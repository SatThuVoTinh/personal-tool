// M10/T2-R9-A — duplicate-guard denial must be attributable to a run.
//
// Live evidence (2026-10-06 09:22:00 +07, msg 1556853993278541867):
//   09:22:09.761 [model-fallback/decision] next=google/gemini-flash-lite-latest
//   09:22:10.306 ingress denied: reason=DUPLICATE_DISCORD_EVENT msg=<same>
//   09:22:10.306 [zink-native-gate] enterNativeRun: GOVERNANCE_DENIED
//   model-fetch after 09:22:09 : 0
// The fallback re-entry carried the same Discord message id, so deriveTaskId
// produced the same taskId and the guard denied it BEFORE any model call. The
// identical fallback event on a non-Discord session
// (lane session:agent:main:main) DID call the model, so the boundary is the
// duplicate guard, not the fallback machinery.
//
// R9-A adds exactly one thing: the denying run's runId is now logged, so a
// later R9-C can distinguish "same event re-entered by our own fallback" from
// "same event re-delivered" using evidence instead of inference.
//
// R9-A is LOG-ONLY. This suite pins that the verdict, the ledger mutation
// count, and WORKFLOW_OPENED idempotency are all unchanged, so the
// observability addition cannot have altered the security control.
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

import { enterNativeRun } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
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
  `154543${String(900000000000 + midCounter++).padStart(12, "0")}`;

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r9dup-"));
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
  const logged = [];
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: () => {},
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
    return await body({ paths, native, logged });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const directedContext = (runId, currentMessageId) => {
  if (!globalThis[MENTION_MAIN_KEY]) globalThis[MENTION_MAIN_KEY] = new Map();
  globalThis[MENTION_MAIN_KEY].set(currentMessageId, {
    mentionedUserIds: [MAIN_BOT],
    mentionedRoleIds: [],
    mentionRoles: [],
  });
  return {
    agentId: "main",
    sessionKey: `agent:main:discord:channel:${OFFICE}`,
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

test("R9-A1: a repeated message id is still denied, so R9-A is log-only", async () => {
  await withPlugin(async ({ native }) => {
    const msgId = freshMsg();
    const first = await enterNativeRun(
      native,
      directedContext("r9-run-1", msgId),
    );
    assert.notEqual(first, false, "first admission must succeed");

    // Same message id, DIFFERENT runId: this is the shape a model fallback
    // re-entry takes. R9-A must NOT admit it — that is R9-C's decision, which
    // the owner deferred. This assertion is what proves R9-A changed no
    // behavior.
    await assert.rejects(
      enterNativeRun(native, directedContext("r9-run-2", msgId)),
      /GOVERNANCE_RUN_UNAVAILABLE/,
      "R9-A must not admit the duplicate",
    );
  });
});

test("R9-A2: the denial log names the denying run's runId", async () => {
  await withPlugin(async ({ native, logged }) => {
    const msgId = freshMsg();
    await enterNativeRun(native, directedContext("r9-run-alpha", msgId));
    logged.length = 0;

    await assert.rejects(
      enterNativeRun(native, directedContext("r9-run-beta", msgId)),
      /GOVERNANCE_RUN_UNAVAILABLE/,
    );

    const denial = logged.find(
      (l) =>
        l.includes("ingress denied: reason=DUPLICATE_DISCORD_EVENT") &&
        l.includes(`msg=${msgId}`),
    );
    assert.ok(denial, `no DUPLICATE_DISCORD_EVENT denial logged: ${logged}`);
    assert.ok(
      denial.includes("runId=r9-run-beta"),
      `denial must carry the denying run's runId, got: ${denial}`,
    );
    assert.ok(
      !denial.includes("r9-run-alpha"),
      `denial must not name the admitting run, got: ${denial}`,
    );
  });
});

test("R9-A3: WORKFLOW_OPENED idempotency is unchanged — exactly one event", async () => {
  await withPlugin(async ({ paths, native }) => {
    const msgId = freshMsg();
    await enterNativeRun(native, directedContext("r9-run-1", msgId));
    assert.equal(openedCount(paths), 1, "first entry opens the task once");

    await assert.rejects(
      enterNativeRun(native, directedContext("r9-run-2", msgId)),
      /GOVERNANCE_RUN_UNAVAILABLE/,
    );
    assert.equal(
      openedCount(paths),
      1,
      "a duplicate must never write a second WORKFLOW_OPENED",
    );
  });
});
