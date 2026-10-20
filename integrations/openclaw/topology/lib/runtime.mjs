import {
  canonicalHash,
  deriveDelegationId,
  utcNow,
  GOVERNANCE_VERSION,
} from "./canonical.mjs";
import { validateContract } from "./schema.mjs";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

const REASON_POLICY_URL = new URL(
  "../policy/reason-code-matrix.json",
  import.meta.url,
);
const REASON_POLICY_REQUIRED = [
  ["agent_claims", "array"],
  ["runtime_reasons", "array"],
  // F-251: the matrix publishes THREE vocabularies. The third one
  // (task_suspension_reasons) names the codes the reducer writes when it
  // suspends a task, and it was the only section no reader consulted: a
  // declared suspension code was therefore invisible to the very check that
  // every other durable reason passes.
  ["task_suspension_reasons", "array"],
  ["outcome_compatibility", "object"],
  // M12/T9 F-127: the ONE declaration of the outcome vocabulary. It used to be
  // re-listed independently in six places (two schemas, the ledger snapshot,
  // the trusted result envelope, the agent result payload and a regex in this
  // file), so editing one copy silently re-labelled history or rejected
  // writes for an outcome another copy did not declare. Every consumer now
  // derives from THIS list.
  ["outcome_statuses", "array"],
];

// This matrix is what every governed denial gets attributed to, so a load that dies as a raw
// fs/JSON error — or that quietly returns a policy missing a key its readers use — leaves the
// whole runtime unable to explain itself at import time. Name the condition instead.
export function loadReasonPolicy(policyUrl = REASON_POLICY_URL) {
  let raw;
  try {
    raw = readFileSync(policyUrl, "utf8");
  } catch (error) {
    throw new Error(`REASON_POLICY_UNREADABLE: ${error.message}`, {
      cause: error,
    });
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      "REASON_POLICY_MALFORMED: reason-code-matrix.json is not valid JSON",
      { cause: error },
    );
  }

  for (const [key, kind] of REASON_POLICY_REQUIRED) {
    const value = parsed?.[key];
    const holds =
      kind === "array"
        ? Array.isArray(value)
        : typeof value === "object" && value !== null && !Array.isArray(value);
    if (!holds) {
      throw new Error(
        `REASON_POLICY_INCOMPLETE: ${key} must be ${kind}, got ${
          value === null ? "null" : typeof value
        }`,
      );
    }
  }

  return parsed;
}

const reasonPolicy = loadReasonPolicy();
export const AGENT_REASON_CODES = Object.freeze(reasonPolicy.agent_claims);
export const RUNTIME_REASON_CODES = Object.freeze(reasonPolicy.runtime_reasons);
export const TASK_SUSPENSION_REASON_CODES = Object.freeze(
  reasonPolicy.task_suspension_reasons,
);
// M12/T9 F-127: the outcome vocabulary, derived from the ONE declaration. A
// consumer that needs "is this an outcome?" asks here instead of re-listing
// the four values.
export const OUTCOME_STATUSES = Object.freeze(reasonPolicy.outcome_statuses);
export const OUTCOME_STATUS_SET = new Set(OUTCOME_STATUSES);
// F-251: ONE membership set built from EVERY section the matrix publishes, so
// a code the policy declares can never be invisible to the check that guards
// durable `task.reason_code` writes.
const DECLARED_REASON_CODES = new Set([
  ...AGENT_REASON_CODES,
  ...RUNTIME_REASON_CODES,
  ...TASK_SUSPENSION_REASON_CODES,
]);

/**
 * Membership in a vocabulary the policy file already publishes. Derived from the
 * declared sets rather than a third list, so nothing here widens the contract.
 */
export function isDeclaredReasonCode(code) {
  return typeof code === "string" && DECLARED_REASON_CODES.has(code);
}

const SECRET_PATTERN =
  /(?:api[_-]?key|token|password|secret|private[_-]?key|authorization)["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n,;}]+)/giu;
const PATH_PATTERN =
  /(?:[A-Z]:\\|\/home\/|~\/|\\\\[a-zA-Z0-9_.-]+\\)[^\s"']+/gu;
const PEM_PATTERN =
  /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )?PRIVATE KEY-----|$)/gu;
const TOKEN_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|mfa\.[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{25,})\b/gu;

export function sanitizeDelegationText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(PEM_PATTERN, "[REDACTED_SECRET]")
    .replace(TOKEN_PATTERN, "[REDACTED_SECRET]")
    .replace(SECRET_PATTERN, "[REDACTED_SECRET]")
    .replace(PATH_PATTERN, "[REDACTED_PATH]");
}

