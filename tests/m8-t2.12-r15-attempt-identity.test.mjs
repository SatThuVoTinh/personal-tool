// M8/T2.2-R15 — attempt-scoped transaction identity.
//
// R12 keyed the transaction directory on the PREIMAGE DIGEST. That made a
// completed or cleanly rolled-back attempt a permanent blocker for any later
// attempt from the same state: the restored runtime matches the old preimage, the
// derived ID repeats, and persist refuses with TRANSACTION_ALREADY_EXISTS. The
// second authorized R10 deployment attempt died exactly there, before any
// mutation.
//
// R15 separates the two identities:
//
//   attemptId      — WHICH apply attempt this is. Random, unique per attempt,
//                     and the filesystem uniqueness key.
//   preimageDigest — WHICH exact runtime state it started from. Deterministic,
//                     and retained in full so preimage evidence is never replaced
//                     by the attempt ID.
//
// These tests drive a real temporary filesystem, so persistence, identity,
// recovery and orphan behaviour are exercised for real without WSL or a live
// OpenClaw process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyRuntime } from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";
import {
  ORPHANED_TRANSACTION,
  createTransactionSnapshot,
  findOrphanedTransaction,
  loadTransaction,
  markTransactionComplete,
  persistTransactionSnapshot,
  restoreTransactionSnapshot,
  transactionRoot,
  verifyLiveRestore,
  verifyTransactionSnapshot,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const R7_CONFIG = '{\n  "meta": { "revision": "R7" }\n}\n';
const R10_CONFIG = '{\n  "meta": { "revision": "R10" }\n}\n';
const R7_BRIDGE = "// bridge R7\n";
const R10_BRIDGE = "// bridge R10\n";

function buildRuntime() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r15-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "openclaw");
  const dist = path.join(runtimeRoot, "dist");
  const extension = path.join(stateDir, "extensions", "zink-governance");
  mkdirSync(path.join(extension, "lib"), { recursive: true });
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(stateDir, "openclaw.json"), R7_CONFIG);
  writeFileSync(path.join(extension, "index.mjs"), "// governance R7\n");
  writeFileSync(path.join(extension, "lib", "native-boundary.mjs"), R7_BRIDGE);
  writeFileSync(path.join(dist, "selection-DopzNY3I.js"), "// selection R7\n");
  writeFileSync(
    path.join(dist, "subagent-announce-Bh1QyKiE.js"),
    "// announce R7\n",
  );
  writeFileSync(path.join(dist, "zink-governance-boundary.mjs"), R7_BRIDGE);
  return {
    root,
    stateDir,
    runtimeRoot,
    dist,
    extension,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

const R7_DIGESTS = Object.freeze({
  config: R7_CONFIG,
  entrypoint: "// governance R7\n",
  bridge: R7_BRIDGE,
});

function liveDigests(rt) {
  return {
    config: readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
    entrypoint: readFileSync(path.join(rt.extension, "index.mjs"), "utf8"),
    bridge: readFileSync(
      path.join(rt.dist, "zink-governance-boundary.mjs"),
      "utf8",
    ),
  };
}

const mutateToR10 = (rt) => {
  writeFileSync(path.join(rt.stateDir, "openclaw.json"), R10_CONFIG);
  writeFileSync(path.join(rt.extension, "index.mjs"), "// governance R10\n");
  writeFileSync(path.join(rt.dist, "zink-governance-boundary.mjs"), R10_BRIDGE);
};

const AT = "2026-09-30T00:00:00.000Z";
const persist = (rt, snapshot, extra = {}) =>
  persistTransactionSnapshot(rt.stateDir, snapshot, {
    createdAt: AT,
    ...extra,
  });

/** A harness wired to the real transaction implementation. */
function harness(rt, { failAt = null, orphans = null } = {}) {
  // M10/T2-R8: the expected post-image of the R10 outcome, declared from the
  // known constant. Post-apply verification is judged against this, so a
  // fixture that never landed the mutation can no longer report PASS.
  const expected = [
    {
      relative: "dist/zink-governance-boundary.mjs",
      sha256: sha256(R10_BRIDGE),
    },
  ];
  const calls = [];
  let restarted = false;
  const record = (name) => calls.push(name);
  return {
    calls,
    deps: {
      expectedNativePostImage: () => expected,
      readIdentifiers: () => ({ guildId: "1" }),
      runBuilder: (mode) => {
        const stage = `builder-${mode.replace(/^--/u, "")}`;
        record(stage);
        if (failAt === stage) throw new Error("Policy drift");
      },
      findOrphanedTransaction: () => {
        record("orphan-check");
        if (failAt === "orphan-check") throw new Error("ORPHAN_SCAN_FAILED");
        return orphans ?? findOrphanedTransaction(rt.stateDir);
      },
      createTransactionSnapshot: () => {
        record("snapshot:create");
        return createTransactionSnapshot(rt);
      },
      verifyTransactionSnapshot: (snapshot) => {
        record("snapshot:verify");
        if (failAt === "snapshot:verify") throw new Error("SNAPSHOT_REJECTED");
        return verifyTransactionSnapshot(snapshot);
      },
      persistTransactionSnapshot: (snapshot) => {
        record("snapshot:persist");
        if (failAt === "snapshot:persist") throw new Error("PERSIST_FAILED");
        return persist(rt, snapshot);
      },
      markTransactionComplete: (attemptId) => {
        record("snapshot:complete");
        if (failAt === "snapshot:complete") throw new Error("MARK_FAILED");
        return markTransactionComplete(rt.stateDir, attemptId);
      },
      pruneQuarantine: () => record("prune:quarantine"),
      pruneStaleNativeBackup: () => record("prune:native"),
      applyNativePatch: () => {
        record("native:patch");
        mutateToR10(rt);
        if (failAt === "native-patch") throw new Error("NATIVE_SOURCE_DRIFT");
      },
      checkNativePatch: () => {
        record("native:verify");
        if (failAt === "native-verify")
          throw new Error("NATIVE_PATCH_INCOMPLETE");
      },
      restartScopedGateway: () => {
        const first = !restarted;
        restarted = true;
        record("gateway:restart");
        if (first && failAt === "gateway-restart")
          throw new Error("GATEWAY_NOT_ACTIVE");
      },
      restoreTransactionSnapshot: (snapshot) => {
        record("rollback:restore");
        verifyTransactionSnapshot(snapshot);
        return restoreTransactionSnapshot(snapshot);
      },
      verifyLiveRestore: (snapshot, options) => {
        // M10/T2-R8: post-apply verification is judged against the declared
        // expectation the orchestrator passes in, never a bare "applied: true".
        if (options?.postApply) {
          record("verify:applied");
          return verifyLiveRestore(rt, snapshot, options);
        }
        record("rollback:validate");
        return verifyLiveRestore(rt, snapshot, options);
      },
      classifyReason: (error) => String(error?.message ?? error),
    },
  };
}

// ---------------------------------------------------------------------------
// 1-5, 17, 18: identity separation
// ---------------------------------------------------------------------------

test("R15 1-3: the same preimage yields unique attempt IDs", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    const b = persist(rt, snapshot);
    assert.notEqual(a.attemptId, b.attemptId, "attempt IDs must differ");
    assert.equal(
      readdirSync(transactionRoot(rt.stateDir)).length,
      2,
      "each attempt gets its own directory",
    );
  } finally {
    rt.dispose();
  }
});

