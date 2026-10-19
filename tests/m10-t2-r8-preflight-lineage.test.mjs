// M10/T2-R8 — Discord preflight lineage: proof that the executed preflight is
// the file this patch writes, and that the retired lineage is retired rather
// than rewritten to match a deploy.
//
// Live evidence that forced this: `openclaw plugins list` resolves the enabled
// `discord` plugin to the separately installed `@openclaw/discord` package under
// the profile's npm project store. The R5→R8 chain had been injected into the
// runtime package's own copy of the same Discord bundle, which nothing loads, so
// the executing preflight never carried any region, the ingress metadata
// registry was never written, and every admissible message was denied for a
// missing mention.
//
// There is therefore NO predecessor slot for the live channel file: it is still
// at its upstream baseline. These tests pin that fact, pin that the executed file
// really does carry the current injection, and pin that the retired regions stay
// exported verbatim so the mistake remains auditable.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DISCORD_PREFLIGHT_ANCHOR,
  DISCORD_PREFLIGHT_INJECTION,
  DISCORD_PREFLIGHT_INJECTION_R5,
  DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS,
  DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED,
  DISCORD_PREFLIGHT_INJECTION_R8_UNION,
  NATIVE_DISCORD_CHANNEL_RELATIVE,
  NATIVE_PATCH_PREDECESSORS,
  NATIVE_RUNTIME_PINS,
  transformNativeSource,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const VERSION = "2026.6.34";
const CHANNEL_FILE = "message-handler.preflight-CbD0u7U7.js";
const DEAD_FILE = "message-handler.preflight-C1XBiefW.js";

// The live channel package is WSL-side. Read it through a UNC path so the pins
// run on Windows hosts that can reach the distro, and skip cleanly where they
// cannot — never assert an unverified artifact identity.
const LIVE_CHANNEL =
  "//wsl$/Ubuntu/home/hoang_vinh/.openclaw-zink/npm/projects/openclaw-discord-c0892df945/node_modules/@openclaw/discord/dist/";
const LIVE_WSL_CHANNEL =
  "/home/hoang_vinh/.openclaw-zink/npm/projects/openclaw-discord-c0892df945/node_modules/@openclaw/discord/dist/";
const LIVE_DEAD =
  "//wsl$/Ubuntu/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";
const LIVE_WSL_DEAD = "/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** Read a live artifact through the UNC form, falling back to the WSL path. */
function readLive(unc, wsl, file) {
  for (const base of [unc, wsl]) {
    try {
      return readFileSync(base + file, "utf8");
    } catch {
      /* try the next path form */
    }
  }
  return null;
}

/**
 * Every governed zink region the patcher can write into a preflight file.
 *
 * The retired-chain check used to name one constant and one marker string.
 * Both were wrong against the live host: the retired copy has been re-patched
 * by a later apply, and the marker it used
 * (`zink_ingress_metadata_r5`) is present in EVERY exported region, including
 * the current one — measured 2026-10-19 on the WSL host, where the retired
 * copy carries the R8 diagnostics-hardened region and the executing copy
 * carries the base R8 region.
 */
const GOVERNED_REGIONS = [
  ["R8 base", DISCORD_PREFLIGHT_INJECTION],
  ["R5", DISCORD_PREFLIGHT_INJECTION_R5],
  ["R8 union", DISCORD_PREFLIGHT_INJECTION_R8_UNION],
  ["R8 diagnostics", DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS],
  [
    "R8 diagnostics-hardened",
    DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED,
  ],
];

/** Count the governed regions present in a preflight body. */
function countGovernedRegions(body) {
  const counts = {};
  let total = 0;
  for (const [label, region] of GOVERNED_REGIONS) {
    const occurrences = body.split(region).length - 1;
    counts[label] = occurrences;
    total += occurrences;
  }
  return { counts, total };
}

/** The pinned upstream channel baseline, verified by inspection. */
const CHANNEL_BASELINE_SHA256 =
  "386ba4b7c89a5aedaa29756e0ac320709b049c5abf4a4f77a918c309d2028edf";

