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
import {
  createGovernanceGuard,
  resolveN8nInvocation,
  bindInvocationApproval,
  whenGovernanceDependenciesReady,
} from "../../topology/lib/guard.mjs";
import {
  checkSchema,
  loadContractSchema,
  generateSchemaManifest,
  verifySchemaManifestChecksums,
  validateContract,
} from "../../topology/lib/schema.mjs";
import {
  TOOL_POLICY,
  BUILT_IN_TOOL_POLICY,
  MEMORY_TOOL_POLICY,
  ZINK_MEMORY_TOOL_REGISTRY,
  effectiveMemoryTools,
  canAccessMemoryTool,
  evaluateCapabilityAccess,
  GOVERNED_SKILL_NAMESPACE_CATALOG,
  AGENT_SPAWN_POLICY,
} from "../../lib/policy.mjs";
import { sanitizeDelegationText } from "../../topology/lib/runtime.mjs";
import {
  registerNativeGuard,
  recordNativeQuota,
  selfNativeQuota,
  resolveNativeRunModel,
} from "../../topology/lib/native-boundary.mjs";
import {
  BUDGETS,
  readSnapshot,
  recordWorkflowEvent,
} from "../../topology/lib/ledger.mjs";
import {
  findSession,
  resolveCurrentRunOwner,
} from "../../topology/lib/workflow.mjs";
import {
  canonicalHash,
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
  buildComponentCustomId,
  parseComponentCustomId,
  DISCORD_COMPONENT_ACTION_NAMESPACE,
  resolveIngressRouting,
} from "../../lib/authority.mjs";

import { QueueManager, defaultQueueManager } from "../../lib/queue-manager.mjs";

import {
  buildNativeComponentPayload,
  sendNativePayload,
} from "../../lib/discord-native-send.mjs";

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
let duckDbBridgeModule = null;

function resolveDefaultOllamaUrl() {
  const configured = process.env.OLLAMA_URL?.trim();
  return configured || null;
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
      } catch {
        console.error(
          "[zink-governance] Failed to import skill adapter: ADAPTER_UNAVAILABLE",
        );
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
      } catch {
        console.error(
          "[zink-governance] Failed to import knowledge adapter: ADAPTER_UNAVAILABLE",
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

// M7-018: Discord ingress requires a verified sender identity before owner
// authorization. A missing sender never passes as the owner; bot senders
// never pass at all.
export function isIngressSenderAuthorized(context, ownerDiscordId) {
  if (typeof context?.senderId !== "string" || !context.senderId) {
    return { ok: false, reason: "POLICY_DENIED" };
  }
  if (context.isBot === true || context.author?.bot === true) {
    return { ok: false, reason: "BOT_INGRESS_DENIED" };
  }
  // An absent owner identity is a DENY, never an implicit allow. The previous
  // `ownerDiscordId && ...` guard skipped the comparison entirely when the owner
  // was unset, so any non-bot sender was admitted — the opposite default from
  // the sibling authority helper `isAllowedDiscordSender`, which denies when the
  // owner is unknown.
  if (
    typeof ownerDiscordId !== "string" ||
    !ownerDiscordId ||
    context.senderId !== ownerDiscordId
  ) {
    return { ok: false, reason: "POLICY_DENIED" };
  }
  return { ok: true };
}

// M8-061: caller identity always derives from trusted runtime context.
// Tool payload may carry business metadata, never authority identity.
export function deriveTrustedRequester(_id) {
  return _id?.agent ?? _id?.agentId ?? "unknown";
}

// M7-071/M8-062: missing-backend envelope — explicit unavailable/blocked,
// never a governed-looking success; no internal paths or exception content.
export function adapterUnavailableResponse(tool, error) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          status: "UNAVAILABLE",
          tool,
          error,
          code: error,
          blocked: true,
        }),
      },
    ],
  };
}
// M7-005/M7-007: the live tool path calls the canonical validators through
// these cached loaders — never a second local SQL/path policy. An
// unavailable validator fails closed as GOVERNANCE_DEPENDENCY_MISSING.
let sqlValidatorModule = null;
let pathSafetyModule = null;

async function loadRepoModule(relativePath) {
  const attempts = [];
  try {
    const root = findRepoRoot();
    if (root) attempts.push(pathToFileURL(path.join(root, relativePath)).href);
  } catch {
    /* ignore */
  }
  attempts.push(
    new URL(`../../../../${relativePath}`, import.meta.url).href,
    pathToFileURL(path.resolve(process.cwd(), relativePath)).href,
  );
  for (const href of attempts) {
    try {
      return await import(href);
    } catch {
      /* next candidate */
    }
  }
  return null;
}

export async function validateLiveSqlQuery(query, parameters) {
  if (!sqlValidatorModule) {
    sqlValidatorModule = await loadRepoModule("zink-tools/sql/validator.mjs");
  }
  const validate = sqlValidatorModule?.validateSqlQuery;
  if (typeof validate !== "function") {
    return { ok: false, reason: "GOVERNANCE_DEPENDENCY_MISSING" };
  }
  try {
    validate(query, parameters);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || "SQL_VALIDATION_FAILED" };
  }
}

