import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createGovernanceGuard } from "../../topology/lib/guard.mjs";
import { sanitizeDelegationText } from "../../topology/lib/runtime.mjs";
import { registerNativeGuard } from "../../topology/lib/native-boundary.mjs";
import {
  readSnapshot,
  recordWorkflowEvent,
} from "../../topology/lib/ledger.mjs";
import { findSession } from "../../topology/lib/workflow.mjs";
import {
  canonicalHash,
  derivePrincipalRef,
  deriveTaskId,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "../../topology/lib/canonical.mjs";

let policyModule;
try {
  policyModule = await import("../../lib/policy.mjs");
} catch {
  const repoPolicyPath = path.resolve(
    process.cwd(),
    "integrations/openclaw/lib/policy.mjs",
  );
  policyModule = await import(pathToFileURL(repoPolicyPath).href);
}
const { CALLABLE_TOOL_REGISTRY } = policyModule;

export function registerTools(api) {
  const registerFn =
    typeof api?.registerTool === "function"
      ? api.registerTool.bind(api)
      : typeof api?.tools?.register === "function"
        ? api.tools.register.bind(api.tools)
        : null;
  if (!registerFn) return;
  for (const [toolId, def] of Object.entries(CALLABLE_TOOL_REGISTRY)) {
    registerFn({
      name: toolId,
      id: toolId,
      description: def.description,
    });
  }
}

const ids = new Set(["main", "o1", "o2", "excel", "power-bi", "sql", "python"]);
function noLinks(target) {
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  )
    if (lstatSync(cursor).isSymbolicLink()) throw new Error("POLICY_DENIED");
}
function leaseKey(context, event = {}) {
  const sessionKey = context.sessionKey ?? event.sessionKey;
  const runId = context.runId ?? event.runId;
  const toolCallId = context.toolCallId ?? event.toolCallId;
  if (!sessionKey || !runId || !toolCallId)
    throw new Error(
      `LINEAGE_MISMATCH: sessionKey=${sessionKey}, runId=${runId}, toolCallId=${toolCallId}`,
    );
  return canonicalHash("zink-native-call-v1", {
    sessionKey,
    runId,
    toolCallId,
  });
}

