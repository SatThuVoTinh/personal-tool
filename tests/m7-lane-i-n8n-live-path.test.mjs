import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import governancePlugin from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import {
  installNativeToolGate,
  POLICY_REFUSAL_TEXT,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  resolveN8nInvocation,
  bindInvocationApproval,
  whenGovernanceDependenciesReady,
} from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  buildSpawnProposal,
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  agentInstructions,
  governanceHash,
  N8N_WORKFLOW_REGISTRY,
  AGENT_IDS,
} from "../integrations/openclaw/lib/policy.mjs";

const OWNER = "32345678901234567";

let snowflake = 88000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-n8n-"));
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

/**
 * A task whose live delegation is a python run on the data_plant stack with
 * `zink_n8n` inside its own recorded allowlist. This is the only shape in
 * which a live n8n trigger is admissible at all.
 */
function n8nLiveDelegation(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
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
    nodes: [{ ...briefNode("o2"), stack_id: "intelligence" }],
  });
  // M7-020: a spawn reservation creates governed work, so the owner
  // approval is recorded first.
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });

  // o2 is the canonical n8n caller under the delegation tool policy.
  const run = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "o2",
    agent_id: "o2",
    parent_agent_id: "main",
    parent_session_key: "main-session",
    parent_run_id: "main-run",
    tool_call_id: "call-0",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("o2"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", run);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: run.delegation_id,
    native_run_id: "o2-run-1",
    child_session_key: "o2-session-1",
    agent_id: "o2",
    parent_session_key: "main-session",
  });
  return { paths, taskId, run };
}