export async function validateLiveArtifactPath(logicalPath) {
  if (!pathSafetyModule) {
    pathSafetyModule = await loadRepoModule(
      "zink-tools/common/path-safety.mjs",
    );
  }
  const validate = pathSafetyModule?.validateArtifactLogicalPath;
  if (typeof validate !== "function") {
    return { ok: false, reason: "GOVERNANCE_DEPENDENCY_MISSING" };
  }
  try {
    validate(logicalPath);
    return { ok: true };
  } catch {
    return { ok: false, reason: "POLICY_DENIED" };
  }
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

async function getDuckDbBridge() {
  if (!duckDbBridgeModule) {
    const root = findRepoRoot();
    if (root) {
      try {
        const p = path.join(root, "zink-tools/sql/duckdb-bridge.mjs");
        duckDbBridgeModule = await import(pathToFileURL(p).href);
      } catch (err) {
        console.error("[zink-governance] Failed to import DuckDB bridge:", err);
      }
    }
    if (!duckDbBridgeModule) {
      try {
        duckDbBridgeModule = await import(
          new URL(
            "../../../../zink-tools/sql/duckdb-bridge.mjs",
            import.meta.url,
          ).href
        );
      } catch {
        try {
          duckDbBridgeModule = await import(
            path.resolve(process.cwd(), "zink-tools/sql/duckdb-bridge.mjs")
          );
        } catch {
          // Module not accessible in isolated test directory
        }
      }
    }
  }
  return duckDbBridgeModule;
}

export async function handleOwnerSkillApproval({
  ownerDiscordId,
  proposalId,
  contentSha256,
  skillsRoot,
  // No default, deliberately. A hardcoded default would place a real account
  // identifier in production source — forbidden outside `tests/` by this
  // repository's own `.gitleaks.toml` — and, worse, would keep authorizing that
  // account whenever a caller forgot to bind the expected principal. The
  // parameter is required so the exact-identity binding is always explicit, and
  // an omitted value fails the comparison below and denies the approval.
  expectedOwnerId,
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
  // M7-041: the authoritative task is resolved up front and is never taken
  // from caller-supplied data, so every governed event below is bound to the
  // real owning run.
  let authoritativeTask = null;
  // The digest a user verdict must be bound to: whatever the ledger recorded for
  // the result now pending review.
  let authoritativeResultDigest = null;
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
      authoritativeTask = snapshot?.tasks?.[taskId];
      // The digest a user verdict must be bound to: whatever the ledger
      // recorded for the result now pending review.
      authoritativeResultDigest =
        authoritativeTask?.root_result?.payload_digest ??
        authoritativeTask?.execution_payload_digest ??
        null;
      if (authoritativeTask) {
        let status = authoritativeTask.workflow_status;
        // R6: APPROVAL_PENDING is derived from a RECORDED approval request, not
        // inferred from an open task. WORKFLOW_OPENED sets workflow_status to
        // ACTIVE, so the previous `ACTIVE && !approved_at && !claimed_at`
        // inference relabelled every freshly opened task as approval-pending and
        // let the owner approve a request that was never surfaced. Only
        // WORKFLOW_APPROVAL_REQUESTED may create an approval opportunity.
        if (
          status === "ACTIVE" &&
          authoritativeTask.approval_requested_at &&
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
  // Bounds are enforced in UTF-8 BYTES by the canonical contract validator
  // (schema.mjs uses Buffer.byteLength for maxLength), so a character-count
  // slice can produce a value the contract rejects — which failed the write and
  // wedged the task in WAITING_FOR_USER. Truncation is therefore byte-budgeted
  // and never splits a character. This repo's user-facing language is
  // Vietnamese (2 bytes/char) with CJK and emoji also expected, so a character
  // slice was never sufficient.
  const safeFeedback = data.feedback
    ? truncateUtf8(String(data.feedback), 2000)
    : "Revision requested";
  const safeQuestion = data.question
    ? truncateUtf8(String(data.question), 2000)
    : "Clarification needed";
  const safeAnswer = data.answer
    ? truncateUtf8(String(data.answer), 4000)
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
          // The verdict binds to the digest the LEDGER recorded. A component
          // carrying its own digest is bound to that instead, so a card issued
          // for an earlier result is refused rather than applied to whatever is
          // pending now. The previous `?? null` made every verdict fail the
          // binding, leaving the task stuck in RESULT_PENDING_REVIEW.
          result_digest: data.resultDigest ?? authoritativeResultDigest,
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
          result_digest: data.resultDigest ?? authoritativeResultDigest,
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
          result_digest: data.resultDigest ?? authoritativeResultDigest,
        });
      } else if (normAction === ACTIONS.ASK_USER) {
        // M7-017: governed pre-clarification lookup. A prior decision for
        // this exact question suppresses the duplicate clarification. The
        // store resolves from the configured authority root (M7-021
        // direction); a corrupt store fails closed instead of re-asking.
        const questionTopic = data.topic ?? "CLARIFICATION";
        const questionScope = data.scope ?? "global";
        const questionTaskId =
          questionScope === "task-specific" ? (data.taskId ?? taskId) : null;
        let decisionStore = null;
        try {
          decisionStore = paths?.root
            ? new DecisionLedger({
                storagePath: path.join(paths.root, "decision-ledger.json"),
              })
            : defaultDecisionLedger;
        } catch (storeErr) {
          return {
            allowed: false,
            reason: `LEDGER_CORRUPT: decision store unavailable (${storeErr?.message ?? storeErr})`,
            status: "BLOCKED",
          };
        }
        let prior = null;
        try {
          prior = decisionStore.lookupDecision({
            topic: questionTopic,
            question: safeQuestion,
            scope: questionScope,
            taskId: questionTaskId,
            domain: data.domain ?? null,
          });
        } catch (lookupErr) {
          return {
            allowed: false,
            reason: `LEDGER_CORRUPT: prior-decision lookup blocked (${lookupErr?.message ?? lookupErr})`,
            status: "BLOCKED",
          };
        }
        if (prior) {
          return {
            allowed: true,
            status: "DECIDED",
            nextState: effectiveCurrentState,
            priorDecision: prior,
          };
        }
        // M7-041: the governing run is resolved from the authoritative
        // snapshot, never from caller-supplied data, and the reducer
        // re-derives the same canonical owner.
        if (!authoritativeTask) {
          return {
            allowed: false,
            reason:
              "EXECUTION_STATE_UNKNOWN: ASK_USER requires the authoritative task to resolve the governing run",
            status: "BLOCKED",
          };
        }
        const governedRun = resolveCurrentRunOwner(authoritativeTask);
        recordWorkflowEvent(paths, "WORKFLOW_USER_QUESTION_RECORDED", {
          task_id: taskId,
          agent_id: governedRun.agent_id,
          question: safeQuestion,
          session_key: governedRun.session_key,
          run_id: governedRun.run_id,
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
        // M7-042: the answer is recorded as a USER act with an explicit
        // principal and message id. The reducer requires both, so a caller
        // cannot attribute an answer to an agent or an unidentifiable author.
        const answerPrincipal = derivePrincipalRef(
          "identity-key",
          String(userPrincipal),
        );
        const answerMessageId =
          data.messageId ?? data.origin_message_id ?? null;
        if (
          typeof answerMessageId !== "string" ||
          !/^[1-9][0-9]{16,19}$/u.test(answerMessageId)
        ) {
          return {
            allowed: false,
            reason:
              "MISSING_USER_MESSAGE_ID: ANSWER_USER requires a source message id to bind the answering turn",
            status: "DENIED",
          };
        }
        recordWorkflowEvent(paths, "WORKFLOW_USER_ANSWER_RECORDED", {
          task_id: taskId,
          answer: safeAnswer,
          actor: "user",
          user_principal_ref: answerPrincipal,
          message_id: answerMessageId,
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
  agentId,
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

  // G14: Execution-agent lease/attempt validation against active claims
  if (queueManager?.activeClaims?.has(taskId)) {
    const claim = queueManager.activeClaims.get(taskId);
    if (agentId && claim.agentId !== agentId) {
      return {
        status: "FAILED",
        error: `AGENT_MISMATCH: Task claimed by ${claim.agentId}, not ${agentId}`,
      };
    }
    if (leaseId && claim.leaseId !== leaseId) {
      return {
        status: "FAILED",
        error:
          "LEASE_MISMATCH: Execution-agent lease does not match active claim",
      };
    }
    if (attempt !== null && claim.attempt !== attempt) {
      return {
        status: "FAILED",
        error: "ATTEMPT_MISMATCH: Attempt does not match active claim",
      };
    }
  }

  // M8-051: the canonical artifact set is ordered and bounded, and every
  // member is validated BEFORE any validation verdict is produced. A
  // singular artifactPath may not stand in for a delivered multi-artifact
  // result, and an unreadable member is a hard delivery failure rather than
  // a technical-validation verdict.
  const artifactSet = [];
  for (const candidate of allArtifacts) {
    const logicalPath =
      typeof candidate === "string"
        ? candidate
        : (candidate?.logical_path ?? null);
    if (typeof logicalPath !== "string" || !logicalPath.trim()) {
      return {
        status: "FAILED",
        error: "ARTIFACT_INVALID: Result set contains an unreadable artifact",
      };
    }
    if (!existsSync(logicalPath)) {
      return {
        status: "FAILED",
        error: `ARTIFACT_MISSING: ${path.basename(logicalPath)}`,
      };
    }
    let sha256;
    try {
      sha256 = createHash("sha256")
        .update(readFileSync(logicalPath))
        .digest("hex");
    } catch {
      return {
        status: "FAILED",
        error: `ARTIFACT_UNREADABLE: ${path.basename(logicalPath)}`,
      };
    }
    artifactSet.push({ logical_path: logicalPath, sha256 });
  }

  // One digest over the whole ordered set. Ordering is authoritative, so a
  // reordered list yields a different canonical digest.
  const artifactSetDigest =
    artifactSet.length > 0
      ? canonicalHash("zink-artifact-set-v1", { artifacts: artifactSet })
      : null;
  const payloadDigest =
    artifactSetDigest ??
    (artifactPath && existsSync(artifactPath)
      ? createHash("sha256").update(readFileSync(artifactPath)).digest("hex")
      : null);

  // M8-053: durable replay fence. The queue projection is restart-durable, so
  // an exact replay of the same task + attempt + result digest is an
  // idempotent no-op rather than a second execution.
  const fenceKey = `${taskId}\u0000${attempt ?? 1}\u0000${payloadDigest ?? "none"}`;
  if (payloadDigest) {
    const alreadyFinished = queueManager.getTask?.(taskId);
    if (
      alreadyFinished &&
      alreadyFinished.status === TASK_STATES.RESULT_PENDING_REVIEW &&
      alreadyFinished.resultAttempt === (attempt ?? 1) &&
      alreadyFinished.resultDigest === payloadDigest
    ) {
      return {
        status: "ALREADY_COMPLETED",
        idempotencyKey: fenceKey,
        payloadDigest,
        artifactSetDigest,
      };
    }
  }

  const effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null;
  const gateResult = evaluateResultGate({
    artifactPath: artifactPath ?? artifactSet[0]?.logical_path,
    artifactSet: artifactSet.map((artifact) => artifact.logical_path),
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

  // G13: Propagate queue finish errors instead of swallowing
  try {
    queueManager.finishExecution({
      taskId,
      agentId,
      leaseId,
      attempt,
      artifacts: artifactSet.map((artifact) => artifact.logical_path),
      artifactSet,
      artifactSetDigest,
      resultDigest: payloadDigest,
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
        agent_id: agentId,
        attempt: attempt ?? 1,
        payload_digest: payloadDigest,
        technical_status: gateResult.technical?.status || "PASS",
        business_status: gateResult.business?.status || "PASS",
        artifact_path: artifactPath ? path.basename(artifactPath) : null,
        artifacts: artifactSet.length > 0 ? artifactSet : null,
        artifact_set_digest: artifactSetDigest,
        recorded_at: new Date().toISOString(),
      });
    } catch (err) {
      // M8-052: the queue already moved to RESULT_PENDING_REVIEW. Reconcile
      // the projection back to the authoritative ledger so the two can never
      // disagree silently; the caller retries from the authoritative state.
      let reconciled;
      try {
        reconciled = queueManager.rebuildFromLedger(readSnapshot(paths));
      } catch (reconcileErr) {
        return {
          status: "BLOCKED",
          error: `QUEUE_LEDGER_RECONCILIATION_FAILED: ${reconcileErr?.message}`,
          ledgerError: err?.message,
          gateResult,
        };
      }
      return {
        status: "FAILED",
        error: `LEDGER_RESULT_RECORD_FAILED: ${err?.message}`,
        reconciled,
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
    artifactSet,
    artifactSetDigest,
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

export function evaluateToolAccess(agentId, toolName, params = {}) {
  if (!ids.has(agentId)) {
    return { allowed: false, reason: "UNKNOWN_AGENT" };
  }
  if (toolName === "zink_knowledge_search") {
    if (typeof params.namespace !== "string" || !params.namespace.trim()) {
      return { allowed: false, reason: "NAMESPACE_REQUIRED" };
    }
    const access = evaluateCapabilityAccess(
      agentId,
      "zink_knowledge",
      params.namespace,
      params.action || "search",
    );
    return access.allowed
      ? { allowed: true, level: access.level }
      : { allowed: false, reason: access.reason };
  }
  if (toolName === "zink_skill_search") {
    if (!(
      typeof params.namespace === "string" ||
      (Array.isArray(params.namespace) && params.namespace.length > 0)
    )) {
      return { allowed: false, reason: "NAMESPACE_REQUIRED" };
    }
    const namespaces = Array.isArray(params.namespace)
      ? params.namespace
      : [params.namespace];
    if (
      namespaces.length === 0 ||
      namespaces.some(
        (namespace) =>
          typeof namespace !== "string" ||
          !namespace.trim() ||
          namespace.trim().toLowerCase() === "all" ||
          // Exact match, deliberately: the canonical vetted set in the adapter
          // compares the raw namespace, so lowercasing here admitted inputs
          // ("Excel", "SC/Logistics") the adapter then rejected. Two
          // normalizations of one namespace is a policy split; the gate now
          // uses the same exact comparison the adapter does.
          !GOVERNED_SKILL_NAMESPACE_CATALOG.includes(namespace.trim()),
      )
    ) {
      return { allowed: false, reason: "NAMESPACE_ACCESS_DENIED" };
    }
    const access = evaluateCapabilityAccess(
      agentId,
      "zink_skill",
      params.namespace,
      params.action || "search",
    );
    return access.allowed
      ? { allowed: true, level: access.level }
      : { allowed: false, reason: access.reason };
  }
  if (toolName === "zink_skill_propose") {
    // The canonical resolver decides, exactly as the two sibling memory-tool
    // branches above do. The previous local `allowedProposers` list was a
    // hand-maintained copy of SKILL_STORE_ACCESS_MATRIX[agent].propose that no
    // mechanical test tied to the matrix.
    const access = evaluateCapabilityAccess(
      agentId,
      "zink_skill",
      null,
      "propose",
    );
    return access.allowed
      ? { allowed: true, level: access.level }
      : { allowed: false, reason: access.reason };
  }
  // M7-003/M7-004: one canonical resolver for direct tool execution.
  // Matrix levels carry read/delegate semantics; only L3 executes.
  const access = evaluateCapabilityAccess(agentId, toolName, null, "execute");
  if (!access.allowed || access.level === "delegate") {
    return {
      allowed: false,
      reason:
        access.level === "delegate" ? "DELEGATION_REQUIRED" : access.reason,
    };
  }
  return { allowed: true, level: access.level };
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
  const failed = [];
  for (const [toolId, schemaName] of Object.entries(toolSchemaMap)) {
    try {
      const rawSchema = loadContractSchema(schemaName);
      result[toolId] = {
        schemaName,
        rawSchema,
        parameters: rawSchema.$defs?.input || rawSchema,
      };
    } catch (err) {
      // M7-050: a missing canonical tool contract never falls back to a
      // hand-written schema. The tool stays unregistered (see registerTools).
      failed.push(toolId);
      apiLoggerWarn(`contract load failed for ${toolId}: ${err?.message}`);
    }
  }
  result.failedContracts = failed;
  return result;
}

function apiLoggerWarn(_message) {
  // Registration-time diagnostics must not throw when no logger exists.
  try {
    globalThis.console?.warn?.(`[zink-governance] ${_message}`);
  } catch {
    /* ignore */
  }
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

// Lane H5: the canonical shape of a registry checksum. A non-empty string is
// not a checksum: an integrity binding that accepts arbitrary text binds
// nothing, so a malformed value is refused rather than trusted.
function isCanonicalChecksum(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

/**
 * T2: the host-side quota publication seam. `recordNativeQuota` resolves the
 * registered guard and hands the snapshot to `guard.recordQuota`, which
 * rejects cross-agent, malformed and non-canonical payloads. It is exported
 * from the native boundary and materialized into the deployed plugin tree, but
 * until the plugin imports it the HOST HAS NO WAY IN: nothing could ever publish
 * usage, so `selfNativeQuota` always answered "unknown" and the T3 run-scoped
 * model fallback could never fire. This function is that entry point.
 *
 * Returns the recorded agent id, or null when governance is disabled. It never
 * throws for a rejected payload: a malformed publication is simply not evidence.
 */
export async function publishNativeQuota(snapshot, context = null) {
  try {
    return await recordNativeQuota(
      {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: context?.enabled !== false,
              config: { ledgerRoot: context?.ledgerRoot },
            },
          },
        },
      },
      snapshot,
    );
  } catch {
    return null;
  }
}

/**
 * T2: opportunistically publish usage carried on a run-end event. The runtime
 * is not guaranteed to provide any usage field, so this is a no-op when it does
 * not. It never invents numbers: a payload without a recognised usage shape is
 * simply not recorded, and "unknown" remains the safe reading that keeps the
 * PRIMARY model.
 */
function recordQuotaIfProvided(api, event, context) {
  const usage =
    event?.usage ??
    event?.tokenUsage ??
    event?.token_usage ??
    event?.providerUsage ??
    event?.provider_usage ??
    null;
  if (!usage || typeof usage !== "object") return false;
  const agentId = context?.agentId;
  if (typeof agentId !== "string" || !agentId) return false;
  publishNativeQuota(
    {
      agent_id: agentId,
      used_pct: usage.usedPct ?? usage.used_pct,
      remaining_pct: usage.remainingPct ?? usage.remaining_pct,
      status: usage.status,
      observed_at: usage.observedAt ?? usage.observed_at,
    },
    { ledgerRoot: api?.pluginConfig?.ledgerRoot },
  ).catch(() => false);
  return true;
}

/**
 * M7-016: the semantic contract status the activated brief actually carries.
 * An absent or unrecognised status is MISSING, never VALID: defaulting to VALID
 * would let an unvalidated brief authorise specialist execution, which is
 * exactly the gate this status exists to enforce.
 */
function normalizeSemanticContractStatus(value) {
  return ["VALID", "MISSING", "AMBIGUOUS"].includes(value) ? value : "MISSING";
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a character.
 * The canonical contract validator measures `maxLength` in bytes, so every
 * runtime bound must be byte-budgeted: a character-count slice can emit a value
 * the contract then rejects, turning a legitimate user message into an
 * unwritable event.
 */
function truncateUtf8(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  // Walk code points so a surrogate pair is never cut in half.
  let bytes = 0;
  let result = "";
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    result += character;
  }
  return result;
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

export function registerTools(api, options = {}) {
  const registerFn =
    typeof api?.registerTool === "function"
      ? api.registerTool.bind(api)
      : typeof api?.tools?.register === "function"
        ? api.tools.register.bind(api.tools)
        : null;
  if (!registerFn) return { registered: [], skipped: [] };
  const proposalStorageDir =
    options.proposalStorageDir ??
    (path.isAbsolute(api.pluginConfig?.ledgerRoot ?? "")
      ? path.join(api.pluginConfig.ledgerRoot, "skill-proposals")
      : undefined);
  // Test seam: options.toolContracts / options.registryChecksum override the
  // loaders so contract/checksum failure paths are provable. Production
  // always omits them and uses the loaders below.
  const toolContracts = options.toolContracts ?? loadToolContractSchemas();
  let registryChecksum = null;
  let checksumOk = false;
  if (options.registryChecksum !== undefined) {
    registryChecksum = options.registryChecksum;
    checksumOk = isCanonicalChecksum(registryChecksum);
    if (!checksumOk) {
      api?.logger?.error?.(
        "[zink-governance] registerTools: refusing registration without a valid registry checksum",
      );
      return { registered: [], skipped: ["*"] };
    }
  } else {
    try {
      registryChecksum = getToolRegistryChecksum();
      checksumOk = isCanonicalChecksum(registryChecksum);
    } catch (err) {
      api?.logger?.error?.(
        `[zink-governance] registerTools: tool registry checksum unavailable — no governed tools registered: ${err?.message}`,
      );
    }
    // M8-059: checksum failure blocks registration. Integrity binding is never
    // claimed when checksum generation failed.
    if (!checksumOk) {
      api?.logger?.error?.(
        "[zink-governance] registerTools: refusing registration without a valid registry checksum",
      );
      return { registered: [], skipped: ["*"] };
    }
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
            required: ["query", "namespace"],
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
              namespace: {
                type: "string",
                description: "Governed Skill Store namespace",
              },
              task_id: {
                type: "string",
                description: "Governed task correlation ID",
              },
            },
            required: ["query", "namespace"],
          },
      async execute(_id, params) {
        // M8-061: memory/skill authority identity comes from trusted runtime
        // context only. Tool payload never impersonates another agent.
        const mod = await getSkillAdapter();
        // O09: Pass context with task/agent/session identity
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent: deriveTrustedRequester(_id),
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
        // M7-071: missing/malformed adapter is explicit unavailable/blocked,
        // never a governed-looking success. No fabricated result context.
        return adapterUnavailableResponse(
          "zink_skill_search",
          "SKILL_ADAPTER_UNAVAILABLE",
        );
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
              action: {
                type: "string",
                enum: ["search", "retrieve", "citation", "metadata"],
              },
              namespace: toolContracts.zink_knowledge_search.parameters
                .properties?.namespace || { type: "string" },
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
            required: ["query", "namespace"],
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
              action: {
                type: "string",
                enum: ["search", "retrieve", "citation", "metadata"],
              },
              namespace: {
                type: "string",
                description: "Governed Knowledgebase namespace",
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
            required: ["query", "namespace"],
          },
      async execute(_id, params) {
        const mod = await getKnowledgeAdapter();
        // O10: Pass context with task/agent/session identity (M8-061:
        // trusted context only — payload never impersonates)
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent: deriveTrustedRequester(_id),
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
        // M7-071: missing/malformed adapter is explicit unavailable/blocked,
        // never a governed-looking success. No fabricated result context.
        return adapterUnavailableResponse(
          "zink_knowledge_search",
          "KNOWLEDGE_ADAPTER_UNAVAILABLE",
        );
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
        // (M8-061: trusted context only — payload never impersonates)
        const ctx = {
          sessionKey:
            params?.session_key || _id?.sessionKey || "unbound-session",
          runId: params?.run_id || _id?.runId || "unbound-run",
          taskId: params?.task_id || _id?.taskId || "unbound-task",
          requestingAgent: deriveTrustedRequester(_id),
        };
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "propose",
              ...params,
            },
            ctx,
            {
              ollamaUrl: resolveDefaultOllamaUrl(),
              proposalStorageDir,
            },
          );

          if (res?.governed_status === "SUCCESS" && res.proposal) {
            const proposal = res.proposal;
            const nsStr = Array.isArray(proposal.namespace)
              ? proposal.namespace.join("/")
              : proposal.namespace || "specialist";
            const targetStr = `skills/${nsStr}/${proposal.capability}@${proposal.version}`;
            // The content digest and the approval id are derived by the
            // governance layer from the content it received, never copied from
            // a caller-supplied field. The adapter does not always populate
            // `proposal_id`, so deriving it here also means the approval is
            // always bound to specific bytes rather than to an absent id.
            const contentDigest = canonicalHash(
              "zink-skill-content-v1",
              String(params?.content ?? ""),
            );
            const approvalRecord = {
              schema_version: "1.0.0",
              governance_version: GOVERNANCE_VERSION,
              approval_id: String(
                proposal.proposal_id ??
                  canonicalHash("zink-skill-approval-id-v1", contentDigest),
              ),
              // The contract requires a 64-hex task correlation id. The old
              // `task-skill-<id>` string violated that pattern, so the record
              // could never have validated; the digest is deterministic, so it
              // remains a stable correlation key.
              task_id: canonicalHash(
                "zink-skill-approval-v1",
                String(proposal.proposal_id ?? contentDigest),
              ),
              brief_revision: 1,
              exact_target: targetStr,
              exact_operation: "SKILL_CANDIDATE_APPROVAL",
              material_parameters: {
                namespace: proposal.namespace,
                capability: proposal.capability,
                version: proposal.version,
                // The content digest is computed by the governance layer from
                // the content it actually received, never copied from a
                // caller-supplied field. That makes the approval scope digest
                // bind to the bytes the owner is approving.
                content_sha256: contentDigest,
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
              // The scope digest is what an owner's decision is bound to, so it
              // is computed over exactly the parameters shown for approval.
              approval_scope_digest: canonicalHash(
                "zink-approval-scope-v1",
                `${targetStr}|SKILL_CANDIDATE_APPROVAL|${contentDigest}`,
              ),
              publication_status: "pending_owner_post",
              proposal,
            };
            // The contract is enforced, not decorative: a packet that does not
            // conform is never presented to the owner.
            validateContract("approval-request", approvalRecord);
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
        // M7-071: missing/malformed adapter is explicit unavailable/blocked,
        // never a governed-looking success. No fabricated result context.
        return adapterUnavailableResponse(
          "zink_skill_propose",
          "SKILL_ADAPTER_UNAVAILABLE",
        );
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
          const sandboxDir = resolveAgentSandboxDir("excel");
          if (!sandboxDir) {
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "BLOCKED",
                    error: "SANDBOX_UNAVAILABLE",
                    tool: "zink_excel",
                  }),
                },
              ],
            };
          }
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
        const query = params?.query;
        const targetDb = params?.target_database;
        // M8-061: SQL caller identity comes from trusted runtime context.
        const agentId = deriveTrustedRequester(_id);
        const taskId =
          params?.task_id || _id?.taskId || _id?.task_id || _id?.runId;
        if (!query || !targetDb || !taskId) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "BLOCKED",
                  execution_state: "BLOCKED",
                  error: "TASK_SCOPE_REQUIRED",
                  message:
                    "SQL execution requires query, target_database and task scope; no defaults are permitted.",
                }),
              },
            ],
          };
        }
        const bridge = await getDuckDbBridge();
        if (!bridge?.executeGovernedDuckDbQuery) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "BLOCKED",
                  execution_state: "BLOCKED",
                  error: "ENGINE_NOT_IMPLEMENTED",
                  tool: "zink_sql",
                }),
              },
            ],
          };
        }
        try {
          const result = await bridge.executeGovernedDuckDbQuery(
            { agent_id: agentId, task_id: taskId },
            { ...params, query, target_database: targetDb },
          );
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "BLOCKED",
                  execution_state:
                    err?.code === "DUCKDB_TIMEOUT" ? "TIMEOUT" : "FAILED",
                  error: err?.code || "DUCKDB_EXECUTION_ERROR",
                  message: "Governed SQL execution failed closed.",
                  target_database: targetDb,
                  rows: [],
                  row_count: 0,
                }),
              },
            ],
          };
        }
      },
    },
  };

  const registered = [];
  const skipped = [];
  for (const [toolId, def] of Object.entries(registry)) {
    // M7-050: a tool without its canonical contract is never registered
    // with a hand-written fallback schema.
    if (!toolContracts[toolId]) {
      api?.logger?.error?.(
        `[zink-governance] registerTools: skipping ${toolId} — canonical contract unavailable`,
      );
      skipped.push(toolId);
      continue;
    }
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
        // M7-049: principal identity comes exclusively from trusted OpenClaw
        // context, never from tool payload. params.requesting_agent is
        // business metadata and must not authorize as another agent.
        const trustedAgent = _id?.agent ?? _id?.agentId ?? null;
        const claimedAgent =
          params?.requesting_agent ?? params?.agentId ?? null;
        if (typeof trustedAgent !== "string" || !trustedAgent) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "DENIED",
                  tool: toolId,
                  error:
                    "IDENTITY_REQUIRED: No trusted agent identity in tool context",
                  code: "IDENTITY_REQUIRED",
                }),
              },
            ],
          };
        }
        if (claimedAgent !== null && claimedAgent !== trustedAgent) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "DENIED",
                  tool: toolId,
                  error: `IDENTITY_SPOOF: payload identity '${claimedAgent}' does not match trusted context '${trustedAgent}'`,
                  code: "IDENTITY_SPOOF",
                }),
              },
            ],
          };
        }
        const requestingAgent = trustedAgent;

        // N08: Wrapper-level per-agent authorization
        {
          const access = evaluateToolAccess(
            requestingAgent,
            toolId,
            params || {},
          );
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
            // M8-062: no executable backend — explicit unavailable, never a
            // governed-looking success.
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    status: "UNAVAILABLE",
                    tool: toolId,
                    error: "TOOL_EXECUTE_UNAVAILABLE",
                    code: "TOOL_EXECUTE_UNAVAILABLE",
                    blocked: true,
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
        const outputCheck = validateToolOutputEnvelope(
          toolId,
          executionResult,
          toolContracts[toolId],
        );
        if (!outputCheck.ok) {
          return outputCheck.response;
        }

        return executionResult;
      },
    });
    registered.push(toolId);
  }
  return { registered, skipped };
}

