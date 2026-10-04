// M8/T2.2-R12 — durable transaction recovery safety.
//
// R11 made automatic apply rollback correct: it restores the exact pre-apply
// preimage and only reports success after verifying the live bytes. It left two
// boundaries open, and this suite covers both.
//
// 1. DURABILITY. R11's snapshot lives in memory. That is enough for a
//    synchronous failure the orchestrator survives, and useless if the process
//    dies mid-mutation: no recovery target, and no record that a mutation was
//    in progress, so the next apply cannot tell a clean runtime from a
//    half-mutated one. R12 persists the snapshot, marks the transaction complete
//    only on a verified outcome, and refuses a new apply when it finds a
//    transaction that started but never completed.
//
// 2. THE HISTORICAL ROLLBACK PATH. `operator-rollback.mjs` installs the
//    2026-09-11 T1 config, the clean native baseline, and no governance
//    extension. R11 stopped the apply path from reaching it; R12 guards the
//    command itself with an explicit recovery authorization that cannot be
//    inferred from a deployment decision.
//
// The tests drive a synthetic runtime and a synthetic state directory on a real
// temporary filesystem, so persistence, integrity and recovery are exercised for
// real without WSL, systemctl, or a live OpenClaw process.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyRuntime } from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";
import {
  ORPHANED_TRANSACTION,
  ROLLBACK_SAFETY_UNAVAILABLE,
  TRANSACTION_STATUS,
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
import {
  KNOWN_RECOVERY_TARGETS,
  RECOVERY_CONFIRMATION,
  RECOVERY_REFUSALS,
  authorizeHistoricalRecovery,
  evaluateRecoveryAuthorization,
  parseRecoveryArguments,
  readRecoveryAuthorization,
} from "../integrations/openclaw/topology/lib/recovery-authorization.mjs";

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

const R7_CONFIG = '{\n  "meta": { "revision": "R7" }\n}\n';
const R10_CONFIG = '{\n  "meta": { "revision": "R10" }\n}\n';
const R7_SELECTION = "// selection R7 patched\n";
const R10_SELECTION = "// selection R10 patched\n";
const R7_BRIDGE = "// bridge R7\n";
const R10_BRIDGE = "// bridge R10\n";

/**
 * A state directory + runtime root shaped like the live one, with the historical
 * r12/T1 recovery evidence present so the tests can assert it is never touched.
 */
function buildRuntime() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r12-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "openclaw");
  const dist = path.join(runtimeRoot, "dist");
  const extension = path.join(stateDir, "extensions", "zink-governance");
  const r12 = path.join(stateDir, "operator", "m7-t2", "backups", "r12");
  const nativeR12 = path.join(stateDir, "operator", "m7-t2", "native-r12");
  mkdirSync(path.join(extension, "lib"), { recursive: true });
  mkdirSync(path.join(r12, "preimages"), { recursive: true });
  mkdirSync(nativeR12, { recursive: true });
  mkdirSync(dist, { recursive: true });

  writeFileSync(path.join(stateDir, "openclaw.json"), R7_CONFIG);
  writeFileSync(path.join(extension, "index.mjs"), "// governance R7\n");
  writeFileSync(path.join(extension, "lib", "native-boundary.mjs"), R7_BRIDGE);
  writeFileSync(path.join(dist, "selection-DopzNY3I.js"), R7_SELECTION);
  writeFileSync(
    path.join(dist, "subagent-announce-Bh1QyKiE.js"),
    "// announce R7\n",
  );
  writeFileSync(path.join(dist, "zink-governance-boundary.mjs"), R7_BRIDGE);

  // Historical recovery evidence. Must remain byte-identical throughout.
  writeFileSync(path.join(r12, "t1-config.json"), '{\n  "meta": "T1" }\n');
  writeFileSync(
    path.join(r12, "manifest.json"),
    `${JSON.stringify({ governance_version: "m7-t2-r12" }, null, 2)}\n`,
  );
  writeFileSync(path.join(nativeR12, "manifest.json"), "{}\n");
  writeFileSync(path.join(nativeR12, "selection-DopzNY3I.js"), "// BASELINE\n");

  return {
    root,
    stateDir,
    runtimeRoot,
    dist,
    extension,
    r12,
    nativeR12,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function liveDigests(rt) {
  return {
    config: readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
    entrypoint: readFileSync(path.join(rt.extension, "index.mjs"), "utf8"),
    selection: readFileSync(
      path.join(rt.dist, "selection-DopzNY3I.js"),
      "utf8",
    ),
    bridge: readFileSync(
      path.join(rt.dist, "zink-governance-boundary.mjs"),
      "utf8",
    ),
  };
}

const R7_DIGESTS = Object.freeze({
  config: R7_CONFIG,
  entrypoint: "// governance R7\n",
  selection: R7_SELECTION,
  bridge: R7_BRIDGE,
});

function mutateToR10(rt) {
  writeFileSync(path.join(rt.stateDir, "openclaw.json"), R10_CONFIG);
  writeFileSync(path.join(rt.extension, "index.mjs"), "// governance R10\n");
  writeFileSync(path.join(rt.dist, "selection-DopzNY3I.js"), R10_SELECTION);
  writeFileSync(path.join(rt.dist, "zink-governance-boundary.mjs"), R10_BRIDGE);
}

/** A second, distinct deployment, so an apply genuinely changes the runtime. */
function mutateToR11(rt) {
  writeFileSync(
    path.join(rt.stateDir, "openclaw.json"),
    '{\n  "meta": "R11" }\n',
  );
  writeFileSync(path.join(rt.extension, "index.mjs"), "// governance R11\n");
  writeFileSync(
    path.join(rt.dist, "selection-DopzNY3I.js"),
    "// selection R11\n",
  );
  writeFileSync(
    path.join(rt.dist, "zink-governance-boundary.mjs"),
    "// bridge R11\n",
  );
}

/** A valid explicit recovery authorization naming the only known target. */
const recoveryAuthorization = (overrides = {}) => ({
  recoveryAuthorization: "EXPLICIT",
  target: "r12-t1-baseline",
  confirmation: RECOVERY_CONFIRMATION,
  authorizedAt: "2026-09-30T00:00:00.000Z",
  ...overrides,
});

/**
 * The orchestration harness. `failAt` names the stage that throws. Durability and
 * orphan detection are wired to the REAL implementation against a real
 * filesystem, so persistence, integrity and recovery are genuinely exercised.
 */
/**
 * M10/T2-R8: the expected post-image for each declared outcome, stated from the
 * known constants rather than read back from the live tree. `verifyLiveRestore`
 * refuses to call an apply verified unless the caller declares what the runtime
 * must look like, so these fixtures state it explicitly.
 */
const expectedRuntime = (selection, bridge) => [
  { relative: "dist/selection-DopzNY3I.js", sha256: sha256(selection) },
  {
    relative: "dist/zink-governance-boundary.mjs",
    sha256: sha256(bridge),
  },
];
const EXPECTED_R10 = expectedRuntime(R10_SELECTION, R10_BRIDGE);
const EXPECTED_R11 = expectedRuntime("// selection R11\n", "// bridge R11\n");

function harness(
  rt,
  {
    failAt = null,
    orphans = null,
    liveMutation = mutateToR10,
    expected = liveMutation === mutateToR11 ? EXPECTED_R11 : EXPECTED_R10,
  } = {},
) {
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
        return persistTransactionSnapshot(rt.stateDir, snapshot, {
          createdAt: "2026-09-30T00:00:00.000Z",
        });
      },
      markTransactionComplete: (id) => {
        record("snapshot:complete");
        if (failAt === "snapshot:complete") throw new Error("MARK_FAILED");
        return markTransactionComplete(rt.stateDir, id);
      },
      pruneQuarantine: () => {
        record("prune:quarantine");
        if (failAt === "quarantine-prune") throw new Error("EACCES");
      },
      pruneStaleNativeBackup: () => {
        record("prune:native");
        if (failAt === "native-backup-prune") throw new Error("EACCES");
      },
      applyNativePatch: () => {
        record("native:patch");
        liveMutation(rt);
        if (failAt === "native-patch") throw new Error("NATIVE_SOURCE_DRIFT");
      },
      checkNativePatch: () => {
        record("native:verify");
        if (failAt === "native-verify")
          throw new Error("NATIVE_PATCH_INCOMPLETE");
      },
      restartScopedGateway: () => {
        // The apply's own restart can be the failure. A rollback then restarts
        // again, because restored files are not live until the gateway reloads.
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
        record(options?.postApply ? "verify:applied" : "verify:restored");
        return verifyLiveRestore(rt, snapshot, options);
      },
      classifyReason: (error) => String(error?.message ?? error),
    },
  };
}

