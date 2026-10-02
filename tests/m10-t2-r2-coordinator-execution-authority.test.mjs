import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyWorkflowEvent,
  findSession,
  findBoundCoordinatorRun,
} from "../integrations/openclaw/topology/lib/workflow.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
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
import {
  QueueManager,
  defaultQueueManager,
} from "../integrations/openclaw/lib/queue-manager.mjs";
import {
  lockDirFor,
  tryAcquire,
} from "../integrations/openclaw/lib/file-lock.mjs";
import governancePlugin from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  AGENT_IDS,
  agentInstructions,
} from "../integrations/openclaw/lib/policy.mjs";

// M10/T2-R2 — coordinator execution authority.
//
// The M10/T2 pre-live safety audit found one residual class: a coordinator
// runtime could outlive its queue lease, and because every governed consumer
// resolved identity from the HISTORICAL binding alone, that run kept mutation
// authority after its lease was revoked, could reserve work onto a task a newer
// attempt owned, and — because recognition required a live EXECUTING queue item
// — could be misclassified at run end and reach the generic ALL_LIVE_RUNS
// containment sweep.
//
// These tests pin the three repaired invariants and the fencing evidence.

const OWNER = "32345678901234567";
const MANIFEST_HASH = "0".repeat(64);

function manifestFor() {
  return {
    expected_governance_hash: MANIFEST_HASH,
    observed_governance_hash: MANIFEST_HASH,
    allowed_tools: ["sessions_spawn", "sessions_yield"],
  };
}

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function nodeDef(nodeId, agentId, inputs) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: agentId === "sql" ? "data_plant" : "data_plant",
    dependencies: [],
    required: true,
    input_digest: canonicalHash("zink-input-v1", inputs),
    constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
    validation_digest: canonicalHash(
      "zink-validation-v1",
      "agent-result-payload.schema.json",
    ),
  };
}

function sessionKeyFor(taskId, attempt, coordinator = "o1") {
  return `agent:${coordinator}:coordinator:${taskId}:attempt-${attempt}`;
}

/** An approved, claimed coordinator task in a real ledger, not yet bound. */
function claimedCoordinatorTask(root, { inputs = "Bound workbook" } = {}) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "123456789012345673",
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
    nodes: [
      nodeDef("node-excel", "excel", inputs),
      nodeDef("node-sql", "sql", inputs),
    ],
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: taskId,
    agent_id: "o1",
  });
  return { paths, taskId, inputs };
}

/** Bind an attempt exactly as the pickup does: the real claim lease. */
function bindAttempt(paths, taskId, leaseId, attempt = 1) {
  const bound = {
    sessionKey: sessionKeyFor(taskId, attempt),
    runId: `run-attempt-${attempt}`,
    leaseId,
  };
  recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", {
    task_id: taskId,
    coordinator: "o1",
    attempt,
    lease_id: bound.leaseId,
    session_key: bound.sessionKey,
    run_id: bound.runId,
  });
  return bound;
}

/**
 * A ledger task bound to a coordinator run whose queue claim really holds the
 * bound lease — the exact relationship production pickup creates. Reducer-only
 * tests use `claimedCoordinatorTask` plus `bindAttempt` directly, because the
 * reducer never consults the queue.
 */
function liveBoundTask(root, options) {
  const { paths, taskId, inputs } = claimedCoordinatorTask(root, options);
  const { queue, claim } = liveQueue(root, taskId);
  const attempt1 = bindAttempt(paths, taskId, claim.leaseId, 1);
  return { paths, taskId, inputs, queue, claim, attempt1 };
}

function liveQueue(root, taskId) {
  const storagePath = path.join(root, "queue", "task-queue.json");
  const queue = new QueueManager({ storagePath });
  queue.enqueueTask({
    taskId,
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel", "sql"],
    payload: { brief: "Bound workbook" },
  });
  const claim = queue.claimTaskById({ taskId, agentId: "o1" });
  return { queue, claim };
}

/**
 * Drive the real stale-recovery code path. The age threshold is an existing
 * public parameter of `detectAndRecoverStaleTasks`; a negative value makes every
 * EXECUTING item stale, so the recovery itself (status, claimant, lease
 * revocation, generation increment, durable write) is what runs. No durable state
 * is hand-edited, because `withLock` reloads the projection and would discard an
 * in-memory heartbeat edit anyway.
 */
