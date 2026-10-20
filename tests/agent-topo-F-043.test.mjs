// M12/T9 F-043 (legacy R1-A07-04) - the reducer half of the approval-thread
// binding.
//
// MEASURED AT HEAD: the reducer never compared `payload.thread_id` with the
// task's own `approval_thread_id`, so a reposted card, a forwarded message or
// an owner reply in an unrelated thread produced a durable verdict. The plugin
// half refuses the mismatch before it writes; the reducer is the DURABLE gate
// and must refuse it too, because the plugin's own check reads a projection.
//
// The comparison is made on the CANONICAL thread id (a transport prefix such
// as `channel:` names the same thread), and an ABSENT thread id cannot satisfy
// the comparison by being absent.
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
const OTHER_THREAD = "2222222222222222222";

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f043-${tag}-`));
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

const decide = (taskId, threadId) => ({
  task_id: taskId,
  actor: "user",
  channel: "approvals",
  decision: "APPROVE",
  thread_id: threadId,
});

describe("F-043 - a decision must come from the thread the card was surfaced in", () => {
  it("a decision from another thread is refused and records nothing", () => {
    const { root, paths, taskId } = fixture("other");
    try {
      const before = readSnapshot(paths);
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_USER_APPROVAL_DECIDED",
            decide(taskId, OTHER_THREAD),
          ),
        { code: "INVALID_STATE_TRANSITION" },
      );
      const after = readSnapshot(paths);
      assert.equal(after.sequence, before.sequence);
      assert.equal(after.tasks[taskId].workflow_status, "ACTIVE");
      assert.equal(after.tasks[taskId].approved_at, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("an ABSENT thread id cannot satisfy the comparison", () => {
    const { root, paths, taskId } = fixture("absent");
    try {
      assert.throws(
        () =>
          recordWorkflowEvent(
            paths,
            "WORKFLOW_USER_APPROVAL_DECIDED",
            decide(taskId, null),
          ),
        { code: "INVALID_STATE_TRANSITION" },
      );
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "ACTIVE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the decision from the recorded thread is accepted", () => {
    const { root, paths, taskId } = fixture("same");
    try {
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        decide(taskId, THREAD),
      );
      const task = readSnapshot(paths).tasks[taskId];
      assert.equal(task.workflow_status, "QUEUED");
      assert.ok(task.approved_at, "the decision must be recorded");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the transport prefix of a thread id is not a different thread", () => {
    const { root, paths, taskId } = fixture("prefix");
    try {
      recordWorkflowEvent(
        paths,
        "WORKFLOW_USER_APPROVAL_DECIDED",
        decide(taskId, `channel:${THREAD}`),
      );
      assert.equal(readSnapshot(paths).tasks[taskId].workflow_status, "QUEUED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
