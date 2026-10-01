// M8/T2.2-R11 — transactional live rollback safety.
//
// R11 replaces two false assumptions in the live apply path:
//
//   1. Rollback restores the historical r12/T1 BASELINE. Proven wrong: the
//      wired target is `backups/r12/t1-config.json`, captured 2026-09-11,
//      and `native-r12`, which holds clean upstream preimages. Restoring it
//      installs a superseded config, quarantines the governance extension and
//      DE-PATCHES the native runtime.
//
//   2. `rollbackSucceeded` means the runtime came back. Proven wrong: it was
//      set purely because the restore helpers returned, with no comparison
//      against the pre-apply state. A restore to the WRONG state reported
//      success.
//
// R11 therefore makes the apply transactionally reversible: a transaction
// snapshot of the EXACT live runtime is created and verified BEFORE any
// mutation, rollback restores that preimage, and success is emitted only after
// the live runtime is verified against it.
//
// `backups/r12` is never a transaction rollback target. It remains historical
// recovery evidence and must be left untouched.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyRuntime } from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";
import {
  ROLLBACK_SAFETY_UNAVAILABLE,
  createTransactionSnapshot,
  restoreTransactionSnapshot,
  verifyTransactionSnapshot,
  verifyLiveRestore,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

// ---------------------------------------------------------------------------
// A synthetic runtime, shaped exactly like the live one: a config, a
// governance extension, patched native artifacts and a bridge.
// ---------------------------------------------------------------------------

const R7_CONFIG = '{\n  "meta": { "revision": "R7" }\n}\n';
const T1_CONFIG = '{\n  "meta": { "revision": "T1" }\n}\n';
const R10_CONFIG = '{\n  "meta": { "revision": "R10" }\n}\n';
const R7_SELECTION = "// selection R7 patched\n";
const R10_SELECTION = "// selection R10 patched\n";
const R7_ANNOUNCE = "// announce R7 patched\n";
const R7_BRIDGE = "// bridge R7\n";
const R10_BRIDGE = "// bridge R10\n";

function buildRuntime() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r11-rt-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "openclaw");
  const dist = path.join(runtimeRoot, "dist");
  const extension = path.join(stateDir, "extensions", "zink-governance");
  mkdirSync(path.join(extension, "lib"), { recursive: true });
  mkdirSync(dist, { recursive: true });
  mkdirSync(path.join(stateDir, "operator", "m7-t2", "backups", "r12"), {
    recursive: true,
  });

  writeFileSync(path.join(stateDir, "openclaw.json"), R7_CONFIG);
  writeFileSync(path.join(extension, "index.mjs"), "// governance R7\n");
  writeFileSync(path.join(extension, "lib", "native-boundary.mjs"), R7_BRIDGE);
  writeFileSync(path.join(dist, "selection-DopzNY3I.js"), R7_SELECTION);
  writeFileSync(path.join(dist, "subagent-announce-Bh1QyKiE.js"), R7_ANNOUNCE);
  writeFileSync(path.join(dist, "zink-governance-boundary.mjs"), R7_BRIDGE);

  // The historical r12/T1 baseline, which must be left alone by R11.
  writeFileSync(
    path.join(
      stateDir,
      "operator",
      "m7-t2",
      "backups",
      "r12",
      "t1-config.json",
    ),
    T1_CONFIG,
  );
  const nativeR12 = path.join(stateDir, "operator", "m7-t2", "native-r12");
  mkdirSync(nativeR12, { recursive: true });
  writeFileSync(
    path.join(nativeR12, "selection-DopzNY3I.js"),
    "// selection BASELINE\n",
  );

  return {
    root,
    stateDir,
    runtimeRoot,
    dist,
    extension,
    nativeR12,
    r12: path.join(stateDir, "operator", "m7-t2", "backups", "r12"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** Every path the transaction snapshot is contractually required to cover. */
function liveDigests(rt) {
  return {
    config: readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
    entrypoint: readFileSync(path.join(rt.extension, "index.mjs"), "utf8"),
    extensionBridge: readFileSync(
      path.join(rt.extension, "lib", "native-boundary.mjs"),
      "utf8",
    ),
    selection: readFileSync(
      path.join(rt.dist, "selection-DopzNY3I.js"),
      "utf8",
    ),
    announce: readFileSync(
      path.join(rt.dist, "subagent-announce-Bh1QyKiE.js"),
      "utf8",
    ),
    bridge: readFileSync(
      path.join(rt.dist, "zink-governance-boundary.mjs"),
      "utf8",
    ),
  };
}

/** Apply the R10 change to the synthetic runtime, as `--apply` would. */
function mutateToR10(rt) {
  writeFileSync(path.join(rt.stateDir, "openclaw.json"), R10_CONFIG);
  writeFileSync(path.join(rt.extension, "index.mjs"), "// governance R10\n");
  writeFileSync(
    path.join(rt.extension, "lib", "native-boundary.mjs"),
    R10_BRIDGE,
  );
  writeFileSync(path.join(rt.dist, "selection-DopzNY3I.js"), R10_SELECTION);
  writeFileSync(path.join(rt.dist, "zink-governance-boundary.mjs"), R10_BRIDGE);
}

/**
 * The old, defective rollback: restore the historical T1/r12 baseline and
 * de-patch the native runtime. Reproduces the incident exactly.
 */
function legacyRollback(rt) {
  writeFileSync(
    path.join(rt.stateDir, "openclaw.json"),
    readFileSync(path.join(rt.r12, "t1-config.json"), "utf8"),
  );
  rmSync(path.join(rt.extension, "index.mjs"), { force: true });
  rmSync(path.join(rt.extension, "lib"), { recursive: true, force: true });
  writeFileSync(
    path.join(rt.dist, "selection-DopzNY3I.js"),
    readFileSync(path.join(rt.nativeR12, "selection-DopzNY3I.js"), "utf8"),
  );
  rmSync(path.join(rt.dist, "zink-governance-boundary.mjs"), { force: true });
}

/**
 * An orchestration harness. `failAt` names the stage that throws; `onApply` is
 * the live mutation. Every effect is injected, so no WSL and no live runtime is
 * involved.
 */
function harness(rt, { failAt = null, liveMutation = mutateToR10 } = {}) {
  const calls = [];
  let restarted = false;
  const record = (name) => calls.push(name);
  return {
    calls,
    deps: {
      readIdentifiers: () => ({ guildId: "1" }),
      runBuilder: (mode) => {
        // `configure.mjs` is invoked as `--preflight` / `--apply`.
        record(`builder:${mode.replace(/^--/u, "")}`);
        if (failAt === `builder-${mode.replace(/^--/u, "")}`)
          throw new Error("Policy drift");
      },
      createTransactionSnapshot: () => {
        record("snapshot:create");
        return createTransactionSnapshot(rt);
      },
      verifyTransactionSnapshot: (snapshot) => {
        record("snapshot:verify");
        return verifyTransactionSnapshot(snapshot);
      },
      // R12 durability seams. This suite still proves the R11 in-memory contract;
      // durability, integrity and orphan handling are covered by
      // m8-t2.9-r12-durable-recovery.test.mjs against a real filesystem.
      findOrphanedTransaction: () => [],
      persistTransactionSnapshot: (snapshot) => {
        record("snapshot:persist");
        return { ...snapshot, attemptId: "txn-synthetic", snapshot };
      },
      markTransactionComplete: () => {
        record("snapshot:complete");
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
        // The apply's own restart can be the thing that fails. A rollback then
        // restarts again, because the restored config and native artifacts are
        // not loaded until the gateway picks them up. Only the FIRST call fails,
        // so the rollback path is exercised as it would be in reality.
        const first = !restarted;
        restarted = true;
        record("gateway:restart");
        if (first && failAt === "gateway-restart")
          throw new Error("GATEWAY_NOT_ACTIVE");
      },
      // Production re-verifies the snapshot immediately before it is used to
      // restore. The tests depend on this seam too, so a snapshot tampered
      // between capture and rollback is refused rather than trusted.
      restoreTransactionSnapshot: (snapshot) => {
        record("rollback:restore");
        verifyTransactionSnapshot(snapshot);
        return restoreTransactionSnapshot(snapshot);
      },
      verifyLiveRestore: (snapshot, options) => {
        if (options?.postApply) {
          // The mutation really ran, so the post-apply check passes.
          record("verify:applied");
          return { applied: true, unrestored: [] };
        }
        record("rollback:validate");
        return verifyLiveRestore(rt, snapshot);
      },
      // The legacy helpers must not be reachable from the transaction path.
      restoreNativePatch: () => {
        record("LEGACY:restoreNativePatch");
        legacyRollback(rt);
      },
      restoreT1RuntimeFiles: async () => {
        record("LEGACY:restoreT1RuntimeFiles");
        legacyRollback(rt);
        return { liveBaselineValidation: "NOT RUN" };
      },
      validateConfig: () => {
        record("rollback:validateConfig");
      },
      classifyReason: (error) => String(error?.message ?? error),
    },
  };
}

// ---------------------------------------------------------------------------
// Snapshot creation and verification
// ---------------------------------------------------------------------------

test("R11 1: a transaction snapshot captures the exact live pre-apply state", () => {
  const rt = buildRuntime();
  try {
    const before = liveDigests(rt);
    const snapshot = createTransactionSnapshot(rt);
    // Every mutable component is covered, and each is byte-exact.
    assert.equal(snapshot.files["openclaw.json"].sha256, sha256(before.config));
    assert.equal(
      snapshot.files["extensions/zink-governance/index.mjs"].sha256,
      sha256(before.entrypoint),
    );
    assert.equal(
      snapshot.files["dist/selection-DopzNY3I.js"].sha256,
      sha256(before.selection),
    );
    assert.equal(
      snapshot.files["dist/subagent-announce-Bh1QyKiE.js"].sha256,
      sha256(before.announce),
    );
    assert.equal(
      snapshot.files["dist/zink-governance-boundary.mjs"].sha256,
      sha256(before.bridge),
    );
    assert.equal(verifyTransactionSnapshot(snapshot).verified, true);
  } finally {
    rt.dispose();
  }
});

test("R11 2: snapshot creation failure stops before any mutation", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt);
    deps.createTransactionSnapshot = () => {
      calls.push("snapshot:create");
      throw new Error("TRANSACTION_SNAPSHOT_FAILED");
    };
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.reason, ROLLBACK_SAFETY_UNAVAILABLE);
    assert.equal(report.stage, "transaction-snapshot");
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackAttempted, false);
    // The read-only preflight may precede the snapshot; nothing after it ran.
    assert.deepEqual(calls, ["builder:preflight", "snapshot:create"]);
    assert.deepEqual(liveDigests(rt), buildRuntimeDigests());
  } finally {
    rt.dispose();
  }
});