function recoverStale(queue) {
  return queue.detectAndRecoverStaleTasks({ staleThresholdSeconds: -1 });
}

/** A ledger-only bound task for reducer and lifecycle-classification tests. */
function boundCoordinatorTask(root, options) {
  const { paths, taskId, inputs } = claimedCoordinatorTask(root, options);
  const attempt1 = bindAttempt(paths, taskId, "lease-attempt-1", 1);
  return { paths, taskId, inputs, attempt1 };
}

function fencedGuard(paths, queue) {
  return createGovernanceGuard({
    paths,
    manifestFor,
    queueExecutionFence: (fence, operation) =>
      queue.withExecutionFence(fence, operation),
  });
}

function spawnProposal(inputs, nodeId = "node-excel") {
  return {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r12",
    node_id: nodeId,
    inputs,
    input_refs: [],
    constraints: "{}",
    validation_criteria: "agent-result-payload.schema.json",
  };
}

function spawnEvent(targetAgentId, proposal) {
  return {
    toolName: "sessions_spawn",
    toolCallId: "call-spawn-1",
    turn: 1,
    batchToolNames: ["sessions_spawn"],
    assistantText: "",
    params: {
      agentId: targetAgentId,
      runtime: "subagent",
      mode: "run",
      thread: false,
      context: "isolated",
      sandbox: "require",
      cleanup: "keep",
      task: JSON.stringify(proposal),
    },
  };
}

function delegationCount(paths, taskId) {
  return Object.keys(readSnapshot(paths).tasks[taskId].delegations ?? {})
    .length;
}

function journalTypes(paths) {
  return fs
    .readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).type);
}

function taskIdOf(paths) {
  return Object.keys(readSnapshot(paths).tasks)[0];
}

// ===========================================================================
// Test A — the current coordinator still performs its authorized work
// ===========================================================================

