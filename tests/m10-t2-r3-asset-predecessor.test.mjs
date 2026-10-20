// M10/T2-R3 — proven governance-asset predecessor admission.
//
// The M10/T2-R2 candidate is repository-complete, but the single authorized
// deployment attempt never started: `configure.mjs --preflight` refused the
// live runtime with `Governance plugin asset drift detected` and
// `installed_mutation: false`. The live runtime carries the owner-identity
// hygiene build (extension `2271b56b…`), whose ten governance-plugin assets
// below differ from the current build and were not admitted in
// `ALLOWED_GOVERNANCE_ASSET_SHA256` — an asset-level predecessor deadlock of
// the exact class R13 documents for the entrypoint.
//
// R3 admits exactly those ten OUTGOING hygiene-build digests, each bound to
// its own path. Provenance is established the same way R2 closed its six
// entrypoint predecessors: the live tree (34 files) is byte-identical to the
// packaged build at `41c62e7` (34/34), re-derived here through the
// repository's own `governancePluginFiles()`, so no digest is admitted on
// faith. The entrypoint `2271b56b…` was already admitted; it is reproduced
// here only as a sanity pin, not as a new admission.
//
// Like R13, every test below asks both questions: is the proven predecessor
// now accepted, and did anything ELSE become acceptable?
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
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

import { classifyApplyReason } from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";
import { ledgerPaths } from "../integrations/openclaw/topology/lib/ledger.mjs";
import { lockDirFor } from "../integrations/openclaw/lib/file-lock.mjs";

const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/**
 * The commit whose packaged governance-plugin build IS the live runtime:
 * `41c62e7` ("deployment path for the hygiene build + its proof"). Its parent
 * `9b53f92` packages these files byte-identically. Provenance test R3 P1
 * re-derives every digest below from this commit through the real generator.
 */
const HYGIENE_SOURCE_COMMIT = "41c62e7";

/** The live hygiene-build entrypoint, already admitted before R3. Pinned, not added. */
const HYGIENE_ENTRYPOINT_SHA256 =
  "2271b56bc7f0ed3a3446e4474c411c1a6132a4e3c1a2edfedb5e6907d8340b5d";

/**
 * The ten proven hygiene-build predecessor digests R3 admits, each bound to
 * its own asset path. Every value was re-derived from HYGIENE_SOURCE_COMMIT
 * (see R3 P1) and cross-checked against the live runtime read-only (34/34
 * files match the packaged build at that commit).
 */
const HYGIENE_ASSET_PREDECESSORS = Object.freeze({
  "lib/guard.mjs":
    "9e7e284507e6d6f5e2213005d4ad89af60540ef0bb404eb0d4855bf8078cab78",
  "lib/workflow.mjs":
    "e78d81bf55d144e36edff7327c5a1d8ef0ed6b4f7a2dd2b1cc586ea1088389d8",
  "lib/policy.mjs":
    "e29812bcae3d791252ea6d567d77ceb4c7a1e43692fdf920317251369d2a2891",
  "lib/authority.mjs":
    "bb2f53280712d94ee799f116d3c28a6d199e6648ad558ea0cce18bd6210eddd0",
  "lib/queue-manager.mjs":
    "97fa9907c5c37c7c4e0432d0ccd9d1d1786b153197913da6a888bfb0e81ce5f2",
  "lib/decision-ledger.mjs":
    "9b5f2f94c33430a30ae5da96b118a558229503bf195e8168701cfb1d748b782e",
  "contracts/approval-request.schema.json":
    "29eb3ed9992171481d30d1bb9f64f97e06ceed53bcf185da77817886458ab007",
  "contracts/ledger-event.schema.json":
    "6acc2539cf1ca1e8393f6950937bb6aafb6312c9d9262774d748b57fb58ff974",
  "contracts/ledger-snapshot.schema.json":
    "a8c3d7aabeaae962a2ee7738d42739d0941104f61da572ef5cd5db54f6ccd5fb",
  "governance-manifests.json":
    "e27647b9742b56052188a8bbf746ab6c5eeaaeb67344216c11859167ee78946f",
});

