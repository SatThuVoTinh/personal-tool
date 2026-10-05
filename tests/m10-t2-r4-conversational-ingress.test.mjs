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
//
// M10/T2-R5 UPDATE: the attribution map above is RETIRED, replaced by the
// host-resolved threadOwnerId forwarded from the Discord preflight seam
// (authoritative, no memory, no eviction semantics to defend). The verdict
// contract is unchanged; only the ownership source moved. Tests below pass
// threadOwnerId directly (see tests/m10-t2-r5-host-inbound-metadata).
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
  DISCORD_BOT_IDS,
} from "../integrations/openclaw/lib/authority.mjs";
import { DISCORD_PREFLIGHT_INJECTION } from "../integrations/openclaw/topology/lib/native-patch.mjs";

const MAIN_BOT = DISCORD_BOT_IDS.main;
// Unique message ids per admission test: Discord ids are unique in
// production, and the stash is messageId-keyed, so fixtures must not reuse
// them across tests sharing one process.
const MID_R4_A1 = "1545430000000000201";

/**
 * Seed inbound metadata through the REAL preflight injection snippet.
 *
 * M10/T2-R8: the injection awaits the preflight intake gate and the host
 * function it lives in is `async`, so the harness must be async too. The route
 * is Main on purpose — these fixtures exercise ingress metadata and Main-owned
 * conversation admission, so the gate admits and the injection runs fully.
 */
function seedIngress({ messageId, threadOwnerId } = {}) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const factory = new AsyncFunction(
    "message",
    "threadOwnerId",
    "globalThis",
    "effectiveRoute",
    "resolvedAccountId",
    DISCORD_PREFLIGHT_INJECTION,
  );
  return factory(
    {
      id: messageId,
      content: "hello",
      mentionedUsers: [],
      mentionedRoles: [],
      messageReference: null,
      referencedMessage: null,
      author: { id: OWNER, bot: false },
      thread: null,
    },
    threadOwnerId ?? null,
    globalThis,
    { agentId: "main" },
    "acct-main",
  );
}

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
    // NOTE: threadOwnerId travels via the preflight stash + boundary, NOT
    // the selection patch, so it is passed per-test through overrides only.
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

/** The R4 outbound-attribution seeding helper is retired with the cache it
 * fed (see header). Fixtures now carry the host-resolved owner directly. */

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

test("R4 N3: exactly one selection predecessor slot, R10 -> R5", async () => {
  // M10/T2-R5 UPDATE: the slot leads to R5 (the R4 tree state was never
  // deployed, so the descriptor follows the deployed chain R10→R5; the R4
  // selection bytes equal the R5 selection bytes and R4 history stays here).
  //
  // M10/T2-R8 UPDATE: this previously asserted the lineage table had exactly
  // one key. That was broader than the invariant it exists to protect. The
  // mechanism's rule is per-ARTIFACT ("a descriptor binds one artifact for
  // one release"): R8 legitimately added a slot for a DIFFERENT artifact (the
  // Discord preflight file) and did not touch the selection slot. The pin now
  // asserts the real rule — the selection artifact keeps exactly one slot
  // with its exact chain — and separately asserts the pre-artifact rule that
  // no artifact ever carries more than one slot. The second assertion is
  // what makes this a tightening rather than a relaxation.
  const mod = await import(pathToFileURL(PATCHER).href);
  const table = mod.NATIVE_PATCH_PREDECESSORS?.["2026.6.34"];
  assert.ok(table, "the 2026.6.34 lineage table must exist");
  assert.ok(
    Object.keys(table).includes("selection-DopzNY3I.js"),
    "the selection artifact must have a predecessor slot",
  );
  // Per-artifact invariant: no artifact may carry more than one slot, and no
  // descriptor may claim two different successor revisions for the same
  // artifact. Slots for other artifacts are legitimate (R8 preflight).
  assert.equal(
    new Set(Object.keys(table)).size,
    Object.keys(table).length,
    "artifact keys must be unique",
  );
  const descriptor = table["selection-DopzNY3I.js"];
  assert.equal(descriptor.revision, "R10");
  assert.equal(descriptor.successorRevision, "R5");
  assert.equal(
    descriptor.sourceDigest,
    "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5",
    "the predecessor is the deployed R10 selection, byte-exact",
  );
  // The selection slot itself must be the ONLY descriptor that supersedes the
  // selection patch: a second slot reaching the same artifact would make the
  // forward transition ambiguous. Matched on the region's own invocation, not
  // the bare symbol name — M10/T2-R8 prose in the preflight seam also mentions
  // `enterNativeRun`, and a prose mention is not a slot on the selection region.
  const selectionSupersedes = new Set(
    Object.values(table)
      .filter((entry) =>
        entry.supersedes.includes("await enterNativeRun(params.config"),
      )
      .map((entry) => entry.supersedes),
  );
  assert.equal(
    selectionSupersedes.size,
    1,
    "exactly one descriptor may target the selection injection slot",
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
    threadOwnerId: MAIN_BOT,
    mainBotId: MAIN_BOT,
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
      threadOwnerId: MAIN_BOT,
      mainBotId: MAIN_BOT,
      missingMentionRefusal: refusal,
    });
    assert.equal(verdict.admitted, false);
    assert.equal(verdict.classification, MAIN_NOT_CONFIRMED);
  }
});

