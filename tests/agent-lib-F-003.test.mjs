// M12/T9 F-003 (R1-A09-03): #incidents could never post. The dedupe read used
// `GET /channels/{id}/threads/active`, a route Discord DECOMMISSIONED in API
// v10 in favour of `GET /guilds/{guild.id}/threads/active`.
//
// Every call therefore answered 404, the read threw, and the incident surface
// was SKIPPED before any POST: a governance containment never reached
// #incidents at all, while the plan credits #incidents with a first publish
// path.
//
// The lanes below pin the route, the guild scoping and the named refusal. The
// companion in `tests/m12-t2-forum-tags.test.mjs` (the shared fake) must be
// updated by its owner: the fake answers the channel-scoped route only.
import assert from "node:assert/strict";
import { test } from "node:test";

import { readActiveForumThreads } from "../integrations/openclaw/lib/discord-forum-tags.mjs";

const FORUM = "1000000000000000003";
const GUILD = "1000000000000000009";

function stubFetch(
  threads = [],
  { channelBody = { id: FORUM, guild_id: GUILD } } = {},
) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/channels/")) {
      return { ok: true, json: async () => channelBody };
    }
    return {
      ok: true,
      json: async () => ({ threads, has_more: false }),
    };
  };
  return { calls, fetchImpl };
}

test("F-003: the dedupe read uses the guild-scoped active-thread listing", async () => {
  const { calls, fetchImpl } = stubFetch([
    { id: "t1", name: "INCIDENT ABCDEF", parent_id: FORUM },
  ]);
  const listing = await readActiveForumThreads({
    channelId: FORUM,
    token: "t",
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.equal(listing.threads.length, 1);
  assert.ok(
    calls.some((url) => url.includes(`/guilds/${GUILD}/threads/active`)),
    `the guild-scoped route must be used, got ${calls.join(", ")}`,
  );
  assert.equal(
    calls.some((url) => url.includes(`/channels/${FORUM}/threads/active`)),
    false,
    "the decommissioned channel-scoped route must not be used",
  );
});

test("F-003: a thread of another channel is not this forum's thread", async () => {
  const { fetchImpl } = stubFetch([
    { id: "t1", name: "INCIDENT ELSEWHERE", parent_id: "1000000000000000004" },
    { id: "t2", name: "INCIDENT MINE", parent_id: FORUM },
  ]);
  const listing = await readActiveForumThreads({
    channelId: FORUM,
    token: "t",
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.equal(listing.threads.length, 1);
  assert.equal(listing.threads[0].id, "t2");
});

test("F-003: a channel that names no guild is refused by name", async () => {
  const { fetchImpl } = stubFetch([], { channelBody: { id: FORUM } });
  await assert.rejects(
    () =>
      readActiveForumThreads({
        channelId: FORUM,
        token: "t",
        fetchImpl,
        deadlineMs: 5000,
      }),
    /FORUM_TAG_GUILD_REQUIRED/u,
    "a forum whose guild is unknown must be a named refusal, never a guess",
  );
});

test("F-003: the caller's guild id is used without a second read", async () => {
  const { calls, fetchImpl } = stubFetch([
    { id: "t1", name: "INCIDENT ABCDEF", parent_id: FORUM },
  ]);
  const listing = await readActiveForumThreads({
    channelId: FORUM,
    guildId: GUILD,
    token: "t",
    fetchImpl,
    deadlineMs: 5000,
  });
  assert.equal(listing.threads.length, 1);
  assert.equal(
    calls.filter((url) => url.includes("/channels/")).length,
    0,
    "a caller that knows the guild must not pay for a channel read",
  );
});