/** The CURRENT build entrypoint (M11/T1-R1 Phase 2 approval-path
 * remediation). None may be allowlisted. Moved from 0fb628e8… exactly as prior
 * revisions moved their pins when the entrypoint changed: denial-reason +
 * signal logging in authenticateIngress changes the packaged bytes; behavior is
 * observation-only and every verdict is unchanged. */
// M10/T2-R15: this pin moves again. R14 fixed the text-approval dispatch
// ordering, the queue-completion success reporting, both owner gates, the
// internal-run classifier's ledger-ownership flag and `safeReason`; R15 removed
// the duplicated `truncateUtf8` in favour of the shared one, so the entrypoint
// no longer carries a second copy of the byte-budget rule.
// M11/T1-R1 Phase 2: the pin moves once more. The owner approval path now
// requires an explicit `decisionRef` instead of defaulting one, promotes inside
// the canonical Skill Store writer lock, and requires `skillsRoot` to reject.
// The outgoing build (`230f3c79…`) is an admitted predecessor in BOTH per-mode
// lists; the new digest is deliberately NOT listed, because it is the current
// build and is accepted by content comparison.
// M11/T1-R1 Phase 4: the pin moves again — outbound attachment containment, the
// bounded in-process caches, and per-target containment reporting all live in
// this entrypoint. Phase 2's digest (`81b9a9c7…`) is NOT admitted either: the
// whole task ran under `Deployment Authorized: NO`, so those bytes were never
// installed on any runtime, and the runtime a future deployment starts from is
// still the admitted `230f3c79…` build.
// M11/T3 Phase 1: the pin moves again — A1 resolves the Discord bot-token
// helper through argv instead of a shell and A2 bounds the three unbounded REST
// calls, both inside this entrypoint. The build M11/T1-R1 left installed
// (`e8f084ab…`) IS admitted this time: `--preflight` proved the live WSL runtime
// carries it, so leaving it out would refuse the deployed extension.
// M12/T1-R1: the pin moves again — the governance entrypoint now registers the
// Discord components it posts with the host component registry, records an approval
// decision with a reason that matches the decision, mints the 12-character identity,
// and presents the plan plus an expected-result image. The build the live runtime
// carries (`61e344e6…`) is admitted in configure.mjs, and `--preflight` proved it
// installed, so it stays reachable as a predecessor.
// M12/T2-R1: and again — the entrypoint now opens every governed thread through one
// forum-tag path (STATUS+RISK+STACK on #approvals, STATUS+TYPE+STACK on #results,
// STATUS+SEVERITY+STACK on #incidents), records the thread it surfaced, re-drives a
// request that never got a card, publishes the accepted result, and surfaces a
// containment in #incidents. The live runtime still carries `61e344e6…` (M12/T1-R1 was
// never deployed, so its `85fbee50…` stays unlisted by design), and the same 17
// outgoing asset digests are still the admitted predecessors.
// M12/T2-R2: and again — the entrypoint now also moves the approval thread's STATUS tag when
// the owner decides (APPROVED / REJECTED / CHANGES), through the same lib seam that owns every
// other tag rule. R1's `f9ef77dc…` was never deployed so it stays unlisted, and no asset
// admission changes: the installed files are unchanged.
// Deployment A (2026-10-13) installed this pin: the live runtime now carries `513beb15…`, which
// IS the current build, so it is accepted by content comparison rather than admitted.
// M12/T2-R3: the live runtime stopped producing approval cards because the forum-tag asset
// refused every plan whose nodes reach more than one stack. That asset (`lib/discord-forum-tags.mjs`)
// is now packaged from changed source, so its deployed digest `e0a755bb…` — what the operator
// apply post-check measured and what `git show b6d04e8` reproduces — is admitted as a predecessor.
// M12/T2.2-R1 A-3: this pin moves. Moving the coordinator-notification queue write
// inside the queue lock changes packaged entrypoint bytes, so `513beb15…` — the build
// Deployment A installed on 2026-10-13, re-measured read-only against the deployed WSL
// file on 2026-10-16 — becomes an admitted predecessor in BOTH per-mode lists in
// `configure.mjs`. The digest below is deliberately NOT listed there: it is the current
// build, accepted by content comparison.
const CURRENT_ENTRYPOINT_SHA256 =
  "9c1b6e1e94e1bff06509f166c98b671f85716e2f4d511eed578916420e9174ed";

