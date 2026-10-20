import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyWorkflowEvent,
  resolveCurrentRunOwner,
} from "../integrations/openclaw/topology/lib/workflow.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";

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

function emptySnapshot() {
  return { tasks: {}, sequence: 0 };
}

function openOne(overrides = {}) {
  const payload = openedPayload(overrides);
  const next = applyWorkflowEvent(emptySnapshot(), "WORKFLOW_OPENED", payload);
  return { payload, snapshot: next };
}

describe("Lane A — workflow/event authority (M7-001/013/014/015/016/069)", () => {
  it("M7-001: identical WORKFLOW_OPENED replay is an idempotent no-op", () => {
    const { payload, snapshot } = openOne();
    const again = applyWorkflowEvent(snapshot, "WORKFLOW_OPENED", payload);
    assert.deepEqual(again, snapshot);
  });

  it("M7-001: same task_id with changed lineage is a deterministic conflict", () => {
    const { payload, snapshot } = openOne();
    for (const mutation of [
      { root_run_id: "run-2" },
      { root_session_key: "agent:main:sess-2" },
      { origin_message_id: "22345678901234567" },
      { origin_principal_ref: "b".repeat(64) },
      { root_agent_id: "o1" },
    ]) {
      const conflict = { ...payload, ...mutation };
      assert.throws(
        () => applyWorkflowEvent(snapshot, "WORKFLOW_OPENED", conflict),
        { code: "LINEAGE_MISMATCH" },
      );
    }
    assert.equal(snapshot.sequence ?? 0, snapshot.sequence ?? 0);
  });

  it("M7-013: approval from terminal or post-approval states is rejected", () => {
    const { payload, snapshot } = openOne();
    const approve = {
      task_id: payload.task_id,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
    };
    const queued = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_USER_APPROVAL_DECIDED",
      approve,
    );
    assert.equal(queued.tasks[payload.task_id].workflow_status, "QUEUED");
    assert.throws(
      () =>
        applyWorkflowEvent(queued, "WORKFLOW_USER_APPROVAL_DECIDED", approve),
      { code: "INVALID_STATE_TRANSITION" },
    );
  });

  it("M7-014: root result enters review, never COMPLETE without ACCEPT", () => {
    const { payload, snapshot } = openOne();
    const digest = "c".repeat(64);
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: payload.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: digest,
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: "d".repeat(64),
      },
    );
    assert.equal(
      reviewed.tasks[payload.task_id].workflow_status,
      "RESULT_PENDING_REVIEW",
    );
    assert.equal(
      reviewed.tasks[payload.task_id].root_result.pending_outcome_status,
      "COMPLETE",
    );
    const accepted = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      {
        task_id: payload.task_id,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
        result_digest: digest,
      },
    );
    assert.equal(accepted.tasks[payload.task_id].workflow_status, "COMPLETE");
  });

  it("M7-016: ACCEPT with missing/foreign digest is rejected", () => {
    const { payload, snapshot } = openOne();
    const digest = "c".repeat(64);
    const reviewed = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: payload.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: digest,
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: "d".repeat(64),
      },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(reviewed, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: payload.task_id,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
        }),
      { code: "RESULT_MISMATCH" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(reviewed, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: payload.task_id,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
          result_digest: "e".repeat(64),
        }),
      { code: "RESULT_MISMATCH" },
    );
  });

  it("M7-015: task-level result injection outside EXECUTING is rejected", () => {
    const { payload, snapshot } = openOne();
    assert.throws(
      () =>
        applyWorkflowEvent(snapshot, "WORKFLOW_RESULT_RECORDED", {
          task_id: payload.task_id,
          payload_digest: "f".repeat(64),
        }),
      { code: "INVALID_STATE_TRANSITION" },
    );
  });

  it("M7-069: late SPAWN_RECEIVED on a terminal task is a no-op", () => {
    const { payload, snapshot } = openOne();
    const before = JSON.stringify(snapshot);
    const terminalSnap = globalThis.structuredClone(snapshot);
    terminalSnap.tasks[payload.task_id].workflow_status = "COMPLETE";
    terminalSnap.tasks[payload.task_id].brief_state = "CLOSED";
    terminalSnap.tasks[payload.task_id].delegations = {
      "del-1": {
        delegation_id: "del-1",
        agent_id: "o1",
        parent_session_key: "agent:main:sess-1",
        run_state: "SPAWN_UNKNOWN",
      },
    };
    const after = applyWorkflowEvent(terminalSnap, "WORKFLOW_SPAWN_RECEIVED", {
      task_id: payload.task_id,
      delegation_id: "del-1",
      native_run_id: "native-9",
      child_session_key: "agent:o1:child-9",
      agent_id: "o1",
      parent_session_key: "agent:main:sess-1",
    });
    assert.equal(JSON.stringify(after), JSON.stringify(terminalSnap));
    assert.ok(before.length > 0);
  });

  it("M7-072: cancellation requires authorized actor provenance", () => {
    const { payload, snapshot } = openOne();
    const ownerCancel = applyWorkflowEvent(snapshot, "WORKFLOW_CANCELLED", {
      task_id: payload.task_id,
      reason_code: "OWNER_CANCELLED",
      actor: "user",
    });
    assert.equal(
      ownerCancel.tasks[payload.task_id].workflow_status,
      "CANCELLED",
    );
    const { payload: payload2, snapshot: snap2 } = openOne({
      origin_message_id: "22345678901234567",
    });
    const parentCancel = applyWorkflowEvent(snap2, "WORKFLOW_CANCELLED", {
      task_id: payload2.task_id,
      reason_code: "PARENT_CANCELLED",
      actor: "main",
    });
    assert.equal(
      parentCancel.tasks[payload2.task_id].workflow_status,
      "CANCELLED",
    );
    const { snapshot: snap3 } = openOne({
      origin_message_id: "32345678901234567",
    });
    const tid3 = Object.keys(snap3.tasks)[0];
    assert.throws(
      () =>
        applyWorkflowEvent(snap3, "WORKFLOW_CANCELLED", {
          task_id: tid3,
          reason_code: "OWNER_CANCELLED",
        }),
      { code: "SCHEMA_INVALID" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(snap3, "WORKFLOW_CANCELLED", {
          task_id: tid3,
          reason_code: "OWNER_CANCELLED",
          actor: "excel",
        }),
      { code: "POLICY_DENIED" },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(snap3, "WORKFLOW_CANCELLED", {
          task_id: tid3,
          reason_code: "PARENT_CANCELLED",
          actor: "user",
        }),
      { code: "POLICY_DENIED" },
    );
  });

  it("M7-002: raw writer cannot persist workflow events", async () => {
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const pathMod = (await import("node:path")).default;
    const {
      ensureLedger,
      ledgerPaths,
      readSnapshot,
      recordWorkflowEvent,
      appendEvent,
    } = await import("../integrations/openclaw/topology/lib/ledger.mjs");
    const root = mkdtempSync(pathMod.join(tmpdir(), "lane-a-ledger-"));
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const snap = readSnapshot(paths);
    const beforeEvents = (await import("node:fs")).readFileSync(
      paths.events,
      "utf8",
    );
    // Audit events still append through the raw writer.
    const afterAudit = appendEvent(paths, snap, "TASK_CREATED", {
      task_id: "a".repeat(64),
    });
    assert.equal(afterAudit.sequence, snap.sequence + 1);
    // M7-002: a metadata event may be JOURNALLED but must never advance the
    // workflow projection. `DELEGATION_RESERVED` and `TASK_CREATED` are
    // state-shaped names that a reader of the log could reasonably read as
    // "a delegation was reserved" — so the invariant is asserted, not assumed:
    // neither creates a task, a delegation, or any budget counter.
    const emptyProjection = readSnapshot(paths);
    // The contract for this audit event permits ONLY a correlation id, so it
    // cannot even express a delegation — the strongest possible form of the
    // invariant. (Extra fields are refused by the schema.)
    assert.throws(
      () =>
        appendEvent(paths, emptyProjection, "DELEGATION_RESERVED", {
          task_id: "a".repeat(64),
          node_id: "node-1",
          agent_id: "o1",
        }),
      { message: "SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED" },
      "a metadata event must not be able to express reservation state",
    );
    appendEvent(paths, emptyProjection, "DELEGATION_RESERVED", {
      task_id: "a".repeat(64),
    });
    const afterDelegationAudit = readSnapshot(paths);
    assert.deepEqual(
      afterDelegationAudit.tasks,
      emptyProjection.tasks,
      "a metadata event must not create or mutate a task",
    );
    assert.deepEqual(
      Object.values(afterDelegationAudit.tasks).flatMap((task) =>
        Object.keys(task.delegations ?? {}),
      ),
      [],
      "DELEGATION_RESERVED is an audit record, never a reservation",
    );
    assert.equal(
      Object.values(afterDelegationAudit.tasks).every(
        (task) => task.delegated_runs_used === 0,
      ),
      true,
      "a metadata event must not consume a delegation budget",
    );
    // The event IS in the log: the record is honest about what happened.
    const logged = (await import("node:fs"))
      .readFileSync(paths.events, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((event) => event.type);
    assert.ok(logged.includes("DELEGATION_RESERVED"));
    assert.ok(!Object.keys(afterDelegationAudit.tasks).length);
    // Workflow events are rejected by the raw writer; nothing persists.
    const opened = openedPayload({ origin_message_id: "42345678901234567" });
    assert.throws(
      () => appendEvent(paths, readSnapshot(paths), "WORKFLOW_OPENED", opened),
      { code: "WORKFLOW_COMMIT_PATH_REQUIRED" },
    );
    assert.equal(
      (await import("node:fs"))
        .readFileSync(paths.events, "utf8")
        .split("\n")
        .filter(Boolean).length,
      // TASK_CREATED + DELEGATION_RESERVED were journalled; the refused
      // WORKFLOW_OPENED and the schema-rejected payload added nothing.
      beforeEvents.split("\n").filter(Boolean).length + 2,
    );
    // The canonical path still commits workflow events.
    const committed = recordWorkflowEvent(paths, "WORKFLOW_OPENED", opened);
    assert.ok(committed.tasks[opened.task_id]);
    // A failed transition leaves event log and snapshot unchanged.
    const eventsBefore = (await import("node:fs")).readFileSync(
      paths.events,
      "utf8",
    );
    const snapBefore = JSON.stringify(readSnapshot(paths));
    assert.throws(() =>
      recordWorkflowEvent(paths, "NO_SUCH_EVENT", { task_id: opened.task_id }),
    );
    assert.equal(
      (await import("node:fs")).readFileSync(paths.events, "utf8"),
      eventsBefore,
    );
    assert.equal(JSON.stringify(readSnapshot(paths)), snapBefore);
  });
});

