// M10/T2-R9-C — a same-run model-fallback re-entry is not a replay.
//
// Live evidence (2026-10-07 16:44:18-16:44:20, msg 1557326125670342669):
//   16:38:06.917 [model-fetch] start model=execute
//   16:44:18.929 [diagnostic] stalled session activeWorkKind=model_call
//                  lastProgress=model_call:started lastProgressAge=372s
//   16:44:18.964 [model-fetch] error model=execute elapsedMs=372045 AbortError
//   16:44:19.423 [model-fallback/decision] decision=candidate_failed
//                  candidate=router/execute next=router/gemini/gemini-3.6-flash
//   16:44:20.389 ingress denied: reason=DUPLICATE_DISCORD_EVENT agent=main
//                  msg=1557326125670342669 runId=98aae218-ae57-447f-8a66-1150262e4f3b
//   16:44:20.389 [zink-native-gate] enterNativeRun: GOVERNANCE_DENIED
//   16:44:20.449 Embedded agent failed before reply: GOVERNANCE_RUN_UNAVAILABLE
//
// The runId in the denial is the SAME runId that opened the task: OpenClaw's
// fallback starts a new lane for the same already-authenticated run, so the
// duplicate-event guard denied the host's own failover candidate. A hung
// primary could therefore never fail over, and the owner received nothing.
// This is the same defect R9-A observed on 2026-10-06 (msg 1556853993278541867).
//
// R9-C admits ONLY a re-entry whose task root identity matches the observing run
// (runId + agent + session). Every other re-use of a message id still denies.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  enterNativeRun,
  resolveGovernance,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import {
  governancePluginFiles,
  AGENT_IDS,
  agentInstructions,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";

const OWNER = "123456789012345678";
const OFFICE = "1545425766161063937";
const MAIN_BOT = DISCORD_BOT_IDS.main;
const MENTION_MAIN_KEY = "__zink_ingress_metadata_r5";
let midCounter = 0;
const freshMsg = () =>
  `154543${String(800000000000 + midCounter++).padStart(12, "0")}`;

// Unlike the R9-A harness, the `on` collector KEEPS the registered handlers so a
// test can call the `before_run` hook directly. R9-C's second half is about what
// that hook returns, which enterNativeRun cannot observe.
async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r9c-"));
  const paths = ledgerPaths(root);
  // readSnapshot materializes the ledger tree; identity.key must be written into
  // an existing directory (same order as the R9-A harness).
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
  const logged = [];
  const handlers = new Map();
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: (event, handler) => {
      handlers.set(event, handler);
    },
    logger: {
      error: (m) => logged.push(`ERROR ${m}`),
      warn: (m) => logged.push(`WARN ${m}`),
      info: (m) => logged.push(`INFO ${m}`),
    },
  });
  const native = {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot: paths.root },
        },
      },
    },
  };
  try {
    return await body({ paths, native, logged, handlers });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const directedContext = (runId, currentMessageId, sessionKey) => {
  if (!globalThis[MENTION_MAIN_KEY]) globalThis[MENTION_MAIN_KEY] = new Map();
  globalThis[MENTION_MAIN_KEY].set(currentMessageId, {
    mentionedUserIds: [MAIN_BOT],
    mentionedRoleIds: [],
    mentionRoles: [],
  });
  return {
    agentId: "main",
    sessionKey: sessionKey ?? `agent:main:discord:channel:${OFFICE}`,
    runId,
    inputProvenance: undefined,
    channelId: "discord",
    senderId: OWNER,
    currentMessageId,
    trigger: "user",
    transcriptPrompt: undefined,
    threadId: undefined,
  };
};

const openedCount = (paths) => {
  let raw;
  try {
    raw = readFileSync(paths.events, "utf8");
  } catch {
    return 0;
  }
  return raw
    .split("\n")
    .filter((l) => l.trim() && JSON.parse(l).type === "WORKFLOW_OPENED").length;
};

test("R9-C1: the SAME run re-entering its own message is admitted, not denied", async () => {
  // This is the exact live failure: one admitted run, primary hung, host opened
  // a fallback lane under the same runId and the same message id.
  await withPlugin(async ({ native }) => {
    const msgId = freshMsg();
    const runId = "r9c-run-1";
    await enterNativeRun(native, directedContext(runId, msgId));
    await assert.doesNotReject(
      enterNativeRun(native, directedContext(runId, msgId)),
      "a same-run fallback re-entry must be admitted or failover can never fire",
    );
  });
});

test("R9-C2: the re-entry writes NO second WORKFLOW_OPENED", async () => {
  await withPlugin(async ({ paths, native }) => {
    const msgId = freshMsg();
    const runId = "r9c-run-idem";
    await enterNativeRun(native, directedContext(runId, msgId));
    assert.equal(openedCount(paths), 1);
    await enterNativeRun(native, directedContext(runId, msgId));
    assert.equal(
      openedCount(paths),
      1,
      "admitting the retry must not open the task twice",
    );
  });
});

test("R9-C3: a DIFFERENT run re-using the message id is still denied", async () => {
  // The security invariant R9-C must not weaken: replay protection for a
  // genuinely re-delivered Discord event is unchanged.
  await withPlugin(async ({ native, logged }) => {
    const msgId = freshMsg();
    await enterNativeRun(native, directedContext("r9c-admitting", msgId));
    logged.length = 0;
    await assert.rejects(
      enterNativeRun(native, directedContext("r9c-other-run", msgId)),
      /GOVERNANCE_RUN_UNAVAILABLE/,
      "a different run must never reuse an admitted message id",
    );
    assert.ok(
      logged.some((l) =>
        l.includes("ingress denied: reason=DUPLICATE_DISCORD_EVENT"),
      ),
      `the replay denial must still be logged: ${logged.join(" | ")}`,
    );
  });
});

test("R9-C4: the same runId from a DIFFERENT session is still denied", async () => {
  // The root identity is a triple (runId + agent + session). Matching only runId
  // would let a second session ride the admitted run through.
  await withPlugin(async ({ native, logged }) => {
    const msgId = freshMsg();
    const runId = "r9c-shared-run";
    await enterNativeRun(native, directedContext(runId, msgId));
    logged.length = 0;
    await assert.rejects(
      enterNativeRun(
        native,
        directedContext(
          runId,
          msgId,
          "agent:main:discord:channel:1545425766161063938",
        ),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/,
      "a foreign session must not inherit the admitted run",
    );
    assert.ok(
      logged.some((l) =>
        l.includes("ingress denied: reason=DUPLICATE_DISCORD_EVENT"),
      ),
      `a session mismatch must deny at the duplicate guard: ${logged.join(" | ")}`,
    );
  });
});

test("R9-C5: the re-entry is attributed in the log, not silently admitted", async () => {
  await withPlugin(async ({ native, logged }) => {
    const msgId = freshMsg();
    const runId = "r9c-attr";
    await enterNativeRun(native, directedContext(runId, msgId));
    logged.length = 0;
    await enterNativeRun(native, directedContext(runId, msgId));
    const note = logged.find(
      (l) =>
        l.includes("ingress re-entry admitted as model-fallback retry") &&
        l.includes(`msg=${msgId}`) &&
        l.includes(`runId=${runId}`),
    );
    assert.ok(note, `no re-entry attribution logged: ${logged.join(" | ")}`);
    assert.ok(
      !logged.some((l) => l.includes("DUPLICATE_DISCORD_EVENT")),
      "an admitted re-entry must not also log a duplicate denial",
    );
  });
});

test("R9-C6: the re-entry does NOT pin the model back to the aborted primary", async () => {
  // The second half of the live defect. `resolveRuntimeModel` reads QUOTA, which a
  // model failure never lowers, so on the retry it resolves to the primary — the
  // model that just aborted at 372s — and would override the host's reactive
  // failover candidate. On the re-entry the proactive resolution must stand aside.
  await withPlugin(async ({ native }) => {
    // The plugin registers its admission hook through `registerNativeGuard`, which
    // is exactly what `resolveGovernance` reads — so this is the same object
    // `enterNativeRun` calls, reached without guessing a hook event name.
    const guard = resolveGovernance(native).guard;
    assert.ok(guard, "the plugin must register a native guard");
    assert.equal(
      typeof guard.beforeRun,
      "function",
      "beforeRun must be registered",
    );
    const msgId = freshMsg();
    const runId = "r9c-model";
    // Calling the guard directly skips `enterNativeRun`, which normally reads the
    // inbound-metadata registry and forwards the structured mention ids. This test
    // therefore forwards them itself, exactly as the host seam would.
    const ctx = {
      ...directedContext(runId, msgId),
      mentionedUserIds: [MAIN_BOT],
      mentionedRoleIds: [],
      mentionRoles: [],
    };

    const first = await guard.beforeRun({}, ctx);
    assert.equal(
      first.allow,
      true,
      `first admission must allow, got: ${JSON.stringify(first)}`,
    );
    assert.ok(
      first.modelResolution,
      "a FIRST admission still resolves a proactive model (unchanged behaviour)",
    );

    const retry = await guard.beforeRun({}, ctx);
    assert.equal(retry.allow, true, "the re-entry must still be admitted");
    assert.equal(
      retry.modelResolution,
      undefined,
      "the re-entry must not resolve a model, or it pins the aborted primary back",
    );
  });
});
