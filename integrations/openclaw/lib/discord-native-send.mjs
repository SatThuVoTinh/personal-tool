/**
 * Native Discord outbound seam for zink-governance (R4 Finding 1).
 *
 * Sends approval/result component messages through the official OpenClaw
 * 2026.6.34 outbound path instead of raw Discord REST:
 *
 *   api.runtime.channel.outbound.loadAdapter("discord")
 *     -> adapter.sendPayload({ to, threadId, accountId, payload })
 *     -> Discord adapter renders payload.channelData.discord.components
 *        with its own official transport.
 *
 * Contract notes (verified against installed openclaw@2026.6.34):
 * - `loadAdapter` resolves channel adapters from the plugin registry
 *   (same seam used by first-party device-pair/notify extensions).
 * - The Discord adapter natively forwards `channelData.discord.components`
 *   (official ActionRow/Button objects) in `sendPayload`.
 * - Button clicks route to `registerInteractiveHandler({ channel:
 *   "discord", namespace: "zink" })` by custom_id namespace prefix
 *   (`zink:...`), parsed by `parseComponentCustomId` in authority.mjs.
 * - No private/global component registry is used or required for sending.
 * - Forum *thread creation* has no verified native plugin-facing seam in
 *   exact 2026.6.34 and intentionally remains raw REST at the call site,
 *   documented as the remaining limitation.
 *
 * Failure semantics: native path unavailable -> throw
 * NATIVE_OUTBOUND_UNAVAILABLE; delivery failure -> throw (caller logs an
 * incident). Never falls back to raw REST silently.
 */

const NATIVE_CHANNEL = "discord";

// Official Discord component object types (discord-api reference, as
// serialized by the native Button/Row implementation in 2026.6.34).
export const NATIVE_COMPONENT_TYPE_ACTION_ROW = 1;
export const NATIVE_COMPONENT_TYPE_BUTTON = 2;

export const NATIVE_BUTTON_STYLE = Object.freeze({
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
});

const MAX_LABEL_LENGTH = 80;
const MAX_CUSTOM_ID_LENGTH = 100;

function assertButtonSpec(button) {
  if (!button || typeof button !== "object") {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: button must be an object");
  }
  if (typeof button.customId !== "string" || button.customId.length === 0) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: customId required");
  }
  if (button.customId.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: customId too long");
  }
  if (
    typeof button.label !== "string" ||
    button.label.length === 0 ||
    button.label.length > MAX_LABEL_LENGTH
  ) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: label required (1-80)");
  }
  if (!Object.values(NATIVE_BUTTON_STYLE).includes(button.style)) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: unknown style");
  }
  if (
    button.emoji !== undefined &&
    (typeof button.emoji !== "object" ||
      button.emoji === null ||
      typeof button.emoji.name !== "string" ||
      button.emoji.name.length === 0)
  ) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: emoji must be {name}");
  }
}

/**
 * Build official Discord component objects for one action row.
 * @param {Array<{customId: string, label: string, style: number, disabled?: boolean, emoji?: {name: string}}>} buttons
 */
export function buildNativeComponents(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: at least one button");
  }
  if (buttons.length > 5) {
    throw new Error("NATIVE_BUTTON_SPEC_INVALID: max 5 buttons per row");
  }
  return [
    {
      type: NATIVE_COMPONENT_TYPE_ACTION_ROW,
      components: buttons.map((button) => {
        assertButtonSpec(button);
        const serialized = {
          type: NATIVE_COMPONENT_TYPE_BUTTON,
          style: button.style,
          custom_id: button.customId,
          label: button.label,
        };
        if (button.disabled === true) serialized.disabled = true;
        if (button.emoji !== undefined) {
          serialized.emoji = { name: button.emoji.name };
        }
        return serialized;
      }),
    },
  ];
}

/**
 * Build a ReplyPayload carrying native Discord components.
 */
export function buildNativeComponentPayload({ text, buttons }) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("NATIVE_PAYLOAD_INVALID: text required");
  }
  return {
    text,
    channelData: {
      discord: {
        components: buildNativeComponents(buttons),
      },
    },
  };
}

/**
 * Send through the native outbound adapter. Returns { messageId, channelId }.
 * @throws NATIVE_OUTBOUND_UNAVAILABLE when the seam is missing.
 */
export async function sendNativePayload({
  api,
  to,
  threadId = null,
  accountId = null,
  payload,
}) {
  const loadAdapter = api?.runtime?.channel?.outbound?.loadAdapter;
  if (typeof loadAdapter !== "function") {
    throw new Error("NATIVE_OUTBOUND_UNAVAILABLE: loadAdapter missing");
  }
  const adapter = await loadAdapter(NATIVE_CHANNEL);
  if (!adapter || typeof adapter.sendPayload !== "function") {
    throw new Error("NATIVE_OUTBOUND_UNAVAILABLE: discord sendPayload missing");
  }
  if (!to && !threadId) {
    throw new Error("NATIVE_OUTBOUND_UNAVAILABLE: target required");
  }
  const context = { to: to ?? String(threadId), text: payload?.text ?? "" };
  if (threadId !== null && threadId !== undefined) {
    context.threadId = threadId;
  }
  if (accountId) context.accountId = accountId;
  context.payload = payload;
  const result = await adapter.sendPayload(context);
  if (!result || typeof result !== "object") {
    throw new Error("NATIVE_DELIVERY_FAILED: empty adapter result");
  }
  return {
    messageId: result.messageId ?? "",
    channelId: result.channelId ?? String(threadId ?? to ?? ""),
  };
}
