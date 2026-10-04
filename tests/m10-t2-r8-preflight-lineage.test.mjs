// M10/T2-R8 — preflight lineage: the live R5-injected file must be
// recognized as the approved predecessor of the R8 union-sources repair.
//
// Without a descriptor, the R8 injection change makes the live preflight
// file unrecognizable (NATIVE_SOURCE_DRIFT), which blocks preflight and
// therefore the whole R8 deployment — observed directly before the
// descriptor existed. This suite pins the exact recognition: the live
// digest, the verbatim R5 region text, inversion to the pinned upstream
// baseline, and forward convergence onto the R8 region.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DISCORD_PREFLIGHT_ANCHOR,
  DISCORD_PREFLIGHT_INJECTION,
  DISCORD_PREFLIGHT_INJECTION_R5,
  NATIVE_PATCH_PREDECESSORS,
  transformNativeSource,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const VERSION = "2026.6.34";
const PREFLIGHT = "message-handler.preflight-C1XBiefW.js";

// The live runtime is WSL-side. Read it through a UNC path so the pins run
// on Windows hosts that can reach the distro, and skip cleanly where they
// cannot — never assert an unverified artifact identity.
const LIVE_UNC =
  "//wsl$/Ubuntu/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";
const LIVE_WSL = "/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The pinned upstream preflight baseline (R5 H1). */
const PREFLIGHT_BASELINE_SHA256 =
  "dca5459d27777d7884483d86432d82c0da88244338c3e6ec574a337ec687c0b0";

/** The live R5-injected preflight digest, read-only verified pre-admission. */
const LIVE_R5_PREFLIGHT_SHA256 =
  "5411ccd4c8bafaa29013e498ee8c6cc58d034bd7db48dafcb1aeb105ddc61d8e";

function livePreflight() {
  try {
    return readFileSync(LIVE_UNC + PREFLIGHT, "utf8");
  } catch {
    return readFileSync(LIVE_WSL + PREFLIGHT, "utf8");
  }
}

const reachable = (() => {
  try {
    return sha256(livePreflight()) === LIVE_R5_PREFLIGHT_SHA256;
  } catch {
    return false;
  }
})();

const skip = (message) => (reachable ? false : message);

test("R8 L0: the descriptor names the R5→R8 preflight transition exactly", () => {
  const entry = NATIVE_PATCH_PREDECESSORS[VERSION]?.[PREFLIGHT];
  assert.ok(entry, "a preflight predecessor descriptor must exist");
  assert.equal(entry.revision, "R5");
  assert.equal(entry.successorRevision, "R8");
  assert.equal(entry.sourceDigest, LIVE_R5_PREFLIGHT_SHA256);
  assert.equal(
    entry.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R5}`,
  );
  assert.equal(
    entry.supersedes,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
  );
  assert.notEqual(entry.sourceSignature, entry.supersedes);
});

test(
  "R8 L1: the live R5 preflight file is the approved predecessor",
  { skip: skip("live runtime not reachable") },
  () => {
    const live = livePreflight();
    assert.equal(sha256(live), LIVE_R5_PREFLIGHT_SHA256);
    // The R5 region occurs exactly once; the R8 union code is absent.
    assert.equal(
      live.split(DISCORD_PREFLIGHT_INJECTION_R5).length - 1,
      1,
      "the live file carries exactly one R5 region",
    );
    assert.equal(
      live.includes("zinkRaw?.mentions"),
      false,
      "the live file predates the R8 union repair",
    );
  },
);

test(
  "R8 L2: the predecessor inverts to the pinned baseline and converges onto R8",
  { skip: skip("live runtime not reachable") },
  () => {
    const verdict = transformNativeSource(PREFLIGHT, livePreflight(), VERSION);
    assert.equal(verdict.state, "PREDECESSOR");
    assert.equal(verdict.predecessorRevision, "R5");
    assert.equal(verdict.successorRevision, "R8");
    assert.equal(
      sha256(verdict.before),
      PREFLIGHT_BASELINE_SHA256,
      "inversion must reproduce the pinned upstream baseline byte-for-byte",
    );
    assert.ok(
      verdict.after.includes("zinkRaw?.mentions"),
      "forward convergence must carry the R8 union repair",
    );
    assert.ok(
      verdict.after.includes(DISCORD_PREFLIGHT_ANCHOR),
      "the anchor survives the transition",
    );
  },
);

test("R8 L3: an unrecognized preflight file still fails closed", () => {
  assert.throws(
    () => transformNativeSource(PREFLIGHT, "not a preflight file", VERSION),
    /NATIVE_SOURCE_DRIFT/,
  );
});
