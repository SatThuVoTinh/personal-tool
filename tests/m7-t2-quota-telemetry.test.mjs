import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createQuotaTelemetryStore,
  recordQuotaSnapshot,
  readSelfQuotaTelemetry,
  buildSelfQuotaReceipt,
  resolveRuntimeModel,
  normalizeQuotaSnapshot,
  QUOTA_FALLBACK_THRESHOLD_PCT,
  QUOTA_RECOVERY_THRESHOLD_PCT,
  QUOTA_FRESHNESS_MS,
  QUOTA_STATUS,
  RESOLUTION_REASON,
} from "../integrations/openclaw/lib/quota-telemetry.mjs";
import {
  AGENT_IDS,
  MODEL_ALLOWLIST,
} from "../integrations/openclaw/lib/policy.mjs";

const AGENTS = [...AGENT_IDS];
const T0 = 1_800_000_000_000;

function snapshot(agentId, remainingPct, observedAt = T0) {
  return {
    agentId,
    provider: "google",
    model: MODEL_ALLOWLIST[0],
    remainingPct,
    resetAt: new Date(T0 + 3_600_000).toISOString(),
    source: "canonical-provider-usage",
    observedAt,
  };
}

describe("T2 — self-quota telemetry isolation", () => {
  it("TEST A/I: each agent reads only its own quota", () => {
    for (const agentId of AGENTS) {
      const store = createQuotaTelemetryStore();
      // Publish quota for EVERY agent, all with distinct values.
      AGENTS.forEach((id, index) => {
        assert.equal(
          recordQuotaSnapshot(store, snapshot(id, 50 + index)),
          true,
        );
      });
      const receipt = buildSelfQuotaReceipt(store, agentId, T0);
      assert.equal(receipt.quota_self_read.agent_id, agentId);
      assert.equal(
        receipt.quota_self_read.quota.remaining_pct,
        50 + AGENTS.indexOf(agentId),
      );
      // No other agent's number appears anywhere in the receipt.
      const serialized = JSON.stringify(receipt);
      AGENTS.filter((id) => id !== agentId).forEach((other) => {
        const otherValue = 50 + AGENTS.indexOf(other);
        assert.equal(
          serialized.includes(`"${otherValue}"`),
          false,
          `${agentId} receipt must not leak ${other} quota`,
        );
      });
      // No aggregate, no profile list, no credential material.
      for (const forbidden of [
        "profiles",
        "apiKey",
        "api_key",
        "token",
        "auth",
        "aggregate",
        "order",
        "sessions",
      ]) {
        assert.equal(
          serialized.toLowerCase().includes(forbidden.toLowerCase()),
          false,
          `receipt must not contain ${forbidden}`,
        );
      }
    }
  });

  it("TEST I: unknown agent identity yields no telemetry at all", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 90));
    for (const fake of ["root", "admin", "", null, undefined, "O1", "o1 "]) {
      const receipt = readSelfQuotaTelemetry(store, fake, T0);
      assert.equal(
        receipt.status,
        QUOTA_STATUS.UNKNOWN,
        `deny ${String(fake)}`,
      );
      assert.equal(receipt.quota, null);
    }
  });

  it("cross-agent snapshot publication is rejected", () => {
    const store = createQuotaTelemetryStore();
    // A payload claiming to be another agent's quota is not accepted as
    // evidence for the caller's identity; only exact-key snapshots apply.
    assert.equal(recordQuotaSnapshot(store, snapshot("root", 99)), false);
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0).status,
      QUOTA_STATUS.UNKNOWN,
    );
    // An agentId field that does not match the routing key cannot be smuggled.
    const forged = { ...snapshot("o1", 10), agentId: "o2" };
    assert.equal(recordQuotaSnapshot(store, forged), true);
    // It lands under o2, not o1.
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0).status,
      QUOTA_STATUS.UNKNOWN,
    );
    assert.equal(
      readSelfQuotaTelemetry(store, "o2", T0).quota.remaining_pct,
      10,
    );
  });

  it("malformed telemetry never becomes quota evidence", () => {
    const cases = [
      null,
      undefined,
      {},
      { ...snapshot("o1", 10), remainingPct: NaN },
      { ...snapshot("o1", 10), remainingPct: Infinity },
      { ...snapshot("o1", 10), remainingPct: -1 },
      { ...snapshot("o1", 10), remainingPct: 101 },
      { ...snapshot("o1", 10), remainingPct: "10" },
      { ...snapshot("o1", 10), provider: "" },
      { ...snapshot("o1", 10), model: "" },
      { ...snapshot("o1", 10), source: "synthetic" },
      { ...snapshot("o1", 10), source: "" },
      { ...snapshot("o1", 10), observedAt: 0 },
      { ...snapshot("o1", 10), observedAt: "now" },
    ];
    for (const payload of cases) {
      assert.equal(
        normalizeQuotaSnapshot(payload),
        null,
        JSON.stringify(payload),
      );
      const store = createQuotaTelemetryStore();
      assert.equal(recordQuotaSnapshot(store, payload), false);
      assert.equal(
        readSelfQuotaTelemetry(store, "o1", T0).status,
        QUOTA_STATUS.UNKNOWN,
      );
      // TEST D: unknown telemetry must not fabricate a fallback.
      assert.equal(
        resolveRuntimeModel({ store, agentId: "o1", now: T0 }).model,
        MODEL_ALLOWLIST[0],
      );
    }
  });

  it("stale telemetry keeps PRIMARY and is distinguished from fresh", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 10, T0));
    // Fresh.
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0).status,
      QUOTA_STATUS.FRESH,
    );
    // Boundary: exactly the freshness window is still fresh.
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0 + QUOTA_FRESHNESS_MS).status,
      QUOTA_STATUS.FRESH,
    );
    // Beyond the window: stale.
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0 + QUOTA_FRESHNESS_MS + 1).status,
      QUOTA_STATUS.STALE,
    );
    // A future timestamp is not usable evidence either.
    assert.equal(
      readSelfQuotaTelemetry(store, "o1", T0 - 1).status,
      QUOTA_STATUS.STALE,
    );
  });

  it("one common threshold policy applies to all seven agents", () => {
    const store = createQuotaTelemetryStore();
    for (const agentId of AGENTS) {
      const receipt = buildSelfQuotaReceipt(store, agentId, T0);
      assert.equal(
        receipt.quota_self_read.policy.fallback_threshold_pct,
        QUOTA_FALLBACK_THRESHOLD_PCT,
      );
      assert.equal(
        receipt.quota_self_read.policy.recovery_threshold_pct,
        QUOTA_RECOVERY_THRESHOLD_PCT,
      );
      assert.equal(
        receipt.quota_self_read.policy.stale_or_unknown,
        "KEEP_PRIMARY",
      );
    }
  });
});

