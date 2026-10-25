/**
 * Read-only self-quota telemetry + runtime model resolution.
 *
 * This module is NOT a quota service. It performs no network I/O, no polling,
 * no repository scan and no persistence. It consumes a usage snapshot that the
 * host runtime already owns (the canonical provider-usage seam) and derives a
 * bounded, agent-scoped decision.
 *
 * Hard invariants:
 * - Self-only. A snapshot is keyed by the canonical agent identity that
 *   produced it. There is no read path that returns another agent's telemetry.
 * - Read-only. Nothing in this module writes session state, model overrides or
 *   any persisted artifact. The only mutable state is a process-local
 *   hysteresis latch used to avoid oscillation.
 * - No fake quota. A snapshot that is absent, malformed, out of range or from
 *   an unknown agent is NOT quota evidence. It yields status "unknown" and the
 *   resolver keeps PRIMARY.
 * - Stale telemetry is uncertainty, not evidence of exhaustion. Stale also
 *   yields PRIMARY. Real provider failures still take the native reactive
 *   failover path; this module never disables it.
 * - One common policy for all seven agents. No per-agent thresholds.
 */

import { AGENT_IDS, MODEL_ALLOWLIST } from "./policy.mjs";

/** Proactive fallback when fresh remaining quota is <= this percentage. */
export const QUOTA_FALLBACK_THRESHOLD_PCT = 20;
/** Return to primary when fresh remaining quota is >= this percentage. */
export const QUOTA_RECOVERY_THRESHOLD_PCT = 30;
/** Single canonical freshness window for provider usage snapshots. */
export const QUOTA_FRESHNESS_MS = 60000;

export const QUOTA_STATUS = Object.freeze({
  FRESH: "fresh",
  STALE: "stale",
  UNKNOWN: "unknown",
});

export const RESOLUTION_REASON = Object.freeze({
  PRIMARY_OK: "PRIMARY_OK",
  PROACTIVE_FALLBACK: "PROACTIVE_FALLBACK",
  STALE_KEEP_PRIMARY: "STALE_KEEP_PRIMARY",
  UNKNOWN_KEEP_PRIMARY: "UNKNOWN_KEEP_PRIMARY",
  HYSTERESIS_HOLD_FALLBACK: "HYSTERESIS_HOLD_FALLBACK",
  RECOVERED_PRIMARY: "RECOVERED_PRIMARY",
  // M10/T2-R9: the governed set holds one entry, so a low-quota reading cannot
  // move the run to a second model. Reported instead of silently staying on the
  // primary under PRIMARY_OK, which would misattribute a real quota signal.
  NO_FALLBACK_AVAILABLE: "NO_FALLBACK_AVAILABLE",
});

const CANONICAL_AGENTS = new Set(AGENT_IDS);

function isFinitePct(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Structural validation for one provider-usage snapshot. Returns the frozen
 * normalized snapshot, or null when the payload is not quota evidence.
 */
export function normalizeQuotaSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const agentId = snapshot.agentId;
  if (typeof agentId !== "string" || !CANONICAL_AGENTS.has(agentId)) {
    return null;
  }
  if (!isFinitePct(snapshot.remainingPct) || snapshot.remainingPct < 0) {
    return null;
  }
  if (snapshot.remainingPct > 100) return null;
  if (typeof snapshot.provider !== "string" || !snapshot.provider.trim()) {
    return null;
  }
  if (typeof snapshot.model !== "string" || !snapshot.model.trim()) {
    return null;
  }
  // `source` must name a canonical provider-usage surface. An unnamed or
  // synthetic source is not quota evidence.
  if (
    typeof snapshot.source !== "string" ||
    !snapshot.source.startsWith("canonical-")
  ) {
    return null;
  }
  if (!isFinitePct(snapshot.observedAt) || snapshot.observedAt <= 0) {
    return null;
  }
  const resetAt =
    typeof snapshot.resetAt === "string" &&
    !Number.isNaN(Date.parse(snapshot.resetAt))
      ? snapshot.resetAt
      : null;
  return Object.freeze({
    agentId,
    provider: snapshot.provider,
    model: snapshot.model,
    remainingPct: snapshot.remainingPct,
    resetAt,
    source: snapshot.source,
    observedAt: snapshot.observedAt,
  });
}

