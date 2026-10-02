import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
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
  findBoundCoordinatorRun,
  resolveCurrentRunOwner,
} from "../../topology/lib/workflow.mjs";

import {
  createCoordinatorRuntimeStart,
  startCoordinatorPickupLoop,
  PICKUP_SCAN_INTERVAL_MS,
  parseCoordinatorSessionKey,
} from "../../lib/coordinator-pickup.mjs";
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
  APPROVAL_SUBJECT_TYPES,
  buildComponentCustomId,
  buildSkillComponentCustomId,
  parseComponentCustomId,
  DISCORD_COMPONENT_ACTION_NAMESPACE,
  resolveIngressRouting,
  AGENT_IDS,
} from "../../lib/authority.mjs";

import {
  QueueManager,
  defaultQueueManager,
  isExecutableCoordinator,
} from "../../lib/queue-manager.mjs";

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
  const directProposalId =
    approvalRecord.proposal_id || approvalRecord.proposal?.proposal_id;
  if (directProposalId && directProposalId !== proposalId) {
    globalThis[PENDING_PROPOSALS_KEY].set(directProposalId, approvalRecord);
  }
}

export function getPendingSkillProposal(proposalId) {
  return globalThis[PENDING_PROPOSALS_KEY]?.get(proposalId) || null;
}

// ---------------------------------------------------------------------------
// Durable skill-proposal store.
//
// The file under the governed operator state directory
// (`<ledgerRoot>/skill-proposals/<proposal_id>.json`) is AUTHORITATIVE for
// pending skill proposals. The in-memory map above is a cache/index only:
// after a process restart the proposal must still resolve from disk, replay
// must still be rejected idempotently, and a missing record must fail
// closed. Proposal ids are 32-hex digests, so the derived filename can
// never escape the store directory.
// ---------------------------------------------------------------------------

const PROPOSAL_ID_PATTERN = /^[a-f0-9]{32}$/u;
const CONTENT_SHA_PATTERN = /^[a-f0-9]{64}$/u;

export function skillProposalFilePath(proposalStorageDir, proposalId) {
  if (typeof proposalStorageDir !== "string" || !proposalStorageDir)
    return null;
  if (typeof proposalId !== "string" || !PROPOSAL_ID_PATTERN.test(proposalId))
    return null;
  return path.join(proposalStorageDir, `${proposalId}.json`);
}

export function skillApprovalFilePath(proposalStorageDir, proposalId) {
  const proposalFile = skillProposalFilePath(proposalStorageDir, proposalId);
  if (!proposalFile) return null;
  return `${proposalFile}.approval.json`;
}

function writeJsonAtomicSync(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, filePath);
}

function readJsonStrictSync(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function readDurableSkillProposal(proposalStorageDir, proposalId) {
  const file = skillProposalFilePath(proposalStorageDir, proposalId);
  if (!file) return null;
  try {
    const record = readJsonStrictSync(file);
    if (!record || record.proposal_id !== proposalId) return null;
    return record;
  } catch {
    // A partially written or corrupt file is never a valid proposal.
    return null;
  }
}

function rawContentSha256(text) {
  return createHash("sha256")
    .update(String(text ?? ""), "utf8")
    .digest("hex");
}

/**
 * Corroborates an approval binding against the durable proposal. A full
 * 64-hex digest must match exactly; the compact 16-hex button fragment
 * (Discord caps custom_id at 100 chars) must prefix the stored digest.
 * This is corroboration only — the approval itself always binds the exact
 * bytes read back from the durable store.
 */
function skillProposalBindingMatches(stored, contentSha256) {
  if (!stored || typeof contentSha256 !== "string") return false;
  return (
    contentSha256 === stored.content_sha256 ||
    (/^[a-f0-9]{16}$/u.test(contentSha256) &&
      stored.content_sha256.startsWith(contentSha256))
  );
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
  namespace,
  capability,
  version,
  subjectType = APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL,
  skillsRoot,
  proposalStorageDir,
  // No default, deliberately. A hardcoded default would place a real account
  // identifier in production source — forbidden outside `tests/` by this
  // repository's own `.gitleaks.toml` — and, worse, would keep authorizing that
  // account whenever a caller forgot to bind the expected principal. The
  // parameter is required so the exact-identity binding is always explicit, and
  // an omitted value fails the comparison below and denies the approval.
  expectedOwnerId,
  decisionRef = "PLAN:M8/T3-R1",
  options = {},
}) {
  // Distinct governance subject: a skill approval is never an execution-plan
  // approval and vice versa. The wrong subject on this path is denied.
  if (subjectType !== APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL) {
    throw new Error(
      "APPROVAL_SUBJECT_MISMATCH: expected SKILL_CANDIDATE_APPROVAL on the skill approval path",
    );
  }
  // Exact owner snowflake binding (BUG-06). An absent owner identity denies.
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
  if (!contentSha256 || !CONTENT_SHA_PATTERN.test(contentSha256)) {
    throw new Error(
      "APPROVAL_CONTENT_HASH_INVALID: Content hash must be 64-character SHA-256",
    );
  }
  const nsArray = Array.isArray(namespace)
    ? namespace
    : typeof namespace === "string" && namespace
      ? [namespace]
      : null;
  if (
    !nsArray ||
    typeof capability !== "string" ||
    typeof version !== "string"
  ) {
    throw new Error(
      "APPROVAL_IDENTITY_REQUIRED: namespace, capability and version must bind the approval",
    );
  }
  const storeDir = proposalStorageDir ?? options.proposalStorageDir;
  if (!storeDir || typeof storeDir !== "string") {
    throw new Error(
      "PROPOSAL_STORE_UNAVAILABLE: durable proposal store is not configured",
    );
  }
  if (!skillsRoot || typeof skillsRoot !== "string") {
    throw new Error(
      "SKILLS_ROOT_REQUIRED: canonical Skill Store root is required",
    );
  }

  // The durable record is authoritative. A missing, unreadable or partial
  // record fails closed — it is never treated as "probably okay".
  const stored = readDurableSkillProposal(storeDir, proposalId);
  if (!stored) {
    throw new Error(
      "APPROVAL_UNKNOWN_PROPOSAL: no durable proposal for this approval",
    );
  }

  // Exact proposal binding: identity and content must all match.
  const storedNs = Array.isArray(stored.namespace)
    ? stored.namespace
    : [stored.namespace];
  if (
    stored.content_sha256 !== contentSha256 ||
    storedNs.join("/") !== nsArray.join("/") ||
    stored.capability !== capability ||
    stored.version !== version
  ) {
    throw new Error(
      "APPROVAL_PROPOSAL_MISMATCH: approval does not bind the stored proposal exactly",
    );
  }

  // Terminal and lifecycle states.
  if (stored.status === "REJECTED") {
    throw new Error("APPROVAL_PROPOSAL_REJECTED: candidate was rejected");
  }
  if (
    typeof stored.expires_at === "string" &&
    Number.isFinite(Date.parse(stored.expires_at)) &&
    Date.parse(stored.expires_at) <= Date.now()
  ) {
    try {
      writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
        ...stored,
        status: "EXPIRED",
      });
    } catch {
      /* best effort */
    }
    throw new Error("APPROVAL_PROPOSAL_EXPIRED: candidate is expired");
  }
  if (stored.status === "EXPIRED") {
    throw new Error("APPROVAL_PROPOSAL_EXPIRED: candidate is expired");
  }
  if (stored.status === "CONFLICTED") {
    throw new Error(
      "APPROVAL_SKILL_CONFLICT: candidate conflicts with canonical state",
    );
  }
  if (
    stored.status !== "CANDIDATE" &&
    stored.status !== "APPROVED" &&
    stored.status !== "MATERIALIZED" &&
    stored.status !== "READY"
  ) {
    throw new Error(
      `APPROVAL_PROPOSAL_STATE_INVALID: unexpected status ${stored.status}`,
    );
  }

  // Idempotent replay: the exact same approval binding already completed.
  const approvalFile = skillApprovalFilePath(storeDir, proposalId);
  let completed = null;
  try {
    completed = readJsonStrictSync(approvalFile);
  } catch {
    /* absent or unreadable: no completed approval */
  }
  if (completed?.approval_status === "APPROVED") {
    const sameBinding =
      completed.proposal_id === proposalId &&
      completed.content_sha256 === contentSha256 &&
      (completed.namespace ?? []).join("/") === nsArray.join("/") &&
      completed.capability === capability &&
      completed.version === version;
    if (!sameBinding) {
      throw new Error(
        "APPROVAL_PROPOSAL_MISMATCH: a different approval already consumed this proposal id",
      );
    }
    // The canonical record must still hold the approved bytes. Approval
    // replay after canonical tampering is drift, not idempotent success.
    try {
      const canonicalBytes = readFileSync(
        path.join(skillsRoot, ...nsArray, capability, version, "SKILL.md"),
      );
      if (rawContentSha256(canonicalBytes) !== contentSha256) {
        throw new Error(
          "APPROVAL_CANONICAL_DRIFT: canonical bytes no longer match the approved digest",
        );
      }
    } catch (error) {
      if (error?.message?.startsWith("APPROVAL_CANONICAL_DRIFT")) throw error;
      throw new Error(
        `APPROVAL_CANONICAL_DRIFT: canonical record is unreadable (${error?.code ?? error?.message})`,
        { cause: error },
      );
    }
    return { ...completed, idempotent: true };
  }

  // The owner approves the exact bytes that will be persisted.
  if (
    typeof stored.content !== "string" ||
    rawContentSha256(stored.content) !== contentSha256
  ) {
    throw new Error(
      "APPROVAL_PROPOSAL_MISMATCH: durable content does not match the approved digest",
    );
  }

  // Canonical Skill Store write is the source-of-truth commit point.
  // Trusted internal promotion only: agents propose, governance promotes.
  const catalogMod = await loadRepoModule("zink-skill-store/src/catalog.mjs");
  const promote = catalogMod?.promoteApprovedSkill;
  if (typeof promote !== "function") {
    throw new Error(
      "APPROVAL_PROMOTE_UNAVAILABLE: canonical Skill Store writer is unavailable",
    );
  }
  let canonical;
  try {
    canonical = await promote({
      skillsRoot,
      namespace: nsArray,
      capability,
      version,
      content: stored.content,
      requestingActor: stored.requesting_agent ?? "unknown",
      ownerActor: "owner",
      decisionRef,
    });
  } catch (error) {
    if (
      error?.code === "SKILL_ACTIVE_CONFLICT" ||
      error?.code === "SKILL_VERSION_CONFLICT"
    ) {
      try {
        writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
          ...stored,
          status: "CONFLICTED",
        });
      } catch {
        /* best effort */
      }
      throw new Error(
        `APPROVAL_SKILL_CONFLICT: ${error?.message ?? "canonical conflict"}`,
        {
          cause: error,
        },
      );
    }
    throw error;
  }
  try {
    writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
      ...stored,
      status: "MATERIALIZED",
    });
  } catch {
    /* best effort: canonical truth already holds */
  }

  // pgvector is derived from canonical ACTIVE state, never the reverse. A
  // sync failure keeps the canonical record authoritative and is reported
  // as a derived-index failure; it never rolls the canonical write back.
  let vectorSync;
  try {
    const report = options.vectorSyncFn
      ? await options.vectorSyncFn({ skillsRoot, proposal: stored })
      : await (
          await getVectorSyncModule()
        ).syncSkillsToVectorStore({ skillsRoot, ...options });
    vectorSync = {
      status: report?.status ?? "UNKNOWN",
      synced_count: report?.synced_count ?? 0,
    };
    try {
      writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
        ...stored,
        status: report?.status === "READY" ? "READY" : "INDEX_FAILED",
      });
    } catch {
      /* best effort */
    }
  } catch (error) {
    vectorSync = {
      status: "FAILED",
      error: String(error?.message ?? error).slice(0, 500),
    };
    try {
      writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
        ...stored,
        status: "INDEX_FAILED",
      });
    } catch {
      /* best effort */
    }
  }

  // K18: distinct approval transaction identity for this governance act.
  const approvalTransactionId = `appr_${createHash("sha256")
    .update(
      `${proposalId}:${contentSha256}:${Date.now()}:${randomBytes(8).toString("hex")}`,
    )
    .digest("hex")
    .slice(0, 24)}`;
  const record = {
    approval_transaction_id: approvalTransactionId,
    proposal_id: proposalId,
    content_sha256: contentSha256,
    namespace: nsArray,
    capability,
    version,
    subject_type: APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL,
    approval_status: "APPROVED",
    canonical,
    vector_sync: vectorSync,
    approved_at: new Date().toISOString(),
  };
  try {
    writeJsonAtomicSync(approvalFile, record);
  } catch {
    /* best effort: canonical truth already holds */
  }
  globalThis[PENDING_PROPOSALS_KEY].set(proposalId, {
    ...stored,
    status: "READY",
    approval_id: approvalTransactionId,
  });
  return record;
}