describe("T3 — proactive fallback resolution", () => {
  it("TEST B: threshold table", () => {
    const cases = [
      [90, MODEL_ALLOWLIST[0], RESOLUTION_REASON.PRIMARY_OK],
      [30, MODEL_ALLOWLIST[0], RESOLUTION_REASON.PRIMARY_OK],
      [21, MODEL_ALLOWLIST[0], RESOLUTION_REASON.PRIMARY_OK],
      [20, MODEL_ALLOWLIST[1], RESOLUTION_REASON.PROACTIVE_FALLBACK],
      [19, MODEL_ALLOWLIST[1], RESOLUTION_REASON.PROACTIVE_FALLBACK],
      [0, MODEL_ALLOWLIST[1], RESOLUTION_REASON.PROACTIVE_FALLBACK],
    ];
    for (const [pct, expectedModel, expectedReason] of cases) {
      const store = createQuotaTelemetryStore();
      recordQuotaSnapshot(store, snapshot("o1", pct));
      const result = resolveRuntimeModel({ store, agentId: "o1", now: T0 });
      assert.equal(result.model, expectedModel, `${pct}% -> ${expectedModel}`);
      assert.equal(
        result.reason,
        expectedReason,
        `${pct}% -> ${expectedReason}`,
      );
    }
  });

  it("TEST B: fallback needs no primary request failure", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("python", 5));
    // Resolution alone decides; no failed request was ever simulated.
    const result = resolveRuntimeModel({ store, agentId: "python", now: T0 });
    assert.equal(result.model, MODEL_ALLOWLIST[1]);
    assert.equal(result.run_scoped, true);
    assert.equal(result.session_override, false);
  });

  it("TEST C: hysteresis prevents 19-21% oscillation", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 19, T0));
    assert.equal(
      resolveRuntimeModel({ store, agentId: "o1", now: T0 }).model,
      MODEL_ALLOWLIST[1],
      "19% -> fallback",
    );
    // 21% must HOLD fallback (below the 30% recovery threshold).
    recordQuotaSnapshot(store, snapshot("o1", 21, T0 + 1000));
    const held = resolveRuntimeModel({ store, agentId: "o1", now: T0 + 1000 });
    assert.equal(held.model, MODEL_ALLOWLIST[1], "21% holds fallback");
    assert.equal(held.reason, RESOLUTION_REASON.HYSTERESIS_HOLD_FALLBACK);
    // 29% still holds.
    recordQuotaSnapshot(store, snapshot("o1", 29, T0 + 2000));
    const held2 = resolveRuntimeModel({ store, agentId: "o1", now: T0 + 2000 });
    assert.equal(held2.model, MODEL_ALLOWLIST[1], "29% holds fallback");
    // Recovery boundary is inclusive at 30%.
    recordQuotaSnapshot(store, snapshot("o1", 29, T0 + 3000));
    resolveRuntimeModel({ store, agentId: "o1", now: T0 + 3000 });
    recordQuotaSnapshot(store, snapshot("o1", 30, T0 + 4000));
    const recovered = resolveRuntimeModel({
      store,
      agentId: "o1",
      now: T0 + 4000,
    });
    assert.equal(
      recovered.model,
      MODEL_ALLOWLIST[0],
      "30% -> primary (inclusive)",
    );
    assert.equal(recovered.reason, RESOLUTION_REASON.RECOVERED_PRIMARY);
    // 31% is unambiguously primary.
    recordQuotaSnapshot(store, snapshot("o1", 31, T0 + 5000));
    assert.equal(
      resolveRuntimeModel({ store, agentId: "o1", now: T0 + 5000 }).model,
      MODEL_ALLOWLIST[0],
    );
    // A fresh drop back to 19% re-enters fallback.
    recordQuotaSnapshot(store, snapshot("o1", 19, T0 + 6000));
    assert.equal(
      resolveRuntimeModel({ store, agentId: "o1", now: T0 + 6000 }).model,
      MODEL_ALLOWLIST[1],
    );
  });

  it("TEST D: stale and unknown both keep PRIMARY", () => {
    // Fresh low quota -> fallback.
    const fresh = createQuotaTelemetryStore();
    recordQuotaSnapshot(fresh, snapshot("o1", 10, T0));
    assert.equal(
      resolveRuntimeModel({ store: fresh, agentId: "o1", now: T0 }).model,
      MODEL_ALLOWLIST[1],
    );
    // Same value, stale telemetry -> primary.
    const stale = createQuotaTelemetryStore();
    recordQuotaSnapshot(stale, snapshot("o1", 10, T0));
    assert.equal(
      resolveRuntimeModel({
        store: stale,
        agentId: "o1",
        now: T0 + QUOTA_FRESHNESS_MS + 1,
      }).model,
      MODEL_ALLOWLIST[0],
    );
    // No telemetry -> primary.
    const none = createQuotaTelemetryStore();
    const noneResult = resolveRuntimeModel({
      store: none,
      agentId: "o1",
      now: T0,
    });
    assert.equal(noneResult.model, MODEL_ALLOWLIST[0]);
    assert.equal(noneResult.reason, RESOLUTION_REASON.UNKNOWN_KEEP_PRIMARY);
  });

  it("stale telemetry does not latch an agent into fallback", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 5, T0));
    // Force fallback while fresh.
    assert.equal(
      resolveRuntimeModel({ store, agentId: "o1", now: T0 }).model,
      MODEL_ALLOWLIST[1],
    );
    // Now the snapshot goes stale. Stale means PRIMARY, not "hold fallback",
    // because holding a fallback on missing evidence is the degradation the
    // policy explicitly rejects.
    const staleResult = resolveRuntimeModel({
      store,
      agentId: "o1",
      now: T0 + QUOTA_FRESHNESS_MS + 1,
    });
    assert.equal(staleResult.model, MODEL_ALLOWLIST[0]);
    assert.equal(staleResult.reason, RESOLUTION_REASON.STALE_KEEP_PRIMARY);
  });

  it("TEST M: fallback can never escape the canonical allowlist", () => {
    const store = createQuotaTelemetryStore();
    for (const agentId of AGENTS) {
      recordQuotaSnapshot(store, snapshot(agentId, 1, T0));
      const result = resolveRuntimeModel({ store, agentId, now: T0 });
      assert.ok(
        MODEL_ALLOWLIST.includes(result.model),
        `${agentId} model must be allowlisted`,
      );
    }
  });

  it("TEST K: concurrent resolution is deterministic and writes no session state", async () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 10, T0));
    const results = await Promise.all(
      Array.from({ length: 32 }, async () =>
        Promise.resolve().then(() =>
          resolveRuntimeModel({ store, agentId: "o1", now: T0 }),
        ),
      ),
    );
    const models = new Set(results.map((r) => r.model));
    assert.equal(models.size, 1, "concurrent resolution must be deterministic");
    assert.equal([...models][0], MODEL_ALLOWLIST[1]);
    // The only mutated state is the in-process latch; nothing persisted.
    assert.deepEqual(
      [...store.snapshots.keys()],
      ["o1"],
      "resolution must not add snapshot keys",
    );
    // The stored snapshot is unchanged: no model field, no override field,
    // no session identifier, nothing the resolver could have pinned.
    const stored = store.snapshots.get("o1");
    assert.deepEqual(
      Object.keys(stored).sort(),
      [
        "agentId",
        "model",
        "observedAt",
        "provider",
        "remainingPct",
        "resetAt",
        "source",
      ],
      "snapshot shape must be stable and model-payload free",
    );
    assert.equal(Object.isFrozen(stored), true);
  });

  it("TEST K: two agents resolving in parallel do not cross-contaminate", async () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 5, T0));
    recordQuotaSnapshot(store, snapshot("python", 95, T0));
    const [o1, py] = await Promise.all([
      Promise.resolve().then(() =>
        resolveRuntimeModel({ store, agentId: "o1", now: T0 }),
      ),
      Promise.resolve().then(() =>
        resolveRuntimeModel({ store, agentId: "python", now: T0 }),
      ),
    ]);
    assert.equal(o1.model, MODEL_ALLOWLIST[1]);
    assert.equal(py.model, MODEL_ALLOWLIST[0]);
  });

  it("TEST L: reactive fallback is a separate path and stays available", async () => {
    // The resolution seam is advisory: a fresh healthy primary stays primary
    // even though a real provider failure may still trigger the host's native
    // reactive failover. Telemetry policy must not disable that.
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot("o1", 90, T0));
    const result = resolveRuntimeModel({ store, agentId: "o1", now: T0 });
    assert.equal(result.model, MODEL_ALLOWLIST[0]);
    // No flag in the result suppresses reactive failover.
    assert.equal(result.suppress_reactive_failover, undefined);
    assert.equal(result.run_scoped, true);
  });

  it("unknown agent cannot resolve a model", () => {
    const store = createQuotaTelemetryStore();
    assert.throws(
      () => resolveRuntimeModel({ store, agentId: "root", now: T0 }),
      /UNKNOWN_AGENT/,
    );
  });
});
