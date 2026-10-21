// M12/T9 (the owner's ruling of 2026-10-21) — the forward migration of the
// DERIVED snapshot.
//
// F-160 changed how a task's state is re-derived from its events, and F-060
// changed what a task carries. A snapshot written by an older build therefore
// no longer agrees with its own journal, and the reader refuses with
// `snapshot workflow mismatch` — the ledger becomes unreadable even though the
// record it is derived from is intact.
//
// The journal is the RECORD; the snapshot is DERIVED from it. The migration
// recomputes the derived artefact from the authoritative record and never
// writes to the record.
//
// The deploy ceremony calls it, so the operator runs nothing by hand.
//
// This lane also pins the TWO properties the deploy depends on, because both
// of them were broken on a live host:
//
//   1. the migration projects with the READER's own anchored rule. The
//      accepted history is replayed with the admission the operator gave it,
//      so the reducer does not re-litigate an approval the history already
//      records. A migration that replays it under the strict rules refuses
//      the very history it is supposed to migrate;
//   2. the preflight does not refuse a STALE DERIVATION. A snapshot that
//      disagrees with its journal is not a broken record, and a preflight
//      that refuses it makes the migration unreachable.
//
// M12/T9 F-377 adds the third property, the one the migration could not do
// before: a stored snapshot that does not have the CURRENT SHAPE is repaired
// too. The snapshot contract itself changes (F-247 removed a member from it),
// so a snapshot an older build wrote does not satisfy the current contract -
// and the reader refused it at the contract check, before the comparison even
// ran, so the migration could not repair the very artefact it exists to
// repair.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureLedger,
  inspectLedgerUpgrade,
  ledgerPaths,
  migrateLedgerProjection,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { recordWorkflowEvent } from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
  GOVERNANCE_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const ORIGIN = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "1556249093729427459",
};

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "zink-migrate-"));
}

function seed(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...ORIGIN,
    task_id: deriveTaskId(ORIGIN),
    root_agent_id: "sql",
    root_session_key: "agent:sql:sess",
    root_run_id: "run-1",
  });
  return paths;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * A journal whose ACCEPTED history the strict rules refuse.
 *
 * The owner's decision names a thread, but no approval request was ever
 * recorded for it: the pre-F-023 shape, which the reader accepts only because
 * the anchored replay trusts the admission the history records. The strict
 * rules (a write) refuse it with INVALID_STATE_TRANSITION, and the relaxed
 * rules (an anchored replay) accept it.
 *
 * This is the live host's shape: the accepted history was written by a build
 * whose rules the current strict rules do not reproduce, so a migration that
 * replays it strictly dies with AUTH_APPROVAL_REQUIRED on a healthy ledger.
 */
