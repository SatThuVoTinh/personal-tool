// Installed as dist/zink-governance-boundary.mjs by the pinned native patcher.
// No model tool is registered. Only trusted in-process plugin code registers.
import { Buffer } from "node:buffer";
const registryKey = Symbol.for("zink.governance.native.r12");
// M10/T2-R8: the Discord preflight seam reaches the canonical intake predicate
// through this global. Published only while a guard is registered.
const preflightIngressKey = Symbol.for(
  "zink.governance.native.preflightIngress",
);
const coordinatorIds = new Set(["main", "o1", "o2"]);
const installedAgents = new WeakSet();

/**
 * M10/T2-R8 — the ONLY text a blocked tool call may hand back to the host.
 *
 * The host maps a block decision's `reason` to `blockReason` and writes that
 * into the tool-result the model reads, so whatever sits here is model-visible
 * and, through the model's own answer, owner-visible. It is therefore a plain
 * refusal sentence and deliberately NOT a governance identifier: repeating it
 * back to the owner is truthful and harmless. The canonical reason code stays in
 * the diagnostic channel and in the ledger.
 */
export const POLICY_REFUSAL_TEXT = "Action not permitted by workspace policy.";

function registry() {
  if (!globalThis[registryKey])
    Object.defineProperty(globalThis, registryKey, { value: new Map() });
  return globalThis[registryKey];
}

export function registerNativeGuard(scope, guard) {
  if (
    typeof scope !== "string" ||
    !scope ||
    typeof guard?.beforeToolCall !== "function" ||
    typeof guard?.beforeAnnounce !== "function" ||
    // T2/T3: quota telemetry and run-scoped model resolution are mandatory
    // governance capabilities. A guard without them cannot enforce the
    // self-quota / proactive-fallback contract, so registration fails closed.
    typeof guard?.recordQuota !== "function" ||
    typeof guard?.selfQuotaReceipt !== "function" ||
    typeof guard?.resolveRunModel !== "function"
  )
    throw new Error("GOVERNANCE_REGISTRATION_INVALID");
  const entry = Object.freeze({
    beforeIngress:
      typeof guard.beforeIngress === "function"
        ? guard.beforeIngress.bind(guard)
        : undefined,
    beforeRunEnd:
      typeof guard.beforeRunEnd === "function"
        ? guard.beforeRunEnd.bind(guard)
        : undefined,
    beforeRun:
      typeof guard.beforeRun === "function"
        ? guard.beforeRun.bind(guard)
        : undefined,
    beforeToolCall: guard.beforeToolCall.bind(guard),
    beforeAnnounce: guard.beforeAnnounce.bind(guard),
    // M10/T2-R8: the PURE direct-intake predicate, evaluated at the Discord
    // preflight seam so a direct specialist mention never creates a host run at
    // all. Side-effect free: it decides, it never writes the ledger.
    beforePreflightIngress:
      typeof guard.beforePreflightIngress === "function"
        ? guard.beforePreflightIngress.bind(guard)
        : undefined,
    // T2/T3: quota publication, self receipt and run-scoped model resolution
    // are required governance capabilities. Registration fails closed when the
    // guard cannot enforce them, so there is no "quota but no enforcement" mode.
    recordQuota: guard.recordQuota.bind(guard),
    selfQuotaReceipt: guard.selfQuotaReceipt.bind(guard),
    resolveRunModel: guard.resolveRunModel.bind(guard),
  });
  registry().set(scope, entry);
  publishPreflightIngress(entry);
  return () => {
    if (registry().get(scope) === entry) registry().delete(scope);
  };
}

/**
 * M10/T2-R8 — the global the Discord preflight injection calls.
 *
 * The preflight runs inside the host's channel bundle, which never imports this
 * module, so the seam is reached through one published global instead of a
 * duplicated import or a second copy of the policy. The caller passes the SAME
 * scope string `resolveGovernance` derives from the host config, so there is one
 * registry and one policy, not two.
 *
 * ABSENT PREDICATE IS NOT A DENY. If governance never registered — the plugin
 * has not loaded, or a build predates this seam — the preflight must not invent
 * an admission decision. It returns null and the late `enterNativeRun` gate
 * still governs the run, so enforcement is unchanged and only the timing is lost.
 */
function publishPreflightIngress(entry) {
  if (entry.beforePreflightIngress) {
    globalThis[preflightIngressKey] = (input) =>
      entry.beforePreflightIngress(input);
  }
}

