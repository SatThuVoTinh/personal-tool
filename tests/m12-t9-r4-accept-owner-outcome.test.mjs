// M12/T9-R4 — the ACCEPT seam, end to end.
//
//   F-402 (legacy R9-L04-2): the production enqueue projected no owner and the
//   two ACCEPT presenters handed the queue a raw Discord snowflake, so
//   completeTask refused every owner ACCEPT (first OWNER_PRINCIPAL_REQUIRED,
//   then USER_PRINCIPAL_MISMATCH).
//   F-405 (legacy R9-T02-2): the queue advance that follows the durable ledger
//   ACCEPT was a caught log line, so the ledger could reach its terminal state
//   while the queue stayed in review for ever.
//   F-406 (legacy R9-T02-3): completeTask wrote COMPLETE unconditionally, so an
//   accepted PARTIAL/FAILED/BLOCKED outcome was recorded as a completed task.
//
// Every lane registers the REAL plugin, drives the REAL text handler as the
// owner, and reads the REAL queue projection: calling `qm.completeTask`
// directly is exactly the gap these rows are about.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { defaultQueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import {
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  RESULTS_CHANNEL_ID,
  RESULTS_THREAD_ID,
  briefNode,
  registerGovernancePlugin,
  seedGovernedTask,
  sendOwnerText,
  waitFor,
  waitForQueueTask,
  withGovernanceState,
} from "./helpers/governance-plugin-flow.mjs";

const ROOT_DIGEST = "2".repeat(64);

// The coordinator node is REQUIRED (the reducer derives the task's owner from
// required nodes only); the specialist is optional, so nothing here needs a
// spawned child to be satisfied.
const REVIEW_NODES = [
  briefNode({
    nodeId: "n1",
    agentId: "o1",
    stackId: "data_plant",
    required: true,
  }),
  briefNode({
    nodeId: "n2",
    agentId: "excel",
    stackId: "data_plant",
    required: false,
  }),
];

const REASON_FOR = {
  COMPLETE: "NONE",
  PARTIAL: "OPTIONAL_BRANCH_FAILED",
  FAILED: "RETRY_EXHAUSTED",
};

function rootResult(taskId, outcome) {
  return {
    task_id: taskId,
    brief_revision: 1,
    native_run_id: "main-run",
    agent_id: "main",
    payload_digest: ROOT_DIGEST,
    outcome_status: outcome,
    reason_code: REASON_FOR[outcome],
    governance_hash: governanceHash("main"),
  };
}

/**
 * Drive the production APPROVE leg, then park the task in review exactly as
 * the execution lane does: claim, ledger claim, result, queue finish.
 *
 * A COMPLETE outcome uses the coordinator's own task-level result
 * (`WORKFLOW_RESULT_RECORDED` with no envelope). A COMPLETE *root* result is
 * only admissible once every required node's child run is COMPLETE (D19), which
 * is the execution plane's work and not this lane's subject; the task-level
 * result is the other production path, and an ACCEPT against it resolves to
 * COMPLETE. A non-COMPLETE outcome can only be carried by the root result.
 */
async function approvedIntoReview(paths, { outcome = "COMPLETE" } = {}) {
  const { taskId, originPrincipalRef } = seedGovernedTask(paths, {
    nodes: REVIEW_NODES,
  });
  const { hooks, logs } = registerGovernancePlugin(paths);
  await sendOwnerText(hooks, { text: `APPROVE ${taskId}` });
  const queued = await waitForQueueTask(taskId);
  assert.ok(
    queued,
    `the approved task must be queued; plugin logged ${JSON.stringify(logs)}`,
  );
  assert.equal(queued.status, "QUEUED");

  const claim = defaultQueueManager.claimTask({
    agentId: "o1",
    capabilities: ["excel"],
  });
  assert.equal(claim.claimed, true, "the coordinator must claim the item");
  recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: taskId,
    agent_id: "o1",
  });
  if (outcome === "COMPLETE") {
    recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", { task_id: taskId });
  } else {
    recordWorkflowEvent(
      paths,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      rootResult(taskId, outcome),
    );
  }
  assert.equal(
    readSnapshot(paths).tasks[taskId].workflow_status,
    "RESULT_PENDING_REVIEW",
  );
  assert.equal(
    defaultQueueManager.finishExecution({
      taskId,
      agentId: "o1",
      leaseId: claim.leaseId,
      attempt: claim.task.attempt,
      resultSummary: `root result ${outcome}`,
    }).status,
    "RESULT_PENDING_REVIEW",
  );
  return { taskId, originPrincipalRef, queued, hooks, logs };
}

