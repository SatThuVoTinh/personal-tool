// M12/T9 F-025 (legacy R1-A03-02) - the owner's APPROVE must be bound to the
// ADMITTED brief, not to the model's own card text.
//
// MEASURED AT HEAD: the child-announce approval card rendered `card.content`,
// which is parsed out of the child's findings (model output), while the plan
// that executes is the ledger's recorded brief. The custom id carried only
// (task id, brief revision) and the recorded decision carried an OPTIONAL
// caller-supplied scope digest, so the binding to the admitted plan was off.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const load = async (rel) => import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

const { ensureLedger, ledgerPaths, readSnapshot, recordWorkflowEvent } =
  await load("integrations/openclaw/topology/lib/ledger.mjs");
const { deriveApprovalPlanDigest, deriveTaskId, canonicalHash } = await load(
  "integrations/openclaw/topology/lib/canonical.mjs",
);
const { handleDiscordAction } = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);

const OPENED = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
};
const SURFACED_THREAD = "1111111111111111111";

function briefNode(nodeId, agentId, stackId) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: stackId,
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

function fixture(tag, { withBrief = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f025-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const payload = {
    ...OPENED,
    origin_message_id: `12345678901234567${tag.charCodeAt(0) % 10}`,
  };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  if (withBrief) {
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: taskId,
      brief_revision: 1,
      semantic_contract_status: "VALID",
      nodes: [briefNode("node-excel", "excel", "data_plant")],
    });
  }
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: taskId,
    agent_id: "o1",
    session_key: OPENED.root_session_key,
    run_id: OPENED.root_run_id,
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: taskId,
    channel: "approvals",
    thread_id: SURFACED_THREAD,
  });
  return { root, paths, taskId };
}

const events = (paths) =>
  readFileSync(paths.events, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("F-025: the recorded approval is bound to the ADMITTED plan digest", () => {
  const { root, paths, taskId } = fixture("bound");
  try {
    const res = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId,
      action: "APPROVE",
      paths,
      data: { threadId: SURFACED_THREAD, briefRevision: "1" },
    });
    assert.equal(res.allowed, true, `expected allow, got ${res.reason}`);
    const task = readSnapshot(paths).tasks[taskId];
    const recorded = events(paths).filter(
      (event) => event.type === "WORKFLOW_USER_APPROVAL_DECIDED",
    );
    assert.equal(recorded.length, 1, "the decision must be recorded once");
    const expectedDigest = deriveApprovalPlanDigest({
      brief_revision: task.brief_revision,
      nodes: task.nodes,
    });
    assert.equal(
      recorded[0].payload.scope_digest,
      expectedDigest,
      "the decision must carry the digest of the recorded plan",
    );
    assert.equal(
      recorded[0].payload.brief_revision,
      1,
      "the decision must carry the brief revision the card was issued for",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-025: a STALE card (an earlier brief revision) cannot approve", () => {
  const { root, paths, taskId } = fixture("stale");
  try {
    const res = handleDiscordAction({
      actor: "user",
      channel: "approvals",
      taskId,
      action: "APPROVE",
      paths,
      data: { threadId: SURFACED_THREAD, briefRevision: "0" },
    });
    assert.equal(res.allowed, false, "a stale revision must not approve");
    assert.match(res.reason, /LEDGER_WRITE_FAILED/u);
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "ACTIVE",
      "the task must stay un-approved",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-025: the announce card renders the ADMITTED brief, not the model text", () => {
  const source = readFileSync(
    path.join(REPO_ROOT, "integrations/openclaw/plugins/zink-governance/index.mjs"),
    "utf8",
  );
  assert.equal(
    /bodyContent\s*=\s*card\.content/u.test(source),
    false,
    "the model-authored card text must not be the approved body",
  );
  const at = source.indexOf("async function maybePublishDiscordCard");
  assert.ok(at > 0, "the announce card path must exist");
  const slice = source.slice(at, at + 6000);
  assert.match(slice, /admittedNodes/u);
  assert.match(slice, /buildFirstSpawnApprovalCard\(/u);
});
