import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DecisionLedger,
  canonicalDecisionKey,
} from "../integrations/openclaw/lib/decision-ledger.mjs";

function freshLedger() {
  const dir = mkdtempSync(path.join(tmpdir(), "lane-d-"));
  return new DecisionLedger({ storagePath: path.join(dir, "ledger.json") });
}

describe("Lane D — decision ledger authority (M7-022/023/033/070)", () => {
  it("M7-022: corrupt ledger blocks lookups instead of reading as empty", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lane-d-"));
    const storagePath = path.join(dir, "ledger.json");
    writeFileSync(storagePath, "{ malformed json", "utf8");
    const ledger = new DecisionLedger({ storagePath });
    assert.equal(ledger.corrupt, true);
    assert.throws(() => ledger.queryDecisions({ topic: "X" }), {
      code: "LEDGER_CORRUPT",
    });
    assert.throws(() => ledger.hasDecision("X", "y"), {
      code: "LEDGER_CORRUPT",
    });
  });

  it("M7-023: save failure surfaces instead of false success", () => {
    const ledger = freshLedger();
    ledger.storagePath = path.join(
      tmpdir(),
      "lane-d-no-such-dir-should-fail",
      "\0invalid",
      "ledger.json",
    );
    assert.throws(
      () =>
        ledger.recordDecision({
          topic: "T",
          decision: "D",
          confirmedBy: "123456789012345678",
        }),
      /LEDGER_WRITE_FAILED/,
    );
    assert.equal(ledger.getDecision("whatever"), null);
  });

  it("M7-033: invalid scope and task-scope without identity are rejected", () => {
    const ledger = freshLedger();
    assert.throws(
      () =>
        ledger.recordDecision({
          topic: "T",
          decision: "D",
          confirmedBy: "123456789012345678",
          scope: "universe",
        }),
      /DECISION_SCOPE_INVALID/,
    );
    assert.throws(
      () =>
        ledger.recordDecision({
          topic: "T",
          decision: "D",
          confirmedBy: "123456789012345678",
          scope: "task-specific",
          context: {},
        }),
      /DECISION_TASK_IDENTITY_REQUIRED/,
    );
    const rec = ledger.recordDecision({
      topic: "T",
      decision: "D",
      confirmedBy: "123456789012345678",
      scope: "GLOBAL",
      context: {},
    });
    assert.equal(rec.scope, "global");
  });

  it("M7-070: same decisionId with different content conflicts, replay is idempotent", () => {
    const ledger = freshLedger();
    const first = ledger.recordDecision({
      decisionId: "D1",
      topic: "T",
      question: "Q",
      decision: "yes",
      confirmedBy: "123456789012345678",
    });
    const replay = ledger.recordDecision({
      decisionId: "D1",
      topic: "T",
      question: "Q",
      decision: "yes",
      confirmedBy: "123456789012345678",
    });
    assert.equal(replay.decisionId, "D1");
    assert.throws(
      () =>
        ledger.recordDecision({
          decisionId: "D1",
          topic: "T",
          question: "Q",
          decision: "no — changed",
          confirmedBy: "123456789012345678",
        }),
      { code: "DECISION_ID_CONFLICT" },
    );
    assert.equal(ledger.getDecision("D1").decision, first.decision);
  });

  it("M7-027: queue load rebuilds instead of merging stale entries", async () => {
    const { QueueManager } =
      await import("../integrations/openclaw/lib/queue-manager.mjs");
    const dir = mkdtempSync(path.join(tmpdir(), "lane-d-q-"));
    const storagePath = path.join(dir, "task-queue.json");
    const qm = new QueueManager({ storagePath });
    qm.enqueueTask({
      taskId: "t-keep",
      primaryCoordinator: "o1",
      requiredCapabilities: [],
      payload: {},
    });
    qm.enqueueTask({
      taskId: "t-drop",
      primaryCoordinator: "o1",
      requiredCapabilities: [],
      payload: {},
    });
    writeFileSync(
      storagePath,
      JSON.stringify([
        {
          taskId: "t-keep",
          status: "QUEUED",
          primaryCoordinator: "o1",
          requiredCapabilities: [],
          payload: {},
          history: [],
        },
      ]),
      "utf8",
    );
    qm.load();
    assert.equal(qm.getTask("t-keep")?.taskId, "t-keep");
    assert.equal(qm.getTask("t-drop"), null);
  });

  it("M7-034: arbitrary principal strings are rejected", () => {
    const ledger = freshLedger();
    for (const fake of ["user-1", "fake-user", "", null, "owner", "85400"]) {
      assert.throws(
        () =>
          ledger.recordDecision({
            topic: "T",
            decision: "D",
            confirmedBy: fake,
          }),
        /HUMAN_CONFIRMATION_REQUIRED/,
      );
    }
    const rec = ledger.recordDecision({
      topic: "T",
      decision: "D",
      confirmedBy: "123456789012345678",
    });
    assert.equal(rec.confirmedBy, "123456789012345678");
    const digestRec = ledger.recordDecision({
      decisionId: "dig-1",
      topic: "T",
      decision: "D2",
      confirmedBy: "c".repeat(64),
    });
    assert.equal(digestRec.confirmedBy, "c".repeat(64));
  });

  it("M7-035: scope containment — task decisions never leak across tasks", () => {
    const ledger = freshLedger();
    ledger.recordDecision({
      decisionId: "task-1-dec",
      topic: "T",
      question: "Which baseline?",
      decision: "2026 baseline",
      scope: "task-specific",
      confirmedBy: "123456789012345678",
      context: { taskId: "task-1" },
    });
    ledger.recordDecision({
      decisionId: "glob-1",
      topic: "T",
      question: "Which currency?",
      decision: "VND",
      scope: "global",
      confirmedBy: "123456789012345678",
    });
    assert.equal(
      ledger.hasDecision("T", "Which baseline?", {
        scope: "task-specific",
        taskId: "task-2",
      }),
      false,
    );
    assert.equal(
      ledger.hasDecision("T", "Which baseline?", {
        scope: "task-specific",
        taskId: "task-1",
      }),
      true,
    );
    assert.equal(ledger.hasDecision("T", "Which currency?"), true);
  });

  it("M7-036: near-collision and different-question queries never match", () => {
    const ledger = freshLedger();
    ledger.recordDecision({
      topic: "TAX",
      question: "What is the VAT rate?",
      decision: "10 percent",
      confirmedBy: "123456789012345678",
    });
    assert.equal(ledger.hasDecision("TAX", "VAT"), false);
    assert.equal(ledger.hasDecision("TAX", "What is the CIT rate?"), false);
    assert.equal(ledger.hasDecision("TAX", "What is the VAT rate?"), true);
    assert.equal(ledger.hasDecision("TAX", "  what IS the vat RATE?  "), true);
  });

  it("M7-017: prior global decision suppresses duplicate clarification", () => {
    const ledger = freshLedger();
    assert.deepEqual(
      ledger.shouldClarify({ topic: "T", question: "Proceed?" }).ask,
      true,
    );
    ledger.recordDecision({
      topic: "T",
      question: "Proceed?",
      decision: "Yes, proceed",
      confirmedBy: "123456789012345678",
    });
    const held = ledger.shouldClarify({ topic: "T", question: "Proceed?" });
    assert.equal(held.ask, false);
    assert.equal(held.decision.decision, "Yes, proceed");
    // Task-scoped question is not covered by the global decision above.
    assert.equal(
      ledger.shouldClarify({
        topic: "T",
        question: "Proceed?",
        scope: "task-specific",
        taskId: "task-9",
      }).ask,
      true,
    );
  });
});

