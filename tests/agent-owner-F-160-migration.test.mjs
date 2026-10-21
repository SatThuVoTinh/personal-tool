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
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureLedger,
  ledgerPaths,
  migrateLedgerProjection,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { recordWorkflowEvent } from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";

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
    writeFileSync(paths.snapshot, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

    // The reader refuses: the stored snapshot and the replay disagree.
    assert.throws(
      () => readSnapshot(paths),
      (err) => /snapshot workflow mismatch|Ledger corruption/u.test(err.message),
      "the reader must refuse a snapshot that disagrees with its journal",
    );

    // The migration recomputes the derived state from the record.
    const report = migrateLedgerProjection(paths);
    assert.equal(report.changed, true, "the migration must report the recompute");

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
    const lines = readFileSync(paths.events, "utf8").split("\n").filter(Boolean);
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
    assert.equal(report.changed, false, "a current ledger must not be rewritten");
    assert.equal(
      readFileSync(paths.snapshot, "utf8"),
      before,
      "a current ledger's snapshot must be byte-identical",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
