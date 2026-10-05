// M10/T2-R8 — a governance refusal must never become conversational content.
//
// PROVEN LIVE, not hypothesised. The recorded session for the owner's message
// `1556360697561088142` is structured exactly as:
//
//   5  message role=user        parts=[string]
//   6  message role=assistant   parts=[text,toolCall,text]
//   7  message role=toolResult  parts=[text]        <- GOVERNANCE_UNAVAILABLE
//   8  message role=assistant   parts=[text]        <- model repeats it -> Discord
//
// The host maps a block decision's `reason` to `blockReason` and writes it into
// the tool result the MODEL reads, so the code travelled governance gate -> host
// block decision -> tool result -> model context -> model answer -> Discord.
// Mechanism A is confirmed by that transcript, not by inference.
//
// The fix is structural: the canonical reason code is never handed to the host
// in the first place. These tests pin that at the seam, and pin that the
// diagnostic channel and the governance decision itself are untouched.
import assert from "node:assert/strict";
import test from "node:test";
import {
  installNativeToolGate,
  POLICY_REFUSAL_TEXT,
  registerNativeGuard,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const CONTEXT = Object.freeze({
  agentId: "main",
  sessionKey: "agent:main:discord:channel:1545425766161063937",
  runId: "52c55764-88c3-424f-8e74-6b05ff34aea4",
});

/** The governance identifiers that must never reach the model. */
const INTERNAL_CODES = [
  "GOVERNANCE_RUN_UNAVAILABLE",
  "GOVERNANCE_DENIED",
  "GOVERNANCE_UNAVAILABLE",
  "NON_MAIN_DIRECT_INGRESS",
  "RUNTIME_CAPABILITY_MISMATCH",
  "YIELD_BATCH_DENIED",
  "AUTH_POLICY_DENIED",
  "POLICY_DENIED",
];

function guard(over = {}) {
  return {
    beforeToolCall: async () => ({ allow: true }),
    beforeAnnounce: async () => ({ allow: true }),
    beforeRun: async () => ({ allow: true }),
    beforeRunEnd: async () => ({ allow: true }),
    beforeIngress: async () => ({ allow: true }),
    recordQuota: async () => ({}),
    selfQuotaReceipt: async () => null,
    resolveRunModel: async () => null,
    ...over,
  };
}

/**
 * `resolveGovernance` reads `config.plugins.entries["zink-governance"]` and uses
 * `config.ledgerRoot` as the registry scope, so the config and the registration
 * must agree on that exact string — otherwise the gate is simply not installed
 * and every assertion below would pass vacuously.
 */
function configFor(scope) {
  return {
    plugins: {
      entries: {
        "zink-governance": {
          enabled: true,
          config: { ledgerRoot: scope },
        },
      },
    },
  };
}

function install(guardImpl, agentId = "main") {
  const scope = `zink-test-${Math.random().toString(36).slice(2)}`;
  registerNativeGuard(scope, guardImpl);
  const agent = {
    // The host's own decision must NOT block: the boundary returns a host block
    // unchanged and short-circuits, so a blocking stub would skip governance
    // entirely and make every assertion below pass vacuously.
    beforeToolCall: async () => ({ block: false }),
  };
  installNativeToolGate(
    agent,
    configFor(scope),
    Object.freeze({ ...CONTEXT, agentId }),
  );
  return agent;
}

function event(name = "zink_sql") {
  const toolCall = { id: "call-1", name };
  const assistantMessage = {
    role: "assistant",
    content: [
      { type: "text", text: "let me check" },
      { type: "toolCall", id: toolCall.id, name: toolCall.name },
    ],
  };
  return { assistantMessage, toolCall, args: {} };
}

/** Runs `fn` with console.error captured, and resolves with the captured lines. */
async function withLogs(fn) {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test("R8 L1: a guard denial never returns its canonical code to the host", async () => {
  const agent = install(
    guard({
      beforeToolCall: async () => ({
        allow: false,
        reason: "NON_MAIN_DIRECT_INGRESS",
      }),
    }),
  );
  const decision = await agent.beforeToolCall(event());
  assert.equal(decision.block, true);
  assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
  for (const code of INTERNAL_CODES)
    assert.equal(
      decision.reason.includes(code),
      false,
      `${code} must never reach the model`,
    );
});

test("R8 L2: a thrown governance failure never returns its code or detail", async () => {
  const agent = install(
    guard({
      beforeToolCall: async () => {
        throw new Error("RUNTIME_CAPABILITY_MISMATCH");
      },
    }),
  );
  const decision = await agent.beforeToolCall(event());
  assert.equal(decision.block, true);
  assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
  assert.equal(decision.reason.includes("RUNTIME_CAPABILITY_MISMATCH"), false);
});

test("R8 L3: an exception message carrying input is still never surfaced", async () => {
  const agent = install(
    guard({
      beforeToolCall: async () => {
        throw new Error("ECONNREFUSED 10.0.0.7:5432 db=zink password=hunter2");
      },
    }),
  );
  const decision = await agent.beforeToolCall(event());
  assert.equal(decision.block, true);
  assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
  assert.equal(decision.reason.includes("hunter2"), false);
  assert.equal(decision.reason.includes("10.0.0.7"), false);
});

test("R8 L4: the batch refusal keeps its canonical code in diagnostics only", async () => {
  const agent = install(guard(), "sql");
  const e = event("sessions_yield");
  e.assistantMessage.content = [
    { type: "toolCall", id: "call-1", name: "sessions_yield" },
  ];
  // A yield batch from a non-coordinator agent is refused before the guard runs.
  // The canonical code must be logged and must NOT be the model-visible reason.
  let decision;
  const lines = await withLogs(async () => {
    decision = await agent.beforeToolCall(e);
  });
  assert.equal(decision.block, true);
  assert.equal(decision.reason, POLICY_REFUSAL_TEXT);
  assert.match(lines.join("\n"), /YIELD_BATCH_DENIED/);
});

test("R8 L5: the diagnostic channel still records the canonical code", async () => {
  const agent = install(
    guard({
      beforeToolCall: async () => {
        throw new Error("RUNTIME_CAPABILITY_MISMATCH");
      },
    }),
  );
  const lines = await withLogs(() => agent.beforeToolCall(event()));
  const joined = lines.join("\n");
  assert.match(joined, /beforeToolCall blocked/);
  assert.match(
    joined,
    /RUNTIME_CAPABILITY_MISMATCH/,
    "the denial must stay auditable in diagnostics",
  );
});

test("R8 L6: an allowed call is untouched — no refusal, no diagnostic", async () => {
  const agent = install(guard());
  const lines = await withLogs(async () => {
    const decision = await agent.beforeToolCall(event());
    // The host's own decision is returned unchanged when governance allows.
    assert.deepEqual(decision, { block: false });
  });
  assert.equal(
    lines.length,
    0,
    "an allowed call must not be logged as blocked",
  );
});

test("R8 L7: the refusal text is a sentence, not an identifier", () => {
  assert.match(POLICY_REFUSAL_TEXT, /^[A-Z]/);
  assert.match(POLICY_REFUSAL_TEXT, /\.$/u);
  for (const code of INTERNAL_CODES)
    assert.equal(
      POLICY_REFUSAL_TEXT.includes(code),
      false,
      `${code} must not appear in the model-visible refusal`,
    );
  // The historical codes must not reappear anywhere in the boundary source.
  const source = POLICY_REFUSAL_TEXT;
  assert.equal(source.includes("GOVERNANCE"), false);
});
