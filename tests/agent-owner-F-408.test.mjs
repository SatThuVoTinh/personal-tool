/**
 * M12/T9 F-408 (legacy R9-L02-4) - the checkpoint repair must store an
 * ABSOLUTE whole-file offset.
 *
 * The fault-injected crash the finding measured: an event reaches the journal
 * (and is fsynced) but the process dies before the snapshot that anchors it is
 * written. The next read recovers the tail, writes the snapshot, and then
 * repairs the checkpoint. The tail's line ends are byte offsets into the TAIL
 * buffer, not into the journal (`splitJournalLines` is called on
 * `buffer.subarray(checkpoint.events_offset)`), but the repair copied one of
 * them straight into the absolute `events_offset` field.
 *
 * The result was internally self-consistent (offset and digest agreed with each
 * other) and looked like journal-chain corruption: the SECOND read sliced the
 * journal at the tail-relative offset, landed mid-line, and reported
 * EXECUTION_STATE_UNKNOWN.
 *
 * This lane pins the acceptance criteria:
 *
 *   - a crash between the journal fsync and the snapshot write still yields
 *     `readSnapshot` succeeding on two consecutive reads;
 *   - the repaired `events_offset` is the absolute end of the anchored prefix
 *     (the checkpoint's existing offset plus the tail-relative end);
 *   - `prefix_digest` seals exactly the journal bytes up to that offset.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  checkpointDigest,
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

const OPENED = (taskId) => ({
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  task_id: taskId,
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
});

const ROOT_RESULT = (taskId) => ({
  task_id: taskId,
  brief_revision: 1,
  native_run_id: "root-run",
  agent_id: "main",
  payload_digest: "1".repeat(64),
  outcome_status: "COMPLETE",
  reason_code: "NONE",
  governance_hash: governanceHash("main"),
});

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "f408-"));
}

function checkpointFile(paths) {
  return path.join(paths.root, "checkpoint.json");
}

/**
 * Append one event line to the journal WITHOUT writing its snapshot or its
 * checkpoint - the crash window the finding measured.
 */
function appendCrashWindowEvent(paths, snapshot, sequence, type, payload) {
  const body = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence,
    type,
    payload,
    created_at: "2026-10-23T00:00:00.000Z",
    previous_event_digest: snapshot.last_event_digest,
  };
  const event_digest = canonicalHash("zink-ledger-event-v1", body);
  appendFileSync(
    paths.events,
    `${JSON.stringify({ ...body, event_digest })}\n`,
    "utf8",
  );
}

test("F-408 (R9-L02-4): a crash after the journal fsync repairs an ABSOLUTE events_offset and stays readable", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const taskId = deriveTaskId(OPENED("x"));
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
    recordWorkflowEvent(
      paths,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      ROOT_RESULT(taskId),
    );

    // The crash: event 3 reached the journal and was fsynced, but the process
    // died before the snapshot (and its checkpoint) were rewritten. A
    // TASK_CREATED is audit-only, so it only advances the anchor.
    const snapshotBeforeCrash = JSON.parse(
      readFileSync(paths.snapshot, "utf8"),
    );
    appendCrashWindowEvent(paths, snapshotBeforeCrash, 3, "TASK_CREATED", {
      task_id: taskId,
    });
    assert.equal(statSync(paths.events).size > 0, true);

    // The first read recovers the tail and repairs the checkpoint. This read
    // is green at HEAD: the bug is in the anchor it leaves behind.
    const first = readSnapshot(paths);
    assert.equal(first.sequence, 3, "the recovered tail advances the anchor");
    assert.equal(first.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");

    const journal = readFileSync(paths.events);
    const repaired = JSON.parse(readFileSync(checkpointFile(paths), "utf8"));
    assert.equal(
      repaired.events_offset,
      journal.length,
      "the repaired anchor must be an absolute whole-file offset, not the tail-relative end",
    );
    const repairedSnapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    assert.equal(
      repaired.prefix_digest,
      checkpointDigest(journal, repairedSnapshot.tasks),
      "the seal must cover exactly the journal bytes up to the absolute anchor",
    );

    // The second read is the one the tail-relative anchor broke: it sliced the
    // journal mid-line and reported EXECUTION_STATE_UNKNOWN.
    const second = readSnapshot(paths);
    assert.equal(second.sequence, 3);
    assert.equal(second.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");

    // Two consecutive reads must agree, and the checkpoint stays absolute.
    const third = readSnapshot(paths);
    assert.deepEqual(third, second);
    assert.equal(
      JSON.parse(readFileSync(checkpointFile(paths), "utf8")).events_offset,
      journal.length,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-408 (R9-L02-4): the repaired checkpoint is the one the next read resumes from", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const taskId = deriveTaskId(OPENED("y"));
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
    recordWorkflowEvent(
      paths,
      "WORKFLOW_ROOT_RESULT_RECORDED",
      ROOT_RESULT(taskId),
    );

    const snapshotBeforeCrash = JSON.parse(
      readFileSync(paths.snapshot, "utf8"),
    );
    appendCrashWindowEvent(paths, snapshotBeforeCrash, 3, "TASK_CREATED", {
      task_id: taskId,
    });

    readSnapshot(paths);
    const journal = readFileSync(paths.events);
    const repaired = JSON.parse(readFileSync(checkpointFile(paths), "utf8"));
    assert.equal(repaired.events_offset, journal.length);

    // A checkpoint that resumes at an absolute anchor can be VERIFIED rather
    // than replayed. Break the anchored byte and the read must still refuse:
    // the repair did not turn the verified prefix into trusted prose.
    const tampered = Buffer.from(journal);
    tampered[0] ^= 0xff;
    writeFileSync(paths.events, tampered);
    assert.throws(
      () => readSnapshot(paths),
      { code: "EXECUTION_STATE_UNKNOWN" },
      "the repaired anchor must still verify the bytes it seals",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
