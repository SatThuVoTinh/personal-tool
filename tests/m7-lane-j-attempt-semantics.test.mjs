import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { createTrustedResultEnvelope } from "../integrations/openclaw/topology/lib/runtime.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

let snowflake = 90000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-attempt-"));
}

function node(agentId) {
  return {
    node_id: agentId,
    agent_id: agentId,
    stack_id: "data_plant",
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

function spawn(paths, taskId, fields) {
  const proposal = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: fields.node_id,
    agent_id: fields.agent_id,
    parent_agent_id: "o1",
    parent_session_key: "o1-session-1",
    parent_run_id: "o1-run-1",
    tool_call_id: fields.tool_call_id,
    turn: 1,
    attempt: fields.attempt,
    expected_governance_hash: governanceHash(fields.agent_id),
  });
  // M7-020: the approval evidence is recorded once by the fixture, before the
  // first reservation; a later attempt reuses the same approval.
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", proposal);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: proposal.delegation_id,
    native_run_id: fields.native_run_id,
    child_session_key: fields.child_session_key,
    agent_id: fields.agent_id,
    parent_session_key: "o1-session-1",
  });
  return proposal;
}

/**
 * A task whose o1 coordinator is live and whose python node has already been
 * attempted once, so a second attempt can be reserved.
 */
function twoAttemptTask(root) {
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
    nodes: [node("o1"), node("python")],
  });
  // M7-020: a spawn reservation creates governed work, so the owner
  // approval is recorded first.
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });

  const coordinator = buildSpawnProposal({
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
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", coordinator);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: coordinator.delegation_id,
    native_run_id: "o1-run-1",
    child_session_key: "o1-session-1",
    agent_id: "o1",
    parent_session_key: "main-session",
  });
  const first = spawn(paths, taskId, {
    node_id: "python",
    agent_id: "python",
    tool_call_id: "call-1",
    attempt: 1,
    native_run_id: "python-run-1",
    child_session_key: "python-session-1",
  });
  return { paths, taskId, first, coordinator };
}

function envelopeFor(paths, taskId, delegationId, digest) {
  const run = readSnapshot(paths).tasks[taskId].delegations[delegationId];
  return createTrustedResultEnvelope({
    payload: {
      schema_version: "1.0.0",
      governance_version: "m8-t2.2-r4",
      outcome_claim: "COMPLETE",
      reason_claim: "NONE",
      output: `output ${digest}`,
      assumptions: [],
      limitations: [],
      requested_prerequisites: [],
      agent_self_validation: "Claim only",
    },
    lineage: run,
    governance: {
      expected_governance_hash: run.expected_governance_hash,
      observed_governance_hash: run.expected_governance_hash,
    },
    runState: "COMPLETE",
    verifierValidation: "VALID",
    resultAcceptance: "ACCEPTED",
  });
}

const delegationOf = (paths, taskId, childSessionKey) => {
  const task = readSnapshot(paths).tasks[taskId];
  const id = Object.keys(task.delegations).find(
    (key) => task.delegations[key].child_session_key === childSessionKey,
  );
  return { id, run: task.delegations[id] };
};

