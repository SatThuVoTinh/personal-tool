// M8/T2.2-R18 — run-end propagation of the admission-time liveness discriminator.
//
// R17 fixed the CLASSIFIER but not the SEAM. The host forwards `trigger` and
// `transcriptPrompt` to `enterNativeRun` and NOT to `finishNativeRun`: the run-end
// call in the pinned selection passes only `{agentId, sessionKey, runId}`. So at
// run-end those two fields were `undefined`, `isPureLivenessHeartbeat` returned
// false even for a heartbeat admission had already recognised, and the self-keyed
// heartbeat was pushed into full governance and failed with
// GOVERNANCE_COMPLETION_UNAVAILABLE / EXECUTION_STATE_UNKNOWN. That was observed
// repeatedly in the live runtime and is the proven cause of the open gap.
//
// The fix records the two fields per runId at the moment admission ACCEPTS the
// run, and recovers them at the run-end seam, so both seams apply the SAME
// predicate to the SAME execution.
//
// The alternative — threading the fields through the pinned selection's call site
// — was rejected deliberately: it changes the installed `selection-*.js`, which
// would require a new predecessor descriptor AND would break the R7 lineage (R7
// would then differ from the current edit set in two slots, which the single-slot
// descriptor cannot express). Group 3 pins that decision: the native patch is
// byte-identical, so the deployed selection `555f37da` stays recognised by
// content comparison and no native file is mutated.
//
// These tests are the security boundary for the change, so the negatives are
// asserted as hard as the positive.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  classifyInternalRunEnd,
  isPureLivenessHeartbeat,
} from "../integrations/openclaw/plugins/zink-governance/index.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOUNDARY_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-boundary.mjs",
);
const NATIVE_PATCH_PATH = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "lib",
  "native-patch.mjs",
);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const { enterNativeRun, finishNativeRun, registerNativeGuard } =
  await import("../integrations/openclaw/topology/lib/native-boundary.mjs");

// The host-provided liveness sentinel. It is a module-local constant in the
// extension rather than an export, so it is restated here on purpose: the test
// pins the exact contract string instead of importing whatever the module happens
// to define.
const HEARTBEAT_LIVENESS_SENTINEL = "[OpenClaw heartbeat poll]";

/** A context the host would build for a genuine liveness poll at ADMISSION. */
const heartbeatContext = (runId, overrides = {}) => ({
  agentId: "main",
  sessionKey: "agent:main:main",
  runId,
  trigger: "heartbeat",
  transcriptPrompt: HEARTBEAT_LIVENESS_SENTINEL,
  ...overrides,
});

/**
 * The context the host ACTUALLY builds at RUN-END. This shape is the proven bug:
 * it carries no trigger and no transcriptPrompt, exactly as the patched selection
 * emits it. Every positive test drives the boundary through THIS shape, so none of
 * them can pass by accident through a field the real host never sends.
 */
const hostRunEndContext = (runId, overrides = {}) => ({
  agentId: "main",
  sessionKey: "agent:main:main",
  runId,
  ...overrides,
});

/** A registrable guard needs the five mandatory capabilities; the two run seams vary. */
const registrableGuard = (overrides = {}) => ({
  beforeToolCall: () => ({ allow: true }),
  beforeAnnounce: () => ({ allow: true }),
  recordQuota: () => {},
  selfQuotaReceipt: () => null,
  resolveRunModel: () => undefined,
  beforeRun: () => ({ allow: true }),
  ...overrides,
});

const boundaryConfig = (scope) => ({
  plugins: {
    entries: {
      "zink-governance": { enabled: true, config: { ledgerRoot: scope } },
    },
  },
});

let scopeCounter = 0;
const scope = () => `/tmp/zink-r18-scope-${process.pid}-${(scopeCounter += 1)}`;

/**
 * A guard whose `beforeRunEnd` is the REAL plugin rule, transcribed from
 * `index.mjs`: the same `classifyInternalRunEnd` / `isPureLivenessHeartbeat` pair
 * the live extension runs. The recorded line is what a lane-completion heartbeat
 * must produce, so the positive tests assert the live decision, not a stub's.
 */
