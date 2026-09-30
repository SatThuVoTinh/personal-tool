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
  content: HEARTBEAT,
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

test("G1: the sentinel alone does not exempt a run that carries a mention", async () => {
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, {
        ...heartbeatRun("hb-with-mention"),
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

test("G3: before_prompt_build fails closed for an unresolvable governed run", async () => {
  await withPlugin(async ({ hooks }) => {
    await assert.rejects(
      hooks.get("before_prompt_build")(
        {},
        {
          agentId: "main",
          sessionKey: "agent:main:main",
          runId: "unresolved-governed-run",
          content: "please do the work",
        },
      ),
      (error) => {
        // Fail closed with the contract reason code, not a degraded context.
        assert.equal(error.message, "EXECUTION_STATE_UNKNOWN");
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
// DS — PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION.
//
// The R7 defect: rollback was gated on `if (identifiers)`, which is assigned
// BEFORE the builder runs. A preflight failure therefore satisfied the gate and
// ran restoreNativePatch + restoreT1RuntimeFiles + restartScopedGateway, which
// destroyed a working runtime on 2026-09-30.
// ---------------------------------------------------------------------------

/** A recording dependency set. `failAt` names the stage that throws. */
function applyDeps(failAt, overrides = {}) {
  const calls = [];
  const step = (stage, value) => {
    calls.push(stage);
    if (failAt === stage) throw new Error(`synthetic failure at ${stage}`);
    return typeof value === "function" ? value() : value;
  };
  const deps = {
    calls,
    readIdentifiers: () => step("readIdentifiers", "synthetic-identifiers"),
    runBuilder(mode) {
      calls.push(`runBuilder:${mode}`);
      if (failAt === `runBuilder:${mode}`) throw new Error(`drift at ${mode}`);
    },
    pruneQuarantine: () => step("pruneQuarantine"),
    pruneStaleNativeBackup: () => step("pruneStaleNativeBackup"),
    applyNativePatch: () => step("applyNativePatch"),
    checkNativePatch: () => step("checkNativePatch"),
    restoreNativePatch: () => step("restoreNativePatch"),
    restoreT1RuntimeFiles: async () => step("restoreT1RuntimeFiles"),
    restartScopedGateway: () => step("restartScopedGateway"),
    validateConfig: () => step("validateConfig"),
    classifyReason: (error) => String(error?.message ?? error),
  };
  for (const [key, value] of Object.entries(overrides)) deps[key] = value;
  return deps;
}

const RESTORE_CALLS = ["restoreNativePatch", "restoreT1RuntimeFiles"];
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
    restoreT1RuntimeFiles: () => {
      deps.calls.push("restoreT1RuntimeFiles");
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
  for (const call of RESTORE_CALLS) {
    assert.equal(deps.calls.includes(call), false, `${call} must not run`);
  }
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
