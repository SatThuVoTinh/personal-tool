import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import {
  createGovernanceGuard,
  resolveN8nInvocation,
  resolveAuthenticatedApproval,
  whenGovernanceDependenciesReady,
  loadSharedGovernanceModule,
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
  AGENT_STACK_POLICY,
  ZINK_CAPABILITY_REGISTRY,
  AUTHORIZATION_MODE_BY_TOOL,
  OPERATION_POLICY,
  deriveApprovalMaterialParameters,
  deriveApprovalScopeDigest,
  configureGovernedStoreRoot,
  // M12/T9 F-049: the ONE referential scheme for Discord identities. The
  // owner's ruling was "lưu dạng mã băm" — a third party's account id is
  // stored as a hashed reference, never in the clear.
  isIdentityKey,
  tokenizeDiscordPrincipalReferences,
  tokenizePayloadPrincipalReferences,
} from "../../lib/policy.mjs";
import {
  sanitizeDelegationText,
  truncateUtf8 as sharedTruncateUtf8,
  deriveIncidentId,
} from "../../topology/lib/runtime.mjs";
import {
  registerNativeGuard,
  recordNativeQuota,
  selfNativeQuota,
  resolveNativeRunModel,
} from "../../topology/lib/native-boundary.mjs";
import {
  BUDGETS,
  readSnapshot,
  recordWorkflowEvent as writeWorkflowEvent,
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
  deriveApprovalPlanDigest,
  derivePrincipalRef,
  GOVERNANCE_VERSION,
  isTaskCodeForm,
  mintTaskId,
  SCHEMA_VERSION,
  TASK_CODE_ALPHABET,
  TASK_ID_PATTERN,
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
  renderGovernedApprovalBody,
  renderGovernedExpectedResult,
  renderGovernedPlanSteps,
  renderGovernedResultBody,
  sanitizeDiscordText,
  specialistSoftwareLabel,
  SPECIALIST_SOFTWARE_LABELS,
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
  resolveMainConversationAdmission,
  resolveMainReplyAdmission,
  MAIN_CONVERSATION_CONTINUATION,
  MAIN_DIRECTED,
  MISSING_MENTION_REFUSAL,
  DISCORD_BOT_IDS,
  AGENT_IDS,
  normalizeAuthorityAction,
  resolveLedgerDecision,
} from "../../lib/authority.mjs";

import {
  QueueManager,
  defaultQueueManager,
  isExecutableCoordinator,
} from "../../lib/queue-manager.mjs";

import {
  buildNativeComponentPayload,
  hostComponentSdkCandidates,
  registerPostedNativeComponents,
  sendNativePayload,
} from "../../lib/discord-native-send.mjs";

import { renderExpectedResultPreview } from "../../lib/discord-result-preview.mjs";
// M12/T2-R1: one tagging system for all three governed forums.
import {
  approvalCardExpiresAt,
  approvalRiskTag,
  approvalStatusTag,
  buildSurfaceSelections,
  createForumTagResolver,
  incidentSeverityTag,
  isApprovalCardExpired,
  incidentStatusTag,
  openGovernedForumThread,
  readActiveForumThreads,
  resultStatusTag,
  resultTypeTag,
  surfaceStackTag,
  transitionGovernedForumStatus,
} from "../../lib/discord-forum-tags.mjs";

import {
  evaluateResultGate,
  VALIDATION_STATUS,
} from "../../lib/artifact-validator.mjs";

import {
  DecisionLedger,
  defaultDecisionLedger,
} from "../../lib/decision-ledger.mjs";

import { lockDirFor, withFileLockSync } from "../../lib/file-lock.mjs";

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

// M11/T1-R1 (4.2): both caches above live on `globalThis` for the whole process
// lifetime, so they need explicit ceilings. The durable
// `<ledgerRoot>/skill-proposals/` store is authoritative for proposals, so an
// evicted entry costs only a re-read; the completed-execution Set is a replay
// guard with a bounded idempotency window BY DESIGN — beyond the ceiling the
// oldest keys stop being recognized as complete, which the ledger-based
// terminal-state checks in `handleExecutionFinished` still refuse.
export const PENDING_PROPOSALS_LIMIT = 256;
export const COMPLETED_EXECUTIONS_LIMIT = 4096;
// M11/T3 A2: one deadline for every outbound Discord REST call. All three sites
// awaited `fetch` with no signal, so a stalled socket pinned the gateway hook
// indefinitely. 10s matches the existing probe deadline (verify.mjs:311).
export const DISCORD_REST_DEADLINE_MS = 10_000;

/**
 * M12/T2-R1 (owner decision Q3 = A): the RISK a governed thread advertises is the highest
 * `riskClass` among the tools the admitted plan can actually reach. A brief node names an
 * agent, not a tool, so the reachable set is that agent's admitted capabilities plus one
 * bounded level of the spawn policy — a coordinator admits no capability of its own, yet
 * the plan it admits runs governed Excel, SQL and n8n tools. Descending further would
 * describe the whole server rather than this request, and inventing a class for a built-in
 * session tool would be a claim the policy tables never made.
 *
 * These live at module level because the owner's tag rule depends on the classification:
 * the plugin and its tests must read one function, not two copies.
 */
export function riskClassesAdmittedBy(agentIds) {
  const classes = new Set();
  const addFor = (agentId) => {
    for (const tool of TOOL_POLICY[agentId] ?? []) {
      const risk = ZINK_CAPABILITY_REGISTRY[tool]?.riskClass;
      if (risk) classes.add(risk);
    }
  };
  for (const agentId of new Set(
    (Array.isArray(agentIds) ? agentIds : []).filter(Boolean),
  )) {
    addFor(agentId);
    for (const child of AGENT_SPAWN_POLICY[agentId] ?? []) addFor(child);
  }
  return [...classes];
}

export function governedTaskAgents(task, targetAgentId) {
  const agents = [];
  if (typeof targetAgentId === "string" && targetAgentId)
    agents.push(targetAgentId);
  for (const node of Array.isArray(task?.nodes) ? task.nodes : [])
    if (typeof node?.agent_id === "string" && node.agent_id)
      agents.push(node.agent_id);
  return [...new Set(agents)];
}

/**
 * M12/T9 F-123: the moment the approval card was POSTED.
 *
 * The durable fact is the `WORKFLOW_APPROVAL_SURFACED` event — the record OF
 * the surfaced card — and its `created_at` is the moment the card was posted.
 * The 24 hours are counted from there: not from the moment the request was
 * written, and not from the moment a decision arrives.
 *
 * The journal is append-only and its last line can be torn, so an unparsable
 * line is skipped rather than fatal. The caller has already verified the
 * journal's digest chain through `readSnapshot`, so what this reads is the
 * verified history.
 */
export function readSurfacedApprovalPostedAt(paths, taskId) {
  const eventsPath = paths?.events;
  if (typeof eventsPath !== "string" || eventsPath.length === 0) return null;
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  let raw;
  try {
    raw = readFileSync(eventsPath, "utf8");
  } catch {
    return null;
  }
  let postedAt = null;
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== "WORKFLOW_APPROVAL_SURFACED") continue;
    if (event?.payload?.task_id !== taskId) continue;
    const at = Date.parse(event.created_at);
    if (!Number.isFinite(at)) continue;
    // The LAST surface is the card the owner is looking at now.
    if (postedAt === null || at >= postedAt) postedAt = at;
  }
  return postedAt;
}

/**
 * The approvals trio: the state the card asks about, its risk, its stack. `decision` is only
 * supplied by the post-verdict tag transition (M12/T2-R2); every publish path leaves it out, so
 * an opened thread is always `STATUS: WAITING`.
 */
export function approvalTagSelectionsFor(task, targetAgentId, decision = null) {
  return buildSurfaceSelections("approvals", {
    status: approvalStatusTag(decision),
    risk: approvalRiskTag(
      riskClassesAdmittedBy(governedTaskAgents(task, targetAgentId)),
    ),
    stack: surfaceStackTag({
      currentStack: task?.current_stack,
      nodeStackIds: (Array.isArray(task?.nodes) ? task.nodes : []).map(
        (node) => node?.stack_id,
      ),
    }),
  });
}

/**
 * The results trio. TYPE prefers durable artifact evidence and falls back to the software
 * the admitted plan named, so a thread is never tagged by a guess about work the ledger
 * cannot show. `BLOCKED` and `CANCELLED` deliberately have no results tag: they are not
 * outcomes the owner accepted, and mapping them to FAILED would state a verdict he never
 * made — the caller then posts nothing and logs the reason.
 */
export function resultTagSelectionsFor(task, artifactPaths = []) {
  const nodeAgents = (Array.isArray(task?.nodes) ? task.nodes : [])
    .map((node) => node?.agent_id)
    .filter((agentId) => typeof agentId === "string" && agentId);
  let type = null;
  // F-005: the SPECIALIST targets are tried first, so a mixed DAG stays
  // typed by the software that produced the deliverable. The coordinator
  // (`undefined`) is the fallback, not the first guess.
  for (const target of [...nodeAgents, undefined]) {
    type = resultTypeTag({ artifactPaths, target });
    if (type) break;
  }
  return buildSurfaceSelections("results", {
    status: resultStatusTag({
      decision: "ACCEPT",
      outcomeStatus: task?.root_result?.outcome_status,
    }),
    type,
    stack: surfaceStackTag({
      currentStack: task?.current_stack,
      nodeStackIds: (Array.isArray(task?.nodes) ? task.nodes : []).map(
        (node) => node?.stack_id,
      ),
    }),
  });
}

/** The software a delivered result belongs to, for the thread body. */
export function resultSoftwareLabelFor(task) {
  for (const node of Array.isArray(task?.nodes) ? task.nodes : []) {
    const agentId = node?.agent_id;
    if (agentId && agentId in SPECIALIST_SOFTWARE_LABELS && agentId !== "main")
      return specialistSoftwareLabel(agentId);
  }
  return "";
}

/**
 * The incidents trio. SEVERITY is what the containment decision actually was, and STACK is
 * the affected tasks' own recorded stack.
 *
 * M12/T9 F-009: the comment this replaces claimed that a containment spanning two stacks
 * reports unresolved and opens no thread. That is not what `surfaceStackTag` does, and it
 * has not done since the one-tagging rule landed: the STACK tag is the surface the
 * containment's OUTPUT belongs to, so a containment that reaches further downstream is
 * tagged by that downstream surface. The precedence is `decision > intelligence >
 * data_plant > semantic > infrastructure` (STACK_TAG_PRECEDENCE), and it is applied over
 * the union of every affected task's node stacks.
 *
 * `current_stack` still wins when the ledger has bound one - but only for a SINGLE
 * affected task, because a containment over several tasks has no single executing stack
 * and the union decides. Nothing is invented when there is no stack evidence at all:
 * the caller then reports an unresolved tag and posts nothing.
 */
export function incidentTagSelectionsFor(
  tasks,
  { reason, scope, ledgerError },
) {
  const list = Array.isArray(tasks) ? tasks : [];
  return buildSurfaceSelections("incidents", {
    status: incidentStatusTag(),
    severity: incidentSeverityTag({ reason, scope, ledgerError }),
    stack: surfaceStackTag({
      currentStack: list.length === 1 ? list[0]?.current_stack : null,
      nodeStackIds: list.flatMap((task) =>
        (Array.isArray(task?.nodes) ? task.nodes : []).map(
          (node) => node?.stack_id,
        ),
      ),
    }),
  });
}

/**
 * M12/T9 F-016: whether an #incidents thread may be opened for a containment.
 *
 * A TRUNCATED listing cannot answer "is this incident already open?", so the honest answer
 * is "unable to conclude" and the surface is skipped. The owner's rule is that a blind post
 * is how a duplicate incident gets made, so a partial listing must never be read as "not
 * open yet". The decision is a pure function so the dedupe rule can be pinned by a test
 * without a live forum.
 */
export function incidentSurfaceDecision(listing, token) {
  if (listing?.truncated)
    return { open: false, reason: "THREAD_LIST_TRUNCATED" };
  const already = (Array.isArray(listing?.threads) ? listing.threads : []).some(
    (thread) => String(thread?.name ?? "").includes(String(token ?? "")),
  );
  if (already) return { open: false, reason: "ALREADY_SURFACED" };
  return { open: true, reason: null };
}

/**
 * A stable per-containment identity. #incidents has no incident record in the ledger and
 * this task is not authorized to invent one, so the thread title carries this token and the
 * forum's active-thread list is what makes a retry recognizable instead of duplicated.
 */
export function incidentIdentityFor({
  reason,
  runId = null,
  childSessionKey = null,
  scope = "NONE",
  taskIds = [],
}) {
  const token = deriveIncidentId({
    reason,
    runId,
    childSessionKey,
    scope,
    taskIds: [...taskIds].sort(),
  }).slice(0, 8);
  return { token, title: `🚨 [SỰ CỐ] ${reason} · ${token}` };
}

/** Evict oldest insertions until the collection fits its ceiling. */
function boundCache(collection, limit) {
  const iterator = collection.keys();
  while (collection.size > limit) {
    const oldest = iterator.next();
    if (oldest.done) break;
    collection.delete(oldest.value);
  }
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
  boundCache(globalThis[PENDING_PROPOSALS_KEY], PENDING_PROPOSALS_LIMIT);
}

/**
 * Drop a decided proposal from the cache. A proposal that reached a terminal
 * state (MATERIALIZED / READY / INDEX_FAILED / REJECTED) is decided by the
 * durable record on disk; keeping the stale in-memory copy alive would let
 * `getPendingSkillProposal` answer for a proposal that no longer has one.
 */
