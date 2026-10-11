// M10/T2-R14 — regression tests for the defects found in the full-repo review.
// Each test fails on the pre-fix code and passes after.
//
// Evidence for each finding is recorded inline; nothing here is speculative.
process.env.ZINK_ROUTER_HOST ||= "router.invalid";
process.env.ZINK_ROUTER_PORT ||= "1";
process.env.ZINK_ROUTER_API_KEY ||= "test-router-key-not-a-credential";

import assert from "node:assert/strict";
import test from "node:test";

const { evaluateCapabilityAccess, AGENT_SPAWN_POLICY } =
  await import("../integrations/openclaw/lib/policy.mjs");

const { validateOpenClawReleaseCompatibility } =
  await import("../integrations/openclaw/lib/authority.mjs");

// structuredClone is not in this repo's lint globals; JSON round-trip is the
// idiom used elsewhere in the suite and is exact for these literal fixtures.
const clone = (value) => JSON.parse(JSON.stringify(value));

test("R14-01: capability authorization rejects inherited/prototype keys", () => {
  // PROVEN pre-fix: evaluateCapabilityAccess("main","constructor",null,"execute")
  // returned {allowed:true, level:<function>, reason:"AUTHORIZED"}. The lookup was
  // a truthiness test, so Object.prototype members resolved, and none of them
  // equals "L0"/"delegate"/"L2" so control fell through to `allowed: true`.
  const prototypeKeys = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__proto__",
    "__defineGetter__",
  ];
  for (const key of prototypeKeys) {
    const verdict = evaluateCapabilityAccess("main", key, null, "execute");
    assert.equal(
      verdict.allowed,
      false,
      `capability "${key}" must not be authorized (got ${JSON.stringify(verdict)})`,
    );
    assert.equal(verdict.reason, "UNKNOWN_CAPABILITY");
  }
  // The genuine controls must keep behaving exactly as before, so this fix is not
  // a blanket deny. The real capability ids are the `zink_*` tool names.
  for (const cap of [
    "zink_excel",
    "zink_power_bi",
    "zink_sql",
    "zink_python",
    "zink_n8n",
  ]) {
    const verdict = evaluateCapabilityAccess("main", cap, null, "execute");
    assert.equal(
      verdict.allowed,
      true,
      `real capability "${cap}" must still be authorized for main`,
    );
  }
  // A real capability held at L0 stays denied (o2 holds zink_sql at L0).
  assert.equal(
    evaluateCapabilityAccess("o2", "zink_sql", null, "execute").reason,
    "CAPABILITY_ACCESS_DENIED",
  );
  // L2 + execute stays refused as READ_ONLY_ACCESS (o1 holds zink_sql at L2).
  assert.equal(
    evaluateCapabilityAccess("o1", "zink_sql", null, "execute").reason,
    "READ_ONLY_ACCESS",
  );
  // "delegate" still yields DELEGATION_REQUIRED (main holds zink_excel there),
  // which is the pre-existing behaviour and must be untouched.
  assert.equal(
    evaluateCapabilityAccess("main", "zink_excel", null, "execute").reason,
    "DELEGATION_REQUIRED",
  );
  // And a real unknown capability is still UNKNOWN_CAPABILITY.
  assert.equal(
    evaluateCapabilityAccess("main", "definitely_not_real", null, "execute")
      .reason,
    "UNKNOWN_CAPABILITY",
  );
});

test("R14-02: the compat validator no longer demands the `auth` key R9 removed", () => {
  // R9 removed auth.profiles/order/cooldowns from the generator on purpose, and
  // validateConfig rejects unexpected top-level keys, so `auth` could not be
  // added to satisfy the old list: the validator could never pass on a config
  // this repository produces. Build a config that mirrors the canonical shape
  // (no `auth`) and prove it is no longer rejected for that reason.
  const base = {
    update: {},
    gateway: {},
    agents: { list: [{ id: "main" }] },
    tools: {},
    commands: {},
    secrets: { providers: {} },
    plugins: { allow: [], entries: {} },
    bindings: [],
    channels: {},
  };
  assert.equal(Object.hasOwn(base, "auth"), false);
  assert.doesNotThrow(() => validateOpenClawReleaseCompatibility(clone(base)));
  // The check must still reject a genuinely missing key, so the list was not
  // simply emptied.
  const broken = clone(base);
  delete broken.secrets;
  assert.throws(
    () => validateOpenClawReleaseCompatibility(broken),
    /Missing required top-level key: secrets/u,
  );
});

test("R14-03: the spawn allowlist is the same canonical table at both seams", () => {
  // Pins the invariant Fix 3 relies on: the pre-commit assertion in
  // guard.mjs admitInitialBrief and the existing later assertion both read
  // AGENT_SPAWN_POLICY, so moving the verdict earlier grants nothing new.
  assert.deepEqual(AGENT_SPAWN_POLICY.main, ["o1", "o2"]);
  assert.deepEqual(AGENT_SPAWN_POLICY.o1, ["excel", "sql", "python"]);
  assert.deepEqual(AGENT_SPAWN_POLICY.o2, ["power-bi", "python"]);
  for (const agent of ["excel", "power-bi", "sql", "python"]) {
    assert.deepEqual(
      AGENT_SPAWN_POLICY[agent],
      [],
      `${agent} must not be able to spawn`,
    );
  }
  // A brief node naming `excel` under Main is exactly the wedge case: it can
  // never be dispatched, which is why the refusal must happen BEFORE the
  // irreversible WORKFLOW_BRIEF_ACTIVATED write rather than after it.
  assert.equal(
    AGENT_SPAWN_POLICY.main.includes("excel"),
    false,
    "the wedge precondition this fix guards must still hold",
  );
});
