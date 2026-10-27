// M12/T9 F-396 (legacy R9-L02-6): WORKFLOW_RESULT_SURFACED admits a
// `result_digest` and persists nothing, so a second surface of a DIFFERENT
// result on the SAME thread was silently accepted and durable state could not
// say which result the owner was shown.
//
// MEASURED AT HEAD: the arm compared only `thread_id`; replaying two differing
// digests on one thread admitted both. The fix binds the surfaced digest to the
// SAME durable result identity a verdict must name
// (`root_result.payload_digest ?? execution_payload_digest`) and refuses a
// divergence with RESULT_MISMATCH, BEFORE the idempotent same-thread return.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deriveApprovalPlanDigest,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const RECORDED_DIGEST = "c".repeat(64);
const OTHER_DIGEST = "d".repeat(64);
const ROOT_DIGEST = "e".repeat(64);
const THREAD = "444444444444444444";
const OTHER_THREAD = "555555555555555555";

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
    nodes: [node()],
  });
  return { opened, snapshot };
}

// The production order: the result is recorded, THEN the owner is shown it.
function withRecordedResult() {
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
  task = applyWorkflowEvent(task, "WORKFLOW_RESULT_RECORDED", {
    task_id: opened.task_id,
    payload_digest: RECORDED_DIGEST,
    technical_status: "PASS",
    business_status: "PASS",
    recorded_at: new Date().toISOString(),
  });
  assert.equal(
    task.tasks[opened.task_id].workflow_status,
    "RESULT_PENDING_REVIEW",
  );
  return { opened, task };
}

function surface(opened, overrides = {}) {
  return {
    task_id: opened.task_id,
    channel: "results",
    thread_id: THREAD,
    result_digest: RECORDED_DIGEST,
    ...overrides,
  };
}

describe("M12/T9 F-396 - a surfaced digest is bound to the recorded result", () => {
  it("admits a surface that names the recorded result", () => {
    const { opened, task } = withRecordedResult();
    const surfaced = applyWorkflowEvent(task, "WORKFLOW_RESULT_SURFACED", {
      ...surface(opened),
    });
    assert.equal(
      surfaced.tasks[opened.task_id].results_thread_id,
      THREAD,
      "the first surface projects its thread",
    );
  });

  it("refuses a DIFFERENT result digest on the recorded thread", () => {
    const { opened, task } = withRecordedResult();
    const surfaced = applyWorkflowEvent(task, "WORKFLOW_RESULT_SURFACED", {
      ...surface(opened),
    });
    assert.throws(
      () =>
        applyWorkflowEvent(surfaced, "WORKFLOW_RESULT_SURFACED", {
          ...surface(opened, { result_digest: OTHER_DIGEST }),
        }),
      /RESULT_MISMATCH/,
      "a second, different result may not be shown as the recorded one",
    );
    assert.equal(
      surfaced.tasks[opened.task_id].results_thread_id,
      THREAD,
      "the refused surface changes nothing",
    );
  });

  it("keeps an identical re-surface idempotent", () => {
    const { opened, task } = withRecordedResult();
    const surfaced = applyWorkflowEvent(task, "WORKFLOW_RESULT_SURFACED", {
      ...surface(opened),
    });
    const replayed = applyWorkflowEvent(surfaced, "WORKFLOW_RESULT_SURFACED", {
      ...surface(opened),
    });
    assert.equal(replayed.tasks[opened.task_id].results_thread_id, THREAD);
    assert.equal(
      replayed.sequence,
      surfaced.sequence,
      "an identical replay is a no-op",
    );
  });

  it("keeps a digest-less legacy surface admissible", () => {
    const { opened, task } = withRecordedResult();
    const payload = surface(opened);
    delete payload.result_digest;
    const surfaced = applyWorkflowEvent(
      task,
      "WORKFLOW_RESULT_SURFACED",
      payload,
    );
    assert.equal(surfaced.tasks[opened.task_id].results_thread_id, THREAD);
  });

  it("still refuses a different thread even when the digest matches", () => {
    const { opened, task } = withRecordedResult();
    const surfaced = applyWorkflowEvent(task, "WORKFLOW_RESULT_SURFACED", {
      ...surface(opened),
    });
    assert.throws(
      () =>
        applyWorkflowEvent(surfaced, "WORKFLOW_RESULT_SURFACED", {
          ...surface(opened, { thread_id: OTHER_THREAD }),
        }),
      /INVALID_STATE_TRANSITION/,
    );
  });

  it("binds the surface to a ROOT result identity as well", () => {
    const { opened, snapshot } = openedWithBrief();
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: opened.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: ROOT_DIGEST,
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: "f".repeat(64),
      },
    );
    assert.equal(
      reviewed.tasks[opened.task_id].workflow_status,
      "RESULT_PENDING_REVIEW",
    );
    assert.throws(
      () =>
        applyWorkflowEvent(reviewed, "WORKFLOW_RESULT_SURFACED", {
          ...surface(opened, { result_digest: RECORDED_DIGEST }),
        }),
      /RESULT_MISMATCH/,
      "the root result's digest is the identity the surface must name",
    );
    const surfaced = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_RESULT_SURFACED",
      surface(opened, { result_digest: ROOT_DIGEST }),
    );
    assert.equal(surfaced.tasks[opened.task_id].results_thread_id, THREAD);
  });
});
