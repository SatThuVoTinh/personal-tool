import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
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

import { formatForDiscord } from "../../lib/discord-formatter.mjs";

const AGENT_DISPLAY_NAMES = {
  main: "Quản Lý",
  o1: "Điều Phối 1",
  o2: "Điều Phối 2",
  excel: "Excel",
  "power-bi": "PowerBI",
  sql: "SQL",
  python: "Python",
};

let skillAdapterModule = null;
let knowledgeAdapterModule = null;
let vectorSyncModule = null;

function resolveDefaultOllamaUrl() {
  if (process.env.OLLAMA_URL) return process.env.OLLAMA_URL;
  if (process.platform === "linux") {
    try {
      const route = execSync("ip route show default", { encoding: "utf8" });
      const match = route.match(/default\s+via\s+([0-9.]+)/);
      if (match) return `http://${match[1]}:11434`;
    } catch {
      /* ignore */
    }
  }
  return "http://127.0.0.1:11434";
}

function findRepoRoot() {
  const candidates = [
    process.env.ZINK_REPO_ROOT,
    "/mnt/c/Users/HOANG VINH/OneDrive/Documents/personal-tool",
    path.resolve(fileURLToPath(import.meta.url), "../../../.."),
    process.cwd(),
  ];
  for (const c of candidates) {
    if (
      c &&
      existsSync(
        path.join(
          c,
          "zink-tools",
          "adapters",
          "skill-store",
          "skill-adapter.mjs",
        ),
      )
    ) {
      return c;
    }
  }
  return null;
}

async function getSkillAdapter() {
  if (!skillAdapterModule) {
    const root = findRepoRoot();
    if (root) {
      try {
        const p = path.join(
          root,
          "zink-tools/adapters/skill-store/skill-adapter.mjs",
        );
        skillAdapterModule = await import(pathToFileURL(p).href);
      } catch (err) {
        console.error("[zink-governance] Failed to import skill adapter:", err);
      }
    }
    if (!skillAdapterModule) {
      try {
        skillAdapterModule = await import(
          new URL(
            "../../../../zink-tools/adapters/skill-store/skill-adapter.mjs",
            import.meta.url,
          ).href
        );
      } catch {
        try {
          skillAdapterModule = await import(
            path.resolve(
              process.cwd(),
              "zink-tools/adapters/skill-store/skill-adapter.mjs",
            )
          );
        } catch {
          // Module not accessible in isolated test directory
        }
      }
    }
  }
  return skillAdapterModule;
}

async function getKnowledgeAdapter() {
  if (!knowledgeAdapterModule) {
    const root = findRepoRoot();
    if (root) {
      try {
        const p = path.join(
          root,
          "zink-tools/adapters/knowledge/knowledge-adapter.mjs",
        );
        knowledgeAdapterModule = await import(pathToFileURL(p).href);
      } catch (err) {
        console.error(
          "[zink-governance] Failed to import knowledge adapter:",
          err,
        );
      }
    }
    if (!knowledgeAdapterModule) {
      try {
        knowledgeAdapterModule = await import(
          new URL(
            "../../../../zink-tools/adapters/knowledge/knowledge-adapter.mjs",
            import.meta.url,
          ).href
        );
      } catch {
        try {
          knowledgeAdapterModule = await import(
            path.resolve(
              process.cwd(),
              "zink-tools/adapters/knowledge/knowledge-adapter.mjs",
            )
          );
        } catch {
          // Module not accessible in isolated test directory
        }
      }
    }
  }
  return knowledgeAdapterModule;
}

async function getVectorSyncModule() {
  if (!vectorSyncModule) {
    const root = findRepoRoot();
    if (root) {
      try {
        const p = path.join(root, "zink-skill-store/src/vector-sync.mjs");
        vectorSyncModule = await import(pathToFileURL(p).href);
      } catch (err) {
        console.error("[zink-governance] Failed to import vector sync:", err);
      }
    }
    if (!vectorSyncModule) {
      try {
        vectorSyncModule = await import(
          new URL(
            "../../../../zink-skill-store/src/vector-sync.mjs",
            import.meta.url,
          ).href
        );
      } catch {
        try {
          vectorSyncModule = await import(
            path.resolve(process.cwd(), "zink-skill-store/src/vector-sync.mjs")
          );
        } catch {
          // Module not accessible in isolated test directory
        }
      }
    }
  }
  return vectorSyncModule;
}