/**
 * Owner confirmation for a taught decision candidate.
 *
 * USER EXPLICITLY TEACHES -> candidate (untrusted, unpersisted) ->
 * classification -> OWNER CONFIRMS -> DecisionLedger persists -> a new
 * session looks it up. Only `preference-decision` candidates land in the
 * ledger; every other classification is routed elsewhere and this call
 * persists nothing. Observed answers alone never reach the ledger: only
 * this owner-confirmed path writes.
 */
export async function handleOwnerDecisionConfirmation({
  senderId,
  config,
  candidate,
  ledgerStoragePath,
  mode = "record",
  options = {},
}) {
  const ownerId = resolveOwnerDiscordId(config);
  if (!ownerId || senderId !== ownerId) {
    throw new Error(
      "DECISION_OWNER_MISMATCH: only the owner can confirm memory",
    );
  }
  if (!candidate || typeof candidate !== "object") {
    throw new Error("DECISION_CANDIDATE_REQUIRED");
  }
  const { MEMORY_CLASSIFICATIONS: classifications } =
    await import("../../lib/decision-ledger.mjs");
  if (!classifications.includes(candidate.classification)) {
    throw new Error(
      "DECISION_CANDIDATE_AMBIGUOUS: classification is required before memory may form",
    );
  }
  if (candidate.classification !== "preference-decision") {
    const routes = {
      "reusable-procedure": "SKILL_PROPOSAL_PATH",
      "factual-knowledge": "KNOWLEDGE_GOVERNANCE_PATH",
      "operational-state": "WORKFLOW_STATE_ONLY",
    };
    const notes = {
      "reusable-procedure":
        "Use proposeSkillFromTeaching to create a governed skill candidate; nothing was persisted by this call.",
      "factual-knowledge":
        "User-written Knowledgebase persistence is intentionally deferred in M8/T3: the Knowledgebase adapter forbids ingestion/update by contract and the human-owned Vault is read-only. This routing persists nothing and must not be reported as stored knowledge.",
      "operational-state":
        "Current task/execution state only; never long-term memory. Nothing was persisted.",
    };
    return {
      status: "ROUTED",
      route: routes[candidate.classification] ?? "UNKNOWN",
      persisted: false,
      note: notes[candidate.classification] ?? "Nothing was persisted.",
    };
  }
  const storagePath =
    ledgerStoragePath ??
    options.ledgerStoragePath ??
    (path.isAbsolute(config?.ledgerRoot ?? "")
      ? path.join(config.ledgerRoot, "decision-ledger.json")
      : null);
  if (!storagePath) {
    throw new Error(
      "DECISION_STORE_UNAVAILABLE: decision ledger path is not configured",
    );
  }
  const { DecisionLedger } = await import("../../lib/decision-ledger.mjs");
  const ledger = new DecisionLedger({ storagePath });
  if (mode === "correct") {
    const corrected = ledger.correctDecision({
      topic: candidate.topic,
      question: candidate.question,
      decision: candidate.proposed_decision,
      scope: candidate.scope,
      confirmedBy: ownerId,
      context: {
        ...(candidate.context ?? {}),
        ...(candidate.task_id ? { taskId: candidate.task_id } : {}),
        ...(candidate.domain ? { domain: candidate.domain } : {}),
        candidate_key: candidate.candidate_key,
      },
      tags: ["owner-confirmed", "correction"],
    });
    return {
      status: "CORRECTED",
      decision: corrected,
      persisted: true,
    };
  }
  if (mode !== "record") {
    throw new Error(`DECISION_MODE_INVALID: unknown mode ${mode}`);
  }
  const recorded = ledger.recordDecision({
    topic: candidate.topic,
    question: candidate.question,
    decision: candidate.proposed_decision,
    scope: candidate.scope,
    confirmedBy: ownerId,
    context: {
      ...(candidate.context ?? {}),
      ...(candidate.task_id ? { taskId: candidate.task_id } : {}),
      ...(candidate.domain ? { domain: candidate.domain } : {}),
      candidate_key: candidate.candidate_key,
    },
    tags: ["owner-confirmed"],
  });
  return { status: "RECORDED", decision: recorded, persisted: true };
}

