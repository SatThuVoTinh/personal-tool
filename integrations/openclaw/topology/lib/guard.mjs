import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL, fileURLToPath } from "node:url";

const _moduleDir = path.dirname(fileURLToPath(import.meta.url));

import {
  buildSpawnProposal,
  canonicalHash,
  deriveReferenceId,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "./canonical.mjs";
import { readSnapshot, recordWorkflowEvent, BUDGETS } from "./ledger.mjs";
import {
  findSession,
  findBoundCoordinatorRun,
  ownerRunIds,
} from "./workflow.mjs";
import {
  validateContract,
  validateContractSchema,
  loadContractSchema,
  checkSchema,
  stableJson,
  typeMatches,
  TOOL_CALL_ENVELOPE_MAX_BYTES,
  TOOL_RESULT_ENVELOPE_MAX_BYTES,
} from "./schema.mjs";
import {
  createTrustedResultEnvelope,
  payloadDigest,
  sanitizeDelegationText,
  validateAgentClaim,
  normalizeAgentOutcome,
  truncateUtf8,
} from "./runtime.mjs";
import { withFileLockSync, lockDirFor } from "../../lib/file-lock.mjs";
// Spawn and stack topology are policy decisions, so both are read from the one
// canonical policy module. The deployed plugin flattens this to "./policy.mjs".
import { AGENT_SPAWN_POLICY, AGENT_STACK_POLICY } from "../../lib/policy.mjs";

let policy;
let AGENT_IDS = ["main", "o1", "o2", "excel", "power-bi", "sql", "python"];
// A-2 / R1-A04-05: the stack protocol registry lives in policy.mjs ONLY, the
// same single-authority rule already documented below for the built-in tool
// projection. There is no module-level copy: the previous five-member local
// list was overwritten by `policy.STACK_IDS` on every successful policy load
// anyway, so it was dead code, and while it existed the two lists disagreed
// about both membership and order. An empty list is the fail-closed state, not
// a permissive one: with no loaded policy no stack is a member of the registry
// and the delegation scope check denies.
let STACK_IDS = [];
// M8-067: the delegation-run ceiling is reduced by one for the legacy
// m7-t2-r12 governance version. The CEILING itself is canonical (BUDGETS in
// ledger.mjs); only this version-specific delta is declared here, so there is
// exactly one number that decides how many runs a task may have.
const LEGACY_DELEGATED_RUN_CARVE_OUT = Object.freeze({ "m7-t2-r12": 1 });

// T1: the built-in tool authority lives in policy.mjs ONLY. There is no
// module-level default projection here: without the policy module the guard
// fails closed rather than falling back to a divergent local copy. The previous
// local default listed `subagent_announce`, which the canonical list omits, so
// the two selected different code paths for the same tool id. An empty list is
// the fail-closed state, not a permissive one: a built-in tool is simply not
// recognised as one until the policy module is loaded.
let OPENCLAW_BUILT_IN_TOOL_IDS = [];
let OPERATION_POLICY = {};
let AUTHORIZATION_MODES = {};
let AUTHORIZATION_MODE_BY_TOOL = {};
let DISPATCH_TARGETS = {};
let CALLABLE_TOOL_REGISTRY = {};
let CALLABLE_DISPATCH_REGISTRY = {};
let N8N_WORKFLOW_REGISTRY = {};
let ZINK_CAPABILITY_REGISTRY = {};
let T3_GLOBAL_TIMEOUT_CEILING_MS = 30000;
let T3_GLOBAL_MEMORY_CEILING_MB = 512;
// M7-008: mandatory governance validators must be loaded before use. A
// missing validator fails closed with GOVERNANCE_DEPENDENCY_MISSING —
// never with a no-op fallback that silently allows.
let deriveApprovalMaterialParameters;
let deriveApprovalScopeDigest;
let validateArtifactLogicalPath;
let validateSqlQuery;
let invokeN8n;
let N8nAdapterError = Error;
let depsApprovalLoaded = false;
let depsPolicyLoaded = false;
let depsPathSafetyLoaded = false;
let depsSqlLoaded = false;
let depsN8nLoaded = false;
let depsQuotaLoaded = false;
let quotaTelemetry = null;

function requireDep(loaded, code = "GOVERNANCE_DEPENDENCY_MISSING") {
  if (!loaded) fail(code);
}
function requireQuotaDep() {
  if (!depsQuotaLoaded) fail("GOVERNANCE_DEPENDENCY_MISSING");
}

let depsLoaded = false;
let depsPromise = null;

async function ensureDependencies() {
  if (depsLoaded) return;
  if (!depsPromise) {
    depsPromise = (async () => {
      policy = null;
      // M7-063: package-relative and cwd-relative resolution only.
      // Machine-specific absolute paths are prohibited here.
      const policyCandidates = [
        "../../lib/policy.mjs",
        path.resolve(process.cwd(), "integrations/openclaw/lib/policy.mjs"),
      ];
      for (const candidate of policyCandidates) {
        try {
          const href = candidate.startsWith(".")
            ? // M10/T2-R10: `_moduleDir` is already a filesystem path
              // (`path.dirname(fileURLToPath(import.meta.url))`). Wrapping it in
              // `pathToFileURL` handed `path.resolve` a URL object, which throws
              // `ERR_INVALID_ARG_TYPE`; the throw was swallowed here, the
              // package-relative candidate always died, and production (gateway
              // cwd `/home/hoang_vinh`) fell through to nothing — leaving every
              // capability registry empty and every built-in tool call failing
              // with RUNTIME_CAPABILITY_MISMATCH. Resolve the path directly.
              pathToFileURL(path.resolve(_moduleDir, candidate)).href
            : pathToFileURL(candidate).href;
          const loaded = await import(href);
          if (loaded?.BUILT_IN_TOOL_POLICY) {
            policy = loaded;
            break;
          }
        } catch {
          /* next candidate */
        }
      }

      if (policy) {
        AGENT_IDS = policy.AGENT_IDS ?? [];
        STACK_IDS = policy.STACK_IDS ?? [];
        OPENCLAW_BUILT_IN_TOOL_IDS = policy.OPENCLAW_BUILT_IN_TOOL_IDS ?? [];
        OPERATION_POLICY = policy.OPERATION_POLICY ?? {};
        AUTHORIZATION_MODES = policy.AUTHORIZATION_MODES ?? {};
        AUTHORIZATION_MODE_BY_TOOL = policy.AUTHORIZATION_MODE_BY_TOOL ?? {};
        DISPATCH_TARGETS = policy.DISPATCH_TARGETS ?? {};
        CALLABLE_TOOL_REGISTRY = policy.CALLABLE_TOOL_REGISTRY ?? {};
        CALLABLE_DISPATCH_REGISTRY = policy.CALLABLE_DISPATCH_REGISTRY ?? {};
        N8N_WORKFLOW_REGISTRY = policy.N8N_WORKFLOW_REGISTRY ?? {};
        ZINK_CAPABILITY_REGISTRY = policy.ZINK_CAPABILITY_REGISTRY ?? {};
        T3_GLOBAL_TIMEOUT_CEILING_MS =
          policy.T3_GLOBAL_TIMEOUT_CEILING_MS ?? 30000;
        T3_GLOBAL_MEMORY_CEILING_MB = policy.T3_GLOBAL_MEMORY_CEILING_MB ?? 512;
        deriveApprovalMaterialParameters =
          policy.deriveApprovalMaterialParameters ?? null;
        deriveApprovalScopeDigest = policy.deriveApprovalScopeDigest ?? null;
        depsApprovalLoaded =
          typeof deriveApprovalMaterialParameters === "function" &&
          typeof deriveApprovalScopeDigest === "function";
      }
      // T1: the policy module is the single tool authority. Without it there
      // is no authority, so the guard fails closed instead of using the
      // module-level default projection.
      depsPolicyLoaded =
        policy !== null &&
        typeof policy.BUILT_IN_TOOL_POLICY === "object" &&
        typeof policy.isSessionStatusReadOnlyArgs === "function";

      // T2/T3: quota telemetry is a mandatory governance dependency. Missing
      // it fails closed — never silently degrading to a fabricated quota.
      quotaTelemetry = null;
      const quotaCandidates = [
        path.resolve(_moduleDir, "../../lib/quota-telemetry.mjs"),
        path.resolve(
          process.cwd(),
          "integrations/openclaw/lib/quota-telemetry.mjs",
        ),
      ];
      for (const candidate of quotaCandidates) {
        try {
          const loaded = await import(pathToFileURL(candidate).href);
          if (typeof loaded?.recordQuotaSnapshot === "function") {
            quotaTelemetry = loaded;
            break;
          }
        } catch {
          /* next candidate */
        }
      }
      depsQuotaLoaded =
        quotaTelemetry !== null &&
        typeof quotaTelemetry.recordQuotaSnapshot === "function" &&
        typeof quotaTelemetry.buildSelfQuotaReceipt === "function" &&
        typeof quotaTelemetry.resolveRuntimeModel === "function";

      // M7-063: resolve shared zink-tools modules from the module directory
      // first, then the working directory. Machine-specific absolute paths are
      // prohibited. Every dependency is fail-closed: a missing validator is
      // GOVERNANCE_DEPENDENCY_MISSING, never a no-op allow.
      // M12/T9 F-024: ONE resolver for the shared zink-tools modules. The
      // guard and the plugin used to have two different ones, so the same
      // dependency could be loaded from two different trees and the two
      // copies could disagree. See `loadSharedGovernanceModule` below.
      const loadShared = (relativePath) =>
        loadSharedGovernanceModule(relativePath);
      const pathSafety = await loadShared("zink-tools/common/path-safety.mjs");
      validateArtifactLogicalPath =
        typeof pathSafety?.validateArtifactLogicalPath === "function"
          ? pathSafety.validateArtifactLogicalPath
          : null;
      depsPathSafetyLoaded = validateArtifactLogicalPath !== null;

      const sqlValidator = await loadShared("zink-tools/sql/validator.mjs");
      validateSqlQuery =
        typeof sqlValidator?.validateSqlQuery === "function"
          ? sqlValidator.validateSqlQuery
          : null;
      depsSqlLoaded = validateSqlQuery !== null;

      const n8nAdapter = await loadShared("zink-tools/n8n/trigger.mjs");
      invokeN8n =
        typeof n8nAdapter?.invokeN8n === "function"
          ? n8nAdapter.invokeN8n
          : null;
      N8nAdapterError = n8nAdapter?.N8nAdapterError ?? Error;
      depsN8nLoaded = invokeN8n !== null;

      // M12/T9 F-024: the ready flag used to be set UNCONDITIONALLY, so
      // `whenGovernanceDependenciesReady()` answered `ready: true` while
      // `validateSqlQuery` was still null, and the guard-gated tools failed
      // closed as GOVERNANCE_DEPENDENCY_MISSING. Ready now means what it says:
      // path-safety, the SQL validator and the n8n adapter all loaded.
      depsLoaded = computeGovernanceReadiness({
        pathSafetyLoaded: depsPathSafetyLoaded,
        sqlLoaded: depsSqlLoaded,
        n8nLoaded: depsN8nLoaded,
      });
    })();
  }
  await depsPromise;
}

/**
 * M12/T9 F-024: the readiness rule, as a pure function so it is provable
 * without a broken installation. Ready means: path-safety, the SQL validator
 * and the n8n adapter all actually loaded.
 */
export function computeGovernanceReadiness({
  pathSafetyLoaded = false,
  sqlLoaded = false,
  n8nLoaded = false,
} = {}) {
  return pathSafetyLoaded === true && sqlLoaded === true && n8nLoaded === true;
}

/**
 * M12/T9 F-024: ONE resolver for the shared zink-tools modules.
 *
 * The guard and the plugin used to have two different resolvers for the same
 * dependencies — the guard resolved from its own module directory plus the
 * working directory, the plugin from a repo-root walk plus a machine-specific
 * absolute path — so the same module could be loaded from two different
 * trees, and the two copies could disagree. Both now use this one, and the
 * candidate order is the same for both.
 *
 * The working directory is still the LAST resort: it is the only candidate
 * that works in the flattened installed tree. It is never the first.
 */
export function resolveSharedGovernanceModulePath(
  relativePath,
  { roots = [] } = {},
) {
  const candidates = [
    ...roots
      .filter((root) => typeof root === "string" && root.length > 0)
      .map((root) => path.resolve(root, relativePath)),
    path.resolve(_moduleDir, "../../../../" + relativePath),
    path.resolve(process.cwd(), relativePath),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export async function loadSharedGovernanceModule(
  relativePath,
  { roots = [] } = {},
) {
  const candidates = [
    ...roots
      .filter((root) => typeof root === "string" && root.length > 0)
      .map((root) => path.resolve(root, relativePath)),
    path.resolve(_moduleDir, "../../../../" + relativePath),
    path.resolve(process.cwd(), relativePath),
  ];
  for (const candidate of candidates) {
    try {
      const loaded = await import(pathToFileURL(candidate).href);
      if (loaded) return loaded;
    } catch {
      /* next candidate */
    }
  }
  return null;
}

/**
 * The governance dependencies (policy authority, validators, adapters) load
 * asynchronously. Callers that need the loaded policy — such as the live tool
 * path — await this before deciding, so a policy that is not yet loaded fails
 * as "not ready" rather than as a silent pass against an empty projection.
 */
export async function whenGovernanceDependenciesReady() {
  await ensureDependencies();
  return Object.freeze({
    // M12/T9 F-024: `ready` now means every shared module actually loaded.
    ready: depsLoaded,
    policyLoaded: depsPolicyLoaded,
    pathSafetyLoaded: depsPathSafetyLoaded,
    sqlLoaded: depsSqlLoaded,
    n8nLoaded: depsN8nLoaded,
  });
}

function fail(code) {
  throw new Error(code);
}
function assert(value, code) {
  if (!value) fail(code);
}
const activeRun = new Set([
  "PENDING",
  "SPAWN_UNKNOWN",
  "RUNNING",
  "UNKNOWN",
  "BLOCKED",
]);
const nativeSpawnKeys = new Set([
  "task",
  "agentId",
  "runtime",
  "mode",
  "thread",
  "context",
  "sandbox",
  "cleanup",
  "taskName",
]);

export function isUuidV4(str) {
  return (
    typeof str === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str,
    )
  );
}

/**
 * M7-006: the single canonical n8n invocation decision. Both the guarded
 * tool-call path and the live OpenClaw tool path resolve the workflow, the
 * operation, the target and the approval requirement HERE, so an n8n trigger
 * can never be authorized by one registry lookup on one path and skipped on the
 * other.
 *
 * Fails closed with the canonical reason code; never returns undefined.
 */
export function resolveN8nInvocation({
  workflowId,
  agentId,
  toolId = "zink_n8n",
}) {
  // The policy module is the single tool authority. Without it there is no
  // authority to decide against, so this fails closed rather than deciding
  // against an empty projection.
  requireDep(depsPolicyLoaded);
  const workflowDef =
    typeof workflowId === "string"
      ? N8N_WORKFLOW_REGISTRY[workflowId]
      : undefined;
  // An unregistered workflow id is a capability mismatch, not a pass.
  if (!workflowDef) fail("RUNTIME_CAPABILITY_MISMATCH");
  // The workflow allowlist is agent-scoped, exactly as the guarded path applies it.
  if (!workflowDef.allowedAgents?.includes(agentId)) {
    fail("AUTH_POLICY_DENIED");
  }
  const opPolicy = OPERATION_POLICY[toolId]?.trigger;
  if (!opPolicy) fail("RUNTIME_CAPABILITY_MISMATCH");
  return Object.freeze({
    workflowId,
    workflowDef,
    toolId,
    operationName: "trigger",
    actualTarget: workflowId,
    requiresApproval: opPolicy.requiresApproval === true,
    timeoutMs: workflowDef.timeoutMs,
  });
}

/**
 * M7-006: the single canonical approval binding for one tool invocation. The
 * guarded path and the live path both bind an approval here, so an approval can
 * never be required on one path and optional on the other.
 */
export function bindInvocationApproval({
  paths,
  approvalId,
  taskId,
  briefRevision,
  originPrincipalRef,
  toolId,
  operationName,
  actualTarget,
  input,
  runId,
  currentTime,
}) {
  requireDep(depsPolicyLoaded);
  if (approvalId === undefined || approvalId === null) {
    fail("AUTH_APPROVAL_REQUIRED");
  }
  if (typeof approvalId !== "string" || !isUuidV4(approvalId)) {
    fail("AUTH_APPROVAL_INVALID");
  }
  const record = resolveAuthenticatedApproval(paths, approvalId);
  if (!record || typeof record !== "object") fail("AUTH_APPROVAL_INVALID");
  // M12/T9 F-245: the principal assertion was wrapped in a conditional, and
  // the caller derives the reference from a three-deep fallback chain — so a
  // task that names no principal silently lost the "who approved this"
  // binding while every other check still passed. The reference is now
  // REQUIRED: an approval that cannot name its principal is invalid.
  assert(
    typeof originPrincipalRef === "string" &&
      originPrincipalRef.length > 0 &&
      record.owner_principal_ref === originPrincipalRef,
    "AUTH_APPROVAL_INVALID",
  );
  assert(record.task_id === taskId, "AUTH_APPROVAL_INVALID");
  assert(
    String(record.brief_revision) === String(briefRevision),
    "AUTH_APPROVAL_INVALID",
  );
  assert(
    record.tool_id === toolId && record.operation === operationName,
    "AUTH_APPROVAL_INVALID",
  );
  assert(record.exact_target === actualTarget, "AUTH_APPROVAL_INVALID");
  const expiryMs = Date.parse(record.expires_at);
  if (Number.isNaN(expiryMs) || currentTime > expiryMs) {
    fail("AUTH_APPROVAL_EXPIRED");
  }
  const materialParameters = (() => {
    requireDep(depsApprovalLoaded);
    return deriveApprovalMaterialParameters(toolId, operationName, input);
  })();
  const expectedDigest = (() => {
    requireDep(depsApprovalLoaded);
    return deriveApprovalScopeDigest({
      task_id: record.task_id,
      brief_revision: record.brief_revision,
      tool_id: record.tool_id,
      operation: record.operation,
      exact_target: record.exact_target,
      material_parameters: materialParameters,
      expires_at: record.expires_at,
    });
  })();
  assert(
    record.approval_scope_digest === expectedDigest,
    "AUTH_APPROVAL_INVALID",
  );
  const claimResult = consumeApprovalAtomically(paths, approvalId, {
    task_id: record.task_id,
    brief_revision: record.brief_revision,
    tool_id: record.tool_id,
    operation: record.operation,
    exact_target: record.exact_target,
    approval_scope_digest: record.approval_scope_digest,
    run_id: runId,
  });
  if (!claimResult) fail("AUTH_APPROVAL_REPLAYED");
  return expiryMs;
}

export function deepFreeze(object) {
  if (object === null || typeof object !== "object") {
    return object;
  }
  const propNames = Reflect.ownKeys(object);
  for (const name of propNames) {
    const value = object[name];
    if (value && typeof value === "object") {
      deepFreeze(value);
    }
  }
  return Object.freeze(object);
}

export function makeEngineNotImplementedResult(callId, toolId, specialist) {
  return {
    call_id: callId,
    tool_id: toolId,
    specialist: specialist,
    status: "error",
    error: {
      code: "ENGINE_NOT_IMPLEMENTED",
      message: `Engine for ${toolId} is not implemented in T3.`,
      details: "Contract seam invoked; engine execution unavailable.",
    },
    artifacts: [],
  };
}

export function makeTimeoutResult(callId, toolId, specialist) {
  return {
    call_id: callId,
    tool_id: toolId,
    specialist: specialist,
    status: "timeout",
    error: {
      code: "TOOL_TIMEOUT",
      message: "Tool invocation timed out.",
      details: "Adapter execution exceeded timeout ceiling.",
    },
    artifacts: [],
  };
}

export function makeErrorResult(
  callId,
  toolId,
  specialist,
  errorCode,
  message,
  details = "Adapter execution failed.",
) {
  return {
    call_id: callId,
    tool_id: toolId,
    specialist: specialist,
    status: "error",
    error: {
      code: errorCode,
      message: message,
      details: details,
    },
    artifacts: [],
  };
}

export function verifyResultCorrelation(result, callId) {
  if (!result || typeof result !== "object") {
    throw new Error("CORRELATION_MISMATCH");
  }
  if (result.call_id !== callId) {
    throw new Error("CORRELATION_MISMATCH");
  }
  return true;
}

export function contractOnlySeam(toolId, params, decisionContext) {
  return makeEngineNotImplementedResult(
    params.call_id,
    toolId,
    decisionContext.scope.common.agentId,
  );
}

// C06: Re-export canonical validator from schema.mjs (100% dialect equivalence)
export {
  validateContractSchema,
  loadContractSchema,
  checkSchema,
  stableJson,
  typeMatches,
};

export function resolveAuthenticatedApproval(paths, approvalId) {
  if (typeof approvalId !== "string" || !isUuidV4(approvalId)) {
    throw new Error("AUTH_APPROVAL_INVALID");
  }
  const memKey = Symbol.for("zink.governance.approvals");
  if (globalThis[memKey] && globalThis[memKey].has(approvalId)) {
    const rec = globalThis[memKey].get(approvalId);
    validateApprovalRecord8Fields(rec);
    return rec;
  }
  // (A record that exists but fails the contract is a hard denial above, not a
  // fall-through to a later source.)
  if (paths && paths.root) {
    const fromFiles = readApprovalRecordFromFiles(paths, approvalId);
    if (fromFiles) return fromFiles;
    let snapshot;
    try {
      snapshot = readSnapshot(paths);
    } catch {
      snapshot = undefined;
    }
    for (const task of Object.values(snapshot?.tasks || {})) {
      if (task.approvals && task.approvals[approvalId]) {
        validateApprovalRecord8Fields(task.approvals[approvalId]);
        return task.approvals[approvalId];
      }
    }
  }
  return null;
}

/**
 * Read one approval from the two file-based stores under the ledger's
 * `writer.lock`.
 *
 * M11/T3 B5: `consumeApprovalAtomically` consumes under that same lock, so an
 * unlocked read here could observe `approvals.json` mid-write and then consume
 * a record whose durable form the consumer never saw. Contention is a DENIAL
 * (`null`), never an error: this is a read, and a new host-visible failure code
 * on the approval path would be a larger change than the defect.
 *
 * A record that exists but violates the contract still throws
 * `AUTH_APPROVAL_INVALID` — `withFileLockSync` propagates the callback's own
 * errors and translates only acquisition failures.
 *
 * Deliberately NOT inside this lock: the ledger-sourced read in the caller.
 * `readSnapshot` takes `writer.lock` itself and this primitive is single-attempt
 * and non-reentrant, so wrapping it would turn every ledger-sourced approval into
 * a contention denial.
 */
function readApprovalRecordFromFiles(paths, approvalId) {
  const lock = lockDirFor(paths.root, "writer.lock");
  let found;
  try {
    withFileLockSync(lock, () => {
      const approvalsFile = path.join(paths.root, "approvals.json");
      if (existsSync(approvalsFile)) {
        let data;
        try {
          data = JSON.parse(readFileSync(approvalsFile, "utf8"));
        } catch {
          data = undefined;
        }
        if (data && data[approvalId]) {
          // An approval record that EXISTS but does not satisfy the canonical
          // contract is an explicit invalid-approval denial, not an absent one:
          // silently degrading it to "not found" hides a tampered record behind a
          // generic refusal.
          validateApprovalRecord8Fields(data[approvalId]);
          found = data[approvalId];
          return;
        }
      }
      const individualApprovalFile = path.join(
        paths.root,
        "approvals",
        `${approvalId}.json`,
      );
      if (existsSync(individualApprovalFile)) {
        // M11/T3 B5: the sibling store above already fails closed on an
        // unparseable record. Parser text is not a governed denial — and on
        // Node 20+ a `SyntaxError` message quotes the offending input, so
        // leaving it raw could echo persisted content to the caller.
        let record;
        try {
          record = JSON.parse(readFileSync(individualApprovalFile, "utf8"));
        } catch {
          return;
        }
        validateApprovalRecord8Fields(record);
        found = record;
      }
    });
  } catch (err) {
    if (err?.code === "FILE_LOCK_BUSY") return null;
    throw err;
  }
  return found ?? null;
}

function validateApprovalRecord8Fields(record) {
  const REQUIRED = [
    "owner_principal_ref",
    "task_id",
    "brief_revision",
    "tool_id",
    "operation",
    "exact_target",
    "approval_scope_digest",
    "expires_at",
  ];
  for (const field of REQUIRED) {
    if (!record || record[field] === undefined || record[field] === null) {
      throw new Error("AUTH_APPROVAL_INVALID");
    }
  }
  // The presence check above is a shape assertion; the canonical contract is
  // the authority on the record's actual shape and value formats. Validating
  // here means the guard's approval path can never accept a record the
  // published contract would refuse.
  try {
    validateContract("approval-request", record);
  } catch {
    throw new Error("AUTH_APPROVAL_INVALID");
  }
}

export function consumeApprovalAtomically(paths, approvalId, claimScope) {
  if (typeof approvalId !== "string" || !isUuidV4(approvalId)) {
    throw new Error("AUTH_APPROVAL_INVALID");
  }
  const consumedKey = Symbol.for("zink.governance.consumed_approvals");
  if (!globalThis[consumedKey]) {
    Object.defineProperty(globalThis, consumedKey, { value: new Map() });
  }
  const memConsumed = globalThis[consumedKey];

  // M11/T3 B5 — documented limitation, kept intentionally: with no ledger root
  // there is no durable store to record consumption against, so replay
  // protection here is in-memory and single-process only. A second process, a
  // restart, or the gateway's worker pool can each re-consume the same approval.
  // Fixing it requires a durable consumption store, which is out of this task's
  // scope; the behavior is recorded here rather than left to be rediscovered.
  if (!paths || !paths.root) {
    if (memConsumed.has(approvalId)) {
      return false;
    }
    memConsumed.set(approvalId, {
      consumed_at: new Date().toISOString(),
      claimScope,
    });
    return true;
  }

  const lock = lockDirFor(paths.root, "writer.lock");
  try {
    return withFileLockSync(lock, () => {
      const consumedFile = path.join(paths.root, "consumed-approvals.json");
      let consumed = {};
      if (existsSync(consumedFile)) {
        // M7-024: corrupt one-time-approval storage fails closed. A corrupt
        // replay-protection store is never reinterpreted as empty history.
        try {
          consumed = JSON.parse(readFileSync(consumedFile, "utf8"));
        } catch (err) {
          throw new Error("EXECUTION_STATE_UNKNOWN", { cause: err });
        }
        if (
          !consumed ||
          typeof consumed !== "object" ||
          Array.isArray(consumed)
        ) {
          throw new Error("EXECUTION_STATE_UNKNOWN");
        }
      }
      if (consumed[approvalId] || memConsumed.has(approvalId)) {
        return false;
      }
      consumed[approvalId] = {
        consumed_at: new Date().toISOString(),
        claimScope,
      };
      memConsumed.set(approvalId, consumed[approvalId]);
      writeFileSync(consumedFile, JSON.stringify(consumed, null, 2), "utf8");
      return true;
    });
  } catch (err) {
    if (err?.code === "FILE_LOCK_BUSY") {
      throw new Error("EXECUTION_STATE_UNKNOWN", { cause: err });
    }
    throw err;
  }
}

export function createGovernanceGuard({
  paths,
  manifestFor,
  _snapshotOverride,
  quotaStore = null,
  // M10/T2-R2: the queue is the lease authority, so current execution authority
  // is established through the queue's own critical section rather than through
  // the ledger. Production binds `(fence, operation) => queueManager
  // .withExecutionFence(fence, operation)`. It is REQUIRED for coordinator
  // mutation and deliberately absent for every other caller: a bound
  // coordinator can mutate nothing without it, and delegation/root parents are
  // unaffected. It is injected rather than imported so this module keeps no
  // dependency edge to the queue projection.
  queueExecutionFence = null,
}) {
  const getSnapshot = () => _snapshotOverride || readSnapshot(paths);
  // T2/T3: process-local, agent-scoped. Never persisted; the host runtime owns
  // the canonical provider-usage source and publishes snapshots into it.
  // The store is created inline rather than via the telemetry module's factory
  // because the guard is constructible BEFORE the async dependency load
  // completes, and the store must exist unconditionally from construction.
  const quota = quotaStore ?? {
    snapshots: new Map(),
    latches: new Map(),
  };

  /**
   * M10/T2-R2: commit one coordinator-originated governed mutation under CURRENT
   * execution authority.
   *
   * A ledger binding is HISTORICAL IDENTITY: it survives stale recovery so the
   * run can still be attributed. It is not execution authority. The queue lease
   * is execution authority, and the queue is the only store that can revoke it,
   * so the commit is executed inside the queue critical section itself. A lease
   * revoked between identity resolution and this commit therefore cannot land:
   * recovery takes the same lock and either precedes the whole fenced commit or
   * follows it.
   *
   * Without an available authority seam the answer is a denial, never a
   * fallback: an unestablished fence is EXECUTION_STATE_UNKNOWN, exactly like
   * every other unresolvable governed state in this module.
   */
  function commitCoordinatorMutation(owner, commit) {
    if (typeof queueExecutionFence !== "function") {
      fail("EXECUTION_STATE_UNKNOWN");
    }
    const binding = owner.coordinatorRun;
    return queueExecutionFence(
      {
        taskId: owner.task_id,
        claimedBy: binding.coordinator,
        // The lease and the attempt come from the BINDING, not from the caller:
        // a caller can therefore only present the authority its own binding
        // recorded, and the queue decides whether that authority is still live.
        leaseId: binding.lease_id,
        attempt: binding.attempt,
      },
      commit,
    );
  }

  /**
   * T2: record one provider-usage snapshot for the agent that owns it.
   * Rejects cross-agent, malformed and non-canonical payloads. No I/O.
   */
  async function recordQuota(snapshot) {
    await ensureDependencies();
    requireQuotaDep();
    return quotaTelemetry.recordQuotaSnapshot(quota, snapshot);
  }

  /**
   * T2: self-scoped read-only receipt. No parameter can widen the result to
   * another agent.
   */
  async function selfQuotaReceipt(agentId, now = Date.now()) {
    await ensureDependencies();
    requireQuotaDep();
    return quotaTelemetry.buildSelfQuotaReceipt(quota, agentId, now);
  }

  /**
   * T3: run-scoped model resolution. Performs no persisted write; the returned
   * model applies to the current run only and is never pinned to the session.
   */
  async function resolveRunModel({
    agentId,
    sessionKey,
    runId,
    now = Date.now(),
  }) {
    await ensureDependencies();
    requireQuotaDep();
    const owner = findSession(getSnapshot(), sessionKey, runId);
    assert(
      (owner.delegation?.agent_id ??
        owner.coordinatorRun?.coordinator ??
        owner.task.root_agent_id) === agentId,
      "LINEAGE_MISMATCH",
    );
    return quotaTelemetry.resolveRuntimeModel({ store: quota, agentId, now });
  }

  function admitInitialBrief(owner, context, text) {
    assert(
      !owner.delegation && context.agentId === owner.task.root_agent_id,
      "UNAUTHORIZED_TARGET",
    );
    assert(
      typeof text === "string" && Buffer.byteLength(text, "utf8") <= 32768,
      "SCHEMA_INVALID",
    );
    let brief;
    try {
      brief = JSON.parse(text);
    } catch {
      fail("MISSING_PREREQUISITE");
    }
    validateContract("execution-brief", brief, 32768);
    if (brief.semantic_contract_status === "VALID")
      assert(
        owner.task.semantic_contract_status === "VALID",
        "MISSING_PREREQUISITE",
      );
    if (brief.dataset_validation_status === "VALID")
      assert(
        owner.task.dataset_validation_status === "VALID",
        "MISSING_PREREQUISITE",
      );
    assert(
      brief.task_id === owner.task_id &&
        brief.brief_revision === 1 &&
        brief.brief_state === "ACTIVE" &&
        brief.workflow_status === "ACTIVE",
      "LINEAGE_MISMATCH",
    );
    for (const key of ["origin", "origin_principal_ref", "origin_message_id"])
      assert(brief[key] === owner.task[key], "LINEAGE_MISMATCH");
    assert(
      brief.input_refs.length === 0 &&
        brief.mandatory_decision_evidence.length === 0,
      "REFERENCE_INVALID",
    );
    assert(
      sanitizeDelegationText(brief.inputs) === brief.inputs,
      "POLICY_DENIED",
    );
    // A non-main author's permitted stacks used to be copied here by hand, with a
    // one-stack-per-brief test; the copy had drifted to the inverse of
    // AGENT_STACK_POLICY for o1/o2, refusing nodes the reducer had just admitted.
    assert(
      brief.nodes.every((node) =>
        (AGENT_STACK_POLICY[node.agent_id] ?? []).includes(node.stack_id),
      ),
      "UNAUTHORIZED_TARGET",
    );
    // M10/T2-R14: the spawn-target authorization is asserted HERE, before the
    // irreversible ledger write below, not only ~120 lines later at the
    // `AGENT_SPAWN_POLICY` check. The later check is real but too late:
    // `WORKFLOW_BRIEF_ACTIVATED` had already committed the nodes, and the
    // reducer pins `brief_revision` to 1 whenever `task.nodes` is empty, so a
    // brief naming an agent the caller may not spawn (e.g. Main naming
    // `excel`, while `AGENT_SPAWN_POLICY.main` is `["o1","o2"]`) produced a
    // task that could never be dispatched and had no revision path out — every
    // retry re-matched the same node at `node.agent_id === params.agentId` and
    // was denied `UNAUTHORIZED_TARGET` again. Failing BEFORE the commit turns
    // an unrecoverable wedge into a plain refusal the caller can correct.
    //
    // This is the SAME canonical table the later check uses, so it grants
    // nothing new; it only moves the verdict ahead of the durable effect.
    assert(
      brief.nodes.every((node) =>
        (AGENT_SPAWN_POLICY[context.agentId] ?? []).includes(node.agent_id),
      ),
      "UNAUTHORIZED_TARGET",
    );
    const nodes = brief.nodes.map((node) => {
      for (const field of ["inputs", "constraints", "validation_criteria"])
        assert(
          sanitizeDelegationText(node[field]) === node[field],
          "POLICY_DENIED",
        );
      if (node.stack_id === "decision")
        assert(node.agent_id === "main", "UNAUTHORIZED_TARGET");
      const dependencies = node.dependencies.map((id) =>
        brief.nodes.find((item) => item.node_id === id),
      );
      assert(dependencies.every(Boolean), "MISSING_PREREQUISITE");
      if (
        node.stack_id === "data_plant" &&
        brief.semantic_contract_status !== "VALID"
      )
        assert(
          dependencies.some((item) => item.stack_id === "semantic"),
          "MISSING_PREREQUISITE",
        );
      if (
        node.stack_id === "intelligence" &&
        brief.dataset_validation_status !== "VALID"
      )
        assert(
          dependencies.some((item) => item.stack_id === "data_plant"),
          "MISSING_PREREQUISITE",
        );
      return {
        node_id: node.node_id,
        agent_id: node.agent_id,
        stack_id: node.stack_id,
        dependencies: node.dependencies,
        required: node.required,
        input_digest: canonicalHash("zink-input-v1", node.inputs),
        constraints_digest: canonicalHash(
          "zink-constraints-v1",
          node.constraints,
        ),
        validation_digest: canonicalHash(
          "zink-validation-v1",
          node.validation_criteria,
        ),
      };
    });
    recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
      task_id: owner.task_id,
      brief_revision: 1,
      nodes,
    });
  }

  function manifest(agentId) {
    const value = manifestFor(agentId);
    assert(
      value &&
        /^[a-f0-9]{64}$/u.test(value.expected_governance_hash) &&
        value.expected_governance_hash === value.observed_governance_hash,
      "GOVERNANCE_HASH_MISMATCH",
    );
    return value;
  }

  return {
    // T2: agent-scoped read-only quota receipt. No model-callable tool, no
    // credential material, no other agent's data.
    selfQuotaReceipt(agentId, now) {
      return selfQuotaReceipt(agentId, now);
    },
    // T2: host-owned provider-usage publication seam.
    recordQuota(snapshot) {
      return recordQuota(snapshot);
    },
    // T3: run-scoped model resolution. Never writes session state.
    resolveRunModel(args) {
      return resolveRunModel(args);
    },
    beforeRunEnd(event, context) {
      const owner = findSession(
        getSnapshot(),
        context.sessionKey,
        context.runId,
      );
      // M10/T2: a bound coordinator end that reaches the guard directly (past
      // the plugin's recognition path) is denied explicitly. Coordinator ends
      // are never task-completion claims here — completion ingestion is a
      // separate future task — so there is no valid branch for them in this
      // function, only a clear denial instead of a misleading comparison
      // against Main/root.
      if (owner.coordinatorRun) fail("LINEAGE_MISMATCH");
      assert(
        (owner.delegation?.agent_id ?? owner.task.root_agent_id) ===
          context.agentId,
        "LINEAGE_MISMATCH",
      );
      if (owner.delegation) return { allow: true };
      // F-088: a yield is not a success, but a run that yielded has made NO
      // completion claim at all: `success` is absent, which is the documented
      // path for a run that asked something and is waiting for the owner. That
      // path is admitted, and the task stays open.
      //
      // What must never pass is an EXPLICIT failure carried on the yield flag.
      // The flag used to short-circuit the success assertion below, so a
      // FAILED run passed the run-end gate and recorded no terminal event at
      // all: the ledger then showed an open task the owner had been told had
      // finished.
      if (event.yielded === true) {
        if (event.success === false) fail("EXECUTION_STATE_UNKNOWN");
        return { allow: true };
      }
      assert(event.success === true, "EXECUTION_STATE_UNKNOWN");
      // M7-020: the root result closes governed work, so it requires an active
      // brief. The approval requirement belongs on the spawn RESERVATION, which
      // is the authority; a task that never activated a brief keeps the
      // pre-approval ACTIVE requirement.
      if (owner.task.nodes.length > 0) {
        assert(
          ["ACTIVE", "QUEUED", "EXECUTING"].includes(
            owner.task.workflow_status,
          ) && owner.task.brief_state === "ACTIVE",
          "INVALID_STATE_TRANSITION",
        );
      } else {
        assert(
          owner.task.workflow_status === "ACTIVE" &&
            owner.task.brief_state === "ACTIVE",
          "INVALID_STATE_TRANSITION",
        );
      }
      const message = event.lastAssistant;
      assert(
        message?.role === "assistant" && Array.isArray(message.content),
        "SCHEMA_INVALID",
      );
      assert(message.stopReason === "stop", "VALIDATION_FAILED");
      assert(
        message.content.every((part) =>
          ["text", "thinking"].includes(part?.type),
        ),
        "SCHEMA_INVALID",
      );
      let text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      assert(Buffer.byteLength(text, "utf8") <= 65536, "SCHEMA_INVALID");

      let trimmed = text;
      if (trimmed.startsWith("```json")) {
        trimmed = trimmed.slice(7);
        if (trimmed.endsWith("```")) trimmed = trimmed.slice(0, -3);
        trimmed = trimmed.trim();
      } else if (trimmed.startsWith("```")) {
        trimmed = trimmed.slice(3);
        if (trimmed.endsWith("```")) trimmed = trimmed.slice(0, -3);
        trimmed = trimmed.trim();
      }

      let payload;
      try {
        payload = JSON.parse(trimmed);
      } catch {
        payload = null;
      }

      assert(
        payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          typeof payload.outcome_claim === "string",
        "SCHEMA_INVALID",
      );

      if (!payload.schema_version) payload.schema_version = SCHEMA_VERSION;
      if (!payload.governance_version)
        payload.governance_version = GOVERNANCE_VERSION;
      if (!payload.assumptions) payload.assumptions = [];
      if (!payload.limitations) payload.limitations = [];
      if (!payload.requested_prerequisites)
        payload.requested_prerequisites = [];
      if (!payload.agent_self_validation) {
        payload.agent_self_validation =
          "[UNVERIFIED_SELF_ASSERTION] Model self-claim: unverified";
      } else if (
        payload.governance_version !== "m7-t2-r12" &&
        typeof payload.agent_self_validation === "string" &&
        !payload.agent_self_validation.startsWith("[UNVERIFIED_SELF_ASSERTION]")
      ) {
        payload.agent_self_validation = `[UNVERIFIED_SELF_ASSERTION] ${payload.agent_self_validation}`;
      }
      if (typeof payload.output !== "string") {
        payload.output = String(payload.output ?? "");
      }
      // M10/T2-R15: byte-budgeted, because `agent-result-payload.schema.json` bounds
      // `output` with `maxLength: 16384` and `schema.mjs` measures it with
      // `Buffer.byteLength`. This slice counted CHARACTERS, so its own output
      // failed the validator that runs two lines later — measured: 16384
      // Vietnamese characters became 32768 bytes and were rejected as
      // SCHEMA_VALIDATION_FAILED, with no recovery since the same slice repeats
      // on every retry.
      payload.output = truncateUtf8(payload.output, 16384);
      payload.output = sanitizeDelegationText(payload.output);
      payload.agent_self_validation = sanitizeDelegationText(
        payload.agent_self_validation,
      );
      // M10/T2-R15: byte-budgeted for the same reason as `output` above — the contract
      // bounds this field at `maxLength: 4096` BYTES. Measured: 4096 Vietnamese
      // characters became 8192 bytes and were rejected.
      payload.agent_self_validation = truncateUtf8(
        payload.agent_self_validation,
        4096,
      );
      // M10/T2-R15: these two were only sanitized and never bounded, while the
      // contract limits every item to `maxLength: 4096` BYTES and the array to
      // `maxItems: 16`. An over-long assumption therefore failed the whole
      // result with no truncation and no recovery. Byte-budgeted here for the
      // same reason as `output`.
      payload.assumptions = payload.assumptions.map((a) =>
        truncateUtf8(sanitizeDelegationText(String(a)), 4096),
      );
      payload.limitations = payload.limitations.map((l) =>
        truncateUtf8(sanitizeDelegationText(String(l)), 4096),
      );

      validateAgentClaim(payload);
      for (const field of [
        payload.output,
        payload.agent_self_validation,
        ...payload.assumptions,
        ...payload.limitations,
        ...payload.requested_prerequisites.map((item) => item.requirement),
      ])
        assert(sanitizeDelegationText(field) === field, "POLICY_DENIED");
      assert(
        (payload.claimed_artifact_refs ?? []).length === 0,
        "REFERENCE_INVALID",
      );
      const accepted = normalizeAgentOutcome(payload);
      recordWorkflowEvent(paths, "WORKFLOW_ROOT_RESULT_RECORDED", {
        task_id: owner.task_id,
        brief_revision: owner.task.brief_revision,
        native_run_id: context.runId,
        agent_id: context.agentId,
        payload_digest: payloadDigest(payload),
        outcome_status: accepted.outcome,
        reason_code: accepted.reason,
        governance_hash: manifest(context.agentId).expected_governance_hash,
      });
      return { allow: true };
    },

    beforeRun(_event, context) {
      const snapshot = getSnapshot();
      let owner;
      try {
        owner = findSession(snapshot, context.sessionKey, context.runId);
      } catch (findErr) {
        // M10/T2: a gateway-started coordinator run owns no root or delegation
        // session, so findSession cannot resolve it. The ledger binding recorded
        // at pickup time is the only legitimate alternative identity: it must
        // match session, run AND agent exactly, otherwise the original failure
        // stands and admission stays refused.
        const bound = findBoundCoordinatorRun(
          snapshot,
          context.sessionKey,
          context.runId,
          context.agentId,
        );
        if (bound) {
          owner = bound;
        } else {
          const candidates = Object.entries(snapshot.tasks).filter(
            ([, task]) => {
              const entry = task.continuations?.[context.runId];
              return (
                entry &&
                !entry.started &&
                entry.session_key === context.sessionKey
              );
            },
          );
          // F-059: the original findSession failure is the CAUSE of this
          // refusal, and it used to be discarded (`void findErr`), so the
          // operator saw a bare code with no reason attached. The refusal code
          // names the symptom; the cause names the reason.
          try {
            assert(candidates.length === 1, "EXECUTION_STATE_UNKNOWN");
            const [task_id, task] = candidates[0];
            const entry = task.continuations?.[context.runId];
            assert(
              entry &&
                context.inputProvenance?.kind === "inter_session" &&
                context.inputProvenance.sourceTool === "subagent_announce" &&
                context.inputProvenance.sourceSessionKey ===
                  entry.source_session_key,
              "LINEAGE_MISMATCH",
            );
            // E13: Cryptographically bind inter-session trust to the trigger sender event & accepted payload digest
            const trigger = Object.values(task.delegations || {}).find(
              (run) => run.native_run_id === entry.trigger_run_id,
            );
            if (entry.trigger_run_id !== entry.previous_run_id) {
              assert(
                trigger && trigger.accepted_payload_digest,
                "LINEAGE_MISMATCH",
              );
              if (context.inputProvenance.senderDigest) {
                assert(
                  context.inputProvenance.senderDigest ===
                    trigger.accepted_payload_digest,
                  "LINEAGE_MISMATCH",
                );
              }
            }
            const next = recordWorkflowEvent(
              paths,
              "WORKFLOW_CONTINUATION_STARTED",
              {
                task_id,
                next_run_id: context.runId,
                session_key: context.sessionKey,
                source_session_key: context.inputProvenance.sourceSessionKey,
                agent_id: context.agentId,
              },
            );
            owner = findSession(next, context.sessionKey, context.runId);
          } catch (cause) {
            // F-059: the original findSession failure is the CAUSE of this
            // refusal. The refusal code still names the symptom; the cause
            // names the reason. The refusal itself is re-thrown unchanged -
            // only the discarded reason is attached underneath it.
            if (cause instanceof Error && cause.cause === undefined)
              cause.cause = findErr;
            throw cause;
          }
        }
      }
      // M7-020: this is RUN ADMISSION, not work authorization. A native run may
      // enter a task whether or not the work has been approved; the approval
      // requirement lives on the spawn RESERVATION, which is where the bypass
      // seam was. Admission is refused only for a terminal or unbriefed task.
      assert(
        ["ACTIVE", "QUEUED", "EXECUTING"].includes(
          owner.task.workflow_status,
        ) && owner.task.brief_state === "ACTIVE",
        "INVALID_STATE_TRANSITION",
      );
      // M10/T2: a bound coordinator resolves to its bound coordinator identity,
      // never to Main/root. The fallback order is load-bearing: delegation first,
      // then binding, then root.
      assert(
        (owner.delegation?.agent_id ??
          owner.coordinatorRun?.coordinator ??
          owner.task.root_agent_id) === context.agentId,
        "INVALID_STATE_TRANSITION",
      );
      assert(
        !owner.delegation || owner.delegation.run_state === "RUNNING",
        "INVALID_STATE_TRANSITION",
      );
      manifest(context.agentId);
      return { allow: true };
    },

    async beforeToolCall(event, context, signalOrOptions) {
      await ensureDependencies();
      let signal = null;
      let nowFn = Date.now;
      if (signalOrOptions) {
        if (typeof signalOrOptions.now === "function") {
          nowFn = signalOrOptions.now;
        }
        if (signalOrOptions.aborted !== undefined) {
          signal = signalOrOptions;
        }
      }
      assert(!signal?.aborted, "EXECUTION_STATE_UNKNOWN");

      // 0. Capture Single Timestamp
      const currentTime = nowFn();

      // 1. Trusted Context Identity Verification (Pre-Lookup)
      if (
        typeof context?.agentId !== "string" ||
        context.agentId.length === 0
      ) {
        fail("AUTH_POLICY_DENIED");
      }
      if (!AGENT_IDS.includes(context.agentId)) {
        fail("AUTH_POLICY_DENIED");
      }
      if (
        typeof context?.sessionKey !== "string" ||
        context.sessionKey.length === 0
      ) {
        fail("AUTH_POLICY_DENIED");
      }
      if (typeof context?.runId !== "string" || context.runId.length === 0) {
        fail("LINEAGE_MISMATCH");
      }
      const agentId = context.agentId;
      const sessionKey = context.sessionKey;
      const runId = context.runId;

      // 2. Resolve Candidate Tool Discriminator
      const candidateToolId = event?.toolName;
      if (typeof candidateToolId !== "string" || candidateToolId.length === 0) {
        fail("RUNTIME_CAPABILITY_MISMATCH");
      }

      // 3. Tool Classification & Built-in Pass-Through
      if (OPENCLAW_BUILT_IN_TOOL_IDS.includes(candidateToolId)) {
        // T1: one canonical tool authority. Every built-in tool, including
        // session_status, is checked against the same BUILT_IN_TOOL_POLICY
        // projection from policy.mjs. There is no exempt tool. A missing
        // policy module fails closed rather than defaulting to a local copy.
        requireDep(depsPolicyLoaded);
        if (
          !policy?.BUILT_IN_TOOL_POLICY?.[agentId]?.includes(candidateToolId)
        ) {
          fail("AUTH_POLICY_DENIED");
        }

        let snapshot = readSnapshot(paths);
        let owner = findSession(snapshot, context.sessionKey, context.runId);
        if (
          event.toolName === "sessions_spawn" &&
          owner.task.nodes.length === 0
        ) {
          admitInitialBrief(owner, context, event.assistantText);
          snapshot = readSnapshot(paths);
          owner = findSession(snapshot, context.sessionKey, context.runId);
        }
        const task = owner.task;
        // M10/T2: same load-bearing fallback order as admission: a bound
        // coordinator resolves to its bound coordinator identity, never to
        // Main/root.
        assert(
          (owner.delegation?.agent_id ??
            owner.coordinatorRun?.coordinator ??
            task.root_agent_id) === context.agentId,
          "LINEAGE_MISMATCH",
        );
        // M7-020: a spawn reservation is a POST-approval event, matching the
        // reducer. Read-only session inspection is not governed work and is
        // unaffected.
        if (owner.delegation)
          assert(
            owner.delegation.run_state === "RUNNING" &&
              owner.delegation.brief_revision === task.brief_revision,
            "SUPERSEDED_REVISION",
          );
        const governance = manifest(context.agentId);
        assert(
          governance.allowed_tools?.includes(event.toolName),
          "RUNTIME_CAPABILITY_MISMATCH",
        );
        if (event.toolName === "sessions_yield") {
          assert(
            event.batchToolNames?.length === 1 &&
              ["main", "o1", "o2"].includes(context.agentId),
            "POLICY_DENIED",
          );
          const children = Object.values(task.delegations).filter(
            (run) =>
              ownerRunIds(owner).includes(run.parent_run_id) &&
              run.parent_session_key === context.sessionKey &&
              run.brief_revision === task.brief_revision &&
              activeRun.has(run.run_state),
          );
          assert(
            children.length > 0 &&
              children.every(
                (run) =>
                  run.run_state === "RUNNING" &&
                  run.native_run_id &&
                  (run.parent_run_id !== context.runId ||
                    run.turn < event.turn),
              ),
            "SPAWN_UNKNOWN",
          );
          return { allow: true };
        }
        if (event.toolName !== "sessions_spawn") {
          assert(
            ["session_status", "agents_list"].includes(event.toolName),
            "POLICY_DENIED",
          );
          if (event.toolName === "session_status") {
            // T1: session_status is read-only status inspection. Any argument
            // that could mutate session state — `model` being the session
            // override vector — is denied for EVERY agent, Main included.
            assert(
              policy?.isSessionStatusReadOnlyArgs(event.params),
              "POLICY_DENIED",
            );
            assert(
              !event.params ||
                event.params.sessionKey === undefined ||
                event.params.sessionKey === "current" ||
                event.params.sessionKey === context.sessionKey,
              "POLICY_DENIED",
            );
          } else {
            assert(
              !event.params || Object.keys(event.params).length === 0,
              "POLICY_DENIED",
            );
          }
          return { allow: true };
        }
        const params = event.params;
        assert(
          params &&
            Object.keys(params).every((key) => nativeSpawnKeys.has(key)) &&
            (params.runtime === "subagent" || params.runtime === undefined) &&
            (params.mode === "run" || params.mode === undefined) &&
            (params.thread === false || params.thread === undefined) &&
            params.context === "isolated" &&
            params.sandbox === "require" &&
            (params.cleanup === "keep" || params.cleanup === undefined) &&
            (params.taskName === undefined ||
              typeof params.taskName === "string") &&
            typeof params.agentId === "string" &&
            typeof params.task === "string",
          "UNAUTHORIZED_TARGET",
        );
        assert(
          Buffer.byteLength(params.task, "utf8") <= 32768,
          "SCHEMA_INVALID",
        );
        let proposal;
        try {
          proposal = JSON.parse(params.task);
        } catch {
          fail("SCHEMA_INVALID");
        }
        validateContract("delegation-proposal", proposal, 32768);
        const node = task.nodes.find(
          (item) => item.node_id === proposal.node_id,
        );
        assert(node && node.agent_id === params.agentId, "UNAUTHORIZED_TARGET");
        // Spawn topology comes from the canonical AGENT_SPAWN_POLICY, not a
        // local copy. The previous inline map was a hand-maintained duplicate:
        // changing the policy would have changed the OpenClaw config and the
        // governance manifest while leaving enforcement unchanged.
        const allowedSpawnTargets = AGENT_SPAWN_POLICY[context.agentId] ?? [];
        assert(
          allowedSpawnTargets.includes(params.agentId),
          "UNAUTHORIZED_TARGET",
        );
        if (owner.delegation)
          assert(
            node.stack_id === owner.delegation.stack_id,
            "UNAUTHORIZED_TARGET",
          );
        // M10/T2: a bound coordinator is root-like (top of its subtree, no
        // parent delegation), so like a root spawn it carries no parent-stack
        // constraint. Target containment stays enforced by the canonical
        // AGENT_SPAWN_POLICY allowlist above, which is the same table the
        // dispatch derivation already enforced before the claim.
        const handoff = {
          ...proposal,
          task_id: owner.task_id,
          brief_revision: task.brief_revision,
          parent_agent_id: context.agentId,
          target_agent_id: params.agentId,
          target_stack: node.stack_id,
          expected_governance_hash: manifest(params.agentId)
            .expected_governance_hash,
          attempt:
            Object.values(task.delegations).filter(
              (item) =>
                item.brief_revision === task.brief_revision &&
                item.node_id === node.node_id,
            ).length + 1,
          remaining_task_budget: {
            // The resource ceilings come from the canonical BUDGETS table, not
            // from literals restated here. The m7-t2-r12 legacy carve-out is
            // expressed as a named delta so the ceiling itself stays in one
            // place: a change to BUDGETS must change what is reported.
            revisions: BUDGETS.maxBriefRevisionsPerTask - task.revisions_used,
            transitions:
              BUDGETS.maxStackTransitionsPerTask -
              task.transitions_used -
              (context.agentId === "main" &&
              task.current_stack &&
              task.current_stack !== node.stack_id
                ? 1
                : 0),
            delegated_runs:
              BUDGETS.maxTotalDelegatedRunsPerTask -
              // M10/T2-R12: versions without a legacy carve-out entry get zero,
              // not NaN. Without `?? 0` any proposal whose governance_version
              // is not in the map poisons the whole budget to NaN and every
              // guard spawn dies here — previously masked because the approval
              // check fired first.
              (LEGACY_DELEGATED_RUN_CARVE_OUT[
                proposal.governance_version ?? ""
              ] ?? 0) -
              task.delegated_runs_used,
          },
          requested_output_schema: "agent-result-payload.schema.json",
        };
        // M8-055: the handoff id and the reservation id come from the same
        // canonical builder over the same identity tuple.
        handoff.delegation_id = buildSpawnProposal({
          task_id: owner.task_id,
          brief_revision: task.brief_revision,
          node_id: node.node_id,
          agent_id: params.agentId,
          parent_agent_id: context.agentId,
          parent_session_key: context.sessionKey,
          parent_run_id: context.runId,
          tool_call_id: event.toolCallId,
          turn: event.turn,
          attempt: handoff.attempt,
          expected_governance_hash: handoff.expected_governance_hash,
        }).delegation_id;
        assert(
          Object.values(handoff.remaining_task_budget).every(
            (value) => value >= 0,
          ),
          "WORKFLOW_BUDGET_EXHAUSTED",
        );
        validateContract("delegation-envelope", handoff, 32768);
        for (const field of ["inputs", "constraints", "validation_criteria"])
          assert(
            sanitizeDelegationText(handoff[field]) === handoff[field],
            "POLICY_DENIED",
          );
        assert(
          canonicalHash("zink-input-v1", handoff.inputs) ===
            node.input_digest &&
            canonicalHash("zink-constraints-v1", handoff.constraints) ===
              node.constraints_digest &&
            canonicalHash("zink-validation-v1", handoff.validation_criteria) ===
              node.validation_digest,
          "LINEAGE_MISMATCH",
        );
        for (const ref of handoff.input_refs)
          assert(
            // M12/T9 F-157: the ONE derivation of a reference id. The check
            // used to re-inline the reference hash under its own domain tag,
            // so the tag lived in two places and the two could disagree.
            task.accepted_reference_digests?.[ref.ref_id] ===
              deriveReferenceId(ref),
            "REFERENCE_INVALID",
          );
        // M8-055: this governed route and the live adapter route both build
        // the reservation through the same canonical builder, so the
        // delegation id and request digest cannot diverge between them.
        const spec = buildSpawnProposal({
          task_id: owner.task_id,
          brief_revision: task.brief_revision,
          node_id: node.node_id,
          agent_id: params.agentId,
          parent_agent_id: context.agentId,
          parent_session_key: context.sessionKey,
          parent_run_id: context.runId,
          tool_call_id: event.toolCallId,
          turn: event.turn,
          attempt: handoff.attempt,
          expected_governance_hash: handoff.expected_governance_hash,
        });
        assert(
          spec.delegation_id === handoff.delegation_id,
          "LINEAGE_MISMATCH",
        );
        // M10/T2-R2: the reservation is the authorization artifact, so this is
        // the authoritative mutation boundary. A coordinator parent commits it
        // under current execution authority; every other parent keeps the
        // existing unfenced path, whose pre-approval, topology, budget and
        // lineage rules are unchanged.
        //
        // M10/T2-R12: the approval precondition is evaluated HERE, after all
        // params/node/topology/budget/lineage validation, immediately before
        // the commit. It states the same condition the reducer enforces for
        // WORKFLOW_SPAWN_RESERVED, so the two cannot disagree — and a denial
        // with AUTH_APPROVAL_REQUIRED now structurally implies an otherwise
        // valid request. Previously this check fired before validation, which
        // let malformed requests report "needs approval" for work that could
        // never be approved. Same condition, later position; no valid request
        // changes verdict, and REQUESTED still never satisfies this gate.
        assert(
          typeof task.approved_at === "string" &&
            !Number.isNaN(Date.parse(task.approved_at)) &&
            ["QUEUED", "EXECUTING"].includes(task.workflow_status) &&
            task.brief_state === "ACTIVE",
          "AUTH_APPROVAL_REQUIRED",
        );
        const commitReservation = () =>
          recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spec);
        if (owner.coordinatorRun) {
          commitCoordinatorMutation(owner, commitReservation);
        } else {
          commitReservation();
        }
        return {
          allow: true,
          spawnLabel: spec.delegation_id,
          spawnTask: JSON.stringify(handoff),
        };
      } else if (candidateToolId in ZINK_CAPABILITY_REGISTRY) {
        if (
          ZINK_CAPABILITY_REGISTRY[candidateToolId].status === "schema_only"
        ) {
          fail("AUTH_POLICY_DENIED");
        }
      } else {
        fail("RUNTIME_CAPABILITY_MISMATCH");
      }

      // 4. Zink Request Envelope Size Preflight
      let serialized;
      try {
        serialized = JSON.stringify(event.params);
        if (
          typeof serialized !== "string" ||
          Buffer.byteLength(serialized, "utf8") > 262144
        ) {
          fail("SCHEMA_VALIDATION_FAILED");
        }
      } catch {
        fail("SCHEMA_VALIDATION_FAILED");
      }

      // 5. Zink Contract Schema Validation
      try {
        // M12/T9 F-272: the budget is the one the module publishes, not the
        // validator's old 64 KiB default.
        validateContractSchema(
          "tool-call",
          event.params,
          TOOL_CALL_ENVELOPE_MAX_BYTES,
        );
      } catch {
        fail("SCHEMA_VALIDATION_FAILED");
      }
      const validatedParams = event.params;
      if (validatedParams.tool_id !== candidateToolId) {
        fail("SCHEMA_VALIDATION_FAILED");
      }
      if (validatedParams.specialist !== agentId) {
        fail("AUTH_POLICY_DENIED");
      }
      if (validatedParams.provenance?.session_key !== sessionKey) {
        fail("AUTH_POLICY_DENIED");
      }

      // 6. Logical Artifact Path Validation
      if (
        candidateToolId === "zink_excel" &&
        validatedParams.input?.file_path
      ) {
        requireDep(depsPathSafetyLoaded);
        try {
          validateArtifactLogicalPath(validatedParams.input.file_path);
        } catch {
          fail("SCHEMA_VALIDATION_FAILED");
        }
      }
      if (
        candidateToolId === "zink_python" &&
        validatedParams.input?.entrypoint
      ) {
        requireDep(depsPathSafetyLoaded);
        try {
          validateArtifactLogicalPath(validatedParams.input.entrypoint);
        } catch {
          fail("SCHEMA_VALIDATION_FAILED");
        }
      }

      // 7. Monotonic Authorization Verification (M7-003/M7-004: the same
      // canonical resolver as every other tool-ingress path — matrix
      // levels enforced, delegation never executes directly).
      {
        requireDep(typeof policy?.evaluateCapabilityAccess === "function");
        const directAccess = policy.evaluateCapabilityAccess(
          agentId,
          candidateToolId,
          null,
          "execute",
        );
        if (!directAccess.allowed || directAccess.level === "delegate") {
          fail("AUTH_POLICY_DENIED");
        }
      }

      // 8. Effective Constraints Computation
      const callerTimeoutMs =
        (validatedParams.constraints?.timeout_seconds ?? 300) * 1000;
      let workflowLimitMs = Infinity;
      if (candidateToolId === "zink_n8n") {
        // M7-006: one canonical registry resolution for both paths.
        const invocation = resolveN8nInvocation({
          workflowId: validatedParams.input.workflow_id,
          agentId,
          toolId: candidateToolId,
        });
        workflowLimitMs = invocation.timeoutMs;
      }
      const effective_timeout_ms = Math.min(
        callerTimeoutMs,
        workflowLimitMs,
        T3_GLOBAL_TIMEOUT_CEILING_MS,
      );
      const effective_memory_mb = Math.min(
        validatedParams.constraints?.max_memory_mb ?? 1024,
        T3_GLOBAL_MEMORY_CEILING_MB,
      );

      // 9. Dual Authorization Paths
      const authorizationMode = AUTHORIZATION_MODE_BY_TOOL[candidateToolId];
      if (!AUTHORIZATION_MODES.includes(authorizationMode)) {
        fail("RUNTIME_CAPABILITY_MISMATCH");
      }

      let scope;
      let opPolicy;
      let approvalExpiryMs = null;

      if (authorizationMode === "read_only") {
        // Read-only path (zink_sql)
        requireDep(depsSqlLoaded);
        validateSqlQuery(
          validatedParams.input.query,
          validatedParams.input.parameters,
        );
        if (validatedParams.provenance?.delegation_id !== undefined) {
          fail("SCHEMA_VALIDATION_FAILED");
        }
        scope = {
          authorization_mode: "read_only",
          common: {
            agentId,
            toolId: candidateToolId,
            taskId: validatedParams.provenance.task_id,
            sessionKey,
            runId,
          },
          delegated: null,
        };
      } else {
        // Delegated path (zink_excel, zink_power_bi, zink_python, zink_n8n)
        let snapshot;
        try {
          snapshot = readSnapshot(paths);
        } catch {
          if (existsSync(paths.snapshot)) {
            snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
          } else {
            fail("AUTH_DELEGATION_NOT_FOUND");
          }
        }
        let ownerSession;
        try {
          ownerSession = findSession(snapshot, sessionKey, runId);
        } catch {
          fail("AUTH_DELEGATION_NOT_FOUND");
        }
        if (!ownerSession || !ownerSession.delegation) {
          fail("AUTH_DELEGATION_NOT_FOUND");
        }
        const del = ownerSession.delegation;
        const delId = del.delegation_id ?? del.id;
        assert(
          typeof delId === "string" && isUuidV4(delId),
          "AUTH_DELEGATION_NOT_FOUND",
        );
        assert(
          typeof del.agent_id === "string" && AGENT_IDS.includes(del.agent_id),
          "AUTH_DELEGATION_NOT_FOUND",
        );
        const delTaskId =
          del.task_id ?? ownerSession.task_id ?? ownerSession.task?.task_id;
        assert(
          typeof delTaskId === "string" && delTaskId.length > 0,
          "AUTH_DELEGATION_NOT_FOUND",
        );
        const delRunId = del.native_run_id ?? del.run_id;
        assert(
          typeof delRunId === "string" && delRunId.length > 0,
          "AUTH_DELEGATION_NOT_FOUND",
        );
        const delStackId =
          del.stack_id ??
          ownerSession.task?.nodes?.find((n) => n.agent_id === del.agent_id)
            ?.stack_id ??
          "data_plant";
        // A-2 / R1-A04-05: this assert answers "is this a stack the protocol
        // knows?", which is a scope question, not an existence question. The
        // delegations above it already established identity, so reporting a
        // stack-scope refusal as AUTH_DELEGATION_NOT_FOUND told the operator a
        // delegation could not be found when the guard had just read it. The
        // code is the one this guard already uses for a scope mismatch.
        assert(
          typeof delStackId === "string" && STACK_IDS.includes(delStackId),
          "AUTH_SCOPE_MISMATCH",
        );
        assert(
          Array.isArray(del.allowed_tools) &&
            new Set(del.allowed_tools).size === del.allowed_tools.length &&
            del.allowed_tools.every(
              (id) => typeof id === "string" && id in CALLABLE_TOOL_REGISTRY,
            ),
          "AUTH_DELEGATION_NOT_FOUND",
        );
        assert(
          [
            "PENDING",
            "RUNNING",
            "COMPLETE",
            "COMPLETED",
            "REVOKED",
            "FAILED",
          ].includes(del.run_state),
          "AUTH_DELEGATION_NOT_FOUND",
        );
        assert(
          (typeof del.brief_revision === "number" ||
            typeof del.brief_revision === "string") &&
            String(del.brief_revision).length > 0,
          "AUTH_DELEGATION_NOT_FOUND",
        );
        if (del.run_state === "REVOKED") fail("AUTH_DELEGATION_REVOKED");
        assert(del.run_state === "RUNNING", "AUTH_DELEGATION_INACTIVE");

        assert(ownerSession.task, "AUTH_SCOPE_MISMATCH");
        assert(
          (typeof ownerSession.task.brief_revision === "number" ||
            typeof ownerSession.task.brief_revision === "string") &&
            String(ownerSession.task.brief_revision).length > 0,
          "AUTH_SCOPE_MISMATCH",
        );
        assert(
          String(ownerSession.task.brief_revision) ===
            String(del.brief_revision),
          "REVISION_SUPERSEDED",
        );

        assert(agentId === del.agent_id, "AUTH_UNAUTHORIZED_TARGET");
        assert(
          validatedParams.provenance?.delegation_id === delId,
          "AUTH_SCOPE_MISMATCH",
        );
        assert(
          validatedParams.provenance?.task_id === delTaskId,
          "AUTH_SCOPE_MISMATCH",
        );
        assert(runId === delRunId, "LINEAGE_MISMATCH");
        assert(
          del.allowed_tools.includes(candidateToolId),
          "AUTH_POLICY_DENIED",
        );

        if (candidateToolId === "zink_python") {
          assert(
            validatedParams.input.stack === del.stack_id,
            "AUTH_POLICY_DENIED",
          );
        }
        if (candidateToolId === "zink_n8n") {
          // M7-006: the registry and agent allowlist are resolved by the one
          // canonical helper the live path also uses.
          resolveN8nInvocation({
            workflowId: validatedParams.input.workflow_id,
            agentId,
            toolId: candidateToolId,
          });
        }

        const operationName =
          candidateToolId === "zink_n8n"
            ? "trigger"
            : candidateToolId === "zink_python"
              ? "execute"
              : candidateToolId === "zink_sql"
                ? "query"
                : validatedParams.input.operation;

        const actualTarget =
          candidateToolId === "zink_n8n"
            ? validatedParams.input.workflow_id
            : candidateToolId === "zink_python"
              ? validatedParams.input.entrypoint
              : candidateToolId === "zink_sql"
                ? validatedParams.input.target_database
                : candidateToolId === "zink_excel"
                  ? validatedParams.input.file_path
                  : validatedParams.input.model;

        opPolicy = OPERATION_POLICY[candidateToolId]?.[operationName];
        if (!opPolicy) fail("RUNTIME_CAPABILITY_MISMATCH");

        if (opPolicy.requiresApproval === true) {
          // M7-006: the approval binding lives in one canonical helper, so the
          // live path cannot make approval optional.
          approvalExpiryMs = bindInvocationApproval({
            paths,
            approvalId: validatedParams.approval_id,
            taskId: delTaskId,
            briefRevision: ownerSession.task.brief_revision,
            originPrincipalRef:
              ownerSession.task.origin_principal_ref ??
              ownerSession.task.origin?.origin_principal_ref ??
              ownerSession.task.root_principal_ref,
            toolId: candidateToolId,
            operationName,
            actualTarget,
            input: validatedParams.input,
            runId,
            currentTime,
          });
        }

        scope = {
          authorization_mode: "delegated",
          common: {
            agentId,
            toolId: candidateToolId,
            taskId: delTaskId,
            sessionKey,
            runId,
          },
          delegated: {
            delegationId: del.id,
            brief_revision: ownerSession.task.brief_revision,
          },
        };
      }

      // 10. Issue Immutable AuthorizationDecisionContext
      const effective_expires_at_ms =
        opPolicy?.requiresApproval && typeof approvalExpiryMs === "number"
          ? Math.min(currentTime + effective_timeout_ms, approvalExpiryMs)
          : currentTime + effective_timeout_ms;

      const decisionContext = deepFreeze({
        authorization_id: randomUUID(),
        authorized_at: new Date(currentTime).toISOString(),
        expires_at: new Date(effective_expires_at_ms).toISOString(),
        scope,
        effective_constraints: {
          timeout_ms: effective_timeout_ms,
          max_memory_mb: effective_memory_mb,
        },
        correlation: {
          call_id: validatedParams.call_id,
        },
      });

      // 11. Dispatch & Guard Error Normalization Boundary
      const target = CALLABLE_DISPATCH_REGISTRY[candidateToolId];
      if (!DISPATCH_TARGETS.includes(target))
        fail("RUNTIME_CAPABILITY_MISMATCH");
      if (target === "adapter") requireDep(depsN8nLoaded);

      let rawResult;
      try {
        if (target === "adapter") {
          rawResult = await invokeN8n(decisionContext, validatedParams.input);
        } else if (target === "contract_seam") {
          rawResult = contractOnlySeam(
            candidateToolId,
            validatedParams,
            decisionContext,
          );
        } else {
          fail("RUNTIME_CAPABILITY_MISMATCH");
        }
      } catch (err) {
        if (err instanceof N8nAdapterError) {
          if (err.code === "N8N_TIMEOUT") {
            rawResult = makeTimeoutResult(
              validatedParams.call_id,
              candidateToolId,
              agentId,
            );
          } else if (
            [
              "N8N_UPSTREAM_ERROR",
              "N8N_RESPONSE_TOO_LARGE",
              "N8N_REDIRECT_BLOCKED",
              "N8N_TRANSPORT_ERROR",
              "N8N_UNAVAILABLE",
              "N8N_CONFIGURATION_INVALID",
              "SCHEMA_VALIDATION_FAILED",
            ].includes(err.code)
          ) {
            rawResult = makeErrorResult(
              validatedParams.call_id,
              candidateToolId,
              agentId,
              err.code,
              "Adapter execution failed.",
            );
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }

      // 12. Post-Dispatch Result Validation & Correlation
      try {
        // M12/T9 F-272: the budget is the one the module publishes, not the
        // validator's old 64 KiB default, which was an order of magnitude
        // below what the published tool-output contracts allow.
        validateContractSchema(
          "tool-result",
          rawResult,
          TOOL_RESULT_ENVELOPE_MAX_BYTES,
        );
      } catch {
        fail("SCHEMA_VALIDATION_FAILED");
      }
      if (Array.isArray(rawResult.artifacts)) {
        requireDep(depsPathSafetyLoaded);
        for (const artifact of rawResult.artifacts) {
          try {
            validateArtifactLogicalPath(artifact.logical_path);
          } catch {
            fail("SCHEMA_VALIDATION_FAILED");
          }
        }
      }
      verifyResultCorrelation(rawResult, validatedParams.call_id);
      return rawResult;
    },

    beforeAnnounce(event) {
      const snapshot = readSnapshot(paths);
      const owner = findSession(
        snapshot,
        event.childSessionKey,
        event.childRunId,
        true,
      );
      const run = owner.delegation;
      assert(
        run && run.parent_session_key === event.requesterSessionKey,
        "LINEAGE_MISMATCH",
      );
      if (run.run_state === "CANCELLED")
        return { action: "discard", reason: "AUTH_DELEGATION_INACTIVE" };
      if (run.brief_revision !== owner.task.brief_revision)
        return { action: "discard", reason: "REVISION_SUPERSEDED" };
      if (owner.task.brief_state !== "ACTIVE")
        return { action: "discard", reason: "SUPERSEDED_REVISION" };
      if (event.phase === "descendant_wake") {
        const children = Object.values(owner.task.delegations).filter((item) =>
          ownerRunIds(owner).includes(item.parent_run_id),
        );
        assert(
          children.length > 0 &&
            children.every(
              (item) =>
                item.run_state === "COMPLETE" && item.accepted_payload_digest,
            ),
          "MISSING_PREREQUISITE",
        );
        recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
          task_id: owner.task_id,
          brief_revision: owner.task.brief_revision,
          session_key: run.child_session_key,
          previous_run_id: run.native_run_id,
          next_run_id: event.nextRunId,
          source_session_key: run.child_session_key,
          trigger_run_id: run.native_run_id,
          // M7-043: the owner attempt is mandatory, so it is always bound
          // from the live delegation rather than left to the reducer.
          owner_attempt: run.attempt,
        });
        return {
          action: "deliver",
          receipt: JSON.stringify({
            task_id: owner.task_id,
            brief_revision: owner.task.brief_revision,
            accepted_children: children.map((item) => ({
              node_id: item.node_id,
              native_run_id: item.native_run_id,
              payload_digest: item.accepted_payload_digest,
              outcome_status: item.accepted_outcome_status,
            })),
          }),
        };
      }
      assert(event.phase === "completion", "EXECUTION_STATE_UNKNOWN");
      assert(
        typeof event.findings === "string" &&
          Buffer.byteLength(event.findings, "utf8") <= 65536,
        "SCHEMA_INVALID",
      );
      let findingsText = event.findings.trim();
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
        fail("SCHEMA_INVALID");
      }
      validateAgentClaim(payload);
      const digest = payloadDigest(payload);
      const duplicate = run.accepted_payload_digest === digest;
      if (duplicate && !event.nextRunId)
        return { action: "discard", reason: "STALE_RESULT" };
      const governance = manifest(run.agent_id);
      assert(
        governance.expected_governance_hash === run.expected_governance_hash,
        "GOVERNANCE_HASH_MISMATCH",
      );
      assert(event.outcome?.status === "ok", "VALIDATION_FAILED");
      assert(
        sanitizeDelegationText(payload.output) === payload.output,
        "POLICY_DENIED",
      );
      assert(
        (payload.claimed_artifact_refs ?? []).length === 0,
        "REFERENCE_INVALID",
      );
      const node = owner.task.nodes.find(
        (item) => item.node_id === run.node_id,
      );
      assert(
        node?.validation_digest ===
          canonicalHash(
            "zink-validation-v1",
            "agent-result-payload.schema.json",
          ),
        "VALIDATION_FAILED",
      );
      const children = Object.values(owner.task.delegations).filter((item) =>
        [run.native_run_id, ...(run.previous_native_run_ids ?? [])].includes(
          item.parent_run_id,
        ),
      );
      assert(
        !children.some((item) => activeRun.has(item.run_state)),
        "MISSING_PREREQUISITE",
      );
      if (payload.outcome_claim === "COMPLETE")
        assert(
          children.every(
            (item) =>
              !owner.task.nodes.find(
                (candidate) => candidate.node_id === item.node_id,
              )?.required || item.accepted_outcome_status === "COMPLETE",
          ),
          "MISSING_PREREQUISITE",
        );
      const envelope = createTrustedResultEnvelope({
        payload,
        lineage: { ...run, native_run_id: run.native_run_id },
        governance,
        runState: "COMPLETE",
        verifierValidation: "VALID",
        resultAcceptance: "ACCEPTED",
        ...(duplicate ? { receivedAt: run.accepted_received_at } : {}),
      });
      const accepted = duplicate
        ? snapshot
        : recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
            task_id: owner.task_id,
            envelope,
          });
      if (run.accepted_payload_digest && run.accepted_payload_digest !== digest)
        fail("DUPLICATE_RESULT_CONFLICT");
      assert(
        accepted.tasks[owner.task_id].delegations[run.delegation_id]
          .accepted_payload_digest === digest,
        "EXECUTION_STATE_UNKNOWN",
      );
      if (event.nextRunId) {
        const task = accepted.tasks[owner.task_id];
        const existingContinuation = task.continuations?.[event.nextRunId];
        if (existingContinuation) {
          assert(
            existingContinuation.trigger_run_id === run.native_run_id &&
              existingContinuation.source_session_key ===
                run.child_session_key &&
              existingContinuation.session_key === run.parent_session_key,
            "LINEAGE_MISMATCH",
          );
        } else {
          const parent =
            task.root_session_key === run.parent_session_key
              ? { native_run_id: task.root_run_id, attempt: null }
              : Object.values(task.delegations).find(
                  (item) =>
                    item.child_session_key === run.parent_session_key &&
                    item.run_state === "RUNNING",
                );
          assert(parent, "LINEAGE_MISMATCH");
          recordWorkflowEvent(paths, "WORKFLOW_CONTINUATION_AUTHORIZED", {
            task_id: owner.task_id,
            brief_revision: task.brief_revision,
            session_key: run.parent_session_key,
            previous_run_id: parent.native_run_id,
            next_run_id: event.nextRunId,
            source_session_key: run.child_session_key,
            trigger_run_id: run.native_run_id,
            // M7-043: mandatory owner attempt. It is present exactly when the
            // continuation owner is a delegation, which is the only case the
            // reducer requires it for.
            ...(parent.attempt ? { owner_attempt: parent.attempt } : {}),
          });
        }
      }
      return {
        action: "deliver",
        receipt: JSON.stringify({
          envelope,
          output: payload.output,
          assumptions: payload.assumptions,
          limitations: payload.limitations,
        }),
      };
    },
  };
}
