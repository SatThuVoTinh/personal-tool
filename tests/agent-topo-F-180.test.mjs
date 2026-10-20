// M12/T9 F-180 (legacy R1-A07-02) - the revision cycle must RE-ARM the
// approval.
//
// MEASURED AT HEAD: `approval_thread_id` was set once and never cleared, so
// the thread that carried the plan the owner sent back stayed bound to the
// task: the next WORKFLOW_APPROVAL_SURFACED was refused as "a different thread
// for one recorded request" and the re-presented plan could never get a card.
//
// The reducer now clears the thread and re-arms the request when the owner
// asks for a revision, so the fresh plan may open a fresh thread.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";

const OPENED = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
};
const THREAD = "1111111111111111111";
const FRESH_THREAD = "3333333333333333333";

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f180-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

function fixture(tag) {
  const { root, paths } = lineage(tag);
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
    thread_id: THREAD,
  });
  return { root, paths, taskId };
}

const requestRevision = (taskId) => ({
  task_id: taskId,
  actor: "user",
  channel: "approvals",
  decision: "REQUEST_REVISION",
  thread_id: THREAD,
  reason: "needs more detail",
});

describe("F-180 - the revision cycle re-arms the approval", () => {
  it("a second thread is refused while the first one is still bound", () => {
    const { root, paths, taskId } = fixture("bound");
    try {
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
            task_id: taskId,
            channel: "approvals",
            thread_id: FRESH_THREAD,
          }),
        { code: "INVALID_STATE_TRANSITION" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("REQUEST_REVISION clears the thread and re-arms the request", () => {
    const { root, paths, taskId } = fixture("revision");
    try {
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        requestRevision(taskId),
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "REVISING");
      assert.equal(
        task.approval_thread_id,
        undefined,
        "the thread that carried the rejected plan must not bind the next one",
      );
      assert.equal(
        task.approval_requested_at,
        undefined,
        "the request the owner rejected must be re-armed",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("after the revision a fresh request may open a fresh thread", () => {
    const { root, paths, taskId } = fixture("redrive");
    try {
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        requestRevision(taskId),
      );
      recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
        task_id: taskId,
        agent_id: "o1",
        session_key: OPENED.root_session_key,
        run_id: "root-run-2",
      });
      recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
        task_id: taskId,
        channel: "approvals",
        thread_id: FRESH_THREAD,
      });
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.approval_thread_id, FRESH_THREAD);
      assert.equal(task.approval_requested_run_id, "root-run-2");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