// ---------------------------------------------------------------------------
// PHASE 2/3 — durable persistence
// ---------------------------------------------------------------------------

test("R12 1: the transaction snapshot is written durably under the state area", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const record = persistTransactionSnapshot(rt.stateDir, snapshot, {
      createdAt: "2026-09-30T00:00:00.000Z",
    });

    // It lives in a dedicated transaction directory, never in r12/native-r12.
    const root = transactionRoot(rt.stateDir);
    assert.equal(
      path.dirname(root),
      path.join(rt.stateDir, "operator", "m7-t2"),
    );
    assert.ok(!root.startsWith(rt.r12));
    assert.ok(!root.startsWith(rt.nativeR12));
    assert.equal(readdirSync(root).length, 1);

    // Every recorded preimage file is on disk, byte-exact.
    for (const [relative, entry] of Object.entries(snapshot.files)) {
      if (!entry.existed) continue;
      const stored = path.join(root, record.attemptId, "preimage", relative);
      assert.equal(readFileSync(stored, "utf8"), entry.body, relative);
    }
  } finally {
    rt.dispose();
  }
});

test("R12 2: the record verifies, and its integrity binding detects tampering", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const record = persistTransactionSnapshot(rt.stateDir, snapshot, {
      createdAt: "2026-09-30T00:00:00.000Z",
    });
    // Re-reads and re-hashes: a clean load proves the manifest binds the bytes.
    const loaded = loadTransaction(rt.stateDir, record.attemptId);
    assert.equal(loaded.status, TRANSACTION_STATUS.STARTED);
    assert.equal(verifyTransactionSnapshot(loaded.snapshot).verified, true);

    // Tamper with the recorded digest; the integrity binding must refuse it.
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
  } finally {
    rt.dispose();
  }
});

