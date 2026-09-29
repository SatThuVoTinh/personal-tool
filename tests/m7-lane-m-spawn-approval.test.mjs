import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

let snowflake = 92000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-m7020-"));
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

/** A task with an active brief and no approval evidence yet. */
function unapprovedTask(root) {
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
    nodes: [node("o1")],
  });
  return { paths, taskId };
}

function approve(paths, taskId) {
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
}

function proposal(taskId) {
  return buildSpawnProposal({
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
}

describe("M7-020 — a spawn reservation asserts the approval state itself", () => {
  it("ACTIVE without approval => deny", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "ACTIVE");
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
      // No delegation was created.
      assert.deepEqual(
        Object.keys(readSnapshot(paths).tasks[taskId].delegations ?? {}),
        [],
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("QUEUED after an approved decision => allow", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      approve(paths, taskId);
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "QUEUED");
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_SPAWN_RESERVED",
        proposal(taskId),
      );
      const task = committed.tasks[taskId];
      assert.equal(task.delegated_runs_used, 1);
      const reservation = Object.values(task.delegations)[0];
      assert.equal(reservation.run_state, "SPAWN_UNKNOWN");
      assert.equal(reservation.node_id, "o1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("EXECUTING after a claim => allow, and the tuple is still single-use", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      approve(paths, taskId);
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "main",
      });
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "EXECUTING",
      );
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", proposal(taskId));
      // The same node/attempt tuple cannot be reserved twice.
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        (err) => {
          assert.equal(
            ["SPAWN_UNKNOWN", "LINEAGE_MISMATCH"].includes(err?.code),
            true,
            `unexpected code ${err?.code}`,
          );
          return true;
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a rejected task denies even with the brief active", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "REJECT",
      });
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "REJECTED",
      );
      // A rejection leaves NO approval evidence, so the approval gate is the
      // first thing that refuses it. That is the stronger statement: the
      // reducer never even reaches the state check for unapproved work.
      assert.equal(
        readSnapshot(paths).tasks[taskId].approved_at,
        undefined,
        "a rejection must not leave approval evidence behind",
      );
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("terminal states deny", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      approve(paths, taskId);
      recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
        task_id: taskId,
        reason_code: "OWNER_CANCELLED",
        actor: "user",
      });
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "CANCELLED",
      );
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "INVALID_STATE_TRANSITION" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a non-user approval actor cannot create the evidence", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      // An agent may request a revision, but it can never approve.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
            task_id: taskId,
            actor: "main",
            channel: "approvals",
            decision: "APPROVE",
          }),
        { code: "POLICY_DENIED" },
      );
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_SPAWN_RESERVED",
            proposal(taskId),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a continuation is likewise a post-approval event", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      const wake = (extra = {}) => ({
        task_id: taskId,
        brief_revision: 1,
        session_key: "main-session",
        previous_run_id: "main-run",
        next_run_id: "main-wake-1",
        source_session_key: "main-session",
        trigger_run_id: "main-run",
        ...extra,
      });
      // Without approval the continuation is refused.
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_CONTINUATION_AUTHORIZED",
            wake(),
          ),
        { code: "AUTH_APPROVAL_REQUIRED" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the reservation is recorded in a schema-valid durable snapshot", () => {
    const root = fixture();
    try {
      const { paths, taskId } = unapprovedTask(root);
      approve(paths, taskId);
      recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", proposal(taskId));
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
