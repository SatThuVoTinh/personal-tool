// M10/T2-R6 — native-boundary predecessor admission.
//
// The R5 deployment attempt never started: `configure.mjs --preflight`
// refused the live R3 runtime with `Governance plugin asset drift
// detected` (installed_mutation false) because live
// `lib/native-boundary.mjs` (d88bff80, the R18 build, unchanged since the
// R16 deployment era) was not admitted, while the R5 candidate rebuilds it
// as bccfa861. Same deadlock class R2 closed for the entrypoint and R3
// closed for ten assets — this time one asset wide.
//
// Provenance (not inference): the digest was re-derived by materializing
// commit 980b36e (R18 run-end liveness propagation) and packaging it
// through the repository's own governancePluginFiles() — byte-identical to
// the observed live file. See R6 P1, which re-derives it in-test.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The live R3 predecessor R6 admits, proven in R6 P1 below. */
const HYGIENE_BOUNDARY_SHA256 =
  "d88bff80aeb3d7531e5a0dceba4e7ba856d085e64a87cbb414c9f295284d81e3";

/**
 * M10/T2-R8: the outgoing build, live at BOTH governed paths before the R8
 * deployment. Now listed so --preflight admits the deployed extension.
 */
const CANDIDATE_BOUNDARY_SHA256 =
  "9e73518583006c0b9c5f8cc058e3bbd10e4749c2004aa9a4204ef226452f842a";

/** The build R8 replaces; listed as an approved predecessor. */
const R6_BOUNDARY_SHA256 =
  "bccfa8616dc89fbb3764d53ad6ea11f5cfbc445bc076e4270f2678c6c1e18c3a";
assert.ok(
  CONFIGURE_SOURCE.includes(R6_BOUNDARY_SHA256),
  "the outgoing R6 build must remain an admitted predecessor",
);

/** The commit whose packaged boundary reproduces the live digest. */
const HYGIENE_SOURCE_COMMIT = "980b36e";

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