test("R12 3: the snapshot survives reconstruction of the orchestrator", () => {
  const rt = buildRuntime();
  try {
    // "Orchestrator A" captures and persists, then vanishes mid-mutation.
    const snapshotA = createTransactionSnapshot(rt);
    const recordA = persistTransactionSnapshot(rt.stateDir, snapshotA, {
      createdAt: "2026-09-30T00:00:00.000Z",
    });
    // The process died: half the runtime was mutated and never rolled back.
    mutateToR10(rt);
    // A brand new process, holding nothing from the first one.
    const recovered = loadTransaction(rt.stateDir, recordA.attemptId);
    assert.equal(recovered.attemptId, recordA.attemptId);
    // And it restores the real preimage, byte for byte.
    restoreTransactionSnapshot(recovered.snapshot);
    assert.deepEqual(liveDigests(rt), R7_DIGESTS);
  } finally {
    rt.dispose();
  }
});

test("R12 4: mutation starts only after durable verification", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "gateway-restart" });
    await applyRuntime(deps);
    const persisted = calls.indexOf("snapshot:persist");
    assert.notEqual(persisted, -1, "the snapshot must be persisted");
    for (const mutating of ["builder-apply", "native:patch", "gateway:restart"])
      assert.ok(
        calls.indexOf(mutating) > persisted,
        `${mutating} must follow durable persistence`,
      );
  } finally {
    rt.dispose();
  }
});

test("R12 5: a successful apply verifies the runtime and marks the transaction complete", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt);
    const report = await applyRuntime(deps);
    assert.equal(report.status, "PASS");
    assert.equal(report.transactionStatus, TRANSACTION_STATUS.COMPLETE);
    assert.ok(report.attemptId);
    assert.equal(
      calls.includes("verify:applied"),
      true,
      "the apply must be verified",
    );
    assert.equal(calls.includes("snapshot:complete"), true);
    // The record on disk really is complete.
    const loaded = loadTransaction(rt.stateDir, report.attemptId);
    assert.equal(loaded.status, TRANSACTION_STATUS.COMPLETE);
    // The live runtime is the applied state, not the preimage.
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R10_CONFIG,
    );
  } finally {
    rt.dispose();
  }
});

