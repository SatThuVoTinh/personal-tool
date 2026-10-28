// M12/T1-R1 Phase 1 — a component we post must be registered with the host.
//
// Proven live 2026-10-13: every approval button answered "This component has expired."
// The host's `handleDiscordComponentEvent` replies that and returns BEFORE dispatching to
// the plugin whenever its component registry misses, and only the host's own component
// send/edit paths register entries. Our outbound seam travels through the ordinary
// adapter send, so no id we minted was ever resolvable — the live state store contains
// zero `discord.components` rows, and the last button-driven approval decision in the
// production ledger is 2026-09-26.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildNativeComponentPayload,
  sendNativePayload,
  hostComponentSdkCandidates,
  registerPostedNativeComponents,
  COMPONENT_REGISTRATION_OUTCOME,
  NATIVE_BUTTON_STYLE,
  DISCORD_COMPONENT_TTL_MS,
} from "../integrations/openclaw/lib/discord-native-send.mjs";
import {
  DISCORD_COMPONENT_ACTION_NAMESPACE,
  DISCORD_COMPONENT_CUSTOM_ID_PREFIX,
  buildComponentCustomId,
} from "../integrations/openclaw/lib/authority.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { deriveTaskId } from "../integrations/openclaw/topology/lib/canonical.mjs";

const TASK_ID = "1".repeat(64);

function buttonSpecs(taskId = TASK_ID, revision = "3") {
  return [
    {
      customId: buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
        taskId,
        revision,
      ),
      label: "Approve",
      style: NATIVE_BUTTON_STYLE.SUCCESS,
      emoji: { name: "✅" },
    },
    {
      customId: buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REJECT,
        taskId,
        revision,
      ),
      label: "Reject",
      style: NATIVE_BUTTON_STYLE.DANGER,
      emoji: { name: "❌" },
    },
    {
      customId: buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
        taskId,
        revision,
      ),
      label: "Request Revision",
      style: NATIVE_BUTTON_STYLE.SECONDARY,
    },
  ];
}

function adapterHarness({
  messageId = "msg-live-1",
  failRegister = false,
  failBuild = false,
} = {}) {
  const calls = [];
  const api = {
    runtime: {
      channel: {
        outbound: {
          loadAdapter: async () => ({
            sendPayload: async (ctx) => {
              calls.push({ kind: "send", ctx });
              return { messageId, channelId: ctx.threadId ?? ctx.to };
            },
          }),
        },
      },
    },
  };
  return {
    api,
    calls,
    sdk: {
      buildDiscordComponentMessage: (params) => {
        calls.push({ kind: "build", params });
        if (failBuild)
          throw new Error("host component builder rejected the spec");
        const rows = params.spec.blocks.map((block, rowIndex) => ({
          type: 1,
          components: block.buttons.map((button, index) => ({
            type: 2,
            style: 1,
            label: button.label,
            custom_id: `occomp:cid=${button.componentId}`,
            __sentinel: `${rowIndex}:${index}`,
          })),
        }));
        return {
          components: rows,
          entries: params.spec.blocks.flatMap((block) =>
            block.buttons.map((button) => ({ id: button.componentId })),
          ),
          modals: [],
        };
      },
      registerBuiltDiscordComponentMessage: (params) => {
        calls.push({ kind: "register", params });
        if (failRegister) throw new Error("registry write rejected");
      },
    },
  };
}

function logHarness() {
  const logs = [];
  const logger = {
    warn: (m) => logs.push(`warn:${m}`),
    info: (m) => logs.push(`info:${m}`),
    error: (m) => logs.push(`error:${m}`),
  };
  return { logs, logger };
}