export default {
  id: "zink-governance",
  name: "Zink Governance",
  description:
    "Model-invisible trusted governance guard for Zink T2 workflows.",
  register(api) {
    registerTools(api);
    const config = api.pluginConfig ?? {};
    if (config.enabled === false) return;
    if (
      !path.isAbsolute(config.ledgerRoot ?? "") ||
      !/^[1-9][0-9]{16,19}$/u.test(config.ownerDiscordId ?? "")
    )
      throw new Error("GOVERNANCE_CONFIGURATION_INVALID");
    const paths = {
      root: config.ledgerRoot,
      events: path.join(config.ledgerRoot, "events.jsonl"),
      snapshot: path.join(config.ledgerRoot, "snapshot.json"),
    };
    const stateDir = path.resolve(config.ledgerRoot, "../../..");
    // Invocation leases prove the native gate ran. They are not workflow state.
    const leasesKey = Symbol.for("zink.governance.native.leases");
    if (!globalThis[leasesKey]) {
      Object.defineProperty(globalThis, leasesKey, { value: new Map() });
    }
    const leases = globalThis[leasesKey];
    // Notification waiters are transient, not authority. After notification the
    // guard still requires the exact receipt persisted in the trusted ledger.
    const startingRunsKey = Symbol.for("zink.governance.native.starting_runs");
    if (!globalThis[startingRunsKey]) {
      Object.defineProperty(globalThis, startingRunsKey, { value: new Set() });
    }
    const startingRuns = globalThis[startingRunsKey];
    async function awaitSpawnReceipt(context, signal) {
      const snapshot = readSnapshot(paths);
      try {
        findSession(snapshot, context.sessionKey, context.runId);
        return;
      } catch {
        /* Check trusted pending work below. */
      }
      if (
        Object.values(snapshot.tasks).some(
          (task) => task.continuations?.[context.runId],
        )
      )
        return;
      const hasPending = Object.values(snapshot.tasks).some(
        (task) =>
          task.workflow_status === "ACTIVE" &&
          Object.values(task.delegations ?? {}).some(
            (run) =>
              run.agent_id === context.agentId &&
              run.run_state === "SPAWN_UNKNOWN",
          ),
      );
      if (!hasPending) return; // beforeRun rejects the unresolved identity.
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          startingRuns.delete(check);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new Error("EXECUTION_STATE_UNKNOWN"));
        const check = (stopping = false) => {
          if (stopping) return abort();
          try {
            findSession(readSnapshot(paths), context.sessionKey, context.runId);
          } catch {
            return;
          }
          finish();
        };
        // Never outlive the frozen delegated-run ceiling while waiting for ACK.
        const timer = setTimeout(abort, 300000);
        startingRuns.add(check);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        else check();
      });
    }
    const manifestFor = (agentId) => {
      if (!ids.has(agentId)) throw new Error("UNAUTHORIZED_TARGET");
      const mapping = JSON.parse(
        readFileSync(
          new URL("./governance-manifests.json", import.meta.url),
          "utf8",
        ),
      );
      const expected = mapping[agentId];
      if (!expected || expected.governance_version !== GOVERNANCE_VERSION)
        throw new Error("GOVERNANCE_HASH_MISMATCH");
      const workspaceFile = path.join(
        stateDir,
        "workspaces",
        agentId,
        "AGENTS.md",
      );
      noLinks(workspaceFile);
      const observed = createHash("sha256")
        .update(readFileSync(workspaceFile))
        .digest("hex");
      if (observed !== expected.workspace_sha256)
        throw new Error("GOVERNANCE_HASH_MISMATCH");
      return {
        expected_governance_hash: expected.governance_hash,
        observed_governance_hash: expected.governance_hash,
        allowed_tools: expected.allowed_tools,
      };
    };
    const guard = createGovernanceGuard({ paths, manifestFor });
    const unregister = registerNativeGuard(paths.root, {
      beforeIngress(event) {
        return {
          prompt: sanitizeDelegationText(event.prompt)
            .split(config.ownerDiscordId)
            .join("[OWNER_PRINCIPAL]"),
        };
      },
      async beforeRun(event, context, signal) {
        // message_received is fire-and-forget and its inbound mapper has no
        // runId in 2026.6.34. Bind authenticated ingress at the awaited native
        // run boundary, where message identity and run identity coexist.
        if (!context.inputProvenance && context.channelId === "discord")
          authenticateIngress(context);
        await awaitSpawnReceipt(context, signal);
        return guard.beforeRun(event, context, signal);
      },
      async beforeToolCall(event, context, signal) {
        const decision = await guard.beforeToolCall(event, context, signal);
        if (decision?.allow) {
          const params = decision.spawnLabel
            ? {
                ...event.params,
                label: decision.spawnLabel,
                task: decision.spawnTask,
              }
            : { ...event.params };
          if (event.toolName === "sessions_spawn") {
            params.runtime = "subagent";
            params.mode = "run";
            params.thread = false;
            params.cleanup = "keep";
            delete params.taskName;
          }
          const lKey = leaseKey(
            { ...context, toolCallId: event.toolCallId },
            event,
          );
          const pHash = canonicalHash("zink-native-call-v1", params);
          leases.set(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set] key=${lKey} agent=${context.agentId} sessionKey=${context.sessionKey} runId=${context.runId} toolCallId=${event.toolCallId} hash=${pHash}`,
          );
        }
        return decision;
      },
      beforeAnnounce: guard.beforeAnnounce,
      beforeRunEnd: guard.beforeRunEnd,
    });
    api.on("gateway_stop", () => {
      for (const check of [...startingRuns]) check(true);
      leases.clear();
      unregister();
    });
    api.on("before_tool_call", (event, context = {}) => {
      try {
        const key = leaseKey(context, event);
        const expected = leases.get(key);
        const params = { ...event.params };
        if (
          event.toolName === "sessions_spawn" &&
          params.cleanup === undefined
        ) {
          params.cleanup = "keep";
        }
        const actualHash = canonicalHash("zink-native-call-v1", params);
        api.logger?.warn?.(
          `[zink-lease:get] key=${key} expected=${expected} actual=${actualHash} match=${expected === actualHash} available=[${[...leases.keys()].join(",")}] context=${JSON.stringify({ agentId: context.agentId, sessionKey: context.sessionKey, runId: context.runId, toolCallId: context.toolCallId })} event=${JSON.stringify({ toolName: event.toolName, runId: event.runId, toolCallId: event.toolCallId })}`,
        );
        leases.delete(key);
        if (!expected || expected !== actualHash)
          throw new Error("POLICY_DENIED");
      } catch (err) {
        api.logger?.warn?.(`[zink-lease:blocked] ${err?.message ?? err}`);
        return {
          block: true,
          blockReason: "Trusted native governance authorization is missing",
        };
      }
    });
    function authenticateIngress(context) {
      if (
        context.channelId !== "discord" ||
        context.senderId !== config.ownerDiscordId ||
        !ids.has(context.agentId)
      )
        throw new Error("POLICY_DENIED");
      if (
        typeof context.currentMessageId !== "string" ||
        !/^[1-9][0-9]{16,19}$/u.test(context.currentMessageId)
      )
        throw new Error("LINEAGE_MISMATCH");
      const identityPath = path.resolve(paths.root, "../identity.key");
      noLinks(identityPath);
      // Trusted HMAC use only; the key never enters prompts or logs.
      const key = readFileSync(identityPath, "utf8").trim();
      if (!/^[a-f0-9]{64}$/u.test(key))
        throw new Error("EXECUTION_STATE_UNKNOWN");
      const origin = {
        origin: "discord",
        origin_principal_ref: derivePrincipalRef(key, context.senderId),
        origin_message_id: context.currentMessageId,
      };
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id: deriveTaskId(origin),
        root_agent_id: context.agentId,
        root_session_key: context.sessionKey,
        root_run_id: context.runId,
      });
    }
    api.on("before_prompt_build", (_event, context = {}) => {
      try {
        const owner = findSession(
          readSnapshot(paths),
          context.sessionKey,
          context.runId,
        );
        const receipt = {
          schema_version: SCHEMA_VERSION,
          governance_version: GOVERNANCE_VERSION,
          task_id: owner.task_id,
          brief_revision: owner.task.brief_revision,
          remaining_task_budget: {
            revisions: 16 - owner.task.revisions_used,
            transitions: 10 - owner.task.transitions_used,
            delegated_runs: 72 - owner.task.delegated_runs_used,
          },
        };
        if (!owner.delegation)
          Object.assign(receipt, {
            origin: owner.task.origin,
            origin_principal_ref: owner.task.origin_principal_ref,
            origin_message_id: owner.task.origin_message_id,
          });
        return {
          prependContext: `[Trusted governance receipt]\n${JSON.stringify(receipt)}`,
        };
      } catch (error) {
        api.logger?.error?.(
          `zink governance before_prompt_build: EXECUTION_STATE_UNKNOWN (${error?.message ?? error})`,
        );
        return {
          prependContext:
            "[Trusted governance] EXECUTION_STATE_UNKNOWN. Do not delegate; report BLOCKED.",
        };
      }
    });
    api.on("subagent_ended", (event, context = {}) => {
      try {
        if (
          event.targetKind !== "subagent" ||
          event.runId !== context.runId ||
          event.targetSessionKey !== context.childSessionKey
        )
          throw new Error("LINEAGE_MISMATCH");
        const owner = findSession(
          readSnapshot(paths),
          context.childSessionKey,
          context.runId,
        );
        if (
          !owner.delegation ||
          owner.delegation.parent_session_key !== context.requesterSessionKey
        )
          throw new Error("LINEAGE_MISMATCH");
        recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
          task_id: owner.task_id,
          native_run_id: context.runId,
          child_session_key: context.childSessionKey,
          parent_session_key: context.requesterSessionKey,
          outcome: event.outcome,
        });
      } catch {
        api.logger?.error?.(
          "zink governance completion: EXECUTION_STATE_UNKNOWN",
        );
      }
    });
    api.on("subagent_spawned", (event, context = {}) => {
      try {
        const matches = Object.entries(readSnapshot(paths).tasks).flatMap(
          ([task_id, task]) =>
            Object.values(task.delegations ?? {})
              .filter(
                (run) =>
                  run.delegation_id === event.label &&
                  run.parent_session_key === context.requesterSessionKey &&
                  run.agent_id === event.agentId,
              )
              .map((run) => ({ task_id, run })),
        );
        if (matches.length !== 1) throw new Error("LINEAGE_MISMATCH");
        recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RECEIVED", {
          task_id: matches[0].task_id,
          delegation_id: matches[0].run.delegation_id,
          native_run_id: event.runId,
          child_session_key: event.childSessionKey,
          agent_id: event.agentId,
          parent_session_key: context.requesterSessionKey,
        });
        for (const check of [...startingRuns]) check();
      } catch {
        api.logger?.error?.("zink governance spawn: EXECUTION_STATE_UNKNOWN");
      }
    });
  },
};