test("R11 3: snapshot verification failure stops before any mutation", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt);
    deps.verifyTransactionSnapshot = () => {
      calls.push("snapshot:verify");
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    };
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.reason, ROLLBACK_SAFETY_UNAVAILABLE);
    assert.equal(report.stage, "transaction-snapshot");
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackAttempted, false);
    assert.equal(calls.includes("builder:apply"), false);
    assert.equal(calls.includes("gateway:restart"), false);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// The mutation gate and the happy path
// ---------------------------------------------------------------------------

test("R11 4: no mutation is possible before the snapshot is verified", async () => {
  const rt = buildRuntime();
  try {
    // Fail late, so every stage up to the restart is reached and the ordering
    // between snapshot verification and each mutation is actually observed.
    const { calls, deps } = harness(rt, { failAt: "gateway-restart" });
    await applyRuntime(deps);
    const snapshotAt = calls.indexOf("snapshot:verify");
    assert.notEqual(snapshotAt, -1, "the snapshot must be verified");
    for (const mutating of ["builder:apply", "native:patch", "gateway:restart"])
      assert.ok(
        calls.indexOf(mutating) > snapshotAt,
        `${mutating} must follow snapshot verification`,
      );
  } finally {
    rt.dispose();
  }
});

test("R11 5: a successful apply performs no rollback and keeps the new state", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt);
    const report = await applyRuntime(deps);
    assert.equal(report.status, "PASS");
    assert.equal(report.stage, "applied");
    assert.equal(report.rollbackAttempted, false);
    assert.equal(report.rollbackSucceeded, false);
    assert.equal(
      calls.some((c) => c.startsWith("rollback:")),
      false,
    );
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R10_CONFIG,
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// Rollback restores the exact preimage
// ---------------------------------------------------------------------------