/**
 * Bridges an owner-confirmed reusable-procedure teaching into the existing
 * governed skill proposal infrastructure. The teaching must already carry
 * classification `reusable-procedure` (anything else fails closed here);
 * the exact procedure bytes become a CANDIDATE proposal that still needs
 * owner approval — this bridge never activates anything by itself.
 */
export async function proposeSkillFromTeaching({
  teaching,
  namespace,
  capability,
  version,
  content,
  reason,
  requestingAgent,
  proposalStorageDir,
  context = {},
  options = {},
}) {
  if (!teaching || teaching.classification !== "reusable-procedure") {
    throw new Error(
      "TEACHING_NOT_A_SKILL: only reusable-procedure teachings may enter the skill proposal path",
    );
  }
  const nsArray =
    namespace ??
    (Array.isArray(teaching.namespace)
      ? teaching.namespace
      : typeof teaching.namespace === "string"
        ? [teaching.namespace]
        : null);
  const capabilitySlug = capability ?? teaching.capability;
  const versionString = version ?? teaching.version;
  const procedureBytes = content ?? teaching.content;
  if (
    !nsArray ||
    typeof capabilitySlug !== "string" ||
    typeof versionString !== "string" ||
    typeof procedureBytes !== "string" ||
    !procedureBytes.trim()
  ) {
    throw new Error(
      "TEACHING_CONTENT_REQUIRED: namespace, capability, version and exact procedure bytes are required",
    );
  }
  const storeDir = proposalStorageDir ?? options.proposalStorageDir;
  if (!storeDir || typeof storeDir !== "string") {
    throw new Error(
      "PROPOSAL_STORE_UNAVAILABLE: durable proposal store is not configured",
    );
  }
  const skillMod = await getSkillAdapter();
  const Adapter = skillMod?.SkillAdapter;
  if (typeof Adapter !== "function") {
    throw new Error(
      "SKILL_ADAPTER_UNAVAILABLE: cannot propose without the skill adapter",
    );
  }
  const adapter = new Adapter(undefined, {
    proposalStorageDir: storeDir,
    ...options,
  });
  const result = await adapter.querySkillStore(
    {
      action: "propose",
      namespace: nsArray,
      capability: capabilitySlug,
      version: versionString,
      content: procedureBytes,
      reason:
        reason ?? teaching.reason ?? "Promoted from owner-confirmed teaching",
      requesting_agent:
        requestingAgent ?? teaching.requesting_agent ?? context?.agentId,
    },
    { agentId: requestingAgent ?? teaching.requesting_agent ?? "unknown" },
  );
  if (result?.governed_status !== "SUCCESS" || !result?.proposal) {
    throw new Error(
      `SKILL_PROPOSAL_FAILED: ${result?.error ?? "proposal was not accepted"}`,
    );
  }
  return { status: "CANDIDATE_PROPOSED", proposal: result.proposal };
}

/**
 * Skill rejection on the dedicated learning path. Owner-only, bound to the
 * exact durable proposal. A rejected candidate can never become ACTIVE.
 */
export async function handleOwnerSkillRejection({
  ownerDiscordId,
  expectedOwnerId,
  proposalId,
  proposalStorageDir,
  options = {},
}) {
  if (ownerDiscordId !== expectedOwnerId) {
    throw new Error(
      "APPROVAL_OWNER_MISMATCH: Unauthorized principal cannot reject skills",
    );
  }
  const storeDir = proposalStorageDir ?? options.proposalStorageDir;
  if (!storeDir || typeof storeDir !== "string") {
    throw new Error(
      "PROPOSAL_STORE_UNAVAILABLE: durable proposal store is not configured",
    );
  }
  const stored = readDurableSkillProposal(storeDir, proposalId);
  if (!stored) {
    throw new Error(
      "APPROVAL_UNKNOWN_PROPOSAL: no durable proposal for this rejection",
    );
  }
  if (stored.status !== "CANDIDATE") {
    throw new Error(
      `APPROVAL_ALREADY_DECIDED: candidate is already ${stored.status}`,
    );
  }
  writeJsonAtomicSync(skillProposalFilePath(storeDir, proposalId), {
    ...stored,
    status: "REJECTED",
  });
  return { proposal_id: proposalId, approval_status: "REJECTED" };
}

/**
 * Builds the #office learning-confirmation card for a skill candidate:
 * human-readable proposal text plus native approve/reject buttons whose
 * custom_ids bind the exact proposal (and corroborate the content digest
 * within Discord's 100-char custom_id ceiling). The buttons round-trip
 * through `handleSkillDiscordAction`; posting the card to #office is the
 * poster's job and is not performed here.
 */
export function buildSkillProposalCard(proposal) {
  if (!proposal || typeof proposal !== "object") {
    throw new Error("SKILL_CARD_PROPOSAL_REQUIRED");
  }
  const text = formatApprovalNotification({ proposal });
  const approveCustomId = buildSkillComponentCustomId(
    DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_APPROVE,
    proposal.proposal_id,
    proposal.content_sha256,
  );
  const rejectCustomId = buildSkillComponentCustomId(
    DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_REJECT,
    proposal.proposal_id,
    proposal.content_sha256,
  );
  return {
    text,
    proposal_id: proposal.proposal_id,
    content_sha256: proposal.content_sha256,
    buttons: [
      {
        customId: approveCustomId,
        label: "Approve skill",
        style: 3,
        emoji: { name: "✅" },
      },
      {
        customId: rejectCustomId,
        label: "Reject",
        style: 4,
        emoji: { name: "❌" },
      },
    ],
  };
}

/**
 * Dedicated Discord learning-confirmation handler for skill proposals.
 *
 * This is the ONLY Discord path that may approve or reject a skill
 * candidate. It operates on the skill proposal identity (proposal_id plus
 * exact content digest), posts to the #office learning surface, and never
 * touches the workflow ledger, the execution queue, or
 * `executeApprovedTask`. The generic execution-plan APPROVE path must
 * never reach here and this path must never reach it.
 */