export function forgetPendingSkillProposal(...proposalIds) {
  for (const proposalId of proposalIds) {
    if (proposalId) globalThis[PENDING_PROPOSALS_KEY]?.delete(proposalId);
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

/**
 * M12/T9 F-296: flush a directory's own entries.
 *
 * A rename is only durable once the PARENT DIRECTORY's entry for the new name
 * has been flushed. The renamed file's own fsync does not do that: it makes
 * the file's CONTENT durable, while the directory entry that makes the name
 * visible survives a crash only if the directory itself was synced. The
 * publication path below therefore fsyncs the file, renames it, and then
 * fsyncs the parent directory - and it does so at EVERY rename site, because
 * a rename without the directory flush can leave a durable file that no
 * directory points at.
 *
 * The pattern is the one `topology/lib/runtime-backup.mjs` already uses.
 * Windows cannot fsync a directory handle, so the platform error is swallowed
 * there; every other error is re-thrown, because a publication that cannot
 * guarantee its own durability must fail loudly rather than pretend.
 */
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
  // F-296: the rename is not crash-durable until the parent directory entry
  // is flushed. Every rename site in this file goes through this helper, so
  // there is exactly one place where the durability step can be removed.
  syncDirectory(path.dirname(filePath));
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
let skillStoreModule = null;
let duckDbBridgeModule = null;

function resolveDefaultOllamaUrl() {
  const configured = process.env.OLLAMA_URL?.trim();
  return configured || null;
}

/**
 * M12/T9 F-022: the deployed plugin must never resolve a module through a
 * MACHINE-SPECIFIC absolute path.
 *
 * The candidate list used to carry this workstation's Windows mount
 * (`/mnt/c/Users/<operator>/...`) as a literal. On a host where that mount
 * exists, the deployed plugin loaded LIVE REPOSITORY SOURCE instead of its
 * own digest-gated packaged assets, so a branch switch or an uncommitted edit
 * changed governed behaviour with no redeploy and no digest change - and the
 * one gate that looked for machine-specific paths never inspected the
 * entrypoint that carried the literal.
 *
 * The resolution is now machine-independent: the configured root, the module's
 * own tree, the working directory, and the nearest ANCESTOR of this module
 * that carries the repository layout. Nothing in it names a machine.
 */
function findRepoRoot() {
  const marker = path.join(
    "zink-tools",
    "adapters",
    "skill-store",
    "skill-adapter.mjs",
  );
  const carriesRepository = (root) => {
    if (!root) return false;
    try {
      return existsSync(path.join(root, marker));
    } catch {
      return false;
    }
  };
  const candidates = [
    process.env.ZINK_REPO_ROOT,
    path.resolve(fileURLToPath(import.meta.url), "../../../.."),
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (carriesRepository(candidate)) return candidate;
  }
  // The nearest ancestor of this module that carries the repository layout.
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (carriesRepository(parent)) return parent;
    current = parent;
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
  // M10/T2-R5: the structured author bot flag forwarded from the Discord
  // inbound event. Previously this check was vacuous at the native seam
  // (neither field was ever forwarded); now bot authorship denies.
  if (context.authorIsBot === true) {
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

// M12/T1-R1: replay detection after the identity stopped being a hash of the
// origin message. A re-delivered Discord event used to be caught by recomputing
// `deriveTaskId(origin)` and looking that up as the snapshot key; a minted
// 12-character identity makes that impossible, so the same fact is now read from
// the binding every WORKFLOW_OPENED already records.
//
// The match is deliberately the SAME set the old derivation consumed: origin,
// principal ref, message id and agent. The session is NOT part of it, because the
// old id did not include the session either, and that is what makes a second
// session quoting the same message land on the existing task and be denied by the
// duplicate guard instead of silently opening a second task.
export function findTaskByOriginBinding(
  snapshot,
  { origin, origin_principal_ref, origin_message_id, root_agent_id } = {},
) {
  const tasks = snapshot?.tasks;
  if (!tasks || typeof tasks !== "object") return null;
  if (
    typeof origin !== "string" ||
    !/^[a-f0-9]{64}$/u.test(String(origin_principal_ref ?? "")) ||
    !/^[1-9][0-9]{16,19}$/u.test(String(origin_message_id ?? "")) ||
    typeof root_agent_id !== "string"
  ) {
    return null;
  }
  for (const [taskId, task] of Object.entries(tasks)) {
    if (!new RegExp(TASK_ID_PATTERN, "u").test(taskId)) continue;
    if (
      task?.origin === origin &&
      task?.origin_principal_ref === origin_principal_ref &&
      task?.origin_message_id === origin_message_id &&
      task?.root_agent_id === root_agent_id
    ) {
      return taskId;
    }
  }
  return null;
}

// M12/T1-R1: display token for an identity that may be either shape. The
// 12-character code is short enough to show whole — and truncating it to its first
// eight characters would leave only the date, so two same-day tasks would look
// identical. A legacy 64-hex id keeps its 8-character prefix, which is what every
// existing card and `res-<token>` id already carries.
export function displayTaskToken(taskId) {
  const value = String(taskId ?? "");
  return isTaskCodeForm(value) ? value : value.slice(0, 8);
}

// M12/T1-R1 (owner option D): a specialist may report its OWN work to the owner.
// Pure so the rule is testable without a live ledger: everything it reads is the
// durable task record, never the message text, so a specialist cannot earn admission
// by what it says.
export function evaluateSpecialistProvenance({
  agentId,
  task = null,
  delegationAgentId = null,
} = {}) {
  if (typeof agentId !== "string" || agentId.length === 0) {
    return { allowed: false, reason: "NO_AGENT_IDENTITY" };
  }
  if (!task || typeof task !== "object") {
    return { allowed: false, reason: "TASK_NOT_KNOWN" };
  }
  if (delegationAgentId && delegationAgentId !== agentId) {
    return { allowed: false, reason: "TASK_NOT_OWNED_BY_THIS_AGENT" };
  }
  if (!task.approved_at) {
    return { allowed: false, reason: "TASK_NOT_APPROVED" };
  }
  const executing =
    ["EXECUTING", "RESULT_PENDING_REVIEW"].includes(task.workflow_status) ||
    (task.workflow_status === "ACTIVE" && Boolean(task.claimed_at));
  if (!executing) {
    return {
      allowed: false,
      reason: `TASK_NOT_EXECUTING:${task.workflow_status ?? "unknown"}`,
    };
  }
  return { allowed: true, taskId: task.task_id ?? null };
}

// M8-061: caller identity always derives from trusted runtime context.
// Tool payload may carry business metadata, never authority identity.
export function deriveTrustedRequester(_id) {
  return _id?.agent ?? _id?.agentId ?? "unknown";
}

// M12/T9 F-041: the memory/skill tools' correlation identity is the TRUSTED
// runtime context, never the tool payload.
//
// The registered schemas advertised `session_key`, `run_id` and `task_id` as
// model-fillable, and the executors read the payload FIRST (the payload's
// session key won over the trusted one), so a model could name the run its
// own retrieval was scoped to. The identity now comes from the trusted
// context alone, and a payload that carries a correlation key has it REFUSED:
// the key is dropped before the adapter sees the input, the refusal is named
// (the field only - never the value), and the trusted correlation always
// reaches the adapter.
const TRUSTED_IDENTITY_FIELDS = Object.freeze([
  "session_key",
  "run_id",
  "task_id",
]);

export function deriveTrustedToolIdentity(_id, params = null) {
  const input = { ...(params ?? {}) };
  const refused = [];
  for (const field of TRUSTED_IDENTITY_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    refused.push(field);
    delete input[field];
  }
  return {
    input,
    refused,
    context: {
      sessionKey: _id?.sessionKey || "unbound-session",
      runId: _id?.runId || "unbound-run",
      taskId: _id?.taskId || "unbound-task",
      requestingAgent: deriveTrustedRequester(_id),
    },
  };
}

// M12/T9 F-227: the owner-visible task code IS the task identity, so it is
// minted from a cryptographic byte source. The ambient PRNG is not a source of
// authority: it is not unpredictable and it is not reproducible for a forensic
// re-derivation, which is exactly what `topology/lib/canonical.mjs` documents
// as forbidden for an identity.
//
// The alphabet has 21 symbols, so a plain byte modulo 21 would bias the first
// five values. Rejection sampling removes the bias: a byte at or above the
// largest multiple of 21 is discarded and another one is drawn.
export function createTaskCodeRandomSource() {
  const limit = 256 - (256 % TASK_CODE_ALPHABET.length);
  return () => {
    for (;;) {
      const byte = randomBytes(1)[0];
      if (byte < limit) return byte % TASK_CODE_ALPHABET.length;
    }
  };
}

// M12/T9 F-109: the announce seam READS the publish verdict.
//
// The seam used to await the publish and throw its verdict away, so a card
// that was never published was indistinguishable from one that was: the host
// was told the announcement was delivered when it never left the process, and
// an unparsable payload dropped with no log line at all.
//
// The verdict is the ONE source of truth for the publish outcome:
//   - `PUBLISHED`     - the card is in the owner's forum; the host's decision
//                       (the guard's) stands.
//   - `NOT_APPLICABLE`- this announce was never a governed approval card; the
//                       host's decision stands.
//   - `BLOCKED`       - a governed card was expected and could not be
//                       published. The announce is DISCARDED with the declared
//                       runtime reason, so the host is never told a card it
//                       cannot act on was delivered.
export function resolveAnnouncePublishDecision({ decision, verdict } = {}) {
  if (verdict?.status === "BLOCKED") {
    return { action: "discard", reason: verdict.error };
  }
  return decision;
}

// M12/T9 F-104: the account that opens an #approvals thread is the one the
// LEDGER assigned to the task.
//
// The posting account used to be parsed out of the event's child session key
// (`/^agent:([^:]+)/`), so an announce could name an account the ledger never
// assigned to that task and the card was re-routed to another bot's token.
// The ledger's own owning run is the authority: a coordinator run names its
// coordinator, a delegation names its agent, and the root run names the root
// agent. The event's claim is only ever a CLAIM: it may select an agent when
// it agrees with the ledger, and a disagreement is refused.
//
// The refusals use DECLARED runtime reason codes (see
// `topology/policy/reason-code-matrix.json`): EXACT_TASK_CORRELATION_REQUIRED
// when the ledger owns no run for this announce, UNAUTHORIZED_TARGET when the
// event claims an account the ledger did not assign.
const GOVERNED_COORDINATOR_ACCOUNTS = Object.freeze(["o1", "o2"]);

export function resolveGovernedAnnouncementAccount({
  owner,
  eventAgentId = null,
} = {}) {
  const ledgerAgentId =
    owner?.coordinatorRun?.coordinator ??
    owner?.delegation?.agent_id ??
    owner?.task?.root_agent_id ??
    null;
  if (!ledgerAgentId) {
    return { status: "BLOCKED", error: "EXACT_TASK_CORRELATION_REQUIRED" };
  }
  if (eventAgentId && eventAgentId !== ledgerAgentId) {
    return { status: "BLOCKED", error: "UNAUTHORIZED_TARGET" };
  }
  if (!GOVERNED_COORDINATOR_ACCOUNTS.includes(ledgerAgentId)) {
    return { status: "NOT_APPLICABLE", agentId: ledgerAgentId };
  }
  return { status: "COORDINATOR", agentId: ledgerAgentId };
}

/**
 * M12/T9 F-021: the pickup lane's eligibility is decided WHEN work could be
 * claimed, not once at `register()` time.
 *
 * The loop used to be started only when the ledger snapshot already existed at
 * registration, so a snapshot created afterwards (a first install, or a
 * guarded lock/snapshot recovery - exactly the state the owner's recovery
 * procedures leave behind) left the coordinator lane dark until a restart.
 *
 * The reader answers "no tasks" while the snapshot is absent, so an absent
 * snapshot still refuses to claim anything, and a snapshot that appears later
 * makes the lane eligible on the next tick - no restart, no second scheduler.
 */
export function readPickupLedgerTasks({ paths } = {}) {
  try {
    if (!paths?.snapshot || !existsSync(paths.snapshot)) return {};
    return readSnapshot(paths).tasks ?? {};
  } catch {
    // An unreadable ledger is never a claim: the lane stays idle.
    return {};
  }
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

// M12/T9 F-024: the plugin and the guard used to have TWO resolvers for the
// same zink-tools dependencies — the plugin walked up to a repo root (with a
// machine-specific absolute path in the list) and the guard resolved from its
// own module directory plus the working directory — so the same module could
// be loaded from two different trees and the two copies could disagree about
// the same decision. There is now ONE resolver, in the guard, and the plugin
// hands it the repo root it found.
async function loadRepoModule(relativePath) {
  let root = null;
  try {
    root = findRepoRoot();
  } catch {
    /* ignore */
  }
  return loadSharedGovernanceModule(relativePath, {
    roots: root ? [root] : [],
  });
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

/**
 * M12/T9 F-156: the Skill Store's PUBLIC DOOR.
 *
 * The plugin used to load the store's internals (the catalog and the
 * vector-sync modules under the store's own `src/` tree) by relative path,
 * with its own three-candidate fallback chain. That welded
 * the plugin to the store's private file layout: the OpenClaw tree had no
 * governed Skill Store boundary at all, and a rename inside `src/` broke the
 * plugin.
 *
 * The store now publishes ONE public module - `zink-skill-store/index.mjs` -
 * which exports exactly the three entry points a caller needs (the canonical
 * promotion, the store-wide writer lock and the derived pgvector sync). The
 * plugin loads THAT module, through the ONE shared-module resolver, so the
 * repository layout and the packaged tree resolve it the same way.
 */
async function getSkillStoreModule() {
  if (!skillStoreModule) {
    skillStoreModule = await loadRepoModule("zink-skill-store/index.mjs");
    if (!skillStoreModule) {
      console.error(
        "[zink-governance] Skill Store public module is unavailable",
      );
    }
  }
  return skillStoreModule;
}

/**
 * M12/T9 F-156/F-176: the derived-index sync, through the Skill Store's public
 * door.
 *
 * `expectedStoreId` is the identity of the store this deployment means to
 * sync. It is operator configuration, never a constant: an unconfigured
 * deployment syncs without naming the store, and the sync then refuses the
 * zero-row tombstone instead of guessing.
 */
async function syncSkillsThroughDoor(skillsRoot, options, expectedStoreId) {
  const skillStore = await getSkillStoreModule();
  if (!skillStore || typeof skillStore.syncSkillsToVectorStore !== "function") {
    throw new Error(
      "SKILL_STORE_PUBLIC_MODULE_UNAVAILABLE: the Skill Store public module is unavailable",
    );
  }
  return skillStore.syncSkillsToVectorStore({
    skillsRoot,
    ...options,
    expectedStoreId,
  });
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
  // M11/T1-R1 (2.4): deliberately no default. A hardcoded default stamped a
  // false plan reference into EVERY promoted skill's canonical lifecycle,
  // and kept authorizing approvals whenever a caller forgot to bind the
  // real decision. The ref is required and validated below; an omitted or
  // blank value denies the approval before any durable read.
  decisionRef,
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
  if (typeof decisionRef !== "string" || decisionRef.trim().length === 0) {
    throw new Error(
      "APPROVAL_DECISION_REF_REQUIRED: an explicit plan decision reference must bind the approval",
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
  const skillStore = await getSkillStoreModule();
  const promoteApproved = skillStore?.promoteApprovedSkill;
  const underWriterLock = skillStore?.withSkillStoreWriterLock;
  if (
    typeof promoteApproved !== "function" ||
    typeof underWriterLock !== "function"
  ) {
    throw new Error(
      "APPROVAL_PROMOTE_UNAVAILABLE: canonical Skill Store writer is unavailable",
    );
  }
  // M11/T1-R1 (2.3): heal → validate → clash-check → staging write → rename →
  // proposal-status write form ONE critical section under the store-wide
  // writer lock, so two concurrent approvals (or an approval racing a
  // rejection or a CLI promotion) cannot interleave clash-check and rename
  // and fork the canonical tree. The lock is taken exactly here and the
  // Unlocked variant is called inside it: `promoteApprovedSkill` acquires the
  // same lock itself, so calling it from within this section would
  // self-deadlock into FILE_LOCK_TIMEOUT. The async seam is used rather than
  // the sync one because the guarded work is async — the sync seam would
  // release while writes were still in flight.
  const boundDecisionRef = decisionRef.trim();
  const planProvenanceRef = boundDecisionRef.replace(/^PLAN:/u, "");
  const canonical = await underWriterLock(skillsRoot, async () => {
    // Re-read inside the critical section: a rejection committed by another
    // process after the checks above must never be overwritten by this one.
    const current = readDurableSkillProposal(storeDir, proposalId);
    if (current?.status === "REJECTED") {
      throw new Error("APPROVAL_PROPOSAL_REJECTED: candidate was rejected");
    }
    let promoted;
    try {
      promoted = await promoteApproved({
        skillsRoot,
        namespace: nsArray,
        capability,
        version,
        content: stored.content,
        requestingActor: stored.requesting_agent ?? "unknown",
        ownerActor: "owner",
        decisionRef: boundDecisionRef,
        // M11/T1-R1 (2.4): provenance is derived from the ref this approval
        // actually carries — never a constant.
        references: [{ type: "plan", ref: planProvenanceRef }],
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
    return promoted;
  });

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
  // M11/T1-R1 (4.2): the durable record just written (MATERIALIZED / READY /
  // INDEX_FAILED) is terminal for this proposal, so it leaves the pending cache
  // instead of being re-stamped as READY. Replaying the approval still fails
  // closed on the disk state, and `getPendingSkillProposal` now answers only
  // for proposals that are genuinely still pending.
  forgetPendingSkillProposal(proposalId, stored.proposal_id);
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
 *
 * M11/T1-R1 (2.3): the read → CANDIDATE check → REJECTED write runs under
 * the store-wide writer lock, the same critical section the approval
 * transaction uses. Without it, a rejection racing an approval could be
 * decided against a proposal state that the concurrent approval had already
 * moved past CANDIDATE, and the loser's terminal write would silently
 * overwrite the winner's. `skillsRoot` is required because the lock is
 * addressed from it.
 */
export async function handleOwnerSkillRejection({
  ownerDiscordId,
  expectedOwnerId,
  proposalId,
  skillsRoot,
  proposalStorageDir,
  options = {},
}) {
  if (ownerDiscordId !== expectedOwnerId) {
    throw new Error(
      "APPROVAL_OWNER_MISMATCH: Unauthorized principal cannot reject skills",
    );
  }
  if (!skillsRoot || typeof skillsRoot !== "string") {
    throw new Error(
      "SKILLS_ROOT_REQUIRED: canonical Skill Store root is required",
    );
  }
  const storeDir = proposalStorageDir ?? options.proposalStorageDir;
  if (!storeDir || typeof storeDir !== "string") {
    throw new Error(
      "PROPOSAL_STORE_UNAVAILABLE: durable proposal store is not configured",
    );
  }
  const catalogMod = await loadRepoModule("zink-skill-store/src/catalog.mjs");
  const underWriterLock = catalogMod?.withSkillStoreWriterLock;
  if (typeof underWriterLock !== "function") {
    throw new Error(
      "APPROVAL_PROMOTE_UNAVAILABLE: canonical Skill Store writer is unavailable",
    );
  }
  return underWriterLock(skillsRoot, () => {
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
    // M11/T1-R1 (4.2): REJECTED is terminal — the durable record owns the
    // decision, so the pending-cache entry goes with it.
    forgetPendingSkillProposal(proposalId, stored.proposal_id);
    return { proposal_id: proposalId, approval_status: "REJECTED" };
  });
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
 * M12/T9 F-124: the Discord body ceiling and the mention syntax.
 *
 * Discord refuses a message body over 2000 characters, and `PLAN_TRUNCATION_MARK`
 * is the marker `renderGovernedApprovalBody` uses when it cuts one. The marker
 * is repeated here so the seam that publishes a body it did not render still
 * marks its cut instead of losing the tail silently. The drift between the two
 * copies is checked by a gate, not by a reader.
 */
const DISCORD_BODY_LIMIT = 2000;
const PLAN_TRUNCATION_MARK = "…(xem toàn bộ kế hoạch trong phiên)";

/**
 * M12/T9 F-124: Discord mention syntax never reaches an approval surface.
 *
 * `sanitizeDiscordIdentifier` strips mentions but also every newline, so it
 * cannot be used on a body: the body keeps its structure and loses only the
 * mention tokens.
 */
const DISCORD_MENTION_TOKENS = Object.freeze([
  /(?<![A-Za-z0-9_])@everyone/giu,
  /(?<![A-Za-z0-9_])@here/giu,
  /<@[!&]?\d+>/gu,
  /<#\d+>/gu,
]);

export function sanitizeApprovalBody(body) {
  if (typeof body !== "string") return "";
  let sanitized = body;
  for (const token of DISCORD_MENTION_TOKENS) {
    sanitized = sanitized.replace(token, "");
  }
  return sanitized;
}

/**
 * M12/T9 F-124: the short, ledger-derived line the buttons message carries.
 *
 * The body itself is published once, in the thread. This message carries the
 * buttons and a pointer, so the owner never reads the same body twice.
 */
export function buildApprovalActionLine(taskId) {
  const token = sanitizeApprovalBody(
    String(displayTaskToken(taskId) ?? ""),
  ).trim();
  return `⏳ **Chờ anh phê duyệt** — Task \`${token}\``;
}

/**
 * M12/T9 F-124: a body that does not fit is cut with an EXPLICIT marker.
 */
export function boundApprovalBody(bodyContent) {
  const body = typeof bodyContent === "string" ? bodyContent : "";
  if (body.length <= DISCORD_BODY_LIMIT) return body;
  // The marker and the newline it sits on are part of the ceiling.
  const budget = DISCORD_BODY_LIMIT - PLAN_TRUNCATION_MARK.length - 1;
  return `${body.slice(0, budget).trimEnd()}\n${PLAN_TRUNCATION_MARK}`;
}

/**
 * M10/T2-R12: first-approval card content builder for a fresh Main
 * `sessions_spawn`. Pure: no I/O, no network. The transporter posts what this
 * returns; tests assert the contract here.
 *
 * M12/T1-R1 re-froze the presentation on the owner's instruction: the card shows
 * the Task ID and nothing else that identifies plumbing (no run code, no
 * requester line, no action line, no `child:` line), `Lý do` carries the durable
 * plan step by step with the software named for each step, and `Kết quả` carries the
 * expected result plus the preview image that travels with it.
 *
 * Contract that must still hold for the verdict paths to work:
 * - the FULL task id appears in the body (the text-approval path matches an owner's
 *   APPROVE message to a task by substring);
 * - the `[PHÊ DUYỆT]` marker keeps the card recognizable to card parsers;
 * - REQUESTED state is explicit: the card asks, it never authorizes;
 * - button custom_ids use the same builder+namespace as child-announce cards so the
 *   button verdict path resolves the same taskId.
 */
export function buildFirstSpawnApprovalCard({
  taskId,
  taskCode,
  briefRevision,
  targetAgentId,
  spawnInputs,
  spawnNodeId,
  planNodes = [],
  previewImage = null,
}) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("FIRST_APPROVAL_CARD_TASK_REQUIRED");
  }
  const title = "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi";
  const steps = renderGovernedPlanSteps(planNodes, {
    activeNodeId: spawnNodeId,
  });
  if (steps.length === 0) {
    // A task admitted without a recorded node graph still has to say what will be
    // done, so this spawn itself becomes the single rendered step rather than an
    // empty plan.
    steps.push(
      [
        `1. **${specialistSoftwareLabel(targetAgentId)}**`,
        `   - Thao tác: ${String(spawnInputs ?? "").trim() || "(không mô tả)"}`,
        "   - **Đang chờ anh duyệt ở bước này**",
      ].join("\n"),
    );
  }
  const commandToken = taskCode ?? taskId;
  // M12/T9 F-124: the body is ledger-derived, but the plan text it renders can
  // still carry a Discord mention from the spawn payload, so the seam makes it
  // mention-safe before it is published.
  const bodyContent = sanitizeApprovalBody(
    renderGovernedApprovalBody({
      title,
      taskId,
      planSteps: steps,
      expectedResult: renderGovernedExpectedResult({
        nodes: planNodes,
        outcome: spawnInputs,
        previewImage,
      }),
      commandToken,
    }),
  );
  return {
    title,
    bodyContent,
    buttons: [
      {
        customId: buildComponentCustomId(
          DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_APPROVE,
          taskId,
          String(briefRevision),
        ),
        label: "Approve",
        style: 3,
        emoji: { name: "✅" },
      },
      {
        customId: buildComponentCustomId(
          DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REJECT,
          taskId,
          String(briefRevision),
        ),
        label: "Reject",
        style: 4,
        emoji: { name: "❌" },
      },
      {
        customId: buildComponentCustomId(
          DISCORD_COMPONENT_ACTION_NAMESPACE.APPROVAL_REVISION,
          taskId,
          String(briefRevision),
        ),
        label: "Request Revision",
        style: 2,
        emoji: undefined,
      },
    ],
  };
}

/**
 * M10/T2-R12: is this outbound text a governance MACHINE payload rather than a
 * reply written for the owner?
 *
 * Proven live 2026-10-08 15:41: `Main` emitted its execution-brief envelope as
 * its turn text, and the host delivered that raw JSON straight to #office. The
 * owner saw a wall of JSON instead of an answer. The envelope is not waste: it is
 * required, because `admitInitialBrief` ingests the brief from the assistant text
 * AT THE `sessions_spawn` CALL (guard.mjs beforeToolCall). So the payload must be
 * produced but must never be the user-visible reply.
 *
 * The predicate is deliberately narrow and requires BOTH contract markers
 * (`schema_version` and `governance_version`) plus one payload-shape marker, so
 * ordinary prose, ordinary JSON, and JSON the owner actually asked about are all
 * untouched. Pure: no I/O, no network, no logging.
 */
export function isGovernanceMachinePayload(text) {
  if (typeof text !== "string") return false;
  let trimmed = text.trim();
  if (trimmed.startsWith("```json")) trimmed = trimmed.slice(7);
  else if (trimmed.startsWith("```")) trimmed = trimmed.slice(3);
  if (trimmed.endsWith("```")) trimmed = trimmed.slice(0, -3);
  trimmed = trimmed.trim();
  // A reply that merely CONTAINS a payload (prose around it) is not the
  // payload: only the bare envelope is suppressed, so context is never lost.
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return false;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  if (typeof parsed.schema_version !== "string") return false;
  if (typeof parsed.governance_version !== "string") return false;
  const hasPayloadShape =
    typeof parsed.outcome_claim === "string" ||
    typeof parsed.brief_state === "string" ||
    typeof parsed.brief_revision === "number";
  return hasPayloadShape;
}

/**
 * M10/T2-R12: raw-REST message body carrying the approval buttons.
 * Pure: maps the adapter-shaped button specs (`customId`) to the Discord
 * wire shape (`custom_id`). Tested directly.
 *
 * R4-EXCEPTION (owner decision 2026-10-07): this raw-REST /messages post is
 * the SOLE permitted exception to the no-component-REST rule. The native
 * adapter cannot deliver from the tool-call hook context (proven live:
 * "Discord send requires a resolved runtime config"), while the thread
 * creation the buttons belong to already travels by permitted raw REST.
 * The m8-t2-native-outbound test enforces that any /messages REST site
 * carries this marker; without it the suite fails.
 */
export function buildApprovalButtonsMessage(bodyContent, buttons) {
  return {
    // M12/T9 F-124: a body over Discord's ceiling is cut with an explicit
    // marker, never silently.
    content: boundApprovalBody(bodyContent),
    components: [
      {
        type: 1,
        components: (buttons ?? []).map((b) => ({
          type: 2,
          style: b.style,
          label: b.label,
          custom_id: b.customId,
          ...(b.emoji ? { emoji: b.emoji } : {}),
        })),
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
  // M11/T1-R1 (2.4): the plan decision reference the approval binds. There
  // is no default: an approve action without a ref fails closed with
  // APPROVAL_DECISION_REF_REQUIRED inside `handleOwnerSkillApproval`.
  decisionRef,
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
        skillsRoot,
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
      decisionRef,
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
 * M12/T9 F-043 (legacy R1-A07-04): the thread a decision came from, normalized
 * the way the interaction path normalizes it (`channel:` is a transport
 * prefix, not a different thread). An absent thread is `null` - never a value
 * that can satisfy a comparison against a recorded approval thread.
 */
function normalizeDecisionThreadId(threadId) {
  if (typeof threadId !== "string") return null;
  const value = threadId
    .trim()
    .replace(/^channel:/u, "")
    .trim();
  return value.length > 0 ? value : null;
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
  // M12/T9 F-123: the clock the approval card's 24-hour window is measured
  // against. It is injected for the same reason the guard injects
  // `currentTime`: a caller that owns a clock (a test, a replay) must be able
  // to move it without the governance path reading the wall clock itself.
  currentTime = null,
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
    if (!authoritativeTask) {
      // M12/T9 F-080: the ledger was readable and holds no such task, so the
      // caller named a task that does not exist. There is nothing to approve.
      return {
        allowed: false,
        reason:
          "NO_AUTHORITATIVE_TASK: an approval verdict requires an authoritative ledger task",
        status: "DENIED",
      };
    }
  }

  // 3. Normalize action and validate 5-tuple authority
  // F-085: the ONE reviewed mapping between the authority vocabulary and the
  // ledger decision vocabulary. The plugin does not carry its own ternary:
  // "is this REJECT an approval or a result verdict?" is answered in one
  // place, so the plugin and the authority gate cannot disagree.
  const normAction = normalizeAuthorityAction(action, channel);

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
  // M10/T2-R14: byte-budgeted like its three siblings below. This field was
  // still on a character slice, so ~1400 multi-byte characters (~4200 UTF-8
  // bytes) passed `.slice(0, 2000)` untouched and were then rejected by
  // `ledger-event.schema.json`'s `maxLength: 4096`, which schema.mjs measures in
  // bytes — the write failed and the task could not be rejected at all.
  //
  // M12/T1-R1: the fallback described the action actually taken. It used to be the
  // literal "USER_REJECTED" for every approval-channel decision, so the live ledger
  // recorded `decision: "APPROVE"` with `reason: "USER_REJECTED"` — a durable audit
  // trail that said the opposite of what the owner did.
  const DEFAULT_APPROVAL_REASON = Object.freeze({
    [ACTIONS.APPROVE]: "USER_APPROVED",
    [ACTIONS.REQUEST_REVISION_APPROVAL]: "USER_REQUESTED_REVISION",
    [ACTIONS.REJECT_APPROVAL]: "USER_REJECTED",
    [ACTIONS.ACCEPT_RESULT]: "USER_ACCEPTED",
    [ACTIONS.REQUEST_REVISION_RESULT]: "USER_REQUESTED_REVISION",
    [ACTIONS.REJECT_RESULT]: "USER_REJECTED",
  });
  const safeReason = truncateUtf8(
    String(
      data.reason || DEFAULT_APPROVAL_REASON[normAction] || "USER_DECISION",
    ),
    2000,
  );
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
        // M12/T9 F-123: the card's own 24-hour clock.
        //
        // The owner's ruling is that a card expires 24 hours after the bot
        // posts it, and that an expired card is not approved. The clock is
        // read from the DURABLE record of the surfaced card, so it survives a
        // restart and cannot be re-derived from a moment that is not the
        // card's own. The refusal carries the same code the guard's own
        // approval seam already uses for an expired approval.
        const approvalExpiresAt = approvalCardExpiresAt(
          readSurfacedApprovalPostedAt(paths, taskId),
        );
        if (
          approvalExpiresAt !== null &&
          isApprovalCardExpired({
            expiresAt: approvalExpiresAt,
            now: currentTime,
          })
        ) {
          return {
            allowed: false,
            reason: "AUTH_APPROVAL_EXPIRED",
            status: "DENIED",
          };
        }
        // M12/T9 F-043 (legacy R1-A07-04): the verdict must come from the
        // thread the card was surfaced in. The recorded `thread_id` was never
        // compared with the task's own `approval_thread_id`, so a reposted,
        // forwarded or stale card - or an owner reply in an unrelated thread -
        // yielded a durable APPROVE. An ABSENT thread id satisfied the
        // comparison by being absent, so the refusal has to be explicit: the
        // decision must NAME the recorded thread, and nothing is recorded when
        // it does not.
        const recordedApprovalThreadId =
          authoritativeTask?.approval_thread_id ?? null;
        if (recordedApprovalThreadId) {
          const decisionThreadId = normalizeDecisionThreadId(data.threadId);
          if (decisionThreadId !== recordedApprovalThreadId) {
            return {
              allowed: false,
              reason:
                "APPROVAL_THREAD_MISMATCH: the decision must come from the approval thread the card was surfaced in",
              status: "DENIED",
            };
          }
        }
        // M12/T9 F-025 (legacy R1-A03-02): the consent is bound to the PLAN
        // that will execute. The digest is derived from the task's OWN recorded
        // brief (its revision and its whole node graph) - never from a
        // caller-supplied summary - so a model-authored card body can never
        // decide what the owner approved. The reducer compares the recorded
        // digest with the plan it holds and refuses a consent that does not
        // match, and the brief revision the button carries is recorded with it
        // so a STALE card (issued for an earlier revision) is refused too.
        const authoritativePlanDigest = deriveApprovalPlanDigest({
          brief_revision: authoritativeTask?.brief_revision,
          nodes: Array.isArray(authoritativeTask?.nodes)
            ? authoritativeTask.nodes
            : [],
        });
        const decidedBriefRevision = (() => {
          const supplied = data.briefRevision;
          if (Number.isSafeInteger(supplied) && supplied >= 1) return supplied;
          if (typeof supplied === "string") {
            const trimmed = supplied.trim();
            if (/^[0-9]{1,3}$/u.test(trimmed)) return Number(trimmed);
          }
          return undefined;
        })();
        recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
          task_id: taskId,
          actor: normalizeActor(actor),
          channel: normalizeChannel(channel),
          decision:
            // F-085: the ONE reviewed mapping from the authority action to the
            // ledger decision vocabulary. The plugin does not carry its own
            // ternary: the ledger's `decision` value and the authority gate's
            // verdict come from one mapping, so they cannot disagree.
            resolveLedgerDecision(normAction) ?? normAction,
          message_id: data.messageId ?? data.origin_message_id ?? null,
          thread_id: data.threadId ?? null,
          scope_digest: authoritativePlanDigest,
          ...(decidedBriefRevision !== undefined
            ? { brief_revision: decidedBriefRevision }
            : {}),
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
          // M12/T9 F-249: the verdict binds by DIGEST. The result id is not
          // sent any more: the reducer compared it against a root-result field
          // the published contract does not declare, so it could never bind.
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
          // M12/T9 F-249: the verdict binds by DIGEST; the result id is not
          // sent any more (the reducer could never bind it).
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
          // M12/T9 F-249: the verdict binds by DIGEST; the result id is not
          // sent any more (the reducer could never bind it).
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
        // M12/T9 F-031: the principal is minted with the identity secret, never
        // with a literal that is in the public source. Without the key the
        // answer cannot be attributed, so it is refused.
        const answerPrincipal = mintUserPrincipalRef(paths, userPrincipal);
        if (!answerPrincipal) {
          return {
            allowed: false,
            reason:
              "MISSING_IDENTITY_SECRET: ANSWER_USER requires the identity key to mint a user principal",
            status: "DENIED",
          };
        }
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

  // M12/T9 F-080: a verdict is bound to the AUTHORITATIVE ledger task. When the
  // ledger is readable and holds no such task, the verdict is refused above.
  //
  // The paths-less case is NOT changed here: the repository's own end-to-end
  // contract (tests/m8-t2-e2e-workflow.test.mjs) pins an unpersisted verdict as
  // allowed, and changing it needs a pinned-assertion decision that this
  // remediation does not carry. It is reported as a residual, not silently
  // narrowed.
  return {
    allowed: true,
    nextState: auth.nextState,
    status: paths ? "SUCCESS" : readOnly ? "READ_ONLY" : "UNPERSISTED",
  };
}

/**
 * M12/T9 F-066: the artifacts a runtime "the execution finished" event
 * delivered.
 *
 * The runtime's event shape is not the governance contract, so every field is
 * read defensively and NOTHING is invented: an event that names no artifact
 * yields an empty set, and the caller then records no result rather than a
 * result with no evidence.
 */
export function readExecutionArtifacts(event) {
  const candidates = [
    event?.artifacts,
    event?.artifactPaths,
    event?.artifact_paths,
    event?.result?.artifacts,
    event?.output?.artifacts,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : (entry?.logical_path ?? entry?.path ?? entry?.file_path ?? null),
      )
      .filter((entry) => typeof entry === "string" && entry.length > 0);
  }
  const single =
    event?.artifactPath ??
    event?.artifact_path ??
    event?.result?.artifactPath ??
    event?.result?.artifact_path ??
    null;
  return typeof single === "string" && single.length > 0 ? [single] : [];
}

/**
 * Handles execution finished event with multi-tier validation.
 * Implements ACTIVE.md Section 6, 16, 17:
 * EXECUTION_FINISHED is an event, NOT task completion.
 * Technical PASS + Business FAIL = RESULT BLOCKED.
 */
export const MAX_ARTIFACTS_PER_RESULT = 10;

/**
 * M12/T9 F-040: the boundary an artifact has to be inside.
 *
 * The declared sandbox is the boundary when the caller names one. When it
 * names none, the seam still has ONE root it can prove from the durable state
 * it was handed: the governed store root that owns the task queue (the queue
 * file lives at `<store>/operator/m7-t2/queue.json`, so the store root is
 * three levels above it). An artifact outside that root is out of the
 * sandbox by definition, and the seam refuses it BEFORE its bytes are read.
 */
export function resolveArtifactBoundary({
  sandboxDir = null,
  queueManager = null,
} = {}) {
  if (typeof sandboxDir === "string" && sandboxDir.trim().length > 0) {
    return { root: path.resolve(sandboxDir), source: "DECLARED_SANDBOX" };
  }
  const storagePath = queueStoragePath(queueManager);
  if (!storagePath) return null;
  return {
    root: governedStoreRootFromQueuePath(storagePath),
    source: "GOVERNED_STORE_ROOT",
  };
}

function queueStoragePath(queueManager) {
  try {
    const storagePath = queueManager?.storagePath;
    return typeof storagePath === "string" && storagePath.trim().length > 0
      ? storagePath
      : null;
  } catch {
    // An unconfigured store has no path to prove, and the seam refuses
    // rather than guessing one.
    return null;
  }
}

function governedStoreRootFromQueuePath(storagePath) {
  const resolved = path.resolve(storagePath);
  const segments = resolved.split(path.sep).filter(Boolean);
  const governed =
    segments.length >= 4 &&
    segments[segments.length - 3] === "operator" &&
    segments[segments.length - 2] === "m7-t2";
  if (governed) return path.dirname(path.dirname(path.dirname(resolved)));
  return path.dirname(resolved);
}

/**
 * M12/T9 F-040: refuse an artifact the seam cannot prove is inside the
 * boundary.
 *
 * The refusal carries a named code and is returned as the error of a FAILED
 * result, so no hash of an uncontained file is ever produced or recorded.
 */
export function artifactContainmentFailure(artifactPath, boundary) {
  if (!boundary) {
    return "ARTIFACT_SANDBOX_UNSPECIFIED: no containment boundary could be established for the artifact";
  }
  if (typeof artifactPath !== "string" || !path.isAbsolute(artifactPath)) {
    // The artifact layer owns a non-absolute path; it names it itself.
    return null;
  }
  let artifact;
  let root;
  try {
    artifact = realpathSync(artifactPath);
    root = realpathSync(boundary.root);
  } catch {
    artifact = path.resolve(artifactPath);
    root = path.resolve(boundary.root);
  }
  const relative = path.relative(root, artifact);
  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return `ARTIFACT_OUTSIDE_SANDBOX: the artifact is outside the governed ${boundary.source}`;
  }
  return null;
}

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
  //
  // M12/T9 F-040: the containment boundary is established BEFORE the first
  // byte is read. `artifact-validator.mjs` puts both its symlink-escape check
  // and its sandbox-containment check behind `if (sandboxDir)`, so a caller
  // that names no sandbox had its artifact bytes read, hashed and recorded
  // with no containment proven at all.
  const effectiveSandbox = sandboxDir || technicalConfig.sandboxDir || null;
  const artifactBoundary = resolveArtifactBoundary({
    sandboxDir: effectiveSandbox,
    queueManager,
  });
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
    // The refusal happens BEFORE the read and the hash, so an out-of-sandbox
    // artifact never has its bytes touched.
    const containment = artifactContainmentFailure(
      logicalPath,
      artifactBoundary,
    );
    if (containment) {
      return { status: "FAILED", error: containment };
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
    // M11/T1-R1 (4.2): the replay guard is bounded, so memory cannot grow with
    // the number of completed executions. A key older than the ceiling simply
    // stops being recognized here; the ledger's own terminal-state checks in
    // this function remain the authoritative duplicate guard.
    boundCache(
      globalThis[COMPLETED_EXECUTIONS_KEY],
      COMPLETED_EXECUTIONS_LIMIT,
    );
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
/**
 * M12/T9 F-162: the excel writer that EXECUTES is the one whose digest was
 * admitted.
 *
 * The first two candidates are the plugin's own tree: in the deployed layout
 * they are the PACKAGED asset (`./lib/excel-writer.mjs`, after the packaging
 * rewrite), and in the repository layout they are the file that is packaged
 * from. The third candidate used to be an arbitrary WORKING-TREE path
 * (`findRepoRoot() || process.cwd()`), so a tree edit could change the
 * artifact writer with no digest change at all. That override is gone: the
 * writer is either the plugin's own asset or it is unavailable.
 */
async function getExcelWriter() {
  if (!excelWriterModule) {
    try {
      excelWriterModule = await import("./lib/excel-writer.mjs");
    } catch {
      try {
        excelWriterModule = await import("../../lib/excel-writer.mjs");
      } catch {
        console.error(
          "[zink-governance] Failed to import excel writer: the governed asset is unavailable",
        );
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

/**
 * M11/T1-R1 (4.1): decide whether an outbound attachment may leave the host.
 *
 * The internal tool path already confines every artifact to the agent sandbox
 * (`resolveAgentSandboxDir` is the root the logical paths returned by
 * `validateLiveArtifactPath` resolve under, and `lib/artifact-validator.mjs`
 * enforces the same boundary for published artifacts). An outbound message
 * used to check only `existsSync`, which follows `..` and symlinks, so any file
 * on the host could be published to #office. This reuses that same root and the
 * same relative-path containment idiom — no second path policy, no new
 * dependency.
 *
 * Fails closed for: a missing file, an unresolvable sandbox root, an
 * unresolvable real path, the root itself, or any component that escapes it.
 */
export function containOutboundAttachment(filePath, agentId, context = null) {
  if (typeof filePath !== "string" || filePath.length === 0) {
    return { contained: false, reason: "has no attachment path" };
  }
  const sandboxDir = resolveAgentSandboxDir(agentId, context);
  if (!sandboxDir) {
    return { contained: false, reason: "has no governed sandbox root" };
  }
  let realPath;
  let realRoot;
  try {
    realPath = realpathSync(filePath);
    realRoot = realpathSync(sandboxDir);
  } catch {
    return {
      contained: false,
      reason: "cannot be resolved inside the governed sandbox",
    };
  }
  const relative = path.relative(realRoot, realPath);
  if (
    relative.length === 0 ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    return { contained: false, reason: "escapes the governed sandbox root" };
  }
  return { contained: true, realPath };
}

/**
 * M12/T9 F-122 (legacy R1-A04-04): the stack an agent owns is CANONICAL, and
 * an unmapped agent is REFUSED BY NAME.
 *
 * Four sites used to answer "which stack?" with a silent fallback to the
 * `data_plant` stack, so a delegation with no recorded `stack_id` and no
 * matching task node was granted the data-plant scope instead of a named
 * refusal, and an agent id the plugin's private table did not list silently
 * received `data_plant` nodes which were then written into durable
 * WORKFLOW_BRIEF_ACTIVATED state.
 *
 * The mapping below is validated against the canonical `AGENT_STACK_POLICY`:
 * a "primary" stack the agent is not permitted to own is not a mapping at all,
 * and an agent the canonical roster does not know has NO stack - which is a
 * refusal (AUTH_UNAUTHORIZED_TARGET), never a default.
 */
const CANONICAL_AGENT_PRIMARY_STACK = Object.freeze({
  main: "decision",
  o1: "data_plant",
  o2: "intelligence",
  excel: "data_plant",
  "power-bi": "intelligence",
  sql: "data_plant",
  python: "data_plant",
});

export function canonicalAgentPrimaryStack(agentId) {
  if (typeof agentId !== "string" || agentId.length === 0) return null;
  const primary = CANONICAL_AGENT_PRIMARY_STACK[agentId];
  if (!primary) return null;
  const permitted = AGENT_STACK_POLICY[agentId];
  if (!Array.isArray(permitted) || !permitted.includes(primary)) return null;
  return primary;
}

/**
 * M12/T9 F-302 (legacy R7-C6-02): the expected-result preview's table inputs
 * had no producer, so every generated image was the placeholder layout even
 * though the plan that would fill it was in scope.
 *
 * The table is built from the ADMITTED plan (the task's own recorded nodes) and
 * never from invented data: one column per declared attribute, one row per
 * planned step. A task whose snapshot declares no node keeps the placeholder,
 * because then nothing is declared.
 */
export function buildExpectedResultPreviewInputs(
  governedTask,
  spawnInputs = "",
) {
  const nodes = Array.isArray(governedTask?.nodes) ? governedTask.nodes : [];
  const notes = String(spawnInputs ?? "")
    .trim()
    .slice(0, 120);
  if (nodes.length === 0) {
    return { columns: [], rows: [], notes };
  }
  const columns = ["Bước", "Phần mềm", "Thao tác", "Nghiệm thu"];
  const rows = nodes.slice(0, 8).map((node, index) => [
    String(node?.node_id ?? `node-${index + 1}`),
    specialistSoftwareLabel(node?.agent_id),
    String(node?.inputs ?? "")
      .trim()
      .slice(0, 60) || "—",
    String(node?.validation_criteria ?? "")
      .trim()
      .slice(0, 60) || "—",
  ]);
  return { columns, rows, notes };
}

/**
 * M12/T9 F-305 (legacy R7-C6-06): the preview rasteriser performs no redaction
 * of its own, unlike every other Discord-visible surface. The seam therefore
 * guarantees the invariant the rasteriser relies on: a string that is not
 * already sanitised is refused at the seam and never reaches the image.
 *
 * Only the BANNED-PATTERN removal is compared - whitespace normalisation is
 * not a redaction, so ordinary spacing never refuses a render.
 */
export function previewInputIsSanitised(value) {
  if (typeof value !== "string") return true;
  const normalise = (text) => text.replace(/\s+/gu, " ").trim();
  return normalise(sanitizeDiscordText(value)) === normalise(value);
}

/**
 * M12/T9 F-113 (legacy R1-A16-03): the durable proof that a result was shown
 * to the owner. Both result surfaces (the pending announcement and the
 * accepted publication) record the SAME event shape, so the two can never
 * drift apart.
 */
export function buildResultSurfaceEvent({ taskId, threadId, resultDigest }) {
  const surfaceEvent = {
    task_id: taskId,
    channel: "results",
    thread_id: threadId,
  };
  if (/^[a-f0-9]{64}$/u.test(String(resultDigest ?? "")))
    surfaceEvent.result_digest = resultDigest;
  return surfaceEvent;
}

/**
 * M12/T9 F-027 (legacy R1-A04-02) — the Knowledgebase access matrix carries a
 * DISCOVER tier (`L1`) and the canonical policy enforces it on the `read`
 * action. The knowledge TOOL never used that vocabulary: its own contract
 * declares `search | retrieve | citation | metadata`, so the L1 branch was
 * unreachable dead code and the L1 column carried no security meaning at all
 * (measured: `evaluateToolAccess("main", "zink_knowledge_search", {namespace:
 * "finance"})` returned `allowed: true`).
 *
 * This seam now TRANSLATES the tool's action into the canonical policy action
 * instead of inventing a policy of its own: every content-bearing knowledge
 * action IS a read, and the mutating actions are passed through unchanged so
 * the canonical denial list keeps its full force. The policy table stays the
 * single source of truth for what L1 means.
 */
const KB_CONTENT_ACTIONS = Object.freeze([
  "search",
  "retrieve",
  "citation",
  "metadata",
]);

export function canonicalKnowledgeAction(action) {
  const value = typeof action === "string" ? action.trim().toLowerCase() : "";
  if (value.length === 0) return "read";
  return KB_CONTENT_ACTIONS.includes(value) ? "read" : value;
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
      canonicalKnowledgeAction(params.action),
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

/**
 * M12/T9 F-242: the canonical operation of a governed tool call.
 *
 * The operation comes from the POLICY table and the tool's own contract, never
 * from a field the model chose: `zink_python` executes, `zink_sql` queries,
 * `zink_n8n` triggers, and the two workbook tools name their operation inside
 * the input the published contract validates. An operation the policy does not
 * know is a capability mismatch, not a free-form pass.
 */
export function governedOperationFor(toolName, input) {
  if (toolName === "zink_python") return "execute";
  if (toolName === "zink_sql") return "query";
  if (toolName === "zink_n8n") return "trigger";
  if (toolName === "zink_excel" || toolName === "zink_power_bi") {
    const operation = input?.operation;
    return typeof operation === "string" &&
      OPERATION_POLICY[toolName]?.[operation]
      ? operation
      : null;
  }
  return null;
}

/**
 * M12/T9 F-243: the durable minter for a tool-invocation approval record.
 *
 * `bindInvocationApproval` resolves its record from four stores - a
 * process-global map, `approvals.json`, `approvals/<id>.json` and the task's
 * own approvals map - and NOTHING in the shipped code wrote any of them: the
 * only writers were test fixtures. The control therefore had no
 * production-reachable pass path, and the only real behaviour was the refusal.
 *
 * This is the production writer. The record it writes is the PUBLISHED
 * `GovernedInvocationApproval` shape of `approval-request.schema.json` - the
 * same shape the guard's resolver validates - so the record the owner
 * approves is exactly the record the guard reads back.
 *
 * The record is written UNDER THE LEDGER'S WRITER LOCK, because the guard
 * reads the same store under that lock: an unlocked read could observe a
 * half-written record and then consume a record the consumer never saw.
 */
export const INVOCATION_APPROVAL_TTL_MS = 60 * 60 * 1000;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function invocationApprovalRecordPath(paths, approvalId) {
  if (!paths?.root || typeof paths.root !== "string") return null;
  if (typeof approvalId !== "string" || !UUID_V4_PATTERN.test(approvalId))
    return null;
  return path.join(paths.root, "approvals", `${approvalId}.json`);
}

export function mintInvocationApprovalRecord({
  paths,
  taskId,
  briefRevision,
  toolId,
  operation,
  exactTarget,
  input,
  ownerPrincipalRef,
  expiresAt = null,
  ttlMs = INVOCATION_APPROVAL_TTL_MS,
}) {
  if (!paths?.root || typeof paths.root !== "string") {
    throw new Error("APPROVAL_STORE_UNAVAILABLE: the ledger root is required");
  }
  if (typeof ownerPrincipalRef !== "string" || ownerPrincipalRef.length === 0) {
    throw new Error(
      "APPROVAL_PRINCIPAL_REQUIRED: an approval record must name its owner",
    );
  }
  if (!OPERATION_POLICY[toolId]?.[operation]) {
    throw new Error(
      "APPROVAL_OPERATION_UNKNOWN: the policy declares no such operation",
    );
  }
  const expiresIso =
    typeof expiresAt === "string" && expiresAt
      ? expiresAt
      : new Date(Date.now() + ttlMs).toISOString();
  const materialParameters = deriveApprovalMaterialParameters(
    toolId,
    operation,
    input ?? {},
  );
  const approvalScopeDigest = deriveApprovalScopeDigest({
    task_id: taskId,
    brief_revision: Number(briefRevision),
    tool_id: toolId,
    operation,
    exact_target: exactTarget,
    material_parameters: materialParameters,
    expires_at: expiresIso,
  });
  const approvalId = randomUUID();
  const record = {
    owner_principal_ref: ownerPrincipalRef,
    task_id: taskId,
    brief_revision: Number(briefRevision),
    tool_id: toolId,
    operation,
    exact_target: exactTarget,
    approval_scope_digest: approvalScopeDigest,
    expires_at: expiresIso,
  };
  // The contract is authority, not decoration: a record that does not conform
  // is never written, so the resolver can never find an unusable record.
  validateContract("approval-request", record);
  const recordPath = invocationApprovalRecordPath(paths, approvalId);
  if (!recordPath) {
    throw new Error("APPROVAL_STORE_UNAVAILABLE: no durable approval path");
  }
  // The guard reads this store under the ledger's writer lock, so the write
  // takes the SAME lock: an unlocked write could be observed half-written by
  // a reader that then consumes a record it never fully saw.
  withFileLockSync(lockDirFor(paths.root, "writer.lock"), () => {
    mkdirSync(path.dirname(recordPath), { recursive: true });
    writeJsonAtomicSync(recordPath, record);
  });
  return { approvalId, record, path: recordPath };
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
 *
 * M10/T2-R15: the implementation now lives in `topology/lib/runtime.mjs` and is
 * imported. A second, identical private copy here is exactly how the rule
 * drifted in the first place — the guard kept character-counting `output`,
 * `agent_self_validation`, `assumptions` and `limitations` while this file was
 * byte-budgeting its own fields.
 */
function truncateUtf8(value, maxBytes) {
  return sharedTruncateUtf8(value, maxBytes);
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
              // M12/T9 F-041: `task_id`, `session_key` and `run_id` are the
              // trusted runtime context's correlation identity, never
              // model-fillable fields.
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
              // M12/T9 F-041: `task_id` is the trusted runtime context's
              // correlation identity, never a model-fillable field.
            },
            required: ["query", "namespace"],
          },
      async execute(_id, params) {
        // M8-061: memory/skill authority identity comes from trusted runtime
        // context only. Tool payload never impersonates another agent.
        const mod = await getSkillAdapter();
        // O09: Pass context with task/agent/session identity
        // M12/T9 F-041: a payload correlation key is refused, never honoured.
        const { input, refused, context } = deriveTrustedToolIdentity(
          _id,
          params,
        );
        for (const field of refused) {
          api.logger?.warn?.(
            `[zink-governance] memory tool payload correlation refused: field=${field}`,
          );
        }
        const ctx = context;
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "search",
              ...input,
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
              // M12/T9 F-041: `task_id`, `session_key` and `run_id` are the
              // trusted runtime context's correlation identity, never
              // model-fillable fields.
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
              // M12/T9 F-041: `task_id` is the trusted runtime context's
              // correlation identity, never a model-fillable field.
            },
            required: ["query", "namespace"],
          },
      async execute(_id, params) {
        const mod = await getKnowledgeAdapter();
        // O10: Pass context with task/agent/session identity (M8-061:
        // trusted context only - payload never impersonates)
        // M12/T9 F-041: a payload correlation key is refused, never honoured.
        const { input, refused, context } = deriveTrustedToolIdentity(
          _id,
          params,
        );
        for (const field of refused) {
          api.logger?.warn?.(
            `[zink-governance] memory tool payload correlation refused: field=${field}`,
          );
        }
        const ctx = context;
        if (mod?.executeGovernedKnowledgeQuery) {
          const res = await mod.executeGovernedKnowledgeQuery(
            {
              action: "search",
              ...input,
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
              // M12/T9 F-041: `task_id`, `session_key` and `run_id` are the
              // trusted runtime context's correlation identity, never
              // model-fillable fields.
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
              // M12/T9 F-041: `task_id` is the trusted runtime context's
              // correlation identity, never a model-fillable field.
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
        // (M8-061: trusted context only - payload never impersonates)
        // M12/T9 F-041: a payload correlation key is refused, never honoured.
        const { input, refused, context } = deriveTrustedToolIdentity(
          _id,
          params,
        );
        for (const field of refused) {
          api.logger?.warn?.(
            `[zink-governance] memory tool payload correlation refused: field=${field}`,
          );
        }
        const ctx = context;
        if (mod?.executeGovernedSkillQuery) {
          const res = await mod.executeGovernedSkillQuery(
            {
              action: "propose",
              ...input,
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
 * M10/T2-R5: shape structured inbound id lists into mention entries the
 * existing mention resolver already understands (user objects by id, role
 * ids as raw strings). Invalid entries never reach here — the boundary
 * snowflake-validates every id — so this mapping is total and infallible.
 * Replaces the R4 outbound-attribution cache: host-resolved ownership made
 * the memory fragile and unnecessary, and a single ownership source keeps
 * diagnostics unambiguous.
 */
function toStructuredMentionEntries(ids) {
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => ({ id }));
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

/**
 * M12/T9 F-031: the identity secret that mints a principal ref.
 *
 * A durably recorded "verified user principal" must not be recomputable from
 * public source, and the two trust levels must share ONE vocabulary. The
 * ANSWER_USER path used to mint with the literal string "identity-key", which is
 * in the public source: anyone who knew the snowflake could recompute the
 * recorded ref, and any later comparison between the two trust levels was
 * meaningless. The identity key is the SAME 64-hex secret the ingress path
 * already uses.
 *
 * Returns null when the key is absent or unusable, so the caller can fail
 * closed instead of minting a ref with a weaker key.
 */
export function mintUserPrincipalRef(paths, userPrincipal) {
  if (!paths || userPrincipal === null || userPrincipal === undefined)
    return null;
  const identityPath =
    paths.identityKey || path.resolve(paths.root, "../identity.key");
  try {
    noLinks(identityPath);
    if (!existsSync(identityPath)) return null;
    const key = readFileSync(identityPath, "utf8").trim();
    if (!/^[a-f0-9]{64}$/u.test(key)) return null;
    return derivePrincipalRef(key, String(userPrincipal));
  } catch {
    return null;
  }
}

/**
 * M12/T9 F-049: the ledger's identity secret — READ, and created on first use.
 *
 * This is the ONLY writer of the identity key, so two paths can never mint
 * two different keys for one ledger: the key file is created EXCLUSIVELY and
 * then re-read, so a concurrent creation cannot overwrite a key another writer
 * has already published. A key that cannot be read is not a weaker key: it is
 * no key at all, and every caller fails closed on it.
 *
 * The key never enters a prompt or a log.
 */
export function resolveIdentityKey(paths) {
  if (!paths?.root || typeof paths.root !== "string") return null;
  const identityPath =
    paths.identityKey || path.resolve(paths.root, "../identity.key");
  noLinks(identityPath);
  try {
    if (!existsSync(identityPath)) {
      mkdirSync(path.dirname(identityPath), { recursive: true });
      try {
        writeFileSync(identityPath, `${randomBytes(32).toString("hex")}\n`, {
          mode: 0o600,
          flag: "wx",
        });
      } catch (err) {
        // Another writer won the race: ITS key is the ledger's key.
        if (err?.code !== "EEXIST") return null;
      }
    }
    const key = readFileSync(identityPath, "utf8").trim();
    return isIdentityKey(key) ? key : null;
  } catch {
    return null;
  }
}

/**
 * M12/T9 F-049: the ONE ledger write seam of this plugin.
 *
 * Every durable event this plugin writes passes through here, so the
 * referential scheme is applied at ONE place: the PROSE of a payload can never
 * carry a third party's Discord account id in the clear. The same third party
 * always resolves to the same hashed reference, so the system still
 * recognises the identity when it sees it again.
 *
 * Only prose is rewritten. `message_id`, `thread_id`, `origin_message_id` and
 * `session_key` are STRUCTURAL: they identify a Discord surface, the
 * published contract pins them to their raw form, and rewriting them would
 * break a binding rather than protect a person.
 *
 * The identity secret is needed only when there is an identity to hide: a
 * payload whose prose carries none is written exactly as it was.
 */
export function recordWorkflowEvent(paths, type, payload) {
  return writeWorkflowEvent(
    paths,
    type,
    tokenizePayloadPrincipalReferences(payload, {
      identityKey: resolveIdentityKey(paths),
    }),
  );
}

/**
 * M12/T9 F-083: can the host's Discord component SDK be reached from the running
 * entrypoint? The answer decides whether a button this plugin posts can ever be
 * answered, so it is computed once at load and named in the capability line.
 */
function componentSdkResolvable() {
  try {
    const entrypoint = process.argv?.[1] ?? "";
    if (!entrypoint) return false;
    return hostComponentSdkCandidates(entrypoint).length > 0;
  } catch {
    return false;
  }
}

/**
 * M12/T9 F-158: the governance manifest is a POLICY ARTIFACT. A missing or
 * unparseable one used to raise ENOENT or SyntaxError, which escapes to the host
 * and is re-attributed as a model failure by the run-end seam - and a module-level
 * load failure takes the whole plugin down. Every policy-artifact read now fails
 * with a declared canonical code instead.
 */
export function readGovernanceManifests(manifestUrl) {
  try {
    const parsed = JSON.parse(readFileSync(manifestUrl, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error("not an object");
    return parsed;
  } catch {
    throw new Error("GOVERNANCE_DEPENDENCY_MISSING");
  }
}

function leaseKey(context, event = {}) {
  const sessionKey = context.sessionKey ?? event.sessionKey;
  const runId = context.runId ?? event.runId;
  const toolCallId = context.toolCallId ?? event.toolCallId;
  if (!sessionKey || !runId || !toolCallId)
    // M12/T9 F-087: the diagnostic names the MISSING lineage, never its value. The
    // module's own log policy is "no params, no hash", and a session key / run id /
    // tool call id is exactly the identity this line used to print.
    throw new Error(
      "LINEAGE_MISMATCH: session_key, run_id and tool_call_id are all required",
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
    // F-002: the ONE configured governance store root. The queue projection
    // and the decision ledger live under it, and an unconfigured store
    // refuses by name (GOVERNANCE_STORE_ROOT_UNCONFIGURED) instead of
    // guessing a home-directory path. This must run before the first
    // queue or decision read, so the plugin's own stores resolve to the
    // configured root rather than refusing.
    configureGovernedStoreRoot(config.ledgerRoot);
    const paths = {
      root: config.ledgerRoot,
      events: path.join(config.ledgerRoot, "events.jsonl"),
      snapshot: path.join(config.ledgerRoot, "snapshot.json"),
    };
    const stateDir = path.resolve(config.ledgerRoot, "../../..");
    // Invocation leases prove the native gate ran. They are not workflow state.
    //
    // M12/T9 F-042: this registry is ONE process-global map, so a lease minted under
    // one ledger root used to satisfy a call governed by another, and stopping one
    // registration revoked the other's pending authorizations. Every entry is now
    // partitioned by the governance root that minted it, and a stop revokes only the
    // scope it owns.
    const leasesKey = Symbol.for("zink.governance.native.leases");
    if (!globalThis[leasesKey]) {
      Object.defineProperty(globalThis, leasesKey, { value: new Map() });
    }
    const leases = globalThis[leasesKey];
    const LEASE_TTL_MS = 10 * 60 * 1000;
    const leaseScope = path.resolve(String(config.ledgerRoot ?? ""));
    const scopedLeaseKey = (key) => `${leaseScope}\u0000${key}`;
    function setLease(key, hash) {
      const now = Date.now();
      for (const [k, entry] of leases) {
        if (entry.expiresAt < now) leases.delete(k);
      }
      leases.set(scopedLeaseKey(key), {
        hash,
        expiresAt: now + LEASE_TTL_MS,
        scope: leaseScope,
      });
    }
    function getLease(key) {
      const scoped = scopedLeaseKey(key);
      const entry = leases.get(scoped);
      if (!entry) return undefined;
      if (entry.expiresAt < Date.now()) {
        leases.delete(scoped);
        return undefined;
      }
      return entry.hash;
    }
    /**
     * M12/T9 F-087: consume the lease ONLY when it authorizes THIS call. A wrong or
     * duplicated call must not destroy the one-shot proof, or the correct call that
     * follows is denied with nothing left to check.
     */
    function consumeLease(key, hash) {
      const expected = getLease(key);
      if (expected === undefined || expected !== hash) return false;
      leases.delete(scopedLeaseKey(key));
      return true;
    }
    /** M12/T9 F-042: revoke only the leases this registration owns. */
    function clearScopeLeases() {
      for (const [k, entry] of leases)
        if (entry.scope === leaseScope) leases.delete(k);
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
      const mapping = readGovernanceManifests(
        new URL("./governance-manifests.json", import.meta.url),
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
    const guard = createGovernanceGuard({
      paths,
      manifestFor,
      // M10/T2-R2: the queue projection is the lease authority, so a
      // coordinator's governed mutation is committed inside the queue's own
      // critical section. This is the same lock claim/recovery already use, so a
      // stale recovery cannot interleave between the authority check and the
      // ledger commit. Deliberately bound to the singleton the pickup loop uses,
      // so both observe exactly the same queue state.
      queueExecutionFence: (fence, operation) =>
        defaultQueueManager.withExecutionFence(fence, operation),
    });

    const cachedDiscordTokens = new Map();
    // M12/T2-R1: one tag resolver and one publish path for all three governed forums. Tag
    // ids are read from the forum a thread is about to open in, so a rename in Discord
    // stays an operator action and no snowflake is duplicated in this repository
    // (owner decision Q2 = A).
    const forumTags = createForumTagResolver({ logger: api.logger });

    /**
     * Opens a governed forum thread carrying exactly one tag per required category of that
     * forum, or posts nothing. An unresolved category is logged with the channel, the
     * category and the tag being sought (requirement 4); a failure returns a result instead
     * of throwing, so a broken #approvals surface cannot consume a #results or #incidents
     * event (requirement 5).
     */
    async function postGovernedThread({
      surface,
      channelId,
      token,
      title,
      bodyContent,
      selections,
    }) {
      if (selections.absent.length > 0) {
        for (const category of selections.absent)
          api.logger?.warn?.(
            `[zink-governance] DISCORD_TAG_UNRESOLVED channel=${surface} category=${category} wanted="(no evidence in the governed record)" reason=CLASSIFIER_EMPTY channelId=${channelId ?? "unconfigured"}`,
          );
        return { posted: false, code: "DISCORD_TAG_UNRESOLVED" };
      }
      return openGovernedForumThread({
        surface,
        channelId,
        token,
        title,
        bodyContent,
        selections: selections.selections,
        resolver: forumTags,
        fetchImpl: globalThis.fetch,
        deadlineMs: DISCORD_REST_DEADLINE_MS,
      });
    }

    /**
     * M12/T2-R2: the owner's verdict must be visible where he looks — the forum's STATUS tag,
     * which is what he filters on. The decision is already durable in `WORKFLOW_USER_APPROVAL_
     * DECIDED` before this runs, so the tag is a projection of it and never the record itself:
     * no outcome of this call can undo, delay or rewrite what he decided (requirement 5), which
     * is why it is fire-and-forget at the call site and every refusal here is only a log line.
     * The thread id comes from the durable surface state R1 introduced; a task whose card was
     * never surfaced has nothing to re-tag, and that is reported rather than guessed at.
     */
    async function transitionApprovalTag({ taskId, decision }) {
      const approvalsForumId = resolveDiscordDestination(
        config,
        "discordApprovalsForumId",
        "approvalsChannelId",
      );
      let task;
      try {
        task = readSnapshot(paths)?.tasks?.[taskId] ?? null;
      } catch {
        api.logger?.warn?.(
          `[zink-governance] DISCORD_TAG_TRANSITION_SKIPPED channel=approvals task=${taskId} reason=STATE_UNREADABLE`,
        );
        return { applied: false, code: "STATE_UNREADABLE" };
      }
      if (!task) return { applied: false, code: "TASK_NOT_FOUND" };
      const threadId = task.approval_thread_id ?? null;
      if (!threadId) {
        api.logger?.warn?.(
          `[zink-governance] DISCORD_TAG_TRANSITION_SKIPPED channel=approvals task=${taskId} reason=NO_SURFACE_STATE`,
        );
        return { applied: false, code: "NO_SURFACE_STATE" };
      }
      let token;
      try {
        token = resolveDiscordBotToken("main");
      } catch {
        api.logger?.warn?.(
          `[zink-governance] DISCORD_TAG_TRANSITION_SKIPPED channel=approvals task=${taskId} reason=CREDENTIAL_UNAVAILABLE`,
        );
        return { applied: false, code: "CREDENTIAL_UNAVAILABLE" };
      }
      // M12/T9 F-123: the card's own 24-hour clock. An untouched card whose
      // 24 hours are up is EXPIRED, not WAITING — the owner's ruling is that
      // an unanswered card is not approved. The expiry comes from the durable
      // record of the surfaced card.
      const status = approvalStatusTag(decision, {
        expiresAt: approvalCardExpiresAt(
          readSurfacedApprovalPostedAt(paths, taskId),
        ),
      });
      if (!status) {
        api.logger?.warn?.(
          `[zink-governance] DISCORD_TAG_TRANSITION_SKIPPED channel=approvals task=${taskId} reason=DECISION_UNKNOWN`,
        );
        return { applied: false, code: "DECISION_UNKNOWN" };
      }
      return transitionGovernedForumStatus({
        surface: "approvals",
        channelId: approvalsForumId,
        threadId,
        token,
        status,
        resolver: forumTags,
        fetchImpl: globalThis.fetch,
        deadlineMs: DISCORD_REST_DEADLINE_MS,
        logger: api.logger,
      });
    }

    /**
     * M12/T9 F-123: project the expiry onto the card.
     *
     * The owner's ruling is that an expired card is not approved, and the card
     * must say so: its STATUS tag becomes EXPIRED. The transition is
     * fire-and-forget, exactly like the verdict transition — a decision path
     * never blocks on a Discord round-trip, and a surface failure is a log
     * line, never a verdict.
     *
     * This is the ONLY place besides the post-verdict effect that moves the
     * approvals tag, so the two owner paths (button and text) cannot drift.
     */
    function projectExpiredApprovalTag(taskId) {
      transitionApprovalTag({ taskId, decision: null }).catch((tagErr) => {
        api.logger?.warn?.(
          `[zink-governance] expired approval tag not transitioned for task ${taskId}: ${tagErr?.message}`,
        );
      });
    }

    /**
     * M12/T2-R1: publish an accepted result as one tagged #results thread and return its id,
     * or the id already recorded for this task. #results had no publish path at all before
     * this task, so the delivered work existed only as a sentence in #office. Returns null
     * when no thread could be opened and never throws: an owner verdict already durable in
     * the queue and the ledger cannot be revoked by a surface failure (requirement 5), and
     * the caller still posts its notice.
     */
    async function surfaceAcceptedResult({ taskId, resultsForumId }) {
      let task;
      try {
        task = readSnapshot(paths)?.tasks?.[taskId] ?? null;
      } catch {
        api.logger?.warn?.(
          `[zink-governance] result surface state unreadable for task ${taskId}; no #results thread opened`,
        );
        return null;
      }
      if (!task) return null;
      if (task.results_thread_id) return task.results_thread_id;
      let token;
      try {
        token = resolveDiscordBotToken("main");
      } catch {
        api.logger?.warn?.(
          `[zink-governance] result thread not posted for task ${taskId}: CREDENTIAL_UNAVAILABLE`,
        );
        return null;
      }
      const queueItem = defaultQueueManager.getTask(taskId) ?? {};
      const artifactPaths = [
        ...(Array.isArray(queueItem.artifacts) ? queueItem.artifacts : []),
        ...(Array.isArray(queueItem.resultArtifacts)
          ? queueItem.resultArtifacts
          : []),
      ]
        .map((artifact) =>
          typeof artifact === "string"
            ? artifact
            : (artifact?.logical_path ?? ""),
        )
        .filter(Boolean);
      const surfaced = await postGovernedThread({
        surface: "results",
        channelId: resultsForumId,
        token,
        title: `✅ [KẾT QUẢ] ${displayTaskToken(taskId)}`,
        bodyContent: renderGovernedResultBody({
          taskId,
          software: resultSoftwareLabelFor(task),
          outcomeStatus: task?.root_result?.outcome_status,
          resultDigest: queueItem.resultDigest ?? null,
          planSteps: renderGovernedPlanSteps(
            Array.isArray(task?.nodes) ? task.nodes : [],
          ),
        }),
        selections: resultTagSelectionsFor(task, artifactPaths),
      });
      if (!surfaced.posted) {
        api.logger?.warn?.(
          `[zink-governance] result thread not posted for task ${taskId}: ${surfaced.code}`,
        );
        return null;
      }
      const surfaceEvent = buildResultSurfaceEvent({
        taskId,
        threadId: surfaced.threadId,
        resultDigest: queueItem.resultDigest,
      });
      try {
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", surfaceEvent);
      } catch (recordError) {
        api.logger?.error?.(
          `[zink-governance] RESULT_SURFACE_UNRECORDED task=${taskId} thread=${surfaced.threadId} cause=${recordError?.message}`,
        );
      }
      return surfaced.threadId;
    }

    /**
     * M12/T9 F-113 (legacy R1-A16-03): a result that waits for the owner's
     * verdict must be VISIBLE to him, with the control that accepts it.
     *
     * Before this producer existed, the ONLY producer able to make a pending
     * result visible was the ACCEPT path itself - so the accept path had
     * nothing to accept, and the owner saw the task approved and then silence.
     * This producer announces the pending result as soon as the ledger records
     * it, carries the accept control, and records WORKFLOW_RESULT_SURFACED so
     * the announcement is provable rather than assumed.
     *
     * It is idempotent on the recorded `results_thread_id`: one task has one
     * #results thread, and a second run-end never opens a second one.
     */
    async function surfacePendingResult({ taskId, resultsForumId }) {
      let task;
      try {
        task = readSnapshot(paths)?.tasks?.[taskId] ?? null;
      } catch {
        api.logger?.warn?.(
          `[zink-governance] pending result state unreadable for task ${taskId}; no #results thread opened`,
        );
        return null;
      }
      if (!task) return null;
      // Only a result that is genuinely waiting for the owner is announced
      // here; an accepted result is published by `surfaceAcceptedResult`.
      if (task.workflow_status !== "RESULT_PENDING_REVIEW") return null;
      if (task.results_thread_id) return task.results_thread_id;
      let token;
      try {
        token = resolveDiscordBotToken("main");
      } catch {
        api.logger?.warn?.(
          `[zink-governance] pending result thread not posted for task ${taskId}: CREDENTIAL_UNAVAILABLE`,
        );
        return null;
      }
      const queueItem = defaultQueueManager.getTask(taskId) ?? {};
      const artifactPaths = [
        ...(Array.isArray(queueItem.artifacts) ? queueItem.artifacts : []),
        ...(Array.isArray(queueItem.resultArtifacts)
          ? queueItem.resultArtifacts
          : []),
      ]
        .map((artifact) =>
          typeof artifact === "string"
            ? artifact
            : (artifact?.logical_path ?? ""),
        )
        .filter(Boolean);
      const surfaced = await postGovernedThread({
        surface: "results",
        channelId: resultsForumId,
        token,
        title: `⏳ [KẾT QUẢ CHỜ DUYỆT] ${displayTaskToken(taskId)}`,
        bodyContent: renderGovernedResultBody({
          taskId,
          software: resultSoftwareLabelFor(task),
          outcomeStatus: task?.root_result?.outcome_status,
          resultDigest: queueItem.resultDigest ?? null,
          planSteps: renderGovernedPlanSteps(
            Array.isArray(task?.nodes) ? task.nodes : [],
          ),
        }),
        selections: resultTagSelectionsFor(task, artifactPaths),
      });
      if (!surfaced.posted) {
        api.logger?.warn?.(
          `[zink-governance] pending result thread not posted for task ${taskId}: ${surfaced.code}`,
        );
        return null;
      }
      const surfaceEvent = buildResultSurfaceEvent({
        taskId,
        threadId: surfaced.threadId,
        resultDigest: queueItem.resultDigest,
      });
      try {
        recordWorkflowEvent(paths, "WORKFLOW_RESULT_SURFACED", surfaceEvent);
      } catch (recordError) {
        api.logger?.error?.(
          `[zink-governance] PENDING_RESULT_SURFACE_UNRECORDED task=${taskId} thread=${surfaced.threadId} cause=${recordError?.message}`,
        );
      }
      // The accept control: the owner must be able to ACT on the announcement,
      // not only read about it.
      try {
        const revision = String(task.brief_revision ?? 1);
        const buttons = [
          {
            customId: buildComponentCustomId(
              DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_ACCEPT,
              taskId,
              revision,
            ),
            label: "Accept",
            style: 3,
            emoji: { name: "✅" },
          },
          {
            customId: buildComponentCustomId(
              DISCORD_COMPONENT_ACTION_NAMESPACE.RESULT_REJECT,
              taskId,
              revision,
            ),
            label: "Reject",
            style: 4,
            emoji: { name: "❌" },
          },
        ];
        await sendNativePayload({
          api,
          to: surfaced.threadId,
          threadId: surfaced.threadId,
          accountId: "main",
          buttons,
          payload: buildNativeComponentPayload({
            text: "**Accept** để nghiệm thu kết quả, **Reject** để từ chối kết quả này.",
            buttons,
          }),
        });
      } catch (controlError) {
        api.logger?.warn?.(
          `[zink-governance] pending result controls not delivered for task ${taskId}: ${controlError?.message}`,
        );
      }
      return surfaced.threadId;
    }

    /**
     * M12/T9 F-113 (legacy R1-A16-03): the announcement seam. Fire-and-forget
     * with its own catch: the result is already durable in the ledger, so a
     * surface failure is recorded and never rewrites what the run produced.
     */
    function announcePendingResult(taskId) {
      if (!taskId) return;
      const resultsForumId = resolveDiscordDestination(
        config,
        "discordResultsForumId",
        "resultsChannelId",
      );
      if (!resultsForumId) {
        api.logger?.warn?.(
          "[zink-governance] pending result not announced: no configured results forum",
        );
        return;
      }
      surfacePendingResult({ taskId, resultsForumId }).catch((announceErr) => {
        api.logger?.warn?.(
          `[zink-governance] pending result not announced for task ${taskId}: ${announceErr?.message}`,
        );
      });
    }

    /**
     * M12/T2-R1: surface a governance containment in #incidents as one tagged thread.
     * Strictly additive: the containment and its ledger writes already happened when this
     * runs, and a surface failure is logged rather than folded into the verdict — the block
     * stands either way (requirement 5). If the forum's current threads cannot be read, no
     * thread is opened, because a blind post is how a duplicate incident gets made.
     */
    async function surfaceGovernanceIncident({
      reason,
      runId,
      childSessionKey,
      scope,
      taskIds,
      ledgerError,
    }) {
      const incidentsForumId = resolveDiscordDestination(
        config,
        "discordIncidentsForumId",
        "incidentsChannelId",
      );
      if (!incidentsForumId) {
        api.logger?.warn?.(
          `[zink-governance] DISCORD_TAG_UNRESOLVED channel=incidents category=(none) wanted="(configured incidents forum)" reason=DESTINATION_UNCONFIGURED channelId=unconfigured`,
        );
        return null;
      }
      let botToken;
      try {
        botToken = resolveDiscordBotToken("main");
      } catch {
        api.logger?.warn?.(
          `[zink-governance] incident not surfaced: CREDENTIAL_UNAVAILABLE (reason=${reason})`,
        );
        return null;
      }
      const { token, title } = incidentIdentityFor({
        reason,
        runId,
        childSessionKey,
        scope,
        taskIds,
      });
      let alreadySurfaced;
      try {
        const listing = await readActiveForumThreads({
          channelId: incidentsForumId,
          token: botToken,
          fetchImpl: globalThis.fetch,
          deadlineMs: DISCORD_REST_DEADLINE_MS,
        });
        // M12/T9 F-016: a truncated listing cannot answer "is this incident already open?".
        // The honest answer is "unable to conclude", so the surface is skipped rather than
        // opened a second time for an incident that is already open.
        const decision = incidentSurfaceDecision(listing, token);
        if (decision.reason === "THREAD_LIST_TRUNCATED") {
          api.logger?.warn?.(
            `[zink-governance] INCIDENT_SURFACE_SKIPPED incident=${token} cause=THREAD_LIST_TRUNCATED`,
          );
          return null;
        }
        alreadySurfaced = decision.reason === "ALREADY_SURFACED";
      } catch (listError) {
        api.logger?.warn?.(
          `[zink-governance] INCIDENT_SURFACE_SKIPPED incident=${token} cause=THREAD_LIST_UNREADABLE ${listError?.message}`,
        );
        return null;
      }
      if (alreadySurfaced) {
        api.logger?.info?.(
          `[zink-governance] incident ${token} already surfaced in #incidents; no duplicate thread`,
        );
        return null;
      }
      let affected;
      try {
        const snapshot = readSnapshot(paths);
        affected = taskIds
          .map((taskId) => snapshot?.tasks?.[taskId] ?? null)
          .filter(Boolean);
      } catch {
        affected = [];
      }
      const selections = incidentTagSelectionsFor(affected, {
        reason,
        scope,
        ledgerError,
      });
      const severity =
        selections.selections.find((entry) => entry.category === "SEVERITY")
          ?.value ?? "";
      const surfaced = await postGovernedThread({
        surface: "incidents",
        channelId: incidentsForumId,
        token: botToken,
        title,
        bodyContent: formatIncidentCard({
          incidentId: token,
          taskId: taskIds[0] ?? null,
          state: "OPEN",
          severity: severity || "MEDIUM",
          observed: `Một run không thể đối chiếu (${reason}, phạm vi ${scope}) đã bị tạm dừng: ${taskIds.join(", ") || "không xác định tác vụ"}.`,
          expected:
            "Mọi run kết thúc đều được ghi vào sổ cái governance trước khi hệ thống tiếp tục.",
          action: ledgerError
            ? `Sổ cái KHÔNG ghi được (${ledgerError}) — cần operator đối chiếu trước khi chạy lại.`
            : "Run đã bị chặn cho tới khi operator đối chiếu; chưa có kết quả nào được ghi nhận.",
        }),
        selections,
      });
      if (!surfaced.posted) {
        api.logger?.warn?.(
          `[zink-governance] incident thread not posted for ${token}: ${surfaced.code}`,
        );
        return null;
      }
      api.logger?.info?.(
        `[zink-governance] incident ${token} surfaced in #incidents (threadId: ${surfaced.threadId})`,
      );
      return surfaced.threadId;
    }

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
        // M11/T3 A1: argv, never a shell. execSync interprets its first argument
        // with /bin/sh -c, and this path is joined from a config-derived stateDir
        // that legitimately contains spaces — so a shell here both breaks the call
        // and turns a metacharacter in that value into command execution on the
        // bot-token path.
        const resRaw = execFileSync(resolverPath, [], {
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
      // M12/T9 F-104: the account that opens an #approvals thread is the one
      // the LEDGER assigned to this task. The event's child session key only
      // ever CLAIMS an account; a claim that disagrees with the ledger is
      // refused instead of silently re-routing the card to another bot.
      const eventAgentId = childSessionKey.match(/^agent:([^:]+)/)?.[1] ?? null;
      let ledgerOwner;
      try {
        ledgerOwner = findSession(
          readSnapshot(paths),
          childSessionKey,
          event.childRunId,
          true,
        );
      } catch {
        ledgerOwner = null;
      }
      const account = resolveGovernedAnnouncementAccount({
        owner: ledgerOwner,
        eventAgentId,
      });
      if (account.status === "BLOCKED") {
        api.logger?.warn?.(
          `[zink-governance] approval card blocked: reason=${account.error}`,
        );
        return { status: "BLOCKED", error: account.error };
      }
      if (account.status === "NOT_APPLICABLE") {
        // Not a coordinator announce: this seam has no approval card to
        // publish, so the host's delivery decision is untouched.
        return { status: "NOT_APPLICABLE", agentId: account.agentId };
      }
      const agentId = account.agentId;

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
        // M12/T9 F-109: a governed card was expected and the payload could not
        // be read, so the publish attempt ends in a NAMED refusal, never in
        // silence.
        api.logger?.warn?.(
          "[zink-governance] approval card not published: the announce payload is not readable JSON",
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }
      if (!payload?.output) {
        api.logger?.warn?.(
          "[zink-governance] approval card not published: the announce carries no governed output",
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }

      const card = extractApprovalCard(payload.output);
      if (!card) {
        // The announce is not an approval card at all: the host's delivery
        // decision stays the guard's.
        return { status: "NOT_APPLICABLE", agentId };
      }

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
        return { status: "BLOCKED", error: "GOVERNANCE_DEPENDENCY_MISSING" };
      }
      let token;
      try {
        token = resolveDiscordBotToken(agentId);
      } catch {
        // M12/T9 F-109: the account's credential is unavailable, so no card can
        // be published. The refusal is named; the announce is not reported as
        // delivered.
        api.logger?.error?.(
          "[zink-governance] approval card not posted: the account credential is unavailable",
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }

      let taskId;
      let briefRevision;
      let admittedNodes = [];
      let admittedTaskCode = null;
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
          // M12/T9 F-025 (legacy R1-A03-02): the plan the owner reads must be
          // the ADMITTED brief - the ledger's own recorded node graph - and not
          // the model's card text. These are the nodes the approval is bound to.
          admittedNodes = Array.isArray(owner.task?.nodes)
            ? owner.task.nodes
            : [];
          admittedTaskCode =
            typeof owner.task?.task_code === "string" &&
            owner.task.task_code.length > 0
              ? owner.task.task_code
              : null;
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

      // M12/T9 F-025 (legacy R1-A03-02): the card the owner approves is
      // rendered from the ADMITTED brief with the same canonical builder the
      // first-spawn card uses. The announce's own text is model output: it was
      // never admitted, so it must never be presented as the plan the owner is
      // approving - the plan that executes is the ledger's recorded brief, and
      // the verdict is bound to it (scope_digest + brief_revision below).
      const governedCard = buildFirstSpawnApprovalCard({
        taskId,
        taskCode: admittedTaskCode,
        briefRevision,
        targetAgentId: agentId,
        spawnInputs: "",
        spawnNodeId: null,
        planNodes: admittedNodes,
        previewImage: null,
      });
      let bodyContent = governedCard.bodyContent;
      if (!bodyContent.includes("[APPROVE]")) {
        bodyContent += `\n\n---\n**Thao tác dành cho User (Buttons & Actions):**\n- Phản hồi **APPROVE** hoặc bấm **[APPROVE]** để phê duyệt đưa vào hàng đợi thực thi.\n- Phản hồi **REJECT** hoặc bấm **[REJECT]** để từ chối kế hoạch.\n- Phản hồi **REQUEST REVISION** để yêu cầu sửa đổi kế hoạch.`;
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
      // M12/T2-R1: the durable record of the request AND of any thread that already
      // surfaced it. A task whose card was never posted must be re-driven; a task whose
      // thread is already recorded must not get a second card (owner requirement 5).
      let requestTask;
      try {
        const owner = findSession(
          readSnapshot(paths),
          childSessionKey,
          event.childRunId,
          false,
        );
        const requestTaskId = owner.task_id;
        const before = readSnapshot(paths)?.tasks?.[requestTaskId] ?? null;
        if (before?.approval_thread_id) {
          api.logger?.info?.(
            `[zink-governance] approval already surfaced for task ${requestTaskId} in thread ${before.approval_thread_id}; no duplicate card`,
          );
          // The card IS published (an earlier attempt delivered it), so the
          // verdict says so; the re-drive gate is what stops a second card.
          return {
            status: "PUBLISHED",
            agentId,
            taskId: requestTaskId,
            threadId: before.approval_thread_id,
          };
        }
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
        requestTask = confirmed?.tasks?.[requestTaskId] ?? null;
      } catch (requestError) {
        api.logger?.warn?.(
          `[zink-governance] approval request NOT recorded; card suppressed: ${requestError?.message}`,
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }

      let surfaced;
      try {
        surfaced = await postGovernedThread({
          surface: "approvals",
          channelId: approvalsForumId,
          token,
          title: card.title || "🔖 [PHÊ DUYỆT] Kế hoạch Thực thi",
          bodyContent,
          selections: approvalTagSelectionsFor(requestTask, agentId),
        });
      } catch (postError) {
        api.logger?.warn?.(
          `[zink-governance] Discord approval post exception: ${postError?.message}`,
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }
      if (!surfaced.posted) {
        // Nothing was advertised and the recorded request stands untouched: the owner gets
        // a loud line naming what could not be resolved instead of a thread whose tags do
        // not describe it, and the next attempt can re-drive (requirements 4 and 5).
        api.logger?.warn?.(
          `[zink-governance] approval card not posted for task ${taskId}: ${surfaced.code}`,
        );
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }
      const thread = { id: surfaced.threadId };
      // Native outbound: components travel through the official
      // OpenClaw 2026.6.34 Discord adapter. Only forum-thread
      // creation above remains raw REST (no verified native seam).
      //
      // M12/T9 F-107 + F-180: the DURABLE "surfaced" record is written only for
      // a card the owner can ACT on. The interactive component IS the actionable
      // part; if its delivery fails, the thread carries text the owner cannot
      // approve, and a recorded `approval_thread_id` would refuse every later
      // re-drive forever. So the record comes AFTER the component is delivered:
      // a task whose component never arrived keeps `approval_thread_id` unset
      // and the next attempt surfaces an actionable card.
      let receipt;
      try {
        const buttonSpecs = components[0].components.map((button) => ({
          customId: button.custom_id,
          label: button.label,
          style: button.style,
          emoji: button.emoji,
        }));
        receipt = await sendNativePayload({
          api,
          to: thread.id,
          threadId: thread.id,
          accountId: agentId,
          // M12/T1-R1: `buttons` is what makes the send register the component
          // ids with the host. Without it the adapter still delivers the card,
          // but every click answers "This component has expired."
          buttons: buttonSpecs,
          payload: buildNativeComponentPayload({
            text: bodyContent.slice(0, 2000),
            buttons: buttonSpecs,
          }),
        });
        api.logger?.info?.(
          `[zink-governance] Discord approval card posted for ${agentId} into #approvals (threadId: ${thread.id}, messageId: ${receipt.messageId})`,
        );
      } catch (deliveryErr) {
        api.logger?.error?.(
          `[zink-governance] Discord approval component delivery failed: ${deliveryErr?.message}`,
        );
        // The thread exists but carries no actionable component, so the task
        // stays re-drivable: nothing is recorded as SURFACED.
        return { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
      }
      // M12/T2-R1: the thread exists and the owner can act on it, so the ledger
      // must know. Without this record a retry cannot tell "already surfaced"
      // from "never surfaced", and would either lose the card or open a second
      // one for the same request.
      try {
        recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
          task_id: taskId,
          channel: "approvals",
          thread_id: thread.id,
        });
      } catch (surfaceError) {
        api.logger?.error?.(
          `[zink-governance] APPROVAL_SURFACE_UNRECORDED task=${taskId} thread=${thread.id} cause=${surfaceError?.message}`,
        );
      }
      return { status: "PUBLISHED", agentId, taskId, threadId: thread.id };
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
      // A-3 / R6-A03-01: `QueueManager.save()` does not acquire the queue lock —
      // serialization is the caller's job, and `withLock` is the class's own
      // critical section. Before this, the item was read and written outside any
      // lock, so the save projected a stale whole-document map over one the other
      // pickup loops had already advanced, erasing their committed rows. The read
      // has to move inside as well: `withLock` reloads from disk first, and an
      // item captured before it is a copy that reload has already replaced.
      //
      // Contention stays a returned failure, not a throw: `withLock` converts
      // FILE_LOCK_BUSY into QUEUE_LOCK_TIMEOUT, and `persist` callers treat this
      // evidence as reconciliation material, not authority.
      try {
        return defaultQueueManager.withLock(() => {
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
        });
      } catch (lockErr) {
        return { ok: false, error: lockErr?.message };
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
    /**
     * M10/T2-R17 — one owner-facing label per action.
     *
     * The button and text paths each carried their own copy and they had
     * drifted: the button copy enumerated five actions with a real REJECT-RESULT
     * fallback, while the text copy had four and let its DEFAULT mean ACCEPT.
     * That default is currently safe — the text path can only ever produce
     * APPROVE / REJECT_APPROVAL / REQUEST_REVISION_APPROVAL / ACCEPT_RESULT — but
     * it is a trap: any future text verb would be silently reported to the owner
     * as "nghiệm thu (ACCEPT)". One explicit mapping removes the ambiguity, and
     * an unknown action is reported as unknown rather than as an approval.
     */
    function describeOwnerAction(normAction) {
      switch (normAction) {
        case ACTIONS.APPROVE:
          return "phê duyệt (APPROVE)";
        case ACTIONS.REJECT_APPROVAL:
          return "từ chối (REJECT)";
        case ACTIONS.REQUEST_REVISION_APPROVAL:
          return "yêu cầu sửa đổi (REQUEST REVISION)";
        case ACTIONS.ACCEPT_RESULT:
          return "nghiệm thu (ACCEPT)";
        case ACTIONS.REJECT_RESULT:
          return "từ chối kết quả (REJECT)";
        default:
          return "hành động không xác định";
      }
    }

    /**
     * M10/T2-R16 — the ONE post-decision effect for an owner approval, shared by
     * the button and text paths.
     *
     * It existed as two near-identical copies that had to stay in sync by hand,
     * and they did not: the text copy awaited a cosmetic send before dispatching
     * (R14) and the button copy awaited an unguarded ack (R15) — the same
     * divergence, found twice. One copy removes the cause, so a future change
     * cannot be applied to one path and forgotten in the other.
     */
    function applyOwnerDecisionEffect({
      api,
      config,
      paths,
      normAction,
      taskId,
      userPrincipalRef,
      userConfirmationRef,
      threadId,
    }) {
      // M12/T2-R2: the verdict has to appear on the surface the owner triages. It is already
      // durable in WORKFLOW_USER_APPROVAL_DECIDED, so this is a projection and nothing else:
      // fire-and-forget with its own catch, no decision path awaits a Discord round-trip, and no
      // outcome here can undo, delay or rewrite what he decided (requirement 5).
      if (
        normAction === ACTIONS.APPROVE ||
        normAction === ACTIONS.REJECT_APPROVAL ||
        normAction === ACTIONS.REQUEST_REVISION_APPROVAL
      ) {
        transitionApprovalTag({
          taskId,
          decision:
            // F-085: the ONE reviewed mapping from the authority action to the
            // ledger decision vocabulary. The plugin does not carry its own
            // ternary: the ledger's `decision` value and the authority gate's
            // verdict come from one mapping, so they cannot disagree.
            resolveLedgerDecision(normAction) ?? normAction,
        }).catch((tagErr) => {
          api.logger?.warn?.(
            `[zink-governance] approval tag not transitioned for task ${taskId}: ${tagErr?.message}`,
          );
        });
      }
      if (normAction === ACTIONS.APPROVE) {
        executeApprovedTask({
          taskId,
          paths,
          config,
          api,
          originThreadId: threadId,
        }).catch((err) => {
          api.logger?.error?.(
            `[zink-governance] executeApprovedTask async error: ${err?.message}`,
          );
        });
        return;
      }
      if (normAction !== ACTIONS.ACCEPT_RESULT) return;

      // M7-012: complete only from the verified owner principal, bound to the
      // current authoritative result digest. The caller has already proven the
      // sender is the owner.
      let queueCompletionRecorded = false;
      try {
        defaultQueueManager.completeTask({
          taskId,
          userConfirmationRef,
          userPrincipalRef,
          resultDigest: defaultQueueManager.getTask(taskId)?.resultDigest,
        });
        queueCompletionRecorded = true;
      } catch (qErr) {
        // This queue write is the only thing that advances queue state, so its
        // failure must not be followed by a public success notice. The flag is
        // already false, so only the error is recorded here.
        api.logger?.error?.(
          `[zink-governance] completeTask FAILED (queue not advanced): ${qErr?.message}`,
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
      // Both destinations must be configured: the notice names the results
      // forum, so posting with an unresolved forum renders a dangling mention
      // into an undesignated channel.
      if (officeChannelId && resultsForumId && queueCompletionRecorded) {
        // M12/T2-R1: the accepted result is published as one tagged #results thread first,
        // and the #office notice then points at that thread rather than only naming the
        // forum. The chain is deliberately fire-and-forget with both halves guarded: the
        // verdict is already durable in the queue and the ledger, so a surface or delivery
        // failure is recorded and never rewrites what the owner decided (requirement 5).
        surfaceAcceptedResult({ taskId, resultsForumId })
          .catch((surfaceErr) => {
            api.logger?.warn?.(
              `[zink-governance] result thread not posted for task ${taskId}: ${surfaceErr?.message}`,
            );
            return null;
          })
          .then((resultsThread) =>
            sendNativePayload({
              api,
              to: officeChannelId,
              accountId: "main",
              payload: {
                text: `🎉 **Chúc mừng!** Anh Zink đã chính thức nghiệm thu kết quả tác vụ \`${displayTaskToken(taskId)}\` tại ${
                  resultsThread ? `<#${resultsThread}>` : `<#${resultsForumId}>`
                }. Tác vụ đã hoàn tất xuất sắc và được lưu trữ an toàn trong sổ cái governance. Quản Lý xin cảm ơn anh Zink!`,
              },
            }).catch((deliveryErr) => {
              api.logger?.warn?.(
                `[zink-governance] discord delivery failed (office-completion-notice): ${deliveryErr?.message}`,
              );
            }),
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
     * M10/T2-R2: classify a gateway-started coordinator run from its session
     * identity. Classification is what keeps a coordinator lifecycle event out of
     * the generic native-delegation containment path, so it is decided on
     * IDENTITY and never on queue liveness:
     *  1. the session key must parse as the approved coordinator shape AND name
     *     the observed agent — a key alone never attributes a run;
     *  2. the ledger must hold the exact binding for that (session_key, run_id)
     *     and that attempt, OR the queue must hold a LIVE claim (EXECUTING) by
     *     that coordinator. Either fact alone is sufficient to know this identity
     *     is a governed coordinator run of that task.
     *
     * Why queue status left classification. Requiring EXECUTING meant a
     * coordinator run ending in the window between stale recovery and the next
     * pickup — when the queue item is QUEUED — was classified as unrecognizable,
     * fell through to the delegation path, matched no delegation, and reached the
     * generic containment sweep that suspends every live run in the ledger. A
     * superseded coordinator run is still a coordinator run.
     *
     * `requireBinding` keeps the stricter rule for authority-adjacent decisions
     * (the run-end completion bypass), which is never satisfied by a queue claim
     * alone. `requireLiveClaim` keeps the advisory rule for prompt build, which
     * must describe the CURRENT execution and therefore may not serve a
     * superseded run from its historical binding.
     *
     * An EXECUTING item claimed by a DIFFERENT agent is not ours — UNLESS the
     * ledger holds the exact binding for this identity, in which case identity is
     * proven by the authoritative record and the claim holder is irrelevant to
     * classification (a specialist is itself an assigned claimant for its queue
     * item under M7-010, so `claimedBy` differing from the coordinator is a
     * legitimate state, not evidence of a foreign run). Anything less returns null
     * and the caller keeps its existing fail-closed behavior.
     * Nothing here writes state and nothing here grants execution authority.
     */
    function resolveCoordinatorRun(
      sessionKey,
      runId,
      agentId,
      { requireBinding = false, requireLiveClaim = false } = {},
    ) {
      const parsed = parseCoordinatorSessionKey(sessionKey);
      if (!parsed) return null;
      // Lifecycle events do not always carry the agent identity (notably
      // subagent_ended). When present it must agree with the key; when absent
      // the coordinator is taken from the key and then confirmed by the ledger
      // binding and the queue claim below — the key alone never attributes.
      const coordinator =
        typeof agentId === "string" && agentId.length > 0
          ? agentId
          : parsed.coordinator;
      if (parsed.coordinator !== coordinator) return null;
      // A snapshot read failure means the binding cannot be established, which
      // is indistinguishable from absent for recognition purposes; the caller
      // keeps its fail-closed behavior either way.
      const found = (() => {
        try {
          return findBoundCoordinatorRun(
            readSnapshot(paths),
            sessionKey,
            runId,
            coordinator,
          );
        } catch {
          return null;
        }
      })();
      const binding =
        found && found.coordinatorRun.attempt === parsed.attempt
          ? found.coordinatorRun
          : null;
      if (requireBinding && !binding) return null;
      const queueItem = defaultQueueManager.getTask(parsed.taskId) ?? null;
      let claimedLive = false;
      if (queueItem?.status === "EXECUTING") {
        if (queueItem.claimedBy === parsed.coordinator) {
          claimedLive = true;
        } else if (!binding) {
          // A live claim held by a different agent is somebody else's
          // execution, and with no authoritative binding this identity is only a
          // coincidence. Fail closed exactly as before.
          return null;
        }
        // A binding DOES match, so the identity is proven regardless of who
        // holds the live claim. A specialist is an assigned claimant for its own
        // queue item (M7-010), so `claimedBy` can legitimately differ from the
        // coordinator; refusing recognition here would push a reconciled
        // coordinator run into the generic containment sweep that design
        // contract 2.6 forbids.
      }
      if (requireLiveClaim && !claimedLive) return null;
      if (!binding && !claimedLive) return null;
      return {
        taskId: parsed.taskId,
        coordinator: parsed.coordinator,
        attempt: parsed.attempt,
        queueItem,
        binding,
        bound: Boolean(binding),
        claimedLive,
      };
    }

    /**
     * M10/T2-R2: record a coordinator-originated task mutation only while that
     * coordinator still holds current execution authority, using the same queue
     * critical section the stale-recovery path holds. Delegates and Main keep the
     * existing unfenced path, whose own rules are unchanged.
     */
    function recordCoordinatorFenced(owner, type, payload) {
      if (!owner?.coordinatorRun) {
        return recordWorkflowEvent(paths, type, payload);
      }
      return defaultQueueManager.withExecutionFence(
        {
          taskId: owner.task_id,
          claimedBy: owner.coordinatorRun.coordinator,
          leaseId: owner.coordinatorRun.lease_id,
          attempt: owner.coordinatorRun.attempt,
        },
        () => recordWorkflowEvent(paths, type, payload),
      );
    }

    /**
     * M10/T2: production coordinator pickup loop. It scans authoritative
     * ledger/queue state every PICKUP_SCAN_INTERVAL_MS, claims as the
     * designated coordinator, records the ledger claim, starts the real
     * coordinator turn through api.runtime.subagent.run, and then records the
     * ledger binding. Stopped on gateway_stop.
     *
     * M12/T9 F-021 + F-075: TWO defects, one hub.
     *
     * F-075: the loop was created per `register()` with no process-level latch,
     * so four loops were observed in ONE live process, all of them claiming
     * against the same `defaultQueueManager` singleton. The loop is now latched
     * per ledger scope in one process-global map: a second registration ATTACHES
     * to the running loop instead of starting another, and the loop stops only
     * when the LAST registration for that scope stops.
     *
     * F-021: the eligibility was a ONE-SHOT `existsSync(snapshot)` evaluated at
     * `register()` time, so a snapshot created after the plugin loaded (a
     * first install, or a guarded lock/snapshot recovery - exactly the state
     * the owner's recovery procedures leave behind) left the coordinator lane
     * permanently dark until a restart. The eligibility is now decided when
     * work could be claimed: the reader answers "no tasks" while the snapshot
     * is absent, so an absent snapshot still refuses to claim anything, and a
     * snapshot that appears later starts the lane without a restart.
     */
    const coordinatorRuntime = createCoordinatorRuntimeStart({ api });
    const pickupLoopsKey = Symbol.for(
      "zink.governance.coordinator.pickup.loops",
    );
    if (!globalThis[pickupLoopsKey]) {
      Object.defineProperty(globalThis, pickupLoopsKey, { value: new Map() });
    }
    const pickupLoops = globalThis[pickupLoopsKey];
    const pickupScope = path.resolve(String(config.ledgerRoot ?? ""));
    let pickupEntry = pickupLoops.get(pickupScope);
    if (!pickupEntry) {
      pickupEntry = {
        registrations: 0,
        loop: startCoordinatorPickupLoop({
          queueManager: defaultQueueManager,
          getLedgerTasks: () => readPickupLedgerTasks({ paths }),
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
        }),
      };
      pickupLoops.set(pickupScope, pickupEntry);
    }
    pickupEntry.registrations += 1;
    const coordinatorPickupLoop = pickupEntry.loop;
    coordinatorPickupLoop.start();
    api.logger?.info?.(
      pickupEntry.registrations === 1
        ? "[zink-governance] coordinator pickup loop started"
        : "[zink-governance] coordinator pickup loop already running for this ledger scope; attached",
    );

    const unregister = registerNativeGuard(paths.root, {
      // M10/T2-R8: the PURE direct-intake predicate, evaluated at the Discord
      // preflight seam so a direct specialist mention never creates a host run.
      //
      // It is the SAME rule `authenticateIngress` applies at the native gate —
      // Discord intake is Main only (Decision 3 & RC-01) — with no ledger write,
      // no task derivation and no identity key, so it is safe to run before the
      // host has built a run. The native gate is unchanged and still governs
      // every run; this only removes the run that would have been denied anyway.
      //
      // It is reached through the boundary's published global because the
      // channel bundle cannot import this plugin.
      beforePreflightIngress(event) {
        const agentId = event?.agentId;
        if (!ids.has(agentId)) return { allow: false, reason: "POLICY_DENIED" };
        if (agentId !== "main")
          return { allow: false, reason: "NON_MAIN_DIRECT_INGRESS" };
        return { allow: true };
      },
      beforeIngress(event) {
        // M12/T9 F-049: the prompt transcript is durable and long-lived, so it
        // must not carry a third party's account id in the clear. The OWNER's
        // own id is still substituted exactly as it always was — the owner's
        // identity handling is unchanged — and every OTHER Discord identity
        // (a mention, or a bare snowflake the owner pasted) becomes a hashed
        // reference.
        return {
          prompt: tokenizeDiscordPrincipalReferences(
            sanitizeDelegationText(event.prompt),
            {
              identityKey: resolveIdentityKey(paths),
              ownerDiscordId: config.ownerDiscordId,
            },
          ),
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
        //
        // M10/T2-R14: `ownedByLedger` was hardcoded `false` here, so the ledger
        // ownership test this comment relies on was never actually evaluated —
        // the admission seam and the end-of-run seam classified the same session
        // differently by construction. It now answers the real question, but the
        // snapshot is read ONLY when the cheap preconditions for the internal
        // verdict already hold, so the ordinary governed path pays nothing.
        const cheapInternalShape =
          !context.runId && !context.currentMessageId && !context.message;
        const ownedByLedger = cheapInternalShape
          ? Boolean(
              findSession(
                readSnapshot(paths),
                context.sessionKey,
                context.runId,
              ),
            )
          : false;
        if (
          classifyInternalRunEnd({
            agentId: context.agentId,
            sessionKey: context.sessionKey,
            runId: context.runId,
            ownedByLedger,
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
        let ingressReentry = false;
        if (isDiscordIngress) {
          const admission = authenticateIngress(context);
          if (admission?.allow !== true) return admission;
          ingressReentry = admission.modelFallbackReentry === true;
        } else {
          await awaitSpawnReceipt(context, signal);
        }
        // T3: proactive fallback at the model-resolution seam. The resolved
        // model is run-scoped and returned to the host for the CURRENT run
        // only. No session state is written, no model override is created and
        // no model pin is persisted. Quota is advisory here; a real provider
        // failure still takes the native reactive failover path.
        //
        // M10/T2-R9-C: that sentence must hold on a same-run fallback re-entry.
        // `resolveRuntimeModel` reads QUOTA, which a model failure never lowers,
        // so on the retry it would resolve to the PRIMARY again — the very model
        // just aborted at 372s — and pin the host's reactive failover candidate
        // away. Proven live 2026-10-07: the host had already decided to fail over
        // to `gemini/gemini-3.6-flash` (16:44:19.423 candidate_failed), so the
        // proactive resolution must stand aside and let the host's reactive
        // decision stand. Skipped ONLY for a recognized same-run re-entry; every
        // other admission still resolves exactly as before.
        const decision = await guard.beforeRun(event, context, signal);
        if (decision?.allow !== true) return decision;
        if (ingressReentry) return decision;
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
          // M12/T9 F-242: ONE governed path, chosen by POLICY and never by the
          // shape of the model's own parameters.
          //
          // The branch used to be selected by `isSynthetic`: a call whose
          // params happened to carry call_id/specialist/tool_id/input went
          // through guard.beforeToolCall, and EVERY OTHER call - which is every
          // live call the runtime actually makes - went through a capability
          // lookup and a path check and was ALLOWED. A delegated operation the
          // policy marks `requiresApproval` therefore executed with no
          // approval record, no delegation binding and no
          // AuthorizationDecisionContext, and a model could opt out of the
          // governed path simply by shaping its arguments.
          //
          // The path is now ONE path, and it is the canonical one: the plugin
          // builds the tool-call envelope from TRUSTED context - the ledger's
          // delegation, the policy's operation table - and the guard decides.
          // The model's parameters are DATA (the input), never the authority
          // that selects the path.
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

          // The live input is the model's DATA. The operation comes from the
          // canonical policy tables, so a payload cannot rename the operation
          // it is asking for.
          //
          // The approval id is a GOVERNMENT ENVELOPE field, never tool input:
          // the published tool-call contract carries it beside the input, and
          // the published tool input contracts forbid it. So it is lifted out
          // of the payload here and never reaches the envelope's `input`.
          const rawInput = event.params?.input ?? event.params ?? {};
          const { approval_id: inlineApprovalId, ...liveInput } = rawInput;
          const approvalId =
            typeof inlineApprovalId === "string"
              ? inlineApprovalId
              : typeof event.params?.approval_id === "string"
                ? event.params.approval_id
                : null;
          const operation = governedOperationFor(event.toolName, liveInput);
          if (!operation) {
            return {
              allow: false,
              block: true,
              reason: "RUNTIME_CAPABILITY_MISMATCH",
            };
          }
          if (event.toolName === "zink_n8n") {
            // M7-006: the live n8n path resolves the workflow through the ONE
            // canonical registry, so an unregistered workflow is a capability
            // mismatch and an agent outside the workflow allowlist is denied -
            // before any approval is considered.
            try {
              resolveN8nInvocation({
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
          }

          // The delegation is the authority for the call, and it is resolved
          // from the LEDGER - never asserted by the caller.
          let owner;
          try {
            owner = findSession(
              readSnapshot(paths),
              context.sessionKey,
              context.runId,
            );
          } catch {
            owner = null;
          }
          const delegated =
            AUTHORIZATION_MODE_BY_TOOL[event.toolName] === "delegated";
          if (!owner || (delegated && !owner.delegation)) {
            return {
              allow: false,
              block: true,
              reason: "AUTH_DELEGATION_NOT_FOUND",
            };
          }

          // The owner's approval is resolved through the guard's OWN resolver,
          // so the live seam and the guarded seam can never disagree about
          // which record backs a call. The record is CONSUMED by the guard
          // below; this step only proves that a well-formed, unexpired record
          // exists, and it NAMES the refusal when it does not.
          if (
            OPERATION_POLICY[event.toolName]?.[operation]?.requiresApproval ===
            true
          ) {
            if (!approvalId) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_APPROVAL_REQUIRED",
              };
            }
            let approvalRecord;
            try {
              approvalRecord = resolveAuthenticatedApproval(paths, approvalId);
            } catch (approvalErr) {
              return {
                allow: false,
                block: true,
                reason: approvalErr?.message ?? "AUTH_APPROVAL_INVALID",
              };
            }
            if (!approvalRecord) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_APPROVAL_INVALID",
              };
            }
            const approvalExpiry = Date.parse(approvalRecord.expires_at);
            if (
              !Number.isFinite(approvalExpiry) ||
              Date.now() > approvalExpiry
            ) {
              return {
                allow: false,
                block: true,
                reason: "AUTH_APPROVAL_EXPIRED",
              };
            }
          }

          // The canonical tool-call envelope. Every field except `input` comes
          // from trusted context: the identity, the delegation and the call
          // id. `input` is the model's data, and the published tool-call
          // contract is what validates it.
          const canonicalParams = {
            call_id: randomUUID(),
            specialist: context.agentId,
            tool_id: event.toolName,
            input: liveInput,
            constraints: { timeout_seconds: 300, max_memory_mb: 1024 },
            ...(delegated
              ? {
                  provenance: {
                    delegation_id:
                      owner.delegation?.delegation_id ?? owner.delegation?.id,
                    task_id: owner.task_id,
                    session_key: context.sessionKey,
                  },
                }
              : {
                  provenance: {
                    task_id: owner.task_id,
                    session_key: context.sessionKey,
                  },
                }),
            ...(approvalId ? { approval_id: approvalId } : {}),
          };
          const canonicalEvent = {
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            turn:
              typeof event.turn === "number" && event.turn > 0 ? event.turn : 1,
            params: canonicalParams,
            batchToolNames: [event.toolName],
            assistantText: "",
          };

          // The guard decides. It issues the immutable
          // AuthorizationDecisionContext, resolves the delegation from the
          // ledger, binds and CONSUMES the approval when the operation
          // requires one, and throws on every refusal. A throw here IS the
          // refusal: it is never swallowed into an allow.
          const canonicalDecision = await guard.beforeToolCall(
            canonicalEvent,
            context,
            signal,
          );
          if (event.toolName === "zink_n8n") {
            // The n8n adapter ran INSIDE the guard, so its result is the
            // truthful outcome of the call and is surfaced verbatim.
            return canonicalDecision;
          }
          // The other governed tools execute in this plugin's own registered
          // tool, so the guard's CONTRACT-SEAM result is not the tool's
          // outcome: what matters here is that the guard AUTHORIZED the call.
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

        // M10/T2-R12: first-approval bootstrap for sessions_spawn.
        //
        // Deadlock this closes: a fresh Main task cannot spawn (the guard
        // requires an approved brief), but the only approval-request path
        // needed a child announce, which needs a spawn. Main may now ASK:
        // when an otherwise-valid spawn is denied ONLY for lack of approval,
        // the denial ALSO records a first-class WORKFLOW_APPROVAL_REQUESTED
        // and posts the card to #approvals. Creating the request never
        // authorizes the spawn — the denial below is returned unchanged, and
        // REQUESTED never satisfies the spawn gate. Only a valid Owner
        // approval (APPROVE → QUEUED + approved_at) unblocks a later attempt
        // under the SAME task/run.
        //
        // Precondition (R12 §6): this helper runs only after the plugin's own
        // topology/session/proposal validation passed AND the guard denied
        // with AUTH_APPROVAL_REQUIRED, which since the R12 guard reorder
        // fires only after params/node/topology/budget/lineage validation.
        // Anything else denied stays denied with no request and no card.
        async function requestFirstSpawnApproval({
          ownerTaskId,
          briefRevision,
          targetAgentId,
          spawnInputs,
          spawnNodeId,
        }) {
          const taskId = ownerTaskId;
          try {
            // Dedupe: an existing request means the card flow already ran for
            // this task. Retries (same or different run) must not mint another
            // approval or post another card. The ledger reducer additionally
            // no-ops same-agent+run retries and rejects a second requester.
            // M12/T2-R1: the dedupe key is the *surface*, not the request. A recorded
            // request with no thread means the card was never shown (a failed post, or a
            // required tag that could not be resolved), and the owner would otherwise wait
            // for a card that is not coming. The reducer keeps the request itself
            // idempotent, so re-driving posts the card without minting a second approval;
            // a task with a thread already recorded can never get a second card.
            const snap = readSnapshot(paths);
            const t = snap?.tasks?.[taskId];
            if (!t) return;
            if (t.approval_thread_id) {
              api.logger?.info?.(
                `[zink-governance] first-approval already surfaced for ${taskId} in thread ${t.approval_thread_id}; no duplicate card`,
              );
              return;
            }
            if (t.approved_at) return;
            const alreadyRequested = Boolean(t.approval_requested_at);
            if (!alreadyRequested) {
              recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
                task_id: taskId,
                agent_id: context.agentId,
                session_key: context.sessionKey,
                run_id: context.runId,
                brief_revision: briefRevision,
              });
            }
            // R6 read-back: the request must be visible before anything is
            // surfaced. A failed write posts no card.
            const confirmed = readSnapshot(paths);
            if (!confirmed?.tasks?.[taskId]?.approval_requested_at) {
              throw new Error("APPROVAL_REQUEST_NOT_DURABLE");
            }
            if (alreadyRequested)
              api.logger?.info?.(
                `[zink-governance] first-approval requested for ${taskId} but never surfaced; re-driving the card`,
              );
          } catch (requestError) {
            api.logger?.warn?.(
              `[zink-governance] first-approval request NOT recorded; card suppressed: ${requestError?.message}`,
            );
            return;
          }
          try {
            await postFirstSpawnApprovalCard({
              taskId,
              briefRevision,
              targetAgentId,
              spawnInputs,
              spawnNodeId,
            });
          } catch (postError) {
            // Fail-closed: the denial stands; the recorded request keeps the
            // task approvable by text (taskId) on retry. Never throw: this
            // helper must not change the spawn verdict.
            api.logger?.warn?.(
              `[zink-governance] first-approval card NOT posted: ${postError?.message}`,
            );
          }
        }

        // Card content comes from the exported module-level builder (tested
        // directly); the poster below only transports it.

        async function postFirstSpawnApprovalCard({
          taskId,
          briefRevision,
          targetAgentId,
          spawnInputs,
          spawnNodeId,
        }) {
          const approvalsForumId = resolveDiscordDestination(
            config,
            "discordApprovalsForumId",
            "approvalsChannelId",
          );
          if (!approvalsForumId) {
            api.logger?.error?.(
              "[zink-governance] first-approval card not posted: no configured approvals forum",
            );
            return;
          }
          const token = resolveDiscordBotToken("main");
          // M12/T1-R1: the plan the owner reads comes from the durable brief
          // record, not from the model's spawn payload, so the card cannot present a
          // plan the ledger never admitted. An unreadable snapshot degrades to the
          // spawn-only step rather than dropping the card.
          let governedTask = null;
          try {
            governedTask = readSnapshot(paths)?.tasks?.[taskId] ?? null;
          } catch {
            api.logger?.warn?.(
              "[zink-governance] approval plan read from the ledger failed; the card shows the spawn step only",
            );
          }
          let previewPath = null;
          const previewRoot = resolveAgentSandboxDir("main", context);
          if (previewRoot) {
            // M12/T9 F-302 (legacy R7-C6-02): the expected-result preview had NO
            // producer for its table inputs, so every generated image was the
            // placeholder layout while the plan that would fill it was in
            // scope. The table is now built from the ADMITTED plan - the task's
            // own nodes - and never from invented data.
            const previewInputs = buildExpectedResultPreviewInputs(
              governedTask,
              spawnInputs,
            );
            // M12/T9 F-305 (legacy R7-C6-06): the rasteriser performs no
            // redaction of its own, so the seam guarantees the invariant: a
            // string that is not already sanitised is REFUSED here and never
            // reaches the image.
            const previewStrings = [
              ...previewInputs.columns,
              ...previewInputs.rows.flat(),
              previewInputs.notes,
            ];
            const unsanitised = previewStrings.filter(
              (value) =>
                typeof value === "string" && !previewInputIsSanitised(value),
            );
            if (unsanitised.length > 0) {
              api.logger?.warn?.(
                "[zink-governance] expected-result preview refused: the declared plan text is not sanitised for a Discord-visible surface",
              );
            } else {
              try {
                previewPath = renderExpectedResultPreview({
                  target: targetAgentId,
                  title: `TASK ${displayTaskToken(taskId)}`,
                  columns: previewInputs.columns,
                  rows: previewInputs.rows,
                  notes: previewInputs.notes,
                  outputDirectory: previewRoot,
                });
              } catch (previewError) {
                // The card is still worth approving without a picture; the reason is
                // recorded so an owner asking "where is the image?" has an answer.
                api.logger?.warn?.(
                  `[zink-governance] expected-result preview not rendered: ${previewError?.message}`,
                );
              }
            }
          } else {
            api.logger?.warn?.(
              "[zink-governance] expected-result preview skipped: no governed sandbox root",
            );
          }
          const { title, bodyContent, buttons } = buildFirstSpawnApprovalCard({
            taskId,
            taskCode:
              typeof governedTask?.task_code === "string" &&
              governedTask.task_code.length > 0
                ? governedTask.task_code
                : null,
            briefRevision,
            targetAgentId,
            spawnInputs,
            spawnNodeId,
            planNodes: Array.isArray(governedTask?.nodes)
              ? governedTask.nodes
              : [],
            previewImage: previewPath ? path.basename(previewPath) : null,
          });
          // M12/T2-R1: the thread carries exactly one tag per category the approvals forum
          // requires, resolved from that forum's own available_tags. When a required tag
          // cannot be resolved nothing is posted and the recorded request stays durable,
          // so the next attempt surfaces the card instead of the owner waiting for a
          // thread that is not coming (requirements 4 and 5).
          const surfaced = await postGovernedThread({
            surface: "approvals",
            channelId: approvalsForumId,
            token,
            title,
            bodyContent,
            selections: approvalTagSelectionsFor(governedTask, targetAgentId),
          });
          if (!surfaced.posted)
            throw new Error(`APPROVAL_CARD_NOT_SURFACED:${surfaced.code}`);
          const thread = { id: surfaced.threadId };
          // M12/T2-R1: record the surface, not just the request, so a later retry of the
          // same task can see that the owner was already shown this card.
          try {
            recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
              task_id: taskId,
              channel: "approvals",
              thread_id: thread.id,
            });
          } catch (surfaceError) {
            api.logger?.error?.(
              `[zink-governance] APPROVAL_SURFACE_UNRECORDED task=${taskId} thread=${thread.id} cause=${surfaceError?.message}`,
            );
          }
          // R4-EXCEPTION (owner decision 2026-10-07): buttons travel by raw
          // REST in the SAME call flow as the permitted thread creation. The
          // native adapter cannot deliver from this hook context (proven live
          // twice); this /messages post is the sole permitted exception, marked
          // and test-enforced. See buildApprovalButtonsMessage.
          // M12/T9 F-124: the body is published ONCE - in the thread above.
          // This message carries the buttons and a short ledger-derived
          // pointer, so the owner's approval surface never shows the same
          // body twice.
          const approvalActionLine = buildApprovalActionLine(taskId);
          try {
            const msgRes = await fetch(
              `https://discord.com/api/v10/channels/${thread.id}/messages`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bot ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(
                  buildApprovalButtonsMessage(approvalActionLine, buttons),
                ),
                signal: AbortSignal.timeout(DISCORD_REST_DEADLINE_MS),
              },
            );
            if (!msgRes.ok) {
              throw new Error(`APPROVAL_BUTTONS_POST_FAILED:${msgRes.status}`);
            }
            const posted = await msgRes.json();
            // M12/T1-R1: this site transports by raw REST under the R4-EXCEPTION,
            // so the host's own component send never sees these buttons and would
            // answer every click with "This component has expired." The ids must be
            // registered against the message id that now carries them.
            await registerPostedNativeComponents({
              api,
              buttons,
              messageId: posted?.id ?? "",
              accountId: "main",
            });
            // M12/T1-R1: the expected-result image is a second message of the same
            // thread, because the host carries components on only the first media
            // item. The attachment is confined by the same governed sandbox root the
            // internal tool path already uses, so nothing outside it can be published.
            if (previewPath) {
              const containment = containOutboundAttachment(
                previewPath,
                "main",
                context,
              );
              if (!containment.contained) {
                api.logger?.warn?.(
                  `[zink-governance] expected-result preview not sent: ${containment.reason}`,
                );
              } else {
                try {
                  await sendNativePayload({
                    api,
                    to: thread.id,
                    threadId: thread.id,
                    accountId: "main",
                    payload: {
                      text: `🖼️ Kết quả dự kiến của tác vụ \`${displayTaskToken(taskId)}\` — ${specialistSoftwareLabel(targetAgentId)}`,
                    },
                    mediaUrl: previewPath,
                    mediaLocalRoots: [previewRoot],
                  });
                } catch (mediaErr) {
                  api.logger?.warn?.(
                    `[zink-governance] expected-result preview delivery failed: ${mediaErr?.message}`,
                  );
                }
              }
            }
            api.logger?.info?.(
              `[zink-governance] first-approval card posted for task ${taskId} into #approvals (threadId: ${thread.id}, messageId: ${posted.id})`,
            );
          } catch (deliveryErr) {
            api.logger?.error?.(
              `[zink-governance] first-approval component delivery failed: ${deliveryErr?.message}`,
            );
          }
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
          let fixtureOwner = null;
          if (parsedProposal?.node_id && parsedProposal?.inputs) {
            try {
              const currentSnapshot = readSnapshot(paths);
              fixtureOwner = findSession(
                currentSnapshot,
                context.sessionKey,
                context.runId,
              );
              if (
                fixtureOwner?.task?.nodes?.some(
                  (n) =>
                    n.node_id === parsedProposal.node_id &&
                    n.agent_id === event.params?.agentId,
                )
              ) {
                isPreAdmittedFixture = true;
              }
            } catch {
              // M12/T9 F-079: an unreadable ledger is not a fixture: the branch
              // is skipped and the canonical path decides. The refusal is
              // never swallowed into "this is a fixture".
              isPreAdmittedFixture = false;
              fixtureOwner = null;
            }
          }

          if (isPreAdmittedFixture) {
            let decision;
            try {
              decision = await guard.beforeToolCall(event, context, signal);
            } catch (gateError) {
              // M12/T9 F-079: this branch must never be a DEAD END. The guard
              // refuses with AUTH_APPROVAL_REQUIRED when the owner still has to
              // approve; the canonical path answers that refusal with the
              // first-approval surface (the request plus the card), so this
              // branch answers it the SAME way. Otherwise a model-supplied
              // node id could skip the approval surface entirely and the task
              // would wait for an approval nobody was ever asked for.
              if (gateError?.message === "AUTH_APPROVAL_REQUIRED") {
                await requestFirstSpawnApproval({
                  ownerTaskId: fixtureOwner?.task_id,
                  briefRevision: fixtureOwner?.task?.brief_revision ?? 1,
                  targetAgentId: event.params?.agentId,
                  spawnInputs: sanitizeDelegationText(
                    parsedProposal?.inputs ?? "",
                  ),
                  spawnNodeId: parsedProposal?.node_id,
                });
              }
              throw gateError;
            }
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

          // M10/T2-R12: the canonical proposal strings are derived ONCE here
          // and used for BOTH the admitted nodes below and the canonical
          // proposal further down, so the guard's digest check (handoff vs
          // node digests) can succeed for a well-formed request. Previously
          // the nodes carried hardcoded digests ("{}" / the schema filename)
          // while the guard recomputed over the proposal's actual strings, so
          // NO live spawn through this path could ever pass lineage — every
          // approved spawn would still die at LINEAGE_MISMATCH. Same fallback
          // logic the canonical proposal uses; no new semantics.
          const canonicalConstraints =
            typeof parsedProposal?.constraints === "string"
              ? parsedProposal.constraints
              : "{}";
          const canonicalValidation =
            typeof parsedProposal?.validation_criteria === "string"
              ? parsedProposal.validation_criteria
              : "agent-result-payload.schema.json";

          // M12/T9 F-122: the stack an agent owns is canonical, and an agent the
          // canonical roster does not know is REFUSED BY NAME. The target's
          // stack is resolved BEFORE anything is written, so an unmapped agent
          // can never receive a `data_plant` node and never records one.
          const targetPrimaryStack = canonicalAgentPrimaryStack(targetAgentId);
          if (!targetPrimaryStack) {
            api.logger?.warn?.(
              `[zink-governance] spawn blocked: agent '${targetAgentId}' has no canonical stack mapping (canonical topology violation)`,
            );
            return {
              allow: false,
              block: true,
              reason: "AUTH_UNAUTHORIZED_TARGET",
            };
          }

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
              const nodes = candidateAgents
                .map((id) => ({
                  node_id: `node-${id}`,
                  agent_id: id,
                  // F-122: no silent default. An agent with no canonical stack
                  // contributes NO node rather than a `data_plant` one.
                  stack_id: canonicalAgentPrimaryStack(id),
                  dependencies: [],
                  required: false,
                  input_digest: canonicalHash("zink-input-v1", sanitizedTask),
                  constraints_digest: canonicalHash(
                    "zink-constraints-v1",
                    canonicalConstraints,
                  ),
                  validation_digest: canonicalHash(
                    "zink-validation-v1",
                    canonicalValidation,
                  ),
                }))
                .filter((node) => node.stack_id !== null);

              if (
                candidateNodeId &&
                !nodes.some((n) => n.node_id === candidateNodeId)
              ) {
                nodes.push({
                  node_id: candidateNodeId,
                  agent_id: targetAgentId,
                  // F-122: the target's stack was resolved (and refused when it
                  // is unmapped) before this record was attempted.
                  stack_id: targetPrimaryStack,
                  dependencies: [],
                  required: false,
                  input_digest: canonicalHash("zink-input-v1", sanitizedTask),
                  constraints_digest: canonicalHash(
                    "zink-constraints-v1",
                    canonicalConstraints,
                  ),
                  validation_digest: canonicalHash(
                    "zink-validation-v1",
                    canonicalValidation,
                  ),
                });
              }

              try {
                // M10/T2-R2: this is a coordinator-originated task mutation, so
                // it commits under current execution authority like the spawn
                // reservation does. A superseded coordinator records nothing.
                recordCoordinatorFenced(owner, "WORKFLOW_BRIEF_ACTIVATED", {
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
          // Single derivation point: the nodes above were digested over these
          // exact strings, so the guard's recomputation matches by
          // construction rather than by duplicated fallback logic.
          const canonicalProposal = {
            schema_version: SCHEMA_VERSION,
            governance_version:
              parsedProposal?.governance_version ?? GOVERNANCE_VERSION,
            node_id: assignedNodeId,
            inputs: sanitizedTask,
            input_refs: Array.isArray(parsedProposal?.input_refs)
              ? parsedProposal.input_refs
              : [],
            constraints: canonicalConstraints,
            validation_criteria: canonicalValidation,
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

          const canonicalDecision = await guard
            .beforeToolCall(canonicalEvent, context, signal)
            .catch(async (gateError) => {
              // M10/T2-R12: the guard denies by THROWING, so the approval
              // bootstrap must live in the catch path. The ONLY throw that
              // creates an approval request is AUTH_APPROVAL_REQUIRED, which
              // since the R12 guard reorder fires only after params/node/
              // topology/budget/lineage validation — i.e. the request is
              // otherwise valid but unapproved (§6). Every other throw
              // propagates untouched: no request, no card. The original error
              // is always re-thrown, so the denial is unchanged and REQUESTED
              // never authorizes the spawn (§4, §12).
              if (gateError?.message === "AUTH_APPROVAL_REQUIRED") {
                await requestFirstSpawnApproval({
                  ownerTaskId: owner.task_id,
                  briefRevision: owner.task?.brief_revision ?? 1,
                  targetAgentId,
                  spawnInputs: sanitizedTask,
                  spawnNodeId: assignedNodeId,
                });
              }
              throw gateError;
            });

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
          // M12/T9 F-109: the publish verdict is READ, never discarded. Every
          // path in which a governed approval card was not published yields a
          // verdict, the verdict is recorded, and the host is never told the
          // announcement was delivered when the card never left the process.
          let verdict;
          try {
            verdict = await maybePublishDiscordCard(event);
          } catch (pubErr) {
            api.logger?.warn?.(
              `[zink-governance] Discord card publish warning: ${pubErr?.message}`,
            );
            verdict = { status: "BLOCKED", error: "ANNOUNCE_DELIVERY_FAILED" };
          }
          if (verdict?.status === "BLOCKED") {
            api.logger?.warn?.(
              `[zink-governance] approval card not published: reason=${verdict.error}`,
            );
          } else if (verdict && verdict.status !== "PUBLISHED") {
            api.logger?.info?.(
              `[zink-governance] no governed approval card in this announce (status=${verdict.status})`,
            );
          }
          return resolveAnnouncePublishDecision({ decision, verdict });
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
          // M12/T9 F-122: the node's stack is canonical, and an agent with no
          // canonical stack is refused BY NAME. The previous inline table fell
          // back to the data-plant stack, so an unmapped agent silently
          // received a data-plant node and that node was written into durable
          // state.
          const directStackId = canonicalAgentPrimaryStack(context.agentId);
          if (!directStackId) {
            api.logger?.warn?.(
              `[zink-governance] brief activation refused: agent '${context.agentId}' has no canonical stack mapping`,
            );
            return {
              allow: false,
              reason: "AUTH_UNAUTHORIZED_TARGET",
              taskCompleted: false,
            };
          }
          try {
            recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
              task_id: owner.task_id,
              brief_revision: owner.task.brief_revision || 1,
              semantic_contract_status: "VALID",
              nodes: [
                {
                  node_id: `node-${context.agentId}`,
                  agent_id: context.agentId,
                  stack_id: directStackId,
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
          const runEnd = guard.beforeRunEnd(event, context);
          // M12/T9 F-113 (legacy R1-A16-03): a result the owner has to judge
          // must be announced to him as soon as the ledger records it. The
          // ACCEPT path is not the only producer able to make a pending result
          // visible, so a task can never sit pending with zero producers able
          // to announce it.
          announcePendingResult(owner?.task_id ?? null);
          return runEnd;
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
      // M12/T9 F-042: only this registration's leases are revoked.
      clearScopeLeases();
      // M12/T9 F-075: the pickup loop is shared by every registration for this
      // ledger scope, so it stops only when the LAST one stops. One
      // registration's shutdown must not silence another's lane.
      if (pickupEntry) {
        pickupEntry.registrations = Math.max(0, pickupEntry.registrations - 1);
        if (pickupEntry.registrations === 0) {
          try {
            pickupEntry.loop?.stop();
          } catch {
            // Shutdown must not throw: the loop holds no authority and the queue
            // persists independently.
          }
          pickupLoops.delete(pickupScope);
        }
      }
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
        // M12/T9 F-087: only the call the lease authorizes may consume it. A wrong
        // or duplicated call must not burn the one-shot proof, and the three causes
        // are named so the log says WHICH one refused the call.
        if (matched) consumeLease(key, actualHash);
        if (!expected) throw new Error("POLICY_DENIED:LEASE_MISSING");
        if (!matched) throw new Error("POLICY_DENIED:LEASE_DIGEST_MISMATCH");
      } catch (err) {
        api.logger?.warn?.(`[zink-lease:blocked] ${err?.message ?? err}`);
        return {
          block: true,
          blockReason: "Trusted native governance authorization is missing",
        };
      }
    });
    function authenticateIngress(context) {
      // M10/T2-R8: ingress verdict observability. Every denial and every
      // conversational allow is logged with the reason code plus metadata
      // PRESENCE flags only (counts/booleans — never message content, sender
      // identity, or secrets), so a future live message can be correlated
      // end-to-end without guessing which boundary acted. Logging never
      // alters the verdict: it observes, then the original return stands.
      const ingressEvidence = () => ({
        mentions:
          (Array.isArray(context.mentionedUserIds)
            ? context.mentionedUserIds.length
            : 0) +
          (Array.isArray(context.mentions) ? context.mentions.length : 0),
        reply: Boolean(context.replyReferenceAuthorId),
        threadOwner: Boolean(context.threadOwnerId),
      });
      const deny = (reason) => {
        const evidence = ingressEvidence();
        api.logger?.warn?.(
          `[zink-governance] ingress denied: reason=${reason} agent=${context.agentId} mentions=${evidence.mentions} reply=${evidence.reply} threadOwner=${evidence.threadOwner} msg=${context.currentMessageId ?? context.messageId}`,
        );
        return { allow: false, reason };
      };
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
        return deny("POLICY_DENIED");
      // M7-018: verified sender identity precedes owner authorization.
      const senderAuth = isIngressSenderAuthorized(
        context,
        config.ownerDiscordId,
      );
      if (!senderAuth.ok) return deny(senderAuth.reason);
      if (context.isBot === true || context.author?.bot === true) {
        return deny("BOT_INGRESS_DENIED");
      }
      // M10/T2-R5: structured author bot flag from the inbound event (see
      // the sender-authorization gate above for the same rule).
      if (context.authorIsBot === true) {
        return deny("BOT_INGRESS_DENIED");
      }
      // Direct intake at Discord ingress is strictly Main only (Decision 3 & RC-01).
      if (context.agentId !== "main") {
        return deny("NON_MAIN_DIRECT_INGRESS");
      }
      const msgId = context.currentMessageId ?? context.messageId;
      if (typeof msgId !== "string" || !/^[1-9][0-9]{16,19}$/u.test(msgId)) {
        return deny("LINEAGE_MISMATCH");
      }
      const routing = resolveIngressRouting({
        message: context.message || {
          id: msgId,
          content: context.content,
          // M10/T2-R5: structured Discord inbound metadata forwarded from
          // the preflight seam. Structured ids take precedence over the
          // legacy unforwarded fields; both are validated snowflake shapes
          // by the boundary before they reach this point.
          mentions: [
            ...(Array.isArray(context.mentions) ? context.mentions : []),
            ...toStructuredMentionEntries(context.mentionedUserIds),
            ...toStructuredMentionEntries(context.mentionedRoleIds),
          ],
          mention_roles: context.mentionRoles,
          author: context.author,
        },
        context,
        identifiers: { discordGuildId: config.discordGuildId },
      });
      // M10/T2-R8: the admission SIGNAL is computed here but NOT logged here.
      // Live evidence showed MAIN_DIRECTED emitted at 11:08:11.788 and the same
      // event denied as DUPLICATE_DISCORD_EVENT at 11:08:11.875, so the audit
      // recorded an admission that never happened. The signal is logged only
      // after the duplicate check below has passed, which makes MAIN_DIRECTED
      // mean "admission succeeded" instead of "routing reached this line".
      let admissionSignal;
      if (routing.needs_clarification || routing.target_agents[0] !== "main") {
        // M10/T2-R5: deterministic conversational signals beyond the literal
        // mention. Bypassed ONLY when the routing layer refused solely for a
        // missing mention. Every check above (channel, agent roster, sender
        // authorization, bot filter, Main-only intake) already passed; the
        // lineage, task-derivation and inner-governance checks below still
        // run unchanged. Order: reply first (strongest identity evidence),
        // then thread ownership.
        const missingMention =
          routing.clarification_reason === MISSING_MENTION_REFUSAL;
        const reply = resolveMainReplyAdmission({
          agentId: context.agentId,
          replyReferenceMessageId: context.replyReferenceMessageId,
          replyReferenceAuthorId: context.replyReferenceAuthorId,
          mainBotId: DISCORD_BOT_IDS.main,
          missingMentionRefusal: missingMention,
        });
        if (reply.admitted) {
          admissionSignal = `${MAIN_DIRECTED}: agent=main via reply msg=${msgId}`;
        } else {
          const continuation = resolveMainConversationAdmission({
            agentId: context.agentId,
            threadId: context.threadId,
            threadOwnerId: context.threadOwnerId,
            mainBotId: DISCORD_BOT_IDS.main,
            missingMentionRefusal: missingMention,
          });
          if (!continuation.admitted) {
            return deny(routing.clarification_reason || "INGRESS_NOT_ADMITTED");
          }
          admissionSignal = `${MAIN_CONVERSATION_CONTINUATION}: agent=main msg=${msgId}`;
        }
      } else {
        // Routing targeted Main directly (structured mention path): record
        // which signal admitted, so a future live message is attributable
        // to its evidence rather than to an assumption. Emitted after the
        // duplicate check, so a duplicate never claims an admission.
        admissionSignal = `${MAIN_DIRECTED}: agent=main via mention msg=${msgId}`;
      }
      // Trusted HMAC use only; the key never enters prompts or logs. The key
      // is created by the ONE writer (`resolveIdentityKey`), so two paths can
      // never publish two different keys for one ledger.
      const key = resolveIdentityKey(paths);
      if (!key) throw new Error("EXECUTION_STATE_UNKNOWN");
      const origin = {
        origin: "discord",
        origin_principal_ref: derivePrincipalRef(
          key,
          context.senderId || config.ownerDiscordId || "owner",
        ),
        origin_message_id: msgId,
      };
      const currentSnapshot = readSnapshot(paths);
      // M12/T1-R1: the identity is the owner-visible 12-character code, so it is
      // minted rather than derived — and a re-delivered Discord message can no
      // longer be recognized by recomputing an id. Replay protection therefore
      // reads the origin binding the ledger already recorded for the task.
      const replayedTaskId = findTaskByOriginBinding(currentSnapshot, {
        ...origin,
        root_agent_id: context.agentId,
      });
      const taskId =
        replayedTaskId ??
        mintTaskId({
          date: new Date(),
          // M12/T9 F-227: the code IS the identity, so it is minted from a
          // cryptographic byte source, never from the ambient PRNG.
          random: createTaskCodeRandomSource(),
          isTaken: (candidate) =>
            Object.hasOwn(currentSnapshot?.tasks ?? {}, candidate) ||
            Object.values(currentSnapshot?.tasks ?? {}).some(
              (task) => task.task_code === candidate,
            ),
        });
      // D06: Check snapshot; do not write duplicate WORKFLOW_OPENED event if task already opened.
      // M10/T2-R8: this check now runs BEFORE the admission signal is logged, so
      // a duplicate event produces no MAIN_DIRECTED and no admission claim at all.
      const existingTask = currentSnapshot?.tasks?.[taskId];
      if (existingTask) {
        // M10/T2-R9-C: a model-fallback re-entry is NOT a replay. OpenClaw's
        // fallback starts a new lane for the SAME already-authenticated run:
        // proven live 2026-10-07 16:44:20, msg 1557326125670342669, runId
        // 98aae218-ae57-447f-8a66-1150262e4f3b — the same runId that opened the
        // task, 916ms after `model-fallback/decision candidate_failed`. Denying
        // it here produced `Embedded agent failed before reply` and the owner
        // received nothing, so a HUNG primary (372s, zero bytes) could never
        // fail over. Same defect, first seen 2026-10-06 on msg 1556853993278541867.
        //
        // The discriminator is the task's own recorded root identity, not a
        // timing heuristic: a retry re-enters under the SAME runId that opened
        // the task, so it is a second model attempt of one admitted run. A
        // genuine re-delivery arrives under a DIFFERENT runId and still denies.
        // Replay protection is therefore unchanged for every other caller.
        // Agent and session must also match, so a second agent or a second
        // session can never ride the root identity through.
        const isSameAdmittedRun =
          typeof context.runId === "string" &&
          existingTask.root_run_id === context.runId &&
          existingTask.root_agent_id === context.agentId &&
          existingTask.root_session_key === context.sessionKey;
        if (isSameAdmittedRun) {
          // Log-only attribution: admission is already durable, so no second
          // WORKFLOW_OPENED is written and the signal is not re-emitted.
          api.logger?.info?.(
            `[zink-governance] ingress re-entry admitted as model-fallback retry: agent=${context.agentId} msg=${msgId} runId=${context.runId} task=${taskId}`,
          );
          return { allow: true, taskId, modelFallbackReentry: true };
        }
        // M10/T2-R9-A: log-only. The denying run's runId is recorded so a later
        // change can tell "this same Discord event re-entered by OpenClaw's own
        // model fallback" from "this same event re-delivered" using evidence.
        // Live evidence for why this is needed: on 2026-10-06 the fallback
        // re-entry of msg 1556853993278541867 was denied here 545ms after the
        // fallback decision and made zero model calls, while the identical
        // fallback event on a non-Discord session did call the model.
        api.logger?.warn?.(
          `[zink-governance] ingress denied: reason=DUPLICATE_DISCORD_EVENT agent=${context.agentId} msg=${msgId} runId=${context.runId ?? "none"}`,
        );
        return { allow: false, reason: "DUPLICATE_DISCORD_EVENT" };
      }
      // Admission is proven here: routing admitted, identity resolved, task id
      // derived, and the event is not a duplicate. Only now is the signal an
      // auditable fact.
      if (admissionSignal)
        api.logger?.info?.(`[zink-governance] ${admissionSignal}`);
      // M12/T1-R1: no separate display alias is minted any more. For a task
      // opened under the new rule the identity IS the owner-visible code, so the
      // recorded `task_code` equals `task_id`; for a task admitted before the rule
      // the ledger's own value is carried, and only when the replayed binding is
      // somehow not in the snapshot does nothing get recorded.
      let taskCode = isTaskCodeForm(taskId) ? taskId : null;
      if (taskCode === null) {
        const recorded = currentSnapshot?.tasks?.[taskId]?.task_code;
        if (typeof recorded === "string" && recorded.length > 0)
          taskCode = recorded;
      }
      recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
        ...origin,
        task_id: taskId,
        ...(taskCode ? { task_code: taskCode } : {}),
        root_agent_id: context.agentId,
        root_session_key: context.sessionKey,
        root_run_id: context.runId,
      });
      return { allow: true, taskId, ...(taskCode ? { taskCode } : {}) };
    }
    api.on("before_prompt_build", async (_event, context = {}) => {
      // M10/T2: a recognized coordinator run gets its authoritative brief as
      // advisory context — never the unresolvable-run BLOCKED instruction
      // below, which would sabotage the turn it is meant to serve. Recognition
      // here needs a LIVE queue claim (advisory level), so a first prompt that
      // races the ledger bind write still starts from truthful state while a
      // SUPERSEDED run is not served stale coordinator context. M10/T2-R2 made
      // "live" explicit: recognition for this seam requires the claim to be
      // current, never satisfied by a historical binding alone.
      // Authority for everything the turn does still comes from the ledger
      // binding via the guard, never from this text.
      const coordinatedPrompt = resolveCoordinatorRun(
        context.sessionKey,
        context.runId,
        context.agentId,
        { requireLiveClaim: true },
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
      // M11/T1-R1 (4.3): containment is per target, not per sweep. A single
      // failed write leaves that task running with no ledger record of its
      // suspension, so the whole decision must report UNKNOWN and name the
      // tasks still uncontained instead of claiming the sweep finished.
      const uncontainedTasks = [];
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
            // The list names the tasks left uncontained, so a task with
            // several failing delegations is reported once.
            if (!uncontainedTasks.includes(task_id)) {
              uncontainedTasks.push(task_id);
            }
          }
        }
      } catch (readErr) {
        ledgerError = readErr?.message ?? String(readErr);
      }
      // Containment holds only when at least one ledger write proved it AND no
      // target failed to be recorded. `ledgerWriteFailed` keeps its original
      // meaning (the authoritative ledger does not reflect this sweep), which
      // the zero-target and unreadable-ledger cases already reported.
      const contained = ledgerWritten && uncontainedTasks.length === 0;
      // M12/T2-R1: the containment above is already decided and, where it succeeded,
      // durable. The incident surface therefore runs as its own guarded chain and cannot
      // change this verdict, so a Discord failure never consumes the governance event
      // (requirement 5).
      const incidentTaskIds = [
        ...new Set(
          blocked.map((entry) => entry.task_id).concat(uncontainedTasks),
        ),
      ];
      if (incidentTaskIds.length > 0 || ledgerError) {
        surfaceGovernanceIncident({
          reason,
          runId,
          childSessionKey,
          scope,
          taskIds: incidentTaskIds,
          ledgerError,
        }).catch((surfaceErr) => {
          api.logger?.warn?.(
            `[zink-governance] INCIDENT_SURFACE_FAILED reason=${reason} cause=${surfaceErr?.message}`,
          );
        });
      }
      return {
        allow: false,
        blocked: true,
        governanceState: contained ? "BLOCKED" : "UNKNOWN",
        reason,
        scope,
        blockedTasks: blocked,
        // When the authoritative ledger could not be written for every target,
        // the state is UNKNOWN rather than BLOCKED: nothing may assume the
        // child is contained until the ledger says so.
        ledgerWriteFailed: !contained,
        uncontainedTasks,
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
      // M10/T2-R2: recognition is on identity, so this stays narrow for a
      // SUPERSEDED run too. Before R2 a coordinator ending while its queue item
      // was QUEUED (the window between stale recovery and the next pickup) fell
      // through here, matched no delegation, and reached the ALL_LIVE_RUNS
      // containment sweep. It is still classified as a coordinator run and still
      // records nothing.
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
      // M10/T2-R2: identity-based recognition, so a coordinator spawn observed
      // while the queue item is QUEUED is still recognized and never reaches the
      // ALL_LIVE_RUNS containment sweep below.
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
    /**
     * M12/T9 F-066: the EXECUTION_FINISHED seam.
     *
     * `handleExecutionFinished`, `queueManager.finishExecution` and
     * `formatGovernedResultCard` all existed, but NOTHING registered the
     * runtime event that drives them. The only producer able to make a
     * pending result visible was the ACCEPT path itself, so a finished
     * execution had no live edge to RESULT_PENDING_REVIEW, the queue never
     * left EXECUTING, and the operator documentation described a lifecycle
     * the build did not have.
     *
     * This handler is that edge. The runtime says "the execution finished";
     * the plugin finishes the queue item, records the result in the ledger,
     * and announces the pending result on #results BEFORE the owner's verdict
     * - never after it.
     *
     * Identity comes from the LEDGER and from the QUEUE's own claim, never
     * from the event payload: an event that names a task the ledger does not
     * own, or an attempt the queue never leased, records nothing.
     */
    api.on("execution_finished", (event, context = {}) => {
      const sessionKey = context.sessionKey ?? event?.sessionKey ?? null;
      const runId = context.runId ?? event?.runId ?? null;
      const agentId = context.agentId ?? event?.agentId ?? null;
      if (typeof sessionKey !== "string" || typeof runId !== "string") {
        api.logger?.info?.(
          "[zink-governance] execution_finished carries no governed run identity; no result recorded",
        );
        return { allow: true, governanceState: "UNGOVERNED_RUN" };
      }
      // The owning task is resolved from the LEDGER's own coordinator
      // binding - the same binding the pickup loop and the run-end seam use -
      // and never from the event payload.
      const coordinated = resolveCoordinatorRun(sessionKey, runId, agentId, {
        requireBinding: true,
      });
      if (!coordinated) {
        api.logger?.info?.(
          `[zink-governance] execution_finished for an unbound run ${runId}; no result recorded`,
        );
        return { allow: true, governanceState: "UNGOVERNED_RUN" };
      }
      const taskId = coordinated.taskId;
      const task = readSnapshot(paths)?.tasks?.[taskId] ?? {};
      // A result the owner must judge has to be VISIBLE to him. The root
      // completion-claim path records its own result, so this seam only has
      // to announce what is already pending - and that announcement is
      // idempotent on the recorded thread.
      if (task.workflow_status === "RESULT_PENDING_REVIEW") {
        announcePendingResult(taskId);
        return { allow: true, governanceState: "RESULT_PENDING_REVIEW" };
      }
      const queueItem = coordinated.queueItem ?? null;
      if (!queueItem) {
        api.logger?.warn?.(
          `[zink-governance] execution_finished for task ${taskId} has no queue claim; no result recorded`,
        );
        return { allow: true, governanceState: "NO_QUEUE_CLAIM" };
      }
      const sandboxRoot = resolveAgentSandboxDir(
        queueItem.claimedBy ?? context.agentId ?? "main",
        context,
      );
      const artifacts = readExecutionArtifacts(event)
        .map((entry) =>
          path.isAbsolute(entry) || !sandboxRoot
            ? entry
            : path.join(sandboxRoot, entry),
        )
        .filter(Boolean);
      if (artifacts.length === 0) {
        api.logger?.warn?.(
          `[zink-governance] execution_finished for task ${taskId} carried no artifact; no result recorded`,
        );
        return { allow: true, governanceState: "NO_ARTIFACT" };
      }
      const outcome = handleExecutionFinished({
        taskId,
        agentId: queueItem.claimedBy ?? null,
        leaseId:
          typeof queueItem.leaseId === "string" ? queueItem.leaseId : null,
        attempt: Number.isSafeInteger(queueItem.attempt)
          ? queueItem.attempt
          : null,
        artifacts,
        artifactPath: artifacts[0],
        sandboxDir: sandboxRoot,
        paths,
        queueManager: defaultQueueManager,
      });
      if (outcome?.status !== "READY_FOR_REVIEW") {
        api.logger?.warn?.(
          `[zink-governance] execution_finished for task ${taskId} did not produce a reviewable result: ${outcome?.status ?? "UNKNOWN"}${outcome?.error ? ` (${outcome.error})` : ""}`,
        );
        return {
          allow: true,
          governanceState: outcome?.status ?? "NOT_RECORDED",
        };
      }
      announcePendingResult(taskId);
      return { allow: true, governanceState: "RESULT_PENDING_REVIEW" };
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

    const SPECIALIST_AGENT_IDS = Object.freeze([
      "excel",
      "power-bi",
      "sql",
      "python",
    ]);

    /**
     * M12/T1-R1: is this specialist allowed to speak to the owner right now?
     *
     * The answer comes from the durable ledger only. A specialist reports its own work
     * when the session emitting the message owns a task the owner approved and that is
     * executing or awaiting review; an unapproved, unknown, finished or rejected task
     * keeps the previous suppression. Nothing here consults the message text, so a
     * specialist cannot earn admission by what it says.
     */
    function specialistExecutionProvenance(agentId, ctx = {}) {
      const sessionKey = ctx.sessionKey;
      if (typeof sessionKey !== "string" || sessionKey.length === 0) {
        return { allowed: false, reason: "NO_SESSION_IDENTITY" };
      }
      let task;
      let delegationAgent;
      try {
        const owner = findSession(
          readSnapshot(paths),
          sessionKey,
          ctx.runId,
          true,
        );
        task = owner?.task ?? null;
        delegationAgent = owner?.delegation?.agent_id ?? null;
        if (!task && owner?.task_id) {
          task = readSnapshot(paths)?.tasks?.[owner.task_id] ?? null;
        }
      } catch {
        return { allowed: false, reason: "LEDGER_READ_FAILED" };
      }
      return evaluateSpecialistProvenance({
        agentId,
        task,
        delegationAgentId: delegationAgent,
      });
    }

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

      // M12/T1-R1 (owner option D): a specialist is an execution agent, and the
      // owner's instruction is that the bot which DID the work answers him — "sau khi
      // accept thì chính bot O1 trả về kết quả chứ không phải main". A blanket
      // suppression made that impossible, so the rule is now a provenance gate: a
      // specialist message is admitted only when the emitting session owns a task the
      // owner has approved and that is actually executing. Everything else — an
      // unapproved task, a session the ledger does not recognize, a finished or
      // rejected task, or any unsolicited broadcast — keeps being blocked exactly as
      // before. The destination is still checked against the canonical governed
      // surfaces by the gate below this one, so admitting the agent never admits an
      // arbitrary channel.
      if (SPECIALIST_AGENT_IDS.includes(agentId)) {
        const provenance = specialistExecutionProvenance(agentId, ctx);
        if (!provenance.allowed) {
          api.logger?.warn?.(
            `[zink-governance] Suppressed specialist '${agentId}' Discord message: ${provenance.reason}`,
          );
          return { block: true, cancel: true };
        }
        api.logger?.info?.(
          `[zink-governance] specialist '${agentId}' reporting its own task ${provenance.taskId}`,
        );
      }

      // M10/T2-R12: a governance machine payload is not a reply. The brief
      // envelope is consumed by the gate at the sessions_spawn call and must
      // never reach #office as a user-visible message (live 2026-10-08 15:41).
      // The approval card posted to #approvals is the human-facing artifact for
      // that turn, so suppression loses nothing.
      if (isGovernanceMachinePayload(event.content)) {
        api.logger?.warn?.(
          `[zink-governance] Suppressed governance machine payload from agent='${agentId}' direct reply (consumed by the spawn gate)`,
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

      // E20: Validate outbound attachments/files linkage if present, and since
      // M11/T1-R1 (4.1) confine them too. The existence check alone followed
      // `..` and symlinked components, so any readable host file could be
      // published to #office by naming it here. `http(s)` URLs keep their
      // existing pass-through behavior.
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
                `[zink-governance] message_sending blocked: unlinked/missing attachment`,
              );
              return { block: true, cancel: true };
            }
            const containment = containOutboundAttachment(
              filePath,
              agentId,
              ctx,
            );
            if (!containment.contained) {
              api.logger?.warn?.(
                `[zink-governance] message_sending blocked: attachment '${path.basename(filePath)}' ${containment.reason}`,
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

    // M12/T9 F-083: a host without the interactive API loads GREEN while every
    // button is silently lost, and the component SDK is resolved from the running
    // entrypoint. Both are named at load, so a silent capability loss is visible
    // in the log instead of being inferred from a card that never reacts.
    const interactiveHandlerAvailable =
      typeof api.registerInteractiveHandler === "function";
    const componentSdkAvailable = componentSdkResolvable();

    const capabilityLine = `[zink-governance] capabilities: interactive_handler=${interactiveHandlerAvailable ? "available" : "MISSING"} component_sdk=${componentSdkAvailable ? "available" : "MISSING"}`;
    if (interactiveHandlerAvailable && componentSdkAvailable)
      api.logger?.info?.(capabilityLine);
    else api.logger?.warn?.(capabilityLine);

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
                // M11/T1-R1 (2.4): the owner-approved plan reference is
                // operator configuration, never a hardcoded constant. An
                // unconfigured ref fails the approval closed
                // (APPROVAL_DECISION_REF_REQUIRED) rather than stamping a
                // false provenance into the canonical lifecycle.
                decisionRef: config.skillApprovalDecisionRef,
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
            // M10/T2-R14: guard the unresolved-owner case explicitly. Every other
            // owner gate in this file already writes `!ownerId || ...`
            // (908, 1350, 426-429); these two compared the bare values, and
            // `undefined !== undefined` is false, so a malformed
            // `ownerDiscordId` combined with an event carrying no sender field
            // would have passed the owner check. `resolveOwnerDiscordId` returns
            // undefined for any id that is not 17-19 digits, while the config
            // gate admits 20-digit ids, so that combination is reachable.
            if (!ownerId || senderSnowflake !== ownerId) {
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
                resultId: parsed.revision || `res-${parsed.taskId}`,
                // M12/T9 F-025 (legacy R1-A03-02): the button carries the brief
                // revision the card was issued for, so the verdict can be
                // refused when the plan it showed has been superseded.
                briefRevision: parsed.revision,
              },
            });

            if (res.allowed) {
              const actionLabel = describeOwnerAction(normAction);

              const confirmText =
                normAction === ACTIONS.ACCEPT_RESULT
                  ? `🎉 **Đã nghiệm thu kết quả thành công!**\n- **Mã tác vụ:** \`${parsed.taskId}\`\n- **Trạng thái:** \`${res.nextState}\` (Hoàn tất thành công và lưu trữ an toàn trong sổ cái governance)`
                  : `✅ **Đã ghi nhận ${actionLabel} từ anh Zink!**\n- **Mã tác vụ:** \`${parsed.taskId}\`\n- **Trạng thái:** \`${res.nextState}\` (Đã đưa vào hàng đợi thực thi)`;

              // Cosmetic ack, guarded: an expired interaction token (~15 min lifetime) or a
              // 429 makes `followUp`/`reply` reject, which used to skip the
              // dispatch below and leave the task approved-but-never-run.
              try {
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
              } catch (respondErr) {
                api.logger?.warn?.(
                  `[zink-governance] discord interaction ack failed (non-fatal): ${respondErr?.message}`,
                );
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

              // Post-action execution trigger (R16: shared with the text path, so the two
              // can no longer drift apart).
              applyOwnerDecisionEffect({
                api,
                config,
                paths,
                normAction,
                taskId: parsed.taskId,
                userPrincipalRef: senderSnowflake,
                userConfirmationRef: "user-button-accept",
                threadId,
              });
            } else {
              // M12/T9 F-123: a decision against an expired card is refused,
              // and the card then says so: its STATUS tag becomes EXPIRED. The
              // refusal is already answered to the owner; the tag is the
              // projection of it, and a failure to project is only a log line.
              if (res.reason === "AUTH_APPROVAL_EXPIRED") {
                projectExpiredApprovalTag(parsed.taskId);
              }
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
            // Guarded: a rejection here escapes the handler entirely, and under
            // Node's default unhandled-rejection behaviour that terminates the
            // gateway process.
            try {
              if (typeof ctx.respond?.followUp === "function") {
                await ctx.respond.followUp({ text: errMsg, ephemeral: true });
              } else if (typeof ctx.respond?.reply === "function") {
                await ctx.respond.reply({ text: errMsg, ephemeral: true });
              }
            } catch (reportErr) {
              api.logger?.error?.(
                `[zink-governance] error report to owner also failed: ${reportErr?.message}`,
              );
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
        // M10/T2-R14: `!ownerId ||` — an unresolved owner must never equal an
        // absent sender. See the button path for the full reasoning.
        if (!ownerId || senderId !== ownerId) return;

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
            .find((taskId) => content.includes(taskId)) ||
          // M10/T2-R12: the owner's short code. The full task id is tried FIRST
          // because it is the more specific token. M12/T1-R1: for a task admitted
          // under the new rule the id IS the code, so the two branches converge;
          // the second branch still correlates a legacy 64-hex task the owner
          // quotes by its code. The reducer enforces uniqueness of both, so a
          // substring hit resolves to exactly one task, and a code that matches
          // nothing falls through to the same EXACT_TASK_CORRELATION denial as
          // before — correlation is never loosened, only widened.
          activeTasks
            .filter((task) => typeof task.task_code === "string")
            .find((task) => content.includes(task.task_code))?.task_id;
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

        // M12/T9 F-244: the channel is OBSERVED, never invented. The action
        // word used to decide which channel the verdict was recorded in, so
        // the owner typing `APPROVE <task>` in a DM or in any other channel
        // was admitted and journalled as `channel: "approvals"` — the
        // authority rule then compared the event against the value the caller
        // had itself fabricated, so "approval must occur in #approvals" could
        // never fail. The verdict is now accepted only where it was observed.
        const observedChannelId = String(
          ctx.channelId ??
            event.channelId ??
            ctx.conversationId ??
            ctx.interaction?.channelId ??
            "",
        )
          .replace(/^channel:/u, "")
          .trim();
        const expectedSurfaceId = isResult
          ? resolveDiscordDestination(
              config,
              "discordResultsForumId",
              "resultsChannelId",
            )
          : resolveDiscordDestination(
              config,
              "discordApprovalsForumId",
              "approvalsChannelId",
            );
        if (
          observedChannelId.length === 0 ||
          expectedSurfaceId === undefined ||
          observedChannelId !== expectedSurfaceId
        ) {
          // Fail closed: without a configured destination, or outside it,
          // there is no approval surface to record a verdict in.
          api.logger?.warn?.(
            "[zink-governance] text action blocked: APPROVAL_SURFACE_MISMATCH",
          );
          return;
        }

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
              `res-${displayTaskToken(pendingTask.task_id)}`,
          },
        });

        if (res.allowed) {
          const actionLabel = describeOwnerAction(normAction);

          const confirmText =
            normAction === ACTIONS.ACCEPT_RESULT
              ? `🎉 **Đã nghiệm thu kết quả thành công!**\n- **Mã tác vụ:** \`${pendingTask.task_id}\`\n- **Trạng thái:** \`${res.nextState}\` (Hoàn tất thành công và lưu trữ an toàn trong sổ cái governance)`
              : `✅ **Đã ghi nhận ${actionLabel} từ anh Zink!**\n- **Mã tác vụ:** \`${pendingTask.task_id}\`\n- **Trạng thái:** \`${res.nextState}\` (Đã đưa vào hàng đợi thực thi cho các Specialist)`;

          if (threadId) {
            // The confirmation is cosmetic and must never gate the dispatch
            // below. It used to be `await`ed here, so a delivery failure
            // (NATIVE_OUTBOUND_UNAVAILABLE when the host runtime config is
            // unresolved) skipped `executeApprovedTask` and left the task
            // approved-but-never-dispatched, unrecoverably. See R15/R16.
            sendNativePayload({
              api,
              to: threadId,
              threadId,
              accountId: "o1",
              payload: { text: confirmText },
            }).catch((deliveryErr) => {
              api.logger?.warn?.(
                `[zink-governance] discord delivery failed (text-approval-confirm): ${deliveryErr?.message}`,
              );
            });
          }

          // Post-action execution trigger (R16: shared with the button path).
          applyOwnerDecisionEffect({
            api,
            config,
            paths,
            normAction,
            taskId: pendingTask.task_id,
            userPrincipalRef: senderId,
            userConfirmationRef: "user-text-accept",
            threadId,
          });
        } else if (res.reason === "AUTH_APPROVAL_EXPIRED") {
          // M12/T9 F-123: the text path projects the same refusal onto the
          // card's tag as the button path does.
          projectExpiredApprovalTag(pendingTask.task_id);
        }
      } catch (mErr) {
        api.logger?.warn?.(
          `[zink-governance] message_received approval warning: ${mErr?.message}`,
        );
      }
    });
  },
};