// M8-060: structured-output gate for governed execution tools. Non-JSON
// output and schema violations are blocked; terminal/error envelopes pass
// through untouched. Exported for behavioral regression testing.
export function validateToolOutputEnvelope(toolId, executionResult, contract) {
  const isCallableExecutionTool = [
    "zink_excel",
    "zink_power_bi",
    "zink_sql",
    "zink_python",
    "zink_n8n",
  ].includes(toolId);
  const outputSchema = isCallableExecutionTool
    ? contract?.rawSchema?.$defs?.output
    : null;
  const outputText = executionResult?.content?.[0]?.text;
  if (!outputSchema || typeof outputText !== "string") {
    return { ok: true };
  }
  const blocked = (errors, rawOutput) => ({
    ok: false,
    response: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "INVALID_OUTPUT_SCHEMA",
            tool: toolId,
            errors,
            code: "INVALID_OUTPUT_SCHEMA",
            ...(rawOutput === undefined ? {} : { rawOutput }),
          }),
        },
      ],
    },
  });
  let parsedOutput;
  try {
    parsedOutput = JSON.parse(outputText);
  } catch {
    return blocked(["NON_JSON_OUTPUT"]);
  }
  if (
    parsedOutput &&
    parsedOutput.status !== "ENGINE_NOT_IMPLEMENTED" &&
    parsedOutput.status?.toUpperCase?.() !== "ERROR" &&
    parsedOutput.status !== "DENIED" &&
    parsedOutput.status !== "BLOCKED" &&
    parsedOutput.status !== "INVALID_PARAMETERS" &&
    parsedOutput.status !== "governed" &&
    parsedOutput.status !== "UNAVAILABLE"
  ) {
    try {
      checkSchema(outputSchema, parsedOutput, contract?.schemaName);
    } catch (outErr) {
      return blocked([outErr?.message || String(outErr)], parsedOutput);
    }
  }
  return { ok: true };
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
/**
 * M7-047: a model turn that failed upstream is never a successful completion.
 */
