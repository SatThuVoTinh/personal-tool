// M10/T2-R8 — raw gateway mention fallback (H1 repair).
//
// Live evidence (owner TEST A, structured @Main via autocomplete, msg
// 1556249093729427459): every worker reached native admission with
// mentions=0 while currentMessageId was correctly forwarded (H2
// disproven), and botUserId is correct live (journal probe). The
// discord.js wrapper observed at the R5 injection point therefore
// carries empty mention arrays for this inbound message. The raw
// gateway dispatch (`params.data`, which createMessageDispatchData
// spreads) is the authoritative structured source at the same seam;
// the wrapper may diverge from it (partial messages, synthetic
// debounce-batch rebuilds, hydration merges). This repair unions every
// structured source available at the seam — wrapper getters, the
// message's own rawDataValue, and the raw dispatch payload — while
// keeping every R5 invariant: structured snowflake IDs only, exact
// roster match downstream, no text heuristics, fail-closed on any
// unexpected shape.
import assert from "node:assert/strict";
import test from "node:test";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import {
  DISCORD_PREFLIGHT_INJECTION,
  ZINK_INGRESS_METADATA_KEY,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const MAIN_BOT = DISCORD_BOT_IDS.main;
const MSG = "1545430000000000042";

/** Run the REAL preflight injection snippet in a synthetic host scope. */
function runPreflightInjection({ message, threadOwnerId, params } = {}) {
  const factory = new Function(
    "message",
    "threadOwnerId",
    "params",
    "globalThis",
    DISCORD_PREFLIGHT_INJECTION,
  );
  factory(message, threadOwnerId, params, globalThis);
}

function readStash(msgId) {
  const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
  return registry instanceof Map ? registry.get(msgId) : undefined;
}

function clearStash() {
  const registry = globalThis[ZINK_INGRESS_METADATA_KEY];
  if (registry instanceof Map) registry.clear();
}

/** discord.js-shaped message. Deny-by-default: no mentions anywhere. */
const discordMessage = (overrides = {}) => ({
  id: MSG,
  content: "hello",
  mentionedUsers: [],
  mentionedRoles: [],
  mentionedEveryone: false,
  messageReference: null,
  referencedMessage: null,
  author: { id: "223456789012345678", bot: false },
  rawDataValue: null,
  ...overrides,
});

/** Raw gateway dispatch payload for the same message. */
const rawDispatch = (overrides = {}) => ({
  id: MSG,
  channel_id: "1545425766161063937",
  author: { id: "223456789012345678", bot: false },
  content: "hello",
  mentions: [],
  mention_roles: [],
  mention_everyone: false,
  ...overrides,
});

test("R8 F1: wrapper-empty but rawDataValue carries Main preserves Main", () => {
  clearStash();
  runPreflightInjection({
    message: discordMessage({
      rawDataValue: {
        mentions: [{ id: MAIN_BOT, username: "main" }],
      },
    }),
    threadOwnerId: null,
    params: { data: rawDispatch() },
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [MAIN_BOT],
    "the rawDataValue Main mention must be preserved",
  );
});

test("R8 F2: wrapper-empty and rawDataValue-empty but dispatch carries Main preserves Main", () => {
  clearStash();
  runPreflightInjection({
    message: discordMessage(),
    threadOwnerId: null,
    params: {
      data: rawDispatch({ mentions: [{ id: MAIN_BOT, username: "main" }] }),
    },
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [MAIN_BOT],
    "the dispatch Main mention must be preserved",
  );
});

test("R8 F3: all sources empty records empty (deny preserved)", () => {
  clearStash();
  runPreflightInjection({
    message: discordMessage(),
    threadOwnerId: null,
    params: { data: rawDispatch() },
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [],
    "no structured mention anywhere must stay empty",
  );
});

test("R8 F4: wrapper-present still records without params (legacy scope intact)", () => {
  clearStash();
  runPreflightInjection({
    message: discordMessage({ mentionedUsers: [{ id: MAIN_BOT }] }),
    threadOwnerId: null,
    params: undefined,
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [MAIN_BOT],
    "wrapper mentions must record even when params is absent",
  );
});

test("R8 F5: dispatch role mention for Main is preserved", () => {
  clearStash();
  const MAIN_ROLE = "1545471797452087390";
  runPreflightInjection({
    message: discordMessage(),
    threadOwnerId: null,
    params: { data: rawDispatch({ mention_roles: [MAIN_ROLE] }) },
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedRoleIds],
    [MAIN_ROLE],
    "the dispatch Main role mention must be preserved",
  );
});

test("R8 F6: malformed raw entries are dropped, valid kept", () => {
  clearStash();
  runPreflightInjection({
    message: discordMessage(),
    threadOwnerId: null,
    params: {
      data: rawDispatch({
        mentions: [{ id: "not-a-snowflake" }, { id: MAIN_BOT }],
      }),
    },
  });
  const record = readStash(MSG);
  assert.ok(record, "a record must be written");
  assert.deepEqual(
    [...record.mentionedUserIds],
    [MAIN_BOT],
    "only well-formed snowflakes survive",
  );
});
