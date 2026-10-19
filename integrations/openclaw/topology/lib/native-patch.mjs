import { createHash } from "node:crypto";
import {
  readFileSync,
  lstatSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  chmodSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

// The OpenClaw releases this patch is verified against, keyed BY VERSION.
//
// A bundle hash only means something for the release that produced it: every
// OpenClaw release renames its bundles, so an unversioned hash table silently
// becomes a set of stale filenames the moment the host upgrades. Keying by
// version makes the trust anchor explicit, lets `inspectNativePatch` resolve the
// host to exactly one verified pin, and turns "the host moved" into a named
// condition instead of an unexplained missing file.
//
// Each entry is established by reading the release, not by hashing whatever is
// on disk: the anchors must be present and UNIQUE (replaceOnce enforces
// uniqueness), each injection point must be the same code path it was chosen
// for, and the run-id prerequisite must be positively identified as the module
// that derives `runId` from the request idempotency key.
export const NATIVE_RUNTIME_PINS = Object.freeze({
  "2026.6.34": Object.freeze({
    runIdSource: "dist/agent-FRfbCcij.js",
    runIdSourceSha256:
      "7972dc078d111d2b4132589ce85c0881f2a56583297c221f62b83f2cee465f25",
    sources: Object.freeze({
      "selection-DopzNY3I.js": Object.freeze({
        role: "selection",
        sha256:
          "a5698c5523e87ad454cf89e4a5c940689403f7b6eac6f3d14c7205f1e3071ed6",
      }),
      // M10/T2-R8: the Discord channel is NOT loaded from the runtime root. It is
      // an installed plugin package under the profile's npm project store, which
      // is why `openclaw plugins list` resolves `discord` to
      // `~/.openclaw-zink/npm/projects/openclaw-discord-*/node_modules/@openclaw/discord`.
      // The runtime root also ships a copy of the same Discord bundles, but
      // nothing loads it: patching that copy left the real preflight untouched,
      // so the ingress metadata registry was never written and every admitted
      // message was denied for a missing mention. The pin therefore names the
      // file the host actually executes, under the channel scope.
      "message-handler.preflight-CbD0u7U7.js": Object.freeze({
        role: "discord-preflight",
        scope: "discordChannel",
        sha256:
          "386ba4b7c89a5aedaa29756e0ac320709b049c5abf4a4f77a918c309d2028edf",
      }),
      "subagent-announce-Bh1QyKiE.js": Object.freeze({
        role: "announce",
        sha256:
          "764e6ffa2524a03cd8a5d15a8621cb5594f733a91f05311e45b012b727077994",
      }),
    }),
  }),
  "2026.7.1-2": Object.freeze({
    // Verified: all 10 anchors present and unique; `const activeSession =
    // session;` still follows session resolution before the turn,
    // `const acceptedSessionSpawns = ...` still follows the llm_output hook at
    // run end, and the two announce anchors are still the descendant-wake and
    // completion gates.
    runIdSource: "dist/subagent-control-CXT-voKm.js",
    // Verified: this module performs
    //   `const idempotencyKey = crypto.randomUUID(); let runId = idempotencyKey;`
    // i.e. it is the native agent handler that binds runId to the request
    // idempotency key used by the scoped announce transformation.
    runIdSourceSha256:
      "d11cf9e48cc63f88716a7cb6c8e81d9188469d76af4ab4f691d9934cf1d2e140",
    sources: Object.freeze({
      "selection-JInn13lc.js": Object.freeze({
        role: "selection",
        sha256:
          "ccff13111aa60369ac9d88b526a58a7df1f733f1d99d205c01c6186036957e66",
      }),
      "subagent-announce-BH7YpLmx.js": Object.freeze({
        role: "announce",
        sha256:
          "03f150dff16b9ce8679b0d27f697f3b6dd7726cfa0a4f65d329b9364cb307169",
      }),
    }),
  }),
});

// The release the deployment was originally pinned to. Kept as a named constant
// because the README/runbook and the migration path both refer to it.
export const NATIVE_PINNED_RUNTIME_VERSION = "2026.6.34";
// Every release this patch may be applied to.
export const NATIVE_SUPPORTED_RUNTIME_VERSIONS = Object.freeze(
  Object.keys(NATIVE_RUNTIME_PINS),
);
// The pin used when no host version has been resolved.
export const NATIVE_SOURCE_BASELINE =
  NATIVE_RUNTIME_PINS[NATIVE_PINNED_RUNTIME_VERSION].sources;
export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

/**
 * M10/T2-R8: where the Discord channel plugin package lives, relative to the
 * OpenClaw state directory.
 *
 * The Discord channel is an INSTALLED PLUGIN PACKAGE, not part of the runtime
 * bundle: `openclaw plugins list` resolves `discord` to
 * `<stateDir>/npm/projects/openclaw-discord-<hash>/node_modules/@openclaw/discord`.
 * The runtime root ships a byte-similar copy of the same Discord bundles that
 * nothing loads. Pinning, patching and snapshotting the runtime-root copy left
 * the executing preflight untouched, which is why the ingress metadata registry
 * was never written and every admissible message was denied for a missing
 * mention. This constant is the single source of truth for the executing tree:
 * the patch roots, the snapshot relatives and the operator fixtures all derive
 * from it, so the target cannot drift between them again.
 */
export const NATIVE_DISCORD_CHANNEL_RELATIVE =
  "npm/projects/openclaw-discord-c0892df945/node_modules/@openclaw/discord";

/**
 * Which governed root a pinned source resolves against. A source with no
 * `scope` belongs to the runtime root, which is every source that predates the
 * Discord channel being recognised as a separately installed plugin.
 */
export const NATIVE_SOURCE_ROOTS = Object.freeze({
  runtime: "runtimeRoot",
  discordChannel: "discordChannelRoot",
});

/**
 * Accept either the historical single runtime root or the governed root set, so
 * a caller that only patches core runtime artifacts keeps working unchanged and a
 * caller that also patches the channel plugin states that root explicitly.
 */
export function nativeRoots(input) {
  const value =
    typeof input === "string" ? { runtimeRoot: input } : (input ?? {});
  return {
    runtimeRoot: value.runtimeRoot ?? null,
    discordChannelRoot: value.discordChannelRoot ?? null,
  };
}

/**
 * Absolute path of a pinned source. The scope comes from the pin, never from the
 * caller, and a source whose root was not supplied is a NAMED failure: silently
 * skipping it would repeat exactly the bug this scope exists to close.
 */
function sourcePath(roots, file, version) {
  const entry = NATIVE_RUNTIME_PINS[version]?.sources?.[file];
  if (!entry) throw new Error("NATIVE_SOURCE_UNKNOWN");
  const key = NATIVE_SOURCE_ROOTS[entry.scope ?? "runtime"];
  if (!key) throw new Error("NATIVE_SOURCE_SCOPE_UNKNOWN");
  const root = roots[key];
  if (!root) {
    const error = new Error(
      `NATIVE_SOURCE_ROOT_MISSING: pinned artifact ${file} belongs to ${key}, which was not provided. A governed root is never skipped.`,
    );
    error.code = "NATIVE_SOURCE_ROOT_MISSING";
    error.root = key;
    error.artifact = file;
    throw error;
  }
  return path.join(root, "dist", file);
}

const selectionAnchor = "\t\t\tconst activeSession = session;";
const selectionPatch = `${selectionAnchor}
\t\t\tawait enterNativeRun(params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId,
\t\t\t\tinputProvenance: params.inputProvenance,
\t\t\t\tchannelId: params.messageChannel ?? params.messageProvider,
\t\t\t\tsenderId: params.senderId, currentMessageId: params.currentMessageId,
\t\t\t\ttrigger: params.trigger, transcriptPrompt: params.transcriptPrompt,
\t\t\t\tthreadId: params.currentThreadId ?? null
\t\t\t}, params.abortSignal);
\t\t\tinstallNativeToolGate(activeSession.agent, params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId
\t\t\t});`;
const wakeAnchor = "\t\t\tif (await wakeSubagentRunAfterDescendants({";
const wakePatch = `\t\t\tconst zinkWakeGate = await gateNativeAnnounce(subagentAnnounceDeps.getRuntimeConfig(), {
\t\t\t\tphase: "descendant_wake", childSessionKey: params.childSessionKey,
\t\t\t\tchildRunId: params.childRunId, requesterSessionKey: targetRequesterSessionKey,
\t\t\t\tnextRunId: buildAnnounceIdempotencyKey(\`\${wakeAnnounceId}:wake\`),
\t\t\t\tfindings: childCompletionFindings, outcome
\t\t\t}, params.signal);
\t\t\tif (zinkWakeGate.governed && zinkWakeGate.action !== "deliver") {
\t\t\t\tshouldDeleteChildSession = false;
\t\t\t\treturn zinkWakeGate.action === "discard";
\t\t\t}
${wakeAnchor}`;
const finalAnchor =
  "\t\tconst replyInstruction = buildAnnounceReplyInstruction({";
const finalPatch = `\t\tconst zinkCompletionGate = await gateNativeAnnounce(subagentAnnounceDeps.getRuntimeConfig(), {
\t\t\tphase: "completion", childSessionKey: params.childSessionKey,
\t\t\tchildRunId: params.childRunId, requesterSessionKey: targetRequesterSessionKey,
\t\t\tnextRunId: buildAnnounceIdempotencyKey(announceId),
\t\t\tfindings, outcome
\t\t}, params.signal);
\t\tif (zinkCompletionGate.governed) {
\t\t\tshouldDeleteChildSession = false;
\t\t\tif (zinkCompletionGate.action !== "deliver") return zinkCompletionGate.action === "discard";
\t\t\tfindings = zinkCompletionGate.receipt;
\t\t}
${finalAnchor}`;

// M10/T2-R5 — host-side Discord inbound metadata exposure.
//
// The pinned host drops structured Discord metadata (mentions, reply
// reference, authorship) during canonical mapping, before any plugin hook or
// run param can observe it. This edit records the structured fields at the
// Discord preflight seam, where the raw discord.js message is still in
// scope, into a bounded messageId-keyed registry the boundary reads back by
// currentMessageId. Write and read are on the SAME causal inbound path (a
// turn for a message exists only after that message's preflight completes),
// so there is no event-ordering assumption and no dependency on
// message_received/fireAndForgetHook. Memory-only, exact-match, eviction
// and restart both degrade to deny.
//
// Defined before the edit tables so EDITS_BY_ROLE can reference the
// preflight pair without a temporal-dead-zone break.

/** Registry key shared by the preflight writer and the boundary reader. */
export const ZINK_INGRESS_METADATA_KEY = "__zink_ingress_metadata_r5";

/** Maximum retained inbound metadata records; oldest-first eviction. */
export const ZINK_INGRESS_METADATA_LIMIT = 256;

/**
 * M10/T2-R8 — the superseded R5 preflight injection, retained verbatim as
 * the lineage predecessor of DISCORD_PREFLIGHT_INJECTION. The live runtime
 * carries this exact region; the R8 union-sources repair replaces it. The
 * verbatim transcription is proven by the R8 lineage test, which inverts
 * the live file through this text to the pinned baseline byte-for-byte:
 * any drift here fails that test instead of silently widening recognition.
 */
export const DISCORD_PREFLIGHT_INJECTION_R5 = `\t;{
\t\t// M10/T2-R5: deterministic Discord inbound metadata (see native-patch).
\t\ttry {
\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);
\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };
\t\t\tconst zinkMessageId = zinkSnowflake(message?.id);
\t\t\tif (zinkMessageId) {
\t\t\t\tlet zinkRegistry = globalThis.${ZINK_INGRESS_METADATA_KEY};
\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.${ZINK_INGRESS_METADATA_KEY} = zinkRegistry; }
\t\t\t\twhile (zinkRegistry.size >= ${ZINK_INGRESS_METADATA_LIMIT}) { zinkRegistry.delete(zinkRegistry.keys().next().value); }
\t\t\t\tzinkRegistry.set(zinkMessageId, {
\t\t\t\t\tmentionedUserIds: zinkIds(message.mentionedUsers),
\t\t\t\t\tmentionedRoleIds: zinkIds(message.mentionedRoles),
\t\t\t\t\treplyReferenceMessageId: zinkSnowflake(message.messageReference?.message_id),
\t\t\t\t\treplyReferenceAuthorId: zinkSnowflake(message.referencedMessage?.author?.id),
\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),
\t\t\t\t\tauthorIsBot: message.author?.bot === true,
\t\t\t\t});
\t\t\t}
\t\t} catch { /* fail-closed: no record, downstream denies as today */ }
\t}`;

/**
 * Unique anchor in message-handler.preflight-C1XBiefW.js: the Discord
 * mention-state call whose scope holds the raw `message`, the
 * host-resolved `threadOwnerId`, and the author/bot bindings.
 */
/**
 * M10/T2-R8: the DEPLOYED R8 union-sources injection, retained verbatim as
 * the lineage predecessor of the diagnostics build. The live runtime carries
 * this exact region; the diagnostics build replaces it. Emitted as an escaped
 * string literal rather than a template literal precisely so the bytes are
 * exact: a hand-transcribed 2.3KB template is a transcription risk, and the
 * R8 lineage test PROVES this text by inverting the live file through it back
 * to the pinned baseline byte-for-byte. Drift fails that test instead of
 * silently widening recognition.
 */
/**
 * M10/T2-R8: the DEPLOYED first diagnostics injection, retained verbatim as the
 * lineage predecessor of the hardened diagnostics build. Same rationale as the
 * union constant: emitted as an escaped string literal so the bytes are exact,
 * and proven by the R8 lineage test inverting the live file through it back to
 * the pinned upstream baseline.
 */
export const DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS =
  '\t;{\n\t\t// M10/T2-R8: deterministic Discord inbound metadata (see native-patch).\n\t\ttry {\n\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);\n\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };\n\t\t\tconst zinkUniq = (ids) => [...new Set(ids)];\n\t\t\tconst zinkFirst = (...values) => { for (const value of values) { const id = zinkSnowflake(value); if (id) return id; } return null; };\n\t\t\tconst zinkCount = (entries) => (Array.isArray(entries) ? entries.length : 0);\n\t\t\tconst zinkRawData = (typeof params !== "undefined" && params) ? params.data : null;\n\t\t\tconst zinkRaw = (zinkRawData && typeof zinkRawData === "object") ? zinkRawData : null;\n\t\t\tconst zinkMessageRaw = (message && typeof message === "object") ? message.rawDataValue : null;\n\t\t\tconst zinkMessageRawObj = (zinkMessageRaw && typeof zinkMessageRaw === "object") ? zinkMessageRaw : null;\n\t\t\tconst zinkMessageId = zinkSnowflake(message?.id);\n\t\t\tconst zinkMentionUserIds = zinkUniq([...zinkIds(message.mentionedUsers), ...zinkIds(zinkMessageRawObj?.mentions), ...zinkIds(zinkRaw?.mentions)]);\n\t\t\tconst zinkMentionRoleIds = zinkUniq([...zinkIds(message.mentionedRoles), ...zinkIds(zinkMessageRawObj?.mention_roles), ...zinkIds(zinkRaw?.mention_roles)]);\n\t\t\tif (typeof logger !== "undefined" && logger && typeof logger.info === "function") {\n\t\t\t\tlogger.info("[zink-ingress-meta] msg=" + (zinkMessageId ?? "-")\n\t\t\t\t\t+ " wu=" + zinkCount(message?.mentionedUsers) + " wr=" + zinkCount(message?.mentionedRoles)\n\t\t\t\t\t+ " ru=" + zinkCount(zinkMessageRawObj?.mentions) + " rr=" + zinkCount(zinkMessageRawObj?.mention_roles)\n\t\t\t\t\t+ " du=" + zinkCount(zinkRaw?.mentions) + " dr=" + zinkCount(zinkRaw?.mention_roles)\n\t\t\t\t\t+ " mu=" + zinkMentionUserIds.length + " mr=" + zinkMentionRoleIds.length);\n\t\t\t}\n\t\t\tif (zinkMessageId) {\n\t\t\t\tlet zinkRegistry = globalThis.__zink_ingress_metadata_r5;\n\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.__zink_ingress_metadata_r5 = zinkRegistry; }\n\t\t\t\twhile (zinkRegistry.size >= 256) { zinkRegistry.delete(zinkRegistry.keys().next().value); }\n\t\t\t\tzinkRegistry.set(zinkMessageId, {\n\t\t\t\t\tmentionedUserIds: zinkMentionUserIds,\n\t\t\t\t\tmentionedRoleIds: zinkMentionRoleIds,\n\t\t\t\t\treplyReferenceMessageId: zinkFirst(message.messageReference?.message_id, zinkMessageRawObj?.message_reference?.message_id, zinkRaw?.message_reference?.message_id),\n\t\t\t\t\treplyReferenceAuthorId: zinkFirst(message.referencedMessage?.author?.id, zinkMessageRawObj?.referenced_message?.author?.id, zinkRaw?.referenced_message?.author?.id),\n\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),\n\t\t\t\t\tauthorIsBot: message.author?.bot === true || zinkMessageRawObj?.author?.bot === true || zinkRaw?.author?.bot === true,\n\t\t\t\t});\n\t\t\t}\n\t\t} catch { /* fail-closed: no record, downstream denies as today */ }\n\t}';

export const DISCORD_PREFLIGHT_INJECTION_R8_UNION =
  '\t;{\n\t\t// M10/T2-R8: deterministic Discord inbound metadata (see native-patch).\n\t\ttry {\n\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);\n\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };\n\t\t\tconst zinkUniq = (ids) => [...new Set(ids)];\n\t\t\tconst zinkFirst = (...values) => { for (const value of values) { const id = zinkSnowflake(value); if (id) return id; } return null; };\n\t\t\tconst zinkRawData = (typeof params !== "undefined" && params) ? params.data : null;\n\t\t\tconst zinkRaw = (zinkRawData && typeof zinkRawData === "object") ? zinkRawData : null;\n\t\t\tconst zinkMessageRaw = (message && typeof message === "object") ? message.rawDataValue : null;\n\t\t\tconst zinkMessageRawObj = (zinkMessageRaw && typeof zinkMessageRaw === "object") ? zinkMessageRaw : null;\n\t\t\tconst zinkMessageId = zinkSnowflake(message?.id);\n\t\t\tif (zinkMessageId) {\n\t\t\t\tlet zinkRegistry = globalThis.__zink_ingress_metadata_r5;\n\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.__zink_ingress_metadata_r5 = zinkRegistry; }\n\t\t\t\twhile (zinkRegistry.size >= 256) { zinkRegistry.delete(zinkRegistry.keys().next().value); }\n\t\t\t\tzinkRegistry.set(zinkMessageId, {\n\t\t\t\t\tmentionedUserIds: zinkUniq([...zinkIds(message.mentionedUsers), ...zinkIds(zinkMessageRawObj?.mentions), ...zinkIds(zinkRaw?.mentions)]),\n\t\t\t\t\tmentionedRoleIds: zinkUniq([...zinkIds(message.mentionedRoles), ...zinkIds(zinkMessageRawObj?.mention_roles), ...zinkIds(zinkRaw?.mention_roles)]),\n\t\t\t\t\treplyReferenceMessageId: zinkFirst(message.messageReference?.message_id, zinkMessageRawObj?.message_reference?.message_id, zinkRaw?.message_reference?.message_id),\n\t\t\t\t\treplyReferenceAuthorId: zinkFirst(message.referencedMessage?.author?.id, zinkMessageRawObj?.referenced_message?.author?.id, zinkRaw?.referenced_message?.author?.id),\n\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),\n\t\t\t\t\tauthorIsBot: message.author?.bot === true || zinkMessageRawObj?.author?.bot === true || zinkRaw?.author?.bot === true,\n\t\t\t\t});\n\t\t\t}\n\t\t} catch { /* fail-closed: no record, downstream denies as today */ }\n\t}';

/**
 * M10/T2-R8: the DEPLOYED hardened diagnostics injection, retained verbatim as
 * the lineage predecessor of the stderr-grounded build. It probes every source
 * defensively and emits the report first, but routes the report only through the
 * child logger. Deployed and read back live, it produced NO report at all, which
 * is the evidence that motivated stderr: a transport that cannot fail silently
 * has to carry the finding too.
 */
export const DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED =
  '\t;{\n\t\t// M10/T2-R8: deterministic Discord inbound metadata (see native-patch).\n\t\t//\n\t\t// The report is emitted to stderr FIRST, because stderr reaches the\n\t\t// service journal with no transport, level or redaction filter in\n\t\t// between. Two earlier builds produced no diagnostic at all even though\n\t\t// the region was present, loaded and positioned inside\n\t\t// preflightDiscordMessage, so a silent catch around the child logger is\n\t\t// exactly the failure mode that must not be able to hide the finding\n\t\t// again: the logger is now called LAST and reports its own failure on\n\t\t// stderr. Each count is read through a defensive probe that reports -1\n\t\t// when that specific source THREW, which is itself the finding.\n\t\tconst zinkProbe = (read) => { try { const value = read(); return Array.isArray(value) ? value.length : 0; } catch { return -1; } };\n\t\tconst zinkFlag = (read) => { try { return read() === true; } catch { return false; } };\n\t\ttry {\n\t\t\tconst zinkMessageId = typeof message?.id === "string" && /^[1-9][0-9]{16,19}$/.test(message.id) ? message.id : null;\n\t\t\tconst zinkData = (typeof params !== "undefined" && params && typeof params === "object") ? params.data : null;\n\t\t\tconst zinkRaw = (zinkData && typeof zinkData === "object") ? zinkData : null;\n\t\t\tconst zinkMessageRaw = (() => { try { return message && typeof message === "object" ? message.rawDataValue : null; } catch { return null; } })();\n\t\t\tconst zinkMessageRawObj = (zinkMessageRaw && typeof zinkMessageRaw === "object") ? zinkMessageRaw : null;\n\t\t\tconst zinkDiag = {\n\t\t\t\tzinkIngress: {\n\t\t\t\t\tmsg: zinkMessageId ?? "-",\n\t\t\t\t\twu: zinkProbe(() => message?.mentionedUsers),\n\t\t\t\t\twr: zinkProbe(() => message?.mentionedRoles),\n\t\t\t\t\tru: zinkProbe(() => zinkMessageRawObj?.mentions),\n\t\t\t\t\trr: zinkProbe(() => zinkMessageRawObj?.mention_roles),\n\t\t\t\t\tdu: zinkProbe(() => zinkRaw?.mentions),\n\t\t\t\t\tdr: zinkProbe(() => zinkRaw?.mention_roles),\n\t\t\t\t\thasDispatch: zinkRaw ? 1 : 0,\n\t\t\t\t\thasRawData: zinkMessageRawObj ? 1 : 0,\n\t\t\t\t}\n\t\t\t};\n\t\t\tconst zinkReport = (line) => { try { process.stderr.write(line + "\\n"); } catch { /* stderr unavailable */ } };\n\t\t\tzinkReport("[zink-ingress-meta] " + JSON.stringify(zinkDiag.zinkIngress));\n\t\t\ttry {\n\t\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);\n\t\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };\n\t\t\t\tconst zinkUniq = (ids) => [...new Set(ids)];\n\t\t\t\tconst zinkFirst = (...values) => { for (const value of values) { const id = zinkSnowflake(value); if (id) return id; } return null; };\n\t\t\t\tconst zinkSafeFirst = (read) => { try { return read(); } catch { return undefined; } };\n\t\t\t\tconst zinkSafeIds = (read) => { try { return zinkIds(read()); } catch { return []; } };\n\t\t\t\tconst zinkMentionUserIds = zinkUniq([...zinkSafeIds(() => message.mentionedUsers), ...zinkSafeIds(() => zinkMessageRawObj?.mentions), ...zinkSafeIds(() => zinkRaw?.mentions)]);\n\t\t\t\tconst zinkMentionRoleIds = zinkUniq([...zinkSafeIds(() => message.mentionedRoles), ...zinkSafeIds(() => zinkMessageRawObj?.mention_roles), ...zinkSafeIds(() => zinkRaw?.mention_roles)]);\n\t\t\t\tif (zinkMessageId) {\n\t\t\t\t\tlet zinkRegistry = globalThis.__zink_ingress_metadata_r5;\n\t\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.__zink_ingress_metadata_r5 = zinkRegistry; }\n\t\t\t\t\twhile (zinkRegistry.size >= 256) { zinkRegistry.delete(zinkRegistry.keys().next().value); }\n\t\t\t\t\tzinkRegistry.set(zinkMessageId, {\n\t\t\t\t\t\tmentionedUserIds: zinkMentionUserIds,\n\t\t\t\t\t\tmentionedRoleIds: zinkMentionRoleIds,\n\t\t\t\t\t\treplyReferenceMessageId: zinkFirst(zinkSafeFirst(() => message.messageReference?.message_id), zinkSafeFirst(() => zinkMessageRawObj?.message_reference?.message_id), zinkSafeFirst(() => zinkRaw?.message_reference?.message_id)),\n\t\t\t\t\t\treplyReferenceAuthorId: zinkFirst(zinkSafeFirst(() => message.referencedMessage?.author?.id), zinkSafeFirst(() => zinkMessageRawObj?.referenced_message?.author?.id), zinkSafeFirst(() => zinkRaw?.referenced_message?.author?.id)),\n\t\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),\n\t\t\t\t\t\tauthorIsBot: zinkFlag(() => message.author?.bot) || zinkFlag(() => zinkMessageRawObj?.author?.bot) || zinkFlag(() => zinkRaw?.author?.bot),\n\t\t\t\t\t});\n\t\t\t\t}\n\t\t\t} catch { zinkReport("[zink-ingress-meta] registry write failed"); }\n\t\t\ttry {\n\t\t\t\tif (logger && typeof logger.info === "function") logger.info(zinkDiag, "[zink-ingress-meta]");\n\t\t\t} catch (zinkLoggerError) {\n\t\t\t\tzinkReport("[zink-ingress-meta] child logger unavailable");\n\t\t\t}\n\t\t} catch { /* fail-closed: no record, downstream denies as today */ }\n\t}';

export const DISCORD_PREFLIGHT_ANCHOR =
  "\tconst { implicitMentionKinds, wasMentioned } = resolveDiscordMentionState({\n\t\tauthorIsBot: Boolean(author.bot),\n\t\tbotId,\n\t\thasAnyMention,\n\t\tisDirectMessage,\n\t\tisExplicitlyMentioned: explicitlyMentioned,\n\t\tmentionRegexes,\n\t\tmentionText,\n\t\tmentionedEveryone: message.mentionedEveryone,\n\t\treferencedAuthorId: message.referencedMessage?.author?.id,\n\t\tsenderIsPluralKit: sender.isPluralKit,\n\t\ttranscript: preflightTranscript\n\t});";

/**
 * Appended after the anchor. Reads ONLY structured Discord identity fields;
 * never message text, never heuristics. Every id is snowflake-validated
 * with malformed entries dropped; a missing/invalid message writes
 * nothing. The whole block is exception-safe: any unexpected host shape
 * skips the write (downstream denies as today) instead of breaking
 * preflight. Free variables: `message`, `threadOwnerId`, and the optional
 * preflight `params` (guarded by typeof so scopes without it keep working).
 *
 * M10/T2-R8: the wrapper (`message.mentionedUsers` et al.) is unioned with
 * the message's own `rawDataValue` and the raw gateway dispatch
 * (`params.data`, which the host spreads into the dispatch object). Live
 * evidence showed the wrapper arrays empty at this seam for a structured
 * @Main mention while the dispatch is the authoritative structured source
 * at the same layer (partial messages, synthetic debounce-batch rebuilds
 * and hydration merges can all diverge from the wrapper). Union-only:
 * every source is still a structured snowflake id, exact-matched
 * downstream, so an id is admitted only when Discord really addressed it.
 *
 * M10/T2-R8 diagnostics: the union alone did not recover the mention, so the
 * seam now REPORTS what each structured source actually held. One INFO line
 * per inbound message carries per-source COUNTS only — never the content,
 * never sender identity, never a token. R5 H2's prohibition on reading
 * message text in this path is deliberately preserved: a boolean derived from
 * content would be the first content-derived value in the admission metadata
 * path, and the counts already answer the question that matters (did Discord
 * deliver `mentions[]`, and if so which source carried it). `logger` is
 * optional: a scope without one still writes the registry.
 */
export const DISCORD_PREFLIGHT_INJECTION = `\t;{
\t\t// M10/T2-R8: deterministic Discord inbound metadata (see native-patch).
\t\t//
\t\t// The report is emitted to stderr FIRST, because stderr reaches the
\t\t// service journal with no transport, level or redaction filter in
\t\t// between. Two earlier builds produced no diagnostic at all even though
\t\t// the region was present, loaded and positioned inside
\t\t// preflightDiscordMessage, so a silent catch around the child logger is
\t\t// exactly the failure mode that must not be able to hide the finding
\t\t// again: the logger is now called LAST and reports its own failure on
\t\t// stderr. Each count is read through a defensive probe that reports -1
\t\t// when that specific source THREW, which is itself the finding.
\t\tconst zinkProbe = (read) => { try { const value = read(); return Array.isArray(value) ? value.length : 0; } catch { return -1; } };
\t\tconst zinkFlag = (read) => { try { return read() === true; } catch { return false; } };
\t\t// Declared in the BLOCK scope, not inside a try: both the diagnostic below
\t\t// and the preflight intake gate below report through it. A \`const\` inside a
\t\t// try is scoped to that try, so the gate's reference threw a ReferenceError
\t\t// that its own catch swallowed — the gate then silently never denied.
\t\tconst zinkReport = (line) => { try { process.stderr.write(line + "\\n"); } catch { /* stderr unavailable */ } };
\t\ttry {
\t\t\tconst zinkMessageId = typeof message?.id === "string" && /^[1-9][0-9]{16,19}$/.test(message.id) ? message.id : null;
\t\t\tconst zinkData = (typeof params !== "undefined" && params && typeof params === "object") ? params.data : null;
\t\t\tconst zinkRaw = (zinkData && typeof zinkData === "object") ? zinkData : null;
\t\t\tconst zinkMessageRaw = (() => { try { return message && typeof message === "object" ? message.rawDataValue : null; } catch { return null; } })();
\t\t\tconst zinkMessageRawObj = (zinkMessageRaw && typeof zinkMessageRaw === "object") ? zinkMessageRaw : null;
\t\t\tconst zinkDiag = {
\t\t\t\tzinkIngress: {
\t\t\t\t\tmsg: zinkMessageId ?? "-",
\t\t\t\t\twu: zinkProbe(() => message?.mentionedUsers),
\t\t\t\t\twr: zinkProbe(() => message?.mentionedRoles),
\t\t\t\t\tru: zinkProbe(() => zinkMessageRawObj?.mentions),
\t\t\t\t\trr: zinkProbe(() => zinkMessageRawObj?.mention_roles),
\t\t\t\t\tdu: zinkProbe(() => zinkRaw?.mentions),
\t\t\t\t\tdr: zinkProbe(() => zinkRaw?.mention_roles),
\t\t\t\t\thasDispatch: zinkRaw ? 1 : 0,
\t\t\t\t\thasRawData: zinkMessageRawObj ? 1 : 0,
\t\t\t\t}
\t\t\t};
\t\t\tzinkReport("[zink-ingress-meta] " + JSON.stringify(zinkDiag.zinkIngress));
\t\t\ttry {
\t\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);
\t\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };
\t\t\t\tconst zinkUniq = (ids) => [...new Set(ids)];
\t\t\t\tconst zinkFirst = (...values) => { for (const value of values) { const id = zinkSnowflake(value); if (id) return id; } return null; };
\t\t\t\tconst zinkSafeFirst = (read) => { try { return read(); } catch { return undefined; } };
\t\t\t\tconst zinkSafeIds = (read) => { try { return zinkIds(read()); } catch { return []; } };
\t\t\t\tconst zinkMentionUserIds = zinkUniq([...zinkSafeIds(() => message.mentionedUsers), ...zinkSafeIds(() => zinkMessageRawObj?.mentions), ...zinkSafeIds(() => zinkRaw?.mentions)]);
\t\t\t\tconst zinkMentionRoleIds = zinkUniq([...zinkSafeIds(() => message.mentionedRoles), ...zinkSafeIds(() => zinkMessageRawObj?.mention_roles), ...zinkSafeIds(() => zinkRaw?.mention_roles)]);
\t\t\t\tif (zinkMessageId) {
\t\t\t\t\tlet zinkRegistry = globalThis.${ZINK_INGRESS_METADATA_KEY};
\t\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.${ZINK_INGRESS_METADATA_KEY} = zinkRegistry; }
\t\t\t\t\twhile (zinkRegistry.size >= ${ZINK_INGRESS_METADATA_LIMIT}) { zinkRegistry.delete(zinkRegistry.keys().next().value); }
\t\t\t\t\tzinkRegistry.set(zinkMessageId, {
\t\t\t\t\t\tmentionedUserIds: zinkMentionUserIds,
\t\t\t\t\t\tmentionedRoleIds: zinkMentionRoleIds,
\t\t\t\t\t\treplyReferenceMessageId: zinkFirst(zinkSafeFirst(() => message.messageReference?.message_id), zinkSafeFirst(() => zinkMessageRawObj?.message_reference?.message_id), zinkSafeFirst(() => zinkRaw?.message_reference?.message_id)),
\t\t\t\t\t\treplyReferenceAuthorId: zinkFirst(zinkSafeFirst(() => message.referencedMessage?.author?.id), zinkSafeFirst(() => zinkMessageRawObj?.referenced_message?.author?.id), zinkSafeFirst(() => zinkRaw?.referenced_message?.author?.id)),
\t\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),
\t\t\t\t\t\tauthorIsBot: zinkFlag(() => message.author?.bot) || zinkFlag(() => zinkMessageRawObj?.author?.bot) || zinkFlag(() => zinkRaw?.author?.bot),
\t\t\t\t\t});
\t\t\t\t}
\t\t\t} catch { zinkReport("[zink-ingress-meta] registry write failed"); }
\t\t\ttry {
\t\t\t\tif (logger && typeof logger.info === "function") logger.info(zinkDiag, "[zink-ingress-meta]");
\t\t\t} catch (zinkLoggerError) {
\t\t\t\tzinkReport("[zink-ingress-meta] child logger unavailable");
\t\t\t}
\t\t} catch { /* fail-closed: no record, downstream denies as today */ }
\t\t// M10/T2-R8: the NORMAL direct-intake decision, taken HERE rather than at
\t\t// the native gate. The host only builds a run when this function returns a
\t\t// context, and it starts typing and enqueues strictly after that
\t\t// (\`message-handler-cizxbaDc.js\`: preflight -> \`if (!ctx) return\` ->
\t\t// startAcceptedTypingFeedback -> messageRunQueue.enqueue). So returning
\t\t// null here is what makes a direct specialist mention cost zero run, zero
\t\t// typing, zero execution and zero outbound, instead of a created run that
\t\t// fails later and surfaces a host error.
\t\t//
\t\t// The predicate is the plugin's own, reached through one published global;
\t\t// there is no second copy of the policy here. When it is absent — plugin not
\t\t// loaded, or a build without this seam — nothing is decided and the late
\t\t// \`enterNativeRun\` gate still governs the run.
\t\ttry {
\t\t\tconst zinkGate = globalThis[Symbol.for("zink.governance.native.preflightIngress")];
\t\t\tif (typeof zinkGate === "function" && effectiveRoute && typeof effectiveRoute.agentId === "string") {
\t\t\t\tconst zinkDecision = await zinkGate({
\t\t\t\t\tagentId: effectiveRoute.agentId,
\t\t\t\t\taccountId: typeof resolvedAccountId === "string" ? resolvedAccountId : null,
\t\t\t\t\tmessageId: typeof message?.id === "string" ? message.id : null,
\t\t\t\t});
\t\t\t\tif (zinkDecision && zinkDecision.allow === false) {
\t\t\t\t\tzinkReport("[zink-ingress-denied] reason=" + String(zinkDecision.reason));
\t\t\t\t\treturn null;
\t\t\t\t}
\t\t\t}
\t\t} catch { /* the late gate still governs; never decide here */ }
\t}`;

const DISCORD_PREFLIGHT_EDITS = [
  [
    DISCORD_PREFLIGHT_ANCHOR,
    `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
  ],
];

// The edit sets are defined ONCE, by the ROLE a bundle plays, and each release's
// pin references a role. Duplicating the patch text per release would let two
// releases drift apart in exactly the way the duplicated-policy findings
// describe, so the text lives here and only the filenames+hashes are per-release.
const SELECTION_EDITS = [
  [
    "import { a as normalizeLowercaseStringOrEmpty",
    'import { enterNativeRun, installNativeToolGate, finishNativeRun, sanitizeNativePrompt } from "./zink-governance-boundary.mjs";\nimport { a as normalizeLowercaseStringOrEmpty',
  ],
  [
    "async function runEmbeddedAttempt(params) {",
    "async function runEmbeddedAttempt(params) {\n\tparams = { ...params, prompt: await sanitizeNativePrompt(params.config, params.prompt) };",
  ],
  [selectionAnchor, selectionPatch],
  [
    "\t\t\tconst acceptedSessionSpawns = getAcceptedSessionSpawns();",
    `\t\t\tawait finishNativeRun(params.config, {
\t\t\t\tlastAssistant, yielded: yieldDetected,
\t\t\t\tsuccess: !aborted && !promptError && !timedOut && !idleTimedOut,
\t\t\t\ttimedOut: timedOut || idleTimedOut,
\t\t\t\t// Provider usage for the completed turn, when the runtime reports it.
\t\t\t\t// Absent is normal: the quota seam then stays "unknown", which already
\t\t\t\t// keeps the PRIMARY model.
\t\t\t\tusage: typeof attemptUsage === "undefined" ? null : attemptUsage
\t\t\t}, { agentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId });
\t\t\tconst acceptedSessionSpawns = getAcceptedSessionSpawns();`,
  ],
];

const ANNOUNCE_EDITS = [
  [
    "import { c as normalizeOptionalString }",
    'import { gateNativeAnnounce } from "./zink-governance-boundary.mjs";\nimport { c as normalizeOptionalString }',
  ],
  [
    "\t\t\t\tfindings: childCompletionFindings,",
    "\t\t\t\tfindings: zinkWakeGate.governed ? zinkWakeGate.receipt : childCompletionFindings,",
  ],
  [wakeAnchor, wakePatch],
  [
    "\t\tif (!childCompletionFindings) {",
    '\t\tif (subagentAnnounceDeps.getRuntimeConfig()?.plugins?.entries?.["zink-governance"]?.enabled === true) childCompletionFindings = void 0;\n\t\tif (!childCompletionFindings) {',
  ],
  [
    '\t\tconst findings = childCompletionFindings || reply || "(no output)";',
    '\t\tlet findings = childCompletionFindings || reply || "(no output)";',
  ],
  [finalAnchor, finalPatch],
];

const EDITS_BY_ROLE = Object.freeze({
  selection: SELECTION_EDITS,
  announce: ANNOUNCE_EDITS,
  "discord-preflight": DISCORD_PREFLIGHT_EDITS,
});

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("NATIVE_PATCH_ANCHOR_MISMATCH");
  return source.replace(before, () => after);
}

// M8/T2.2-R14 — native patch LINEAGE compatibility.
//
// The patcher previously modelled the runtime as a two-state toggle: the exact
// upstream baseline, or the exact patched state this patcher generates itself.
// That is not how the deployment graph actually goes. R7 changed the selection
// injection, so the host carries the R7 patch, and the R10 patcher could not
// recognise it: the patcher inverts only ITS OWN patch string, found none, and
// failed closed with NATIVE_SOURCE_DRIFT. That is how the authorized R10
// deployment was lost on 2026-09-30.
//
// A predecessor is recognised by EXACT identity, never by a heuristic: its own
// source digest, its own patch signature, and the pinned baseline digest that
// inverting that signature must reproduce. Recognition additionally requires the
// predecessor signature to begin with the SAME revert anchor the current patch
// uses, so the transition is a region substitution performed entirely in memory
// and the live runtime is never exposed to an unpatched intermediate state.
//
// For R10 the only required predecessor is R7. R5 and R6 are deliberately NOT
// listed: the actual deployment graph requires only R7, and an entry for a
// revision nothing depends on would widen the recognized surface for nothing.
// M10/T2-R5 — the R10 patch is the recognised predecessor, superseded by the
// R4/R5 patch (threadId forwarding; R5 adds no further selection change).
// The R7 descriptor is retired: no R7 runtime remains in the deployment
// graph (the live runtime has been R10 since the R16 deployment), and the
// mechanism holds exactly one active slot per artifact, so the slot follows
// the actual deployment chain R10→R5. The R4 tree state (selection 04e92061…,
// never deployed) is superseded-and-recorded, not admitted: nothing can
// carry it. R7/R4 history stays recorded in tests/docs, not here.
const selectionPatchR10 = `${selectionAnchor}
\t\t\tawait enterNativeRun(params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId,
\t\t\t\tinputProvenance: params.inputProvenance,
\t\t\t\tchannelId: params.messageChannel ?? params.messageProvider,
\t\t\t\tsenderId: params.senderId, currentMessageId: params.currentMessageId,
\t\t\t\ttrigger: params.trigger, transcriptPrompt: params.transcriptPrompt
\t\t\t}, params.abortSignal);
\t\t\tinstallNativeToolGate(activeSession.agent, params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId
\t\t\t});`;

/**
 * Approved patch predecessors, per runtime release AND per artifact.
 *
 * A descriptor binds one artifact for one release. A digest recorded for one
 * artifact never authorizes another, so it cannot be replayed across the
 * governed surface.
 *
 * - `revision` — predecessor identity, for operator-facing diagnostics.
 * - `sourceSignature` — the exact text the predecessor injected in place of
 *   `supersedes`.
 * - `supersedes` — the current replacement it replaces, which binds the
 *   descriptor to ONE exact edit slot rather than to a position or an offset.
 * - `sourceDigest` — the exact sha256 of the predecessor-patched artifact.
 * - `successorRevision` — the revision this descriptor exists to reach.
 *
 * Only the differing edit is recorded. A bundle's other edits are byte-identical
 * between the two revisions and are reused rather than duplicated: duplicating
 * them would let the two revisions drift apart in exactly the way this mechanism
 * exists to prevent.
 */
export const NATIVE_PATCH_PREDECESSORS = Object.freeze({
  "2026.6.34": Object.freeze({
    "selection-DopzNY3I.js": Object.freeze({
      revision: "R10",
      sourceSignature: selectionPatchR10,
      supersedes: selectionPatch,
      sourceDigest:
        "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5",
      successorRevision: "R5",
    }),
    // M10/T2-R8: the live channel preflight now carries the stderr-grounded
    // region, superseded by the preflight intake seam. Recognition is exact:
    // the live digest, the superseded region text, and inversion to the pinned
    // channel baseline must all reproduce, otherwise the runtime fails closed
    // with NATIVE_SOURCE_DRIFT and no deployment proceeds.
    //
    // The RUNTIME-ROOT copy's lineage stays retired below: that chain was
    // injected into a file NOTHING loads, so it has no predecessor and none is
    // invented for it.
    "message-handler.preflight-CbD0u7U7.js": Object.freeze({
      revision: "R8-stderr-grounded",
      sourceSignature:
        DISCORD_PREFLIGHT_ANCHOR +
        "\n" +
        DISCORD_PREFLIGHT_INJECTION_R8_DIAGNOSTICS_HARDENED,
      supersedes: DISCORD_PREFLIGHT_ANCHOR + "\n" + DISCORD_PREFLIGHT_INJECTION,
      sourceDigest:
        "bc1a53d01617195cf4c376eb45034ea4ff9eb6137bc2c750943cbc842f64f4fd",
      successorRevision: "R8-preflight-intake",
    }),
    // M10/T2-R8 RETIRED SLOT, kept so the mistake stays auditable: the whole
    // R5→R8 chain (anchor, union-sources, diagnostics, hardened diagnostics,
    // stderr-grounded) was injected into
    // `openclaw/dist/message-handler.preflight-C1XBiefW.js` — a copy of the
    // Discord bundles that ships inside the runtime package and that NOTHING
    // loads, because the enabled `discord` plugin resolves to the separately
    // installed `@openclaw/discord` package under the profile's npm project
    // store. The executing preflight never carried any of those regions, which
    // is why the ingress metadata registry was never written and every
    // admissible message was denied for a missing mention. No descriptor is
    // declared for that file: nothing was written through it by a governed
    // apply this table recognises, and inventing one would fabricate history.
    // The retired regions stay exported and pinned in this module, and the
    // dead file's preimage is the `preimage/` directory of the transaction that
    // patched it.
  }),
});

/**
 * Recognise an approved predecessor and return the current patched output,
 * derived entirely in memory.
 *
 * Returns `null` for anything that is not an exact approved predecessor, so the
 * caller keeps failing closed. The predecessor's edit set is the current one with
 * the single superseded slot replaced, and recognition requires that inverting
 * that set reproduces the PINNED baseline byte for byte. The baseline therefore
 * exists only in memory and is never written to the live runtime.
 */
function applyPredecessor({ file, source, version, edits, entry }) {
  const descriptor = NATIVE_PATCH_PREDECESSORS[version]?.[file];
  if (!descriptor) return null;
  // Exact state identity, never a heuristic.
  if (sha256(source) !== descriptor.sourceDigest) return null;
  // Bind to one exact edit slot; refuse if the predecessor names a replacement
  // the current set does not contain.
  const slot = edits.findIndex(([, after]) => after === descriptor.supersedes);
  if (slot === -1) return null;
  const predecessorEdits = edits.map((pair, index) =>
    index === slot ? [pair[0], descriptor.sourceSignature] : pair,
  );
  let before;
  try {
    before = [...predecessorEdits]
      .reverse()
      .reduce(
        (text, [original, replacement]) =>
          replaceOnce(text, replacement, original),
        source,
      );
  } catch {
    return null;
  }
  if (sha256(before) !== entry.sha256) return null;
  const after = edits.reduce(
    (text, [from, to]) => replaceOnce(text, from, to),
    before,
  );
  return {
    state: "PREDECESSOR",
    predecessorRevision: descriptor.revision,
    successorRevision: descriptor.successorRevision,
    before,
    after,
    beforeDigest: sha256(before),
    afterDigest: sha256(after),
  };
}

export function transformNativeSource(file, source, version) {
  // Resolve the edit set and the expected hash from the pin for the release the
  // caller resolved, never from a single global table: that is what made a host
  // on a newer release look like an unexplained missing file.
  const pin = NATIVE_RUNTIME_PINS[version];
  const entry = pin?.sources?.[file];
  if (!entry) throw new Error("NATIVE_PATCH_TARGET_DENIED");
  const edits = EDITS_BY_ROLE[entry.role];
  if (!edits) throw new Error("NATIVE_PATCH_TARGET_DENIED");
  if (sha256(source) === entry.sha256) {
    const after = edits.reduce(
      (text, [before, replacement]) => replaceOnce(text, before, replacement),
      source,
    );
    return {
      state: "BASELINE",
      before: source,
      after,
      beforeDigest: sha256(source),
      afterDigest: sha256(after),
    };
  }
  // R14: an approved predecessor patch revision transforms forward in memory.
  const predecessor = applyPredecessor({ file, source, version, edits, entry });
  if (predecessor) return predecessor;
  // Already-patched is accepted only if exact inverse restores the frozen hash.
  let before;
  try {
    before = [...edits]
      .reverse()
      .reduce(
        (text, [original, replacement]) =>
          replaceOnce(text, replacement, original),
        source,
      );
  } catch {
    throw new Error("NATIVE_SOURCE_DRIFT");
  }
  if (sha256(before) !== entry.sha256) throw new Error("NATIVE_SOURCE_DRIFT");
  return {
    state: "PATCHED",
    before,
    after: source,
    beforeDigest: sha256(before),
    afterDigest: sha256(source),
  };
}

/** The OpenClaw release installed under `root`, or null when unreadable. */
function resolveRuntimeVersion(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
      .version;
  } catch {
    return null;
  }
}

export function inspectNativePatch(input) {
  const roots = nativeRoots(input);
  const root = roots.runtimeRoot;
  if (!root || !path.isAbsolute(root))
    throw new Error("NATIVE_ROOT_MUST_BE_ABSOLUTE");
  // Reject symlink ancestors before any source reads.
  for (const governed of Object.values(roots)) {
    if (!governed) continue;
    if (!path.isAbsolute(governed))
      throw new Error("NATIVE_ROOT_MUST_BE_ABSOLUTE");
    let cursor = path.resolve(governed);
    while (cursor !== path.dirname(cursor)) {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("NATIVE_ROOT_SYMLINK");
      cursor = path.dirname(cursor);
    }
  }
  // The runtime version is read FIRST and resolves the pin. A host on a release
  // this patch has not been verified against is a NAMED condition, not a bare
  // ENOENT about a hashed filename: an unverified release must never be
  // patched, and the operator has to be told which releases are supported.
  let installedVersion = resolveRuntimeVersion(root);
  if (!installedVersion) throw new Error("NATIVE_MANIFEST_UNREADABLE");
  const pin = NATIVE_RUNTIME_PINS[installedVersion];
  if (!pin) {
    const error = new Error(
      `NATIVE_VERSION_MISMATCH: this patch is verified against OpenClaw ${NATIVE_SUPPORTED_RUNTIME_VERSIONS.join(", ")} but the host has ${installedVersion}. An unverified release is never patched; adding one is a separately authorized runtime migration.`,
    );
    error.code = "NATIVE_VERSION_MISMATCH";
    error.expected = NATIVE_SUPPORTED_RUNTIME_VERSIONS;
    error.actual = installedVersion;
    throw error;
  }

  // Fail closed with a governance code, never a raw filesystem error, when a
  // pinned prerequisite is absent.
  for (const target of ["package.json", "dist", pin.runIdSource]) {
    const full = path.join(root, target);
    let stats;
    try {
      stats = lstatSync(full);
    } catch {
      const error = new Error(
        `NATIVE_SOURCE_DRIFT: pinned artifact ${target} is absent from OpenClaw ${installedVersion}`,
      );
      error.code = "NATIVE_SOURCE_DRIFT";
      error.artifact = target;
      throw error;
    }
    if (stats.isSymbolicLink()) throw new Error("NATIVE_TARGET_SYMLINK");
  }
  if (
    sha256(readFileSync(path.join(root, pin.runIdSource))) !==
    pin.runIdSourceSha256
  )
    throw new Error("NATIVE_RUN_ID_SOURCE_DRIFT");
  return Object.fromEntries(
    Object.keys(pin.sources).map((file) => {
      const target = sourcePath(roots, file, installedVersion);
      let stats;
      try {
        stats = lstatSync(target);
      } catch {
        const error = new Error(
          `NATIVE_SOURCE_DRIFT: pinned artifact ${file} is absent from OpenClaw ${installedVersion}`,
        );
        error.code = "NATIVE_SOURCE_DRIFT";
        error.artifact = file;
        throw error;
      }
      if (stats.isSymbolicLink()) throw new Error("NATIVE_TARGET_SYMLINK");
      return [
        file,
        transformNativeSource(
          file,
          readFileSync(target, "utf8"),
          installedVersion,
        ),
      ];
    }),
  );
}

function assertNoLinks(target) {
  if (!path.isAbsolute(target)) throw new Error("NATIVE_PATH_MUST_BE_ABSOLUTE");
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  )
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink())
      throw new Error("NATIVE_PATH_SYMLINK");
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !["EPERM", "EISDIR", "EINVAL", "ENOTSUP"].includes(error.code)
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeExclusive(file, contents, mode) {
  const fd = openSync(file, "wx", mode);
  try {
    writeFileSync(fd, contents);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function replaceAtomic(file, contents, mode) {
  const temporary = `${file}.zink-r12-tmp`;
  assertNoLinks(file);
  writeExclusive(temporary, contents, mode);
  try {
    chmodSync(temporary, mode);
    renameSync(temporary, file);
  } catch (cause) {
    // F-163: the temp name is FIXED and created exclusively, so a residue
    // left by an interrupted write makes every later replace of this file die
    // with EEXIST - including the six rollback writes inside
    // restoreNativePatch, so the residue of a failed apply blocked its own
    // recovery. The temp is removed on every failure path, so a failed write
    // leaves no residue and the next attempt succeeds.
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!["ENOENT", "EPERM", "EISDIR"].includes(error?.code)) throw error;
    }
    throw cause;
  }
  syncDirectory(path.dirname(file));
}

const bridgeContents = () =>
  readFileSync(new URL("./native-boundary.mjs", import.meta.url), "utf8");
const bridgeFile = (root) =>
  path.join(root, "dist", "zink-governance-boundary.mjs");

/** The bridge, relative to the runtime root. Part of the patched contract. */
export const NATIVE_BRIDGE_RELATIVE = "dist/zink-governance-boundary.mjs";

/**
 * M10/T2-R8: every live runtime file the native patch can rewrite, DERIVED
 * from the pins themselves rather than maintained by hand.
 *
 * The hand-maintained list this replaces named three files while the patch
 * actually writes four. A runtime file that the patch mutates but that is not
 * on the list escapes the transaction snapshot entirely, which produced two
 * false facts in one deployment: `runtime-verify` could not see the only
 * mutated component and reported the apply unverified, and the rollback
 * "verified" 39 already-identical files and reported success while the fourth
 * file was still mutated. Deriving from the pins makes that class
 * structurally impossible: a new pinned artifact is covered the moment it is
 * pinned. Frozen so a caller cannot widen the tracked set in place.
 */
export function nativePatchedRuntimeRelatives() {
  const relatives = new Set([NATIVE_BRIDGE_RELATIVE]);
  for (const pin of Object.values(NATIVE_RUNTIME_PINS))
    for (const [file, entry] of Object.entries(pin.sources))
      if ((entry.scope ?? "runtime") === "runtime")
        relatives.add(`dist/${file}`);
  return Object.freeze([...relatives].sort());
}

/**
 * M10/T2-R8: the runtime files that live in the installed Discord channel
 * package instead of the runtime root, expressed RELATIVE TO THE STATE
 * DIRECTORY.
 *
 * The channel package is installed under the profile's own state directory, so
 * the transaction snapshot already covers it: adding it as a state-relative
 * target keeps every backup, restore and drift check working without widening
 * the snapshot schema or introducing a third governed root. Deriving it from the
 * pins keeps "mutated but untracked" structurally impossible on the tree the
 * host actually executes.
 */
export function nativePatchedDiscordChannelRelatives() {
  const relatives = new Set();
  for (const pin of Object.values(NATIVE_RUNTIME_PINS))
    for (const [file, entry] of Object.entries(pin.sources))
      if (entry.scope === "discordChannel")
        relatives.add(`${NATIVE_DISCORD_CHANNEL_RELATIVE}/dist/${file}`);
  return Object.freeze([...relatives].sort());
}

/**
 * The expected post-image of every patched runtime file for the release
 * installed under the governed roots, read through the same inspection that
 * verifies the patch. This is the authoritative "what the runtime must look
 * like after a successful apply", derived from the patch contract and not from a
 * diff of what happened to change. An unverified release throws, so the caller
 * fails closed instead of verifying against a guess.
 */
export function nativeRuntimePostImage(input) {
  const roots = nativeRoots(input);
  const inspection = inspectNativePatch(roots);
  const entries = Object.entries(inspection).map(([file, entry]) => {
    const relative =
      NATIVE_RUNTIME_PINS[resolveRuntimeVersion(roots.runtimeRoot)].sources[
        file
      ].scope === "discordChannel"
        ? `${NATIVE_DISCORD_CHANNEL_RELATIVE}/dist/${file}`
        : `dist/${file}`;
    return { relative, sha256: entry.afterDigest };
  });
  entries.push({
    relative: NATIVE_BRIDGE_RELATIVE,
    sha256: sha256(bridgeContents()),
  });
  return Object.freeze(
    entries.sort((a, b) => (a.relative < b.relative ? -1 : 1)),
  );
}

export function checkNativePatch(input) {
  const roots = nativeRoots(input);
  const root = roots.runtimeRoot;
  const inspection = inspectNativePatch(roots);
  assertNoLinks(bridgeFile(root));
  if (
    !Object.values(inspection).every((entry) => entry.state === "PATCHED") ||
    !existsSync(bridgeFile(root)) ||
    sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
  )
    throw new Error("NATIVE_PATCH_INCOMPLETE");
  return { status: "PATCHED", files: Object.keys(inspection) };
}

// The backup manifest is built in ONE place. `restoreNativePatch` requires
// `runtime_version` to resolve a pin, and the two apply paths (fresh patch and
// re-take on an already-patched host) previously declared the manifest
// separately, so the fresh-patch manifest omitted the field and every backup
// taken while actually patching was unrestorable.
export function nativeBackupManifest(input) {
  const roots = nativeRoots(input);
  return {
    version: "m7-t2-r12",
    runtime_root: path.resolve(roots.runtimeRoot),
    // The Discord channel package root the backup was taken from, or null when
    // the caller patched runtime artifacts only. A restore must resolve the SAME
    // roots that produced the patch, so it is recorded rather than assumed.
    discord_channel_root: roots.discordChannelRoot
      ? path.resolve(roots.discordChannelRoot)
      : null,
    // The OpenClaw release the backup was taken from. A restore has to
    // resolve the SAME pin that produced the patch, and the file names in
    // a backup are release-specific, so this is recorded explicitly rather
    // than assumed to be the currently-deployed one.
    runtime_version: resolveRuntimeVersion(roots.runtimeRoot),
    bridge_digest: sha256(bridgeContents()),
    files: {},
  };
}

/**
 * Make `backupRoot` a complete, restorable preimage set for the CURRENT pin set.
 *
 * M10/T2-R8: a host can legitimately arrive with some pinned artifacts already
 * patched and a newly pinned one still at its baseline — exactly what happens
 * when the Discord preflight pin is corrected from the unloadable runtime-root
 * copy to the installed channel package. That state used to be refused outright
 * as `NATIVE_PATCH_PARTIAL_STATE`, which left the ingress repair undeployable.
 *
 * An existing backup is therefore EXTENDED rather than replaced, and only after
 * every preimage it already holds is proven to equal the digest the current
 * inspection derives. `BASELINE`, `PATCHED` and `PREDECESSOR` all invert to the
 * same upstream preimage by construction, so agreement is the invariant to
 * check; disagreement fails closed instead of overwriting a preimage that a
 * pending rollback may still need.
 */
function ensureNativeBackup(backupRoot, roots, inspection, version) {
  const manifestPath = path.join(backupRoot, "manifest.json");
  const expected = {};
  for (const [file, entry] of Object.entries(inspection))
    expected[file] = {
      before_digest: entry.beforeDigest,
      after_digest: entry.afterDigest,
      mode: lstatSync(sourcePath(roots, file, version)).mode & 0o777,
    };

  if (!existsSync(manifestPath)) {
    assertNoLinks(backupRoot);
    mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  }
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : null;
  if (
    manifest &&
    (manifest.version !== "m7-t2-r12" ||
      manifest.runtime_root !== path.resolve(roots.runtimeRoot) ||
      manifest.runtime_version !== version)
  )
    throw new Error("NATIVE_BACKUP_MANIFEST_INVALID");

  for (const [file, entry] of Object.entries(inspection)) {
    const backup = path.join(backupRoot, file);
    if (existsSync(backup)) {
      assertNoLinks(backup);
      if (sha256(readFileSync(backup, "utf8")) !== entry.beforeDigest)
        throw new Error("NATIVE_BACKUP_PREIMAGE_CONFLICT");
      continue;
    }
    writeExclusive(backup, entry.before, 0o600);
  }
  const next = nativeBackupManifest(roots);
  next.files = expected;
  // The manifest is this module's own derived record, so it is REPLACED: an
  // existing one may predate the current pin set (it did — it had no channel
  // entry and a stale after-image). The preimages it points at are never
  // overwritten; they were just proven to match the current `before` digests.
  replaceAtomic(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 0o600);
  syncDirectory(backupRoot);
  syncDirectory(path.dirname(backupRoot));
  return next;
}

export function applyNativePatch(input, backupRoot) {
  const roots = nativeRoots(input);
  const root = roots.runtimeRoot;
  const version = resolveRuntimeVersion(root);
  const inspection = inspectNativePatch(roots);
  // R14: a host carrying an approved predecessor patch revision is upgraded by
  // writing the successor directly. The predecessor's baseline exists only in
  // memory, inside the transform, so the live runtime is never written back to
  // the unpatched upstream baseline even momentarily.
  if (Object.values(inspection).some((e) => e.state === "PREDECESSOR")) {
    if (
      !Object.values(inspection).every((e) =>
        ["BASELINE", "PATCHED", "PREDECESSOR"].includes(e.state),
      )
    )
      throw new Error("NATIVE_PATCH_PARTIAL_STATE");
    // F-146: this branch rewrites the live runtime, so it needs the same
    // recovery path the converge branch has. The predecessor's preimage is the
    // upstream baseline, which the branch derives in memory, so the SAME
    // preimage set the converge branch writes is written BEFORE the first
    // write. A branch that cannot back up must not rewrite the runtime: the
    // backupRoot the caller handed us is either used or refused, never
    // silently discarded.
    if (!backupRoot) throw new Error("NATIVE_BACKUP_REQUIRED");
    ensureNativeBackup(backupRoot, roots, inspection, version);
    // Derive the whole plan in memory BEFORE the first write, so a failure here
    // cannot leave a half-converted runtime.
    const plan = Object.entries(inspection)
      .filter(([, entry]) => entry.state !== "PATCHED")
      .map(([file, entry]) => ({
        file,
        after: entry.after,
        mode: lstatSync(sourcePath(roots, file, version)).mode & 0o777,
      }));
    try {
      assertNoLinks(bridgeFile(root));
      if (
        !existsSync(bridgeFile(root)) ||
        sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
      )
        replaceAtomic(bridgeFile(root), bridgeContents(), 0o600);
      for (const { file, after, mode } of plan)
        replaceAtomic(sourcePath(roots, file, version), after, mode);
      // `checkNativePatch` is the same verification the other paths end with: every
      // pinned source must now invert exactly to the baseline, and the bridge must
      // be the current repository boundary.
      return checkNativePatch(roots);
    } catch (cause) {
      restoreNativePatch(roots, backupRoot);
      throw new Error("NATIVE_APPLY_FAILED_RESTORED", { cause });
    }
  }
  if (Object.values(inspection).every((entry) => entry.state === "PATCHED")) {
    if (
      !existsSync(bridgeFile(root)) ||
      sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
    ) {
      assertNoLinks(bridgeFile(root));
      replaceAtomic(bridgeFile(root), bridgeContents(), 0o600);
    }
    if (backupRoot) ensureNativeBackup(backupRoot, roots, inspection, version);
    return checkNativePatch(roots);
  }
  // M10/T2-R8: converge any host whose pinned artifacts are each either at
  // their upstream baseline or already carrying the current patch. Refusing a
  // mixed state is what made the ingress repair undeployable: correcting the
  // Discord preflight pin produced exactly this shape, because the core
  // artifacts were patched while the newly pinned channel artifact was still
  // at baseline. Every preimage is recorded before the first write, so the
  // native backup stays a complete restore target for the whole pin set.
  if (
    Object.values(inspection).every(
      (entry) => entry.state === "BASELINE" || entry.state === "PATCHED",
    )
  ) {
    const nothingPatchedYet = Object.values(inspection).every(
      (entry) => entry.state === "BASELINE",
    );
    if (nothingPatchedYet) {
      assertNoLinks(bridgeFile(root));
      if (existsSync(bridgeFile(root)))
        throw new Error("NATIVE_BRIDGE_ALREADY_EXISTS");
      assertNoLinks(backupRoot);
      const relativeBackup = path.relative(root, backupRoot);
      if (!(
        relativeBackup === ".." ||
        relativeBackup.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeBackup)
      ))
        throw new Error("NATIVE_BACKUP_MUST_BE_EXTERNAL");
    }
    const manifest = backupRoot
      ? ensureNativeBackup(backupRoot, roots, inspection, version)
      : null;
    try {
      if (nothingPatchedYet) {
        writeExclusive(bridgeFile(root), bridgeContents(), 0o600);
        syncDirectory(path.join(root, "dist"));
      }
      for (const [file, entry] of Object.entries(inspection)) {
        if (entry.state === "PATCHED") continue;
        const target = sourcePath(roots, file, version);
        if (sha256(readFileSync(target)) !== entry.beforeDigest)
          throw new Error("NATIVE_SOURCE_DRIFT");
        replaceAtomic(target, entry.after, manifest.files[file].mode);
      }
      return checkNativePatch(roots);
    } catch (cause) {
      if (backupRoot) restoreNativePatch(roots, backupRoot);
      throw new Error("NATIVE_APPLY_FAILED_RESTORED", { cause });
    }
  }
  throw new Error("NATIVE_PATCH_PARTIAL_STATE");
}

export function restoreNativePatch(input, backupRoot) {
  const roots = nativeRoots(input);
  const root = roots.runtimeRoot;
  assertNoLinks(root);
  assertNoLinks(backupRoot);
  assertNoLinks(path.join(backupRoot, "manifest.json"));
  const manifest = JSON.parse(
    readFileSync(path.join(backupRoot, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== "m7-t2-r12" ||
    manifest.runtime_root !== path.resolve(root) ||
    (manifest.discord_channel_root ?? null) !==
      (roots.discordChannelRoot
        ? path.resolve(roots.discordChannelRoot)
        : null) ||
    !NATIVE_RUNTIME_PINS[manifest.runtime_version] ||
    Object.keys(manifest.files).sort().join() !==
      Object.keys(NATIVE_RUNTIME_PINS[manifest.runtime_version].sources)
        .sort()
        .join()
  )
    throw new Error("NATIVE_BACKUP_MANIFEST_INVALID");
  const originals = {};
  // Validate every preimage/current target before restoring any file.
  for (const [file, expected] of Object.entries(manifest.files)) {
    const backup = path.join(backupRoot, file);
    const target = sourcePath(roots, file, manifest.runtime_version);
    assertNoLinks(backup);
    assertNoLinks(target);
    const contents = readFileSync(backup, "utf8");
    const transformed = transformNativeSource(
      file,
      contents,
      manifest.runtime_version,
    );
    if (
      transformed.state !== "BASELINE" ||
      transformed.beforeDigest !== expected.before_digest ||
      transformed.afterDigest !== expected.after_digest ||
      !Number.isInteger(expected.mode) ||
      expected.mode < 0 ||
      expected.mode > 0o777
    )
      throw new Error("NATIVE_BACKUP_INVALID");
    if (
      ![expected.before_digest, expected.after_digest].includes(
        sha256(readFileSync(target)),
      )
    )
      throw new Error("NATIVE_RESTORE_CONFLICT");
    originals[file] = contents;
  }
  assertNoLinks(bridgeFile(root));
  if (
    existsSync(bridgeFile(root)) &&
    sha256(readFileSync(bridgeFile(root))) !== manifest.bridge_digest
  )
    throw new Error("NATIVE_BRIDGE_RESTORE_CONFLICT");
  for (const [file, contents] of Object.entries(originals))
    replaceAtomic(
      sourcePath(roots, file, manifest.runtime_version),
      contents,
      manifest.files[file].mode,
    );
  if (existsSync(bridgeFile(root))) unlinkSync(bridgeFile(root));
  syncDirectory(path.join(root, "dist"));
  const restored = inspectNativePatch(roots);
  if (!Object.values(restored).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_RESTORE_FAILED");
  return { status: "RESTORED", files: Object.keys(restored) };
}
