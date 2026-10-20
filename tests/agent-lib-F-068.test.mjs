// F-068 (R1-A12-07) — a refusal is a RESULT, not a throw.
//
// `tick()` used to `await runOnce()` and discard the answer, so every named
// refusal the pickup can make (PICKUP_CLAIM_FAILED, PICKUP_ALREADY_CLAIMED,
// LEDGER_CLAIM_RECORD_FAILED, COORDINATOR_RUNTIME_SEAM_UNAVAILABLE) was
// silent: the loop kept ticking and said nothing, so a permanently blocked
// queue looked like a quiet one.
//
// The lane drives the real scheduler with a `runOnce` that refuses, and
// asserts the refusal reaches the error channel on EVERY tick.
import assert from "node:assert/strict";
import test from "node:test";

import { createPickupScheduler } from "../integrations/openclaw/lib/coordinator-pickup.mjs";

const REFUSALS = [
  "PICKUP_CLAIM_FAILED",
  "PICKUP_ALREADY_CLAIMED",
  "LEDGER_CLAIM_RECORD_FAILED",
  "COORDINATOR_RUNTIME_SEAM_UNAVAILABLE",
];

for (const error of REFUSALS) {
  test(`F-068: the pickup loop reports ${error} on every tick`, async () => {
    const seen = [];
    let ticks = 0;
    const scheduler = createPickupScheduler({
      intervalMs: 5,
      runOnce: async () => {
        ticks += 1;
        return { ok: false, error };
      },
      onError: (err) => seen.push(String(err?.message ?? err)),
    });
    try {
      scheduler.start();
      const deadline = Date.now() + 2000;
      while (seen.length < 3 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(
        seen.length >= 3,
        `the refusal must be reported on every tick, saw ${seen.length}`,
      );
      for (const message of seen) {
        assert.match(message, /PICKUP_REFUSED/u);
        assert.match(message, new RegExp(error, "u"));
      }
      assert.ok(ticks >= 3, "the loop kept ticking");
    } finally {
      scheduler.stop();
    }
  });
}

test("F-068: a successful tick reports nothing", async () => {
  const seen = [];
  const scheduler = createPickupScheduler({
    intervalMs: 5,
    runOnce: async () => ({ ok: true }),
    onError: (err) => seen.push(String(err?.message ?? err)),
  });
  try {
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(seen, [], "a successful tick is not an error");
  } finally {
    scheduler.stop();
  }
});
