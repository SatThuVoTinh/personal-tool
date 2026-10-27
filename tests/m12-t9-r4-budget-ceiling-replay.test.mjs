// M12/T9 F-579 (legacy R10-T12-3): a per-task budget ceiling is a WRITE-TIME
// admission rule. The journal is the record, so replay must project the
// reservation the event RECORDS and verify it against the counters that event
// carries - never re-derive the ceiling from whichever BUDGETS constant the
// READING build happens to ship.
//
// Reachable state (R10-T12-1 supplies it): a journal whose checkpoint does not
// cover its tail, plus a build that lowered a ceiling. At HEAD the tail replay
// calls reserveBudget, raises WORKFLOW_BUDGET_EXHAUSTED, and the whole ledger
// reads as EXECUTION_STATE_UNKNOWN. This lane builds exactly that journal: both
// reservations are written by the SHIPPED writer (ceiling 16), then the
// snapshot and the checkpoint are rolled back to the first one, so the second
// reservation is an unanchored tail; the ledger is then re-read by a SCRATCH
// checkout whose maxBriefRevisionsPerTask is 2.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, "../integrations/openclaw");
const TASK_ID = `579${"a".repeat(61)}`;
const CEILING_LITERAL = "maxBriefRevisionsPerTask: 16,";

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function scratch(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function importModule(root, relative) {
  return import(pathToFileURL(path.join(root, relative)).href);
}

// A checkout of the topology that differs from this one only in a ceiling. The
// copy is required for the READ build: lowering the ceiling in place would
// change the writer that produced the journal.
function scratchCheckout(replacements) {
  const root = scratch("zink-f579-build-");
  for (const dir of [
    "topology/lib",
    "topology/contracts",
    "topology/policy",
    "lib",
  ])
    fs.cpSync(path.join(SOURCE_ROOT, dir), path.join(root, dir), {
      recursive: true,
    });
  const file = path.join(root, "topology", "lib", "ledger.mjs");
  let source = fs.readFileSync(file, "utf8");
  for (const [from, to] of replacements) {
    assert.equal(
      source.split(from).length - 1,
      1,
      `the scratch checkout must rewrite exactly one ${from}`,
    );
    source = source.replace(from, to);
  }
  fs.writeFileSync(file, source);
  return root;
}

// The journal R10-T12-1 leaves behind: the record holds two reservations, the
// snapshot and the checkpoint describe only the first.
async function journalWithUnanchoredBudgetTail() {
  const shipped = await importModule(SOURCE_ROOT, "topology/lib/ledger.mjs");
  const stateDir = scratch("zink-f579-state-");
  const paths = shipped.ledgerPaths(stateDir);
  shipped.ensureLedger(paths);
  shipped.reserveBudgetAtomically(paths, null, TASK_ID, "revisions");
  const anchored = {
    snapshot: fs.readFileSync(paths.snapshot),
    checkpoint: fs.readFileSync(paths.checkpoint),
  };
  shipped.reserveBudgetAtomically(paths, null, TASK_ID, "revisions");
  fs.writeFileSync(paths.snapshot, anchored.snapshot);
  fs.writeFileSync(paths.checkpoint, anchored.checkpoint);
  return { paths, shipped };
}

function bodyOf(rawSource, name) {
  const source = rawSource.replace(/\r\n/gu, "\n");
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in topology/lib/ledger.mjs`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} must have a body`);
  return source.slice(start, end);
}

describe("M12/T9 F-579 - replay projects the recorded reservation", () => {
  it("a lowered ceiling still replays the journal a higher ceiling accepted", async () => {
    const { paths } = await journalWithUnanchoredBudgetTail();
    const build = scratchCheckout([
      [CEILING_LITERAL, "maxBriefRevisionsPerTask: 2,"],
    ]);
    const lowered = await importModule(build, "topology/lib/ledger.mjs");
    // HEAD: WORKFLOW_BUDGET_EXHAUSTED from reserveBudget, which the reader
    // reports as a state it cannot project.
    const projection = lowered.readSnapshot(paths);
    assert.equal(projection.sequence, 2, "both recorded events replay");
    assert.deepEqual(
      { ...projection.tasks[TASK_ID] },
      { revisions_used: 3, transitions_used: 0, delegated_runs_used: 0 },
      "the projection is the arithmetic the events recorded, not a ceiling verdict",
    );
    // The read repaired the snapshot, so the shipped reader agrees without a
    // second replay under the lowered ceiling.
    const shipped = await importModule(SOURCE_ROOT, "topology/lib/ledger.mjs");
    assert.equal(shipped.readSnapshot(paths).tasks[TASK_ID].revisions_used, 3);
  });

  it("an event whose counters disagree with its own arithmetic is still refused", async () => {
    const { paths } = await journalWithUnanchoredBudgetTail();
    const build = scratchCheckout([
      [CEILING_LITERAL, "maxBriefRevisionsPerTask: 2,"],
    ]);
    const lowered = await importModule(build, "topology/lib/ledger.mjs");
    lowered.readSnapshot(paths);
    const canonical = await importModule(
      SOURCE_ROOT,
      "topology/lib/canonical.mjs",
    );
    const lines = fs.readFileSync(paths.events, "utf8").trimEnd().split("\n");
    const last = JSON.parse(lines.at(-1));
    const forged = {
      schema_version: last.schema_version,
      governance_version: last.governance_version,
      sequence: last.sequence + 1,
      type: "BUDGET_RESERVED",
      payload: {
        task_id: TASK_ID,
        kind: "revisions",
        amount: 1,
        // The recorded counters are NOT the arithmetic: 3, not 4.
        counters: { ...last.payload.counters },
      },
      created_at: new Date().toISOString(),
      previous_event_digest: last.event_digest,
    };
    forged.event_digest = canonical.canonicalHash(
      "zink-ledger-event-v1",
      forged,
    );
    fs.appendFileSync(paths.events, `${JSON.stringify(forged)}\n`);
    assert.throws(
      () => lowered.readSnapshot(paths),
      (error) => {
        const messages = [];
        for (let cursor = error; cursor; cursor = cursor.cause)
          messages.push(String(cursor.message));
        const text = messages.join("\n");
        // Both replay paths refuse a forged counter with their own message:
        // the anchored projection (`projectLedgerEvent`, which a checkpointed
        // read also verifies the tail through) says "journal budget mismatch",
        // the raw tail loop says "budget replay mismatch". Either proves the
        // projection is still compared with the counters the event records.
        assert.match(
          text,
          /journal budget mismatch|budget replay mismatch/u,
          "the replay must compare the projection with the counters the event records",
        );
        assert.doesNotMatch(
          text,
          /BUDGET_EXHAUSTED/u,
          "a recorded reservation is not re-admitted at read time",
        );
        return true;
      },
    );
  });

  it("the replay path cannot reach the BUDGETS constants", () => {
    const source = fs.readFileSync(
      path.join(SOURCE_ROOT, "topology/lib/ledger.mjs"),
      "utf8",
    );
    assert.doesNotMatch(
      bodyOf(source, "projectBudgetReservation"),
      /BUDGETS\./u,
      "the shared projection must not read a live ceiling",
    );
    assert.doesNotMatch(
      bodyOf(source, "projectLedgerEvent"),
      /reserveBudget\(/u,
      "the anchored projection must use the projection, not the admission gate",
    );
    assert.equal(
      source.split("reserveBudget(").length - 1,
      2,
      "exactly one admission call site (plus the declaration) may remain",
    );
  });
});
