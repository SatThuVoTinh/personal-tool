// M12/T9 F-416 (legacy R9-T03-3): a failed exclusive preimage write used to
// leave a record-less transaction directory that findOrphanedTransaction
// reports as unreadable and every later apply refuses, with no recovery
// surface.
//
// MEASURED AT HEAD: the F-409 closure already removes the directory when the
// capture loop throws mid-way (transaction-snapshot.mjs, the catch around the
// preimage loop), so the row's named trigger no longer strands residue — but
// NOTHING pinned it, and the transaction directory itself was still created
// OUTSIDE the cleanup scope, so a throw from the directory/preimage mkdir or
// the chmod between creation and the try still stranded a record-less
// directory. Case 1 pins the cleanup behaviourally (red the moment the
// rmSync-on-throw is removed); case 2 pins the cleanup SCOPE structurally (red
// at HEAD, where `mkdirSync(directory, …)` precedes the try).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  findOrphanedTransaction,
  markTransactionComplete,
  persistTransactionSnapshot,
  TRANSACTION_STATUS,
  transactionRoot,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB_SOURCE = path.join(
  HERE,
  "../integrations/openclaw/topology/lib/transaction-snapshot.mjs",
);
const ATTEMPT_ID = `txn-${"a1".repeat(32)}`;

const roots = [];
after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function scratchStateDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f416-state-"));
  roots.push(root);
  return root;
}

function entry(body) {
  return {
    existed: true,
    sha256: createHash("sha256").update(body).digest("hex"),
    mode: 0o644,
    body,
  };
}

function snapshotFor(stateDir, files) {
  return {
    schema: "zink-transaction-snapshot/1",
    stateDir,
    runtimeRoot: stateDir,
    files,
  };
}

function bodyOf(rawSource, name) {
  const source = rawSource.replace(/\r\n/gu, "\n");
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist in transaction-snapshot.mjs`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `${name} must have a body`);
  return source.slice(start, end);
}

describe("M12/T9 F-416 - an interrupted capture strands no record-less transaction", () => {
  it("a mid-loop fault leaves no residue and the next apply still captures", () => {
    const stateDir = scratchStateDir();
    const body = "preimage-bytes";
    // Deterministic mid-loop fault: the second target lives UNDER the first
    // target's file, so `mkdirSync(path.dirname(target))` throws after one
    // preimage file has already landed — exactly the interrupted-capture shape
    // the row names (the F-409 base64 throw was the other concrete trigger).
    const failing = snapshotFor(stateDir, {
      "alpha.txt": entry(body),
      "alpha.txt/beta.txt": entry(body),
    });
    assert.throws(
      () =>
        persistTransactionSnapshot(stateDir, failing, {
          createdAt: new Date().toISOString(),
        }),
      "the colliding capture must throw",
    );

    const root = transactionRoot(stateDir);
    assert.deepEqual(
      fs.existsSync(root) ? fs.readdirSync(root) : [],
      [],
      "the interrupted capture removed its own directory: no record-less residue",
    );
    assert.deepEqual(
      findOrphanedTransaction(stateDir),
      [],
      "no orphan for a later apply to refuse",
    );

    // The next apply still runs: a clean capture succeeds, completes, and
    // leaves the orphan surface empty — the state the apply-orchestration
    // orphan-check gate reads before it will mutate.
    const recorded = persistTransactionSnapshot(
      stateDir,
      snapshotFor(stateDir, { "config.json": entry('{"ok":true}') }),
      { createdAt: new Date().toISOString(), attemptId: ATTEMPT_ID },
    );
    assert.equal(recorded.attemptId, ATTEMPT_ID);
    assert.equal(recorded.status, TRANSACTION_STATUS.STARTED);
    markTransactionComplete(stateDir, ATTEMPT_ID);
    assert.deepEqual(
      findOrphanedTransaction(stateDir),
      [],
      "a completed transaction is not an orphan",
    );
  });

  it("the transaction directory is created INSIDE the cleanup scope", () => {
    const source = fs.readFileSync(LIB_SOURCE, "utf8");
    const body = bodyOf(source, "persistTransactionSnapshot");
    const cleanup = body.indexOf("rmSync(directory");
    const tryStart = body.indexOf("try {");
    const dirCreate = body.indexOf("mkdirSync(directory");
    assert.ok(cleanup > 0, "the F-409 cleanup must exist");
    assert.ok(tryStart >= 0, "the cleanup try must exist");
    // HEAD: mkdirSync(directory, …) runs BEFORE the try, so a throw from the
    // directory creation, its chmod or the preimage mkdir still strands a
    // record-less directory. The acceptance criterion is absolute: "no
    // record-less transaction directory can ever exist".
    assert.ok(
      dirCreate > tryStart,
      "the transaction directory must be created inside the cleanup scope",
    );
    assert.ok(
      body.indexOf("mkdirSync(path.join(directory, PREIMAGE_DIR)") > tryStart,
      "the preimage directory must be created inside the cleanup scope",
    );
  });
});