test("R4 C3: thread owned by another bot denies", () => {
  const verdict = resolveMainConversationAdmission({
    agentId: "main",
    threadId: THREAD_MAIN,
    threadOwnerId: "1545438637750227104",
    mainBotId: MAIN_BOT,
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
      threadOwnerId: MAIN_BOT,
      mainBotId: MAIN_BOT,
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
      threadOwnerId: MAIN_BOT,
      mainBotId: MAIN_BOT,
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
      threadOwnerId: MAIN_BOT,
      mainBotId: MAIN_BOT,
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false, `threadId=${String(threadId)}`);
  }
});

test("R4 C7: absent or foreign ownership denies", () => {
  for (const threadOwnerId of [null, undefined, "", "123", THREAD_OTHER]) {
    const verdict = resolveMainConversationAdmission({
      agentId: "main",
      threadId: THREAD_MAIN,
      threadOwnerId,
      mainBotId: MAIN_BOT,
      missingMentionRefusal: true,
    });
    assert.equal(verdict.admitted, false);
  }
});

// ---------------------------------------------------------------------------
// ADMISSION END-TO-END — the real seam, isolated fixtures
// ---------------------------------------------------------------------------

test("R4 A1: owner message in a Main-owned thread is admitted (TEST 3)", async () => {
  await withPlugin(async ({ native, paths }) => {
    // Ownership arrives via the preflight stash (production path), never as
    // a direct context field.
    seedIngress({ messageId: MID_R4_A1, threadOwnerId: MAIN_BOT });
    await enterNativeRun(
      native,
      productionContext({
        currentMessageId: MID_R4_A1,
        threadId: THREAD_MAIN,
      }),
    );
    const snapshot = readSnapshot(paths);
    const tasks = Object.values(snapshot.tasks);
    assert.equal(tasks.length, 1, "admission opens exactly one task");
    assert.equal(tasks[0].root_agent_id, "main");
    // The admitted message is now a handled message: a replay denies.
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          currentMessageId: MID_R4_A1,
          threadId: THREAD_MAIN,
        }),
      ),
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

test("R4 A3: message in a thread Main does not own stays denied (TEST 8)", async () => {
  await withPlugin(async ({ native }) => {
    // Ownership evidence present but foreign: must still deny.
    seedIngress({
      messageId: "1545430000000000203",
      threadOwnerId: "1545438637750227104",
    });
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          currentMessageId: "1545430000000000203",
          threadId: THREAD_OTHER,
        }),
      ),
      /GOVERNANCE_RUN_UNAVAILABLE/u,
    );
  });
});

test("R4 A4: specialist in a Main-owned thread stays denied (TEST 9)", async () => {
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: "1545430000000000204",
      threadOwnerId: MAIN_BOT,
    });
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          currentMessageId: "1545430000000000204",
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
  await withPlugin(async ({ native }) => {
    seedIngress({
      messageId: "1545430000000000205",
      threadOwnerId: MAIN_BOT,
    });
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({
          currentMessageId: "1545430000000000205",
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
  await withPlugin(async ({ native }) => {
    await assert.rejects(
      enterNativeRun(
        native,
        productionContext({ threadId: "office", threadOwnerId: MAIN_BOT }),
      ),
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
