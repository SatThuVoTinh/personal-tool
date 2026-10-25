// M12/T9 F-506 (legacy R10-L03-1): the published preflight predicate is a view of
// the registration set, not of whichever guard registered last. A released root's
// traffic must never be decided by another root's guard, and the last unregister
// must leave no predicate behind.
import assert from "node:assert/strict";
import test from "node:test";

import { registerNativeGuard } from "../integrations/openclaw/topology/lib/native-boundary.mjs";

const GATE_KEY = Symbol.for("zink.governance.native.preflightIngress");
const ROOT_A = "f506-root-a";
const ROOT_B = "f506-root-b";

function guard(reason) {
  return {
    beforePreflightIngress: async () => ({ allow: false, reason }),
    beforeToolCall: async () => ({ allow: true }),
    beforeAnnounce: async () => ({ allow: true }),
    recordQuota: async () => ({}),
    selfQuotaReceipt: async () => null,
    resolveRunModel: async () => null,
  };
}

test("F-506: one registration answers an unscoped call", async () => {
  const unregister = registerNativeGuard(ROOT_A, guard("A"));
  const gate = globalThis[GATE_KEY];
  assert.equal(typeof gate, "function", "registering publishes the seam");
  assert.equal((await gate({ agentId: "python" })).reason, "A");
  unregister();
  assert.equal(
    globalThis[GATE_KEY],
    undefined,
    "the only unregister retracts the global",
  );
});

test("F-506: two roots resolve their own predicate and a release never falls through", async () => {
  const unregisterA = registerNativeGuard(ROOT_A, guard("A"));
  const unregisterB = registerNativeGuard(ROOT_B, guard("B"));
  const gate = globalThis[GATE_KEY];
  assert.equal((await gate({ scope: ROOT_A })).reason, "A");
  assert.equal((await gate({ scope: ROOT_B })).reason, "B");
  unregisterA();
  assert.equal(
    await gate({ scope: ROOT_A }),
    undefined,
    "a released root must not be decided by another root's guard",
  );
  assert.equal((await gate({ scope: ROOT_B })).reason, "B");
  unregisterB();
  assert.equal(
    globalThis[GATE_KEY],
    undefined,
    "the last unregister retracts the global",
  );
});

test("F-506: an unscoped call with two registrations decides nothing", async () => {
  const unregisterA = registerNativeGuard(ROOT_A, guard("A"));
  const unregisterB = registerNativeGuard(ROOT_B, guard("B"));
  const gate = globalThis[GATE_KEY];
  assert.equal(
    await gate({ agentId: "python" }),
    undefined,
    "an ambiguous call must leave the late gate to govern instead of guessing a root",
  );
  unregisterA();
  unregisterB();
  assert.equal(globalThis[GATE_KEY], undefined);
});

test("F-506: releasing a replaced registration leaves the survivor published", async () => {
  const unregisterFirst = registerNativeGuard(ROOT_A, guard("first"));
  const unregisterSecond = registerNativeGuard(ROOT_A, guard("second"));
  const gate = globalThis[GATE_KEY];
  assert.equal((await gate({ scope: ROOT_A })).reason, "second");
  unregisterFirst();
  assert.equal(
    (await gate({ scope: ROOT_A })).reason,
    "second",
    "the stale closure must not retract the registration that replaced it",
  );
  unregisterSecond();
  assert.equal(globalThis[GATE_KEY], undefined);
});