export function isProviderFailureEvent(event) {
  return (
    event?.success === false ||
    event?.lastAssistant?.stopReason === "error" ||
    event?.lastAssistant?.stopReason === "aborted" ||
    event?.lastAssistant?.stopReason === "length"
  );
}

/**
 * R10 G1 (Option A, corrected) — the pure-liveness heartbeat exemption.
 *
 * A qualifying run is an INTERNAL run: it requires no ledger task and no ledger
 * session, and none is fabricated for it. Every condition below must hold.
 *
 * 1. `trigger === "heartbeat"`. This is the PRIMARY discriminator and it is
 *    HOST-ASSIGNED, never content-derived. The host computes it as
 *    `opts?.isHeartbeat === true ? "heartbeat" : "user"` — a strict binary whose
 *    only producer is the heartbeat scheduler. A user message that merely
 *    contains the sentinel cannot produce it.
 * 2. Self-keyed session.
 * 3. The exact sentinel in the canonical host-provided heartbeat representation.
 * 4. No inter-session / continuation provenance.
 * 5. Not Discord ingress.
 *
 * R10 correction: the former "no mentions" and "not bot-author" conditions are
 * RETIRED. Those fields do not exist at the native admission anchor — `mentions`
 * is produced only in the Discord ingress layer and no run-scoped bot-author
 * field exists at all. They are deliberately NOT replaced by an
 * `mentions === undefined` test, which would be vacuous and would recreate the
 * false confidence of R9. Condition 5 already excludes every Discord-shaped run,
 * which is the only source of mentions and bot authorship in this topology.
 */
const HEARTBEAT_LIVENESS_SENTINEL = "[OpenClaw heartbeat poll]";

export function isPureLivenessHeartbeat(context) {
  if (!context || typeof context !== "object") return false;
  if (context.trigger !== "heartbeat") return false;
  if (context.inputProvenance) return false;
  const { agentId, sessionKey } = context;
  if (typeof agentId !== "string" || typeof sessionKey !== "string")
    return false;
  if (sessionKey !== `agent:${agentId}:${agentId}`) return false;
  if (sessionKey.includes(":discord:")) return false;
  for (const key of [
    "channelId",
    "channel",
    "messageChannel",
    "messageProvider",
  ]) {
    if (context[key] === "discord") return false;
  }
  return (
    context.transcriptPrompt === HEARTBEAT_LIVENESS_SENTINEL ||
    context.prompt === HEARTBEAT_LIVENESS_SENTINEL
  );
}

// M8/T2.2-R19 — the admission-time liveness discriminator, recovered at the
// prompt-build seam.
//
// The host invokes the advisory `before_prompt_build` hook as
// `runBeforePromptBuild(promptEvent, params.hookCtx)`, and `hookCtx` is built
// with only runId/trace/agentId/sessionKey/sessionId/workspaceDir/modelProviderId/
// modelId/trigger plus channel and identity fields. It carries `trigger`, which
// the host itself relies on (`hookCtx.trigger === "heartbeat"` gates its own
// heartbeat contribution hook), but it carries NEITHER `transcriptPrompt` NOR
// `prompt`: the liveness sentinel lives in the turn's transcript body, not in the
// run context. So `isPureLivenessHeartbeat` could never match at that seam even
// though admission had already accepted the very same run as a pure liveness
// heartbeat. The hook therefore fell through to a ledger lookup, a heartbeat has
// no ledger owner by design, and it emitted the fail-open
// `EXECUTION_STATE_UNKNOWN ... report BLOCKED` instruction — which is why every
// live poll replied `outcome_claim: BLOCKED`.
//
// The recovery is deliberately local to this module rather than a cross-module
// read of the native boundary. The boundary exists in two distinct module
// instances at runtime (`dist/zink-governance-boundary.mjs` is what the pinned
// selection imports, while `lib/native-boundary.mjs` is the packaged copy this
// plugin would import), each with its own module state, so a cross-instance read
// would observe an empty store. Instead this plugin records the host-provided
// discriminator inside its OWN `beforeRun` guard — the callback the boundary
// invokes at admission, carrying the same `trigger`/`transcriptPrompt` the
// predicate already evaluates — and reads it back here. One predicate, one rule,
// no second copy of the liveness test.
//
// Safety properties, matching the R18 boundary pattern:
//   * The record holds DATA, never a verdict. The exemption is still decided by
//     re-running `isPureLivenessHeartbeat`, and every other guard (self-keyed
//     session, no input provenance, no Discord provenance) is evaluated against
//     the HOOK's own context, not against the record. Nothing here can grant an
//     exemption the predicate would not have granted on its own.
//   * `trigger` is host-assigned (`opts?.isHeartbeat === true ? "heartbeat" :
//     "user"`), so a user message that merely contains the sentinel still arrives
//     with `trigger: "user"` and is fully governed. Recovery cannot be spoofed.
//   * Keyed strictly by the host `runId`, which is unique per run, so one run's
//     record can never be read by another.
//   * Bounded, with oldest-first eviction. A run that dies before run-end cannot
//     grow the store, and an evicted record DEGRADES TO GOVERNANCE: the predicate
//     then fails and the run stays fully governed. Eviction never yields a bypass.
//   * Consumed at the run-end seam, which runs after prompt build.
const ADMISSION_LIVENESS = new Map();
const ADMISSION_LIVENESS_LIMIT = 256;

function rememberAdmissionLiveness(runId, trigger, transcriptPrompt) {
  if (typeof runId !== "string" || runId === "") return;
  if (ADMISSION_LIVENESS.size >= ADMISSION_LIVENESS_LIMIT)
    ADMISSION_LIVENESS.delete(ADMISSION_LIVENESS.keys().next().value);
  ADMISSION_LIVENESS.set(runId, { trigger, transcriptPrompt });
}

/** Read-only: prompt build must not consume what the run-end seam still needs. */
function readAdmissionLiveness(runId) {
  if (typeof runId !== "string" || runId === "") return undefined;
  return ADMISSION_LIVENESS.get(runId);
}

function forgetAdmissionLiveness(runId) {
  if (typeof runId !== "string" || runId === "") return;
  ADMISSION_LIVENESS.delete(runId);
}

/**
 * The ONE heartbeat decision, applied identically at every seam.
 *
 * `context` is always the host's own run context for the seam in question. When
 * that context already carries the discriminator the fast path applies. Otherwise
 * the admission-time record is consulted, so a seam whose host context omits the
 * sentinel reaches the same verdict on the same run.
 *
 * A context that does not CORROBORATE the record fails closed. In production the
 * hook context's `trigger` and the admission record's `trigger` are the same
 * `params.trigger` from the same `runEmbeddedAttempt`, so they always agree.
 * Requiring them to agree exactly means the exemption rests on TWO independent
 * host-authored facts rather than on the record alone: a missing, absent or
 * differing trigger is treated as ambiguous and stays governed. Recovery may
 * therefore only SUPPLY the sentinel, which is the one field this seam's host
 * context genuinely omits.
 */
function isLivenessHeartbeat(context) {
  if (isPureLivenessHeartbeat(context)) return true;
  const liveness = readAdmissionLiveness(context?.runId);
  if (!liveness) return false;
  if (context.trigger !== liveness.trigger) return false;
  return isPureLivenessHeartbeat({
    ...context,
    trigger: liveness.trigger,
    transcriptPrompt: liveness.transcriptPrompt,
  });
}

/**
 * M7-048: classify a run-end request without trusting a session-key string.
 *
 * A session is an internal system session only when the authoritative ledger
 * does not own it AND no governed run identity was presented. A self-keyed
 * session that carries a runId is a real governed run wearing an internal
 * key, so it must fall through to full end-of-run governance.
 */
export function classifyInternalRunEnd({
  agentId,
  sessionKey,
  runId,
  ownedByLedger,
  hasMessageIdentity = false,
  pureLivenessHeartbeat = false,
}) {
  const selfKeyed =
    typeof sessionKey === "string" &&
    sessionKey === `agent:${agentId}:${agentId}`;
  if (ownedByLedger) {
    return { isInternal: false, selfKeyed, selfKeyedWithRunId: false };
  }
  if (!selfKeyed) {
    return { isInternal: false, selfKeyed: false, selfKeyedWithRunId: false };
  }
  // R17: a PURE liveness heartbeat is exempt here for the same reason it is
  // exempt at admission, and it is the same rule, not a second copy of it: the
  // caller passes the verdict of `isPureLivenessHeartbeat`, which requires the
  // host `trigger === "heartbeat"`, no input provenance, a self-keyed session,
  // no Discord provenance and the exact liveness sentinel. The runId refusal
  // below is untouched for every other run, so a governed self-keyed run that
  // merely carries a runId still receives full end-of-run governance, and a
  // ledger-owned session was already refused above regardless of this flag.
  if (runId && !pureLivenessHeartbeat) {
    return { isInternal: false, selfKeyed: true, selfKeyedWithRunId: true };
  }
  // Run ADMISSION additionally requires that no inbound message identity was
  // presented: a self-keyed session that carries a Discord message is a
  // governed ingress run wearing an internal key. This is the ONE classifier —
  // admission and end-of-run must not hold two copies of the same rule.
  if (hasMessageIdentity) {
    return {
      isInternal: false,
      selfKeyed: true,
      selfKeyedWithRunId: false,
    };
  }
  return { isInternal: true, selfKeyed: true, selfKeyedWithRunId: false };
}

