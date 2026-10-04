// Trusted operator probe. Never prints prompts, raw RPC results, IDs or auth.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { execFileBounded, resolveGatewayToken } from "../../../verify.mjs";
import {
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../../lib/ledger.mjs";
import {
  deriveTaskId,
  SCHEMA_VERSION,
  GOVERNANCE_VERSION,
} from "../../lib/canonical.mjs";
import {
  checkNativePatch,
  NATIVE_DISCORD_CHANNEL_RELATIVE,
} from "../../lib/native-patch.mjs";
import { validateContract } from "../../lib/schema.mjs";

const stateDir = "/home/hoang_vinh/.openclaw-zink";
const runtimeRoot = "/home/hoang_vinh/.local/lib/node_modules/openclaw";
const executable = "/home/hoang_vinh/.local/bin/openclaw";
const environment = {
  ...process.env,
  // The password-store resolver has a portable /usr/bin/env node shebang.
  // Operator probes run outside the systemd service environment, so supply a
  // minimal WSL executable PATH without inheriting an arbitrary host PATH.
  PATH: "/home/hoang_vinh/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  OPENCLAW_PROFILE: "zink",
  OPENCLAW_STATE_DIR: stateDir,
  PASSWORD_STORE_DIR: path.join(stateDir, "secrets/password-store"),
  GNUPGHOME: path.join(stateDir, "secrets/gnupg"),
};
const paths = ledgerPaths(stateDir);
let stage = "native-patch";
try {
  checkNativePatch({
    runtimeRoot,
    discordChannelRoot: path.join(stateDir, NATIVE_DISCORD_CHANNEL_RELATIVE),
  });
  stage = "gateway-auth";
  environment.OPENCLAW_GATEWAY_TOKEN = await resolveGatewayToken(
    path.join(stateDir, "bin/openclaw-pass-resolver"),
    environment,
  );
  const rpc = async (method, params, final = false) => {
    const args = [
      "--profile",
      "zink",
      "gateway",
      "call",
      method,
      "--params",
      JSON.stringify(params),
      "--json",
      "--timeout",
      final ? "300000" : "45000",
      ...(final ? ["--expect-final"] : []),
    ];
    const { stdout } = await execFileBounded(executable, args, {
      env: environment,
      timeout: final ? 305000 : 50000,
      maxBuffer: 262144,
    });
    return JSON.parse(stdout);
  };
  stage = "gateway-health";
  await rpc("health", {});
  const payload = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    outcome_claim: "COMPLETE",
    reason_claim: "NONE",
    output: "Synthetic check complete",
    assumptions: [],
    limitations: [],
    requested_prerequisites: [],
    agent_self_validation: "Synthetic schema-only check",
  };
  const openFixture = (agentId) => {
    const runId = randomUUID();
    const sessionKey = `agent:${agentId}:zink-r12-probe-${runId}`;
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: String(900000000000000000n + BigInt(Date.now())),
    };
    const task_id = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id,
      root_agent_id: agentId,
      root_session_key: sessionKey,
      root_run_id: runId,
    });
    return { ...origin, task_id, runId, sessionKey };
  };
  const manifests = JSON.parse(
    readFileSync(
      path.join(
        stateDir,
        "extensions/zink-governance/governance-manifests.json",
      ),
      "utf8",
    ),
  );
  const checkTools = async (agentId, sessionKey) => {
    const inventory = await rpc("tools.effective", { agentId, sessionKey });
    // Runtime projection shape is deliberately strict; no guessed fallback.
    assert.ok(Array.isArray(inventory.groups), "INVENTORY_SHAPE_MISMATCH");
    assert.deepEqual(
      inventory.groups
        .flatMap((group) => group.tools.map((tool) => tool.id))
        .sort(),
      [...manifests[agentId].allowed_tools].sort(),
    );
  };
  for (const agentId of [
    "main",
    "o1",
    "o2",
    "excel",
    "power-bi",
    "sql",
    "python",
  ]) {
    stage = `direct-${agentId}`;
    const fixture = openFixture(agentId);
    await rpc(
      "agent",
      {
        agentId,
        sessionKey: fixture.sessionKey,
        idempotencyKey: fixture.runId,
        deliver: false,
        message: `Synthetic governance regression only. No tools required. Return exactly this JSON, without markdown or extra text: ${JSON.stringify(payload)}`,
        timeout: 300,
      },
      true,
    );
    assert.equal(
      readSnapshot(paths).tasks[fixture.task_id].workflow_status,
      "COMPLETE",
    );
    await checkTools(agentId, fixture.sessionKey);
    process.stdout.write(`${JSON.stringify({ stage, status: "PASS" })}\n`);
    await delay(6000);
  }
  await delay(60000);
  stage = "nested-seven-role-matrix";
  const fixture = openFixture("main");
  const leafInput = "Synthetic leaf execution. Return COMPLETE outcome.";
  const constraints = "Synthetic only; no external access";
  const validation_criteria = "agent-result-payload.schema.json";
  const coordinatorInput = (children) =>
    `Delegate each of these independent nodes to the same-named agent: ${children.join(", ")}. For every child use inputs "${leafInput}", constraints "${constraints}", validation_criteria "${validation_criteria}", and empty input_refs. Use the semantic proposal contract and frozen native spawn fields with runtime="subagent", mode="run", thread=false, context="isolated", sandbox="require", cleanup="keep". Turn 1: call sessions_spawn for both children. Turn 2: call sessions_yield once. In subsequent turns when subagent completions arrive: NEVER call sessions_yield or any other tool. Check your previous assistant message in the conversation: If it was Turn yielded or a tool call, this is your first child completion: reply ONLY with First child done. If it was First child done, both children are now complete: you MUST emit your final completion claim JSON with schema_version 1.0.0, governance_version m7-t2-r12, outcome_claim COMPLETE, reason_claim NONE, output Synthetic coordinator complete, empty arrays, and agent_self_validation Synthetic coordinator check. Do not create another brief.`;
  const nodes = [
    {
      id: "o1",
      stack: "semantic",
      dependencies: [],
      children: ["python", "power-bi"],
    },
    {
      id: "o2",
      stack: "data_plant",
      dependencies: ["o1"],
      children: ["sql", "excel"],
    },
  ].flatMap(({ id, stack, dependencies, children }) => [
    {
      node_id: id,
      agent_id: id,
      stack_id: stack,
      dependencies,
      required: true,
      inputs: coordinatorInput(children),
      constraints,
      validation_criteria,
    },
    ...children.map((child) => ({
      node_id: child,
      agent_id: child,
      stack_id: stack,
      dependencies,
      required: true,
      inputs: leafInput,
      constraints,
      validation_criteria,
    })),
  ]);
  const brief = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    task_id: fixture.task_id,
    brief_revision: 1,
    workflow_status: "ACTIVE",
    brief_state: "ACTIVE",
    origin: fixture.origin,
    origin_principal_ref: fixture.origin_principal_ref,
    origin_message_id: fixture.origin_message_id,
    inputs: "Synthetic nested schema check",
    input_refs: [],
    semantic_contract_status: "MISSING",
    dataset_validation_status: "MISSING",
    mandatory_decision_evidence: [],
    nodes,
  };
  validateContract("execution-brief", brief);
  await rpc(
    "agent",
    {
      agentId: "main",
      sessionKey: fixture.sessionKey,
      idempotencyKey: fixture.runId,
      deliver: false,
      message: `Synthetic nested regression.
Turn 1: You must emit this exact execution brief as assistant text in the same turn before calling sessions_spawn: ${JSON.stringify(brief)}. Call sessions_spawn to spawn o1 for node o1 with runtime="subagent", mode="run", thread=false, context="isolated", sandbox="require", cleanup="keep", and task set to the JSON string of the exact planned inputs/constraints/validation and no input refs.
Turn 2: Call sessions_yield once to wait for o1.
Turn 3 (when o1 completes): Authorize cross-stack handoff by calling sessions_spawn to spawn o2 for node o2 with runtime="subagent", mode="run", thread=false, context="isolated", sandbox="require", cleanup="keep", and task set to the JSON string of the exact planned inputs/constraints/validation and no input refs.
Turn 4: Call sessions_yield once to wait for o2.
Turn 5 (when o2 completes): Never call sessions_yield. Return exactly this JSON completion payload without markdown or extra text: ${JSON.stringify(payload)}.
Never directly spawn any specialist. Use the frozen native fields and semantic proposal schema.`,
      timeout: 300,
    },
    false,
  );
  const deadline = Date.now() + 300000;
  let task;
  do {
    task = readSnapshot(paths).tasks[fixture.task_id];
    if (task.workflow_status !== "ACTIVE") break;
    await delay(1000);
  } while (Date.now() < deadline);
  assert.equal(task.workflow_status, "COMPLETE");
  assert.equal(task.delegated_runs_used, 6);
  assert.equal(task.transitions_used, 1);
  for (const run of Object.values(task.delegations)) {
    assert.equal(run.accepted_outcome_status, "COMPLETE");
    assert.ok(run.accepted_payload_digest);
    await checkTools(run.agent_id, run.child_session_key);
  }
  process.stdout.write(
    `${JSON.stringify({ stage, status: "PASS", accepted_children: 6 })}\n`,
  );
} catch (error) {
  // Never emit model output, RPC arguments, raw response or stderr. Preserve a
  // small static classification so operators can repair a gate safely.
  const detail = String(error?.code ?? error?.message ?? "");
  const known = [
    "GOVERNANCE_COMPLETION_UNAVAILABLE",
    "GOVERNANCE_INGRESS_UNAVAILABLE",
    "EXECUTION_STATE_UNKNOWN",
    "LINEAGE_MISMATCH",
    "GOVERNANCE_HASH_MISMATCH",
    "RUNTIME_CAPABILITY_MISMATCH",
    "VALIDATION_FAILED",
    "SCHEMA_INVALID",
    "POLICY_DENIED",
    "ETIMEDOUT",
    "INVENTORY_SHAPE_MISMATCH",
  ];
  const reason =
    known.find((value) => detail.includes(value)) ?? "LIVE_GATE_REJECTED";
  process.stdout.write(
    `${JSON.stringify({ stage, status: "FAIL", reason })}\n`,
  );
  process.exitCode = 1;
} finally {
  delete environment.OPENCLAW_GATEWAY_TOKEN;
}
