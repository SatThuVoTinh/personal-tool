import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalHash, deriveDelegationId } from "./canonical.mjs";
import { readSnapshot, recordWorkflowEvent } from "./ledger.mjs";
import { findSession, ownerRunIds } from "./workflow.mjs";
import { validateContract } from "./schema.mjs";
import {
  createTrustedResultEnvelope,
  payloadDigest,
  sanitizeDelegationText,
  validateAgentClaim,
  normalizeAgentOutcome,
} from "./runtime.mjs";

let policy;
try {
  policy = await import("../../lib/policy.mjs");
} catch {
  const repoPolicyPath = path.resolve(
    process.cwd(),
    "integrations/openclaw/lib/policy.mjs",
  );
  policy = await import(pathToFileURL(repoPolicyPath).href);
}

const {
  AGENT_IDS,
  STACK_IDS,
  OPENCLAW_BUILT_IN_TOOL_IDS,
  BUILT_IN_TOOL_POLICY,
  TOOL_POLICY,
  OPERATION_POLICY,
  AUTHORIZATION_MODES,
  AUTHORIZATION_MODE_BY_TOOL,
  DISPATCH_TARGETS,
  CALLABLE_TOOL_REGISTRY,
  CALLABLE_DISPATCH_REGISTRY,
  N8N_WORKFLOW_REGISTRY,
  ZINK_CAPABILITY_REGISTRY,
  T3_GLOBAL_TIMEOUT_CEILING_MS,
  T3_GLOBAL_MEMORY_CEILING_MB,
  deriveApprovalMaterialParameters,
  deriveApprovalScopeDigest,
} = policy;

let pathSafety;
try {
  pathSafety = await import("../../../../zink-tools/common/path-safety.mjs");
} catch {
  const repoPathSafety = path.resolve(
    process.cwd(),
    "zink-tools/common/path-safety.mjs",
  );
  pathSafety = await import(pathToFileURL(repoPathSafety).href);
}
const { validateArtifactLogicalPath } = pathSafety;

let sqlValidator;
try {
  sqlValidator = await import("../../../../zink-tools/sql/validator.mjs");
} catch {
  const repoValidator = path.resolve(
    process.cwd(),
    "zink-tools/sql/validator.mjs",
  );
  sqlValidator = await import(pathToFileURL(repoValidator).href);
}
const { validateSqlQuery } = sqlValidator;

let n8nAdapter;
try {
  n8nAdapter = await import("../../../../zink-tools/n8n/trigger.mjs");
} catch {
  const repoN8n = path.resolve(process.cwd(), "zink-tools/n8n/trigger.mjs");
  n8nAdapter = await import(pathToFileURL(repoN8n).href);
}
const { invokeN8n, N8nAdapterError } = n8nAdapter;

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const contractsDir = path.resolve(
  __dirname,
  "../../../../zink-tools/contracts",
);

const schemaCache = new Map();
function loadContractSchema(name) {
  let cleanName = name;
  if (cleanName.startsWith("tools/")) cleanName = cleanName.slice(6);
  if (cleanName.endsWith(".schema.json")) cleanName = cleanName.slice(0, -12);

  if (!schemaCache.has(cleanName)) {
    let filePath = path.join(contractsDir, `${cleanName}.schema.json`);
    if (!existsSync(filePath)) {
      filePath = path.join(contractsDir, "tools", `${cleanName}.schema.json`);
    }
    if (!existsSync(filePath)) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
    schemaCache.set(cleanName, JSON.parse(readFileSync(filePath, "utf8")));
  }
  return schemaCache.get(cleanName);
}

function typeMatches(type, value) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object")
    return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isSafeInteger(value);
  if (type === "number")
    return typeof value === "number" && Number.isFinite(value);
  if (type === "string" || type === "boolean") return typeof value === type;
  return false;
}

function resolveRef(ref, currentSchemaName) {
  const [target, pointer = ""] = ref.split("#");
  const schemaName = target ? target : currentSchemaName;
  let root = loadContractSchema(schemaName);
  let cur = root;
  if (pointer && pointer.startsWith("/")) {
    for (const part of pointer.split("/").slice(1)) {
      const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!cur || typeof cur !== "object" || !Object.hasOwn(cur, key)) {
        throw new Error("SCHEMA_VALIDATION_FAILED");
      }
      cur = cur[key];
    }
  }
  return { schema: cur, schemaName };
}