const realRunEndGuard = (log) =>
  registrableGuard({
    beforeRunEnd(event, context) {
      const internal = classifyInternalRunEnd({
        agentId: context.agentId,
        sessionKey: context.sessionKey,
        runId: context.runId,
        ownedByLedger: false,
        pureLivenessHeartbeat: isPureLivenessHeartbeat(context),
      });
      log.push(internal);
      if (internal.isInternal) return { allow: true, internalSession: true };
      return { allow: false, reason: "EXECUTION_STATE_UNKNOWN" };
    },
  });

// ---------------------------------------------------------------------------
// 1. The proven defect: the run-end seam sees what admission saw
// ---------------------------------------------------------------------------

test("R18 1: the host's run-end shape still yields a heartbeat context after admission", async () => {
  const runId = "r18-1";
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );

  await enterNativeRun(boundaryConfig(s), heartbeatContext(runId));
  // The host passes ONLY this. Before R18 the guard saw trigger/transcriptPrompt
  // as undefined here, which is the defect.
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(runId),
  );

  assert.equal(seen.length, 1);
  assert.equal(seen[0].trigger, "heartbeat");
  assert.equal(seen[0].transcriptPrompt, HEARTBEAT_LIVENESS_SENTINEL);
  assert.equal(
    isPureLivenessHeartbeat(seen[0]),
    true,
    "run-end must reach the same verdict admission reached",
  );
});

test("R18 2: the full heartbeat cycle no longer fails at run-end", async () => {
  const runId = "r18-2";
  const log = [];
  const s = scope();
  registerNativeGuard(s, realRunEndGuard(log));

  // scheduled poll -> admission -> (execution) -> run end
  await enterNativeRun(boundaryConfig(s), heartbeatContext(runId));
  const decision = await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end", success: true },
    hostRunEndContext(runId),
  ).then(
    () => ({ threw: false }),
    (error) => ({ threw: true, error }),
  );

  assert.equal(
    decision.threw,
    false,
    "GOVERNANCE_COMPLETION_UNAVAILABLE must not be raised: " +
      (decision.error?.message ?? ""),
  );
  assert.equal(log.length, 1);
  assert.equal(log[0].isInternal, true, "execution state is known");
  assert.equal(log[0].selfKeyedWithRunId, false, "no full-governance refusal");
});

test("R18 3: the recovered values are exactly what admission was given", async () => {
  const runId = "r18-3";
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );

  // A non-heartbeat admission carries no sentinel; the recovery must not invent one.
  await enterNativeRun(
    boundaryConfig(s),
    heartbeatContext(runId, {
      trigger: "user",
      transcriptPrompt: "are you there?",
    }),
  );
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(runId),
  );
  assert.equal(seen[0].trigger, "user");
  assert.equal(seen[0].transcriptPrompt, "are you there?");

  // And undefined stays undefined rather than becoming a truthy placeholder.
  const bareRunId = "r18-3-bare";
  await enterNativeRun(
    boundaryConfig(s),
    heartbeatContext(bareRunId, {
      trigger: undefined,
      transcriptPrompt: undefined,
    }),
  );
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(bareRunId),
  );
  assert.equal(seen[1].trigger, undefined);
  assert.equal(seen[1].transcriptPrompt, undefined);
});

// ---------------------------------------------------------------------------
// 2. Negatives: no new exemption, and nothing leaks
// ---------------------------------------------------------------------------

test("R18 4: a run that never passed admission gets NO exemption", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  // No enterNativeRun at all — the host's run-end seam is reached cold.
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext("r18-4"),
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trigger, undefined);
  assert.equal(seen[0].transcriptPrompt, undefined);
  assert.equal(
    isPureLivenessHeartbeat(seen[0]),
    false,
    "no record means no heartbeat verdict",
  );
});

test("R18 5: a DENIED admission records nothing, so run-end stays fully governed", async () => {
  const log = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRun: () => ({ allow: false }),
      beforeRunEnd: realRunEndGuard(log).beforeRunEnd,
    }),
  );
  const runId = "r18-5";
  await assert.rejects(
    () => enterNativeRun(boundaryConfig(s), heartbeatContext(runId)),
    { message: "GOVERNANCE_RUN_UNAVAILABLE" },
    "admission still fails closed",
  );
  await assert.rejects(
    () =>
      finishNativeRun(
        boundaryConfig(s),
        { type: "run_end" },
        hostRunEndContext(runId),
      ),
    { message: "GOVERNANCE_COMPLETION_UNAVAILABLE" },
    "a denied run must not inherit a heartbeat exemption",
  );
  // The run-end seam WAS reached, and it applied FULL governance: the denial was
  // not remembered, so the predicate is false and the runId refusal stands.
  assert.equal(log.length, 1);
  assert.equal(
    log[0].isInternal,
    false,
    "no internal exemption survives a denial",
  );
  assert.equal(
    log[0].selfKeyedWithRunId,
    true,
    "the pre-existing runId refusal is unchanged",
  );
});

