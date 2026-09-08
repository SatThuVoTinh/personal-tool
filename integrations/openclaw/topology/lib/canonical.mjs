import { createHash, createHmac } from "node:crypto";

export const GOVERNANCE_VERSION = "m7-t2-r11";
export const SCHEMA_VERSION = "1.0.0";

const SET_KEYS = new Set(["allowed_tools", "allowAgents", "allowed_stacks"]);

function normalize(value, key = "") {
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number") {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
      throw new TypeError("Canonical contracts allow integers only");
    }
    return value;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalize(item));
    return SET_KEYS.has(key)
      ? [...items].sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        )
      : items;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, normalize(value[field], field)]),
    );
  }
  if (value === null || typeof value === "boolean") return value;
  throw new TypeError("Unsupported canonical value");
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
  origin,
  origin_principal_ref,
  origin_message_id,
}) {
  return canonicalHash("zink-task-id-v1", {
    origin,
    origin_principal_ref,
    origin_message_id: String(origin_message_id),
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
    .update(`discord-principal-v1\0${String(rawDiscordId)}`, "utf8")
    .digest("hex");
}

export function utcNow() {
  return new Date().toISOString().replace(".000Z", "Z");
}
