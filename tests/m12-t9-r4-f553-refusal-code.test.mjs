/**
 * M12/T9-R4 F-553 (R10-T06-5) — L5 lane half.
 *
 * The queue-claim seam classified refusals ONLY by regex over
 * `claimErr.message`, so a reword of a producer line silently changed the
 * owner-visible class, and the producers threw plain Errors whose code lived
 * only in the message prefix. This lane's half:
 *
 *  1. both classifiable refusals in `queue-manager.mjs` (`claimTaskById`'s
 *     CONCURRENT_CLAIM_DENIED and INVALID_STATE_TRANSITION arms) carry `code`
 *     as a member;
 *  2. `coordinator-pickup.mjs` tests `code` FIRST and keeps the message
 *     substring match only for foreign errors that carry no code.
 *
 * The remaining F-553 sites (the ordered-list assertions and code-first
 * `classifyRefusal` in topology/fixtures/runtime-regression/refusal-classifier.mjs
 * and operator-preflight.mjs — lanes L6/L7; artifact-validator.mjs:189 — lane
 * L8; index.mjs:1385-1392 — lane L4) are reported, not implemented here.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { runCoordinatorPickup } from "../integrations/openclaw/lib/coordinator-pickup.mjs";
import { deriveGovernedDispatchTarget } from "../integrations/openclaw/lib/policy.mjs";

function freshQueue() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f553-"));
  const qm = new QueueManager({
    storagePath: path.join(dir, "task-queue.json"),
  });
  return {
    qm,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function enqueueO1(qm, taskId) {
  return qm.enqueueTask({
    taskId,
    planVersion: "1.0",
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel"],
    payload: { brief: "f553 refusal codes" },
  });
}

function ledgerTask() {
  return {
    workflow_status: "QUEUED",
    primary_coordinator: "o1",
    brief_revision: 1,
    nodes: [{ node_id: "node-excel", agent_id: "excel" }],
    payload: { brief: "f553 refusal codes" },
  };
}

// ===========================================================================
// Producer half: the refusals carry their code as a member
// ===========================================================================

test("F-553: CONCURRENT_CLAIM_DENIED refusal carries code as a member", () => {
  const { qm, cleanup } = freshQueue();
  try {
    const taskId = "f553-concurrent";
    enqueueO1(qm, taskId);
    qm.claimTaskById({ taskId, agentId: "o1" });
    assert.throws(
      () => qm.claimTaskById({ taskId, agentId: "o2" }),
      (err) =>
        err instanceof Error &&
        err.code === "CONCURRENT_CLAIM_DENIED" &&
        /CONCURRENT_CLAIM_DENIED/u.test(err.message),
      "the refusal must set error.code without changing its message",
    );
  } finally {
    cleanup();
  }
});

test("F-553: INVALID_STATE_TRANSITION refusal carries code as a member", () => {
  const { qm, cleanup } = freshQueue();
  try {
    const taskId = "f553-invalid-state";
    enqueueO1(qm, taskId);
    // Drive the projection to a terminal state through the stored record;
    // withLock reloads from disk, so the change must be persisted.
    qm.queue.get(taskId).status = "COMPLETE";
    qm.save();
    assert.throws(
      () => qm.claimTaskById({ taskId, agentId: "o1" }),
      (err) =>
        err instanceof Error &&
        err.code === "INVALID_STATE_TRANSITION" &&
        /INVALID_STATE_TRANSITION/u.test(err.message),
      "the refusal must set error.code without changing its message",
    );
  } finally {
    cleanup();
  }
});

// ===========================================================================
// Consumer half: coordinator-pickup classifies by code first
// ===========================================================================

function pickupWithClaimError(error, taskId) {
  const stubQueueManager = {
    getTask: () => ({ taskId, status: "QUEUED", primaryCoordinator: "o1" }),
    claimTaskById: () => {
      throw error;
    },
  };
  return runCoordinatorPickup({
    queueManager: stubQueueManager,
    ledgerTasks: { [taskId]: ledgerTask() },
    deriveTarget: deriveGovernedDispatchTarget,
    recordClaimed: async () => {},
    startCoordinatorRun: async (bundle) => ({
      runId: `run-${bundle.taskId}`,
      sessionKey: `agent:${bundle.coordinator}:${bundle.taskId}`,
      agentId: bundle.coordinator,
    }),
    taskId,
  });
}

test("F-553: pickup classifies a reworded CONCURRENT_CLAIM_DENIED by code", async () => {
  const reworded = new Error("another lane already holds this claim");
  reworded.code = "CONCURRENT_CLAIM_DENIED";
  const result = await pickupWithClaimError(reworded, "f553-reworded-ccd");
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "PICKUP_ALREADY_CLAIMED",
    "code must classify even when the message prose no longer carries it",
  );
});

test("F-553: pickup classifies a reworded INVALID_STATE_TRANSITION by code", async () => {
  const reworded = new Error("the projection moved under the claimant");
  reworded.code = "INVALID_STATE_TRANSITION";
  const result = await pickupWithClaimError(reworded, "f553-reworded-ist");
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    "PICKUP_ALREADY_CLAIMED",
    "code must classify even when the message prose no longer carries it",
  );
});

test("F-553: pickup keeps substring classification for foreign code-less errors", async () => {
  // A foreign producer that only prefixes the message must still classify:
  // substring matching is retained exactly for errors that carry no `code`.
  const foreign = new Error(
    "CONCURRENT_CLAIM_DENIED: Task f553-foreign is already claimed by o9",
  );
  const result = await pickupWithClaimError(foreign, "f553-foreign");
  assert.equal(result.ok, false);
  assert.equal(result.error, "PICKUP_ALREADY_CLAIMED");

  const unclassified = new Error("storage exploded");
  const fallback = await pickupWithClaimError(
    unclassified,
    "f553-unclassified",
  );
  assert.equal(fallback.ok, false);
  assert.equal(fallback.error, "PICKUP_CLAIM_FAILED");
  assert.equal(fallback.cause, "storage exploded");
});
