// F-298 (R7-C5B-A) -- the refused-retry case is actually performed, and the
// transient class is imported from production.
//
// The lane that names the no-retry-path invariant drove a killed run and
// asserted only that its reason code belonged to the documented transient
// pair -- which the file's own comment admits means the run IS retryable. The
// behaviour the title claims (a reservation must be refused for a non-transient
// terminal state) was never performed: no reservation event was applied and no
// refusal was asserted, so the production classification set was unconstrained.
//
// This lane performs both halves:
//
//   - the POSITIVE half: a documented transient failure IS reconciled by the
//     reservation, so the retry class stays reachable; and
//   - the NEGATIVE half: a run whose reason code is OUTSIDE the production
//     transient class cannot be reconciled, the reservation is refused, and the
//     task stays blocked.
//
// The class itself is IMPORTED from the production module, never hand-copied,
// and is asserted to be exactly the documented pair, so widening or emptying
// it in production reddens this lane.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  applyWorkflowEvent,
  TRANSIENT_FAILURE_CLASS,
} from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

let snowflake = 97000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-f298-"));
}

function briefNode(agentId, stack = "data_plant") {
  return {
    node_id: agentId,
    agent_id: agentId,
    stack_id: stack,
    dependencies: [],
    required: true,
    input_digest: canonicalHash("zink-input-v1", "work"),
    constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
    validation_digest: canonicalHash(
      "zink-validation-v1",
      "agent-result-payload.schema.json",
    ),
  };
}

function seed(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: [briefNode("o1"), briefNode("python")],
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  const o1 = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "o1",
    agent_id: "o1",
    parent_agent_id: "main",
    parent_session_key: "main-session",
    parent_run_id: "main-run",
    tool_call_id: "call-0",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("o1"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", o1);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: o1.delegation_id,
    native_run_id: "o1-run-1",
    child_session_key: "o1-session-1",
    agent_id: "o1",
    parent_session_key: "main-session",
  });
  const leaf = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "python",
    agent_id: "python",
    parent_agent_id: "o1",
    parent_session_key: "o1-session-1",
    parent_run_id: "o1-run-1",
    tool_call_id: "call-1",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("python"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", leaf);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: leaf.delegation_id,
    native_run_id: "python-run-1",
    child_session_key: "python-session-1",
    agent_id: "python",
    parent_session_key: "o1-session-1",
  });
  return { paths, taskId };
}

function retryProposal(taskId) {
  return buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "python",
    agent_id: "python",
    parent_agent_id: "o1",
    parent_session_key: "o1-session-1",
    parent_run_id: "o1-run-1",
    tool_call_id: "call-retry",
    turn: 2,
    attempt: 2,
    expected_governance_hash: governanceHash("python"),
  });
}

function failLeaf(paths, taskId) {
  recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
    task_id: taskId,
    native_run_id: "python-run-1",
    child_session_key: "python-session-1",
    parent_session_key: "o1-session-1",
    outcome: "error",
    recorded_at: new Date().toISOString(),
  });
}

test("F-298: the production transient class is exactly the documented pair", () => {
  assert.deepEqual(
    [...TRANSIENT_FAILURE_CLASS].sort(),
    ["RUN_TIMEOUT", "TRANSIENT_RUNTIME_FAILURE"],
    "the production transient class must stay the documented pair: widening it makes every failure retryable, emptying it makes the retry class unreachable",
  );
});

test("F-298: a documented transient failure IS retried by the reservation", () => {
  const root = fixture();
  try {
    const { paths, taskId } = seed(root);
    failLeaf(paths, taskId);
    const blocked = readSnapshot(paths).tasks[taskId];
    assert.equal(blocked.workflow_status, "BLOCKED");
    assert.equal(blocked.reason_code, "BLOCKED");
    const failedRun = Object.values(blocked.delegations).find(
      (candidate) => candidate.node_id === "python",
    );
    assert.ok(
      TRANSIENT_FAILURE_CLASS.has(failedRun.runtime_reason_code),
      "the failed attempt must carry a reason code the production class contains",
    );
    const retried = applyWorkflowEvent(
      readSnapshot(paths),
      "WORKFLOW_SPAWN_RESERVED",
      retryProposal(taskId),
    );
    const task = retried.tasks[taskId];
    assert.equal(task.reason_code, undefined, "the block must be lifted");
    assert.equal(task.reconciled_attempts, 1);
    const attempts = Object.values(task.delegations).filter(
      (candidate) => candidate.node_id === "python",
    );
    assert.deepEqual(
      attempts.map((candidate) => candidate.run_state).sort(),
      ["FAILED", "SPAWN_UNKNOWN"],
      "the old attempt is terminally FAILED and the new attempt is reserved",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-298: a run OUTSIDE the transient class cannot be retried", () => {
  const root = fixture();
  try {
    const { paths, taskId } = seed(root);
    failLeaf(paths, taskId);
    const snapshot = readSnapshot(paths);
    assert.ok(
      !TRANSIENT_FAILURE_CLASS.has("EXECUTION_STATE_UNKNOWN"),
      "the reason code used here must be outside the production class, or the case proves nothing",
    );
    // The state a runtime genuinely cannot classify: the attempt is UNKNOWN
    // but its reason code is NOT one the retry class contains.
    const outside = JSON.parse(JSON.stringify(snapshot));
    for (const candidate of Object.values(outside.tasks[taskId].delegations)) {
      if (candidate.node_id !== "python") continue;
      candidate.run_state = "UNKNOWN";
      candidate.runtime_reason_code = "EXECUTION_STATE_UNKNOWN";
    }
    assert.throws(
      () =>
        applyWorkflowEvent(
          outside,
          "WORKFLOW_SPAWN_RESERVED",
          retryProposal(taskId),
        ),
      (error) => typeof error?.code === "string" && error.code.length > 0,
      "a reservation for a run outside the transient class must be refused",
    );
    const stillBlocked = readSnapshot(paths).tasks[taskId];
    assert.equal(
      stillBlocked.workflow_status,
      "BLOCKED",
      "the task must stay blocked: an unclassifiable failure has no retry path",
    );
    assert.equal(stillBlocked.reason_code, "BLOCKED");
    assert.equal(
      stillBlocked.reconciled_attempts,
      undefined,
      "no attempt may be reconciled for a reason code outside the class",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
