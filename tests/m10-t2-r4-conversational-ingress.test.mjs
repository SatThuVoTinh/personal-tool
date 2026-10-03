// M10/T2-R4 — Main conversational ingress via native thread metadata.
//
// Forensic result (R3 deployment): every free-text Discord ingress turn is
// denied at the native admission seam with MISSING_MENTION, because the seam
// structurally cannot observe mentions, reply references, or authorship —
// the frozen patch forwards only agentId/sessionKey/runId/channelId/
// senderId/currentMessageId/trigger/transcriptPrompt. @main therefore does
// NOT work as an ingress signal today either; there is no working path to
// preserve, only a denied one to repair where deterministic evidence exists.
//
// Host census on pinned 2026.6.34 (read-only) proved exactly ONE additional
// deterministic inbound field available in runEmbeddedAttempt params:
// `currentThreadId` (0 occurrences of mentions/reply-reference/author in
// the 644KB selection bundle). R4 forwards threadId and admits an owner
// message in a Main-owned thread (MAIN_CONVERSATION_CONTINUATION).
// Mention and reply attribution stay denied — documented, not heuristically
// approximated — as do ordinary unresolved #office messages.
//
// Thread ownership is established WITHOUT races or caches-with-timing:
// Main's own outbound posts pass the awaited `message_sending` hook (which
// carries threadId + agentId), so a bounded memory-only attribution map
// recorded there strictly precedes any later human reply in that thread.
// Eviction degrades to deny; restart loses bindings and degrades to deny.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { enterNativeRun } from "../integrations/openclaw/topology/lib/native-boundary.mjs";
import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";
import { AGENT_IDS } from "../integrations/openclaw/lib/policy.mjs";
import { agentInstructions } from "../integrations/openclaw/lib/policy.mjs";
import {
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  resolveMainConversationAdmission,
  MAIN_CONVERSATION_CONTINUATION,
  MAIN_NOT_CONFIRMED,
} from "../integrations/openclaw/lib/authority.mjs";

const REPO = process.cwd();
const PATCHER = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-patch.mjs",
);
const CONFIGURE_SOURCE = readFileSync(
  path.join(REPO, "integrations", "openclaw", "configure.mjs"),
  "utf8",
);
const OWNER = "123456789012345678";
const OFFICE = "1545425766161063937";
// Valid Discord snowflakes (19 digits, leading non-zero) for fixtures.
const THREAD_MAIN = "1545430000000000001";
const THREAD_OTHER = "1545430000000000002";
const MSG = "1545430000000000009";

/** Field names the pinned patch passes into enterNativeRun, read from source. */
const injectedFields = () => {
  const source = readFileSync(PATCHER, "utf8");
  const at = source.indexOf("await enterNativeRun(params.config");
  assert.notEqual(at, -1, "the native patch must still inject enterNativeRun");
  const raw = source.slice(at, source.indexOf("}, params.abortSignal)", at));
  const block = raw.replaceAll("\\t", " ");
  return [...block.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/gu)].map(
    (m) => m[1],
  );
};

/** Production-shaped admission context: only injected fields. */
const productionContext = (overrides = {}) => {
  const fields = injectedFields();
  const values = {
    agentId: "main",
    sessionKey: `agent:main:discord:channel:${OFFICE}`,
    runId: "r4-run-1",
    inputProvenance: undefined,
    channelId: "discord",
    senderId: OWNER,
    currentMessageId: MSG,
    trigger: "user",
    transcriptPrompt: undefined,
    threadId: undefined,
  };
  const context = {};
  for (const field of fields) context[field] = values[field];
  return { ...context, ...overrides };
};

const nativeConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

async function withPlugin(body) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r4-"));
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
    },
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

/** Seed a Main-owned thread binding through the REAL outbound hook. */
async function seedMainThread(hooks, threadId) {
  const send = hooks.get("message_sending");
  assert.ok(typeof send === "function", "message_sending hook must exist");
  const out = await send(
    { content: "Main reply", to: `channel:${OFFICE}` },
    {
      channelId: "discord",
      sessionKey: "agent:main:discord:channel:1",
      agentId: "main",
      threadId,
    },
  );
  assert.ok(!out?.block, "Main outbound post must not be blocked");
}

