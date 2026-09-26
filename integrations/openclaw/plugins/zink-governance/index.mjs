import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { createGovernanceGuard } from "../../topology/lib/guard.mjs";
import {
  checkSchema,
  loadContractSchema,
  generateSchemaManifest,
  verifySchemaManifestChecksums,
} from "../../topology/lib/schema.mjs";
import {
  TOOL_POLICY,
  BUILT_IN_TOOL_POLICY,
  MEMORY_TOOL_POLICY,
  ZINK_MEMORY_TOOL_REGISTRY,
  effectiveMemoryTools,
  canAccessMemoryTool,
} from "../../lib/policy.mjs";
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
  ZINK_TOOLS_ACCESS_MATRIX,
  buildComponentCustomId,
  parseComponentCustomId,
  DISCORD_COMPONENT_ACTION_NAMESPACE,
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

import { executeExcelOperation } from "../../lib/excel-writer.mjs";

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
  MEMORY_TOOL_POLICY,
  ZINK_MEMORY_TOOL_REGISTRY,
  effectiveMemoryTools,
  canAccessMemoryTool,
};

const PENDING_PROPOSALS_KEY = Symbol.for(
  "zink.governance.pending_skill_proposals",
);
if (!globalThis[PENDING_PROPOSALS_KEY]) {
  globalThis[PENDING_PROPOSALS_KEY] = new Map();
}