// M10/T2-R12: exported as a test seam so suites can drive the registered
// guard hooks exactly as production does. Read-only accessor; no behavior.
export function resolveGovernance(config) {
  const entry = config?.plugins?.entries?.["zink-governance"];
  if (entry?.enabled !== true) return { enabled: false };
  const scope = entry.config?.ledgerRoot;
  let guard = typeof scope === "string" ? registry().get(scope) : undefined;
  if (!guard && typeof scope === "string") {
    // Normalization check in case of path separator / trailing slash differences
    const normScope = scope.replace(/\\/g, "/").replace(/\/+$/, "");
    for (const [registeredScope, registeredGuard] of registry().entries()) {
      if (
        registeredScope.replace(/\\/g, "/").replace(/\/+$/, "") === normScope
      ) {
        guard = registeredGuard;
        break;
      }
    }
  }
  return {
    enabled: true,
    guard,
  };
}

async function callGuard(method, event, context, signal) {
  if (signal?.aborted || typeof method !== "function") {
    if (typeof method !== "function") {
      console.error(
        "[zink-native-gate] callGuard: guard method is not a function or guard unregistered",
      );
    }
    throw new Error("GOVERNANCE_UNAVAILABLE");
  }
  let abort;
  const interrupted = new Promise((_, reject) => {
    abort = () => reject(new Error("GOVERNANCE_ABORTED"));
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => method(event, context, signal)),
      interrupted,
    ]);
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export function installNativeToolGate(agent, config, context) {
  if (!resolveGovernance(config).enabled) return;
  const refuse = (canonical) => {
    // R8: the host contract turns this return value into the BLOCKED TOOL
    // RESULT the model reads — `decision.reason` becomes `blockReason`, which
    // the host puts verbatim into the tool-result text. Proven live: a block
    // reason reached the model, the model repeated it, and the owner's Discord
    // reply carried the internal governance code.
    //
    // So the model-visible surface gets a deliberate, non-diagnostic refusal and
    // never a governance identifier. The canonical code and its detail stay in
    // the diagnostic channel and in the ledger, where a refusal must remain
    // auditable. This is not a message filter: the code is never handed to the
    // host in the first place, so it cannot be echoed by the model.
    console.error(
      "[zink-native-gate:error] beforeToolCall blocked:",
      canonical,
    );
    return { block: true, reason: POLICY_REFUSAL_TEXT };
  };
  if (!agent || installedAgents.has(agent))
    throw new Error("GOVERNANCE_GATE_INSTALL_INVALID");
  const trusted = Object.freeze({
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
  });
  if (!trusted.agentId || !trusted.sessionKey || !trusted.runId)
    throw new Error("GOVERNANCE_CONTEXT_MISSING");
  const previous = agent.beforeToolCall?.bind(agent);
  // One host object per completed assistant message, not a model-claimed id.
  const batches = new WeakMap();
  let turn = 0;
  agent.beforeToolCall = async (event, signal) => {
    try {
      const message = event.assistantMessage;
      if (
        !message ||
        message.role !== "assistant" ||
        !Array.isArray(message.content)
      )
        throw new Error("GOVERNANCE_BATCH_MISSING");
      let batch = batches.get(message);
      if (!batch) {
        const calls = message.content.filter(
          (part) => part?.type === "toolCall",
        );
        if (
          calls.length === 0 ||
          calls.some(
            (part) =>
              typeof part.id !== "string" ||
              !part.id.trim() ||
              typeof part.name !== "string" ||
              !part.name.trim(),
          )
        )
          throw new Error("GOVERNANCE_BATCH_INVALID");
        batch = Object.freeze({
          turn: ++turn,
          ids: calls.map((part) => part.id),
          names: calls.map((part) => part.name),
        });
        batches.set(message, batch);
      }
      const index = batch.ids.indexOf(event.toolCall?.id);
      if (
        index < 0 ||
        new Set(batch.ids).size !== batch.ids.length ||
        batch.names[index] !== event.toolCall?.name
      )
        throw new Error("GOVERNANCE_BATCH_INVALID");
      if (
        batch.names.includes("sessions_yield") &&
        (batch.names.length !== 1 || !coordinatorIds.has(trusted.agentId))
      )
        return refuse("YIELD_BATCH_DENIED");
      const nativeDecision = await previous?.(event, signal);
      if (nativeDecision?.block) return nativeDecision;
      const decision = await callGuard(
        resolveGovernance(config).guard?.beforeToolCall,
        {
          toolName: event.toolCall.name,
          toolCallId: event.toolCall.id,
          params: event.args,
          turn: batch.turn,
          batchToolNames: [...batch.names],
          assistantText: message.content
            .filter(
              (part) => part?.type === "text" && typeof part.text === "string",
            )
            .map((part) => part.text)
            .join("\n"),
        },
        trusted,
        signal,
      );
      if (decision?.allow !== true) {
        // The canonical reason code is a fixed governance identifier, never
        // caller data — but it is NOT safe to surface here, because this return
        // value is model-visible. See `refuse` above. A guard-supplied reason is
        // recorded as the diagnostic code; the model only ever sees the refusal.
        const canonical =
          typeof decision?.reason === "string" &&
          /^[A-Z][A-Z0-9_]{0,63}$/u.test(decision.reason)
            ? decision.reason
            : "GOVERNANCE_DENIED";
        return refuse(canonical);
      }
      if (decision.spawnLabel !== undefined) {
        if (
          event.toolCall.name !== "sessions_spawn" ||
          !/^[a-f0-9]{64}$/u.test(decision.spawnLabel)
        )
          throw new Error("GOVERNANCE_DECISION_INVALID");
        event.args.label = decision.spawnLabel;
      }
      if (decision.spawnTask !== undefined) {
        if (
          event.toolCall.name !== "sessions_spawn" ||
          typeof decision.spawnTask !== "string" ||
          Buffer.byteLength(decision.spawnTask, "utf8") > 32768
        )
          throw new Error("GOVERNANCE_DECISION_INVALID");
        event.args.task = decision.spawnTask;
      }
      if (event.toolCall.name === "sessions_spawn") {
        event.args.runtime = "subagent";
        event.args.mode = "run";
        event.args.thread = false;
        event.args.cleanup = "keep";
        delete event.args.taskName;
      }
      return nativeDecision;
    } catch (err) {
      // Never return exception text: a provider/plugin error may contain input,
      // and the reason is model-visible. The diagnostic keeps the detail; the
      // model only ever sees the refusal.
      return refuse(err?.message || String(err));
    }
  };
  installedAgents.add(agent);
}

