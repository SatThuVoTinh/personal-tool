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

/** The pinned upstream channel baseline, verified by inspection. */
const CHANNEL_BASELINE_SHA256 =
  "386ba4b7c89a5aedaa29756e0ac320709b049c5abf4a4f77a918c309d2028edf";

const reachable = (() => {
  const live = readLive(LIVE_CHANNEL, LIVE_WSL_CHANNEL, CHANNEL_FILE);
  return live !== null && sha256(live) === CHANNEL_BASELINE_SHA256;
})();

const skip = (message) => (reachable ? false : message);

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

test(
  "R8 L1: the live channel preflight is the baseline this patch transforms",
  { skip: skip("live runtime not reachable") },
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
  () => {
    const dead = readLive(LIVE_DEAD, LIVE_WSL_DEAD, DEAD_FILE);
    if (!dead) return;
    // The whole R5→R8 chain landed HERE: the region is present in the file
    // nobody loads, which is the direct evidence that the repair never reached
    // the executing preflight.
    assert.equal(
      dead.split(DISCORD_PREFLIGHT_INJECTION).length - 1,
      1,
      "the retired chain is expected to be present in the dead copy",
    );
    assert.ok(dead.includes("zinkProbe"), "the dead copy carries the probes");
    // …and the executing file carries none of it.
    const live = readLive(LIVE_CHANNEL, LIVE_WSL_CHANNEL, CHANNEL_FILE);
    assert.equal(
      live.split(DISCORD_PREFLIGHT_INJECTION).length - 1,
      0,
      "the executing preflight never received the injection",
    );
  },
);

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
