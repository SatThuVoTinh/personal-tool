import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
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
import { resolveCurrentRunOwner } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { readFileSync } from "node:fs";

const PRINCIPAL_REF = "a".repeat(64);

let snowflake = 85000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-d2-"));
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

/**
 * A task that is EXECUTING with one live delegated run (o1). This is the state
 * in which a question can legitimately be asked, and the state in which a
 * foreign or stale run must not be able to pose one.
 */
function executingTaskWithLiveDelegation(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: PRINCIPAL_REF,
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
  // M7-020: a spawn reservation creates governed work, so the owner approval
  // is recorded first.
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
  // The claim moves the task to EXECUTING, which is the state in which a
  // question is admissible.
  recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: taskId,
    agent_id: "main",
  });
  return { paths, taskId, o1 };
}

describe("M7-041 — a question is bound to the authoritative run owner", () => {
  it("only the canonical current run owner may pose a question", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      const task = readSnapshot(paths).tasks[taskId];
      // The canonical owner is the single RUNNING delegation.
      const owner = resolveCurrentRunOwner(task);
      assert.equal(owner.agent_id, "o1");
      assert.equal(owner.session_key, "o1-session-1");
      assert.equal(owner.run_id, "o1-run-1");
      assert.equal(owner.attempt, 1);

      // The current run may ask.
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_QUESTION_RECORDED",
        {
          task_id: taskId,
          agent_id: "o1",
          question: "Which period?",
          session_key: "o1-session-1",
          run_id: "o1-run-1",
        },
      );
      assert.equal(committed.tasks[taskId].workflow_status, "WAITING_FOR_USER");
      assert.equal(committed.tasks[taskId].waiting_question_run_id, "o1-run-1");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a foreign agent cannot pose a question for the live run", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      // Same run, wrong agent: the run is owned by exactly one agent.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "main",
            question: "Which period?",
            session_key: "o1-session-1",
            run_id: "o1-run-1",
          }),
        { code: "UNAUTHORIZED_TARGET" },
      );
      // Right agent, run that does not exist.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "o1",
            question: "Which period?",
            session_key: "o1-session-1",
            run_id: "o1-run-forged",
          }),
        { code: "EXECUTION_STATE_UNKNOWN" },
      );
      // The task never left EXECUTING.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "EXECUTING",
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].waiting_question,
        undefined,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a run identity that exists but is not the current owner is refused", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      // The root run is a real, resolvable run of this task, but a delegated
      // run is live, so the root is not the canonical owner and cannot pose a
      // question for it.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "main",
            question: "Which period?",
            session_key: "main-session",
            run_id: "main-run",
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "EXECUTING",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a superseded run cannot pose a question on a blocked task", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      // The delegated run dies at runtime, so the task suspends.
      recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: taskId,
        native_run_id: "o1-run-1",
        child_session_key: "o1-session-1",
        parent_session_key: "main-session",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "o1",
            question: "Which period?",
            session_key: "o1-session-1",
            run_id: "o1-run-1",
          }),
        (err) => {
          // The run is no longer RUNNING, so it is both a lineage violation
          // and out of state. Either refusal is correct; the invariant is that
          // it does not succeed.
          assert.equal(
            ["LINEAGE_MISMATCH", "INVALID_STATE_TRANSITION"].includes(
              err?.code,
            ),
            true,
            `unexpected refusal code ${err?.code}`,
          );
          return true;
        },
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.waiting_question, undefined);
      assert.equal(task.workflow_status, "BLOCKED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a question without a governed run identity is rejected outright", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      // The old, unbound shape is no longer admissible.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "o1",
            question: "Which period?",
          }),
        { code: "SCHEMA_INVALID" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("more than one live run is a lineage violation, not an ambiguity", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      const snapshot = readSnapshot(paths);
      const second = buildSpawnProposal({
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
      const ambiguous = {
        ...snapshot,
        tasks: {
          [taskId]: {
            ...snapshot.tasks[taskId],
            delegations: {
              ...snapshot.tasks[taskId].delegations,
              [second.delegation_id]: {
                ...snapshot.tasks[taskId].delegations[second.delegation_id],
                child_session_key: "python-session-1",
                native_run_id: "python-run-1",
                run_state: "RUNNING",
                attempt: 1,
              },
            },
          },
        },
      };
      assert.throws(() => resolveCurrentRunOwner(ambiguous.tasks[taskId]), {
        code: "LINEAGE_MISMATCH",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-042 — the raw reducer requires user provenance for an answer", () => {
  function waitingTask(root) {
    const made = executingTaskWithLiveDelegation(root);
    recordWorkflowEvent(made.paths, "WORKFLOW_USER_QUESTION_RECORDED", {
      task_id: made.taskId,
      agent_id: "o1",
      question: "Which period?",
      session_key: "o1-session-1",
      run_id: "o1-run-1",
    });
    return made;
  }

  it("a valid user answer is recorded with its principal and message", () => {
    const root = fixture();
    try {
      const { paths, taskId } = waitingTask(root);
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_ANSWER_RECORDED",
        {
          task_id: taskId,
          answer: "Q1 2026",
          actor: "user",
          user_principal_ref: PRINCIPAL_REF,
          message_id: nextMessageId(),
        },
      );
      const task = committed.tasks[taskId];
      assert.equal(task.workflow_status, "EXECUTING");
      assert.equal(task.user_answer, "Q1 2026");
      assert.equal(task.user_answer_principal_ref, PRINCIPAL_REF);
      assert.match(task.user_answer_message_id, /^[1-9][0-9]{16,19}$/u);
      // The question binding is released once answered.
      assert.equal(task.waiting_question_run_id, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("missing principal, missing message, and a non-user actor are denied", () => {
    const root = fixture();
    try {
      const { paths, taskId } = waitingTask(root);
      // No principal at all.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "user",
            message_id: nextMessageId(),
          }),
        { code: "SCHEMA_INVALID" },
      );
      // No message id.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "user",
            user_principal_ref: PRINCIPAL_REF,
          }),
        { code: "SCHEMA_INVALID" },
      );
      // An agent may not answer as the user.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "main",
            user_principal_ref: PRINCIPAL_REF,
            message_id: nextMessageId(),
          }),
        { code: "POLICY_DENIED" },
      );
      // A malformed principal ref is not a principal.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "user",
            user_principal_ref: "not-a-ref",
            message_id: nextMessageId(),
          }),
        { code: "SCHEMA_INVALID" },
      );
      // A malformed message id is not a message.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "user",
            user_principal_ref: PRINCIPAL_REF,
            message_id: "0",
          }),
        { code: "SCHEMA_INVALID" },
      );
      // The task is still waiting: none of the refusals consumed the question.
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "WAITING_FOR_USER");
      assert.equal(task.user_answer, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an answer cannot be replayed after the question is released", () => {
    const root = fixture();
    try {
      const { paths, taskId } = waitingTask(root);
      const messageId = nextMessageId();
      recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
        task_id: taskId,
        answer: "Q1 2026",
        actor: "user",
        user_principal_ref: PRINCIPAL_REF,
        message_id: messageId,
      });
      // Replaying the same answer is now out of state.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
            task_id: taskId,
            answer: "Q1 2026",
            actor: "user",
            user_principal_ref: PRINCIPAL_REF,
            message_id: messageId,
          }),
        { code: "INVALID_STATE_TRANSITION" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-043 — the continuation owner attempt is mandatory", () => {
  function continuationFixture(root) {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const origin = {
      origin: "discord",
      origin_principal_ref: PRINCIPAL_REF,
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
    return { paths, taskId, o1, leaf };
  }
  /**
   * o1 may only be woken once every one of its children is COMPLETE with an
   * accepted payload, so the fixture has to deliver the leaf result first.
   */
  function completeRun(paths, taskId, proposal) {
    const run =
      readSnapshot(paths).tasks[taskId].delegations[proposal.delegation_id];
    recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
      task_id: taskId,
      envelope: createTrustedResultEnvelope({
        payload: {
          schema_version: "1.0.0",
          governance_version: "m8-t2.2-r4",
          outcome_claim: "COMPLETE",
          reason_claim: "NONE",
          output: `${run.agent_id} output`,
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
      }),
    });
  }

  const wake = (taskId, extra = {}) => ({
    task_id: taskId,
    brief_revision: 1,
    session_key: "o1-session-1",
    previous_run_id: "o1-run-1",
    next_run_id: "o1-wake-1",
    source_session_key: "o1-session-1",
    trigger_run_id: "o1-run-1",
    ...extra,
  });

  it("a matching attempt is accepted and recorded on the continuation", () => {
    const root = fixture();
    try {
      const { paths, taskId, leaf } = continuationFixture(root);
      completeRun(paths, taskId, leaf);
      // o1 still has a live child, so authorize its own wake.
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_CONTINUATION_AUTHORIZED",
        wake(taskId, { owner_attempt: 1 }),
      );
      const cont = committed.tasks[taskId].continuations["o1-wake-1"];
      assert.equal(cont.owner_attempt, 1);
      assert.equal(cont.started, false);
      // The durable snapshot still validates.
      validateContract(
        "ledger-snapshot",
        JSON.parse(readFileSync(paths.snapshot, "utf8")),
        Number.MAX_SAFE_INTEGER,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a missing attempt is denied, not defaulted", () => {
    const root = fixture();
    try {
      const { paths, taskId, leaf } = continuationFixture(root);
      completeRun(paths, taskId, leaf);
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_CONTINUATION_AUTHORIZED",
            wake(taskId),
          ),
        { code: "LINEAGE_MISMATCH" },
      );
      assert.equal(readSnapshot(paths).tasks[taskId].continuations, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a stale attempt is denied", () => {
    const root = fixture();
    try {
      const { paths, taskId, leaf } = continuationFixture(root);
      completeRun(paths, taskId, leaf);
      for (const stale of [2, 3, 99]) {
        assert.throws(
          () =>
            recordWorkflowEvent(
              paths,
              "WORKFLOW_CONTINUATION_AUTHORIZED",
              wake(taskId, { owner_attempt: stale }),
            ),
          { code: "LINEAGE_MISMATCH" },
          `attempt ${stale} must be denied`,
        );
      }
      // A zero or non-integer attempt is not an attempt at all.
      for (const bad of [0, -1, 1.5, "1", null]) {
        assert.throws(
          () =>
            recordWorkflowEvent(
              paths,
              "WORKFLOW_CONTINUATION_AUTHORIZED",
              wake(taskId, { owner_attempt: bad }),
            ),
          { code: "LINEAGE_MISMATCH" },
          `attempt ${JSON.stringify(bad)} must be denied`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the wrong delegated run cannot be continued", () => {
    const root = fixture();
    try {
      const { paths, taskId, leaf } = continuationFixture(root);
      completeRun(paths, taskId, leaf);
      // The leaf run is not the continuation owner: it has already completed,
      // so no continuation may be authorized on it.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
            task_id: taskId,
            brief_revision: 1,
            session_key: "python-session-1",
            previous_run_id: "python-run-1",
            next_run_id: "python-wake-1",
            source_session_key: "python-session-1",
            trigger_run_id: "python-run-1",
            owner_attempt: 1,
          }),
        { code: "INVALID_STATE_TRANSITION" },
      );
      // And a continuation that names a run which does not exist at all.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
            ...wake(taskId, { owner_attempt: 1 }),
            session_key: "sql-session-forged",
            previous_run_id: "sql-run-forged",
          }),
        { code: "EXECUTION_STATE_UNKNOWN" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a root-owned continuation does not fabricate a delegation attempt", () => {
    const root = fixture();
    try {
      const { paths, taskId, o1, leaf } = continuationFixture(root);
      completeRun(paths, taskId, leaf);
      completeRun(paths, taskId, o1);
      // The main root run owns the task; no delegation attempt exists, and
      // none is invented. The trigger is the completed o1 run.
      const committed = recordWorkflowEvent(
        paths,
        "WORKFLOW_CONTINUATION_AUTHORIZED",
        {
          task_id: taskId,
          brief_revision: 1,
          session_key: "main-session",
          previous_run_id: "main-run",
          next_run_id: "main-wake-1",
          source_session_key: "o1-session-1",
          trigger_run_id: "o1-run-1",
        },
      );
      const cont = committed.tasks[taskId].continuations["main-wake-1"];
      assert.equal(cont.owner_attempt, undefined);
      assert.equal(
        Object.hasOwn(cont, "owner_attempt"),
        false,
        "an absent delegation attempt must not be serialized as present",
      );
      // And the same record is durable.
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

describe("durable contract alignment", () => {
  it("the question and answer payload contracts are enforced on disk", () => {
    const root = fixture();
    try {
      const { paths, taskId } = executingTaskWithLiveDelegation(root);
      // A question event that violates the declared contract is refused even
      // though the reducer also refuses it: the two layers agree.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
            task_id: taskId,
            agent_id: "not-an-agent",
            question: "Which period?",
            session_key: "o1-session-1",
            run_id: "o1-run-1",
          }),
        { code: "UNAUTHORIZED_TARGET" },
      );
      recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
        task_id: taskId,
        agent_id: "o1",
        question: "Which period?",
        session_key: "o1-session-1",
        run_id: "o1-run-1",
      });
      // The waiting snapshot validates against the durable contract.
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