export async function handleSkillDiscordAction({
  action,
  proposalId,
  contentSha256,
  senderId,
  config,
  skillsRoot,
  proposalStorageDir,
  notify,
  options = {},
}) {
  const ownerId = resolveOwnerDiscordId(config);
  if (!ownerId || senderId !== ownerId) {
    return { ok: false, reason: "APPROVAL_OWNER_MISMATCH" };
  }
  if (action === "reject") {
    try {
      const storeDir = proposalStorageDir ?? options.proposalStorageDir;
      const stored = readDurableSkillProposal(storeDir, proposalId);
      if (!skillProposalBindingMatches(stored, contentSha256)) {
        return { ok: false, reason: "APPROVAL_PROPOSAL_MISMATCH" };
      }
      const result = await handleOwnerSkillRejection({
        ownerDiscordId: senderId,
        expectedOwnerId: ownerId,
        proposalId,
        proposalStorageDir: storeDir,
        options,
      });
      await notify?.({
        channel: "office",
        text: `📝 Skill proposal \`${proposalId}\` rejected. It can never become ACTIVE.`,
      });
      return { ok: true, status: "REJECTED", ...result };
    } catch (error) {
      return { ok: false, reason: error?.message ?? String(error) };
    }
  }
  if (action !== "approve") {
    return { ok: false, reason: "UNKNOWN_SKILL_ACTION" };
  }
  try {
    const storeDir = proposalStorageDir ?? options.proposalStorageDir;
    const stored = readDurableSkillProposal(storeDir, proposalId);
    if (!stored) {
      return { ok: false, reason: "APPROVAL_UNKNOWN_PROPOSAL" };
    }
    // The button corroborates identity only; the approval below binds the
    // exact bytes read back from the durable store.
    if (!skillProposalBindingMatches(stored, contentSha256)) {
      return { ok: false, reason: "APPROVAL_PROPOSAL_MISMATCH" };
    }
    const approval = await handleOwnerSkillApproval({
      ownerDiscordId: senderId,
      expectedOwnerId: ownerId,
      proposalId,
      // Exact server-side binding: the approval always names the full
      // stored digest, never the button corroborator.
      contentSha256: stored.content_sha256,
      namespace: stored.namespace,
      capability: stored.capability,
      version: stored.version,
      skillsRoot,
      proposalStorageDir: storeDir,
      options,
    });
    await notify?.({
      channel: "office",
      text: `✅ Skill \`${stored.capability}\` v${stored.version} approved and materialized as ACTIVE.`,
    });
    return { ok: true, status: "APPROVED", approval };
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) };
  }
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

  // Discriminated approval subjects: a skill-candidate approval is a
  // governance transaction on the dedicated #office learning path. It must
  // never queue workflow execution through this generic handler.
  if (
    data?.approvalSubject === APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL
  ) {
    return {
      allowed: false,
      reason:
        "SKILL_APPROVAL_SEPARATE_PATH: skill approvals use the dedicated skill approval path, never the execution approval handler",
      status: "DENIED",
    };
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

/**
 * Derive the governed execution target for an approved task from the
 * AUTHORITATIVE task record.
 *
 * Nothing here is a default. A missing or non-executable coordinator, an empty
 * DAG, a DAG naming an agent outside the canonical roster, and a DAG that asks a
 * coordinator for a specialist it may not spawn are all fail-closed BLOCKED
 * outcomes, because guessing would mean running work under an identity or a
 * topology the owner never approved. The coordinator is never assumed to be
 * "o1" and the specialist set is never assumed to be a fixed list: both come
 * from the task the owner actually approved, so the plugin cannot dispatch a
 * task to a capability that was never part of its plan.
 *
 * Containment is checked against the canonical AGENT_SPAWN_POLICY, which is the
 * same table `guard.beforeToolCall` enforces on the live `sessions_spawn` path.
 * A graph that is not reachable through canonical topology is a governance
 * error: the offending specialist is never silently dropped, the coordinator is
 * never silently replaced, and the task is never narrowed to the runnable
 * subset, because the owner approved the whole graph.
 */
export function deriveGovernedDispatchTarget(task) {
  if (!task || typeof task !== "object") {
    return {
      ok: false,
      error: "TASK_NOT_FOUND",
    };
  }
  const coordinator = task.primary_coordinator;
  if (!isExecutableCoordinator(coordinator)) {
    return {
      ok: false,
      error: "COORDINATOR_NOT_EXECUTABLE",
    };
  }
  const requiredCapabilities = (Array.isArray(task.nodes) ? task.nodes : [])
    .map((node) => node?.agent_id)
    .filter((agentId) => typeof agentId === "string" && agentId.length > 0);
  // The roster is canonical, so a DAG naming an unknown agent is a governance
  // defect and must not be narrowed into a runnable subset.
  const unknown = requiredCapabilities.filter(
    (agentId) => !AGENT_IDS.includes(agentId),
  );
  if (unknown.length > 0) {
    return { ok: false, error: "UNKNOWN_SPECIALIST_IN_DAG" };
  }
  if (requiredCapabilities.length === 0) {
    return { ok: false, error: "NO_EXECUTABLE_SPECIALIST" };
  }
  // Canonical topology containment. Read the table that the live spawn gate
  // enforces rather than introducing a local copy, so a topology change can
  // never be legal here and illegal there.
  const spawnable = AGENT_SPAWN_POLICY[coordinator] ?? [];
  const unreachable = requiredCapabilities.filter(
    (agentId) => !spawnable.includes(agentId),
  );
  if (unreachable.length > 0) {
    return {
      ok: false,
      error: "SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR",
      unreachable,
      coordinator,
    };
  }
  return { ok: true, coordinator, requiredCapabilities };
}

/**
 * Decide what a post-approval invocation must do, given the authoritative queue
 * state and whether the coordinator notification was delivered.
 *
 * This is the whole queue/release consistency policy, expressed as a pure
 * function so it can be proven directly rather than inferred. The invariants:
 *
 *  - A duplicate approval NEVER creates a second execution and never
 *    re-notifies a handoff that already succeeded.
 *  - A duplicate approval MAY retry a notification that never landed, because
 *    the durable record says it did not.
 *  - `RELEASED_TO_COORDINATOR` is not representable. A delivered Discord POST
 *    is not an accepted handoff, so the most that can be reported is that the
 *    task is durably queued and awaiting a coordinator pickup that nothing in
 *    this repository currently performs.
 */
export function resolveCoordinatorHandoffOutcome({ preExisting, delivered }) {
  if (preExisting) {
    if (preExisting.coordinatorNotification?.delivered === true) {
      return {
        status: "QUEUED",
        queue_status: preExisting.status,
        handoff: "ALREADY_NOTIFIED",
      };
    }
    return {
      status: "QUEUED",
      queue_status: preExisting.status,
      handoff: delivered ? "NOTIFIED" : "NOTIFICATION_FAILED",
    };
  }
  if (!delivered) {
    return {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "NOTIFICATION_FAILED",
    };
  }
  return {
    status: "QUEUED",
    queue_status: "QUEUED",
    handoff: "AWAITING_COORDINATOR_PICKUP",
  };
}

/**
 * Reservation window for an in-flight coordinator notification.
 *
 * A Discord POST is an external, potentially slow side effect, so the shared
 * cross-process file lock is deliberately NOT held across it: that lock has no
 * stale reclaim, so a crash mid-send would wedge the queue permanently. Instead
 * the attempt is claimed in-process for a bounded window, which is where the
 * real concurrency lives: the plugin is a single OpenClaw gateway process, and
 * two Discord APPROVE actions arrive as two overlapping handler invocations in
 * that one process.
 */
export const NOTIFICATION_ATTEMPT_TTL_MS = 60_000;

const notificationAttempts = new Map();

/**
 * Claim the single in-flight notification attempt for a task.
 *
 * Returns a release function on success, or `null` when another attempt already
 * holds the reservation. The reservation is released in a `finally` by the
 * caller, so a thrown transport never leaks it. The TTL bounds the damage if a
 * process dies mid-send: the window closes and the task becomes retryable again.
 *
 * LIMITATION, stated rather than hidden: this is an in-process guard, so it does
 * NOT provide cross-process exactly-once delivery. Two separate plugin processes
 * sharing one queue could still both notify. The repository has no cross-process
 * idempotency key that the Discord transport would honour, and inventing one
 * would be a new mechanism, so the honest claim is: at most one notification
 * attempt per task per process per TTL window.
 */
export function reserveCoordinatorNotificationAttempt(
  taskId,
  {
    now = Date.now(),
    ttlMs = NOTIFICATION_ATTEMPT_TTL_MS,
    registry = notificationAttempts,
  } = {},
) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    return null;
  }
  for (const [key, entry] of registry) {
    if (now - entry.startedAt > ttlMs) registry.delete(key);
  }
  if (registry.has(taskId)) {
    return null;
  }
  const entry = { startedAt: now };
  registry.set(taskId, entry);
  return () => {
    if (registry.get(taskId) === entry) {
      registry.delete(taskId);
    }
  };
}

export function isCoordinatorNotificationAttemptInFlight(
  taskId,
  {
    now = Date.now(),
    ttlMs = NOTIFICATION_ATTEMPT_TTL_MS,
    registry = notificationAttempts,
  } = {},
) {
  const entry = registry.get(taskId);
  return Boolean(entry) && now - entry.startedAt <= ttlMs;
}

/**
 * Classify the outcome of one notification attempt.
 *
 * The three cases are materially different and are never collapsed:
 *  - not delivered: the record stays retryable.
 *  - delivered and persisted: future duplicates short-circuit, because durable
 *    state now knows the message exists.
 *  - delivered but NOT persisted: the Discord message exists, but durable local
 *    knowledge of that does not. Reporting NOTIFIED here would claim an
 *    idempotency the repository does not have and would let a later duplicate
 *    send a second message while claiming the first was known. The honest answer
 *    is that the state is uncertain, and the delivery evidence is carried through
 *    so an operator can reconcile it.
 */
function classifyNotificationAttempt({
  delivered,
  persisted,
  error,
  evidence,
}) {
  if (!delivered) {
    return {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "NOTIFICATION_FAILED",
      ...(error ? { error } : {}),
    };
  }
  if (!persisted) {
    return {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "NOTIFICATION_STATE_UNCERTAIN",
      error:
        error ??
        "COORDINATOR_NOTIFICATION_PERSIST_FAILED: the notification was accepted by the transport but the durable record was not written",
      ...(evidence ? { delivery_evidence: evidence } : {}),
    };
  }
  return {
    status: "QUEUED",
    queue_status: "QUEUED",
    handoff: "NOTIFIED",
    ...(evidence ? { delivery_evidence: evidence } : {}),
  };
}

/**
 * Perform at most one coordinator notification attempt for a task.
 *
 * This is the SINGLE owner of the notification side effect. Both the first
 * approval and a duplicate approval route through it, so they share one guard
 * and the reservation is acquired exactly once, by whichever caller owns the
 * actual send. Nesting the reservation inside a second helper would make the
 * first path reserve and then immediately lose to itself, which is exactly the
 * double-reserve bug this shape avoids.
 *
 * The reservation is claimed BEFORE the await, so a concurrent caller that
 * arrives while the transport is in flight sees the held reservation and does
 * not send. The `finally` surrounds the actual send plus the persistence
 * outcome, so a throwing transport, a failed send and a failed durable write all
 * release it, and a later approval can still retry.
 */
