// M12/T9 F-577 (legacy R10-T12-1): the ledger's commit seam wrote three
// durable artefacts in sequence (journal, snapshot, checkpoint) with no
// classification of WHERE a fault happened, named the snapshot temp by pid
// alone with no sweeper, and re-charged BUDGET_RESERVED on retry because the
// event carried no idempotency key.
//
// MEASURED AT HEAD: a fault between the journal fsync and the snapshot write
// surfaced as a raw errno; a lock-busy writer answered EXECUTION_STATE_UNKNOWN
// although nothing was attempted; a pre-created `snapshot.json.tmp-<pid>`
// blocked every later commit; and a caller retry after any snapshot failure
// appended a SECOND reservation for the same logical charge.
//
// This lane proves the fixed seam: COMMITTED / NOT_ATTEMPTED / UNKNOWN,
// pid-Date.now()-randomBytes temp names with the exclusive open inside a
// residue-cleaning fault handler, and a caller-supplied idempotency key the
// writer dedupes against the journal. The fault injection runs in scratch
// checkouts of the module tree only; nothing live is touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(HERE, "../integrations/openclaw");
const TASK_ID = `577${"a".repeat(61)}`;
const KEY = "f577-reservation-key-1";

// The one snapshot write inside the commit seam (appendEventLocked). The
// repair path writes `writeSnapshotAtomic(paths, snapshot)` and the derive
// path writes `(paths, derived)`, so this substring is the seam alone.
const INJECT_TARGET = "writeSnapshotAtomic(paths, next);";
const INJECTED =
  'if (globalThis.__l6FailSnapshotOnce) { globalThis.__l6FailSnapshotOnce = false; const injected = new Error("injected snapshot fault"); injected.code = "EIO"; throw injected; } writeSnapshotAtomic(paths, next);';

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  delete globalThis.__l6FailSnapshotOnce;
});

