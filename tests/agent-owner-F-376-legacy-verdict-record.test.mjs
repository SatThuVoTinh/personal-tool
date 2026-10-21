// M12/T9 F-376 — the record must stay readable.
//
// F-249 withdrew `result_id` from the four verdict payload branches of
// `ledger-event.schema.json`, so the contract stopped admitting a member the
// OLDER build's verdicts carry. The live journal holds two such verdicts
// (sequences 66 and 83, `WORKFLOW_USER_RESULT_ACCEPTED`, written by the
// `m8-t2.2-r4` build), so the current contract refused the live record: the
// preflight reported "Ledger corruption" and the apply died with
// SCHEMA_VALIDATION_FAILED — the deploy could not complete.
//
// The journal is the RECORD and it is never rewritten, so the contract has to
// admit the legacy rendering. This lane pins:
//
//   1. a verdict the older build wrote is READ, and the ledger reads it again;
//   2. the contract still refuses a member it does not declare — the gate is
//      not weakened, only ONE named legacy member is admitted;
//   3. the reducer still refuses an id-ONLY verdict (F-249's ruling), and the
//      live producer still never sends the legacy member.
import assert from "node:assert/strict";
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
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

const ROOT_DIGEST = "1".repeat(64);
const LEGACY_RESULT_ID = "legacy-result-1";

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "zink-f376-"));
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
  payload_digest: ROOT_DIGEST,
  outcome_status: "COMPLETE",
  reason_code: "NONE",
  governance_hash: governanceHash("main"),
});

const ACCEPT = (taskId, extra = {}) => ({
  task_id: taskId,
  actor: "user",
  channel: "results",
  decision: "ACCEPT",
  ...extra,
});

/**
 * A journal whose ACCEPTED history carries the LEGACY verdict member.
 *
 * The event is written by hand, exactly as the older build wrote it: the
 * payload names the result id next to the digest, and the event carries the
 * older build's governance version. Everything else — the chain, the digests,
 * the projection — is the current build's own.
 */
function legacyVerdictJournal(paths, taskId) {
  const bodies = [
    {
      type: "WORKFLOW_OPENED",
      payload: OPENED(taskId),
      created_at: "2026-10-01T00:00:00.000Z",
      governance_version: "m8-t2.2-r4",
    },
    {
      type: "WORKFLOW_ROOT_RESULT_RECORDED",
      payload: ROOT_RESULT(taskId),
      created_at: "2026-10-01T00:01:00.000Z",
      governance_version: "m8-t2.2-r4",
    },
    {
      type: "WORKFLOW_USER_RESULT_ACCEPTED",
      payload: ACCEPT(taskId, {
        result_digest: ROOT_DIGEST,
        result_id: LEGACY_RESULT_ID,
      }),
      created_at: "2026-10-01T00:02:00.000Z",
      governance_version: "m8-t2.2-r4",
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
        governance_version: "m8-t2.2-r4",
        sequence: lines.length,
        last_event_digest: previous,
        ingress_ids: [],
        tasks: projection.tasks,
        updated_at: "2026-10-01T00:02:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

test("F-376: a verdict the older build wrote is READ, and the ledger reads it again", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const taskId = deriveTaskId(OPENED("x"));
    legacyVerdictJournal(paths, taskId);

    // The reader accepts the record: the legacy member no longer makes the
    // contract refuse the journal.
    const read = readSnapshot(paths);
    assert.equal(
      read.tasks[taskId].workflow_status,
      "COMPLETE",
      "the verdict the older build wrote must be readable",
    );

    // The preflight reports the ledger as CURRENT — it is the record that
    // decides, and the record verifies.
    assert.equal(
      inspectLedgerUpgrade(paths, { probeWriterLock: false }),
      "CURRENT",
      "a readable record must not be refused by the preflight",
    );

    // And the migration recomputes the derived cache from the record — the
    // journal is never written.
    const journalBefore = readFileSync(paths.events, "utf8");
    const report = migrateLedgerProjection(paths);
    assert.equal(
      readFileSync(paths.events, "utf8"),
      journalBefore,
      "the migration must never write to the journal",
    );
    assert.equal(
      report.sequence,
      3,
      "the migration must derive the record's own head",
    );

    // The ledger reads again, with the state the record describes.
    const after = readSnapshot(paths);
    assert.equal(
      after.tasks[taskId].workflow_status,
      "COMPLETE",
      "the ledger must read again after the migration",
    );
    assert.equal(
      inspectLedgerUpgrade(paths, { probeWriterLock: false }),
      "CURRENT",
      "the recomputed ledger must be current",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-376: the contract still refuses a member it does not declare", () => {
  const root = fixture();
  try {
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const taskId = deriveTaskId(OPENED("x"));
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", OPENED(taskId));
    const lines = readFileSync(paths.events, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const opened = lines.find((event) => event.type === "WORKFLOW_OPENED");
    assert.ok(opened, "the fixture must journal an opener");

    // The legacy member is admitted.
    const legacy = {
      ...opened,
      sequence: opened.sequence + 1,
      type: "WORKFLOW_USER_RESULT_ACCEPTED",
      payload: ACCEPT(taskId, {
        result_digest: ROOT_DIGEST,
        result_id: LEGACY_RESULT_ID,
      }),
      previous_event_digest: opened.event_digest,
      event_digest: "2".repeat(64),
    };
    validateContract("ledger-event", legacy);

    // An UNKNOWN member is still refused: only the named legacy member is
    // admitted, the gate is not weakened.
    assert.throws(
      () =>
        validateContract("ledger-event", {
          ...legacy,
          payload: ACCEPT(taskId, {
            result_digest: ROOT_DIGEST,
            result_id: LEGACY_RESULT_ID,
            unknown_member: "x",
          }),
        }),
      { code: "SCHEMA_VALIDATION_FAILED" },
      "a member the contract does not declare must still be refused",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-376: the reducer still refuses an id-ONLY verdict, and the producer never sends it", () => {
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
    const state = readSnapshot(paths);

    // F-249's ruling is untouched: a verdict that names ONLY a result id
    // binds to nothing and is refused.
    assert.throws(
      () =>
        applyWorkflowEvent(
          state,
          "WORKFLOW_USER_RESULT_ACCEPTED",
          ACCEPT(taskId, { result_id: LEGACY_RESULT_ID }),
        ),
      { code: "RESULT_MISMATCH" },
      "an id-only verdict must still be refused",
    );

    // And the live producer does not send the legacy member any more.
    const source = readFileSync(
      new URL(
        "../integrations/openclaw/plugins/zink-governance/index.mjs",
        import.meta.url,
      ),
      "utf8",
    );
    assert.equal(
      source.includes("result_id:"),
      false,
      "no verdict payload may carry a result id any more",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