/**
 * Create the process-local telemetry store. O(1) lookups, no I/O.
 */
export function createQuotaTelemetryStore() {
  return {
    snapshots: new Map(),
    latches: new Map(),
  };
}

/**
 * Record one provider-usage snapshot published by the host runtime for the
 * agent that owns it. Invalid payloads are rejected (they never overwrite a
 * previously valid snapshot and never create quota evidence).
 */
export function recordQuotaSnapshot(store, snapshot) {
  const normalized = normalizeQuotaSnapshot(snapshot);
  if (!normalized) return false;
  store.snapshots.set(normalized.agentId, normalized);
  return true;
}

/**
 * Read ONLY the caller's own telemetry. There is no parameter that can widen
 * the result to another agent, and no aggregate is ever produced.
 */
export function readSelfQuotaTelemetry(store, agentId, now = Date.now()) {
  if (typeof agentId !== "string" || !CANONICAL_AGENTS.has(agentId)) {
    return {
      status: QUOTA_STATUS.UNKNOWN,
      agentId: null,
      quota: null,
      health: null,
    };
  }
  const snapshot = store.snapshots.get(agentId);
  if (!snapshot) {
    return { status: QUOTA_STATUS.UNKNOWN, agentId, quota: null, health: null };
  }
  const ageMs = now - snapshot.observedAt;
  if (!isFinitePct(ageMs) || ageMs < 0 || ageMs > QUOTA_FRESHNESS_MS) {
    // Stale is uncertainty, not exhaustion. Report the age so the caller can
    // observe the difference, but never the cross-agent view.
    return { status: QUOTA_STATUS.STALE, agentId, quota: null, health: null };
  }
  return {
    status: QUOTA_STATUS.FRESH,
    agentId,
    quota: {
      provider: snapshot.provider,
      model: snapshot.model,
      remaining_pct: snapshot.remainingPct,
      reset_at: snapshot.resetAt,
      source: snapshot.source,
      observed_at: new Date(snapshot.observedAt).toISOString(),
      age_ms: ageMs,
    },
    health: {
      cooldown: false,
      eligible: true,
    },
  };
}

/**
 * Read-only, self-scoped receipt injected as prompt context. Contains no
 * credential material, no auth profile list and no session identifiers.
 */
export function buildSelfQuotaReceipt(store, agentId, now = Date.now()) {
  const telemetry = readSelfQuotaTelemetry(store, agentId, now);
  return {
    quota_self_read: {
      scope: "self",
      agent_id: agentId,
      status: telemetry.status,
      quota: telemetry.quota,
      health: telemetry.health,
      policy: {
        fallback_threshold_pct: QUOTA_FALLBACK_THRESHOLD_PCT,
        recovery_threshold_pct: QUOTA_RECOVERY_THRESHOLD_PCT,
        freshness_ms: QUOTA_FRESHNESS_MS,
        stale_or_unknown: "KEEP_PRIMARY",
      },
    },
  };
}

/**
 * Resolve the model for the CURRENT RUN.
 *
 * Pure with respect to every persisted artifact: this performs no write to
 * session state, ledger, queue or configuration. The only state transition is
 * a process-local hysteresis latch, documented as ephemeral.
 */