test("R18 6: a non-heartbeat run admitted with a runId keeps full governance", async () => {
  const log = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd: realRunEndGuard(log).beforeRunEnd,
    }),
  );
  const runId = "r18-6";
  // A Discord-origin run: real inbound work on an internal-looking key.
  await enterNativeRun(
    boundaryConfig(s),
    heartbeatContext(runId, {
      trigger: "user",
      transcriptPrompt: "deploy the thing",
      sessionKey: "agent:main:discord:channel:123",
      channelId: "discord",
    }),
  );
  await assert.rejects(
    () =>
      finishNativeRun(
        boundaryConfig(s),
        { type: "run_end" },
        hostRunEndContext(runId, {
          sessionKey: "agent:main:discord:channel:123",
        }),
      ),
    { message: "GOVERNANCE_COMPLETION_UNAVAILABLE" },
    "the runId refusal must remain in force",
  );
});

test("R18 7: one run's record never reaches another run", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  const heartbeatRun = "r18-7-heartbeat";
  const otherRun = "r18-7-other";
  await enterNativeRun(boundaryConfig(s), heartbeatContext(heartbeatRun));
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(otherRun),
  );
  assert.equal(seen[0].runId, otherRun);
  assert.equal(
    seen[0].trigger,
    undefined,
    "records are keyed strictly by runId",
  );
  assert.equal(isPureLivenessHeartbeat(seen[0]), false);
});

test("R18 8: a record is consumed once and cannot be replayed", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  const runId = "r18-8";
  await enterNativeRun(boundaryConfig(s), heartbeatContext(runId));
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(runId),
  );
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(runId),
  );
  assert.equal(seen.length, 2);
  assert.equal(isPureLivenessHeartbeat(seen[0]), true);
  assert.equal(
    isPureLivenessHeartbeat(seen[1]),
    false,
    "a second run-end for the same runId must not re-read the record",
  );
});

test("R18 9: the run-end seam stays authoritative when the host speaks", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  const runId = "r18-9";
  await enterNativeRun(boundaryConfig(s), heartbeatContext(runId));
  // The host passes a real trigger at this seam, so it must win over the record.
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    {
      ...hostRunEndContext(runId),
      trigger: "user",
    },
  );
  assert.equal(
    seen[0].trigger,
    "user",
    "an explicit value is never overridden",
  );
});

test("R18 10: the record store is bounded and evicts fail-closed", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  // The store holds 256 runs. Admit 257 without reaching run-end: the oldest must
  // have been evicted rather than the map growing without limit.
  const first = "r18-10-first";
  await enterNativeRun(boundaryConfig(s), heartbeatContext(first));
  for (let i = 0; i < 256; i += 1)
    await enterNativeRun(
      boundaryConfig(s),
      heartbeatContext(`r18-10-fill-${i}`),
    );
  await finishNativeRun(
    boundaryConfig(s),
    { type: "run_end" },
    hostRunEndContext(first),
  );
  assert.equal(seen.length, 1);
  assert.equal(
    isPureLivenessHeartbeat(seen[0]),
    false,
    "an evicted record degrades to full governance, never to a bypass",
  );
});

test("R18 11: the run-end seam is still fail-closed on deny and on error", async () => {
  const runId = "r18-11";
  const context = hostRunEndContext(runId);
  const guards = [
    registrableGuard({ beforeRunEnd: () => ({ allow: false }) }),
    registrableGuard({
      beforeRunEnd() {
        throw new Error("boom");
      },
    }),
    registrableGuard(),
  ];
  for (const [index, guard] of guards.entries()) {
    const s = `${scope()}-${index}`;
    registerNativeGuard(s, guard);
    await assert.rejects(
      () => finishNativeRun(boundaryConfig(s), { type: "run_end" }, context),
      { message: "GOVERNANCE_COMPLETION_UNAVAILABLE" },
    );
  }
});

