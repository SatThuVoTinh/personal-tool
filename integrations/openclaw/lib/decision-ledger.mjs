import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

/**
 * Governed Decision Ledger
 * Implements ACTIVE.md Sections 18, 19, 20:
 * - Stores user-confirmed decisions with explicit scope and context.
 * - Queried by Main, O1, and O2 before asking the user for clarification.
 * - Strictly prevents generalizing decisions beyond their approved scope.
 * - Enforces Human Semantic Authority: AI agents may propose, but only user confirmation persists.
 */

function resolveDefaultStoragePath() {
  const dir = path.join(os.homedir(), ".openclaw-zink");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return path.join(dir, "decision-ledger.json");
}

const DECISION_SCOPES = Object.freeze(["global", "domain", "task-specific"]);

// Governed teaching classifications. A candidate must carry exactly one.
// Anything else — including an explicit "ambiguous" — fails closed and
// persists nothing: the owner must classify before memory may form.
export const MEMORY_CLASSIFICATIONS = Object.freeze([
  "preference-decision",
  "reusable-procedure",
  "factual-knowledge",
  "operational-state",
]);

/**
 * Builds an untrusted decision candidate. Pure: persists nothing.
 * Only `preference-decision` candidates may later be confirmed into the
 * ledger; every other classification routes elsewhere and never lands here.
 */
export function buildDecisionCandidate({
  topic,
  question,
  proposedDecision,
  scope = "global",
  taskId = null,
  domain = null,
  context = {},
  classification,
}) {
  if (!MEMORY_CLASSIFICATIONS.includes(classification)) {
    failLedger("DECISION_CANDIDATE_AMBIGUOUS");
  }
  if (typeof topic !== "string" || !topic.trim()) {
    failLedger("DECISION_CANDIDATE_INVALID");
  }
  if (typeof proposedDecision !== "string" || !proposedDecision.trim()) {
    failLedger("DECISION_CANDIDATE_INVALID");
  }
  const normalizedScope = String(scope ?? "global")
    .toLowerCase()
    .trim();
  if (!DECISION_SCOPES.includes(normalizedScope)) {
    failLedger("DECISION_SCOPE_INVALID");
  }
  if (normalizedScope === "task-specific" && !taskId) {
    failLedger("DECISION_TASK_IDENTITY_REQUIRED");
  }
  if (normalizedScope === "domain" && !domain) {
    failLedger("DECISION_DOMAIN_REQUIRED");
  }
  const candidateKey = canonicalDecisionKey({
    topic,
    question: question ?? "",
    scope: normalizedScope,
    taskId,
    domain,
  });
  return {
    candidate_key: candidateKey,
    topic: String(topic).toUpperCase().trim(),
    question: question ?? "",
    proposed_decision: String(proposedDecision).trim(),
    scope: normalizedScope,
    task_id: normalizedScope === "task-specific" ? taskId : null,
    domain: normalizedScope === "domain" ? String(domain) : null,
    context,
    classification,
    created_at: new Date().toISOString(),
  };
}

// M7-034: only principals in verified-identity shape are recorded — a raw
// Discord snowflake or a derived 64-hex principal digest. Arbitrary display
// names can never be stored as the "verified user".
const SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/u;
const PRINCIPAL_DIGEST_RE = /^[a-f0-9]{64}$/u;

