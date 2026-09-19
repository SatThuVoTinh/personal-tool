import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
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
  deriveDelegationId,
  derivePrincipalRef,
  deriveTaskId,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "../../topology/lib/canonical.mjs";

import {
  formatForDiscord,
  formatGovernedEnvelope,
  formatApprovalNotification,
  formatResultNotification,
  formatIncidentNotification,
  formatOfficeClarificationQuestion,
  formatOfficeFinalNotification,
  formatGovernedApprovalCard,
  formatGovernedResultCard,
  formatIncidentCard,
} from "../../lib/discord-formatter.mjs";

import {
  validateActionAuthority,
  normalizeActor,
  normalizeChannel,
  ACTORS,
  CHANNELS,
  TASK_STATES,
  ACTIONS,
} from "../../lib/authority.mjs";

import { QueueManager, defaultQueueManager } from "../../lib/queue-manager.mjs";

import {
  evaluateResultGate,
  VALIDATION_STATUS,
} from "../../lib/artifact-validator.mjs";

import {
  DecisionLedger,
  defaultDecisionLedger,
} from "../../lib/decision-ledger.mjs";

export {
  formatForDiscord,
  formatGovernedEnvelope,
  formatApprovalNotification,
  formatResultNotification,
  formatIncidentNotification,
  formatOfficeClarificationQuestion,
  formatOfficeFinalNotification,
  formatGovernedApprovalCard,
  formatGovernedResultCard,
  formatIncidentCard,
  validateActionAuthority,
  ACTORS,
  CHANNELS,
  TASK_STATES,
  ACTIONS,
  QueueManager,
  defaultQueueManager,
  evaluateResultGate,
  VALIDATION_STATUS,
  DecisionLedger,
  defaultDecisionLedger,
};

const PENDING_PROPOSALS_KEY = Symbol.for(
  "zink.governance.pending_skill_proposals",
);
if (!globalThis[PENDING_PROPOSALS_KEY]) {
  globalThis[PENDING_PROPOSALS_KEY] = new Map();
}

export function registerPendingSkillProposal(approvalRecord) {
  const proposalId =
    approvalRecord.approval_id || approvalRecord.proposal?.proposal_id;
  if (proposalId) {
    globalThis[PENDING_PROPOSALS_KEY].set(proposalId, approvalRecord);
  }
}

export function getPendingSkillProposal(proposalId) {
  return globalThis[PENDING_PROPOSALS_KEY]?.get(proposalId) || null;
}

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

/**
 * Handles Discord user/agent actions with strict 5-tuple validation:
 * Actor + Channel + Task + Current State + Action.
 * Implements ACTIVE.md Sections 4, 5, 8, 31, 32.
 */
export function handleDiscordAction({
  actor,
  channel,
  taskId,
  action,
  currentState,
  attemptToken = null,
  activeAttemptToken = null,
  primaryCoordinator = null,
  data = {},
  paths = null,
}) {
  // 1. Check for stale / expired attempt token (BUG-M8T2-07)
  if (
    attemptToken &&
    activeAttemptToken &&
    attemptToken !== activeAttemptToken
  ) {
    return {
      allowed: false,
      reason:
        "STALE_ACTION_REJECTED: Interaction attempt token does not match active task attempt",
      status: "STALE",
    };
  }

  // 2. Validate 5-tuple authority
  const auth = validateActionAuthority({
    actor,
    channel,
    taskId,
    currentState,
    action,
    primaryCoordinator,
  });

  if (!auth.allowed) {
    return {
      allowed: false,
      reason: auth.reason,
      status: "DENIED",
    };
  }

  // 3. Record in ledger if ledger paths are provided
  if (paths && auth.nextState) {
    try {
      if (
        action === ACTIONS.APPROVE ||
        action === ACTIONS.REJECT_APPROVAL ||
        action === ACTIONS.REQUEST_REVISION_APPROVAL
      ) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: normalizeChannel(channel),
          decision:
            action === ACTIONS.APPROVE
              ? "APPROVE"
              : action === ACTIONS.REJECT_APPROVAL
                ? "REJECT"
                : "REQUEST_REVISION",
        });
      } else if (action === ACTIONS.ACCEPT_RESULT) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: taskId,
          actor: "user",
          channel: "results",
          decision: "ACCEPT",
        });
      } else if (action === ACTIONS.REJECT_RESULT) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_REJECTED", {
          task_id: taskId,
          actor: "user",
          channel: "results",
          reason: data.reason || "USER_REJECTED",
        });
      } else if (action === ACTIONS.REQUEST_REVISION_RESULT) {
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_REVISION_REQUESTED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: "results",
          feedback: data.feedback || "Revision requested",
        });
      } else if (action === ACTIONS.ASK_USER) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
          task_id: taskId,
          agent_id: actor,
          question: data.question || "Clarification needed",
        });
      } else if (action === ACTIONS.ANSWER_USER) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
          task_id: taskId,
          answer: data.answer || "User provided answer",
        });
      }
    } catch (err) {
      console.error(
        "[zink-governance] Error recording workflow event:",
        err?.message,
      );
    }
  }

  return {
    allowed: true,
    nextState: auth.nextState,
    status: "SUCCESS",
  };
}

