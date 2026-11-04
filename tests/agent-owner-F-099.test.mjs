/**
 * M12/T9 F-099 — the ledger replay checkpoint.
 *
 * The reader replayed the WHOLE event log on every operation: every line was
 * re-parsed, re-validated against the contract, re-hashed and re-applied,
 * including the anchored prefix the snapshot had already sealed. The cost is
 * O(total history) per operation, and a read holds the WRITER LOCK for the
 * whole of it, so the lock-hold time — and with it the FILE_LOCK_BUSY window
 * — grew linearly with the ledger.
 *
 * The checkpoint is the replay's resume point: a small file in the ledger
 * root, written with the snapshot, that records where the anchored prefix
 * ends and what seals it. The reader then replays only the tail.
 *
 * This lane pins:
 *
 *   - the checkpoint's shape, its mode, and the fact that it is written with
 *     the snapshot it describes;
 *   - the anchored prefix is VERIFIED, not replayed: the reader starts the
 *     chain at the snapshot's own anchor;
 *   - `prefix_digest` is not optional: a corrupted ANCHORED event still makes
 *     the read throw;
 *   - a stale checkpoint is rebuilt, never trusted;
 *   - the era flag survives in the checkpoint;
 *   - the checkpoint may not outlive the state it describes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import process from "node:process";
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
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const PRE_VERDICT_VERSION = "m7-t5-r13";

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `f099-${tag}-`));
}

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

function checkpointFile(paths) {
  return path.join(paths.root, "checkpoint.json");
}

function readCheckpointFile(paths) {
  return JSON.parse(readFileSync(checkpointFile(paths), "utf8"));
}

/** A ledger with one task, its root result, and a checkpoint that describes it. */
function ledgerWithCheckpoint(tag) {
  const root = fixture(tag);
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const taskId = deriveTaskId(OPENED("x"));
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
  recordWorkflowEvent(
    paths,
    "WORKFLOW_ROOT_RESULT_RECORDED",
    ROOT_RESULT(taskId),
  );
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  return { root, paths, taskId, snapshot };
}

