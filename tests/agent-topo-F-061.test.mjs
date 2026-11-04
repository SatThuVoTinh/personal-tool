// F-061 (R1-A06-03) -- a CLAIMED task can leave EXECUTING.
//
// The first successful pickup (WORKFLOW_TASK_CLAIMED) moved the task to
// EXECUTING, and the reducer accepted a root result ONLY from ACTIVE. So from
// the moment a coordinator claimed the task, the task's own result could no
// longer be recorded: the task reached EXECUTING and nothing could close it,
// and the queue and the ledger diverged for ever.
//
// The exit this lane proves is the ROOT agent's completion, which is a
// production path: the governance guard records WORKFLOW_ROOT_RESULT_RECORDED
// when the root run ends (topology/lib/guard.mjs), and the guard's own
// admission rule already admits a root result from ACTIVE, QUEUED or
// EXECUTING. This lane drives that production seam (the native boundary's
// finishNativeRun -> guard.beforeRunEnd) and reads the ledger afterwards.
//
// The lane also pins the two edges that must NOT open: an UNCLAIMED (QUEUED)
// task still cannot record a root result, so the claim cannot be skipped.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  finishNativeRun,
  registerNativeGuard,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

const resultPayload = () => ({
  schema_version: "1.0.0",
  governance_version: "m7-t2-r12",
  outcome_claim: "COMPLETE",
  reason_claim: "NONE",
  output: "synthetic coordinator output",
  assumptions: [],
  limitations: [],
  requested_prerequisites: [],
  agent_self_validation: "Claim only",
});

const briefNode = (agentId) => ({
  node_id: agentId,
  agent_id: agentId,
  stack_id: "data_plant",
  dependencies: [],
  // F-061: the node is an OPTIONAL branch. A required node with no accepted
  // result makes the root result MISSING_PREREQUISITE, which is a different
  // control and is covered by its own lane.
  required: false,
  input_digest: canonicalHash("zink-input-v1", "work"),
  constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
  validation_digest: canonicalHash(
    "zink-validation-v1",
    "agent-result-payload.schema.json",
  ),
});

function seedTask(paths, { approve }) {
  const origin = {
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "123456789012345678",
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "root-session",
    root_run_id: "root-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: 1,
    semantic_contract_status: "VALID",
    nodes: [briefNode("o1")],
  });
  if (!approve) return taskId;
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  return taskId;
}

function rootEndEvent() {
  return {
    success: true,
    yielded: false,
    lastAssistant: {
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: JSON.stringify(resultPayload()) }],
    },
  };
}

test("F-061: a CLAIMED task reaches review through the production root-result path", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f061-"));
  const paths = ledgerPaths(root);
  let unregister;
  try {
    ensureLedger(paths);
    const taskId = seedTask(paths, { approve: true });
    recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
      task_id: taskId,
      agent_id: "o1",
    });
    const claimed = readSnapshot(paths).tasks[taskId];
    assert.equal(
      claimed.workflow_status,
      "EXECUTING",
      "the claim must have moved the task to EXECUTING",
    );
    const guard = createGovernanceGuard({
      paths,
      manifestFor: (id) => ({
        expected_governance_hash: governanceHash(id),
        observed_governance_hash: governanceHash(id),
      }),
    });
    unregister = registerNativeGuard(paths.root, guard);
    await finishNativeRun(nativeConfig(paths.root), rootEndEvent(), {
      agentId: "main",
      sessionKey: "root-session",
      runId: "root-run",
    });
    const task = readSnapshot(paths).tasks[taskId];
    assert.equal(
      task.workflow_status,
      "RESULT_PENDING_REVIEW",
      "a claimed task must be able to reach review: the root result is a production path",
    );
    assert.equal(task.brief_state, "ACTIVE");
    assert.ok(
      task.root_result,
      "the root result must be recorded, not silently dropped",
    );
  } finally {
    unregister?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-061: an UNCLAIMED task still cannot record a root result", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f061-queued-"));
  const paths = ledgerPaths(root);
  let unregister;
  try {
    ensureLedger(paths);
    const taskId = seedTask(paths, { approve: true });
    const queued = readSnapshot(paths).tasks[taskId];
    assert.equal(
      queued.workflow_status,
      "QUEUED",
      "the approval must have queued the task",
    );
    const guard = createGovernanceGuard({
      paths,
      manifestFor: (id) => ({
        expected_governance_hash: governanceHash(id),
        observed_governance_hash: governanceHash(id),
      }),
    });
    unregister = registerNativeGuard(paths.root, guard);
    await assert.rejects(
      finishNativeRun(nativeConfig(paths.root), rootEndEvent(), {
        agentId: "main",
        sessionKey: "root-session",
        runId: "root-run",
      }),
      "an unclaimed task must not be able to skip the claim",
    );
    const task = readSnapshot(paths).tasks[taskId];
    assert.equal(task.workflow_status, "QUEUED");
    assert.equal(task.root_result, undefined);
  } finally {
    unregister?.();
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-061: the published projection declares the EXECUTING -> RESULT_PENDING_REVIEW edge", () => {
  const transitions = JSON.parse(
    readFileSync(
      path.join(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
        "integrations",
        "openclaw",
        "topology",
        "policy",
        "state-transitions.json",
      ),
      "utf8",
    ),
  );
  assert.ok(
    transitions.workflow_status.EXECUTING.includes("RESULT_PENDING_REVIEW"),
    "the published projection must declare the edge the reducer now admits",
  );
});
