// M10/T2-R8 — preflight lineage: the live DEPLOYED R8 diagnostics-hardened file
// must be recognized as the approved predecessor of the stderr-grounded build.
//
// Without an advanced slot, every subsequent deploy fails closed at
// `native-backup-prune` with NATIVE_SOURCE_DRIFT, because the live preflight
// file no longer inverts through the current injection. The active slot
// follows the real deployment chain, exactly as the R7 and R8-diagnostics slots
// were retired earlier; every superseded region stays exported and pinned as
// history, so history is never rewritten to match a deploy.
//
// This suite pins the exact recognition: the live digest, the verbatim
// predecessor region, inversion to the pinned upstream baseline, and forward
// convergence onto the stderr-grounded region.
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

/** The deployed R8 diagnostics-hardened preflight digest, read-only verified. */
const LIVE_R8_HARDENED_SHA256 =
  "f15e907849bf62a455538c901e8c39e05804edbaebf6485d95c182731154bb07";

function livePreflight() {
  try {
    return readFileSync(LIVE_UNC + PREFLIGHT, "utf8");
  } catch {
    return readFileSync(LIVE_WSL + PREFLIGHT, "utf8");
  }
}

const reachable = (() => {
  try {
    return sha256(livePreflight()) === LIVE_R8_HARDENED_SHA256;
  } catch {
    return false;
  }
})();

const skip = (message) => (reachable ? false : message);

test("R8 L0: the descriptor names the active preflight transition exactly", () => {
  const entry = NATIVE_PATCH_PREDECESSORS[VERSION]?.[PREFLIGHT];
  assert.ok(entry, "a preflight predecessor descriptor must exist");
  assert.equal(entry.revision, "R8-diagnostics-hardened");
  assert.equal(entry.successorRevision, "R8-stderr-grounded");
  assert.equal(entry.sourceDigest, LIVE_R8_HARDENED_SHA256);
  assert.equal(
    entry.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED}`,
  );
  assert.equal(
    entry.supersedes,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
  );
  assert.notEqual(entry.sourceSignature, entry.supersedes);
});

test("R8 L0b: the retired slots stay pinned as verbatim history", () => {
  // Retiring a SLOT must never retire its text or reorder the chain. Each
  // retired step keeps its own superseded region so no deploy can rewrite
  // history to match itself.
  const entry = NATIVE_PATCH_PREDECESSORS[VERSION]?.[PREFLIGHT];
  const chain = entry.retiredPredecessors.map((step) => step.revision);
  assert.deepEqual(chain, ["R8-diagnostics", "R5"]);
  const [diagnostics, r5] = entry.retiredPredecessors;
  assert.equal(
    diagnostics.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS}`,
  );
  assert.equal(
    diagnostics.supersedes,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R8_UNION}`,
  );
  assert.equal(
    r5.sourceSignature,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R5}`,
  );
  assert.equal(r5.supersedes, DISCORD_PREFLIGHT_ANCHOR);
});

test(
  "R8 L1: the live hardened file is the approved predecessor",
  { skip: skip("live runtime not reachable") },
  () => {
    const live = livePreflight();
    assert.equal(sha256(live), LIVE_R8_HARDENED_SHA256);
    assert.equal(
      live.split(DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED).length -
        1,
      1,
      "the live file carries exactly one deployed hardened region",
    );
    // The hardened build routed the report only through the child logger, which
    // is why live evidence produced no report at all. The live file must lack
    // the stderr ground truth.
    assert.equal(
      live.includes("zinkReport"),
      false,
      "the live file predates the stderr-grounded build",
    );
    assert.equal(live.includes("zinkProbe"), true);
  },
);

test(
  "R8 L2: the predecessor inverts to the pinned baseline and converges",
  { skip: skip("live runtime not reachable") },
  () => {
    const verdict = transformNativeSource(PREFLIGHT, livePreflight(), VERSION);
    assert.equal(verdict.state, "PREDECESSOR");
    assert.equal(verdict.predecessorRevision, "R8-diagnostics-hardened");
    assert.equal(verdict.successorRevision, "R8-stderr-grounded");
    assert.equal(
      sha256(verdict.before),
      PREFLIGHT_BASELINE_SHA256,
      "inversion must reproduce the pinned upstream baseline byte-for-byte",
    );
    assert.ok(
      verdict.after.includes("zinkReport"),
      "forward convergence must carry the stderr-grounded region",
    );
    assert.ok(
      verdict.after.includes(DISCORD_PREFLIGHT_ANCHOR),
      "the anchor survives the transition",
    );
  },
);

test("R8 L3: every superseded region stays exported verbatim as history", () => {
  // Retiring a SLOT must not retire its text. Each superseded region is still
  // exported and pinned, so no deploy can rewrite history to match itself.
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
    () => transformNativeSource(PREFLIGHT, "not a preflight file", VERSION),
    /NATIVE_SOURCE_DRIFT/,
  );
});
