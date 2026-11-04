// M12/T9 F-100 (legacy R1-A08-07) - every schema-permitted event type has a
// defined replay behaviour in BOTH regions.
//
// MEASURED AT HEAD: the anchored region ignored `TASK_CREATED` and
// `DELEGATION_RESERVED` by accident of the `WORKFLOW_` prefix test, and the
// tail region threw "unreconciled event after snapshot" for them, which
// relabelled to EXECUTION_STATE_UNKNOWN and made every later read of the
// ledger fail forever. The position was reachable: the writer fsyncs the
// event BEFORE the snapshot that anchors it, so a crash in between leaves
// exactly such an event in the tail.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  appendEvent,
  ensureLedger,
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

function lineage(tag) {
  const root = mkdtempSync(path.join(os.tmpdir(), `f100-${tag}-`));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  return { root, paths };
}

// Reproduce the crash window: the event is fsynced, the snapshot that
// anchors it is not written.
function crashWindow(paths, type) {
  const snapshot = readSnapshot(paths);
  appendEvent(paths, snapshot, type, { task_id: "a".repeat(64) });
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(
      {
        schema_version: "1.0.0",
        governance_version: "m8-t2.3-r5",
        sequence: 0,
        last_event_digest: null,
        ingress_ids: [],
        tasks: {},
        updated_at: "2026-09-29T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
}

describe("F-100 - the audit-only event types replay in both regions", () => {
  it("a TASK_CREATED in the tail does not brick the read", () => {
    const { root, paths } = lineage("created");
    try {
      crashWindow(paths, "TASK_CREATED");
      const read = readSnapshot(paths);
      assert.equal(read.sequence, 1, "the audit record is reconciled");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a DELEGATION_RESERVED in the tail does not brick the read", () => {
    const { root, paths } = lineage("reserved");
    try {
      crashWindow(paths, "DELEGATION_RESERVED");
      const read = readSnapshot(paths);
      assert.equal(read.sequence, 1, "the audit record is reconciled");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
