// M12/T9 F-002 (R1-A02-07): two decision/queue stores with two roots, and a
// load-once in-memory singleton used as live authority.
//
// The two stores used to answer from a home-directory default while the ledger
// event journal lived under the configured `ledgerRoot`, and their in-memory
// map was filled ONCE at import: a second writer's decision was invisible to
// the first, and the first's save replaced the second's whole decision set.
//
// The store root is PROCESS-GLOBAL, so the refusal case is declared FIRST: once
// a root is configured, an unconfigured store can no longer be observed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";
import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { configureGovernedStoreRoot } from "../integrations/openclaw/lib/policy.mjs";

const PRINCIPAL = "a".repeat(64);

function tempRoot(label) {
  return mkdtempSync(path.join(os.tmpdir(), `f002-${label}-`));
}

test("F-002: an unconfigured store refuses by name instead of guessing a path", () => {
  assert.throws(
    () => new QueueManager().getTask("x"),
    { code: "GOVERNANCE_STORE_ROOT_UNCONFIGURED" },
    "an unconfigured queue store must refuse by name, never guess a home-directory root",
  );
  assert.throws(
    () => new DecisionLedger().listAll(),
    { code: "GOVERNANCE_STORE_ROOT_UNCONFIGURED" },
    "an unconfigured decision store must refuse by name, never guess a home-directory root",
  );
});

test("F-002: neither store reaches for a home-directory root", () => {
  for (const relative of [
    "integrations/openclaw/lib/queue-manager.mjs",
    "integrations/openclaw/lib/decision-ledger.mjs",
  ]) {
    const src = readFileSync(
      new URL(`../${relative}`, import.meta.url),
      "utf8",
    );
    assert.equal(
      /\bhomedir\b/u.test(src),
      false,
      `${relative} must not reach for a home-directory root`,
    );
  }
});

test("F-002: both stores resolve the ONE configured governance root", () => {
  const root = tempRoot("root");
  configureGovernedStoreRoot(root);
  assert.equal(
    new QueueManager().storagePath,
    path.join(root, "task-queue.json"),
  );
  assert.equal(
    new DecisionLedger().storagePath,
    path.join(root, "decision-ledger.json"),
  );
});

test("F-002: a read answers from the durable file, not from the map filled at construction", () => {
  const root = tempRoot("read");
  configureGovernedStoreRoot(root);

  // The readers are constructed BEFORE the writers commit anything.
  const queueReader = new QueueManager();
  const ledgerReader = new DecisionLedger();

  const queueWriter = new QueueManager();
  queueWriter.enqueueTask({
    taskId: "t1",
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel"],
    payload: { note: "first" },
  });

  const ledgerWriter = new DecisionLedger();
  ledgerWriter.recordDecision({
    decisionId: "d1",
    topic: "LSCM",
    question: "is the durable set visible?",
    decision: "yes",
    scope: "global",
    confirmedBy: PRINCIPAL,
  });

  assert.equal(
    queueReader.getTask("t1")?.status,
    "QUEUED",
    "the queue reader must answer from the durable file",
  );
  assert.notEqual(
    ledgerReader.getDecision("d1"),
    null,
    "the decision reader must answer from the durable file",
  );
});

test("F-002: a second writer's decision is not replaced by the first's save", () => {
  const root = tempRoot("merge");
  configureGovernedStoreRoot(root);

  const first = new DecisionLedger();
  first.recordDecision({
    decisionId: "d-first",
    topic: "LSCM",
    question: "first question",
    decision: "yes",
    scope: "global",
    confirmedBy: PRINCIPAL,
  });

  const second = new DecisionLedger();
  second.recordDecision({
    decisionId: "d-second",
    topic: "TAXONOMY",
    question: "second question",
    decision: "yes",
    scope: "global",
    confirmedBy: PRINCIPAL,
  });

  const durable = JSON.parse(
    readFileSync(path.join(root, "decision-ledger.json"), "utf8"),
  );
  assert.equal(
    durable.length,
    2,
    "the durable set must hold BOTH writers' decisions",
  );
});
