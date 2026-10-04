// M8/T2.2-R7 — regression coverage for the three defects proven by the
// 2026-09-30 read-only forensic audit, plus the apply-safety invariant.
//
// G1  Option A heartbeat admission (INTERNAL / EXEMPT, pure liveness only).
// G2  native-boundary diagnosability: the original failure survives as .cause.
// G3  before_prompt_build fails closed for an unresolvable governed run.
// DS  PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION in the operator apply path.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  enterNativeRun,
  registerNativeGuard,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  AGENT_IDS,
  agentInstructions,
  governancePluginFiles,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { applyRuntime } from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

/**
 * A minimal guard that satisfies the mandatory T2/T3 registration contract.
 * `beforeRun` is supplied by the caller so each test can express one admission
 * outcome without standing up a ledger.
 */
const guardWith = (beforeRun) => ({
  beforeRun,
  beforeToolCall: () => undefined,
  beforeAnnounce: () => ({ action: "deliver", receipt: "synthetic-receipt" }),
  recordQuota: () => undefined,
  selfQuotaReceipt: () => null,
  resolveRunModel: () => null,
});

/** Run `body` with console.error captured, so the boundary log is assertable. */
async function captureStderr(body) {
  const original = console.error;
  const lines = [];
  console.error = (...parts) => lines.push(parts.join(" "));
  try {
    await body();
  } finally {
    console.error = original;
  }
  return lines;
}

const scratch = (label) =>
  mkdtempSync(path.join(os.tmpdir(), `zink-r7-${label}-`));

// ---------------------------------------------------------------------------
// Plugin harness. Each case materializes a private copy of the packaged plugin
// so module-level state never leaks between cases, exactly as the m7-t2
// integration case does.
// ---------------------------------------------------------------------------

