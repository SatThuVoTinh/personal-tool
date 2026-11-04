/**
 * M12/T9 F-160 — the ambiguous `m8-t2.2-r4` journal stamp is SEALED.
 *
 * The owner's ruling (2026-10-21): "như đề xuất" — r4 is a VERDICT stamp.
 *
 * Before the ruling the reader resolved an r4 event with the JOURNAL's scope:
 * a journal carrying ANY pre-verdict stamp re-resolved EVERY r4 event as
 * pre-verdict. The semantics of one event therefore depended on which OTHER
 * events sat in the same file, so deleting one legacy line (compaction, tail
 * surgery, a mixed backup restore) silently re-resolved the governance history
 * of every other event in the journal.
 *
 * This lane pins the sealed reading:
 *
 *   - an r4-only journal classifies as a verdict (the pinned assertion in
 *     tests/m8-t2.3-writer-semantics.test.mjs);
 *   - a MIXED journal (one pre-verdict line + one r4 root result) classifies
 *     the r4 event as a verdict as well — the case the journal-scope
 *     discriminator got wrong;
 *   - a pre-verdict stamp still classifies as pre-verdict, so the journals
 *     that predate the verdict model still replay historically
 *     (tests/m8-t2-anchored-replay.test.mjs asserts the same resolution);
 *   - the CURRENT stamp is a verdict, always.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  canonicalHash,
  deriveTaskId,
  GOVERNANCE_VERSION,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import { governanceHash } from "../integrations/openclaw/lib/policy.mjs";

const PRE_VERDICT_VERSION = "m7-t5-r13";
const AMBIGUOUS_VERSION = "m8-t2.2-r4";

function fixture(tag) {
  return mkdtempSync(path.join(os.tmpdir(), `f160-${tag}-`));
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

/**
 * Seal a journal from a list of bodies and write the snapshot the reader is
 * expected to accept. `preVerdictRootResult` is the classification the FIXED
 * mapping gives the r4 stamp; the lane asserts the OBSERVED status, so the
 * expectation is never taken from the reader itself.
 */
function sealJournal(paths, bodies, { preVerdictRootResult }) {
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
  );
  let projection = { tasks: {} };
  for (const line of lines) {
    projection = applyWorkflowEvent(
      projection,
      line.type,
      line.payload,
      line.created_at,
      { replayAnchored: true, preVerdictRootResult },
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
        updated_at: "2026-09-02T00:00:00.000Z",
      },
      null,
      2,
    )}\n`,
  );
  return projection;
}

describe("F-160 — the r4 stamp is a verdict stamp, in every path", () => {
  it("an r4-only journal classifies the r4 event as a verdict", () => {
    const root = fixture("r4-only");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      sealJournal(
        paths,
        [
          {
            governance_version: AMBIGUOUS_VERSION,
            type: "WORKFLOW_OPENED",
            payload: OPENED(taskId),
            created_at: "2026-09-01T00:00:00.000Z",
          },
          {
            governance_version: AMBIGUOUS_VERSION,
            type: "WORKFLOW_ROOT_RESULT_RECORDED",
            payload: ROOT_RESULT(taskId),
            created_at: "2026-09-02T00:00:00.000Z",
          },
        ],
        { preVerdictRootResult: false },
      );
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "an m8-t2.2-r4 stamp alone must not force pre-verdict semantics",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a MIXED journal classifies the r4 event as a verdict too", () => {
    // The case the journal-scope discriminator got wrong: the journal carries
    // one pre-verdict line, so the old reader re-resolved the r4 root result
    // as pre-verdict and the read died on `snapshot workflow mismatch`.
    const root = fixture("mixed");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      sealJournal(
        paths,
        [
          {
            governance_version: PRE_VERDICT_VERSION,
            type: "WORKFLOW_OPENED",
            payload: OPENED(taskId),
            created_at: "2026-09-01T00:00:00.000Z",
          },
          {
            governance_version: AMBIGUOUS_VERSION,
            type: "WORKFLOW_ROOT_RESULT_RECORDED",
            payload: ROOT_RESULT(taskId),
            created_at: "2026-09-02T00:00:00.000Z",
          },
        ],
        { preVerdictRootResult: false },
      );
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "RESULT_PENDING_REVIEW",
        "the r4 event's semantics must not depend on the other events in the file",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the pre-verdict stamp still classifies as pre-verdict", () => {
    // The journals that PREDATE the verdict model still resolve historically:
    // their own events carry a pre-verdict stamp, so the era is declared by the
    // event instead of by the journal's scope.
    const root = fixture("pre-verdict");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      sealJournal(
        paths,
        [
          {
            governance_version: PRE_VERDICT_VERSION,
            type: "WORKFLOW_OPENED",
            payload: OPENED(taskId),
            created_at: "2026-09-01T00:00:00.000Z",
          },
          {
            governance_version: PRE_VERDICT_VERSION,
            type: "WORKFLOW_ROOT_RESULT_RECORDED",
            payload: ROOT_RESULT(taskId),
            created_at: "2026-09-02T00:00:00.000Z",
          },
        ],
        { preVerdictRootResult: true },
      );
      const read = readSnapshot(paths);
      assert.equal(
        read.tasks[taskId].workflow_status,
        "COMPLETE",
        "a pre-verdict stamp must still resolve to the recorded outcome",
      );
      assert.equal(
        "result_pending_at" in read.tasks[taskId],
        false,
        "pre-verdict history has no pending timestamp",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the current stamp is a verdict, and the journal survives its own read", () => {
    const root = fixture("current");
    try {
      const paths = ledgerPaths(root);
      ensureLedger(paths);
      const taskId = deriveTaskId(OPENED("x"));
      sealJournal(
        paths,
        [
          {
            governance_version: GOVERNANCE_VERSION,
            type: "WORKFLOW_OPENED",
            payload: OPENED(taskId),
            created_at: "2026-09-01T00:00:00.000Z",
          },
          {
            governance_version: GOVERNANCE_VERSION,
            type: "WORKFLOW_ROOT_RESULT_RECORDED",
            payload: ROOT_RESULT(taskId),
            created_at: "2026-09-02T00:00:00.000Z",
          },
        ],
        { preVerdictRootResult: false },
      );
      const read = readSnapshot(paths);
      assert.equal(read.tasks[taskId].workflow_status, "RESULT_PENDING_REVIEW");
      assert.equal(
        readFileSync(paths.events, "utf8").trim().split("\n").length,
        2,
        "the read must not rewrite the journal",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
