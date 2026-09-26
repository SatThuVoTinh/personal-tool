import { createHash, createHmac } from "node:crypto";

export const GOVERNANCE_VERSION = "m8-t2.1-r3";
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
