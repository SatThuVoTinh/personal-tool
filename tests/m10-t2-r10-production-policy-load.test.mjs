// M10/T2-R10 — production policy-loading regression.
//
// Incident: every built-in tool call (`session_status`, `sessions_spawn`,
// `sessions_yield`, `agents_list`) failed in production with
// `RUNTIME_CAPABILITY_MISMATCH`, while the same call passed in tests. Root
// cause: `guard.mjs` resolved its policy module with
// `path.resolve(pathToFileURL(_moduleDir), candidate)`, which throws
// `ERR_INVALID_ARG_TYPE` because `path.resolve` rejects a URL object. The throw
// was swallowed, the package-relative candidate always died, and the
// cwd-relative fallback only works when tests run from the repository root.
// The production gateway runs with cwd `/home/hoang_vinh`, so policy stayed
// null, every capability registry stayed empty, and built-in tools fell into
// the Zink capability path.
//
// This suite spawns the probe with `cwd` set to an EMPTY directory that
// contains no repository files — the production condition. The probe imports
// every repository module by absolute file URL, so the ONLY thing that can
// resolve policy is the guard's own loader. A regression therefore fails here
// instead of passing falsely.
//
// What `allow: true` proves: with empty registries `session_status` cannot
// take the built-in path and dies at the Zink capability check, so an allow
// proves the registries are populated. What the spawn/yield denials prove:
// they carry the NORMAL governed reasons (`AUTH_APPROVAL_REQUIRED` for an
// unapproved spawn, `SPAWN_UNKNOWN` for a yield with no children), which are
// only reachable past the registry check — so the fix did not convert denials
// into allows.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROBE = path.join(REPO, "tests", "fixtures", "r10-policy-load-probe.mjs");

function runProbe() {
  // An empty cwd: no package.json, no integrations/ tree, nothing the
  // cwd-relative fallback could resolve. This IS the production condition.
  const emptyCwd = mkdtempSync(path.join(os.tmpdir(), "zink-r10-cwd-"));
  const stateDir = mkdtempSync(path.join(os.tmpdir(), "zink-r10-state-"));
  try {
    const raw = execFileSync(process.execPath, [PROBE, stateDir, REPO], {
      cwd: emptyCwd,
      encoding: "utf8",
      timeout: 120_000,
    });
    return JSON.parse(raw);
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  }
}

const byName = (out, name) => {
  const found = out.checks.find((c) => c.name === name);
  assert.ok(found, `probe must report ${name}`);
  return found;
};

test("R10: the probe really ran outside the repository", () => {
  const out = runProbe();
  assert.notEqual(
    path.resolve(out.cwd),
    REPO,
    "probe cwd must not be the repository",
  );
  assert.ok(
    !path.resolve(out.cwd).startsWith(`${REPO}${path.sep}`),
    "probe cwd must not be inside the repository",
  );
});

test("R10: session_status and agents_list reach allow (registries populated)", () => {
  const out = runProbe();
  for (const name of ["session_status", "agents_list"]) {
    const c = byName(out, name);
    assert.equal(c.threw ?? null, null, `${name} must not throw: ${c.threw}`);
    assert.equal(c.allow, true, `${name} must allow for main`);
  }
});

test("R10: spawn and yield reach their NORMAL governed denials", () => {
  const out = runProbe();
  const spawn = byName(out, "sessions_spawn");
  assert.equal(spawn.allow, false, "unapproved spawn must stay denied");
  assert.equal(
    spawn.reason ?? spawn.threw,
    "AUTH_APPROVAL_REQUIRED",
    `spawn must hit the approval gate, got: ${spawn.reason ?? spawn.threw}`,
  );
  const yld = byName(out, "sessions_yield");
  assert.equal(yld.allow, false, "childless yield must stay denied");
  assert.equal(
    yld.reason ?? yld.threw,
    "SPAWN_UNKNOWN",
    `yield must hit the child check, got: ${yld.reason ?? yld.threw}`,
  );
});

test("R10: no incident tool fails with the empty-registry signature", () => {
  const out = runProbe();
  for (const name of [
    "session_status",
    "agents_list",
    "sessions_spawn",
    "sessions_yield",
  ]) {
    const c = byName(out, name);
    const sig = c.reason ?? c.threw ?? "";
    assert.ok(
      sig !== "RUNTIME_CAPABILITY_MISMATCH",
      `${name} must not die with the empty-registry signature, got: ${sig}`,
    );
  }
});

test("R10: invalid lineage still denies (no fail-open)", () => {
  const out = runProbe();
  const c = byName(out, "bogus-run-stays-denied");
  assert.equal(c.allow, false, "unknown run must stay denied");
  assert.equal(
    c.reason ?? c.threw,
    "EXECUTION_STATE_UNKNOWN",
    `bogus run must hit lineage, got: ${c.reason ?? c.threw}`,
  );
});
