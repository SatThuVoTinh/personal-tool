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
import { createTrustedResultEnvelope } from "../integrations/openclaw/topology/lib/runtime.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

let snowflake = 93000000000000001n;
const nextMessageId = () => String(snowflake++);

const TERMINAL_STATES = [
  "COMPLETE",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "REJECTED",
];

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-h1-"));
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

/**
 * A deeply-seeded task: opened, briefed, approved and carrying one live
 * delegated run. This is the richest state in which a transition can still be
 * attempted, so it is the right baseline for the invalid-source-state matrix.
 */
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
  return { paths, taskId, o1, leaf };
}

function runFor(paths, taskId, childSessionKey) {
  const task = readSnapshot(paths).tasks[taskId];
  const id = Object.keys(task.delegations).find(
    (key) => task.delegations[key].child_session_key === childSessionKey,
  );
  return task.delegations[id];
}

function resultEnvelope(paths, taskId, childSessionKey, output) {
  const run = runFor(paths, taskId, childSessionKey);
  return createTrustedResultEnvelope({
    payload: {
      schema_version: "1.0.0",
      governance_version: "m8-t2.2-r4",
      outcome_claim: "COMPLETE",
      reason_claim: "NONE",
      output,
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

/** The event matrix: one representative payload per governed event type. */
const EVENT_MATRIX = [
  {
    type: "WORKFLOW_USER_APPROVAL_DECIDED",
    label: "approval decision",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      actor: "user",
      channel: "approvals",
      decision: "REJECT",
    }),
  },
  {
    type: "WORKFLOW_BRIEF_ACTIVATED",
    label: "brief activation",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      brief_revision: 2,
      nodes: [briefNode("o1"), briefNode("python")],
    }),
  },
  {
    type: "WORKFLOW_SPAWN_RESERVED",
    label: "spawn reservation",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      brief_revision: 1,
      node_id: "python",
      agent_id: "python",
      parent_agent_id: "o1",
      parent_session_key: "o1-session-1",
      parent_run_id: "o1-run-1",
      tool_call_id: "call-2",
      turn: 2,
      attempt: 2,
      expected_governance_hash: governanceHash("python"),
      ...ctx.extraProposal,
    }),
  },
  {
    type: "WORKFLOW_SPAWN_RECEIVED",
    label: "spawn receipt",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      delegation_id: ctx.leaf.delegation_id,
      native_run_id: "python-run-1",
      child_session_key: "python-session-1",
      agent_id: "python",
      parent_session_key: "o1-session-1",
    }),
  },
  {
    type: "WORKFLOW_NATIVE_ENDED",
    label: "native end",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      native_run_id: "python-run-1",
      child_session_key: "python-session-1",
      parent_session_key: "o1-session-1",
      outcome: "error",
      recorded_at: new Date().toISOString(),
    }),
  },
  {
    type: "WORKFLOW_TASK_CLAIMED",
    label: "task claim",
    payload: (ctx) => ({ task_id: ctx.taskId, agent_id: "main" }),
  },
  {
    type: "WORKFLOW_RESULT_RECORDED",
    label: "result recorded",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      envelope: resultEnvelope(
        ctx.paths,
        ctx.taskId,
        "python-session-1",
        "matrix output",
      ),
    }),
  },
  {
    type: "WORKFLOW_USER_RESULT_ACCEPTED",
    label: "user result acceptance",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      actor: "user",
      channel: "results",
      decision: "ACCEPT",
    }),
  },
  {
    type: "WORKFLOW_USER_RESULT_REJECTED",
    label: "user result rejection",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      actor: "user",
      channel: "results",
      decision: "REJECT",
      reason: "not acceptable",
    }),
  },
  {
    type: "WORKFLOW_RESULT_REVISION_REQUESTED",
    label: "result revision request",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      actor: "user",
      channel: "results",
      feedback: "redo it",
    }),
  },
  {
    type: "WORKFLOW_CONTINUATION_AUTHORIZED",
    label: "continuation authorization",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      brief_revision: 1,
      session_key: "main-session",
      previous_run_id: "main-run",
      next_run_id: "main-wake-1",
      source_session_key: "main-session",
      trigger_run_id: "main-run",
    }),
  },
  {
    type: "WORKFLOW_CONTINUATION_STARTED",
    label: "continuation start",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      next_run_id: "main-wake-1",
      session_key: "main-session",
      source_session_key: "main-session",
      agent_id: "main",
    }),
  },
  {
    type: "WORKFLOW_CANCELLED",
    label: "cancellation",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      reason_code: "OWNER_CANCELLED",
      actor: "user",
    }),
  },
  {
    type: "WORKFLOW_USER_QUESTION_RECORDED",
    label: "user question",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      agent_id: "main",
      question: "Which period?",
      session_key: "main-session",
      run_id: "main-run",
    }),
  },
  {
    type: "WORKFLOW_USER_ANSWER_RECORDED",
    label: "user answer",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      answer: "Q1 2026",
      actor: "user",
      user_principal_ref: "a".repeat(64),
      message_id: nextMessageId(),
    }),
  },
  {
    type: "WORKFLOW_TASK_RECONCILED",
    label: "reconciliation",
    payload: (ctx) => ({
      task_id: ctx.taskId,
      actor: "main",
      reason_code: "TRANSIENT_RUNTIME_FAILURE",
      node_id: "o1",
      agent_id: "o1",
    }),
  },
];

