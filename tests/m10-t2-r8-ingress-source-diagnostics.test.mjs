// M10/T2-R8 — ingress metadata source diagnostics, hardened.
//
// The first diagnostics build produced ZERO lines in the live log while the
// owner's message demonstrably reached admission. The code was in the right
// function with `logger` in scope, which leaves exactly two explanations: the
// `try` threw before reaching the log (hiding the registry write too, behind
// one silent catch), or the single-argument log form was dropped. This suite
// pins the hardened contract that closes both:
//
//   * the diagnostic is emitted FIRST, before any optional source read;
//   * each source count is read defensively and reports -1 when that source
//     THREW, so a failing discord.js getter is visible instead of silent;
//   * a throwing getter never prevents the registry write;
//   * the two-argument log form is used, matching the pattern this codebase
//     demonstrably emits;
//   * content, sender identity and mention ids are never logged.
import assert from "node:assert/strict";
import test from "node:test";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import {
  DISCORD_PREFLIGHT_INJECTION,
  ZINK_INGRESS_METADATA_KEY,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const MAIN_BOT = DISCORD_BOT_IDS.main;
const MSG = "1545430000000000077";

function runInjection({ message, threadOwnerId, params, loggerArg }) {
  const calls = [];
  const stderrLines = [];
  const logger =
    loggerArg === null
      ? undefined
      : (loggerArg ?? {
          info: (...args) => calls.push(args),
          warn: () => {},
          error: () => {},
        });
  const factory = new Function(
    "message",
    "threadOwnerId",
    "params",
    "logger",
    "globalThis",
    "process",
    DISCORD_PREFLIGHT_INJECTION,
  );
  factory(message, threadOwnerId, params, logger, globalThis, {
    stderr: { write: (s) => stderrLines.push(s) },
  });
  const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
  return {
    calls,
    stderr: stderrLines,
    record: registry instanceof Map ? registry.get(MSG) : undefined,
    flat: calls
      .flat()
      .map((a) => (typeof a === "string" ? a : JSON.stringify(a))),
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

function diag(calls) {
  // calls is a list of info(...) argument lists; flatten before matching.
  const flat = calls.flat();
  const at = flat.indexOf("[zink-ingress-meta]");
  assert.notEqual(at, -1, "the marker argument must be present");
  const obj = flat[at - 1];
  assert.ok(
    obj && typeof obj === "object",
    "a structured object must precede it",
  );
  return obj.zinkIngress;
}

test("R8 D1: the two-argument log form carries a structured diagnostic", () => {
  const { calls } = runInjection({
    message: msg(),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  const d = diag(calls);
  assert.equal(d.msg, MSG);
  assert.equal(d.hasDispatch, 1);
  assert.equal(d.hasRawData, 0);
});

test("R8 D2: per-source counts are reported for every structured source", () => {
  const { calls } = runInjection({
    message: msg({
      rawDataValue: { mentions: [{ id: MAIN_BOT }], mention_roles: ["1"] },
    }),
    threadOwnerId: null,
    params: { data: dispatch({ mentions: [{ id: MAIN_BOT }] }) },
  });
  const d = diag(calls);
  assert.deepEqual(
    [d.wu, d.wr, d.ru, d.rr, d.du],
    [0, 0, 1, 1, 1],
    "every structured source must be counted",
  );
});

function hostileMessage(throwingKeys) {
  // Defined, not spread: spreading would EVALUATE the getters during fixture
  // construction, which tests the fixture instead of the injection.
  const base = msg();
  for (const key of throwingKeys) {
    Object.defineProperty(base, key, {
      get() {
        throw new Error("getter exploded");
      },
      enumerable: true,
      configurable: true,
    });
  }
  return base;
}

test("R8 D3: a throwing getter is reported as -1 and does not stop the write", () => {
  const { calls, record } = runInjection({
    message: hostileMessage(["mentionedUsers"]),
    threadOwnerId: null,
    params: { data: dispatch({ mentions: [{ id: MAIN_BOT }] }) },
  });
  const d = diag(calls);
  assert.equal(d.wu, -1, "a throwing source must be visible, not silent");
  assert.ok(record, "the registry write must still happen");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [MAIN_BOT],
    "a throwing wrapper must not lose the other sources",
  );
});

test("R8 D4: the diagnostic is emitted before any source is read", () => {
  // Every source getter throws: the diagnostic must still be produced.
  const { calls } = runInjection({
    message: hostileMessage(["mentionedUsers", "mentionedRoles"]),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  const d = diag(calls);
  assert.equal(d.wu, -1);
  assert.equal(d.wr, -1);
});

test("R8 D5: no content, sender identity or mention id is logged", () => {
  const body = "xin chao rat vui";
  const { calls } = runInjection({
    message: msg({ content: body, mentionedUsers: [{ id: MAIN_BOT }] }),
    threadOwnerId: null,
    params: { data: dispatch({ content: body }) },
  });
  const joined = calls
    .flat()
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  assert.equal(joined.includes(body), false, "content must never be logged");
  assert.equal(
    joined.includes(MAIN_BOT),
    false,
    "mention ids must never be logged",
  );
  assert.equal(
    joined.includes("223456789012345678"),
    false,
    "sender identity must never be logged",
  );
  assert.equal(
    DISCORD_PREFLIGHT_INJECTION.includes("message.content"),
    false,
    "the injection must not read message content",
  );
});

test("R8 D8: a bot-authored message stays denied", () => {
  // The array-count probe must never be reused for a boolean: counting a
  // boolean yields 0, which would silently clear the bot filter.
  const { record } = runInjection({
    message: msg({
      mentionedUsers: [{ id: MAIN_BOT }],
      author: { id: "223456789012345678", bot: true },
    }),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  assert.equal(record.authorIsBot, true, "the bot flag must survive probing");
});

test("R8 D9: a human-authored message is not flagged as a bot", () => {
  const { record } = runInjection({
    message: msg({ author: { id: "223456789012345678", bot: false } }),
    threadOwnerId: null,
    params: {
      data: dispatch({ author: { id: "223456789012345678", bot: false } }),
    },
  });
  assert.equal(record.authorIsBot, false);
});

test("R8 D6: a missing or throwing logger never breaks preflight", () => {
  for (const loggerArg of [
    null,
    {
      info: () => {
        throw new Error("logger down");
      },
    },
  ]) {
    const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
    if (registry instanceof Map) registry.clear();
    const { record } = runInjection({
      message: msg(),
      threadOwnerId: null,
      params: { data: dispatch() },
      loggerArg,
    });
    assert.ok(record, "the registry write must survive any logger problem");
  }
});

test("R8 D7: diagnostics are emitted even when the registry write is skipped", () => {
  const { calls } = runInjection({
    message: msg({ id: "not-a-snowflake" }),
    threadOwnerId: null,
    params: { data: dispatch() },
  });
  const d = diag(calls);
  assert.equal(d.msg, "-", "an invalid id must still be reported");
});

test("R8 D10: the report reaches stderr unfiltered, before the logger call", () => {
  const order = [];
  const logger = {
    info: () => {
      order.push("logger");
    },
  };
  const { stderr } = runInjection({
    message: msg({
      rawDataValue: { mentions: [{ id: MAIN_BOT }], mention_roles: [] },
    }),
    threadOwnerId: null,
    params: { data: dispatch({ mentions: [{ id: MAIN_BOT }] }) },
    loggerArg: logger,
  });
  assert.equal(stderr.length, 1, "exactly one stderr line per inbound message");
  assert.match(stderr[0], /^\[zink-ingress-meta\] /);
  assert.match(stderr[0], /"du":1/);
  assert.match(stderr[0], /"ru":1/);
  assert.equal(order.length, 1, "the child logger still receives the report");
});

test("R8 D11: a broken child logger is reported on stderr, never swallowed", () => {
  const { stderr, record } = runInjection({
    message: msg({ mentionedUsers: [{ id: MAIN_BOT }] }),
    threadOwnerId: null,
    params: { data: dispatch() },
    loggerArg: {
      info: () => {
        throw new Error("logger down");
      },
    },
  });
  assert.ok(
    stderr.some((line) => line.includes("child logger unavailable")),
    "a silent catch here is what hid the last two builds",
  );
  assert.ok(record, "the registry write must already have happened");
});
