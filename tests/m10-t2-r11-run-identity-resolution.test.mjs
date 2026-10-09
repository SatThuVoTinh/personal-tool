// M10/T2-R11 — run-identity resolution regression.
//
// Finding: the live `sessions_spawn` of 2026-10-07 00:19 was suspected of
// resolving a stale task, because reproducing it against the previous day's
// task yielded MISSING_PREREQUISITE while live yielded AUTH_APPROVAL_REQUIRED.
// Investigation proved there was no mismatch: the live turn's own task
// (c89af0308, 7 nodes via a plugin-admitted brief) yields AUTH_APPROVAL_REQUIRED
// when driven with the live args, exactly matching live. The earlier
// reproduction used the WRONG task (yesterday's b89a87cf, 0 nodes).
//
// This suite locks in the correct behavior: when two tasks share one session
// key, each run resolves its OWN task. An approved task passes the approval
// gate while a fresh task hits it — the divergence proves resolution, and a
// bogus run still denies. No approval-bootstrap logic is touched: the approved
// task here is seeded, not manufactured by the code under test.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mod = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

const policy = await mod("integrations/openclaw/lib/policy.mjs");
const guardMod = await mod("integrations/openclaw/topology/lib/guard.mjs");
const ledger = await mod("integrations/openclaw/topology/lib/ledger.mjs");
const canonical = await mod("integrations/openclaw/topology/lib/canonical.mjs");
const { GOVERNANCE_VERSION } = await mod(
  "integrations/openclaw/topology/lib/canonical.mjs",
);

const OFFICE = "1545425766161063937";

function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r11-"));
  const stateDir = path.join(root, "state");
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
    writeFileSync(
      path.join(dir, "AGENTS.md"),
      policy.agentInstructions(agentId),
    );
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
    const wc = readFileSync(
      path.join(stateDir, "workspaces", agentId, "AGENTS.md"),
      "utf8",
    );
    if (
      createHash("sha256").update(wc).digest("hex") !==
      expected.workspace_sha256
    )
      throw new Error("GOVERNANCE_HASH_MISMATCH");
    const m = wc.match(/governance_hash=([a-f0-9]{64})/);
    if (!m || m[1] !== expected.governance_hash)
      throw new Error("GOVERNANCE_HASH_MISMATCH");
    return {
      expected_governance_hash: expected.governance_hash,
      observed_governance_hash: m[1],
      allowed_tools: expected.allowed_tools,
    };
  };
  const guard = guardMod.createGovernanceGuard({
    paths,
    manifestFor,
    queueExecutionFence: (fence, operation) => operation(),
  });
  return { root, paths, guard };
}

const node = {
  node_id: "o1",
  agent_id: "o1",
  stack_id: "data_plant",
  dependencies: [],
  required: true,
  input_digest: canonical.canonicalHash("zink-input-v1", "probe work"),
  constraints_digest: canonical.canonicalHash("zink-constraints-v1", "{}"),
  validation_digest: canonical.canonicalHash("zink-validation-v1", "probe"),
};

function seedTask(paths, msgSuffix, runId, approved) {
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: `723456789012345${msgSuffix}`,
    root_agent_id: "main",
    root_session_key: `agent:main:discord:channel:${OFFICE}`,
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
    nodes: [node],
  });
  if (approved) {
    ledger.recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: taskId,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
    });
  }
  return taskId;
}

const proposal = (nodeId) =>
  JSON.stringify({
    schema_version: "1.0.0",
    governance_version: "m8-t2.3-r5",
    node_id: nodeId,
    inputs: "probe work",
    input_refs: [],
    constraints: "{}",
    validation_criteria: "probe",
  });

async function spawnDecision(guard, sessionKey, runId, agentId = "o1") {
  try {
    const d = await guard.beforeToolCall(
      {
        toolName: "sessions_spawn",
        toolCallId: `call-r11-${runId.slice(0, 8)}`,
        params: {
          agentId,
          task: proposal("o1"),
          context: "isolated",
          sandbox: "require",
        },
        turn: 1,
        batchToolNames: ["sessions_spawn"],
        assistantText: "",
      },
      { agentId: "main", sessionKey, runId },
      null,
    );
    return { allow: d?.allow === true, reason: d?.reason ?? null };
  } catch (error) {
    return { allow: false, threw: error?.message ?? String(error) };
  }
}

test("R11: each run resolves its OWN task when two share a session", async () => {
  const { root, paths, guard } = setup();
  try {
    const sessionKey = `agent:main:discord:channel:${OFFICE}`;
    // Task A: approved. Task B: fresh, unapproved. Same session key.
    seedTask(paths, "01", "run-r11-approved", true);
    seedTask(paths, "02", "run-r11-fresh", false);

    // Case 2 (stale exists, current still resolves): the FRESH run hits the
    // approval gate — proving it resolved task B, not the approved task A.
    const fresh = await spawnDecision(guard, sessionKey, "run-r11-fresh");
    assert.equal(fresh.allow, false);
    assert.equal(
      fresh.reason ?? fresh.threw,
      "AUTH_APPROVAL_REQUIRED",
      `fresh run must hit its own approval gate, got: ${fresh.reason ?? fresh.threw}`,
    );

    // Case 1 (fresh task, correct identity): the APPROVED run passes the
    // approval gate — proving it resolved task A. It must NOT report
    // AUTH_APPROVAL_REQUIRED; whatever later verdict it reaches is the normal
    // path for an approved spawn, not this test's concern.
    const approved = await spawnDecision(guard, sessionKey, "run-r11-approved");
    assert.notEqual(
      approved.reason ?? approved.threw,
      "AUTH_APPROVAL_REQUIRED",
      `approved run must pass its own approval gate, got: ${approved.reason ?? approved.threw}`,
    );

    // Case 3 (legitimate continuation): same run twice resolves the same task.
    const again = await spawnDecision(guard, sessionKey, "run-r11-fresh");
    assert.equal(
      again.reason ?? again.threw,
      "AUTH_APPROVAL_REQUIRED",
      "repeat call must resolve identically",
    );

    // Cases 4-5 (deny preserved): unknown run denies via lineage.
    const bogus = await spawnDecision(guard, sessionKey, "run-no-such-run");
    assert.equal(bogus.allow, false);
    assert.equal(
      bogus.reason ?? bogus.threw,
      "EXECUTION_STATE_UNKNOWN",
      `bogus run must hit lineage, got: ${bogus.reason ?? bogus.threw}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
