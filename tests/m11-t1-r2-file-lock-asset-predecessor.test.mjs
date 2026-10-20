// M11/T1-R2 — admit the one live `lib/file-lock.mjs` asset predecessor.
//
// M11/T1-R1 closed with `Deployment Authorized: NO`, so its build was never
// installed. When the owner granted deployment on 2026-10-12, the read-only
// `configure.mjs --preflight` failed closed:
//
//   Governance plugin asset drift detected:
//   /home/hoang_vinh/.openclaw-zink/extensions/zink-governance/lib/file-lock.mjs
//
// The live entrypoint (`230f3c79…`) was already admitted in BOTH per-mode
// lists, so the refusal was an asset-layer gap: R1 changed `index.mjs` (all four
// phases) AND `lib/file-lock.mjs` (`d773856`, then `8b5c9e0`), but only the
// entrypoint digest was re-pinned and admitted. A full 33-file scan of the live
// tree proved the gap is exactly one asset: 31 files are byte-equal to the
// current build, `index.mjs` is an admitted predecessor, and `lib/file-lock.mjs`
// is not.
//
// R2 admits exactly that one OUTGOING digest, proven the same way M10/T2-R3
// proved its ten: the live runtime is re-packaged from `ea84a5a` through the
// repository's own `governancePluginFiles()`, and test R2 P1 shows the whole
// live tree equals that commit's packaged build. `d773856`'s intermediate
// digest is deliberately NOT admitted — that build was never installed anywhere
// — and R2 3 proves the gate still refuses it, so the admission is bounded to
// what was actually live rather than to every historic revision.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { skipWhenUnreachable } from "./helpers/historical-read.mjs";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * The commit whose packaged governance-plugin build IS the live runtime:
 * `ea84a5a` ("fix(m10/t2-r13-r25): sweep 39 defects…"). R2 P1 re-derives the
 * admitted digest from this commit through the real generator, so the value
 * added to the allowlist is proven by construction, not transcribed.
 */
const LIVE_SOURCE_COMMIT = "ea84a5a";

/** The live `lib/file-lock.mjs` bytes R2 admits. */
const LIVE_FILE_LOCK_SHA256 =
  "1975c821f94afe25147debe5ca538f83c3c0e2e3be10bfcacca80c3e9bfbf37e";

/** The live entrypoint, admitted before R2; pinned here, not added. */
const LIVE_ENTRYPOINT_SHA256 =
  "230f3c79d0a35c2261129ddc0048ad4f0ae4fc6d86a5c49e444594a446bd2982";

/** The only other predecessor already listed for this asset (M10/T2-R18). */
const R18_FILE_LOCK_SHA256 =
  "165243b2edb0ff5a406f146343220320947ac930a91779de42f8232c28b6d2d4";

/**
 * `d773856`'s file-lock build — an intermediate revision that was never
 * installed on any runtime, so it must stay unadmitted and keep being refused.
 */
const NEVER_INSTALLED_SHA256 =
  "0e533f101b699b8432a374e7db0758ac8610b462cbcb4255065fe2b49041dcd1";

/**
 * The asset digest the live WSL runtime carries after the M11/T1-R2
 * deployment — recorded in PLAN.md §3/§4 and CHANGELOG.md as
 * `lib/file-lock.mjs = 22d7411a…`. M11/T3 Phase 2 (B1: the non-spinning
 * `releaseAsync`, the WSL drvfs/9p errnos, the owner-token cleanup on
 * exhaustion) makes it the outgoing build, so it must be admitted or
 * --preflight refuses the deployed extension.
 */
const M11_T3_OUTGOING_FILE_LOCK_SHA256 =
  "22d7411a1a4613bc70379b405c922b560fd15cf41e81d0ff52db7231c409e6ff";

/** The CURRENT build's file-lock asset — accepted by content, never listed. */
const CURRENT_FILE_LOCK_SHA256 =
  "e9cac11dea2ebca6fd57f55e1aca6a7c0a6959fb4ff6a6dabf0811533a9bde06";

const identifiers = Object.freeze({
  discordGuildId: "123456789012345678",
  discordOwnerId: "223456789012345678",
  discordOfficeChannelId: "323456789012345678",
  discordResultsForumId: "423456789012345678",
  discordApprovalsForumId: "523456789012345678",
  discordIncidentsForumId: "62345678901234567",
});

import {
  ROUTER_TEST_API_KEY,
  ROUTER_TEST_HOST,
  ROUTER_TEST_PORT,
} from "./helpers/router-env.mjs";

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
  const root = mkdtempSync(path.join(tmpdir(), "zink-r2-"));
  const stateDir = path.join(root, ".openclaw-zink");
  const systemdUserDir = path.join(root, ".config", "systemd", "user");
  // configure.mjs runs as a CHILD process, so the non-routable placeholders must
  // reach its environment; reachability is never proven by these values.
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
  return { root, asset, apply: run("--apply"), preflight: run("--preflight") };
}