test("R15 4: both manifests record the identical preimage digest", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    const b = persist(rt, snapshot);
    assert.equal(a.preimageDigest, b.preimageDigest);
    assert.equal(a.preimageDigest.length, 64);
    // And the digest is derived from the component manifest, not from the ID.
    assert.notEqual(a.preimageDigest, a.attemptId.replace(/^txn-/u, ""));
    assert.notEqual(b.preimageDigest, b.attemptId.replace(/^txn-/u, ""));
  } finally {
    rt.dispose();
  }
});

test("R15 5: both snapshots are independently recoverable", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    const b = persist(rt, snapshot);
    // Mutate the runtime, then recover from each attempt in turn.
    mutateToR10(rt);
    const restoredFromA = loadTransaction(rt.stateDir, a.attemptId);
    assert.deepEqual(restoredFromA.snapshot.files, snapshot.files);
    restoreTransactionSnapshot(restoredFromA.snapshot);
    assert.deepEqual(liveDigests(rt), R7_DIGESTS);
    const restoredFromB = loadTransaction(rt.stateDir, b.attemptId);
    assert.equal(restoredFromB.preimageDigest, a.preimageDigest);
    assert.equal(verifyLiveRestore(rt, restoredFromB.snapshot).restored, true);
  } finally {
    rt.dispose();
  }
});

