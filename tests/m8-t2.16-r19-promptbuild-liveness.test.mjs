// M8/T2.2-R19 — the prompt-build seam's heartbeat exemption.
//
// R18 closed the run-end seam: `finishNativeRun` now receives the admission-time
// liveness discriminator, so `beforeRunEnd` classifies a heartbeat correctly. The
// live runtime proved it (`internal system session` 0 -> 2; self-keyed full
// governance stopped at 40).
//
// ONE seam remained broken: the third and last call site of
// `isPureLivenessHeartbeat`, the advisory `before_prompt_build` hook.
//
// PROVEN from the live runtime, not inferred. The host invokes that hook as
// `runBeforePromptBuild(promptEvent, params.hookCtx)`, and `hookCtx` is built from
// only runId/trace/agentId/sessionKey/sessionId/workspaceDir/modelProviderId/
// modelId/trigger plus channel and identity fields. It DOES carry `trigger` — the
// host itself gates its own heartbeat contribution on `hookCtx.trigger ===
// "heartbeat"` — but it carries NEITHER `transcriptPrompt` NOR `prompt`, because
// the liveness sentinel lives in the turn's transcript body, not in the run
// context. The predicate therefore could never match there even though admission
// had already accepted the SAME run. The hook fell through to a ledger lookup, a
// heartbeat has no ledger owner by design, and it emitted the fail-open
// `EXECUTION_STATE_UNKNOWN ... report BLOCKED` instruction — which is why every
// live poll replied `outcome_claim: BLOCKED`.
//
// The fix records the host-provided discriminator inside the plugin's OWN
// `beforeRun` guard — the callback the boundary invokes at admission, carrying
// the very fields the predicate already evaluates — and reads it back at the
// prompt-build seam. One predicate, one rule, no second copy of the liveness
// test. Line order in the patched runtime proves the record exists by then:
// `enterNativeRun` is injected at the top of the attempt and the host invokes
// `before_prompt_build` later in the same `runEmbeddedAttempt`, with the identical
// `params.runId` in both.
//
// These tests drive the REAL packaged extension through the REAL seams, and the
// negatives are asserted as hard as the positive: the store holds DATA, never a
// verdict, so nothing here can grant an exemption the predicate would not grant.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

import {
  enterNativeRun,
  finishNativeRun,
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRYPOINT_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "plugins",
  "zink-governance",
  "index.mjs",
);
const BOUNDARY_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-boundary.mjs",
);
const SENTINEL = "[OpenClaw heartbeat poll]";
const OWNER = "123456789012345678";

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

/**
 * The context the host builds at the PROMPT-BUILD seam, reproduced exactly as the
 * live runtime builds `hookCtx`: `trigger` present, and NEITHER `transcriptPrompt`
 * NOR `prompt`. Every positive below drives this shape, so none can pass by
 * accident through a field the real host never sends.
 */
const promptBuildContext = (runId, overrides = {}) => ({
  runId,
  trace: { span: "test" },
  agentId: "main",
  sessionKey: "agent:main:main",
  sessionId: "sess-1",
  workspaceDir: "/tmp/ws",
  modelProviderId: "google",
  modelId: "gemini-flash-latest",
  trigger: "heartbeat",
  ...overrides,
});

/** The context the pinned selection passes at ADMISSION, for a heartbeat. */
const admissionContext = (runId, overrides = {}) => ({
  agentId: "main",
  sessionKey: "agent:main:main",
  runId,
  inputProvenance: undefined,
  channelId: undefined,
  senderId: undefined,
  currentMessageId: undefined,
  trigger: "heartbeat",
  transcriptPrompt: SENTINEL,
  ...overrides,
});

/**
 * Materialize the REAL packaged extension into a temp tree, register the plugin,
 * and expose its hooks plus a live native-boundary config. This is the same
 * harness R10 uses, so these tests exercise the deployed code path, not a stub.
 */
