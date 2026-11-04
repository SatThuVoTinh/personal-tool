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
 *
 * M12/T9 F-183: the send is BOUNDED. A stalled Discord socket used to pin this
 * seam forever, because the adapter's promise was awaited with no deadline and
 * no abort — the defect class M11/T3-R1 removed for the REST fetch sites. The
 * seam now stops waiting at the deadline and refuses with a named code, and a
 * Discord rate limit is surfaced with its `Retry-After` / `X-RateLimit` facts so
 * a bounded retry is possible instead of a silently lost card.
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
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

/**
 * M12/T9 F-183: the bound on the native outbound send.
 *
 * It is the SAME bound the REST fetch sites already use
 * (`DISCORD_REST_DEADLINE_MS` in the plugin). The plugin imports THIS module,
 * so a lib module cannot import its own caller; the two constants are pinned
 * equal by `tests/agent-discord-F-183.test.mjs`.
 */
export const DISCORD_NATIVE_DEADLINE_MS = 10_000;

/** The named code a never-settling adapter is refused with. */
export const NATIVE_DELIVERY_TIMEOUT = "NATIVE_DELIVERY_TIMEOUT";

/** The named code a Discord rate limit is surfaced with. */
export const NATIVE_DELIVERY_RATE_LIMITED = "NATIVE_DELIVERY_RATE_LIMITED";

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
 * The outcome of a component-registration attempt.
 *
 * Registration is NOT a delivery verdict: the card is delivered either way, a dead
 * button degrades to the `APPROVE <code>` reply path, and a registration failure must
 * never be turned into a delivery failure. It IS the only signal that says whether
 * the buttons on a posted card can be clicked at all, and a bare boolean could not
 * tell "this card carries no buttons" apart from "the host refused the
 * registration" — M12/T9 F-193: the production caller discarded the value, so
 * an unregistered card was indistinguishable from a card with nothing to register.
 */
export const COMPONENT_REGISTRATION_OUTCOME = Object.freeze({
  REGISTERED: "REGISTERED",
  NO_COMPONENTS: "NO_COMPONENTS",
  NO_MESSAGE_ID: "NO_MESSAGE_ID",
  SDK_UNAVAILABLE: "SDK_UNAVAILABLE",
  BUILD_FAILED: "BUILD_FAILED",
  REGISTRATION_FAILED: "REGISTRATION_FAILED",
});

/**
 * Build the host component bundle (components + registry entries) for adapter-shaped
 * buttons and say WHICH failure happened when there is no bundle.
 *
 * Returns `{ bundle, outcome }`: `bundle` is null when the host SDK cannot be reached
 * or when the build throws, and `outcome` then names which of the two it was, so the
 * caller can report the real cause instead of a generic miss.
 */