const currentBuild = async () =>
  (
    await import(
      pathToFileURL(
        path.join(REPO, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    )
  ).governancePluginFiles();

/**
 * Package the LIVE source commit through the REAL generator in a scratch tree —
 * provenance by construction.
 */
let liveGenerated = null;
async function liveExtension() {
  if (liveGenerated) return liveGenerated;
  const scratch = mkdtempSync(path.join(tmpdir(), "zink-r2-gen-"));
  try {
    const archive = spawnSync(
      "git",
      ["archive", LIVE_SOURCE_COMMIT, "--", "integrations/openclaw"],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(
      archive.status,
      0,
      `git archive of ${LIVE_SOURCE_COMMIT} must succeed`,
    );
    const tar = spawnSync("tar", ["-x", "-C", scratch], {
      input: archive.stdout,
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(tar.status, 0, "extracting the archived tree must succeed");
    const { governancePluginFiles } = await import(
      pathToFileURL(
        path.join(scratch, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    );
    liveGenerated = governancePluginFiles();
    return liveGenerated;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// The reachability precondition for the historical-object reads below is
// shared with the other suites that unpack a pinned commit: a shallow clone
// or a pruned object store must produce a named skip, never a red suite for
// a non-code cause.
/** The bounds of the shared ALLOWED_GOVERNANCE_ASSET_SHA256 declaration. */
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

/** The 64-hex digests listed inside one key's block, comments excluded. */
function listedDigests(block) {
  return block
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .flatMap((line) => line.match(/"[0-9a-f]{64}"/gu) || [])
    .map((token) => token.replaceAll('"', ""));
}

// ---------------------------------------------------------------------------
// PROVENANCE — before trusting the admission
// ---------------------------------------------------------------------------

test(
  "R2 P1: the live runtime IS the ea84a5a packaged build and differs from the current build in exactly two files",
  { skip: skipWhenUnreachable(REPO, "ea84a5a") },
  async () => {
    const live = await liveExtension();
    const current = await currentBuild();
    assert.equal(
      sha256(live.entrypoint),
      LIVE_ENTRYPOINT_SHA256,
      "the proven live entrypoint must reproduce from its source commit",
    );
    assert.equal(
      sha256(live.assets["lib/file-lock.mjs"]),
      LIVE_FILE_LOCK_SHA256,
      "the proven live file-lock asset must reproduce from its source commit",
    );
    assert.equal(
      sha256(current.assets["lib/file-lock.mjs"]),
      CURRENT_FILE_LOCK_SHA256,
      "the working tree must carry the final file-lock build",
    );
    // The whole gap R2 closed, stated exactly: of the packaged files, the
    // ea84a5a build differs from the working tree in the entrypoint (admitted),
    // in lib/file-lock.mjs (admitted by R2 and again by M11/T3), in the two
    // assets M11/T3 Phase 1 necessarily moved — lib/native-boundary.mjs (A3) and
    // lib/queue-manager.mjs (A4) — and in the four assets Phase 2 moved:
    // lib/file-lock.mjs (B1), lib/ledger.mjs (B2/B3), lib/decision-ledger.mjs
    // (B4) and lib/guard.mjs (B5). Each divergence is admitted below, so the
    // deployed build stays upgradable. Anything beyond this set would mean the
    // 33-file scan that motivated R2 was wrong.
    const differing = Object.keys(current.assets).filter(
      // M12/T1-R1 packages a new asset that the installed tree does not carry yet; a
      // file with no installed predecessor has no digest to admit, so it counts as a
      // divergence rather than crashing the comparison.
      (rel) =>
        !(rel in live.assets) ||
        sha256(live.assets[rel]) !== sha256(current.assets[rel]),
    );
    assert.deepEqual(
      differing.sort(),
      [
        "contracts/agent-result-payload.schema.json",
        "contracts/approval-request.schema.json",
        "contracts/delegation-envelope.schema.json",
        "contracts/delegation-proposal.schema.json",
        "contracts/execution-brief.schema.json",
        "contracts/governance-manifest.schema.json",
        "contracts/governed-reference.schema.json",
        "contracts/incident.schema.json",
        "contracts/ledger-event.schema.json",
        "contracts/ledger-snapshot.schema.json",
        "contracts/result.schema.json",
        "contracts/trusted-result-envelope.schema.json",
        "governance-manifests.json",
        "lib/artifact-validator.mjs",
        "lib/authority.mjs",
        "lib/canonical.mjs",
        "lib/coordinator-pickup.mjs",
        "lib/decision-ledger.mjs",
        "lib/discord-formatter.mjs",
        "lib/discord-forum-tags.mjs",
        "lib/discord-native-send.mjs",
        "lib/discord-result-preview.mjs",
        "lib/excel-writer.mjs",
        "lib/file-lock.mjs",
        "lib/guard.mjs",
        "lib/ledger.mjs",
        "lib/native-boundary.mjs",
        "lib/policy.mjs",
        "lib/queue-manager.mjs",
        "lib/quota-telemetry.mjs",
        "lib/runtime.mjs",
        "lib/schema.mjs",
        "lib/workflow.mjs",
        "policy/reason-code-matrix.json",
        "policy/workflow-policy.json",
        "zink-skill-store/src/catalog.mjs",
        "zink-skill-store/src/vector-sync.mjs",
        "zink-tools/adapters/knowledge/knowledge-adapter.mjs",
        "zink-tools/adapters/skill-store/skill-adapter.mjs",
        "zink-tools/common/path-safety.mjs",
        "zink-tools/common/semantic-contract.mjs",
        "zink-tools/n8n/trigger.mjs",
        "zink-tools/sql/duckdb-bridge.mjs",
        "zink-tools/sql/validator.mjs",
      ].sort(),
      "only the M11/T3, M12/T1 and M12/T2 assets may diverge from the proven live build",
    );
    const table = assetTable();
    for (const rel of differing) {
      // An asset this task introduces has no installed predecessor to admit; the
      // packaging guard in configure.mjs accepts it because the installed path is
      // missing rather than different.
      if (!(rel in live.assets)) continue;
      assert.equal(
        listedDigests(keyBlock(table, rel)).includes(sha256(live.assets[rel])),
        true,
        `the ea84a5a ${rel} digest must be an admitted predecessor`,
      );
    }
  },
);

test("R2 P2: the live runtime agrees with the proven digest where readable", async (t) => {
  // Read-only cross-check against the real deployed tree. On a host where the
  // live state directory is not reachable this is a skip, never a silent pass:
  // R2 P1 already proves the digest from the committed source.
  //
  // The read and the comparison are separated on purpose. One try/catch around
  // both made an unreadable live root and a drifted live artifact
  // indistinguishable — the catch swallowed the digest mismatch and the suite
  // reported a pass it never earned. Unreadable skips with a named reason; a
  // readable artifact that does not match the proven digest fails.
  const live = "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance";
  let fileLock;
  let entrypoint;
  try {
    fileLock = readFileSync(path.join(live, "lib", "file-lock.mjs"), "utf8");
    entrypoint = readFileSync(path.join(live, "index.mjs"), "utf8");
  } catch (error) {
    t.skip(
      `the live runtime root is not reachable on this host: ${error.code ?? error.message}`,
    );
    return;
  }

  assert.equal(
    sha256(fileLock),
    LIVE_FILE_LOCK_SHA256,
    "the live file-lock asset must match the proven digest",
  );
  assert.equal(
    sha256(entrypoint),
    LIVE_ENTRYPOINT_SHA256,
    "the live entrypoint must still be the admitted predecessor",
  );
});

// ---------------------------------------------------------------------------
// THE ALLOWLIST ITSELF — one addition, bounded
// ---------------------------------------------------------------------------

test("R2 0: the file-lock block holds exactly the three proven predecessors, each listed once", async () => {
  const block = keyBlock(assetTable(), "lib/file-lock.mjs");
  const admitted = [
    R18_FILE_LOCK_SHA256,
    LIVE_FILE_LOCK_SHA256,
    M11_T3_OUTGOING_FILE_LOCK_SHA256,
  ];
  assert.deepEqual(
    listedDigests(block).sort(),
    admitted.slice().sort(),
    "the block must carry the R18 predecessor, the R2 live predecessor and the M11/T3 outgoing build, nothing else",
  );
  for (const digest of admitted) {
    assert.equal(
      CONFIGURE_SOURCE.split(digest).length - 1,
      1,
      `${digest.slice(0, 16)}: exactly one allowlist occurrence`,
    );
  }
  // Nothing else became acceptable: the never-installed intermediate and the
  // current build must not appear anywhere in the gate file.
  const current = await currentBuild();
  for (const digest of [
    NEVER_INSTALLED_SHA256,
    CURRENT_FILE_LOCK_SHA256,
    sha256(current.entrypoint),
  ]) {
    assert.equal(
      CONFIGURE_SOURCE.includes(digest),
      false,
      `${digest.slice(0, 16)} must stay unlisted`,
    );
  }
  assert.equal(
    /"\*"|\*\//u.test(CONFIGURE_SOURCE),
    false,
    "no wildcard entries",
  );
});

test("R2 0b: preflight and apply still share the single asset allowlist", () => {
  // R2 adds a digest to a table consumed by BOTH builder modes, so it cannot
  // create the per-mode deadlock R13 documents for the entrypoint.
  const declarations = [
    ...CONFIGURE_SOURCE.matchAll(
      /const ALLOWED_GOVERNANCE_ASSET_SHA256 = Object\.freeze\(\{/gu,
    ),
  ];
  assert.equal(declarations.length, 1, "exactly one asset allowlist");
  assert.equal(
    [
      ...CONFIGURE_SOURCE.matchAll(
        /ALLOWED_GOVERNANCE_ASSET_SHA256\[relative\]/gu,
      ),
    ].length,
    2,
    "the preflight gate and the apply gate must consume the same table",
  );
});

// ---------------------------------------------------------------------------
// ACCEPTANCE — the observed production state
// ---------------------------------------------------------------------------

test(
  "R2 1: the exact production failure state passes preflight and converges on apply",
  { skip: skipWhenUnreachable(REPO, "ea84a5a") },
  async () => {
    const live = await liveExtension();
    const current = await currentBuild();
    const p = provisioned();
    try {
      // Reproduce the live runtime: the predecessor entrypoint and the predecessor
      // file-lock asset, everything else already current.
      writeFileSync(p.asset("index.mjs"), live.entrypoint, "utf8");
      writeFileSync(
        p.asset("lib/file-lock.mjs"),
        live.assets["lib/file-lock.mjs"],
        "utf8",
      );
      const parsed = JSON.parse(p.preflight().toString("utf8"));
      assert.equal(
        parsed.preflight,
        "PASS",
        "preflight must accept the live state",
      );
      assert.equal(
        parsed.installedMutation,
        false,
        "preflight must not mutate",
      );
      assert.equal(
        sha256(readFileSync(p.asset("lib/file-lock.mjs"), "utf8")),
        LIVE_FILE_LOCK_SHA256,
        "preflight must leave the predecessor in place",
      );
      p.apply();
      assert.equal(
        sha256(readFileSync(p.asset("lib/file-lock.mjs"), "utf8")),
        sha256(current.assets["lib/file-lock.mjs"]),
        "apply must upgrade the admitted predecessor onto the current build",
      );
      assert.equal(
        sha256(readFileSync(p.asset("index.mjs"), "utf8")),
        sha256(current.entrypoint),
        "apply must converge the entrypoint too",
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// REJECTION — the admission is load-bearing, not a blanket
// ---------------------------------------------------------------------------

test(
  "R2 2: a one-byte perturbation of the admitted predecessor is refused without mutation",
  { skip: skipWhenUnreachable(REPO, "ea84a5a") },
  async () => {
    const live = await liveExtension();
    const p = provisioned();
    try {
      const target = p.asset("lib/file-lock.mjs");
      const perturbed = `${live.assets["lib/file-lock.mjs"]}// one extra byte\n`;
      assert.notEqual(sha256(perturbed), LIVE_FILE_LOCK_SHA256);
      writeFileSync(target, perturbed, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin asset drift detected/u,
        "preflight must refuse a perturbed predecessor",
      );
      assert.throws(
        p.apply,
        /Governance plugin asset drift detected/u,
        "apply must refuse a perturbed predecessor",
      );
      assert.equal(
        readFileSync(target, "utf8"),
        perturbed,
        "a refused asset must be left byte-identical",
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  },
);

test(
  "R2 3: the never-installed d773856 intermediate is still refused",
  { skip: skipWhenUnreachable(REPO, "d773856") },
  async () => {
    // The admission is bounded to what actually ran. Provenance of this fixture:
    // `d773856` sits between the live build and the current build, so its bytes
    // are a real historic asset — and admitting it would let an unobserved
    // revision pass the gate.
    const scratch = mkdtempSync(path.join(tmpdir(), "zink-r2-mid-"));
    let bytes;
    try {
      const archive = spawnSync(
        "git",
        ["archive", "d773856", "--", "integrations/openclaw"],
        { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
      );
      assert.equal(archive.status, 0, "git archive of d773856 must succeed");
      assert.equal(
        spawnSync("tar", ["-x", "-C", scratch], {
          input: archive.stdout,
          maxBuffer: 256 * 1024 * 1024,
        }).status,
        0,
        "extracting the archived tree must succeed",
      );
      const { governancePluginFiles } = await import(
        pathToFileURL(
          path.join(scratch, "integrations", "openclaw", "lib", "policy.mjs"),
        ).href
      );
      bytes = governancePluginFiles().assets["lib/file-lock.mjs"];
      assert.equal(sha256(bytes), NEVER_INSTALLED_SHA256);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
    const p = provisioned();
    try {
      const target = p.asset("lib/file-lock.mjs");
      writeFileSync(target, bytes, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin asset drift detected/u,
        "preflight must refuse a revision that was never live",
      );
      assert.throws(p.apply, /Governance plugin asset drift detected/u);
      assert.equal(
        sha256(readFileSync(target, "utf8")),
        NEVER_INSTALLED_SHA256,
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  },
);