/**
 * T2: self-scoped read-only quota receipt. Returns null when governance is
 * disabled so the prompt path degrades to no telemetry rather than a fabricated
 * quota. Never throws: a missing receipt is not a governance failure for
 * prompt construction, and stale/unknown telemetry keeps PRIMARY anyway.
 */
async function quotaReceiptFor(config, agentId) {
  try {
    if (typeof agentId !== "string" || !agentId) return null;
    return await selfNativeQuota(
      {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: config?.enabled !== false,
              config: { ledgerRoot: config?.ledgerRoot },
            },
          },
        },
      },
      { agentId },
    );
  } catch {
    return null;
  }
}

/**
 * T3: run-scoped model resolution. Returns null when governance is disabled so
 * the host keeps its own resolution. The result applies to the current run
 * only and is never written into session state.
 */
async function resolveRunModelFor(config, context) {
  try {
    return await resolveNativeRunModel(
      {
        plugins: {
          entries: {
            "zink-governance": {
              enabled: config?.enabled !== false,
              config: { ledgerRoot: config?.ledgerRoot },
            },
          },
        },
      },
      context,
    );
  } catch {
    return null;
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

/**
 * The owner's Discord account id, from validated configuration only.
 *
 * This identity is deliberately NEVER hardcoded. A baked-in fallback would put a
 * real account identifier into source — a privacy leak, and one the repository's
 * own `.gitleaks.toml` policy forbids outside `tests/` — and it would be worse
 * than a leak: if configuration were ever absent or unreadable, that fallback
 * would silently keep authorizing one specific account, so the authorization
 * gate would depend on a source constant instead of on deployed configuration.
 *
 * `parseIdentifiers` refuses to build a configuration whose owner id is not a
 * valid Discord snowflake, so a real deployment always supplies one. Absence
 * therefore means "cannot prove who the owner is", and the correct answer is to
 * authorize nobody. Every caller compares a sender against this value, so an
 * `undefined` result denies the action and the gate fails closed.
 */
function resolveOwnerDiscordId(config) {
  const ownerId = config?.ownerDiscordId;
  return typeof ownerId === "string" && /^[0-9]{17,19}$/u.test(ownerId)
    ? ownerId
    : undefined;
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
    const config = api.pluginConfig ?? {};
    // M8-058: a disabled governance plugin exposes no tools or hooks.
    // The enabled check runs before any registration side effect.
    if (config.enabled === false) return;
    registerTools(api, {
      proposalStorageDir: path.isAbsolute(config.ledgerRoot ?? "")
        ? path.join(config.ledgerRoot, "skill-proposals")
        : undefined,
    });
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
          // M7-020: a reserved child waits for its receipt whether the task
          // is still pre-approval or already executing. Restricting the wait to
          // ACTIVE would make an approved task's child fail to start.
          ["ACTIVE", "QUEUED", "EXECUTING"].includes(task.workflow_status) &&
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
    function credentialUnavailable(agentId) {
      const error = new Error("CREDENTIAL_UNAVAILABLE");
      error.code = "CREDENTIAL_UNAVAILABLE";
      error.agentId = agentId;
      return error;
    }

    function resolveDiscordBotToken(agentId) {
      if (cachedDiscordTokens.has(agentId))
        return cachedDiscordTokens.get(agentId);
      try {
        const tokenKey = {
          main: "zink/openclaw/DISCORD_BOT_TOKEN_MAIN",
          o1: "zink/openclaw/DISCORD_BOT_TOKEN_O1",
          o2: "zink/openclaw/DISCORD_BOT_TOKEN_O2",
        }[agentId];
        if (!tokenKey) throw credentialUnavailable(agentId);

        const resolverPath = path.join(
          stateDir,
          "bin",
          "openclaw-pass-resolver",
        );
        const passStoreDirectory = path.join(
          stateDir,
          "secrets",
          "password-store",
        );
        const gpgHomeDirectory = path.join(stateDir, "secrets", "gnupg");
        const resRaw = execSync(resolverPath, {
          input: JSON.stringify({
            protocolVersion: 1,
            provider: "pass_store",
            ids: [tokenKey],
          }),
          env: {
            ...process.env,
            PATH: `${path.join(path.dirname(stateDir), ".local", "bin")}${path.delimiter}${process.env.PATH || ""}`,
            PASSWORD_STORE_DIR: passStoreDirectory,
            GNUPGHOME: gpgHomeDirectory,
          },
          encoding: "utf8",
          timeout: 5000,
        });
        const parsed = JSON.parse(resRaw);
        const token = parsed.values?.[tokenKey];
        if (token) cachedDiscordTokens.set(agentId, token);
        if (!token) throw credentialUnavailable(agentId);
        return token;
      } catch {
        throw credentialUnavailable(agentId);
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

      let bodyContent = card.content;
      if (!bodyContent.includes("[APPROVE]")) {
        bodyContent += `\n\n---\n**Thao tác dành cho User (Buttons & Actions):**\n- Phản hồi **APPROVE** hoặc bấm **[APPROVE]** để phê duyệt đưa vào hàng đợi thực thi.\n- Phản hồi **REJECT** hoặc bấm **[REJECT]** để từ chối kế hoạch.\n- Phản hồi **REQUEST REVISION** để yêu cầu sửa đổi kế hoạch.`;
      }

      let taskId;
      let briefRevision;
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
          briefRevision = owner.task?.brief_revision;
        }
      } catch {
        api.logger?.warn?.(
          "[zink-governance] Discord approval card blocked: TASK_CORRELATION_UNAVAILABLE",
        );
      }
      if (!taskId || !Number.isInteger(briefRevision) || briefRevision < 1) {
        api.logger?.warn?.(
          "[zink-governance] Discord approval card blocked: EXACT_TASK_CORRELATION_REQUIRED",
        );
        return { status: "BLOCKED", error: "EXACT_TASK_CORRELATION_REQUIRED" };
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

      // R6 — RECORD THE REQUEST BEFORE THE CARD IS ADVERTISED.
      //
      // The ledger is authoritative for whether an approval opportunity exists.
      // If the card were posted first, the UI would advertise an approval the
      // ledger does not know about, recreating the original semantic gap in the
      // opposite direction. So the event is appended (and read back) first, and
      // ANY failure here returns WITHOUT posting.
      //
      // The task is resolved from the ledger via the owning run, never parsed out
      // of the model's own card text, which is untrusted evidence. An
      // unresolvable or ambiguous run therefore fails closed.
      try {
        const owner = findSession(
          readSnapshot(paths),
          childSessionKey,
          event.childRunId,
          false,
        );
        const requestTaskId = owner.task_id;
        recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
          task_id: requestTaskId,
          agent_id: agentId,
          session_key: childSessionKey,
          run_id: event.childRunId,
        });
        // Read-back: the request must be visible in the authoritative snapshot
        // before anything is surfaced to the owner.
        const confirmed = readSnapshot(paths);
        if (!confirmed?.tasks?.[requestTaskId]?.approval_requested_at) {
          throw new Error("APPROVAL_REQUEST_NOT_DURABLE");
        }
      } catch (requestError) {
        api.logger?.warn?.(
          `[zink-governance] approval request NOT recorded; card suppressed: ${requestError?.message}`,
        );
        return;
      }

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
              },
              applied_tags: ["1545697161985921064"], // STATUS: WAITING tag
            }),
          },
        );

        if (res.ok) {
          const thread = await res.json();
          // Native outbound: components travel through the official
          // OpenClaw 2026.6.34 Discord adapter. Only forum-thread
          // creation above remains raw REST (no verified native seam).
          try {
            const receipt = await sendNativePayload({
              api,
              to: thread.id,
              threadId: thread.id,
              accountId: agentId,
              payload: buildNativeComponentPayload({
                text: bodyContent.slice(0, 2000),
                buttons: components[0].components.map((button) => ({
                  customId: button.custom_id,
                  label: button.label,
                  style: button.style,
                  emoji: button.emoji,
                })),
              }),
            });
            api.logger?.info?.(
              `[zink-governance] Discord approval card posted for ${agentId} into #approvals (threadId: ${thread.id}, messageId: ${receipt.messageId})`,
            );
          } catch (deliveryErr) {
            api.logger?.error?.(
              `[zink-governance] Discord approval component delivery failed: ${deliveryErr?.message}`,
            );
          }
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

    async function resolveVerifiedExecutionBackend() {
      // R4: the live projection has no registered specialist engine.
      return null;
    }

    function enqueueApprovedTaskForExecution({ taskId, paths }) {
      if (!paths) {
        return { status: "BLOCKED", error: "TASK_SCOPE_REQUIRED" };
      }
      const snapshot = readSnapshot(paths);
      const task = snapshot?.tasks?.[taskId];
      if (!task) {
        return { status: "BLOCKED", error: "TASK_NOT_FOUND" };
      }
      const existing = defaultQueueManager.getTask(taskId);
      if (existing) {
        return { status: existing.status, taskId, queueItem: existing };
      }
      const queueItem = defaultQueueManager.enqueueTask({
        taskId,
        planVersion: String(task.brief_revision || "1.0"),
        primaryCoordinator: task.primary_coordinator || "o1",
        requiredCapabilities: task.nodes?.map((node) => node.agent_id) || [],
        payload: task.payload || {},
      });
      return { status: "QUEUED", taskId, queueItem };
    }

    async function executeApprovedTask({
      taskId,
      paths,
      config,
      api,
      originThreadId = null,
    }) {
      let queueStatus;
      try {
        queueStatus = enqueueApprovedTaskForExecution({ taskId, paths });
      } catch (err) {
        api.logger?.error?.(
          `[zink-governance] approved task queueing failed: ${err?.message}`,
        );
        return {
          status: "BLOCKED",
          error: "QUEUE_STORAGE_WRITE_FAILED",
          taskId,
        };
      }
      if (queueStatus.status !== "QUEUED") {
        return { ...queueStatus, taskId };
      }
      const executionBackend = await resolveVerifiedExecutionBackend();
      if (!executionBackend) {
        return {
          status: "BLOCKED",
          error: "ENGINE_NOT_IMPLEMENTED",
          taskId,
          queue_status: queueStatus.status,
        };
      }

      try {
        api.logger?.info?.(
          `[zink-governance] Starting autonomous execution for approved task: ${taskId}`,
        );

        if (originThreadId) {
          sendNativePayload({
            api,
            to: originThreadId,
            threadId: originThreadId,
            accountId: "o1",
            payload: {
              text: `⏳ **Execution backend đang được kiểm tra...**\n- **Điều phối viên:** O1\n- **Tiến trình:** Chỉ tiếp tục khi backend chuyên môn có đăng ký và trả evidence tin cậy.`,
            },
          }).catch((deliveryErr) => {
            api.logger?.warn?.(
              `[zink-governance] discord delivery failed (execution-backend-notice): ${deliveryErr?.message}`,
            );
          });
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
        // M7-010: the broker claims under the task's governed coordinator
        // identity so the claim is bound to the authoritative assignment.
        const brokerAgentId = task.primary_coordinator || "o1";
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
            agentId: brokerAgentId,
            leaseSeconds: 300,
          });
          leaseId = claim.leaseId;
          attempt = claim.task.attempt;
        } else if (existing.status === "EXECUTING") {
          if (existing.claimedBy !== brokerAgentId) {
            // LEGACY-MIGRATION: pre-M7-010 claims used the opaque broker
            // principal. Revoke via stale recovery (ledger-reconciled so
            // terminal work is never resurrected) and claim governed.
            defaultQueueManager.detectAndRecoverStaleTasks({
              staleThresholdSeconds: 0,
              ledgerTasks: snapshot?.tasks ?? null,
            });
            const claim = defaultQueueManager.claimTaskById({
              taskId,
              agentId: brokerAgentId,
              leaseSeconds: 300,
            });
            leaseId = claim.leaseId;
            attempt = claim.task.attempt;
          } else {
            leaseId = existing.leaseId;
            attempt = existing.attempt;
          }
        } else {
          const claim = defaultQueueManager.claimTaskById({
            taskId,
            agentId: brokerAgentId,
            leaseSeconds: 300,
          });
          leaseId = claim.leaseId;
        }

        if (paths && task.workflow_status === "QUEUED") {
          try {
            recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
              task_id: taskId,
              agent_id: "execution-agent",
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

        // 3. Multi-tier Validation via handleExecutionFinished
        const finishRes = handleExecutionFinished({
          taskId,
          agentId: task.primary_coordinator || "o1",
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
          businessData: task.payload?.businessData || {},
          businessConfig: task.payload?.businessConfig || {},
          paths,
          queueManager: defaultQueueManager,
        });

        if (finishRes.status !== "READY_FOR_REVIEW") {
          api.logger?.error?.(
            `[zink-governance] Execution validation failed: ${finishRes.error || finishRes.status}`,
          );
          if (originThreadId) {
            sendNativePayload({
              api,
              to: originThreadId,
              threadId: originThreadId,
              accountId: "o1",
              payload: {
                text: `⚠️ **Kiểm định thất bại:** ${finishRes.error || "Không đạt chuẩn kiểm định 2 tầng"}`,
              },
            }).catch((deliveryErr) => {
              api.logger?.warn?.(
                `[zink-governance] discord delivery failed (validation-failure-notice): ${deliveryErr?.message}`,
              );
            });
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

        // Forum-thread creation (with file attachments) remains raw REST:
        // exact 2026.6.34 exposes no native plugin-facing thread-create/file
        // seam. o1Token is still required here as the transport credential.
        const o1Token = resolveDiscordBotToken("o1");
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
          // Native outbound for the component message; the multipart
          // thread creation above (with file attachments) remains raw
          // REST (no verified native forum/file seam in exact 2026.6.34).
          try {
            const receipt = await sendNativePayload({
              api,
              to: resultThreadId,
              threadId: resultThreadId,
              accountId: "o1",
              payload: buildNativeComponentPayload({
                text: finishRes.resultCard.slice(0, 2000),
                buttons: components[0].components.map((button) => ({
                  customId: button.custom_id,
                  label: button.label,
                  style: button.style,
                  emoji: button.emoji,
                })),
              }),
            });
            api.logger?.info?.(
              `[zink-governance] Result card and actions published successfully: thread ${resultThreadId}, messageId: ${receipt.messageId}`,
            );
          } catch (deliveryErr) {
            api.logger?.error?.(
              `[zink-governance] Discord result component delivery failed: ${deliveryErr?.message}`,
            );
          }
        } else {
          api.logger?.error?.(
            `[zink-governance] Failed to publish result card: ${postRes.status} ${await postRes.text()}`,
          );
        }

        // 5. Update Approval Thread
        if (originThreadId) {
          sendNativePayload({
            api,
            to: originThreadId,
            threadId: originThreadId,
            accountId: "o1",
            payload: {
              text: `📋 **Evidence đã được chuẩn bị cho nghiệm thu.**\n- **Kiểm định:** Theo kết quả validator thực tế\n- **Kênh nghiệm thu:** <#${resultsForumId}> ${resultThreadId ? `(Thread: <#${resultThreadId}>)` : ""}. Kính mời anh Zink kiểm tra và nghiệm thu nếu đủ evidence.`,
            },
          }).catch((deliveryErr) => {
            api.logger?.warn?.(
              `[zink-governance] discord delivery failed (evidence-ready-notice): ${deliveryErr?.message}`,
            );
          });
        }

        // 6. Main notifies #office
        const officeChannelId =
          config.discordOfficeChannelId ||
          config.officeChannelId ||
          "1545425766161063937";
        if (officeChannelId) {
          sendNativePayload({
            api,
            to: officeChannelId,
            accountId: "main",
            payload: {
              text: `📋 **Thông báo từ Quản Lý:** Evidence của tác vụ \`${taskId.slice(0, 8)}\` đã được chuyển tới <#${resultsForumId}> để kiểm tra và nghiệm thu.`,
            },
          }).catch((deliveryErr) => {
            api.logger?.warn?.(
              `[zink-governance] discord delivery failed (office-evidence-notice): ${deliveryErr?.message}`,
            );
          });
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
        // R19: record the host-provided discriminator this admission evaluated, so
        // the prompt-build seam — whose host context omits the sentinel — can
        // re-run the SAME predicate on the SAME run instead of reporting a false
        // EXECUTION_STATE_UNKNOWN. Data only; the verdict is still taken by
        // `isLivenessHeartbeat`. Bounded and consumed at run-end.
        rememberAdmissionLiveness(
          context.runId,
          context.trigger,
          context.transcriptPrompt,
        );
        // R7 G1: a pure liveness heartbeat is an internal run and is exempt from
        // ledger ownership. It is admitted before the classifier below, which
        // deliberately refuses any self-keyed session that carries a runId.
        if (isPureLivenessHeartbeat(context)) return { allow: true };
        // The internal-session rule is decided by the ONE canonical classifier,
        // not by a second local copy of the same test. A self-keyed session that
        // the ledger owns, or that carries a runId, is a GOVERNED session and
        // must pass through full run-admission governance — the previous local
        // copy waved it through at admission while the end-of-run path
        // correctly classified it as governed.
        if (
          classifyInternalRunEnd({
            agentId: context.agentId,
            sessionKey: context.sessionKey,
            runId: context.runId,
            ownedByLedger: false,
            hasMessageIdentity:
              Boolean(context.currentMessageId) || Boolean(context.message),
          }).isInternal
        ) {
          return { allow: true };
        }
        // message_received is fire-and-forget and its inbound mapper has no
        // runId in 2026.6.34. Bind authenticated ingress at the awaited native
        // run boundary, where message identity and run identity coexist.
        const isDiscordIngress =
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
          const admission = authenticateIngress(context);
          if (admission?.allow !== true) return admission;
        } else {
          await awaitSpawnReceipt(context, signal);
        }
        // T3: proactive fallback at the model-resolution seam. The resolved
        // model is run-scoped and returned to the host for the CURRENT run
        // only. No session state is written, no model override is created and
        // no model pin is persisted. Quota is advisory here; a real provider
        // failure still takes the native reactive failover path.
        const decision = await guard.beforeRun(event, context, signal);
        if (decision?.allow !== true) return decision;
        const modelResolution = await resolveRunModelFor(config, context);
        return modelResolution ? { ...decision, modelResolution } : decision;
      },
      // T3: dedicated model-resolution boundary. The host may call this
      // directly when it exposes before_model_resolve. It is pure with respect
      // to persisted state.
      async before_model_resolve(event, context) {
        return (await resolveRunModelFor(config, context)) ?? { allow: true };
      },
      async beforeToolCall(event, context, signal) {
        if (
          [
            "zink_skill_search",
            "zink_knowledge_search",
            "zink_skill_propose",
          ].includes(event.toolName)
        ) {
          if (!canAccessMemoryTool(context.agentId, event.toolName)) {
            return {
              allow: false,
              block: true,
              reason: "MEMORY_TOOL_ACCESS_DENIED",
            };
          }
          const memoryAccess = evaluateToolAccess(
            context.agentId,
            event.toolName,
            event.params || {},
          );
          if (!memoryAccess.allowed) {
            api.logger?.warn?.(
              `[zink-governance:denied] agent=${context.agentId} tool=${event.toolName} reason=${memoryAccess.reason}`,
            );
            return {
              allow: false,
              block: true,
              reason: memoryAccess.reason || "AUTH_POLICY_DENIED",
            };
          }
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

          // Path & Query Safety Validation (M7-005/M7-007: the live path
          // calls the canonical validators — no second SQL/path policy)
          if (event.toolName === "zink_excel") {
            const filePath = event.params?.file_path;
            if (!filePath || typeof filePath !== "string") {
              return {
                allow: false,
                block: true,
                reason: "SCHEMA_VALIDATION_FAILED",
              };
            }
            const pathCheck = await validateLiveArtifactPath(filePath);
            if (!pathCheck.ok) {
              return {
                allow: false,
                block: true,
                reason: pathCheck.reason,
              };
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
            const sqlCheck = await validateLiveSqlQuery(
              query,
              event.params?.parameters,
            );
            if (!sqlCheck.ok) {
              return {
                allow: false,
                block: true,
                reason: sqlCheck.reason,
              };
            }
          } else if (event.toolName === "zink_n8n") {
            // M7-006: the live n8n path uses the SAME canonical registry,
            // delegation scope and approval binding as the guarded path. The
            // live branch previously performed none of them, so any agent with
            // static tool access could trigger any workflow id.
            // The policy authority loads asynchronously; decide only against a
            // loaded policy, never against an empty projection.
            try {
              await whenGovernanceDependenciesReady();
            } catch {
              return {
                allow: false,
                block: true,
                reason: "GOVERNANCE_DEPENDENCY_MISSING",
              };
            }
            let owner;
            try {
              owner = findSession(
                readSnapshot(paths),
                context.sessionKey,
                context.runId,
              );
            } catch {
              return {
                allow: false,
                block: true,
                reason: "AUTH_DELEGATION_NOT_FOUND",
              };
            }
            if (!owner?.delegation) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_DELEGATION_NOT_FOUND",
              };
            }
            const liveRun = owner.delegation;
            // Delegation scope: the run must be live, the agent must own it,
            // the run id must match, and the tool must be in the delegation's
            // own allowlist. A root session has no delegation to scope to.
            if (liveRun.run_state === "REVOKED") {
              return {
                allow: false,
                block: true,
                reason: "AUTH_DELEGATION_REVOKED",
              };
            }
            if (liveRun.run_state !== "RUNNING") {
              return {
                allow: false,
                block: true,
                reason: "AUTH_DELEGATION_INACTIVE",
              };
            }
            if (context.agentId !== liveRun.agent_id) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_UNAUTHORIZED_TARGET",
              };
            }
            if (context.runId !== liveRun.native_run_id) {
              return {
                allow: false,
                block: true,
                reason: "LINEAGE_MISMATCH",
              };
            }
            if (
              String(owner.task?.brief_revision) !==
              String(liveRun.brief_revision)
            ) {
              return {
                allow: false,
                block: true,
                reason: "REVISION_SUPERSEDED",
              };
            }
            // The recorded delegation tool list, when present, may only NARROW
            // the canonical ceiling that evaluateToolAccess already applied. It
            // can never add authority the canonical policy withheld, and its
            // absence is not a licence: the canonical projection stands alone.
            if (
              Array.isArray(liveRun.allowed_tools) &&
              !liveRun.allowed_tools.includes("zink_n8n")
            ) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_POLICY_DENIED",
              };
            }
            const liveInput = event.params?.input ?? event.params ?? {};
            let invocation;
            try {
              invocation = resolveN8nInvocation({
                workflowId: liveInput.workflow_id,
                agentId: context.agentId,
              });
            } catch (registryErr) {
              return {
                allow: false,
                block: true,
                reason: registryErr?.message ?? "RUNTIME_CAPABILITY_MISMATCH",
              };
            }
            if (invocation.requiresApproval) {
              try {
                bindInvocationApproval({
                  paths,
                  approvalId: event.params?.approval_id,
                  taskId: owner.task_id,
                  briefRevision: owner.task.brief_revision,
                  originPrincipalRef:
                    owner.task?.origin_principal_ref ??
                    owner.task?.origin?.origin_principal_ref ??
                    owner.task?.root_principal_ref,
                  toolId: "zink_n8n",
                  operationName: invocation.operationName,
                  actualTarget: invocation.actualTarget,
                  input: liveInput,
                  runId: context.runId,
                  currentTime: Date.now(),
                });
              } catch (approvalErr) {
                return {
                  allow: false,
                  block: true,
                  reason: approvalErr?.message ?? "AUTH_APPROVAL_INVALID",
                };
              }
            }
          } else if (event.toolName === "zink_python") {
            if (event.params?.entrypoint) {
              const pathCheck = await validateLiveArtifactPath(
                String(event.params.entrypoint),
              );
              if (!pathCheck.ok) {
                return {
                  allow: false,
                  block: true,
                  reason: pathCheck.reason,
                };
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

          // Live OpenClaw conversational delegation. The live adapter
          // normalizes its input and then delegates to the ONE canonical spawn
          // gate; it makes no independent topology or authorization decision.
          if (!["main", "o1", "o2"].includes(context.agentId)) {
            return { allow: false, block: true, reason: "UNAUTHORIZED_TARGET" };
          }
          const targetAgentId = event.params?.agentId;
          if (!ids.has(targetAgentId)) {
            return { allow: false, block: true, reason: "UNAUTHORIZED_TARGET" };
          }
          // The canonical policy decides spawn topology. The previous inline
          // map was a hand-maintained copy, so changing AGENT_SPAWN_POLICY
          // would not have changed what this path enforces. The authoritative
          // reservation in guard.beforeToolCall re-derives the same value.
          const allowedTargets = AGENT_SPAWN_POLICY[context.agentId] ?? [];
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
            return {
              allow: false,
              block: true,
              reason: "EXACT_TASK_CORRELATION_REQUIRED",
            };
          }
          if (!owner?.task_id || !owner?.task) {
            return {
              allow: false,
              block: true,
              reason: "EXACT_TASK_CORRELATION_REQUIRED",
            };
          }

          const sanitizedTask = sanitizeDelegationText(
            (parsedProposal && parsedProposal.inputs) ||
              event.params?.task ||
              "Delegated execution",
          );

          const candidateNodeId =
            parsedProposal?.node_id &&
            /^[a-z][a-z0-9_-]{0,63}$/u.test(parsedProposal.node_id)
              ? parsedProposal.node_id
              : `node-${targetAgentId}`;
          let assignedNodeId = candidateNodeId;

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
            const briefRevision = task.brief_revision || 1;

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
                  // M7-016: the activated brief's semantic contract status is
                  // required by the event contract and mirrored onto the task,
                  // because the guard authorizes a specialist against recorded
                  // task state. It comes from the submitted brief, never from
                  // invented state: an absent or unrecognised value is MISSING.
                  semantic_contract_status: normalizeSemanticContractStatus(
                    sanitizedTask?.semantic_contract_status,
                  ),
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
          }

          // M7-019: the live adapter NORMALIZES its input and then delegates
          // to the one canonical spawn gate. It makes no independent policy
          // decision: topology, approval, lineage, attempt derivation and the
          // reservation write all happen in guard.beforeToolCall, which is the
          // same function the synthetic route uses.
          const canonicalProposal = {
            schema_version: SCHEMA_VERSION,
            governance_version:
              parsedProposal?.governance_version ?? GOVERNANCE_VERSION,
            node_id: assignedNodeId,
            inputs: sanitizedTask,
            input_refs: Array.isArray(parsedProposal?.input_refs)
              ? parsedProposal.input_refs
              : [],
            constraints:
              typeof parsedProposal?.constraints === "string"
                ? parsedProposal.constraints
                : "{}",
            validation_criteria:
              typeof parsedProposal?.validation_criteria === "string"
                ? parsedProposal.validation_criteria
                : "agent-result-payload.schema.json",
          };

          const canonicalEvent = {
            toolName: "sessions_spawn",
            toolCallId: event.toolCallId,
            turn:
              typeof event.turn === "number" && event.turn > 0 ? event.turn : 1,
            params: {
              task: JSON.stringify(canonicalProposal),
              agentId: targetAgentId,
              runtime: "subagent",
              mode: "run",
              thread: false,
              context: "isolated",
              sandbox: "require",
              cleanup: "keep",
            },
            batchToolNames: ["sessions_spawn"],
            assistantText: "",
          };

          const canonicalDecision = await guard.beforeToolCall(
            canonicalEvent,
            context,
            signal,
          );
          if (!canonicalDecision?.allow) {
            return (
              canonicalDecision ?? {
                allow: false,
                block: true,
                reason: "SPAWN_RESERVATION_FAILED",
              }
            );
          }

          const spawnParams = {
            ...event.params,
            label: canonicalDecision.spawnLabel,
            task: canonicalDecision.spawnTask,
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
            spawnLabel: canonicalDecision.spawnLabel,
            spawnTask: canonicalDecision.spawnTask,
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
      // T2: the host runtime publishes the provider-usage snapshot it already
      // owns. This is a receipt-publication seam, not a model-callable tool,
      // and it never reads or emits credential material. The published
      // identity is re-bound to the caller that owns the run, so a snapshot
      // cannot be attributed to another agent.
      async recordQuota(snapshot) {
        return guard.recordQuota(snapshot);
      },
      // T2: self-scoped, read-only quota receipt for prompt context. The
      // agentId always comes from trusted runtime context.
      async selfQuotaReceipt(agentId) {
        return guard.selfQuotaReceipt(agentId);
      },
      // T3: run-scoped model resolution. Applies to the CURRENT run only; it
      // never creates a session override and never pins a model to a session.
      async resolveRunModel(args) {
        return guard.resolveRunModel(args);
      },
      beforeRunEnd(event, context) {
        // R19: prompt build has already consumed what it needed, so the
        // admission-time record has no remaining consumer. Dropping it here keeps
        // the store scoped to one run lifecycle; the bound remains the backstop.
        forgetAdmissionLiveness(context.runId);
        // T2: publish provider usage when the runtime supplies it. This is
        // opportunistic and strictly optional: the run-end event is not
        // guaranteed to carry a usage field, and when it does not, NOTHING is
        // recorded and the quota status stays "unknown" — which already keeps
        // the PRIMARY model (UNKNOWN_KEEP_PRIMARY). It never fabricates usage
        // and never blocks the run.
        recordQuotaIfProvided(api, event, context);
        // M7-048: a session key that merely matches the agent:<id>:<id> pattern
        // is not proof of an internal system session, so it cannot bypass
        // end-of-run governance. Only a session that the authoritative ledger
        // does not own AND that carries no governed run identity is treated as
        // an internal system session, and even then the reduced policy still
        // fails closed on provider failure.
        const snapshot = readSnapshot(paths);
        let owner;
        try {
          owner = findSession(snapshot, context.sessionKey, context.runId);
        } catch {
          /* ignore */
        }
        const internal = classifyInternalRunEnd({
          agentId: context.agentId,
          sessionKey: context.sessionKey,
          runId: context.runId,
          ownedByLedger: Boolean(owner),
          // R17: the run-end seam now receives the same liveness fields the
          // admission seam already receives, so it can reuse the ONE predicate
          // instead of holding a second, weaker copy of the rule.
          pureLivenessHeartbeat: isPureLivenessHeartbeat(context),
        });
        if (internal.isInternal) {
          api.logger?.info?.(
            `[zink-governance] beforeRunEnd: internal system session for ${context.agentId}`,
          );
          if (isProviderFailureEvent(event)) {
            return { allow: false, reason: "PROVIDER_UNAVAILABLE" };
          }
          return { allow: true, internalSession: true };
        }
        if (internal.selfKeyedWithRunId) {
          api.logger?.warn?.(
            `[zink-governance] beforeRunEnd: self-keyed session presented a runId; applying full governance`,
          );
        }
        if (owner && !owner.delegation && owner.task?.brief_state === "DRAFT") {
          try {
            recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
              task_id: owner.task_id,
              brief_revision: owner.task.brief_revision || 1,
              semantic_contract_status: "VALID",
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
            // M7-047: the conversational accommodation must never be
            // interpretable as successful task completion. Provider failure
            // returns an explicit non-completion dispatch result, and a
            // result-envelope schema violation is likewise non-completion.
            if (isProviderFailureEvent(event)) {
              api.logger?.warn?.(
                `[zink-governance] beforeRunEnd upstream model failure in Discord session: non-completion dispatch`,
              );
              return {
                allow: false,
                reason: "PROVIDER_UNAVAILABLE",
                taskCompleted: false,
              };
            }
            if (err?.message === "SCHEMA_INVALID") {
              api.logger?.info?.(
                `[zink-governance] beforeRunEnd: Permitting Main conversational Discord reply (non-completion)`,
              );
              return {
                allow: true,
                taskCompleted: false,
                conversational: true,
              };
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

      if (!isDiscordChannel || !ids.has(context.agentId))
        return { allow: false, reason: "POLICY_DENIED" };
      // M7-018: verified sender identity precedes owner authorization.
      const senderAuth = isIngressSenderAuthorized(
        context,
        config.ownerDiscordId,
      );
      if (!senderAuth.ok) return { allow: false, reason: senderAuth.reason };
      if (context.isBot === true || context.author?.bot === true) {
        return { allow: false, reason: "BOT_INGRESS_DENIED" };
      }
      // Direct intake at Discord ingress is strictly Main only (Decision 3 & RC-01).
      if (context.agentId !== "main") {
        return { allow: false, reason: "NON_MAIN_DIRECT_INGRESS" };
      }
      const msgId = context.currentMessageId ?? context.messageId;
      if (typeof msgId !== "string" || !/^[1-9][0-9]{16,19}$/u.test(msgId)) {
        return { allow: false, reason: "LINEAGE_MISMATCH" };
      }
      const routing = resolveIngressRouting({
        message: context.message || {
          id: msgId,
          content: context.content,
          mentions: context.mentions,
          mention_roles: context.mentionRoles,
          author: context.author,
        },
        context,
        identifiers: { discordGuildId: config.discordGuildId },
      });
      if (routing.needs_clarification || routing.target_agents[0] !== "main") {
        return {
          allow: false,
          reason: routing.clarification_reason || "INGRESS_NOT_ADMITTED",
        };
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
        return { allow: false, reason: "DUPLICATE_DISCORD_EVENT" };
      }
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id: taskId,
        root_agent_id: context.agentId,
        root_session_key: context.sessionKey,
        root_run_id: context.runId,
      });
      return { allow: true, taskId };
    }
    api.on("before_prompt_build", async (_event, context = {}) => {
      // R7 G1: an exempt heartbeat has no ledger owner by design, so no
      // governance receipt is built for it. Nothing is fabricated.
      //
      // R19: the host context here omits the liveness sentinel, so this seam needs
      // the admission-time discriminator to reach the verdict admission already
      // reached on this same run. Without it every heartbeat fell through to a
      // ledger lookup, found no owner, and emitted the fail-open
      // `EXECUTION_STATE_UNKNOWN ... report BLOCKED` instruction.
      if (isLivenessHeartbeat(context)) return {};
      try {
        const owner = findSession(
          readSnapshot(paths),
          context.sessionKey,
          context.runId,
        );
        // T2: self-scoped, read-only quota telemetry. This is context, not
        // a model-callable tool, so it grants no session-control capability.
        // The agent identity comes from trusted runtime context, so an agent
        // can only ever observe its own provider quota. A null receipt (no
        // telemetry) is honest and keeps PRIMARY downstream.
        const quotaSelfRead = await quotaReceiptFor(config, context.agentId);
        const receipt = {
          schema_version: SCHEMA_VERSION,
          governance_version: GOVERNANCE_VERSION,
          task_id: owner.task_id,
          brief_revision: owner.task.brief_revision,
          remaining_task_budget: {
            // The ceilings are canonical (BUDGETS in topology/lib/ledger.mjs),
            // the same table the guard and the reducer enforce. Restating the
            // numbers here meant a ceiling change could reach the receipt
            // without reaching enforcement, or the reverse.
            revisions:
              BUDGETS.maxBriefRevisionsPerTask - owner.task.revisions_used,
            transitions:
              BUDGETS.maxStackTransitionsPerTask - owner.task.transitions_used,
            delegated_runs:
              BUDGETS.maxTotalDelegatedRunsPerTask -
              owner.task.delegated_runs_used,
          },
          quota_self_read: quotaSelfRead,
        };
        if (quotaSelfRead === null) delete receipt.quota_self_read;
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
        // R7 correction: before_prompt_build is an ADVISORY OpenClaw hook. Its
        // result type has no blocking channel, runModifyingHook() catches every
        // handler exception, and both host call sites additionally swallow the
        // rejection. Throwing here is therefore fail-OPEN: the turn would
        // continue with no governance instruction at all.
        //
        // So this hook stays advisory and returns an explicit BLOCKED
        // instruction instead. The enforcing control for an unresolvable run is
        // the native governance boundary (enterNativeRun -> beforeRun), which
        // the host does propagate: it fails the turn with
        // GOVERNANCE_RUN_UNAVAILABLE and preserves the cause.
        api.logger?.error?.(
          `zink governance before_prompt_build: ${error?.message ?? error}`,
        );
        return {
          prependContext:
            "[Trusted governance] EXECUTION_STATE_UNKNOWN. Do not delegate; report BLOCKED.",
        };
      }
    });
    /**
     * M7-045 / M7-046: a native child that cannot be bound to the recorded
     * lineage must not be allowed to keep running, and the incident must land
     * in the authoritative ledger rather than in a log line.
     *
     * The blocker writes WORKFLOW_NATIVE_ENDED using identity taken from the
     * LEDGER, never from the untrusted event, so the event is schema-valid and
     * truthful. That write moves the owning run to UNKNOWN and the task to
     * BLOCKED, which is the enforceable state every other path consults. The
     * returned decision additionally tells the host not to proceed.
     */
    const blockUnreconciledNativeRun = ({ reason, runId, childSessionKey }) => {
      const blocked = [];
      let ledgerWritten = false;
      let ledgerError = null;
      let scope = "NONE";
      try {
        const snapshot = readSnapshot(paths);
        const live = (run) =>
          !["COMPLETE", "FAILED", "CANCELLED"].includes(run.run_state);
        const candidates = [];
        for (const [task_id, task] of Object.entries(snapshot.tasks ?? {})) {
          for (const run of Object.values(task.delegations ?? {})) {
            // Identity must come from the ledger's own record of the run.
            const identityMatch =
              (typeof runId === "string" && run.native_run_id === runId) ||
              (typeof childSessionKey === "string" &&
                run.child_session_key === childSessionKey);
            candidates.push({
              task_id,
              task,
              run,
              identityMatch,
              live: live(run),
            });
          }
        }
        const identified = candidates.filter((c) => c.identityMatch);
        // An unreconciled child that matches no recorded run means at least one
        // live run's identity is in doubt, so every live run is suspended until
        // an operator reconciles. Containment is fail-closed by construction,
        // not by trusting the event's own identity claim.
        const targets =
          identified.length > 0 ? identified : candidates.filter((c) => c.live);
        scope =
          identified.length > 0
            ? "IDENTIFIED_RUN"
            : targets.length > 0
              ? "ALL_LIVE_RUNS"
              : "NONE";
        for (const { task_id, task, run } of targets) {
          if (task.workflow_status === "BLOCKED") {
            blocked.push({ task_id, alreadyTerminal: true });
            continue;
          }
          try {
            recordWorkflowEvent(paths, "WORKFLOW_NATIVE_ENDED", {
              task_id,
              native_run_id: run.native_run_id,
              child_session_key: run.child_session_key,
              parent_session_key: run.parent_session_key,
              outcome: "error",
              recorded_at: new Date().toISOString(),
            });
            ledgerWritten = true;
            blocked.push({ task_id, alreadyTerminal: false });
          } catch (writeErr) {
            ledgerError = writeErr?.message ?? String(writeErr);
          }
        }
      } catch (readErr) {
        ledgerError = readErr?.message ?? String(readErr);
      }
      return {
        allow: false,
        blocked: true,
        governanceState: ledgerWritten ? "BLOCKED" : "UNKNOWN",
        reason,
        scope,
        blockedTasks: blocked,
        // When the authoritative ledger could not be written at all, the state
        // is UNKNOWN rather than BLOCKED: nothing may assume the child is
        // contained until the ledger says so.
        ledgerWriteFailed: !ledgerWritten,
        ledgerError,
      };
    };

    api.on("subagent_ended", (event, context = {}) => {
      const runId = context.runId || event.runId;
      const childSessionKey = context.childSessionKey || event.targetSessionKey;
      try {
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
        return { allow: true, governanceState: "RECORDED" };
      } catch (err) {
        // M7-045: a completion that cannot be written is a governance
        // incident, not a log line. Execution is blocked until reconciled.
        api.logger?.error?.(
          `zink governance completion: ${err?.message ?? err}`,
        );
        return blockUnreconciledNativeRun({
          reason: "NATIVE_COMPLETION_UNRECONCILED",
          runId,
          childSessionKey,
        });
      }
    });
    api.on("subagent_spawned", (event, context = {}) => {
      let reconciled = true;
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
      } catch (err) {
        // M7-046: an unknown or mismatched child receipt is an authoritative
        // incident. The child already exists outside the recorded lineage, so
        // the recorded lineage is suspended until an operator reconciles it.
        reconciled = false;
        api.logger?.error?.(
          `zink governance spawn: EXECUTION_STATE_UNKNOWN: ${err?.message ?? err}`,
        );
      } finally {
        // A pending run-start wait must never hang, on either path.
        for (const check of [...startingRuns]) check();
      }
      if (!reconciled) {
        return blockUnreconciledNativeRun({
          // The operator-facing reason code is preserved so the incident stays
          // correlatable; it is carried on the blocking decision, not smuggled
          // into a ledger payload that the contract does not admit.
          reason: "SPAWN_LINEAGE_MISMATCH",
          runId: event.runId,
          childSessionKey: event.childSessionKey,
        });
      }
      return { allow: true, governanceState: "RECORDED" };
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

      // Suppress specialist messages: specialists are execution agents, never direct broadcasters to #office
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
        Boolean(
          ctx.threadId ||
          event.threadId ||
          ctx.parentChannelId ||
          event.parentChannelId,
        );
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
                await ctx.respond.followUp({
                  text: invalidMsg,
                  ephemeral: true,
                });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({ text: invalidMsg, ephemeral: true });
              }
              return;
            }

            const ownerId = resolveOwnerDiscordId(config);
            const senderSnowflake =
              ctx.senderId ||
              ctx.interaction?.senderId ||
              ctx.interaction?.user?.id ||
              ctx.interaction?.member?.user?.id;
            if (senderSnowflake !== ownerId) {
              const unauthMsg =
                "⛔ Bạn không có quyền phê duyệt kế hoạch này. Chỉ User/Owner mới có thẩm quyền.";
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({
                  text: unauthMsg,
                  ephemeral: true,
                });
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
                sendNativePayload({
                  api,
                  to: threadId,
                  threadId,
                  accountId: "o1",
                  payload: { text: confirmText },
                }).catch((deliveryErr) => {
                  api.logger?.warn?.(
                    `[zink-governance] discord delivery failed (thread-confirm-notice): ${deliveryErr?.message}`,
                  );
                });
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
                  // M7-012: complete only from the verified owner principal
                  // bound to the current authoritative result digest.
                  // senderSnowflake was verified === ownerId above.
                  defaultQueueManager.completeTask({
                    taskId: parsed.taskId,
                    userConfirmationRef: "user-button-accept",
                    userPrincipalRef: senderSnowflake,
                    resultDigest: defaultQueueManager.getTask(parsed.taskId)
                      ?.resultDigest,
                  });
                } catch (qErr) {
                  api.logger?.warn?.(
                    `[zink-governance] completeTask warning: ${qErr?.message}`,
                  );
                }

                const officeChannelId =
                  config.discordOfficeChannelId ||
                  config.officeChannelId ||
                  "1545425766161063937";
                if (officeChannelId) {
                  const resultsForumId =
                    config.discordResultsForumId ||
                    config.resultsChannelId ||
                    "1545696269010477056";
                  sendNativePayload({
                    api,
                    to: officeChannelId,
                    accountId: "main",
                    payload: {
                      text: `🎉 **Chúc mừng!** Anh Zink đã chính thức nghiệm thu kết quả tác vụ \`${parsed.taskId.slice(0, 8)}\` tại <#${resultsForumId}>. Tác vụ đã hoàn tất xuất sắc và được lưu trữ an toàn trong sổ cái governance. Quản Lý xin cảm ơn anh Zink!`,
                    },
                  }).catch((deliveryErr) => {
                    api.logger?.warn?.(
                      `[zink-governance] discord delivery failed (office-completion-notice-button): ${deliveryErr?.message}`,
                    );
                  });
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
        const ownerId = resolveOwnerDiscordId(config);
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

        const requestedTaskId =
          event.taskId ||
          event.task_id ||
          ctx.taskId ||
          activeTasks
            .map((task) => task.task_id)
            .find((taskId) => content.includes(taskId));
        if (!requestedTaskId) {
          api.logger?.warn?.(
            "[zink-governance] text action blocked: EXACT_TASK_CORRELATION_REQUIRED",
          );
          return;
        }
        const pendingTask = activeTasks.find(
          (task) => task.task_id === requestedTaskId,
        );
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

          if (threadId) {
            await sendNativePayload({
              api,
              to: threadId,
              threadId,
              accountId: "o1",
              payload: { text: confirmText },
            });
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
              // M7-012: senderId was verified === ownerId above; bind the
              // current authoritative result digest.
              defaultQueueManager.completeTask({
                taskId: pendingTask.task_id,
                userConfirmationRef: "user-text-accept",
                userPrincipalRef: senderId,
                resultDigest: defaultQueueManager.getTask(pendingTask.task_id)
                  ?.resultDigest,
              });
            } catch (qErr) {
              api.logger?.warn?.(
                `[zink-governance] completeTask text warning: ${qErr?.message}`,
              );
            }

            const officeChannelId =
              config.discordOfficeChannelId ||
              config.officeChannelId ||
              "1545425766161063937";
            if (officeChannelId) {
              const resultsForumId =
                config.discordResultsForumId ||
                config.resultsChannelId ||
                "1545696269010477056";
              sendNativePayload({
                api,
                to: officeChannelId,
                accountId: "main",
                payload: {
                  text: `🎉 **Chúc mừng!** Anh Zink đã chính thức nghiệm thu kết quả tác vụ \`${pendingTask.task_id.slice(0, 8)}\` tại <#${resultsForumId}>. Tác vụ đã hoàn tất xuất sắc và được lưu trữ an toàn trong sổ cái governance. Quản Lý xin cảm ơn anh Zink!`,
                },
              }).catch((deliveryErr) => {
                api.logger?.warn?.(
                  `[zink-governance] discord delivery failed (office-completion-notice-text): ${deliveryErr?.message}`,
                );
              });
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
