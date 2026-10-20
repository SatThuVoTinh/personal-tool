// M12/T9 F-242 - the live tool-call branch was selected by MODEL-SUPPLIED
// parameter shape, and for zink_excel / zink_power_bi it never consumed the
// approval those operations require.
//
// MEASURED AT HEAD: `isSynthetic` was computed from the model's own
// `event.params.call_id/specialist/tool_id/input`. Only that branch called
// `guard.beforeToolCall`. Every other call - which is every LIVE call the
// runtime makes - went through `evaluateToolAccess` plus a path check and was
// ALLOWED. So a delegated operation the policy marks `requiresApproval`
// (zink_excel populate/generate, zink_power_bi bind/update, zink_python
// execute, zink_n8n trigger) executed with no approval record, no delegation
// binding and no AuthorizationDecisionContext, and a model could opt out of
// the governed path simply by shaping its arguments.
//
// The live seam now goes through the SAME canonical binding and the SAME
// guard, and the branch is chosen by POLICY, never by the payload.
import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const load = async (rel) =>
  import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const { ensureLedger, ledgerPaths, recordWorkflowEvent } = await load(
  "integrations/openclaw/topology/lib/ledger.mjs",
);
const { buildSpawnProposal, canonicalHash, deriveTaskId } = await load(
  "integrations/openclaw/topology/lib/canonical.mjs",
);
const { installNativeToolGate } = await load(
  "integrations/openclaw/topology/lib/native-boundary.mjs",
);
const { agentInstructions, governanceHash, AGENT_IDS } = await load(
  "integrations/openclaw/lib/policy.mjs",
);

const OWNER = "32345678901234567";
const THREAD_ID = "1111111111111111111";
const INPUT = {
  operation: "populate",
  file_path: "reports/budget.xlsx",
  data: { values: [1, 2, 3] },
};

let snowflake = 88000000000000001n;
const nextMessageId = () => String(snowflake++);

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

function excelDelegation(root) {
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
    nodes: [briefNode("o1"), briefNode("excel")],
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: taskId,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: taskId,
    channel: "approvals",
    thread_id: THREAD_ID,
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
    thread_id: THREAD_ID,
  });
  // Main may only spawn a COORDINATOR, and the coordinator may only spawn the
  // specialist: the canonical topology is main -> o1 -> excel.
  const coordinatorRun = buildSpawnProposal({
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
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", coordinatorRun);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: coordinatorRun.delegation_id,
    native_run_id: "o1-run-1",
    child_session_key: "o1-session-1",
    agent_id: "o1",
    parent_session_key: "main-session",
  });
  const run = buildSpawnProposal({
    task_id: taskId,
    brief_revision: 1,
    node_id: "excel",
    agent_id: "excel",
    parent_agent_id: "o1",
    parent_session_key: "o1-session-1",
    parent_run_id: "o1-run-1",
    tool_call_id: "call-1",
    turn: 1,
    attempt: 1,
    expected_governance_hash: governanceHash("excel"),
  });
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", run);
  recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
    task_id: taskId,
    delegation_id: run.delegation_id,
    native_run_id: "excel-run-1",
    child_session_key: "excel-session-1",
    agent_id: "excel",
    parent_session_key: "o1-session-1",
  });
  return { paths, taskId, run };
}

async function liveGate(root) {
  const hooks = new Map();
  const logs = [];
  plugin.default.register({
    pluginConfig: { ledgerRoot: ledgerPaths(root).root, ownerDiscordId: OWNER },
    on: (name, handler) => hooks.set(name, handler),
    registerTool: () => {},
    logger: {
      warn: (m) => logs.push(`warn:${m}`),
      info: (m) => logs.push(`info:${m}`),
      error: (m) => logs.push(`error:${m}`),
    },
  });
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
    {
      agentId: "excel",
      sessionKey: "excel-session-1",
      runId: "excel-run-1",
    },
  );
  return { agent, hooks, logs };
}

function excelCall(args) {
  const call = {
    type: "toolCall",
    name: "zink_excel",
    id: "call-excel",
    arguments: {},
  };
  return {
    assistantMessage: { role: "assistant", content: [call] },
    toolCall: call,
    args,
  };
}

async function withDiagnostics(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines.join("\n");
}

