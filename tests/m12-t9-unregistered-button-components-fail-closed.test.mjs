// M12/T9 F-OC-001 — Red-before evidence captured when 844a10f landed.
//
// The red-before behaviour demonstrated the pre-fix defect: when the Discord component SDK
// could not be resolved, sendNativePayload built a payload with unregistered markdown-style
// button objects rather than failing closed. Clicks on those buttons answered "This component has expired."
//
// Post-fix contract: when buttons are present but the component SDK is unavailable,
// sendNativePayload must reject with COMPONENT_SDK_UNAVAILABLE and the adapter's
// sendPayload must never be called.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildNativeComponentPayload,
  sendNativePayload,
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
  it("rejects with COMPONENT_SDK_UNAVAILABLE when buttons are present and SDK resolution fails", async () => {
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

  it("proves adapter sendPayload is never called when buttons are present and SDK resolution fails", async () => {
    let adapterCalled = false;
    const api = {
      runtime: {
        channel: {
          outbound: {
            loadAdapter: async () => ({
              sendPayload: async () => {
                adapterCalled = true;
                return { messageId: "msg-fail-closed", channelId: "1234567890123456789" };
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
      }
    );

    assert.equal(
      adapterCalled,
      false,
      "the adapter sendPayload must never be called when component SDK resolution fails"
    );
  });
});