test("R12 6: an apply that returns success but did not land is not a success", async () => {
  const rt = buildRuntime();
  try {
    // The builder claims success and changes nothing.
    const { deps } = harness(rt, { liveMutation: () => {} });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.reason, "APPLY_NOT_VERIFIED");
    // It rolled back, and the rollback is verified against the real preimage.
    assert.equal(report.rollbackAttempted, true);
    assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.deepEqual(liveDigests(rt), R7_DIGESTS);
  } finally {
    rt.dispose();
  }
});

test("R12 7: an incomplete transaction is detected", () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    const orphans = findOrphanedTransaction(rt.stateDir);
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].attemptId, record.attemptId);
    assert.equal(orphans[0].reason, ORPHANED_TRANSACTION);

    // Once resolved, it is no longer an orphan.
    markTransactionComplete(rt.stateDir, record.attemptId);
    assert.deepEqual(findOrphanedTransaction(rt.stateDir), []);
  } finally {
    rt.dispose();
  }
});

test("R12 8: an incomplete transaction blocks a new apply", async () => {
  const rt = buildRuntime();
  try {
    // A previous apply died after mutation began and was never resolved.
    const orphan = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    mutateToR10(rt);

    const { calls, deps } = harness(rt);
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.stage, "orphan-check");
    assert.equal(report.reason, ORPHANED_TRANSACTION);
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackAttempted, false);
    // The orphan ID is reported so an operator can decide what to do.
    assert.deepEqual(report.orphanedTransactionIds, [orphan.attemptId]);
    // Nothing was deleted, resumed, or rolled back.
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R10_CONFIG,
    );
    assert.equal(findOrphanedTransaction(rt.stateDir).length, 1);
    // And no mutating call was ever made.
    for (const call of [
      "builder-apply",
      "native:patch",
      "gateway:restart",
      "rollback:restore",
    ])
      assert.equal(calls.includes(call), false, call);
  } finally {
    rt.dispose();
  }
});

test("R12 9: a corrupted snapshot file is refused", () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    // Corrupt a preimage byte without touching the record.
    const stored = path.join(
      transactionRoot(rt.stateDir),
      record.attemptId,
      "preimage",
      "openclaw.json",
    );
    writeFileSync(stored, "corrupted\n");
    assert.throws(
      () => loadTransaction(rt.stateDir, record.attemptId),
      /TRANSACTION_SNAPSHOT_DIGEST_MISMATCH/u,
    );
  } finally {
    rt.dispose();
  }
});

test("R12 10: a missing snapshot file is refused", () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    rmSync(
      path.join(
        transactionRoot(rt.stateDir),
        record.attemptId,
        "preimage",
        "openclaw.json",
      ),
    );
    assert.throws(
      () => loadTransaction(rt.stateDir, record.attemptId),
      /TRANSACTION_SNAPSHOT_INCOMPLETE/u,
    );
  } finally {
    rt.dispose();
  }
});

test("R12 11: a traversal in the record is refused", () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    const recordPath = path.join(
      transactionRoot(rt.stateDir),
      record.attemptId,
      "transaction.json",
    );
    const onDisk = JSON.parse(readFileSync(recordPath, "utf8"));
    onDisk.files["../../escape.mjs"] = {
      existed: true,
      sha256: sha256("escaped\n"),
      mode: 0o600,
    };
    writeFileSync(recordPath, JSON.stringify(onDisk, null, 2));
    // Either the integrity binding or the path check refuses it; never a write
    // outside the transaction directory.
    assert.throws(() => loadTransaction(rt.stateDir, record.attemptId));
    assert.equal(
      existsOutside(rt.stateDir, "escape.mjs"),
      false,
      "nothing may be written outside the transaction directory",
    );
  } finally {
    rt.dispose();
  }
});

