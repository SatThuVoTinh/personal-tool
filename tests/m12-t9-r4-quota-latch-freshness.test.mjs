// M12/T9 F-403 (legacy R9-L04-3): a STALE or UNKNOWN reading means the
// resolver has no fresh evidence, yet the shared tail still rewrote the
// hysteresis latch from that guess — so the same quota data, read one minute
// later, erased the fallback hold the latch exists to keep.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  QUOTA_FRESHNESS_MS,
  RESOLUTION_REASON,
  createQuotaTelemetryStore,
  recordQuotaSnapshot,
  resolveRuntimeModel,
} from "../integrations/openclaw/lib/quota-telemetry.mjs";
import { MODEL_ALLOWLIST } from "../integrations/openclaw/lib/policy.mjs";

const T0 = 1_800_000_000_000;
const AGENT = "o1";

// The governed two-model set, which is what makes the fallback reachable.
const TWO_ENTRY = [MODEL_ALLOWLIST[0], MODEL_ALLOWLIST[1]];

function snapshot(remainingPct) {
  return {
    agentId: AGENT,
    provider: "google",
    model: MODEL_ALLOWLIST[0],
    remainingPct,
    resetAt: new Date(T0 + 3_600_000).toISOString(),
    source: "canonical-provider-usage",
    observedAt: T0,
  };
}

function latched(store) {
  return store.latches.get(AGENT);
}

describe("M12/T9 F-403 - no fresh evidence does not rewrite the latch", () => {
  it("a stale reading keeps the recorded fallback latch", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot(5));
    const fresh = resolveRuntimeModel({
      store,
      agentId: AGENT,
      now: T0,
      allowlist: TWO_ENTRY,
    });
    assert.equal(fresh.model, TWO_ENTRY[1]);
    assert.equal(latched(store), "fallback");

    // Identical durable state, only the clock moved: the reading is now STALE.
    const stale = resolveRuntimeModel({
      store,
      agentId: AGENT,
      now: T0 + QUOTA_FRESHNESS_MS + 1,
      allowlist: TWO_ENTRY,
    });
    assert.equal(stale.model, MODEL_ALLOWLIST[0]);
    assert.equal(stale.reason, RESOLUTION_REASON.STALE_KEEP_PRIMARY);
    assert.equal(
      latched(store),
      "fallback",
      "an absence of evidence must not erase the hold it cannot disprove",
    );
  });

  it("an unknown reading keeps the recorded fallback latch", () => {
    const store = createQuotaTelemetryStore();
    store.latches.set(AGENT, "fallback");
    const unknown = resolveRuntimeModel({
      store,
      agentId: AGENT,
      now: T0,
      allowlist: TWO_ENTRY,
    });
    assert.equal(unknown.reason, RESOLUTION_REASON.UNKNOWN_KEEP_PRIMARY);
    assert.equal(latched(store), "fallback");
  });

  it("a fresh reading still latches, including the recovery back to primary", () => {
    const store = createQuotaTelemetryStore();
    recordQuotaSnapshot(store, snapshot(5));
    resolveRuntimeModel({
      store,
      agentId: AGENT,
      now: T0,
      allowlist: TWO_ENTRY,
    });
    assert.equal(latched(store), "fallback");

    recordQuotaSnapshot(store, { ...snapshot(80), observedAt: T0 + 1 });
    const recovered = resolveRuntimeModel({
      store,
      agentId: AGENT,
      now: T0 + 2,
      allowlist: TWO_ENTRY,
    });
    assert.equal(recovered.reason, RESOLUTION_REASON.RECOVERED_PRIMARY);
    assert.equal(latched(store), "primary");
  });
});
