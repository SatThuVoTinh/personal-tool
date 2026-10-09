// M10/T2-R10 probe fixture — runs the DEPLOYED-shape guard with a
// NON-repository cwd, exactly like the production gateway.
//
// The parent test spawns this file with `cwd` set to an empty temporary
// directory. Every repository module is imported by ABSOLUTE file URL, so the
// only thing that can resolve policy is the guard's own loader — which is
// precisely what R10 fixes. If the loader regresses, the capability registries
// stay empty and every built-in tool dies with RUNTIME_CAPABILITY_MISMATCH,
// which this probe reports instead of masking.
//
// Usage: node r10-policy-load-probe.mjs <stateDir> <repoRoot>
// Prints one JSON object to stdout. Never touches the live state directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const [stateDir, repoRoot] = process.argv.slice(2);
const mod = (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const policy = await mod("integrations/openclaw/lib/policy.mjs");
const canonicalMod = await mod(
  "integrations/openclaw/topology/lib/canonical.mjs",
);
const { GOVERNANCE_VERSION } = canonicalMod;
const guardMod = await mod("integrations/openclaw/topology/lib/guard.mjs");
const ledger = await mod("integrations/openclaw/topology/lib/ledger.mjs");
const canonical = await mod("integrations/openclaw/topology/lib/canonical.mjs");

const out = { cwd: process.cwd(), checks: [] };

// --- state: ledger + extension manifests + workspaces (all temp) ---
const paths = ledger.ledgerPaths(stateDir);
ledger.ensureLedger(paths);
const extension = path.join(stateDir, "extensions", "zink-governance");
const generated = policy.governancePluginFiles();
mkdirSync(extension, { recursive: true });
writeFileSync(
  path.join(extension, "governance-manifests.json"),
  generated.assets["governance-manifests.json"],
);
for (const agentId of policy.AGENT_IDS) {
  const dir = path.join(stateDir, "workspaces", agentId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "AGENTS.md"), policy.agentInstructions(agentId));
}

const ids = new Set(policy.AGENT_IDS);
const manifestFor = (agentId) => {
  if (!ids.has(agentId)) throw new Error("UNAUTHORIZED_TARGET");
  const mapping = JSON.parse(
    readFileSync(path.join(extension, "governance-manifests.json"), "utf8"),
  );
  const expected = mapping[agentId];
  if (!expected || expected.governance_version !== GOVERNANCE_VERSION)
    throw new Error("GOVERNANCE_HASH_MISMATCH");
  const workspaceFile = path.join(stateDir, "workspaces", agentId, "AGENTS.md");
  const workspaceContent = readFileSync(workspaceFile, "utf8");
  const observed = createHash("sha256").update(workspaceContent).digest("hex");
  if (observed !== expected.workspace_sha256)
    throw new Error("GOVERNANCE_HASH_MISMATCH");
  const match = workspaceContent.match(/governance_hash=([a-f0-9]{64})/);
  const observedGovHash = match ? match[1] : null;
  if (!observedGovHash || observedGovHash !== expected.governance_hash)
    throw new Error("GOVERNANCE_HASH_MISMATCH");
  return {
    expected_governance_hash: expected.governance_hash,
    observed_governance_hash: observedGovHash,
    allowed_tools: expected.allowed_tools,
  };
};

const guard = guardMod.createGovernanceGuard({
  paths,
  manifestFor,
  queueExecutionFence: (fence, operation) => operation(),
});

// --- seed: one main task with one o1 node, NO approval ---
const OFFICE = "1545425766161063937";
const sessionKey = `agent:main:discord:channel:${OFFICE}`;
const runId = "run-r10-probe";
const origin = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "72345678901234567",
  root_agent_id: "main",
  root_session_key: sessionKey,
  root_run_id: runId,
};
const taskId = canonical.deriveTaskId(origin);
ledger.recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
  ...origin,
  task_id: taskId,
});
ledger.recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
  task_id: taskId,
  brief_revision: 1,
  semantic_contract_status: "VALID",
  nodes: [
    {
      node_id: "o1",
      agent_id: "o1",
      stack_id: "data_plant",
      dependencies: [],
      required: true,
      input_digest: canonical.canonicalHash("zink-input-v1", "probe work"),
      constraints_digest: canonical.canonicalHash("zink-constraints-v1", "{}"),
      validation_digest: canonical.canonicalHash("zink-validation-v1", "probe"),
    },
  ],
});

const context = { agentId: "main", sessionKey, runId };
const decide = async (toolName, params, batchToolNames) => {
  try {
    const d = await guard.beforeToolCall(
      {
        toolName,
        toolCallId: `call-r10-${toolName}`,
        params,
        turn: 1,
        batchToolNames: batchToolNames ?? [toolName],
        assistantText: "",
      },
      context,
      null,
    );
    return { allow: d?.allow === true, reason: d?.reason ?? null };
  } catch (error) {
    return { allow: false, threw: error?.message ?? String(error) };
  }
};

// --- the four incident tools must reach their NORMAL governed path ---
const status = await decide("session_status", { sessionKey: "current" });
out.checks.push({ name: "session_status", ...status });

const agents = await decide("agents_list", {});
out.checks.push({ name: "agents_list", ...agents });

const proposal = {
  schema_version: "1.0.0",
  governance_version: "m8-t2.3-r5",
  node_id: "o1",
  inputs: "probe work",
  input_refs: [],
  constraints: "{}",
  validation_criteria: "probe",
};
const spawn = await decide("sessions_spawn", {
  agentId: "o1",
  task: JSON.stringify(proposal),
  context: "isolated",
  sandbox: "require",
});
out.checks.push({ name: "sessions_spawn", ...spawn });

const yld = await decide("sessions_yield", {});
out.checks.push({ name: "sessions_yield", ...yld });

// --- negatives must stay denied ---
const bogus = await guard
  .beforeToolCall(
    {
      toolName: "session_status",
      toolCallId: "call-r10-bogus",
      params: { sessionKey: "current" },
      turn: 1,
      batchToolNames: ["session_status"],
      assistantText: "",
    },
    { agentId: "main", sessionKey, runId: "run-does-not-exist" },
    null,
  )
  .then(
    (d) => ({ allow: d?.allow === true, reason: d?.reason ?? null }),
    (error) => ({ allow: false, threw: error?.message ?? String(error) }),
  );
out.checks.push({ name: "bogus-run-stays-denied", ...bogus });

process.stdout.write(`${JSON.stringify(out)}\n`);