/** The owner's own text ACCEPT, in the results surface the card lives in. */
async function acceptResult(hooks, taskId) {
  await sendOwnerText(hooks, {
    text: `ACCEPT ${taskId}`,
    channelId: RESULTS_CHANNEL_ID,
    threadId: RESULTS_THREAD_ID,
  });
  return waitFor(() => {
    const item = defaultQueueManager.getTask(taskId);
    return item && item.status !== "RESULT_PENDING_REVIEW" ? item : null;
  });
}

describe("M12/T9 F-402/F-405/F-406 — the plugin-driven ACCEPT reaches the queue", () => {
  it("F-402: the production enqueue projects the ledger owner principal", async () => {
    await withGovernanceState("accept-owner", async ({ paths }) => {
      const { originPrincipalRef, queued } = await approvedIntoReview(paths);
      assert.match(originPrincipalRef, /^[a-f0-9]{64}$/u);
      assert.equal(
        queued.ownerPrincipalRef,
        originPrincipalRef,
        "the queue must carry the principal the ledger projected, not null",
      );
    });
  });

  it("F-402: the owner's own ACCEPT satisfies the queue's principal guard", async () => {
    await withGovernanceState("accept-complete", async ({ paths }) => {
      const { taskId, originPrincipalRef, hooks, logs } =
        await approvedIntoReview(paths);

      const completed = await acceptResult(hooks, taskId);
      assert.ok(
        completed,
        `the ACCEPT must advance the queue; plugin logged ${JSON.stringify(logs)}`,
      );
      assert.equal(completed.status, "COMPLETE");
      assert.equal(
        completed.completedBy,
        originPrincipalRef,
        "the queue records the ledger-minted principal, not a snowflake",
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "COMPLETE",
      );
    });
  });

  it("F-406: an accepted PARTIAL outcome is written as PARTIAL, never COMPLETE", async () => {
    await withGovernanceState("accept-partial", async ({ paths }) => {
      const { taskId, hooks, logs } = await approvedIntoReview(paths, {
        outcome: "PARTIAL",
      });

      const completed = await acceptResult(hooks, taskId);
      assert.ok(
        completed,
        `the ACCEPT must advance the queue; plugin logged ${JSON.stringify(logs)}`,
      );
      assert.equal(
        completed.status,
        "PARTIAL",
        "the queue terminal state must be the accepted outcome",
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "PARTIAL",
        "the queue and the ledger must agree on the accepted outcome",
      );
    });
  });

  it("F-405: a queue advance that fails is reconciled from the ledger on the same path", async () => {
    await withGovernanceState("accept-reconcile", async ({ paths }) => {
      const { taskId, originPrincipalRef, hooks, logs } =
        await approvedIntoReview(paths, { outcome: "PARTIAL" });
      // Force the queue-side write to fail exactly as F-402 did in production:
      // the projection's owner no longer matches the ledger's owner.
      const item = defaultQueueManager.getTask(taskId);
      item.ownerPrincipalRef = "e".repeat(64);
      defaultQueueManager.save();

      const repaired = await acceptResult(hooks, taskId);
      assert.ok(
        repaired,
        `the ACCEPT must reconcile the projection; plugin logged ${JSON.stringify(logs)}`,
      );
      assert.equal(
        repaired.status,
        "PARTIAL",
        "the reconciled queue state is the ledger's accepted outcome",
      );
      assert.equal(
        repaired.ownerPrincipalRef,
        originPrincipalRef,
        "the reconciliation restores the ledger's authoritative owner",
      );
      assert.ok(
        logs.some((line) => /reconcil/iu.test(line)),
        `the repair is reported, not silent: ${JSON.stringify(logs)}`,
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "PARTIAL",
      );
    });
  });
});
