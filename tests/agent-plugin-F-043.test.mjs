// M12/T9 F-043 (legacy R1-A07-04) - an approval decision must come from the
// thread the card was surfaced in.
//
// MEASURED AT HEAD: the plugin recorded `thread_id: data.threadId ?? null` on
// WORKFLOW_USER_APPROVAL_DECIDED and never compared it with the task's own
// `approval_thread_id`, so a reposted card, a forwarded message or an owner
// reply in an unrelated thread all yielded a durable APPROVE. An ABSENT thread
// id satisfied the comparison by being absent.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const load = async (rel) =>
  import(pathToFileURL(path.join(REPO_ROOT, rel)).href);

const { ensureLedger, ledgerPaths, readSnapshot, recordWorkflowEvent } =
  await load("integrations/openclaw/topology/lib/ledger.mjs");
const { deriveTaskId } = await load(
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
const OTHER_THREAD = "2222222222222222222";

function fixture(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f043-${tag}-`));
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

const approve = (paths, taskId, data) =>
  handleDiscordAction({
    actor: "user",
    channel: "approvals",
    taskId,
    action: "APPROVE",
    paths,
    data: data ?? {},
  });

test("F-043: a decision from another thread is refused and records nothing", () => {
  const { root, paths, taskId } = fixture("other");
  try {
    const before = readSnapshot(paths);
    const res = approve(paths, taskId, { threadId: OTHER_THREAD });
    assert.equal(res.allowed, false, "a foreign thread must not approve");
    assert.match(res.reason, /APPROVAL_THREAD_MISMATCH/u);
    const after = readSnapshot(paths);
    assert.equal(
      after.sequence,
      before.sequence,
      "a refused decision must not append an event",
    );
    assert.equal(after.tasks[taskId].workflow_status, "ACTIVE");
    assert.equal(after.tasks[taskId].approved_at, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-043: an ABSENT thread id cannot satisfy the comparison", () => {
  const { root, paths, taskId } = fixture("absent");
  try {
    const res = approve(paths, taskId, { threadId: null });
    assert.equal(res.allowed, false, "an absent thread must not approve");
    assert.match(res.reason, /APPROVAL_THREAD_MISMATCH/u);
    assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "ACTIVE");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-043: the decision from the recorded thread is accepted", () => {
  const { root, paths, taskId } = fixture("same");
  try {
    const res = approve(paths, taskId, { threadId: SURFACED_THREAD });
    assert.equal(res.allowed, true, `expected allow, got ${res.reason}`);
    const task = readSnapshot(paths).tasks[taskId];
    assert.equal(task.workflow_status, "QUEUED");
    assert.ok(task.approved_at, "the decision must be recorded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-043: the transport prefix of a thread id is not a different thread", () => {
  const { root, paths, taskId } = fixture("prefix");
  try {
    const res = approve(paths, taskId, {
      threadId: `channel:${SURFACED_THREAD}`,
    });
    assert.equal(res.allowed, true, `expected allow, got ${res.reason}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