function sealAcceptedHistory(paths) {
  const taskId = deriveTaskId(ORIGIN);
  const bodies = [
    {
      type: "WORKFLOW_OPENED",
      payload: {
        ...ORIGIN,
        task_id: taskId,
        root_agent_id: "sql",
        root_session_key: "agent:sql:sess",
        root_run_id: "run-1",
      },
      created_at: "2026-09-01T00:00:00.000Z",
    },
    {
      type: "WORKFLOW_USER_APPROVAL_DECIDED",
      payload: {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
        thread_id: "1556249093729427458",
      },
      created_at: "2026-09-01T00:01:00.000Z",
    },
  ];
  let previous = null;
  const lines = bodies.map((body, index) => {
    const signed = {
      schema_version: "1.0.0",
      governance_version: GOVERNANCE_VERSION,
      sequence: index + 1,
      type: body.type,
      payload: body.payload,
      created_at: body.created_at,
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
  // The projection the READER produces: the anchored rule, the same one the
  // migration must use.
  let projection = { tasks: {} };
  for (const line of lines) {
    projection = applyWorkflowEvent(
      projection,
      line.type,
      line.payload,
      line.created_at,
      { replayAnchored: true, preVerdictRootResult: false },
    );
  }
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(
      {
        schema_version: "1.0.0",
        governance_version: GOVERNANCE_VERSION,
        sequence: lines.length,
        last_event_digest: previous,
        ingress_ids: [],
        tasks: projection.tasks,
        updated_at: "2026-09-01T00:01:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return { taskId, projection };
}

/**
 * Make the stored snapshot an OLD SHAPE: a derivation the current contract
 * refuses.
 *
 * The live host's snapshot was written by an older build, so its tasks do not
 * carry the fields the current contract requires. The reader refused it at the
 * CONTRACT check - before the comparison, before the migration could recompute
 * it - so the deploy could not complete: the preflight said "Ledger
 * corruption" and the apply died with SCHEMA_VALIDATION_FAILED.
 *
 * The journal - the RECORD - is untouched by this: only the derived cache
 * wears the old shape.
 */
function oldShapeSnapshot(paths) {
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  const [taskId] = Object.keys(snapshot.tasks);
  delete snapshot.tasks[taskId].brief_state;
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  return taskId;
}

/** Make the stored snapshot a stale DERIVATION of an intact record. */
function staleSnapshot(paths) {
  const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  const [taskId] = Object.keys(snapshot.tasks);
  snapshot.tasks[taskId].workflow_status = "REJECTED";
  writeFileSync(
    paths.snapshot,
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  return taskId;
}

test("F-160/F-060: a snapshot that disagrees with its journal is recomputed from the journal", () => {
  const root = fixture();
  try {
    const paths = seed(root);
    const journalBefore = readFileSync(paths.events, "utf8");
    // The snapshot is the DERIVED artefact: an older build wrote it with a
    // state the current rules no longer produce, so it disagrees with the
    // record it is derived from.
    const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    const [taskId] = Object.keys(snapshot.tasks);
    snapshot.tasks[taskId].workflow_status = "REJECTED";
    writeFileSync(
      paths.snapshot,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );

    // The reader refuses: the stored snapshot and the replay disagree.
    assert.throws(
      () => readSnapshot(paths),
      (err) =>
        /snapshot workflow mismatch|Ledger corruption/u.test(err.message),
      "the reader must refuse a snapshot that disagrees with its journal",
    );

    // The migration recomputes the derived state from the record.
    const report = migrateLedgerProjection(paths);
    assert.equal(
      report.changed,
      true,
      "the migration must report the recompute",
    );

    // The RECORD is untouched - byte for byte.
    assert.equal(
      sha256(readFileSync(paths.events, "utf8")),
      sha256(journalBefore),
      "the migration must never write to the journal",
    );

    // And the ledger reads again, with the state the journal describes.
    const read = readSnapshot(paths);
    assert.equal(
      read.tasks[taskId].workflow_status,
      "ACTIVE",
      "the recomputed state is the one the journal describes",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160/F-060: a journal that does not verify is refused and NOTHING is written", () => {
  const root = fixture();
  try {
    const paths = seed(root);
    const snapshotBefore = readFileSync(paths.snapshot, "utf8");
    // A corrupted event: the chain no longer verifies.
    const lines = readFileSync(paths.events, "utf8")
      .split("\n")
      .filter(Boolean);
    const corrupted = JSON.parse(lines[0]);
    corrupted.payload.root_agent_id = "excel";
    writeFileSync(paths.events, `${JSON.stringify(corrupted)}\n`, "utf8");

    assert.throws(
      () => migrateLedgerProjection(paths),
      (err) => /event chain mismatch/u.test(err.message),
      "a journal that does not verify must be refused",
    );
    assert.equal(
      readFileSync(paths.snapshot, "utf8"),
      snapshotBefore,
      "a refused migration must write nothing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160/F-060: a ledger that already agrees with its journal is left alone", () => {
  const root = fixture();
  try {
    const paths = seed(root);
    const before = readFileSync(paths.snapshot, "utf8");
    const report = migrateLedgerProjection(paths);
    assert.equal(
      report.changed,
      false,
      "a current ledger must not be rewritten",
    );
    assert.equal(
      readFileSync(paths.snapshot, "utf8"),
      before,
      "a current ledger's snapshot must be byte-identical",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160: the migration projects with the READER's anchored rule", () => {
  // The live host's defect: the migration replayed the ACCEPTED history under
  // the strict rules, so the reducer demanded a post-approval state that
  // history never had and the migration died with AUTH_APPROVAL_REQUIRED on
  // a healthy ledger. The migration must project exactly what the reader
  // projects.
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const { taskId, projection } = sealAcceptedHistory(paths);

    // The reader accepts the accepted history.
    const read = readSnapshot(paths);
    assert.equal(
      read.tasks[taskId].workflow_status,
      "QUEUED",
      "the reader must accept the history it anchored",
    );

    // The stored snapshot is now a stale derivation of that record.
    staleSnapshot(paths);

    // The migration must succeed: it projects the history the way the reader
    // does, and it never re-litigates the admission.
    const report = migrateLedgerProjection(paths);
    assert.equal(report.changed, true, "the stale snapshot must be recomputed");

    // And the recomputed projection is the READER's projection, byte for
    // byte - not a second, independently derived one.
    const migrated = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    assert.deepEqual(
      migrated.tasks,
      projection.tasks,
      "the migration must derive exactly what the reader derives",
    );
    assert.equal(
      readSnapshot(paths).tasks[taskId].workflow_status,
      "QUEUED",
      "the ledger must read again after the migration",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160: the migration never drops a task the journal does not describe", () => {
  // A task the journal does not produce is not a stale derivation, it is
  // governance history the record lost. The recompute refuses instead of
  // repairing it away.
  const root = fixture();
  try {
    const paths = seed(root);
    const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    const [taskId] = Object.keys(snapshot.tasks);
    snapshot.tasks["f".repeat(64)] = {
      ...snapshot.tasks[taskId],
      workflow_status: "ACTIVE",
    };
    writeFileSync(
      paths.snapshot,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    const before = readFileSync(paths.snapshot, "utf8");

    assert.throws(
      () => migrateLedgerProjection(paths),
      (err) => /snapshot task missing from journal/u.test(err.message),
      "a task the journal does not describe must be refused, not dropped",
    );
    assert.equal(
      readFileSync(paths.snapshot, "utf8"),
      before,
      "a refused migration must write nothing",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160: the preflight does not refuse a stale DERIVATION", () => {
  // A stale derivation is not a broken record: the journal still verifies and
  // the apply recomputes the cache from it. A preflight that refuses it makes
  // the migration unreachable - the deploy can never complete.
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    sealAcceptedHistory(paths);

    // A healthy ledger is CURRENT, exactly as before.
    assert.equal(inspectLedgerUpgrade(paths), "CURRENT");

    staleSnapshot(paths);

    assert.equal(
      inspectLedgerUpgrade(paths),
      "CURRENT_STALE",
      "a stale derivation must be reported, not refused",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160: a record that does not verify still refuses the preflight", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    sealAcceptedHistory(paths);
    const lines = readFileSync(paths.events, "utf8")
      .split("\n")
      .filter(Boolean);
    const corrupted = JSON.parse(lines[0]);
    corrupted.payload.root_agent_id = "excel";
    writeFileSync(paths.events, `${JSON.stringify(corrupted)}\n`, "utf8");

    assert.throws(
      () => inspectLedgerUpgrade(paths),
      (err) => /Ledger corruption/u.test(err.message),
      "a broken record must still refuse the deployment",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160/F-377: a snapshot in an OLD shape is recomputed from the journal", () => {
  // The live host's shape: an older build wrote the derived cache, so the
  // cache does not have the current shape. The reader refuses it at the
  // CONTRACT check - before the comparison - so the migration could not repair
  // it and the deploy could not complete.
  const root = fixture();
  try {
    const paths = seed(root);
    const journalBefore = readFileSync(paths.events, "utf8");
    const taskId = oldShapeSnapshot(paths);

    // The reader still refuses it: the old shape is not the current contract.
    assert.throws(
      () => readSnapshot(paths),
      (err) => /Ledger corruption/u.test(err.message),
      "the reader must refuse a snapshot that does not have the current shape",
    );

    // The migration recomputes the derived state from the record.
    const report = migrateLedgerProjection(paths);
    assert.equal(
      report.changed,
      true,
      "the old-shaped snapshot must be recomputed",
    );

    // The RECORD is untouched - byte for byte.
    assert.equal(
      sha256(readFileSync(paths.events, "utf8")),
      sha256(journalBefore),
      "the migration must never write to the journal",
    );

    // The recomputed snapshot carries the CURRENT shape again.
    const migrated = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    assert.equal(
      migrated.tasks[taskId].brief_state,
      "ACTIVE",
      "the recomputed snapshot must have the current shape",
    );

    // And the ledger reads again.
    const read = readSnapshot(paths);
    assert.equal(
      read.tasks[taskId].workflow_status,
      "ACTIVE",
      "the ledger must read again after the migration",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-160/F-377: the preflight does not refuse a snapshot in an OLD shape", () => {
  // An older build's derivation is a STALE DERIVATION, not a broken record:
  // the journal still verifies and the apply recomputes the cache from it. A
  // preflight that refuses it makes the migration unreachable - the deploy can
  // never complete.
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    sealAcceptedHistory(paths);

    // A healthy ledger is CURRENT, exactly as before.
    assert.equal(inspectLedgerUpgrade(paths), "CURRENT");

    oldShapeSnapshot(paths);

    assert.equal(
      inspectLedgerUpgrade(paths),
      "CURRENT_STALE",
      "an old-shaped derivation must be reported, not refused",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