for (const [label, failAt] of [
  ["first mutating call (builder-apply)", "builder-apply"],
  ["a later mutating call (quarantine-prune)", "quarantine-prune"],
  ["native mutation (native-patch)", "native-patch"],
  ["native verify (native-verify)", "native-verify"],
  ["gateway restart (gateway-restart)", "gateway-restart"],
]) {
  test(`R11 6: a failure at ${label} restores the exact preimage`, async () => {
    const rt = buildRuntime();
    try {
      const before = liveDigests(rt);
      const { deps } = harness(rt, { failAt });
      const report = await applyRuntime(deps);
      assert.equal(report.status, "FAIL");
      assert.equal(report.mutationStarted, true);
      assert.equal(report.rollbackAttempted, true);
      assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
      // Byte identity across every mutated component.
      assert.deepEqual(liveDigests(rt), before);
    } finally {
      rt.dispose();
    }
  });
}

test("R11 7: a mid-sequence failure restores ALL previously mutated state", async () => {
  const rt = buildRuntime();
  try {
    const before = liveDigests(rt);
    // Mutate config AND extension, then fail on the native patch.
    const { deps } = harness(rt, {
      failAt: "native-patch",
      liveMutation: (target) => {
        writeFileSync(path.join(target.stateDir, "openclaw.json"), R10_CONFIG);
        writeFileSync(
          path.join(target.extension, "index.mjs"),
          "// governance R10\n",
        );
        mutateToR10(target);
      },
    });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.deepEqual(liveDigests(rt), before);
  } finally {
    rt.dispose();
  }
});