describe("F-099 — the ledger replay checkpoint", () => {
  it("the checkpoint is written with the snapshot and describes its anchor", () => {
    const { root, paths, taskId, snapshot } = ledgerWithCheckpoint("shape");
    try {
      assert.equal(existsSync(checkpointFile(paths)), true);
      const checkpoint = readCheckpointFile(paths);
      assert.deepEqual(Object.keys(checkpoint).sort(), [
        "events_offset",
        "has_pre_verdict_stamp",
        "last_event_digest",
        "prefix_digest",
        "sequence",
      ]);
      assert.equal(checkpoint.sequence, snapshot.sequence);
      assert.equal(checkpoint.last_event_digest, snapshot.last_event_digest);

      assert.equal(
        checkpoint.events_offset,
        statSync(paths.events).size,
        "the anchored prefix ends where the journal ends",
      );
      assert.equal(checkpoint.has_pre_verdict_stamp, false);
      assert.match(checkpoint.prefix_digest, /^[a-f0-9]{64}$/u);
      // The file is private state, like the journal and the snapshot. Windows
      // does not report POSIX mode bits, so the mode is asserted where the
      // platform has them.
      if (process.platform !== "win32") {
        assert.equal(statSync(checkpointFile(paths)).mode & 0o777, 0o600);
      }
      // The read-back still works, and the task is there.
      const read = readSnapshot(paths);
      assert.equal(read.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a checkpoint that does not seal the snapshot is stale: the reader rebuilds it", () => {
    const { root, paths, taskId, snapshot } =
      ledgerWithCheckpoint("stale-seal");
    try {
      const journal = readFileSync(paths.events);
      // A checkpoint whose seal does NOT match the snapshot's own states is
      // stale, so the reader falls back to the full read and rewrites it.
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
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "a stale checkpoint must not make a valid ledger unreadable",
      );
      // The checkpoint is REBUILT, not trusted: it now seals the journal and
      // the snapshot the reader verified.
      const rebuilt = readCheckpointFile(paths);
      assert.equal(rebuilt.sequence, snapshot.sequence);
      assert.equal(
        rebuilt.prefix_digest,
        checkpointDigest(journal, snapshot.tasks),
        "the rebuilt checkpoint seals the journal and the snapshot",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a snapshot that disagrees with the events is still refused", () => {
    const { root, paths } = ledgerWithCheckpoint("tampered");
    try {
      // The snapshot's task states are tampered with. The checkpoint no longer
      // seals them, so the reader falls back to the full read - which
      // re-derives the anchored projection and refuses the mismatch.
      const tampered = JSON.parse(readFileSync(paths.snapshot, "utf8"));
      const [taskId] = Object.keys(tampered.tasks);
      tampered.tasks[taskId].workflow_status = "COMPLETE";
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(tampered, null, 2)}\n`,
        "utf8",
      );
      assert.throws(
        () => readSnapshot(paths),
        { code: "EXECUTION_STATE_UNKNOWN" },
        "a snapshot that disagrees with the events must still be refused",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the anchored prefix is verified, not replayed: the chain starts at the anchor", () => {
    const root = fixture("skip");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      // An anchored event the CURRENT reducer would refuse: the payload does
      // not satisfy the published contract. The full read refuses it, so the
      // reader can only succeed if the anchored prefix is NOT replayed.
      const body = {
        schema_version: "1.0.0",
        governance_version: GOVERNANCE_VERSION,
        sequence: 1,
        type: "WORKFLOW_OPENED",
        payload: { task_id: "not-a-valid-opener" },
        created_at: "2026-09-01T00:00:00.000Z",
        previous_event_digest: null,
      };
      const event_digest = canonicalHash("zink-ledger-event-v1", body);
      const line = `${JSON.stringify({ ...body, event_digest })}\n`;
      writeFileSync(paths.events, line, "utf8");
      const snapshot = {
        schema_version: "1.0.0",
        governance_version: GOVERNANCE_VERSION,
        sequence: 1,
        last_event_digest: event_digest,
        ingress_ids: [],
        tasks: {},
        updated_at: "2026-09-01T00:00:00.000Z",
      };
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(snapshot, null, 2)}\n`,
        "utf8",
      );
      // Without a checkpoint the anchored event is replayed and refused.
      assert.throws(
        () => readSnapshot(paths),
        { code: "EXECUTION_STATE_UNKNOWN" },
        "the full read replays the anchored prefix",
      );
      // With a checkpoint that seals the journal and the snapshot, the reader
      // verifies the seal and replays only the tail - the anchored event is
      // never replayed.
      const journal = readFileSync(paths.events);
      writeFileSync(
        checkpointFile(paths),
        `${JSON.stringify(
          {
            sequence: snapshot.sequence,
            last_event_digest: snapshot.last_event_digest,
            has_pre_verdict_stamp: false,
            events_offset: journal.length,
            prefix_digest: checkpointDigest(journal, snapshot.tasks),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const read = readSnapshot(paths);
      assert.equal(read.sequence, 1);
      assert.deepEqual(read.tasks, {});
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a corrupted ANCHORED event still makes the read throw", () => {
    const { root, paths } = ledgerWithCheckpoint("corrupt");
    try {
      assert.equal(existsSync(checkpointFile(paths)), true);
      const corrupted = readFileSync(paths.events, "utf8").replace(
        "WORKFLOW_OPENED",
        "WORKFLOW_OPENEK",
      );
      writeFileSync(paths.events, corrupted, "utf8");
      assert.throws(
        () => readSnapshot(paths),
        /Ledger corruption/u,
        "the prefix digest is what makes a corrupted anchored event visible",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a stale checkpoint falls back to the full read and is rebuilt", () => {
    const { root, paths, taskId } = ledgerWithCheckpoint("stale");
    try {
      const before = readCheckpointFile(paths);
      // A benign change to the anchored bytes: the event still parses to the
      // same object, so the journal is still valid, but the checkpoint no
      // longer describes it.
      const benign = readFileSync(paths.events, "utf8").replace(
        '{"schema_version"',
        '{ "schema_version"',
      );
      writeFileSync(paths.events, benign, "utf8");
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "a stale checkpoint must not make a valid journal unreadable",
      );
      const after = readCheckpointFile(paths);
      assert.notEqual(
        after.prefix_digest,
        before.prefix_digest,
        "the stale checkpoint must be rebuilt",
      );
      assert.equal(after.sequence, before.sequence);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the era flag survives in the checkpoint", () => {
    const root = fixture("era");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      // A legacy-era journal: every event carries a PRE-VERDICT stamp.
      const bodies = [
        {
          governance_version: PRE_VERDICT_VERSION,
          type: "WORKFLOW_OPENED",
          payload: OPENED(taskId),
        },
        {
          governance_version: PRE_VERDICT_VERSION,
          type: "WORKFLOW_ROOT_RESULT_RECORDED",
          payload: ROOT_RESULT(taskId),
        },
      ];
      let previous = null;
      const lines = bodies.map((body, index) => {
        const signed = {
          schema_version: "1.0.0",
          governance_version: body.governance_version,
          sequence: index + 1,
          type: body.type,
          payload: body.payload,
          created_at: "2026-09-01T00:00:00.000Z",
          previous_event_digest: previous,
        };
        const event_digest = canonicalHash("zink-ledger-event-v1", signed);
        previous = event_digest;
        return { ...signed, event_digest };
      });
      writeFileSync(
        paths.events,
        `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
        "utf8",
      );
      let projection = { tasks: {} };
      for (const line of lines) {
        projection = applyWorkflowEvent(
          projection,
          line.type,
          line.payload,
          line.created_at,
          { replayAnchored: true, preVerdictRootResult: true },
        );
      }
      writeFileSync(
        paths.snapshot,
        `${JSON.stringify(
          {
            schema_version: "1.0.0",
            governance_version: PRE_VERDICT_VERSION,
            sequence: lines.length,
            last_event_digest: previous,
            ingress_ids: [],
            tasks: projection.tasks,
            updated_at: "2026-09-01T00:00:00.000Z",
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      const read = readSnapshot(paths);
      assert.equal(read.tasks[taskId].workflow_status, "COMPLETE");
      const checkpoint = readCheckpointFile(paths);
      assert.equal(
        checkpoint.has_pre_verdict_stamp,
        true,
        "the era the journal declares must survive in the checkpoint",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a checkpoint may not outlive the state it describes", () => {
    const { root, paths } = ledgerWithCheckpoint("orphan");
    try {
      rmSync(paths.snapshot);
      assert.throws(
        () => ensureLedger(paths),
        { code: "EXECUTION_STATE_UNKNOWN" },
        "a checkpoint beside a ledger that does not exist is refused",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a ledger without a checkpoint still reads, and the checkpoint is rebuilt", () => {
    const { root, paths, taskId } = ledgerWithCheckpoint("rebuild");
    try {
      rmSync(checkpointFile(paths));
      const read = readSnapshot(paths);
      assert.equal(read.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");
      assert.equal(
        existsSync(checkpointFile(paths)),
        true,
        "the reader rebuilds the checkpoint it needs",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the current stamp is never a pre-verdict era", () => {
    const { root, paths } = ledgerWithCheckpoint("current");
    try {
      assert.equal(
        readCheckpointFile(paths).has_pre_verdict_stamp,
        false,
        "a current-version journal is not a legacy-era journal",
      );
      assert.equal(GOVERNANCE_VERSION, "m8-t2.3-r5");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