function checkSchema(schema, value, currentSchemaName, depth = 0) {
  if (depth > 64) throw new Error("SCHEMA_VALIDATION_FAILED");
  if (schema === true) return;
  if (schema === false || schema === undefined || value === undefined)
    throw new Error("SCHEMA_VALIDATION_FAILED");

  if (schema.$ref) {
    const { schema: targetSchema, schemaName: newSchemaName } = resolveRef(
      schema.$ref,
      currentSchemaName,
    );
    checkSchema(targetSchema, value, newSchemaName, depth + 1);
    return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(t, value))) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
  }

  if (Object.hasOwn(schema, "const")) {
    if (JSON.stringify(value) !== JSON.stringify(schema.const)) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
  }

  if (schema.enum) {
    if (
      !schema.enum.some(
        (item) => JSON.stringify(item) === JSON.stringify(value),
      )
    ) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
  }

  if (schema.oneOf) {
    let matchCount = 0;
    for (const branch of schema.oneOf) {
      try {
        checkSchema(branch, value, currentSchemaName, depth + 1);
        matchCount++;
      } catch {
        void 0;
      }
    }
    if (matchCount !== 1) {
      throw new Error("SCHEMA_VALIDATION_FAILED");
    }
  }

  if (schema.allOf) {
    for (const branch of schema.allOf) {
      checkSchema(branch, value, currentSchemaName, depth + 1);
    }
  }

  if (schema.anyOf) {
    let matched = false;
    for (const branch of schema.anyOf) {
      try {
        checkSchema(branch, value, currentSchemaName, depth + 1);
        matched = true;
        break;
      } catch {
        void 0;
      }
    }
    if (!matched) throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (
      schema.maxLength !== undefined &&
      Buffer.byteLength(value, "utf8") > schema.maxLength
    )
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value))
      throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum)
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (schema.maximum !== undefined && value > schema.maximum)
      throw new Error("SCHEMA_VALIDATION_FAILED");
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (schema.uniqueItems) {
      const set = new Set(value.map((x) => JSON.stringify(x)));
      if (set.size !== value.length)
        throw new Error("SCHEMA_VALIDATION_FAILED");
    }
    if (schema.items) {
      for (const item of value) {
        checkSchema(schema.items, item, currentSchemaName, depth + 1);
      }
    }
  } else if (value !== null && typeof value === "object") {
    const keys = Object.keys(value);
    if (
      schema.minProperties !== undefined &&
      keys.length < schema.minProperties
    )
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (
      schema.maxProperties !== undefined &&
      keys.length > schema.maxProperties
    )
      throw new Error("SCHEMA_VALIDATION_FAILED");
    if (schema.required) {
      for (const req of schema.required) {
        if (!Object.hasOwn(value, req))
          throw new Error("SCHEMA_VALIDATION_FAILED");
      }
    }
    const props = schema.properties || {};
    for (const key of keys) {
      if (Object.hasOwn(props, key)) {
        checkSchema(props[key], value[key], currentSchemaName, depth + 1);
      } else {
        if (schema.additionalProperties === false) {
          throw new Error("SCHEMA_VALIDATION_FAILED");
        } else if (
          schema.additionalProperties &&
          typeof schema.additionalProperties === "object"
        ) {
          checkSchema(
            schema.additionalProperties,
            value[key],
            currentSchemaName,
            depth + 1,
          );
        }
      }
    }
  }
}