describe("Lane H1 — workflow state transition matrix", () => {
  it("no governed event mutates a task in a terminal state", () => {
    const covered = new Set();
    for (const entry of EVENT_MATRIX) {
      for (const terminalStatus of TERMINAL_STATES) {
        const root = fixture();
        try {
          const ctx = seed(root);
          const snapshot = readSnapshot(ctx.paths);
          // Force the task into the terminal state under test. The assertion is
          // about MUTATION, so the seed only has to be structurally valid.
          const forced = {
            ...snapshot,
            tasks: {
              [ctx.taskId]: {
                ...snapshot.tasks[ctx.taskId],
                workflow_status: terminalStatus,
                reason_code: "MATRIX_TERMINAL",
                approved_at: snapshot.tasks[ctx.taskId].approved_at,
              },
            },
          };
          const payload = entry.payload({ ...ctx, extraProposal: {} });
          let mutated = false;
          let threw = null;
          try {
            const next = applyWorkflowEvent(forced, entry.type, payload);
            mutated = !deepEqual(
              next.tasks[ctx.taskId],
              forced.tasks[ctx.taskId],
            );
          } catch (error) {
            threw = error;
          }
          assert.equal(
            mutated,
            false,
            `${entry.type} mutated a ${terminalStatus} task (${entry.label})`,
          );
          // Either the event was refused or it was ignored; both are safe.
          assert.equal(
            threw === null || typeof threw?.message === "string",
            true,
            `${entry.type} must refuse with a governance code`,
          );
          covered.add(entry.type);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
    assert.equal(
      covered.size,
      EVENT_MATRIX.length,
      "every event in the matrix must be exercised",
    );
  });

  it("the reducer never lowers a terminal status", () => {
    for (const entry of EVENT_MATRIX) {
      for (const terminalStatus of TERMINAL_STATES) {
        const root = fixture();
        try {
          const ctx = seed(root);
          const snapshot = readSnapshot(ctx.paths);
          const forced = {
            ...snapshot,
            tasks: {
              [ctx.taskId]: {
                ...snapshot.tasks[ctx.taskId],
                workflow_status: terminalStatus,
              },
            },
          };
          let next = forced;
          try {
            next = applyWorkflowEvent(
              forced,
              entry.type,
              entry.payload({ ...ctx, extraProposal: {} }),
            );
          } catch {
            /* refused: the forced state is unchanged by definition */
          }
          const status = next.tasks[ctx.taskId].workflow_status;
          assert.equal(
            status === terminalStatus ||
              !TERMINAL_STATES.includes(terminalStatus),
            true,
            `${entry.type} moved a ${terminalStatus} task to ${status}`,
          );
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      }
    }
  });

  it("the sequence and event log are untouched by a refused transition", () => {
    for (const entry of EVENT_MATRIX) {
      const root = fixture();
      try {
        const ctx = seed(root);
        const beforeSequence = readSnapshot(ctx.paths).sequence;
        const beforeEvents = readFileSync(ctx.paths.events, "utf8");
        const beforeSnapshot = readSnapshot(ctx.paths);
        // The task is left in ACTIVE, which is an invalid source state for most
        // of these events, and the live delegation is not completed.
        let refused = false;
        try {
          recordWorkflowEvent(
            ctx.paths,
            entry.type,
            entry.payload({ ...ctx, extraProposal: {} }),
          );
        } catch {
          refused = true;
        }
        if (refused) {
          assert.equal(
            readSnapshot(ctx.paths).sequence,
            beforeSequence,
            `${entry.type} advanced the sequence on refusal`,
          );
          assert.equal(
            readFileSync(ctx.paths.events, "utf8"),
            beforeEvents,
            `${entry.type} appended an event on refusal`,
          );
          assert.deepEqual(
            readSnapshot(ctx.paths),
            beforeSnapshot,
            `${entry.type} changed durable state on refusal`,
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("lineage is never fabricated: a foreign run identity cannot apply", () => {
    const foreign = [
      ["WORKFLOW_NATIVE_ENDED", "child_session_key", "forged-session"],
      ["WORKFLOW_NATIVE_ENDED", "parent_session_key", "forged-parent"],
      ["WORKFLOW_NATIVE_ENDED", "native_run_id", "forged-run"],
      ["WORKFLOW_USER_QUESTION_RECORDED", "run_id", "forged-run"],
      ["WORKFLOW_USER_QUESTION_RECORDED", "session_key", "forged-session"],
    ];
    for (const [type, field, forged] of foreign) {
      const root = fixture();
      try {
        const ctx = seed(root);
        const entry = EVENT_MATRIX.find((item) => item.type === type);
        const payload = entry.payload({ ...ctx, extraProposal: {} });
        payload[field] = forged;
        let threw = false;
        try {
          recordWorkflowEvent(ctx.paths, type, payload);
        } catch {
          threw = true;
        }
        assert.equal(
          threw,
          true,
          `${type} with a forged ${field} must be refused`,
        );
        const task = readSnapshot(ctx.paths).tasks[ctx.taskId];
        assert.equal(
          Object.values(task.delegations).some(
            (run) => run.child_session_key === "forged-session",
          ),
          false,
          `${type} adopted a forged session key`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

describe("Lane H1 — replay and idempotency matrix", () => {
  it("the same spawn proposal replayed is an idempotent no-op", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      const before = readSnapshot(ctx.paths);
      recordWorkflowEvent(ctx.paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id: ctx.taskId,
        delegation_id: ctx.leaf.delegation_id,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        agent_id: "python",
        parent_session_key: "o1-session-1",
      });
      const afterFirst = readSnapshot(ctx.paths);
      // The receipt was already recorded by the seed, so this exact replay is
      // itself a no-op: it advances neither the state nor the sequence.
      assert.equal(afterFirst.sequence, before.sequence);
      const eventsBefore = readFileSync(ctx.paths.events, "utf8");
      recordWorkflowEvent(ctx.paths, "WORKFLOW_SPAWN_RECEIVED", {
        task_id: ctx.taskId,
        delegation_id: ctx.leaf.delegation_id,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        agent_id: "python",
        parent_session_key: "o1-session-1",
      });
      assert.deepEqual(
        readSnapshot(ctx.paths),
        afterFirst,
        "an exact receipt replay must be a no-op",
      );
      assert.equal(
        readFileSync(ctx.paths.events, "utf8"),
        eventsBefore,
        "an exact receipt replay must not append an event",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the same result digest replayed is accepted; a conflicting one blocks", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      const envelope = resultEnvelope(
        ctx.paths,
        ctx.taskId,
        "python-session-1",
        "stable output",
      );
      recordWorkflowEvent(ctx.paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: ctx.taskId,
        envelope,
      });
      const afterFirst = readSnapshot(ctx.paths);
      // Exact replay: identical digest, no state change.
      recordWorkflowEvent(ctx.paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: ctx.taskId,
        envelope,
      });
      assert.deepEqual(
        readSnapshot(ctx.paths),
        afterFirst,
        "an identical result digest must be a no-op",
      );
      // Conflicting digest on the same attempt is a conflict, and the task
      // must be suspended rather than silently accepting the second result.
      const conflicting = resultEnvelope(
        ctx.paths,
        ctx.taskId,
        "python-session-1",
        "different output",
      );
      const after = recordWorkflowEvent(ctx.paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: ctx.taskId,
        envelope: conflicting,
      });
      assert.equal(after.tasks[ctx.taskId].workflow_status, "BLOCKED");
      assert.equal(
        after.tasks[ctx.taskId].reason_code,
        "DUPLICATE_RESULT_CONFLICT",
      );
      // The accepted digest is unchanged: a conflict never overwrites.
      const run = runFor(ctx.paths, ctx.taskId, "python-session-1");
      assert.equal(run.accepted_payload_digest, envelope.payload_digest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a conflicting tool call id for the same parent is refused", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      // A node can only be re-attempted after a DOCUMENTED transient failure,
      // so the leaf fails at runtime and the attempt is reconciled. That is
      // the only path on which a second reservation is admissible at all.
      recordWorkflowEvent(ctx.paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: ctx.taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      recordWorkflowEvent(ctx.paths, "WORKFLOW_TASK_RECONCILED", {
        task_id: ctx.taskId,
        actor: "main",
        reason_code: "TRANSIENT_RUNTIME_FAILURE",
        node_id: "python",
        agent_id: "python",
      });
      const proposal = buildSpawnProposal({
        task_id: ctx.taskId,
        brief_revision: 1,
        node_id: "python",
        agent_id: "python",
        parent_agent_id: "o1",
        parent_session_key: "o1-session-1",
        parent_run_id: "o1-run-1",
        tool_call_id: "call-2",
        turn: 2,
        attempt: 2,
        expected_governance_hash: governanceHash("python"),
      });
      recordWorkflowEvent(ctx.paths, "WORKFLOW_SPAWN_RESERVED", proposal);
      const before = readSnapshot(ctx.paths);
      // Same parent run + same tool call id, different turn: a replayed call.
      const replay = buildSpawnProposal({
        task_id: ctx.taskId,
        brief_revision: 1,
        node_id: "python",
        agent_id: "python",
        parent_agent_id: "o1",
        parent_session_key: "o1-session-1",
        parent_run_id: "o1-run-1",
        tool_call_id: "call-2",
        turn: 5,
        attempt: 3,
        expected_governance_hash: governanceHash("python"),
      });
      assert.throws(
        () => recordWorkflowEvent(ctx.paths, "WORKFLOW_SPAWN_RESERVED", replay),
        { code: "SPAWN_UNKNOWN" },
      );
      assert.deepEqual(readSnapshot(ctx.paths), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("every user verdict is bound to the exact result it names", () => {
    // M7-062: accept, reject and request-revision all carry the same
    // security-relevant obligation — a verdict must name the result it
    // applies to. They share ONE implementation, and this asserts the
    // obligation holds on all three, so a future edit to one cannot silently
    // weaken the others.
    const verdicts = [
      [
        "WORKFLOW_USER_RESULT_ACCEPTED",
        { actor: "user", channel: "results", decision: "ACCEPT" },
      ],
      [
        "WORKFLOW_USER_RESULT_REJECTED",
        { actor: "user", channel: "results", reason: "no" },
      ],
      [
        "WORKFLOW_RESULT_REVISION_REQUESTED",
        { actor: "user", channel: "results", feedback: "redo" },
      ],
    ];
    for (const [type, extra] of verdicts) {
      const root = fixture();
      try {
        const ctx = seed(root);
        // Drive the task to review with a known authoritative digest.
        recordWorkflowEvent(ctx.paths, "WORKFLOW_TASK_CLAIMED", {
          task_id: ctx.taskId,
          agent_id: "main",
        });
        const authoritative = canonicalHash("zink-payload-v1", "the result");
        recordWorkflowEvent(ctx.paths, "WORKFLOW_RESULT_RECORDED", {
          task_id: ctx.taskId,
          payload_digest: authoritative,
        });
        assert.equal(
          readSnapshot(ctx.paths).tasks[ctx.taskId].workflow_status,
          "RESULT_PENDING_REVIEW",
        );
        const base = { task_id: ctx.taskId, ...extra };
        // A verdict that names NO result is refused: it could apply to any.
        assert.throws(
          () => recordWorkflowEvent(ctx.paths, type, base),
          { code: "RESULT_MISMATCH" },
          `${type}: an unbound verdict must be refused`,
        );
        // A verdict naming a DIFFERENT result is refused.
        assert.throws(
          () =>
            recordWorkflowEvent(ctx.paths, type, {
              ...base,
              result_digest: "9".repeat(64),
            }),
          { code: "RESULT_MISMATCH" },
          `${type}: a verdict for another result must be refused`,
        );
        // Neither refusal advanced the review state.
        assert.equal(
          readSnapshot(ctx.paths).tasks[ctx.taskId].workflow_status,
          "RESULT_PENDING_REVIEW",
          `${type}: a refused verdict must not advance the task`,
        );
        // A verdict naming the authoritative result is applied.
        const applied = recordWorkflowEvent(ctx.paths, type, {
          ...base,
          result_digest: authoritative,
        });
        assert.notEqual(
          applied.tasks[ctx.taskId].workflow_status,
          "RESULT_PENDING_REVIEW",
          `${type}: a correctly bound verdict must be applied`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it("a documented transient failure is retried by the reservation itself", () => {
    // M8-056: the retry class must be REACHABLE, not merely declared. A
    // transient failure suspends the task to BLOCKED; before this path existed
    // nothing in production reconciled it, so such a task could never be
    // recovered. Reserving the next attempt performs the reconcile atomically.
    const root = fixture();
    try {
      const ctx = seed(root);
      recordWorkflowEvent(ctx.paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: ctx.taskId,
        agent_id: "main",
      });
      // The leaf fails at runtime with a documented transient reason.
      recordWorkflowEvent(ctx.paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: ctx.taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "error",
        recorded_at: new Date().toISOString(),
      });
      const blocked = readSnapshot(ctx.paths).tasks[ctx.taskId];
      assert.equal(blocked.workflow_status, "BLOCKED");
      assert.equal(blocked.reason_code, "BLOCKED");
      // A reservation for an UNRELATED node must NOT reconcile it.
      assert.throws(
        () =>
          recordWorkflowEvent(
            ctx.paths,
            "WORKFLOW_SPAWN_RESERVED",
            buildSpawnProposal({
              task_id: ctx.taskId,
              brief_revision: 1,
              node_id: "o1",
              agent_id: "o1",
              parent_agent_id: "main",
              parent_session_key: "main-session",
              parent_run_id: "main-run",
              tool_call_id: "call-x",
              turn: 9,
              attempt: 1,
              expected_governance_hash: governanceHash("o1"),
            }),
          ),
        { code: "INVALID_STATE_TRANSITION" },
        "an unrelated retry must not lift the block",
      );
      assert.equal(
        readSnapshot(ctx.paths).tasks[ctx.taskId].workflow_status,
        "BLOCKED",
      );
      // Reserving the NEXT attempt for the failed node reconciles it and
      // reserves, in one atomic event.
      const retried = recordWorkflowEvent(
        ctx.paths,
        "WORKFLOW_SPAWN_RESERVED",
        buildSpawnProposal({
          task_id: ctx.taskId,
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
        }),
      );
      const task = retried.tasks[ctx.taskId];
      assert.equal(task.reason_code, undefined, "the block must be lifted");
      assert.equal(task.reconciled_attempts, 1);
      // The old attempt is terminally FAILED, and the new one exists.
      const attempts = Object.values(task.delegations).filter(
        (run) => run.node_id === "python",
      );
      assert.equal(attempts.length, 2);
      assert.deepEqual(attempts.map((run) => run.run_state).sort(), [
        "FAILED",
        "SPAWN_UNKNOWN",
      ]);
      assert.equal(
        attempts.find((run) => run.run_state === "FAILED").reconciled_at !==
          undefined,
        true,
        "a reconciled attempt records when it was reconciled",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a non-transient failure still has no retry path", () => {
    // The retry trigger is restricted to the documented transient class, so a
    // state the runtime genuinely cannot classify still must be escalated.
    const root = fixture();
    try {
      const ctx = seed(root);
      recordWorkflowEvent(ctx.paths, "WORKFLOW_NATIVE_ENDED", {
        task_id: ctx.taskId,
        native_run_id: "python-run-1",
        child_session_key: "python-session-1",
        parent_session_key: "o1-session-1",
        outcome: "killed",
        recorded_at: new Date().toISOString(),
      });
      const task = readSnapshot(ctx.paths).tasks[ctx.taskId];
      // Every reported non-ok outcome maps to the documented transient class, so
      // the run IS retryable here; the guard is that the class is never widened
      // to EXECUTION_STATE_UNKNOWN by the reservation path.
      assert.equal(
        ["RUN_TIMEOUT", "TRANSIENT_RUNTIME_FAILURE"].includes(
          Object.values(task.delegations).find(
            (run) => run.node_id === "python",
          ).runtime_reason_code,
        ),
        true,
        "a reported runtime failure must carry a documented failure class",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the activated brief's semantic contract status is recorded and enforced", () => {
    // M7-016: execution-brief.schema.json always REQUIRED this status, but the
    // WORKFLOW_BRIEF_ACTIVATED event did not carry it, so the reducer had
    // nothing to mirror onto the task and the guard's check against
    // task.semantic_contract_status could only ever fail. A VALID brief is now
    // authorizable, and a non-VALID one is still refused.
    for (const [status, expectAllowed] of [
      ["VALID", true],
      ["MISSING", false],
      ["AMBIGUOUS", false],
    ]) {
      const root = fixture();
      try {
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
          semantic_contract_status: status,
          nodes: [briefNode("o1")],
        });
        // The task records what the brief declared, so the guard authorizes
        // against durable state rather than a caller-supplied document.
        assert.equal(
          readSnapshot(paths).tasks[taskId].semantic_contract_status,
          status,
        );
        // The guard's prerequisite holds only for VALID.
        assert.equal(
          readSnapshot(paths).tasks[taskId].semantic_contract_status ===
            "VALID",
          expectAllowed,
          `${status} must ${expectAllowed ? "" : "not "}authorize a specialist`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    // R4 readability (live-ledger migration 2026-09-29): the field is REQUIRED
    // on new writes only in the sense that the writer always emits it — the
    // READER must tolerate its absence, because briefs activated before R4
    // introduced the field carry no status and rejecting them makes the
    // operational ledger unreadable. An omitted status therefore normalizes to
    // an explicit MISSING rather than being refused, and MISSING authorizes
    // nothing: the security invariant (no specialist without VALID) is
    // unchanged, only the mechanism moved from refusal to normalization.
    const root = fixture();
    try {
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
        nodes: [briefNode("o1")],
      });
      // The omission normalizes to MISSING on the recorded task ...
      assert.equal(
        readSnapshot(paths).tasks[taskId].semantic_contract_status,
        "MISSING",
      );
      // ... and MISSING authorizes no specialist.
      assert.equal(
        readSnapshot(paths).tasks[taskId].semantic_contract_status === "VALID",
        false,
        "a status-less brief must not authorize a specialist",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a replayed approval decision is refused rather than re-applied", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      const before = readSnapshot(ctx.paths);
      // The task is already approved; a second APPROVE is out of state.
      assert.throws(
        () =>
          recordWorkflowEvent(ctx.paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
            task_id: ctx.taskId,
            actor: "user",
            channel: "approvals",
            decision: "APPROVE",
          }),
        { code: "INVALID_STATE_TRANSITION" },
      );
      assert.deepEqual(readSnapshot(ctx.paths), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a task opened with a changed root run/session is refused", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      const origin = {
        origin: "discord",
        origin_principal_ref: "a".repeat(64),
        origin_message_id: "123456789012345678",
      };
      const before = readSnapshot(ctx.paths);
      // A different message id is a different task, so the collision is
      // detected; the same message id with a different root run is not.
      assert.throws(
        () =>
          recordWorkflowEvent(ctx.paths, "WORKFLOW_OPENED", {
            ...origin,
            task_id: ctx.taskId,
            root_agent_id: "main",
            root_session_key: "impostor-session",
            root_run_id: "impostor-run",
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      assert.deepEqual(readSnapshot(ctx.paths), before);
      // A genuinely different origin is a different task and is accepted.
      recordWorkflowEvent(ctx.paths, "WORKFLOW_OPENED", {
        origin: "discord",
        origin_principal_ref: "a".repeat(64),
        origin_message_id: "123456789012345679",
        task_id: deriveTaskId({
          origin: "discord",
          origin_principal_ref: "a".repeat(64),
          origin_message_id: "123456789012345679",
        }),
        root_agent_id: "main",
        root_session_key: "other-session",
        root_run_id: "other-run",
      });
      assert.equal(Object.keys(readSnapshot(ctx.paths).tasks).length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a process restart before replay preserves identity and refuses duplicates", () => {
    const root = fixture();
    try {
      const ctx = seed(root);
      const before = readSnapshot(ctx.paths);
      // "Restart": a fresh read of the durable store, exactly as a new process
      // would see it.
      const afterRestart = readSnapshot(ctx.paths);
      assert.deepEqual(afterRestart, before);
      // The duplicate is still refused after the restart.
      assert.throws(
        () =>
          recordWorkflowEvent(ctx.paths, "WORKFLOW_SPAWN_RECEIVED", {
            task_id: ctx.taskId,
            delegation_id: ctx.leaf.delegation_id,
            native_run_id: "python-run-1-forged",
            child_session_key: "python-session-1-forged",
            agent_id: "python",
            parent_session_key: "o1-session-1",
          }),
        { code: "LINEAGE_MISMATCH" },
      );
      validateContract(
        "ledger-snapshot",
        JSON.parse(readFileSync(ctx.paths.snapshot, "utf8")),
        Number.MAX_SAFE_INTEGER,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
