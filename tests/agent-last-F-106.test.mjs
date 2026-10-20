// M12/T9 F-106 - the apply must not mutate a surface the transaction preimage
// does not cover, and must not delete anything the preimage cannot recreate.
//
// The row (F-106) records two defects that share one cause: the transaction
// preimage is not the pre-apply state.
//
//   1. The builder's apply branch writes five files the preimage never
//      recorded: the password-store resolver, the Gemini stream hotfix
//      utility, the two auth plans and the systemd drop-in. The drop-in lives
//      in a THIRD root (~/.config/systemd/user), outside both the state
//      directory and the OpenClaw runtime root, so the two-root preimage
//      could not hold it at all.
//
//      The consequence was a licensed lie: a failed apply reported
//      `rollbackSucceeded: true` while the resolver, the hotfix, the plans
//      and the unit drop-in stayed at the NEW revision, because the rollback
//      compared only the bytes it had captured.
//
//   2. The quarantine prune deleted `backups/r12/quarantined-t2` outright. That
//      tree is deliberately never a transaction target (it stays historical
//      recovery evidence), so no preimage could ever recreate it, and the
//      delete destroyed unique evidence for good.
//
// The gate is the behaviour, not the list: every path the apply can write must
// lie inside the preimage and byte-match after a restore, and an apply stage
// must never delete anything the preimage cannot recreate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
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
import { nativePatchedRuntimeRelatives } from "../integrations/openclaw/topology/lib/native-patch.mjs";
import {
  createTransactionSnapshot,
  preimageRecreates,
  pruneTransactionPath,
  restoreTransactionSnapshot,
  verifyLiveRestore,
  verifyTransactionSnapshot,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// The service the operator driver governs, and the drop-in the builder writes
// into the THIRD root.
const SERVICE = "openclaw-gateway-zink.service";
const DROP_IN = `${SERVICE}.d/10-zink.conf`;

// Every file the builder's apply branch writes inside the state directory.
const STATE_WRITES = Object.freeze({
  "zink-auth-secret-plan.json": '{"targets":[]}\n',
  "zink-auth-order-plan.json": '{"order":[]}\n',
  "bin/openclaw-pass-resolver": "#!/bin/sh\n# resolver\n",
  "bin/openclaw-gemini-stream-hotfix.mjs": "// hotfix\n",
});

/**
 * A runtime shaped like the live one: the state directory, the OpenClaw
 * runtime root, and the systemd user directory the unit drop-in lives in.
 */
function buildRuntime() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-f106-rt-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "openclaw");
  const systemdRoot = path.join(root, ".config", "systemd", "user");
  const extension = path.join(stateDir, "extensions", "zink-governance");
  mkdirSync(extension, { recursive: true });
  mkdirSync(path.join(stateDir, "bin"), { recursive: true });
  mkdirSync(path.join(runtimeRoot, "dist"), { recursive: true });
  mkdirSync(path.join(systemdRoot, `${SERVICE}.d`), { recursive: true });

  writeFileSync(path.join(stateDir, "openclaw.json"), '{"revision":"R7"}\n');
  writeFileSync(path.join(extension, "index.mjs"), "// governance R7\n");
  for (const relative of nativePatchedRuntimeRelatives())
    writeFileSync(path.join(runtimeRoot, relative), `// ${relative}\n`);
  for (const [relative, body] of Object.entries(STATE_WRITES))
    writeFileSync(path.join(stateDir, relative), body);
  writeFileSync(path.join(systemdRoot, DROP_IN), "[Service]\nMemoryMax=768M\n");

  // The legacy r12 quarantine: unique historical evidence that no preimage
  // can recreate, and the tree the apply used to delete outright.
  const quarantine = path.join(
    stateDir,
    "operator",
    "m7-t2",
    "backups",
    "r12",
    "quarantined-t2",
  );
  mkdirSync(quarantine, { recursive: true });
  writeFileSync(path.join(quarantine, "index.mjs"), "// quarantined R5\n");

  return {
    root,
    stateDir,
    runtimeRoot,
    systemdRoot,
    extension,
    quarantine,
    dropIn: path.join(systemdRoot, DROP_IN),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * The orchestration harness. Every effect is injected, so the case never
 * touches WSL, systemd or a live OpenClaw process.
 */
function harness(rt, { failAt = null, liveMutation = null } = {}) {
  const calls = [];
  let restarted = false;
  return {
    calls,
    deps: {
      expectedNativePostImage: () => [],
      readIdentifiers: () => ({ guildId: "1" }),
      runBuilder: (mode) => {
        calls.push(`builder:${mode.replace(/^--/u, "")}`);
        if (failAt === `builder-${mode.replace(/^--/u, "")}`)
          throw new Error("Policy drift");
      },
      createTransactionSnapshot: () => {
        calls.push("snapshot:create");
        return createTransactionSnapshot({
          stateDir: rt.stateDir,
          runtimeRoot: rt.runtimeRoot,
          systemdRoot: rt.systemdRoot,
        });
      },
      verifyTransactionSnapshot: (snapshot) => {
        calls.push("snapshot:verify");
        return verifyTransactionSnapshot(snapshot);
      },
      findOrphanedTransaction: () => [],
      persistTransactionSnapshot: (snapshot) => ({
        ...snapshot,
        attemptId: "txn-f106",
        snapshot,
      }),
      markTransactionComplete: () => {
        calls.push("snapshot:complete");
      },
      pruneQuarantine: (snapshot) => {
        calls.push("prune:quarantine");
        // The LIVE wiring is in operator-apply.mjs; this stub only proves the
        // orchestration hands the preimage to the stage that deletes.
        if (snapshot) calls.push("prune:quarantine:preimage");
      },
      pruneStaleNativeBackup: () => {
        calls.push("prune:native");
        if (failAt === "native-backup-prune") throw new Error("EACCES");
      },
      applyNativePatch: () => {
        calls.push("native:patch");
        if (liveMutation) liveMutation(rt);
        if (failAt === "native-patch") throw new Error("NATIVE_SOURCE_DRIFT");
      },
      checkNativePatch: () => {
        calls.push("native:verify");
        if (failAt === "native-verify")
          throw new Error("NATIVE_PATCH_INCOMPLETE");
      },
      restartScopedGateway: () => {
        const first = !restarted;
        restarted = true;
        calls.push("gateway:restart");
        if (first && failAt === "gateway-restart")
          throw new Error("GATEWAY_NOT_ACTIVE");
      },
      restoreTransactionSnapshot: (snapshot) => {
        calls.push("rollback:restore");
        verifyTransactionSnapshot(snapshot);
        return restoreTransactionSnapshot(snapshot);
      },
      verifyLiveRestore: (snapshot, options) => {
        if (options?.postApply) {
          calls.push("verify:applied");
          return verifyLiveRestore(rt, snapshot, options);
        }
        calls.push("rollback:validate");
        return verifyLiveRestore(rt, snapshot);
      },
      classifyReason: (error) => String(error?.message ?? error),
    },
  };
}

// ---------------------------------------------------------------------------
// 1 - the preimage covers every path the apply can write
// ---------------------------------------------------------------------------

test("F-106 1: the preimage covers every file the builder's apply writes", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot({
      stateDir: rt.stateDir,
      runtimeRoot: rt.runtimeRoot,
      systemdRoot: rt.systemdRoot,
    });
    for (const [relative, body] of Object.entries(STATE_WRITES)) {
      assert.ok(
        Object.hasOwn(snapshot.files, relative),
        `${relative} is written by the apply and must be inside the preimage`,
      );
      assert.equal(snapshot.files[relative].sha256, sha256(body));
      assert.equal(snapshot.files[relative].existed, true);
    }
    // The unit drop-in lives in a THIRD root, outside the state directory and
    // outside the runtime root.
    assert.ok(
      Object.hasOwn(snapshot.files, DROP_IN),
      "the systemd drop-in must be inside the preimage",
    );
    assert.equal(
      snapshot.files[DROP_IN].sha256,
      sha256(readFileSync(rt.dropIn)),
    );
    assert.equal(verifyTransactionSnapshot(snapshot).verified, true);
  } finally {
    rt.dispose();
  }
});