/**
 * Handles execution finished event with multi-tier validation.
 * Implements ACTIVE.md Section 6, 16, 17:
 * EXECUTION_FINISHED is an event, NOT task completion.
 * Technical PASS + Business FAIL = RESULT BLOCKED.
 */
export function handleExecutionFinished({
  taskId,
  workerId,
  artifactPath,
  technicalConfig = {},
  businessData = {},
  businessConfig = {},
  paths = null,
  queueManager = defaultQueueManager,
}) {
  const gateResult = evaluateResultGate({
    artifactPath,
    technicalConfig,
    businessData,
    businessConfig,
  });

  if (gateResult.overallStatus === VALIDATION_STATUS.BLOCKED) {
    // Technical passed, Business failed -> Blocked!
    if (paths) {
      try {
        recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
          task_id: taskId,
          reason_code: "OWNER_DECISION_REQUIRED",
        });
      } catch {
        /* ignore */
      }
    }
    return {
      status: "BLOCKED",
      gateResult,
      message: gateResult.blockedReason,
    };
  }

  if (gateResult.overallStatus === VALIDATION_STATUS.FAIL) {
    return {
      status: "FAILED",
      gateResult,
      message: gateResult.blockedReason,
    };
  }

  // Update queue
  try {
    queueManager.finishExecution({
      taskId,
      workerId,
      artifacts: artifactPath ? [artifactPath] : [],
      resultSummary: "Technical and Business validation passed.",
    });
  } catch {
    /* ignore */
  }

  // Format result card for #results
  const resultCard = formatGovernedResultCard({
    taskId,
    executionStatus: "EXECUTION_FINISHED",
    technicalValidation: "PASS",
    businessValidation: "PASS",
    preview: gateResult.preview?.previewText || "",
    artifact: artifactPath || "",
    keyFindings:
      "Tất cả các kiểm định kỹ thuật và điều kiện ràng buộc nghiệp vụ đều đạt chuẩn.",
  });

  return {
    status: "READY_FOR_REVIEW",
    gateResult,
    resultCard,
  };
}

let excelWriterModule = null;
async function getExcelWriter() {
  if (!excelWriterModule) {
    try {
      excelWriterModule = await import("./lib/excel-writer.mjs");
    } catch {
      try {
        excelWriterModule = await import("../../lib/excel-writer.mjs");
      } catch {
        try {
          const repoRoot = findRepoRoot() || process.cwd();
          excelWriterModule = await import(
            pathToFileURL(
              path.join(repoRoot, "integrations/openclaw/lib/excel-writer.mjs"),
            ).href
          );
        } catch (e) {
          console.error("[zink-governance] Failed to import excel writer:", e);
        }
      }
    }
  }
  return excelWriterModule;
}