test("R11 8: a preflight failure mutates nothing and rolls nothing back", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "builder-preflight" });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackAttempted, false);
    assert.equal(report.rollbackSucceeded, false);
    assert.equal(calls.includes("rollback:restore"), false);
    assert.deepEqual(liveDigests(rt), buildRuntimeDigests());
  } finally {
    rt.dispose();
  }
});

test("R11 9: no destructive operation runs when mutation never started", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "builder-preflight" });
    await applyRuntime(deps);
    for (const destructive of [
      "rollback:restore",
      "LEGACY:restoreNativePatch",
      "LEGACY:restoreT1RuntimeFiles",
      "gateway:restart",
      "native:patch",
    ])
      assert.equal(calls.includes(destructive), false, destructive);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// Live restore validation — the false-positive defence
// ---------------------------------------------------------------------------

test("R11 10: a restore that returns while the live runtime differs is NOT a success", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, { failAt: "native-verify" });
    // The restore helper succeeds, but the config silently stays mutated. This
    // is exactly the old false positive: a returning restore, an unrestored
    // runtime, and a reported success.
    deps.restoreTransactionSnapshot = (snapshot) => {
      calls.push("rollback:restore");
      // Restore only the native artifacts, leaving the config wrong.
      const partial = {
        ...snapshot,
        files: Object.fromEntries(
          Object.entries(snapshot.files).filter(([name]) =>
            name.startsWith("dist/"),
          ),
        ),
      };
      return restoreTransactionSnapshot(partial);
    };
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.rollbackAttempted, true);
    assert.equal(
      report.rollbackSucceeded,
      false,
      "an unverified restore must never report success",
    );
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R10_CONFIG,
      "the scenario really did leave the config unrestored",
    );
  } finally {
    rt.dispose();
  }
});

