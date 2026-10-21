// M8/T2.2-R13 — the R7 predecessor governance-asset digests.
//
// R8 added the R5 predecessor for lib/native-boundary.mjs so the RESTORED R5
// extension could be recognized. The R10 deployment then failed closed with
// "Governance plugin asset drift detected", because R7 changed exactly two
// generated-extension files and NEITHER outgoing R7 identity was approved:
//
//   lib/native-boundary.mjs  live R7 33b3feef…  ->  R10 50af7d4a…
//   index.mjs                live R7 74582778…  ->  R10 e5b220b4…
//
// R13 adds exactly those two OUTGOING R7 digests, each bound to its own path.
//
// The more important half of this suite is the negative half. Adding an approved
// predecessor is the one edit that can silently widen what the runtime accepts,
// so every test below asks both questions: is the R7 predecessor now accepted,
// and did anything ELSE become acceptable?
//
// Provenance is established two independent ways, not by copying a digest out of
// a previous report:
//
//   1. read from the live R7 runtime at the exact relative path, and
//   2. re-derived from the committed R7-era source (4f5cc6d, the commit
//      immediately before R10) through the real governancePluginFiles().
//
// The two agree byte-for-byte, which is what makes the allowlist entries
// defensible rather than merely convenient.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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
// M12/T9 F-111: the apply is bound to the transaction the apply orchestration
// took; a lane that drives the builder directly takes the same one.
import { takeApplyTransaction } from "./helpers/apply-transaction.mjs";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");
const BOUNDARY = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-boundary.mjs",
);
const PLUGIN_ENTRYPOINT_SOURCE = path.join(
  REPO,
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The live R7 digests R13 approves, byte-proven in the first test below. */
const R7_NATIVE_BOUNDARY_SHA256 =
  "33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412";
const R7_ENTRYPOINT_SHA256 =
  "74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215";

/** The R5 predecessor R8 added. R13 must leave it untouched. */
const R5_NATIVE_BOUNDARY_SHA256 =
  "49352d47ac88798cc918c654875f84241a7efbb1d5a661c64b77e7efbacf3be9";
const R5_ENTRYPOINT_SHA256 =
  "e77689c94ba066bd854549750044f78dcf9d97cc3de73420893851c0a800b10a";

/**
 * The CURRENT build digests. M10/T2-R12: resolveGovernance is exported as a
 * read-only test seam (no behavior change). The outgoing R10 build
 * (`9e735185…`) is now the listed predecessor in configure.mjs. The outgoing
 * R6 build remains listed as a recognized predecessor.
 */
/**
 * M10/T2-R12 .. M11/T1: the boundary build the LIVE runtime carries. M11/T3 A3
 * gave the three silent governance seams cause-preserving diagnostics, so these
 * bytes are no longer the current build and must be an admitted predecessor.
 */
const R12_OUTGOING_NATIVE_BOUNDARY_SHA256 =
  "97c7f3e15d2845474ded9bbe908893bbeca6c655a7cecf37b816490693e8d52c";
/**
 * M12/T2.2 B-16 (owner grant §0.5-F extended by §0.5-I): the CURRENT boundary.
 * Four seams also name the guard's reason in the diagnostic channel; every
 * host-visible code, verdict and return shape is unchanged. Accepted by content
 * comparison and deliberately NOT listed.
 */
const M11_T3_NATIVE_BOUNDARY_SHA256 =
  "a4e30801aba1e00a2f23e63f1d8b0882f4daa60833adfb2a0d72aa536f464380";
/**
 * M12/T2.2-R2 J-1: the boundary build the LIVE runtime ACTUALLY carries,
 * byte-proven by `sha256sum` of the installed asset on the WSL host. B-16 rolled
 * the three current-build pins from `5966d446…` to `fceefc0d…` without admitting
 * the outgoing value, which left the deployed extension reachable to neither
 * `--preflight` nor `--apply` — the M11/T1-R2 blocker recurring, caught only by
 * `R13 P1` on the WSL lane (Windows skips it: 48 skips, the live tree is not
 * mountable there). Admitted here as the predecessor it is, and re-derived from
 * its source commit in `R13 P6` rather than transcribed.
 */
const B16_OUTGOING_NATIVE_BOUNDARY_SHA256 =
  "5966d446258259407ccd4a349b1d6df75dccc2a75c651a149caa92d4fa8393d0";
const R6_OUTGOING_NATIVE_BOUNDARY_SHA256 =
  "bccfa8616dc89fbb3764d53ad6ea11f5cfbc445bc076e4270f2678c6c1e18c3a";
assert.ok(
  CONFIGURE_SOURCE.includes(R6_OUTGOING_NATIVE_BOUNDARY_SHA256),
  "the outgoing R6 boundary must remain an admitted predecessor",
);
/**
 * The CURRENT packaged entrypoint, after ingress verdict observability
 * (denial reasons + allow signals logged; verdicts unchanged). Updated
 * from 0fb628e8… exactly as prior revisions moved their pins when the
 * entrypoint changed. NOT listed.
 */
/**
 * M10/T2-R8: the entrypoint that R9-A replaces. Duplicate detection precedes the
 * admission signal, the pure preflight intake predicate is present, and the
 * DUPLICATE_DISCORD_EVENT denial carries no runId.
 */
const R10_ENTRYPOINT_SHA256 =
  "f4ed9d9c54ccf486a30425b98a549cab5aebbbe8e9ee7f2d32bfc6795598c4a3";
/**
 * M10/T2-R14/R15: the entrypoint M11/T1-R1 Phase 2 replaces. The R14 review
 * fixes changed packaged bytes (text-approval dispatch ordering,
 * queue-completion success reporting, owner-gate guards, the internal-run
 * classifier's real ledger-ownership flag, byte-budgeted `safeReason`) and R15
 * dropped the duplicated `truncateUtf8`. It is now an admitted predecessor in
 * BOTH per-mode lists, so the next authorized deployment stays reachable from it.
 */
const R14_OUTGOING_ENTRYPOINT_SHA256 =
  "230f3c79d0a35c2261129ddc0048ad4f0ae4fc6d86a5c49e444594a446bd2982";
/**
 * M11/T1-R1: the entrypoint build the LIVE runtime carries (PLAN.md records the
 * live digest as `e8f084ab…`). M11/T3 Phase 1 changed the packaged entrypoint —
 * A1 resolved the bot-token helper through argv instead of a shell, A2 bounded
 * the Discord REST calls — so these bytes became an admitted predecessor. They
 * were installed, so unlike the never-deployed `81b9a9c7…` Phase-2 build they
 * MUST be listed; without this entry --preflight refuses the deployed extension.
 */
const M11_T1_R1_OUTGOING_ENTRYPOINT_SHA256 =
  "e8f084ab5593a093a2075db8167ce6db4ea39e87141dc4a2ba4dee99fb4fccaa";
assert.ok(
  CONFIGURE_SOURCE.includes(M11_T1_R1_OUTGOING_ENTRYPOINT_SHA256),
  "the live M11/T1-R1 entrypoint must remain an admitted predecessor",
);
/**
 * M12/T2.2-R1 A-3: the CURRENT entrypoint build. Accepted by content comparison
 * and deliberately NOT listed. The constant name is a carrier for "the current
 * packaged build", not a claim about which milestone produced it.
 *
 * The build this replaces (`513beb15…`) IS listed as an admitted predecessor,
 * because the live WSL runtime carries it: re-measured read-only on 2026-10-16
 * with `sha256sum` against
 * `/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/index.mjs`, not
 * transcribed from the plan. Without that entry `--preflight` refuses the
 * deployed extension. M12/T1-R1's own candidate (`85fbee50…`) and M12/T2-R1's
 * (`f9ef77dc…`) are NOT listed: neither was ever deployed, so no runtime can
 * carry it.
 */
const M11_T3_ENTRYPOINT_SHA256 =
  "76b3ffda363262ce44612237b599dab0bc966671f2002b69783a980c169fd998";
const M12_T2_2_OUTGOING_ENTRYPOINT_SHA256 =
  "513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d";
assert.ok(
  CONFIGURE_SOURCE.includes(M12_T2_2_OUTGOING_ENTRYPOINT_SHA256),
  "the entrypoint the live runtime carries must remain an admitted predecessor",
);
/** The outgoing entrypoint this deployment replaces; now listed. */
const R8_OUTGOING_ENTRYPOINT_SHA256 =
  "6a7968b7d456ff6d3f2c5b9d60c7b6046a702603b880093c33b717d9a37c13b1";
assert.ok(
  CONFIGURE_SOURCE.includes(R8_OUTGOING_ENTRYPOINT_SHA256),
  "the outgoing R8 entrypoint must remain an admitted predecessor in BOTH modes",
);

/**
 * The outgoing entrypoint before the coordinator execution-authority
 * remediation (M10/T2-R2), admitted as a recognized predecessor in BOTH per-mode
 * lists so the next authorized deployment is reachable.
 */
const COORDINATOR_AUTHORITY_OUTGOING_ENTRYPOINT_SHA256 =
  "fa243547f04675685d06bfadd64fa11602fe071fe764a84d328414e7b53dfe89";

/**
 * The outgoing entrypoint of the first R2 build, superseded when the independent
 * coverage review added the binding-over-claim-holder rule. Never deployed;
 * admitted so the deployment path stays reachable from either R2 build.
 */
const COORDINATOR_AUTHORITY_REVIEW_OUTGOING_ENTRYPOINT_SHA256 =
  "a1c8957bbeb2845c61953cf12cf395deae4c9dbae536b486d6748c2944961460";

/**
 * The outgoing entrypoint before coordinator session binding (M10/T2),
 * admitted so the next authorized deployment is reachable.
 */
const SESSION_BINDING_OUTGOING_ENTRYPOINT_SHA256 =
  "4a957b246533ab8e55f88172daa3667ae06cda10dc1d1e8c0858a18e31895663";

/**
 * The outgoing entrypoint before the first-approval/duplicate notification
 * guard was unified, admitted so the next authorized deployment is reachable.
 */
const FIRST_APPROVAL_GUARD_OUTGOING_ENTRYPOINT_SHA256 =
  "0940eb77d5796f29d819331e92a7c00c4f9230eb1185dce3de7b524a37e2f7c2";

/**
 * The outgoing entrypoint before the notification persistence-truth and
 * concurrency-guard fix, admitted so the next authorized deployment is
 * reachable.
 */
const PERSISTENCE_TRUTH_OUTGOING_ENTRYPOINT_SHA256 =
  "36ed858c74dd09423d0afc74ff2fc8eb589843f163fb8ffccf8bcc912f097ce9";

/**
 * The outgoing handoff-semantics entrypoint (before the duplicate-notification
 * side-effect fix), admitted so the next authorized deployment is reachable.
 */
const DUPLICATE_NOTIFY_FIX_OUTGOING_ENTRYPOINT_SHA256 =
  "4bb0c1e12b4116340fb80f9cc136082200c7506fa691623bc922414f0bd92845";

/**
 * The outgoing functional-truth remediation entrypoint, admitted so the next
 * authorized deployment of the handoff-semantics build is reachable.
 */
const HANDOFF_SEMANTICS_OUTGOING_ENTRYPOINT_SHA256 =
  "118db9a746a0757dbea2d15c5d8d9585a298a1ca0d235a6b13a3a8513fb2bcac";

/**
 * The outgoing M8/T3 entrypoint, admitted as a recognized predecessor so the
 * next authorized deployment of the remediation build is reachable.
 */
const M8T3_OUTGOING_ENTRYPOINT_SHA256 =
  "a3dbf945deae82c1c07b419d6f1af1724f70a336c88331d4a772dfc93420ab92";

/** The outgoing owner-identity-hygiene entrypoint (M8/T3 predecessor). */
const HYGIENE_OUTGOING_ENTRYPOINT_SHA256 =
  "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d";

/**
 * The outgoing R17 entrypoint, admitted by R19 so the authorized deployment is
 * reachable. This is the digest the live runtime carried immediately before R19.
 */
const R17_OUTGOING_ENTRYPOINT_SHA256 =
  "d01c210b0cc13f01d6d294223ae400a30ef6407c962d5b46e2f199474f799a1d";

/**
 * The outgoing R19 entrypoint, currently live, admitted by the owner-identity
 * hygiene fix so the next authorized deployment is reachable.
 */
const R19_OUTGOING_ENTRYPOINT_SHA256 =
  "bae7bdf358f35c43c5308c4b0b24a1da57b55bbc609d1ff3a7e32daf65182eca";

/**
 * The outgoing R19 builds of the two lib assets this remediation changes,
 * byte-verified against the live runtime. Admitted as recognized predecessors
 * so the deployment is reachable; the new digests stay unlisted as current
 * builds accepted by content comparison.
 */
const R19_OUTGOING_POLICY_SHA256 =
  "5a1d991977b6b5bb3c510f9e193f21b8300766ef6271a6316acb9a77ed4b6776";
const R19_OUTGOING_AUTHORITY_SHA256 =
  "50a0b47860cb4cce29fc4f4d40d7c57813035324bc2e490a6f184754212e3e82";

/** The commit carrying the R19 plugin source now deployed live. */
const R19_SOURCE_COMMIT = "4b9eb0f";

/** The commit carrying the R7-era plugin source: R10's immediate parent. */
const R7_SOURCE_COMMIT = "4f5cc6d";

/**
 * M11/T1-R1 Phase 2: the commit whose packaged entrypoint is the outgoing
 * build this deployment replaces (`230f3c79…`). Phase 2 changed only
 * `plugins/zink-governance/index.mjs` inside the packaged tree, so building
 * that commit's entrypoint source through the real generator reproduces the
 * outgoing bytes exactly.
 */
const M11_T1_R1_SOURCE_COMMIT = "45e0ee7";

/**
 * M11/T3 Phase 1: the commit whose packaged entrypoint is the build the LIVE
 * runtime carries (`e8f084ab…`). M11/T3 changed only packaged sources, so
 * re-packaging this commit's entrypoint source through the real generator
 * reproduces the live bytes exactly.
 */
const M11_T3_SOURCE_COMMIT = "d7df6d9";

/**
 * M12/T2.2-R2 J-1: the commit whose packaged boundary is the build the LIVE
 * runtime carries (`5966d446…`). Phase 1's A3 is the revision that produced
 * those bytes, so re-reading that commit reproduces them exactly.
 */
const A3_BOUNDARY_SOURCE_COMMIT = "3cb8274";

const gitShow = (rev, file) =>
  execFileSync("git", ["show", `${rev}:${file}`], {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });

// The R7-era sources, read once from git.
const R7_ENTRYPOINT_SOURCE = gitShow(
  R7_SOURCE_COMMIT,
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const R7_BOUNDARY_BODY = gitShow(
  R7_SOURCE_COMMIT,
  "integrations/openclaw/topology/lib/native-boundary.mjs",
);

// M11/T1-R1 Phase 2: the plugin entrypoint source as committed by the build this
// deployment replaces.
const M11_T1_R1_ENTRYPOINT_SOURCE = gitShow(
  M11_T1_R1_SOURCE_COMMIT,
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);

// M11/T3 Phase 1: the plugin entrypoint source as committed by the build the
// live runtime carries, which this task's deployment replaces.
const M11_T1_R1_LIVE_ENTRYPOINT_SOURCE = gitShow(
  M11_T3_SOURCE_COMMIT,
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);

// ---------------------------------------------------------------------------
// Provisioning, mirroring the R8 harness: a throwaway state directory with the
// current build already materialized by the real builder.
// ---------------------------------------------------------------------------

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
  const root = mkdtempSync(path.join(tmpdir(), "zink-r13-"));
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
  const run = (mode) => () => {
    const args = [
      "--",
      CONFIGURE,
      mode,
      "--state-dir",
      stateDir,
      "--systemd-user-dir",
      systemdUserDir,
      ...identifierArgs,
    ];
    // M12/T9 F-111: the builder's apply is reachable only through the apply
    // orchestration, which takes the transaction snapshot first and hands the
    // builder its attempt id. A lane that drives the builder directly takes
    // the same transaction and passes the same id; the helper is the operator
    // driver's own two-step, so the record the builder reads is the production
    // one. A fresh transaction per call, because the builder marks the one it
    // is given as SPENT.
    if (mode === "--apply") {
      args.push(
        "--apply-transaction",
        takeApplyTransaction({
          stateDir,
          runtimeRoot: path.join(root, "runtime"),
          systemdRoot: systemdUserDir,
        }),
      );
    }
    return execFileSync(process.execPath, args, { env, stdio: "pipe" });
  };
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

const currentBuild = async () =>
  (
    await import(
      pathToFileURL(
        path.join(REPO, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    )
  ).governancePluginFiles();

// ---------------------------------------------------------------------------
// PROVENANCE
// ---------------------------------------------------------------------------

test("R13 P1: the R7 boundary digest is proven from the committed R7 source and the live runtime stays reachable", async () => {
  // (1) The repository's R7-era file at the R7 commit.
  assert.equal(
    sha256(R7_BOUNDARY_BODY),
    R7_NATIVE_BOUNDARY_SHA256,
    "the committed R7-era native-boundary.mjs must hash to the approved digest",
  );
  // (2) The live runtime at its exact relative path. Since the 2026-10-13
  // M11/T3-R1 deployment it no longer carries the R7 bytes, so this half checks
  // reachability rather than R7 equality: the installed digest must still be the
  // build the repository derives or an admitted predecessor.
  const live = "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance";
  let liveDigest = null;
  try {
    liveDigest = sha256(
      readFileSync(path.join(live, "lib", "native-boundary.mjs"), "utf8"),
    );
  } catch {
    // Not reachable from this platform. The committed-source derivation above is
    // still a byte-exact proof, so this is a skip, never a silent pass.
  }
  if (liveDigest !== null)
    await assertLiveReachable(
      "lib/native-boundary.mjs",
      liveDigest,
      listedAssetDigests("lib/native-boundary.mjs"),
    );
});

test("R13 P2: the R7 entrypoint digest is reproduced byte-exact from the committed R7 source and the live runtime stays reachable", async () => {
  // The entrypoint is the plugin source plus deterministic rewrites, so building
  // the R7-era source through the REAL generator must reproduce the deployed
  // entrypoint exactly. This is provenance by construction, not by transcription.
  const r7 = await r7Extension();
  assert.equal(
    sha256(r7.entrypoint),
    R7_ENTRYPOINT_SHA256,
    "the R7 entrypoint must be reproducible from the R7 commit",
  );
  let liveDigest = null;
  try {
    liveDigest = sha256(
      readFileSync(
        "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/index.mjs",
        "utf8",
      ),
    );
  } catch {
    /* not reachable from this platform */
  }
  if (liveDigest !== null) {
    // The entrypoint has no asset-table key: its admissions are the literal
    // lists inside the two mode gates. A digest admitted by only one gate is the
    // exact failure R13 exists to remove (--preflight PASSES, --apply then
    // refuses), so only the intersection counts.
    const gates = entrypointGates();
    assert.equal(gates.length, 2, "expected one entrypoint gate per mode");
    const digests = (block) => [
      ...new Set([...block.matchAll(/[0-9a-f]{64}/gu)].map((m) => m[0])),
    ];
    const [first, ...rest] = gates.map(digests);
    await assertLiveReachable(
      "index.mjs",
      liveDigest,
      first.filter((digest) => rest.every((list) => list.includes(digest))),
    );
  }
});

test("R13 P3: the R7 and current builds differ in exactly the two governed files", async () => {
  const r7 = await r7Extension();
  const current = await currentBuild();
  const differing = Object.keys(current.assets).filter(
    (rel) => sha256(r7.assets[rel]) !== sha256(current.assets[rel]),
  );
  assert.deepEqual(
    differing,
    ["lib/native-boundary.mjs"],
    "exactly one asset differs between R7 and the current build",
  );
  assert.notEqual(
    sha256(r7.entrypoint),
    sha256(current.entrypoint),
    "the entrypoint differs too",
  );
  // Everything else is byte-identical, which is why no other predecessor entry
  // is needed for the R10 deployment.
  const identical = Object.keys(current.assets).length - differing.length;
  assert.ok(
    identical >= 29,
    `expected most assets identical, got ${identical}`,
  );
});

test("R13 P4: the M11/T1-R1 Phase 2 outgoing entrypoint is proven from its commit", async () => {
  // Provenance by construction, not transcription: the bytes the new
  // allowlist entry admits are re-derived from the commit that carries them
  // through the real generator, exactly as the R7 and R19 predecessors are.
  const outgoing = await outgoingEntrypoint();
  assert.equal(
    sha256(outgoing),
    R14_OUTGOING_ENTRYPOINT_SHA256,
    "the committed Phase-1 source must reproduce the outgoing digest",
  );
  const current = await currentBuild();
  assert.equal(
    sha256(current.entrypoint),
    M11_T3_ENTRYPOINT_SHA256,
    "the working tree must carry the M11/T3 Phase-1 build",
  );
  assert.notEqual(
    M11_T1_R1_ENTRYPOINT_SOURCE,
    readFileSync(PLUGIN_ENTRYPOINT_SOURCE, "utf8"),
    "M11/T1-R1 must really have moved the plugin entrypoint source",
  );
});

test("R13 P5: the entrypoint the live runtime carries is proven from its commit", async () => {
  // M11/T3 Phase 1 admits a NEW predecessor: the build actually installed on the
  // WSL runtime. Admitting a digest nobody can reproduce is exactly how an
  // allowlist silently rots, so the admitted bytes are re-derived from
  // `M11_T3_SOURCE_COMMIT` through the real generator.
  const live = await liveOutgoingEntrypoint();
  assert.equal(
    sha256(live),
    M11_T1_R1_OUTGOING_ENTRYPOINT_SHA256,
    "the committed source must reproduce the live outgoing digest",
  );
  assert.notEqual(
    M11_T1_R1_LIVE_ENTRYPOINT_SOURCE,
    readFileSync(PLUGIN_ENTRYPOINT_SOURCE, "utf8"),
    "M11/T3 must really have moved the plugin entrypoint source",
  );
  // The three hunks A1/A2 touched are the only packaged difference.
  const current = await currentBuild();
  assert.equal(sha256(current.entrypoint), M11_T3_ENTRYPOINT_SHA256);
});

test("R13 P6: the boundary build the live runtime carries is admitted and proven from its commit", async () => {
  // Same rule R13 P5 states for the entrypoint: an allowlist entry nobody can
  // reproduce is how an allowlist rots. `B-16` rolled the three current-build
  // content pins and stopped there, which left the deployed boundary reachable
  // to neither `--preflight` nor `--apply`; this pins the missing half.
  assert.equal(
    sha256(
      gitShow(
        A3_BOUNDARY_SOURCE_COMMIT,
        "integrations/openclaw/topology/lib/native-boundary.mjs",
      ),
    ),
    B16_OUTGOING_NATIVE_BOUNDARY_SHA256,
    "the committed A3 source must reproduce the digest the live runtime carries",
  );
  assert.notEqual(
    B16_OUTGOING_NATIVE_BOUNDARY_SHA256,
    M11_T3_NATIVE_BOUNDARY_SHA256,
    "the admitted predecessor must not be the current build",
  );
  assert.ok(
    listedAssetDigests("lib/native-boundary.mjs").includes(
      B16_OUTGOING_NATIVE_BOUNDARY_SHA256,
    ),
    "configure.mjs must admit the outgoing boundary build the live runtime carries",
  );
});

/**
 * Build a historical extension through the real generator, in a scratch tree.
 * `overrides` are repository-relative paths under `integrations/openclaw` whose
 * committed bodies replace the current ones; every other packaged asset is the
 * current build, which is exactly what the provenance claims require.
 */
async function scratchGenerator(overrides) {
  const scratch = mkdtempSync(path.join(tmpdir(), "zink-r13-gen-"));
  try {
    const alt = path.join(scratch, "integrations", "openclaw");
    mkdirSync(path.dirname(alt), { recursive: true });
    cpSync(path.join(REPO, "integrations", "openclaw"), alt, {
      recursive: true,
    });
    // M12/T9 F-115: the packaged build carries the Skill Store and Zink Tools
    // runtime modules as well, and the generator reads them from the
    // REPOSITORY ROOT relative to itself. A scratch tree that holds only
    // `integrations/openclaw` is not shaped like the repository, so the
    // generator cannot read them and the build cannot be produced at all.
    // These are the CURRENT bodies, exactly like every other packaged asset
    // this scratch build carries.
    for (const root of ["zink-skill-store", "zink-tools"]) {
      cpSync(path.join(REPO, root), path.join(scratch, root), {
        recursive: true,
      });
    }
    // The R7 source for the entrypoint, and the R7 file for the boundary asset.
    for (const [rel, body] of overrides)
      writeFileSync(path.join(alt, rel), body, "utf8");
    const { governancePluginFiles } = await import(
      pathToFileURL(path.join(alt, "lib", "policy.mjs")).href
    );
    return governancePluginFiles();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const r7Overrides = [
  ["plugins/zink-governance/index.mjs", R7_ENTRYPOINT_SOURCE],
  ["topology/lib/native-boundary.mjs", R7_BOUNDARY_BODY],
];

/**
 * The DEPLOYED R7 entrypoint bytes, generated once. This is NOT the plugin
 * source: `governancePluginFiles()` applies deterministic package rewrites, and
 * it is the rewritten form that was installed and hashed on the live runtime.
 */
let r7Generated = null;
const r7Extension = async () =>
  (r7Generated ??= await scratchGenerator(r7Overrides));

/**
 * M11/T1-R1 Phase 2: the outgoing packaged entrypoint, re-derived from the
 * commit that carries it rather than transcribed from a report.
 */
let outgoingGenerated = null;
const outgoingEntrypoint = async () =>
  (outgoingGenerated ??= (
    await scratchGenerator([
      ["plugins/zink-governance/index.mjs", M11_T1_R1_ENTRYPOINT_SOURCE],
    ])
  ).entrypoint);

/**
 * M11/T3 Phase 1: the packaged entrypoint the live runtime carries today
 * (`e8f084ab…`), re-derived from the commit that carries it rather than
 * transcribed from a report. This is the state a real operator-apply starts from.
 */
let liveOutgoingGenerated = null;
const liveOutgoingEntrypoint = async () =>
  (liveOutgoingGenerated ??= (
    await scratchGenerator([
      ["plugins/zink-governance/index.mjs", M11_T1_R1_LIVE_ENTRYPOINT_SOURCE],
    ])
  ).entrypoint);

/** The bounds of the ALLOWED_GOVERNANCE_ASSET_SHA256 declaration. */
function assetTable() {
  const start = CONFIGURE_SOURCE.indexOf(
    "const ALLOWED_GOVERNANCE_ASSET_SHA256",
  );
  assert.notEqual(start, -1, "the allowlist table must exist");
  const end = CONFIGURE_SOURCE.indexOf("\n});", start);
  assert.notEqual(end, -1, "the allowlist table must be terminated");
  return CONFIGURE_SOURCE.slice(start, end);
}

/** The digests configure.mjs admits for one deployed asset path. */
function listedAssetDigests(rel) {
  const table = assetTable();
  const key = table.indexOf(`"${rel}": Object.freeze([`);
  if (key === -1) return [];
  const block = table.slice(key, table.indexOf("]),", key));
  return [...block.matchAll(/[0-9a-f]{64}/gu)].map((match) => match[0]);
}

/** The two entrypoint gates (preflight and apply), as source blocks. */
function entrypointGates() {
  return [
    ...CONFIGURE_SOURCE.matchAll(
      /output\.governancePluginEntrypointPath,\n\s*pluginFiles\.entrypoint,/gu,
    ),
  ].map((gate) =>
    CONFIGURE_SOURCE.slice(
      gate.index,
      CONFIGURE_SOURCE.indexOf("  );", gate.index),
    ),
  );
}

/**
 * What a live-runtime cross-check can honestly prove after a deployment: the
 * installed bytes no longer have to be any particular historical build, but
 * every authorized `--preflight` starts from them, so they must be reachable —
 * either the build the repository derives now or a digest configure.mjs admits.
 * A live digest that is neither is the M11/T1-R2 blocker recurring.
 */
async function assertLiveReachable(rel, liveDigest, admitted) {
  const current = await currentBuild();
  const packaged =
    rel === "index.mjs"
      ? sha256(current.entrypoint)
      : sha256(current.assets[rel]);
  if (liveDigest === packaged) return;
  assert.ok(
    admitted.includes(liveDigest),
    `the live ${rel} digest ${liveDigest.slice(0, 8)}… is neither the current build nor an admitted predecessor`,
  );
}

// ---------------------------------------------------------------------------
// THE ALLOWLIST ITSELF — exactly two additions, each at its own path
// ---------------------------------------------------------------------------

test("R13 1: each R7 digest is listed exactly once, under its own path", () => {
  // The asset table is a single shared constant, so the boundary digest must
  // appear exactly once in the whole file.
  assert.equal(
    CONFIGURE_SOURCE.split(R7_NATIVE_BOUNDARY_SHA256).length - 1,
    1,
    "the R7 boundary digest must appear exactly once",
  );
  // The entrypoint's allowlist, by contrast, is a LITERAL list duplicated in
  // both the preflight and the apply gate. Both must carry the R7 entrypoint
  // digest: if only one did, --preflight would PASS and --apply would then
  // refuse, which is precisely the deadlock R13 exists to remove. This test is
  // what caught that asymmetry.
  assert.equal(
    CONFIGURE_SOURCE.split(R7_ENTRYPOINT_SHA256).length - 1,
    2,
    "the R7 entrypoint digest must appear in BOTH mode gates",
  );
  const gates = [
    ...CONFIGURE_SOURCE.matchAll(
      /output\.governancePluginEntrypointPath,\n\s*pluginFiles\.entrypoint,/gu,
    ),
  ];
  assert.equal(gates.length, 2, "expected one entrypoint gate per mode");
  for (const gate of gates) {
    const block = CONFIGURE_SOURCE.slice(
      gate.index,
      CONFIGURE_SOURCE.indexOf("  );", gate.index),
    );
    assert.ok(
      block.includes(R7_ENTRYPOINT_SHA256),
      "every entrypoint gate must admit the R7 predecessor",
    );
  }
  // The boundary digest must live under lib/native-boundary.mjs …
  const boundaryKey = '"lib/native-boundary.mjs": Object.freeze([';
  const boundaryAt = CONFIGURE_SOURCE.indexOf(boundaryKey);
  assert.notEqual(boundaryAt, -1);
  const boundaryBlock = CONFIGURE_SOURCE.slice(
    boundaryAt,
    CONFIGURE_SOURCE.indexOf("]),", boundaryAt),
  );
  assert.ok(
    boundaryBlock.includes(R7_NATIVE_BOUNDARY_SHA256),
    "the R7 boundary digest must be listed under lib/native-boundary.mjs",
  );
  // … and neither digest may leak into the other's gate.
  assert.equal(
    boundaryBlock.includes(R7_ENTRYPOINT_SHA256),
    false,
    "the R7 entrypoint digest must not be listed under lib/native-boundary.mjs",
  );
});

test("R13 2: the current build digests are NOT listed anywhere", () => {
  // M11/T3: both current-build pins moved (the entrypoint by A1/A2, the
  // boundary by A3), so their live predecessors are now listed on purpose. Only
  // the digests of the CURRENT build must be absent from the source.
  for (const digest of [
    M11_T3_NATIVE_BOUNDARY_SHA256,
    M11_T3_ENTRYPOINT_SHA256,
  ]) {
    assert.equal(
      CONFIGURE_SOURCE.includes(digest),
      false,
      `${digest.slice(0, 16)} is the current build and must not be allowlisted`,
    );
  }
});

test("R13 2a: the outgoing M8/T3 entrypoint is admitted as a predecessor", () => {
  // The functional-truth remediation changed the packaged entrypoint, so the
  // outgoing digest must be recognized as a predecessor exactly like every
  // prior authorized entrypoint change. Without this, the next authorized
  // deployment of the remediation build would be unreachable.
  assert.ok(
    CONFIGURE_SOURCE.includes(M8T3_OUTGOING_ENTRYPOINT_SHA256),
    `${M8T3_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  // The remediation pin must not accidentally equal the digest it replaced.
  assert.notEqual(R10_ENTRYPOINT_SHA256, M8T3_OUTGOING_ENTRYPOINT_SHA256);
});

test("R13 2b: the outgoing handoff-semantics entrypoint is admitted as a predecessor", () => {
  assert.ok(
    CONFIGURE_SOURCE.includes(HANDOFF_SEMANTICS_OUTGOING_ENTRYPOINT_SHA256),
    `${HANDOFF_SEMANTICS_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  assert.notEqual(
    R10_ENTRYPOINT_SHA256,
    HANDOFF_SEMANTICS_OUTGOING_ENTRYPOINT_SHA256,
  );
});

test("R13 2c: the outgoing duplicate-notification-fix entrypoint is admitted", () => {
  assert.ok(
    CONFIGURE_SOURCE.includes(DUPLICATE_NOTIFY_FIX_OUTGOING_ENTRYPOINT_SHA256),
    `${DUPLICATE_NOTIFY_FIX_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  assert.notEqual(
    R10_ENTRYPOINT_SHA256,
    DUPLICATE_NOTIFY_FIX_OUTGOING_ENTRYPOINT_SHA256,
  );
});

test("R13 2f: the outgoing session-binding entrypoint is admitted", () => {
  assert.ok(
    CONFIGURE_SOURCE.includes(SESSION_BINDING_OUTGOING_ENTRYPOINT_SHA256),
    `${SESSION_BINDING_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  assert.notEqual(
    R10_ENTRYPOINT_SHA256,
    SESSION_BINDING_OUTGOING_ENTRYPOINT_SHA256,
  );
});

/**
 * M10/T2-R2 closure. Six entrypoint predecessors the preflight gate admitted
 * were missing from the apply-mode list, so an apply run from one of those
 * intermediate builds would pass `--preflight` and then be refused by `--apply`
 * — the exact per-mode deadlock R13 documents. Each digest below was re-derived
 * from the commit named in its comment by materializing that commit's
 * `integrations/openclaw` tree and hashing the packaged entrypoint, so these are
 * proven historical builds, not values copied across.
 */
const PER_MODE_PARITY_DIGESTS = Object.freeze({
  "2ef4bd64 M8/T3":
    "a3dbf945deae82c1c07b419d6f1af1724f70a336c88331d4a772dfc93420ab92",
  "adc1a49f handoff-semantics":
    "118db9a746a0757dbea2d15c5d8d9585a298a1ca0d235a6b13a3a8513fb2bcac",
  "598481c9 duplicate-notify":
    "4bb0c1e12b4116340fb80f9cc136082200c7506fa691623bc922414f0bd92845",
  "eed43f60 persistence-truth":
    "36ed858c74dd09423d0afc74ff2fc8eb589843f163fb8ffccf8bcc912f097ce9",
  "9f52fcd6 first-approval-guard":
    "0940eb77d5796f29d819331e92a7c00c4f9230eb1185dce3de7b524a37e2f7c2",
  "dc868066 session-binding":
    "4a957b246533ab8e55f88172daa3667ae06cda10dc1d1e8c0858a18e31895663",
});

test("R13 2h: the six closed apply-mode predecessors are admitted in BOTH per-mode lists", () => {
  for (const [label, digest] of Object.entries(PER_MODE_PARITY_DIGESTS)) {
    assert.equal(
      CONFIGURE_SOURCE.split(digest).length - 1,
      2,
      `${label} (${digest.slice(0, 16)}) must be admitted in the preflight list ` +
        "AND the apply list, or --preflight would PASS and --apply would refuse",
    );
    assert.notEqual(
      R10_ENTRYPOINT_SHA256,
      digest,
      `${label} is a predecessor, never the current build`,
    );
  }
  assert.equal(Object.keys(PER_MODE_PARITY_DIGESTS).length, 6);
});

test("R13 2i: the apply-mode predecessor list never admits fewer entries than the preflight list", () => {
  // Structural guard for the whole class, not just the six closed here: the two
  // per-mode lists must stay in parity, so a future entrypoint change cannot
  // re-open the apply-mode deadlock.
  const anchor =
    '"2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d"';
  const first = CONFIGURE_SOURCE.indexOf(anchor);
  const second = CONFIGURE_SOURCE.indexOf(anchor, first + 1);
  assert.notEqual(first, -1, "the per-mode anchor must exist");
  assert.notEqual(second, -1, "the anchor must appear in BOTH per-mode lists");
  const digestsOf = (from) => {
    const open = CONFIGURE_SOURCE.lastIndexOf("[", from);
    const close = CONFIGURE_SOURCE.indexOf("]", from);
    return [
      ...new Set(
        [
          ...CONFIGURE_SOURCE.slice(open + 1, close).matchAll(
            /"([a-f0-9]{64})"/g,
          ),
        ].map((m) => m[1]),
      ),
    ];
  };
  const preflight = digestsOf(first);
  const apply = new Set(digestsOf(second));
  const missing = preflight.filter((digest) => !apply.has(digest));
  assert.deepEqual(
    missing,
    [],
    `apply-mode list is missing predecessors: ${missing
      .map((d) => d.slice(0, 16))
      .join(", ")}`,
  );
});

test("R13 2g: the outgoing coordinator-authority entrypoint is admitted in BOTH per-mode lists", () => {
  for (const digest of [
    COORDINATOR_AUTHORITY_OUTGOING_ENTRYPOINT_SHA256,
    COORDINATOR_AUTHORITY_REVIEW_OUTGOING_ENTRYPOINT_SHA256,
  ]) {
    const occurrences = CONFIGURE_SOURCE.split(digest).length - 1;
    assert.equal(
      occurrences,
      2,
      `${digest.slice(0, 16)} must be admitted in the preflight list AND the ` +
        "apply list, or --preflight would PASS and --apply would refuse",
    );
    assert.notEqual(R10_ENTRYPOINT_SHA256, digest);
  }
  assert.notEqual(
    COORDINATOR_AUTHORITY_OUTGOING_ENTRYPOINT_SHA256,
    COORDINATOR_AUTHORITY_REVIEW_OUTGOING_ENTRYPOINT_SHA256,
  );
});

test("R13 2d: the outgoing persistence-truth entrypoint is admitted", () => {
  assert.ok(
    CONFIGURE_SOURCE.includes(PERSISTENCE_TRUTH_OUTGOING_ENTRYPOINT_SHA256),
    `${PERSISTENCE_TRUTH_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  assert.notEqual(
    R10_ENTRYPOINT_SHA256,
    PERSISTENCE_TRUTH_OUTGOING_ENTRYPOINT_SHA256,
  );
});

test("R13 2e: the outgoing first-approval-guard entrypoint is admitted", () => {
  assert.ok(
    CONFIGURE_SOURCE.includes(FIRST_APPROVAL_GUARD_OUTGOING_ENTRYPOINT_SHA256),
    `${FIRST_APPROVAL_GUARD_OUTGOING_ENTRYPOINT_SHA256.slice(0, 16)} must be preserved`,
  );
  assert.notEqual(
    R10_ENTRYPOINT_SHA256,
    FIRST_APPROVAL_GUARD_OUTGOING_ENTRYPOINT_SHA256,
  );
});

test("R13 3: the R5 predecessors R8 added are preserved", () => {
  for (const digest of [R5_NATIVE_BOUNDARY_SHA256, R5_ENTRYPOINT_SHA256])
    assert.ok(
      CONFIGURE_SOURCE.includes(digest),
      `${digest.slice(0, 16)} must be preserved`,
    );
});

test("R13 3b: each outgoing entrypoint is listed in BOTH modes", () => {
  // The entrypoint allowlist is duplicated per builder mode. Admitting the
  // predecessor in one mode and not the other would let --preflight PASS and
  // then --apply refuse, which is the deadlock R13 exists to remove.
  for (const [digest, label] of [
    [R17_OUTGOING_ENTRYPOINT_SHA256, "R17 outgoing"],
    [R19_OUTGOING_ENTRYPOINT_SHA256, "R19 outgoing"],
    [HYGIENE_OUTGOING_ENTRYPOINT_SHA256, "hygiene outgoing"],
    [R14_OUTGOING_ENTRYPOINT_SHA256, "M11/T1-R1 Phase 2 outgoing"],
  ]) {
    assert.equal(
      CONFIGURE_SOURCE.split(digest).length - 1,
      2,
      `the ${label} entrypoint must be admitted in the preflight AND apply gates`,
    );
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE
// ---------------------------------------------------------------------------

test("R13 A: the R7 lib/native-boundary.mjs predecessor is accepted", async () => {
  const p = provisioned();
  try {
    writeFileSync(p.asset("lib/native-boundary.mjs"), R7_BOUNDARY_BODY, "utf8");
    // Must not throw, on either mode.
    assert.doesNotThrow(p.preflight);
    assert.doesNotThrow(p.apply);
    // And apply converges it onto the current build.
    assert.equal(
      sha256(readFileSync(p.asset("lib/native-boundary.mjs"), "utf8")),
      sha256(readFileSync(BOUNDARY, "utf8")),
      "an accepted predecessor must be upgraded onto the current build",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 B: the R7 index.mjs predecessor is accepted", async () => {
  const r7 = await r7Extension();
  const current = await currentBuild();
  const p = provisioned();
  try {
    // The DEPLOYED entrypoint bytes, not the plugin source.
    writeFileSync(p.asset("index.mjs"), r7.entrypoint, "utf8");
    assert.doesNotThrow(p.preflight);
    assert.doesNotThrow(p.apply);
    // Apply converges the accepted predecessor onto the CURRENT BUILD, whose
    // installed form is the generated entrypoint (the source plus its package
    // rewrites), not the raw plugin source.
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      sha256(current.entrypoint),
      "an accepted predecessor must be upgraded onto the current build",
    );
    assert.notEqual(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      R7_ENTRYPOINT_SHA256,
      "the R7 bytes must not survive the upgrade",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 B2: the M11/T1-R1 Phase 2 outgoing entrypoint is accepted and converges", async () => {
  // The state a real operator-apply starts from: the installed extension still
  // carries the outgoing bytes. Preflight must admit them from BOTH gates and
  // apply must upgrade them onto the current build.
  const outgoing = await outgoingEntrypoint();
  const p = provisioned();
  try {
    writeFileSync(p.asset("index.mjs"), outgoing, "utf8");
    assert.doesNotThrow(p.preflight);
    assert.doesNotThrow(p.apply);
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      M11_T3_ENTRYPOINT_SHA256,
      "an accepted predecessor must be upgraded onto the current build",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 B3: the build the live runtime carries is accepted and converges", async () => {
  // M11/T3 Phase 1 moved three packaged digests at once (A1/A2 the entrypoint,
  // A3 the boundary, A4 the queue manager), and all three are installed on the
  // WSL runtime. Admitting them one at a time would leave --preflight refusing
  // the real deployed combination, which is the M11/T1-R2 defect. This test
  // reproduces that combination exactly and proves the upgrade path is reachable.
  const liveBoundary = gitShow(
    M11_T3_SOURCE_COMMIT,
    "integrations/openclaw/topology/lib/native-boundary.mjs",
  );
  const liveQueue = gitShow(
    M11_T3_SOURCE_COMMIT,
    "integrations/openclaw/lib/queue-manager.mjs",
  );
  assert.equal(sha256(liveBoundary), R12_OUTGOING_NATIVE_BOUNDARY_SHA256);
  assert.equal(
    sha256(liveQueue),
    "f7995d51d2d8f5a73fb3f7a980292236ff76fcc445cf1d769a48d35c84a8f140",
    "the committed queue source must reproduce the live digest",
  );
  const live = await liveOutgoingEntrypoint();
  const p = provisioned();
  try {
    writeFileSync(p.asset("index.mjs"), live, "utf8");
    writeFileSync(p.asset("lib/native-boundary.mjs"), liveBoundary, "utf8");
    writeFileSync(p.asset("lib/queue-manager.mjs"), liveQueue, "utf8");
    assert.doesNotThrow(p.preflight);
    assert.doesNotThrow(p.apply);
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      M11_T3_ENTRYPOINT_SHA256,
    );
    assert.equal(
      sha256(readFileSync(p.asset("lib/native-boundary.mjs"), "utf8")),
      M11_T3_NATIVE_BOUNDARY_SHA256,
    );
    // M12/T2.2-R2 B-12, re-valued under owner grant §0.5-A. The queue writer's temp is now
    // created (`"wx"`) behind the shared symlink guard instead of truncating whatever already
    // sat at its predictable `.tmp-<pid>-<ms>` name, and a failed write removes its own
    // residue. Moved from `a5580bb67a7ace7edfdaf2595b7245a3be3a6959333ae6cbeaf76d080f49fb37`,
    // which is proven to have been this file's own digest at HEAD immediately before the edit
    // (`git show HEAD:integrations/openclaw/lib/queue-manager.mjs | sha256sum`), so the value
    // replaced here is the one this test was actually pinning. No `configure.mjs` entry is
    // added: this is the CURRENT build, which is accepted by content comparison and
    // deliberately never allowlisted; the live `f7995d51…` stays admitted.
    // M12/T9-R1 F-056 (legacy R1-A06-01), re-valued in band. The queue's
    // current-execution fence now renews the lease it just verified, so the
    // lease clock moves in production and a live execution is no longer fenced
    // out at the lease cliff. The queue writer's bytes therefore changed, and
    // this pin tracks the CURRENT build of that asset. Moved from
    // `4e6ae88e9e6fe0b30ebbeb3d655a186c69660b6211103738faaba28f313283aa`,
    // proven to be this file's own digest at HEAD immediately before the edit
    // (`git cat-file blob HEAD:integrations/openclaw/lib/queue-manager.mjs`
    // -> sha256 8cd9446a...), so the value replaced here is the one this test
    // was actually pinning. No `configure.mjs` entry is added: this is the
    // CURRENT build, which is accepted by content comparison and deliberately
    // never allowlisted; the live `a5580bb6...` (measured read-only on the WSL
    // runtime) and the admitted `f7995d51...` both stay admitted predecessors,
    // so the upgrade path is unchanged.
    assert.equal(
      sha256(readFileSync(p.asset("lib/queue-manager.mjs"), "utf8")),
      "f2774f580fa45d48ad0cfeb59b93aae2cee4e97f5ab03077a9d0802b400d7572",
      "an accepted predecessor must converge onto the current queue writer",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 C: BOTH R7 predecessors together are accepted — the real deployed combination", async () => {
  const r7 = await r7Extension();
  const p = provisioned();
  try {
    writeFileSync(p.asset("lib/native-boundary.mjs"), R7_BOUNDARY_BODY, "utf8");
    writeFileSync(p.asset("index.mjs"), r7.entrypoint, "utf8");
    // This is the exact state the live R7 runtime is in.
    assert.doesNotThrow(p.preflight);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 C2: the current-build versions remain accepted", async () => {
  const p = provisioned();
  try {
    // `provisioned()` already materialized the current build; it must be accepted
    // unchanged, with no allowlist involvement.
    assert.doesNotThrow(p.preflight);
    assert.equal(
      sha256(readFileSync(p.asset("lib/native-boundary.mjs"), "utf8")),
      M11_T3_NATIVE_BOUNDARY_SHA256,
    );
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      M11_T3_ENTRYPOINT_SHA256,
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 D: the R5 predecessors remain accepted", async () => {
  const p = provisioned();
  try {
    // The R5 boundary body is the current source with the post-R5 hunks
    // reverted, exactly as the R8 suite derives it.
    writeFileSync(p.asset("lib/native-boundary.mjs"), r5BoundaryBody(), "utf8");
    assert.doesNotThrow(p.preflight);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 D2: the outgoing R19 lib assets are proven from committed source", () => {
  // authority.mjs is packaged without rewrites, so its committed source must
  // hash to the live digest directly.
  assert.equal(
    sha256(
      gitShow(R19_SOURCE_COMMIT, "integrations/openclaw/lib/authority.mjs"),
    ),
    R19_OUTGOING_AUTHORITY_SHA256,
    "the committed R19 authority source must reproduce the live digest",
  );
  // policy.mjs is packaged with exactly the two rewrites declared in
  // PACKAGE_REWRITES["lib/policy.mjs"]; replicating them must reproduce live.
  const packaged = gitShow(
    R19_SOURCE_COMMIT,
    "integrations/openclaw/lib/policy.mjs",
  )
    .split('"../topology/lib/')
    .join('"./')
    .split('"../../topology/contracts"')
    .join('"../../contracts"');
  assert.equal(
    sha256(packaged),
    R19_OUTGOING_POLICY_SHA256,
    "the committed R19 policy source must reproduce the live digest",
  );
});

test("R13 D3: the outgoing R19 lib assets are accepted and converge", async () => {
  const p = provisioned();
  try {
    writeFileSync(
      p.asset("lib/authority.mjs"),
      gitShow(R19_SOURCE_COMMIT, "integrations/openclaw/lib/authority.mjs"),
      "utf8",
    );
    const packaged = gitShow(
      R19_SOURCE_COMMIT,
      "integrations/openclaw/lib/policy.mjs",
    )
      .split('"../topology/lib/')
      .join('"./')
      .split('"../../topology/contracts"')
      .join('"../../contracts"');
    writeFileSync(p.asset("lib/policy.mjs"), packaged, "utf8");
    // The outgoing R19 lib assets must be accepted as recognized predecessors.
    assert.doesNotThrow(p.preflight);
    // And apply must converge them onto the current build, not leave them.
    p.apply();
    const files = await currentBuild();
    assert.equal(
      sha256(readFileSync(p.asset("lib/authority.mjs"), "utf8")),
      sha256(files.assets["lib/authority.mjs"]),
      "an accepted predecessor must be upgraded onto the current build",
    );
    assert.equal(
      sha256(readFileSync(p.asset("lib/policy.mjs"), "utf8")),
      sha256(files.assets["lib/policy.mjs"]),
      "an accepted predecessor must be upgraded onto the current build",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

/** The R5 body of native-boundary.mjs: the current source minus post-R5 hunks. */
function r5BoundaryBody() {
  const hunks = [
    [
      `  } catch (error) {
    // R7 G2: the host-visible contract string is unchanged, but the original
    // failure is preserved as the cause so a governance verdict and a genuine
    // execution-state fault stay distinguishable. Only the fixed error message
    // is logged: never the stack, the run context, or message content.
    console.error(
      "[zink-native-gate] enterNativeRun:",
      error?.message ?? error,
    );
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE", { cause: error });
  }`,
      `  } catch {
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE");
  }`,
    ],
    [
      `        // R10: the host-assigned run discriminator and the canonical host
        // heartbeat representation. Both are plain strings the host already
        // holds at the injection anchor; neither is user content, a message
        // object, or Discord-layer data.
        trigger: context.trigger,
        transcriptPrompt: context.transcriptPrompt,
`,
      ``,
    ],
    // R18: admission-time liveness recovery (module helpers). Inverted so the
    // derived R5 body reproduces the packaged R5 digest exactly.
    [
      `// R18: the admission-time liveness discriminator, recovered at run-end.
//
// The host forwards \`trigger\` and \`transcriptPrompt\` to \`enterNativeRun\` but NOT
// to \`finishNativeRun\` (its run-end call passes only agentId/sessionKey/runId).
// Without them at run-end, \`isPureLivenessHeartbeat\` returns false there even
// though admission recognised the same run as a pure liveness heartbeat, so the
// run-end seam applied full governance and failed with
// GOVERNANCE_COMPLETION_UNAVAILABLE. Threading them through the pinned selection
// would change the installed selection and break the R7/R10 native lineage; this
// records them per run at admission and recovers them at run-end so BOTH seams
// classify a run with the single predicate. A run that never passed admission has
// no record and therefore keeps the existing full-governance behaviour.
//
// Bounded so a run that dies before run-end cannot grow this without limit.
const RUN_LIVENESS = new Map();
const RUN_LIVENESS_LIMIT = 256;

function rememberRunLiveness(runId, trigger, transcriptPrompt) {
  if (typeof runId !== "string" || runId === "") return;
  if (RUN_LIVENESS.size >= RUN_LIVENESS_LIMIT) {
    const oldest = RUN_LIVENESS.keys().next().value;
    RUN_LIVENESS.delete(oldest);
  }
  RUN_LIVENESS.set(runId, { trigger, transcriptPrompt });
}

function takeRunLiveness(runId) {
  if (typeof runId !== "string" || runId === "") return undefined;
  const record = RUN_LIVENESS.get(runId);
  RUN_LIVENESS.delete(runId);
  return record;
}

`,
      ``,
    ],
    // R18: the per-run liveness record, created only for an accepted admission.
    [
      `    // R18: record the discriminator only for a run admission ACCEPTED, so the
    // record means precisely "admission recognised this run". A denied or failed
    // admission leaves no record and its run-end therefore keeps full governance.
    rememberRunLiveness(
      context.runId,
      context.trigger,
      context.transcriptPrompt,
    );
`,
      ``,
    ],
    // R18: run-end prefers the admission record for this runId.
    [
      `  // R18: prefer anything the host passes at this seam, then fall back to the
  // values recorded at admission for this runId, so admission and run-end apply
  // the same predicate to the same execution.
  const liveness = takeRunLiveness(context.runId);
`,
      ``,
    ],
    // R18: the run-end guard context carries the recovered discriminator.
    [
      `        trigger: context.trigger ?? liveness?.trigger,
        transcriptPrompt:
          context.transcriptPrompt ?? liveness?.transcriptPrompt,
`,
      ``,
    ],
    // M10/T2-R5: the registry read in enterNativeRun. ORDER MATTERS: this
    // insertion sits between the R4 validation block and `const decision`,
    // so it must be inverted BEFORE the R4 hunk below can match.
    [
      `    // M10/T2-R5: structured Discord inbound metadata, read by inbound
    // message id from the preflight registry. Unknown/absent degrades to
    // empty (deny preserved); malformed is normalized by the reader.
    const ingress = readZinkIngressMetadata(context.currentMessageId);
`,
      ``,
    ],
    // M10/T2-R4: explicit inbound thread identity typing. Inverted so the
    // derived R5 body reproduces the packaged R5 digest exactly.
    [
      `  try {
    // M10/T2-R4: the inbound thread identity is typed explicitly. null means
    // "not a threaded message" (the patch forwards \`?? null\`); anything else
    // must be a Discord snowflake, otherwise the context is malformed and the
    // run fails closed before any guard sees it. The original message is
    // preserved as the cause and logged, while the host-visible contract
    // string stays GOVERNANCE_RUN_UNAVAILABLE.
    const threadId = context.threadId ?? null;
    if (threadId !== null && !/^[1-9][0-9]{16,19}$/u.test(threadId)) {
      throw new Error("GOVERNANCE_CONTEXT_MISSING");
    }
    const decision = await callGuard(`,
      `  try {
    const decision = await callGuard(`,
    ],
    // M10/T2-R4: the frozen admission-context threadId field.
    [
      `        isBot: context.isBot,
        threadId,
`,
      `        isBot: context.isBot,
`,
    ],
    // M10/T2-R5: the preflight-registry reader block. Inverted so the
    // derived R5 body reproduces the packaged R5 digest exactly.
    [
      `const INGRESS_METADATA_KEY = "__zink_ingress_metadata_r5";
const DISCORD_SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/u;

const emptyIngressMetadata = () =>
  Object.freeze({
    mentionedUserIds: Object.freeze([]),
    mentionedRoleIds: Object.freeze([]),
    replyReferenceMessageId: null,
    replyReferenceAuthorId: null,
    threadOwnerId: null,
    authorIsBot: false,
  });

/**
 * M10/T2-R5: read the deterministic Discord inbound metadata the preflight
 * patch recorded for this inbound message id. The write sits on the same
 * causal inbound path (a turn exists only after its message's preflight
 * completes), so no ordering assumption is involved. Unknown, malformed or
 * evicted records normalize to empty (deny preserved). Re-validated here
 * even though the writer validates too: the registry crosses a bundle
 * boundary, so neither side trusts the other's bytes.
 */
export function readZinkIngressMetadata(messageId) {
  let record;
  try {
    const registry = globalThis[INGRESS_METADATA_KEY];
    record =
      typeof messageId === "string" && registry instanceof Map
        ? registry.get(messageId)
        : undefined;
  } catch {
    return emptyIngressMetadata();
  }
  if (!record || typeof record !== "object") return emptyIngressMetadata();
  const snowflake = (value) =>
    typeof value === "string" && DISCORD_SNOWFLAKE_RE.test(value)
      ? value
      : null;
  const idList = (entries) => {
    if (!Array.isArray(entries)) return [];
    const ids = [];
    for (const entry of entries) {
      const id = snowflake(typeof entry === "string" ? entry : entry?.id);
      if (id) ids.push(id);
    }
    return ids;
  };
  return Object.freeze({
    mentionedUserIds: Object.freeze(idList(record.mentionedUserIds)),
    mentionedRoleIds: Object.freeze(idList(record.mentionedRoleIds)),
    replyReferenceMessageId: snowflake(record.replyReferenceMessageId),
    replyReferenceAuthorId: snowflake(record.replyReferenceAuthorId),
    threadOwnerId: snowflake(record.threadOwnerId),
    authorIsBot: record.authorIsBot === true,
  });
}

`,
      ``,
    ],
    // M10/T2-R5: structured inbound metadata in the frozen admission context
    // (read by message id from the preflight registry). Inverted so the
    // derived R5 body reproduces the packaged R5 digest exactly.
    [
      `        mentionedUserIds: ingress.mentionedUserIds,
        mentionedRoleIds: ingress.mentionedRoleIds,
        replyReferenceMessageId: ingress.replyReferenceMessageId,
        replyReferenceAuthorId: ingress.replyReferenceAuthorId,
        threadOwnerId: ingress.threadOwnerId,
        authorIsBot: context.isBot === true || ingress.authorIsBot,
`,
      ``,
    ],
    // M10/T2-R8: the Discord preflight seam reaches the canonical intake
    // predicate through one published global.
    [
      `const registryKey = Symbol.for("zink.governance.native.r12");
// M10/T2-R8: the Discord preflight seam reaches the canonical intake predicate
// through this global. Published only while a guard is registered.
const preflightIngressKey = Symbol.for(
  "zink.governance.native.preflightIngress",
);`,
      `const registryKey = Symbol.for("zink.governance.native.r12");`,
    ],
    // M10/T2-R8: the pure preflight intake predicate on the registry entry.
    [
      `    beforeToolCall: guard.beforeToolCall.bind(guard),
    beforeAnnounce: guard.beforeAnnounce.bind(guard),
    // M10/T2-R8: the PURE direct-intake predicate, evaluated at the Discord
    // preflight seam so a direct specialist mention never creates a host run at
    // all. Side-effect free: it decides, it never writes the ledger.
    beforePreflightIngress:
      typeof guard.beforePreflightIngress === "function"
        ? guard.beforePreflightIngress.bind(guard)
        : undefined,`,
      `    beforeToolCall: guard.beforeToolCall.bind(guard),
    beforeAnnounce: guard.beforeAnnounce.bind(guard),`,
    ],
    // M10/T2-R8: publishing the seam, and its deliberate "absent is not a deny".
    [
      `  registry().set(scope, entry);
  publishPreflightIngress(entry);
  return () => {
    if (registry().get(scope) === entry) registry().delete(scope);
  };
}

/**
 * M10/T2-R8 — the global the Discord preflight injection calls.
 *
 * The preflight runs inside the host's channel bundle, which never imports this
 * module, so the seam is reached through one published global instead of a
 * duplicated import or a second copy of the policy. The caller passes the SAME
 * scope string \`resolveGovernance\` derives from the host config, so there is one
 * registry and one policy, not two.
 *
 * ABSENT PREDICATE IS NOT A DENY. If governance never registered — the plugin
 * has not loaded, or a build predates this seam — the preflight must not invent
 * an admission decision. It returns null and the late \`enterNativeRun\` gate
 * still governs the run, so enforcement is unchanged and only the timing is lost.
 */
function publishPreflightIngress(entry) {
  if (entry.beforePreflightIngress) {
    globalThis[preflightIngressKey] = (input) =>
      entry.beforePreflightIngress(input);
  }
}`,
      `  registry().set(scope, entry);
  return () => {
    if (registry().get(scope) === entry) registry().delete(scope);
  };
}`,
    ],
    // M10/T2-R8: the model-visible block reason is a refusal sentence. Proven
    // live: the host copies a block decision's `reason` into the tool result the
    // MODEL reads, the model repeated it, and the owner's Discord reply carried
    // the internal code. Reverting these reproduces the R5 body exactly.
    [
      `
/**
 * M10/T2-R8 — the ONLY text a blocked tool call may hand back to the host.
 *
 * The host maps a block decision's \`reason\` to \`blockReason\` and writes that
 * into the tool-result the model reads, so whatever sits here is model-visible
 * and, through the model's own answer, owner-visible. It is therefore a plain
 * refusal sentence and deliberately NOT a governance identifier: repeating it
 * back to the owner is truthful and harmless. The canonical reason code stays in
 * the diagnostic channel and in the ledger.
 */
export const POLICY_REFUSAL_TEXT = "Action not permitted by workspace policy.";
`,
      ``,
    ],
    [
      `  const refuse = (canonical) => {
    // R8: the host contract turns this return value into the BLOCKED TOOL
    // RESULT the model reads — \`decision.reason\` becomes \`blockReason\`, which
    // the host puts verbatim into the tool-result text. Proven live: a block
    // reason reached the model, the model repeated it, and the owner's Discord
    // reply carried the internal governance code.
    //
    // So the model-visible surface gets a deliberate, non-diagnostic refusal and
    // never a governance identifier. The canonical code and its detail stay in
    // the diagnostic channel and in the ledger, where a refusal must remain
    // auditable. This is not a message filter: the code is never handed to the
    // host in the first place, so it cannot be echoed by the model.
    console.error(
      "[zink-native-gate:error] beforeToolCall blocked:",
      canonical,
    );
    return { block: true, reason: POLICY_REFUSAL_TEXT };
  };
`,
      ``,
    ],
    [
      `        return refuse("YIELD_BATCH_DENIED");`,
      `        return { block: true, reason: "YIELD_BATCH_DENIED" };`,
    ],
    [
      `      if (decision?.allow !== true) {
        // The canonical reason code is a fixed governance identifier, never
        // caller data — but it is NOT safe to surface here, because this return
        // value is model-visible. See \`refuse\` above. A guard-supplied reason is
        // recorded as the diagnostic code; the model only ever sees the refusal.
        const canonical =
          typeof decision?.reason === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/u.test(decision.reason)
            ? decision.reason
            : "GOVERNANCE_DENIED";
        return refuse(canonical);
      }
`,
      `      if (decision?.allow !== true) {
        // A blocked call keeps its canonical reason code when the guard
        // supplied one. The code is a fixed governance identifier, never
        // caller data, so surfacing it is safe and makes the refusal
        // auditable instead of collapsing every denial into one opaque code.
        const reason =
          typeof decision?.reason === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/u.test(decision.reason)
            ? decision.reason
            : "GOVERNANCE_DENIED";
        return { block: true, reason };
      }
`,
    ],
    [
      `    } catch (err) {
      // Never return exception text: a provider/plugin error may contain input,
      // and the reason is model-visible. The diagnostic keeps the detail; the
      // model only ever sees the refusal.
      return refuse(err?.message || String(err));
    }
`,
      `    } catch (err) {
      console.error(
        "[zink-native-gate:error] beforeToolCall blocked:",
        err?.message || err,
      );
      // Never return exception text: a provider/plugin error may contain input.
      return { block: true, reason: "GOVERNANCE_UNAVAILABLE" };
    }
`,
    ],
    // M10/T2-R12: resolveGovernance exported as a read-only test seam.
    // Inverted so the derived R5 body reproduces the packaged R5 digest.
    [
      `// M10/T2-R12: exported as a test seam so suites can drive the registered
// guard hooks exactly as production does. Read-only accessor; no behavior.
export function resolveGovernance(config) {`,
      `function resolveGovernance(config) {`,
    ],
    // M11/T3 A3: the three seams gained cause-preserving message-only
    // diagnostics. Host-visible codes and verdicts are unchanged, so inverting
    // them keeps the derived R5 body equal to the packaged R5 digest exactly.
    [
      `  } catch (error) {
    // M11/T3 A3: the host-visible verdict is unchanged, but a block with no
    // diagnostic was unattributable. Message only — never stack or content.
    console.error(
      "[zink-native-gate] gateNativeAnnounce:",
      error?.message ?? error,
    );
    return { governed: true, action: "block" };
  }`,
      `  } catch {
    return { governed: true, action: "block" };
  }`,
    ],
    [
      `  } catch (error) {
    // M11/T3 A3: same standard as \`enterNativeRun\` — the host-visible contract
    // string is unchanged, but the guard fault is preserved as the cause so a
    // policy denial, an unregistered guard and a disk fault stay separable.
    console.error(
      "[zink-native-gate] finishNativeRun:",
      error?.message ?? error,
    );
    throw new Error("GOVERNANCE_COMPLETION_UNAVAILABLE", { cause: error });
  }`,
      `  } catch {
    throw new Error("GOVERNANCE_COMPLETION_UNAVAILABLE");
  }`,
    ],
    [
      `  } catch (error) {
    // M11/T3 A3: cause-preserving sibling of \`enterNativeRun\` at this seam.
    console.error(
      "[zink-native-gate] sanitizeNativePrompt:",
      error?.message ?? error,
    );
    throw new Error("GOVERNANCE_INGRESS_UNAVAILABLE", { cause: error });
  }`,
      `  } catch {
    throw new Error("GOVERNANCE_INGRESS_UNAVAILABLE");
  }`,
    ],
    // M12/T2.2 B-16: the four seams now name the guard's reason in the
    // diagnostic channel. Every host-visible code, verdict and return shape is
    // unchanged, so inverting these reproduces the R5 body exactly. The reason
    // is only echoed when it matches the closed governance-code grammar, so no
    // caller text can reach the log.
    [
      `// B-16: a guard verdict that denies carries a canonical reason code, and this
// boundary used to drop it, so every policy denial reached the operator as the
// bare class name. The reason is written to the diagnostic channel only when it
// matches the closed governance-code grammar the tool-gate seam already applies
// to the same field, which keeps message text, paths and credentials out of the
// log. Nothing here moves a host-visible code, verdict, or return shape.
function logDecisionReason(seam, verdict, decision) {
  const reason =
    typeof decision?.reason === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/u.test(decision.reason)
      ? decision.reason
      : "REASON_UNDECLARED";
  console.error(\`[zink-native-gate] \${seam} \${verdict}: reason=\${reason}\`);
}

`,
      ``,
    ],
    [
      `    if (decision?.allow !== true) {
      logDecisionReason("enterNativeRun", "denied", decision);
      throw new Error("GOVERNANCE_DENIED");
    }`,
      `    if (decision?.allow !== true) throw new Error("GOVERNANCE_DENIED");`,
    ],
    [
      `    if (decision?.action === "discard") {
      logDecisionReason("gateNativeAnnounce", "discarded", decision);
      return { governed: true, action: "discard" };
    }`,
      `    if (decision?.action === "discard")
      return { governed: true, action: "discard" };`,
    ],
    [
      `    ) {
      logDecisionReason("gateNativeAnnounce", "refused", decision);
      throw new Error("GOVERNANCE_RECEIPT_INVALID");
    }`,
      `    )
      throw new Error("GOVERNANCE_RECEIPT_INVALID");`,
    ],
    [
      `    if (decision?.allow !== true) {
      logDecisionReason("finishNativeRun", "denied", decision);
      throw new Error("GOVERNANCE_DENIED");
    }`,
      `    if (decision?.allow !== true) throw new Error("GOVERNANCE_DENIED");`,
    ],
    [
      `    ) {
      logDecisionReason("sanitizeNativePrompt", "refused", decision);
      throw new Error("SCHEMA_INVALID");
    }`,
      `    )
      throw new Error("SCHEMA_INVALID");`,
    ],
    // M12/T9 F-371: the spawn label the boundary accepts is now the version-4
    // UUID the canonical builder renders (the legacy 64-hex rendering still
    // replays). The host-visible verdict is unchanged - an unusable label is
    // still refused - so inverting this hunk keeps the derived R5 body equal
    // to the packaged R5 digest exactly.
    [
      `          // M12/T9 F-371: the delegation id is a version-4 UUID rendered from
          // the canonical digest, and the ledger may still carry the legacy
          // 64-hex rendering. Both are legitimate identities of the same
          // proposal, so the spawn label accepts both - and nothing else.
          !/^([a-f0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(
            decision.spawnLabel,
          )`,
      `          !/^[a-f0-9]{64}$/u.test(decision.spawnLabel)`,
    ],
  ];
  let derived = readFileSync(BOUNDARY, "utf8");
  for (const [after, before] of hunks) {
    assert.ok(derived.includes(after), "every post-R5 hunk must be present");
    derived = derived.replace(after, before);
  }
  // The digest assertion is what makes this derivation exact.
  assert.equal(sha256(derived), R5_NATIVE_BOUNDARY_SHA256);
  return derived;
}

// ---------------------------------------------------------------------------
// REJECTION — the half that matters
// ---------------------------------------------------------------------------

test("R13 E: an unknown governance asset is still rejected and NOT overwritten", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/native-boundary.mjs");
    writeFileSync(target, "unrecognized plugin asset\n", "utf8");
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
    assert.throws(p.apply, /Governance plugin asset drift detected/u);
    assert.equal(
      readFileSync(target, "utf8"),
      "unrecognized plugin asset\n",
      "a refused asset must be left byte-identical",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 F: a one-byte modification of either R7 predecessor is rejected", async () => {
  const r7 = await r7Extension();
  for (const [rel, body] of [
    ["lib/native-boundary.mjs", R7_BOUNDARY_BODY],
    ["index.mjs", r7.entrypoint],
  ]) {
    const p = provisioned();
    try {
      const target = p.asset(rel);
      writeFileSync(target, `${body}// one extra byte\n`, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin (asset|entrypoint) drift detected/u,
        `${rel} must reject a one-byte modification`,
      );
      assert.equal(
        readFileSync(target, "utf8"),
        `${body}// one extra byte\n`,
        "a refused file must be left byte-identical",
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test("R13 G: the correct R7 digests at the WRONG paths are still rejected", async () => {
  // Each approved identity is bound to its own path. Path-scoping is what stops
  // the allowlist from becoming a global digest set.
  const r7 = await r7Extension();
  const swapped = [
    // R7 boundary bytes placed at the entrypoint path.
    ["index.mjs", R7_BOUNDARY_BODY],
    // R7 entrypoint bytes placed at a governed asset path.
    ["lib/native-boundary.mjs", r7.entrypoint],
  ];
  for (const [rel, body] of swapped) {
    const p = provisioned();
    try {
      writeFileSync(p.asset(rel), body, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin (asset|entrypoint) drift detected/u,
        `${rel} must not accept the other path's approved bytes`,
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test("R13 H: an unrelated historical asset is still rejected", async () => {
  const r7 = await r7Extension();
  const p = provisioned();
  try {
    // A truncated, unrelated historical body at a governed asset path.
    writeFileSync(
      p.asset("lib/native-boundary.mjs"),
      r7.entrypoint.slice(0, 5000),
      "utf8",
    );
    assert.throws(p.preflight, /Governance plugin asset drift detected/u);
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R13 I: the two new digests exist ONLY at their correct paths", () => {
  // Neither may appear under any other allowlist key, so a future edit cannot
  // relocate an identity.
  const table = assetTable();
  assert.equal(
    table.includes(R7_ENTRYPOINT_SHA256),
    false,
    "the R7 entrypoint digest must not be in the asset table at all",
  );
  assert.equal(
    table.split(R7_NATIVE_BOUNDARY_SHA256).length - 1,
    1,
    "the R7 boundary digest must appear exactly once in the asset table",
  );
  // No wildcard or prefix entry was introduced anywhere.
  assert.equal(
    /"\*"|\*\//u.test(CONFIGURE_SOURCE),
    false,
    "no wildcard entries",
  );
});

test("R13 J: preflight stays fail-closed — R13 added no permissiveness of its own", () => {
  // Every governed asset path in the table must still refuse an unknown body.
  // This is the property R13 must not have weakened anywhere.
  const table = assetTable();
  const keys = [...table.matchAll(/"([^"]+)":\s*Object\.freeze\(\[/gu)].map(
    (m) => m[1],
  );
  assert.ok(
    keys.length >= 20,
    `expected the full asset table, saw ${keys.length}`,
  );
  for (const rel of keys) {
    const p = provisioned();
    try {
      writeFileSync(p.asset(rel), `unknown body for ${rel}\n`, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin asset drift detected/u,
        `${rel} must refuse an unknown body`,
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});
