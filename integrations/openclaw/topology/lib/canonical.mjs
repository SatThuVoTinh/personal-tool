import { createHash, createHmac } from "node:crypto";

// The governance version doubles as the WRITER-SEMANTICS discriminator, so it
// must only ever be bumped when the reducer's meaning for an already-emitted
// event is unchanged. m8-t2.2-r4 is deliberately NOT a unique discriminator:
// two different writers emitted it, one resolving a root result directly to its
// outcome (pre-verdict) and one routing it to owner review (verdict). It is
// therefore retained forever and handled by the compatibility path, never
// treated as evidence of verdict semantics. m8-t2.3-r5 is the first version
// whose semantics are unambiguous: only the verdict-model writer emits it.
export const GOVERNANCE_VERSION = "m8-t2.3-r5";
export const SCHEMA_VERSION = "1.0.0";

const SET_KEYS = new Set(["allowed_tools", "allowAgents", "allowed_stacks"]);

// M10/T2-R12: the human-facing task code (owner decision 2026-10-08).
//
// The owner reads and types this code to approve work by text, so the alphabet
// deliberately omits every character that is confusable when transcribed or read
// aloud: no `0`/`O`, no `1`/`I`/`L`, no `5`/`S`, no `2`/`Z`, no `8`/`B`, no
// `6`/`G`, no `4`/`A`. That leaves 18 letters (C D E F H J K M N P Q R T U V W
// X Y) and 3 digits (3 7 9) = 21 symbols.
//
// Format: 8 date characters (YYYYMMDD) + 4 random characters = 12.
//
// The code is a DISPLAY ALIAS, never an identity. The canonical 64-hex
// `task_id` stays the ledger key and stays inside the button `custom_id`, because
// a 4-character code over 21 symbols has far too little entropy to be an
// authority token: 21^4 is under 195k, so it must never be trusted to prove
// which task is being approved. That is why uniqueness is enforced at generation.
export const TASK_CODE_ALPHABET = "CDEFHJKMNPQRTUVWXY379";
export const TASK_CODE_LENGTH = 12;
export const TASK_CODE_DATE_LENGTH = 8;
export const TASK_CODE_SUFFIX_LENGTH = 4;
export const TASK_CODE_PATTERN = "^[0-9]{8}[CDEFHJKMNPQRTUVWXY379]{4}$";

/**
 * Build one task code. `random` is an injected byte source so the generator is
 * testable and never depends on ambient randomness in a governance path.
 */
export function buildTaskCode({ date, random }) {
  const datePart = normalizeTaskCodeDate(date);
  let suffix = "";
  for (let index = 0; index < TASK_CODE_SUFFIX_LENGTH; index++) {
    if (typeof random !== "function") {
      throw new TypeError("TASK_CODE_RANDOM_REQUIRED");
    }
    const pick = random(index);
    if (
      typeof pick !== "number" ||
      !Number.isInteger(pick) ||
      pick < 0 ||
      pick >= TASK_CODE_ALPHABET.length
    ) {
      throw new RangeError(`TASK_CODE_RANDOM_OUT_OF_RANGE:${pick}`);
    }
    suffix += TASK_CODE_ALPHABET[pick];
  }
  const code = datePart + suffix;
  if (code.length !== TASK_CODE_LENGTH) {
    throw new Error(`TASK_CODE_LENGTH:${code.length}`);
  }
  return code;
}

export function normalizeTaskCodeDate(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime()))
      throw new RangeError("TASK_CODE_DATE_INVALID");
    const year = String(date.getUTCFullYear()).padStart(4, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }
  if (typeof date === "string" && /^[0-9]{8}$/u.test(date)) return date;
  throw new RangeError("TASK_CODE_DATE_INVALID");
}

/**
 * Generate a code that is not already taken. `isTaken` is consulted for every
 * candidate so a collision can never produce two tasks sharing one code, and the
 * attempt count is bounded so a caller cannot spin forever on a hostile
 * predicate.
 */
export function buildUniqueTaskCode({
  date,
  random,
  isTaken,
  maxAttempts = 32,
}) {
  if (typeof isTaken !== "function") {
    throw new TypeError("TASK_CODE_IS_TAKEN_REQUIRED");
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError("TASK_CODE_MAX_ATTEMPTS_INVALID");
  }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = buildTaskCode({
      date,
      random: (index) => random(index, attempt),
    });
    if (!isTaken(code)) return code;
  }
  throw new Error("TASK_CODE_COLLISION_EXHAUSTED");
}

/**
 * M12/T1-R1 — the owner's instruction made this 12-character form the task
 * IDENTITY, not a display alias: "task ID anh muốn identity vẫn là 12 kí tự thay vì
 * 64 hex, để vậy cho đồng bộ." Two consequences are pinned by tests rather than by
 * comment: the identity is no longer a function of the origin message, so replay
 * detection reads the recorded binding (`findTaskByOriginBinding`); and every
 * pre-existing 64-hex record must keep loading, so readers accept both shapes
 * through TASK_ID_PATTERN while only this shape is ever minted.
 *
 * The date part is ordered ddmmyyyy as the owner described. Codes minted before this
 * task by the display-alias generator read yyyymmdd; both are eight digits, both are
 * accepted on read, and neither is authority on its own — the snapshot key is.
 */
export const TASK_ID_PATTERN =
  "^([0-9a-f]{64}|[0-9]{8}[CDEFHJKMNPQRTUVWXY379]{4})$";

export function isTaskCodeForm(value) {
  return (
    typeof value === "string" &&
    new RegExp(TASK_CODE_PATTERN, "u").test(value) === true
  );
}

export function formatTaskIdentityDate(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime()))
      throw new RangeError("TASK_CODE_DATE_INVALID");
    const year = String(date.getUTCFullYear()).padStart(4, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${day}${month}${year}`;
  }
  if (typeof date === "string" && /^[0-9]{8}$/u.test(date)) return date;
  throw new RangeError("TASK_CODE_DATE_INVALID");
}

/**
 * Mint a governed task identity. `isTaken` is mandatory: uniqueness is now a
 * property of the identity itself, so it is checked against every live task id and
 * every recorded code before the id leaves this function, and exhaustion fails
 * closed instead of issuing a second task under a shared identity.
 */
export function mintTaskId({
  date = new Date(),
  random,
  isTaken,
  maxAttempts = 32,
}) {
  if (typeof isTaken !== "function") {
    throw new TypeError("TASK_ID_IS_TAKEN_REQUIRED");
  }
  return buildUniqueTaskCode({
    date: formatTaskIdentityDate(date),
    random,
    isTaken,
    maxAttempts,
  });
}

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

/**
 * M12/T1-R1: this is no longer the identity mint. It stays exported and stays the
 * authoritative derivation for the 64-hex ids already written into the live ledger
 * (the reducer re-derives those to prove a legacy record was not tampered with), and
 * it remains the origin-binding digest a new task can be traced back through.
 */
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