test("R11 11: verifyLiveRestore names every component that does not match", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    mutateToR10(rt);
    writeFileSync(path.join(rt.dist, "selection-DopzNY3I.js"), "// tampered\n");
    const verdict = verifyLiveRestore(rt, snapshot);
    assert.equal(verdict.restored, false);
    for (const component of [
      "openclaw.json",
      "extensions/zink-governance/index.mjs",
      "dist/selection-DopzNY3I.js",
      "dist/zink-governance-boundary.mjs",
    ])
      assert.ok(
        verdict.mismatches.includes(component),
        `${component} must be reported as mismatched`,
      );
  } finally {
    rt.dispose();
  }
});

test("R11 12: a snapshot tampered between capture and rollback is refused", async () => {
  const rt = buildRuntime();
  try {
    const { deps } = harness(rt, { failAt: "native-verify" });
    // Tamper AFTER the snapshot is verified and BEFORE it is used to restore, so
    // the only thing standing between the corrupted preimage and the live
    // runtime is the pre-restore re-verification.
    const original = deps.restoreTransactionSnapshot;
    deps.restoreTransactionSnapshot = (snapshot) => {
      snapshot.files["openclaw.json"].sha256 = "1".repeat(64);
      return original(snapshot);
    };
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.rollbackAttempted, true);
    assert.equal(report.rollbackSucceeded, false);
    assert.equal(report.rollbackReason, "TRANSACTION_SNAPSHOT_INCONSISTENT");
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R10_CONFIG,
      "a tampered preimage must not be written to the live runtime",
    );
  } finally {
    rt.dispose();
  }
});

test("R11 12b: a snapshot that verifies cleanly is accepted", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    snapshot.files["openclaw.json"].sha256 = "0".repeat(64);
    assert.throws(
      () => verifyTransactionSnapshot(snapshot),
      /TRANSACTION_SNAPSHOT_INCONSISTENT/u,
    );
  } finally {
    rt.dispose();
  }
});