describe("M12/T1 P1 — components are built and registered through the host", () => {
  it("sends the host-built components, not the locally built ones", async () => {
    const h = adapterHarness();
    const buttons = buttonSpecs();
    const payload = buildNativeComponentPayload({
      text: "card body",
      buttons,
    });
    await sendNativePayload({
      api: h.api,
      to: "1234567890123456789",
      threadId: "1234567890123456700",
      accountId: "o1",
      payload,
      buttons,
      sdk: h.sdk,
    });
    const send = h.calls.find((c) => c.kind === "send");
    assert.ok(send, "the adapter must still be the transport");
    const delivered = send.ctx.payload.channelData.discord.components;
    assert.equal(
      delivered[0].components[0].__sentinel,
      "0:0",
      "the delivered components must be the host builder's output",
    );
  });

  it("passes our own governed id as each button's host componentId", async () => {
    const h = adapterHarness();
    const buttons = buttonSpecs();
    await sendNativePayload({
      api: h.api,
      to: "1234567890123456789",
      accountId: "o1",
      payload: buildNativeComponentPayload({ text: "card body", buttons }),
      buttons,
      sdk: h.sdk,
    });
    const build = h.calls.find((c) => c.kind === "build");
    assert.ok(build, "the host builder must be used");
    const spec = build.params.spec;
    assert.equal(spec.blocks.length, 1);
    assert.deepEqual(
      spec.blocks[0].buttons.map((b) => b.componentId),
      buttons.map((b) =>
        b.customId.slice(DISCORD_COMPONENT_CUSTOM_ID_PREFIX.length),
      ),
      "the registry key must be exactly the governed <action>:<task>:<revision> id",
    );
    assert.deepEqual(
      spec.blocks[0].buttons.map((b) => b.label),
      ["Approve", "Reject", "Request Revision"],
    );
    assert.deepEqual(
      spec.blocks[0].buttons.map((b) => b.emoji),
      [{ name: "✅" }, { name: "❌" }, undefined],
    );
    assert.equal(
      spec.blocks[0].buttons.every((b) => b.reusable === true),
      true,
      "a decision that fails inside the plugin must stay retryable, so the host must not consume the entry",
    );
  });

  it("registers after the send, with the real message id and a bounded ttl", async () => {
    const h = adapterHarness({ messageId: "msg-777" });
    const buttons = buttonSpecs();
    const receipt = await sendNativePayload({
      api: h.api,
      to: "1234567890123456789",
      accountId: "o1",
      payload: buildNativeComponentPayload({ text: "card body", buttons }),
      buttons,
      sdk: h.sdk,
    });
    const order = h.calls.map((c) => c.kind);
    assert.deepEqual(
      order,
      ["build", "send", "register"],
      "registration must happen after the message id exists",
    );
    const register = h.calls.find((c) => c.kind === "register");
    assert.equal(register.params.messageId, "msg-777");
    assert.equal(register.params.ttlMs, DISCORD_COMPONENT_TTL_MS);
    assert.deepEqual(
      register.params.buildResult.entries.map((e) => e.id),
      buttons.map((b) =>
        b.customId.slice(DISCORD_COMPONENT_CUSTOM_ID_PREFIX.length),
      ),
    );
    assert.equal(receipt.messageId, "msg-777");
  });

  it("does not report a dead-button card as a delivery failure", async () => {
    const h = adapterHarness({ failRegister: true });
    const { logs, logger } = logHarness();
    const buttons = buttonSpecs();
    const receipt = await sendNativePayload({
      api: h.api,
      to: "1234567890123456789",
      accountId: "o1",
      payload: buildNativeComponentPayload({ text: "card body", buttons }),
      buttons,
      sdk: h.sdk,
      logger,
    });
    assert.equal(
      receipt.messageId,
      "msg-live-1",
      "the card is still readable and text approval still works, so the send must succeed",
    );
    assert.match(
      logs.join("\n"),
      /COMPONENT_REGISTRATION_FAILED/u,
      "a registration miss must be logged, never swallowed",
    );
  });

  it("FAIL CLOSED when the component build itself throws with buttons present", async () => {
    const h = adapterHarness({ failBuild: true });
    const { logs, logger } = logHarness();
    const buttons = buttonSpecs();
    
    await assert.rejects(
      sendNativePayload({
        api: h.api,
        to: "1234567890123456789",
        accountId: "o1",
        payload: buildNativeComponentPayload({ text: "card body", buttons }),
        buttons,
        sdk: h.sdk,
        logger,
      }),
      (error) => {
        assert.ok(error.message.includes("COMPONENT_BUILD_FAILED"));
        return true;
      },
      "must throw COMPONENT_BUILD_FAILED when bundle building fails and buttons are present"
    );
    
    assert.equal(
      h.calls.some((c) => c.kind === "register"),
      false,
      "nothing can be registered when the build produced no bundle"
    );
  });

  it("FAIL CLOSED when the host component sdk cannot be reached", async () => {
    const h = adapterHarness();
    const { logs, logger } = logHarness();
    const buttons = buttonSpecs();
    
    await assert.rejects(
      sendNativePayload({
        api: h.api,
        to: "1234567890123456789",
        accountId: "o1",
        payload: buildNativeComponentPayload({ text: "card body", buttons }),
        buttons,
        sdk: null,
        resolveSdk: () => {
          throw new Error("openclaw/plugin-sdk/discord not resolvable");
        },
        logger,
      }),
      (error) => {
        assert.ok(error.message.includes("COMPONENT_SDK_UNAVAILABLE"));
        return true;
      },
      "must throw COMPONENT_SDK_UNAVAILABLE when SDK is unavailable but buttons are present"
    );
    
    assert.equal(
      h.calls.some((c) => c.kind === "register"),
      false,
      "nothing can be registered without the host builder"
    );
  });

  it("finds the host sdk from the running entrypoint, not from a baked path", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "m12t1-hostpkg-"));
    try {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      mkdirSync(path.join(root, "dist", "plugin-sdk"), { recursive: true });
      writeFileSync(
        path.join(root, "package.json"),
        JSON.stringify({ name: "openclaw", version: "2026.6.34" }),
      );
      writeFileSync(
        path.join(root, "dist", "plugin-sdk", "discord.js"),
        "export const buildDiscordComponentMessage = () => {};export const registerBuiltDiscordComponentMessage = () => {};",
      );
      const candidates = hostComponentSdkCandidates(
        path.join(root, "dist", "cli.js"),
      );
      assert.equal(candidates.length, 1);
      assert.match(candidates[0], /plugin-sdk\/discord\.js$/u);
      assert.deepEqual(
        hostComponentSdkCandidates(path.join(os.tmpdir(), "not-the-host.js")),
        [],
        "an entrypoint outside an openclaw package must yield no candidate",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves a text-only send exactly as it was", async () => {
    const h = adapterHarness();
    const receipt = await sendNativePayload({
      api: h.api,
      to: "1234567890123456789",
      accountId: "main",
      payload: { text: "plain notice" },
      sdk: h.sdk,
    });
    assert.equal(receipt.messageId, "msg-live-1");
    assert.deepEqual(
      h.calls.map((c) => c.kind),
      ["send"],
      "a payload without buttons must not touch the component registry",
    );
    assert.equal(h.calls[0].ctx.payload.channelData, undefined);
  });
});