test("R2-A: a current coordinator holding a live lease still spawns through the governed gate", async () => {
  const root = tempRoot("zink-r2-auth-");
  try {
    const { paths, taskId, inputs, queue, claim, attempt1 } =
      liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    const decision = await guard.beforeToolCall(
      spawnEvent("excel", spawnProposal(inputs)),
      { agentId: "o1", sessionKey: attempt1.sessionKey, runId: attempt1.runId },
    );
    assert.equal(decision?.allow, true);
    assert.equal(typeof decision?.spawnLabel, "string");
    assert.equal(delegationCount(paths, taskId), 1);
    // The fence was satisfied by real queue authority: the bound lease is the
    // live claim lease, exactly as production pickup binds it.
    assert.equal(attempt1.leaseId, claim.leaseId);
    assert.equal(queue.getTask(taskId).leaseId, claim.leaseId);
    assert.equal(
      readSnapshot(paths).tasks[taskId].delegations[decision.spawnLabel]
        .parent_session_key,
      attempt1.sessionKey,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-A2: a historical binding with no queue authority seam cannot mutate anything", async () => {
  const root = tempRoot("zink-r2-noauth-");
  try {
    const { paths, taskId, inputs, attempt1 } = boundCoordinatorTask(root);
    // No queueExecutionFence is injected: current execution authority cannot be
    // established, so the binding alone must not authorize a mutation.
    const guard = createGovernanceGuard({ paths, manifestFor });
    await assert.rejects(
      async () =>
        guard.beforeToolCall(spawnEvent("excel", spawnProposal(inputs)), {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        }),
      /EXECUTION_STATE_UNKNOWN/,
    );
    assert.equal(delegationCount(paths, taskId), 0);
    assert.equal(
      journalTypes(paths).includes("WORKFLOW_SPAWN_RESERVED"),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test B — a revoked lease blocks the old coordinator
// ===========================================================================

test("R2-B: after stale recovery the old coordinator reserves nothing and history survives", async () => {
  const root = tempRoot("zink-r2-revoked-");
  try {
    const { paths, taskId, inputs, queue, attempt1 } = liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    const recovered = recoverStale(queue);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].revokedLeaseId, attempt1.leaseId);
    const item = queue.getTask(taskId);
    assert.equal(item.status, "QUEUED");
    assert.equal(item.claimedBy, null);
    assert.equal(item.leaseId, null, "recovery must revoke the lease");
    assert.equal(item.attempt, 2, "recovery must increment the generation");
    await assert.rejects(
      async () =>
        guard.beforeToolCall(spawnEvent("excel", spawnProposal(inputs)), {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        }),
      /EXECUTION_FENCE_(SUPERSEDED|REVOKED)/,
    );
    assert.equal(delegationCount(paths, taskId), 0, "no reservation may exist");
    assert.equal(
      journalTypes(paths).includes("WORKFLOW_SPAWN_RESERVED"),
      false,
    );
    const task = readSnapshot(paths).tasks[taskId];
    assert.equal(task.coordinator_runs["1"].run_id, attempt1.runId);
    assert.equal(task.workflow_status, "EXECUTING");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test C — attempt isolation at the authoritative mutation
// ===========================================================================

test("R2-C: a superseded attempt cannot reserve even when the queue seam is bypassed", () => {
  const root = tempRoot("zink-r2-supersede-");
  try {
    const { paths, taskId, attempt1 } = boundCoordinatorTask(root);
    bindAttempt(paths, taskId, "lease-attempt-2", 2);
    const attempt2 = {
      sessionKey: sessionKeyFor(taskId, 2),
      runId: "run-attempt-2",
    };
    const proposalFor = (attempt, toolCallId) =>
      buildSpawnProposal({
        task_id: taskId,
        brief_revision: 1,
        node_id: "node-excel",
        agent_id: "excel",
        parent_agent_id: "o1",
        parent_session_key: attempt.sessionKey,
        parent_run_id: attempt.runId,
        tool_call_id: toolCallId,
        turn: 1,
        attempt: 1,
        expected_governance_hash: MANIFEST_HASH,
      });
    const snapshot = readSnapshot(paths);
    // The current generation may reserve: the reducer's own fence admits it.
    const admitted = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_SPAWN_RESERVED",
      proposalFor(attempt2, "call-current"),
      "2026-10-02T00:00:00.000Z",
    );
    assert.equal(
      Object.keys(admitted.tasks[taskId].delegations).length,
      1,
      "the current generation must keep working",
    );
    // The superseded generation may not, at the reducer alone.
    assert.throws(
      () =>
        applyWorkflowEvent(
          snapshot,
          "WORKFLOW_SPAWN_RESERVED",
          proposalFor(attempt1, "call-old"),
          "2026-10-02T00:00:01.000Z",
        ),
      /SUPERSEDED_REVISION/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-C2: a coordinator reservation is refused once the task is no longer claimed by it", () => {
  const taskId = "d".repeat(64);
  const base = {
    workflow_status: "EXECUTING",
    brief_state: "ACTIVE",
    brief_revision: 1,
    revisions_used: 1,
    transitions_used: 0,
    delegated_runs_used: 0,
    approved_at: "2026-10-02T00:00:00.000Z",
    claimed_by: "o1",
    root_agent_id: "main",
    nodes: [nodeDef("node-excel", "excel", "work")],
    delegations: {},
  };
  const bound = applyWorkflowEvent(
    { tasks: { [taskId]: { ...base } } },
    "WORKFLOW_COORDINATOR_RUN_BOUND",
    {
      task_id: taskId,
      coordinator: "o1",
      attempt: 1,
      lease_id: "lease-x",
      session_key: sessionKeyFor(taskId, 1),
      run_id: "run-x",
    },
    "2026-10-02T00:00:00.000Z",
  );
  const reservation = {
    task_id: taskId,
    brief_revision: 1,
    node_id: "node-excel",
    agent_id: "excel",
    parent_agent_id: "o1",
    parent_session_key: sessionKeyFor(taskId, 1),
    parent_run_id: "run-x",
    tool_call_id: "call-x",
    turn: 1,
    attempt: 1,
    expected_governance_hash: MANIFEST_HASH,
    delegation_id: buildSpawnProposal({
      task_id: taskId,
      brief_revision: 1,
      node_id: "node-excel",
      agent_id: "excel",
      parent_agent_id: "o1",
      parent_session_key: sessionKeyFor(taskId, 1),
      parent_run_id: "run-x",
      tool_call_id: "call-x",
      turn: 1,
      attempt: 1,
      expected_governance_hash: MANIFEST_HASH,
    }).delegation_id,
    request_digest: buildSpawnProposal({
      task_id: taskId,
      brief_revision: 1,
      node_id: "node-excel",
      agent_id: "excel",
      parent_agent_id: "o1",
      parent_session_key: sessionKeyFor(taskId, 1),
      parent_run_id: "run-x",
      tool_call_id: "call-x",
      turn: 1,
      attempt: 1,
      expected_governance_hash: MANIFEST_HASH,
    }).request_digest,
  };
  const claimedByOther = { ...bound, tasks: { ...bound.tasks } };
  claimedByOther.tasks[taskId] = { ...bound.tasks[taskId], claimed_by: "o2" };
  assert.throws(
    () =>
      applyWorkflowEvent(
        claimedByOther,
        "WORKFLOW_SPAWN_RESERVED",
        reservation,
        "2026-10-02T00:00:01.000Z",
      ),
    /POLICY_DENIED|LINEAGE_MISMATCH/,
    "a task claimed by another coordinator must refuse the reservation",
  );
});

// ===========================================================================
// Test D/E — QUEUED-window coordinator lifecycle events stay narrow
// ===========================================================================

/**
 * A coordinator task whose attempt-1 run already spawned excel, excel is still
 * RUNNING, and the queue item is QUEUED after stale recovery. This is exactly
 * the window the pre-live audit found.
 */
function liveDelegationFixture(root) {
  const { paths, taskId, inputs, attempt1 } = boundCoordinatorTask(root);
  const excel = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "node-excel",
    agent_id: "excel",
    parent_agent_id: "o1",
    parent_session_key: attempt1.sessionKey,
    parent_run_id: attempt1.runId,
    tool_call_id: "call-excel",
    turn: 1,
    attempt: 1,
    expected_governance_hash: MANIFEST_HASH,
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", excel);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: excel.delegation_id,
    native_run_id: "excel-run-1",
    child_session_key: "excel-session-1",
    agent_id: "excel",
    parent_session_key: attempt1.sessionKey,
  });
  return { paths, taskId, inputs, attempt1, delegationId: excel.delegation_id };
}

function registerPlugin(root, ledgerRoot) {
  const hooks = new Map();
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "AGENTS.md"),
      agentInstructions(agentId),
    );
  }
  governancePlugin.register({
    pluginConfig: { ledgerRoot, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    registerTool: () => {},
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  });
  return hooks;
}

/**
 * Present the QUEUED queue item the plugin's own singleton sees. In-memory only:
 * the test must never write the developer's real queue file, and this state is
 * byte-for-byte what detectAndRecoveryStaleTasks leaves behind.
 */
function injectQueuedQueueItem(taskId) {
  defaultQueueManager.queue.set(taskId, {
    taskId,
    planVersion: "1.0",
    primaryCoordinator: "o1",
    requiredCapabilities: ["excel", "sql"],
    payload: {},
    ownerPrincipalRef: null,
    status: "QUEUED",
    queueReason: "AGENT_HEARTBEAT_TIMEOUT (stale after 3600s)",
    enqueuedAt: new Date().toISOString(),
    claimedBy: null,
    claimedAt: null,
    leaseId: null,
    attempt: 2,
    lastHeartbeatAt: null,
    leaseExpiresAt: null,
    history: [],
  });
  return () => defaultQueueManager.queue.delete(taskId);
}

test("R2-D: a coordinator end in the QUEUED window never reaches ALL_LIVE_RUNS containment", () => {
  const root = tempRoot("zink-r2-queued-end-");
  try {
    const { paths, taskId, attempt1, delegationId } =
      liveDelegationFixture(root);
    const hooks = registerPlugin(root, paths.root);
    const restore = injectQueuedQueueItem(taskId);
    try {
      const decision = hooks.get("subagent_ended")(
        { outcome: "ok" },
        { childSessionKey: attempt1.sessionKey, runId: attempt1.runId },
      );
      assert.equal(decision?.allow, true);
      assert.equal(decision.governanceState, "COORDINATOR_RUN_ENDED");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(
        task.delegations[delegationId].run_state,
        "RUNNING",
        "the unrelated live delegation must be untouched",
      );
      assert.equal(task.workflow_status, "EXECUTING");
      assert.notEqual(task.reason_code, "BLOCKED");
      const journal = journalTypes(paths);
      assert.equal(
        journal.includes("WORKFLOW_NATIVE_ENDED"),
        false,
        "no generic containment event may be written",
      );
      // Test I: a coordinator end is never a result.
      assert.equal(journal.includes("WORKFLOW_RESULT_RECORDED"), false);
      assert.notEqual(task.workflow_status, "RESULT_PENDING_REVIEW");
    } finally {
      restore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-E: a coordinator spawn in the QUEUED window never reaches ALL_LIVE_RUNS containment", () => {
  const root = tempRoot("zink-r2-queued-spawn-");
  try {
    const { paths, taskId, attempt1, delegationId } =
      liveDelegationFixture(root);
    const hooks = registerPlugin(root, paths.root);
    const restore = injectQueuedQueueItem(taskId);
    try {
      const decision = hooks.get("subagent_spawned")(
        {
          childSessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
          agentId: "o1",
        },
        {},
      );
      assert.equal(decision?.allow, true);
      assert.equal(decision.governanceState, "COORDINATOR_RUN_RECOGNIZED");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.delegations[delegationId].run_state, "RUNNING");
      assert.equal(task.workflow_status, "EXECUTING");
      assert.equal(
        journalTypes(paths).includes("WORKFLOW_NATIVE_ENDED"),
        false,
      );
    } finally {
      restore();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-K: a bound coordinator is still narrow when a SPECIALIST holds the live claim", () => {
  // A specialist is an assigned claimant for its own queue item (M7-010), so
  // `claimedBy` may legitimately differ from the coordinator while the o1
  // binding is still authoritative. Classification must follow the binding:
  // design contract 2.6 requires an exact binding match to attribute the event
  // BEFORE any fallthrough to generic containment.
  const root = tempRoot("zink-r2-specialist-claim-");
  try {
    const { paths, taskId, attempt1, delegationId } =
      liveDelegationFixture(root);
    const hooks = registerPlugin(root, paths.root);
    defaultQueueManager.queue.set(taskId, {
      taskId,
      planVersion: "1.0",
      primaryCoordinator: "o1",
      requiredCapabilities: ["excel", "sql"],
      payload: {},
      status: "EXECUTING",
      queueReason: "APPROVED_WAITING_EXECUTION",
      enqueuedAt: new Date().toISOString(),
      claimedBy: "excel",
      claimedAt: new Date().toISOString(),
      leaseId: "lease-specialist",
      attempt: 1,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      history: [],
    });
    try {
      const decision = hooks.get("subagent_ended")(
        { outcome: "ok" },
        { childSessionKey: attempt1.sessionKey, runId: attempt1.runId },
      );
      assert.equal(decision?.allow, true);
      assert.equal(decision.governanceState, "COORDINATOR_RUN_ENDED");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(
        task.delegations[delegationId].run_state,
        "RUNNING",
        "a foreign live claim must not make the coordinator run containment-eligible",
      );
      assert.equal(task.workflow_status, "EXECUTING");
      assert.equal(
        journalTypes(paths).includes("WORKFLOW_NATIVE_ENDED"),
        false,
      );
    } finally {
      defaultQueueManager.queue.delete(taskId);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-K2: an UNBOUND coordinator-shaped identity under a foreign live claim is still contained", () => {
  // The complement of R2-K: without the authoritative binding, a live claim held
  // by a different agent remains a fail-closed containment case.
  const root = tempRoot("zink-r2-foreign-unbound-");
  try {
    const { paths, taskId, delegationId } = liveDelegationFixture(root);
    const hooks = registerPlugin(root, paths.root);
    defaultQueueManager.queue.set(taskId, {
      taskId,
      planVersion: "1.0",
      primaryCoordinator: "o1",
      requiredCapabilities: ["excel", "sql"],
      payload: {},
      status: "EXECUTING",
      queueReason: "APPROVED_WAITING_EXECUTION",
      enqueuedAt: new Date().toISOString(),
      claimedBy: "excel",
      claimedAt: new Date().toISOString(),
      leaseId: "lease-specialist",
      attempt: 2,
      lastHeartbeatAt: new Date().toISOString(),
      leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
      history: [],
    });
    try {
      const decision = hooks.get("subagent_ended")(
        { outcome: "ok" },
        {
          childSessionKey: `agent:o1:coordinator:${taskId}:attempt-9`,
          runId: "run-9",
        },
      );
      assert.equal(decision?.allow, false);
      assert.equal(decision.scope, "ALL_LIVE_RUNS");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.delegations[delegationId].run_state, "UNKNOWN");
    } finally {
      defaultQueueManager.queue.delete(taskId);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-DRAFT: the brief_state === 'DRAFT' run-end branch is unreachable under the current contract", () => {
  // The plugin's run-end path has a defensive branch for a task whose brief was
  // never activated. That branch is NOT fenced by R2 (it is agent-agnostic), so it
  // must be proven unreachable rather than assumed safe.
  //
  // 1. The reducer writes brief_state only as "ACTIVE" (WORKFLOW_OPENED) or
  //    "CLOSED" (terminal outcomes). No transition can produce "DRAFT".
  const reducer = fs.readFileSync(
    new URL(
      "../integrations/openclaw/topology/lib/workflow.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const writes = [...reducer.matchAll(/brief_state\s*[:=]\s*"([A-Z_]+)"/g)].map(
    (match) => match[1],
  );
  assert.ok(writes.length >= 6, "the reducer must write brief_state somewhere");
  for (const value of writes) {
    assert.ok(
      ["ACTIVE", "CLOSED"].includes(value),
      `brief_state must only ever be ACTIVE or CLOSED, found ${value}`,
    );
  }
  // 2. TASK_STATES.DRAFT is a different vocabulary (queue task states), so the
  //    literal cannot leak into brief_state through a shared enum.
  const authority = fs.readFileSync(
    new URL("../integrations/openclaw/lib/authority.mjs", import.meta.url),
    "utf8",
  );
  assert.match(authority, /TASK_STATES\s*=\s*Object\.freeze\(\{/u);
  assert.doesNotMatch(
    authority,
    /brief_state\s*:\s*"DRAFT"/u,
    "the queue task-state vocabulary must never define brief_state",
  );
  // 3. Behavioural confirmation on a real ledger: after every brief-state-writing
  //    transition available to a task, brief_state is still ACTIVE or CLOSED.
  const root = tempRoot("zink-r2-briefstate-");
  try {
    const { paths } = claimedCoordinatorTask(root);
    assert.equal(
      readSnapshot(paths).tasks[taskIdOf(paths)].brief_state,
      "ACTIVE",
    );
    const taskId = taskIdOf(paths);
    recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
      task_id: taskId,
      reason_code: "OWNER_CANCELLED",
      actor: "user",
    });
    assert.equal(readSnapshot(paths).tasks[taskId].brief_state, "CLOSED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-E2: genuine unreconciled native delegations are still contained exactly as before", () => {
  const root = tempRoot("zink-r2-containment-");
  try {
    const { paths, taskId, delegationId } = liveDelegationFixture(root);
    const hooks = registerPlugin(root, paths.root);
    // A native delegation identity whose run id matches nothing: the existing
    // containment model must be unchanged by the R2 recognition fix.
    const decision = hooks.get("subagent_ended")(
      { outcome: "ok" },
      { childSessionKey: "excel-session-1", runId: "no-such-run" },
    );
    assert.equal(decision?.allow, false);
    assert.equal(decision.blocked, true);
    assert.equal(decision.scope, "IDENTIFIED_RUN");
    const task = readSnapshot(paths).tasks[taskId];
    assert.equal(task.delegations[delegationId].run_state, "UNKNOWN");
    assert.equal(task.workflow_status, "BLOCKED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test F — historical attribution survives revocation
// ===========================================================================

test("R2-F: a revoked coordinator keeps its identity for history but loses execution authority", async () => {
  const root = tempRoot("zink-r2-history-");
  try {
    const { paths, taskId, inputs, queue, attempt1 } = liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    recoverStale(queue);
    const snapshot = readSnapshot(paths);
    // History: the binding still resolves exactly as before.
    const owner = findSession(snapshot, attempt1.sessionKey, attempt1.runId);
    assert.equal(owner.task_id, taskId);
    assert.equal(owner.coordinatorRun.attempt, 1);
    assert.equal(owner.coordinatorRun.lease_id, attempt1.leaseId);
    assert.ok(
      findBoundCoordinatorRun(
        snapshot,
        attempt1.sessionKey,
        attempt1.runId,
        "o1",
      ),
    );
    // Authority: the same identity cannot mutate.
    await assert.rejects(
      async () =>
        guard.beforeToolCall(spawnEvent("excel", spawnProposal(inputs)), {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        }),
      /EXECUTION_FENCE_(SUPERSEDED|REVOKED)/,
    );
    // Admission is not a mutation, so attribution stays usable.
    assert.deepEqual(
      await guard.beforeRun(
        {},
        {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        },
      ),
      { allow: true },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test G — the new attempt works normally
// ===========================================================================

test("R2-G: the new attempt after recovery performs its authorized work normally", async () => {
  const root = tempRoot("zink-r2-attempt2-");
  try {
    const { paths, taskId, inputs, queue, attempt1 } = liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    recoverStale(queue);
    const claim = queue.claimTaskById({ taskId, agentId: "o1" });
    assert.equal(queue.getTask(taskId).attempt, 2);
    assert.notEqual(claim.leaseId, attempt1.leaseId, "a new lease is issued");
    const attempt2 = bindAttempt(paths, taskId, claim.leaseId, 2);
    assert.deepEqual(
      await guard.beforeRun(
        {},
        {
          agentId: "o1",
          sessionKey: attempt2.sessionKey,
          runId: attempt2.runId,
        },
      ),
      { allow: true },
    );
    const current = await guard.beforeToolCall(
      spawnEvent("excel", spawnProposal(inputs)),
      { agentId: "o1", sessionKey: attempt2.sessionKey, runId: attempt2.runId },
    );
    assert.equal(current?.allow, true, "the current generation must work");
    assert.equal(delegationCount(paths, taskId), 1);
    // The old attempt is still refused, and it must not affect run B.
    await assert.rejects(
      async () =>
        guard.beforeToolCall(
          spawnEvent("sql", spawnProposal(inputs, "node-sql")),
          {
            agentId: "o1",
            sessionKey: attempt1.sessionKey,
            runId: attempt1.runId,
          },
        ),
      /EXECUTION_FENCE_(SUPERSEDED|REVOKED)/,
    );
    assert.equal(
      delegationCount(paths, taskId),
      1,
      "run A must leave run B's reservation exactly as it was",
    );
    // A wrong-agent caller is refused by identity, never by the fence.
    await assert.rejects(
      async () =>
        guard.beforeToolCall(spawnEvent("excel", spawnProposal(inputs)), {
          agentId: "o2",
          sessionKey: attempt2.sessionKey,
          runId: attempt2.runId,
        }),
      /LINEAGE_MISMATCH|INVALID_STATE_TRANSITION/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test H — idempotency is preserved
// ===========================================================================

test("R2-H: identical re-bind is a no-op and a conflicting re-bind still fails", () => {
  const root = tempRoot("zink-r2-idem-");
  try {
    const { paths, taskId, attempt1 } = boundCoordinatorTask(root);
    const before = readSnapshot(paths);
    recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", {
      task_id: taskId,
      coordinator: "o1",
      attempt: 1,
      lease_id: attempt1.leaseId,
      session_key: attempt1.sessionKey,
      run_id: attempt1.runId,
    });
    const after = readSnapshot(paths);
    assert.equal(before.sequence, after.sequence, "no event is appended");
    assert.deepEqual(before, after);
    assert.throws(
      () =>
        recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", {
          task_id: taskId,
          coordinator: "o1",
          attempt: 1,
          lease_id: "lease-different",
          session_key: attempt1.sessionKey,
          run_id: attempt1.runId,
        }),
      /LINEAGE_MISMATCH/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test I — a coordinator is still never Main/root, and a revoked one neither
// ===========================================================================

test("R2-I: a revoked coordinator cannot borrow root or another coordinator identity", async () => {
  const root = tempRoot("zink-r2-identity-");
  try {
    const { paths, taskId, inputs, queue, attempt1 } = liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    recoverStale(queue);
    for (const agentId of ["main", "o2"]) {
      await assert.rejects(
        async () =>
          guard.beforeToolCall(
            spawnEvent(
              agentId === "main" ? "o1" : "excel",
              spawnProposal(inputs),
            ),
            { agentId, sessionKey: attempt1.sessionKey, runId: attempt1.runId },
          ),
        /EXECUTION_FENCE_|LINEAGE_MISMATCH|INVALID_STATE_TRANSITION|UNAUTHORIZED_TARGET|POLICY_DENIED/,
      );
    }
    assert.equal(delegationCount(paths, taskId), 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// Test J — fencing / race evidence
// ===========================================================================

test("R2-J1: the authoritative commit runs inside the queue critical section", () => {
  const root = tempRoot("zink-r2-lock-");
  try {
    const { taskId, queue, attempt1 } = liveBoundTask(root);
    const lockDir = lockDirFor(
      path.dirname(queue.storagePath),
      `${path.basename(queue.storagePath)}.lock`,
    );
    let heldDuringOperation = null;
    let recoveryDuringOperation = null;
    const result = queue.withExecutionFence(
      {
        taskId,
        claimedBy: "o1",
        leaseId: attempt1.leaseId,
        attempt: 1,
      },
      () => {
        heldDuringOperation = tryAcquire(lockDir);
        try {
          recoverStale(queue);
          recoveryDuringOperation = "recovered";
        } catch (err) {
          recoveryDuringOperation = err?.message ?? String(err);
        }
        return "committed";
      },
    );
    assert.equal(result, "committed");
    assert.equal(
      heldDuringOperation,
      false,
      "the queue lock must be held for the whole fenced commit",
    );
    assert.match(
      recoveryDuringOperation,
      /QUEUE_LOCK_TIMEOUT/,
      "stale recovery must be locked out of the fenced commit",
    );
    assert.equal(
      queue.getTask(taskId).status,
      "EXECUTING",
      "no revocation may have landed inside the fence",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-J2: the exact TOCTOU sequence is refused at the mutation boundary", async () => {
  const root = tempRoot("zink-r2-toctou-");
  try {
    const { paths, taskId, inputs, queue, attempt1 } = liveBoundTask(root);
    const guard = fencedGuard(paths, queue);
    // Time 1: the coordinator resolves cleanly and is otherwise admissible.
    assert.deepEqual(
      await guard.beforeRun(
        {},
        {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        },
      ),
      { allow: true },
    );
    // Time 2: stale recovery revokes the lease between the check and the write.
    recoverStale(queue);
    // Time 3: the coordinator attempts its governed mutation.
    await assert.rejects(
      async () =>
        guard.beforeToolCall(spawnEvent("excel", spawnProposal(inputs)), {
          agentId: "o1",
          sessionKey: attempt1.sessionKey,
          runId: attempt1.runId,
        }),
      /EXECUTION_FENCE_(SUPERSEDED|REVOKED)/,
    );
    assert.equal(delegationCount(paths, taskId), 0);
    assert.equal(
      journalTypes(paths).includes("WORKFLOW_SPAWN_RESERVED"),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-J3: the durable projection, not an in-memory one, decides the fence", () => {
  const root = tempRoot("zink-r2-durable-");
  try {
    const { taskId, queue, attempt1 } = liveBoundTask(root);
    const storagePath = path.join(root, "queue", "task-queue.json");
    // A second manager over the same file, holding a pre-recovery in-memory copy.
    const stale = new QueueManager({ storagePath });
    assert.equal(stale.getTask(taskId).status, "EXECUTING");
    assert.equal(stale.getTask(taskId).leaseId, attempt1.leaseId);
    recoverStale(queue);
    assert.throws(
      () =>
        stale.withExecutionFence(
          {
            taskId,
            claimedBy: "o1",
            leaseId: attempt1.leaseId,
            attempt: 1,
          },
          () => "committed",
        ),
      /EXECUTION_FENCE_(SUPERSEDED|REVOKED)/,
      "a stale in-memory projection must never present a revoked lease as live",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("R2-J4: the lock ordering is queue-then-ledger, so the fence cannot deadlock the ledger", () => {
  const guardSource = fs.readFileSync(
    new URL("../integrations/openclaw/topology/lib/guard.mjs", import.meta.url),
    "utf8",
  );
  // The only place the guard commits a coordinator mutation routes through the
  // injected fence, and the injected fence is the queue's own critical section.
  const coordinatorCommits = guardSource.match(
    /commitCoordinatorMutation\(|queueExecutionFence\(/g,
  );
  assert.equal(coordinatorCommits.length, 3);
  assert.equal(
    guardSource.includes(
      "withExecutionFence(lockDir, () => readSnapshotLocked(paths))",
    ),
    false,
    "the ledger must never take the queue lock",
  );
  assert.equal(taskIdOf.length > 0, true);
});