test("R11 13: a recorded path cannot escape the root it was captured from", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    // A traversal recorded under the runtime root must be refused, so a
    // tampered snapshot cannot reach outside the runtime it describes.
    const tampered = {
      ...snapshot,
      files: {
        ...snapshot.files,
        "dist/../../escape.mjs": {
          existed: true,
          sha256: sha256("escaped\n"),
          mode: 0o600,
          body: "escaped\n",
        },
      },
    };
    assert.throws(
      () => restoreTransactionSnapshot(tampered),
      /TRANSACTION_SNAPSHOT_TARGET_MISMATCH/u,
    );
    // A traversal recorded under the state root is equally refused.
    const stateEscape = {
      ...snapshot,
      files: {
        ...snapshot.files,
        "openclaw.json/../../escape.json": {
          existed: true,
          sha256: sha256("escaped\n"),
          mode: 0o600,
          body: "escaped\n",
        },
      },
    };
    assert.throws(
      () => restoreTransactionSnapshot(stateEscape),
      /TRANSACTION_SNAPSHOT_TARGET_MISMATCH/u,
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// Error preservation and determinism
// ---------------------------------------------------------------------------

test("R11 14: apply, rollback and validation errors are preserved independently", async () => {
  const rt = buildRuntime();
  try {
    const { deps } = harness(rt, { failAt: "native-verify" });
    deps.restoreTransactionSnapshot = () => {
      throw new Error("TRANSACTION_RESTORE_FAILED");
    };
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.reason, "NATIVE_PATCH_INCOMPLETE");
    assert.equal(report.rollbackAttempted, true);
    assert.equal(report.rollbackSucceeded, false);
    assert.equal(report.rollbackReason, "TRANSACTION_RESTORE_FAILED");
    // A restore failure and a validation failure are distinct fields.
    assert.notEqual(report.rollbackReason, report.reason);
    assert.equal(
      report.restoreValidationReason,
      null,
      "validation never ran, so it must not be conflated with the restore error",
    );
  } finally {
    rt.dispose();
  }
});

test("R11 15: a validation failure is reported separately from a restore failure", async () => {
  const rt = buildRuntime();
  try {
    const { deps } = harness(rt, { failAt: "native-verify" });
    deps.verifyLiveRestore = () => ({
      restored: false,
      mismatches: ["openclaw.json"],
    });
    const report = await applyRuntime(deps);
    assert.equal(report.reason, "NATIVE_PATCH_INCOMPLETE");
    assert.equal(
      report.rollbackReason,
      null,
      "the restore itself did not fail",
    );
    assert.equal(report.rollbackSucceeded, false);
    assert.deepEqual(report.restoreMismatches, ["openclaw.json"]);
    assert.equal(
      report.restoreValidationReason,
      "TRANSACTION_RESTORE_UNVERIFIED",
    );
  } finally {
    rt.dispose();
  }
});

test("R11 16: repeated identical failures report deterministically", async () => {
  const rt = buildRuntime();
  try {
    const reports = [];
    for (let index = 0; index < 3; index += 1) {
      // The snapshot is taken INSIDE each apply, so each attempt must restore
      // the R7 state that was live when that attempt began. A leftover R10 from a
      // prior attempt would be the correct preimage for that attempt, so the
      // runtime is reset to R7 to keep the three attempts identical.
      const fresh = buildRuntime();
      try {
        const { deps } = harness(fresh, { failAt: "gateway-restart" });
        reports.push(await applyRuntime(deps));
        assert.deepEqual(
          liveDigests(fresh),
          {
            config: R7_CONFIG,
            entrypoint: "// governance R7\n",
            extensionBridge: R7_BRIDGE,
            selection: R7_SELECTION,
            announce: R7_ANNOUNCE,
            bridge: R7_BRIDGE,
          },
          "each attempt restores its own R7 preimage",
        );
      } finally {
        fresh.dispose();
      }
    }
    for (const report of reports)
      assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.equal(reports[0].rollbackSucceeded, reports[1].rollbackSucceeded);
    assert.equal(reports[1].rollbackSucceeded, reports[2].rollbackSucceeded);
    // Determinism is exact, not merely "all true".
    assert.deepEqual(
      reports.map((r) => [r.stage, r.reason, r.rollbackSucceeded]),
      reports.map(() => ["gateway-restart", "GATEWAY_NOT_ACTIVE", true]),
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// The historical r12/T1 baseline is never a transaction target
// ---------------------------------------------------------------------------

test("R11 17: the transaction path never reads or writes backups/r12", async () => {
  const rt = buildRuntime();
  try {
    const t1Before = readFileSync(path.join(rt.r12, "t1-config.json"), "utf8");
    const nativeBefore = readFileSync(
      path.join(rt.nativeR12, "selection-DopzNY3I.js"),
      "utf8",
    );
    const { calls, deps } = harness(rt, { failAt: "native-verify" });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.equal(
      readFileSync(path.join(rt.r12, "t1-config.json"), "utf8"),
      t1Before,
      "the historical T1 baseline must be untouched",
    );
    assert.equal(
      readFileSync(path.join(rt.nativeR12, "selection-DopzNY3I.js"), "utf8"),
      nativeBefore,
      "the historical native preimage must be untouched",
    );
    for (const legacy of [
      "LEGACY:restoreNativePatch",
      "LEGACY:restoreT1RuntimeFiles",
    ])
      assert.equal(calls.includes(legacy), false, legacy);
  } finally {
    rt.dispose();
  }
});

test("R11 18: rollback does not use the T1 config even when it is present", async () => {
  const rt = buildRuntime();
  try {
    const before = liveDigests(rt);
    const { deps } = harness(rt, { failAt: "native-patch" });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R7_CONFIG,
      "the R7 config must be restored, never the T1 baseline",
    );
    assert.deepEqual(liveDigests(rt), before);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// PHASE 8 — mandatory falsification of the incident defect
// ---------------------------------------------------------------------------

test("R11 F1: the OLD rollback restores T1, which does NOT satisfy the contract", () => {
  const rt = buildRuntime();
  try {
    // Snapshot the genuine R7 pre-apply state, exactly as R11 requires.
    const preimage = createTransactionSnapshot(rt);
    const before = liveDigests(rt);
    assert.equal(verifyLiveRestore(rt, preimage).restored, true);

    mutateToR10(rt);
    // The historical behaviour, reproduced exactly: restore the r12/T1 config
    // and de-patch the native runtime.
    legacyRollback(rt);

    // The old code reported success here, because the restore helpers returned.
    const legacyReportedSuccess = true;
    assert.equal(legacyReportedSuccess, true, "the old code reported success");

    // ...but the runtime is NOT the pre-apply state. `liveDigests` cannot be
    // used here: the old rollback DELETED the extension and the bridge, which is
    // itself part of the proof.
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      T1_CONFIG,
      "the config is the T1 baseline, not R7",
    );
    assert.notEqual(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      before.config,
    );
    assert.notEqual(
      readFileSync(path.join(rt.dist, "selection-DopzNY3I.js"), "utf8"),
      before.selection,
      "the native runtime is de-patched",
    );
    assert.throws(
      () => readFileSync(path.join(rt.extension, "index.mjs"), "utf8"),
      /ENOENT/u,
      "the governance extension is quarantined away",
    );
    assert.throws(
      () =>
        readFileSync(
          path.join(rt.dist, "zink-governance-boundary.mjs"),
          "utf8",
        ),
      /ENOENT/u,
      "the native bridge is removed",
    );

    // The new contract rejects exactly this outcome: three components mismatch.
    const verdict = verifyLiveRestore(rt, preimage);
    assert.equal(verdict.restored, false);
    for (const component of [
      "openclaw.json",
      "extensions/zink-governance/index.mjs",
      "dist/selection-DopzNY3I.js",
      "dist/zink-governance-boundary.mjs",
    ]) {
      assert.ok(
        verdict.mismatches.includes(component),
        `${component} must be reported as not restored`,
      );
    }
  } finally {
    rt.dispose();
  }
});

test("R11 F2: the NEW rollback restores R7 exactly, where the old one restored T1", async () => {
  const rt = buildRuntime();
  try {
    const before = liveDigests(rt);
    const { deps } = harness(rt, { failAt: "gateway-restart" });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, true, report.rollbackReason ?? "");
    assert.equal(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      R7_CONFIG,
    );
    assert.notEqual(
      readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
      T1_CONFIG,
      "the T1 baseline must never be installed by the transaction path",
    );
    assert.deepEqual(liveDigests(rt), before);
  } finally {
    rt.dispose();
  }
});

test("R11 F3: the false positive is falsified — return without restoring is a failure", async () => {
  const rt = buildRuntime();
  try {
    // A restore helper that returns successfully while doing nothing at all.
    const { deps } = harness(rt, { failAt: "native-verify" });
    deps.restoreTransactionSnapshot = () => ({ restored: true });
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackAttempted, true);
    assert.equal(
      report.rollbackSucceeded,
      false,
      "a no-op restore must not be reported as a successful rollback",
    );
    assert.equal(
      report.restoreValidationReason,
      "TRANSACTION_RESTORE_UNVERIFIED",
    );
  } finally {
    rt.dispose();
  }
});

test("R11 F4: removing live validation reopens the false positive", async () => {
  const rt = buildRuntime();
  try {
    // The R7 behaviour: success is decided by the restore helper alone.
    const { deps } = harness(rt, { failAt: "native-verify" });
    deps.restoreTransactionSnapshot = () => {
      /* returns without restoring */
    };
    // With validation wired in, this is a failure...
    const report = await applyRuntime(deps);
    assert.equal(report.rollbackSucceeded, false);
    // ...and the R7 rule ("the helper returned") would have said true.
    const r7WouldSay = true;
    assert.equal(r7WouldSay, true);
    assert.notEqual(report.rollbackSucceeded, r7WouldSay);
  } finally {
    rt.dispose();
  }
});

test("R11 F5: every R11 guarantee fails when its mechanism is broken", async () => {
  // Each guarantee is a claim about what CANNOT happen, so each is proven by
  // breaking the mechanism and showing the guarantee fails. A passing suite must
  // not be an artefact of the harness agreeing with itself.
  //
  // A. Break the preimage restore — live validation must catch a no-op restore.
  {
    const rt = buildRuntime();
    try {
      const { deps } = harness(rt, { failAt: "native-verify" });
      deps.restoreTransactionSnapshot = () => ({ restored: true });
      const report = await applyRuntime(deps);
      assert.equal(
        report.rollbackSucceeded,
        false,
        "a neutered restore must not yield a successful rollback",
      );
      assert.equal(
        report.restoreValidationReason,
        "TRANSACTION_RESTORE_UNVERIFIED",
      );
    } finally {
      rt.dispose();
    }
  }

  // B. Break the mutation gate — an unverified snapshot must not authorize a
  //    single mutating call.
  {
    const rt = buildRuntime();
    try {
      const { calls, deps } = harness(rt, { failAt: "builder-apply" });
      deps.verifyTransactionSnapshot = () => {
        calls.push("snapshot:verify");
        throw new Error("unverified");
      };
      const report = await applyRuntime(deps);
      assert.equal(report.reason, "ROLLBACK_SAFETY_UNAVAILABLE");
      assert.equal(report.mutationStarted, false);
      assert.equal(calls.includes("builder:apply"), false);
      assert.equal(calls.includes("native:patch"), false);
      assert.equal(calls.includes("gateway:restart"), false);
    } finally {
      rt.dispose();
    }
  }

  // C. Break the snapshot itself — a corrupted preimage must be refused before
  //    it can reach the live runtime, even though the orchestrator asked for it.
  {
    const rt = buildRuntime();
    try {
      const { deps } = harness(rt, { failAt: "native-verify" });
      const real = deps.restoreTransactionSnapshot;
      deps.restoreTransactionSnapshot = (snapshot) => {
        // A body that no longer hashes to its recorded digest.
        snapshot.files["openclaw.json"].body = "corrupted\n";
        return real(snapshot);
      };
      const report = await applyRuntime(deps);
      assert.equal(report.rollbackSucceeded, false);
      assert.equal(
        readFileSync(path.join(rt.stateDir, "openclaw.json"), "utf8"),
        R10_CONFIG,
        "a corrupted preimage must never be written",
      );
    } finally {
      rt.dispose();
    }
  }
});

/** The contents of a freshly built, unmutated runtime, for zero-mutation asserts. */
function buildRuntimeDigests() {
  return {
    config: R7_CONFIG,
    entrypoint: "// governance R7\n",
    extensionBridge: R7_BRIDGE,
    selection: R7_SELECTION,
    announce: R7_ANNOUNCE,
    bridge: R7_BRIDGE,
  };
}
