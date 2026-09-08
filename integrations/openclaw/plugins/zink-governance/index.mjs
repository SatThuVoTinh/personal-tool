import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

const VERSION = "m7-t2-r11";
const AGENTS = Object.freeze({
  main: ["o1", "o2"],
  o1: ["excel", "power-bi", "sql", "python"],
  o2: ["excel", "sql", "python"],
  excel: [],
  "power-bi": [],
  sql: [],
  python: [],
});

function canonical(value) {
  if (typeof value === "string") return value.normalize("NFC");
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
function hash(value) {
  return createHash("sha256")
    .update(`zink-ledger-event-v1\0${JSON.stringify(canonical(value))}`)
    .digest("hex");
}
function paths(api) {
  const root =
    api.pluginConfig?.ledgerRoot ??
    path.join(
      api.runtime?.state?.resolveStateDir?.() ??
        process.env.OPENCLAW_STATE_DIR ??
        ".",
      "operator",
      "m7-t2",
      "ledger",
    );
  return {
    root,
    events: path.join(root, "events.jsonl"),
    snapshot: path.join(root, "snapshot.json"),
  };
}
function ensure(p) {
  const parent = path.dirname(p.root);
  mkdirSync(p.root, { recursive: true, mode: 0o700 });
  chmodSync(parent, 0o700);
  chmodSync(p.root, 0o700);
  if (!existsSync(p.events)) writeFileSync(p.events, "", { mode: 0o600 });
  if (!existsSync(p.snapshot))
    writeFileSync(
      p.snapshot,
      `${JSON.stringify({ schema_version: "1.0.0", governance_version: VERSION, sequence: 0, last_event_digest: null, ingress_ids: [], tasks: {} })}\n`,
      { mode: 0o600 },
    );
  chmodSync(p.events, 0o600);
  chmodSync(p.snapshot, 0o600);
}
function snapshot(p) {
  ensure(p);
  const value = JSON.parse(readFileSync(p.snapshot, "utf8"));
  if (
    value.schema_version !== "1.0.0" ||
    value.governance_version !== VERSION ||
    !Number.isInteger(value.sequence)
  )
    throw new Error("EXECUTION_STATE_UNKNOWN");
  return value;
}
function ingressDuplicate(api, messageId) {
  if (!messageId) return false;
  const current = snapshot(paths(api));
  return (
    Array.isArray(current.ingress_ids) &&
    current.ingress_ids.includes(String(messageId))
  );
}
function record(api, type, payload) {
  const p = paths(api);
  const current = snapshot(p);
  const event = {
    schema_version: "1.0.0",
    governance_version: VERSION,
    sequence: current.sequence + 1,
    type,
    payload,
    created_at: new Date().toISOString(),
    previous_event_digest: current.last_event_digest,
  };
  const eventDigest = hash(event);
  const fd = openSync(p.events, "a", 0o600);
  try {
    appendFileSync(
      fd,
      `${JSON.stringify({ ...event, event_digest: eventDigest })}\n`,
    );
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const next = {
    ...current,
    sequence: event.sequence,
    last_event_digest: eventDigest,
    updated_at: event.created_at,
    ingress_ids:
      type === "INGRESS_RECEIVED" && payload.messageId
        ? [
            ...new Set([
              ...(current.ingress_ids ?? []),
              String(payload.messageId),
            ]),
          ].slice(-2048)
        : (current.ingress_ids ?? []),
  };
  const temp = `${p.snapshot}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, p.snapshot);
  const directoryFd = openSync(p.root, "r");
  try {
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
  return next;
}
function blockReason(error) {
  return error?.code ?? "POLICY_DENIED";
}

export default {
  id: "zink-governance",
  name: "Zink Governance",
  description:
    "Model-invisible trusted governance guard for Zink T2 workflows.",
  register(api) {
    const config = api.pluginConfig ?? {};
    if (config.enabled === false) return;
    const pendingChildren = new Map();
    const lastToolBySession = new Map();
    const childParentBySession = new Map();
    const hook = (events, name, handler) =>
      api.registerHook(events, handler, {
        name,
        description: `Zink governance ${name}`,
      });
    hook(["message_received"], "zink-governance-ingress", async (event) => {
      try {
        const authenticatedOwner =
          typeof config.ownerDiscordId === "string" &&
          event.senderId === config.ownerDiscordId;
        if (
          !authenticatedOwner ||
          (config.ownerPrincipalRef &&
            event.ownerPrincipalRef !== config.ownerPrincipalRef)
        ) {
          record(api, "INGRESS_DENIED", {
            sessionKey: event.sessionKey,
            reason: "POLICY_DENIED",
          });
          return;
        }
        if (ingressDuplicate(api, event.messageId)) return;
        record(api, "INGRESS_RECEIVED", {
          sessionKey: event.sessionKey,
          messageId: event.messageId ?? undefined,
        });
      } catch (error) {
        api.logger.error?.(
          `zink governance ingress blocked: ${blockReason(error)}`,
        );
      }
    });
    hook(["before_prompt_build"], "zink-governance-receipt", async (event) => {
      try {
        record(api, "PROMPT_BOUNDARY", { sessionKey: event.sessionKey });
        return {};
      } catch (error) {
        api.logger.error?.(
          `zink governance prompt blocked: ${blockReason(error)}`,
        );
        return {
          prependContext:
            "[Governance] EXECUTION_STATE_UNKNOWN; remain BLOCKED.",
        };
      }
    });
    hook(["llm_output"], "zink-governance-yield-audit", async (event) => {
      const assistant = event.lastAssistant ?? event.assistant ?? {};
      const serialized = JSON.stringify(assistant);
      if (
        serialized.includes("sessions_yield") &&
        serialized.includes("sessions_spawn")
      ) {
        try {
          record(api, "YIELD_SIBLING_DETECTED", {
            sessionKey: event.sessionKey,
          });
        } catch {
          /* before_tool_call remains the enforcement point */
        }
      }
    });
    hook(["before_tool_call"], "zink-governance-tool-guard", async (event) => {
      const toolName = event.toolName ?? event.name ?? "";
      if (toolName === "sessions_yield") {
        const caller = event.agentId ?? event.requesterAgentId ?? "";
        const key = event.sessionKey ?? caller;
        const pending = pendingChildren.get(key) ?? 0;
        if (
          !["main", "o1", "o2"].includes(caller) ||
          pending === 0 ||
          event.pending_child_count === 0 ||
          event.sibling_tool_calls > 0 ||
          lastToolBySession.get(key) === "sessions_spawn"
        )
          return {
            block: true,
            blockReason:
              "sessions_yield requires a later turn with pending children and no sibling calls",
          };
      }
      if (toolName === "subagents")
        return { block: true, blockReason: "subagents model tool is disabled" };
      if (toolName === "sessions_spawn") {
        const agentId = event.params?.agentId;
        const caller = event.agentId ?? event.requesterAgentId ?? "";
        const params = event.params ?? {};
        if (
          !agentId ||
          !Object.hasOwn(AGENTS, caller) ||
          !AGENTS[caller].includes(agentId) ||
          params.runtime !== "subagent" ||
          params.mode !== "run" ||
          params.thread !== false ||
          params.context !== "isolated" ||
          params.sandbox !== "require" ||
          params.cleanup !== "keep" ||
          ["model", "thinking", "cwd", "profile", "auth", "attachments"].some(
            (key) => Object.hasOwn(params, key),
          )
        )
          return { block: true, blockReason: "UNAUTHORIZED_TARGET" };
        const key = event.sessionKey ?? caller;
        pendingChildren.set(key, (pendingChildren.get(key) ?? 0) + 1);
        try {
          record(api, "DELEGATION_RESERVED", {
            caller,
            agentId,
            params: {
              runtime: event.params?.runtime,
              mode: event.params?.mode,
              thread: event.params?.thread,
              context: event.params?.context,
              sandbox: event.params?.sandbox,
            },
          });
        } catch (error) {
          return { block: true, blockReason: blockReason(error) };
        }
      }
      if (event.sessionKey || event.agentId)
        lastToolBySession.set(event.sessionKey ?? event.agentId, toolName);
      return undefined;
    });
    hook(["after_tool_call"], "zink-governance-tool-receipt", async (event) => {
      try {
        record(api, "TOOL_RECEIPT", {
          toolName: event.toolName ?? event.name,
          sessionKey: event.sessionKey,
        });
      } catch {
        /* fail closed on next state operation */
      }
    });
    hook(["subagent_spawned"], "zink-governance-spawned", async (event) => {
      try {
        record(api, "SPAWN_RECEIPT", {
          childSessionKey: event.childSessionKey,
          runId: event.runId,
          agentId: event.agentId,
        });
        if (event.childSessionKey && event.requesterSessionKey)
          childParentBySession.set(
            event.childSessionKey,
            event.requesterSessionKey,
          );
      } catch (error) {
        api.logger.error?.(
          `zink governance spawn receipt failed: ${blockReason(error)}`,
        );
      }
    });
    hook(["subagent_ended"], "zink-governance-ended", async (event) => {
      try {
        record(api, "CHILD_ENDED", {
          targetSessionKey: event.targetSessionKey,
          runId: event.runId,
          outcome: event.outcome,
        });
        const parentSession = childParentBySession.get(event.targetSessionKey);
        pendingChildren.set(
          parentSession ?? event.targetSessionKey,
          Math.max(
            0,
            (pendingChildren.get(parentSession ?? event.targetSessionKey) ??
              1) - 1,
          ),
        );
      } catch {
        /* ledger failure is surfaced by verifier */
      }
    });
    hook(["agent_end"], "zink-governance-result", async (event) => {
      try {
        record(api, "AGENT_PAYLOAD_RECEIVED", {
          sessionKey: event.sessionKey,
          stopReason: event.stopReason,
        });
      } catch (error) {
        api.logger.error?.(
          `zink governance result rejected: ${blockReason(error)}`,
        );
      }
    });
  },
};
