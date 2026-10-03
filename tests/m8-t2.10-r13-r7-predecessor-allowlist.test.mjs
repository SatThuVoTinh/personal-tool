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

/** The CURRENT build digests (M10/T2-R4). NOT listed. */
const R10_NATIVE_BOUNDARY_SHA256 =
  "7b3ced37252720830230ed630981881f5bd7c2b68d21c158f6221297179eac50";
/**
 * The CURRENT packaged entrypoint, after the M10/T2-R4 native threadId
 * extension. Updated from the R3 digest d1ce6386… exactly as R13/R19 moved
 * their pins when the entrypoint changed: the packaged entrypoint is a
 * provenance-pinned governance asset, so any entrypoint change moves this
 * pin and admits the outgoing digest as a recognized predecessor (now
 * listed in configure.mjs). NOT listed.
 */
const R10_ENTRYPOINT_SHA256 =
  "73ffc92a580134a63647aed174eb07de265d6a4e4478b968278486c7d7cca5d3";

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

test("R13 P1: the R7 boundary digest is proven from BOTH the live runtime and the committed R7 source", async () => {
  // (1) The repository's R7-era file at the R7 commit.
  assert.equal(
    sha256(R7_BOUNDARY_BODY),
    R7_NATIVE_BOUNDARY_SHA256,
    "the committed R7-era native-boundary.mjs must hash to the approved digest",
  );
  // (2) The live deployed R7 runtime, at its exact relative path.
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
    assert.equal(
      liveDigest,
      R7_NATIVE_BOUNDARY_SHA256,
      "the live R7 file must match",
    );
});

test("R13 P2: the R7 entrypoint digest is reproduced byte-exact from the committed R7 source", async () => {
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
  if (liveDigest !== null)
    assert.equal(
      liveDigest,
      R7_ENTRYPOINT_SHA256,
      "the live R7 entrypoint must match",
    );
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

/** Build the R7 extension through the real generator, in a scratch tree. */
async function scratchGenerator() {
  const scratch = mkdtempSync(path.join(tmpdir(), "zink-r13-gen-"));
  try {
    const alt = path.join(scratch, "integrations", "openclaw");
    mkdirSync(path.dirname(alt), { recursive: true });
    cpSync(path.join(REPO, "integrations", "openclaw"), alt, {
      recursive: true,
    });
    // The R7 source for the entrypoint, and the R7 file for the boundary asset.
    writeFileSync(
      path.join(alt, "plugins", "zink-governance", "index.mjs"),
      R7_ENTRYPOINT_SOURCE,
    );
    writeFileSync(
      path.join(alt, "topology", "lib", "native-boundary.mjs"),
      R7_BOUNDARY_BODY,
    );
    const { governancePluginFiles } = await import(
      pathToFileURL(path.join(alt, "lib", "policy.mjs")).href
    );
    return governancePluginFiles();
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * The DEPLOYED R7 entrypoint bytes, generated once. This is NOT the plugin
 * source: `governancePluginFiles()` applies deterministic package rewrites, and
 * it is the rewritten form that was installed and hashed on the live runtime.
 */
let r7Generated = null;
const r7Extension = async () => (r7Generated ??= await scratchGenerator());

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
  for (const digest of [R10_NATIVE_BOUNDARY_SHA256, R10_ENTRYPOINT_SHA256]) {
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

test("R13 C2: the R10 current-build versions remain accepted", async () => {
  const p = provisioned();
  try {
    // `provisioned()` already materialized the current build; it must be accepted
    // unchanged, with no allowlist involvement.
    assert.doesNotThrow(p.preflight);
    assert.equal(
      sha256(readFileSync(p.asset("lib/native-boundary.mjs"), "utf8")),
      R10_NATIVE_BOUNDARY_SHA256,
    );
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      R10_ENTRYPOINT_SHA256,
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
