// M10/T2-R8 — ingress verdict matrix over the REAL admission seam.
//
// Forensic follow-up to two live observations that could not be correlated
// to gateway traffic (no Discord ingress reached the live runtime in the
// verification windows):
//   BUG 1 (claimed): valid @main message gets no reply.
//   BUG 2 (claimed): untagged message gets a reply.
//
// This suite drives enterNativeRun with production-shaped contexts through
// a real plugin registration and pins the verdict for every input class:
// valid Main-directed signals ALLOW and open exactly one task; everything
// else DENIES with zero ledger/queue mutation and zero runtime invocation.
// Any future change that flips a verdict fails loudly here first.
//
// What this suite does NOT prove (documented limits, not gaps):
// - Discord transport delivery (websocket gaps lose messages upstream).
// - Model provider success (429/503 failover is environmental).
// - Outbound Discord posting (host dispatcher; no adapter in fixtures).
// A visible reply additionally requires all three, which fixtures cannot
// provide. See the R8 live-verification report for the live evidence.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
const OTHER_BOT = DISCORD_BOT_IDS.excel;
let midCounter = 0;
// Valid Discord snowflakes (19 digits): messageId format is enforced by
// the lineage gate, so fixtures must use well-formed ids.
const freshMsg = () =>
  `154543${String(100000000000 + midCounter++).padStart(12, "0")}`;

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r8m-"));
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
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: () => {},
    logger: { error() {}, warn() {}, info() {} },
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
    return await body({ paths, native });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

const base = (overrides = {}) => ({
  agentId: "main",
  sessionKey: `agent:main:discord:channel:${OFFICE}`,
  runId: `r8m-${midCounter}`,
  inputProvenance: undefined,
  channelId: "discord",
  senderId: OWNER,
  currentMessageId: freshMsg(),
  trigger: "user",
  transcriptPrompt: undefined,
  threadId: undefined,
  ...overrides,
});

// Each case: [name, context overrides, stash record or null, expected verdict].
// Stash records mirror exactly what the deployed preflight patch writes.
const cases = [
  ["untagged-plain", {}, null, "DENY"],
  ["mention-main", {}, { mentionedUserIds: ["1545436878835163156"] }, "ALLOW"],
  [
    "mention-other-bot",
    {},
    { mentionedUserIds: ["1545438637750227104"] },
    "DENY",
  ],
  ["mention-owner-user", {}, { mentionedUserIds: [OWNER] }, "DENY"],
  [
    "reply-main",
    {},
    {
      replyReferenceMessageId: "1545430000000000051",
      replyReferenceAuthorId: MAIN_BOT,
    },
    "ALLOW",
  ],
  [
    "reply-other-bot",
    {},
    {
      replyReferenceMessageId: "1545430000000000052",
      replyReferenceAuthorId: OTHER_BOT,
    },
    "DENY",
  ],
  [
    "reply-user",
    {},
    {
      replyReferenceMessageId: "1545430000000000053",
      replyReferenceAuthorId: OWNER,
    },
    "DENY",
  ],
  [
    "thread-owned",
    { threadId: "1545430000000000001" },
    { threadOwnerId: MAIN_BOT },
    "ALLOW",
  ],
  [
    "thread-foreign",
    { threadId: "1545430000000000001" },
    { threadOwnerId: OTHER_BOT },
    "DENY",
  ],
  [
    "specialist-plain",
    { agentId: "excel", sessionKey: `agent:excel:discord:channel:${OFFICE}` },
    null,
    "DENY",
  ],
  [
    "specialist-mention-main",
    { agentId: "excel", sessionKey: `agent:excel:discord:channel:${OFFICE}` },
    { mentionedUserIds: [MAIN_BOT] },
    "DENY",
  ],
  [
    "o1-plain",
    { agentId: "o1", sessionKey: `agent:o1:discord:channel:${OFFICE}` },
    null,
    "DENY",
  ],
  [
    "nonowner-mention",
    { senderId: "223456789012345678" },
    { mentionedUserIds: [MAIN_BOT] },
    "DENY",
  ],
  [
    "bot-author",
    {},
    { mentionedUserIds: [MAIN_BOT], authorIsBot: true },
    "DENY",
  ],
  [
    "heartbeat",
    {
      sessionKey: "agent:main:main",
      channelId: undefined,
      senderId: undefined,
      currentMessageId: undefined,
      trigger: "heartbeat",
      transcriptPrompt: "[OpenClaw heartbeat poll]",
    },
    null,
    "ALLOW",
  ],
  ["missing-msgid", { currentMessageId: undefined }, null, "DENY"],
  ["bad-msgid", { currentMessageId: "abc" }, null, "DENY"],
  ["empty-session", { sessionKey: "" }, null, "DENY"],
  [
    "webchat-operator",
    { sessionKey: "agent:main:main", channelId: "webchat", senderId: OWNER },
    null,
    "DENY",
  ],
  [
    "cli-operator",
    { sessionKey: "agent:main:main", channelId: "cli", senderId: OWNER },
    null,
    "DENY",
  ],
];

test("R8 matrix: every ingress class reaches its specified verdict", async () => {
  for (const [name, shape, stash, expected] of cases) {
    await withPlugin(async ({ paths, native }) => {
      const ctx = base(shape);
      if (stash) {
        const KEY = "__zink_ingress_metadata_r5";
        if (!globalThis[KEY]) globalThis[KEY] = new Map();
        globalThis[KEY].set(ctx.currentMessageId, {
          mentionedUserIds: stash.mentionedUserIds ?? [],
          mentionedRoleIds: [],
          replyReferenceMessageId: stash.replyReferenceMessageId ?? null,
          replyReferenceAuthorId: stash.replyReferenceAuthorId ?? null,
          threadOwnerId: stash.threadOwnerId ?? null,
          authorIsBot: stash.authorIsBot ?? false,
        });
      }
      const before = readSnapshot(paths);
      let verdict;
      try {
        await enterNativeRun(native, ctx);
        verdict = "ALLOW";
      } catch {
        verdict = "DENY";
      }
      assert.equal(verdict, expected, `${name}: expected ${expected}`);
      const after = readSnapshot(paths);
      if (expected === "DENY") {
        // A denied message must not invoke the runtime: no task, no ledger
        // mutation, no queue entry.
        assert.equal(
          after.sequence,
          before.sequence,
          `${name}: denied run must not mutate the ledger`,
        );
        assert.equal(
          Object.keys(after.tasks).length,
          Object.keys(before.tasks).length,
          `${name}: denied run must not open a task`,
        );
      } else if (name === "heartbeat") {
        // Heartbeat exemption admits without opening a task (no ledger
        // owner by design) and without mutating state.
        assert.equal(
          after.sequence,
          before.sequence,
          `${name}: heartbeat must not mutate the ledger`,
        );
      } else {
        // An admitted message opens exactly one Main task through the
        // governed path (model invocation itself is host-side).
        assert.equal(
          Object.keys(after.tasks).length,
          Object.keys(before.tasks).length + 1,
          `${name}: admitted run must open exactly one task`,
        );
        const created = Object.values(after.tasks).at(-1);
        assert.equal(
          created.root_agent_id,
          "main",
          `${name}: task owned by main`,
        );
      }
      // Stash hygiene: each case uses a unique message id (Discord ids are
      // unique in production); remove it so cases stay independent.
      globalThis["__zink_ingress_metadata_r5"]?.delete?.(ctx.currentMessageId);
    });
  }
});