export function isVerifiedPrincipalRef(value) {
  return (
    typeof value === "string" &&
    (SNOWFLAKE_RE.test(value) || PRINCIPAL_DIGEST_RE.test(value))
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
}

// M7-036: canonical governed semantic key — exact, never substring.
export function canonicalDecisionKey({
  topic,
  question,
  scope,
  taskId,
  domain,
}) {
  const normalizedScope = String(scope ?? "global")
    .toLowerCase()
    .trim();
  return createHash("sha256")
    .update(
      [
        "zink-decision-v1",
        String(topic ?? "")
          .toUpperCase()
          .trim(),
        normalizeText(question ?? ""),
        normalizedScope,
        normalizedScope === "task-specific" ? String(taskId ?? "") : "",
        normalizedScope === "domain" ? normalizeText(domain ?? "") : "",
      ].join("\0"),
      "utf8",
    )
    .digest("hex");
}

function recordKey(record) {
  const ctx = record?.context ?? {};
  return canonicalDecisionKey({
    topic: record?.topic,
    question: record?.question,
    scope: record?.scope,
    taskId: ctx.taskId ?? ctx.task_id ?? null,
    domain: ctx.domain ?? null,
  });
}

function failLedger(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function validateDecisionRecord(d) {
  if (!d || typeof d !== "object") return false;
  if (typeof d.decisionId !== "string" || !d.decisionId) return false;
  if (typeof d.topic !== "string" || !d.topic) return false;
  if (typeof d.decision !== "string" || !d.decision) return false;
  if (typeof d.confirmedBy !== "string" || !d.confirmedBy) return false;
  if (typeof d.scope !== "string") return false;
  if (!DECISION_SCOPES.includes(d.scope)) return false;
  if (d.scope === "task-specific") {
    const ctx = d.context ?? {};
    if (typeof ctx.taskId !== "string" && typeof ctx.task_id !== "string")
      return false;
  }
  return true;
}

function canonicalRecordBytes(record) {
  return JSON.stringify({
    decisionId: record.decisionId,
    topic: record.topic,
    question: record.question ?? "",
    decision: record.decision,
    scope: record.scope,
    confirmedBy: record.confirmedBy,
    context: record.context ?? {},
    tags: record.tags ?? [],
  });
}

export class DecisionLedger {
  constructor({ storagePath = resolveDefaultStoragePath() } = {}) {
    this.storagePath = storagePath;
    this.decisions = new Map();
    this.corrupt = false;
    this.loadError = null;
    this.load();
  }

  assertUsable() {
    if (this.corrupt) failLedger("LEDGER_CORRUPT");
  }

  load() {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf8");
        const entries = JSON.parse(raw);
        if (!Array.isArray(entries)) {
          this.corrupt = true;
          this.loadError = "LEDGER_SCHEMA_INVALID";
          return;
        }
        for (const d of entries) {
          if (!validateDecisionRecord(d)) {
            this.corrupt = true;
            this.loadError = "LEDGER_SCHEMA_INVALID";
            return;
          }
          this.decisions.set(d.decisionId, d);
        }
      }
    } catch (err) {
      this.corrupt = true;
      this.loadError = err?.code ?? "LEDGER_CORRUPT";
    }
  }

  save() {
    const dir = path.dirname(this.storagePath);
    const tempPath = `${this.storagePath}.tmp-${process.pid}-${Date.now()}`;
    let fd = null;
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.decisions.values());
      fd = openSync(tempPath, "w", 0o600);
      writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, this.storagePath);
    } catch (err) {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* preserve original failure */
        }
      }
      failLedger(`LEDGER_WRITE_FAILED: ${err?.message}`);
    }
  }

  /**
   * Records a user-confirmed decision.
   * Requires confirmedBy (user snowflake / identity).
   *
   * Only trusted governance code may call this, after an explicit owner
   * confirmation has passed the authority gate. Observed answers and
   * behavior are operational evidence, never implicit input here.
   *
   * Identity is deterministic: without an explicit decisionId, the id
   * derives from the governed question key, so confirming the same teaching
   * twice is idempotent, while a different decision for the same governed
   * question is a fail-closed conflict.
   */
  recordDecision({
    decisionId,
    topic, // e.g. "LSCM", "TAXONOMY", "SEMANTIC_MERGE"
    question,
    decision, // exact decision text
    scope = "global", // e.g. "task-specific", "domain", "global"
    confirmedBy, // Must be verified user
    context = {},
    tags = [],
  }) {
    if (!topic || !decision) {
      throw new Error("TOPIC_AND_DECISION_REQUIRED");
    }
    // M7-034: only a verified-identity principal may author a decision.
    if (!isVerifiedPrincipalRef(confirmedBy)) {
      throw new Error(
        "HUMAN_CONFIRMATION_REQUIRED: Agents cannot author decisions without a verified user principal",
      );
    }
    this.assertUsable();
    const normalizedScope = String(scope).toLowerCase().trim();
    if (!DECISION_SCOPES.includes(normalizedScope)) {
      throw new Error(`DECISION_SCOPE_INVALID: ${scope}`);
    }
    if (normalizedScope === "task-specific") {
      const ctx = context ?? {};
      if (typeof ctx.taskId !== "string" && typeof ctx.task_id !== "string") {
        throw new Error("DECISION_TASK_IDENTITY_REQUIRED");
      }
    }

    const id =
      decisionId ||
      `dec-${canonicalDecisionKey({
        topic,
        question: question || "",
        scope: normalizedScope,
        taskId:
          normalizedScope === "task-specific"
            ? (context?.taskId ?? context?.task_id ?? null)
            : null,
        domain: normalizedScope === "domain" ? (context?.domain ?? null) : null,
      }).slice(0, 16)}`;
    const record = {
      decisionId: id,
      topic: topic.toUpperCase().trim(),
      question: question || "",
      decision: decision.trim(),
      scope: normalizedScope,
      confirmedBy,
      confirmedAt: new Date().toISOString(),
      context,
      tags: tags.map((t) => String(t).toLowerCase()),
    };

    const existing = this.decisions.get(id);
    if (existing) {
      // Same governed identity with a different decision is a conflict:
      // the owner must resolve it explicitly, never silently overwrite.
      const key = canonicalDecisionKey({
        topic: record.topic,
        question: record.question,
        scope: record.scope,
        taskId: context?.taskId ?? context?.task_id ?? null,
        domain: context?.domain ?? null,
      });
      if (recordKey(existing) !== key) {
        failLedger("DECISION_ID_CONFLICT");
      }
      if (!existing.superseded) {
        if (canonicalRecordBytes(existing) === canonicalRecordBytes(record)) {
          return existing;
        }
        failLedger("DECISION_ID_CONFLICT");
      }
      // This governed identity was corrected: the deterministic id now
      // belongs to the chain, so answer against the chain's AUTHORITATIVE
      // record. Replaying the current decision stays idempotent, while
      // re-asserting the superseded value fails closed and must go through
      // the explicit correction path.
      const authoritative = Array.from(this.decisions.values()).find(
        (d) => !d.superseded && recordKey(d) === key,
      );
      if (
        authoritative &&
        authoritative.decision === record.decision &&
        authoritative.scope === record.scope
      ) {
        return authoritative;
      }
      failLedger("DECISION_SUPERSEDED_CORRECTION_REQUIRED");
    }
    this.decisions.set(id, record);
    try {
      this.save();
    } catch (err) {
      this.decisions.delete(id);
      if (existing) this.decisions.set(id, existing);
      throw err;
    }
    return record;
  }

  /**
   * Explicit owner correction of an existing decision. The old record is
   * superseded (kept as audit history, excluded from all applicable
   * lookups) and exactly one new authoritative record takes its place,
   * so two contradictory active decisions for one scope can never coexist.
   * Raw `recordDecision` stays fail-closed on conflict; only this path,
   * driven by an explicit owner correction, may supersede.
   */
  correctDecision({
    topic,
    question,
    decision,
    scope = "global",
    confirmedBy,
    context = {},
    tags = [],
  }) {
    if (!topic || !decision) {
      throw new Error("TOPIC_AND_DECISION_REQUIRED");
    }
    if (!isVerifiedPrincipalRef(confirmedBy)) {
      throw new Error(
        "HUMAN_CONFIRMATION_REQUIRED: Agents cannot author decisions without a verified user principal",
      );
    }
    this.assertUsable();
    const normalizedScope = String(scope).toLowerCase().trim();
    if (!DECISION_SCOPES.includes(normalizedScope)) {
      throw new Error(`DECISION_SCOPE_INVALID: ${scope}`);
    }
    const key = canonicalDecisionKey({
      topic,
      question: question || "",
      scope: normalizedScope,
      taskId:
        normalizedScope === "task-specific"
          ? (context?.taskId ?? context?.task_id ?? null)
          : null,
      domain: normalizedScope === "domain" ? (context?.domain ?? null) : null,
    });
    const chain = Array.from(this.decisions.values()).filter(
      (d) => recordKey(d) === key,
    );
    const active = chain.find((d) => !d.superseded) ?? null;
    if (!active) {
      failLedger("DECISION_NOT_FOUND");
    }
    if (
      active.decision === String(decision).trim() &&
      active.scope === normalizedScope
    ) {
      return active;
    }
    const now = new Date().toISOString();
    const successorId = `dec-${key.slice(0, 12)}-s${chain.length + 1}`;
    if (this.decisions.has(successorId)) {
      failLedger("DECISION_ID_CONFLICT");
    }
    const successor = {
      decisionId: successorId,
      topic: String(topic).toUpperCase().trim(),
      question: question || "",
      decision: String(decision).trim(),
      scope: normalizedScope,
      confirmedBy,
      confirmedAt: now,
      context,
      tags: tags.map((t) => String(t).toLowerCase()),
      supersedes: active.decisionId,
    };
    const supersededActive = {
      ...active,
      superseded: true,
      superseded_by: successorId,
      superseded_at: now,
    };
    this.decisions.set(active.decisionId, supersededActive);
    this.decisions.set(successorId, successor);
    try {
      this.save();
    } catch (err) {
      this.decisions.set(active.decisionId, active);
      this.decisions.delete(successorId);
      throw err;
    }
    return successor;
  }

  /**
   * Finds relevant prior decisions to avoid redundant questions to the user.
   * M7-035: lookup always carries explicit scope/task/domain context with
   * containment — a task-specific decision never satisfies another task, a
   * domain decision only satisfies its domain, a global decision matches all.
   * M7-036: matching is exact (canonical key or normalized exact text),
   * never raw substring generalization.
   */
  queryDecisions({
    topic,
    query = "",
    scope = null,
    taskId = null,
    domain = null,
    key = null,
  } = {}) {
    this.assertUsable();
    const normTopic = topic ? topic.toUpperCase().trim() : null;
    const normScope = scope ? String(scope).toLowerCase().trim() : null;
    const normQuery = normalizeText(query);
    const results = [];

    for (const d of this.decisions.values()) {
      // Superseded records are audit history, never applicable answers.
      // Fresh lookups therefore see only the authoritative decision.
      if (d.superseded) continue;
      if (normTopic && d.topic !== normTopic) continue;
      if (normScope && d.scope !== normScope) continue;

      // M7-035 containment: narrow decisions never leak outward.
      const ctx = d.context ?? {};
      if (d.scope === "task-specific") {
        const owner = ctx.taskId ?? ctx.task_id ?? null;
        if (owner === null || owner !== taskId) continue;
      } else if (d.scope === "domain") {
        if (
          domain === null ||
          normalizeText(ctx.domain) !== normalizeText(domain)
        )
          continue;
      }

      if (key) {
        if (recordKey(d) !== key) continue;
      } else if (normQuery) {
        const exactHit =
          normalizeText(d.question) === normQuery ||
          normalizeText(d.decision) === normQuery ||
          normalizeText(d.topic) === normQuery ||
          recordKey(d) ===
            canonicalDecisionKey({
              topic: d.topic,
              question: normQuery,
              scope: d.scope,
              taskId,
              domain,
            });
        if (!exactHit) continue;
      }

      results.push(d);
    }

    return results;
  }

  /**
   * Exact lookup of one prior decision by its canonical governed key.
   */
  lookupDecision({
    topic,
    question,
    scope = "global",
    taskId = null,
    domain = null,
  }) {
    this.assertUsable();
    const key = canonicalDecisionKey({
      topic,
      question,
      scope,
      taskId,
      domain,
    });
    const matches = this.queryDecisions({
      topic,
      scope,
      taskId,
      domain,
      key,
    });
    return matches.length > 0 ? matches[0] : null;
  }

  /**
   * M7-017: governed pre-clarification lookup. Returns { ask: false,
   * decision } when a prior decision already covers the question, { ask: true }
   * otherwise. A corrupt/unreadable ledger fails closed (throws) instead of
   * acting as if no decision exists.
   */
  shouldClarify({
    topic,
    question,
    scope = "global",
    taskId = null,
    domain = null,
  }) {
    this.assertUsable();
    const prior = this.lookupDecision({
      topic,
      question,
      scope,
      taskId,
      domain,
    });
    if (prior) return { ask: false, decision: prior };
    return { ask: true, decision: null };
  }

  /**
   * Checks if an authoritative prior decision exists for the given topic /
   * question under explicit scope context (M7-035/M7-036). The query must be
   * the exact governed question (or decision text) — near-collision terms
   * and same-topic different-question queries never match.
   */
  hasDecision(
    topic,
    query = "",
    { scope = null, taskId = null, domain = null } = {},
  ) {
    const matches = this.queryDecisions({
      topic,
      query,
      scope,
      taskId,
      domain,
    });
    return matches.length > 0;
  }

  getDecision(decisionId) {
    return this.decisions.get(decisionId) || null;
  }

  listAll() {
    return Array.from(this.decisions.values());
  }

  clear() {
    this.decisions.clear();
    this.save();
  }
}

export const defaultDecisionLedger = new DecisionLedger();