export function payloadDigest(payload) {
  return canonicalHash("zink-result-payload-v1", payload);
}

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a character.
 *
 * This lives beside `validateAgentClaim` because it encodes the SAME rule the
 * contract validator enforces: `maxLength` is measured in UTF-8 bytes
 * (`schema.mjs` uses `Buffer.byteLength`), so every runtime bound that produces
 * a value destined for a contract MUST be byte-budgeted.
 *
 * Proven defect (M10/T2-R15): the guard truncated `payload.output` at 16384
 * CHARACTERS and `payload.agent_self_validation` at 4096 characters before
 * calling `validateAgentClaim`. For Vietnamese output (2 bytes/char) the guard's
 * own truncation produced a value its own contract then rejected — measured on
 * the real validator:
 *   output = 16384 "á" -> 32768 bytes -> SCHEMA_VALIDATION_FAILED
 *   output = 12000 "á" -> 24000 bytes -> SCHEMA_VALIDATION_FAILED
 *   agent_self_validation = 4096 "á" -> 8192 bytes -> SCHEMA_VALIDATION_FAILED
 * while the byte-exact limits passed. A legitimate specialist report was
 * therefore rejected with no recovery, because the same character slice runs on
 * every retry. This function previously existed only as a private copy inside
 * the plugin entrypoint; it is now the single shared definition so the rule
 * cannot drift again.
 */
export function truncateUtf8(value, maxBytes) {
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

export function validateAgentClaim(payload) {
  validateContract("agent-result-payload", payload);
  const inspectText = (value) => {
    if (typeof value === "string" && sanitizeDelegationText(value) !== value)
      throw new Error("POLICY_DENIED");
    if (Array.isArray(value)) value.forEach(inspectText);
    else if (value && typeof value === "object")
      Object.values(value).forEach(inspectText);
  };
  inspectText(payload);
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("SCHEMA_INVALID");
  if (!OUTCOME_STATUS_SET.has(payload.outcome_claim ?? ""))
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
  verifierValidation,
  resultAcceptance,
  receivedAt = utcNow(),
}) {
  validateAgentClaim(payload);
  if (verifierValidation !== "VALID" || resultAcceptance !== "ACCEPTED")
    throw new Error("VALIDATION_FAILED");
  if (
    !/^[a-f0-9]{64}$/u.test(governance?.expected_governance_hash ?? "") ||
    governance.expected_governance_hash !== governance.observed_governance_hash
  )
    throw new Error("GOVERNANCE_HASH_MISMATCH");
  if (runState !== "COMPLETE") throw new Error("INVALID_STATE_TRANSITION");
  if (
    !lineage?.native_run_id ||
    (lineage.delegation_id &&
      lineage.delegation_id !== deriveDelegationId(lineage))
  )
    throw new Error("LINEAGE_MISMATCH");
  const { outcome: acceptedOutcome, reason: acceptedReason } =
    normalizeAgentOutcome(payload, lineage.attempt);
  const envelope = {
    schema_version: "1.0.0",
    governance_version: GOVERNANCE_VERSION,
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
    received_at: receivedAt,
    payload_digest: payloadDigest(payload),
    verifier_validation: verifierValidation,
    accepted_outcome_status: acceptedOutcome,
    accepted_reason_code: acceptedReason,
    owner_action_required: ["BLOCKED", "FAILED"].includes(acceptedOutcome),
    result_acceptance: resultAcceptance,
  };
  validateContract("trusted-result-envelope", envelope);
  return envelope;
}

export function normalizeAgentOutcome(payload, attempt = 1) {
  validateAgentClaim(payload);
  // Self-reported failure cannot spend retry budget or declare exhaustion.
  // Likewise a PARTIAL claim cannot authorize degraded delivery by itself.
  let acceptedOutcome = payload.outcome_claim;
  let acceptedReason = payload.reason_claim;
  if (acceptedReason === "SELF_VALIDATION_FAILED") {
    acceptedOutcome = attempt >= 3 ? "FAILED" : "BLOCKED";
    acceptedReason = attempt >= 3 ? "RETRY_EXHAUSTED" : "VALIDATION_FAILED";
  } else if (acceptedOutcome === "PARTIAL") {
    acceptedOutcome = "BLOCKED";
    acceptedReason = "OWNER_DECISION_REQUIRED";
  }
  if (
    !reasonPolicy.outcome_compatibility[acceptedOutcome]?.includes(
      acceptedReason,
    )
  )
    throw new Error("VALIDATION_FAILED");
  return { outcome: acceptedOutcome, reason: acceptedReason };
}

export function outcomeReasonAllowed(outcome, reason) {
  return reasonPolicy.outcome_compatibility[outcome]?.includes(reason) === true;
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
  if (mandatory.length === 0) return "BLOCKED";
  // An accepted terminal mandatory failure cannot be repaired by waiting for
  // downstream nodes which will never become ready. Optional failures still
  // do not decide the workflow outcome.
  if (mandatory.some((node) => outcome(node) === "FAILED")) return "FAILED";
  if (
    mandatory.some(
      (node) =>
        !["COMPLETE", "PARTIAL", "FAILED", "BLOCKED"].includes(outcome(node)),
    )
  )
    return "BLOCKED";
  if (mandatory.some((node) => outcome(node) === "BLOCKED")) return "BLOCKED";
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