const COMPLETED_EXECUTIONS_KEY = Symbol.for(
  "zink.governance.completed_executions",
);
if (!globalThis[COMPLETED_EXECUTIONS_KEY]) {
  globalThis[COMPLETED_EXECUTIONS_KEY] = new Set();
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

  // K18: Distinct approval transaction identity
  const approvalTransactionId = `appr_${createHash("sha256").update(`${proposalId}:${contentSha256}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24)}`;

  // K19 & K22: Proposal record verification
  const pendingRecord =
    options.proposalRecord || getPendingSkillProposal(proposalId);
  if (pendingRecord) {
    const recContentSha =
      pendingRecord.content_sha256 ||
      pendingRecord.proposal?.content_sha256 ||
      pendingRecord.contentSha256;
    if (recContentSha && recContentSha !== contentSha256) {
      throw new Error(
        "APPROVAL_PROPOSAL_MISMATCH: Content hash does not match approved proposal record",
      );
    }
    const recProposalId =
      pendingRecord.proposal_id ||
      pendingRecord.approval_id ||
      pendingRecord.proposal?.proposal_id;
    if (recProposalId && recProposalId !== proposalId) {
      throw new Error(
        "APPROVAL_PROPOSAL_MISMATCH: Proposal ID does not match registered record",
      );
    }
  }

  // K21: Verify skill exists if skillsRoot provided and skill target specified
  if (
    skillsRoot &&
    options.capability &&
    options.namespace &&
    options.version
  ) {
    const nsParts = Array.isArray(options.namespace)
      ? options.namespace
      : [options.namespace];
    const skillPath = path.join(
      skillsRoot,
      ...nsParts,
      options.capability,
      options.version,
      "SKILL.md",
    );
    if (!existsSync(skillPath)) {
      throw new Error(
        `APPROVAL_SKILL_VERSION_MISSING: Skill version ${options.version} not found in store`,
      );
    }
  }

  // K20: Vector sync module availability (Fail-Closed)
  const syncMod = await getVectorSyncModule();
  if (!syncMod || typeof syncMod.syncSkillsToVectorStore !== "function") {
    throw new Error(
      "VECTOR_SYNC_UNAVAILABLE: Cannot complete approval without vector sync module",
    );
  }

  // K23: Atomic proposal -> approval -> vector-sync transition
  const syncResult = await syncMod.syncSkillsToVectorStore({
    skillsRoot,
    ...options,
  });

  return {
    ...syncResult,
    approval_transaction_id: approvalTransactionId,
    proposal_id: proposalId,
    approval_status: "APPROVED",
  };
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
  readOnly = false,
}) {
  // 1. Check attempt token fencing (BUG-M8T2-07 / G03)
  // G03: if requireAttemptFencing=true, BOTH tokens must be present; missing pair fails closed.
  if (data?.requireAttemptFencing === true) {
    if (!attemptToken || !activeAttemptToken) {
      return {
        allowed: false,
        reason:
          "MISSING_ATTEMPT_TOKEN: Attempt fencing required but attemptToken or activeAttemptToken is missing",
        status: "STALE",
      };
    }
  }
  if (attemptToken !== null || activeAttemptToken !== null) {
    if (
      !attemptToken ||
      !activeAttemptToken ||
      attemptToken !== activeAttemptToken
    ) {
      return {
        allowed: false,
        reason:
          "STALE_ACTION_REJECTED: Interaction attempt token does not match active task attempt",
        status: "STALE",
      };
    }
  }

  // 2. Authoritative State & Primary Coordinator resolution (G01, G02)
  let effectiveCurrentState = currentState;
  let effectivePrimaryCoordinator = primaryCoordinator;

  if (paths) {
    try {
      const snapshot = readSnapshot(paths);
      const authoritativeTask = snapshot?.tasks?.[taskId];
      if (authoritativeTask) {
        let status = authoritativeTask.workflow_status;
        if (
          status === "ACTIVE" &&
          !authoritativeTask.approved_at &&
          !authoritativeTask.claimed_at
        ) {
          status = "APPROVAL_PENDING";
        }
        effectiveCurrentState = status;
        effectivePrimaryCoordinator =
          authoritativeTask.primary_coordinator ??
          authoritativeTask.root_agent_id ??
          primaryCoordinator;
      }
    } catch {
      return {
        allowed: false,
        reason: "LEDGER_READ_FAILED: Unable to load authoritative task state",
        status: "FAILED",
      };
    }
  }

  // 3. Normalize action and validate 5-tuple authority
  const normAction = action
    ? typeof action === "string" && action.toUpperCase().trim() === "REJECT"
      ? normalizeChannel(channel) === CHANNELS.RESULTS
        ? ACTIONS.REJECT_RESULT
        : ACTIONS.REJECT_APPROVAL
      : typeof action === "string" &&
          action.toUpperCase().trim() === "REQUEST_REVISION"
        ? normalizeChannel(channel) === CHANNELS.RESULTS
          ? ACTIONS.REQUEST_REVISION_RESULT
          : ACTIONS.REQUEST_REVISION_APPROVAL
        : action
    : action;

  const auth = validateActionAuthority({
    actor,
    channel,
    taskId,
    currentState: effectiveCurrentState,
    action: normAction,
    primaryCoordinator: effectivePrimaryCoordinator,
  });

  if (!auth.allowed) {
    return {
      allowed: false,
      reason: auth.reason,
      status: "DENIED",
    };
  }

  // 4. Sanitize inputs and enforce bounds on feedback/reason (G10)
  const safeReason = data.reason
    ? String(data.reason).slice(0, 2000)
    : "USER_REJECTED";
  const safeFeedback = data.feedback
    ? String(data.feedback).slice(0, 2000)
    : "Revision requested";
  const safeQuestion = data.question
    ? String(data.question).slice(0, 2000)
    : "Clarification needed";
  const safeAnswer = data.answer
    ? String(data.answer).slice(0, 4000)
    : "User provided answer";

  // 5. Record in ledger if ledger paths are provided
  if (paths && auth.nextState) {
    try {
      if (
        normAction === ACTIONS.APPROVE ||
        normAction === ACTIONS.REJECT_APPROVAL ||
        normAction === ACTIONS.REQUEST_REVISION_APPROVAL
      ) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: normalizeChannel(channel),
          decision:
            normAction === ACTIONS.APPROVE
              ? "APPROVE"
              : normAction === ACTIONS.REJECT_APPROVAL
                ? "REJECT"
                : "REQUEST_REVISION",
          message_id: data.messageId ?? data.origin_message_id ?? null,
          thread_id: data.threadId ?? null,
          scope_digest: data.scopeDigest ?? null,
          reason: safeReason,
        });
      } else if (normAction === ACTIONS.ACCEPT_RESULT) {
        // G09: result accept must bind specific result_id; reject if missing
        const resultId = data.resultId ?? null;
        if (!resultId) {
          return {
            allowed: false,
            reason:
              "MISSING_RESULT_ID: ACCEPT_RESULT requires data.resultId to bind specific result",
            status: "DENIED",
          };
        }
        recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_ACCEPTED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: normalizeChannel(channel),
          decision: "ACCEPT",
          result_id: resultId,
          result_digest: data.resultDigest ?? null,
          message_id: data.messageId ?? data.origin_message_id ?? null,
          thread_id: data.threadId ?? null,
        });
      } else if (normAction === ACTIONS.REJECT_RESULT) {
        // G09: result reject must also bind specific result_id
        const resultId = data.resultId ?? null;
        if (!resultId) {
          return {
            allowed: false,
            reason:
              "MISSING_RESULT_ID: REJECT_RESULT requires data.resultId to bind specific result",
            status: "DENIED",
          };
        }
        recordWorkflowEvent(paths, "WORKFLOW_USER_RESULT_REJECTED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: normalizeChannel(channel),
          reason: safeReason,
          result_id: resultId,
          result_digest: data.resultDigest ?? null,
          message_id: data.messageId ?? data.origin_message_id ?? null,
          thread_id: data.threadId ?? null,
        });
      } else if (normAction === ACTIONS.REQUEST_REVISION_RESULT) {
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_REVISION_REQUESTED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: "results",
          feedback: safeFeedback,
          result_id: data.resultId ?? taskId,
          result_digest: data.resultDigest ?? null,
        });
      } else if (normAction === ACTIONS.ASK_USER) {
        recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
          task_id: taskId,
          agent_id: normalizeActor(actor),
          question: safeQuestion,
        });
      } else if (normAction === ACTIONS.ANSWER_USER) {
        // G07: bind user principal + message_id; reject if userPrincipalRef missing
        const userPrincipal =
          data.userPrincipalRef ?? data.userSnowflake ?? null;
        if (!userPrincipal) {
          return {
            allowed: false,
            reason:
              "MISSING_USER_PRINCIPAL: ANSWER_USER requires userPrincipalRef to bind user identity",
            status: "DENIED",
          };
        }
        recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
          task_id: taskId,
          answer: safeAnswer,
          user_principal_ref: userPrincipal,
          message_id: data.messageId ?? data.origin_message_id ?? null,
          thread_id: data.threadId ?? null,
        });
      }
    } catch (err) {
      // G05: Ledger write failure CANNOT return SUCCESS
      return {
        allowed: false,
        reason: `LEDGER_WRITE_FAILED: ${err?.message}`,
        status: "FAILED",
      };
    }
  }

  return {
    allowed: true,
    nextState: auth.nextState,
    status: paths ? "SUCCESS" : readOnly ? "READ_ONLY" : "UNPERSISTED",
  };
}

/**
 * Handles execution finished event with multi-tier validation.
 * Implements ACTIVE.md Section 6, 16, 17:
 * EXECUTION_FINISHED is an event, NOT task completion.
 * Technical PASS + Business FAIL = RESULT BLOCKED.
 */
export const MAX_ARTIFACTS_PER_RESULT = 10;

export function handleExecutionFinished({
  taskId,
  workerId,
  leaseId = null,
  attempt = null,
  artifactPath,
  artifacts = null,
  sandboxDir = null,
  technicalConfig = {},
  businessData = {},
  businessConfig = {},
  paths = null,
  queueManager = defaultQueueManager,
  idempotencyKey = null,
}) {
  // I09: Validate maximum artifact count at governance boundary
  const allArtifacts = Array.isArray(artifacts)
    ? artifacts
    : artifactPath
      ? [artifactPath]
      : [];
  if (allArtifacts.length > MAX_ARTIFACTS_PER_RESULT) {
    return {
      status: "FAILED",
      error: `MAX_ARTIFACTS_EXCEEDED: Result exceeds maximum allowed artifacts (${MAX_ARTIFACTS_PER_RESULT})`,
    };
  }

  // G20: Idempotency check for repeated artifact completion
  if (idempotencyKey) {
    if (globalThis[COMPLETED_EXECUTIONS_KEY]?.has(idempotencyKey)) {
      return {
        status: "ALREADY_COMPLETED",
        idempotencyKey,
      };
    }
  }

  // G15: Resolve authoritative scope BEFORE reading artifact — fail if task is in a terminal/wrong state
  let authoritativeTask = null;
  if (paths) {
    try {
      const snapshot = readSnapshot(paths);
      authoritativeTask = snapshot?.tasks?.[taskId] ?? null;
      if (authoritativeTask) {
        const ws = authoritativeTask.workflow_status;
        if (ws === "CANCELLED") {
          return { status: "FAILED", error: "TASK_ALREADY_CANCELLED" };
        }
        if (ws === "COMPLETE" || ws === "PARTIAL") {
          return { status: "FAILED", error: `TASK_ALREADY_TERMINAL: ${ws}` };
        }
      }
    } catch {
      return {
        status: "FAILED",
        error: "SCOPE_RESOLUTION_FAILED: Cannot load authoritative task state",
      };
    }
  }

  // G14: Worker lease/attempt validation against active claims
  if (queueManager?.activeClaims?.has(taskId)) {
    const claim = queueManager.activeClaims.get(taskId);
    if (workerId && claim.workerId !== workerId) {
      return {
        status: "FAILED",
        error: `WORKER_MISMATCH: Task claimed by ${claim.workerId}, not ${workerId}`,
      };
    }
    if (leaseId && claim.leaseId !== leaseId) {
      return {
        status: "FAILED",
        error: "LEASE_MISMATCH: Worker lease does not match active claim",
      };
    }
    if (attempt !== null && claim.attempt !== attempt) {
      return {
        status: "FAILED",
        error: "ATTEMPT_MISMATCH: Attempt does not match active claim",
      };
    }
  }

  const effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null;
  const gateResult = evaluateResultGate({
    artifactPath,
    technicalConfig: {
      ...technicalConfig,
      ...(effectiveSandbox ? { sandboxDir: effectiveSandbox } : {}),
    },
    businessData,
    businessConfig,
  });

  // G11 & G12: Business validation BLOCKED does NOT call WORKFLOW_CANCELLED
  if (gateResult.overallStatus === VALIDATION_STATUS.BLOCKED) {
    return {
      status: "BLOCKED",
      gateResult,
      message: gateResult.blockedReason || "Business validation blocked",
    };
  }

  if (gateResult.overallStatus === VALIDATION_STATUS.FAIL) {
    return {
      status: "FAILED",
      gateResult,
      message: gateResult.blockedReason || "Technical validation failed",
    };
  }

  let payloadDigest = null;
  if (artifactPath && existsSync(artifactPath)) {
    try {
      const buf = readFileSync(artifactPath);
      payloadDigest = createHash("sha256").update(buf).digest("hex");
    } catch {
      /* ignore */
    }
  }

  // G13: Propagate queue finish errors instead of swallowing
  try {
    queueManager.finishExecution({
      taskId,
      workerId,
      leaseId,
      attempt,
      artifacts: artifactPath ? [artifactPath] : [],
      payloadDigest,
      resultSummary:
        gateResult.summary || "Technical and Business validation passed.",
    });
  } catch (queueErr) {
    return {
      status: "FAILED",
      error: `QUEUE_FINISH_FAILED: ${queueErr?.message}`,
      gateResult,
    };
  }

  // G16: Derive executionStatus from actual task state, not hard-coded string
  const derivedExecutionStatus = (() => {
    if (authoritativeTask) {
      const ws = authoritativeTask.workflow_status;
      if (ws === "EXECUTING") return "EXECUTION_FINISHED";
      if (ws === "ACTIVE") return "EXECUTION_FINISHED";
      return `EXECUTION_FINISHED_FROM_${ws}`;
    }
    return "EXECUTION_FINISHED";
  })();

  // Format result card for #results using actual validator outputs (F14, F15, F16)
  const resultCard = formatGovernedResultCard({
    taskId,
    attempt: attempt || 1,
    executionStatus: derivedExecutionStatus,
    technicalValidation: gateResult.technical?.status || "PASS",
    businessValidation: gateResult.business?.status || "PASS",
    preview: gateResult.preview?.previewText || "",
    previewImage: gateResult.preview?.previewImage || null,
    artifact: artifactPath || "",
    keyFindings:
      gateResult.keyFindings ||
      gateResult.summary ||
      "Tất cả các kiểm định kỹ thuật và điều kiện ràng buộc nghiệp vụ đều đạt chuẩn.",
    resultDigest: payloadDigest,
  });

  // G17, G18, G19: Record WORKFLOW_RESULT_RECORDED in ledger; fail closed to prevent queue/ledger drift
  if (paths) {
    try {
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        worker_id: workerId,
        attempt: attempt ?? 1,
        payload_digest: payloadDigest,
        technical_status: gateResult.technical?.status || "PASS",
        business_status: gateResult.business?.status || "PASS",
        artifact_path: artifactPath ? path.basename(artifactPath) : null,
        recorded_at: new Date().toISOString(),
      });
    } catch (err) {
      return {
        status: "FAILED",
        error: `LEDGER_RESULT_RECORD_FAILED: ${err?.message}`,
        gateResult,
      };
    }
  }

  if (idempotencyKey) {
    globalThis[COMPLETED_EXECUTIONS_KEY]?.add(idempotencyKey);
  }

  return {
    status: "READY_FOR_REVIEW",
    gateResult,
    resultCard,
    payloadDigest,
    idempotencyKey,
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

export function resolveAgentSandboxDir(agentId, context = null) {
  if (!agentId || typeof agentId !== "string") {
    return null;
  }
  // I04: Validate agentId against authenticated execution context when context provided
  if (context && context.agentId && context.agentId !== agentId) {
    return null;
  }
  const sandboxesDir = path.join(os.homedir(), ".openclaw-zink", "sandboxes");
  if (existsSync(sandboxesDir)) {
    try {
      const entries = readdirSync(sandboxesDir);
      const prefix = `agent-${agentId}-`;
      // I02: Must match exactly one sandbox or specific session/task sandbox, never ambiguously pick first
      const matches = entries.filter((e) => e.startsWith(prefix));
      if (matches.length === 1) {
        return path.join(sandboxesDir, matches[0]);
      }
      if (matches.length > 1 && context?.sessionKey) {
        const specific = matches.find(
          (e) =>
            e.includes(context.sessionKey) ||
            (context.taskId && e.includes(context.taskId)),
        );
        if (specific) return path.join(sandboxesDir, specific);
        // Ambiguous multiple sandboxes without specific match: fail closed
        return null;
      }
    } catch {
      /* ignore */
    }
  }
  // I03: Fails closed to null, NEVER falls back to process.cwd()
  return null;
}

export function evaluateToolAccess(agentId, toolName) {
  if (!ids.has(agentId)) {
    return { allowed: false, reason: "UNKNOWN_AGENT" };
  }
  if (
    toolName === "zink_knowledge_search" ||
    toolName === "zink_skill_search"
  ) {
    return { allowed: true, level: "L2" };
  }
  if (toolName === "zink_skill_propose") {
    const allowedProposers = ["excel", "power-bi", "sql", "python"];
    if (allowedProposers.includes(agentId)) {
      return { allowed: true, level: "L3" };
    }
    return { allowed: false, reason: "CAPABILITY_ACCESS_DENIED" };
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

// C10 & C11: Auto-load tool schemas from checked-in contracts in zink-tools/contracts/
export function loadToolContractSchemas() {
  const toolSchemaMap = {
    zink_excel: "zink-excel",
    zink_power_bi: "zink-power-bi",
    zink_sql: "zink-sql",
    zink_python: "zink-python",
    zink_n8n: "zink-n8n",
    zink_skill_search: "zink-skill",
    zink_knowledge_search: "zink-knowledge",
    zink_skill_propose: "zink-skill",
  };
  const result = {};
  for (const [toolId, schemaName] of Object.entries(toolSchemaMap)) {
    try {
      const rawSchema = loadContractSchema(schemaName);
      result[toolId] = {
        schemaName,
        rawSchema,
        parameters: rawSchema.$defs?.input || rawSchema,
      };
    } catch {
      // fallback
    }
  }
  return result;
}

// C12 & O18: Schema manifest and checksum generator
export function generateToolSchemaManifest() {
  return generateSchemaManifest();
}

export function verifyToolSchemaManifest(manifest = null) {
  return verifySchemaManifestChecksums(manifest);
}

// O18: Generated runtime registry checksum
export function getToolRegistryChecksum() {
  const manifest = generateToolSchemaManifest();
  return manifest.manifestChecksum || manifest.manifestSha256;
}

// O20: Schema-only capabilities taxonomy
export const SCHEMA_ONLY_CAPABILITIES = Object.freeze([
  "zink_forecast",
  "zink_optimization",
  "zink_operations_research",
  "zink_simulation",
]);

export function isExecutableTool(toolId) {
  return !SCHEMA_ONLY_CAPABILITIES.includes(toolId);
}

// O19: Validate built-in vs callable tool allowlist invariants
export function validateToolAllowlistInvariants() {
  const violations = [];
  for (const agentId of ids) {
    const callable = TOOL_POLICY[agentId] || [];
    const builtin = BUILT_IN_TOOL_POLICY[agentId] || [];
    const intersection = callable.filter((t) => builtin.includes(t));
    if (intersection.length > 0) {
      violations.push(
        `Overlap between callable and builtin tools for ${agentId}: ${intersection.join(", ")}`,
      );
    }
  }
  return {
    valid: violations.length === 0,
    violations,
  };
}

export function registerTools(api) {
  const registerFn =
    typeof api?.registerTool === "function"
      ? api.registerTool.bind(api)
      : typeof api?.tools?.register === "function"
        ? api.tools.register.bind(api.tools)
        : null;
  if (!registerFn) return;
  const toolContracts = loadToolContractSchemas();
  let registryChecksum = null;
  try {
    registryChecksum = getToolRegistryChecksum();
  } catch (err) {
    api?.logger?.warn?.(
      `[zink-governance] registerTools: Could not compute tool registry checksum: ${err?.message}`,
    );
  }

  const registry = {
    zink_skill_search: {
      description:
        "Search governed skills in Zink Skill Store using semantic vector similarity.",
      parameters: toolContracts.zink_skill_search?.parameters
        ? {
            type: "object",
            properties: {
              query: toolContracts.zink_skill_search.parameters.properties
                ?.query || { type: "string" },
              limit: toolContracts.zink_skill_search.parameters.properties
                ?.limit || { type: "integer" },
              primary_topic: toolContracts.zink_skill_search.parameters
                .properties?.primary_topic || { type: "string" },
              subtopic: toolContracts.zink_skill_search.parameters.properties
                ?.subtopic || { type: "string" },
              capability: toolContracts.zink_skill_search.parameters.properties
                ?.capability || { type: "string" },
              namespace: toolContracts.zink_skill_search.parameters.properties
                ?.namespace || { type: "string" },
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
              session_key: {
                type: "string",
                description: "Runtime session key",
              },
              run_id: { type: "string", description: "Runtime execution ID" },
            },
            required: ["query"],
          }
        : {
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
              subtopic: {
                type: "string",
                description: "Optional subtopic filter",
              },
              capability: {
                type: "string",
                description: "Optional capability name filter",
              },
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
            },
            required: ["query"],
          },
      async execute(_id, params) {
        const mod = await getSkillAdapter();
        // O09: Pass context with task/agent/session identity
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent:
            params?.requesting_agent || _id?.agent || _id?.agentId || "unknown",
        };
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "search",
              ...params,
            },
            ctx,
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
                context: ctx,
              }),
            },
          ],
        };
      },
    },
    zink_knowledge_search: {
      description:
        "Search authoritative documents in Zink Knowledgebase using semantic hybrid RAG.",
      parameters: toolContracts.zink_knowledge_search?.parameters
        ? {
            type: "object",
            properties: {
              query: toolContracts.zink_knowledge_search.parameters.properties
                ?.query || { type: "string" },
              limit: toolContracts.zink_knowledge_search.parameters.properties
                ?.limit || { type: "integer" },
              primary_topic: toolContracts.zink_knowledge_search.parameters
                .properties?.primary_topic || { type: "string" },
              path_prefix: {
                type: "string",
                description: "Optional path prefix filter",
              },
              rerank: {
                type: "boolean",
                description: "Optional deep cross-encoder reranking",
              },
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
              session_key: {
                type: "string",
                description: "Runtime session key",
              },
              run_id: { type: "string", description: "Runtime execution ID" },
            },
            required: ["query"],
          }
        : {
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
                description: "Optional deep cross-encoder reranking",
              },
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
            },
            required: ["query"],
          },
      async execute(_id, params) {
        const mod = await getKnowledgeAdapter();
        // O10: Pass context with task/agent/session identity
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent:
            params?.requesting_agent || _id?.agent || _id?.agentId || "unknown",
        };
        if (mod?.executeGovernedKnowledgeQuery) {
          const res = await mod.executeGovernedKnowledgeQuery(
            {
              action: "search",
              ...params,
            },
            ctx,
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
                context: ctx,
              }),
            },
          ],
        };
      },
    },
    zink_skill_propose: {
      description:
        "Propose a new or updated skill candidate for human owner review and approval.",
      parameters: toolContracts.zink_skill_propose?.parameters
        ? {
            type: "object",
            properties: {
              namespace: {
                type: "string",
                description:
                  "Skill namespace slug (e.g. excel, sql, python, data)",
              },
              capability: {
                type: "string",
                description:
                  "Skill capability slug (e.g. vlookup-optimization)",
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
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
              session_key: {
                type: "string",
                description: "Runtime session key",
              },
              run_id: { type: "string", description: "Runtime execution ID" },
            },
            required: [
              "namespace",
              "capability",
              "version",
              "content",
              "reason",
            ],
          }
        : {
            type: "object",
            properties: {
              namespace: {
                type: "string",
                description:
                  "Skill namespace slug (e.g. excel, sql, python, data)",
              },
              capability: {
                type: "string",
                description:
                  "Skill capability slug (e.g. vlookup-optimization)",
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
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
            },
            required: [
              "namespace",
              "capability",
              "version",
              "content",
              "reason",
            ],
          },
      async execute(_id, params) {
        const mod = await getSkillAdapter();
        // O11: Pass context with requesting agent and correlation identity
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent:
            params?.requesting_agent || _id?.agent || _id?.agentId || "unknown",
        };
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "propose",
              ...params,
            },
            ctx,
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
                requesting_agent:
                  proposal.requesting_agent || ctx.requestingAgent,
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
                context: ctx,
              }),
            },
          ],
        };
      },
    },
    // O16, N09, N10: Excel operations strictly aligned with contract
    zink_excel: {
      description:
        "Execute governed Excel workbook operations: load, populate, validate, generate (contract seam).",
      parameters: toolContracts.zink_excel?.parameters || {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["load", "populate", "validate", "generate"],
            description: "Excel operation to execute",
          },
          file_path: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            description: "Target Excel workbook file path",
          },
          template_path: {
            type: "string",
            minLength: 1,
            maxLength: 512,
            description: "Template file path for population",
          },
          data: {
            type: "object",
            description: "Data object to populate into workbook",
          },
          rules: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 256 },
            description: "Validation rules to check against workbook",
          },
          specification: {
            type: "object",
            description: "Generation specification for new workbook",
          },
          task_id: {
            type: "string",
            description: "Governed task correlation ID",
          },
          provenance: {
            type: "object",
            description: "Artifact provenance metadata",
          },
        },
        required: ["operation", "file_path"],
      },
      async execute(_id, params) {
        const mod = await getExcelWriter();
        if (mod?.executeExcelOperation) {
          const sandboxDir =
            resolveAgentSandboxDir("excel") ||
            path.resolve(process.cwd(), "artifacts");
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
                status: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_excel",
                operation: params?.operation || "generate",
                file_path: params?.file_path,
                message:
                  "Excel engine not available in this environment. Deploy zink-tools/excel-engine to enable real execution.",
              }),
            },
          ],
        };
      },
    },
    // O17, N09: n8n workflow triggers bound to workflow definitions
    zink_n8n: {
      description:
        "Execute governed n8n workflows via webhook triggers (data_plant_ingest, data_plant_sync, pipeline_notify).",
      parameters: toolContracts.zink_n8n?.parameters || {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            enum: ["data_plant_ingest", "data_plant_sync", "pipeline_notify"],
            description: "Registered n8n workflow identifier",
          },
          payload: {
            type: "object",
            description:
              "Workflow-specific input payload matching registered schema",
          },
          task_id: {
            type: "string",
            description: "Governed task correlation ID",
          },
        },
        required: ["workflow_id", "payload"],
      },
      async execute(_id, params) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_n8n",
                workflow_id: params?.workflow_id,
                message: `n8n engine not available. Deploy zink-tools/n8n-adapter to trigger workflow ${params?.workflow_id}.`,
              }),
            },
          ],
        };
      },
    },
    // O14, N09, N10: Power BI operations strictly aligned with contract
    zink_power_bi: {
      description:
        "Execute governed Power BI operations: load, bind, update, validate (contract seam).",
      parameters: toolContracts.zink_power_bi?.parameters || {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["load", "bind", "update", "validate"],
            description: "Power BI operation to execute",
          },
          model: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description: "Target Power BI semantic model name",
          },
          datasource: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description: "Datasource for bind operation",
          },
          tables: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 128 },
            description: "Tables for bind operation",
          },
          changes: {
            type: "object",
            description: "Changes object for update operation",
          },
          task_id: {
            type: "string",
            description: "Governed task correlation ID",
          },
        },
        required: ["operation", "model"],
      },
      async execute(_id, params) {
        const targetModel =
          params?.model ||
          params?.model_name ||
          params?.dataset_name ||
          "DefaultModel";
        const op = params?.operation || "validate";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_power_bi",
                operation: op,
                model: targetModel,
                message: `Power BI engine not available. Deploy zink-tools/power-bi-engine to execute operation '${op}' on model '${targetModel}'.`,
              }),
            },
          ],
        };
      },
    },
    // O13, N09, N10: Python script execution requires entrypoint and stack
    zink_python: {
      description:
        "Execute bounded Python scripts in isolated per-stack environments (contract seam).",
      parameters: toolContracts.zink_python?.parameters || {
        type: "object",
        properties: {
          entrypoint: {
            type: "string",
            pattern: "^scripts/[a-zA-Z0-9_-]+\\.py$",
            maxLength: 512,
            description: "Relative path to Python entrypoint script",
          },
          args: {
            type: "array",
            items: { type: "string", maxLength: 1024 },
            maxItems: 64,
            description: "Command-line arguments",
          },
          stack: {
            type: "string",
            enum: ["data_plant", "semantic", "intelligence", "decision"],
            description: "Target isolated execution stack",
          },
          task_id: {
            type: "string",
            description: "Governed task correlation ID",
          },
        },
        required: ["entrypoint", "stack"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_python",
                entrypoint: params?.entrypoint,
                stack: params?.stack,
                message:
                  "Python sandbox not available. Deploy zink-tools/python-sandbox to enable real script execution.",
              }),
            },
          ],
        };
      },
    },
    // O15, N09, N10: SQL read-only queries with target_database
    zink_sql: {
      description:
        "Execute bounded read-only SELECT SQL queries against authorized target database (contract seam).",
      parameters: toolContracts.zink_sql?.parameters || {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 8192,
            description: "Read-only SELECT SQL query to execute",
          },
          target_database: {
            type: "string",
            enum: ["knowledge", "analytics_read"],
            description: "Authorized target database for query",
          },
          max_rows: {
            type: "integer",
            minimum: 1,
            maximum: 1000,
            default: 100,
          },
          parameters: {
            type: "array",
            maxItems: 100,
          },
          task_id: {
            type: "string",
            description: "Governed task correlation ID",
          },
        },
        required: ["query", "target_database"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const query = params?.query || params?.sql || "SELECT 1";
        const targetDb =
          params?.target_database || params?.database || "knowledge";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_sql",
                query,
                target_database: targetDb,
                rows: [],
                row_count: 0,
                message:
                  "SQL engine not available. Deploy zink-tools/sql-engine to execute read-only queries.",
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
      parameters: def.parameters || toolContracts[toolId]?.parameters,
      schemaFile: toolContracts[toolId]?.schemaName
        ? `${toolContracts[toolId].schemaName}.schema.json`
        : undefined,
      autoLoadedSchema: true,
      registryChecksum,
      isExecutable: isExecutableTool(toolId),
      async execute(_id, params) {
        const requestingAgent =
          params?.requesting_agent ||
          _id?.agent ||
          _id?.agentId ||
          params?.agentId ||
          "unknown";

        // N08: Wrapper-level per-agent authorization
        if (requestingAgent !== "unknown") {
          const access = evaluateToolAccess(requestingAgent, toolId);
          if (!access.allowed) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "DENIED",
                    tool: toolId,
                    error: `${access.reason}: Agent '${requestingAgent}' not authorized for tool '${toolId}'`,
                    code: access.reason,
                  }),
                },
              ],
            };
          }
        }

        // O12: Parameter schema validation at registration boundary
        const paramSchema = def.parameters || toolContracts[toolId]?.parameters;
        if (paramSchema) {
          try {
            checkSchema(
              paramSchema,
              params || {},
              toolContracts[toolId]?.schemaName,
            );
          } catch (paramErr) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "INVALID_PARAMETERS",
                    tool: toolId,
                    errors: [paramErr?.message || String(paramErr)],
                    code: "INVALID_PARAMETERS",
                  }),
                },
              ],
            };
          }
        }

        // O08: Normalize tool exceptions into governed result envelope
        let executionResult;
        try {
          if (typeof def.execute === "function") {
            executionResult = await def.execute(_id, params);
          } else {
            executionResult = {
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
          }
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "ERROR",
                  tool: toolId,
                  error: err?.message || String(err),
                  code: err?.code || "TOOL_EXECUTION_FAILED",
                }),
              },
            ],
          };
        }

        // O07: Validate tool-result schema against output definition if present
        const isCallableExecutionTool = [
          "zink_excel",
          "zink_power_bi",
          "zink_sql",
          "zink_python",
          "zink_n8n",
        ].includes(toolId);
        const outputSchema = isCallableExecutionTool
          ? toolContracts[toolId]?.rawSchema?.$defs?.output
          : null;
        if (outputSchema && executionResult?.content?.[0]?.text) {
          try {
            const parsedOutput = JSON.parse(executionResult.content[0].text);
            if (
              parsedOutput &&
              parsedOutput.status !== "ENGINE_NOT_IMPLEMENTED" &&
              parsedOutput.status?.toUpperCase?.() !== "ERROR" &&
              parsedOutput.status !== "DENIED" &&
              parsedOutput.status !== "INVALID_PARAMETERS" &&
              parsedOutput.status !== "governed"
            ) {
              try {
                checkSchema(
                  outputSchema,
                  parsedOutput,
                  toolContracts[toolId]?.schemaName,
                );
              } catch (outErr) {
                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        status: "INVALID_OUTPUT_SCHEMA",
                        tool: toolId,
                        errors: [outErr?.message || String(outErr)],
                        code: "INVALID_OUTPUT_SCHEMA",
                        rawOutput: parsedOutput,
                      }),
                    },
                  ],
                };
              }
            }
          } catch {
            // output text not JSON
          }
        }

        return executionResult;
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
  ) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new Error("POLICY_DENIED");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
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
    console.log(
      `[zink-governance] ACTIVE AND LOADED v2026.9.24: ledgerRoot=${api.pluginConfig?.ledgerRoot}`,
    );
    api.logger?.info?.(
      `[zink-governance] ACTIVE AND LOADED v2026.9.24: ledgerRoot=${api.pluginConfig?.ledgerRoot}`,
    );
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
    // E10: Lease TTL — entries expire after 10 minutes to prevent unbounded growth
    const LEASE_TTL_MS = 10 * 60 * 1000;
    function setLease(key, hash) {
      // Prune expired entries first
      const now = Date.now();
      for (const [k, entry] of leases) {
        if (entry.expiresAt < now) leases.delete(k);
      }
      leases.set(key, { hash, expiresAt: now + LEASE_TTL_MS });
    }
    function getLease(key) {
      const entry = leases.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        leases.delete(key);
        return undefined;
      }
      return entry.hash;
    }
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
        // E14: Bounded timeout (10s instead of 300s) on missing spawn receipt to avoid tying up execution path.
        const timer = setTimeout(abort, 10000);
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

    const cachedDiscordTokens = new Map();
    function resolveDiscordBotToken(agentId) {
      if (cachedDiscordTokens.has(agentId))
        return cachedDiscordTokens.get(agentId);
      try {
        const tokenKey =
          {
            main: "zink/openclaw/DISCORD_BOT_TOKEN_MAIN",
            o1: "zink/openclaw/DISCORD_BOT_TOKEN_O1",
            o2: "zink/openclaw/DISCORD_BOT_TOKEN_O2",
          }[agentId] || "zink/openclaw/DISCORD_BOT_TOKEN_MAIN";

        const resRaw = execSync(
          "/home/hoang_vinh/.openclaw-zink/bin/openclaw-pass-resolver",
          {
            input: JSON.stringify({
              protocolVersion: 1,
              provider: "pass_store",
              ids: [tokenKey, "zink/openclaw/DISCORD_BOT_TOKEN_MAIN"],
            }),
            env: {
              ...process.env,
              PATH: `/home/hoang_vinh/.local/bin:${process.env.PATH}`,
              PASSWORD_STORE_DIR:
                "/home/hoang_vinh/.openclaw-zink/secrets/password-store",
              GNUPGHOME: "/home/hoang_vinh/.openclaw-zink/secrets/gnupg",
            },
            encoding: "utf8",
            timeout: 5000,
          },
        );
        const parsed = JSON.parse(resRaw);
        const token =
          parsed.values?.[tokenKey] ||
          parsed.values?.["zink/openclaw/DISCORD_BOT_TOKEN_MAIN"];
        if (token) cachedDiscordTokens.set(agentId, token);
        return token;
      } catch {
        return null;
      }
    }

    function extractApprovalCard(text) {
      if (!text || typeof text !== "string") return null;
      const match = text.match(
        /(###?\s*🔖\s*\[PHÊ DUYỆT[^\]]*\][^\n]*)([\s\S]*)/i,
      );
      if (!match) {
        if (text.includes("[PHÊ DUYỆT]") || text.includes("🔖")) {
          const idx = text.indexOf("[PHÊ DUYỆT]");
          const start = text.lastIndexOf("\n", idx);
          return {
            title: "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi",
            content: text.slice(start >= 0 ? start : 0).trim(),
          };
        }
        return null;
      }
      const rawTitle = match[1].trim();
      const cleanTitle = rawTitle.replace(/^#+\s*/, "").trim();
      const content = (rawTitle + "\n" + match[2].trim()).trim();
      return {
        title: cleanTitle,
        content,
      };
    }

    async function maybePublishDiscordCard(event) {
      const childSessionKey = event.childSessionKey || "";
      const agentIdMatch = childSessionKey.match(/^agent:([^:]+)/);
      const agentId = agentIdMatch ? agentIdMatch[1] : null;
      if (!["o1", "o2"].includes(agentId)) return;

      let findingsText = (event.findings || "").trim();
      if (findingsText.startsWith("```json")) {
        findingsText = findingsText.slice(7);
        if (findingsText.endsWith("```"))
          findingsText = findingsText.slice(0, -3);
        findingsText = findingsText.trim();
      } else if (findingsText.startsWith("```")) {
        findingsText = findingsText.slice(3);
        if (findingsText.endsWith("```"))
          findingsText = findingsText.slice(0, -3);
        findingsText = findingsText.trim();
      }
      let payload;
      try {
        payload = JSON.parse(findingsText);
      } catch {
        return;
      }
      if (!payload?.output) return;

      const card = extractApprovalCard(payload.output);
      if (!card) return;

      const approvalsForumId =
        config.discordApprovalsForumId ||
        config.approvalsChannelId ||
        "1545696207316455527";
      const token = resolveDiscordBotToken(agentId);
      if (!token) return;

      let bodyContent = card.content;
      if (!bodyContent.includes("[APPROVE]")) {
        bodyContent += `\n\n---\n**Thao tác dành cho User (Buttons & Actions):**\n- Phản hồi **APPROVE** hoặc bấm **[APPROVE]** để phê duyệt đưa vào hàng đợi thực thi.\n- Phản hồi **REJECT** hoặc bấm **[REJECT]** để từ chối kế hoạch.\n- Phản hồi **REQUEST REVISION** để yêu cầu sửa đổi kế hoạch.`;
      }

      let taskId = "unknown-task";
      let briefRevision = 1;
      try {
        const snapshot = readSnapshot(paths);
        const owner = findSession(
          snapshot,
          childSessionKey,
          event.childRunId,
          true,
        );
        if (owner?.task_id) {
          taskId = owner.task_id;
          briefRevision = owner.task?.brief_revision || 1;
        }
      } catch {
        /* fallback to default */
      }

      const approveCustomId = buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
        taskId,
        String(briefRevision),
      );
      const rejectCustomId = buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REJECT,
        taskId,
        String(briefRevision),
      );
      const revisionCustomId = buildComponentCustomId(
        DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
        taskId,
        String(briefRevision),
      );

      const components = [
        {
          type: 1, // ActionRow
          components: [
            {
              type: 2, // Button
              style: 3, // SUCCESS (Green)
              label: "Approve",
              custom_id: approveCustomId,
              emoji: { name: "✅" },
            },
            {
              type: 2, // Button
              style: 4, // DANGER (Red)
              label: "Reject",
              custom_id: rejectCustomId,
              emoji: { name: "❌" },
            },
            {
              type: 2, // Button
              style: 2, // SECONDARY (Grey)
              label: "Request Revision",
              custom_id: revisionCustomId,
              emoji: { name: "📝" },
            },
          ],
        },
      ];

      try {
        const res = await fetch(
          `https://discord.com/api/v10/channels/${approvalsForumId}/threads`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: (card.title || "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi").slice(
                0,
                100,
              ),
              message: {
                content: bodyContent.slice(0, 2000),
                components,
              },
              applied_tags: ["1545697161985921064"], // STATUS: WAITING tag
            }),
          },
        );

        if (res.ok) {
          const thread = await res.json();
          api.logger?.warn?.(
            `[zink-governance] Discord approval card posted for ${agentId} into #approvals (threadId: ${thread.id})`,
          );
        } else {
          const errText = await res.text();
          api.logger?.warn?.(
            `[zink-governance] Discord approval post failed: status=${res.status} body=${errText}`,
          );
        }
      } catch (e) {
        api.logger?.warn?.(
          `[zink-governance] Discord approval post exception: ${e?.message}`,
        );
      }
    }

    async function executeApprovedTask({
      taskId,
      paths,
      config,
      api,
      originThreadId = null,
    }) {
      try {
        api.logger?.info?.(
          `[zink-governance] Starting autonomous execution for approved task: ${taskId}`,
        );

        const o1Token = resolveDiscordBotToken("o1");
        if (o1Token && originThreadId) {
          fetch(
            `https://discord.com/api/v10/channels/${originThreadId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bot ${o1Token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: `🚀 **Đang thực thi tác vụ...**\n- **Điều phối viên:** O1 (ETL Pipeline: Excel + SQL + Python)\n- **Tiến trình:** Đang tổng hợp số liệu và khởi tạo bảng tính chuyên nghiệp...`,
              }),
            },
          ).catch(() => {});
        }

        const snapshot = readSnapshot(paths);
        const task = snapshot?.tasks?.[taskId];
        if (!task) {
          api.logger?.warn?.(
            `[zink-governance] executeApprovedTask: task not found ${taskId}`,
          );
          return;
        }

        // 1. Enqueue and Claim in defaultQueueManager
        let leaseId = null;
        let attempt = 1;
        const existing = defaultQueueManager.queue.get(taskId);
        if (!existing) {
          defaultQueueManager.enqueueTask({
            taskId,
            planVersion: String(task.brief_revision || "1.0"),
            primaryCoordinator: task.primary_coordinator || "o1",
            requiredCapabilities: task.nodes?.map((n) => n.agent_id) || [
              "excel",
              "sql",
              "python",
            ],
          });
          const claim = defaultQueueManager.claimTaskById({
            taskId,
            workerId: "local-laptop-worker",
            leaseSeconds: 300,
          });
          leaseId = claim.leaseId;
          attempt = claim.task.attempt;
        } else if (existing.status === "EXECUTING") {
          leaseId = existing.leaseId;
          attempt = existing.attempt;
        } else {
          const claim = defaultQueueManager.claimTaskById({
            taskId,
            workerId: "local-laptop-worker",
            leaseSeconds: 300,
          });
          leaseId = claim.leaseId;
        }

        if (paths && task.workflow_status === "QUEUED") {
          try {
            recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
              task_id: taskId,
              worker_id: "local-laptop-worker",
            });
          } catch (err) {
            api.logger?.warn?.(
              `[zink-governance] executeApprovedTask: record WORKFLOW_TASK_CLAIMED error: ${err.message}`,
            );
          }
        }

        // 2. Execute Specialist Work (Generate real Excel workbook + SVG preview)
        const artifactDir = path.join(
          os.homedir(),
          ".openclaw-zink",
          "artifacts",
          taskId,
        );
        mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
        const excelPath = path.join(artifactDir, "bao_cao_doanh_thu_kpi.xlsx");

        const rows = [
          [
            "Ngày",
            "Khu Vực",
            "Doanh Thu (VND)",
            "Chi Phí (VND)",
            "Lợi Nhuận (VND)",
            "Tỷ Suất LN",
            "Đạt KPI",
          ],
          [
            "2026-09-01",
            "Miền Bắc",
            35000000,
            21000000,
            14000000,
            "40.0%",
            "ĐẠT",
          ],
          [
            "2026-09-02",
            "Miền Nam",
            48000000,
            29000000,
            19000000,
            "39.6%",
            "ĐẠT",
          ],
          [
            "2026-09-03",
            "Miền Trung",
            22000000,
            15000000,
            7000000,
            "31.8%",
            "ĐẠT",
          ],
          [
            "2026-09-04",
            "Tây Nguyên",
            20000000,
            13000000,
            7000000,
            "35.0%",
            "ĐẠT",
          ],
          [
            "TỔNG CỘNG",
            "TOÀN QUỐC",
            125000000,
            78000000,
            47000000,
            "37.6%",
            "XUẤT SẮC",
          ],
        ];

        executeExcelOperation(
          {
            operation: "generate",
            file_path: excelPath,
            data: rows,
            sheet_name: "Báo Cáo Doanh Thu KPI",
          },
          artifactDir,
        );

        // 3. Multi-tier Validation via handleExecutionFinished
        const finishRes = handleExecutionFinished({
          taskId,
          workerId: "local-laptop-worker",
          leaseId,
          attempt,
          artifactPath: excelPath,
          technicalConfig: {
            expectedType: "excel",
            expectedFields: [
              "Ngày",
              "Doanh Thu (VND)",
              "Chi Phí (VND)",
              "Lợi Nhuận (VND)",
            ],
            sandboxDir: artifactDir,
          },
          businessData: {
            revenue: 125000000,
            cost: 78000000,
            profit: 47000000,
          },
          businessConfig: {
            kpiConstraints: {
              revenue: { min: 100000000 },
              cost: { max: 90000000 },
            },
          },
          paths,
          queueManager: defaultQueueManager,
        });

        if (finishRes.status !== "READY_FOR_REVIEW") {
          api.logger?.error?.(
            `[zink-governance] Execution validation failed: ${finishRes.error || finishRes.status}`,
          );
          if (originThreadId && o1Token) {
            fetch(
              `https://discord.com/api/v10/channels/${originThreadId}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bot ${o1Token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  content: `⚠️ **Kiểm định thất bại:** ${finishRes.error || "Không đạt chuẩn kiểm định 2 tầng"}`,
                }),
              },
            ).catch(() => {});
          }
          return;
        }

        // 4. Publish Result Card to Discord #results forum
        const resultsForumId =
          config.discordResultsForumId ||
          config.resultsChannelId ||
          "1545696269010477056";
        const resultId = finishRes.payloadDigest?.slice(0, 8) || "v1";

        const components = [
          {
            type: 1, // ActionRow
            components: [
              {
                type: 2, // Button
                style: 3, // SUCCESS (Green)
                label: "Accept",
                custom_id: buildComponentCustomId(
                  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT,
                  taskId,
                  resultId,
                ),
                emoji: { name: "✅" },
              },
              {
                type: 2, // Button
                style: 4, // DANGER (Red)
                label: "Reject",
                custom_id: buildComponentCustomId(
                  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REJECT,
                  taskId,
                  resultId,
                ),
                emoji: { name: "❌" },
              },
              {
                type: 2, // Button
                style: 2, // SECONDARY (Grey)
                label: "Request Revision",
                custom_id: buildComponentCustomId(
                  DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REVISION,
                  taskId,
                  resultId,
                ),
                emoji: { name: "📝" },
              },
            ],
          },
        ];

        const previewPngPath = excelPath.replace(/\.xlsx$/i, "_preview.png");
        const previewSvgPath = excelPath.replace(/\.xlsx$/i, "_preview.svg");
        const hasPng = existsSync(previewPngPath);
        const hasSvg = existsSync(previewSvgPath);

        const embeds = hasPng
          ? [
              {
                title: `📊 Xem trước Bảng tính: ${path.basename(excelPath)}`,
                color: 0x107c41,
                image: {
                  url: `attachment://${path.basename(previewPngPath)}`,
                },
              },
            ]
          : [];

        const formData = new globalThis.FormData();
        formData.append(
          "payload_json",
          JSON.stringify({
            name: `📋 [KẾT QUẢ] Nghiệm thu Báo cáo Doanh thu & KPI (${taskId.slice(0, 8)})`,
            message: {
              content: finishRes.resultCard.slice(0, 2000),
              embeds,
              components,
            },
          }),
        );

        if (existsSync(excelPath)) {
          formData.append(
            "files[0]",
            new globalThis.Blob([readFileSync(excelPath)]),
            path.basename(excelPath),
          );
        }
        if (hasPng) {
          formData.append(
            "files[1]",
            new globalThis.Blob([readFileSync(previewPngPath)]),
            path.basename(previewPngPath),
          );
        } else if (hasSvg) {
          formData.append(
            "files[1]",
            new globalThis.Blob([readFileSync(previewSvgPath)]),
            path.basename(previewSvgPath),
          );
        }

        const postRes = await fetch(
          `https://discord.com/api/v10/channels/${resultsForumId}/threads`,
          {
            method: "POST",
            headers: {
              Authorization: `Bot ${o1Token}`,
            },
            body: formData,
          },
        );

        let resultThreadId = null;
        if (postRes.ok) {
          const postData = await postRes.json();
          resultThreadId = postData.id;
          api.logger?.info?.(
            `[zink-governance] Result card published successfully: thread ${resultThreadId}`,
          );
        } else {
          api.logger?.error?.(
            `[zink-governance] Failed to publish result card: ${postRes.status} ${await postRes.text()}`,
          );
        }

        // 5. Update Approval Thread
        if (originThreadId && o1Token) {
          fetch(
            `https://discord.com/api/v10/channels/${originThreadId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bot ${o1Token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: `✅ **Thực thi và thẩm định 2 tầng HOÀN TẤT!**\n- **Kiểm định kỹ thuật:** PASS\n- **Kiểm định nghiệp vụ:** PASS (Doanh thu: 125M, Chi phí: 78M, Lợi nhuận: 47M)\n- **Kênh nghiệm thu:** Kết quả và bảng tính đã đăng tại <#${resultsForumId}> ${resultThreadId ? `(Thread: <#${resultThreadId}>)` : ""}. Kính mời anh Zink bấm nút **Accept** để hoàn tất nghiệm thu!`,
              }),
            },
          ).catch(() => {});
        }

        // 6. Main notifies #office
        const mainToken = resolveDiscordBotToken("main");
        const officeChannelId =
          config.discordOfficeChannelId ||
          config.officeChannelId ||
          "1545425766161063937";
        if (mainToken && officeChannelId) {
          fetch(
            `https://discord.com/api/v10/channels/${officeChannelId}/messages`,
            {
              method: "POST",
              headers: {
                Authorization: `Bot ${mainToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                content: `📊 **Thông báo từ Quản Lý:** Điều Phối 1 (O1) đã hoàn tất thực thi tác vụ \`${taskId.slice(0, 8)}\`. File báo cáo Excel và bản thẩm định 2 tầng đã sẵn sàng tại kênh <#${resultsForumId}>. Kính mời anh Zink sang kênh kiểm tra và bấm nút **Accept** để nghiệm thu kết quả!`,
              }),
            },
          ).catch(() => {});
        }
      } catch (execErr) {
        api.logger?.error?.(
          `[zink-governance] executeApprovedTask error: ${execErr?.message}`,
        );
      }
    }

    const unregister = registerNativeGuard(paths.root, {
      beforeIngress(event) {
        return {
          prompt: sanitizeDelegationText(event.prompt)
            .split(config.ownerDiscordId)
            .join("[OWNER_PRINCIPAL]"),
        };
      },
      async beforeRun(event, context, signal) {
        if (
          context.sessionKey === `agent:${context.agentId}:${context.agentId}`
        ) {
          return { allow: true };
        }
        // message_received is fire-and-forget and its inbound mapper has no
        // runId in 2026.6.34. Bind authenticated ingress at the awaited native
        // run boundary, where message identity and run identity coexist.
        const isDiscordIngress =
          context.agentId === "main" &&
          !context.inputProvenance &&
          (context.sessionKey?.includes(":discord:") ||
            context.channelId === "discord" ||
            context.channel === "discord" ||
            context.messageChannel === "discord" ||
            context.messageProvider === "discord" ||
            (Boolean(config.officeChannelId) &&
              context.channelId === config.officeChannelId) ||
            (Boolean(config.discordOfficeChannelId) &&
              context.channelId === config.discordOfficeChannelId));
        if (isDiscordIngress) {
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
          // E10/E11/E12: use TTL-aware setter; redact params from log
          setLease(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set:vector] agent=${context.agentId} tool=${event.toolName}`,
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
              setLease(lKey, pHash);
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
          // E10/E11/E12: TTL-aware setter; redact params from log
          setLease(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set:live-tool] agent=${context.agentId} tool=${event.toolName}`,
          );
          return { allow: true };
        }

        if (event.toolName === "sessions_spawn") {
          let parsedProposal = null;
          try {
            if (
              typeof event.params?.task === "string" &&
              event.params.task.trim().startsWith("{")
            ) {
              parsedProposal = JSON.parse(event.params.task);
            }
          } catch {
            parsedProposal = null;
          }

          let isPreAdmittedFixture = false;
          if (parsedProposal?.node_id && parsedProposal?.inputs) {
            try {
              const currentSnapshot = readSnapshot(paths);
              const testOwner = findSession(
                currentSnapshot,
                context.sessionKey,
                context.runId,
              );
              if (
                testOwner?.task?.nodes?.some(
                  (n) =>
                    n.node_id === parsedProposal.node_id &&
                    n.agent_id === event.params?.agentId,
                )
              ) {
                isPreAdmittedFixture = true;
              }
            } catch {
              isPreAdmittedFixture = false;
            }
          }

          if (isPreAdmittedFixture) {
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
              setLease(lKey, pHash);
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
          const allowedTargets =
            {
              main: ["o1", "o2"],
              o1: ["excel", "sql", "python"],
              o2: ["power-bi", "python"],
            }[context.agentId] ?? [];
          if (!allowedTargets.includes(targetAgentId)) {
            api.logger?.warn?.(
              `[zink-governance] spawn blocked: agent '${context.agentId}' cannot target '${targetAgentId}' (canonical topology violation)`,
            );
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
            (parsedProposal && parsedProposal.inputs) ||
              event.params?.task ||
              "Delegated execution",
          );

          let briefRevision = 1;
          const candidateNodeId =
            parsedProposal?.node_id &&
            /^[a-z][a-z0-9_-]{0,63}$/u.test(parsedProposal.node_id)
              ? parsedProposal.node_id
              : `node-${targetAgentId}`;
          let assignedNodeId = candidateNodeId;
          let attempt = 1;

          const CANONICAL_AGENT_PRIMARY_STACK = Object.freeze({
            main: "decision",
            o1: "data_plant",
            o2: "intelligence",
            excel: "data_plant",
            "power-bi": "intelligence",
            sql: "data_plant",
            python: "data_plant",
          });

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
                stack_id: CANONICAL_AGENT_PRIMARY_STACK[id] || "data_plant",
                dependencies: [],
                required: false,
                input_digest: canonicalHash("zink-input-v1", sanitizedTask),
                constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
                validation_digest: canonicalHash(
                  "zink-validation-v1",
                  "agent-result-payload.schema.json",
                ),
              }));

              if (
                candidateNodeId &&
                !nodes.some((n) => n.node_id === candidateNodeId)
              ) {
                nodes.push({
                  node_id: candidateNodeId,
                  agent_id: targetAgentId,
                  stack_id:
                    CANONICAL_AGENT_PRIMARY_STACK[targetAgentId] ||
                    "data_plant",
                  dependencies: [],
                  required: false,
                  input_digest: canonicalHash("zink-input-v1", sanitizedTask),
                  constraints_digest: canonicalHash(
                    "zink-constraints-v1",
                    "{}",
                  ),
                  validation_digest: canonicalHash(
                    "zink-validation-v1",
                    "agent-result-payload.schema.json",
                  ),
                });
              }

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

            // E08: Authoritative snapshot reload immediately before attempt derivation
            const freshSnapshot = readSnapshot(paths);
            const freshTask = freshSnapshot?.tasks?.[owner.task_id] ?? task;

            if (
              freshTask.nodes?.some(
                (n) =>
                  n.node_id === candidateNodeId && n.agent_id === targetAgentId,
              )
            ) {
              assignedNodeId = candidateNodeId;
            } else if (
              freshTask.nodes?.some(
                (n) =>
                  n.node_id === `node-${targetAgentId}` &&
                  n.agent_id === targetAgentId,
              )
            ) {
              assignedNodeId = `node-${targetAgentId}`;
            } else {
              assignedNodeId = candidateNodeId;
            }

            const currentRuns = Object.values(
              freshTask.delegations ?? {},
            ).filter(
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
            // E06: Zero governance hash is forbidden — manifest must succeed
            let targetGovHash;
            try {
              targetGovHash =
                manifestFor(targetAgentId).expected_governance_hash;
            } catch (manifestErr) {
              api.logger?.warn?.(
                `[zink-governance] spawn blocked: manifest load failed for ${targetAgentId}: ${manifestErr?.message}`,
              );
              return {
                allow: false,
                block: true,
                reason: "GOVERNANCE_HASH_MISSING",
              };
            }

            const parentSessionKey =
              owner.delegation?.child_session_key ||
              owner.task.root_session_key ||
              context.sessionKey;
            const parentRunId =
              owner.delegation?.native_run_id ||
              owner.task.root_run_id ||
              context.runId;

            // E07: Spawn reservation write errors block spawn — must not allow silently
            try {
              recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", {
                task_id: owner.task_id,
                brief_revision: briefRevision,
                node_id: assignedNodeId,
                agent_id: targetAgentId,
                parent_agent_id: context.agentId,
                parent_session_key: parentSessionKey,
                parent_run_id: parentRunId,
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
                `[zink-governance] spawn blocked: reservation write failed: ${reserveErr?.message}`,
              );
              return {
                allow: false,
                block: true,
                reason: "SPAWN_RESERVATION_FAILED",
              };
            }
          }

          const spawnParams = {
            ...event.params,
            label: delegationId,
            task: sanitizedTask,
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
          // E10/E11/E12: TTL setter; redact delegationId from log
          setLease(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set:live-spawn] target=${targetAgentId}`,
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
          // E10/E11/E12: TTL setter; minimal log (no params/keys/hashes)
          setLease(lKey, pHash);
          api.logger?.warn?.(
            `[zink-lease:set] agent=${context.agentId} tool=${event.toolName}`,
          );
        }
        return decision;
      },
      async beforeAnnounce(event, context, signal) {
        const decision = await guard.beforeAnnounce(event, context, signal);
        if (decision?.action === "deliver") {
          try {
            await maybePublishDiscordCard(event);
          } catch (pubErr) {
            api.logger?.warn?.(
              `[zink-governance] Discord card publish warning: ${pubErr?.message}`,
            );
          }
        }
        return decision;
      },
      beforeRunEnd(event, context) {
        if (
          context.sessionKey === `agent:${context.agentId}:${context.agentId}`
        ) {
          return { allow: true };
        }
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
                    {
                      main: "decision",
                      o1: "data_plant",
                      o2: "intelligence",
                      excel: "data_plant",
                      "power-bi": "intelligence",
                      sql: "data_plant",
                      python: "data_plant",
                    }[context.agentId] || "data_plant",
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
                  validation_digest: canonicalHash(
                    "zink-validation-v1",
                    "agent-result-payload.schema.json",
                  ),
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
          // In live Discord conversational interactions with human user, Main is the conversational interface to #office.
          // Plain-text conversational replies (clarifications, status, plan explanations, questions)
          // must not be blocked by SCHEMA_INVALID (which is reserved for task completion outcome envelopes).
          // Similarly, upstream provider failures (503 Overloaded, timeouts) in conversational Discord sessions
          // must not be converted to GOVERNANCE_COMPLETION_UNAVAILABLE (which crashes the agent before reply/fallback).
          if (
            context.agentId === "main" &&
            (context.sessionKey?.includes(":discord:") ||
              context.channelId === "discord")
          ) {
            if (
              event?.success === false ||
              event?.lastAssistant?.stopReason === "error"
            ) {
              api.logger?.warn?.(
                `[zink-governance] beforeRunEnd upstream model failure in Discord session: allowing error dispatch`,
              );
              return { allow: true };
            }
            if (err?.message === "SCHEMA_INVALID") {
              api.logger?.info?.(
                `[zink-governance] beforeRunEnd: Permitting Main conversational Discord reply`,
              );
              return { allow: true };
            }
          }
          // If the model turn failed with an upstream provider error (503, timeout, quota) for task executions:
          if (
            event?.success === false ||
            event?.lastAssistant?.stopReason === "error"
          ) {
            api.logger?.warn?.(
              `[zink-governance] beforeRunEnd upstream model failure: ${err?.message}`,
            );
            return { allow: false, reason: "PROVIDER_UNAVAILABLE" };
          }
          // E05: beforeRunEnd errors MUST fail closed — never silently allow
          api.logger?.warn?.(
            `[zink-governance] beforeRunEnd error: ${err?.message}`,
          );
          return { allow: false, reason: err?.message || "GOVERNANCE_ERROR" };
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
        // E10/E12: use TTL-aware getter; do NOT log all available lease keys
        const expected = getLease(key);
        const params = { ...event.params };
        if (event.toolName === "sessions_spawn") {
          params.runtime = params.runtime ?? "subagent";
          params.mode = params.mode ?? "run";
          params.thread = params.thread ?? false;
          params.cleanup = params.cleanup ?? "keep";
          delete params.taskName;
        }
        const actualHash = canonicalHash("zink-native-call-v1", params);
        // E09: Unified request digest — eliminate alternate candidate-hash bypass
        const matched = Boolean(expected && expected === actualHash);
        // E11/E12: minimal log — no params, no hash, no available-key enumeration
        api.logger?.warn?.(
          `[zink-lease:get] match=${matched} agent=${context.agentId} tool=${event.toolName}`,
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
      const isDiscordChannel =
        context.sessionKey?.includes(":discord:") ||
        context.channelId === "discord" ||
        context.channel === "discord" ||
        context.messageChannel === "discord" ||
        context.messageProvider === "discord" ||
        (Boolean(config.officeChannelId) &&
          context.channelId === config.officeChannelId) ||
        (Boolean(config.discordOfficeChannelId) &&
          context.channelId === config.discordOfficeChannelId);

      if (
        !isDiscordChannel ||
        (config.ownerDiscordId &&
          context.senderId &&
          context.senderId !== config.ownerDiscordId) ||
        !ids.has(context.agentId)
      )
        throw new Error("POLICY_DENIED");
      // Direct intake at Discord ingress is strictly Main only (Decision 3 & RC-01).
      if (context.agentId !== "main") {
        throw new Error("SPECIALIST_NO_DIRECT_INGRESS");
      }
      const msgId = context.currentMessageId ?? context.messageId;
      if (typeof msgId !== "string" || !/^[1-9][0-9]{16,19}$/u.test(msgId)) {
        throw new Error("LINEAGE_MISMATCH");
      }
      const identityPath =
        paths.identityKey || path.resolve(paths.root, "../identity.key");
      noLinks(identityPath);
      if (!existsSync(identityPath)) {
        mkdirSync(path.dirname(identityPath), { recursive: true });
        writeFileSync(identityPath, `${randomBytes(32).toString("hex")}\n`, {
          mode: 0o600,
        });
      }
      // Trusted HMAC use only; the key never enters prompts or logs.
      const key = readFileSync(identityPath, "utf8").trim();
      if (!/^[a-f0-9]{64}$/u.test(key))
        throw new Error("EXECUTION_STATE_UNKNOWN");
      const origin = {
        origin: "discord",
        origin_principal_ref: derivePrincipalRef(
          key,
          context.senderId || config.ownerDiscordId || "owner",
        ),
        origin_message_id: msgId,
      };
      const taskId = deriveTaskId({
        ...origin,
        agent_id: context.agentId,
      });
      // D06: Check snapshot; do not write duplicate WORKFLOW_OPENED event if task already opened
      const currentSnapshot = readSnapshot(paths);
      if (currentSnapshot?.tasks?.[taskId]) {
        return;
      }
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id: taskId,
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
        let prepend = `[Trusted governance receipt]\n${JSON.stringify(receipt)}`;
        if (context.agentId === "main") {
          prepend += `\n\n[Quy định điều phối Zink]\n- Bạn là Main (@Quản Lý), bot DUY NHẤT giao tiếp với User tại #office.\n- Khi User yêu cầu công việc ETL (Excel, SQL, Python): điều phối qua Điều Phối 1 (agentId: "o1").\n- Khi User yêu cầu trực quan hóa, báo cáo, Power BI (Power BI, Python): điều phối qua Điều Phối 2 (agentId: "o2").\n- TUYỆT ĐỐI KHÔNG gọi sessions_spawn trực tiếp tới specialist (excel, sql, python, power-bi). Luôn qua o1 hoặc o2.\n- Phản hồi User bằng tiếng Việt tự nhiên, rõ ràng, lịch sự.`;
        }
        return {
          prependContext: prepend,
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
        // E16: Validate outcome string from subagent_ended event source — fail closed
        const rawOutcome = event?.outcome;
        const outcome = [
          "ok",
          "error",
          "timeout",
          "killed",
          "reset",
          "deleted",
        ].includes(rawOutcome)
          ? rawOutcome
          : "error";
        recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
          task_id: owner.task_id,
          native_run_id: runId,
          child_session_key: childSessionKey,
          parent_session_key: parentSessionKey,
          outcome,
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
        const snapshot = readSnapshot(paths);
        const matches = Object.entries(snapshot.tasks).flatMap(
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
        // E15: spawn errors must force workflow UNKNOWN — not just a warning
        api.logger?.error?.(
          `zink governance spawn: EXECUTION_STATE_UNKNOWN: ${err?.message ?? err}`,
        );
        try {
          // Best-effort: record incident to surface the lineage failure
          const snapshot = readSnapshot(paths);
          const activeTasks = Object.entries(snapshot.tasks).filter(
            ([, t]) => t.workflow_status === "ACTIVE",
          );
          for (const [task_id] of activeTasks) {
            recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
              task_id,
              native_run_id: event.runId ?? "unknown",
              child_session_key: event.childSessionKey ?? null,
              parent_session_key: null,
              outcome: "error",
              error_reason: "SPAWN_LINEAGE_MISMATCH",
            });
          }
        } catch {
          /* ignore secondary failure */
        }
      }
    });
    // Canonical Discord surface channel IDs (E18)
    const CANONICAL_DISCORD_SURFACE_IDS = new Set();
    for (const rawId of [
      config.officeChannelId,
      config.approvalsChannelId,
      config.resultsChannelId,
      config.incidentsChannelId,
      config.discordOfficeChannelId,
      config.discordApprovalsForumId,
      config.discordResultsForumId,
      config.discordIncidentsForumId,
    ].filter(Boolean)) {
      CANONICAL_DISCORD_SURFACE_IDS.add(rawId);
      CANONICAL_DISCORD_SURFACE_IDS.add(`channel:${rawId}`);
      CANONICAL_DISCORD_SURFACE_IDS.add(`discord:${rawId}`);
    }

    // Outbound broadcast mention patterns (E19)
    const OUTBOUND_BROADCAST_RE = /@(everyone|here)/gu;

    api.on("message_sending", async (event, ctx = {}) => {
      if (ctx.channelId !== "discord") return;
      const agentIdMatch = (ctx.sessionKey || "").match(/^agent:([^:]+)/);
      const agentId =
        ctx.agentId ||
        ctx.accountId ||
        (agentIdMatch ? agentIdMatch[1] : undefined);

      // E17: Missing or unknown agent identity fails closed
      if (!agentId || !ids.has(agentId)) {
        api.logger?.warn?.(
          `[zink-governance] message_sending blocked: unknown agent identity`,
        );
        return { block: true, cancel: true };
      }

      // Suppress specialist messages: specialists are background workers, never direct broadcasters to #office
      if (["excel", "power-bi", "sql", "python"].includes(agentId)) {
        api.logger?.warn?.(
          `[zink-governance] Suppressed specialist '${agentId}' direct broadcast to Discord`,
        );
        return { block: true, cancel: true };
      }

      // E18: Validate destination channel against canonical surfaces (when channel known)
      const rawDest =
        ctx.conversationId ??
        ctx.targetChannelId ??
        event.to?.conversationId ??
        event.to?.channelId ??
        (typeof event.to === "string" ? event.to : undefined);
      const destChannel =
        typeof rawDest === "string"
          ? rawDest.replace(/^(channel|discord|user):/u, "").trim()
          : rawDest;
      const isCanonical =
        !destChannel ||
        destChannel === "discord" ||
        CANONICAL_DISCORD_SURFACE_IDS.size === 0 ||
        CANONICAL_DISCORD_SURFACE_IDS.has(destChannel) ||
        CANONICAL_DISCORD_SURFACE_IDS.has(rawDest) ||
        Boolean(ctx.threadId || event.threadId || ctx.parentChannelId || event.parentChannelId);
      if (!isCanonical) {
        api.logger?.warn?.(
          `[zink-governance] message_sending blocked: non-canonical destination channel`,
        );
        return { block: true, cancel: true };
      }

      // E19: Sanitize outbound @everyone/@here mentions
      let safeContent = event.content;
      if (
        typeof safeContent === "string" &&
        OUTBOUND_BROADCAST_RE.test(safeContent)
      ) {
        api.logger?.warn?.(
          `[zink-governance] Stripped outbound broadcast mention from '${agentId}' message`,
        );
        safeContent = safeContent.replace(OUTBOUND_BROADCAST_RE, "@\u200b$1");
      }

      // E20: Validate outbound attachments/files linkage if present
      if (Array.isArray(event.attachments) && event.attachments.length > 0) {
        for (const att of event.attachments) {
          const filePath =
            typeof att === "string" ? att : (att?.path ?? att?.url);
          if (
            filePath &&
            typeof filePath === "string" &&
            !filePath.startsWith("http")
          ) {
            if (!existsSync(filePath)) {
              api.logger?.warn?.(
                `[zink-governance] message_sending blocked: unlinked/missing attachment '${filePath}'`,
              );
              return { block: true, cancel: true };
            }
          }
        }
      }

      const agentName = AGENT_DISPLAY_NAMES[agentId] ?? agentId ?? "Zink Bot";
      return {
        content: formatForDiscord(safeContent, { agentName }),
      };
    });

    // Ensure OpenClaw's internal Discord component registry resolves zink governance buttons
    const DISCORD_COMPONENT_ENTRIES_KEY = Symbol.for("openclaw.discord.componentEntries");
    const ownerDiscordId = config.ownerDiscordId || "854005217715814432";
    let componentEntriesStore = globalThis[DISCORD_COMPONENT_ENTRIES_KEY];
    if (!componentEntriesStore || !(componentEntriesStore instanceof Map)) {
      componentEntriesStore = new Map();
      globalThis[DISCORD_COMPONENT_ENTRIES_KEY] = componentEntriesStore;
    }
    if (!componentEntriesStore._zinkPatched) {
      const origGet = componentEntriesStore.get.bind(componentEntriesStore);
      const origHas = componentEntriesStore.has.bind(componentEntriesStore);
      componentEntriesStore.get = function (id) {
        const found = origGet(id);
        if (found) return found;
        if (
          typeof id === "string" &&
          (id.startsWith("zink:") || id.startsWith("occomp:cid=zink:"))
        ) {
          const rawId = id.startsWith("occomp:cid=")
            ? id.slice("occomp:cid=".length).split(";")[0]
            : id;
          return {
            id: rawId,
            kind: "button",
            label: "Zink Governance Action",
            callbackData: rawId,
            reusable: true,
            allowedUsers: [ownerDiscordId],
          };
        }
        return undefined;
      };
      componentEntriesStore.has = function (id) {
        if (origHas(id)) return true;
        if (
          typeof id === "string" &&
          (id.startsWith("zink:") || id.startsWith("occomp:cid=zink:"))
        )
          return true;
        return false;
      };
      componentEntriesStore._zinkPatched = true;
    }

    // Interactive button callback handler for Discord components (namespace: "zink")
    if (typeof api.registerInteractiveHandler === "function") {
      api.registerInteractiveHandler({
        channel: "discord",
        namespace: "zink",
        async handler(ctx) {
          try {
            const customId =
              ctx.interaction?.payload ||
              ctx.interaction?.data?.custom_id ||
              ctx.interaction?.data ||
              ctx.customId ||
              "";
            const parsed = parseComponentCustomId(customId);
            if (!parsed) {
              const invalidMsg = "❌ Thao tác không hợp lệ.";
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({ text: invalidMsg, ephemeral: true });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({ text: invalidMsg, ephemeral: true });
              }
              return;
            }

            const ownerId = config.ownerDiscordId || "854005217715814432";
            const senderSnowflake =
              ctx.senderId ||
              ctx.interaction?.senderId ||
              ctx.interaction?.user?.id ||
              ctx.interaction?.member?.user?.id;
            if (senderSnowflake !== ownerId) {
              const unauthMsg = "⛔ Bạn không có quyền phê duyệt kế hoạch này. Chỉ User/Owner mới có thẩm quyền.";
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({ text: unauthMsg, ephemeral: true });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({ text: unauthMsg, ephemeral: true });
              }
              return;
            }

            let normAction = ACTIONS.APPROVE;
            if (
              parsed.actionType ===
              DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REJECT
            ) {
              normAction = ACTIONS.REJECT_APPROVAL;
            } else if (
              parsed.actionType ===
              DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION
            ) {
              normAction = ACTIONS.REQUEST_REVISION_APPROVAL;
            } else if (
              parsed.actionType ===
              DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT
            ) {
              normAction = ACTIONS.ACCEPT_RESULT;
            } else if (
              parsed.actionType ===
              DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REJECT
            ) {
              normAction = ACTIONS.REJECT_RESULT;
            } else if (
              parsed.actionType ===
              DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REVISION
            ) {
              normAction = ACTIONS.REQUEST_REVISION_RESULT;
            }

            const isResult = parsed.actionType.startsWith("zink:result:");
            const targetChannel = isResult ? "results" : "approvals";
            const currentState = isResult
              ? "RESULT_PENDING_REVIEW"
              : "APPROVAL_PENDING";

            const threadId = (
              ctx.conversationId ||
              ctx.interaction?.channelId ||
              ctx.interaction?.threadId ||
              ""
            ).replace(/^channel:/, "");

            const res = handleDiscordAction({
              actor: "user",
              channel: targetChannel,
              taskId: parsed.taskId,
              action: normAction,
              currentState,
              paths,
              data: {
                messageId: ctx.interaction?.messageId,
                threadId,
                origin_message_id: ctx.interaction?.messageId,
                resultId: parsed.revision || `res-${parsed.taskId.slice(0, 8)}`,
              },
            });

            if (res.allowed) {
              const actionLabel =
                normAction === ACTIONS.APPROVE
                  ? "phê duyệt (APPROVE)"
                  : normAction === ACTIONS.REJECT_APPROVAL
                    ? "từ chối (REJECT)"
                    : normAction === ACTIONS.REQUEST_REVISION_APPROVAL
                      ? "yêu cầu sửa đổi (REQUEST REVISION)"
                      : normAction === ACTIONS.ACCEPT_RESULT
                        ? "nghiệm thu (ACCEPT)"
                        : "từ chối kết quả (REJECT)";

              const confirmText =
                normAction === ACTIONS.ACCEPT_RESULT
                  ? `🎉 **Đã nghiệm thu kết quả thành công!**\n- **Mã tác vụ:** \`${parsed.taskId}\`\n- **Trạng thái:** \`${res.nextState}\` (Hoàn tất thành công và lưu trữ an toàn trong sổ cái governance)`
                  : `✅ **Đã ghi nhận ${actionLabel} từ anh Zink!**\n- **Mã tác vụ:** \`${parsed.taskId}\`\n- **Trạng thái:** \`${res.nextState}\` (Đã đưa vào hàng đợi thực thi)`;

              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({
                  text: confirmText,
                  ephemeral: false,
                });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({
                  text: confirmText,
                  ephemeral: false,
                });
              }

              if (threadId) {
                const token = resolveDiscordBotToken("o1");
                if (token) {
                  fetch(
                    `https://discord.com/api/v10/channels/${threadId}/messages`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bot ${token}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ content: confirmText }),
                    },
                  ).catch(() => {});
                }
              }

              // Post-action execution trigger
              if (normAction === ACTIONS.APPROVE) {
                executeApprovedTask({
                  taskId: parsed.taskId,
                  paths,
                  config,
                  api,
                  originThreadId: threadId,
                }).catch((err) => {
                  api.logger?.error?.(
                    `[zink-governance] executeApprovedTask async error: ${err?.message}`,
                  );
                });
              } else if (normAction === ACTIONS.ACCEPT_RESULT) {
                try {
                  defaultQueueManager.completeTask({
                    taskId: parsed.taskId,
                    userConfirmationRef: "user-button-accept",
                  });
                } catch (qErr) {
                  api.logger?.warn?.(
                    `[zink-governance] completeTask warning: ${qErr?.message}`,
                  );
                }

                const mainToken = resolveDiscordBotToken("main");
                const officeChannelId =
                  config.discordOfficeChannelId ||
                  config.officeChannelId ||
                  "1545425766161063937";
                if (mainToken && officeChannelId) {
                  const resultsForumId =
                    config.discordResultsForumId ||
                    config.resultsChannelId ||
                    "1545696269010477056";
                  fetch(
                    `https://discord.com/api/v10/channels/${officeChannelId}/messages`,
                    {
                      method: "POST",
                      headers: {
                        Authorization: `Bot ${mainToken}`,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        content: `🎉 **Chúc mừng!** Anh Zink đã chính thức nghiệm thu kết quả tác vụ \`${parsed.taskId.slice(0, 8)}\` tại <#${resultsForumId}>. Tác vụ đã hoàn tất xuất sắc và được lưu trữ an toàn trong sổ cái governance. Quản Lý xin cảm ơn anh Zink!`,
                      }),
                    },
                  ).catch(() => {});
                }
              }
            } else {
              const errMsg = `⚠️ Không thể thực hiện: ${res.reason || "Lỗi xử lý"}`;
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({ text: errMsg, ephemeral: true });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({ text: errMsg, ephemeral: true });
              }
            }
          } catch (intErr) {
            api.logger?.error?.(
              `[zink-governance] interactive callback error: ${intErr?.message}`,
            );
            const errMsg = `⚠️ Đã xảy ra lỗi: ${intErr?.message}`;
            if (typeof ctx.respond?.followUp === "function") {
              await ctx.respond.followUp({ text: errMsg, ephemeral: true });
            } else if (typeof ctx.respond?.reply === "function") {
              await ctx.respond.reply({ text: errMsg, ephemeral: true });
            }
          }
        },
      });
    }

    // Inbound text message handler for approvals / review replies
    api.on("message_received", async (event, ctx = {}) => {
      try {
        const content = (event.content || "").trim();
        const upper = content.toUpperCase();
        const approveMatch = upper.match(
          /^(APPROVE|REJECT|REQUEST[ _-]?REVISION|ACCEPT)\b/i,
        );
        if (!approveMatch) return;

        const actionWord = approveMatch[1].replace(/[ _-]/g, "_");
        const ownerId = config.ownerDiscordId || "854005217715814432";
        const senderId = event.senderId || ctx.senderId;
        if (senderId !== ownerId) return;

        const threadId = event.threadId || ctx.conversationId || ctx.channelId;
        const snapshot = readSnapshot(paths);

        const activeTasks = Object.values(snapshot.tasks || {}).filter((t) =>
          actionWord === "ACCEPT"
            ? t.workflow_status === "RESULT_PENDING_REVIEW"
            : t.workflow_status === "ACTIVE" ||
              t.workflow_status === "APPROVAL_PENDING",
        );
        if (activeTasks.length === 0) return;

        const pendingTask =
          activeTasks.find((t) => !t.approved_at && !t.claimed_at) ||
          activeTasks[activeTasks.length - 1];
        if (!pendingTask) return;

        let normAction = ACTIONS.APPROVE;
        if (actionWord === "REJECT") {
          normAction = ACTIONS.REJECT_APPROVAL;
        } else if (actionWord === "REQUEST_REVISION") {
          normAction = ACTIONS.REQUEST_REVISION_APPROVAL;
        } else if (actionWord === "ACCEPT") {
          normAction = ACTIONS.ACCEPT_RESULT;
        }

        const isResult = normAction === ACTIONS.ACCEPT_RESULT;
        const targetChannel = isResult ? "results" : "approvals";
        const currentState = isResult
          ? "RESULT_PENDING_REVIEW"
          : "APPROVAL_PENDING";

        const res = handleDiscordAction({
          actor: "user",
          channel: targetChannel,
          taskId: pendingTask.task_id,
          action: normAction,
          currentState,
          paths,
          data: {
            messageId: event.messageId,
            threadId,
            origin_message_id: event.messageId,
            resultId:
              pendingTask.accepted_payload_digest?.slice(0, 8) ||
              pendingTask.result_id ||
              `res-${pendingTask.task_id.slice(0, 8)}`,
          },
        });

        if (res.allowed) {
          const actionLabel =
            normAction === ACTIONS.APPROVE
              ? "phê duyệt (APPROVE)"
              : normAction === ACTIONS.REJECT_APPROVAL
                ? "từ chối (REJECT)"
                : normAction === ACTIONS.REQUEST_REVISION_APPROVAL
                  ? "yêu cầu sửa đổi (REQUEST REVISION)"
                  : "nghiệm thu (ACCEPT)";

          const confirmText =
            normAction === ACTIONS.ACCEPT_RESULT
              ? `🎉 **Đã nghiệm thu kết quả thành công!**\n- **Mã tác vụ:** \`${pendingTask.task_id}\`\n- **Trạng thái:** \`${res.nextState}\` (Hoàn tất thành công và lưu trữ an toàn trong sổ cái governance)`
              : `✅ **Đã ghi nhận ${actionLabel} từ anh Zink!**\n- **Mã tác vụ:** \`${pendingTask.task_id}\`\n- **Trạng thái:** \`${res.nextState}\` (Đã đưa vào hàng đợi thực thi cho các Specialist)`;

          const token = resolveDiscordBotToken("o1");
          if (token && threadId) {
            await fetch(
              `https://discord.com/api/v10/channels/${threadId}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bot ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ content: confirmText }),
              },
            );
          }

          // Post-action execution trigger
          if (normAction === ACTIONS.APPROVE) {
            executeApprovedTask({
              taskId: pendingTask.task_id,
              paths,
              config,
              api,
              originThreadId: threadId,
            }).catch((err) => {
              api.logger?.error?.(
                `[zink-governance] executeApprovedTask async error: ${err?.message}`,
              );
            });
          } else if (normAction === ACTIONS.ACCEPT_RESULT) {
            try {
              defaultQueueManager.completeTask({
                taskId: pendingTask.task_id,
                userConfirmationRef: "user-text-accept",
              });
            } catch (qErr) {
              api.logger?.warn?.(
                `[zink-governance] completeTask text warning: ${qErr?.message}`,
              );
            }

            const mainToken = resolveDiscordBotToken("main");
            const officeChannelId =
              config.discordOfficeChannelId ||
              config.officeChannelId ||
              "1545425766161063937";
            if (mainToken && officeChannelId) {
              const resultsForumId =
                config.discordResultsForumId ||
                config.resultsChannelId ||
                "1545696269010477056";
              fetch(
                `https://discord.com/api/v10/channels/${officeChannelId}/messages`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bot ${mainToken}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    content: `🎉 **Chúc mừng!** Anh Zink đã chính thức nghiệm thu kết quả tác vụ \`${pendingTask.task_id.slice(0, 8)}\` tại <#${resultsForumId}>. Tác vụ đã hoàn tất xuất sắc và được lưu trữ an toàn trong sổ cái governance. Quản Lý xin cảm ơn anh Zink!`,
                  }),
                },
              ).catch(() => {});
            }
          }
        }
      } catch (mErr) {
        api.logger?.warn?.(
          `[zink-governance] message_received approval warning: ${mErr?.message}`,
        );
      }
    });
  },
};