// M12/T9 F-345: the contract declared one deterministic id rule and the store
// enforced another. The contract now states the enforced rule, including the
// 12-hex chain prefix, and this pins it against the store instead of against
// an id the caller passed in.
describe("M12/T9 F-345 - the documented id derivation is the enforced one", () => {
  const OWNER = "123456789012345678";

  it("derives dec-<16 hex of the governed key> when the caller supplies no id", () => {
    const ledger = freshLedger();
    const key = canonicalDecisionKey({
      topic: "T",
      question: "Q",
      scope: "global",
      taskId: null,
      domain: null,
    });
    const record = ledger.recordDecision({
      topic: "T",
      question: "Q",
      decision: "yes",
      confirmedBy: OWNER,
      scope: "global",
    });
    assert.equal(record.decisionId, `dec-${key.slice(0, 16)}`);
    assert.match(record.decisionId, /^dec-[0-9a-f]{16}$/u);
  });

  it("gives a chain generation the documented 12-hex prefix and the generation number", () => {
    const ledger = freshLedger();
    const key = canonicalDecisionKey({
      topic: "T",
      question: "Q",
      scope: "global",
      taskId: null,
      domain: null,
    });
    ledger.recordDecision({
      topic: "T",
      question: "Q",
      decision: "yes",
      confirmedBy: OWNER,
      scope: "global",
    });
    const corrected = ledger.correctDecision({
      topic: "T",
      question: "Q",
      decision: "no",
      confirmedBy: OWNER,
      scope: "global",
    });
    assert.equal(corrected.decisionId, `dec-${key.slice(0, 12)}-s2`);
    assert.match(corrected.decisionId, /^dec-[0-9a-f]{12}-s\d+$/u);
  });

  it("states the same rule in the contract, so the two cannot drift", () => {
    const contract = readFileSync(
      new URL("../docs/contracts/decision-ledger.md", import.meta.url),
      "utf8",
    );
    assert.match(
      contract,
      /dec-<first 16 hex of the\s+governed key>/u,
      "the contract must state the root derivation",
    );
    assert.match(
      contract,
      /dec-<first 12 hex of the governed key>-s<n>/u,
      "the contract must state the chain prefix and its length",
    );
    assert.match(
      contract,
      /explicit `decisionId`/u,
      "the contract must state whether a caller may supply the id",
    );
  });

  it("uses a caller-supplied id verbatim, as the contract states", () => {
    const ledger = freshLedger();
    const record = ledger.recordDecision({
      decisionId: "D1",
      topic: "T",
      question: "Q",
      decision: "yes",
      confirmedBy: OWNER,
    });
    assert.equal(record.decisionId, "D1");
  });
});