// ---------------------------------------------------------------------------
// NATIVE CONTRACT — the injection itself
// ---------------------------------------------------------------------------

test("R4 N1: the native patch forwards deterministic threadId", () => {
  const fields = injectedFields();
  assert.ok(
    fields.includes("threadId"),
    "native patch must inject threadId for Main conversation admission",
  );
});

test("R4 N2: the native patch still grows no unstructured Discord fields", () => {
  const fields = injectedFields();
  for (const forbidden of [
    "mentions",
    "mentionedUserIds",
    "replyReference",
    "replyReferenceMessageId",
    "replyReferenceAuthorId",
    "isBot",
    "message",
    "author",
    "events",
    "payloads",
    "request",
  ]) {
    assert.equal(
      fields.includes(forbidden),
      false,
      `native patch must not inject ${forbidden}: unavailable or unstructured`,
    );
  }
});

test("R4 N3: exactly one selection predecessor slot, R10 -> R4", async () => {
  const mod = await import(pathToFileURL(PATCHER).href);
  const table = mod.NATIVE_PATCH_PREDECESSORS?.["2026.6.34"];
  assert.ok(table, "the 2026.6.34 lineage table must exist");
  const keys = Object.keys(table);
  assert.deepEqual(
    keys,
    ["selection-DopzNY3I.js"],
    "exactly one active deployment slot for the selection artifact",
  );
  const descriptor = table["selection-DopzNY3I.js"];
  assert.equal(descriptor.revision, "R10");
  assert.equal(descriptor.successorRevision, "R4");
  assert.equal(
    descriptor.sourceDigest,
    "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5",
    "the predecessor is the deployed R10 selection, byte-exact",
  );
});

test("R4 N4: the outgoing R3 entrypoint is admitted in both per-mode lists", () => {
  const digest =
    "d1ce63868680ea5f89721ae8b42f07f6f033a840606cdc3a7cd7b6556b3ab593";
  assert.equal(
    CONFIGURE_SOURCE.split(digest).length - 1,
    2,
    "the R3 entrypoint must be admitted in the preflight AND apply lists",
  );
});

// ---------------------------------------------------------------------------
// CLASSIFIER — pure, deterministic, no state
// ---------------------------------------------------------------------------

test("R4 C1: Main-owned thread with missing-mention refusal admits", () => {
  const verdict = resolveMainConversationAdmission({
    agentId: "main",
    threadId: THREAD_MAIN,
    mainThreadIds: [THREAD_MAIN],
    missingMentionRefusal: true,
  });
  assert.equal(verdict.admitted, true);
  assert.equal(verdict.classification, MAIN_CONVERSATION_CONTINUATION);
});

test("R4 C2: a non-mention refusal reason is never bypassed", () => {
  for (const refusal of [false, null, undefined]) {
    const verdict = resolveMainConversationAdmission({
      agentId: "main",
      threadId: THREAD_MAIN,
      mainThreadIds: [THREAD_MAIN],
      missingMentionRefusal: refusal,
    });
    assert.equal(verdict.admitted, false);
    assert.equal(verdict.classification, MAIN_NOT_CONFIRMED);
  }
});

test("R4 C3: unowned thread denies", () => {
  const verdict = resolveMainConversationAdmission({
    agentId: "main",
    threadId: THREAD_OTHER,
    mainThreadIds: [THREAD_MAIN],
    missingMentionRefusal: true,
  });
  assert.equal(verdict.admitted, false);
  assert.equal(verdict.classification, MAIN_NOT_CONFIRMED);
});