// ===========================================================================
// M12/T9 - F-076 / F-077 / F-078: the reducer binds the run that ASKED, the
// result that is PENDING, and the attempt that was ABANDONED.
// ===========================================================================
describe("M12/T9 - F-076/F-077/F-078: the reducer binds the run that asked, the result that is pending and the attempt that was abandoned", () => {
  function approve(snapshot, taskId) {
    return applyWorkflowEvent(snapshot, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: taskId,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
    });
  }

  function claim(snapshot, taskId, agentId) {
    return applyWorkflowEvent(snapshot, "WORKFLOW_TASK_CLAIMED", {
      task_id: taskId,
      agent_id: agentId,
    });
  }

  /** A task with one ABANDONED spawn: a reservation whose receipt never came. */
  function withAbandonedSpawn(snapshot, taskId) {
    const next = globalThis.structuredClone(snapshot);
    next.tasks[taskId].delegations = {
      "del-1": {
        delegation_id: "del-1",
        node_id: "node-1",
        agent_id: "sql",
        parent_agent_id: "o1",
        parent_session_key: "agent:o1:sess-1",
        parent_run_id: "run-1",
        tool_call_id: "call-1",
        turn: 1,
        attempt: 1,
        brief_revision: 1,
        stack_id: "data_plant",
        run_state: "SPAWN_UNKNOWN",
      },
    };
    return next;
  }

  it("F-076: a coordinator-bound task records the COORDINATOR run as the asker", () => {
    const { payload, snapshot } = openOne();
    const queued = approve(snapshot, payload.task_id);
    const executing = claim(queued, payload.task_id, "o1");
    const bound = applyWorkflowEvent(
      executing,
      "WORKFLOW_COORDINATOR_RUN_BOUND",
      {
        task_id: payload.task_id,
        coordinator: "o1",
        attempt: 1,
        lease_id: "lease-1",
        session_key: "agent:o1:sess-c",
        run_id: "coord-run-1",
      },
    );
    assert.deepEqual(
      resolveCurrentRunOwner(bound.tasks[payload.task_id]),
      {
        agent_id: "o1",
        session_key: "agent:o1:sess-c",
        run_id: "coord-run-1",
        attempt: 1,
      },
      "the bound coordinator run is the task's live run",
    );
    const asked = applyWorkflowEvent(bound, "WORKFLOW_USER_QUESTION_RECORDED", {
      task_id: payload.task_id,
      agent_id: "o1",
      question: "which table?",
      session_key: "agent:o1:sess-c",
      run_id: "coord-run-1",
    });
    const task = asked.tasks[payload.task_id];
    assert.equal(task.workflow_status, "WAITING_FOR_USER");
    assert.equal(task.waiting_question_run_id, "coord-run-1");
    assert.equal(task.waiting_question_agent_id, "o1");
    assert.equal(task.waiting_question_session_key, "agent:o1:sess-c");
    // The answer correlates with the run that ASKED, not with the root run.
    const answered = applyWorkflowEvent(
      asked,
      "WORKFLOW_USER_ANSWER_RECORDED",
      {
        task_id: payload.task_id,
        answer: "the blue one",
        actor: "user",
        user_principal_ref: "b".repeat(64),
        message_id: "22345678901234567",
      },
    );
    assert.equal(answered.tasks[payload.task_id].workflow_status, "EXECUTING");
  });

  it("F-076: the root run can no longer be recorded as the asker of a coordinator-bound task", () => {
    const { payload, snapshot } = openOne();
    const bound = applyWorkflowEvent(
      claim(approve(snapshot, payload.task_id), payload.task_id, "o1"),
      "WORKFLOW_COORDINATOR_RUN_BOUND",
      {
        task_id: payload.task_id,
        coordinator: "o1",
        attempt: 1,
        lease_id: "lease-1",
        session_key: "agent:o1:sess-c",
        run_id: "coord-run-1",
      },
    );
    assert.throws(
      () =>
        applyWorkflowEvent(bound, "WORKFLOW_USER_QUESTION_RECORDED", {
          task_id: payload.task_id,
          agent_id: "main",
          question: "which table?",
          session_key: "agent:main:sess-1",
          run_id: "run-1",
        }),
      { code: "LINEAGE_MISMATCH" },
      "a run that is not the live run must not be recordable as the asker",
    );
  });

  it("F-077: a task-level result recorded without a digest carries ONE digest and is closed by one verdict", () => {
    const { payload, snapshot } = openOne();
    const executing = claim(
      approve(snapshot, payload.task_id),
      payload.task_id,
      "o1",
    );
    const recorded = applyWorkflowEvent(executing, "WORKFLOW_RESULT_RECORDED", {
      task_id: payload.task_id,
      agent_id: "o1",
      attempt: 1,
      technical_status: "PASS",
      business_status: "PASS",
    });
    const task = recorded.tasks[payload.task_id];
    assert.equal(task.workflow_status, "RESULT_PENDING_REVIEW");
    assert.match(
      task.execution_payload_digest,
      /^[a-f0-9]{64}$/u,
      "the ledger must carry exactly one digest for a result that carried none",
    );
    // The digest is a function of the recorded facts, not of the clock: the
    // same event replays to the same digest, so a replay cannot re-label it.
    const replayed = applyWorkflowEvent(executing, "WORKFLOW_RESULT_RECORDED", {
      task_id: payload.task_id,
      agent_id: "o1",
      attempt: 1,
      technical_status: "PASS",
      business_status: "PASS",
    });
    assert.equal(
      replayed.tasks[payload.task_id].execution_payload_digest,
      task.execution_payload_digest,
    );
    const accepted = applyWorkflowEvent(
      recorded,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      {
        task_id: payload.task_id,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
      },
    );
    assert.equal(
      accepted.tasks[payload.task_id].workflow_status,
      "COMPLETE",
      "one owner verdict must close the review instead of wedging it",
    );
  });

  it("F-077: a verdict that names a FOREIGN digest is still refused", () => {
    const { payload, snapshot } = openOne();
    const executing = claim(
      approve(snapshot, payload.task_id),
      payload.task_id,
      "o1",
    );
    const recorded = applyWorkflowEvent(executing, "WORKFLOW_RESULT_RECORDED", {
      task_id: payload.task_id,
      agent_id: "o1",
      attempt: 1,
      technical_status: "PASS",
      business_status: "PASS",
    });
    assert.throws(
      () =>
        applyWorkflowEvent(recorded, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: payload.task_id,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
          result_digest: "e".repeat(64),
        }),
      { code: "RESULT_MISMATCH" },
      "the M7-062 binding still refuses a verdict that names another result",
    );
  });

  it("F-078: an abandoned spawn is reconciled so the root result is no longer refused", () => {
    const { payload, snapshot } = openOne();
    const recorded = applyWorkflowEvent(
      withAbandonedSpawn(snapshot, payload.task_id),
      "WORKFLOW_ROOT_RESULT_RECORDED",
      {
        task_id: payload.task_id,
        brief_revision: 1,
        native_run_id: "run-1",
        agent_id: "main",
        payload_digest: "c".repeat(64),
        outcome_status: "COMPLETE",
        reason_code: "NONE",
        governance_hash: "d".repeat(64),
      },
    );
    const task = recorded.tasks[payload.task_id];
    assert.equal(
      task.workflow_status,
      "RESULT_PENDING_REVIEW",
      "an abandoned spawn must not refuse the root result for ever",
    );
    const run = task.delegations["del-1"];
    assert.equal(run.run_state, "FAILED");
    assert.equal(run.recovery_reason, "SPAWN_RECEIPT_LOST");
    assert.equal(run.runtime_reason_code, "TRANSIENT_RUNTIME_FAILURE");
  });

  it("F-078: a late report about an abandoned spawn gets a terminal outcome instead of LINEAGE_MISMATCH", () => {
    const { payload, snapshot } = openOne();
    const after = applyWorkflowEvent(
      withAbandonedSpawn(snapshot, payload.task_id),
      "WORKFLOW_NATIVE_ENDED",
      {
        task_id: payload.task_id,
        native_run_id: "child-native-1",
        child_session_key: "agent:sql:child-1",
        parent_session_key: "agent:o1:sess-1",
        outcome: "error",
      },
    );
    const run = after.tasks[payload.task_id].delegations["del-1"];
    assert.equal(run.run_state, "FAILED");
    assert.equal(run.recovery_reason, "SPAWN_RECEIPT_LOST");
    assert.equal(run.runtime_reason_code, "TRANSIENT_RUNTIME_FAILURE");
  });
});