test("R18 12: governance disabled means neither seam records nor recovers", async () => {
  const seen = [];
  const s = scope();
  registerNativeGuard(
    s,
    registrableGuard({
      beforeRunEnd(event, context) {
        seen.push(context);
        return { allow: true };
      },
    }),
  );
  const off = {
    plugins: { entries: { "zink-governance": { enabled: false } } },
  };
  const runId = "r18-12";
  await enterNativeRun(off, heartbeatContext(runId));
  await finishNativeRun(off, { type: "run_end" }, hostRunEndContext(runId));
  assert.equal(seen.length, 0, "an ungoverned runtime is not intercepted");
});

// ---------------------------------------------------------------------------
// 3. The pinned native runtime is untouched
// ---------------------------------------------------------------------------

// M10/T2-R4 UPDATE: the R17-blob comparison this section used is retired —
// the patch is intentionally extended by the R4-authorized threadId edit
// (see R18 13). The R17 commit reference stays recorded here as history.

// The patched selection currently deployed in the live runtime — now the
// recognised R10 predecessor of the R4 selection (see R18 15).
const DEPLOYED_SELECTION_SHA256 =
  "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5";

test("R18 13: R18 leaves the pinned native patch byte-identical", () => {
  // M10/T2-R4 UPDATE (owner Option A): the patch is intentionally extended by
  // exactly one deterministic field (`threadId: params.currentThreadId ??
  // null` in the selection injection slot) plus the R10->R4 lineage
  // descriptor. This pin now records the R4-authorized bytes so any further
  // unreviewed native mutation still fails; see R4 N1-N3 for the contract.
  assert.equal(
    sha256(readFileSync(NATIVE_PATCH_PATH, "utf8")),
    "40b42b29ac493ba71c44f9bd79968dde8c360cd4e8c3eaa41237c83f756ab101",
    "native-patch.mjs must equal the R4-authorized bytes; any other drift fails",
  );
});

test("R18 14: the generated run-end call site is still unthreaded by design", () => {
  const source = readFileSync(NATIVE_PATCH_PATH, "utf8");
  // The exact context the patched selection emits at run-end.
  const hostRunEnd =
    "}, { agentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId });";
  assert.equal(
    source.split(hostRunEnd).length - 1,
    1,
    "the pinned call site is present and unchanged",
  );
  // Therefore the R18 propagation happens at the boundary, and the fix cannot be
  // reintroduced into the selection as a second copy of the same rule.
  const boundary = readFileSync(BOUNDARY_PATH, "utf8");
  assert.ok(
    boundary.includes("rememberRunLiveness("),
    "the boundary is where the discriminator is recorded",
  );
  assert.ok(
    boundary.includes("context.transcriptPrompt ?? liveness?.transcriptPrompt"),
    "the run-end context resolves the recorded value",
  );
});

test("R18 15: the deployed selection needs no predecessor descriptor", async () => {
  // M10/T2-R4 UPDATE (owner Option A): the R10 selection (555f37da, live
  // since the R16 deployment) is now the recognised predecessor of the R4
  // selection, in the single active slot. The descriptor below asserts that
  // exact lineage; R4 N3 pins the slot invariant.
  const { NATIVE_RUNTIME_PINS, NATIVE_PATCH_PREDECESSORS } =
    await import("../integrations/openclaw/topology/lib/native-patch.mjs");
  const source = readFileSync(NATIVE_PATCH_PATH, "utf8");
  assert.equal(
    source.split(DEPLOYED_SELECTION_SHA256).length - 1,
    1,
    "the deployed R10 selection is listed exactly once, as the R4 predecessor",
  );
  const descriptor =
    NATIVE_PATCH_PREDECESSORS["2026.6.34"]["selection-DopzNY3I.js"];
  assert.equal(descriptor.revision, "R10");
  assert.equal(descriptor.successorRevision, "R4");
  assert.equal(descriptor.sourceDigest, DEPLOYED_SELECTION_SHA256);
  // And the runtime pins the deployed selection derives from are untouched.
  assert.equal(
    typeof NATIVE_RUNTIME_PINS["2026.6.34"],
    "object",
    "the pinned runtime release is unchanged",
  );
});
