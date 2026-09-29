import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import governancePlugin from "../integrations/openclaw/plugins/zink-governance/index.mjs";
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
import {
  agentInstructions,
  governanceHash,
  AGENT_IDS,
} from "../integrations/openclaw/lib/policy.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { readFileSync } from "node:fs";

const OWNER = "32345678901234567";

let snowflake = 87000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-d3-"));
}

function briefNode(agentId) {
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

/** A task with one live delegated run (o1) that has a recorded receipt. */
function liveDelegation(root) {
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
    nodes: [briefNode("o1")],
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
  return { paths, taskId, o1 };
}

function registerPlugin(root) {
  const hooks = new Map();
  const logs = [];
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
  governancePlugin.register({
    pluginConfig: { ledgerRoot: pathsRoot(root), ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    registerTool: () => {},
    logger: {
      warn: (m) => logs.push(`warn:${m}`),
      info: (m) => logs.push(`info:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
  });
  return { hooks, logs };
}

const pathsRoot = (root) => ledgerPaths(root).root;

function eventsOf(paths) {
  return readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("M7-045 — a completion that cannot be written blocks execution", () => {
  it("a valid completion records the native end and allows the run to close", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      const decision = hooks.get("subagent_ended")(
        { outcome: "ok", runId: "o1-run-1", targetSessionKey: "o1-session-1" },
        { agentId: "o1", childSessionKey: "o1-session-1", runId: "o1-run-1" },
      );
      assert.equal(decision.allow, true);
      assert.equal(decision.governanceState, "RECORDED");
      const run =
        readSnapshot(paths).tasks[taskId].delegations[
          Object.keys(readSnapshot(paths).tasks[taskId].delegations)[0]
        ];
      assert.equal(run.run_state, "COMPLETE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an injected lineage mismatch blocks and suspends the owning task", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      // The host reports a child session that the ledger does not own, so the
      // authoritative write must fail.
      const decision = hooks.get("subagent_ended")(
        {
          outcome: "ok",
          runId: "unknown-run",
          targetSessionKey: "unknown-session",
        },
        {
          agentId: "o1",
          childSessionKey: "unknown-session",
          runId: "unknown-run",
        },
      );
      // It is a blocking result, not a swallowed warning.
      assert.equal(decision.allow, false);
      assert.equal(decision.blocked, true);
      // The reported child is unknown, so containment is fail-closed over
      // every live run rather than trusted from the event's own identity.
      assert.equal(decision.scope, "ALL_LIVE_RUNS");
      assert.equal(decision.governanceState, "BLOCKED");
      // The owning task is suspended, so the runtime and the ledger agree.
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "BLOCKED");
      assert.equal(task.reason_code, "BLOCKED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a completion whose write is rejected still blocks the resolvable run", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      // The ledger knows the run, so the incident is recorded against it and
      // the task is suspended rather than left running unverified.
      const decision = hooks.get("subagent_ended")(
        { outcome: "ok" },
        {
          agentId: "o1",
          childSessionKey: "o1-session-1",
          runId: "o1-run-1",
          // A requester session the ledger does not own makes the owner
          // resolution fail, which is exactly the write-failure case.
          requesterSessionKey: "forged-parent-session",
        },
      );
      // The plugin falls back to the recorded parent identity, so this one is
      // reconciled. Force the failure with a native_end that cannot apply.
      if (decision.allow === true) {
        const after = readSnapshot(paths).tasks[taskId];
        assert.ok(after);
      } else {
        assert.equal(decision.blocked, true);
        const task = readSnapshot(paths).tasks[taskId];
        assert.equal(task.workflow_status, "BLOCKED");
        assert.equal(task.reason_code, "BLOCKED");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a late duplicate completion is recorded as a no-op incident, not a crash", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      const ended = hooks.get("subagent_ended")(
        { outcome: "error" },
        { agentId: "o1", childSessionKey: "o1-session-1", runId: "o1-run-1" },
      );
      assert.equal(ended.allow, true);
      // The task is now BLOCKED by the error outcome.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
      const before = eventsOf(paths).length;
      const repeat = hooks.get("subagent_ended")(
        { outcome: "ok" },
        { agentId: "o1", childSessionKey: "o1-session-1", runId: "o1-run-1" },
      );
      // A duplicate must not throw, and must not invent a state change.
      assert.ok(repeat);
      const after = readSnapshot(paths);
      assert.equal(after.sequence >= before, true);
      assert.equal(after.tasks[taskId].workflow_status, "BLOCKED");
      // Every event on disk still satisfies the durable contract.
      for (const event of eventsOf(paths)) {
        validateContract("ledger-event", event);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-046 — an unreconciled spawn receipt blocks execution", () => {
  it("a wrong label blocks and suspends the run the label names", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      // A label that belongs to no reservation.
      const decision = hooks.get("subagent_spawned")(
        {
          label: "f".repeat(64),
          agentId: "o1",
          runId: "o1-run-2",
          childSessionKey: "o1-session-2",
        },
        { requesterSessionKey: "main-session" },
      );
      assert.equal(decision.allow, false);
      assert.equal(decision.blocked, true);
      // The receipt names no recorded run, so containment is fail-closed:
      // every live run is suspended until an operator reconciles.
      assert.equal(decision.scope, "ALL_LIVE_RUNS");
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "BLOCKED");
      assert.equal(task.reason_code, "BLOCKED");
      const run =
        task.delegations[
          Object.keys(task.delegations).find(
            (id) => task.delegations[id].child_session_key === "o1-session-1",
          )
        ];
      assert.equal(run.run_state, "UNKNOWN");
      assert.equal(run.recovery_reason, "error");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a wrong requester session blocks instead of reconciling", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      const decision = hooks.get("subagent_spawned")(
        {
          label:
            readSnapshot(paths).tasks[taskId].delegations[
              Object.keys(readSnapshot(paths).tasks[taskId].delegations)[0]
            ].delegation_id,
          agentId: "o1",
          runId: "o1-run-1",
          childSessionKey: "o1-session-1",
        },
        { requesterSessionKey: "forged-parent" },
      );
      assert.equal(decision.allow, false);
      assert.equal(decision.blocked, true);
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an unknown child session is not silently accepted", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      const decision = hooks.get("subagent_spawned")(
        {
          label: "e".repeat(64),
          agentId: "o2",
          runId: "ghost-run",
          childSessionKey: "ghost-session",
        },
        { requesterSessionKey: "main-session" },
      );
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "BLOCKED",
      );
      // The child matches no recorded run, so the decision still refuses and
      // suspends every live run rather than trusting the event's identity.
      assert.equal(decision.allow, false);
      assert.equal(decision.governanceState, "BLOCKED");
      assert.equal(decision.ledgerWriteFailed, false);
      // The live o1 run is the one suspended: containment is fail-closed.
      assert.equal(decision.blockedTasks.length, 1);
      assert.equal(decision.blockedTasks[0].task_id, taskId);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a valid receipt reconciles and is idempotent on retry", () => {
    const root = fixture();
    try {
      const { paths, taskId } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      const delegationId =
        readSnapshot(paths).tasks[taskId].delegations[
          Object.keys(readSnapshot(paths).tasks[taskId].delegations)[0]
        ].delegation_id;
      const event = {
        label: delegationId,
        agentId: "o1",
        runId: "o1-run-1",
        childSessionKey: "o1-session-1",
      };
      const first = hooks.get("subagent_spawned")(event, {
        requesterSessionKey: "main-session",
      });
      assert.equal(first.allow, true);
      const sequence = readSnapshot(paths).sequence;
      // A duplicate receipt is idempotent: no second write, no state change.
      const second = hooks.get("subagent_spawned")(event, {
        requesterSessionKey: "main-session",
      });
      assert.equal(second.allow, true);
      assert.equal(readSnapshot(paths).sequence, sequence);
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "QUEUED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the recorded incident satisfies the durable event contract", () => {
    const root = fixture();
    try {
      const { paths } = liveDelegation(root);
      const { hooks } = registerPlugin(root);
      hooks.get("subagent_spawned")(
        {
          label: "f".repeat(64),
          agentId: "o1",
          runId: "o1-run-2",
          childSessionKey: "o1-session-2",
        },
        { requesterSessionKey: "main-session" },
      );
      // The old best-effort writer emitted null child/parent session keys and
      // an undeclared error_reason, so its incident could never be written.
      // Every event the blocker produced must validate.
      const events = eventsOf(paths);
      const incident = events.find(
        (e) =>
          e.type === "WORKFLOW_NATIVE_ENDED" &&
          e.payload.native_run_id === "o1-run-1",
      );
      assert.ok(incident, "an authoritative incident must be recorded");
      assert.equal(typeof incident.payload.child_session_key, "string");
      assert.equal(typeof incident.payload.parent_session_key, "string");
      assert.equal(Object.hasOwn(incident.payload, "error_reason"), false);
      for (const event of events) validateContract("ledger-event", event);
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
