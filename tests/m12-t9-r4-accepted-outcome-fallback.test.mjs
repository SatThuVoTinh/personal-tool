// M12/T9 F-393 (legacy R9-L02-1): a verdict that names no outcome must follow
// the outcome the ledger RECORDED. The only ACCEPT emitter in production sends
// result_digest/message_id/thread_id and no outcome_status, so the reducer's
// silent branch is the production branch: it used to stamp COMPLETE over a
// recorded FAILED and close the brief on a run the ledger itself called failed.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveApprovalPlanDigest,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const DIGEST = "c".repeat(64);
const GOVERNANCE_HASH = "d".repeat(64);

function openedPayload(overrides = {}) {
  const base = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-1",
    root_run_id: "run-1",
    ...overrides,
  };
  return { ...base, task_id: deriveTaskId(base) };
}

function node(nodeId, agentId) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: "data_plant",
    dependencies: [],
    required: false,
    input_digest: "1".repeat(64),
    constraints_digest: "2".repeat(64),
    validation_digest: "3".repeat(64),
  };
}

function openedWithBrief() {
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
    nodes: [node("node-excel", "excel")],
  });
  return { opened, snapshot };
}

const REASON_BY_OUTCOME = {
  COMPLETE: "NONE",
  PARTIAL: "OPTIONAL_BRANCH_FAILED",
  BLOCKED: "OWNER_DECISION_REQUIRED",
  FAILED: "RUN_TIMEOUT",
};

function rootResult(opened, outcome) {
  return {
    task_id: opened.task_id,
    brief_revision: 1,
    native_run_id: "run-1",
    agent_id: "main",
    payload_digest: DIGEST,
    outcome_status: outcome,
    reason_code: REASON_BY_OUTCOME[outcome],
    governance_hash: GOVERNANCE_HASH,
  };
}

function silentAccept(opened) {
  return {
    task_id: opened.task_id,
    actor: "user",
    channel: "results",
    decision: "ACCEPT",
    result_digest: DIGEST,
  };
}

describe("M12/T9 F-393 - a silent verdict follows the recorded outcome", () => {
  for (const outcome of ["FAILED", "PARTIAL", "BLOCKED"]) {
    it(`an ACCEPT with no outcome_status does not turn a recorded ${outcome} into COMPLETE`, () => {
      const { opened, snapshot } = openedWithBrief();
      const reviewed = applyWorkflowEvent(
        snapshot,
        "WORKFLOW_ROOT_RESULT_RECORDED",
        rootResult(opened, outcome),
      );
      assert.equal(
        reviewed.tasks[opened.task_id].workflow_status,
        "RESULT_PENDING_REVIEW",
      );
      const accepted = applyWorkflowEvent(
        reviewed,
        "WORKFLOW_USER_RESULT_ACCEPTED",
        silentAccept(opened),
      );
      assert.equal(
        accepted.tasks[opened.task_id].workflow_status,
        outcome,
        "the verdict must inherit the outcome the ledger recorded",
      );
      assert.equal(
        accepted.tasks[opened.task_id].brief_state,
        outcome === "BLOCKED" ? "ACTIVE" : "CLOSED",
        "a BLOCKED outcome stays recoverable, the other outcomes close the brief",
      );
    });
  }

  it("a silent verdict over a recorded COMPLETE is still COMPLETE", () => {
    const { opened, snapshot } = openedWithBrief();
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      rootResult(opened, "COMPLETE"),
    );
    const accepted = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      silentAccept(opened),
    );
    assert.equal(accepted.tasks[opened.task_id].workflow_status, "COMPLETE");
    assert.equal(accepted.tasks[opened.task_id].brief_state, "CLOSED");
  });

  it("a silent verdict over a result that recorded no outcome keeps the legacy COMPLETE", () => {
    const { opened, snapshot } = openedWithBrief();
    const planDigest = deriveApprovalPlanDigest({
      brief_revision: snapshot.tasks[opened.task_id].brief_revision,
      nodes: snapshot.tasks[opened.task_id].nodes,
    });
    let task = applyWorkflowEvent(snapshot, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: opened.task_id,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
      scope_digest: planDigest,
      brief_revision: 1,
    });
    task = applyWorkflowEvent(task, "WORKFLOW_TASK_CLAIMED", {
      task_id: opened.task_id,
      agent_id: "main",
    });
    // The task-level arm records an outcome nowhere (F-394), so the ledger
    // genuinely holds none and the legacy COMPLETE is the only available answer.
    task = applyWorkflowEvent(task, "WORKFLOW_RESULT_RECORDED", {
      task_id: opened.task_id,
      technical_status: "PASS",
      business_status: "PASS",
      recorded_at: new Date().toISOString(),
    });
    assert.equal(task.tasks[opened.task_id].root_result, undefined);
    const accepted = applyWorkflowEvent(task, "WORKFLOW_USER_RESULT_ACCEPTED", {
      task_id: opened.task_id,
      actor: "user",
      channel: "results",
      decision: "ACCEPT",
    });
    assert.equal(accepted.tasks[opened.task_id].workflow_status, "COMPLETE");
  });
});
