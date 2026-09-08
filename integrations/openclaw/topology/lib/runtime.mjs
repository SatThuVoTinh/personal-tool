import { canonicalHash, deriveDelegationId, utcNow } from "./canonical.mjs";

export const AGENT_REASON_CODES = Object.freeze([
  "NONE",
  "OPTIONAL_BRANCH_FAILED",
  "MISSING_INPUT",
  "MISSING_PREREQUISITE",
  "APPROVAL_REQUIRED",
  "OWNER_DECISION_REQUIRED",
  "POLICY_DENIED",
  "SELF_VALIDATION_FAILED",
  "PROMPT_INJECTION_SUSPECTED",
]);

export const RUNTIME_REASON_CODES = Object.freeze([
  "SCHEMA_INVALID",
  "LINEAGE_MISMATCH",
  "GOVERNANCE_HASH_MISMATCH",
  "UNAUTHORIZED_TARGET",
  "DUPLICATE_RESULT_CONFLICT",
  "INVALID_STATE_TRANSITION",
  "RESULT_DIGEST_MISMATCH",
  "REFERENCE_INVALID",
  "TRANSIENT_RUNTIME_FAILURE",
  "VALIDATION_FAILED",
  "SPAWN_UNKNOWN",
  "EXECUTION_STATE_UNKNOWN",
  "RUN_TIMEOUT",
  "ANNOUNCE_DELIVERY_FAILED",
  "DEPENDENCY_CYCLE",
  "WORKFLOW_BUDGET_EXHAUSTED",
  "RUNTIME_CAPABILITY_MISMATCH",
  "RETRY_EXHAUSTED",
  "OWNER_CANCELLED",
  "PARENT_CANCELLED",
  "SUPERSEDED_REVISION",
  "STALE_RESULT",
]);

const SECRET_PATTERN =
  /(?:api[_-]?key|token|password|secret|private[_-]?key|authorization)\s*[:=]\s*[^\s,;]+/giu;
const PATH_PATTERN = /(?:[A-Z]:\\|\/home\/|~\/|\\\\)[^\s"']+/gu;

export function sanitizeDelegationText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(SECRET_PATTERN, "[REDACTED_SECRET]")
    .replace(PATH_PATTERN, "[REDACTED_PATH]")
    .slice(0, 16 * 1024);
}

export function payloadDigest(payload) {
  return canonicalHash("zink-result-payload-v1", payload);
}

export function validateAgentClaim(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("SCHEMA_INVALID");
  if (!/^(COMPLETE|PARTIAL|BLOCKED|FAILED)$/u.test(payload.outcome_claim ?? ""))
    throw new Error("SCHEMA_INVALID");
  if (!AGENT_REASON_CODES.includes(payload.reason_claim))
    throw new Error("SCHEMA_INVALID");
  if (payload.outcome_claim === "COMPLETE" && payload.reason_claim !== "NONE")
    throw new Error("SCHEMA_INVALID");
  if (
    payload.outcome_claim === "PARTIAL" &&
    payload.reason_claim !== "OPTIONAL_BRANCH_FAILED"
  )
    throw new Error("SCHEMA_INVALID");
  if (
    ["BLOCKED", "FAILED"].includes(payload.outcome_claim) &&
    payload.reason_claim === "NONE"
  )
    throw new Error("SCHEMA_INVALID");
  if (
    payload.outcome_claim === "BLOCKED" &&
    ![
      "MISSING_INPUT",
      "MISSING_PREREQUISITE",
      "APPROVAL_REQUIRED",
      "OWNER_DECISION_REQUIRED",
      "POLICY_DENIED",
      "PROMPT_INJECTION_SUSPECTED",
    ].includes(payload.reason_claim)
  )
    throw new Error("SCHEMA_INVALID");
  if (
    payload.outcome_claim === "FAILED" &&
    payload.reason_claim !== "SELF_VALIDATION_FAILED"
  )
    throw new Error("SCHEMA_INVALID");
  return true;
}

export function createTrustedResultEnvelope({
  payload,
  lineage,
  governance,
  runState,
  verifierValidation = "VALID",
  resultAcceptance = "ACCEPTED",
}) {
  validateAgentClaim(payload);
  const acceptedReason = payload.reason_claim;
  return {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r11",
    task_id: lineage.task_id,
    brief_revision: lineage.brief_revision,
    node_id: lineage.node_id,
    agent_id: lineage.agent_id,
    stack_id: lineage.stack_id,
    delegation_id: lineage.delegation_id ?? deriveDelegationId(lineage),
    native_run_id: lineage.native_run_id,
    ...(lineage.parent_run_id ? { parent_run_id: lineage.parent_run_id } : {}),
    attempt: lineage.attempt,
    expected_governance_hash: governance.expected_governance_hash,
    observed_governance_hash: governance.observed_governance_hash,
    run_state: runState,
    received_at: utcNow(),
    payload_digest: payloadDigest(payload),
    verifier_validation: verifierValidation,
    accepted_outcome_status: payload.outcome_claim,
    accepted_reason_code: acceptedReason,
    owner_action_required: ["BLOCKED", "FAILED"].includes(
      payload.outcome_claim,
    ),
    result_acceptance: resultAcceptance,
  };
}

export function classifyDuplicate(existing, incoming) {
  if (!existing) return "PENDING";
  if (
    existing.delegation_id !== incoming.delegation_id ||
    existing.native_run_id !== incoming.native_run_id
  )
    return "PENDING";
  return existing.payload_digest === incoming.payload_digest
    ? "IDEMPOTENT_DUPLICATE"
    : "CONFLICT_REJECTED";
}

export function workflowAggregate(nodes) {
  const mandatory = nodes.filter((node) => node.required);
  const outcome = (node) => node.outcome_status ?? node.accepted_outcome_status;
  if (mandatory.some((node) => outcome(node) === "BLOCKED")) return "BLOCKED";
  if (mandatory.some((node) => outcome(node) === "FAILED")) return "FAILED";
  if (mandatory.some((node) => outcome(node) === "PARTIAL")) return "PARTIAL";
  return "COMPLETE";
}

export function transitionAllowed(namespace, from, to, transitions) {
  return (
    Array.isArray(transitions?.[namespace]?.[from]) &&
    transitions[namespace][from].includes(to)
  );
}

export function revisionCanCarryForward({
  producerStatus,
  referenceStatus,
  dependencyDigestsMatch,
  constraintsUnchanged,
}) {
  return (
    producerStatus === "COMPLETE" &&
    referenceStatus === "VALID" &&
    dependencyDigestsMatch === true &&
    constraintsUnchanged === true
  );
}

export function reasonEmitterAllowed(reason, emitter) {
  if (AGENT_REASON_CODES.includes(reason)) return emitter === "agent";
  if (RUNTIME_REASON_CODES.includes(reason))
    return emitter === "runtime" || emitter === "verifier";
  return false;
}

export function deriveIncidentId(value) {
  return canonicalHash("zink-incident-v1", value);
}