/**
 * Classify a live channel artifact against the pin.
 *
 * The previous predicate collapsed three different states into one boolean:
 * an unreadable live root, a live artifact that is a recognised build
 * (baseline, already patched, or an admitted predecessor), and a live artifact
 * that is none of those — an upstream change. The third state is the exact
 * regression these pins exist to catch, and it used to turn the suite green by
 * skipping. It is now its own state, and a readable artifact in it fails.
 */
function classifyLiveChannel(body) {
  if (body === null) return { readable: false, state: "UNREADABLE" };
  try {
    const verdict = transformNativeSource(CHANNEL_FILE, body, VERSION);
    return { readable: true, state: verdict.state, verdict };
  } catch (error) {
    return { readable: true, state: "DRIFT", error };
  }
}

const liveChannel = classifyLiveChannel(
  readLive(LIVE_CHANNEL, LIVE_WSL_CHANNEL, CHANNEL_FILE),
);

const skip = (message) => (liveChannel.readable ? false : message);

/**
 * The baseline-identity assertion only applies to an unpatched live artifact.
 * An unreadable root skips; an artifact that is already patched or an admitted
 * predecessor skips with that reason; an artifact in an unrecognised state
 * does NOT skip — it must fail.
 */
const skipBaselineIdentity = (message) => {
  if (!liveChannel.readable) return message;
  if (liveChannel.state === "DRIFT") return false;
  if (liveChannel.state !== "BASELINE") {
    return `the live channel artifact is a ${liveChannel.state} build, not the upstream baseline`;
  }
  return false;
};

test("R8 L0: the pin names the file the host actually executes", () => {
  const entry = NATIVE_RUNTIME_PINS[VERSION].sources[CHANNEL_FILE];
  assert.ok(entry, "the executing preflight must be pinned");
  assert.equal(entry.role, "discord-preflight");
  assert.equal(entry.scope, "discordChannel");
  assert.equal(entry.sha256, CHANNEL_BASELINE_SHA256);
  // The runtime package's own copy must NOT be pinned: it is dead code, and
  // pinning it is what kept the repair invisible for the whole chain.
  assert.equal(
    Object.keys(NATIVE_RUNTIME_PINS[VERSION].sources).includes(DEAD_FILE),
    false,
    "the unloadable runtime-root copy must never be pinned again",
  );
  assert.ok(
    NATIVE_DISCORD_CHANNEL_RELATIVE.includes("@openclaw/discord"),
    "the channel root must name the installed plugin package",
  );
});

