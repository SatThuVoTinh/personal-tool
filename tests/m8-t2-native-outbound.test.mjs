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
      // M10/T2-R12: the wire envelope is the host's `occomp:cid=` form, NOT the
      // bare `zink:` form. This assertion used to pin `/^zink:/`, which was the
      // bug: the host's parseDiscordComponentCustomId requires the parsed key to
      // be `occomp`, so every click answered "This component is no longer valid."
      // Proven live 2026-10-08 15:45:08 on the #approvals card.
      assert.match(button.custom_id, /^occomp:cid=zink:/);
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
      // native 2026.6.34 routes the interaction by the FIRST prefix segment, and
      // that segment must be "occomp". A bare "zink:..." id never reaches the
      // handler at all (M10/T2-R12; live failure 2026-10-08 15:45:08). The zink
      // action namespace lives INSIDE the envelope, after `cid=`.
      assert.equal(id.split(":")[0], "occomp");
      assert.ok(id.startsWith("occomp:cid=zink:"), id);
      assert.ok(
        id.length <= 100,
        `custom_id exceeds Discord ceiling: ${id.length}`,
      );
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
      if (/\/threads`/.test(site)) continue;
      // R4-EXCEPTION (owner decision 2026-10-07): exactly one /messages REST
      // site is permitted — the approval-buttons post, which the native
      // adapter cannot deliver from the tool-call hook context (proven live).
      // The exception is valid ONLY with its marker comment in source; any
      // other /messages REST fails here.
      assert.match(
        site,
        /\/messages`/,
        "unexpected REST site (only threads + the marked buttons exception): " +
          site,
      );
      const at = source.indexOf(site);
      const contextBefore = source.slice(Math.max(0, at - 1200), at);
      assert.ok(
        contextBefore.includes("R4-EXCEPTION"),
        "a /messages REST site must carry the R4-EXCEPTION marker with the owner decision reference: " +
          site,
      );
    }
    // The exception must remain singular: more than one /messages site means
    // the exception is spreading and the rule needs re-examination.
    const messageSites = restPosts.filter((s) => /\/messages`/.test(s));
    assert.equal(
      messageSites.length,
      1,
      `exactly one R4-EXCEPTION /messages site allowed, found ${messageSites.length}`,
    );
    // M12/T2-R1: a governed thread is opened in exactly one place — the shared forum-tag
    // module — so the plugin must no longer post threads itself, and the module must not
    // gain a component-bearing message path that would spread the R4-EXCEPTION.
    assert.equal(
      restPosts.filter((site) => /\/threads`/.test(site)).length,
      0,
      "the plugin must not post forum threads directly any more",
    );
    const tagsSource = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..",
        "integrations",
        "openclaw",
        "lib",
        "discord-forum-tags.mjs",
      ),
      "utf8",
    );
    assert.equal(
      (
        tagsSource.match(
          /https:\/\/discord\.com\/api\/v10\/channels\/\$\{channelId\}\/[a-z_]+/gu,
        ) ?? []
      ).length,
      3,
      "one thread post, one tag read and one active-thread list, all bounded",
    );
    // M12/T2-R2: the post-verdict tag transition is the only other seam, and it is bounded to
    // the thread itself: read what it carries now, then PATCH only its applied_tags. A thread
    // is a channel, so this is the same endpoint family, not a new transport.
    const threadSites =
      tagsSource.match(
        /https:\/\/discord\.com\/api\/v10\/channels\/\$\{threadId\}/gu,
      ) ?? [];
    assert.equal(
      threadSites.length,
      2,
      "exactly the thread tag read and the thread tag transition are allowed",
    );
    assert.equal(
      (tagsSource.match(/method: "PATCH"/gu) ?? []).length,
      1,
      "the transition is the only mutating call outside thread creation",
    );
    assert.equal(
      /method: "PATCH"[\s\S]{0,400}applied_tags: tagIds/u.test(tagsSource),
      true,
      "the PATCH may carry applied_tags and nothing else",
    );
    assert.equal(
      tagsSource.includes("/messages"),
      false,
      "the shared publish path may not carry the /messages exception",
    );
  });
});
