// M12/T9 F-032 (legacy R2-B01-03) - the durable reducer admits APPROVE for a
// plan that was never requested or surfaced.
//
// MEASURED AT HEAD: `WORKFLOW_USER_APPROVAL_DECIDED` required only a
// non-terminal task in ACTIVE/REVISING. `WORKFLOW_OPENED` sets
// `workflow_status: ACTIVE`, so "approvable" was inferable from any open task
// and the durable reducer recorded the owner's consent against a plan that was
// never requested and never shown to them.
//
// The rule the reducer now applies:
//
//   a decision that NAMES the surface it came from (it carries a `thread_id`)
//   is a surface-bound decision, and a surface-bound decision must also name a
//   RECORDED approval request. A decision that names no surface is the
//   pre-F-023 shape and keeps replaying byte-identically, because an approval
//   recorded before WORKFLOW_APPROVAL_REQUESTED existed carries neither.
//
// The keyed-on-the-decision form is the pattern the reducer already uses for
// the plan binding (F-023: `scope_digest` / `brief_revision` are checked only
// when the decision carries them), so an approval recorded before that rule
// existed still replays unchanged.
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
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
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

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f032-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

function openTask(paths, tag = "b") {
  const payload = {
    ...OPENED,
    origin_message_id: `12345678901234567${tag.charCodeAt(0) % 10}`,
  };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  return taskId;
}

const request = (taskId, agentId = "o1", runId = "root-run") => ({
  task_id: taskId,
  agent_id: agentId,
  session_key: OPENED.root_session_key,
  run_id: runId,
});

const decide = (taskId, decision = "APPROVE", threadId = THREAD) => ({
  task_id: taskId,
  actor: "user",
  channel: "approvals",
  decision,
  thread_id: threadId,
});

describe("F-032 - an APPROVE must bind to a recorded approval request", () => {
  it("an APPROVE for a task with NO recorded request is refused", () => {
    const { root, paths } = lineage("norequest");
    try {
      const taskId = openTask(paths);
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_USER_APPROVAL_DECIDED",
            decide(taskId),
          ),
        { code: "INVALID_STATE_TRANSITION" },
        "an owner approval must never bind to a plan that was not requested",
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "ACTIVE");
      assert.equal(task.approved_at, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an APPROVE after a recorded request and a surfaced card is accepted", () => {
    const { root, paths } = lineage("request");
    try {
      const taskId = openTask(paths);
      recordWorkflowEvent(
        paths,
        "WORKFLOW_APPROVAL_REQUESTED",
        request(taskId),
      );
      recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
        task_id: taskId,
        channel: "approvals",
        thread_id: THREAD,
      });
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        decide(taskId),
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "QUEUED");
      assert.ok(task.approved_at, "the decision must be recorded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the reducer itself refuses the request-less APPROVE", () => {
    const { root, paths } = lineage("reducer");
    try {
      const taskId = openTask(paths);
      const snapshot = readSnapshot(paths);
      assert.throws(
        () =>
          applyWorkflowEvent(
            snapshot,
            "WORKFLOW_USER_APPROVAL_DECIDED",
            decide(taskId),
          ),
        { code: "INVALID_STATE_TRANSITION" },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the request-less APPROVE leaves no decision in the ledger", () => {
    const { root, paths } = lineage("nodurable");
    try {
      const taskId = openTask(paths);
      const before = readSnapshot(paths);
      assert.throws(() =>
        recordWorkflowEvent(
          paths,
          "WORKFLOW_USER_APPROVAL_DECIDED",
          decide(taskId),
        ),
      );
      const after = readSnapshot(paths);
      assert.equal(after.sequence, before.sequence);
      assert.equal(after.tasks[taskId].workflow_status, "ACTIVE");
      assert.equal(after.tasks[taskId].approved_at, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