function scratch(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function importModule(root, relative) {
  return import(pathToFileURL(path.join(root, relative)).href);
}

function scratchCheckout(replacements) {
  const root = scratch("zink-f577-build-");
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

function bodyOf(rawSource, name) {
  const source = rawSource.replace(/\r\n/gu, "\n");
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in topology/lib/ledger.mjs`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} must have a body`);
  return source.slice(start, end);
}

function budgetEvents(paths) {
  const text = fs.readFileSync(paths.events, "utf8").trim();
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((event) => event.type === "BUDGET_RESERVED");
}

describe("M12/T9 F-577 - the commit seam is classified and retries are idempotent", () => {
  it("a post-append snapshot fault is COMMITTED and a keyed retry is discarded", async () => {
    const build = scratchCheckout([[INJECT_TARGET, INJECTED]]);
    const m = await importModule(build, "topology/lib/ledger.mjs");
    const paths = m.ledgerPaths(scratch("zink-f577-state-"));
    m.ensureLedger(paths);

    globalThis.__l6FailSnapshotOnce = true;
    let firstError = null;
    try {
      m.reserveBudgetAtomically(paths, null, TASK_ID, "revisions", 1, KEY);
    } catch (error) {
      firstError = error;
    }
    assert.ok(firstError, "the injected snapshot fault must surface");
    // HEAD: the raw EIO of the snapshot write, with the journal line durable.
    assert.equal(
      firstError.code,
      "LEDGER_COMMIT_UNCERTAIN",
      "a post-append fault is the F-417 uncertain family, not a raw errno",
    );
    assert.equal(firstError.commitState, "COMMITTED");
    assert.equal(firstError.committed, true);
    assert.equal(firstError.cause?.code, "EIO", "the cause survives");
    assert.equal(
      budgetEvents(paths).length,
      1,
      "the journal holds exactly one reservation",
    );

    // The retry that used to double-charge: same logical reservation, same key.
    const retried = m.reserveBudgetAtomically(
      paths,
      null,
      TASK_ID,
      "revisions",
      1,
      KEY,
    );
    assert.equal(
      retried.discarded,
      true,
      "a repeated idempotency key is discarded, not appended",
    );
    assert.equal(budgetEvents(paths).length, 1, "no second append");
    assert.equal(
      m.readSnapshot(paths).tasks[TASK_ID].revisions_used,
      2,
      "the budget is charged exactly once (1 initial + 1 reservation)",
    );

    // A DIFFERENT key is a different reservation and charges once more.
    m.reserveBudgetAtomically(paths, null, TASK_ID, "revisions", 1, `${KEY}-2`);
    assert.equal(budgetEvents(paths).length, 2);
    assert.equal(m.readSnapshot(paths).tasks[TASK_ID].revisions_used, 3);
  });

  it("a lock-busy writer answers NOT_ATTEMPTED, never EXECUTION_STATE_UNKNOWN", async () => {
    const shipped = await importModule(SOURCE_ROOT, "topology/lib/ledger.mjs");
    const paths = shipped.ledgerPaths(scratch("zink-f577-state-"));
    shipped.ensureLedger(paths);
    const fileLock = await importModule(SOURCE_ROOT, "lib/file-lock.mjs");
    const lockDir = fileLock.lockDirFor(paths.root, "writer.lock");
    fs.mkdirSync(lockDir, { recursive: true });
    try {
      assert.throws(
        () =>
          shipped.reserveBudgetAtomically(paths, null, TASK_ID, "revisions"),
        (error) => {
          // HEAD: error.code === "EXECUTION_STATE_UNKNOWN" for a commit that
          // never started.
          assert.equal(error.code, "LEDGER_COMMIT_NOT_ATTEMPTED");
          assert.equal(error.commitState, "NOT_ATTEMPTED");
          assert.equal(error.cause?.code, "FILE_LOCK_BUSY");
          return true;
        },
      );
    } finally {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
    assert.equal(
      budgetEvents(paths).length,
      0,
      "the refused writer left no journal trace",
    );
  });

  it("pid-only snapshot residue no longer blocks the commit and temp names carry entropy", async () => {
    const shipped = await importModule(SOURCE_ROOT, "topology/lib/ledger.mjs");
    const paths = shipped.ledgerPaths(scratch("zink-f577-state-"));
    shipped.ensureLedger(paths);
    // The row's own trigger: a pre-created `snapshot.json.tmp-<pid>`. At HEAD
    // the pid-only exclusive open meets it and every commit fails EEXIST.
    fs.writeFileSync(`${paths.snapshot}.tmp-${process.pid}`, "residue");
    const committed = shipped.reserveBudgetAtomically(
      paths,
      null,
      TASK_ID,
      "revisions",
    );
    assert.equal(committed.commitState, "COMMITTED");
    assert.doesNotMatch(
      JSON.stringify(committed),
      /commitState/u,
      "the commit marker is non-enumerable: the snapshot contract stays closed",
    );
    assert.equal(shipped.readSnapshot(paths).tasks[TASK_ID].revisions_used, 2);

    const source = fs.readFileSync(
      path.join(SOURCE_ROOT, "topology", "lib", "ledger.mjs"),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /\.tmp-\$\{process\.pid\}`/u,
      "no pid-only temp name may remain",
    );
    for (const name of ["writeSnapshotAtomic", "writeCheckpointAtomic"])
      assert.match(
        bodyOf(source, name),
        /writerTempName\(/u,
        `${name} must use the entropy grammar`,
      );
    assert.match(
      bodyOf(source, "writerTempName"),
      /process\.pid\}-\$\{Date\.now\(\)\}-\$\{randomBytes/u,
      "pid-Date.now()-randomBytes, the catalog.mjs grammar",
    );
    const open = bodyOf(source, "openExclusiveTemp");
    assert.match(open, /EEXIST/u, "the exclusive open handles its own residue");
    assert.match(open, /unlinkWriterResidue\(/u);
  });

  it("a key-less reservation keeps the legacy behaviour exactly", async () => {
    const shipped = await importModule(SOURCE_ROOT, "topology/lib/ledger.mjs");
    const paths = shipped.ledgerPaths(scratch("zink-f577-state-"));
    shipped.ensureLedger(paths);
    shipped.reserveBudgetAtomically(paths, null, TASK_ID, "revisions");
    shipped.reserveBudgetAtomically(paths, null, TASK_ID, "revisions");
    const events = budgetEvents(paths);
    assert.equal(events.length, 2, "no key means no dedupe: two charges");
    assert.equal(
      events.every((event) => !("idempotency_key" in event.payload)),
      true,
      "a key-less event carries no key member",
    );
    assert.equal(shipped.readSnapshot(paths).tasks[TASK_ID].revisions_used, 3);
    assert.throws(
      () =>
        shipped.reserveBudgetAtomically(
          paths,
          null,
          TASK_ID,
          "revisions",
          1,
          "x".repeat(129),
        ),
      TypeError,
      "an over-long key is refused before anything is written",
    );
  });
});