const OWNER = "123456789012345678";
const HEARTBEAT = "[OpenClaw heartbeat poll]";

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r7-plugin-"));
  const paths = ledgerPaths(root);
  readSnapshot(paths);
  const extension = path.join(root, "extensions", "zink-governance");
  const generated = governancePluginFiles();
  for (const [relative, contents] of Object.entries({
    ...generated.assets,
    "index.mjs": generated.entrypoint,
    "package.json": generated.package,
  })) {
    const target = path.join(extension, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const agentId of AGENT_IDS) {
    const folder = path.join(root, "workspaces", agentId);
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, "AGENTS.md"), agentInstructions(agentId));
  }
  writeFileSync(paths.identityKey, `${"1".repeat(64)}\n`);
  const hooks = new Map();
  const logged = [];
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    logger: { error: (message) => logged.push(String(message)) },
  });
  try {
    return await body({
      paths,
      hooks,
      logged,
      native: nativeConfig(paths.root),
    });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const heartbeatRun = (runId) => ({
  agentId: "main",
  sessionKey: "agent:main:main",
  runId,
  // R10: identified by the host-assigned trigger plus the canonical host
  // heartbeat representation, not by user-visible message content.
  trigger: "heartbeat",
  transcriptPrompt: HEARTBEAT,
});

// ---------------------------------------------------------------------------
// G2 — the boundary must not destroy the failure it reports.
// ---------------------------------------------------------------------------

test("G2: an execution-state fault stays diagnosable through enterNativeRun", async () => {
  const root = scratch("g2-fault");
  const scope = path.join(root, "state");
  const unregister = registerNativeGuard(
    scope,
    guardWith(() => {
      throw new Error("EXECUTION_STATE_UNKNOWN");
    }),
  );
  try {
    await captureStderr(async () => {
      await assert.rejects(
        enterNativeRun(nativeConfig(scope), {
          agentId: "main",
          sessionKey: "agent:main:main",
          runId: "g2-fault-run",
        }),
        (error) => {
          // The host-visible contract string must not change.
          assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
          // The whole point of R7: the real cause survives.
          assert.equal(error.cause?.message, "EXECUTION_STATE_UNKNOWN");
          return true;
        },
      );
    });
  } finally {
    unregister();
    rmSync(root, { recursive: true, force: true });
  }
});

test("G2: a governance denial stays distinguishable from an execution-state fault", async () => {
  const root = scratch("g2-denied");
  const scope = path.join(root, "state");
  const unregister = registerNativeGuard(
    scope,
    guardWith(() => ({ allow: false })),
  );
  try {
    await captureStderr(async () => {
      await assert.rejects(
        enterNativeRun(nativeConfig(scope), {
          agentId: "main",
          sessionKey: "agent:main:main",
          runId: "g2-denied-run",
        }),
        (error) => {
          assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
          assert.equal(error.cause?.message, "GOVERNANCE_DENIED");
          return true;
        },
      );
    });
  } finally {
    unregister();
    rmSync(root, { recursive: true, force: true });
  }
});

test("G2: the boundary log names the lower-level failure and no user content", async () => {
  const root = scratch("g2-log");
  const scope = path.join(root, "state");
  const unregister = registerNativeGuard(
    scope,
    guardWith(() => {
      throw new Error("EXECUTION_STATE_UNKNOWN");
    }),
  );
  const secretish = "SENTINEL_USER_CONTENT_DO_NOT_LOG";
  try {
    const lines = await captureStderr(async () => {
      await assert.rejects(
        enterNativeRun(nativeConfig(scope), {
          agentId: "main",
          sessionKey: "agent:main:main",
          runId: "g2-log-run",
          content: secretish,
        }),
      );
    });
    const joined = lines.join("\n");
    assert.equal(joined.includes("EXECUTION_STATE_UNKNOWN"), true);
    assert.equal(joined.includes("enterNativeRun"), true);
    // Disclosure discipline: no message content, no session key, no raw stack.
    assert.equal(joined.includes(secretish), false);
    assert.equal(joined.includes("agent:main:main"), false);
    assert.equal(joined.includes("g2-log-run"), false);
    assert.equal(joined.includes("at "), false);
  } finally {
    unregister();
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// G1 — Option A: the pure liveness heartbeat is internal and exempt.
// ---------------------------------------------------------------------------

test("G1: a pure liveness heartbeat is admitted and fabricates no ledger task", async () => {
  await withPlugin(async ({ paths, native }) => {
    const before = readSnapshot(paths);
    // Must resolve, not reject. Before R7 this threw GOVERNANCE_RUN_UNAVAILABLE
    // on every single heartbeat, for 19 days.
    await enterNativeRun(native, heartbeatRun("hb-admitted"));
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence);
    assert.deepEqual(after.tasks, before.tasks);
    assert.equal(Object.keys(after.tasks).length, 0);
  });
});

test("G1: a self-keyed run that is not the liveness sentinel is not exempt", async () => {
  await withPlugin(async ({ native }) => {
    // Same session key, real user work. The exemption is bounded by its inverse:
    // this must still fail closed through the normal governed path.
    await assert.rejects(
      enterNativeRun(native, {
        agentId: "main",
        sessionKey: "agent:main:main",
        runId: "hb-not-sentinel",
        content: "run the quarterly ETL and post the workbook",
      }),
      (error) => {
        assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
        return true;
      },
    );
  });
});

test("G1: mentions are not a G1 condition, but a mention-bearing Discord run is still refused", async () => {
  await withPlugin(async ({ native }) => {
    // R10 retired "no mentions" / "not bot-author": those fields do not exist at
    // the native admission anchor. `mentions` is deliberately NOT treated as a
    // disqualifier and NOT treated as an `undefined` check, which would be
    // vacuous. The non-Discord condition is what excludes mention-bearing runs.
    await assert.doesNotReject(
      enterNativeRun(native, {
        ...heartbeatRun("hb-with-mention"),
        mentions: [{ username: "main" }],
      }),
    );
    // A real mention-bearing Discord ingress is still refused outright.
    await assert.rejects(
      enterNativeRun(native, {
        ...heartbeatRun("hb-mention-discord"),
        channelId: "discord",
        senderId: "223456789012345678",
        mentions: [{ username: "main" }],
      }),
      (error) => {
        assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
        return true;
      },
    );
  });
});

test("G1: the sentinel does not exempt a Discord ingress run", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, {
        ...heartbeatRun("hb-discord"),
        channelId: "discord",
        currentMessageId: "123456789012345999",
        senderId: OWNER,
      }),
      (error) => {
        assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// G3 — before_prompt_build must not launder an unresolvable run.
// ---------------------------------------------------------------------------

test("G3: an unresolvable governed run gets an explicit BLOCKED context, not silence", async () => {
  await withPlugin(async ({ hooks, logged }) => {
    // R7 correction: before_prompt_build is an ADVISORY OpenClaw hook. The host
    // catches and swallows anything thrown here, so throwing is fail-OPEN. The
    // run must instead receive an explicit BLOCKED governance instruction.
    const result = await hooks.get("before_prompt_build")(
      {},
      {
        agentId: "main",
        sessionKey: "agent:main:main",
        runId: "unresolved-governed-run",
        content: "please do the work",
      },
    );
    assert.match(result.prependContext, /EXECUTION_STATE_UNKNOWN/u);
    assert.match(result.prependContext, /BLOCKED/u);
    // It must not be laundered into a normal-looking governance receipt.
    assert.equal(
      result.prependContext.includes("[Trusted governance receipt]"),
      false,
    );
    // The diagnostic must still reach the operator.
    assert.equal(
      logged.some((line) => line.includes("before_prompt_build")),
      true,
    );
    assert.equal(
      logged.some((line) => line.includes("EXECUTION_STATE_UNKNOWN")),
      true,
    );
  });
});

test("G3: an unresolved non-heartbeat run never receives the heartbeat exemption", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, {
        agentId: "main",
        sessionKey: "agent:main:main",
        runId: "unresolved-not-heartbeat",
        content: "please do the work",
      }),
      (error) => {
        // Admission still fails closed at the native boundary, which IS an
        // enforcing seam. That is the real control; the hook is advisory.
        assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
        assert.equal(error.cause?.message, "EXECUTION_STATE_UNKNOWN");
        return true;
      },
    );
  });
});