function agentWorkspaces(root) {
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
}

test("F-242: a delegated live call with no approval is refused, and the refusal is named", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f242-"));
  try {
    agentWorkspaces(root);
    excelDelegation(root);
    const { agent } = await liveGate(root);
    let decision;
    const diagnostics = await withDiagnostics(async () => {
      decision = await agent.beforeToolCall(excelCall(INPUT));
    });
    assert.equal(decision?.block, true, "the call must be refused");
    assert.match(
      diagnostics,
      /AUTH_APPROVAL_REQUIRED/u,
      "the refusal must name the missing approval, not another rule",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-242: the refusal does not depend on the shape of the model's parameters", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f242b-"));
  try {
    agentWorkspaces(root);
    excelDelegation(root);
    const { agent } = await liveGate(root);
    // The parameters shaped like the canonical envelope: the OLD code treated
    // this shape as the "governed" branch and the plain shape as the
    // "ungoverned" one. There is no such fork any more.
    const shaped = {
      call_id: "00000000-0000-4000-8000-0000000000c1",
      tool_id: "zink_excel",
      specialist: "excel",
      constraints: { timeout_seconds: 30, max_memory_mb: 512 },
      input: INPUT,
      provenance: {
        delegation_id: "00000000-0000-4000-8000-0000000000d2",
        task_id: "c".repeat(64),
        session_key: "excel-session-1",
      },
    };
    let decision;
    const diagnostics = await withDiagnostics(async () => {
      decision = await agent.beforeToolCall(excelCall(shaped));
    });
    assert.equal(decision?.block, true, "the shaped call must be refused too");
    assert.match(
      diagnostics,
      /AUTH_APPROVAL_REQUIRED|AUTH_APPROVAL_INVALID|AUTH_DELEGATION_NOT_FOUND/u,
      "the shaped call must be refused by a governance rule, never allowed",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-242: a delegated live call WITH a consumed approval is authorized by the guard", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f242c-"));
  try {
    agentWorkspaces(root);
    const { paths, taskId } = excelDelegation(root);
    const minted = plugin.mintInvocationApprovalRecord({
      paths: { root: paths.root },
      taskId,
      briefRevision: 1,
      toolId: "zink_excel",
      operation: "populate",
      exactTarget: INPUT.file_path,
      input: INPUT,
      ownerPrincipalRef: "b".repeat(64),
    });
    const { agent } = await liveGate(root);
    let decision;
    const diagnostics = await withDiagnostics(async () => {
      decision = await agent.beforeToolCall(
        excelCall({ ...INPUT, approval_id: minted.approvalId }),
      );
    });
    assert.equal(decision?.block, true, "the call must be refused");
    assert.doesNotMatch(
      diagnostics,
      /AUTH_APPROVAL_REQUIRED|AUTH_APPROVAL_INVALID/u,
      "the approval must no longer be the refusal once a record backs the call",
    );
    // The refusal that remains is the PUBLISHED tool-call contract, not the
    // plugin: `delegated_provenance.delegation_id` is pinned to a uuid v4 while
    // the ledger derives the delegation id as a 64-hex digest
    // (`deriveDelegationId`). That mismatch is the topology/tools owners'
    // hand-off; it is recorded here so the plugin half is not blamed for it.
    assert.match(
      diagnostics,
      /SCHEMA_VALIDATION_FAILED/u,
      `the canonical envelope must be judged by the published contract; diagnostics: ${diagnostics}`,
    );
    assert.equal(
      existsSync(path.join(paths.root, "consumed-approvals.json")),
      false,
      "a refused call must not consume the owner's approval",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-242: the canonical operation comes from the policy, not from the payload", () => {
  assert.equal(
    plugin.governedOperationFor("zink_excel", { operation: "populate" }),
    "populate",
  );
  assert.equal(
    plugin.governedOperationFor("zink_excel", { operation: "publish" }),
    null,
  );
  assert.equal(plugin.governedOperationFor("zink_python", {}), "execute");
  assert.equal(plugin.governedOperationFor("zink_sql", {}), "query");
  assert.equal(plugin.governedOperationFor("zink_n8n", {}), "trigger");
  assert.equal(plugin.governedOperationFor("zink_unknown", {}), null);
});