async function resolveNativeComponentBundle({
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
  if (!componentSdk) {
    return {
      bundle: null,
      outcome: COMPONENT_REGISTRATION_OUTCOME.SDK_UNAVAILABLE,
    };
  }
  // A build throw used to escape as a generic delivery failure and take the whole card with
  // it — text body and the `APPROVE <code>` reply path alike. Text-only delivery is exactly
  // what this function already promises when the SDK cannot be reached, so the same shape
  // applies here: name the degrade and report the outcome.
  try {
    return {
      bundle: {
        sdk: componentSdk,
        buildResult: componentSdk.buildDiscordComponentMessage({
          spec: buildHostComponentSpec(buttons),
          accountId: accountId ?? undefined,
        }),
      },
      outcome: COMPONENT_REGISTRATION_OUTCOME.REGISTERED,
    };
  } catch (buildError) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_BUILD_FAILED${contextLabel}: the card is delivered as text only, so the APPROVE code path survives: ${buildError?.message}`,
    );
    return {
      bundle: null,
      outcome: COMPONENT_REGISTRATION_OUTCOME.BUILD_FAILED,
    };
  }
}

/**
 * Build the host component bundle (components + registry entries) for adapter-shaped
 * buttons. Returns null when the host SDK cannot be reached **or when the build throws**,
 * having already said which.
 */
export async function buildNativeComponentBundle(options) {
  const { bundle } = await resolveNativeComponentBundle(options);
  return bundle;
}

/**
 * Register a built bundle against the message id that now carries it. A miss is
 * reported as its own outcome: the card itself is delivered and readable, and the
 * `APPROVE <code>` reply path still works, so a registration failure must never be
 * turned into a delivery failure — but it must not be silent either (M12/T9 F-193).
 */
export function registerNativeComponents({
  sdk,
  buildResult,
  messageId,
  logger = null,
  api = null,
  contextLabel = "",
}) {
  if (!buildResult) return COMPONENT_REGISTRATION_OUTCOME.NO_COMPONENTS;
  if (!messageId) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_REGISTRATION_SKIPPED${contextLabel}: no message id was returned, so the buttons on this card cannot resolve`,
    );
    return COMPONENT_REGISTRATION_OUTCOME.NO_MESSAGE_ID;
  }
  try {
    sdk.registerBuiltDiscordComponentMessage({
      buildResult,
      messageId,
      ttlMs: DISCORD_COMPONENT_TTL_MS,
    });
    return COMPONENT_REGISTRATION_OUTCOME.REGISTERED;
  } catch (registerError) {
    warn(
      logger,
      api,
      `[zink-governance] COMPONENT_REGISTRATION_FAILED${contextLabel}: buttons on message ${messageId} cannot be clicked: ${registerError?.message}`,
    );
    return COMPONENT_REGISTRATION_OUTCOME.REGISTRATION_FAILED;
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
  if (!Array.isArray(buttons) || buttons.length === 0) {
    return COMPONENT_REGISTRATION_OUTCOME.NO_COMPONENTS;
  }
  const { bundle, outcome } = await resolveNativeComponentBundle({
    buttons,
    accountId,
    sdk,
    resolveSdk,
    logger,
    api,
    contextLabel: " (posted rest site)",
  });
  if (!bundle) return outcome;
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
/**
 * Resolve the REAL path of `target`, or of the nearest ancestor that exists, so a
 * path whose leaf does not exist yet is still checked against the real directory
 * that will hold it. A leaf that does not exist cannot be a symlink itself, so the
 * nearest existing ancestor is the only place a link can hide.
 */
function realpathOfNearestExistingAncestor(target) {
  let current = path.resolve(target);
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail);
    } catch (error) {
      const code = error?.code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

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
  const declaredRoots = roots.filter(
    (root) =>
      typeof root === "string" && root.length > 0 && !root.includes(".."),
  );
  const lexicallyAllowed = declaredRoots.some(
    (root) =>
      resolvedMedia === path.resolve(root) ||
      resolvedMedia.startsWith(path.resolve(root) + path.sep),
  );
  if (!lexicallyAllowed) {
    throw new Error("MEDIA_PATH_OUTSIDE_ROOTS");
  }
  // M12/T9 F-039: the prefix test above is LEXICAL, so a symlink or junction
  // inside a declared root can point outside it while the path still reads as
  // inside. The sibling containment on the attachment path already resolves the
  // real path; this boundary now does the same, so one boundary has one
  // containment idiom instead of two.
  const realMedia = realpathOfNearestExistingAncestor(resolvedMedia);
  const reallyAllowed = declaredRoots.some((root) => {
    const realRoot = realpathOfNearestExistingAncestor(path.resolve(root));
    return realMedia === realRoot || realMedia.startsWith(realRoot + path.sep);
  });
  if (!reallyAllowed) {
    throw new Error("MEDIA_PATH_OUTSIDE_ROOTS");
  }
  return resolvedMedia;
}

/**
 * Refuse a missing or nonsensical deadline rather than defaulting to "wait
 * forever" — the same rule the forum-tag module applies to its REST calls.
 */
function assertNativeDeadline(deadlineMs) {
  if (
    typeof deadlineMs !== "number" ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs <= 0
  )
    throw new Error("NATIVE_DEADLINE_REQUIRED");
}

/**
 * Await the host adapter's send under a bounded deadline.
 *
 * The adapter's promise belongs to the host and exposes no abort contract this
 * repository can verify, so the seam enforces the bound on its own wait: a send
 * that has not settled at the deadline is refused by a named code. A send that
 * settles later is ignored, and its late rejection is absorbed so it cannot
 * become an unhandled rejection in the host process.
 */
