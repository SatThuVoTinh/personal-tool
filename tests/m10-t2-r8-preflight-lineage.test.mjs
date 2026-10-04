// M10/T2-R8 — preflight lineage: the live DEPLOYED R8 union-sources file must
// be recognized as the approved predecessor of the diagnostics build.
//
// Without an advanced slot, the R8 diagnostics deploy failed closed at
// `native-backup-prune` with NATIVE_SOURCE_DRIFT, because the live preflight
// file no longer inverted through the (now different) current injection. The
// active slot follows the real deployment chain, exactly as the R7 slot was
// retired earlier; R5's region stays exported and pinned as history.
//
// This suite pins the exact recognition: the live digest, the verbatim
// predecessor region, inversion to the pinned upstream baseline, and forward
// convergence onto the diagnostics region.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DISCORD_PREFLIGHT_ANCHOR,
  DISCORD_PREFLIGHT_INJECTION,
  DISCORD_PREFLIGHT_INJECTION_R5,
  DISCORD_PREFLIGHT_INJECTION_R8_UNION,
  NATIVE_PATCH_PREDECESSORS,
  transformNativeSource,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const VERSION = "2026.6.34";
const PREFLIGHT = "message-handler.preflight-C1XBiefW.js";

// The live runtime is WSL-side. Read it through a UNC path so the pins run on
// Windows hosts that can reach the distro, and skip cleanly where they cannot —
// never assert an unverified artifact identity.
const LIVE_UNC =
  "//wsl$/Ubuntu/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";
const LIVE_WSL = "/home/hoang_vinh/.local/lib/node_modules/openclaw/dist/";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The pinned upstream preflight baseline. */
const PREFLIGHT_BASELINE_SHA256 =
  "dca5459d27777d7884483d86432d82c0da88244338c3e6ec574a337ec687c0b0";

/** The deployed R8 union-sources preflight digest, read-only verified. */
const LIVE_R8_UNION_SHA256 =
  "d12961a2d0f83b23a91e9859343920d86522957eb4e79ea3ffc7733c0253d8c6";

function livePreflight() {
  try {
    return readFileSync(LIVE_UNC + PREFLIGHT, "utf8");
  } catch {
    return readFileSync(LIVE_WSL + PREFLIGHT, "utf8");
  }
}

const reachable = (() => {
  try {
    return sha256(livePreflight()) === LIVE_R8_UNION_SHA256;
  } catch {
    return false;
  }
})();

const skip = (message) => (reachable ? false : message);

test("R8 L0: the descriptor names the R8 -> R8-diagnostics transition exactly", () => {
  const entry = NATIVE_PATCH_PREDECESSORS[VERSION]?.[PREFLIGHT];
  assert.ok(entry, "a preflight predecessor descriptor must exist");
  assert.equal(entry.revision, "R8");
  assert.equal(entry.successorRevision, "R8-diagnostics");
  assert.equal(entry.sourceDigest, LIVE_R8_UNION_SHA256);
  assert.equal(
    entry.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R8_UNION}`,
  );
  assert.equal(
    entry.supersedes,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
  );
  assert.notEqual(entry.sourceSignature, entry.supersedes);
});

test(
  "R8 L1: the live R8 union file is the approved predecessor",
  {
    skip: skip("live runtime not reachable"),
  },
  () => {
    const live = livePreflight();
    assert.equal(sha256(live), LIVE_R8_UNION_SHA256);
    assert.equal(
      live.split(DISCORD_PREFLIGHT_INJECTION_R8_UNION).length - 1,
      1,
      "the live file carries exactly one R8 union region",
    );
    assert.equal(
      live.includes("[zink-ingress-meta]"),
      false,
      "the live file predates the diagnostics build",
    );
  },
);

test(
  "R8 L2: the predecessor inverts to the pinned baseline and converges",
  {
    skip: skip("live runtime not reachable"),
  },
  () => {
    const verdict = transformNativeSource(PREFLIGHT, livePreflight(), VERSION);
    assert.equal(verdict.state, "PREDECESSOR");
    assert.equal(verdict.predecessorRevision, "R8");
    assert.equal(verdict.successorRevision, "R8-diagnostics");
    assert.equal(
      sha256(verdict.before),
      PREFLIGHT_BASELINE_SHA256,
      "inversion must reproduce the pinned upstream baseline byte-for-byte",
    );
    assert.ok(
      verdict.after.includes("[zink-ingress-meta]"),
      "forward convergence must carry the diagnostics region",
    );
    assert.ok(
      verdict.after.includes(DISCORD_PREFLIGHT_ANCHOR),
      "the anchor survives the transition",
    );
  },
);

test("R8 L3: R5's region stays exported verbatim as history", () => {
  // Retiring the R5 SLOT must not retire R5's text: the R5 suite pins its own
  // region, and history is never rewritten to match a new deployment.
  assert.ok(
    DISCORD_PREFLIGHT_INJECTION_R5.length > 100,
    "the R5 region must remain exported",
  );
  assert.notEqual(
    DISCORD_PREFLIGHT_INJECTION_R5,
    DISCORD_PREFLIGHT_INJECTION_R8_UNION,
  );
  assert.notEqual(
    DISCORD_PREFLIGHT_INJECTION_R8_UNION,
    DISCORD_PREFLIGHT_INJECTION,
  );
});

test("R8 L4: an unrecognized preflight file still fails closed", () => {
  assert.throws(
    () => transformNativeSource(PREFLIGHT, "not a preflight file", VERSION),
    /NATIVE_SOURCE_DRIFT/,
  );
});