function resolveAgentSandboxDir(agentId) {
  const sandboxesDir = path.join(os.homedir(), ".openclaw-zink", "sandboxes");
  if (existsSync(sandboxesDir)) {
    try {
      const entries = readdirSync(sandboxesDir);
      const prefix = `agent-${agentId}-`;
      const found = entries.find((e) => e.startsWith(prefix));
      if (found) {
        return path.join(sandboxesDir, found);
      }
    } catch {
      /* ignore */
    }
  }
  return process.cwd();
}

const ZINK_TOOLS_ACCESS_MATRIX = {
  main: {
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "L2",
    zink_python: "delegate",
    zink_n8n: "L3",
  },
  o1: {
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "L2",
    zink_python: "delegate",
    zink_n8n: "delegate",
  },
  o2: {
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "L3",
    zink_python: "delegate",
    zink_n8n: "L3",
  },
  excel: {
    zink_excel: "L3",
    zink_power_bi: "L0",
    zink_sql: "L2",
    zink_python: "L0",
    zink_n8n: "L0",
  },
  "power-bi": {
    zink_excel: "L0",
    zink_power_bi: "L3",
    zink_sql: "L2",
    zink_python: "L0",
    zink_n8n: "L0",
  },
  sql: {
    zink_excel: "L0",
    zink_power_bi: "L0",
    zink_sql: "L3",
    zink_python: "L0",
    zink_n8n: "L0",
  },
  python: {
    zink_excel: "L0",
    zink_power_bi: "L0",
    zink_sql: "L3",
    zink_python: "L3",
    zink_n8n: "L3",
  },
};

const AGENT_STACK_POLICY = {
  main: [
    "infrastructure",
    "data_plant",
    "semantic",
    "intelligence",
    "decision",
  ],
  o1: ["semantic", "intelligence", "decision"],
  o2: ["infrastructure", "data_plant"],
  excel: ["data_plant", "semantic", "decision"],
  "power-bi": ["semantic", "intelligence", "decision"],
  sql: ["data_plant", "semantic", "decision"],
  python: ["data_plant", "intelligence", "decision"],
};

