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
      "message-handler.preflight-C1XBiefW.js": Object.freeze({
        role: "discord-preflight",
        sha256:
          "dca5459d27777d7884483d86432d82c0da88244338c3e6ec574a337ec687c0b0",
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
\t\ttry {
\t\t\tconst zinkSnowflake = (value) => (typeof value === "string" && /^[1-9][0-9]{16,19}$/.test(value) ? value : null);
\t\t\tconst zinkIds = (entries) => { const ids = []; if (Array.isArray(entries)) { for (const entry of entries) { const id = zinkSnowflake(typeof entry === "string" ? entry : entry?.id); if (id) ids.push(id); } } return ids; };
\t\t\tconst zinkUniq = (ids) => [...new Set(ids)];
\t\t\tconst zinkFirst = (...values) => { for (const value of values) { const id = zinkSnowflake(value); if (id) return id; } return null; };
\t\t\tconst zinkCount = (entries) => (Array.isArray(entries) ? entries.length : 0);
\t\t\tconst zinkRawData = (typeof params !== "undefined" && params) ? params.data : null;
\t\t\tconst zinkRaw = (zinkRawData && typeof zinkRawData === "object") ? zinkRawData : null;
\t\t\tconst zinkMessageRaw = (message && typeof message === "object") ? message.rawDataValue : null;
\t\t\tconst zinkMessageRawObj = (zinkMessageRaw && typeof zinkMessageRaw === "object") ? zinkMessageRaw : null;
\t\t\tconst zinkMessageId = zinkSnowflake(message?.id);
\t\t\tconst zinkMentionUserIds = zinkUniq([...zinkIds(message.mentionedUsers), ...zinkIds(zinkMessageRawObj?.mentions), ...zinkIds(zinkRaw?.mentions)]);
\t\t\tconst zinkMentionRoleIds = zinkUniq([...zinkIds(message.mentionedRoles), ...zinkIds(zinkMessageRawObj?.mention_roles), ...zinkIds(zinkRaw?.mention_roles)]);
\t\t\tif (typeof logger !== "undefined" && logger && typeof logger.info === "function") {
\t\t\t\tlogger.info("[zink-ingress-meta] msg=" + (zinkMessageId ?? "-")
\t\t\t\t\t+ " wu=" + zinkCount(message?.mentionedUsers) + " wr=" + zinkCount(message?.mentionedRoles)
\t\t\t\t\t+ " ru=" + zinkCount(zinkMessageRawObj?.mentions) + " rr=" + zinkCount(zinkMessageRawObj?.mention_roles)
\t\t\t\t\t+ " du=" + zinkCount(zinkRaw?.mentions) + " dr=" + zinkCount(zinkRaw?.mention_roles)
\t\t\t\t\t+ " mu=" + zinkMentionUserIds.length + " mr=" + zinkMentionRoleIds.length);
\t\t\t}
\t\t\tif (zinkMessageId) {
\t\t\t\tlet zinkRegistry = globalThis.${ZINK_INGRESS_METADATA_KEY};
\t\t\t\tif (!(zinkRegistry instanceof Map)) { zinkRegistry = new Map(); globalThis.${ZINK_INGRESS_METADATA_KEY} = zinkRegistry; }
\t\t\t\twhile (zinkRegistry.size >= ${ZINK_INGRESS_METADATA_LIMIT}) { zinkRegistry.delete(zinkRegistry.keys().next().value); }
\t\t\t\tzinkRegistry.set(zinkMessageId, {
\t\t\t\t\tmentionedUserIds: zinkMentionUserIds,
\t\t\t\t\tmentionedRoleIds: zinkMentionRoleIds,
\t\t\t\t\treplyReferenceMessageId: zinkFirst(message.messageReference?.message_id, zinkMessageRawObj?.message_reference?.message_id, zinkRaw?.message_reference?.message_id),
\t\t\t\t\treplyReferenceAuthorId: zinkFirst(message.referencedMessage?.author?.id, zinkMessageRawObj?.referenced_message?.author?.id, zinkRaw?.referenced_message?.author?.id),
\t\t\t\t\tthreadOwnerId: zinkSnowflake(threadOwnerId),
\t\t\t\t\tauthorIsBot: message.author?.bot === true || zinkMessageRawObj?.author?.bot === true || zinkRaw?.author?.bot === true,
\t\t\t\t});
\t\t\t}
\t\t} catch { /* fail-closed: no record, downstream denies as today */ }
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
    // M10/T2-R8: the live preflight file carries the R5 injection region,
    // superseded by the R8 union-sources repair (structured wrapper +
    // message rawDataValue + raw gateway dispatch). Recognition is exact:
    // the live digest, the R5 region text, and inversion to the pinned
    // preflight baseline must all reproduce, otherwise the runtime fails
    // closed with NATIVE_SOURCE_DRIFT and no deployment proceeds.
    "message-handler.preflight-C1XBiefW.js": Object.freeze({
      revision: "R5",
      sourceSignature: `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION_R5}`,
      supersedes: `${DISCORD_PREFLIGHT_ANCHOR}\n${DISCORD_PREFLIGHT_INJECTION}`,
      sourceDigest:
        "5411ccd4c8bafaa29013e498ee8c6cc58d034bd7db48dafcb1aeb105ddc61d8e",
      successorRevision: "R8",
    }),
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

export function inspectNativePatch(root) {
  if (!path.isAbsolute(root)) throw new Error("NATIVE_ROOT_MUST_BE_ABSOLUTE");
  // Reject symlink ancestors before any source reads.
  let cursor = path.resolve(root);
  while (cursor !== path.dirname(cursor)) {
    if (lstatSync(cursor).isSymbolicLink())
      throw new Error("NATIVE_ROOT_SYMLINK");
    cursor = path.dirname(cursor);
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
  for (const target of [
    "package.json",
    "dist",
    pin.runIdSource,
    ...Object.keys(pin.sources).map((file) => path.join("dist", file)),
  ]) {
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
    Object.keys(pin.sources).map((file) => [
      file,
      transformNativeSource(
        file,
        readFileSync(path.join(root, "dist", file), "utf8"),
        installedVersion,
      ),
    ]),
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
  chmodSync(temporary, mode);
  renameSync(temporary, file);
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
    for (const file of Object.keys(pin.sources)) relatives.add(`dist/${file}`);
  return Object.freeze([...relatives].sort());
}

/**
 * The expected post-image of every patched runtime file for the release
 * installed under `root`, read through the same inspection that verifies the
 * patch. This is the authoritative "what the runtime must look like after a
 * successful apply", derived from the patch contract and not from a diff of
 * what happened to change. An unverified release throws, so the caller fails
 * closed instead of verifying against a guess.
 */
export function nativeRuntimePostImage(root) {
  const inspection = inspectNativePatch(root);
  const entries = Object.entries(inspection).map(([file, entry]) => ({
    relative: `dist/${file}`,
    sha256: entry.afterDigest,
  }));
  entries.push({
    relative: NATIVE_BRIDGE_RELATIVE,
    sha256: sha256(bridgeContents()),
  });
  return Object.freeze(
    entries.sort((a, b) => (a.relative < b.relative ? -1 : 1)),
  );
}

export function checkNativePatch(root) {
  const inspection = inspectNativePatch(root);
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
export function nativeBackupManifest(root) {
  return {
    version: "m7-t2-r12",
    runtime_root: path.resolve(root),
    // The OpenClaw release the backup was taken from. A restore has to
    // resolve the SAME pin that produced the patch, and the file names in
    // a backup are release-specific, so this is recorded explicitly rather
    // than assumed to be the currently-deployed one.
    runtime_version: resolveRuntimeVersion(root),
    bridge_digest: sha256(bridgeContents()),
    files: {},
  };
}

export function applyNativePatch(root, backupRoot) {
  const inspection = inspectNativePatch(root);
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
    // Derive the whole plan in memory BEFORE the first write, so a failure here
    // cannot leave a half-converted runtime.
    const plan = Object.entries(inspection)
      .filter(([, entry]) => entry.state !== "PATCHED")
      .map(([file, entry]) => ({
        file,
        after: entry.after,
        mode: lstatSync(path.join(root, "dist", file)).mode & 0o777,
      }));
    assertNoLinks(bridgeFile(root));
    if (
      !existsSync(bridgeFile(root)) ||
      sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
    )
      replaceAtomic(bridgeFile(root), bridgeContents(), 0o600);
    for (const { file, after, mode } of plan)
      replaceAtomic(path.join(root, "dist", file), after, mode);
    // `checkNativePatch` is the same verification the other paths end with: every
    // pinned source must now invert exactly to the baseline, and the bridge must
    // be the current repository boundary.
    return checkNativePatch(root);
  }
  if (Object.values(inspection).every((entry) => entry.state === "PATCHED")) {
    if (
      !existsSync(bridgeFile(root)) ||
      sha256(readFileSync(bridgeFile(root))) !== sha256(bridgeContents())
    ) {
      assertNoLinks(bridgeFile(root));
      replaceAtomic(bridgeFile(root), bridgeContents(), 0o600);
    }
    if (backupRoot) {
      const manifestPath = path.join(backupRoot, "manifest.json");
      if (!existsSync(manifestPath)) {
        assertNoLinks(backupRoot);
        mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
        const manifest = nativeBackupManifest(root);
        for (const [file, entry] of Object.entries(inspection)) {
          const mode = lstatSync(path.join(root, "dist", file)).mode & 0o777;
          writeExclusive(path.join(backupRoot, file), entry.before, 0o600);
          manifest.files[file] = {
            before_digest: entry.beforeDigest,
            after_digest: entry.afterDigest,
            mode,
          };
        }
        writeExclusive(
          manifestPath,
          `${JSON.stringify(manifest, null, 2)}\n`,
          0o600,
        );
        syncDirectory(backupRoot);
        syncDirectory(path.dirname(backupRoot));
      }
    }
    return checkNativePatch(root);
  }
  if (!Object.values(inspection).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_PATCH_PARTIAL_STATE");
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
  mkdirSync(backupRoot, { mode: 0o700 }); // Never overwrite an earlier backup.
  const manifest = nativeBackupManifest(root);
  for (const [file, entry] of Object.entries(inspection)) {
    const mode = lstatSync(path.join(root, "dist", file)).mode & 0o777;
    writeExclusive(path.join(backupRoot, file), entry.before, 0o600);
    manifest.files[file] = {
      before_digest: entry.beforeDigest,
      after_digest: entry.afterDigest,
      mode,
    };
  }
  writeExclusive(
    path.join(backupRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o600,
  );
  syncDirectory(backupRoot);
  syncDirectory(path.dirname(backupRoot));
  try {
    writeExclusive(bridgeFile(root), bridgeContents(), 0o600);
    syncDirectory(path.join(root, "dist"));
    for (const [file, entry] of Object.entries(inspection)) {
      const target = path.join(root, "dist", file);
      if (sha256(readFileSync(target)) !== entry.beforeDigest)
        throw new Error("NATIVE_SOURCE_DRIFT");
      replaceAtomic(target, entry.after, manifest.files[file].mode);
    }
    return checkNativePatch(root);
  } catch (cause) {
    restoreNativePatch(root, backupRoot);
    throw new Error("NATIVE_APPLY_FAILED_RESTORED", { cause });
  }
}

export function restoreNativePatch(root, backupRoot) {
  assertNoLinks(root);
  assertNoLinks(backupRoot);
  assertNoLinks(path.join(backupRoot, "manifest.json"));
  const manifest = JSON.parse(
    readFileSync(path.join(backupRoot, "manifest.json"), "utf8"),
  );
  if (
    manifest.version !== "m7-t2-r12" ||
    manifest.runtime_root !== path.resolve(root) ||
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
    const target = path.join(root, "dist", file);
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
      path.join(root, "dist", file),
      contents,
      manifest.files[file].mode,
    );
  if (existsSync(bridgeFile(root))) unlinkSync(bridgeFile(root));
  syncDirectory(path.join(root, "dist"));
  const restored = inspectNativePatch(root);
  if (!Object.values(restored).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_RESTORE_FAILED");
  return { status: "RESTORED", files: Object.keys(restored) };
}
