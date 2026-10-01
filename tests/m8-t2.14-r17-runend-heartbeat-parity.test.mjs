// M8/T2.2-R17 — run-end governance parity for the pure liveness heartbeat.
//
// R17 is an authorized RED correction discovered by live observation AFTER R16 was
// deployed and closed. The heartbeat passed admission but failed at run-end with
// GOVERNANCE_COMPLETION_UNAVAILABLE, because two things were true:
//
//   1. `finishNativeRun` built the run-end context with only agentId, sessionKey
//      and runId, dropping the host `trigger` and `transcriptPrompt` that
//      `enterNativeRun` already forwards. So run-end could not recognise a
//      heartbeat even in principle.
//   2. `classifyInternalRunEnd` refused the internal exemption whenever a runId
//      was present, unconditionally.
//
// The correction is deliberately narrow: the run-end seam forwards the same two
// fields the admission seam already forwards, and the classifier accepts ONE new
// input — the verdict of the pre-existing `isPureLivenessHeartbeat` predicate.
// No second copy of the rule is introduced, and every other run keeps exactly
// the behaviour it had.
//
// These tests are the security boundary for this change, so they assert the
// NEGATIVE cases as hard as the positive one.
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyInternalRunEnd,
  isPureLivenessHeartbeat,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

// The host-provided liveness sentinel. It is a module-local constant in the
// extension rather than an export, so it is restated here on purpose: the test
// pins the exact contract string instead of importing whatever the module
// happens to define.
const HEARTBEAT_LIVENESS_SENTINEL = "[OpenClaw heartbeat poll]";

