// M12/T9-R4 - F-531 (legacy R10-T01-4): WORKFLOW_CANCELLED is reducer- and
// contract-declared for QUEUED tasks but had no producer, so the owner had no
// revocation path after a durable APPROVE. The test approves through
// `handleDiscordAction`, then cancels through the same seam and asserts the
// task reaches CANCELLED with the OWNER_CANCELLED provenance.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { handleDiscordAction } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const TASK_ID = "21102026CDEF";
const THREAD_ID = "900000000000000001";
const MESSAGE_ID = "123456789012345679";

function ledgerWithCard(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `zink-f531-${tag}-`));
  const paths = ledgerPaths(root);
  mkdirSync(path.dirname(paths.identityKey), { recursive: true });
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`, "utf8");
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: TASK_ID,
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: MESSAGE_ID,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: TASK_ID,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: TASK_ID,
    channel: "approvals",
    thread_id: THREAD_ID,
  });
  return { root, paths };
}

function act(paths, action, currentState) {
  return handleDiscordAction({
    actor: "user",
    channel: "approvals",
    taskId: TASK_ID,
    action,
    currentState,
    paths,
    data: { threadId: THREAD_ID, messageId: MESSAGE_ID },
    currentTime: Date.now(),
  });
}

function journalEvents(paths) {
  return readFileSync(paths.events, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

test("F-531: the owner can cancel a task after a durable APPROVE", () => {
  const { root, paths } = ledgerWithCard("owner");
  try {
    const approved = act(paths, "APPROVE", "APPROVAL_PENDING");
    assert.equal(approved.allowed, true, approved.reason ?? "");
    assert.equal(
      readSnapshot(paths).tasks[TASK_ID].workflow_status,
      "QUEUED",
      "the approval must project QUEUED before the revocation",
    );

    const cancelled = act(paths, "CANCEL", "QUEUED");
    assert.equal(cancelled.allowed, true, cancelled.reason ?? "");
    assert.equal(
      readSnapshot(paths).tasks[TASK_ID].workflow_status,
      "CANCELLED",
      "the owner's revocation must reach the durable state",
    );
    const last = journalEvents(paths).at(-1);
    assert.equal(last.type, "WORKFLOW_CANCELLED");
    assert.equal(last.payload.reason_code, "OWNER_CANCELLED");
    assert.equal(last.payload.actor, "user");
    assert.equal(last.payload.channel, "approvals");
    assert.equal(last.payload.message_id, MESSAGE_ID);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-531: a cancellation is refused before the plan is queued", () => {
  const { root, paths } = ledgerWithCard("pending");
  try {
    const refused = act(paths, "CANCEL", "APPROVAL_PENDING");
    assert.equal(refused.allowed, false);
    assert.match(refused.reason, /INVALID_STATE_TRANSITION/u);
    assert.notEqual(
      readSnapshot(paths).tasks[TASK_ID].workflow_status,
      "CANCELLED",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
