import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
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
