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
      `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
      if (canonicalRecordBytes(existing) === canonicalRecordBytes(record)) {
        return existing;
      }
      failLedger("DECISION_ID_CONFLICT");
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