export async function handleOwnerSkillApproval({
  ownerDiscordId,
  proposalId,
  contentSha256,
  skillsRoot,
  expectedOwnerId = "854005217715814432",
  options = {},
}) {
  // Exact owner snowflake binding (BUG-06)
  if (ownerDiscordId !== expectedOwnerId) {
    throw new Error(
      "APPROVAL_OWNER_MISMATCH: Unauthorized principal cannot approve skills",
    );
  }
  if (!proposalId || typeof proposalId !== "string" || !proposalId.trim()) {
    throw new Error(
      "APPROVAL_PROPOSAL_ID_REQUIRED: Missing proposal ID binding",
    );
  }
  if (!contentSha256 || !/^[a-f0-9]{64}$/u.test(contentSha256)) {
    throw new Error(
      "APPROVAL_CONTENT_HASH_INVALID: Content hash must be 64-character SHA-256",
    );
  }

  const syncMod = await getVectorSyncModule();
  if (syncMod?.syncSkillsToVectorStore) {
    return syncMod.syncSkillsToVectorStore({
      skillsRoot,
      ...options,
    });
  }
  return { status: "READY", synced_count: 0, failed_count: 0 };
}

export function registerTools(api) {
  const registerFn =
    typeof api?.registerTool === "function"
      ? api.registerTool.bind(api)
      : typeof api?.tools?.register === "function"
        ? api.tools.register.bind(api.tools)
        : null;
  if (!registerFn) return;
  const registry = {
    zink_skill_search: {
      description:
        "Search governed skills in Zink Skill Store using semantic vector similarity.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query for skills" },
          limit: {
            type: "integer",
            description: "Maximum number of skills to return (1-20)",
          },
          primary_topic: {
            type: "string",
            description: "Optional primary topic filter",
          },
          subtopic: { type: "string", description: "Optional subtopic filter" },
          capability: {
            type: "string",
            description: "Optional capability name filter",
          },
        },
        required: ["query"],
      },
      async execute(_id, params) {
        const mod = await getSkillAdapter();
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "search",
              ...params,
            },
            {},
            { ollamaUrl: resolveDefaultOllamaUrl() },
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(res),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "governed",
                tool: "zink_skill_search",
                params,
              }),
            },
          ],
        };
      },
    },
    zink_knowledge_search: {
      description:
        "Search authoritative documents in Zink Knowledgebase using semantic hybrid RAG.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query for knowledgebase",
          },
          limit: { type: "integer", description: "Maximum results (1-20)" },
          primary_topic: {
            type: "string",
            description: "Optional primary topic filter",
          },
          path_prefix: {
            type: "string",
            description: "Optional path prefix filter",
          },
        },
        required: ["query"],
      },
      async execute(_id, params) {
        const mod = await getKnowledgeAdapter();
        if (mod?.executeGovernedKnowledgeQuery) {
          const res = await mod.executeGovernedKnowledgeQuery(
            {
              action: "search",
              ...params,
            },
            {},
            {
              endpoint:
                process.env.KNOWLEDGE_ENDPOINT ||
                "http://127.0.0.1:8080/knowledge",
            },
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(res),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "governed",
                tool: "zink_knowledge_search",
                params,
              }),
            },
          ],
        };
      },
    },
    zink_skill_propose: {
      description:
        "Propose a new or updated skill candidate for human owner review and approval.",
      parameters: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description: "Skill namespace slug (e.g. excel, sql, python, data)",
          },
          capability: {
            type: "string",
            description: "Skill capability slug (e.g. vlookup-optimization)",
          },
          version: {
            type: "string",
            description: "SemVer version string (e.g. 1.0.0)",
          },
          content: {
            type: "string",
            description: "Full SKILL.md Markdown content with instructions",
          },
          reason: {
            type: "string",
            description: "Justification for this new/updated skill",
          },
        },
        required: ["namespace", "capability", "version", "content", "reason"],
      },
      async execute(_id, params) {
        const mod = await getSkillAdapter();
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "propose",
              ...params,
            },
            {},
            { ollamaUrl: resolveDefaultOllamaUrl() },
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(res),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "governed",
                tool: "zink_skill_propose",
                params,
              }),
            },
          ],
        };
      },
    },
    zink_excel: {
      description:
        "Execute governed Excel operations (load, populate, validate, generate).",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["load", "populate", "validate", "generate"],
            description: "Excel operation to execute",
          },
          file_path: {
            type: "string",
            description: "Target Excel workbook file path",
          },
          template_path: {
            type: "string",
            description: "Template file path for population",
          },
          data: {
            type: "object",
            description: "Data object to populate into workbook",
          },
          rules: {
            type: "array",
            items: { type: "string" },
            description: "Validation rules to check against workbook",
          },
          specification: {
            type: "object",
            description: "Generation specification for new workbook",
          },
        },
        required: ["operation", "file_path"],
      },
    },
    zink_n8n: {
      description: "Execute governed n8n workflows via webhook triggers.",
      parameters: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: "n8n workflow identifier",
          },
          payload: {
            type: "object",
            description: "Workflow input payload",
          },
        },
        required: ["workflow_id"],
      },
    },
    zink_power_bi: {
      description:
        "Execute governed Power BI operations (bind, update, validate).",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["bind", "update", "validate"],
            description: "Power BI operation to execute",
          },
          model_name: {
            type: "string",
            description: "Target Power BI semantic model name",
          },
          parameters: {
            type: "object",
            description: "Model update or bind parameters",
          },
        },
        required: ["operation", "model_name"],
      },
    },
    zink_python: {
      description:
        "Execute bounded Python scripts in isolated per-stack environments.",
      parameters: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description: "Python script code to execute",
          },
          entrypoint: {
            type: "string",
            description: "Optional entrypoint function name",
          },
        },
        required: ["script"],
      },
    },
    zink_sql: {
      description: "Execute bounded read-only SELECT SQL queries.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Read-only SELECT SQL query to execute",
          },
          database: {
            type: "string",
            description: "Target database name",
          },
        },
        required: ["query"],
      },
    },
  };
  for (const [toolId, def] of Object.entries(registry)) {
    registerFn({
      name: toolId,
      id: toolId,
      description: def.description,
      parameters: def.parameters,
      async execute(_id, params) {
        if (typeof def.execute === "function") {
          return def.execute(_id, params);
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "governed",
                tool: toolId,
                params,
              }),
            },
          ],
        };
      },
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
      const parentSessionKey =
        context.inputProvenance?.sessionKey ?? context.requesterSessionKey;
      const hasPending = Object.values(snapshot.tasks).some(
        (task) =>
          task.workflow_status === "ACTIVE" &&
          Object.values(task.delegations ?? {}).some(
            (run) =>
              run.agent_id === context.agentId &&
              run.run_state === "SPAWN_UNKNOWN" &&
              (!parentSessionKey ||
                run.parent_session_key === parentSessionKey),
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
      const workspaceContent = readFileSync(workspaceFile, "utf8");
      const observed = createHash("sha256")
        .update(workspaceContent)
        .digest("hex");
      if (observed !== expected.workspace_sha256)
        throw new Error("GOVERNANCE_HASH_MISMATCH");
      const match = workspaceContent.match(/governance_hash=([a-f0-9]{64})/);
      const observedGovHash = match ? match[1] : null;
      if (!observedGovHash || observedGovHash !== expected.governance_hash)
        throw new Error("GOVERNANCE_HASH_MISMATCH");
      return {
        expected_governance_hash: expected.governance_hash,
        observed_governance_hash: observedGovHash,
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
        if (!context.inputProvenance && context.channelId === "discord") {
          authenticateIngress(context);
        } else {
          await awaitSpawnReceipt(context, signal);
        }
        return guard.beforeRun(event, context, signal);
      },
      async beforeToolCall(event, context, signal) {
        if (
          [
            "zink_skill_search",
            "zink_knowledge_search",
            "zink_skill_propose",
          ].includes(event.toolName)
        ) {
          const lKey = leaseKey(
            { ...context, toolCallId: event.toolCallId },
            event,
          );
          const pHash = canonicalHash(
            "zink-native-call-v1",
            event.params ?? {},
          );
          leases.set(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set:vector] key=${lKey} agent=${context.agentId} tool=${event.toolName}`,
          );
          return { allow: true };
        }
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
        task_id: deriveTaskId({
          ...origin,
          agent_id: context.agentId,
        }),
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
    api.on("message_sending", async (event, ctx = {}) => {
      if (ctx.channelId !== "discord") return;
      const agentIdMatch = (ctx.sessionKey || "").match(/^agent:([^:]+)/);
      const agentId =
        ctx.agentId ||
        ctx.accountId ||
        (agentIdMatch ? agentIdMatch[1] : undefined);
      const agentName = AGENT_DISPLAY_NAMES[agentId] ?? agentId ?? "Zink Bot";
      return {
        content: formatForDiscord(event.content, { agentName }),
      };
    });
  },
};