test("R4 C4: absent threadId never infers a conversation", () => {
  for (const threadId of [null, undefined, ""]) {
    const verdict = resolveMainConversationAdmission({
      agentId: "main",
      threadId,
      mainThreadIds: [THREAD_MAIN],
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false, `threadId=${String(threadId)}`);
  }
});

test("R4 C5: specialist with an owned thread still denies", () => {
  for (const agentId of ["o1", "o2", "excel", "power-bi", "sql", "python"]) {
    const verdict = resolveMainConversationAdmission({
      agentId,
      threadId: THREAD_MAIN,
      mainThreadIds: [THREAD_MAIN],
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false, agentId);
    assert.equal(verdict.classification, MAIN_NOT_CONFIRMED);
  }
});

test("R4 C6: malformed thread identity denies", () => {
  for (const threadId of ["office", "123", "0", "abc", 12345, {}]) {
    const verdict = resolveMainConversationAdmission({
      agentId: "main",
      threadId,
      mainThreadIds: [THREAD_MAIN, "123"],
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false, `threadId=${String(threadId)}`);
  }
});

test("R4 C7: empty bindings deny", () => {
  for (const mainThreadIds of [[], null, undefined]) {
    const verdict = resolveMainConversationAdmission({
      agentId: "main",
      threadId: THREAD_MAIN,
      mainThreadIds,
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false);
  }
});

// ---------------------------------------------------------------------------
// ADMISSION END-TO-END — the real seam, isolated fixtures
// ---------------------------------------------------------------------------

test("R4 A1: owner message in a Main-owned thread is admitted (TEST 3)", async () => {
  await withPlugin(async ({ hooks, native, paths }) => {
    await seedMainThread(hooks, THREAD_MAIN);
    await enterNativeRun(native, productionContext({ threadId: THREAD_MAIN }));
    const snapshot = readSnapshot(paths);
    const tasks = Object.values(snapshot.tasks);
    assert.equal(tasks.length, 1, "admission opens exactly one task");
    assert.equal(tasks[0].root_agent_id, "main");
    // The admitted message is now a handled message: a replay denies.
    await assert.rejects(
      enterNativeRun(native, productionContext({ threadId: THREAD_MAIN })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A2: owner message with no thread binding stays denied (TEST 5)", async () => {
  await withPlugin(async ({ native, paths }) => {
    await assert.rejects(
      enterNativeRun(native, productionContext()),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
    assert.equal(Object.keys(readSnapshot(paths).tasks).length, 0);
  });
});

test("R4 A3: message in a thread Main never posted in stays denied (TEST 8)", async () => {
  await withPlugin(async ({ hooks, native }) => {
    await seedMainThread(hooks, THREAD_MAIN);
    await assert.rejects(
      enterNativeRun(native, productionContext({ threadId: THREAD_OTHER })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A4: specialist in a Main-owned thread stays denied (TEST 9)", async () => {
  await withPlugin(async ({ hooks, native }) => {
    await seedMainThread(hooks, THREAD_MAIN);
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          agentId: "excel",
          sessionKey: `agent:excel:discord:channel:${OFFICE}`,
          threadId: THREAD_MAIN,
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A5: non-owner sender in a Main-owned thread stays denied", async () => {
  await withPlugin(async ({ hooks, native }) => {
    await seedMainThread(hooks, THREAD_MAIN);
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          senderId: "223456789012345678",
          threadId: THREAD_MAIN,
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A6: heartbeat exemption is intact with threadId present (TEST 10)", async () => {
  await withPlugin(async ({ native, paths }) => {
    const before = readSnapshot(paths);
    await enterNativeRun(
      native,
      productionContext({
        sessionKey: "agent:main:main",
        channelId: undefined,
        senderId: undefined,
        currentMessageId: undefined,
        trigger: "heartbeat",
        transcriptPrompt: "[OpenClaw heartbeat poll]",
        threadId: THREAD_MAIN,
      }),
    );
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence);
  });
});

test("R4 A7: malformed threadId fails closed", async () => {
  await withPlugin(async ({ hooks, native }) => {
    await seedMainThread(hooks, THREAD_MAIN);
    await assert.rejects(
      enterNativeRun(native, productionContext({ threadId: "office" })),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A8: mention-like text without structured evidence stays denied", async () => {
  // "@main" as bare text never reaches the seam as structured metadata, so
  // text pretending to be a mention must not admit. (TESTs 1-2 NOT AVAILABLE.)
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(native, productionContext()),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});
