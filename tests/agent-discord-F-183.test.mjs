/**
 * M12/T9 F-183 (legacy `R1-A09-06`) — the native Discord outbound seam is
 * unbounded.
 *
 * `integrations/openclaw/lib/discord-native-send.mjs` awaited
 * `adapter.sendPayload(context)` with no deadline and no AbortSignal, so a
 * never-settling adapter pinned the announce/send seam forever. The REST fetch
 * sites already carry one exported bound (`DISCORD_REST_DEADLINE_MS`); the
 * native seam had none.
 *
 * The deadline is INJECTED, never shortened in production: the test passes a
 * short `deadlineMs`, and the production default stays the same bound the REST
 * sites use. Every test here bounds its own wait, so removing the control makes
 * a test fail on a timeout instead of hanging the suite.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  sendNativePayload,
  DISCORD_NATIVE_DEADLINE_MS,
  NATIVE_DELIVERY_TIMEOUT,
  NATIVE_DELIVERY_RATE_LIMITED,
} from "../integrations/openclaw/lib/discord-native-send.mjs";

/**
 * The `mockApi(calls)` idiom of `tests/m8-t2-native-outbound.test.mjs:19-40`,
 * with the adapter's `sendPayload` replaceable so a case can make it never
 * settle or fail with a rate limit.
 */
function mockApi(calls, sendPayload) {
  return {
    runtime: {
      channel: {
        outbound: {
          loadAdapter: async (channel) => {
            assert.equal(channel, "discord");
            return {
              sendPayload:
                sendPayload ??
                (async (ctx) => {
                  calls.push(ctx);
                  return {
                    messageId: "msg-1",
                    channelId: ctx.threadId ?? ctx.to,
                  };
                }),
            };
          },
        },
      },
    },
  };
}

describe("F-183 — the native Discord outbound seam is bounded", () => {
  test(
    "a never-settling adapter is refused by a named code inside the deadline",
    { timeout: 5_000 },
    async () => {
      const calls = [];
      const neverSettles = async (ctx) => {
        calls.push(ctx);
        return new Promise(() => {});
      };
      const startedAt = Date.now();
      await assert.rejects(
        sendNativePayload({
          api: mockApi(calls, neverSettles),
          to: "thread-123",
          threadId: "thread-123",
          accountId: "o1",
          payload: { text: "approval card" },
          deadlineMs: 100,
        }),
        (error) => {
          assert.equal(error.code, NATIVE_DELIVERY_TIMEOUT);
          assert.match(error.message, /NATIVE_DELIVERY_TIMEOUT/u);
          assert.equal(error.deadlineMs, 100);
          return true;
        },
      );
      const elapsed = Date.now() - startedAt;
      assert.ok(
        elapsed < 3_000,
        `the seam refused after ${elapsed}ms — that is not a bounded deadline`,
      );
      // The adapter WAS called: the refusal happened while the send was in
      // flight, not before it.
      assert.equal(calls.length, 1);
    },
  );

  test("the native seam's default deadline is the bound the REST sites use", async () => {
    const { DISCORD_REST_DEADLINE_MS } =
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
    assert.equal(DISCORD_NATIVE_DEADLINE_MS, DISCORD_REST_DEADLINE_MS);
    assert.equal(DISCORD_NATIVE_DEADLINE_MS, 10_000);
  });

  test("a 429 is surfaced with its Retry-After and X-RateLimit facts", async () => {
    const calls = [];
    const rateLimited = Object.assign(
      new Error("DiscordAPIError[429]: Too Many Requests"),
      {
        status: 429,
        headers: {
          "retry-after": "2",
          "x-ratelimit-reset": "1760000000",
          "x-ratelimit-remaining": "0",
        },
      },
    );
    await assert.rejects(
      sendNativePayload({
        api: mockApi(calls, async () => {
          throw rateLimited;
        }),
        to: "thread-123",
        threadId: "thread-123",
        payload: { text: "approval card" },
        deadlineMs: 1_000,
      }),
      (error) => {
        assert.equal(error.code, NATIVE_DELIVERY_RATE_LIMITED);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfterMs, 2_000);
        assert.equal(error.rateLimitResetAt, 1_760_000_000_000);
        assert.equal(error.rateLimitRemaining, "0");
        assert.match(error.message, /retryAfterMs=2000/u);
        assert.match(error.message, /rateLimitResetAt=1760000000000/u);
        // The original failure is kept as the cause: a rate limit must not
        // erase why the send failed.
        assert.equal(error.cause, rateLimited);
        return true;
      },
    );
  });

  test("a failure that is not a rate limit is not rewritten", async () => {
    const calls = [];
    const failure = new Error("discord socket closed");
    await assert.rejects(
      sendNativePayload({
        api: mockApi(calls, async () => {
          throw failure;
        }),
        to: "thread-123",
        payload: { text: "approval card" },
        deadlineMs: 1_000,
      }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  test("a settling adapter is still delivered normally", async () => {
    const calls = [];
    const receipt = await sendNativePayload({
      api: mockApi(calls),
      to: "thread-123",
      threadId: "thread-123",
      payload: { text: "approval card" },
      deadlineMs: 1_000,
    });
    assert.equal(receipt.messageId, "msg-1");
    assert.equal(receipt.channelId, "thread-123");
    assert.equal(calls.length, 1);
  });
});
