// M10/T2-R7 — authority predecessor admission.
//
// The R6 deployment attempt never started: `configure.mjs --preflight`
// refused the live R3 runtime with `Governance plugin asset drift
// detected` (installed_mutation false) because live
// `lib/authority.mjs` (aa12540f, the R2-tree build installed by the R3
// deployment) was not admitted, while the R5/R6 candidate rebuilds it as
// 42b0cba8 (R4/R5 conversational classifiers). Same deadlock class R2
// closed for the entrypoint, R3 for ten assets, and R6 for the boundary —
// this time one asset wide.
//
// Provenance (not inference): the digest was re-derived by materializing
// commit 2ef4bd6 (M8/T3 learning loop, the origin commit that introduced
// these exact bytes — its parent tree carries the hygiene-era bb2f5328)
// and packaging it through the repository's own governancePluginFiles() —
// byte-identical to the observed live file. No rewrite rules touch this
// path at any commit, so packaged bytes equal source bytes. See R7 P1,
// which re-derives it in-test.
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

/** The live R3 predecessor R7 admits, proven in R7 P1 below. */
const HYGIENE_AUTHORITY_SHA256 =
  "aa12540f60da6bcdf809123f0d75c632c6b8a128a88e4395f38785b663f13e17";

/** The R5/R6/R7 candidate build. Deliberately NOT listed (content comparison). */
const CANDIDATE_AUTHORITY_SHA256 =
  "42b0cba8567c1e52376d41d9329394b70c94e45a503af37733dcf76721d536c6";

/** The origin commit whose packaged authority reproduces the live digest. */
const HYGIENE_SOURCE_COMMIT = "2ef4bd6";

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
  const root = mkdtempSync(path.join(tmpdir(), "zink-r7-"));
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
  const scratch = mkdtempSync(path.join(os.tmpdir(), "zink-r7-gen-"));
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

test("R7 P1: the live authority digest is reproduced from its source commit", async () => {
  const hygiene = await hygieneExtension();
  assert.equal(
    sha256(hygiene.assets["lib/authority.mjs"]),
    HYGIENE_AUTHORITY_SHA256,
    "the committed M8/T3 source must reproduce the live digest",
  );
  // Optional live cross-check: skip where the live dir is unreachable.
  let liveDigest = null;
  try {
    liveDigest = sha256(
      readFileSync(
        "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/lib/authority.mjs",
        "utf8",
      ),
    );
  } catch {
    /* not reachable from this platform */
  }
  if (liveDigest !== null) assert.equal(liveDigest, HYGIENE_AUTHORITY_SHA256);
});

// ---------------------------------------------------------------------------
// THE ALLOWLIST — exactly one addition, at its own path
// ---------------------------------------------------------------------------

test("R7 0: provenance parity — one admitted digest for one proven record", () => {
  const table = assetTable();
  const block = keyBlock(table, "lib/authority.mjs");
  assert.ok(
    block.includes(HYGIENE_AUTHORITY_SHA256),
    "the proven digest must be listed under lib/authority.mjs",
  );
  assert.equal(
    CONFIGURE_SOURCE.split(HYGIENE_AUTHORITY_SHA256).length - 1,
    1,
    "exactly one allowlist occurrence: no duplication, no leakage",
  );
  assert.equal(
    /"\*"|\*\//u.test(CONFIGURE_SOURCE),
    false,
    "no wildcard entries",
  );
});

test("R7 0b: the candidate build digest is NOT listed", async () => {
  const current = await currentBuild();
  assert.equal(
    sha256(current.assets["lib/authority.mjs"]),
    CANDIDATE_AUTHORITY_SHA256,
    "the test pins the actual candidate bytes",
  );
  assert.equal(
    CONFIGURE_SOURCE.includes(CANDIDATE_AUTHORITY_SHA256),
    false,
    "the candidate build must stay accepted by content comparison, not by entry",
  );
});

test("R7 0c: preflight and apply share the single asset allowlist", () => {
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

test("R7 1: the proven predecessor passes preflight and converges on apply", async () => {
  const hygiene = await hygieneExtension();
  const current = await currentBuild();
  const p = provisioned();
  try {
    const target = p.asset("lib/authority.mjs");
    assert.equal(
      sha256(hygiene.assets["lib/authority.mjs"]),
      HYGIENE_AUTHORITY_SHA256,
      "fixture bytes must be the proven predecessor",
    );
    writeFileSync(target, hygiene.assets["lib/authority.mjs"], "utf8");
    const out = p.preflight().toString("utf8");
    const parsed = JSON.parse(out);
    assert.equal(parsed.preflight, "PASS");
    assert.equal(parsed.installedMutation, false);
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      HYGIENE_AUTHORITY_SHA256,
    );
    p.apply();
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      sha256(current.assets["lib/authority.mjs"]),
      "apply must install the candidate bytes",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R7 2: a one-byte perturbation of the predecessor is refused", async () => {
  const hygiene = await hygieneExtension();
  const p = provisioned();
  try {
    const target = p.asset("lib/authority.mjs");
    const perturbed = `${hygiene.assets["lib/authority.mjs"]}// x\n`;
    assert.notEqual(sha256(perturbed), HYGIENE_AUTHORITY_SHA256);
    writeFileSync(target, perturbed, "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), perturbed);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R7 3: an unknown digest on this path is refused without mutation", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/authority.mjs");
    writeFileSync(target, "unrecognized authority body\n", "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(readFileSync(target, "utf8"), "unrecognized authority body\n");
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R7 4: the proven digest at the WRONG path is refused", async () => {
  const hygiene = await hygieneExtension();
  const p = provisioned();
  try {
    writeFileSync(
      p.asset("lib/queue-manager.mjs"),
      hygiene.assets["lib/authority.mjs"],
      "utf8",
    );
    assert.throws(
      p.preflight,
      /Governance plugin asset drift detected/u,
      "path binding must hold: the authority digest is not a queue-manager digest",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});