test("F-106 2: the drop-in is restored from the third root, byte for byte", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot({
      stateDir: rt.stateDir,
      runtimeRoot: rt.runtimeRoot,
      systemdRoot: rt.systemdRoot,
    });
    const before = readFileSync(rt.dropIn, "utf8");
    writeFileSync(rt.dropIn, "[Service]\nMemoryMax=4096M\n");
    // The mutation is visible to the verdict, because the path is tracked.
    const verdict = verifyLiveRestore(rt, snapshot);
    assert.equal(verdict.restored, false);
    assert.ok(
      verdict.mismatches.includes(DROP_IN),
      "the mutated drop-in must be named by the verdict",
    );
    restoreTransactionSnapshot(snapshot);
    assert.equal(readFileSync(rt.dropIn, "utf8"), before);
    assert.equal(verifyLiveRestore(rt, snapshot).restored, true);
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 2 - a failing apply restores the surfaces the preimage now covers
// ---------------------------------------------------------------------------

test("F-106 3: a failed apply restores the resolver, the hotfix and the drop-in", async () => {
  const rt = buildRuntime();
  try {
    const before = {
      resolver: readFileSync(
        path.join(rt.stateDir, "bin", "openclaw-pass-resolver"),
        "utf8",
      ),
      hotfix: readFileSync(
        path.join(rt.stateDir, "bin", "openclaw-gemini-stream-hotfix.mjs"),
        "utf8",
      ),
      dropIn: readFileSync(rt.dropIn, "utf8"),
    };
    const { deps } = harness(rt, {
      failAt: "native-verify",
      liveMutation: (target) => {
        writeFileSync(
          path.join(target.stateDir, "bin", "openclaw-pass-resolver"),
          "#!/bin/sh\n# resolver R10\n",
        );
        writeFileSync(
          path.join(
            target.stateDir,
            "bin",
            "openclaw-gemini-stream-hotfix.mjs",
          ),
          "// hotfix R10\n",
        );
        writeFileSync(target.dropIn, "[Service]\nMemoryMax=4096M\n");
      },
    });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.rollbackAttempted, true);
    assert.equal(
      report.rollbackSucceeded,
      true,
      report.rollbackReason ?? report.restoreValidationReason ?? "",
    );
    // The rollback restored every mutated surface, so the success is honest.
    assert.equal(
      readFileSync(
        path.join(rt.stateDir, "bin", "openclaw-pass-resolver"),
        "utf8",
      ),
      before.resolver,
    );
    assert.equal(
      readFileSync(
        path.join(rt.stateDir, "bin", "openclaw-gemini-stream-hotfix.mjs"),
        "utf8",
      ),
      before.hotfix,
    );
    assert.equal(readFileSync(rt.dropIn, "utf8"), before.dropIn);
  } finally {
    rt.dispose();
  }
});

