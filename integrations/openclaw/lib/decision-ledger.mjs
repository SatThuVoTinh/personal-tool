import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
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

export class DecisionLedger {
  constructor({ storagePath = resolveDefaultStoragePath() } = {}) {
    this.storagePath = storagePath;
    this.decisions = new Map();
    this.load();
  }

  load() {
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf8");
        const entries = JSON.parse(raw);
        if (Array.isArray(entries)) {
          for (const d of entries) {
            this.decisions.set(d.decisionId, d);
          }
        }
      }
    } catch (err) {
      console.error("[decision-ledger] Failed to load ledger:", err?.message);
    }
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.decisions.values());
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.error("[decision-ledger] Failed to save ledger:", err?.message);
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
    if (!confirmedBy) {
      throw new Error(
        "HUMAN_CONFIRMATION_REQUIRED: Agents cannot author decisions without user confirmation",
      );
    }

    const id =
      decisionId ||
      `dec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record = {
      decisionId: id,
      topic: topic.toUpperCase().trim(),
      question: question || "",
      decision: decision.trim(),
      scope: scope.toLowerCase().trim(),
      confirmedBy,
      confirmedAt: new Date().toISOString(),
      context,
      tags: tags.map((t) => String(t).toLowerCase()),
    };

    this.decisions.set(id, record);
    this.save();
    return record;
  }

  /**
   * Finds relevant prior decisions to avoid redundant questions to the user.
   */
  queryDecisions({ topic, query = "", scope = null } = {}) {
    const normTopic = topic ? topic.toUpperCase().trim() : null;
    const queryLower = query ? query.toLowerCase().trim() : null;
    const results = [];

    for (const d of this.decisions.values()) {
      if (normTopic && d.topic !== normTopic) continue;
      if (scope && d.scope !== scope.toLowerCase().trim()) continue;

      if (queryLower) {
        const text =
          `${d.topic} ${d.question} ${d.decision} ${d.tags.join(" ")}`.toLowerCase();
        if (!text.includes(queryLower)) continue;
      }

      results.push(d);
    }

    return results;
  }

  /**
   * Checks if an authoritative prior decision exists for the given topic / keyword.
   */
  hasDecision(topic, query = "") {
    const matches = this.queryDecisions({ topic, query });
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