test("R12 12: a non-transaction ID is refused", () => {
  const rt = buildRuntime();
  try {
    for (const id of [
      "../../etc",
      "txn-nothex",
      "txn-" + "z".repeat(32),
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

test("R12 13: a transaction is never overwritten when its attempt ID is forced to collide", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const first = persistTransactionSnapshot(rt.stateDir, snapshot, {
      createdAt: "2026-09-30T00:00:00.000Z",
    });
    // R15: the directory is keyed by ATTEMPT identity, not by the preimage, so a
    // second attempt from the same runtime legitimately gets its own record. The
    // no-overwrite guarantee is now proven by forcing the SAME attempt ID, which
    // is the only way the collision can actually occur.
    const second = persistTransactionSnapshot(rt.stateDir, snapshot, {
      createdAt: "2026-09-30T01:00:00.000Z",
    });
    assert.notEqual(second.attemptId, first.attemptId);
    assert.equal(
      second.preimageDigest,
      first.preimageDigest,
      "both attempts record the identical preimage identity",
    );
    assert.throws(
      () =>
        persistTransactionSnapshot(rt.stateDir, snapshot, {
          createdAt: "2026-09-30T02:00:00.000Z",
          attemptId: first.attemptId,
        }),
      /TRANSACTION_ALREADY_EXISTS/u,
    );
    assert.equal(
      loadTransaction(rt.stateDir, first.attemptId).createdAt,
      "2026-09-30T00:00:00.000Z",
      "the original record must be untouched",
    );
  } finally {
    rt.dispose();
  }
});

test("R12 14: a durability failure stops before any mutation", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "snapshot:persist" });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.stage, "transaction-snapshot");
    assert.equal(report.reason, ROLLBACK_SAFETY_UNAVAILABLE);
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackAttempted, false);
    for (const call of ["builder-apply", "native:patch", "gateway:restart"])
      assert.equal(calls.includes(call), false, call);
    assert.deepEqual(liveDigests(rt), R7_DIGESTS);
  } finally {
    rt.dispose();
  }
});

test("R12 15: an unreadable transaction directory is reported, not ignored", () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    // Corrupt the record so it cannot be parsed or verified.
    writeFileSync(
      path.join(
        transactionRoot(rt.stateDir),
        record.attemptId,
        "transaction.json",
      ),
      "{ not json",
    );
    const orphans = findOrphanedTransaction(rt.stateDir);
    assert.equal(orphans.length, 1, "unresolved state must be visible");
    assert.equal(orphans[0].attemptId, record.attemptId);
    assert.equal(orphans[0].status, "unreadable");
  } finally {
    rt.dispose();
  }
});

test("R12 16: the exact preimage is restored after a mutation failure, and verified", async () => {
  // A fresh runtime per iteration: the transaction ID is derived from the
  // preimage, so re-running against one runtime would collide with the
  // previous iteration's still-retained record — which is correct behaviour,
  // and would mask what this test is for.
  for (const failAt of ["builder-apply", "native-patch", "native-verify"]) {
    const rt = buildRuntime();
    try {
      const { deps } = harness(rt, { failAt });
      const report = await applyRuntime(deps);
      assert.equal(
        report.rollbackSucceeded,
        true,
        `${failAt}: ${JSON.stringify(report)}`,
      );
      assert.deepEqual(liveDigests(rt), R7_DIGESTS, failAt);
    } finally {
      rt.dispose();
    }
  }
});

test("R12 17: an orphan is never silently deleted", async () => {
  const rt = buildRuntime();
  try {
    const record = persistTransactionSnapshot(
      rt.stateDir,
      createTransactionSnapshot(rt),
      { createdAt: "2026-09-30T00:00:00.000Z" },
    );
    const directory = path.join(transactionRoot(rt.stateDir), record.attemptId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { deps } = harness(rt);
      const result = await applyRuntime(deps);
      assert.equal(result.reason, ORPHANED_TRANSACTION);
      assert.equal(
        existsAsDirectory(directory),
        true,
        "the orphan must survive",
      );
    }
    // Still fully recoverable after three refused attempts.
    const recovered = loadTransaction(rt.stateDir, record.attemptId);
    assert.equal(verifyTransactionSnapshot(recovered.snapshot).verified, true);
  } finally {
    rt.dispose();
  }
});