async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r19-"));
  const paths = ledgerPaths(root);
  readSnapshot(paths);
  const extension = path.join(root, "extensions", "zink-governance");
  const generated = governancePluginFiles();
  for (const [rel, contents] of Object.entries({
    ...generated.assets,
    "index.mjs": generated.entrypoint,
    "package.json": generated.package,
  })) {
    const target = path.join(extension, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  for (const agentId of AGENT_IDS) {
    const dir = path.join(root, "workspaces", agentId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "AGENTS.md"), agentInstructions(agentId));
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
    logger: {
      error: (m) => logged.push(String(m)),
      warn: (m) => logged.push(String(m)),
      info: (m) => logged.push(String(m)),
      debug: () => {},
    },
  });
  try {
    return await body({
      paths,
      hooks,
      logged,
      native: nativeConfig(paths.root),
      promptBuild: (context) => hooks.get("before_prompt_build")({}, context),
    });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// 0. The defect, reproduced: the prompt-build context alone cannot be classified
// ---------------------------------------------------------------------------

test("R19 0: the prompt-build host context alone carries no sentinel", () => {
  const context = promptBuildContext("r19-0");
  // This is the defect in one assertion: the seam's own context has `trigger`
  // but not the sentinel, so the predicate needs the admission-time value.
  assert.equal(context.trigger, "heartbeat");
  assert.equal("transcriptPrompt" in context, false);
  assert.equal("prompt" in context, false);
  // The native patch is unchanged, so the injected field set is unchanged too.
  const patcher = readFileSync(
    path.join(
      REPO,
      "integrations",
      "openclaw",
      "topology",
      "lib",
      "native-patch.mjs",
    ),
    "utf8",
  );
  assert.ok(
    patcher.includes(
      "trigger: params.trigger, transcriptPrompt: params.transcriptPrompt",
    ),
    "admission still receives both discriminator fields from the pinned runtime",
  );
});

// ---------------------------------------------------------------------------
// A / B / C — the heartbeat is recognised, needs no owner, is not BLOCKED
// ---------------------------------------------------------------------------

test("R19 A/B: a heartbeat admitted then prompt-built gets NO governance receipt", async () => {
  await withPlugin(async ({ native, promptBuild, logged }) => {
    const runId = "r19-ab";
    // Admission: the pinned selection's injection. The guard records the
    // discriminator here.
    await enterNativeRun(native, admissionContext(runId));
    // Prompt build: the host context, which omits the sentinel.
    const receipt = await promptBuild(promptBuildContext(runId));
    assert.deepEqual(
      receipt,
      {},
      "an exempt heartbeat gets no fabricated receipt and no BLOCKED instruction",
    );
    // Nothing was logged as an unresolvable execution state.
    assert.equal(
      logged.some((line) => line.includes("before_prompt_build")),
      false,
      "the advisory hook must not report an execution-state failure for a heartbeat",
    );
  });
});

test("R19 B: no ledger owner is required or created for the heartbeat", async () => {
  await withPlugin(async ({ paths, native, promptBuild }) => {
    const runId = "r19-b";
    await enterNativeRun(native, admissionContext(runId));
    const receipt = await promptBuild(promptBuildContext(runId));
    assert.deepEqual(receipt, {}, "no receipt is built for a heartbeat");
    // The ledger remains empty: a heartbeat is not a governed task.
    const snapshot = readSnapshot(paths);
    assert.equal(
      Object.keys(snapshot.tasks).length,
      0,
      "a heartbeat must never create a ledger task",
    );
  });
});

test("R19 C: the BLOCKED instruction is still produced for a genuine unknown", async () => {
  await withPlugin(async ({ promptBuild, logged }) => {
    // A run that was never admitted (no record) and is not self-keyed: exactly
    // the pre-existing behaviour, which must be preserved.
    const receipt = await promptBuild(
      promptBuildContext("r19-c-never-admitted", {
        sessionKey: "agent:main:discord:channel:123",
      }),
    );
    assert.match(
      receipt.prependContext,
      /EXECUTION_STATE_UNKNOWN/u,
      "an unresolvable run must still be told to report BLOCKED",
    );
    assert.ok(
      logged.some((line) => line.includes("before_prompt_build")),
      "and it must still be logged",
    );
  });
});

test("R19 C2: the exemption is decided before the ledger lookup", () => {
  const source = readFileSync(ENTRYPOINT_PATH, "utf8");
  const hookAt = source.indexOf('api.on("before_prompt_build"');
  assert.notEqual(hookAt, -1);
  const exemptionAt = source.indexOf(
    "if (isLivenessHeartbeat(context)) return {};",
    hookAt,
  );
  const lookupAt = source.indexOf("findSession(", hookAt);
  assert.notEqual(exemptionAt, -1, "the prompt-build exemption must exist");
  assert.notEqual(lookupAt, -1);
  assert.ok(
    exemptionAt < lookupAt,
    "the exemption must precede the ledger lookup, or a heartbeat still reaches " +
      "the unresolvable-owner branch and is reported BLOCKED",
  );
});

// ---------------------------------------------------------------------------
// D / E / F — nothing else gains an exemption
// ---------------------------------------------------------------------------

test("R19 D: an ordinary non-heartbeat run still requires governance", async () => {
  await withPlugin(async ({ native, promptBuild }) => {
    const governed = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345911",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "discord-r19-d",
    };
    await enterNativeRun(native, governed);
    // The Discord ingress creates a real task and the hook builds its receipt.
    const receipt = await promptBuild(
      promptBuildContext(governed.runId, {
        agentId: "main",
        sessionKey: "main-session",
        trigger: "user",
      }),
    );
    assert.match(
      receipt.prependContext,
      /Trusted governance receipt/u,
      "an ordinary governed run must still receive its governance receipt",
    );
  });
});

