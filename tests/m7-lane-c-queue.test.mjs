import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { consumeApprovalAtomically } from "../integrations/openclaw/topology/lib/guard.mjs";

function freshQueue() {
  const dir = mkdtempSync(path.join(tmpdir(), "lane-c-"));
  return new QueueManager({ storagePath: path.join(dir, "task-queue.json") });
}

function enqueue(qm, taskId, overrides = {}) {
  return qm.enqueueTask({
    taskId,
    primaryCoordinator: "o1",
    requiredCapabilities: [],
    payload: {},
    ...overrides,
  });
}

function claimAs(qm, taskId, agentId) {
  return qm.claimTaskById({ taskId, agentId });
}

function finishAs(qm, taskId, agentId, leaseId, attempt, extra = {}) {
  return qm.finishExecution({
    taskId,
    agentId,
    leaseId,
    attempt,
    artifacts: [],
    resultSummary: "summary",
    ...extra,
  });
}

const APPROVAL_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("Lane C — queue projection & lease authority", () => {
  it("M7-009: unapproved ACTIVE never projects to QUEUED", () => {
    const qm = freshQueue();
    const res = qm.rebuildFromLedger({
      tasks: {
        unapproved: { workflow_status: "ACTIVE", root_agent_id: "o1" },
        approved: {
          workflow_status: "ACTIVE",
          approved_at: "2026-01-01T00:00:00.000Z",
          root_agent_id: "o1",
        },
        review: {
          workflow_status: "RESULT_PENDING_REVIEW",
          root_agent_id: "o1",
        },
        cancelled: { workflow_status: "CANCELLED", root_agent_id: "o1" },
      },
    });
    assert.equal(res.totalRebuilt, 4);
    assert.equal(qm.getTask("unapproved").status, "APPROVAL_PENDING");
    assert.equal(qm.getTask("approved").status, "QUEUED");
    assert.equal(qm.getTask("review").status, "RESULT_PENDING_REVIEW");
    assert.equal(qm.getTask("cancelled").status, "CANCELLED");
    assert.throws(() => claimAs(qm, "unapproved", "o1"), {
      message: /INVALID_STATE_TRANSITION/,
    });
    assert.equal(claimAs(qm, "approved", "o1").claimed, true);
  });

  it("M7-010: claims bind to assignment; arbitrary agents denied", () => {
    const qm = freshQueue();
    enqueue(qm, "coord-only", { primaryCoordinator: "o1" });
    assert.throws(() => claimAs(qm, "coord-only", "o2"), {
      message: /ASSIGNMENT_MISMATCH/,
    });
    assert.throws(() => claimAs(qm, "coord-only", "excel"), {
      message: /ASSIGNMENT_MISMATCH/,
    });
    enqueue(qm, "specialist-work", {
      primaryCoordinator: "o1",
      requiredCapabilities: ["excel"],
    });
    assert.throws(() => claimAs(qm, "specialist-work", "o2"), {
      message: /ASSIGNMENT_MISMATCH/,
    });
    assert.equal(claimAs(qm, "specialist-work", "excel").claimed, true);
  });

  it("M8-057: capability matching is explicit ANY-match routing", () => {
    const qm = freshQueue();
    enqueue(qm, "multi-cap", {
      primaryCoordinator: "o1",
      requiredCapabilities: ["excel", "sql"],
    });
    const found = qm.claimTask({ agentId: "sql", capabilities: ["sql"] });
    assert.equal(found.claimed, true);
    assert.equal(found.task.taskId, "multi-cap");
  });

  it("M7-011: reject is a governed user decision, not a free mutation", () => {
    const qm = freshQueue();
    enqueue(qm, "q1");
    assert.throws(() => qm.rejectTask({ taskId: "q1", reason: "X" }), {
      message: /POLICY_DENIED/,
    });
    const c = claimAs(qm, "q1", "o1");
    assert.equal(c.claimed, true);
    assert.throws(
      () =>
        qm.rejectTask({ taskId: "q1", actor: "user", decisionRef: "dec-1" }),
      { message: /INVALID_STATE_TRANSITION/ },
    );
    enqueue(qm, "q2");
    const r = qm.rejectTask({
      taskId: "q2",
      actor: "user",
      decisionRef: "dec-2",
    });
    assert.equal(r.status, "REJECTED");
    assert.throws(
      () =>
        qm.rejectTask({ taskId: "q2", actor: "user", decisionRef: "dec-3" }),
      { message: /INVALID_STATE_TRANSITION/ },
    );
  });

  it("M7-012/M8-054: completion binds verified user + current digest", () => {
    const qm = freshQueue();
    enqueue(qm, "t1");
    const { leaseId, task } = claimAs(qm, "t1", "o1");
    const fin = finishAs(qm, "t1", "o1", leaseId, task.attempt, {
      resultDigest: "d".repeat(64),
    });
    assert.equal(fin.resultDigest, "d".repeat(64));
    assert.throws(
      () => qm.completeTask({ taskId: "t1", userConfirmationRef: "fake-ref" }),
      { message: /USER_PRINCIPAL_REQUIRED/ },
    );
    assert.throws(
      () =>
        qm.completeTask({
          taskId: "t1",
          userConfirmationRef: "x",
          userPrincipalRef: "user-1",
          resultDigest: "e".repeat(64),
        }),
      { message: /RESULT_MISMATCH/ },
    );
    const done = qm.completeTask({
      taskId: "t1",
      userConfirmationRef: "user-button-accept",
      userPrincipalRef: "user-1",
      resultDigest: "d".repeat(64),
    });
    assert.equal(done.status, "COMPLETE");
  });

  it("M8-054: finish without a digest still binds a deterministic digest", () => {
    const qm = freshQueue();
    enqueue(qm, "t2");
    const { leaseId, task } = claimAs(qm, "t2", "o1");
    const fin = finishAs(qm, "t2", "o1", leaseId, task.attempt);
    assert.match(fin.resultDigest ?? "", /^[a-f0-9]{64}$/u);
    assert.equal(qm.getTask("t2").resultDigest, fin.resultDigest);
  });

  it("M7-028/M7-029/M7-030: lease fences are mandatory everywhere", () => {
    const qm = freshQueue();
    enqueue(qm, "f1");
    const { leaseId, task } = claimAs(qm, "f1", "o1");
    assert.throws(() => qm.heartbeat({ taskId: "f1", agentId: "o1" }), {
      message: /LEASE_MISMATCH/,
    });
    assert.throws(
      () => qm.heartbeat({ taskId: "f1", agentId: "o1", leaseId: "stale" }),
      { message: /LEASE_MISMATCH/ },
    );
    const hb = qm.heartbeat({ taskId: "f1", agentId: "o1", leaseId });
    assert.equal(hb.success, true);
    assert.throws(() => finishAs(qm, "f1", "o1", null, task.attempt), {
      message: /LEASE_MISMATCH/,
    });
    assert.throws(() => finishAs(qm, "f1", "o1", leaseId, task.attempt + 9), {
      message: /ATTEMPT_MISMATCH/,
    });
    assert.throws(() => qm.claimTaskById({ taskId: "f1", agentId: "o1" }), {
      message: /LEASE_MISMATCH/,
    });
    const renew = qm.claimTaskById({ taskId: "f1", agentId: "o1", leaseId });
    assert.equal(renew.success, true);
  });

  it("M7-024: corrupt approval-consumption storage fails closed", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lane-c-guard-"));
    writeFileSync(
      path.join(root, "consumed-approvals.json"),
      "{ corrupt",
      "utf8",
    );
    assert.throws(
      () => consumeApprovalAtomically({ root }, APPROVAL_ID, "scope-1"),
      { message: /EXECUTION_STATE_UNKNOWN/ },
    );
  });

  it("M7-025: stale recovery never resurrects ledger-closed work", () => {
    const qm = freshQueue();
    enqueue(qm, "s-cancelled");
    const c1 = claimAs(qm, "s-cancelled", "o1");
    enqueue(qm, "s-active");
    const c2 = claimAs(qm, "s-active", "o1");
    assert.ok(c1.leaseId && c2.leaseId);
    const recovered = qm.detectAndRecoverStaleTasks({
      staleThresholdSeconds: 0,
      ledgerTasks: {
        "s-cancelled": { workflow_status: "CANCELLED" },
        "s-active": { workflow_status: "ACTIVE" },
      },
    });
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].taskId, "s-active");
    assert.equal(qm.getTask("s-cancelled").status, "EXECUTING");
    const requeued = qm.getTask("s-active");
    assert.equal(requeued.status, "QUEUED");
    assert.equal(requeued.leaseId, null);
    assert.throws(
      () =>
        qm.finishExecution({
          taskId: "s-active",
          agentId: "o1",
          leaseId: c2.leaseId,
          attempt: c2.task.attempt,
        }),
      { message: /INVALID_STATE/ },
    );
  });

  it("M7-026/M7-073/M7-074: rebuild preserves fences, blocks the underconstrained", () => {
    const qm = freshQueue();
    qm.rebuildFromLedger({
      tasks: {
        // The attempt fence lives on a RUNNING delegation, which is what the
        // reducer actually writes and what the closed snapshot contract
        // declares. A task-level `attempt` is not a real ledger shape.
        "exec-fenced": {
          workflow_status: "EXECUTING",
          root_agent_id: "o1",
          claimed_by: "o1",
          delegations: {
            d1: { run_state: "RUNNING", attempt: 3, agent_id: "sql" },
          },
          nodes: [{ agent_id: "sql" }, { agent_id: "python" }],
        },
        "exec-nofence": { workflow_status: "EXECUTING", root_agent_id: "o1" },
        "main-owned": {
          workflow_status: "ACTIVE",
          approved_at: "2026-01-01",
          root_agent_id: "main",
        },
      },
    });
    const fenced = qm.getTask("exec-fenced");
    assert.equal(fenced.status, "EXECUTING");
    assert.equal(fenced.attempt, 3);
    assert.equal(fenced.claimedBy, "o1");
    // The capability set is derived from the brief's executing agents, so a
    // restart routes to the same specialists the brief named.
    assert.deepEqual(fenced.requiredCapabilities, ["python", "sql"]);
    assert.equal(qm.getTask("exec-nofence").status, "BLOCKED");
    const mainOwned = qm.getTask("main-owned");
    assert.equal(mainOwned.status, "APPROVAL_PENDING");
    assert.equal(mainOwned.primaryCoordinator, null);
  });

  it("M7-031: terminal states are never listed active", () => {
    const qm = freshQueue();
    enqueue(qm, "a-queued");
    enqueue(qm, "a-exec");
    claimAs(qm, "a-exec", "o1");
    enqueue(qm, "a-review");
    const rc = claimAs(qm, "a-review", "o1");
    finishAs(qm, "a-review", "o1", rc.leaseId, rc.task.attempt);
    enqueue(qm, "a-done");
    const dc = claimAs(qm, "a-done", "o1");
    const df = finishAs(qm, "a-done", "o1", dc.leaseId, dc.task.attempt, {
      resultDigest: "f".repeat(64),
    });
    qm.completeTask({
      taskId: "a-done",
      userConfirmationRef: "ref",
      userPrincipalRef: "user-1",
      resultDigest: df.resultDigest,
    });
    enqueue(qm, "a-rej");
    qm.rejectTask({ taskId: "a-rej", actor: "user", decisionRef: "d" });
    const active = new Set(qm.listActiveTasks().map((t) => t.taskId));
    assert.ok(active.has("a-queued"));
    assert.ok(active.has("a-exec"));
    assert.ok(active.has("a-review"));
    assert.ok(!active.has("a-done"));
    assert.ok(!active.has("a-rej"));
  });

  it("M7-032: save failure leaves memory and disk convergent", () => {
    const qm = freshQueue();
    enqueue(qm, "w1");
    const { leaseId } = claimAs(qm, "w1", "o1");
    const before = JSON.stringify(qm.getTask("w1"));
    const realSave = qm.save.bind(qm);
    qm.save = () => {
      throw new Error("INJECTED_SAVE_FAILURE");
    };
    try {
      assert.throws(
        () => qm.heartbeat({ taskId: "w1", agentId: "o1", leaseId }),
        { message: /INJECTED_SAVE_FAILURE/ },
      );
    } finally {
      qm.save = realSave;
    }
    assert.equal(JSON.stringify(qm.getTask("w1")), before);
    qm.load();
    assert.equal(JSON.stringify(qm.getTask("w1")), before);
  });

  it("M7-064: projection version is process-local and monotonic", () => {
    const qm = freshQueue();
    assert.equal(qm._projectionVersion, 0);
    enqueue(qm, "v1");
    assert.equal(qm._projectionVersion, 1);
    const qm2 = new QueueManager({ storagePath: qm.storagePath });
    assert.equal(qm2._projectionVersion, 0);
  });
});