test("R12 18: the historical backups/r12 remains untouched throughout", async () => {
  const rt = buildRuntime();
  try {
    const t1 = readFileSync(path.join(rt.r12, "t1-config.json"), "utf8");
    const t1Manifest = readFileSync(path.join(rt.r12, "manifest.json"), "utf8");
    const nativeManifest = readFileSync(
      path.join(rt.nativeR12, "manifest.json"),
      "utf8",
    );

    // Success, failure, and orphan-refusal paths all leave history alone.
    await applyRuntime(harness(rt).deps);
    mutateToR10(rt);
    await applyRuntime(harness(rt, { failAt: "native-verify" }).deps);

    assert.equal(readFileSync(path.join(rt.r12, "t1-config.json"), "utf8"), t1);
    assert.equal(
      readFileSync(path.join(rt.r12, "manifest.json"), "utf8"),
      t1Manifest,
    );
    assert.equal(
      readFileSync(path.join(rt.nativeR12, "manifest.json"), "utf8"),
      nativeManifest,
    );
    // Nothing was ever written into the historical directories.
    assert.equal(readdirSync(rt.r12).includes("quarantined-t2"), false);
  } finally {
    rt.dispose();
  }
});

test("R12 19: the transaction rollback path never uses the historical helpers", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "native-verify" });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, true);
    // The R11/R12 transaction path restores the preimage; it never reads the
    // r12 T1 config, never de-patches the runtime, and never quarantines the
    // extension.
    for (const forbidden of [
      "LEGACY:restoreNativePatch",
      "LEGACY:restoreT1RuntimeFiles",
      "LEGACY:historicalRollback",
    ])
      assert.equal(calls.includes(forbidden), false, forbidden);
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R7_CONFIG,
      "the R7 config, never the T1 baseline",
    );
    assert.equal(existsAsFile(path.join(rt.extension, "index.mjs")), true);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// PHASE 5/6 — the historical rollback authorization gate
// ---------------------------------------------------------------------------

test("R12 A: no authorization at all is rejected", () => {
  const { options } = parseRecoveryArguments([
    "--target=r12-t1-baseline",
    `--confirm=${RECOVERY_CONFIRMATION}`,
  ]);
  const verdict = authorizeHistoricalRecovery({
    authorization: null,
    options,
    backupPresent: true,
  });
  assert.equal(verdict.proceed, false);
  assert.equal(verdict.refusal, RECOVERY_REFUSALS.RECOVERY_NOT_AUTHORIZED);
  assert.equal(verdict.disclosure, null);
  assert.equal(verdict.installed_mutation, false);
});

test("R12 B: a generic deployment authorization is rejected as a recovery grant", () => {
  const { options } = parseRecoveryArguments([
    "--target=r12-t1-baseline",
    `--confirm=${RECOVERY_CONFIRMATION}`,
  ]);
  for (const deploymentOnly of [
    { deploymentAuthorization: "YES" },
    { DeploymentAuthorized: "YES", PlanRevision: "M8/T2.2-R12" },
    { executionAuthorization: "YES", deploymentAuthorization: "YES" },
  ]) {
    const verdict = authorizeHistoricalRecovery({
      authorization: deploymentOnly,
      options,
      backupPresent: true,
    });
    assert.equal(verdict.proceed, false, JSON.stringify(deploymentOnly));
    assert.equal(
      verdict.refusal,
      RECOVERY_REFUSALS.DEPLOYMENT_AUTHORIZATION_IS_NOT_RECOVERY,
    );
  }
  // The distinction is reported explicitly, not collapsed into "unauthorized".
  assert.equal(
    evaluateRecoveryAuthorization({ recoveryAuthorization: "IMPLICIT" })
      .authorized,
    false,
  );
  assert.equal(
    evaluateRecoveryAuthorization(recoveryAuthorization()).authorized,
    true,
  );
});