function provisioned() {
  const root = mkdtempSync(path.join(tmpdir(), "zink-r6-"));
  const stateDir = path.join(root, ".openclaw-zink");
  const systemdUserDir = path.join(root, ".config", "systemd", "user");
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  const run = (mode) => () =>
    execFileSync(
      process.execPath,
      [
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

/** Package a historical commit through the real generator (provenance). */
let hygieneGenerated = null;
async function hygieneExtension() {
  if (hygieneGenerated) return hygieneGenerated;
  const scratch = mkdtempSync(path.join(os.tmpdir(), "zink-r6-gen-"));
  try {
    const archive = spawnSync(
      "git",
      ["archive", HYGIENE_SOURCE_COMMIT, "--", "integrations/openclaw"],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(archive.status, 0, "git archive must succeed");
    const tar = spawnSync("tar", ["-x", "-C", scratch], {
      input: archive.stdout,
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(tar.status, 0, "extract must succeed");
    const { governancePluginFiles } = await import(
      pathToFileURL(
        path.join(scratch, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    );
    hygieneGenerated = governancePluginFiles();
    return hygieneGenerated;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const currentBuild = async () =>
  (
    await import(
      pathToFileURL(
        path.join(REPO, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    )
  ).governancePluginFiles();

function assetTable() {
  const start = CONFIGURE_SOURCE.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the allowlist table must exist");
  const end = CONFIGURE_SOURCE.indexOf("\n});", start);
  assert.notEqual(end, -1, "the allowlist table must be terminated");
  return CONFIGURE_SOURCE.slice(start, end);
}

function keyBlock(table, key) {
  const at = table.indexOf(`"${key}": Object.freeze([`);
  assert.notEqual(at, -1, `${key} must have an allowlist entry`);
  return table.slice(at, table.indexOf("]),", at));
}

// ---------------------------------------------------------------------------
// PROVENANCE — 1/1 before admission
// ---------------------------------------------------------------------------

test("R6 P1: the live boundary digest is reproduced from its source commit", async () => {
  const hygiene = await hygieneExtension();
  assert.equal(
    sha256(hygiene.assets["lib/native-boundary.mjs"]),
    HYGIENE_BOUNDARY_SHA256,
    "the committed R18 source must reproduce the live digest",
  );
  // Optional live cross-check: skip where the live dir is unreachable.
  let liveDigest = null;
  try {
    liveDigest = sha256(
      readFileSync(
        "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/lib/native-boundary.mjs",
        "utf8",
      ),
    );
  } catch {
    /* not reachable from this platform */
  }
  if (liveDigest !== null) assert.equal(liveDigest, HYGIENE_BOUNDARY_SHA256);
});

// ---------------------------------------------------------------------------
// THE ALLOWLIST — exactly one addition, at its own path
// ---------------------------------------------------------------------------

test("R6 0: provenance parity — one admitted digest for one proven record", () => {
  const table = assetTable();
  const block = keyBlock(table, "lib/native-boundary.mjs");
  assert.ok(
    block.includes(HYGIENE_BOUNDARY_SHA256),
    "the proven digest must be listed under lib/native-boundary.mjs",
  );
  assert.equal(
    CONFIGURE_SOURCE.split(HYGIENE_BOUNDARY_SHA256).length - 1,
    1,
    "exactly one allowlist occurrence: no duplication, no leakage",
  );
  assert.equal(
    /"\*"|\*\//u.test(CONFIGURE_SOURCE),
    false,
    "no wildcard entries",
  );
});

test("R6 0b: the candidate build digest is NOT listed", async () => {
  const current = await currentBuild();
  assert.equal(
    sha256(current.assets["lib/native-boundary.mjs"]),
    CANDIDATE_BOUNDARY_SHA256,
    "the test pins the actual candidate bytes",
  );
  assert.equal(
    CONFIGURE_SOURCE.includes(CANDIDATE_BOUNDARY_SHA256),
    false,
    "the candidate build must stay accepted by content comparison, not by entry",
  );
});

test("R6 0c: preflight and apply share the single asset allowlist", () => {
  const uses = [
    ...CONFIGURE_SOURCE.matchAll(
      /ALLOWED_GOVERNANCE_ASSET_SHA256\[relative\]/gu,
    ),
  ];
  assert.equal(
    uses.length,
    2,
    "the preflight gate and the apply gate must consume the same table",
  );
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — the exact production deadlock, then its resolution
// ---------------------------------------------------------------------------

test("R6 1: the proven predecessor passes preflight and converges on apply", async () => {
  const hygiene = await hygieneExtension();
  const current = await currentBuild();
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    assert.equal(
      sha256(hygiene.assets["lib/native-boundary.mjs"]),
      HYGIENE_BOUNDARY_SHA256,
      "fixture bytes must be the proven predecessor",
    );
    writeFileSync(target, hygiene.assets["lib/native-boundary.mjs"], "utf8");
    const out = p.preflight().toString("utf8");
    const parsed = JSON.parse(out);
    assert.equal(parsed.preflight, "PASS");
    assert.equal(parsed.installedMutation, false);
    assert.equal(sha256(readFileSync(target, "utf8")), HYGIENE_BOUNDARY_SHA256);
    p.apply();
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      sha256(current.assets["lib/native-boundary.mjs"]),
      "apply must install the candidate bytes",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R6 2: a one-byte perturbation of the predecessor is refused", async () => {
  const hygiene = await hygieneExtension();
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    const perturbed = `${hygiene.assets["lib/native-boundary.mjs"]}// x\n`;
    assert.notEqual(sha256(perturbed), HYGIENE_BOUNDARY_SHA256);
    writeFileSync(target, perturbed, "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), perturbed);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R6 3: an unknown digest on this path is refused without mutation", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, "unrecognized boundary body\n", "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), "unrecognized boundary body\n");
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R6 4: the proven digest at the WRONG path is refused", async () => {
  const hygiene = await hygieneExtension();
  const p = provisioned();
  try {
    writeFileSync(
      p.asset("lib/queue-manager.mjs"),
      hygiene.assets["lib/native-boundary.mjs"],
      "utf8",
    );
    assert.throws(
      p.preflight,
      /Governance plugin asset drift detected/u,
      "path binding must hold: the boundary digest is not a queue-manager digest",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});