describe("M12/T9 F-260 — a post-rename durability error must not erase a recorded decision", () => {
  it("F-260: the committed record survives, and memory equals disk", () => {
    // M12/T9 F-260: the directory fsync AFTER the rename used to be rethrown
    // as a write failure. The caller then restored its pre-write in-memory
    // state, which is BEHIND a disk that already held the record, and the
    // next successful save serialised that stale map over the owner's
    // decision — the inverse of "recorded when the write failed".
    const dir = mkdtempSync(path.join(tmpdir(), "lane-d-f260-"));
    const storagePath = path.join(dir, "ledger.json");
    const ledger = new DecisionLedger({
      storagePath,
      directoryFsync: () => {
        const error = new Error("injected directory fsync failure");
        error.code = "EIO";
        throw error;
      },
    });

    assert.throws(
      () =>
        ledger.recordDecision({
          topic: "T",
          decision: "D",
          confirmedBy: "123456789012345678",
        }),
      /LEDGER_COMMIT_UNCERTAIN/,
    );

    // The record SURVIVED on disk ...
    const onDisk = JSON.parse(readFileSync(storagePath, "utf8"));
    assert.equal(onDisk.length, 1, "the committed record must be on disk");
    assert.equal(onDisk[0].decision, "D");

    // ... and memory equals disk.
    assert.equal(ledger.listAll().length, 1);
    assert.equal(ledger.listAll()[0].decision, "D");

    // And the NEXT save does not erase it.
    ledger.directoryFsync = null;
    ledger.recordDecision({
      topic: "T2",
      decision: "D2",
      confirmedBy: "123456789012345678",
    });
    const after = JSON.parse(readFileSync(storagePath, "utf8"));
    assert.equal(after.length, 2, "the earlier record must still be there");
    assert.ok(
      after.some((entry) => entry.decision === "D"),
      "the earlier decision must not be erased by the next save",
    );
  });
});