test("R12 C: an explicit recovery authorization may proceed", () => {
  const { options } = parseRecoveryArguments([
    "--target=r12-t1-baseline",
    `--confirm=${RECOVERY_CONFIRMATION}`,
  ]);
  const verdict = authorizeHistoricalRecovery({
    authorization: recoveryAuthorization(),
    options,
    backupPresent: true,
  });
  assert.equal(verdict.proceed, true);
  // And it discloses the exact target BEFORE any mutation.
  assert.equal(verdict.disclosure.action, "HISTORICAL_RECOVERY");
  assert.equal(verdict.disclosure.isTransactionRollback, false);
  assert.equal(verdict.disclosure.willInstall, "2026-09-11 T1 config");
  assert.equal(verdict.disclosure.willRestoreNative, "CLEAN_UPSTREAM_BASELINE");
  assert.equal(verdict.disclosure.willRemoveGovernanceExtension, true);
  assert.equal(verdict.installed_mutation, false);
});

test("R12 D: a wrong or unnamed target is rejected", () => {
  // Unknown target.
  assert.equal(
    authorizeHistoricalRecovery({
      authorization: recoveryAuthorization(),
      options: { target: "latest-build", confirmed: true },
      backupPresent: true,
    }).refusal,
    RECOVERY_REFUSALS.RECOVERY_TARGET_UNKNOWN,
  );
  // Target not named at all.
  assert.equal(
    authorizeHistoricalRecovery({
      authorization: recoveryAuthorization(),
      options: { target: null, confirmed: true },
      backupPresent: true,
    }).refusal,
    RECOVERY_REFUSALS.RECOVERY_TARGET_NOT_NAMED,
  );
  // Known target the authorization does not cover.
  assert.equal(
    authorizeHistoricalRecovery({
      authorization: recoveryAuthorization({ target: "r12-t1-baseline" }),
      options: { target: "r12-t1-baseline ", confirmed: true },
      backupPresent: true,
    }).refusal,
    RECOVERY_REFUSALS.RECOVERY_TARGET_UNKNOWN,
  );
  // No confirmation.
  assert.equal(
    authorizeHistoricalRecovery({
      authorization: recoveryAuthorization(),
      options: { target: "r12-t1-baseline", confirmed: false },
      backupPresent: true,
    }).refusal,
    RECOVERY_REFUSALS.RECOVERY_NOT_CONFIRMED,
  );
  // An unsupported argument.
  assert.equal(
    parseRecoveryArguments(["--force"]).refusal,
    RECOVERY_REFUSALS.UNSUPPORTED_ARGUMENT,
  );
});

test("R12 E: a missing backup is rejected even with full authorization", () => {
  const { options } = parseRecoveryArguments([
    "--target=r12-t1-baseline",
    `--confirm=${RECOVERY_CONFIRMATION}`,
  ]);
  const verdict = authorizeHistoricalRecovery({
    authorization: recoveryAuthorization(),
    options,
    backupPresent: false,
  });
  assert.equal(verdict.proceed, false);
  assert.equal(verdict.refusal, RECOVERY_REFUSALS.RECOVERY_BACKUP_MISSING);
  assert.equal(verdict.disclosure, null);
});

test("R12 F: the historical target is identified as historical, never as a transaction rollback", () => {
  for (const [name, target] of Object.entries(KNOWN_RECOVERY_TARGETS)) {
    assert.equal(target.kind, "HISTORICAL_RECOVERY", name);
    assert.equal(target.willRemoveGovernanceExtension, true, name);
    assert.match(target.label, /2026-09-11/u, name);
  }
  const verdict = authorizeHistoricalRecovery({
    authorization: recoveryAuthorization(),
    options: { target: "r12-t1-baseline", confirmed: true },
    backupPresent: true,
  });
  assert.equal(verdict.disclosure.isTransactionRollback, false);
  assert.equal(verdict.disclosure.action, "HISTORICAL_RECOVERY");
});

test("R12 G: a recovery authorization file is read under restrictive rules only", () => {
  const rt = buildRuntime();
  try {
    const authPath = path.join(rt.stateDir, "recovery-authorization.json");

    // Missing file.
    assert.equal(readRecoveryAuthorization(authPath), null);

    // Wrong mode.
    writeFileSync(authPath, JSON.stringify(recoveryAuthorization()));
    if (process.platform !== "win32") {
      chmodSync(authPath, 0o644);
      assert.equal(
        readRecoveryAuthorization(authPath),
        null,
        "a loose mode is refused",
      );
      chmodSync(authPath, 0o600);
    }
    assert.deepEqual(
      readRecoveryAuthorization(authPath),
      recoveryAuthorization(),
    );

    // Malformed JSON.
    writeFileSync(authPath, "{ not json");
    assert.equal(readRecoveryAuthorization(authPath), null);
  } finally {
    rt.dispose();
  }
});