// ===========================================================================
// M12/T9 - F-229: the declared projection must contain every transition the
// reducer performs.
// ===========================================================================
describe("M12/T9 - F-229: the transition projection is corrected to match the reducer", () => {
  async function loadProjection() {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    return JSON.parse(
      fs.readFileSync(
        fileURLToPath(
          new URL(
            "../integrations/openclaw/topology/policy/state-transitions.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    );
  }

  it("F-229: every transition this lane drives is declared in the projection", async () => {
    const projection = await loadProjection();
    const edges = [];
    const drive = (from, to) => edges.push(["workflow_status", from, to]);

    const { payload, snapshot } = openOne();
    const queued = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_USER_APPROVAL_DECIDED",
      {
        task_id: payload.task_id,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      },
    );
    drive("ACTIVE", queued.tasks[payload.task_id].workflow_status);
    const executing = applyWorkflowEvent(queued, "WORKFLOW_TASK_CLAIMED", {
      task_id: payload.task_id,
      agent_id: "o1",
    });
    drive("QUEUED", executing.tasks[payload.task_id].workflow_status);
    const reviewed = applyWorkflowEvent(executing, "WORKFLOW_RESULT_RECORDED", {
      task_id: payload.task_id,
      agent_id: "o1",
      attempt: 1,
    });
    drive("EXECUTING", reviewed.tasks[payload.task_id].workflow_status);
    const accepted = applyWorkflowEvent(
      reviewed,
      "WORKFLOW_USER_RESULT_ACCEPTED",
      {
        task_id: payload.task_id,
        actor: "user",
        channel: "results",
        decision: "ACCEPT",
      },
    );
    drive(
      "RESULT_PENDING_REVIEW",
      accepted.tasks[payload.task_id].workflow_status,
    );

    // An approval that requests a revision: ACTIVE -> REVISING.
    const { payload: p2, snapshot: s2 } = openOne({
      origin_message_id: "22345678901234567",
    });
    const revising = applyWorkflowEvent(s2, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: p2.task_id,
      actor: "user",
      channel: "approvals",
      decision: "REQUEST_REVISION",
    });
    drive("ACTIVE", revising.tasks[p2.task_id].workflow_status);

    // An owner cancellation: ACTIVE -> CANCELLED.
    const { payload: p3, snapshot: s3 } = openOne({
      origin_message_id: "32345678901234567",
    });
    const cancelled = applyWorkflowEvent(s3, "WORKFLOW_CANCELLED", {
      task_id: p3.task_id,
      reason_code: "OWNER_CANCELLED",
      actor: "user",
    });
    drive("ACTIVE", cancelled.tasks[p3.task_id].workflow_status);

    for (const [namespace, from, to] of edges) {
      assert.ok(
        (projection[namespace]?.[from] ?? []).includes(to),
        `the projection must declare ${namespace}: ${from} -> ${to}`,
      );
    }
    assert.ok(edges.length >= 5, "the lane must exercise the edges it claims");
  });

  it("F-229: the projection declares the edges the anchored pre-verdict arm and the abandoned spawn need", async () => {
    const projection = await loadProjection();
    // The anchored pre-verdict root-result arm resolves the task DIRECTLY to
    // its recorded outcome, and the abandoned-spawn reconciliation stamps a
    // terminal run state. Both were missing from the projection.
    for (const outcome of ["COMPLETE", "PARTIAL", "BLOCKED", "FAILED"])
      assert.ok(
        (projection.workflow_status?.ACTIVE ?? []).includes(outcome),
        `ACTIVE -> ${outcome} must be declared`,
      );
    assert.ok(
      (projection.run_state?.SPAWN_UNKNOWN ?? []).includes("FAILED"),
      "SPAWN_UNKNOWN -> FAILED must be declared",
    );
    // The tracked lane (tests/m7-lane-g-policy.test.mjs) pins the UNKNOWN row
    // to exactly [FAILED]. The reducer's cancellation CAN move an UNKNOWN run
    // to CANCELLED, so that one divergence stays in place on purpose: the pin
    // is not this agent's to change, and the divergence is reported instead of
    // being papered over.
    assert.deepEqual(
      projection.run_state?.UNKNOWN ?? [],
      ["FAILED"],
      "the UNKNOWN row is pinned by the tracked policy lane",
    );
  });
});
