// M12/T9 F-066 - the documented EXECUTION_FINISHED result chain was
// unreachable in production while two suites kept it green.
//
// MEASURED AT HEAD: `handleExecutionFinished`, `queueManager.finishExecution`
// and `formatGovernedResultCard` existed, but the only registered hooks were
// gateway_stop, before_tool_call, before_prompt_build, subagent_ended,
// subagent_spawned, message_sending and message_received - there was NO
// `execution_finished` registration, so the queue never left EXECUTING and no
// result card was ever produced.
//
// The chain the operator documentation describes is execution finish ->
// RESULT_PENDING_REVIEW -> #results card, BEFORE the owner's verdict.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const { QueueManager } = await load(
  "integrations/openclaw/lib/queue-manager.mjs",
);
const { ensureLedger, ledgerPaths, readSnapshot, recordWorkflowEvent } =
  await load("integrations/openclaw/topology/lib/ledger.mjs");
const { deriveTaskId, canonicalHash } = await load(
  "integrations/openclaw/topology/lib/canonical.mjs",
);

const SOURCE = readFileSync(
  path.join(
    REPO_ROOT,
    "integrations/openclaw/plugins/zink-governance/index.mjs",
  ),
  "utf8",
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

test("F-066: the runtime event that drives the result chain is registered", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f066-"));
  try {
    const { hooks } = registerPlugin(root);
    assert.ok(
      typeof hooks.get("execution_finished") === "function",
      "the plugin must register an execution_finished handler",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-066: the handler drives the result chain, and announces before any verdict", () => {
  const start = SOURCE.indexOf('api.on("execution_finished"');
  assert.ok(start > 0, "the execution_finished handler must exist");
  const body = SOURCE.slice(start, start + 6000);
  const finish = body.indexOf("handleExecutionFinished(");
  const announce = body.indexOf("announcePendingResult(taskId)", finish);
  assert.ok(finish > 0, "the handler must drive handleExecutionFinished");
  assert.ok(announce > 0, "the handler must announce the pending result");
  assert.ok(
    announce > finish,
    "the result must be recorded BEFORE it is announced for review",
  );
});

test("F-066: an ungoverned run records nothing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f066b-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const before = readSnapshot(paths);
    const { hooks, logs } = registerPlugin(root);
    const decision = hooks.get("execution_finished")(
      { artifacts: [] },
      { sessionKey: "agent:o1:coordinator:unknown:attempt-1", runId: "run-x" },
    );
    assert.equal(decision.governanceState, "UNGOVERNED_RUN");
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence, "no event may be appended");
    assert.equal(
      Object.keys(after.tasks).length,
      Object.keys(before.tasks).length,
      "no task may be created",
    );
    assert.ok(
      logs.some((line) => line.includes("execution_finished")),
      "the refusal must be named in the log",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-066: the chain moves the queue to RESULT_PENDING_REVIEW and produces the card", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "f066c-"));
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const origin = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: "154543700000000001",
    };
    const taskId = deriveTaskId(origin);
    // The task reaches EXECUTING through the OWNED events: opened, briefed,
    // approval requested, approval surfaced, approved, claimed. The chain
    // under test is the RESULT half, so the fixture stops at EXECUTING.
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

    const artifact = path.join(root, "result.csv");
    writeFileSync(artifact, "date,revenue\n2026-01-01,10\n", "utf8");

    const queue = new QueueManager({
      storagePath: path.join(root, "queue.json"),
    });
    queue.enqueueTask({ taskId, primaryCoordinator: "o1" });
    const claim = queue.claimTaskById({ taskId, agentId: "o1" });

    const outcome = plugin.handleExecutionFinished({
      taskId,
      agentId: "o1",
      leaseId: claim.leaseId,
      attempt: claim.task.attempt,
      artifacts: [artifact],
      paths,
      queueManager: queue,
    });

    assert.equal(outcome.status, "READY_FOR_REVIEW");
    assert.ok(outcome.resultCard, "the result card must be produced");
    assert.equal(
      queue.getTask(taskId).status,
      "RESULT_PENDING_REVIEW",
      "the queue must leave EXECUTING",
    );
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "RESULT_PENDING_REVIEW",
      "the ledger must record the result as pending review",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-066: the artifact reader takes the delivered set and invents nothing", () => {
  assert.deepEqual(plugin.readExecutionArtifacts({ artifacts: ["a.csv"] }), [
    "a.csv",
  ]);
  assert.deepEqual(
    plugin.readExecutionArtifacts({ artifacts: [{ logical_path: "b.csv" }] }),
    ["b.csv"],
  );
  assert.deepEqual(plugin.readExecutionArtifacts({ artifactPath: "c.csv" }), [
    "c.csv",
  ]);
  assert.deepEqual(plugin.readExecutionArtifacts({}), []);
  assert.deepEqual(plugin.readExecutionArtifacts(null), []);
});