export async function runNotificationAttempt({
  taskId,
  notify,
  persist,
  reserve,
}) {
  const release = reserve ? reserve(taskId) : null;
  if (reserve && !release) {
    // Another attempt owns the send right now. Say so plainly: no transport, no
    // persist, and no claim that a notification exists or that work started.
    return {
      status: "QUEUED",
      queue_status: "QUEUED",
      handoff: "NOTIFICATION_IN_PROGRESS",
      notified: false,
      persisted: false,
    };
  }

  try {
    const retry = await notify();
    const delivered = Boolean(retry?.delivered);
    // `{ ok: false }` is a truthy object, so the persistence result must be read
    // by its own field. Coercing the object previously reported a failed write
    // as a successful one, which is exactly the claim that must not be made.
    const record = persist?.({
      delivered,
      error: retry?.error,
      evidence: retry?.evidence ?? null,
    });
    const persisted = record?.ok === true;
    return {
      ...classifyNotificationAttempt({
        delivered,
        persisted,
        // The persistence error is the diagnostic that matters here, so it is
        // preferred over the transport error when the write itself failed. It
        // must stay inspectable instead of being replaced by a generic message.
        error: !delivered ? retry?.error : (record?.error ?? retry?.error),
        evidence: retry?.evidence ?? null,
      }),
      notified: true,
      // `persisted` means a delivered notification is now durably recorded, which
      // is what lets a future duplicate short-circuit. A failed send may well
      // have written a failure record, but that records the absence of a
      // delivery, so it must not be reported as a persisted delivery.
      persisted: delivered && persisted,
    };
  } finally {
    // Released on every path, including a throwing transport, so a failed send
    // cannot leave the task permanently un-notifiable.
    release?.();
  }
}

/**
 * The FIRST-approval notification segment, after the durable queue write.
 *
 * Extracted so the shipped first-approval send is directly testable, for the
 * same reason the duplicate branch is. The defect this closes was invisible to
 * tests that exercised the shared helper directly: an inline first-path send
 * would still reserve inside the helper, so only a test that drives THIS
 * function — the one `executeApprovedTask` actually calls — can detect the
 * missing reservation, and only a test that overlaps the await can detect the
 * resulting duplicate.
 *
 * Status mapping for a first approval:
 *  - delivered and durably recorded: QUEUED + AWAITING_COORDINATOR_PICKUP.
 *  - delivered but the record failed: NOTIFICATION_STATE_UNCERTAIN, with the
 *    transport evidence, because the message exists.
 *  - delivery failed: NOTIFICATION_FAILED, retryable.
 *  - another attempt already owns the send: NOTIFICATION_IN_PROGRESS, and no
 *    claim that a notification exists.
 */
export async function runFirstApprovalNotification({
  taskId,
  coordinator,
  requiredCapabilities,
  notify,
  persist,
  reserve,
}) {
  const attempt = await runNotificationAttempt({
    taskId,
    notify,
    persist,
    reserve,
  });

  if (
    attempt.handoff === "NOTIFICATION_IN_PROGRESS" ||
    attempt.handoff === "NOTIFICATION_FAILED" ||
    attempt.handoff === "NOTIFICATION_STATE_UNCERTAIN"
  ) {
    // Reported verbatim. The queue write above is truthful in every case, so the
    // caller learns exactly what did and did not happen.
    return { ...attempt, taskId };
  }

  return {
    // A delivered, durably recorded notification on the first approval means the
    // task is queued and awaiting a coordinator pickup, which is the strongest
    // claim this path can make. It is NOT a released handoff and NOT a start of
    // execution.
    status: "QUEUED",
    queue_status: "QUEUED",
    handoff: "AWAITING_COORDINATOR_PICKUP",
    taskId,
    notified: attempt.notified,
    persisted: attempt.persisted,
    ...(attempt.delivery_evidence
      ? { delivery_evidence: attempt.delivery_evidence }
      : {}),
    coordinator,
    requiredCapabilities,
  };
}

/**
 * The duplicate-approval branch of the post-approval path.
 *
 * This is extracted so the branch that actually runs is directly testable with
 * an injected transport, rather than only through the pure outcome policy. The
 * previous version reported ALREADY_NOTIFIED correctly but still invoked the
 * transport first, so a duplicate approval after a successful notification sent
 * a second Discord message. Reporting the right thing while performing the wrong
 * side effect is still wrong, because the message is the user-visible artefact.
 *
 * Invariants:
 *  - A record whose notification already landed is never re-notified, and its
 *    record is left untouched.
 *  - A record that is no longer an `QUEUED` handoff (EXECUTING, or any terminal
 *    queue state) is left completely alone: no transport, no queue rewrite, no
 *    workflow event. Its authoritative state is preserved verbatim.
 *  - Everything else delegates to the single shared attempt, so this path and
 *    the first-approval path cannot both send for the same task.
 *
 * `RELEASED_TO_COORDINATOR` is not representable here either: the highest claim
 * is a delivered notification still awaiting a coordinator pickup.
 */
export async function runDuplicateApprovalHandoff({
  taskId,
  preExisting,
  notify,
  persist,
  reserve,
}) {
  // Status guard first. An item that has moved past the queued-handoff stage is
  // not an approval replay, so it must not be notified, rewritten, or re-stated
  // as a fresh QUEUED outcome.
  if (!preExisting || preExisting.status !== "QUEUED") {
    return {
      ...resolveCoordinatorHandoffOutcome({
        preExisting: null,
        delivered: true,
      }),
      status: preExisting?.status ?? "QUEUED",
      queue_status: preExisting?.status ?? "QUEUED",
      handoff: "ALREADY_PROCESSED",
      // Explicitly no transport call and no record mutation for this branch.
      notified: false,
      persisted: false,
    };
  }

  // A notification that already landed must not be repeated.
  if (preExisting.coordinatorNotification?.delivered === true) {
    return {
      ...resolveCoordinatorHandoffOutcome({
        preExisting,
        delivered: true,
      }),
      notified: false,
      persisted: false,
    };
  }

  // One shared attempt owner: the reservation is acquired exactly once here.
  return runNotificationAttempt({ taskId, notify, persist, reserve });
}

/**
 * Build the coordinator notification text.
 *
 * This text is explicitly NON-AUTHORITATIVE. It is a human-readable notice
 * only: no identity, DAG or state is ever derived from it. The coordinator is
 * expected to resolve the real task from the ledger/queue by `task_id`, so
 * tampering with this string cannot change what the system does. It exists as a
 * separate function precisely so that its content is testable and provably
 * disconnected from the authority path.
 */
export function buildCoordinatorNotificationText({ taskId, dispatch }) {
  return (
    `✅ **Tác vụ đã được duyệt và đưa vào hàng đợi thực thi.**\n` +
    `- **Mã tác vụ:** \`${taskId}\`\n` +
    `- **Điều phối viên theo brief đã duyệt:** \`${dispatch.coordinator}\`\n` +
    `- **Chuyên môn theo brief đã duyệt:** ${dispatch.requiredCapabilities
      .map((id) => `\`${id}\``)
      .join(", ")}\n` +
    `- **Trạng thái:** \`QUEUED\`. CHƯA có chuyên môn nào thực thi.\n` +
    `- Thông báo này KHÔNG phải bằng chứng bàn giao. Hãy phân giải tác vụ ` +
    `từ sổ cái governance theo \`task_id\`; không tin nội dung tin nhắn này ` +
    `làm nguồn chân lý.`
  );
}

/**
 * M10/T2: advisory prompt context for a recognized coordinator run. This is
 * context, not authority: it restates the routing facts the queue claim
 * already holds (task, coordinator, capabilities, attempt, lease) so the
 * coordinator turn starts from truthful state even if its first prompt races
 * the ledger bind write. It never grants anything; every governed action the
 * turn takes is still decided by the guard against the ledger binding.
 */