/**
 * T2: publish one provider-usage snapshot that the host runtime already owns.
 * The snapshot must carry the identity of the agent whose provider quota it is.
 * Invalid or cross-agent payloads are rejected. No network I/O is performed
 * here and no secret material is read or returned.
 */
export async function recordNativeQuota(config, snapshot) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return false;
  if (typeof governance.guard?.recordQuota !== "function") {
    throw new Error("GOVERNANCE_UNAVAILABLE");
  }
  return governance.guard.recordQuota(snapshot);
}

/**
 * T2: read-only, self-scoped quota receipt for prompt context. The agentId is
 * taken from trusted runtime context, never from a model-supplied parameter.
 */
export async function selfNativeQuota(config, context) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return null;
  if (typeof governance.guard?.selfQuotaReceipt !== "function") {
    throw new Error("GOVERNANCE_UNAVAILABLE");
  }
  if (typeof context?.agentId !== "string" || context.agentId.length === 0) {
    throw new Error("GOVERNANCE_CONTEXT_MISSING");
  }
  return governance.guard.selfQuotaReceipt(context.agentId);
}

/**
 * T3: run-scoped model resolution. The returned model applies to the CURRENT
 * run only. This function performs no persisted write: it never creates a
 * session override, never mutates modelOverrideSource and never pins a model
 * into session state.
 */
export async function resolveNativeRunModel(config, context) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return null;
  if (typeof governance.guard?.resolveRunModel !== "function") {
    throw new Error("GOVERNANCE_UNAVAILABLE");
  }
  if (
    typeof context?.agentId !== "string" ||
    typeof context?.sessionKey !== "string" ||
    typeof context?.runId !== "string"
  ) {
    throw new Error("GOVERNANCE_CONTEXT_MISSING");
  }
  return governance.guard.resolveRunModel({
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
  });
}

