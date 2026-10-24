/**
 * M12/T9 F-414 (legacy R9-T03-1) - the forward migration must re-anchor the
 * checkpoint it re-derives the projection from.
 *
 * `migrateLedgerProjection` re-derives the snapshot by replaying the whole
 * journal in the reader's recompute mode. The recompute mode skips the
 * checkpoint on purpose (it replays the anchored prefix too), and the reader's
 * checkpoint writer is gated on `!recompute`, so the migration wrote the
 * snapshot and left the OLD checkpoint exactly where it was.
 *
 * A checkpoint that mis-anchors the journal (the F-408 shape: a tail-relative
 * `events_offset`) therefore survived the deploy ceremony: the migration
 * reported `changed:false` because the snapshot already agreed with the
 * journal, the ceremony completed green, and the very next `readSnapshot` still
 * threw EXECUTION_STATE_UNKNOWN from a parse that started mid-journal.
 * `inspectLedgerUpgrade` rethrew "Ledger corruption" after that.
 *
 * This lane pins the acceptance criteria:
 *
 *   - a wrong-anchored checkpoint fixture makes `readSnapshot` refuse;
 *   - `migrateLedgerProjection` rewrites or deletes that checkpoint whenever
 *     it re-derives the projection (`changed:false` included);
 *   - `readSnapshot` passes on two consecutive reads immediately after the
 *     migration returns - no further repair.
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
  inspectLedgerUpgrade,
  ledgerPaths,
  migrateLedgerProjection,
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
  return mkdtempSync(path.join(os.tmpdir(), "f414-"));
}

function checkpointFile(paths) {
  return path.join(paths.root, "checkpoint.json");
}

function seed(paths) {
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  recordWorkflowEvent(
    paths,
    "WORKFLOW_ROOT_RESULT_RECORDED",
    ROOT_RESULT(taskId),
  );
  return taskId;
}

/**
 * Append an audit-only event line to the journal WITHOUT writing its snapshot,
 * i.e. the F-408 crash window. The reader's first pass then recovers the tail.
 */
function appendAuditTail(paths) {
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  const [taskId] = Object.keys(snapshot.tasks);
  const body = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence: snapshot.sequence + 1,
    type: "TASK_CREATED",
    payload: { task_id: taskId },
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

/**
 * Rewrite the checkpoint in the shape the F-408 repair used to leave behind: a
 * self-consistent record whose `events_offset` is the LAST LINE's length, i.e.
 * tail-relative rather than absolute. The last line is deliberately the short
 * audit event, so the offset lands inside the first event line.
 */
function writeWrongAnchoredCheckpoint(paths) {
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  const journal = readFileSync(paths.events);
  const lines = journal.toString("utf8").split("\n").filter(Boolean);
  const tailRelativeEnd = Buffer.byteLength(lines.at(-1), "utf8");
  assert.ok(
    tailRelativeEnd < Buffer.byteLength(lines[0], "utf8"),
    "the fixture must anchor inside the first journal line",
  );
  writeFileSync(
    checkpointFile(paths),
    `${JSON.stringify(
      {
        sequence: snapshot.sequence,
        last_event_digest: snapshot.last_event_digest,
        has_pre_verdict_stamp: false,
        events_offset: tailRelativeEnd,
        prefix_digest: checkpointDigest(
          journal.subarray(0, tailRelativeEnd),
          snapshot.tasks,
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("F-414 (R9-T03-1): the migration re-anchors a wrong checkpoint and the ledger reads twice", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    const taskId = seed(paths);
    // Simulate the F-408 crash window and let the reader recover the snapshot;
    // the recovery's checkpoint is then rewritten into the wrong shape the
    // finding measured (tail-relative offset, self-consistent seal).
    appendAuditTail(paths);
    readSnapshot(paths);
    writeWrongAnchoredCheckpoint(paths);

    // The premise: the stored snapshot agrees with the journal, but the
    // checkpoint mis-anchors it, so the reader slices mid-journal.
    assert.throws(
      () => readSnapshot(paths),
      { code: "EXECUTION_STATE_UNKNOWN" },
      "a wrong-anchored checkpoint must make the ledger unreadable",
    );

    // The ceremony: the migration re-derives the whole projection. The
    // snapshot is already current, so it reports `changed:false` - exactly the
    // path the finding measured - and it must still dispose of the old anchor.
    const report = migrateLedgerProjection(paths);
    assert.equal(
      report.changed,
      false,
      "the fixture is the changed:false path the finding measured",
    );
    assert.equal(
      statSync(paths.events).size > 0,
      true,
      "the journal is the record and is never touched",
    );

    // No further repair: the first read after the migration must pass, and be
    // able to resume from whatever checkpoint the migration left (or rebuilt).
    const first = readSnapshot(paths);
    assert.equal(first.sequence, 3);
    assert.equal(first.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");
    const second = readSnapshot(paths);
    assert.deepEqual(second, first);

    // The upgrade inspector - the deploy preflight that rethrew "Ledger
    // corruption" on this state - now reports the ledger current.
    assert.equal(inspectLedgerUpgrade(paths), "CURRENT");

    // Whatever checkpoint now exists must describe the whole journal, not a
    // tail-relative slice.
    const journal = readFileSync(paths.events);
    const checkpoint = JSON.parse(readFileSync(checkpointFile(paths), "utf8"));
    assert.equal(checkpoint.events_offset, journal.length);
    assert.equal(
      checkpoint.prefix_digest,
      checkpointDigest(
        journal,
        JSON.parse(readFileSync(paths.snapshot, "utf8")).tasks,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-414 (R9-T03-1): a stale-but-correct checkpoint is re-derived, never trusted", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    const taskId = seed(paths);
    // A checkpoint that seals a DIFFERENT projection is stale. The migration
    // re-derives the snapshot from the journal, so it may not leave a
    // checkpoint describing the projection it replaced.
    const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    const journal = readFileSync(paths.events);
    writeFileSync(
      checkpointFile(paths),
      `${JSON.stringify(
        {
          sequence: snapshot.sequence,
          last_event_digest: snapshot.last_event_digest,
          has_pre_verdict_stamp: false,
          events_offset: journal.length,
          prefix_digest: checkpointDigest(journal, {
            ...snapshot.tasks,
            tampered: true,
          }),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    // The reader falls back to the full replay, which reproduces the snapshot.
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "RESULT_PENDING_REVIEW",
    );

    // The migration runs on a current ledger (changed:false) and must still
    // leave the ledger readable from the checkpoint it chooses to keep.
    const report = migrateLedgerProjection(paths);
    assert.equal(report.changed, false);
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "RESULT_PENDING_REVIEW",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