test("R19 E: ambiguous or malformed events get no exemption", async () => {
  await withPlugin(async ({ native, promptBuild }) => {
    const runId = "r19-e";
    await enterNativeRun(native, admissionContext(runId));
    const nearMisses = {
      "wrong trigger": { trigger: "user" },
      "no trigger": { trigger: undefined },
      "not self-keyed": { sessionKey: "agent:main:other" },
      "discord session key": { sessionKey: "agent:main:discord:channel:123" },
      "discord channel marker": { channelId: "discord" },
      "discord provider marker": { messageProvider: "discord" },
      "missing agentId": { agentId: undefined },
      "missing sessionKey": { sessionKey: undefined },
    };
    for (const [label, override] of Object.entries(nearMisses)) {
      const receipt = await promptBuild(promptBuildContext(runId, override));
      assert.notDeepEqual(receipt, {}, `${label} must not be exempted`);
      assert.match(
        receipt.prependContext,
        /EXECUTION_STATE_UNKNOWN/u,
        `${label} must stay governed`,
      );
    }
  });
});

test("R19 F: a user turn carrying the exact sentinel cannot spoof an exemption", async () => {
  await withPlugin(async ({ native, promptBuild }) => {
    // The strongest spoof available: the message body IS the sentinel. The host
    // assigns `trigger` from `opts.isHeartbeat`, which a user cannot influence,
    // so admission records `trigger: "user"` and nothing is exempted.
    const spoof = {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345922",
      content: SENTINEL,
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: "discord-r19-f",
      trigger: "user",
      transcriptPrompt: SENTINEL,
    };
    await enterNativeRun(native, spoof);
    const receipt = await promptBuild(
      promptBuildContext(spoof.runId, {
        agentId: "main",
        sessionKey: "main-session",
        trigger: "user",
      }),
    );
    assert.match(
      receipt.prependContext,
      /Trusted governance receipt/u,
      "a user turn whose body is the sentinel must still be fully governed",
    );
    assert.doesNotMatch(
      receipt.prependContext,
      /EXECUTION_STATE_UNKNOWN\. Do not delegate/u,
      "and must not be told to report BLOCKED",
    );
  });
});

