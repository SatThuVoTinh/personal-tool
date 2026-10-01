import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildNativeComponents,
  buildNativeComponentPayload,
  sendNativePayload,
  NATIVE_BUTTON_STYLE,
} from "../integrations/openclaw/lib/discord-native-send.mjs";
import {
  DISCORD_COMPONENT_ACTION_NAMESPACE,
  buildComponentCustomId,
  parseComponentCustomId,
} from "../integrations/openclaw/lib/authority.mjs";

function mockApi(calls) {
  return {
    runtime: {
      channel: {
        outbound: {
          loadAdapter: async (channel) => {
            assert.equal(channel, "discord");
            return {
              sendPayload: async (ctx) => {
                calls.push(ctx);
                return {
                  messageId: "msg-1",
                  channelId: ctx.threadId ?? ctx.to,
                };
              },
            };
          },
        },
      },
    },
  };
}

const ACTIONS = [
  DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
  DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REJECT,
  DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT,
  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REJECT,
  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REVISION,
];

describe("R4 Finding 1 — native Discord outbound POC (offline)", () => {
  test("approval buttons build native component structure", () => {
    const buttons = [
      {
        customId: buildComponentCustomId(ACTIONS[0], "task-01", "2"),
        label: "Approve",
        style: NATIVE_BUTTON_STYLE.SUCCESS,
        emoji: { name: "✅" },
      },
      {
        customId: buildComponentCustomId(ACTIONS[1], "task-01", "2"),
        label: "Reject",
        style: NATIVE_BUTTON_STYLE.DANGER,
        emoji: { name: "❌" },
      },
      {
        customId: buildComponentCustomId(ACTIONS[2], "task-01", "2"),
        label: "Request Revision",
        style: NATIVE_BUTTON_STYLE.SECONDARY,
        emoji: { name: "📝" },
      },
    ];
    const rows = buildNativeComponents(buttons);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, 1);
    assert.equal(rows[0].components.length, 3);
    for (const button of rows[0].components) {
      assert.equal(button.type, 2);
      assert.match(button.custom_id, /^zink:/);
      const parsed = parseComponentCustomId(button.custom_id);
      assert.ok(parsed);
      assert.equal(parsed.taskId, "task-01");
      assert.equal(parsed.revision, "2");
    }
  });

  test("result buttons round-trip through the namespace grammar", () => {
    for (const action of ACTIONS.slice(3)) {
      const id = buildComponentCustomId(action, "task-09", "1");
      const parsed = parseComponentCustomId(id);
      assert.equal(parsed.actionType, action);
      // native 2026.6.34 routes by prefix before first ":" -> "zink"
      assert.equal(id.split(":")[0], "zink");
    }
  });

  test("sendNativePayload delivers via adapter, returns receipt", async () => {
    const calls = [];
    const payload = buildNativeComponentPayload({
      text: "approval card",
      buttons: [
        {
          customId: buildComponentCustomId(ACTIONS[0], "t", "1"),
          label: "Approve",
          style: NATIVE_BUTTON_STYLE.SUCCESS,
        },
      ],
    });
    const receipt = await sendNativePayload({
      api: mockApi(calls),
      to: "thread-123",
      threadId: "thread-123",
      accountId: "o1",
      payload,
    });
    assert.equal(receipt.messageId, "msg-1");
    assert.equal(receipt.channelId, "thread-123");
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].payload.channelData.discord.components[0].components[0]
        .custom_id,
      buildComponentCustomId(ACTIONS[0], "t", "1"),
    );
  });

  test("native seam missing fails closed, never falls back", async () => {
    await assert.rejects(
      sendNativePayload({
        api: {},
        to: "x",
        payload: { text: "hi" },
      }),
      /NATIVE_OUTBOUND_UNAVAILABLE/,
    );
    await assert.rejects(
      sendNativePayload({
        api: {
          runtime: {
            channel: { outbound: { loadAdapter: async () => null } },
          },
        },
        to: "x",
        payload: { text: "hi" },
      }),
      /NATIVE_OUTBOUND_UNAVAILABLE/,
    );
  });

  test("button spec validation rejects malformed input", () => {
    assert.throws(() => buildNativeComponents([]), /at least one button/);
    assert.throws(
      () => buildNativeComponents([{ customId: "", label: "x", style: 3 }]),
      /customId required/,
    );
    assert.throws(
      () =>
        buildNativeComponents([
          { customId: "zink:a:b:c", label: "x", style: 99 },
        ]),
      /unknown style/,
    );
  });

  test("zink-governance keeps no private registry and no component-REST", () => {
    const pluginPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "integrations",
      "openclaw",
      "plugins",
      "zink-governance",
      "index.mjs",
    );
    const source = readFileSync(pluginPath, "utf8");
    assert.equal(
      source.includes('Symbol.for("openclaw.discord.componentEntries")'),
      false,
    );
    assert.equal(source.includes("_zinkPatched"), false);
    assert.equal(
      source.includes("registerBuiltDiscordComponentMessage"),
      false,
    );
    const restPosts = source.match(
      /fetch\(\s*`https:\/\/discord\.com\/api\/v10\/channels\/\$\{[^}]+\}\/(threads|messages)`/g,
    );
    assert.ok(restPosts, "expected documented thread-creation REST sites");
    for (const site of restPosts) {
      assert.match(
        site,
        /\/threads`/,
        "only forum-thread creation may remain raw REST: " + site,
      );
    }
  });
});