// M12/T9 F-193: the posted-card registration seam had no test at all, and every
// failure mode returned the same bare `false`, so an unregistered card (every click
// answers "This component has expired") was indistinguishable from a card that
// carried no buttons. The production caller discarded the value entirely.
describe("M12/T9 F-193 - a posted card that cannot register its buttons says so", () => {
  it("names a registration failure instead of reporting the no-buttons short circuit", async () => {
    const h = adapterHarness({ failRegister: true });
    const { logs, logger } = logHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: buttonSpecs(),
      messageId: "msg-posted-1",
      accountId: "main",
      sdk: h.sdk,
      logger,
    });
    assert.equal(
      outcome,
      COMPONENT_REGISTRATION_OUTCOME.REGISTRATION_FAILED,
      "a refused registration must be reported as itself",
    );
    assert.notEqual(
      outcome,
      COMPONENT_REGISTRATION_OUTCOME.NO_COMPONENTS,
      "a card whose buttons could not be registered is not a card with no buttons",
    );
    assert.match(logs.join("\n"), /COMPONENT_REGISTRATION_FAILED/u);
  });

  it("reports the no-buttons case separately", async () => {
    const h = adapterHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: [],
      messageId: "msg-posted-2",
      accountId: "main",
      sdk: h.sdk,
    });
    assert.equal(outcome, COMPONENT_REGISTRATION_OUTCOME.NO_COMPONENTS);
  });

  it("reports REGISTERED when the host accepted the registration", async () => {
    const h = adapterHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: buttonSpecs(),
      messageId: "msg-posted-3",
      accountId: "main",
      sdk: h.sdk,
    });
    assert.equal(outcome, COMPONENT_REGISTRATION_OUTCOME.REGISTERED);
    assert.equal(
      h.calls.some((c) => c.kind === "register"),
      true,
      "the host registry must actually have been written",
    );
  });

  it("names a build failure instead of reporting a registration failure", async () => {
    const h = adapterHarness({ failBuild: true });
    const { logs, logger } = logHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: buttonSpecs(),
      messageId: "msg-posted-4",
      accountId: "main",
      sdk: h.sdk,
      logger,
    });
    assert.equal(outcome, COMPONENT_REGISTRATION_OUTCOME.BUILD_FAILED);
    assert.notEqual(
      outcome,
      COMPONENT_REGISTRATION_OUTCOME.REGISTRATION_FAILED,
      "a build that never produced a bundle is not a refused registration",
    );
    assert.match(logs.join("\n"), /COMPONENT_BUILD_FAILED/u);
  });

  it("names an unreachable host sdk instead of reporting a registration failure", async () => {
    const h = adapterHarness();
    const { logs, logger } = logHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: buttonSpecs(),
      messageId: "msg-posted-5",
      accountId: "main",
      sdk: null,
      resolveSdk: () => {
        throw new Error("openclaw/plugin-sdk/discord not resolvable");
      },
      logger,
    });
    assert.equal(outcome, COMPONENT_REGISTRATION_OUTCOME.SDK_UNAVAILABLE);
    assert.match(logs.join("\n"), /COMPONENT_SDK_UNAVAILABLE/u);
  });

  it("names a missing message id instead of reporting a registration failure", async () => {
    const h = adapterHarness();
    const { logs, logger } = logHarness();
    const outcome = await registerPostedNativeComponents({
      api: h.api,
      buttons: buttonSpecs(),
      messageId: "",
      accountId: "main",
      sdk: h.sdk,
      logger,
    });
    assert.equal(outcome, COMPONENT_REGISTRATION_OUTCOME.NO_MESSAGE_ID);
    assert.notEqual(
      outcome,
      COMPONENT_REGISTRATION_OUTCOME.REGISTRATION_FAILED,
      "a post that returned no id is not a refused registration",
    );
    assert.match(logs.join("\n"), /COMPONENT_REGISTRATION_SKIPPED/u);
  });
});

