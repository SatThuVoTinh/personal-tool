// M10/T2-R8 — ingress metadata source diagnostics.
//
// The union-sources repair did NOT recover the structured mention: after it,
// a real owner message that Discord autocomplete-tagged Main still reached
// admission as `mentions=0`. Every structured source the seam can see is
// already read by the repair, so the remaining question is strictly
// observational: did Discord deliver `mentions[]` at all, and if so which
// source carried it and where it was lost.
//
// This suite pins the instrumentation that answers it, and pins what it must
// never do: emit message content, sender identity, or any secret. Only
// per-source COUNTS and one boolean about whether the content carries a
// mention token.
import assert from "node:assert/strict";
import test from "node:test";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import {
  DISCORD_PREFLIGHT_INJECTION,
  ZINK_INGRESS_METADATA_KEY,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const MAIN_BOT = DISCORD_BOT_IDS.main;
const MSG = "1545430000000000077";

function runInjection({ message, threadOwnerId, params }) {
  const lines = [];
  const logger = {
    info: (line) => lines.push(String(line)),
    warn: () => {},
    error: () => {},
  };
  const factory = new Function(
    "message",
    "threadOwnerId",
    "params",
    "logger",
    "globalThis",
    DISCORD_PREFLIGHT_INJECTION,
  );
  factory(message, threadOwnerId, params, logger, globalThis);
  const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
  return {
    lines,
    record: registry instanceof Map ? registry.get(MSG) : undefined,
  };
}

const msg = (over = {}) => ({
  id: MSG,
  content: "hello",
  mentionedUsers: [],
  mentionedRoles: [],
  mentionedEveryone: false,
  messageReference: null,
  referencedMessage: null,
  author: { id: "223456789012345678", bot: false },
  rawDataValue: null,
  ...over,
});

const dispatch = (over = {}) => ({
  id: MSG,
  content: "hello",
  mentions: [],
  mention_roles: [],
  mention_everyone: false,
  author: { id: "223456789012345678", bot: false },
  ...over,
});

function field(line, key) {
  const match = new RegExp(`\\b${key}=(\\S+)`).exec(line);
  return match ? match[1] : null;
}

test("R8 D1: one diagnostic line is emitted per inbound message", () => {
  const { lines } = runInjection({
    message: msg(),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  const emitted = lines.filter((l) => l.includes("[zink-ingress-meta]"));
  assert.equal(emitted.length, 1, "exactly one diagnostic per inbound message");
});

test("R8 D2: per-source counts are reported for every structured source", () => {
  const { lines } = runInjection({
    message: msg({
      rawDataValue: { mentions: [{ id: MAIN_BOT }], mention_roles: ["1"] },
    }),
    threadOwnerId: null,
    params: { data: dispatch({ mentions: [{ id: MAIN_BOT }] }) },
  });
  const line = lines.find((l) => l.includes("[zink-ingress-meta]"));
  assert.equal(field(line, "wu"), "0", "wrapper mentionedUsers");
  assert.equal(field(line, "wr"), "0", "wrapper mentionedRoles");
  assert.equal(field(line, "ru"), "1", "rawDataValue mentions");
  assert.equal(field(line, "rr"), "1", "rawDataValue mention_roles");
  assert.equal(field(line, "du"), "1", "dispatch mentions");
});
test("R8 D3: the diagnostic never reads or logs message content", () => {
  // R5 H2 forbids reading message text in this path and that prohibition is
  // preserved: a content-derived value would be the first one in the admission
  // metadata path. The per-source counts already answer the question that
  // matters: did Discord deliver mentions[], and which source carried it.
  const body = "xin chao rat vui";
  const { lines } = runInjection({
    message: msg({ content: body }),
    threadOwnerId: null,
    params: { data: dispatch({ content: body }) },
  });
  const line = lines.find((l) => l.includes("[zink-ingress-meta]"));
  assert.ok(line, "a diagnostic must be emitted");
  assert.equal(line.includes(body), false, "content must never be logged");
  assert.equal(line.includes(MAIN_BOT), false, "no mention id may be logged");
  assert.equal(
    DISCORD_PREFLIGHT_INJECTION.includes("message.content"),
    false,
    "the injection must not read message content",
  );
  assert.equal(
    DISCORD_PREFLIGHT_INJECTION.includes("zinkRaw.content"),
    false,
    "the injection must not read the raw dispatch content",
  );
  assert.equal(
    field(line, "mu"),
    "0",
    "the unioned user count is still reported",
  );
});

test("R8 D4: diagnostics are emitted even when the registry write is skipped", () => {
  // A malformed message id means no registry record is written; the seam still
  // has to say what it saw, otherwise a miss is indistinguishable from silence.
  const { lines } = runInjection({
    message: msg({ id: "not-a-snowflake" }),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  const emitted = lines.filter((l) => l.includes("[zink-ingress-meta]"));
  assert.equal(emitted.length, 1, "a skipped write must still be observable");
});

test("R8 D5: a missing logger degrades without breaking preflight", () => {
  const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
  if (registry instanceof Map) registry.clear();
  assert.doesNotThrow(() => {
    const factory = new Function(
      "message",
      "threadOwnerId",
      "params",
      "globalThis",
      DISCORD_PREFLIGHT_INJECTION,
    );
    factory(msg(), null, { data: dispatch() }, globalThis);
  });
  const record = globalThis[ZINK_INGRESS_METADATA_KEY].get(MSG);
  assert.ok(record, "the registry write must still happen without a logger");
});

test("R8 D6: the union behaviour itself is unchanged by the diagnostics", () => {
  const { record } = runInjection({
    message: msg(),
    threadOwnerId: null,
    params: { data: dispatch({ mentions: [{ id: MAIN_BOT }] }) },
  });
  assert.deepEqual([...record.mentionedUserIds], [MAIN_BOT]);
});
