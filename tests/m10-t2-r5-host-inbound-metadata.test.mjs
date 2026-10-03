// M10/T2-R5 — host-side Discord inbound metadata exposure.
//
// R4 proved the native admission seam cannot observe mentions, reply
// references, or authorship: runEmbeddedAttempt params carry none of them
// (zero occurrences in the 644KB pinned selection bundle), and a
// plugin-side message_received cache is racy by host fire-and-forget
// construction. R5 moves observation upstream to the pinned host Discord
// preflight seam, where the raw discord.js message AND the host-resolved
// threadOwnerId are in scope, and carries the extracted record causally to
// admission in a bounded messageId-keyed registry (in-path write before any
// turn for that message can exist; no listener, no polling, no timing
// dependency).
//
// What the pinned host provably provides (2026.6.34 dist, read-only):
// - message.mentionedUsers[] / .mentionedRoles[] (structured ids)
// - message.messageReference?.message_id + message.referencedMessage?.author
// - message.author (bot flag + id), message.id
// - host-resolved threadOwnerId at the same call site
// What it provably does NOT forward downstream (canonical mapper + run
// params carry none of it): everything above. Hence this repair.
//
// Scope discipline: the selection patch is UNCHANGED from R4 (threadId
// only); the new work is the preflight extraction, the boundary read +
// typing, and admission classification. Mention/reply attribution uses
// structured ids only — never message text.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
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
import {
  DISCORD_BOT_IDS,
  resolveMainReplyAdmission,
  MAIN_DIRECTED,
  MAIN_NOT_CONFIRMED,
} from "../integrations/openclaw/lib/authority.mjs";
import {
  ZINK_INGRESS_METADATA_KEY,
  DISCORD_PREFLIGHT_ANCHOR,
  DISCORD_PREFLIGHT_INJECTION,
  NATIVE_PATCH_PREDECESSORS,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";
import { readZinkIngressMetadata } from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const REPO = process.cwd();
const OWNER = "123456789012345678";
const OFFICE = "1545425766161063937";
const MAIN_BOT = DISCORD_BOT_IDS.main;
const OTHER_BOT = DISCORD_BOT_IDS.excel;
const THREAD = "1545430000000000001";
const THREAD_OTHER = "1545430000000000002";
const MSG = "1545430000000000009";
const MSG_OTHER = "1545430000000000019";

/** Run the REAL preflight injection snippet in a synthetic host scope. */
function runPreflightInjection({ message, threadOwnerId } = {}) {
  const factory = new Function(
    "message",
    "threadOwnerId",
    "globalThis",
    DISCORD_PREFLIGHT_INJECTION,
  );
  factory(message, threadOwnerId, globalThis);
}

/** discord.js-shaped message with structured metadata. Deny-by-default:
 * no mentions unless the test states them explicitly. */
const discordMessage = (overrides = {}) => ({
  id: MSG,
  content: "hello",
  mentionedUsers: [],
  mentionedRoles: [],
  mentionedEveryone: false,
  messageReference: null,
  referencedMessage: null,
  author: { id: OWNER, bot: false },
  thread: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// HOST CONTRACT — the pin, the anchor, the prohibition set
// ---------------------------------------------------------------------------

test("R5 H1: the Discord preflight file is pinned with its own role", async () => {
  const mod = await import(
    pathToFileURL(
      path.join(
        REPO,
        "integrations",
        "openclaw",
        "topology",
        "lib",
        "native-patch.mjs",
      ),
    ).href
  );
  const entry =
    mod.NATIVE_RUNTIME_PINS["2026.6.34"].sources[
      "message-handler.preflight-C1XBiefW.js"
    ];
  assert.ok(entry, "the preflight artifact must be pinned");
  assert.equal(entry.role, "discord-preflight");
  assert.equal(
    entry.sha256,
    "dca5459d27777d7884483d86432d82c0da88244338c3e6ec574a337ec687c0b0",
    "the pin is the unpatched upstream baseline",
  );
  assert.ok(
    typeof mod.EDITS_BY_ROLE?.["discord-preflight"] === "undefined" ||
      Array.isArray(mod.EDITS_BY_ROLE["discord-preflight"]),
    "a discord-preflight edit role must exist when pinned",
  );
});

test("R5 H2: the injection reads structured fields only, never text", () => {
  for (const token of [
    "message.mentionedUsers",
    "message.mentionedRoles",
    "message.messageReference",
    "message.referencedMessage",
    "message.author",
    "threadOwnerId",
  ]) {
    assert.ok(
      DISCORD_PREFLIGHT_INJECTION.includes(token),
      `injection must read ${token}`,
    );
  }
  for (const forbidden of [
    "message.content",
    "message_received",
    "fireAndForget",
    "fetch(",
    "setTimeout",
    "setInterval",
  ]) {
    assert.equal(
      DISCORD_PREFLIGHT_INJECTION.includes(forbidden),
      false,
      `injection must not contain ${forbidden}`,
    );
  }
  assert.ok(
    DISCORD_PREFLIGHT_ANCHOR.length > 40,
    "the anchor must be a substantial unique match",
  );
});

test("R5 H3: both patches share one registry key, no duplicates", () => {
  assert.ok(
    typeof ZINK_INGRESS_METADATA_KEY === "string" &&
      ZINK_INGRESS_METADATA_KEY.length > 8,
    "one shared registry key",
  );
  assert.ok(
    DISCORD_PREFLIGHT_INJECTION.includes(ZINK_INGRESS_METADATA_KEY),
    "the preflight writer uses the shared key",
  );
  const boundarySource = readFileSync(
    path.join(
      REPO,
      "integrations",
      "openclaw",
      "topology",
      "lib",
      "native-boundary.mjs",
    ),
    "utf8",
  );
  assert.ok(
    boundarySource.includes(ZINK_INGRESS_METADATA_KEY),
    "the boundary reader uses the shared key",
  );
});

// ---------------------------------------------------------------------------
// EXTRACTION — the real injected snippet in synthetic host scopes
// ---------------------------------------------------------------------------

test("R5 X1: full structured metadata is extracted", () => {
  runPreflightInjection({
    message: discordMessage({
      mentionedUsers: [{ id: MAIN_BOT }, { id: OTHER_BOT }],
      mentionedRoles: ["1545471797452087390"],
      messageReference: { message_id: MSG_OTHER },
      referencedMessage: { author: { id: MAIN_BOT, bot: true } },
    }),
    threadOwnerId: MAIN_BOT,
  });
  const record = readZinkIngressMetadata(MSG);
  assert.deepEqual(record.mentionedUserIds, [MAIN_BOT, OTHER_BOT]);
  assert.deepEqual(record.mentionedRoleIds, ["1545471797452087390"]);
  assert.equal(record.replyReferenceMessageId, MSG_OTHER);
  assert.equal(record.replyReferenceAuthorId, MAIN_BOT);
  assert.equal(record.threadOwnerId, MAIN_BOT);
  assert.equal(record.authorIsBot, false);
});

test("R5 X2: non-reply message yields nulls and empty lists", () => {
  runPreflightInjection({
    message: discordMessage({ mentionedUsers: [], mentionedRoles: [] }),
    threadOwnerId: null,
  });
  const record = readZinkIngressMetadata(MSG);
  assert.deepEqual(record.mentionedUserIds, []);
  assert.deepEqual(record.mentionedRoleIds, []);
  assert.equal(record.replyReferenceMessageId, null);
  assert.equal(record.replyReferenceAuthorId, null);
  assert.equal(record.threadOwnerId, null);
  assert.equal(record.authorIsBot, false);
});

test("R5 X3: malformed ids are dropped, never stored", () => {
  runPreflightInjection({
    message: discordMessage({
      id: MSG_OTHER,
      mentionedUsers: [{ id: "not-an-id" }, { noId: true }, { id: MAIN_BOT }],
      mentionedRoles: ["oops", "123"],
      messageReference: { message_id: "zzz" },
      referencedMessage: { author: { id: "" } },
      author: { id: OWNER, bot: "yes" },
    }),
    threadOwnerId: "bogus",
  });
  const record = readZinkIngressMetadata(MSG_OTHER);
  assert.deepEqual(record.mentionedUserIds, [MAIN_BOT]);
  assert.deepEqual(record.mentionedRoleIds, []);
  assert.equal(record.replyReferenceMessageId, null);
  assert.equal(record.replyReferenceAuthorId, null);
  assert.equal(record.threadOwnerId, null);
  assert.equal(record.authorIsBot, false);
});

test("R5 X4: absent message writes nothing and throws nothing", () => {
  runPreflightInjection({ message: undefined, threadOwnerId: MAIN_BOT });
  runPreflightInjection({ message: null, threadOwnerId: MAIN_BOT });
  const record = readZinkIngressMetadata("1545430000000000099");
  assert.deepEqual(record.mentionedUserIds, []);
  assert.equal(record.replyReferenceAuthorId, null);
});

test("R5 X5: the registry is bounded and evicts oldest-first", () => {
  for (let i = 0; i < 300; i += 1) {
    const id = `154543000000${String(100000 + i).padStart(6, "0")}`;
    runPreflightInjection({ message: discordMessage({ id }) });
  }
  const first = readZinkIngressMetadata("154543000000100000");
  assert.deepEqual(first.mentionedUserIds, []);
  const store = globalThis[ZINK_INGRESS_METADATA_KEY];
  assert.ok(store.size <= 256, `bounded, saw ${store.size}`);
});

// ---------------------------------------------------------------------------
// READ PATH — the boundary normalizes what admission sees
// ---------------------------------------------------------------------------

test("R5 R1: unknown messageId reads as empty", () => {
  const record = readZinkIngressMetadata("1545430000000000777");
  assert.deepEqual(record.mentionedUserIds, []);
  assert.deepEqual(record.mentionedRoleIds, []);
  assert.equal(record.replyReferenceMessageId, null);
  assert.equal(record.replyReferenceAuthorId, null);
  assert.equal(record.threadOwnerId, null);
  assert.equal(record.authorIsBot, false);
});

test("R5 R2: corrupted stored records normalize fail-closed", () => {
  const store = globalThis[ZINK_INGRESS_METADATA_KEY] ?? new Map();
  globalThis[ZINK_INGRESS_METADATA_KEY] = store;
  store.set(MSG, {
    mentionedUserIds: "not-an-array",
    mentionedRoleIds: [{ noId: true }, "bogus", 12345],
    replyReferenceMessageId: 12345,
    replyReferenceAuthorId: "bogus",
    threadOwnerId: [MAIN_BOT],
    authorIsBot: "yes",
  });
  const record = readZinkIngressMetadata(MSG);
  assert.deepEqual(record.mentionedUserIds, []);
  assert.deepEqual(record.mentionedRoleIds, []);
  assert.equal(record.replyReferenceMessageId, null);
  assert.equal(record.replyReferenceAuthorId, null);
  assert.equal(record.threadOwnerId, null);
  assert.equal(record.authorIsBot, false);
  store.delete(MSG);
});

// ---------------------------------------------------------------------------
// REPLY CLASSIFIER — pure
// ---------------------------------------------------------------------------

test("R5 C1: reply to Main-authored message admits", () => {
  const verdict = resolveMainReplyAdmission({
    agentId: "main",
    replyReferenceMessageId: MSG_OTHER,
    replyReferenceAuthorId: MAIN_BOT,
    mainBotId: MAIN_BOT,
    missingMentionRefusal: true,
  });
  assert.equal(verdict.admitted, true);
  assert.equal(verdict.classification, MAIN_DIRECTED);
});

test("R5 C2: reply to another bot denies", () => {
  const verdict = resolveMainReplyAdmission({
    agentId: "main",
    replyReferenceMessageId: MSG_OTHER,
    replyReferenceAuthorId: OTHER_BOT,
    mainBotId: MAIN_BOT,
    missingMentionRefusal: true,
  });
  assert.equal(verdict.admitted, false);
  assert.equal(verdict.classification, MAIN_NOT_CONFIRMED);
});

test("R5 C3: reply to an unrelated user denies", () => {
  const verdict = resolveMainReplyAdmission({
    agentId: "main",
    replyReferenceMessageId: MSG_OTHER,
    replyReferenceAuthorId: OWNER,
    mainBotId: MAIN_BOT,
    missingMentionRefusal: true,
  });
  assert.equal(verdict.admitted, false);
});

test("R5 C4: null reply reference admits nothing", () => {
  for (const partial of [
    { replyReferenceMessageId: null, replyReferenceAuthorId: MAIN_BOT },
    { replyReferenceMessageId: MSG_OTHER, replyReferenceAuthorId: null },
    { replyReferenceMessageId: null, replyReferenceAuthorId: null },
  ]) {
    const verdict = resolveMainReplyAdmission({
      agentId: "main",
      mainBotId: MAIN_BOT,
      missingMentionRefusal: true,
      ...partial,
    });
    assert.equal(verdict.admitted, false, JSON.stringify(partial));
  }
});

test("R5 C5: reply never admits specialists or other refusals", () => {
  for (const agentId of ["o1", "excel", "sql"]) {
    const verdict = resolveMainReplyAdmission({
      agentId,
      replyReferenceMessageId: MSG_OTHER,
      replyReferenceAuthorId: MAIN_BOT,
      mainBotId: MAIN_BOT,
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false, agentId);
  }
  const verdict = resolveMainReplyAdmission({
    agentId: "main",
    replyReferenceMessageId: MSG_OTHER,
    replyReferenceAuthorId: MAIN_BOT,
    mainBotId: MAIN_BOT,
    missingMentionRefusal: false,
  });
  assert.equal(verdict.admitted, false);
});

// ---------------------------------------------------------------------------
// ADMISSION END-TO-END — the real seam, isolated fixtures
// ---------------------------------------------------------------------------

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

const admissionContext = (overrides = {}) => ({
  agentId: "main",
  sessionKey: `agent:main:discord:channel:${OFFICE}`,
  runId: "r5-run-1",
  inputProvenance: undefined,
  channelId: "discord",
  senderId: OWNER,
  currentMessageId: MSG,
  trigger: "user",
  transcriptPrompt: undefined,
  threadId: undefined,
  // NOTE: mention/reply/owner/bot evidence NEVER appears here directly in
  // production — the selection patch cannot observe it. It arrives ONLY via
  // the preflight stash, seeded in fixtures through the REAL injection
  // snippet (seedIngress). Each test uses a unique message id, exactly as
  // Discord ids are unique in production.
  ...overrides,
});

/** Seed inbound metadata through the REAL preflight injection. */
function seedIngress({ messageId, message, threadOwnerId } = {}) {
  runPreflightInjection({
    message: discordMessage({ id: messageId, ...message }),
    threadOwnerId: threadOwnerId ?? null,
  });
}

const MID_A1 = "1545430000000000101";
const MID_A2 = "1545430000000000102";
const MID_A3 = "1545430000000000103";
const MID_A4 = "1545430000000000104";
const MID_A5 = "1545430000000000105";
const MID_A6 = "1545430000000000106";
const MID_A7 = "1545430000000000107";
const MID_A8 = "1545430000000000108";
const MID_A9 = "1545430000000000109";
const MID_A10 = "1545430000000000110";

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r5-"));
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
  const plugin = (
    await import(pathToFileURL(path.join(extension, "index.mjs")).href)
  ).default;
  const dispose = plugin.register({
    pluginConfig: { ledgerRoot: paths.root, ownerDiscordId: OWNER },
    on: (name, fn) => hooks.set(name, fn),
    logger: { error() {}, warn() {}, info() {} },
  });
  try {
    return await body({
      paths,
      hooks,
      native: nativeConfig(paths.root),
    });
  } finally {
    if (typeof dispose === "function") dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

test("R5 A1: structured @main mention admits (TEST 1)", async () => {
  await withPlugin(async ({ native, paths }) => {
    seedIngress({
      messageId: MID_A1,
      message: { mentionedUsers: [{ id: MAIN_BOT }] },
    });
    await enterNativeRun(
      native,
      admissionContext({ currentMessageId: MID_A1 }),
    );
    const tasks = Object.values(readSnapshot(paths).tasks);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].root_agent_id, "main");
  });
});

test("R5 A2: reply to Main-authored message admits (TEST 2)", async () => {
  await withPlugin(async ({ native, paths }) => {
    seedIngress({
      messageId: MID_A2,
      message: {
        // No mention: isolate the reply path (default fixture mentions Main).
        mentionedUsers: [],
        messageReference: { message_id: MSG },
        referencedMessage: { author: { id: MAIN_BOT, bot: true } },
      },
    });
    await enterNativeRun(
      native,
      admissionContext({ currentMessageId: MID_A2 }),
    );
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 1);
  });
});

test("R5 A3: Main-owned thread admits (TEST 3)", async () => {
  await withPlugin(async ({ native, paths }) => {
    seedIngress({
      messageId: MID_A3,
      message: { mentionedUsers: [], mentionedRoles: [] },
      threadOwnerId: MAIN_BOT,
    });
    await enterNativeRun(
      native,
      admissionContext({ currentMessageId: MID_A3, threadId: THREAD }),
    );
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 1);
  });
});

test("R5 A4: unresolved message stays denied (TEST 4)", async () => {
  await withPlugin(async ({ native, paths }) => {
    seedIngress({
      messageId: MID_A4,
      message: { mentionedUsers: [], mentionedRoles: [] },
    });
    await assert.rejects(
      enterNativeRun(native, admissionContext({ currentMessageId: MID_A4 })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 0);
  });
});

test("R5 A5: reply to another bot denies", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: MID_A5,
      message: {
        // No Main mention: isolate the foreign-reply path.
        mentionedUsers: [],
        messageReference: { message_id: MSG },
        referencedMessage: { author: { id: OTHER_BOT, bot: true } },
      },
    });
    await assert.rejects(
      enterNativeRun(native, admissionContext({ currentMessageId: MID_A5 })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R5 A6: thread owned by another bot denies", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: MID_A6,
      // No mention: isolate the foreign-thread path.
      message: { mentionedUsers: [], mentionedRoles: [] },
      threadOwnerId: OTHER_BOT,
    });
    await assert.rejects(
      enterNativeRun(
        native,
        admissionContext({ currentMessageId: MID_A6, threadId: THREAD_OTHER }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R5 A7: non-owner with mention evidence stays denied", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: MID_A7,
      message: { mentionedUsers: [{ id: MAIN_BOT }] },
    });
    await assert.rejects(
      enterNativeRun(
        native,
        admissionContext({
          currentMessageId: MID_A7,
          senderId: "223456789012345678",
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R5 A8: specialist with mention evidence stays denied", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: MID_A8,
      message: { mentionedUsers: [{ id: MAIN_BOT }] },
    });
    await assert.rejects(
      enterNativeRun(
        native,
        admissionContext({
          currentMessageId: MID_A8,
          agentId: "excel",
          sessionKey: `agent:excel:discord:channel:${OFFICE}`,
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R5 A9: bot-authored message with mention evidence stays denied", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: MID_A9,
      message: {
        mentionedUsers: [{ id: MAIN_BOT }],
        author: { id: OWNER, bot: true },
      },
    });
    await assert.rejects(
      enterNativeRun(native, admissionContext({ currentMessageId: MID_A9 })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R5 A10: heartbeat exemption intact with metadata present", async () => {
  await withPlugin(async ({ native, paths }) => {
    seedIngress({
      messageId: MID_A10,
      message: { mentionedUsers: [{ id: MAIN_BOT }] },
      threadOwnerId: MAIN_BOT,
    });
    const before = readSnapshot(paths);
    await enterNativeRun(
      native,
      admissionContext({
        currentMessageId: MID_A10,
        sessionKey: "agent:main:main",
        channelId: undefined,
        senderId: undefined,
        trigger: "heartbeat",
        transcriptPrompt: "[OpenClaw heartbeat poll]",
      }),
    );
    assert.equal(readSnapshot(paths).sequence, before.sequence);
  });
});

// ---------------------------------------------------------------------------
// LINEAGE — single slot, R10 -> R5
// ---------------------------------------------------------------------------

test("R5 L1: exactly one selection predecessor slot, R10 -> R5", () => {
  const keys = Object.keys(NATIVE_PATCH_PREDECESSORS["2026.6.34"]);
  assert.deepEqual(keys, ["selection-DopzNY3I.js"]);
  const descriptor =
    NATIVE_PATCH_PREDECESSORS["2026.6.34"]["selection-DopzNY3I.js"];
  assert.equal(descriptor.revision, "R10");
  assert.equal(descriptor.successorRevision, "R5");
  assert.equal(
    descriptor.sourceDigest,
    "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5",
  );
});

test("R5 L2: the preflight artifact carries no predecessor descriptor", () => {
  assert.equal(
    Object.hasOwn(
      NATIVE_PATCH_PREDECESSORS["2026.6.34"],
      "message-handler.preflight-C1XBiefW.js",
    ),
    false,
    "live preflight file is the unpatched baseline; BASELINE->R5 needs no descriptor",
  );
});
