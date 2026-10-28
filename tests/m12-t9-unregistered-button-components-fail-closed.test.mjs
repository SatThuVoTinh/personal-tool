// M12/T9 F-OC-001 — Red test: verify that SDK resolution failure causes partial payloads
// 
// This test demonstrates the defect before the fix: when the Discord component SDK cannot be
// resolved, sendNativePayload builds a payload with unregistered markdown-style button objects
// rather than failing closed. The host will not recognize these buttons, so clicks answer
// "This component has expired."
//
// After the green fix, this test should FAIL because the code now properly throws
// COMPONENT_SDK_UNAVAILABLE when buttons require registration but the SDK is unreachable.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNativeComponentPayload,
  sendNativePayload,
  COMPONENT_REGISTRATION_OUTCOME,
  NATIVE_BUTTON_STYLE,
} from "../integrations/openclaw/lib/discord-native-send.mjs";

function buttonSpecs(taskId, revision) {
  return [
    {
      customId: `zink:approval:approve:${taskId}:${revision}`,
      label: "Approve",
      style: NATIVE_BUTTON_STYLE.SUCCESS,
    },
  ];
}

describe("M12/T9 F-OC-001 — unregistered button components fail closed", () => {
  it("red: sdk failure allows buttons to be delivered with unregistered markdown components", async () => {
    const calls = [];
    const api = {
      runtime: {
        channel: {
          outbound: {
            loadAdapter: async () => ({
              sendPayload: async (ctx) => {
                calls.push({ kind: "send", ctx });
                return { messageId: "msg-red-test", channelId: ctx.to };
              },
            }),
          },
        },
      },
    };
    const buttons = buttonSpecs("1".repeat(64), "1");
    
    // Simulate SDK resolution failure by providing null sdk and a failing resolver
    const receipt = await sendNativePayload({
      api,
      to: "1234567890123456789",
      accountId: "o1",
      payload: buildNativeComponentPayload({ text: "card body", buttons }),
      buttons,
      sdk: null,
      resolveSdk: async () => {
        throw new Error("COMPONENT_SDK_UNAVAILABLE: openclaw/plugin-sdk/discord not found");
      },
      logger: { warn: (m) => console.warn(m) },
    });
    
    assert.ok(receipt.messageId, "a card with dead buttons was still delivered");
    
    const sendCtx = calls.find((c) => c.kind === "send")?.ctx;
    assert.ok(sendCtx, "the adapter must have been called");
    
    // RED FINDING: the payload contains unregistered markdown-component-like objects
    const components = sendCtx?.payload?.channelData?.discord?.components;
    assert.ok(
      components && Array.isArray(components) && components.length > 0,
      "BUG: unregistered markdown components were included in the button payload"
    );
    
    // These are NOT the host-recognized format: they lack the proper registry entries
    assert.equal(
      typeof components[0].type,
      "number",
      "buttons were serialized as plain markdown objects, not host registry entries"
    );
  });
  
  it("green: sdk failure MUST throw instead of building partial button payloads", async () => {
    const api = {
      runtime: {
        channel: {
          outbound: {
            loadAdapter: async () => ({
              sendPayload: async () => {
                throw new Error("this should never be called");
              },
            }),
          },
        },
      },
    };
    const buttons = buttonSpecs("1".repeat(64), "1");
    
    await assert.rejects(
      sendNativePayload({
        api,
        to: "1234567890123456789",
        accountId: "o1",
        payload: buildNativeComponentPayload({ text: "card body", buttons }),
        buttons,
        sdk: null,
        resolveSdk: async () => {
          throw new Error("COMPONENT_SDK_UNAVAILABLE: openclaw/plugin-sdk/discord not found");
        },
        logger: { warn: () => {} },
      }),
      (error) => {
        assert.ok(error.message.includes("COMPONENT_SDK_UNAVAILABLE"));
        return true;
      },
      "must throw COMPONENT_SDK_UNAVAILABLE when SDK is unavailable but buttons are present"
    );
  });
});