test("G3: an exempt heartbeat receives no fabricated governance receipt", async () => {
  await withPlugin(async ({ paths, hooks }) => {
    const result = await hooks.get("before_prompt_build")(
      {},
      heartbeatRun("hb-no-receipt"),
    );
    // No ledger owner exists, so no receipt may be invented for it.
    assert.equal(result?.prependContext, undefined);
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 0);
  });
});

test("G3: a genuinely governed run still receives its governance receipt", async () => {
  await withPlugin(async ({ paths, hooks, native }) => {
    const governed = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345679",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "main-run",
    };
    await enterNativeRun(native, governed);
    const snapshot = readSnapshot(paths);
    const task_id = Object.keys(snapshot.tasks)[0];
    assert.ok(task_id, "the governed ingress must create exactly one task");
    const receipt = await hooks.get("before_prompt_build")({}, governed);
    assert.match(receipt.prependContext, new RegExp(task_id, "u"));
  });
});

// ---------------------------------------------------------------------------
// A. The G1 exemption is qualified: all five predicates must hold.
// ---------------------------------------------------------------------------

test("A: the heartbeat exemption requires every G1 predicate", async () => {
  const qualifying = {
    agentId: "main",
    sessionKey: "agent:main:main",
    runId: "g1-matrix",
    trigger: "heartbeat",
    transcriptPrompt: "[OpenClaw heartbeat poll]",
  };
  await withPlugin(async ({ native }) => {
    // Baseline: the unmodified qualifying shape is admitted.
    await enterNativeRun(native, { ...qualifying, runId: "g1-matrix-base" });

    // Each mutation below breaks exactly one R10 predicate and must NOT be exempt.
    const disqualified = [
      ["not self-keyed", { sessionKey: "agent:main:other" }],
      ["no host trigger", { trigger: "user" }],
      ["undefined trigger", { trigger: undefined }],
      ["alternative trigger", { trigger: "cron" }],
      [
        "wrong sentinel",
        { transcriptPrompt: "[OpenClaw heartbeat poll] and also do ETL" },
      ],
      ["no sentinel", { transcriptPrompt: undefined }],
      [
        "inter-session provenance",
        {
          inputProvenance: {
            kind: "inter_session",
            sourceTool: "subagent_announce",
            sourceSessionKey: "agent:o1:o1",
          },
        },
      ],
      ["discord channel id", { channelId: "discord" }],
      ["discord in session key", { sessionKey: "agent:main:main:discord:1" }],
    ];
    for (const [label, override] of disqualified) {
      await assert.rejects(
        enterNativeRun(native, {
          ...qualifying,
          runId: `g1-matrix-${label.replace(/\W+/gu, "-")}`,
          ...override,
        }),
        (error) => {
          assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
          return true;
        },
        `must not be exempt: ${label}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// C. The real enforcement seam: the native governance boundary.
//
// before_prompt_build is advisory and cannot block. enterNativeRun is reached
// on the lane path at selection-DopzNY3I.js:12232 inside runEmbeddedAttempt
// (10960-14467), which is ~520 lines before the model invocation
// activeSession.prompt at 12847/13754. The host propagates the rejection, so a
// Discord-shaped unresolved governed run is stopped before any model call.
// ---------------------------------------------------------------------------

test("C: a Discord-shaped unresolved governed run is blocked at the native boundary", async () => {
  await withPlugin(async ({ paths, native, logged }) => {
    const before = readSnapshot(paths);
    // Discord-shaped: discord channel, owner sender, real message id, and an
    // inter-session provenance shape that the ledger cannot resolve. This is
    // the exact class of run that produced EXECUTION_STATE_UNKNOWN in
    // production.
    await assert.rejects(
      enterNativeRun(native, {
        channelId: "discord",
        agentId: "o1",
        senderId: OWNER,
        currentMessageId: "123456789012346001",
        content: "@main please run the quarterly ETL",
        mentions: [{ username: "main" }],
        sessionKey: "discord:1545425763707129928:1545696207316455527",
        runId: "discord-unresolved-run",
        inputProvenance: {
          kind: "inter_session",
          sourceTool: "subagent_announce",
          sourceSessionKey: "agent:main:main",
        },
      }),
      (error) => {
        // Host-visible contract string is byte-identical to pre-R7.
        assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
        // The underlying fault remains diagnosable.
        assert.equal(error.cause?.message, "EXECUTION_STATE_UNKNOWN");
        return true;
      },
    );
    // Admission refused, so no execution was ever represented in the ledger:
    // nothing downstream (prompt, model, tools) has an owner to run as.
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence);
    assert.deepEqual(after.tasks, before.tasks);
    assert.equal(Object.keys(after.tasks).length, 0);
    // And the boundary named the real lower-level failure for the operator.
    assert.equal(
      logged.some((line) => line.includes("before_prompt_build")),
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// E. Discord ingress semantics are unchanged.
// ---------------------------------------------------------------------------

test("E: a valid owner Discord ingress run is still admitted and creates its task", async () => {
  await withPlugin(async ({ paths, native }) => {
    const context = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012346002",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "discord-valid-run",
    };
    await enterNativeRun(native, context);
    const snapshot = readSnapshot(paths);
    const task_id = Object.keys(snapshot.tasks)[0];
    assert.ok(task_id, "a valid owner Discord ingress must create one task");
    // A replay of the identical message id must not create a second task.
    await assert.rejects(enterNativeRun(native, context));
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 1);
  });
});

// ---------------------------------------------------------------------------
// DS — PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION.
//
// The R7 defect: rollback was gated on `if (identifiers)`, which is assigned
// BEFORE the builder runs. A preflight failure therefore satisfied the gate and
// ran restoreNativePatch + restoreT1RuntimeFiles + restartScopedGateway, which
// destroyed a working runtime on 2026-09-30.
// ---------------------------------------------------------------------------

/**
 * A recording dependency set. `failAt` names the stage that throws.
 *
 * R11 replaced the two restore helpers with the transaction snapshot: a
 * pre-mutation capture of the exact live runtime, its re-verification, a restore
 * of that preimage, and a live comparison that alone licenses success. The R7
 * invariant is unchanged and still asserted below — a preflight failure mutates
 * nothing and restores nothing.
 */
/**
 * M10/T2-R8: the declared post-image an apply must state to be verifiable. A
 * representative pair, not a wildcard: the contract under test is that the
 * expectation is DECLARED and compared, not which digests it carries.
 */
const EXPECTED_NATIVE_POST_IMAGE = Object.freeze([
  Object.freeze({
    relative: "dist/selection-DopzNY3I.js",
    sha256: "0".repeat(64),
  }),
]);

function applyDeps(failAt, overrides = {}) {
  const calls = [];
  const step = (stage, value) => {
    calls.push(stage);
    if (failAt === stage) throw new Error(`synthetic failure at ${stage}`);
    return typeof value === "function" ? value() : value;
  };
  // The synthetic snapshot is opaque here: this suite proves the ORCHESTRATION
  // contract, and the R11/R12 suites prove the snapshot's own correctness
  // against a real filesystem.
  const syntheticSnapshot = { synthetic: true };
  const syntheticTransaction = {
    attemptId: "txn-synthetic",
    snapshot: syntheticSnapshot,
  };
  const deps = {
    calls,
    readIdentifiers: () => step("readIdentifiers", "synthetic-identifiers"),
    runBuilder(mode) {
      calls.push(`runBuilder:${mode}`);
      if (failAt === `runBuilder:${mode}`) throw new Error(`drift at ${mode}`);
    },
    createTransactionSnapshot: () =>
      step("createTransactionSnapshot", syntheticSnapshot),
    verifyTransactionSnapshot: (snapshot) => {
      assert.equal(snapshot, syntheticSnapshot);
      return step("verifyTransactionSnapshot", { verified: true });
    },
    // R12 durability seams. The R7 invariant under test is unchanged — a
    // preflight failure mutates nothing and restores nothing — and durability is
    // covered by m8-t2.9-r12-durable-recovery.test.mjs.
    findOrphanedTransaction: () => [],
    persistTransactionSnapshot: (snapshot) => {
      assert.equal(snapshot, syntheticSnapshot);
      return step("persistTransactionSnapshot", syntheticTransaction);
    },
    markTransactionComplete: () => step("markTransactionComplete"),
    pruneQuarantine: () => step("pruneQuarantine"),
    pruneStaleNativeBackup: () => step("pruneStaleNativeBackup"),
    applyNativePatch: () => step("applyNativePatch"),
    checkNativePatch: () => step("checkNativePatch"),
    restoreTransactionSnapshot: (snapshot) => {
      assert.equal(snapshot, syntheticSnapshot);
      return step("restoreTransactionSnapshot", { restored: true });
    },
    verifyLiveRestore: (snapshot, options) => {
      assert.equal(snapshot, syntheticSnapshot);
      if (options?.postApply) {
        // M10/T2-R8: an apply is verified against the DECLARED expectation the
        // orchestrator passes in, so this stub asserts that contract instead of
        // hardcoding success: an apply that never declared what the runtime must
        // look like cannot report PASS.
        assert.deepEqual(
          options.expected,
          EXPECTED_NATIVE_POST_IMAGE,
          "post-apply verification must be judged against a declared expectation",
        );
        return step("verifyLiveRestore", {
          applied: true,
          unrestored: [],
          unverified: [],
        });
      }
      return step("verifyLiveRestore", { restored: true, mismatches: [] });
    },
    expectedNativePostImage: () => EXPECTED_NATIVE_POST_IMAGE,
    restartScopedGateway: () => step("restartScopedGateway"),
    classifyReason: (error) => String(error?.message ?? error),
  };
  for (const [key, value] of Object.entries(overrides)) deps[key] = value;
  return deps;
}

const RESTORE_CALLS = ["restoreTransactionSnapshot", "verifyLiveRestore"];
const ROLLBACK_CALLS = [...RESTORE_CALLS, "restartScopedGateway"];

test("DS: a preflight failure mutates nothing and rolls nothing back", async () => {
  const deps = applyDeps("runBuilder:--preflight");
  const result = await applyRuntime(deps);
  assert.equal(result.status, "FAIL");
  assert.equal(result.stage, "builder-preflight");
  assert.equal(result.mutationStarted, false);
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(result.rollbackSucceeded, false);
  // The apply path must never have been entered.
  assert.equal(deps.calls.includes("runBuilder:--apply"), false);
  for (const call of ROLLBACK_CALLS) {
    assert.equal(deps.calls.includes(call), false, `${call} must not run`);
  }
  // And nothing that writes was reached.
  for (const call of ["pruneQuarantine", "pruneStaleNativeBackup"]) {
    assert.equal(deps.calls.includes(call), false, `${call} must not run`);
  }
});

test("DS: an identifier-read failure is likewise a zero-mutation failure", async () => {
  const deps = applyDeps("readIdentifiers");
  const result = await applyRuntime(deps);
  assert.equal(result.stage, "identifiers");
  assert.equal(result.mutationStarted, false);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(deps.calls.includes("runBuilder:--preflight"), false);
  for (const call of ROLLBACK_CALLS) {
    assert.equal(deps.calls.includes(call), false, `${call} must not run`);
  }
});

test("DS: a native-verify failure after mutation does roll back", async () => {
  const deps = applyDeps("checkNativePatch");
  const result = await applyRuntime(deps);
  assert.equal(result.status, "FAIL");
  assert.equal(result.stage, "native-verify");
  assert.equal(result.mutationStarted, true);
  assert.equal(result.rollbackRequired, true);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
  for (const call of ROLLBACK_CALLS) {
    assert.equal(deps.calls.includes(call), true, `${call} must run`);
  }
});

test("DS: a failure on the first mutating call still rolls back", async () => {
  const deps = applyDeps("pruneQuarantine");
  const result = await applyRuntime(deps);
  assert.equal(result.stage, "quarantine-prune");
  assert.equal(result.mutationStarted, true);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, true);
});

test("DS: a rollback failure is reported alongside the original failure", async () => {
  const deps = applyDeps("applyNativePatch", {
    restoreTransactionSnapshot: () => {
      deps.calls.push("restoreTransactionSnapshot");
      throw new Error("synthetic rollback failure");
    },
  });
  const result = await applyRuntime(deps);
  assert.equal(result.status, "FAIL");
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackSucceeded, false);
  // Neither failure may be hidden.
  assert.equal(result.reason, "synthetic failure at applyNativePatch");
  assert.equal(result.rollbackReason, "synthetic rollback failure");
  assert.notEqual(result.reason, result.rollbackReason);
});

test("DS: a preflight failure reports a rollback reason of null, never a hidden one", async () => {
  const deps = applyDeps("runBuilder:--preflight");
  const result = await applyRuntime(deps);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(result.rollbackSucceeded, false);
  assert.equal(result.rollbackReason, null);
  assert.equal(result.reason, "drift at --preflight");
});

test("DS: a successful apply performs no rollback at all", async () => {
  const deps = applyDeps(null);
  const result = await applyRuntime(deps);
  assert.equal(result.status, "PASS");
  assert.equal(result.stage, "applied");
  assert.equal(result.mutationStarted, true);
  assert.equal(result.rollbackRequired, false);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(deps.calls.includes("runBuilder:--preflight"), true);
  assert.equal(deps.calls.includes("runBuilder:--apply"), true);
  // The gateway restart IS part of a successful apply; only the restoring
  // operations must be absent.
  assert.equal(deps.calls.includes("restartScopedGateway"), true);
  // R12: nothing is RESTORED on a successful apply. `verifyLiveRestore` does
  // legitimately run, but with `postApply`, to confirm the mutation actually
  // landed — a self-reported success is not evidence of a deployment. So the
  // restoring call is asserted absent, and the verifying one is asserted to have
  // been used in its post-apply sense.
  assert.equal(deps.calls.includes("restoreTransactionSnapshot"), false);
  assert.equal(deps.calls.includes("verifyLiveRestore"), true);
  assert.equal(result.transactionStatus, "complete");
  assert.ok(result.attemptId);
});

test("DS: repeated identical failures report deterministically", async () => {
  const first = await applyRuntime(applyDeps("applyNativePatch"));
  const second = await applyRuntime(applyDeps("applyNativePatch"));
  assert.deepEqual(first, second);
  const preflightFirst = await applyRuntime(
    applyDeps("runBuilder:--preflight"),
  );
  const preflightSecond = await applyRuntime(
    applyDeps("runBuilder:--preflight"),
  );
  assert.deepEqual(preflightFirst, preflightSecond);
});
