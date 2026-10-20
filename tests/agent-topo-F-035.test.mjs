// M12/T9 F-035 - the state root's own files must be private.
//
// The builder's named-path checks judge the files the builder OWNS. An
// operator-made COPY of the credential-bearing config is not one of them, so
// nothing ever judged it: the live host carried
// `/home/hoang_vinh/.openclaw-zink/openclaw.json.bak-mobile-1789615159090`
// with mode 0644 - readable by every account on the machine - and no gate
// refused it.
//
// The lanes below prove:
//   1. the ENUMERATION finds every regular file under the state root whose
//      mode carries group or other bits, and reports a private file as clean;
//   2. the refusal is NAMED and names the offending file;
//   3. the builder calls the enumeration on the preflight/apply path, and the
//      named-path checks it replaces are still there.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertStateRootFileModes,
  stateRootFileModeFindings,
  STATE_ROOT_FILE_MODE_DRIFT,
} from "../integrations/openclaw/topology/lib/state-root-modes.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const builderSource = readFileSync(
  path.join(REPO_ROOT, "integrations", "openclaw", "configure.mjs"),
  "utf8",
);

/** A state root with one private file, one world-readable copy and a dir. */
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "f035-state-"));
  writeFileSync(path.join(root, "openclaw.json"), "{}\n");
  writeFileSync(path.join(root, "openclaw.json.bak-mobile-1789615159090"), "{}\n");
  mkdirSync(path.join(root, "operator"), { recursive: true });
  return root;
}

/** The mode the fixture's files carry, injected so the lane runs anywhere. */
function fakeModes() {
  return (target) =>
    path.basename(target).startsWith("openclaw.json.bak") ? 0o644 : 0o600;
}

test("F-035: the state root is enumerated and every group- or other-accessible file is found", () => {
  const root = fixture();
  try {
    const findings = stateRootFileModeFindings(root, fakeModes());
    assert.deepEqual(
      findings.map((finding) => finding.name),
      ["openclaw.json.bak-mobile-1789615159090"],
      "the world-readable copy must be found and the private file must not",
    );
    assert.equal(findings[0].mode, 0o644);
    // A file with NO group/other bits is never reported.
    const clean = stateRootFileModeFindings(root, () => 0o600);
    assert.deepEqual(clean, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-035: the refusal is named and names the offending file", () => {
  const root = fixture();
  try {
    let thrown = null;
    try {
      assertStateRootFileModes(root, {
        platform: "linux",
        modeOf: fakeModes(),
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "the enumeration must refuse");
    assert.equal(thrown.code, STATE_ROOT_FILE_MODE_DRIFT);
    assert.match(
      thrown.message,
      /STATE_ROOT_FILE_MODE_DRIFT/u,
      "the refusal must carry its own named code",
    );
    assert.match(
      thrown.message,
      /openclaw\.json\.bak-mobile-1789615159090/u,
      "the operator must be told WHICH file to act on",
    );
    // A clean state root is accepted.
    assert.doesNotThrow(() =>
      assertStateRootFileModes(root, { platform: "linux", modeOf: () => 0o600 }),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-035: the builder refuses on the preflight/apply path and keeps its named checks", () => {
  assert.ok(
    builderSource.includes(
      'from "./topology/lib/state-root-modes.mjs"',
    ),
    "the builder must use the shared enumeration",
  );
  assert.ok(
    builderSource.includes("assertStateRootFileModes(stateDir);"),
    "the builder must call the enumeration",
  );
  const dryRun = builderSource.indexOf('if (options.mode === "dry-run")');
  const enumeration = builderSource.indexOf("assertStateRootFileModes(stateDir);");
  const firstMutation = builderSource.indexOf("await createRuntimeBackup(");
  assert.ok(dryRun >= 0 && enumeration > dryRun, "the call must be after --dry-run");
  assert.ok(
    firstMutation > 0 && enumeration < firstMutation,
    "the call must be before the apply mutates anything, so the apply fails closed too",
  );
  // The named-path checks this row complements are NOT removed.
  assert.ok(
    builderSource.includes("function requireFileMode("),
    "the named-path mode checks must stay",
  );
  assert.ok(
    builderSource.includes("requireFileMode(output.identityKeyPath, 0o600"),
    "the identity key must still be checked by name",
  );
});
