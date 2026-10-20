// M12/T9 F-081 (legacy R1-A08-03) - a discarded receipt must be visible.
//
// MEASURED AT HEAD: `recordWorkflowEvent` returned the UNCHANGED snapshot when
// the projection did not change, so the caller received success, nothing was
// appended, and the ledger could not tell "arrived and was ignored" from
// "never happened" - the event-count reconciliation the terminal forensics
// need was impossible.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ensureLedger,
  ledgerPaths,
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

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f081-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

const lines = (paths) =>
  readFileSync(paths.events, "utf8").split("\n").filter(Boolean);

describe("F-081 - a discarded receipt is reported to the caller", () => {
  it("a duplicate receipt is reported as discarded", () => {
    const { root, paths } = lineage("dup");
    try {
      const payload = { ...OPENED };
      const taskId = deriveTaskId(payload);
      const first = recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...payload,
        task_id: taskId,
      });
      assert.equal(first.discarded, undefined, "a real write is not discarded");
      const before = lines(paths).length;
      const second = recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...payload,
        task_id: taskId,
      });
      assert.equal(
        second.discarded,
        true,
        "the caller must be able to tell that the receipt was ignored",
      );
      assert.equal(
        lines(paths).length,
        before,
        "a discarded receipt appends nothing to the journal",
      );
      assert.equal(second.tasks[taskId].workflow_status, "ACTIVE");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the discarded flag does not change the snapshot the caller holds", () => {
    const { root, paths } = lineage("shape");
    try {
      const payload = { ...OPENED, origin_message_id: "123456789012345679" };
      const taskId = deriveTaskId(payload);
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...payload,
        task_id: taskId,
      });
      const discarded = recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...payload,
        task_id: taskId,
      });
      assert.deepEqual(
        Object.keys(discarded).sort(),
        Object.keys(
          recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
            ...payload,
            task_id: taskId,
          }),
        ).sort(),
        "the discarded result is still the snapshot and nothing else",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