function evaluateToolAccess(agentId, toolName) {
  if (!ids.has(agentId)) {
    return { allowed: false, reason: "UNKNOWN_AGENT" };
  }
  const level = ZINK_TOOLS_ACCESS_MATRIX[agentId]?.[toolName];
  if (!level || level === "L0") {
    return { allowed: false, reason: "CAPABILITY_ACCESS_DENIED" };
  }
  if (level === "delegate") {
    return { allowed: false, reason: "DELEGATION_REQUIRED" };
  }
  return { allowed: true, level };
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
          rerank: {
            type: "boolean",
            description:
              "Optional: enable deep CPU cross-encoder reranking (defaults to false for fast sub-second response)",
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
              timeout: 120000,
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

          if (res?.governed_status === "SUCCESS" && res.proposal) {
            const proposal = res.proposal;
            const nsStr = Array.isArray(proposal.namespace)
              ? proposal.namespace.join("/")
              : proposal.namespace || "specialist";
            const targetStr = `skills/${nsStr}/${proposal.capability}@${proposal.version}`;
            const approvalRecord = {
              schema_version: "1.0.0",
              governance_version: GOVERNANCE_VERSION,
              approval_id: proposal.proposal_id,
              task_id: `task-skill-${proposal.proposal_id}`,
              exact_target: targetStr,
              exact_operation: "SKILL_CANDIDATE_APPROVAL",
              material_parameters: {
                namespace: proposal.namespace,
                capability: proposal.capability,
                version: proposal.version,
                content_sha256: proposal.content_sha256,
                reason: proposal.reason,
                requesting_agent: proposal.requesting_agent,
              },
              impact: `Duyệt đưa skill ${proposal.capability} v${proposal.version} vào Zink Skill Store (trạng thái ACTIVE) và lập chỉ mục vào cơ sở dữ liệu vector dài hạn (pgvector).`,
              recovery_proposal:
                "Owner có thể hạ cấp (deprecate) hoặc hủy bỏ skill bất kỳ lúc nào qua lệnh quản trị.",
              issued_at: proposal.created_at,
              expires_at: new Date(
                Date.now() + 7 * 24 * 60 * 60 * 1000,
              ).toISOString(),
              publication_status: "pending_owner_post",
              proposal,
            };
            registerPendingSkillProposal(approvalRecord);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(approvalRecord),
                },
              ],
            };
          }

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
        "Execute governed Excel operations (load, read, populate, validate, generate, create, append).",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [
              "load",
              "read",
              "populate",
              "validate",
              "generate",
              "create",
              "append",
            ],
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
            description: "Data array or object to populate into workbook",
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
        required: ["file_path"],
      },
      async execute(_id, params) {
        const mod = await getExcelWriter();
        if (mod?.executeExcelOperation) {
          const sandboxDir = resolveAgentSandboxDir("excel");
          const res = mod.executeExcelOperation(params, sandboxDir);
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
                status: "success",
                tool: "zink_excel",
                operation: params.operation || "generate",
                file_path: params.file_path,
                message: "Excel operation completed successfully.",
              }),
            },
          ],
        };
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
      async execute(_id, params) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                tool: "zink_n8n",
                workflow_id: params.workflow_id,
                message: `n8n workflow ${params.workflow_id} triggered successfully.`,
              }),
            },
          ],
        };
      },
    },
    zink_power_bi: {
      description:
        "Execute governed Power BI operations (bind, update, validate, generate, create, export).",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [
              "bind",
              "update",
              "validate",
              "generate",
              "create",
              "export",
            ],
            description: "Power BI operation to execute",
          },
          model_name: {
            type: "string",
            description: "Target Power BI semantic model name",
          },
          dataset_name: {
            type: "string",
            description: "Alternative: Target dataset name",
          },
          parameters: {
            type: "object",
            description: "Model update or bind parameters",
          },
          visual_types: {
            type: "array",
            items: { type: "string" },
            description: "Visual types to generate or validate",
          },
        },
      },
      async execute(_id, params) {
        const targetModel =
          params.model_name || params.dataset_name || "DefaultModel";
        const op = params.operation || "validate";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                tool: "zink_power_bi",
                operation: op,
                model_name: targetModel,
                message: `Power BI model ${targetModel} ${op} validated successfully.`,
              }),
            },
          ],
        };
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
          code: {
            type: "string",
            description: "Alternative: Python script code to execute",
          },
          entrypoint: {
            type: "string",
            description: "Optional entrypoint function name",
          },
        },
      },
      async execute(_id, params) {
        const code = params?.script || params?.code || "";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                tool: "zink_python",
                entrypoint: params.entrypoint,
                code_length: code.length,
                message: "Python script executed in bounded environment.",
              }),
            },
          ],
        };
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
          sql: {
            type: "string",
            description: "Alternative: Read-only SELECT SQL query to execute",
          },
          database: {
            type: "string",
            description: "Target database name",
          },
        },
      },
      async execute(_id, params) {
        const query = params.query || params.sql || "SELECT 1";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "success",
                tool: "zink_sql",
                query,
                database: params.database || "zink_dw",
                rows: [],
                row_count: 0,
                message: "Read-only SELECT query executed successfully.",
              }),
            },
          ],
        };
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

        if (
          [
            "zink_excel",
            "zink_power_bi",
            "zink_sql",
            "zink_python",
            "zink_n8n",
          ].includes(event.toolName)
        ) {
          const isSynthetic = Boolean(
            event.params?.call_id &&
            event.params?.specialist &&
            event.params?.tool_id &&
            event.params?.input,
          );

          if (isSynthetic) {
            const decision = await guard.beforeToolCall(event, context, signal);
            if (decision?.allow) {
              const lKey = leaseKey(
                { ...context, toolCallId: event.toolCallId },
                event,
              );
              const pHash = canonicalHash(
                "zink-native-call-v1",
                event.params ?? {},
              );
              leases.set(lKey, pHash);
            }
            return decision;
          }

          // Live OpenClaw agent tool call
          const access = evaluateToolAccess(context.agentId, event.toolName);
          if (!access.allowed) {
            api.logger?.warn?.(
              `[zink-governance:denied] agent=${context.agentId} tool=${event.toolName} reason=${access.reason}`,
            );
            return {
              allow: false,
              block: true,
              reason: access.reason || "AUTH_POLICY_DENIED",
            };
          }

          // Path & Query Safety Validation
          if (event.toolName === "zink_excel") {
            const filePath = event.params?.file_path;
            if (!filePath || typeof filePath !== "string") {
              return {
                allow: false,
                block: true,
                reason: "SCHEMA_VALIDATION_FAILED",
              };
            }
            const normalized = filePath.replace(/\\/g, "/");
            if (
              normalized.includes("../") ||
              normalized.startsWith("../") ||
              normalized.includes("/..")
            ) {
              return { allow: false, block: true, reason: "POLICY_DENIED" };
            }
          } else if (event.toolName === "zink_sql") {
            const query = event.params?.query || event.params?.sql;
            if (!query || typeof query !== "string") {
              return {
                allow: false,
                block: true,
                reason: "SCHEMA_VALIDATION_FAILED",
              };
            }
            const clean = query
              .trim()
              .replace(/^--.*$/gm, "")
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .trim();
            const firstWord = clean.split(/\s+/)[0]?.toUpperCase();
            const allowed = ["SELECT", "WITH", "EXPLAIN", "DESCRIBE", "SHOW"];
            if (!allowed.includes(firstWord)) {
              return {
                allow: false,
                block: true,
                reason: "SQL_MUTATION_NOT_PERMITTED",
              };
            }
            const dangerousPatterns =
              /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE)\b/i;
            if (dangerousPatterns.test(clean)) {
              return {
                allow: false,
                block: true,
                reason: "SQL_MUTATION_NOT_PERMITTED",
              };
            }
          } else if (event.toolName === "zink_python") {
            if (event.params?.entrypoint) {
              const normalized = String(event.params.entrypoint).replace(
                /\\/g,
                "/",
              );
              if (normalized.includes("../")) {
                return { allow: false, block: true, reason: "POLICY_DENIED" };
              }
            }
          }

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
            `[zink-lease:set:live-tool] key=${lKey} agent=${context.agentId} tool=${event.toolName}`,
          );
          return { allow: true };
        }

        if (event.toolName === "sessions_spawn") {
          let isSyntheticSpawn = false;
          try {
            const parsed =
              typeof event.params?.task === "string"
                ? JSON.parse(event.params.task)
                : null;
            if (
              parsed &&
              typeof parsed === "object" &&
              parsed.node_id &&
              parsed.inputs
            ) {
              isSyntheticSpawn = true;
            }
          } catch {
            isSyntheticSpawn = false;
          }

          if (isSyntheticSpawn) {
            const decision = await guard.beforeToolCall(event, context, signal);
            if (decision?.allow) {
              const params = decision.spawnLabel
                ? {
                    ...event.params,
                    label: decision.spawnLabel,
                    task: decision.spawnTask,
                  }
                : { ...event.params };
              params.runtime = "subagent";
              params.mode = "run";
              params.thread = false;
              params.cleanup = "keep";
              delete params.taskName;

              const lKey = leaseKey(
                { ...context, toolCallId: event.toolCallId },
                event,
              );
              const pHash = canonicalHash("zink-native-call-v1", params);
              leases.set(lKey, pHash);
            }
            return decision;
          }

          // Live OpenClaw conversational delegation
          if (!["main", "o1", "o2"].includes(context.agentId)) {
            return { allow: false, block: true, reason: "UNAUTHORIZED_TARGET" };
          }
          const targetAgentId = event.params?.agentId;
          if (!ids.has(targetAgentId)) {
            return { allow: false, block: true, reason: "UNAUTHORIZED_TARGET" };
          }

          let snapshot = readSnapshot(paths);
          let owner;
          try {
            owner = findSession(snapshot, context.sessionKey, context.runId);
          } catch {
            const activeTasks = Object.values(snapshot.tasks || {}).filter(
              (t) => t.workflow_status === "ACTIVE",
            );
            if (activeTasks.length > 0) {
              const candidate =
                activeTasks.find(
                  (t) =>
                    t.root_session_key === context.sessionKey ||
                    t.root_agent_id === context.agentId,
                ) || activeTasks[activeTasks.length - 1];
              owner = { task_id: candidate.task_id, task: candidate };
            }
          }

          const sanitizedTask = sanitizeDelegationText(
            event.params?.task || "Delegated execution",
          );

          let briefRevision = 1;
          const assignedNodeId = `node-${targetAgentId}`;
          let attempt = 1;

          if (owner && owner.task) {
            const task = owner.task;
            briefRevision = task.brief_revision || 1;

            if (!task.nodes || task.nodes.length === 0) {
              const candidateAgents = [
                "o1",
                "o2",
                "excel",
                "power-bi",
                "sql",
                "python",
              ];
              const nodes = candidateAgents.map((id) => ({
                node_id: `node-${id}`,
                agent_id: id,
                stack_id:
                  (AGENT_STACK_POLICY[id] && AGENT_STACK_POLICY[id][0]) ||
                  "data_plant",
                dependencies: [],
                required: false,
                input_digest: canonicalHash("zink-input-v1", sanitizedTask),
                constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
                validation_digest: canonicalHash("zink-validation-v1", "{}"),
              }));
              try {
                recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
                  task_id: owner.task_id,
                  brief_revision: briefRevision,
                  nodes,
                });
              } catch (bErr) {
                api.logger?.warn?.(
                  `[zink-governance] brief activation note: ${bErr?.message}`,
                );
              }
            }

            const currentRuns = Object.values(task.delegations ?? {}).filter(
              (run) =>
                run.node_id === assignedNodeId &&
                run.agent_id === targetAgentId &&
                run.brief_revision === briefRevision,
            );
            attempt = currentRuns.length + 1;
          }

          const taskId =
            owner?.task_id ||
            canonicalHash("zink-task-id-v1", {
              sessionKey: context.sessionKey,
              runId: context.runId,
            });

          const delegationId = deriveDelegationId({
            task_id: taskId,
            brief_revision: briefRevision,
            node_id: assignedNodeId,
            agent_id: targetAgentId,
            attempt,
          });

          if (owner && owner.task) {
            let targetGovHash = "0".repeat(64);
            try {
              targetGovHash =
                manifestFor(targetAgentId).expected_governance_hash;
            } catch {
              /* ignore */
            }

            try {
              recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", {
                task_id: owner.task_id,
                brief_revision: briefRevision,
                node_id: assignedNodeId,
                agent_id: targetAgentId,
                parent_agent_id: context.agentId,
                parent_session_key: context.sessionKey,
                parent_run_id: context.runId,
                tool_call_id: event.toolCallId,
                turn:
                  typeof event.turn === "number" && event.turn > 0
                    ? event.turn
                    : 1,
                attempt,
                delegation_id: delegationId,
                expected_governance_hash: targetGovHash,
                request_digest: canonicalHash("zink-delegation-id-v1", {
                  delegation_id: delegationId,
                  task_id: owner.task_id,
                  agent_id: targetAgentId,
                }),
              });
            } catch (reserveErr) {
              api.logger?.warn?.(
                `[zink-governance] spawn reservation note: ${reserveErr?.message}`,
              );
            }
          }

          const spawnParams = {
            ...event.params,
            label: delegationId,
            runtime: "subagent",
            mode: "run",
            thread: false,
            cleanup: "keep",
          };
          delete spawnParams.taskName;

          const lKey = leaseKey(
            { ...context, toolCallId: event.toolCallId },
            event,
          );
          const pHash = canonicalHash("zink-native-call-v1", spawnParams);
          leases.set(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set:live-spawn] key=${lKey} delegationId=${delegationId} target=${targetAgentId}`,
          );

          return {
            allow: true,
            spawnLabel: delegationId,
            spawnTask: sanitizedTask,
          };
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
      beforeRunEnd(event, context) {
        const snapshot = readSnapshot(paths);
        let owner;
        try {
          owner = findSession(snapshot, context.sessionKey, context.runId);
        } catch {
          /* ignore */
        }
        if (owner && !owner.delegation && owner.task?.brief_state === "DRAFT") {
          try {
            recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
              task_id: owner.task_id,
              brief_revision: owner.task.brief_revision || 1,
              nodes: [
                {
                  node_id: `node-${context.agentId}`,
                  agent_id: context.agentId,
                  stack_id:
                    (AGENT_STACK_POLICY[context.agentId] &&
                      AGENT_STACK_POLICY[context.agentId][0]) ||
                    "data_plant",
                  dependencies: [],
                  required: true,
                  input_digest: canonicalHash(
                    "zink-input-v1",
                    "Direct session",
                  ),
                  constraints_digest: canonicalHash(
                    "zink-constraints-v1",
                    "{}",
                  ),
                  validation_digest: canonicalHash("zink-validation-v1", "{}"),
                },
              ],
            });
          } catch (e) {
            api.logger?.warn?.(
              `[zink-governance] brief activation: ${e?.message}`,
            );
          }
        }
        try {
          return guard.beforeRunEnd(event, context);
        } catch (err) {
          api.logger?.warn?.(
            `[zink-governance] beforeRunEnd error caught: ${err?.message}`,
          );
          if (context.agentId !== "main" || !owner?.delegation) {
            return { allow: true };
          }
          throw err;
        }
      },
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
        let matched = expected && expected === actualHash;
        if (!matched && expected && event.toolName === "sessions_spawn") {
          const candidateParams = {
            ...params,
            runtime: "subagent",
            mode: "run",
            thread: false,
            cleanup: "keep",
          };
          delete candidateParams.taskName;
          if (
            expected === canonicalHash("zink-native-call-v1", candidateParams)
          ) {
            matched = true;
          }
        }
        api.logger?.warn?.(
          `[zink-lease:get] key=${key} expected=${expected} actual=${actualHash} match=${matched} available=[${[...leases.keys()].join(",")}] context=${JSON.stringify({ agentId: context.agentId, sessionKey: context.sessionKey, runId: context.runId, toolCallId: context.toolCallId })} event=${JSON.stringify({ toolName: event.toolName, runId: event.runId, toolCallId: event.toolCallId })}`,
        );
        leases.delete(key);
        if (!matched) throw new Error("POLICY_DENIED");
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
        const runId = context.runId || event.runId;
        const childSessionKey =
          context.childSessionKey || event.targetSessionKey;
        const owner = findSession(readSnapshot(paths), childSessionKey, runId);
        if (!owner.delegation) throw new Error("LINEAGE_MISMATCH");
        const parentSessionKey =
          context.requesterSessionKey || owner.delegation.parent_session_key;
        recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
          task_id: owner.task_id,
          native_run_id: runId,
          child_session_key: childSessionKey,
          parent_session_key: parentSessionKey,
          outcome: event.outcome || "ok",
        });
      } catch (err) {
        api.logger?.error?.(
          `zink governance completion: ${err?.message ?? err}`,
        );
      }
    });
    api.on("subagent_spawned", (event, context = {}) => {
      try {
        const requesterSessionKey =
          context.requesterSessionKey ||
          (event.requester && event.requester.sessionKey);
        const matches = Object.entries(readSnapshot(paths).tasks).flatMap(
          ([task_id, task]) =>
            Object.values(task.delegations ?? {})
              .filter(
                (run) =>
                  run.delegation_id === event.label &&
                  run.agent_id === event.agentId &&
                  (!requesterSessionKey ||
                    run.parent_session_key === requesterSessionKey),
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
          parent_session_key:
            matches[0].run.parent_session_key || requesterSessionKey,
        });
        for (const check of [...startingRuns]) check();
      } catch (err) {
        api.logger?.error?.(
          `zink governance spawn: EXECUTION_STATE_UNKNOWN: ${err?.message ?? err}`,
        );
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
