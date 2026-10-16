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
 *
 * M12/T1-R1 — the registry requirement that made every button dead. The claim
 * this file used to make ("no private/global component registry is used or
 * required for sending") was WRONG, and proved live 2026-10-13: every approval
 * button answered "This component has expired." Inside the installed host,
 * `handleDiscordComponentEvent` resolves the clicked id against the component
 * registry FIRST and returns before dispatching to any plugin when the lookup
 * misses; only `sendDiscordComponentMessage`/`editDiscordComponentMessage`
 * register entries, and the ordinary `sendPayload` path this module uses is not
 * one of them. The live state store held zero `discord.components` rows, so no
 * id this plugin minted was ever clickable. Sending components therefore REQUIRES
 * building them with `buildDiscordComponentMessage` (a per-button `componentId`
 * overrides the host's generated short id and becomes both the registry key and
 * the `occomp:cid=` payload, so our governed id survives unchanged) and
 * registering the result with `registerBuiltDiscordComponentMessage` once the
 * adapter has returned a message id.
 * - A card whose registration failed is still delivered: the text and the
 *   `APPROVE <code>` reply path keep working, so a dead button degrades rather
 *   than blocking the owner. The degradation is logged, never silent.
 * - Forum *thread creation* has no verified native plugin-facing seam in
 *   exact 2026.6.34 and intentionally remains raw REST at the call site,
 *   documented as the remaining limitation.
 *
 * Failure semantics: native path unavailable -> throw
 * NATIVE_OUTBOUND_UNAVAILABLE; delivery failure -> throw (caller logs an
 * incident). Never falls back to raw REST silently.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

// The host's own registry default is 30 minutes
// (`send.components-BRdd6e6c.js DEFAULT_COMPONENT_TTL_MS`). An approval card that
// goes un-clicked over a lunch break must not be the reason the owner has to
// re-type a code, so each card is registered for a day. This is a per-call value
// passed to the host API, not a change to host or global configuration.
export const DISCORD_COMPONENT_TTL_MS = 24 * 60 * 60 * 1000;

// The host spec vocabulary for one button; `NATIVE_BUTTON_STYLE` numbers are the
// Discord wire values, so the two must be translated rather than passed through.
const HOST_BUTTON_STYLE = Object.freeze({
  1: "primary",
  2: "secondary",
  3: "success",
  4: "danger",
});

const HOST_COMPONENT_CUSTOM_ID_PREFIX = "occomp:cid=";
const HOST_SDK_SUBPATH = ["dist", "plugin-sdk", "discord.js"];
const HOST_PACKAGE_NAME = "openclaw";

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
 * Build a host component spec from adapter-shaped button specs.
 *
 * `componentId` is the part the host stores as its registry key and re-embeds in
 * the `occomp:cid=` custom_id, so handing it our governed
 * `<action>:<taskId>:<revision>` id keeps `parseComponentCustomId` the single
 * parser for both sides. `reusable` is set because the host consumes a
 * non-reusable entry on the first click: a decision that fails inside the plugin
 * (a stale revision, an unreadable ledger) would otherwise leave the owner with a
 * dead button and no retry, and replay protection belongs to the workflow reducer,
 * not to the transport.
 */
export function buildHostComponentSpec(buttons) {
  return {
    reusable: true,
    blocks: [
      {
        type: "actions",
        reusable: true,
        buttons: buttons.map((button) => {
          assertButtonSpec(button);
          const spec = {
            label: button.label,
            style: HOST_BUTTON_STYLE[button.style],
            componentId: button.customId.startsWith(
              HOST_COMPONENT_CUSTOM_ID_PREFIX,
            )
              ? button.customId.slice(HOST_COMPONENT_CUSTOM_ID_PREFIX.length)
              : button.customId,
            reusable: true,
          };
          if (button.emoji !== undefined) {
            spec.emoji = { name: button.emoji.name };
          }
          return spec;
        }),
      },
    ],
  };
}

function warn(logger, api, message) {
  const emit = logger?.warn ?? api?.logger?.warn;
  if (typeof emit === "function") emit(message);
}

function hostPackageName(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"))?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Candidate file URLs for the host Discord plugin SDK, derived from the running
 * host entrypoint rather than from any hardcoded install path.
 */
export function hostComponentSdkCandidates(entryArgv = process.argv[1]) {
  if (typeof entryArgv !== "string" || entryArgv.length === 0) return [];
  const candidates = [];
  let dir = path.resolve(path.dirname(path.resolve(entryArgv)));
  for (let depth = 0; depth < 6; depth += 1) {
    const manifestPath = path.join(dir, "package.json");
    if (
      existsSync(manifestPath) &&
      hostPackageName(manifestPath) === HOST_PACKAGE_NAME
    ) {
      const sdkPath = path.join(dir, ...HOST_SDK_SUBPATH);
      if (existsSync(sdkPath)) candidates.push(pathToFileURL(sdkPath).href);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
}

let cachedComponentSdk = null;

/**
 * Resolve the host's Discord component builder/registrars. The bare specifier is
 * attempted first because that is the supported plugin-facing subpath; the
 * install-derived file URL is the fallback for a plugin loaded outside the host's
 * own resolution scope. A failure is thrown, never swallowed: the caller must
 * record that the buttons it is about to post cannot be clicked.
 */
export async function resolveHostDiscordComponentSdk() {
  if (cachedComponentSdk) return cachedComponentSdk;
  const failures = [];
  for (const specifier of [
    `${HOST_PACKAGE_NAME}/plugin-sdk/discord`,
    ...hostComponentSdkCandidates(),
  ]) {
    try {
      const module = await import(specifier);
      const build = module?.buildDiscordComponentMessage;
      const register = module?.registerBuiltDiscordComponentMessage;
      if (typeof build !== "function" || typeof register !== "function") {
        failures.push(`${specifier}: component exports missing`);
        continue;
      }
      cachedComponentSdk = Object.freeze({
        buildDiscordComponentMessage: build,
        registerBuiltDiscordComponentMessage: register,
      });
      return cachedComponentSdk;
    } catch (error) {
      failures.push(`${specifier}: ${error?.message ?? String(error)}`);
    }
  }
  throw new Error(`COMPONENT_SDK_UNAVAILABLE: ${failures.join(" | ")}`);
}

/** For tests only: drop the memoized host SDK resolution. */
export function resetHostDiscordComponentSdk() {
  cachedComponentSdk = null;
}

async function resolveComponentSdk({
  sdk,
  resolveSdk,
  logger,
  api,
  contextLabel,
}) {
  if (sdk) return sdk;
  try {
    return await resolveSdk();
  } catch (sdkError) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_SDK_UNAVAILABLE${contextLabel}: buttons will answer "This component has expired": ${sdkError?.message}`,
    );
    return null;
  }
}

/**
 * Build the host component bundle (components + registry entries) for adapter-shaped
 * buttons. Returns null when the host SDK cannot be reached **or when the build throws**,
 * having already said which.
 */
export async function buildNativeComponentBundle({
  buttons,
  accountId = null,
  sdk,
  resolveSdk = resolveHostDiscordComponentSdk,
  logger = null,
  api = null,
  contextLabel = "",
}) {
  const componentSdk = await resolveComponentSdk({
    sdk,
    resolveSdk,
    logger,
    api,
    contextLabel,
  });
  if (!componentSdk) return null;
  // A build throw used to escape as a generic delivery failure and take the whole card with
  // it — text body and the `APPROVE <code>` reply path alike. Text-only delivery is exactly
  // what this function already promises when the SDK cannot be reached, so the same shape
  // applies here: name the degrade and return null.
  try {
    return {
      sdk: componentSdk,
      buildResult: componentSdk.buildDiscordComponentMessage({
        spec: buildHostComponentSpec(buttons),
        accountId: accountId ?? undefined,
      }),
    };
  } catch (buildError) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_BUILD_FAILED${contextLabel}: the card is delivered as text only, so the APPROVE code path survives: ${buildError?.message}`,
    );
    return null;
  }
}

/**
 * Register a built bundle against the message id that now carries it. A miss is
 * reported and returns false: the card itself is delivered and readable, and the
 * `APPROVE <code>` reply path still works, so a registration failure must never be
 * turned into a delivery failure.
 */
export function registerNativeComponents({
  sdk,
  buildResult,
  messageId,
  logger = null,
  api = null,
  contextLabel = "",
}) {
  if (!buildResult) return false;
  if (!messageId) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_REGISTRATION_SKIPPED${contextLabel}: no message id was returned, so the buttons on this card cannot resolve`,
    );
    return false;
  }
  try {
    sdk.registerBuiltDiscordComponentMessage({
      buildResult,
      messageId,
      ttlMs: DISCORD_COMPONENT_TTL_MS,
    });
    return true;
  } catch (registerError) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_REGISTRATION_FAILED${contextLabel}: buttons on message ${messageId} cannot be clicked: ${registerError?.message}`,
    );
    return false;
  }
}

