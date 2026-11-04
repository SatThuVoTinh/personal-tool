// M12/T9 F-082 (legacy R1-A08-04) - every task without a terminal record is
// flagged by the replay.
//
// MEASURED AT HEAD: the ledger layer reported nothing about the tasks it
// holds. 56 opens against 4 closes was invisible in the projection, and the
// ghost tasks skewed the active-run prerequisite gates.
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
  tasksWithoutTerminalRecord,
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

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f082-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

function open(paths, messageId) {
  const payload = { ...OPENED, origin_message_id: messageId };
  const taskId = deriveTaskId(payload);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...payload,
    task_id: taskId,
  });
  return taskId;
}

describe("F-082 - the replay flags every task without a terminal record", () => {
  it("an opened and never closed task is flagged", () => {
    const { root, paths } = lineage("open");
    try {
      const taskId = open(paths, "123456789012345678");
      const snapshot = readSnapshot(paths);
      assert.deepEqual(tasksWithoutTerminalRecord(snapshot), [taskId]);
      assert.deepEqual(snapshot.tasks_without_terminal_record, [taskId]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a cancelled task is not flagged", () => {
    const { root, paths } = lineage("closed");
    try {
      const taskId = open(paths, "123456789012345679");
      recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
        task_id: taskId,
        reason_code: "OWNER_CANCELLED",
        actor: "user",
      });
      const snapshot = readSnapshot(paths);
      assert.deepEqual(tasksWithoutTerminalRecord(snapshot), []);
      assert.equal(snapshot.tasks_without_terminal_record, undefined);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