describe("M12/T9 F-083 - the load reports the capabilities it actually has", () => {
  it("names the interactive-handler loss when the host cannot register one", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "m12t9-cap-"));
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    for (const agentId of [
      "main",
      "o1",
      "o2",
      "excel",
      "power-bi",
      "sql",
      "python",
    ]) {
      mkdirSync(path.join(root, "workspaces", agentId), { recursive: true });
      mkdirSync(path.join(root, "agents", agentId, "agent"), {
        recursive: true,
      });
    }
    const logs = [];
    const plugin = (
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
    ).default;
    plugin.register({
      pluginConfig: {
        ledgerRoot: paths.root,
        ownerDiscordId: "123456789012345678",
        enabled: true,
      },
      on: () => {},
      registerTool: () => {},
      // A host WITHOUT registerInteractiveHandler: it loads green while every
      // button is silently lost.
      logger: {
        warn: (m) => logs.push(String(m)),
        info: (m) => logs.push(String(m)),
        error: (m) => logs.push(String(m)),
      },
    });
    try {
      const line = logs.find((entry) =>
        entry.includes("[zink-governance] capabilities:"),
      );
      assert.ok(
        line,
        `the load must emit a capability line: ${JSON.stringify(logs)}`,
      );
      assert.match(line, /interactive_handler=MISSING/u);
      assert.match(line, /component_sdk=(available|MISSING)/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M12/T1 P1 — an approval decision is recorded with its own reason", () => {
  // M12/T9 F-529: the surfaced record is LOAD-BEARING — an APPROVE against a
  // recorded request now requires the durable record of the surfaced card and
  // the projected approval thread, and every decision must name the thread it
  // was surfaced in (the tests/agent-owner-F-123.test.mjs fixture pattern).
  const DECISION_THREAD = "900000000000000021";
  async function decisionHarness(tag) {
    const root = mkdtempSync(path.join(os.tmpdir(), `m12t1-reason-${tag}-`));
    const ledgerRoot = path.join(root, "operator", "m7-t2", "ledger");
    mkdirSync(ledgerRoot, { recursive: true });
    const paths = ledgerPaths(root);
    ensureLedger(paths);
    const plugin = (
      await import("../integrations/openclaw/plugins/zink-governance/index.mjs")
    ).default;
    const policy = await import("../integrations/openclaw/lib/policy.mjs");
    for (const agentId of [
      "main",
      "o1",
      "o2",
      "excel",
      "power-bi",
      "sql",
      "python",
    ]) {
      const dir = path.join(root, "workspaces", agentId);
      mkdirSync(dir, { recursive: true });
      mkdirSync(path.join(root, "agents", agentId, "agent"), {
        recursive: true,
      });
    }
    plugin.register({
      pluginConfig: {
        ledgerRoot,
        ownerDiscordId: "123456789012345678",
        enabled: true,
      },
      on: () => {},
      registerTool: () => {},
      logger: { warn: () => {}, info: () => {}, error: () => {} },
    });
    void policy;
    const payload = {
      origin: "discord",
      origin_principal_ref: "a".repeat(64),
      origin_message_id: `12345678901234567${tag.charCodeAt(0) % 10}`,
      root_agent_id: "main",
      root_session_key: `root-session-${tag}`,
      root_run_id: `root-run-${tag}`,
    };
    const taskId = deriveTaskId(payload);
    recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
      task_id: taskId,
      ...payload,
    });
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
      task_id: taskId,
      agent_id: "o1",
      session_key: `agent:o1:session-${tag}`,
      run_id: `approval-run-${tag}`,
    });
    recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
      task_id: taskId,
      channel: "approvals",
      thread_id: DECISION_THREAD,
    });
    return { root, paths, taskId };
  }

  function lastDecision(root) {
    const events = readFileSync(
      path.join(root, "operator", "m7-t2", "ledger", "events.jsonl"),
      "utf8",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return events
      .filter((event) => event.type === "WORKFLOW_USER_APPROVAL_DECIDED")
      .at(-1);
  }

  for (const [action, expectedDecision, expectedReason] of [
    ["APPROVE", "APPROVE", "USER_APPROVED"],
    ["REJECT", "REJECT", "USER_REJECTED"],
    ["REQUEST_REVISION", "REQUEST_REVISION", "USER_REQUESTED_REVISION"],
  ]) {
    it(`records ${action} with reason ${expectedReason}, never USER_REJECTED by default`, async () => {
      const h = await decisionHarness(action.toLowerCase());
      try {
        const { handleDiscordAction } =
          await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
        const res = handleDiscordAction({
          actor: "user",
          channel: "approvals",
          taskId: h.taskId,
          action,
          data: { threadId: DECISION_THREAD },
          paths: h.paths,
        });
        assert.equal(
          res.allowed,
          true,
          `${action} must be allowed after a recorded request: ${res.reason}`,
        );
        const event = lastDecision(h.root);
        assert.equal(event.payload.decision, expectedDecision);
        assert.equal(
          event.payload.reason,
          expectedReason,
          "the live ledger showed decision APPROVE with reason USER_REJECTED; the default must describe the action actually taken",
        );
      } finally {
        rmSync(h.root, { recursive: true, force: true });
      }
    });
  }

  it("still honours a reason the caller supplies", async () => {
    const h = await decisionHarness("explicit");
    try {
      const { handleDiscordAction } =
        await import("../integrations/openclaw/plugins/zink-governance/index.mjs");
      handleDiscordAction({
        actor: "user",
        channel: "approvals",
        taskId: h.taskId,
        action: "APPROVE",
        data: { reason: "DUYET_CO_LEU", threadId: DECISION_THREAD },
        paths: h.paths,
      });
      assert.equal(lastDecision(h.root).payload.reason, "DUYET_CO_LEU");
    } finally {
      rmSync(h.root, { recursive: true, force: true });
    }
  });
});