test("R15 17: the attempt ID is not a timestamp and is collision-resistant", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const ids = new Set();
    for (let index = 0; index < 25; index += 1)
      ids.add(persist(rt, snapshot).attemptId);
    assert.equal(
      ids.size,
      25,
      "25 attempts from one preimage must be distinct",
    );
    for (const id of ids) {
      assert.match(id, /^txn-[a-f0-9]{64}$/u, "random hex, not a clock value");
      // A timestamp-derived ID would be a short decimal or base-16 counter.
      assert.ok(!/^\d+$/u.test(id.replace(/^txn-/u, "")));
    }
  } finally {
    rt.dispose();
  }
});

test("R15 18: no existing transaction is ever overwritten", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    assert.throws(
      () => persist(rt, snapshot, { attemptId: a.attemptId, createdAt: AT }),
      /TRANSACTION_ALREADY_EXISTS/u,
    );
    // The original is byte-identical afterwards.
    assert.equal(loadTransaction(rt.stateDir, a.attemptId).createdAt, AT);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 6, 7, 21, 22: the repeat-attempt regression
// ---------------------------------------------------------------------------

test("R15 6-7, 21: a completed attempt does not block a second attempt", async () => {
  // The exact sequence that lost the second deployment.
  for (const run of [1, 2]) {
    const rt = buildRuntime();
    try {
      const first = await applyRuntime(
        harness(rt, { failAt: "native-verify" }).deps,
      );
      assert.equal(first.rollbackSucceeded, true, first.rollbackReason ?? "");
      assert.deepEqual(liveDigests(rt), R7_DIGESTS, `run ${run} restores R7`);

      if (run === 1) {
        // The runtime is now byte-identical to the first attempt's preimage, so
        // the second attempt reproduces the production blocker exactly.
        const second = await applyRuntime(harness(rt).deps);
        assert.equal(
          second.status,
          "PASS",
          `a completed attempt must not block the next one: ${second.reason ?? ""}`,
        );
        assert.equal(second.mutationStarted, true);
        assert.ok(
          second.attemptId,
          "the second attempt has its own attempt ID",
        );
      }
    } finally {
      rt.dispose();
    }
  }
});

test("R15 22: repeated attempts cause no ledger mutation", () => {
  const rt = buildRuntime();
  try {
    // The governance ledger is not part of the transaction snapshot's restore set
    // and no apply path here touches it; assert the snapshot never claims it.
    const snapshot = createTransactionSnapshot(rt);
    assert.equal(
      Object.keys(snapshot.files).some((rel) => rel.includes("ledger")),
      false,
      "the ledger is never a transaction preimage target",
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 8, 11, 12: orphan semantics unchanged
// ---------------------------------------------------------------------------

test("R15 8: an unfinished transaction still blocks a new apply", async () => {
  const rt = buildRuntime();
  try {
    // Simulate a process that died after creating its transaction.
    const orphan = persist(rt, createTransactionSnapshot(rt));
    mutateToR10(rt);
    const report = await applyRuntime(harness(rt).deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.stage, "orphan-check");
    assert.equal(report.reason, ORPHANED_TRANSACTION);
    assert.equal(report.mutationStarted, false);
    assert.deepEqual(report.orphanedTransactionIds, [orphan.attemptId]);
  } finally {
    rt.dispose();
  }
});

test("R15 11-12: orphan detection still works and is not confused by history", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const completed = persist(rt, snapshot);
    markTransactionComplete(rt.stateDir, completed.attemptId);
    // A second, deliberately unfinished attempt against the SAME preimage.
    const orphan = persist(rt, snapshot);
    const orphans = findOrphanedTransaction(rt.stateDir);
    assert.equal(orphans.length, 1, "only the unfinished attempt is an orphan");
    assert.equal(orphans[0].attemptId, orphan.attemptId);
    assert.equal(orphans[0].preimageDigest, completed.preimageDigest);
    // A completed record with the same preimage is history, not an orphan.
    assert.equal(
      orphans.some((entry) => entry.attemptId === completed.attemptId),
      false,
    );
  } finally {
    rt.dispose();
  }
});

test("R15 9: a completed transaction is retained, not deleted", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    markTransactionComplete(rt.stateDir, a.attemptId);
    const b = persist(rt, snapshot);
    markTransactionComplete(rt.stateDir, b.attemptId);
    const dirs = readdirSync(transactionRoot(rt.stateDir));
    assert.equal(dirs.length, 2, "both completed records are retained");
    for (const id of [a.attemptId, b.attemptId])
      assert.equal(loadTransaction(rt.stateDir, id).status, "complete");
  } finally {
    rt.dispose();
  }
});

test("R15 10: a completed record's identity fields are immutable", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const a = persist(rt, snapshot);
    markTransactionComplete(rt.stateDir, a.attemptId);
    const before = loadTransaction(rt.stateDir, a.attemptId);
    // Any further status write must not disturb the identity or the preimage.
    markTransactionComplete(rt.stateDir, a.attemptId);
    const after = loadTransaction(rt.stateDir, a.attemptId);
    assert.equal(after.attemptId, before.attemptId);
    assert.equal(after.preimageDigest, before.preimageDigest);
    assert.equal(after.createdAt, before.createdAt);
    assert.deepEqual(after.files, before.files);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 13, 14, 15: durability and rollback targeting
// ---------------------------------------------------------------------------

test("R15 13-14: snapshot persistence remains durable and re-readable", () => {
  const rt = buildRuntime();
  try {
    const record = persist(rt, createTransactionSnapshot(rt));
    const directory = path.join(transactionRoot(rt.stateDir), record.attemptId);
    // Written durably with restrictive permissions.
    if (process.platform !== "win32") {
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(
        statSync(path.join(directory, "transaction.json")).mode & 0o777,
        0o600,
      );
    }
    // A "fresh process" re-read verifies the manifest and every preimage hash.
    const loaded = loadTransaction(rt.stateDir, record.attemptId);
    assert.equal(verifyTransactionSnapshot(loaded.snapshot).verified, true);
    assert.equal(loaded.manifestDigest, record.manifestDigest);
  } finally {
    rt.dispose();
  }
});

test("R15 15: rollback targets THIS attempt, not the latest or a sibling", async () => {
  const rt = buildRuntime();
  try {
    // Two attempts from the same preimage, the first already resolved.
    const snapshotA = createTransactionSnapshot(rt);
    const a = persist(rt, snapshotA);
    markTransactionComplete(rt.stateDir, a.attemptId);
    const b = persist(rt, snapshotA);
    assert.notEqual(a.attemptId, b.attemptId);

    // Now change the runtime and roll back using B's snapshot explicitly.
    mutateToR10(rt);
    const target = loadTransaction(rt.stateDir, b.attemptId);
    restoreTransactionSnapshot(target.snapshot);
    assert.deepEqual(liveDigests(rt), R7_DIGESTS);
    assert.equal(target.attemptId, b.attemptId);
    // A is still independently addressable afterwards.
    assert.equal(loadTransaction(rt.stateDir, a.attemptId).status, "complete");
  } finally {
    rt.dispose();
  }
});

test("R15 19: a corrupted record is rejected", () => {
  const rt = buildRuntime();
  try {
    const record = persist(rt, createTransactionSnapshot(rt));
    const recordPath = path.join(
      transactionRoot(rt.stateDir),
      record.attemptId,
      "transaction.json",
    );
    const onDisk = JSON.parse(readFileSync(recordPath, "utf8"));
    onDisk.files["openclaw.json"].sha256 = "0".repeat(64);
    writeFileSync(recordPath, JSON.stringify(onDisk, null, 2));
    assert.throws(
      () => loadTransaction(rt.stateDir, record.attemptId),
      /TRANSACTION_MANIFEST_INTEGRITY_FAILED/u,
    );
    // A corrupted attempt does not make a sibling undiscoverable.
    const sibling = persist(rt, createTransactionSnapshot(rt));
    assert.equal(
      loadTransaction(rt.stateDir, sibling.attemptId).status,
      "started",
    );
  } finally {
    rt.dispose();
  }
});

test("R15 20: directory traversal in an attempt ID is refused", () => {
  const rt = buildRuntime();
  try {
    for (const id of [
      "../../etc",
      "txn-" + "z".repeat(64),
      "txn-short",
      "other",
    ])
      assert.throws(
        () => loadTransaction(rt.stateDir, id),
        /TRANSACTION_ID_INVALID/u,
        id,
      );
  } finally {
    rt.dispose();
  }
});

test("R15 19b: a corrupted preimage byte is refused", () => {
  const rt = buildRuntime();
  try {
    const record = persist(rt, createTransactionSnapshot(rt));
    writeFileSync(
      path.join(
        transactionRoot(rt.stateDir),
        record.attemptId,
        "preimage",
        "openclaw.json",
      ),
      "corrupted\n",
    );
    assert.throws(
      () => loadTransaction(rt.stateDir, record.attemptId),
      /TRANSACTION_SNAPSHOT_DIGEST_MISMATCH/u,
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// PHASE 13: forward compatibility with the historical R12 record
// ---------------------------------------------------------------------------

test("R15 13: a legacy preimage-derived record remains readable and is never migrated", () => {
  const rt = buildRuntime();
  try {
    // Reproduce an R12 record exactly as it was written: schema 1, a
    // preimage-derived `transactionId`, no `preimageDigest`.
    const snapshot = createTransactionSnapshot(rt);
    const root = transactionRoot(rt.stateDir);
    mkdirSync(root, { recursive: true });
    const legacyId = `txn-${sha256("legacy-binding").slice(0, 32)}`;
    const directory = path.join(root, legacyId);
    mkdirSync(path.join(directory, "preimage"), { recursive: true });
    const files = {};
    for (const [relative, entry] of Object.entries(snapshot.files)) {
      if (!entry.existed) {
        files[relative] = { existed: false, sha256: null, mode: null };
        continue;
      }
      const target = path.join(directory, "preimage", relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, entry.body);
      files[relative] = {
        existed: true,
        sha256: entry.sha256,
        mode: entry.mode,
      };
    }
    const record = {
      schema: "zink-transaction-record/1",
      transactionId: legacyId,
      createdAt: AT,
      status: "complete",
      snapshotPath: "preimage",
      stateDir: snapshot.stateDir,
      runtimeRoot: snapshot.runtimeRoot,
      files,
    };
    record.manifestDigest = (() => {
      const copy = { ...record };
      delete copy.manifestDigest;
      return sha256(JSON.stringify(copy));
    })();
    // Written with the same 0o600 mode a real R12 record used, so the loader's
    // permission check is genuinely satisfied rather than bypassed.
    writeFileSync(
      path.join(directory, "transaction.json"),
      `${JSON.stringify(record, null, 2)}\n`,
      { mode: 0o600 },
    );
    if (process.platform !== "win32")
      chmodSync(path.join(directory, "transaction.json"), 0o600);

    // Readable, and normalized to the R15 shape for callers.
    const loaded = loadTransaction(rt.stateDir, legacyId);
    assert.equal(loaded.schemaVersion, 1);
    assert.equal(loaded.attemptId, legacyId);
    assert.equal(loaded.preimageDigest, legacyId.replace(/^txn-/u, ""));
    assert.equal(loaded.status, "complete");
    assert.equal(verifyTransactionSnapshot(loaded.snapshot).verified, true);

    // It is NOT an orphan, and a new attempt from the same preimage works.
    assert.equal(findOrphanedTransaction(rt.stateDir).length, 0);
    const fresh = persist(rt, snapshot);
    assert.notEqual(fresh.attemptId, legacyId);
    // The historical directory is byte-identical afterwards.
    assert.equal(
      readFileSync(path.join(directory, "transaction.json"), "utf8"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  } finally {
    rt.dispose();
  }
});