test("R19 F2: one run's record is unreachable from another run", async () => {
  await withPlugin(async ({ native, promptBuild }) => {
    const heartbeatRun = "r19-f2-heartbeat";
    await enterNativeRun(native, admissionContext(heartbeatRun));
    // A different run, same shape otherwise, with no admission of its own.
    const receipt = await promptBuild(
      promptBuildContext("r19-f2-other", {
        sessionKey: "agent:main:discord:channel:123",
      }),
    );
    assert.match(
      receipt.prependContext,
      /EXECUTION_STATE_UNKNOWN/u,
      "a run with no record of its own must stay governed",
    );
  });
});

test("R19 I: the store is bounded and eviction degrades to governance", async () => {
  await withPlugin(async ({ native, promptBuild }) => {
    const first = "r19-i-first";
    await enterNativeRun(native, admissionContext(first));
    assert.deepEqual(
      await promptBuild(promptBuildContext(first)),
      {},
      "the record is honoured while present",
    );
    // Overflow the bound so the oldest entry is evicted.
    for (let i = 0; i < 300; i += 1)
      await enterNativeRun(native, admissionContext(`r19-i-fill-${i}`));
    const afterEviction = await promptBuild(
      promptBuildContext(first, {
        sessionKey: "agent:main:discord:channel:123",
      }),
    );
    // The degradation direction is the whole point: once the record is gone the
    // run falls through to the GOVERNED path, never to the exempt early return.
    assert.notDeepEqual(
      afterEviction,
      {},
      "an evicted record must never yield an exemption",
    );
    assert.match(
      afterEviction.prependContext,
      /EXECUTION_STATE_UNKNOWN/u,
      "it must degrade to the fail-open BLOCKED instruction, i.e. governed",
    );
  });
});

test("R19 I2: a context with no runId has no record", async () => {
  await withPlugin(async ({ promptBuild }) => {
    const receipt = await promptBuild(
      promptBuildContext(undefined, {
        sessionKey: "agent:main:discord:channel:123",
      }),
    );
    assert.match(receipt.prependContext, /EXECUTION_STATE_UNKNOWN/u);
  });
});

// ---------------------------------------------------------------------------
// G / H — R18 and the pinned native runtime stay intact
// ---------------------------------------------------------------------------

