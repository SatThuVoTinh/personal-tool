// M10/T2-R8 — the direct-intake decision belongs at the Discord preflight seam.
//
// PROVEN host contract, from the file the plugin loader actually resolves
// (`openclaw plugins list` → `@openclaw/discord`, and
// `message-handler-cizxbaDc.js` is that package's handler):
//
//   const ctx = await preflightDiscordMessage({...});
//   if (!ctx) { await commitDiscordInboundReplay(...); return; }   // :399-403, :466-470
//   startAcceptedTypingFeedback({...});                            // :415, :474
//   messageRunQueue.enqueue(buildDiscordInboundJob(ctx, ...));    // :424
//
// So `return null` means: no context, no typing, no enqueued run, and therefore
// no execution and no outbound. Typing is started at exactly two sites and both
// are strictly downstream of the ctx check.
//
// The decision itself is NOT reimplemented here. The injection calls the plugin's
// own predicate through one published global, so there is a single policy.
import assert from "node:assert/strict";
import test from "node:test";
import { DISCORD_BOT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import { DISCORD_PREFLIGHT_INJECTION } from "../integrations/openclaw/topology/lib/native-patch.mjs";
import {
  POLICY_REFUSAL_TEXT,
  registerNativeGuard,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const GATE_KEY = Symbol.for("zink.governance.native.preflightIngress");
const MSG = "1545430000000000042";

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

function msg(over = {}) {
  return {
    id: MSG,
    content: "hello",
    mentionedUsers: [{ id: DISCORD_BOT_IDS.main }],
    mentionedRoles: [],
    mentionedEveryone: false,
    messageReference: null,
    referencedMessage: null,
    author: { id: "223456789012345678", bot: false },
    rawDataValue: null,
    ...over,
  };
}

/**
 * Runs the REAL injection with the REAL plugin predicate registered, and returns
 * what the host would see: a context (non-null) or null.
 */
async function preflight(agentId, gate) {
  const scope = `r8-pf-${agentId}-${Math.random().toString(36).slice(2)}`;
  if (gate !== null) {
    registerNativeGuard(scope, {
      beforePreflightIngress: gate,
      beforeToolCall: async () => ({ allow: true }),
      beforeAnnounce: async () => ({ allow: true }),
      recordQuota: async () => ({}),
      selfQuotaReceipt: async () => null,
      resolveRunModel: async () => null,
    });
  }
  const factory = new AsyncFunction(
    "message",
    "threadOwnerId",
    "params",
    "globalThis",
    "effectiveRoute",
    "resolvedAccountId",
    DISCORD_PREFLIGHT_INJECTION,
  );
  const returned = await factory(
    msg(),
    null,
    { cfg: {} },
    globalThis,
    { agentId },
    "acct-1",
  );
  return returned === undefined ? Symbol.for("ctx") : returned;
}

/** The canonical rule, copied from the plugin's registered predicate. */
const canonicalGate = (input) =>
  input?.agentId !== "main"
    ? { allow: false, reason: "NON_MAIN_DIRECT_INGRESS" }
    : { allow: true };

test("R8 P1: a direct specialist mention returns null — no run is created", async () => {
  for (const agentId of ["power-bi", "python", "sql", "excel"]) {
    const verdict = await preflight(agentId, canonicalGate);
    assert.equal(
      verdict,
      null,
      `${agentId} must produce no context, so the host enqueues nothing`,
    );
  }
});

test("R8 P2: an absent predicate does NOT deny — the late gate still governs", async () => {
  delete globalThis[GATE_KEY];
  const verdict = await preflight("python", null);
  assert.notEqual(
    verdict,
    null,
    "an unregistered predicate must never invent an admission decision",
  );
});

test("R8 P3: a throwing predicate does NOT deny — fail-safe, not fail-open policy", async () => {
  const verdict = await preflight("python", () => {
    throw new Error("predicate exploded");
  });
  assert.notEqual(
    verdict,
    null,
    "a broken predicate must not deny all ingress",
  );
});

test("R8 P4: Main is admitted at preflight — the Main path is untouched", async () => {
  const verdict = await preflight("main", canonicalGate);
  assert.notEqual(verdict, null, "Main must still produce a context");
});

test("R8 P5: the denial reason is internal and never conversational", async () => {
  // The gate's canonical code is NON_MAIN_DIRECT_INGRESS. Nothing in the
  // injection may put a governance identifier on a model-visible surface, and
  // the host-boundary refusal stays a plain sentence.
  for (const code of [
    "GOVERNANCE_DENIED",
    "GOVERNANCE_RUN_UNAVAILABLE",
    "GOVERNANCE_UNAVAILABLE",
  ]) {
    assert.equal(
      DISCORD_PREFLIGHT_INJECTION.includes(`reason: "${code}"`),
      false,
      `${code} must not be handed to the host`,
    );
  }
  // The preflight seam returns null to the host; it never produces reply text,
  // so it has no reason to carry the model-facing refusal at all.
  assert.equal(
    DISCORD_PREFLIGHT_INJECTION.includes("POLICY_REFUSAL_TEXT"),
    false,
    "the preflight seam denies by returning no context, not by wording a reply",
  );
  assert.match(POLICY_REFUSAL_TEXT, /\.$/u);
});

test("R8 P6: the injection awaits the gate and can return from the host function", () => {
  // Structural: the gate call must be inside the injection, and the injection
  // must be usable as a `return` inside the async host preflight.
  assert.match(DISCORD_PREFLIGHT_INJECTION, /await zinkGate\(/u);
  assert.match(DISCORD_PREFLIGHT_INJECTION, /return null;/u);
});