async function sendWithinDeadline(send, deadlineMs) {
  let timer = null;
  const sent = Promise.resolve().then(send);
  // The send may settle after the deadline; that rejection is not the caller's
  // failure any more, so it must not surface as an unhandled rejection.
  sent.catch(() => undefined);
  try {
    return await Promise.race([
      sent,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(
            `${NATIVE_DELIVERY_TIMEOUT}: adapter sendPayload did not settle within ${deadlineMs}ms`,
          );
          error.code = NATIVE_DELIVERY_TIMEOUT;
          error.deadlineMs = deadlineMs;
          reject(error);
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

const DISCORD_RATE_LIMIT_STATUS = 429;

/** Read one header from a `Headers` instance or from a plain header object. */
function readHeaderValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") {
    const value = headers.get(name);
    return value === undefined || value === null ? null : String(value);
  }
  if (typeof headers !== "object") return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted)
      return value === undefined || value === null ? null : String(value);
  }
  return null;
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The status and the rate-limit headers Discord sends, read from the places a
 * Discord HTTP error carries them. The host's error shape is not ours, so the
 * read is defensive: a 429 whose headers cannot be read still surfaces as a
 * rate limit — the status alone stops a blind retry — it just cannot say when
 * to come back.
 */
function rateLimitFacts(error) {
  const status = numberOrNull(
    error?.status ??
      error?.statusCode ??
      error?.response?.status ??
      error?.rawError?.status ??
      error?.cause?.status,
  );
  if (status !== DISCORD_RATE_LIMIT_STATUS) return null;
  const headers =
    error?.headers ??
    error?.response?.headers ??
    error?.rawError?.headers ??
    error?.cause?.headers ??
    null;
  const retryAfterSeconds = numberOrNull(
    readHeaderValue(headers, "retry-after"),
  );
  const resetSeconds = numberOrNull(
    readHeaderValue(headers, "x-ratelimit-reset"),
  );
  return {
    status,
    retryAfterMs:
      retryAfterSeconds === null
        ? null
        : Math.max(0, Math.round(retryAfterSeconds * 1000)),
    rateLimitResetAt:
      resetSeconds === null ? null : Math.round(resetSeconds * 1000),
    rateLimitRemaining: readHeaderValue(headers, "x-ratelimit-remaining"),
  };
}

/**
 * Turn a Discord rate limit into a refusal the caller can act on: the named
 * code carries the status and the `Retry-After` / `X-RateLimit` facts, so a
 * bounded retry is possible instead of a silently lost card. The original
 * failure is kept as the cause.
 */
function rateLimitedDeliveryError(error, facts) {
  const limited = new Error(
    `${NATIVE_DELIVERY_RATE_LIMITED}: status=${facts.status} retryAfterMs=${facts.retryAfterMs ?? "unknown"} rateLimitResetAt=${facts.rateLimitResetAt ?? "unknown"} rateLimitRemaining=${facts.rateLimitRemaining ?? "unknown"}`,
    { cause: error },
  );
  limited.code = NATIVE_DELIVERY_RATE_LIMITED;
  limited.status = facts.status;
  limited.retryAfterMs = facts.retryAfterMs;
  limited.rateLimitResetAt = facts.rateLimitResetAt;
  limited.rateLimitRemaining = facts.rateLimitRemaining;
  return limited;
}

/**
 * Send through the native outbound adapter. Returns { messageId, channelId }.
 * @throws NATIVE_OUTBOUND_UNAVAILABLE when the seam is missing.
 * @throws NATIVE_DELIVERY_TIMEOUT when the adapter has not settled at the
 * deadline.
 * @throws NATIVE_DELIVERY_RATE_LIMITED when Discord answered 429.
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
  deadlineMs = DISCORD_NATIVE_DEADLINE_MS,
}) {
  assertNativeDeadline(deadlineMs);
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
    const { bundle: bundleResult, outcome } = await resolveNativeComponentBundle({
      buttons,
      accountId,
      sdk,
      resolveSdk,
      logger,
      api,
    });
    bundle = bundleResult;
    if (!bundle) {
      // Green fix F-OC-001: when buttons are present but bundle cannot be created,
      // fail closed rather than sending payloads with unregistered markdown-style
      // component objects that will never be clickable
      const code =
        outcome === COMPONENT_REGISTRATION_OUTCOME.SDK_UNAVAILABLE
          ? "COMPONENT_SDK_UNAVAILABLE"
          : "COMPONENT_BUILD_FAILED";
      throw new Error(
        `${code}: cannot deliver ${buttons.length} button(s) without working host SDK`
      );
    }
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
  // M12/T9 F-183: the send is bounded. A stalled Discord socket must not pin
  // this seam, so the wait ends at the deadline and the refusal carries a named
  // code; a rate limit is surfaced with the facts a bounded retry needs.
  let result;
  try {
    result = await sendWithinDeadline(
      () => adapter.sendPayload(context),
      deadlineMs,
    );
  } catch (error) {
    const facts = rateLimitFacts(error);
    if (facts) throw rateLimitedDeliveryError(error, facts);
    throw error;
  }
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
