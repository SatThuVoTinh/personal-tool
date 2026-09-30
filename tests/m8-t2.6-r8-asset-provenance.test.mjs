// M8/T2.2-R8 — verified R5 governance-asset provenance.
//
// The restored pre-incident R5 extension differs from the current build in
// exactly one allowlist-governed asset: lib/native-boundary.mjs. R7 changed only
// that file, so no approved-predecessor entry existed and configure.mjs
// --preflight refused the whole extension with
// "Governance plugin asset drift detected".
//
// R8 adds that one byte-exact digest. These tests pin both the acceptance and,
// more importantly, that nothing else became acceptable: an unknown asset, a
// one-byte-modified R5 asset and the R5 bytes at the wrong path must all still be
// refused without being overwritten.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

/**
 * The R5-era digest of lib/native-boundary.mjs, established by packaging the
 * R5-era tree at commit 9713872 and comparing byte-for-byte against the restored
 * pre-incident extension. It is the only digest R8 adds.
 */
const R5_NATIVE_BOUNDARY_SHA256 =
  "49352d47ac88798cc918c654875f84241a7efbb1d5a661c64b77e7efbacf3be9";

// The R7 G2 hunk and its R5 predecessor. Deriving the R5 body this way keeps the
// test hermetic (no git, no network) while still PROVING identity: the digest
// assertion below fails loudly if the R7 hunk ever changes shape.
const R7_HUNK = `  } catch (error) {
    // R7 G2: the host-visible contract string is unchanged, but the original
    // failure is preserved as the cause so a governance verdict and a genuine
    // execution-state fault stay distinguishable. Only the fixed error message
    // is logged: never the stack, the run context, or message content.
    console.error(
      "[zink-native-gate] enterNativeRun:",
      error?.message ?? error,
    );
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE", { cause: error });
  }`;
const R5_HUNK = `  } catch {
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE");
  }`;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const r5NativeBoundaryBody = () => {
  const current = readFileSync(
    path.join(
      REPO,
      "integrations",
      "openclaw",
      "topology",
      "lib",
      "native-boundary.mjs",
    ),
    "utf8",
  );
  assert.ok(
    current.includes(R7_HUNK),
    "the R7 G2 hunk must still be present for the R5 body to be derivable",
  );
  const derived = current.replace(R7_HUNK, R5_HUNK);
  assert.equal(
    sha256(derived),
    R5_NATIVE_BOUNDARY_SHA256,
    "derived R5 body must reproduce the packaged R5 digest exactly",
  );
  return derived;
};

const identifiers = Object.freeze({
  discordGuildId: "123456789012345678",
  discordOwnerId: "223456789012345678",
  discordOfficeChannelId: "323456789012345678",
  discordResultsForumId: "423456789012345678",
  discordApprovalsForumId: "523456789012345678",
  discordIncidentsForumId: "62345678901234567",
});
const identifierArgs = Object.freeze([
  "--discord-guild-id",
  identifiers.discordGuildId,
  "--discord-owner-id",
  identifiers.discordOwnerId,
  "--discord-office-channel-id",
  identifiers.discordOfficeChannelId,
  "--discord-results-forum-id",
  identifiers.discordResultsForumId,
  "--discord-approvals-forum-id",
  identifiers.discordApprovalsForumId,
  "--discord-incidents-forum-id",
  identifiers.discordIncidentsForumId,
]);

/** Build a throwaway state dir with the current build already materialized. */
function provisioned() {
  const root = mkdtempSync(path.join(tmpdir(), "zink-r8-"));
  const stateDir = path.join(root, ".openclaw-zink");
  const systemdUserDir = path.join(root, ".config", "systemd", "user");
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  const run = (mode) => () =>
    execFileSync(
      process.execPath,
      [
        "--",
        CONFIGURE,
        mode,
        "--state-dir",
        stateDir,
        "--systemd-user-dir",
        systemdUserDir,
        ...identifierArgs,
      ],
      { env, stdio: "pipe" },
    );
  run("--apply")();
  const asset = (rel) =>
    path.join(stateDir, "extensions", "zink-governance", ...rel.split("/"));
  return {
    root,
    stateDir,
    asset,
    apply: run("--apply"),
    preflight: run("--preflight"),
  };
}

test("R8: the R5 body is derivable and hashes to the packaged R5 digest", () => {
  assert.equal(sha256(r5NativeBoundaryBody()), R5_NATIVE_BOUNDARY_SHA256);
});

test("R8: the verified R5 predecessor digest is allowlisted for its exact path", () => {
  // Present exactly once in the table, and only under lib/native-boundary.mjs.
  const occurrences =
    CONFIGURE_SOURCE.split(R5_NATIVE_BOUNDARY_SHA256).length - 1;
  assert.equal(occurrences, 1, "the R5 digest must appear exactly once");
  const key = '"lib/native-boundary.mjs": Object.freeze([';
  const at = CONFIGURE_SOURCE.indexOf(key);
  assert.notEqual(
    at,
    -1,
    "the lib/native-boundary.mjs allowlist key must exist",
  );
  const block = CONFIGURE_SOURCE.slice(at, CONFIGURE_SOURCE.indexOf("]),", at));
  assert.ok(
    block.includes(R5_NATIVE_BOUNDARY_SHA256),
    "the R5 digest must be listed under lib/native-boundary.mjs",
  );
});