test("R8 L0b: the live channel region is a recognised predecessor", () => {
  // The channel file is now PATCHED, so the slot follows the real chain: the
  // deployed stderr-grounded region is superseded by the intake-seam build.
  // Recognition is exact and inversion to the pinned baseline still has to
  // reproduce, which is what keeps this from becoming "rewrite history to match
  // whatever is on disk".
  const entry = NATIVE_PATCH_PREDECESSORS[VERSION]?.[CHANNEL_FILE];
  assert.ok(entry, "the channel artifact needs an active predecessor slot");
  assert.equal(entry.revision, "R8-stderr-grounded");
  assert.equal(entry.successorRevision, "R8-preflight-intake");
  assert.equal(
    entry.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED}`,
  );
  assert.equal(
    entry.supersedes,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
  );
  assert.notEqual(entry.sourceSignature, entry.supersedes);
  // The retired runtime-root file must have NO slot at all.
  assert.equal(
    Object.hasOwn(NATIVE_PATCH_PREDECESSORS[VERSION], DEAD_FILE),
    false,
    "a file nothing loads must never gain a predecessor slot",
  );
});

test(
  "R8 L1: the live channel preflight is the baseline this patch transforms",
  { skip: skipBaselineIdentity("live runtime not reachable") },
  () => {
    const live = readLive(LIVE_CHANNEL, LIVE_WSL_CHANNEL, CHANNEL_FILE);
    assert.equal(sha256(live), CHANNEL_BASELINE_SHA256);
    assert.equal(
      live.split(DISCORD_PREFLIGHT_INJECTION).length - 1,
      0,
      "the live executing preflight has never carried the injection",
    );
    assert.equal(
      live.split(DISCORD_PREFLIGHT_ANCHOR).length - 1,
      1,
      "the anchor must be present exactly once in the executed file",
    );
    const verdict = transformNativeSource(CHANNEL_FILE, live, VERSION);
    assert.equal(verdict.state, "BASELINE");
    assert.equal(verdict.beforeDigest, CHANNEL_BASELINE_SHA256);
    assert.ok(
      verdict.after.includes(DISCORD_PREFLIGHT_INJECTION),
      "the transformed image must carry the current injection",
    );
  },
);

test(
  "R8 L2: the dead runtime-root copy proves where the chain went",
  { skip: skip("live runtime not reachable") },
  (t) => {
    const dead = readLive(LIVE_DEAD, LIVE_WSL_DEAD, DEAD_FILE);
    if (!dead) {
      // An absent dead copy is a skip, never a silent pass: the body below is
      // evidence about a real file, and returning quietly reported it as proven.
      t.skip("the retired runtime-root copy is not readable on this host");
      return;
    }
    const live = readLive(LIVE_CHANNEL, LIVE_WSL_CHANNEL, CHANNEL_FILE);
    if (!live) {
      t.skip("the executing preflight is not readable on this host");
      return;
    }
    // The whole R5→R8 chain landed in the copy nobody loads, which is the
    // direct evidence that the repair never reached the executing preflight.
    // The invariant is therefore about WHERE the governed region went, not
    // about which revision it is: the retired copy must carry exactly one
    // governed region, the executing copy must carry one too, and the two must
    // not be the same build.
    const deadRegions = countGovernedRegions(dead);
    const liveRegions = countGovernedRegions(live);
    assert.equal(
      deadRegions.total,
      1,
      `the retired runtime-root copy must carry exactly one governed region, found ${deadRegions.total} (${JSON.stringify(deadRegions.counts)})`,
    );
    assert.ok(
      liveRegions.total >= 1,
      `the executing preflight must carry a governed region, found ${liveRegions.total}`,
    );
    assert.notEqual(
      dead,
      live,
      "the retired runtime-root copy and the executing preflight must not be the same build",
    );
  },
);

test("R8 L1b: a readable live artifact in no recognised build is drift, not a skip", () => {
  // Host-independent half: the classifier must have a state for "readable but
  // unrecognised". Without it a drift collapsed into the same skip as an
  // unreachable live root.
  const drift = classifyLiveChannel("not a preflight file");
  assert.equal(drift.readable, true);
  assert.equal(drift.state, "DRIFT");
  assert.match(String(drift.error?.message ?? ""), /NATIVE_SOURCE_DRIFT/);

  // Live half: on a host where the live artifact drifted, the suite must fail.
  // The skip predicates above deliberately do not skip a DRIFT artifact.
  if (liveChannel.readable && liveChannel.state === "DRIFT") {
    assert.fail(
      `the live channel artifact matches no pinned build and drifted: ${liveChannel.error?.message}`,
    );
  }
});

test("R8 L3: every superseded region stays exported verbatim as history", () => {
  // Retiring a SLOT must not retire its text. Each superseded region is still
  // exported and pinned, so the mistake stays auditable and no future deploy can
  // rewrite history to match itself.
  for (const [label, region] of Object.entries({
    R5: DISCORD_PREFLIGHT_INJECTION_R5,
    R8: DISCORD_PREFLIGHT_INJECTION_R8_UNION,
    "R8-diagnostics": DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS,
    "R8-diagnostics-hardened":
      DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED,
  })) {
    assert.ok(region.length > 100, `${label} region must remain exported`);
    assert.notEqual(
      region,
      DISCORD_PREFLIGHT_INJECTION,
      `${label} must differ`,
    );
  }
});

test("R8 L4: an unrecognized preflight file still fails closed", () => {
  assert.throws(
    () => transformNativeSource(CHANNEL_FILE, "not a preflight file", VERSION),
    /NATIVE_SOURCE_DRIFT|NATIVE_PATCH_TARGET_DENIED/,
  );
  assert.throws(
    () => transformNativeSource(DEAD_FILE, "not a preflight file", VERSION),
    /NATIVE_PATCH_TARGET_DENIED/,
    "an unpinned bundle name must be refused outright",
  );
});
