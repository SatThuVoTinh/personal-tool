// Installed as dist/zink-governance-boundary.mjs by the pinned native patcher.
// No model tool is registered. Only trusted in-process plugin code registers.
import { Buffer } from "node:buffer";
const registryKey = Symbol.for("zink.governance.native.r12");
const coordinatorIds = new Set(["main", "o1", "o2"]);
const installedAgents = new WeakSet();

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
    typeof guard?.beforeAnnounce !== "function"
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
  });
  registry().set(scope, entry);
  return () => {
    if (registry().get(scope) === entry) registry().delete(scope);
  };
}

function resolveGovernance(config) {
  const entry = config?.plugins?.entries?.["zink-governance"];
  if (entry?.enabled !== true) return { enabled: false };
  const scope = entry.config?.ledgerRoot;
  return {
    enabled: true,
    guard: typeof scope === "string" ? registry().get(scope) : undefined,
  };
}

async function callGuard(method, event, context, signal) {
  if (signal?.aborted || typeof method !== "function")
    throw new Error("GOVERNANCE_UNAVAILABLE");
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
        return { block: true, reason: "YIELD_BATCH_DENIED" };
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
      if (decision?.allow !== true)
        return { block: true, reason: "GOVERNANCE_DENIED" };
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
    } catch {
      // Never return exception text: a provider/plugin error may contain input.
      return { block: true, reason: "GOVERNANCE_UNAVAILABLE" };
    }
  };
  installedAgents.add(agent);
}

export async function enterNativeRun(config, context, signal) {
  const governance = resolveGovernance(config);
  if (!governance.enabled) return;
  try {
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
        inputProvenance: context.inputProvenance
          ? Object.freeze({ ...context.inputProvenance })
          : undefined,
      }),
      signal,
    );
    if (decision?.allow !== true) throw new Error("GOVERNANCE_DENIED");
  } catch {
    throw new Error("GOVERNANCE_RUN_UNAVAILABLE");
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
  try {
    const decision = await callGuard(
      governance.guard?.beforeRunEnd,
      event,
      Object.freeze({
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        runId: context.runId,
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