test("R19 G: R18's boundary recovery is byte-for-byte unchanged", () => {
  // M10/T2-R5 UPDATE (owner Option A): the boundary intentionally gains the
  // deterministic preflight-registry read plus the structured frozen fields.
  // R18's recovery must be intact UNDER that extension, so this test pins
  // both halves: every R18 recovery marker plus the R5 markers, and the
  // file must equal the R5-authorized bytes (see digest below) so any
  // further unreviewed boundary mutation still fails.
  const R18_COMMIT = "980b36e";
  const sha = (v) => createHash("sha256").update(v).digest("hex");
  const current = readFileSync(BOUNDARY_PATH, "utf8");
  const atR18 = execFileSync(
    "git",
    [
      "show",
      `${R18_COMMIT}:integrations/openclaw/topology/lib/native-boundary.mjs`,
    ],
    { cwd: REPO, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  assert.notEqual(
    sha(current),
    sha(atR18),
    "the boundary carries the R4-authorized threadId extension",
  );
  assert.ok(
    current.includes("rememberRunLiveness("),
    "R18's admission-time recording must still be present",
  );
  assert.ok(
    current.includes("context.trigger ?? liveness?.trigger"),
    "R18's run-end recovery must still be present",
  );
  assert.ok(
    current.includes("threadId: params.currentThreadId") === false,
    "the patch-side expression lives in the patcher, never duplicated here",
  );
  assert.ok(
    current.includes("const threadId = context.threadId ?? null;"),
    "R4's explicit absent behavior must be present",
  );
  assert.ok(
    current.includes("GOVERNANCE_CONTEXT_MISSING"),
    "R4's malformed-threadId fail-closed must be present",
  );
  assert.equal(
    sha(current),
    "bccfa8616dc89fbb3764d53ad6ea11f5cfbc445bc076e4270f2678c6c1e18c3a",
    "the boundary must equal the R4-authorized bytes exactly",
  );
});

test("R19 H: R18's run-end behaviour is functionally intact", async () => {
  await withPlugin(async ({ native, logged }) => {
    // The boundary registry key is a global Symbol, so this repo-side boundary
    // reaches the temp plugin's guard. That lets the REAL host run-end shape
    // drive the REAL plugin seam.
    const heartbeatRun = "r19-h-heartbeat";
    const from = logged.length;
    await enterNativeRun(native, admissionContext(heartbeatRun));
    // The host passes ONLY this at run-end; R18's boundary recovers the rest.
    await assert.doesNotReject(
      () =>
        finishNativeRun(
          native,
          { type: "run_end", success: true },
          {
            agentId: "main",
            sessionKey: "agent:main:main",
            runId: heartbeatRun,
          },
        ),
      "R18's run-end exemption must still hold for a heartbeat",
    );
    const heartbeatLog = logged.slice(from);
    assert.ok(
      heartbeatLog.some((line) =>
        line.includes("beforeRunEnd: internal system session"),
      ),
      "R18's internal-session verdict must still be reached at run-end",
    );
    assert.equal(
      heartbeatLog.some((line) =>
        line.includes("self-keyed session presented a runId"),
      ),
      false,
      "R18's run-end refusal must not fire for a heartbeat",
    );

    // R18's protection is unchanged: a genuinely governed Discord run is NOT
    // classified as an internal session, so the exemption never leaks to it.
    const governedRun = "r19-h-governed";
    const governedFrom = logged.length;
    await enterNativeRun(native, {
      channelId: "discord",
      agentId: "main",
      senderId: OWNER,
      currentMessageId: "123456789012345933",
      content: "@main ordinary request",
      mentions: [{ username: "main" }],
      sessionKey: "main-session",
      runId: governedRun,
    });
    await finishNativeRun(
      native,
      { type: "run_end", success: true },
      { agentId: "main", sessionKey: "main-session", runId: governedRun },
    ).catch(() => {
      // Full end-of-run governance is expected to reject or fail closed for a
      // governed run in this minimal fixture, which has no workflow state to
      // finalise. Both outcomes are "governed"; neither may be "exempt".
    });
    const governedLog = logged.slice(governedFrom);
    assert.equal(
      governedLog.some((line) =>
        line.includes("beforeRunEnd: internal system session"),
      ),
      false,
      "R18's exemption must not leak to an ordinary governed run",
    );
    assert.equal(
      governedLog.some((line) =>
        line.includes("self-keyed session presented a runId"),
      ),
      false,
      "and the governed run must not take the self-keyed heartbeat refusal path",
    );
  });
});

// ---------------------------------------------------------------------------
// Structural: one predicate, one rule
// ---------------------------------------------------------------------------

test("R19 S: the sentinel remains a single constant and the helper is used once", () => {
  const source = readFileSync(ENTRYPOINT_PATH, "utf8");
  assert.equal(
    source.split("const HEARTBEAT_LIVENESS_SENTINEL").length - 1,
    1,
    "the sentinel must remain a single module-local constant",
  );
  assert.equal(
    source.split("if (isLivenessHeartbeat(context)) return {};").length - 1,
    1,
    "exactly one prompt-build exemption",
  );
  // The helper must delegate to the ONE predicate, never re-implement it.
  const helperAt = source.indexOf("function isLivenessHeartbeat(context) {");
  assert.notEqual(helperAt, -1);
  const helperEnd = source.indexOf("\n}\n", helperAt);
  const helper = source.slice(helperAt, helperEnd);
  assert.equal(
    helper.split("isPureLivenessHeartbeat(").length - 1,
    2,
    "the helper must call the one predicate (fast path + recovered path)",
  );
  assert.equal(
    helper.includes("HEARTBEAT_LIVENESS_SENTINEL"),
    false,
    "the helper must not re-implement the rule with its own sentinel comparison",
  );
});