/** A context the host would build for a genuine liveness poll. */
const heartbeatContext = (overrides = {}) => ({
  agentId: "main",
  sessionKey: "agent:main:main",
  runId: "run-abc123",
  trigger: "heartbeat",
  transcriptPrompt: HEARTBEAT_LIVENESS_SENTINEL,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. The pure liveness heartbeat: consistent at admission AND at run-end
// ---------------------------------------------------------------------------

test("R17 1: a pure liveness heartbeat is internal at run-end despite its runId", () => {
  const context = heartbeatContext();
  assert.equal(
    isPureLivenessHeartbeat(context),
    true,
    "admission recognises it",
  );

  const verdict = classifyInternalRunEnd({
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    ownedByLedger: false,
    pureLivenessHeartbeat: isPureLivenessHeartbeat(context),
  });
  assert.equal(verdict.isInternal, true);
  assert.equal(verdict.selfKeyedWithRunId, false);
});

test("R17 2: admission and run-end agree for the heartbeat in every runId case", () => {
  for (const runId of [undefined, null, "", "run-abc123", 42]) {
    const context = heartbeatContext({ runId });
    const admitted = isPureLivenessHeartbeat(context);
    const verdict = classifyInternalRunEnd({
      agentId: context.agentId,
      sessionKey: context.sessionKey,
      runId: context.runId,
      ownedByLedger: false,
      pureLivenessHeartbeat: admitted,
    });
    assert.equal(
      verdict.isInternal,
      true,
      `runId=${String(runId)} must still be internal`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. Every NON-heartbeat case keeps the existing, stricter behaviour
// ---------------------------------------------------------------------------

test("R17 3: a self-keyed run that is NOT a heartbeat is still fully governed", () => {
  // Same shape as the heartbeat but without the host trigger: the runId refusal
  // must remain in force. This is the case the change must NOT weaken.
  const verdict = classifyInternalRunEnd({
    agentId: "main",
    sessionKey: "agent:main:main",
    runId: "run-abc123",
    ownedByLedger: false,
    pureLivenessHeartbeat: false,
  });
  assert.equal(verdict.isInternal, false);
  assert.equal(verdict.selfKeyedWithRunId, true);
});

test("R17 4: the heartbeat predicate stays strict — no near-miss is exempted", () => {
  const base = heartbeatContext();
  const nearMisses = {
    "no trigger": { trigger: undefined },
    "wrong trigger": { trigger: "user" },
    "has input provenance": { inputProvenance: { channel: "discord" } },
    "not self-keyed": { sessionKey: "agent:main:other" },
    "discord session key": { sessionKey: "agent:main:discord:channel:123" },
    "discord channel marker": { channelId: "discord" },
    "discord provider marker": { messageProvider: "discord" },
    "no sentinel": { transcriptPrompt: "are you there?" },
    "sentinel only on prompt": { transcriptPrompt: "hello" },
  };
  for (const [label, override] of Object.entries(nearMisses)) {
    const context = { ...base, ...override };
    assert.equal(
      isPureLivenessHeartbeat(context),
      false,
      `${label} must not qualify as a heartbeat`,
    );
    // And with the predicate false, run-end must refuse exactly as before.
    const verdict = classifyInternalRunEnd({
      agentId: context.agentId,
      sessionKey: context.sessionKey,
      runId: context.runId,
      ownedByLedger: false,
      pureLivenessHeartbeat: isPureLivenessHeartbeat(context),
    });
    assert.equal(
      verdict.isInternal,
      false,
      `${label} must not become an internal session`,
    );
    // A self-keyed run keeps the explicit runId refusal. A run that is not
    // self-keyed short-circuits earlier, so it is refused for a different and
    // equally strict reason: it was never a candidate for the exemption.
    assert.equal(
      verdict.selfKeyedWithRunId,
      context.sessionKey === `agent:${context.agentId}:${context.agentId}`,
      `${label} keeps the pre-existing refusal`,
    );
  }
});

test("R17 5: a ledger-owned session is governed even when it IS a heartbeat", () => {
  const context = heartbeatContext();
  assert.equal(isPureLivenessHeartbeat(context), true);
  const verdict = classifyInternalRunEnd({
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    ownedByLedger: true,
    pureLivenessHeartbeat: true,
  });
  assert.equal(
    verdict.isInternal,
    false,
    "the ledger owns this session, so full governance applies regardless",
  );
  assert.equal(verdict.selfKeyedWithRunId, false);
});

test("R17 6: a self-keyed heartbeat carrying a message identity is NOT internal", () => {
  const context = heartbeatContext();
  const verdict = classifyInternalRunEnd({
    agentId: context.agentId,
    sessionKey: context.sessionKey,
    runId: context.runId,
    ownedByLedger: false,
    hasMessageIdentity: true,
    pureLivenessHeartbeat: true,
  });
  assert.equal(
    verdict.isInternal,
    false,
    "a message identity means real inbound work wearing an internal key",
  );
});

test("R17 7: a non-self-keyed run is never internal, whatever the flag says", () => {
  const verdict = classifyInternalRunEnd({
    agentId: "main",
    sessionKey: "agent:main:discord:channel:123",
    runId: undefined,
    ownedByLedger: false,
    pureLivenessHeartbeat: true,
  });
  assert.equal(verdict.isInternal, false);
  assert.equal(verdict.selfKeyed, false);
});

test("R17 8: the flag defaults to false, so every pre-existing caller is unchanged", () => {
  // A caller that does not pass the new input must behave exactly as before.
  const verdict = classifyInternalRunEnd({
    agentId: "main",
    sessionKey: "agent:main:main",
    runId: "run-abc123",
    ownedByLedger: false,
  });
  assert.deepEqual(verdict, {
    isInternal: false,
    selfKeyed: true,
    selfKeyedWithRunId: true,
  });
});

// ---------------------------------------------------------------------------
// 3. The boundary forwards the fields the predicate depends on
// ---------------------------------------------------------------------------

// A registrable guard needs the five mandatory governance capabilities; only
// `beforeRunEnd` is varied by these tests.
const registrableGuard = (overrides = {}) => ({
  beforeToolCall: () => ({ allow: true }),
  beforeAnnounce: () => ({ allow: true }),
  recordQuota: () => {},
  selfQuotaReceipt: () => null,
  resolveRunModel: () => undefined,
  ...overrides,
});

const boundaryConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

test("R17 9: finishNativeRun forwards trigger and transcriptPrompt to the guard", async () => {
  const { finishNativeRun, registerNativeGuard } =
    await import("../integrations/openclaw/topology/lib/native-boundary.mjs");
  const seen = [];
  const scope = "/tmp/zink-r17-scope-9";
  registerNativeGuard(
    scope,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  await finishNativeRun(
    boundaryConfig(scope),
    { type: "run_end" },
    {
      agentId: "main",
      sessionKey: "agent:main:main",
      runId: "run-abc123",
      trigger: "heartbeat",
      transcriptPrompt: HEARTBEAT_LIVENESS_SENTINEL,
    },
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trigger, "heartbeat");
  assert.equal(seen[0].transcriptPrompt, HEARTBEAT_LIVENESS_SENTINEL);
  // The forwarded context must itself satisfy the predicate, which is what makes
  // the run-end verdict consistent with admission.
  assert.equal(isPureLivenessHeartbeat(seen[0]), true);
});

test("R17 10: finishNativeRun still fails closed when the guard denies or throws", async () => {
  const { finishNativeRun, registerNativeGuard } =
    await import("../integrations/openclaw/topology/lib/native-boundary.mjs");
  const context = {
    agentId: "main",
    sessionKey: "agent:main:main",
    runId: "run-abc123",
    trigger: "heartbeat",
    transcriptPrompt: HEARTBEAT_LIVENESS_SENTINEL,
  };
  const guards = [
    registrableGuard({ beforeRunEnd: () => ({ allow: false }) }),
    registrableGuard({
      beforeRunEnd() {
        throw new Error("boom");
      },
    }),
    // A guard that registers successfully but exposes no beforeRunEnd at all.
    registrableGuard(),
  ];
  for (const [index, guard] of guards.entries()) {
    const scope = `/tmp/zink-r17-scope-10-${index}`;
    registerNativeGuard(scope, guard);
    await assert.rejects(
      () =>
        finishNativeRun(boundaryConfig(scope), { type: "run_end" }, context),
      { message: "GOVERNANCE_COMPLETION_UNAVAILABLE" },
      "run-end must remain fail-closed",
    );
  }
});