test("R8: a verified R5 predecessor asset is accepted and may be upgraded", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, r5NativeBoundaryBody(), "utf8");
    // Must NOT throw: the deployed R5 asset is a recognized predecessor.
    assert.doesNotThrow(p.apply);
    // An accepted predecessor is UPGRADED to the current build -- that is what
    // apply is for. The no-overwrite guarantee belongs to refused assets only,
    // and is asserted separately below.
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      sha256(
        readFileSync(
          path.join(
            REPO,
            "integrations",
            "openclaw",
            "topology",
            "lib",
            "native-boundary.mjs",
          ),
          "utf8",
        ),
      ),
      "apply must converge an accepted predecessor onto the current build",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: the current build asset is still accepted", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    assert.doesNotThrow(p.apply);
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      sha256(
        readFileSync(
          path.join(
            REPO,
            "integrations",
            "openclaw",
            "topology",
            "lib",
            "native-boundary.mjs",
          ),
          "utf8",
        ),
      ),
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: an unknown asset is rejected and NOT overwritten", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, "unrecognized plugin asset\n", "utf8");
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(
      readFileSync(target, "utf8"),
      "unrecognized plugin asset\n",
      "a refused asset must be left byte-identical on disk",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: a one-byte modification of the verified R5 asset is rejected", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    const tampered = `${r5NativeBoundaryBody()}// tampered\n`;
    assert.notEqual(sha256(tampered), R5_NATIVE_BOUNDARY_SHA256);
    writeFileSync(target, tampered, "utf8");
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), tampered);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: the correct R5 bytes at the wrong path are rejected", () => {
  const p = provisioned();
  try {
    // Same bytes, path the allowlist does not grant them at. Path semantics are
    // part of the contract: a digest is only ever valid at its own path.
    const wrong = p.asset("lib/schema.mjs");
    writeFileSync(wrong, r5NativeBoundaryBody(), "utf8");
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(wrong, "utf8"), r5NativeBoundaryBody());
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: an unrelated older governance asset is rejected", () => {
  const p = provisioned();
  try {
    const legacy = [
      "// legacy governance build, never an approved predecessor",
      'export const GOVERNANCE_VERSION = "m7-t2-r9";',
      "export function beforeRun() { return { allow: true }; }",
      "",
    ].join("\n");
    const target = p.asset("lib/guard.mjs");
    writeFileSync(target, legacy, "utf8");
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), legacy);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: an arbitrary unapproved asset still fails --preflight with no mutation", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, "still not an approved build\n", "utf8");
    const before = readFileSync(target, "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.equal(
      readFileSync(target, "utf8"),
      before,
      "preflight must not write anything",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: --preflight accepts the verified R5 predecessor and mutates nothing", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, r5NativeBoundaryBody(), "utf8");
    const configPath = path.join(p.stateDir, "openclaw.json");
    const configBefore = readFileSync(configPath, "utf8");
    const out = p.preflight().toString("utf8");
    const parsed = JSON.parse(out);
    assert.equal(parsed.preflight, "PASS");
    assert.equal(parsed.installedMutation, false);
    assert.equal(readFileSync(configPath, "utf8"), configBefore);
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      R5_NATIVE_BOUNDARY_SHA256,
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R8: the R5 predecessor allowlist entry is path-scoped, not global", () => {
  // The digest must not appear in any other allowlist key, so it cannot be
  // replayed onto a different asset.
  const keys = [
    ...CONFIGURE_SOURCE.matchAll(/"([^"]+)": Object\.freeze\(\[/g),
  ].map((m) => m[1]);
  const holders = keys.filter((key) => {
    const at = CONFIGURE_SOURCE.indexOf(`"${key}": Object.freeze([`);
    const block = CONFIGURE_SOURCE.slice(
      at,
      CONFIGURE_SOURCE.indexOf("]),", at),
    );
    return block.includes(R5_NATIVE_BOUNDARY_SHA256);
  });
  assert.deepEqual(holders, ["lib/native-boundary.mjs"]);
});

test("R8: existing approved predecessors are preserved", () => {
  // Spot-check that R8 did not empty or replace any pre-existing table entry.
  for (const key of [
    "lib/workflow.mjs",
    "contracts/ledger-event.schema.json",
    "contracts/ledger-snapshot.schema.json",
    "lib/native-boundary.mjs",
  ]) {
    const at = CONFIGURE_SOURCE.indexOf(`"${key}": Object.freeze([`);
    assert.notEqual(at, -1, `${key} must still have an allowlist entry`);
    const block = CONFIGURE_SOURCE.slice(
      at,
      CONFIGURE_SOURCE.indexOf("]),", at),
    );
    const count = (block.match(/[0-9a-f]{64}/gu) ?? []).length;
    assert.ok(count >= 1, `${key} must retain at least one approved digest`);
  }
  // The pre-existing six native-boundary predecessors must all survive.
  const at = CONFIGURE_SOURCE.indexOf(
    '"lib/native-boundary.mjs": Object.freeze([',
  );
  const block = CONFIGURE_SOURCE.slice(at, CONFIGURE_SOURCE.indexOf("]),", at));
  for (const d of [
    "4b77356f2a843f26040a7cd3312c896469aff33cc472bc6c02fdd5c472bd1234",
    "4c3f908b84ae64155e6a32741596fc6e2b28601127b72dc33fcea20bcbcc7347",
    "25759e86e53d962bcb00a13eedd63ea028abb31c212ae2874a84bfd041509809",
    "164b17293cf4ac63089ad2ea1afe96bc24b39450bc3332820bc9f5fff654e253",
    "8dbd524a49a8b65959e74f0aaf37516a7a211759bd0a3d047dfd1e73863bd741",
    "6308a7c37745f2a8214a5ad47f9dd3fa0af00d1479ea9676d15bd3a6eb8ea29a",
  ]) {
    assert.ok(
      block.includes(d),
      `pre-existing predecessor ${d.slice(0, 12)} must survive`,
    );
  }
});