export function resolveRuntimeModel({
  store,
  agentId,
  now = Date.now(),
  // The governed set is the owner's ordered five-model chain (M10/T2-R12), so
  // the fallback branch below IS reachable in production: index 1 is the first
  // fallback the host steps down to when the primary fails or the quota runs
  // low. `allowlist` exists so a caller can resolve against a different
  // governed set; production callers pass nothing and get MODEL_ALLOWLIST.
  allowlist = MODEL_ALLOWLIST,
}) {
  if (typeof agentId !== "string" || !CANONICAL_AGENTS.has(agentId)) {
    throw new Error("UNKNOWN_AGENT");
  }
  const primary = allowlist[0];
  const fallback = allowlist[1];
  // A primary is mandatory; a fallback is not. The governed set is the owner's
  // ordered five-model chain (M10/T2-R12), so a fallback exists in production
  // and the resolver steps down to index 1 when the primary fails or the quota
  // runs low. With no fallback at all the resolver stays on the primary and
  // reports NO_FALLBACK_AVAILABLE, which is the honest verdict: there is no
  // second governed model to move to.
  if (!primary) throw new Error("MODEL_ALLOWLIST_UNAVAILABLE");

  const latch = store.latches.get(agentId) ?? "primary";
  const telemetry = readSelfQuotaTelemetry(store, agentId, now);

  let chosen = primary;
  let reason = RESOLUTION_REASON.PRIMARY_OK;

  if (telemetry.status === QUOTA_STATUS.STALE) {
    chosen = primary;
    reason = RESOLUTION_REASON.STALE_KEEP_PRIMARY;
  } else if (telemetry.status === QUOTA_STATUS.UNKNOWN) {
    chosen = primary;
    reason = RESOLUTION_REASON.UNKNOWN_KEEP_PRIMARY;
  } else {
    const remaining = telemetry.quota.remaining_pct;
    if (!fallback) {
      // NO_FALLBACK_AVAILABLE must mean "quota is low AND there is nowhere to
      // go". Reporting it for a healthy quota would misstate a working run, so a
      // reading above the threshold stays PRIMARY_OK.
      reason =
        remaining <= QUOTA_FALLBACK_THRESHOLD_PCT
          ? RESOLUTION_REASON.NO_FALLBACK_AVAILABLE
          : RESOLUTION_REASON.PRIMARY_OK;
    } else if (latch === "fallback") {
      if (remaining >= QUOTA_RECOVERY_THRESHOLD_PCT) {
        chosen = primary;
        reason = RESOLUTION_REASON.RECOVERED_PRIMARY;
      } else {
        chosen = fallback;
        reason = RESOLUTION_REASON.HYSTERESIS_HOLD_FALLBACK;
      }
    } else if (remaining <= QUOTA_FALLBACK_THRESHOLD_PCT) {
      chosen = fallback;
      reason = RESOLUTION_REASON.PROACTIVE_FALLBACK;
    }
  }

  // F-403: the latch records what FRESH evidence said, so only a fresh read
  // rewrites it. A STALE or UNKNOWN read falls back to the primary model
  // because there is no evidence to step down on, but it is still no evidence:
  // writing "primary" here let the same durable data, read one freshness window
  // later, erase the fallback hold the latch exists to keep.
  const fresh =
    telemetry.status !== QUOTA_STATUS.STALE &&
    telemetry.status !== QUOTA_STATUS.UNKNOWN;
  let nextLatch = latch;
  if (fresh) {
    nextLatch = fallback && chosen === fallback ? "fallback" : "primary";
    store.latches.set(agentId, nextLatch);
  }

  // Model selection can never escape the canonical allowlist.
  //
  // M12/T9 F-206: this guard is REACHABLE, not dead. The resolver reads only
  // `allowlist[0]` and `allowlist[1]`, so with a real array the membership
  // test cannot fail - which is why `tests/m7-t2-quota-telemetry.test.mjs`
  // TEST M asserts the reachable invariant (the resolver consults only the
  // first two entries) instead of re-asserting a tautology, and TEST M3
  // exercises this guard through an allowlist whose own membership test
  // disagrees with its contents. Removing the guard turns TEST M3 red.
  if (!allowlist.includes(chosen)) {
    throw new Error("MODEL_ALLOWLIST_VIOLATION");
  }
  return {
    model: chosen,
    reason,
    run_scoped: true,
    session_override: false,
    latch: nextLatch,
  };
}
