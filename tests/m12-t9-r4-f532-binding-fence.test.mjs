// M12/T9-R4 F-532 (legacy R10-T02-1) — execution_finished presented the queue
// record's OWN fence fields to finishExecution, so the M7-029 three-way fence
// was a self-comparison and a superseded run's result committed under the live
// attempt. The plugin half of the fix: the fence fields come from the run's
// LEDGER BINDING (coordinator / lease_id / attempt), and the dead
// `activeClaims` guard (a property no queue manager declares) is deleted.
//
// Shipped case per the acceptance criteria: claim at attempt N, recover to
// N+1, deliver run N's finish, assert refusal.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const load = async (rel) =>
  import(`file:///${path.join(REPO_ROOT, rel).replaceAll("\\", "/")}`);

const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const { defaultQueueManager } = await load(
  "integrations/openclaw/lib/queue-manager.mjs",
);
const { ensureLedger, ledgerPaths, readSnapshot, recordWorkflowEvent } =
  await load("integrations/openclaw/topology/lib/ledger.mjs");
const { deriveTaskId, canonicalHash } = await load(
  "integrations/openclaw/topology/lib/canonical.mjs",
);

const OWNER = "123456789012345678";

function registerPlugin(root) {
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
  return { hooks, logs };
}

test("F-532: a superseded run's execution_finished is refused, not committed under the live attempt", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f532-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "154543700000000001",
    };
    const taskId = deriveTaskId(origin);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      ...origin,
      task_id: taskId,
      root_agent_id: "o1",
      root_session_key: "o1-session",
      root_run_id: "o1-run",
    });
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
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
          input_digest: canonicalHash("zink-input-v1", "work"),
          constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
          validation_digest: canonicalHash(
            "zink-validation-v1",
            "agent-result-payload.schema.json",
          ),
        },
      ],
    });
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
      task_id: taskId,
      agent_id: "o1",
      session_key: "o1-session",
      run_id: "o1-run",
    });
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: taskId,
      channel: "approvals",
      thread_id: "1111111111111111111",
    });
    recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
      task_id: taskId,
      actor: "user",
      channel: "approvals",
      decision: "APPROVE",
      thread_id: "1111111111111111111",
    });
    recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
      task_id: taskId,
      agent_id: "o1",
    });

    const { hooks, logs } = registerPlugin(root);

    // Attempt N: the coordinator claims and its run is bound in the ledger.
    defaultQueueManager.enqueueTask({ taskId, primaryCoordinator: "o1" });
    const claimN = defaultQueueManager.claimTaskById({ taskId, agentId: "o1" });
    const attemptN = claimN.task.attempt;
    const sessionKey = `agent:o1:coordinator:${taskId}:attempt-${attemptN}`;
    recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", {
      task_id: taskId,
      coordinator: "o1",
      attempt: attemptN,
      lease_id: claimN.leaseId,
      session_key: sessionKey,
      run_id: "run-zombie",
    });

    // Stale recovery supersedes attempt N; a fresh claim takes attempt N+1.
    const stale = defaultQueueManager.detectAndRecoverStaleTasks({
      staleThresholdSeconds: -1,
      ledgerTasks: readSnapshot(paths).tasks,
    });
    assert.equal(stale.length, 1, "the fixture must recover exactly one task");
    const claimN1 = defaultQueueManager.claimTaskById({
      taskId,
      agentId: "o1",
    });
    assert.equal(
      claimN1.task.attempt,
      attemptN + 1,
      "the fixture must re-claim at the next attempt generation",
    );

    const artifact = path.join(paths.root, "result.csv");
    writeFileSync(artifact, "date,revenue\n2026-01-01,10\n", "utf8");

    // The zombie run of attempt N delivers its finish.
    const handler = hooks.get("execution_finished");
    assert.equal(typeof handler, "function");
    let outcome = null;
    let threw = null;
    try {
      outcome = handler(
        { artifacts: [artifact] },
        { sessionKey, runId: "run-zombie", agentId: "o1" },
      );
    } catch (err) {
      threw = err;
    }

    const item = defaultQueueManager.getTask(taskId);
    assert.notEqual(
      item.status,
      "RESULT_PENDING_REVIEW",
      `a superseded run's finish must not commit (threw: ${threw?.message ?? "no"}; governanceState: ${outcome?.governanceState ?? "n/a"})`,
    );
    assert.equal(
      item.attempt,
      attemptN + 1,
      "the live attempt generation must be untouched",
    );
    assert.notEqual(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "RESULT_PENDING_REVIEW",
      "the ledger must not record the zombie run's result",
    );
    assert.equal(
      outcome?.governanceState ?? (threw ? "THREW" : null),
      "FAILED",
      `the seam must name the refusal; threw=${threw?.message ?? "no"}; logs=${logs.filter((l) => l.includes("execution_finished") || l.includes("FENCE") || l.includes("MISMATCH")).join(" | ")}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-532: the dead activeClaims guard is deleted", () => {
  const source = readFileSync(
    path.join(
      REPO_ROOT,
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    ),
    "utf8",
  );
  assert.equal(
    source.includes("activeClaims"),
    false,
    "no queue manager declares activeClaims; the guard that reads it is unreachable dead code and must be removed",
  );
});