const identifiers = Object.freeze({
  discordGuildId: "123456789012345678",
  discordOwnerId: "223456789012345678",
  discordOfficeChannelId: "323456789012345678",
  discordResultsForumId: "423456789012345678",
  discordApprovalsForumId: "523456789012345678",
  discordIncidentsForumId: "62345678901234567",
});
// M10/T2-R9: configure.mjs runs as a child process, so the placeholders must be
// supplied through its environment, not just this process's.
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
  const root = mkdtempSync(path.join(tmpdir(), "zink-r3-"));
  const stateDir = path.join(root, ".openclaw-zink");
  const systemdUserDir = path.join(root, ".config", "systemd", "user");
  // M10/T2-R9: `configure.mjs` is spawned as a CHILD process, so the in-process
  // test env does not reach it. The placeholders are non-routable and are
  // supplied only so the builder can render a config shape; reachability is
  // proven by verify.mjs's live router probe, never by these values.
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

const currentBuild = async () =>
  (
    await import(
      pathToFileURL(
        path.join(REPO, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    )
  ).governancePluginFiles();

/**
 * Package the hygiene-build commit through the REAL generator, in a scratch
 * tree. This is provenance by construction, not by transcription.
 */
let hygieneGenerated = null;
async function hygieneExtension() {
  if (hygieneGenerated) return hygieneGenerated;
  const scratch = mkdtempSync(path.join(tmpdir(), "zink-r3-gen-"));
  try {
    const archive = spawnSync(
      "git",
      ["archive", HYGIENE_SOURCE_COMMIT, "--", "integrations/openclaw"],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(
      archive.status,
      0,
      `git archive of ${HYGIENE_SOURCE_COMMIT} must succeed`,
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
    hygieneGenerated = governancePluginFiles();
    return hygieneGenerated;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

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

function keyBlock(table, key) {
  const at = table.indexOf(`"${key}": Object.freeze([`);
  assert.notEqual(at, -1, `${key} must have an allowlist entry`);
  return table.slice(at, table.indexOf("]),", at));
}

// ---------------------------------------------------------------------------
// PROVENANCE — 10/10 before admission
// ---------------------------------------------------------------------------

test("R3 P1: all ten predecessor digests are reproduced from the hygiene-build commit", async () => {
  const hygiene = await hygieneExtension();
  const packaged = {};
  for (const [rel, body] of Object.entries(hygiene.assets))
    packaged[rel] = sha256(body);
  // The entrypoint reproduces too — already admitted, pinned as sanity.
  assert.equal(
    sha256(hygiene.entrypoint),
    HYGIENE_ENTRYPOINT_SHA256,
    "the hygiene entrypoint must reproduce from its source commit",
  );
  let proven = 0;
  for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
    assert.equal(
      packaged[rel],
      digest,
      `${rel}: the committed hygiene source must reproduce the admitted digest`,
    );
    proven += 1;
  }
  assert.equal(proven, 10, "exactly ten asset predecessors must be proven");
  assert.equal(
    Object.keys(HYGIENE_ASSET_PREDECESSORS).length,
    10,
    "the provenance table must hold exactly ten records",
  );
});

test("R3 P2: the live runtime agrees with the proven digests where reachable", async (t) => {
  // Read-only cross-check against the real deployed tree. On platforms where
  // the WSL live state dir is not mounted this is a skip, never a pass: the
  // committed-source derivation in R3 P1 is already a byte-exact proof.
  //
  // The read and the comparison are separated on purpose. A single try/catch
  // around both made an unreadable live root and a drifted live artifact
  // indistinguishable — the catch swallowed the digest mismatch, so the suite
  // reported a pass it never earned. An unreadable root skips with a named
  // reason; a readable artifact that does not match the proven digest fails.
  const live = "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance";
  const bodies = new Map();
  try {
    for (const rel of Object.keys(HYGIENE_ASSET_PREDECESSORS)) {
      bodies.set(rel, readFileSync(path.join(live, ...rel.split("/")), "utf8"));
    }
    bodies.set("index.mjs", readFileSync(path.join(live, "index.mjs"), "utf8"));
  } catch (error) {
    t.skip(
      `the live runtime root is not reachable on this host: ${error.code ?? error.message}`,
    );
    return;
  }

  for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
    assert.equal(
      sha256(bodies.get(rel)),
      digest,
      `live ${rel} must match the proven digest`,
    );
  }
  assert.equal(sha256(bodies.get("index.mjs")), HYGIENE_ENTRYPOINT_SHA256);
});

// ---------------------------------------------------------------------------
// THE ALLOWLIST ITSELF — exactly ten additions, each at its own path
// ---------------------------------------------------------------------------

test("R3 0: provenance parity — ten admitted digests for ten proven records", () => {
  const table = assetTable();
  const paths = Object.keys(HYGIENE_ASSET_PREDECESSORS);
  assert.equal(paths.length, 10);
  for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
    // Path + digest identity: the digest must live under its own key's block.
    const block = keyBlock(table, rel);
    assert.ok(
      block.includes(digest),
      `${rel}: the proven digest must be listed under its own path`,
    );
    // Exactly once in the whole file: no duplication, no leakage.
    assert.equal(
      CONFIGURE_SOURCE.split(digest).length - 1,
      1,
      `${rel} (${digest.slice(0, 16)}): exactly one allowlist occurrence`,
    );
    // Never the current build.
    assert.notEqual(
      digest,
      sha256(readFileSync(CONFIGURE, "utf8")),
      "sanity: digests differ from the gate file itself",
    );
  }
  // No wildcard or prefix entry was introduced anywhere.
  assert.equal(
    /"\*"|\*\//u.test(CONFIGURE_SOURCE),
    false,
    "no wildcard entries",
  );
});

test("R3 0b: the current-build digests are NOT listed anywhere", async () => {
  const current = await currentBuild();
  assert.equal(
    sha256(current.entrypoint),
    CURRENT_ENTRYPOINT_SHA256,
    "the pinned current entrypoint must match the packaged build",
  );
  const currentDigests = Object.values(current.assets).map((body) =>
    sha256(body),
  );
  currentDigests.push(CURRENT_ENTRYPOINT_SHA256);
  for (const digest of currentDigests) {
    assert.equal(
      CONFIGURE_SOURCE.includes(digest),
      false,
      `${digest.slice(0, 16)} is the current build and must not be allowlisted`,
    );
  }
  // The ten admitted predecessors must each differ from the current build.
  for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
    assert.notEqual(
      sha256(current.assets[rel]),
      digest,
      `${rel}: predecessor must differ from the current build`,
    );
  }
});

test("R3 0c: preflight and apply share the single asset allowlist", () => {
  // The asset admission table is declared once and consumed by BOTH builder
  // modes, so no per-mode deadlock of the R13 entrypoint class can re-open at
  // the asset layer: whatever --preflight accepts, --apply accepts.
  const declarations = [
    ...CONFIGURE_SOURCE.matchAll(
      /const ALLOWED_GOVERNANCE_ASSET_SHA256 = Object\.freeze\(\{/gu,
    ),
  ];
  assert.equal(declarations.length, 1, "exactly one asset allowlist");
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
// ACCEPTANCE — every proven predecessor passes preflight AND apply
// ---------------------------------------------------------------------------

test("R3 1: each proven predecessor passes preflight and converges on apply", async () => {
  const hygiene = await hygieneExtension();
  const current = await currentBuild();
  const p = provisioned();
  try {
    for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
      const target = p.asset(rel);
      const predecessorBytes = hygiene.assets[rel];
      assert.equal(
        sha256(predecessorBytes),
        digest,
        `fixture bytes for ${rel} must be the proven predecessor`,
      );
      writeFileSync(target, predecessorBytes, "utf8");
      // Preflight must accept the proven predecessor and mutate nothing.
      const out = p.preflight().toString("utf8");
      const parsed = JSON.parse(out);
      assert.equal(parsed.preflight, "PASS", `${rel}: preflight must PASS`);
      assert.equal(
        parsed.installedMutation,
        false,
        `${rel}: preflight must not mutate`,
      );
      assert.equal(
        sha256(readFileSync(target, "utf8")),
        digest,
        `${rel}: preflight must leave the predecessor in place`,
      );
      // Apply must accept it too — and converge it onto the current build.
      // (Preflight PASS followed by apply REFUSE would be the R13 deadlock;
      // the correct behaviour is PASS then ACCEPT.)
      p.apply();
      assert.equal(
        sha256(readFileSync(target, "utf8")),
        sha256(current.assets[rel]),
        `${rel}: apply must install the candidate bytes`,
      );
    }
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("M12/T2-R3: the deployed forum-tag asset is a reachable predecessor", async () => {
  // The same acceptance the R3 series exists to prove, applied to the newest admission:
  // Deployment A left `lib/discord-forum-tags.mjs` carrying `e0a755bb…` on the live host,
  // this revision packages it from changed source, and M12/T2-R3 exists because the
  // runtime stopped posting approval cards. `--preflight` must accept the installed bytes
  // and `--apply` must converge them — a PASS followed by a REFUSE is the R13 deadlock,
  // and here it would keep the outage in place.
  const DEPLOYED_REL = "lib/discord-forum-tags.mjs";
  const DEPLOYED_SHA256 =
    "e0a755bb9c6add431c9306fd8bc2895318a868c3c6b8e84326d94fb95526fff5";
  const predecessor = execFileSync(
    "git",
    ["show", `b6d04e8:integrations/openclaw/${DEPLOYED_REL}`],
    { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(
    sha256(predecessor),
    DEPLOYED_SHA256,
    "the admitted digest must reproduce from the commit Deployment A installed",
  );
  const current = await currentBuild();
  assert.notEqual(
    sha256(current.assets[DEPLOYED_REL]),
    DEPLOYED_SHA256,
    "this revision must actually change the asset, or the admission is dead weight",
  );
  const p = provisioned();
  try {
    const target = p.asset(DEPLOYED_REL);
    writeFileSync(target, predecessor, "utf8");
    const parsed = JSON.parse(p.preflight().toString("utf8"));
    assert.equal(
      parsed.preflight,
      "PASS",
      "preflight must accept the deployed forum-tag asset",
    );
    assert.equal(parsed.installedMutation, false);
    assert.equal(sha256(readFileSync(target, "utf8")), DEPLOYED_SHA256);
    p.apply();
    assert.equal(
      sha256(readFileSync(target, "utf8")),
      sha256(current.assets[DEPLOYED_REL]),
      "apply must install the remediation build",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("M12/T2-R3: a stranded ledger writer lock names its code, not APPLY_REJECTED", () => {
  // The production condition the owner hit: a gateway killed mid-append left
  // `<ledger>/writer.lock` behind with a dead owner pid. The lock primitive
  // deliberately never reclaims an orphan, so `--apply`'s last step
  // (`upgradeEmptyLegacyLedger` -> `withWriterLock`) refused, and
  // `operator-apply.mjs` reported the meaningless `APPLY_REJECTED`: the child
  // printed only prose, and the classifier reads only the child's text. The code
  // is a repository constant, so printing it names the fault and leaks nothing.
  const p = provisioned();
  try {
    const lock = lockDirFor(ledgerPaths(p.stateDir).root, "writer.lock");
    mkdirSync(lock, { recursive: true, mode: 0o700 });
    writeFileSync(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: 999999, token: "f".repeat(32) }),
      { mode: 0o600 },
    );
    let childError = null;
    try {
      p.apply();
    } catch (error) {
      childError = error;
    }
    assert.ok(childError, "an orphaned writer lock must stop the apply");
    const stderr = String(childError.stderr ?? "");
    assert.match(stderr, /Ledger writer unavailable/u);
    assert.match(stderr, /\[EXECUTION_STATE_UNKNOWN\]/u);
    assert.equal(
      classifyApplyReason(childError),
      "EXECUTION_STATE_UNKNOWN",
      "the operator report must name the refusal instead of collapsing it",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

test("R3 2: the exact production failure state is accepted — full hygiene tree", async () => {
  // The fixture reproduces the observed live runtime: all ten predecessor
  // assets plus the predecessor entrypoint, everything else current. Before
  // R3 this failed closed with `Governance plugin asset drift detected` (the
  // observed single-attempt preflight result); after R3 it must converge.
  const hygiene = await hygieneExtension();
  const current = await currentBuild();
  const p = provisioned();
  try {
    for (const rel of Object.keys(HYGIENE_ASSET_PREDECESSORS))
      writeFileSync(p.asset(rel), hygiene.assets[rel], "utf8");
    writeFileSync(p.asset("index.mjs"), hygiene.entrypoint, "utf8");
    const out = p.preflight().toString("utf8");
    const parsed = JSON.parse(out);
    assert.equal(parsed.preflight, "PASS");
    assert.equal(parsed.installedMutation, false);
    p.apply();
    for (const rel of Object.keys(HYGIENE_ASSET_PREDECESSORS)) {
      assert.equal(
        sha256(readFileSync(p.asset(rel), "utf8")),
        sha256(current.assets[rel]),
        `${rel}: full-tree apply must install the candidate bytes`,
      );
    }
    assert.equal(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      sha256(current.entrypoint),
      "the entrypoint must converge onto the current build",
    );
    assert.notEqual(
      sha256(readFileSync(p.asset("index.mjs"), "utf8")),
      HYGIENE_ENTRYPOINT_SHA256,
      "the predecessor entrypoint must not survive the upgrade",
    );
  } finally {
    rmSync(p.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// REJECTION — the half that matters
// ---------------------------------------------------------------------------

test("R3 3: a one-byte perturbation of any admitted predecessor is refused", async () => {
  // Each admission is load-bearing: the pass above depends on the EXACT
  // proven bytes, so the pre-R3 refusal is pinned at digest granularity.
  const hygiene = await hygieneExtension();
  for (const [rel, digest] of Object.entries(HYGIENE_ASSET_PREDECESSORS)) {
    const p = provisioned();
    try {
      const target = p.asset(rel);
      const perturbed = `${hygiene.assets[rel]}// one extra byte\n`;
      assert.notEqual(sha256(perturbed), digest);
      writeFileSync(target, perturbed, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin asset drift detected/u,
        `${rel}: preflight must refuse a perturbed predecessor`,
      );
      assert.throws(
        p.apply,
        /Governance plugin asset drift detected/u,
        `${rel}: apply must refuse a perturbed predecessor`,
      );
      assert.equal(
        readFileSync(target, "utf8"),
        perturbed,
        `${rel}: a refused file must be left byte-identical`,
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test("R3 4: an unknown digest on an R3-touched path is refused without mutation", () => {
  const p = provisioned();
  try {
    const target = p.asset("lib/guard.mjs");
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

test("R3 5: a proven digest at the WRONG path is refused", async () => {
  // Each approved identity is bound to its own path. Path-scoping is what
  // stops the allowlist from becoming a global digest set.
  const hygiene = await hygieneExtension();
  const guardBytes = hygiene.assets["lib/guard.mjs"];
  const workflowBytes = hygiene.assets["lib/workflow.mjs"];
  for (const [rel, body] of [
    ["lib/workflow.mjs", guardBytes],
    ["lib/guard.mjs", workflowBytes],
  ]) {
    const p = provisioned();
    try {
      writeFileSync(p.asset(rel), body, "utf8");
      assert.throws(
        p.preflight,
        /Governance plugin asset drift detected/u,
        `${rel} must not accept another path's approved bytes`,
      );
    } finally {
      rmSync(p.root, { recursive: true, force: true });
    }
  }
});

test("R3 6: every governed asset path still refuses an unknown body", () => {
  // The property R3 must not have weakened anywhere: the full table,
  // including the ten extended entries, stays fail-closed.
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