describe("M8-056 — a node/attempt tuple is single-use", () => {
  it("a transient failure permits exactly one retry", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      // Attempt 1 fails at runtime: the documented transient-failure class.
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      // The task suspended, so an operator resumes it and authorizes attempt 2.
      recordWorkflowEvent(paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      const second = spawn(paths, taskId, {
        node_id: "python",
        agent_id: "python",
        tool_call_id: "call-2",
        attempt: 2,
        native_run_id: "python-run-2",
        child_session_key: "python-session-2",
      });
      assert.notEqual(second.delegation_id, first.delegation_id);
      const { run: attempt1 } = delegationOf(paths, taskId, "python-session-1");
      const { run: attempt2 } = delegationOf(paths, taskId, "python-session-2");
      assert.equal(attempt1.attempt, 1);
      assert.equal(attempt2.attempt, 2);
      assert.equal(attempt2.run_state, "RUNNING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a duplicate attempt number is refused", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      // Re-deriving the SAME proposal is an exact duplicate: the reducer must
      // refuse it rather than create a second run for the same tuple.
      assert.throws(
        () => recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", first),
        (err) => {
          assert.equal(
            ["SPAWN_UNKNOWN", "LINEAGE_MISMATCH"].includes(err?.code),
            true,
            `unexpected code ${err?.code}`,
          );
          return true;
        },
      );
      // And the ledger holds exactly one run for that node.
      const task = readSnapshot(paths).tasks[taskId];
      const attempts = Object.values(task.delegations)
        .filter((run) => run.node_id === "python")
        .map((run) => run.attempt);
      assert.deepEqual(attempts, [1]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a node whose attempt already completed cannot be retried", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        envelope: envelopeFor(paths, taskId, first.delegation_id, "a"),
      });
      assert.throws(
        () =>
          spawn(paths, taskId, {
            node_id: "python",
            agent_id: "python",
            tool_call_id: "call-2",
            attempt: 2,
            native_run_id: "python-run-2",
            child_session_key: "python-session-2",
          }),
        { code: "SPAWN_UNKNOWN" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M8-056 — a superseded attempt can never mutate current task state", () => {
  it("a superseded attempt reporting COMPLETE does not complete the old run", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      // Attempt 1 dies, attempt 2 becomes the live run.
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      spawn(paths, taskId, {
        node_id: "python",
        agent_id: "python",
        tool_call_id: "call-2",
        attempt: 2,
        native_run_id: "python-run-2",
        child_session_key: "python-session-2",
      });
      const before = readSnapshot(paths).tasks[taskId];

      // The superseded attempt 1 now reports a completion.
      const committed = recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        envelope: envelopeFor(paths, taskId, first.delegation_id, "b"),
      });
      const task = committed.tasks[taskId];
      const { run: attempt1 } = delegationOf(paths, taskId, "python-session-1");
      const { run: attempt2 } = delegationOf(paths, taskId, "python-session-2");
      // The old run is untouched: no completion, no accepted digest.
      assert.equal(attempt1.accepted_payload_digest, undefined);
      assert.notEqual(attempt1.run_state, "COMPLETE");
      // The live attempt is untouched and still running.
      assert.equal(attempt2.run_state, "RUNNING");
      assert.equal(attempt2.accepted_payload_digest, undefined);
      // The task did not move.
      assert.equal(task.workflow_status, before.workflow_status);
      // And the stale result cannot satisfy a downstream prerequisite.
      assert.equal(
        Object.values(task.delegations).some(
          (run) => run.accepted_outcome_status === "COMPLETE",
        ),
        false,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a superseded attempt reporting failure does not block the live attempt", () => {
    const root = fixture();
    try {
      const { paths, taskId } = twoAttemptTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      spawn(paths, taskId, {
        node_id: "python",
        agent_id: "python",
        tool_call_id: "call-2",
        attempt: 2,
        native_run_id: "python-run-2",
        child_session_key: "python-session-2",
      });
      const before = readSnapshot(paths).tasks[taskId];
      // The superseded attempt 1 reports a runtime error of its own.
      const committed = recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "timeout",
        recorded_at: new Date().toISOString(),
      });
      const task = committed.tasks[taskId];
      // The task is NOT blocked by a dead superseded attempt.
      assert.notEqual(task.workflow_status, "BLOCKED");
      assert.equal(task.workflow_status, before.workflow_status);
      const { run: attempt2 } = delegationOf(paths, taskId, "python-session-2");
      assert.equal(attempt2.run_state, "RUNNING");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a late receipt cannot revive a superseded attempt", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      spawn(paths, taskId, {
        node_id: "python",
        agent_id: "python",
        tool_call_id: "call-2",
        attempt: 2,
        native_run_id: "python-run-2",
        child_session_key: "python-session-2",
      });
      // A late SPAWN_RECEIVED carrying DIFFERENT identity for attempt 1 must be
      // refused, and a repeat of the SAME identity must be a no-op.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
            task_id: taskId,
            delegation_id: first.delegation_id,
            native_run_id: "python-run-1-forged",
            child_session_key: "python-session-1-forged",
            agent_id: "python",
            parent_session_key: "o1-session-1",
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      const sequence = readSnapshot(paths).sequence;
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id: taskId,
        delegation_id: first.delegation_id,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        agent_id: "python",
        parent_session_key: "o1-session-1",
      });
      const { run: attempt1 } = delegationOf(paths, taskId, "python-session-1");
      // The reconciled old attempt stays terminally FAILED: a late receipt
      // never revives it.
      assert.equal(attempt1.run_state, "FAILED");
      assert.ok(readSnapshot(paths).sequence >= sequence);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the durable snapshot still validates after late callbacks", () => {
    const root = fixture();
    try {
      const { paths, taskId, first } = twoAttemptTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      spawn(paths, taskId, {
        node_id: "python",
        agent_id: "python",
        tool_call_id: "call-2",
        attempt: 2,
        native_run_id: "python-run-2",
        child_session_key: "python-session-2",
      });
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        envelope: envelopeFor(paths, taskId, first.delegation_id, "c"),
      });
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      for (const line of readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean)) {
        validateContract("ledger-event", JSON.parse(line));
      }
      validateContract(
        "ledger-snapshot",
        JSON.parse(readFileSync(paths.snapshot, "utf8")),
        Number.MAX_SAFE_INTEGER,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