export function validateContractSchema(schemaName, value) {
  const rootSchema = loadContractSchema(schemaName);
  checkSchema(rootSchema, value, schemaName);
  return true;
}

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
  if (paths && paths.root) {
    const approvalsFile = path.join(paths.root, "approvals.json");
    if (existsSync(approvalsFile)) {
      try {
        const data = JSON.parse(readFileSync(approvalsFile, "utf8"));
        if (data && data[approvalId]) {
          const rec = data[approvalId];
          validateApprovalRecord8Fields(rec);
          return rec;
        }
      } catch {
        void 0;
      }
    }
    const individualApprovalFile = path.join(
      paths.root,
      "approvals",
      `${approvalId}.json`,
    );
    if (existsSync(individualApprovalFile)) {
      try {
        const rec = JSON.parse(readFileSync(individualApprovalFile, "utf8"));
        validateApprovalRecord8Fields(rec);
        return rec;
      } catch {
        void 0;
      }
    }
    try {
      const snapshot = readSnapshot(paths);
      for (const task of Object.values(snapshot.tasks || {})) {
        if (task.approvals && task.approvals[approvalId]) {
          const rec = task.approvals[approvalId];
          validateApprovalRecord8Fields(rec);
          return rec;
        }
      }
    } catch {
      void 0;
    }
  }
  return null;
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

  const lock = path.join(paths.root, "writer.lock");
  const deadline = Date.now() + 5000;
  let acquired = false;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      acquired = true;
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!acquired) {
    throw new Error("EXECUTION_STATE_UNKNOWN");
  }
  try {
    const consumedFile = path.join(paths.root, "consumed-approvals.json");
    let consumed = {};
    if (existsSync(consumedFile)) {
      try {
        consumed = JSON.parse(readFileSync(consumedFile, "utf8"));
      } catch {
        consumed = {};
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
  } finally {
    try {
      rmdirSync(lock);
    } catch {
      void 0;
    }
  }
}

export function createGovernanceGuard({ paths, manifestFor }) {
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
    if (context.agentId !== "main") {
      const permitted =
        context.agentId === "o1"
          ? ["semantic", "intelligence", "decision"]
          : context.agentId === "o2"
            ? ["infrastructure", "data_plant"]
            : [];
      assert(
        new Set(brief.nodes.map((node) => node.stack_id)).size === 1 &&
          brief.nodes.every((node) => permitted.includes(node.stack_id)),
        "UNAUTHORIZED_TARGET",
      );
    }
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
    beforeRunEnd(event, context) {
      const owner = findSession(
        readSnapshot(paths),
        context.sessionKey,
        context.runId,
      );
      assert(
        (owner.delegation?.agent_id ?? owner.task.root_agent_id) ===
          context.agentId,
        "LINEAGE_MISMATCH",
      );
      if (owner.delegation || event.yielded === true) return { allow: true };
      assert(event.success === true, "EXECUTION_STATE_UNKNOWN");
      assert(
        owner.task.workflow_status === "ACTIVE" &&
          owner.task.brief_state === "ACTIVE",
        "INVALID_STATE_TRANSITION",
      );
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
      if (text.startsWith("```json")) {
        text = text.slice(7);
        if (text.endsWith("```")) text = text.slice(0, -3);
        text = text.trim();
      } else if (text.startsWith("```")) {
        text = text.slice(3);
        if (text.endsWith("```")) text = text.slice(0, -3);
        text = text.trim();
      }
      assert(Buffer.byteLength(text, "utf8") <= 65536, "SCHEMA_INVALID");
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        fail("SCHEMA_INVALID");
      }
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
      const snapshot = readSnapshot(paths);
      let owner;
      try {
        owner = findSession(snapshot, context.sessionKey, context.runId);
      } catch {
        const candidates = Object.entries(snapshot.tasks).filter(([, task]) => {
          const entry = task.continuations?.[context.runId];
          return (
            entry && !entry.started && entry.session_key === context.sessionKey
          );
        });
        assert(candidates.length === 1, "EXECUTION_STATE_UNKNOWN");
        const [task_id] = candidates[0];
        assert(
          context.inputProvenance?.kind === "inter_session" &&
            context.inputProvenance.sourceTool === "subagent_announce",
          "LINEAGE_MISMATCH",
        );
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
      }
      assert(
        owner.task.workflow_status === "ACTIVE" &&
          owner.task.brief_state === "ACTIVE",
        "INVALID_STATE_TRANSITION",
      );
      assert(
        (owner.delegation?.agent_id ?? owner.task.root_agent_id) ===
          context.agentId,
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
        if (
          candidateToolId !== "session_status" &&
          !BUILT_IN_TOOL_POLICY[agentId]?.includes(candidateToolId)
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
        assert(
          (owner.delegation?.agent_id ?? task.root_agent_id) ===
            context.agentId,
          "LINEAGE_MISMATCH",
        );
        assert(
          task.workflow_status === "ACTIVE" && task.brief_state === "ACTIVE",
          "INVALID_STATE_TRANSITION",
        );
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
          assert(
            !event.params ||
              Object.keys(event.params).length === 0 ||
              (event.toolName === "session_status" &&
                (event.params.sessionKey === undefined ||
                  event.params.sessionKey === "current" ||
                  event.params.sessionKey === context.sessionKey)),
            "POLICY_DENIED",
          );
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
        if (owner.delegation)
          assert(
            node.stack_id === owner.delegation.stack_id,
            "UNAUTHORIZED_TARGET",
          );
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
            revisions: 16 - task.revisions_used,
            transitions:
              10 -
              task.transitions_used -
              (context.agentId === "main" &&
              task.current_stack &&
              task.current_stack !== node.stack_id
                ? 1
                : 0),
            delegated_runs: 71 - task.delegated_runs_used,
          },
          requested_output_schema: "agent-result-payload.schema.json",
        };
        handoff.delegation_id = deriveDelegationId({
          ...handoff,
          agent_id: params.agentId,
        });
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
            task.accepted_reference_digests?.[ref.ref_id] ===
              canonicalHash("zink-reference-v1", ref),
            "REFERENCE_INVALID",
          );
        const spec = {
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
          delegation_id: handoff.delegation_id,
          expected_governance_hash: handoff.expected_governance_hash,
          request_digest: canonicalHash("zink-delegation-id-v1", handoff),
        };
        assert(
          deriveDelegationId(spec) === spec.delegation_id,
          "LINEAGE_MISMATCH",
        );
        recordWorkflowEvent(paths, "WORKFLOW_SPAWN_RESERVED", spec);
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
        validateContractSchema("tool-call", event.params);
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
        try {
          validateArtifactLogicalPath(validatedParams.input.entrypoint);
        } catch {
          fail("SCHEMA_VALIDATION_FAILED");
        }
      }

      // 7. Monotonic Authorization Verification
      if (!TOOL_POLICY[agentId]?.includes(candidateToolId)) {
        fail("AUTH_POLICY_DENIED");
      }

      // 8. Effective Constraints Computation
      const callerTimeoutMs =
        (validatedParams.constraints?.timeout_seconds ?? 300) * 1000;
      let workflowLimitMs = Infinity;
      if (candidateToolId === "zink_n8n") {
        const workflowDef =
          N8N_WORKFLOW_REGISTRY[validatedParams.input.workflow_id];
        if (!workflowDef) fail("RUNTIME_CAPABILITY_MISMATCH");
        workflowLimitMs = workflowDef.timeoutMs;
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
        assert(
          typeof delStackId === "string" && STACK_IDS.includes(delStackId),
          "AUTH_DELEGATION_NOT_FOUND",
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
          const wf = N8N_WORKFLOW_REGISTRY[validatedParams.input.workflow_id];
          assert(wf?.allowedAgents?.includes(agentId), "AUTH_POLICY_DENIED");
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
          const approvalId = validatedParams.approval_id;
          if (approvalId === undefined || approvalId === null)
            fail("AUTH_APPROVAL_REQUIRED");
          if (typeof approvalId !== "string" || !isUuidV4(approvalId))
            fail("AUTH_APPROVAL_INVALID");

          const record = resolveAuthenticatedApproval(paths, approvalId);
          if (!record || typeof record !== "object")
            fail("AUTH_APPROVAL_INVALID");
          const expectedPrincipal =
            ownerSession.task.origin_principal_ref ??
            ownerSession.task.origin?.origin_principal_ref ??
            ownerSession.task.root_principal_ref;
          if (expectedPrincipal) {
            assert(
              record.owner_principal_ref === expectedPrincipal,
              "AUTH_APPROVAL_INVALID",
            );
          }
          assert(
            record.task_id === delTaskId &&
              String(record.brief_revision) ===
                String(ownerSession.task.brief_revision),
            "AUTH_APPROVAL_INVALID",
          );
          assert(
            record.tool_id === candidateToolId &&
              record.operation === operationName,
            "AUTH_APPROVAL_INVALID",
          );
          assert(record.exact_target === actualTarget, "AUTH_APPROVAL_INVALID");

          const expiryMs = Date.parse(record.expires_at);
          if (Number.isNaN(expiryMs) || currentTime > expiryMs) {
            fail("AUTH_APPROVAL_EXPIRED");
          }
          approvalExpiryMs = expiryMs;

          const materialParameters = deriveApprovalMaterialParameters(
            candidateToolId,
            operationName,
            validatedParams.input,
          );
          const expectedDigest = deriveApprovalScopeDigest({
            task_id: record.task_id,
            brief_revision: record.brief_revision,
            tool_id: record.tool_id,
            operation: record.operation,
            exact_target: record.exact_target,
            material_parameters: materialParameters,
            expires_at: record.expires_at,
          });
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
        validateContractSchema("tool-result", rawResult);
      } catch {
        fail("SCHEMA_VALIDATION_FAILED");
      }
      if (Array.isArray(rawResult.artifacts)) {
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
      if (
        run.run_state === "CANCELLED" ||
        run.brief_revision !== owner.task.brief_revision ||
        owner.task.brief_state !== "ACTIVE"
      )
        return { action: "discard" };
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
      if (duplicate && !event.nextRunId) return { action: "discard" };
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
              ? { native_run_id: task.root_run_id }
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
