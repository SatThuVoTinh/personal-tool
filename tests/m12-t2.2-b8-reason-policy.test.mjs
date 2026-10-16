import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  AGENT_REASON_CODES,
  RUNTIME_REASON_CODES,
  isDeclaredReasonCode,
  loadReasonPolicy,
} from "../integrations/openclaw/topology/lib/runtime.mjs";

// R1-A04-06, as re-scoped after verification. The matrix already existed and was already
// wired, so this item is not "build a matrix": it is (1) the load, which used to crash
// module evaluation with a raw fs/JSON error and could silently return a policy missing the
// keys callers read, and (2) one event handler that accepted any non-empty 128-character
// string as a reason code while the rest of the file went through the declared vocabulary.
// The emitter half was dropped: enforcing `reasonEmitterAllowed` today would require adding
// codes to the published matrix, which is an owner decision, not a side effect.

function withPolicyDirectory(callback) {
  const root = mkdtempSync(path.join(tmpdir(), "m12-t2.2-b8-policy-"));
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the shipped matrix still loads, so the guard cannot reject real policy", () => {
  const policy = loadReasonPolicy();
  assert.ok(Array.isArray(policy.agent_claims));
  assert.ok(Array.isArray(policy.runtime_reasons));
  assert.equal(typeof policy.outcome_compatibility, "object");
});

test("a missing matrix is a named load error, not a module-evaluation crash", () => {
  withPolicyDirectory((root) => {
    const missing = pathToFileURL(path.join(root, "absent.json"));
    assert.throws(
      () => loadReasonPolicy(missing),
      /REASON_POLICY_UNREADABLE/u,
      "the error must name the condition",
    );
  });
});

test("a malformed matrix is a named load error, not a bare JSON traceback", () => {
  withPolicyDirectory((root) => {
    const file = path.join(root, "broken.json");
    writeFileSync(file, "{ this is not json");
    assert.throws(
      () => loadReasonPolicy(pathToFileURL(file)),
      /REASON_POLICY_MALFORMED/u,
    );
  });
});

test("a matrix missing a key the runtime reads is refused instead of freezing undefined", () => {
  withPolicyDirectory((root) => {
    const file = path.join(root, "incomplete.json");
    writeFileSync(file, JSON.stringify({ agent_claims: ["NONE"] }));
    assert.throws(
      () => loadReasonPolicy(pathToFileURL(file)),
      /REASON_POLICY_INCOMPLETE/u,
    );
  });
});

test("reason codes are declared or they are not accepted", () => {
  assert.equal(isDeclaredReasonCode("POLICY_DENIED"), true); // agent_claims
  assert.equal(isDeclaredReasonCode("OWNER_CANCELLED"), true); // runtime_reasons
  assert.equal(isDeclaredReasonCode("MATRIX_TERMINAL"), false);
  assert.equal(isDeclaredReasonCode(""), false);
  assert.equal(isDeclaredReasonCode(undefined), false);
  assert.equal(isDeclaredReasonCode(42), false);
});

test("the two published vocabularies are what the check reads, not a private copy", () => {
  for (const code of AGENT_REASON_CODES) {
    assert.equal(isDeclaredReasonCode(code), true, code);
  }
  for (const code of RUNTIME_REASON_CODES) {
    assert.equal(isDeclaredReasonCode(code), true, code);
  }
});
