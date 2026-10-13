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
// M10/T2-R9: `configure.mjs` is spawned as a child process and now fails
// closed without a router endpoint/credential, so supply non-routable
// placeholders. Reachability is proven by verify.mjs, never by these.
import {
  ROUTER_TEST_API_KEY,
  ROUTER_TEST_HOST,
  ROUTER_TEST_PORT,
} from "./helpers/router-env.mjs";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The live R3 predecessor R7 admits, proven in R7 P1 below. */
const HYGIENE_AUTHORITY_SHA256 =
  "aa12540f60da6bcdf809123f0d75c632c6b8a128a88e4395f38785b663f13e17";

/**
 * M10/T2-R14: the current candidate build. Moves from the R12/R13 build
 * (`8243a038…`, now an admitted predecessor) by dropping the impossible `auth`
 * requirement from `validateOpenClawReleaseCompatibility`: R9 removed
 * auth.profiles/order/cooldowns on purpose and `validateConfig` rejects
 * unexpected top-level keys, so no config this repository produces could ever
 * satisfy the old list. Deliberately NOT listed (content comparison); the
 * outgoing predecessor is admitted.
 */
const CANDIDATE_AUTHORITY_SHA256 =
  "c38e1a6b7934bd01afd262dca0402fbb6936086a03b10731b91952db4003f36b";

/**
 * M12/T1-R1: the authority asset the live WSL runtime actually carries, measured
 * read-only (`sha256sum` of
 * `/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/lib/authority.mjs`)
 * before this task edited that file's byte-budget comment. It is neither the M8/T3
 * hygiene build nor the R9-C build: those were replaced by the M11/T1-R1 and
 * M11/T3-R1 deployments, so this test's earlier live cross-check was only ever
 * reachable on a host where the live directory could not be read — the Windows
 * side skipped it, and it failed on WSL from `2ef4bd6` forward. The same value is
 * admitted in configure.mjs as the outgoing predecessor, which is what keeps
 * --preflight reachable from the installed runtime.
 */
const LIVE_AUTHORITY_SHA256 =
  "71eee819e9a9ce5d3cc927352ae392c9a57e625fa4618273c7cef9a04c383eb8";

/** The outgoing candidate this deployment replaces; now listed. */
const R9C_AUTHORITY_SHA256 =
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
  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    ZINK_ROUTER_HOST: ROUTER_TEST_HOST,
    ZINK_ROUTER_PORT: ROUTER_TEST_PORT,
    ZINK_ROUTER_API_KEY: ROUTER_TEST_API_KEY,
  };
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
  if (liveDigest !== null) {
    assert.equal(
      liveDigest,
      LIVE_AUTHORITY_SHA256,
      "the reachable live runtime must carry the measured outgoing digest",
    );
    assert.equal(
      CONFIGURE_SOURCE.includes(LIVE_AUTHORITY_SHA256),
      true,
      "and that digest must stay admitted, or --preflight refuses the upgrade",
    );
  }
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
  // M10/T2-R12: the outgoing R9-C authority build IS listed, because it is what
  // the runtime has installed. Without this entry --preflight fails closed with
  // "authority.mjs drift detected" and no deployment is reachable. Listed in the
  // single shared allowlist, so both per-mode paths pick it up.
  assert.ok(
    CONFIGURE_SOURCE.includes(R9C_AUTHORITY_SHA256),
    "the outgoing R9-C authority build must be an admitted predecessor",
  );
});

test("R7 0d: every governed custom_id is deliverable, not merely parseable", async () => {
  // M10/T2-R12: the bug this pins was invisible to every existing assertion.
  // A bare `zink:...` custom_id parses correctly through our own
  // parseComponentCustomId, round-trips in tests, and is still undeliverable —
  // the host's parseDiscordComponentCustomId requires the `occomp` key and
  // answers every click with "This component is no longer valid." (proven live
  // 2026-10-08 15:45:08). So the assertion is on the WIRE prefix, not on our
  // internal grammar.
  const { buildComponentCustomId } =
    await import("../integrations/openclaw/lib/authority.mjs");
  const { DISCORD_COMPONENT_ACTION_NAMESPACE } =
    await import("../integrations/openclaw/lib/authority.mjs");
  const taskId = "f".repeat(64);
  for (const actionType of Object.values(DISCORD_COMPONENT_ACTION_NAMESPACE)) {
    const customId = buildComponentCustomId(actionType, taskId, "1");
    assert.ok(
      customId.startsWith("occomp:cid="),
      `${actionType}: host cannot route a non-occomp custom_id: ${customId}`,
    );
    // The host splits on ";" before parsing name=value, so a ";" would split the
    // envelope away and truncate the component id.
    assert.equal(customId.includes(";"), false, customId);
    assert.equal(customId.split(";")[0], customId, customId);
  }
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