async function registerPlugin(root) {
  const hooks = new Map();
  const logs = [];
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
  governancePlugin.register({
    pluginConfig: { ledgerRoot: ledgerPaths(root).root, ownerDiscordId: OWNER },
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

const SIGNAL = new globalThis.AbortController().signal;

const liveCall = (workflowId, extra = {}) => {
  const call = {
    type: "toolCall",
    name: "zink_n8n",
    id: "call-n8n",
    arguments: {},
  };
  return {
    assistantMessage: { role: "assistant", content: [call] },
    toolCall: call,
    args: { workflow_id: workflowId, ...extra },
  };
};

describe("M7-006 — the canonical n8n invocation decision", () => {
  it("resolves a registered workflow for an allowed agent", async () => {
    // The registry and operation policy are loaded when the guard is built, so
    // the plugin is registered first and the policy load is awaited: this
    // exercises the same loaded state the live path uses.
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      await registerPlugin(root);
      await whenGovernanceDependenciesReady();
      const workflowId = Object.keys(N8N_WORKFLOW_REGISTRY).find((id) =>
        N8N_WORKFLOW_REGISTRY[id].allowedAgents.includes("python"),
      );
      assert.ok(
        workflowId,
        "the registry must expose a python-triggerable flow",
      );
      const invocation = resolveN8nInvocation({
        workflowId,
        agentId: "python",
      });
      assert.equal(invocation.workflowId, workflowId);
      assert.equal(invocation.operationName, "trigger");
      assert.equal(invocation.actualTarget, workflowId);
      assert.equal(typeof invocation.requiresApproval, "boolean");
      assert.equal(
        invocation.timeoutMs,
        N8N_WORKFLOW_REGISTRY[workflowId].timeoutMs,
      );
      // Frozen: a caller cannot rewrite the decision it was handed.
      assert.equal(Object.isFrozen(invocation), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an unknown workflow id is a capability mismatch, not a pass", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      await registerPlugin(root);
      await whenGovernanceDependenciesReady();
      for (const bad of ["not-a-workflow", "", null, undefined, 42, {}]) {
        assert.throws(
          () => resolveN8nInvocation({ workflowId: bad, agentId: "python" }),
          (err) => {
            assert.equal(err?.message, "RUNTIME_CAPABILITY_MISMATCH");
            return true;
          },
          `workflow_id ${JSON.stringify(bad)} must be denied`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an agent outside the workflow allowlist is denied", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      await registerPlugin(root);
      await whenGovernanceDependenciesReady();
      const workflowId = Object.keys(N8N_WORKFLOW_REGISTRY).find((id) =>
        N8N_WORKFLOW_REGISTRY[id].allowedAgents.includes("python"),
      );
      assert.ok(workflowId);
      for (const agentId of AGENT_IDS) {
        if (N8N_WORKFLOW_REGISTRY[workflowId].allowedAgents.includes(agentId))
          continue;
        assert.throws(
          () => resolveN8nInvocation({ workflowId, agentId }),
          { message: "AUTH_POLICY_DENIED" },
          `${agentId} must be denied ${workflowId}`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the approval binding fails closed without a bound approval", async () => {
    const root = fixture();
    try {
      const { paths, taskId } = n8nLiveDelegation(root);
      const base = {
        paths,
        taskId,
        briefRevision: 1,
        originPrincipalRef: "b".repeat(64),
        toolId: "zink_n8n",
        operationName: "trigger",
        actualTarget: "data_plant_ingest",
        input: { workflow_id: "data_plant_ingest" },
        runId: "python-run-1",
        currentTime: Date.now(),
      };
      // No approval at all.
      assert.throws(() => bindInvocationApproval(base), {
        message: "AUTH_APPROVAL_REQUIRED",
      });
      // A malformed approval id.
      for (const bad of ["not-a-uuid", "1234", ""]) {
        assert.throws(
          () => bindInvocationApproval({ ...base, approvalId: bad }),
          { message: "AUTH_APPROVAL_INVALID" },
        );
      }
      // A well-formed id that no approval record backs.
      assert.throws(
        () =>
          bindInvocationApproval({
            ...base,
            approvalId: "11111111-1111-4111-8111-111111111111",
          }),
        { message: "AUTH_APPROVAL_INVALID" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M7-006 — the live n8n path enforces the canonical controls", () => {
  /**
   * The live tool branch is reached through the real host boundary, exactly as
   * OpenClaw reaches it: the plugin registers its guard, and the native gate
   * dispatches the tool call into it. o2 is the canonical n8n caller.
   */
  async function liveGate(root, agentId, sessionKey, runId) {
    await registerPlugin(root);
    await whenGovernanceDependenciesReady();
    const agent = {};
    installNativeToolGate(
      agent,
      {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: true,
              config: { ledgerRoot: ledgerPaths(root).root },
            },
          },
        },
      },
      { agentId, sessionKey, runId },
    );
    return agent;
  }

  it("an unregistered workflow id is refused with the canonical code", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      const agent = await liveGate(root, "o2", "o2-session-1", "o2-run-1");
      let decision;
      const diagnostics = await withDiagnostics(async () => {
        decision = await agent.beforeToolCall(
          liveCall("totally-unknown-flow"),
          SIGNAL,
        );
      });
      assert.equal(decision.block, true);
      assert.equal(
        decision.reason,
        POLICY_REFUSAL_TEXT,
        "an unregistered workflow id must be a capability mismatch",
      );
      assert.match(
        diagnostics,
        /RUNTIME_CAPABILITY_MISMATCH/u,
        "the titled rule must be the one that fired, not merely some refusal",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("every registered workflow is refused without a bound approval", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      const agent = await liveGate(root, "o2", "o2-session-1", "o2-run-1");
      for (const id of Object.keys(N8N_WORKFLOW_REGISTRY)) {
        let decision;
        const diagnostics = await withDiagnostics(async () => {
          decision = await agent.beforeToolCall(liveCall(id), SIGNAL);
        });
        assert.equal(decision.block, true, `${id} must be refused`);
        assert.equal(
          decision.reason,
          POLICY_REFUSAL_TEXT,
          `${id} must require a bound approval`,
        );
        assert.match(
          diagnostics,
          /AUTH_APPROVAL_REQUIRED/u,
          `${id} must be refused for the missing approval, not by another rule`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a malformed or unbacked approval id is refused, not ignored", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      const agent = await liveGate(root, "o2", "o2-session-1", "o2-run-1");
      for (const approvalId of [
        "not-a-uuid",
        "1234",
        "11111111-1111-4111-8111-111111111111",
      ]) {
        let decision;
        const diagnostics = await withDiagnostics(async () => {
          decision = await agent.beforeToolCall(
            liveCall("data_plant_ingest", { approval_id: approvalId }),
            SIGNAL,
          );
        });
        assert.equal(decision.block, true, approvalId);
        assert.equal(decision.reason, POLICY_REFUSAL_TEXT, approvalId);
        assert.match(
          diagnostics,
          /AUTH_APPROVAL_INVALID/u,
          `${approvalId} must be refused as an invalid approval, not by another rule`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an agent without n8n capability is refused before the registry", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      // python holds no n8n capability, and the ledger owns no python run in
      // this fixture, so the refusal happens at the delegation boundary and
      // never reaches the registry. The invariant is that it is refused.
      const agent = await liveGate(
        root,
        "python",
        "python-session-1",
        "python-run-1",
      );
      let decision;
      const diagnostics = await withDiagnostics(async () => {
        decision = await agent.beforeToolCall(
          liveCall("data_plant_ingest"),
          SIGNAL,
        );
      });
      // The refusal is unchanged; the reason the host receives is NOT. M10/T2-R8:
      // the host writes a block reason into the tool result the MODEL reads, so
      // the model-visible reason is a plain refusal and the canonical
      // AUTH_DELEGATION_NOT_FOUND code stays in the diagnostic channel.
      assert.equal(decision.block, true);
      assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
      assert.match(
        diagnostics,
        /AUTH_DELEGATION_NOT_FOUND/u,
        "the delegation rule must be the one that fired",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a root session with no delegation cannot trigger a workflow", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      const agent = await liveGate(root, "main", "main-session", "main-run");
      let decision;
      const diagnostics = await withDiagnostics(async () => {
        decision = await agent.beforeToolCall(
          liveCall("data_plant_ingest"),
          SIGNAL,
        );
      });
      assert.equal(decision.block, true);
      assert.match(
        diagnostics,
        /DELEGATION_REQUIRED/u,
        "a root session has no delegation, and that is the rule that must fire",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an unknown session or run identity is refused", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      for (const [sessionKey, runId] of [
        ["not-a-session", "o2-run-1"],
        ["o2-session-1", "not-a-run"],
      ]) {
        const agent = await liveGate(root, "o2", sessionKey, runId);
        let decision;
        const diagnostics = await withDiagnostics(async () => {
          decision = await agent.beforeToolCall(
            liveCall("data_plant_ingest"),
            SIGNAL,
          );
        });
        assert.equal(decision.block, true, `${sessionKey}/${runId}`);
        assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
        assert.match(
          diagnostics,
          /AUTH_DELEGATION_NOT_FOUND/u,
          `${sessionKey}/${runId} must be refused by the delegation rule`,
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the guarded path and the live path agree on every registry decision", async () => {
    const root = fixture();
    try {
      n8nLiveDelegation(root);
      await registerPlugin(root);
      await whenGovernanceDependenciesReady();
      // One decision function, so the two paths cannot diverge. The registry
      // outcome for a given (workflow, agent) pair is identical regardless of
      // which path asks.
      for (const [workflowId, def] of Object.entries(N8N_WORKFLOW_REGISTRY)) {
        for (const agentId of AGENT_IDS) {
          let outcome = "allow";
          try {
            resolveN8nInvocation({ workflowId, agentId });
          } catch (err) {
            outcome = err?.message;
          }
          assert.equal(
            def.allowedAgents.includes(agentId),
            outcome === "allow",
            `${agentId} -> ${workflowId} must agree with the registry`,
          );
        }
        // The trigger operation always requires approval, so the live path can
        // never treat an n8n trigger as approval-free.
        const decision = resolveN8nInvocation({
          workflowId,
          agentId: def.allowedAgents[0],
        });
        assert.equal(decision.requiresApproval, true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// =========================================================================
// M12/T9 F-024 — two resolvers for the same governance dependencies
// disagreed, and the live one pointed at an incomplete hand-seeded tree.
//
// The readiness flag used to be set UNCONDITIONALLY, so `ready: true` was
// reported while the SQL validator was still null and the guard-gated tools
// failed closed as GOVERNANCE_DEPENDENCY_MISSING.
// =========================================================================
describe("M12/T9 F-024 — one resolver, and a readiness flag that means something", () => {
  it("F-024: ready is exactly the conjunction of the three loaded modules", async () => {
    const status = await whenGovernanceDependenciesReady();
    assert.equal(
      status.ready,
      status.pathSafetyLoaded === true &&
        status.sqlLoaded === true &&
        status.n8nLoaded === true,
      "ready must be the conjunction of the three loaded flags",
    );
    // The rule itself, provable without a broken installation.
    assert.equal(
      computeGovernanceReadiness({
        pathSafetyLoaded: true,
        sqlLoaded: true,
        n8nLoaded: true,
      }),
      true,
    );
    for (const missing of ["pathSafetyLoaded", "sqlLoaded", "n8nLoaded"]) {
      const flags = {
        pathSafetyLoaded: true,
        sqlLoaded: true,
        n8nLoaded: true,
        [missing]: false,
      };
      assert.equal(
        computeGovernanceReadiness(flags),
        false,
        `a missing ${missing} must NOT be reported as ready`,
      );
    }
  });

  it("F-024: the shared module resolves to ONE file, not a second copy", () => {
    const resolved = resolveSharedGovernanceModulePath(
      "zink-tools/sql/validator.mjs",
    );
    assert.ok(resolved, "the shared SQL validator must resolve");
    assert.match(resolved, /zink-tools[\\/]sql[\\/]validator\.mjs$/u);
    // The same resolver, asked with the repository root, must land on the
    // SAME file — one mechanism, one copy.
    assert.equal(
      resolveSharedGovernanceModulePath("zink-tools/sql/validator.mjs", {
        roots: [process.cwd()],
      }),
      resolved,
    );
  });
});