/**
 * Register components that were delivered by a caller other than
 * `sendNativePayload` — the one permitted raw-REST `/messages` site, which the
 * native adapter cannot serve from its own hook context (R4-EXCEPTION).
 */
export async function registerPostedNativeComponents({
  api,
  buttons,
  messageId,
  accountId = null,
  sdk,
  resolveSdk = resolveHostDiscordComponentSdk,
  logger = null,
}) {
  if (!Array.isArray(buttons) || buttons.length === 0) return false;
  const bundle = await buildNativeComponentBundle({
    buttons,
    accountId,
    sdk,
    resolveSdk,
    logger,
    api,
    contextLabel: " (posted rest site)",
  });
  if (!bundle) return false;
  return registerNativeComponents({
    sdk: bundle.sdk,
    buildResult: bundle.buildResult,
    messageId,
    logger,
    api,
    contextLabel: " (posted rest site)",
  });
}

/**
 * A local attachment may only ever be read from a directory the caller declares as
 * its own root. The host enforces this too (`LocalMediaAccessError` when
 * `mediaLocalRoots` is missing), but refusing here means the governed path never even
 * asks the host to read a file outside the task's own artifact directory.
 */
export function assertMediaInsideRoots(mediaUrl, mediaLocalRoots) {
  if (typeof mediaUrl !== "string" || mediaUrl.length === 0) {
    throw new Error("MEDIA_URL_REQUIRED");
  }
  if (mediaUrl.includes("..")) {
    throw new Error(`MEDIA_PATH_UNSAFE: ${mediaUrl}`);
  }
  const roots = Array.isArray(mediaLocalRoots) ? mediaLocalRoots : [];
  if (roots.length === 0) {
    throw new Error("MEDIA_LOCAL_ROOTS_REQUIRED");
  }
  const resolvedMedia = path.resolve(mediaUrl);
  const allowed = roots.some(
    (root) =>
      typeof root === "string" &&
      root.length > 0 &&
      !root.includes("..") &&
      (resolvedMedia === path.resolve(root) ||
        resolvedMedia.startsWith(path.resolve(root) + path.sep)),
  );
  if (!allowed) {
    throw new Error("MEDIA_PATH_OUTSIDE_ROOTS");
  }
  return resolvedMedia;
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
  buttons = null,
  mediaUrl = null,
  mediaLocalRoots = null,
  sdk,
  resolveSdk = resolveHostDiscordComponentSdk,
  logger = null,
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

  // Components must be built by the host or their ids will never resolve, so a
  // button-bearing send delivers the host's components and keeps the returned
  // entries for registration once the message id exists.
  let outboundPayload = payload;
  let bundle = null;
  if (Array.isArray(buttons) && buttons.length > 0) {
    bundle = await buildNativeComponentBundle({
      buttons,
      accountId,
      sdk,
      resolveSdk,
      logger,
      api,
    });
    if (bundle) {
      outboundPayload = {
        ...payload,
        channelData: {
          ...(payload?.channelData ?? {}),
          discord: {
            ...(payload?.channelData?.discord ?? {}),
            components: bundle.buildResult.components,
          },
        },
      };
    }
  }

  // M12/T1-R1: a preview image travels as `payload.mediaUrl` with the roots the
  // host is allowed to read. The host puts components on the FIRST media item and
  // only carries one file that way, so a card and its image are two messages of the
  // same thread rather than one overloaded payload — refusing here keeps a caller
  // from discovering that as a silently dropped attachment.
  if (typeof mediaUrl === "string" && mediaUrl.length > 0) {
    if (Array.isArray(buttons) && buttons.length > 0) {
      throw new Error(
        "NATIVE_PAYLOAD_INVALID: a component-bearing message cannot also carry media; send the attachment as the next message of the thread",
      );
    }
    const confined = assertMediaInsideRoots(mediaUrl, mediaLocalRoots);
    outboundPayload = {
      ...outboundPayload,
      mediaUrl: confined,
      mediaLocalRoots: Array.isArray(mediaLocalRoots)
        ? mediaLocalRoots.map((root) => path.resolve(root))
        : [],
    };
  }

  const context = {
    to: to ?? String(threadId),
    text: outboundPayload?.text ?? "",
  };
  if (threadId !== null && threadId !== undefined) {
    context.threadId = threadId;
  }
  if (accountId) context.accountId = accountId;
  context.payload = outboundPayload;
  const result = await adapter.sendPayload(context);
  if (!result || typeof result !== "object") {
    throw new Error("NATIVE_DELIVERY_FAILED: empty adapter result");
  }
  const messageId = result.messageId ?? "";
  if (bundle) {
    registerNativeComponents({
      sdk: bundle.sdk,
      buildResult: bundle.buildResult,
      messageId,
      logger,
      api,
    });
  }
  return {
    messageId,
    channelId: result.channelId ?? String(threadId ?? to ?? ""),
  };
}
