// M12/T9 F-394 (legacy R9-L02-2): the task-level WORKFLOW_RESULT_RECORDED arm
// whitelisted technical_status and business_status and then wrote NEITHER, so
// a FAIL/FAIL result left no outcome anywhere in the durable projection and a
// later ACCEPT derived COMPLETE (resolveAcceptedOutcome found nothing
// recorded). The arm now persists the derived outcome in the OPTIONAL
// execution_outcome_status slot and the verdict derivation reads it.
//
// MEASURED AT HEAD: replaying the plugin's own shipped payload with
// technical_status FAIL / business_status FAIL persisted no outcome and the
// ACCEPT closed the task COMPLETE — both assertions below were red.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveApprovalPlanDigest,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const RESULT_DIGEST = "c".repeat(64);

function openedPayload() {
  const base = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-1",
    root_run_id: "run-1",
  };
  return { ...base, task_id: deriveTaskId(base) };
}

function node() {
  return {
    node_id: "node-excel",
    agent_id: "excel",
    stack_id: "data_plant",
    dependencies: [],
    required: false,
    input_digest: "1".repeat(64),
    constraints_digest: "2".repeat(64),
    validation_digest: "3".repeat(64),
  };
}

// Drives a task to EXECUTING and records a task-level result with the given
// gate statuses — the exact payload shape the plugin ships (index.mjs:3093).
function pendingResult(statuses) {
  const opened = openedPayload();
  let snapshot = applyWorkflowEvent(
    { tasks: {}, sequence: 0 },
    "WORKFLOW_OPENED",
    opened,
  );
  snapshot = applyWorkflowEvent(snapshot, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: opened.task_id,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: [node()],
  });
  const planDigest = deriveApprovalPlanDigest({
    brief_revision: 1,
    nodes: snapshot.tasks[opened.task_id].nodes,
  });
  snapshot = applyWorkflowEvent(snapshot, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: opened.task_id,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
    scope_digest: planDigest,
    brief_revision: 1,
  });
  snapshot = applyWorkflowEvent(snapshot, "WORKFLOW_TASK_CLAIMED", {
    task_id: opened.task_id,
    agent_id: "main",
  });
  snapshot = applyWorkflowEvent(snapshot, "WORKFLOW_RESULT_RECORDED", {
    task_id: opened.task_id,
    payload_digest: RESULT_DIGEST,
    ...statuses,
    recorded_at: new Date().toISOString(),
  });
  assert.equal(
    snapshot.tasks[opened.task_id].workflow_status,
    "RESULT_PENDING_REVIEW",
  );
  return { opened, snapshot };
}

function accept(opened, snapshot) {
  return applyWorkflowEvent(snapshot, "WORKFLOW_USER_RESULT_ACCEPTED", {
    task_id: opened.task_id,
    actor: "user",
    channel: "results",
    decision: "ACCEPT",
    result_digest: RESULT_DIGEST,
  });
}

describe("M12/T9 F-394 - a task-level result persists its outcome", () => {
  it("persists FAILED for a FAIL/FAIL result and ACCEPT yields FAILED", () => {
    const { opened, snapshot } = pendingResult({
      technical_status: "FAIL",
      business_status: "FAIL",
    });
    // HEAD: undefined — the whitelisted members were dropped.
    assert.equal(
      snapshot.tasks[opened.task_id].execution_outcome_status,
      "FAILED",
      "the outcome the owner is asked to accept is durable state",
    );
    const accepted = accept(opened, snapshot);
    // HEAD: COMPLETE.
    assert.equal(accepted.tasks[opened.task_id].workflow_status, "FAILED");
    assert.equal(accepted.tasks[opened.task_id].brief_state, "CLOSED");
  });

  it("persists FAILED when either gate fails", () => {
    for (const statuses of [
      { technical_status: "PASS", business_status: "FAIL" },
      { technical_status: "FAIL", business_status: "PASS" },
      { technical_status: "FAIL" },
      { business_status: "FAIL" },
    ]) {
      const { opened, snapshot } = pendingResult(statuses);
      assert.equal(
        snapshot.tasks[opened.task_id].execution_outcome_status,
        "FAILED",
        `a FAIL on any gate is a FAILED outcome: ${JSON.stringify(statuses)}`,
      );
      assert.equal(
        accept(opened, snapshot).tasks[opened.task_id].workflow_status,
        "FAILED",
      );
    }
  });

  it("persists COMPLETE for a PASS/PASS result and ACCEPT yields COMPLETE", () => {
    const { opened, snapshot } = pendingResult({
      technical_status: "PASS",
      business_status: "PASS",
    });
    assert.equal(
      snapshot.tasks[opened.task_id].execution_outcome_status,
      "COMPLETE",
    );
    assert.equal(
      accept(opened, snapshot).tasks[opened.task_id].workflow_status,
      "COMPLETE",
    );
  });

  it("keeps a status-less legacy result on the legacy COMPLETE fallback", () => {
    const { opened, snapshot } = pendingResult({});
    assert.equal(
      "execution_outcome_status" in snapshot.tasks[opened.task_id],
      false,
      "no status means no derived outcome: an old journal never changes meaning",
    );
    assert.equal(
      accept(opened, snapshot).tasks[opened.task_id].workflow_status,
      "COMPLETE",
    );
  });

  it("refuses a status outside the PASS/FAIL vocabulary", () => {
    assert.throws(
      () =>
        pendingResult({
          technical_status: "MOSTLY_FINE",
          business_status: "PASS",
        }),
      /SCHEMA_INVALID/u,
    );
  });

  it("an ACCEPT naming the recorded outcome cannot re-label it", () => {
    const { opened, snapshot } = pendingResult({
      technical_status: "FAIL",
      business_status: "FAIL",
    });
    // F-406/F-226 binding, now reachable for task-level results too: a
    // decision that CLAIMS COMPLETE against a recorded FAILED is refused.
    assert.throws(
      () =>
        applyWorkflowEvent(snapshot, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: opened.task_id,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
          result_digest: RESULT_DIGEST,
          outcome_status: "COMPLETE",
        }),
      /RESULT_MISMATCH/u,
    );
  });
});
