// M12/T9 F-409 (legacy R9-L03-2): persistence wrote `entry.body` instead of
// the recorded bytes, so a base64-captured preimage reached the exclusive
// writer as `undefined` and threw mid-loop, leaving a record-less transaction
// directory behind.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  createTransactionSnapshot,
  loadTransaction,
  persistTransactionSnapshot,
  restoreTransactionSnapshot,
  transactionRoot,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const BINARY = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x80, 0x42]);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "r4-preimage-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "runtime");
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const target = path.join(stateDir, "openclaw.json");
  fs.writeFileSync(target, BINARY);
  const dispose = () => fs.rmSync(root, { recursive: true, force: true });
  return { stateDir, runtimeRoot, target, dispose };
}

describe("M12/T9 F-409 - a base64 preimage survives persistence", () => {
  it("round-trips through persist -> load -> restore byte-exactly", () => {
    const rt = fixture();
    try {
      const snapshot = createTransactionSnapshot({
        stateDir: rt.stateDir,
        runtimeRoot: rt.runtimeRoot,
      });
      assert.equal(
        typeof snapshot.files["openclaw.json"].body_base64,
        "string",
      );

      const transaction = persistTransactionSnapshot(rt.stateDir, snapshot, {
        createdAt: new Date().toISOString(),
      });
      assert.equal(transaction.status, "started");

      const loaded = loadTransaction(rt.stateDir, transaction.attemptId);
      assert.equal(
        loaded.snapshot.files["openclaw.json"].sha256,
        createHash("sha256").update(BINARY).digest("hex"),
        "the recorded digest must survive the round trip",
      );

      fs.writeFileSync(rt.target, Buffer.from([0x00, 0x01]));
      restoreTransactionSnapshot(loaded.snapshot);
      assert.deepEqual(
        [...fs.readFileSync(rt.target)],
        [...BINARY],
        "the persisted preimage must restore the exact captured bytes",
      );
    } finally {
      rt.dispose();
    }
  });

  it("a mid-loop throw removes the record-less transaction directory", () => {
    const rt = fixture();
    try {
      const body = "blocker";
      const snapshot = {
        schema: "zink-transaction-snapshot/1",
        stateDir: path.resolve(rt.stateDir),
        runtimeRoot: path.resolve(rt.runtimeRoot),
        systemdRoot: null,
        files: {
          // The first entry writes a FILE at the path the second entry needs as
          // a directory, so the loop throws after a preimage has landed.
          blocker: {
            existed: true,
            sha256: createHash("sha256").update(body).digest("hex"),
            mode: 0o644,
            body,
          },
          "blocker/child": {
            existed: true,
            sha256: createHash("sha256").update("child").digest("hex"),
            mode: 0o644,
            body: "child",
          },
        },
      };
      const attemptId = `txn-${"a".repeat(64)}`;
      const directory = path.join(transactionRoot(rt.stateDir), attemptId);

      assert.throws(() =>
        persistTransactionSnapshot(rt.stateDir, snapshot, {
          createdAt: new Date().toISOString(),
          attemptId,
        }),
      );
      assert.equal(
        fs.existsSync(directory),
        false,
        "a failed capture must not leave a directory every later apply refuses",
      );
    } finally {
      rt.dispose();
    }
  });
});