// R18: the admission-time liveness discriminator, recovered at run-end.
//
// The host forwards `trigger` and `transcriptPrompt` to `enterNativeRun` but NOT
// to `finishNativeRun` (its run-end call passes only agentId/sessionKey/runId).
// Without them at run-end, `isPureLivenessHeartbeat` returns false there even
// though admission recognised the same run as a pure liveness heartbeat, so the
// run-end seam applied full governance and failed with
// GOVERNANCE_COMPLETION_UNAVAILABLE. Threading them through the pinned selection
// would change the installed selection and break the R7/R10 native lineage; this
// records them per run at admission and recovers them at run-end so BOTH seams
// classify a run with the single predicate. A run that never passed admission has
// no record and therefore keeps the existing full-governance behaviour.
//
// Bounded so a run that dies before run-end cannot grow this without limit.
const RUN_LIVENESS = new Map();
const RUN_LIVENESS_LIMIT = 256;

function rememberRunLiveness(runId, trigger, transcriptPrompt) {
  if (typeof runId !== "string" || runId === "") return;
  if (RUN_LIVENESS.size >= RUN_LIVENESS_LIMIT) {
    const oldest = RUN_LIVENESS.keys().next().value;
    RUN_LIVENESS.delete(oldest);
  }
  RUN_LIVENESS.set(runId, { trigger, transcriptPrompt });
}

function takeRunLiveness(runId) {
  if (typeof runId !== "string" || runId === "") return undefined;
  const record = RUN_LIVENESS.get(runId);
  RUN_LIVENESS.delete(runId);
  return record;
}

const INGRESS_METADATA_KEY = "__zink_ingress_metadata_r5";
const DISCORD_SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/u;

const emptyIngressMetadata = () =>
  Object.freeze({
    mentionedUserIds: Object.freeze([]),
    mentionedRoleIds: Object.freeze([]),
    replyReferenceMessageId: null,
    replyReferenceAuthorId: null,
    threadOwnerId: null,
    authorIsBot: false,
  });

/**
 * M10/T2-R5: read the deterministic Discord inbound metadata the preflight
 * patch recorded for this inbound message id. The write sits on the same
 * causal inbound path (a turn exists only after its message's preflight
 * completes), so no ordering assumption is involved. Unknown, malformed or
 * evicted records normalize to empty (deny preserved). Re-validated here
 * even though the writer validates too: the registry crosses a bundle
 * boundary, so neither side trusts the other's bytes.
 */
export function readZinkIngressMetadata(messageId) {
  let record;
  try {
    const registry = globalThis[INGRESS_METADATA_KEY];
    record =
      typeof messageId === "string" && registry instanceof Map
        ? registry.get(messageId)
        : undefined;
  } catch {
    return emptyIngressMetadata();
  }
  if (!record || typeof record !== "object") return emptyIngressMetadata();
  const snowflake = (value) =>
    typeof value === "string" && DISCORD_SNOWFLAKE_RE.test(value)
      ? value
      : null;
  const idList = (entries) => {
    if (!Array.isArray(entries)) return [];
    const ids = [];
    for (const entry of entries) {
      const id = snowflake(typeof entry === "string" ? entry : entry?.id);
      if (id) ids.push(id);
    }
    return ids;
  };
  return Object.freeze({
    mentionedUserIds: Object.freeze(idList(record.mentionedUserIds)),
    mentionedRoleIds: Object.freeze(idList(record.mentionedRoleIds)),
    replyReferenceMessageId: snowflake(record.replyReferenceMessageId),
    replyReferenceAuthorId: snowflake(record.replyReferenceAuthorId),
    threadOwnerId: snowflake(record.threadOwnerId),
    authorIsBot: record.authorIsBot === true,
  });
}