test("F-106 4: a restore that leaves a tracked surface mutated is named, not licensed", async () => {
  const rt = buildRuntime();
  try {
    const { calls, deps } = harness(rt, {
      failAt: "native-verify",
      liveMutation: (target) => {
        writeFileSync(target.dropIn, "[Service]\nMemoryMax=4096M\n");
      },
    });
    // The restore helper returns, but the drop-in stays at the new revision -
    // exactly the false positive the row records.
    deps.restoreTransactionSnapshot = (snapshot) => {
      calls.push("rollback:restore");
      const partial = {
        ...snapshot,
        files: Object.fromEntries(
          Object.entries(snapshot.files).filter(
            ([relative]) => relative !== DROP_IN,
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
      report.restoreValidationReason,
      "TRANSACTION_RESTORE_UNVERIFIED",
    );
    assert.ok(
      report.restoreMismatches.includes(DROP_IN),
      "the unrestored drop-in must be named by the verdict",
    );
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 3 - no apply stage deletes what the preimage cannot recreate
// ---------------------------------------------------------------------------

test("F-106 5: the quarantine prune never deletes what the preimage cannot recreate", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot({
      stateDir: rt.stateDir,
      runtimeRoot: rt.runtimeRoot,
      systemdRoot: rt.systemdRoot,
    });
    // The legacy quarantine is not a transaction target, so the preimage
    // cannot recreate it.
    assert.equal(preimageRecreates(snapshot, rt.quarantine), false);
    const outcome = pruneTransactionPath(snapshot, rt.quarantine);
    assert.equal(outcome.deleted, false);
    assert.equal(outcome.reason, "TRANSACTION_PREIMAGE_CANNOT_RECREATE");
    assert.equal(
      existsSync(path.join(rt.quarantine, "index.mjs")),
      true,
      "the quarantined evidence must survive the prune",
    );
  } finally {
    rt.dispose();
  }
});

test("F-106 6: a path the preimage does cover is still prunable", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot({
      stateDir: rt.stateDir,
      runtimeRoot: rt.runtimeRoot,
      systemdRoot: rt.systemdRoot,
    });
    const plan = path.join(rt.stateDir, "zink-auth-order-plan.json");
    // A file the preimage recorded is recreatable, so the prune may delete it.
    assert.equal(preimageRecreates(snapshot, plan), true);
    const outcome = pruneTransactionPath(snapshot, plan);
    assert.equal(outcome.deleted, true);
    assert.equal(outcome.retained, null);
    assert.equal(existsSync(plan), false);
  } finally {
    rt.dispose();
  }
});

test("F-106 7: the operator's quarantine prune is wired to the guard", () => {
  // The live prune lives in operator-apply.mjs, which executes its apply on
  // import and therefore cannot be imported by a test. The wiring is pinned
  // statically instead: the quarantine prune must go through the guard, and
  // must not delete the tree on its own.
  const source = readFileSync(
    new URL(
      "../integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const prune = source.slice(
    source.indexOf("pruneQuarantine("),
    source.indexOf("pruneStaleNativeBackup("),
  );
  assert.ok(
    prune.length > 0,
    "the operator must still declare a quarantine prune",
  );
  assert.ok(
    prune.includes("pruneTransactionPath("),
    "the quarantine prune must delete through the preimage guard",
  );
  assert.equal(
    /rmSync\(/.test(prune),
    false,
    "the quarantine prune must not delete the tree on its own",
  );
});