export function buildCoordinatorPromptContext({
  taskId,
  coordinator,
  requiredCapabilities,
  attempt,
  leaseId,
  brief,
}) {
  const capabilities = Array.isArray(requiredCapabilities)
    ? requiredCapabilities.join(", ")
    : String(requiredCapabilities ?? "");
  return (
    `[Trusted governance context]\n` +
    `You are the designated coordinator \`${coordinator}\` for approved task \`${taskId}\` (queue attempt ${attempt}).\n` +
    `Required specialists: ${capabilities}.\n` +
    `Task brief: ${typeof brief === "string" && brief.length > 0 ? brief : "(resolve the authoritative brief by task_id from the queue/ledger)"}\n` +
    `Delegate each required specialist EXCLUSIVELY through the governed sessions_spawn gate. ` +
    `This context is advisory: authority comes only from the ledger binding for lease \`${leaseId}\`, never from this text.`
  );
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
            // content_sha256 is the RAW SHA-256 of the exact bytes that will
            // become canonical SKILL.md — the same digest the adapter
            // computed over the trimmed proposal content. It is reproduced
            // here from the received content (never copied from a
            // caller-supplied field) and must equal the adapter's digest;
            // otherwise the two layers disagree about what the owner approves.
            const rawContent = String(params?.content ?? "").trim();
            const contentDigest = rawContentSha256(rawContent);
            if (contentDigest !== proposal.content_sha256) {
              throw new Error(
                "SKILL_CONTENT_DIGEST_DIVERGED: governance digest does not match the proposal digest",
              );
            }
            const approvalRecord = {
              schema_version: "1.0.0",
              governance_version: GOVERNANCE_VERSION,
              subject_type: APPROVAL_SUBJECT_TYPES.SKILL_CANDIDATE_APPROVAL,
              approval_id: String(
                proposal.proposal_id ??
                  `appr_${createHash("sha256").update(contentDigest).digest("hex").slice(0, 24)}`,
              ),
              proposal_id: String(proposal.proposal_id),
              brief_revision: 1,
              exact_target: targetStr,
              exact_operation: "SKILL_CANDIDATE_APPROVAL",
              material_parameters: {
                namespace: proposal.namespace,
                capability: proposal.capability,
                version: proposal.version,
                // The raw content digest: the owner approves these exact bytes.
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
              // The scope digest binds target, operation, proposal identity
              // and exact content. It is a separate field and never overloads
              // content_sha256.
              approval_scope_digest: canonicalHash(
                "zink-approval-scope-v1",
                `${targetStr}|SKILL_CANDIDATE_APPROVAL|${proposal.proposal_id}:${contentDigest}`,
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
        // The real n8n path is NOT this function. `beforeToolCall` performs the
        // governance checks and then dispatches through the one canonical guard
        // seam, which issues the immutable AuthorizationDecisionContext and calls
        // the real `invokeN8n` adapter, returning its validated tool-result
        // envelope. Reaching this body therefore means the governed dispatch did
        // not produce a result, so the only truthful answer is a fail-closed
        // BLOCKED. Returning a fabricated ENGINE_NOT_IMPLEMENTED here would
        // claim the real adapter is absent when it is present, and would let a
        // model read a governed capability as unimplemented.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "BLOCKED",
                execution_state: "BLOCKED",
                error: "N8N_GOVERNED_DISPATCH_REQUIRED",
                tool: "zink_n8n",
                workflow_id: params?.workflow_id,
                message:
                  "n8n executes only through the governed dispatch seam. No governed result was produced, so no workflow was triggered.",
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
        // No Power BI executor exists anywhere in the repository. A local
        // stand-in, a URL string, or a fabricated receipt would be a fake
        // success, so this stays explicitly not-implemented and reports BLOCKED
        // so the governance layer can never record a result for work that did
        // not happen.
        const op = params?.operation || "validate";
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "BLOCKED",
                execution_state: "BLOCKED",
                error: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_power_bi",
                operation: op,
                implemented: false,
                message:
                  "No Power BI executor is implemented in this repository. No model was created, refreshed, or validated. This capability is NOT IMPLEMENTED.",
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
        // No Python sandbox is implemented. Host `python`, `child_process`,
        // PowerShell, WSL, and Docker-from-host are all deliberately NOT used
        // here: each would execute model-influenced input outside the governed
        // boundary. Stays explicitly not-implemented and reports BLOCKED.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                status: "BLOCKED",
                execution_state: "BLOCKED",
                error: "ENGINE_NOT_IMPLEMENTED",
                tool: "zink_python",
                entrypoint: params?.entrypoint,
                stack: params?.stack,
                implemented: false,
                message:
                  "No governed Python sandbox is implemented. No script was executed. This capability is NOT IMPLEMENTED.",
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

/**
 * An outbound Discord destination, from validated configuration only.
 *
 * Every call site previously fell back to a hardcoded production channel or
 * forum id, which meant that a runtime whose configuration was missing or
 * incomplete would still post into a specific real Discord surface that
 * configuration never designated. That is precisely the cross-channel-write
 * hazard, so there is no fallback at all: a destination that configuration does
 * not supply is unresolved, and every caller then declines to send.
 *
 * Returning `undefined` is the fail-closed signal. Callers must not substitute a
 * default, and must not treat a missing destination as "broadcast anywhere".
 */
function resolveDiscordDestination(config, ...fieldNames) {
  for (const field of fieldNames) {
    const value = config?.[field];
    if (typeof value === "string" && /^[1-9][0-9]{16,19}$/u.test(value))
      return value;
  }
  return undefined;
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

      const approvalsForumId = resolveDiscordDestination(
        config,
        "discordApprovalsForumId",
        "approvalsChannelId",
      );
      if (!approvalsForumId) {
        // Fail closed: without a configured destination the approval card is not
        // posted anywhere rather than posted into a hardcoded production forum.
        api.logger?.error?.(
          "[zink-governance] approval card not posted: no configured approvals forum",
        );
        return;
      }
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
              // The forum's STATUS:WAITING tag, a stable workflow-semantics constant of
              // the approvals surface itself (not an identity and not authentication
              // material). It is applied only to threads the plugin itself opens in the
              // configured approvals forum, so it cannot redirect anything anywhere.
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

    /**
     * Resolve the post-approval coordinator destination.
     *
     * This is a PREFLIGHT step. It runs before the durable queue write so that a
     * missing destination cannot leave a queue item that no coordinator can
     * ever pick up.
     */
    function resolveCoordinatorDestination({ config, originThreadId }) {
      const officeChannelId = resolveDiscordDestination(
        config,
        "discordOfficeChannelId",
        "officeChannelId",
      );
      const target = originThreadId || officeChannelId;
      if (!target) {
        return { ok: false, error: "COORDINATOR_DESTINATION_UNRESOLVED" };
      }
      return { ok: true, target, isThread: Boolean(originThreadId) };
    }

    async function deliverCoordinatorNotification({
      api,
      destination,
      taskId,
      dispatch,
    }) {
      try {
        // The native transport returns the accepted message identity. It is
        // kept as delivery evidence so an operator can reconcile a notification
        // whose durable record failed to persist. It is never used to infer
        // delivery from the message text, and the text is never authority.
        const receipt = await sendNativePayload({
          api,
          to: destination.target,
          ...(destination.isThread ? { threadId: destination.target } : {}),
          accountId: dispatch.coordinator,
          payload: {
            text: buildCoordinatorNotificationText({ taskId, dispatch }),
          },
        });
        return {
          delivered: true,
          evidence: {
            message_id: receipt?.messageId ?? null,
            channel_id: receipt?.channelId ?? null,
          },
        };
      } catch (deliveryErr) {
        api.logger?.error?.(
          `[zink-governance] coordinator notification failed: ${deliveryErr?.message}`,
        );
        return {
          delivered: false,
          error: `COORDINATOR_NOTIFICATION_FAILED: ${deliveryErr?.message ?? "unknown"}`,
        };
      }
    }

    function enqueueApprovedTaskForExecution({ taskId, paths, dispatch }) {
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
        // A late or duplicate approval must never start a second execution.
        return { status: existing.status, taskId, queueItem: existing };
      }
      const queueItem = defaultQueueManager.enqueueTask({
        taskId,
        planVersion: String(task.brief_revision || "1.0"),
        primaryCoordinator: dispatch.coordinator,
        requiredCapabilities: dispatch.requiredCapabilities,
        payload: task.payload || {},
      });
      return { status: "QUEUED", taskId, queueItem };
    }

    /**
     * Record the outcome of the post-enqueue coordinator notification on the
     * queue item.
     *
     * The queue is a projection of the ledger, so this records an operational
     * fact about the projection (was the notification delivered?) and never
     * claims an execution state. It deliberately does NOT touch
     * `workflow_status`, because the authoritative task state is the ledger's
     * `QUEUED` and nothing here may advance it. Persisting the flag is what
     * makes an incomplete handoff observable and safely retryable instead of a
     * silent stuck state.
     *
     * The write is transactional in the same shape `enqueueTask` uses: the
     * in-memory projection is only advanced once the durable save succeeds, and
     * is rolled back if it does not. Without that, a failed save would leave
     * memory claiming the notification landed while the file did not, and the
     * caller could not tell which was true.
     *
     * The accepted message identity is stored alongside the flag as delivery
     * evidence. It is reconciliation material for an operator, not authority:
     * nothing in the governed path reads it to make a decision.
     */
    function recordCoordinatorNotification({
      taskId,
      delivered,
      error,
      evidence,
    }) {
      const item = defaultQueueManager.getTask(taskId);
      if (!item) {
        return { ok: false, error: "QUEUE_ITEM_NOT_FOUND" };
      }
      const next = {
        ...item,
        coordinatorNotification: {
          delivered: Boolean(delivered),
          ...(delivered
            ? { evidence: evidence ?? null }
            : { error: String(error ?? "UNKNOWN") }),
        },
      };
      defaultQueueManager.queue.set(taskId, next);
      try {
        defaultQueueManager.save();
        return { ok: true };
      } catch (persistErr) {
        defaultQueueManager.queue.set(taskId, item);
        return { ok: false, error: persistErr?.message };
      }
    }

    /**
     * Post-approval dispatch.
     *
     * The governance plugin is a governance layer, NOT an executor. It never
     * runs a task, never fabricates an artifact, and never claims a result. It
     * makes the approved task durably QUEUED, which is the canonical ledger
     * state, and notifies the coordinator named by the authoritative brief.
     *
     * Ordering is chosen to eliminate the split-brain that the previous
     * ordering permitted. Every precondition that can be checked without a
     * durable write is checked first, so a task that could never be dispatched
     * is never queued. The queue write is then idempotent, and a failed
     * notification is recorded rather than left implicit, so a later duplicate
     * approval can retry the notification without ever creating a second
     * execution.
     */
    async function executeApprovedTask({
      taskId,
      paths,
      config,
      api,
      originThreadId = null,
    }) {
      const snapshot = paths ? readSnapshot(paths) : null;
      const task = snapshot?.tasks?.[taskId];
      const dispatch = deriveGovernedDispatchTarget(task);
      if (!dispatch.ok) {
        // Fail closed BEFORE any durable queue write: a task that cannot be
        // dispatched must not appear queued for execution.
        api.logger?.error?.(
          `[zink-governance] approved task not dispatched: ${dispatch.error} (task ${taskId})`,
        );
        return {
          status: "BLOCKED",
          error: dispatch.error,
          taskId,
          queue_status: "NOT_QUEUED",
        };
      }

      // Preflight the destination BEFORE the durable write. A missing
      // destination means no coordinator could ever be told, so queueing first
      // would strand the task permanently.
      const destination = resolveCoordinatorDestination({
        config,
        originThreadId,
      });
      if (!destination.ok) {
        api.logger?.error?.(
          `[zink-governance] approved task not queued: ${destination.error} (task ${taskId})`,
        );
        return {
          status: "BLOCKED",
          error: destination.error,
          taskId,
          queue_status: "NOT_QUEUED",
        };
      }

      const preExisting = defaultQueueManager.getTask(taskId);
      if (preExisting) {
        const duplicate = await runDuplicateApprovalHandoff({
          taskId,
          preExisting,
          notify: () =>
            deliverCoordinatorNotification({
              api,
              destination,
              taskId,
              dispatch,
            }),
          persist: ({ delivered, error, evidence }) =>
            recordCoordinatorNotification({
              taskId,
              delivered,
              error,
              evidence,
            }),
          reserve: reserveCoordinatorNotificationAttempt,
        });
        return { ...duplicate, taskId };
      }

      let queueStatus;
      try {
        queueStatus = enqueueApprovedTaskForExecution({
          taskId,
          paths,
          dispatch,
        });
      } catch (err) {
        api.logger?.error?.(
          `[zink-governance] approved task queueing failed: ${err?.message}`,
        );
        return {
          status: "BLOCKED",
          error: "QUEUE_STORAGE_WRITE_FAILED",
          taskId,
          queue_status: "NOT_QUEUED",
        };
      }
      if (queueStatus.status !== "QUEUED") {
        return { ...queueStatus, taskId };
      }

      // The first approval owns the send through the SAME shared attempt as a
      // duplicate. Previously it sent inline with no reservation, so a duplicate
      // arriving while the transport was awaiting could claim the reservation
      // and send a second message. One guard now covers both callers, and the
      // reservation is acquired exactly once, here.
      const attempt = await runFirstApprovalNotification({
        taskId,
        coordinator: dispatch.coordinator,
        requiredCapabilities: dispatch.requiredCapabilities,
        notify: () =>
          deliverCoordinatorNotification({
            api,
            destination,
            taskId,
            dispatch,
          }),
        persist: ({ delivered, error, evidence }) =>
          recordCoordinatorNotification({
            taskId,
            delivered,
            error,
            evidence,
          }),
        reserve: reserveCoordinatorNotificationAttempt,
      });

      if (attempt.handoff === "AWAITING_COORDINATOR_PICKUP") {
        api.logger?.info?.(
          `[zink-governance] approved task queued and coordinator ${dispatch.coordinator} notified: ${taskId}`,
        );
      }
      return attempt;
    }

    /**
     * M10/T2: recognize a gateway-started coordinator run from its session
     * identity. Recognition is strict and layered:
     *  1. the session key must parse as the approved coordinator shape AND name
     *     the observed agent — a key alone never attributes a run;
     *  2. the queue must hold that task EXECUTING, claimed by that coordinator
     *     — the live claim is what makes this OUR run rather than a coincidence;
     *  3. the ledger binding (session_key + run_id for the claimed attempt) is
     *     consulted when `requireBinding` is set. Authority-adjacent decisions
     *     (run-end bypass, spawn/end attribution) require it; purely advisory
     *     context (prompt build) may proceed on the queue claim alone so a
     *     first prompt that races the bind write still gets truthful context.
     * Anything less returns null and the caller keeps its existing fail-closed
     * behavior. Nothing here writes state.
     */
    function resolveCoordinatorRun(
      sessionKey,
      runId,
      agentId,
      { requireBinding = false } = {},
    ) {
      const parsed = parseCoordinatorSessionKey(sessionKey);
      if (!parsed) return null;
      // Lifecycle events do not always carry the agent identity (notably
      // subagent_ended). When present it must agree with the key; when absent
      // the coordinator is taken from the key and then confirmed by the queue
      // claim and the ledger binding below — the key alone never attributes.
      const coordinator =
        typeof agentId === "string" && agentId.length > 0
          ? agentId
          : parsed.coordinator;
      if (parsed.coordinator !== coordinator) return null;
      const queueItem = defaultQueueManager.getTask(parsed.taskId);
      if (!queueItem || queueItem.status !== "EXECUTING") return null;
      if (queueItem.claimedBy !== parsed.coordinator) return null;
      // A snapshot read failure means the binding cannot be established, which
      // is indistinguishable from absent for recognition purposes; the caller
      // keeps its fail-closed behavior either way.
      const found = (() => {
        try {
          return findBoundCoordinatorRun(
            readSnapshot(paths),
            sessionKey,
            runId,
            agentId,
          );
        } catch {
          return null;
        }
      })();
      const binding = found?.coordinatorRun ?? null;
      if (requireBinding && !binding) return null;
      return {
        taskId: parsed.taskId,
        coordinator: parsed.coordinator,
        attempt: parsed.attempt,
        queueItem,
        binding,
        bound: Boolean(binding),
      };
    }

    /**
     * M10/T2: production coordinator pickup loop. Exactly one scheduler
     * instance per plugin registration: it scans authoritative ledger/queue
     * state every PICKUP_SCAN_INTERVAL_MS, claims as the designated
     * coordinator, records the ledger claim, starts the real coordinator turn
     * through api.runtime.subagent.run, and then records the ledger binding.
     * Started once below; stopped on gateway_stop. Never started when the
     * ledger snapshot is absent, so a broken ledger cannot produce claims.
     */
    const coordinatorRuntime = createCoordinatorRuntimeStart({ api });
    let coordinatorPickupLoop = null;
    const ledgerSnapshotPresent = (() => {
      try {
        return existsSync(paths.snapshot);
      } catch {
        return false;
      }
    })();
    if (ledgerSnapshotPresent) {
      coordinatorPickupLoop = startCoordinatorPickupLoop({
        queueManager: defaultQueueManager,
        getLedgerTasks: () => readSnapshot(paths).tasks ?? {},
        deriveTarget: deriveGovernedDispatchTarget,
        recordClaimed: async ({ taskId: claimedTaskId, agentId }) => {
          recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
            task_id: claimedTaskId,
            agent_id: agentId,
          });
        },
        recordBound: async (event) => {
          recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", event);
        },
        startCoordinatorRun: coordinatorRuntime.startCoordinatorRun,
        isRuntimeStartAvailable: coordinatorRuntime.isRuntimeStartAvailable,
        intervalMs: PICKUP_SCAN_INTERVAL_MS,
        logger: api.logger,
      });
      coordinatorPickupLoop.start();
      api.logger?.info?.("[zink-governance] coordinator pickup loop started");
    } else {
      api.logger?.error?.(
        "[zink-governance] coordinator pickup not started: ledger snapshot missing",
      );
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

            // Dispatch through the ONE canonical governed seam. The guard
            // issues the immutable AuthorizationDecisionContext and calls the
            // real `invokeN8n`; this path adds no authorization of its own and
            // never calls the adapter directly. The validated tool-result
            // envelope it returns is the only truthful n8n outcome, so the
            // model-visible tool reports exactly that instead of a fabricated
            // ENGINE_NOT_IMPLEMENTED.
            const canonicalN8nDecision = await guard.beforeToolCall(
              {
                toolName: "zink_n8n",
                toolCallId: event.toolCallId,
                turn:
                  typeof event.turn === "number" && event.turn > 0
                    ? event.turn
                    : 1,
                params: {
                  call_id: event.params?.call_id ?? null,
                  specialist: context.agentId,
                  tool_id: "zink_n8n",
                  input: liveInput,
                },
                batchToolNames: ["zink_n8n"],
                assistantText: "",
              },
              context,
              signal,
            );
            if (canonicalN8nDecision?.allow) {
              return canonicalN8nDecision;
            }
            if (canonicalN8nDecision && canonicalN8nDecision.status) {
              // The guard already produced a normalized tool-result envelope
              // (success, error, or timeout). It is a real outcome and must be
              // surfaced verbatim rather than replaced with a stub status.
              return canonicalN8nDecision;
            }
            return (
              canonicalN8nDecision ?? {
                allow: false,
                block: true,
                reason: "SPAWN_RESERVATION_FAILED",
              }
            );
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
        // M10/T2: a BOUND coordinator end is not a task-completion claim
        // (coordinator result ingestion is a separate future task), so it must
        // not run completion-claim governance and must not be denied as one.
        // Recognition requires the ledger binding, not just the queue claim:
        // ending a run is authority-adjacent. Anything less falls through to
        // the existing fail-closed path below.
        const coordinatedEnd = resolveCoordinatorRun(
          context.sessionKey,
          context.runId,
          context.agentId,
          { requireBinding: true },
        );
        if (coordinatedEnd) {
          api.logger?.info?.(
            `[zink-governance] coordinator run ended without completion claim: task ${coordinatedEnd.taskId} attempt ${coordinatedEnd.attempt}`,
          );
          return { allow: true, taskCompleted: false, coordinatorRun: true };
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
      try {
        coordinatorPickupLoop?.stop();
      } catch {
        // Shutdown must not throw: the loop holds no authority and the queue
        // persists independently.
      }
      coordinatorPickupLoop = null;
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
      // M10/T2: a recognized coordinator run gets its authoritative brief as
      // advisory context — never the unresolvable-run BLOCKED instruction
      // below, which would sabotage the turn it is meant to serve. Recognition
      // here needs only the queue claim (advisory level), so a first prompt
      // that races the ledger bind write still starts from truthful state.
      // Authority for everything the turn does still comes from the ledger
      // binding via the guard, never from this text.
      const coordinatedPrompt = resolveCoordinatorRun(
        context.sessionKey,
        context.runId,
        context.agentId,
      );
      if (coordinatedPrompt) {
        const brief =
          typeof coordinatedPrompt.queueItem?.payload?.brief === "string"
            ? coordinatedPrompt.queueItem.payload.brief
            : null;
        return {
          prependContext: buildCoordinatorPromptContext({
            taskId: coordinatedPrompt.taskId,
            coordinator: coordinatedPrompt.coordinator,
            requiredCapabilities:
              coordinatedPrompt.queueItem?.requiredCapabilities ?? [],
            attempt: coordinatedPrompt.attempt,
            leaseId: coordinatedPrompt.queueItem?.leaseId ?? null,
            brief,
          }),
        };
      }
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
      // M10/T2: a recognized coordinator run ending is attributed narrowly to
      // its own task attempt — never to the unreconciled-run containment below,
      // which must not suspend unrelated live runs over a run this governance
      // layer started itself. No result is recorded here (result ingestion is a
      // separate future task); the queue/ledger state advances only through the
      // existing lease and stale-recovery semantics.
      const coordinatedEnd = resolveCoordinatorRun(
        childSessionKey,
        runId,
        context.agentId ?? event.agentId,
      );
      if (coordinatedEnd) {
        api.logger?.info?.(
          `[zink-governance] coordinator run ended: task ${coordinatedEnd.taskId} attempt ${coordinatedEnd.attempt} bound=${coordinatedEnd.bound} outcome=${event?.outcome ?? "unknown"}`,
        );
        return { allow: true, governanceState: "COORDINATOR_RUN_ENDED" };
      }
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
      // M10/T2: a recognized coordinator run starting carries no delegation
      // receipt to reconcile (it was gateway-started, not spawn-reserved), so
      // it must not enter the delegation-matching path below, which would treat
      // it as a lineage mismatch. Benign acknowledgment only; the ledger
      // binding recorded at pickup time is the authoritative record.
      const coordinatedSpawn = resolveCoordinatorRun(
        event.childSessionKey,
        event.runId,
        event.agentId ?? context.agentId,
      );
      if (coordinatedSpawn) {
        api.logger?.info?.(
          `[zink-governance] coordinator run recognized at spawn: task ${coordinatedSpawn.taskId} attempt ${coordinatedSpawn.attempt} bound=${coordinatedSpawn.bound}`,
        );
        return { allow: true, governanceState: "COORDINATOR_RUN_RECOGNIZED" };
      }
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

            // Dedicated skill-learning path. A skill candidate is a
            // governance transaction, never a workflow task: this branch
            // must never reach handleDiscordAction or executeApprovedTask,
            // and the execution approval path must never reach skill state.
            if (
              parsed.actionKey === "SKILL_APPROVE" ||
              parsed.actionKey === "SKILL_REJECT"
            ) {
              const skillSender =
                ctx.senderId ||
                ctx.interaction?.senderId ||
                ctx.interaction?.user?.id ||
                ctx.interaction?.member?.user?.id;
              const repoRoot = findRepoRoot();
              const skillResult = await handleSkillDiscordAction({
                action:
                  parsed.actionKey === "SKILL_APPROVE" ? "approve" : "reject",
                proposalId: parsed.taskId,
                contentSha256: parsed.revision,
                senderId: skillSender,
                config,
                skillsRoot: repoRoot
                  ? path.join(repoRoot, "zink-skill-store", "skills")
                  : undefined,
                proposalStorageDir: path.isAbsolute(config.ledgerRoot ?? "")
                  ? path.join(config.ledgerRoot, "skill-proposals")
                  : undefined,
                notify: async ({ text }) => {
                  const officeId = resolveDiscordDestination(
                    config,
                    "discordOfficeChannelId",
                    "officeChannelId",
                  );
                  if (!officeId) return;
                  try {
                    await sendNativePayload({
                      api,
                      to: officeId,
                      accountId: "main",
                      payload: { text },
                    });
                  } catch (deliveryErr) {
                    api.logger?.warn?.(
                      `[zink-governance] skill office notice failed: ${deliveryErr?.message}`,
                    );
                  }
                },
              });
              const skillMsg = skillResult.ok
                ? `✅ ${skillResult.status === "APPROVED" ? "Đã phê duyệt và materialize skill" : "Đã từ chối skill"} (proposal \`${parsed.taskId}\`).`
                : `⛔ Skill approval bị từ chối: ${skillResult.reason}`;
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({
                  text: skillMsg,
                  ephemeral: !skillResult.ok,
                });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({
                  text: skillMsg,
                  ephemeral: !skillResult.ok,
                });
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

                const officeChannelId = resolveDiscordDestination(
                  config,
                  "discordOfficeChannelId",
                  "officeChannelId",
                );
                const resultsForumId = resolveDiscordDestination(
                  config,
                  "discordResultsForumId",
                  "resultsChannelId",
                );
                // Both destinations must be configured: the notice text names the
                // results forum, so posting with an unresolved forum would render
                // a dangling mention into an undesignated channel.
                if (officeChannelId && resultsForumId) {
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

            const officeChannelId = resolveDiscordDestination(
              config,
              "discordOfficeChannelId",
              "officeChannelId",
            );
            const resultsForumId = resolveDiscordDestination(
              config,
              "discordResultsForumId",
              "resultsChannelId",
            );
            // Both destinations must be configured: the notice text names the
            // results forum, so posting with an unresolved forum would render
            // a dangling mention into an undesignated channel.
            if (officeChannelId && resultsForumId) {
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