export async function enterNativeRun(config, context, signal) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return;
  try {
    // M10/T2-R4: the inbound thread identity is typed explicitly. null means
    // "not a threaded message" (the patch forwards `?? null`); anything else
    // must be a Discord snowflake, otherwise the context is malformed and the
    // run fails closed before any guard sees it. The original message is
    // preserved as the cause and logged, while the host-visible contract
    // string stays GOVERNANCE_RUN_UNAVAILABLE.
    const threadId = context.threadId ?? null;
    if (threadId !== null && !/^[1-9][0-9]{16,19}$/u.test(threadId)) {
      throw new Error("GOVERNANCE_CONTEXT_MISSING");
    }
    // M10/T2-R5: structured Discord inbound metadata, read by inbound
    // message id from the preflight registry. Unknown/absent degrades to
    // empty (deny preserved); malformed is normalized by the reader.
    const ingress = readZinkIngressMetadata(context.currentMessageId);
    const decision = await callGuard(
      governance.guard?.beforeRun,
      {},
      Object.freeze({
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        runId: context.runId,
        channelId: context.channelId,
        senderId: context.senderId,
        currentMessageId: context.currentMessageId,
        message: context.message,
        content: context.content,
        mentions: context.mentions,
        mentionRoles: context.mentionRoles,
        author: context.author,
        isBot: context.isBot,
        threadId,
        mentionedUserIds: ingress.mentionedUserIds,
        mentionedRoleIds: ingress.mentionedRoleIds,
        replyReferenceMessageId: ingress.replyReferenceMessageId,
        replyReferenceAuthorId: ingress.replyReferenceAuthorId,
        threadOwnerId: ingress.threadOwnerId,
        authorIsBot: context.isBot === true || ingress.authorIsBot,
        // R10: the host-assigned run discriminator and the canonical host
        // heartbeat representation. Both are plain strings the host already
        // holds at the injection anchor; neither is user content, a message
        // object, or Discord-layer data.
        trigger: context.trigger,
        transcriptPrompt: context.transcriptPrompt,
        inputProvenance: context.inputProvenance
          ? Object.freeze({ ...context.inputProvenance })
          : undefined,
      }),
      signal,
    );
    if (decision?.allow !== true) throw new Error("GOVERNANCE_DENIED");
    // R18: record the discriminator only for a run admission ACCEPTED, so the
    // record means precisely "admission recognised this run". A denied or failed
    // admission leaves no record and its run-end therefore keeps full governance.
    rememberRunLiveness(
      context.runId,
      context.trigger,
      context.transcriptPrompt,
    );
  } catch (error) {
    // R7 G2: the host-visible contract string is unchanged, but the original
    // failure is preserved as the cause so a governance verdict and a genuine
    // execution-state fault stay distinguishable. Only the fixed error message
    // is logged: never the stack, the run context, or message content.
    console.error(
      "[zink-native-gate] enterNativeRun:",
      error?.message ?? error,
    );
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE", { cause: error });
  }
}

export async function gateNativeAnnounce(config, event, signal) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return { governed: false };
  try {
    const decision = await callGuard(
      governance.guard?.beforeAnnounce,
      event,
      Object.freeze({
        childRunId: event.childRunId,
        childSessionKey: event.childSessionKey,
        requesterSessionKey: event.requesterSessionKey,
      }),
      signal,
    );
    if (decision?.action === "discard")
      return { governed: true, action: "discard" };
    if (
      decision?.action !== "deliver" ||
      typeof decision.receipt !== "string" ||
      !decision.receipt ||
      Buffer.byteLength(decision.receipt, "utf8") > 65536
    )
      throw new Error("GOVERNANCE_RECEIPT_INVALID");
    return { governed: true, action: "deliver", receipt: decision.receipt };
  } catch {
    return { governed: true, action: "block" };
  }
}

export async function finishNativeRun(config, event, context) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return;
  // R18: prefer anything the host passes at this seam, then fall back to the
  // values recorded at admission for this runId, so admission and run-end apply
  // the same predicate to the same execution.
  const liveness = takeRunLiveness(context.runId);
  try {
    const decision = await callGuard(
      governance.guard?.beforeRunEnd,
      event,
      Object.freeze({
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        runId: context.runId,
        trigger: context.trigger ?? liveness?.trigger,
        transcriptPrompt:
          context.transcriptPrompt ?? liveness?.transcriptPrompt,
      }),
    );
    if (decision?.allow !== true) throw new Error("GOVERNANCE_DENIED");
  } catch {
    throw new Error("GOVERNANCE_COMPLETION_UNAVAILABLE");
  }
}

export async function sanitizeNativePrompt(config, prompt) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return prompt;
  try {
    if (typeof prompt !== "string" || Buffer.byteLength(prompt, "utf8") > 32768)
      throw new Error("SCHEMA_INVALID");
    const decision = await callGuard(
      governance.guard?.beforeIngress,
      { prompt },
      Object.freeze({}),
    );
    if (
      typeof decision?.prompt !== "string" ||
      Buffer.byteLength(decision.prompt, "utf8") > 32768
    )
      throw new Error("SCHEMA_INVALID");
    return decision.prompt;
  } catch {
    throw new Error("GOVERNANCE_INGRESS_UNAVAILABLE");
  }
}
