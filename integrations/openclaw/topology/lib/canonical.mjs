import { createHash, createHmac } from "node:crypto";

export const GOVERNANCE_VERSION = "m8-t2.2-r4";
export const SCHEMA_VERSION = "1.0.0";

const SET_KEYS = new Set(["allowed_tools", "allowAgents", "allowed_stacks"]);

function normalize(value, key = "") {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError("Canonical contracts allow integers only");
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    return SET_KEYS.has(key)
      ? [...items].sort((left, right) =>
          compareCodeUnits(JSON.stringify(left), JSON.stringify(right)),
        )
      : items;
  }
  if (value && typeof value === "object") {
    if (
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    )
      throw new TypeError("Canonical contracts require plain objects");
    const fields = Object.keys(value)
      .filter((field) => value[field] !== undefined)
      .map((field) => [field.normalize("NFC"), field]);
    if (new Set(fields.map(([field]) => field)).size !== fields.length)
      throw new TypeError("Canonical object has duplicate normalized keys");
    return Object.fromEntries(
      fields
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([normalized, field]) => [
          normalized,
          normalize(value[field], normalized),
        ]),
    );
  }
  if (value === null || typeof value === "boolean") return value;
  throw new TypeError("Unsupported canonical value");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireSnowflake(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{16,19}$/u.test(value))
    throw new TypeError("Discord identity must be a snowflake string");
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function canonicalHash(domain, value) {
  return createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`, "utf8")
    .digest("hex");
}

export function deriveTaskId({
  task_schema_version,
  origin,
  origin_principal_ref,
  origin_message_id,
  agent_id,
  root_agent_id,
  task_id,
}) {
  const explicitAgent =
    agent_id ?? (task_schema_version === "v2" ? root_agent_id : undefined);
  if (task_schema_version === "v2" || explicitAgent !== undefined) {
    if (explicitAgent !== undefined && typeof explicitAgent !== "string") {
      throw new TypeError("agent_id must be a string");
    }
    return canonicalHash("zink-task-id-v2", {
      task_schema_version: "v2",
      origin,
      origin_principal_ref,
      origin_message_id: requireSnowflake(origin_message_id),
      agent_id: explicitAgent,
    });
  }
  if (root_agent_id !== undefined) {
    const v2Candidate = canonicalHash("zink-task-id-v2", {
      task_schema_version: "v2",
      origin,
      origin_principal_ref,
      origin_message_id: requireSnowflake(origin_message_id),
      agent_id: root_agent_id,
    });
    if (task_id !== undefined && task_id === v2Candidate) {
      return v2Candidate;
    }
  }
  return canonicalHash("zink-task-id-v1", {
    origin,
    origin_principal_ref,
    origin_message_id: requireSnowflake(origin_message_id),
  });
}

export function deriveDelegationId({
  task_id,
  brief_revision,
  node_id,
  agent_id,
  attempt,
}) {
  return canonicalHash("zink-delegation-id-v1", {
    task_id,
    brief_revision,
    node_id,
    agent_id,
    attempt,
  });
}

export const SPAWN_PROPOSAL_KEYS = Object.freeze([
  "task_id",
  "brief_revision",
  "node_id",
  "agent_id",
  "parent_agent_id",
  "parent_session_key",
  "parent_run_id",
  "tool_call_id",
  "turn",
  "attempt",
  "expected_governance_hash",
]);

/**
 * M8-055: the single canonical spawn-proposal builder. Both the live plugin
 * adapter and the reducer consume this exact shape, so the delegation id and
 * the request digest can never be derived from two divergent serializations.
 */
export function buildSpawnProposal(fields) {
  const missing = SPAWN_PROPOSAL_KEYS.filter(
    (key) => fields?.[key] === undefined,
  );
  if (missing.length > 0) {
    throw new TypeError(`SPAWN_PROPOSAL_INCOMPLETE: ${missing.join(",")}`);
  }
  const proposal = {
    task_id: fields.task_id,
    brief_revision: fields.brief_revision,
    node_id: fields.node_id,
    agent_id: fields.agent_id,
    parent_agent_id: fields.parent_agent_id,
    parent_session_key: fields.parent_session_key,
    parent_run_id: fields.parent_run_id,
    tool_call_id: fields.tool_call_id,
    turn: fields.turn,
    attempt: fields.attempt,
    expected_governance_hash: fields.expected_governance_hash,
  };
  const delegation_id = deriveDelegationId(proposal);
  return {
    ...proposal,
    delegation_id,
    // The request digest binds the WHOLE request tuple, so a tampered lineage
    // field (tool call id, turn, parent run, governance hash) changes it even
    // though it is not part of the delegation identity.
    request_digest: canonicalHash("zink-spawn-request-v1", {
      ...proposal,
      delegation_id,
    }),
  };
}

export function deriveReferenceId(value) {
  return canonicalHash("zink-reference-v1", value);
}

export function deriveApprovalScopeDigest(value) {
  return canonicalHash("zink-approval-scope-v1", value);
}

export function derivePrincipalRef(identityKey, rawDiscordId) {
  return createHmac("sha256", identityKey)
    .update(`discord-principal-v1\0${requireSnowflake(rawDiscordId)}`, "utf8")
    .digest("hex");
}

export function utcNow() {
  return new Date().toISOString().replace(".000Z", "Z");
}
