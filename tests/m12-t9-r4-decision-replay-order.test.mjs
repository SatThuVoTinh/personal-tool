// M12/T9 F-404 (legacy R9-L04-4): the derived decision id is computed from an
// order-independent canonical key, but the replay comparison was a raw
// JSON.stringify of the record, which is insertion-order sensitive. Two
// representations of one decision collided on identity and differed on bytes,
// so an honest replay threw DECISION_ID_CONFLICT against the documented
// idempotency.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";

function freshLedger() {
  const dir = mkdtempSync(path.join(tmpdir(), "r4-decision-"));
  return new DecisionLedger({ storagePath: path.join(dir, "ledger.json") });
}

describe("M12/T9 F-404 - a replay compares canonical bytes, not key order", () => {
  it("a context replayed with reversed key order returns the existing record", () => {
    const ledger = freshLedger();
    const first = ledger.recordDecision({
      topic: "deploy",
      decision: "approve",
      confirmedBy: "123456789012345678",
      context: { a: 1, b: 2 },
      tags: ["ops", "release"],
    });
    const replay = ledger.recordDecision({
      topic: "deploy",
      decision: "approve",
      confirmedBy: "123456789012345678",
      context: { b: 2, a: 1 },
      tags: ["ops", "release"],
    });
    assert.equal(replay.decisionId, first.decisionId);
    assert.equal(
      replay.confirmedAt,
      first.confirmedAt,
      "the stored record is returned",
    );
  });

  it("nested objects are compared key-order independently", () => {
    const ledger = freshLedger();
    ledger.recordDecision({
      topic: "nested",
      decision: "yes",
      confirmedBy: "123456789012345678",
      context: { outer: { inner: 1, other: [1, 2, 3] } },
    });
    const replay = ledger.recordDecision({
      topic: "nested",
      decision: "yes",
      confirmedBy: "123456789012345678",
      context: { outer: { other: [1, 2, 3], inner: 1 } },
    });
    assert.equal(replay.decision, "yes");
  });

  it("a genuinely different decision on the same identity still conflicts", () => {
    const ledger = freshLedger();
    ledger.recordDecision({
      topic: "deploy",
      decision: "approve",
      confirmedBy: "123456789012345678",
      context: { a: 1, b: 2 },
    });
    assert.throws(
      () =>
        ledger.recordDecision({
          topic: "deploy",
          decision: "approve",
          confirmedBy: "123456789012345678",
          context: { a: 1, b: 3 },
        }),
      { code: "DECISION_ID_CONFLICT" },
      "canonicalisation must not erase a real content difference",
    );
  });
});
