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

import {
  DecisionLedger,
  canonicalDecisionKey,
} from "../integrations/openclaw/lib/decision-ledger.mjs";

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

  it("F-OC-005: concurrent conflicting DecisionLedger save under writer lock is refused with DECISION_ID_CONFLICT", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "f-oc-005-"));
    const storagePath = path.join(dir, "ledger.json");
    const ledger1 = new DecisionLedger({ storagePath });
    const ledger2 = new DecisionLedger({ storagePath });

    // Two instances refresh an empty ledger
    ledger1.refresh();
    ledger2.refresh();

    const topic = "DEPLOY";
    const question = "Which region?";
    const scope = "global";
    const confirmedBy = "123456789012345678";
    const id = "dec-" + canonicalDecisionKey({ topic, question, scope }).slice(0, 16);

    // Create different decisions with identical topic/question/scope (yielding same ID)
    ledger1.decisions.set(id, {
      decisionId: id,
      topic,
      question,
      decision: "us-east-1",
      scope,
      confirmedBy,
      confirmedAt: new Date().toISOString(),
      context: {},
      tags: [],
    });

    ledger2.decisions.set(id, {
      decisionId: id,
      topic,
      question,
      decision: "eu-west-1",
      scope,
      confirmedBy,
      confirmedAt: new Date().toISOString(),
      context: {},
      tags: [],
    });

    // Save instance 1 (succeeds)
    ledger1.save();
    assert.equal(ledger1.getDecision(id)?.decision, "us-east-1");

    // Save instance 2 (refused with DECISION_ID_CONFLICT)
    assert.throws(
      () => ledger2.save(),
      { code: "DECISION_ID_CONFLICT" },
      "saving conflicting decision content under existing ID must throw DECISION_ID_CONFLICT",
    );

    // Existing durable record on disk is preserved and not overwritten
    const fresh = new DecisionLedger({ storagePath }).refresh();
    assert.equal(fresh.getDecision(id)?.decision, "us-east-1");
  });
});