/** FALSIFICATION — each guarantee must fail when its mechanism is removed. */
test("R12 H: FALSIFICATION — every gate is load-bearing", () => {
  const good = {
    authorization: recoveryAuthorization(),
    options: { target: "r12-t1-baseline", confirmed: true },
    backupPresent: true,
  };
  // Sanity: the valid combination really is permitted.
  assert.equal(authorizeHistoricalRecovery(good).proceed, true);

  // Remove each requirement in turn; the gate must close every time.
  assert.equal(
    authorizeHistoricalRecovery({ ...good, authorization: null }).proceed,
    false,
  );
  assert.equal(
    authorizeHistoricalRecovery({ ...good, backupPresent: false }).proceed,
    false,
  );
  assert.equal(
    authorizeHistoricalRecovery({
      ...good,
      options: { ...good.options, confirmed: false },
    }).proceed,
    false,
  );
  assert.equal(
    authorizeHistoricalRecovery({
      ...good,
      options: { ...good.options, target: "something-else" },
    }).proceed,
    false,
  );
  // Break the integrity binding: the load must fail closed.
  const tampered = recoveryAuthorization();
  tampered.confirmation = "yes";
  assert.equal(
    authorizeHistoricalRecovery({ ...good, authorization: tampered }).proceed,
    false,
  );
});

/** FALSIFICATION — orphan detection must fail closed when it is removed. */
test("R12 H2: FALSIFICATION — without orphan detection the runtime is ambiguous", async () => {
  // Case 1: with detection, an unresolved transaction blocks a second deployment.
  {
    const rt = buildRuntime();
    try {
      persistTransactionSnapshot(rt.stateDir, createTransactionSnapshot(rt), {
        createdAt: "2026-09-30T00:00:00.000Z",
      });
      mutateToR10(rt);
      const refused = await applyRuntime(harness(rt).deps);
      assert.equal(refused.reason, ORPHANED_TRANSACTION);
      assert.equal(refused.mutationStarted, false);
      assert.equal(refused.orphanedTransactionIds.length, 1);
    } finally {
      rt.dispose();
    }
  }

  // Case 2: the SAME unresolved state with detection removed. The half-mutated
  // runtime is treated as a clean pre-apply state, a second deployment proceeds
  // on top of it, and the first transaction is still unresolved. That is the
  // ambiguous outcome R12 exists to prevent.
  {
    const rt = buildRuntime();
    try {
      persistTransactionSnapshot(rt.stateDir, createTransactionSnapshot(rt), {
        createdAt: "2026-09-30T00:00:00.000Z",
      });
      mutateToR10(rt);
      // The second deployment is a genuinely different build, so it really does
      // change the runtime and really would be reported as a success.
      const proceeded = await applyRuntime(
        harness(rt, { orphans: [], liveMutation: mutateToR11 }).deps,
      );
      assert.equal(proceeded.status, "PASS");
      assert.equal(proceeded.orphanedTransactionIds, null);
      assert.equal(
        readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
        '{\n  "meta": "R11" }\n',
        "a second deployment is layered over the unresolved first one",
      );
      // And the first transaction is still unresolved: nothing reconciled it.
      assert.equal(findOrphanedTransaction(rt.stateDir).length, 1);
    } finally {
      rt.dispose();
    }
  }
});

function existsAsDirectory(target) {
  try {
    return readdirSync(target) !== null;
  } catch {
    return false;
  }
}

function existsAsFile(target) {
  try {
    return readFileSync(target) !== null;
  } catch {
    return false;
  }
}

function existsOutside(stateDir, name) {
  for (const candidate of [
    path.join(stateDir, name),
    path.join(stateDir, "..", name),
    path.join(path.dirname(stateDir), name),
  ])
    if (existsAsFile(candidate)) return true;
  return false;
}
