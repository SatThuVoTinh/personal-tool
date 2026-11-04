// M12/T2.2 B-16 — the native-boundary seams must say WHY the guard denied.
//
// `K01` / `R1-A13-03` / `R1-A12-07`: the boundary calls the guard, gets a
// verdict that carries a canonical reason code, and then throws a fixed string
// that names only the class of failure. A live run-admission denial therefore
// reaches the operator as `[zink-native-gate] enterNativeRun: GOVERNANCE_DENIED`
// even though `authenticateIngress` had answered
// `{ allow: false, reason: "NON_MAIN_DIRECT_INGRESS" }`, and an announce
// `discard` is dropped without a word at all. That is the attribution collapse
// the six-round audit kept re-deriving from the live logs.
//
// The fix is diagnostic-only, and these tests pin both halves of that promise:
// the guard's reason must reach the log line, and every host-visible value —
// the thrown codes, the returned announce verdict — must stay byte-identical,
// because the host renders them and the pinned suites compare them strictly.
// The reason is echoed only when it matches the closed governance-code grammar
// this file already applies at the tool-gate seam; anything else is reported as
// undeclared, so no caller text, path, or credential can enter the log (§10).
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  enterNativeRun,
  finishNativeRun,
  gateNativeAnnounce,
  registerNativeGuard,
  sanitizeNativePrompt,
} from "../integrations/openclaw/topology/lib/native-boundary.mjs";

function tempRoot(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function guardedConfig(scope) {
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

async function captureConsoleError(run) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(" "));
  try {
    const value = await run();
    return { value, error: undefined, lines };
  } catch (error) {
    return { value: undefined, error, lines };
  } finally {
    console.error = original;
  }
}

/**
 * `registerNativeGuard` fails closed unless the mandatory capabilities exist,
 * so every fixture starts from a complete guard and overrides one seam.
 */
function baseGuard(overrides) {
  return {
    beforeToolCall: () => ({ allow: true }),
    beforeAnnounce: () => ({ action: "deliver", receipt: "receipt" }),
    beforeRunEnd: () => ({ allow: true }),
    beforeIngress: () => ({ prompt: "prompt" }),
    recordQuota: () => ({ recorded: true }),
    selfQuotaReceipt: () => ({ receipt: "quota" }),
    resolveRunModel: () => ({ model: "fixture-model" }),
    ...overrides,
  };
}

/** Drive one seam with a guard whose verdict is `overrides`, and collect logs. */
async function drive(prefix, overrides, call) {
  const scope = tempRoot(prefix);
  const unregister = registerNativeGuard(scope, baseGuard(overrides));
  try {
    return await captureConsoleError(() => call(guardedConfig(scope)));
  } finally {
    unregister();
    rmSync(scope, { recursive: true, force: true });
  }
}

const RUN_CONTEXT = {
  agentId: "main",
  sessionKey: "session-1",
  runId: "run-1",
};
const END_EVENT = { runId: "run-1", outcome: "ok" };

test("B-16 1: a run-admission denial names the guard's reason", async () => {
  const { error, lines } = await drive(
    "b16-run-",
    { beforeRun: () => ({ allow: false, reason: "NON_MAIN_DIRECT_INGRESS" }) },
    (config) => enterNativeRun(config, RUN_CONTEXT, undefined),
  );
  // The thrown texts are the host-visible contract and must not move.
  assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
  assert.equal(error.cause.message, "GOVERNANCE_DENIED");
  assert.match(
    lines.join("\n"),
    /enterNativeRun denied: reason=NON_MAIN_DIRECT_INGRESS/u,
    "the admission denial carried no reason, so the operator sees only the class",
  );
});

test("B-16 2: a run-end denial names the guard's reason", async () => {
  const { error, lines } = await drive(
    "b16-end-",
    { beforeRunEnd: () => ({ allow: false, reason: "LINEAGE_MISMATCH" }) },
    (config) => finishNativeRun(config, END_EVENT, RUN_CONTEXT),
  );
  assert.equal(error.message, "GOVERNANCE_COMPLETION_UNAVAILABLE");
  assert.equal(error.cause.message, "GOVERNANCE_DENIED");
  assert.match(
    lines.join("\n"),
    /finishNativeRun denied: reason=LINEAGE_MISMATCH/u,
    "the run-end denial carried no reason",
  );
});

test("B-16 3: an announce discard is no longer silent", async () => {
  const { value, lines } = await drive(
    "b16-discard-",
    {
      beforeAnnounce: () => ({
        action: "discard",
        reason: "ANNOUNCE_DUPLICATE",
      }),
    },
    (config) => gateNativeAnnounce(config, { runId: "run-2" }, undefined),
  );
  // The verdict shape the host reads is unchanged.
  assert.deepEqual(value, { governed: true, action: "discard" });
  assert.match(
    lines.join("\n"),
    /gateNativeAnnounce discarded: reason=ANNOUNCE_DUPLICATE/u,
    "a discarded announce produced no diagnostic at all",
  );
});

test("B-16 4: a refused announce receipt says whether a reason was declared", async () => {
  const { value, error, lines } = await drive(
    "b16-receipt-",
    { beforeAnnounce: () => ({ action: "deliver" }) },
    (config) => gateNativeAnnounce(config, { runId: "run-3" }, undefined),
  );
  assert.equal(error, undefined);
  assert.deepEqual(value, { governed: true, action: "block" });
  assert.match(
    lines.join("\n"),
    /gateNativeAnnounce refused: reason=REASON_UNDECLARED/u,
    "a blocked announce produced no attributable refusal",
  );
});

test("B-16 5: an unusable ingress verdict names the guard's reason", async () => {
  const { error, lines } = await drive(
    "b16-ingress-",
    { beforeIngress: () => ({ allow: false, reason: "PROMPT_REJECTED" }) },
    (config) => sanitizeNativePrompt(config, "hello"),
  );
  assert.equal(error.message, "GOVERNANCE_INGRESS_UNAVAILABLE");
  assert.equal(error.cause.message, "SCHEMA_INVALID");
  assert.match(
    lines.join("\n"),
    /sanitizeNativePrompt refused: reason=PROMPT_REJECTED/u,
    "the ingress verdict refusal carried no reason",
  );
});

test("B-16 6: a reason that is not a governance code is never echoed", async () => {
  const leaked = "read the file at /mnt/c/Users/me/vault note";
  for (const bad of [
    leaked,
    "lowercase_code",
    "TOO_LONG_".padEnd(65, "X"),
    42,
    { nested: "object" },
    undefined,
  ]) {
    const { error, lines } = await drive(
      "b16-class-",
      { beforeRun: () => ({ allow: false, reason: bad }) },
      (config) => enterNativeRun(config, RUN_CONTEXT, undefined),
    );
    assert.equal(error.message, "GOVERNANCE_RUN_UNAVAILABLE");
    assert.match(
      lines.join("\n"),
      /enterNativeRun denied: reason=REASON_UNDECLARED/u,
      `a non-canonical reason (${String(bad)}) was neither sanitized nor flagged`,
    );
    assert.equal(
      lines.join("\n").includes("vault"),
      false,
      "caller-supplied text reached the diagnostic channel",
    );
  }
});

test("B-16 7: a guard that throws is attributed by its own message, not by an invented reason", async () => {
  const fault = new Error("Stale ledger snapshot");
  const { error, lines } = await drive(
    "b16-throw-",
    {
      beforeRunEnd: () => {
        throw fault;
      },
    },
    (config) => finishNativeRun(config, END_EVENT, RUN_CONTEXT),
  );
  assert.equal(error.message, "GOVERNANCE_COMPLETION_UNAVAILABLE");
  assert.equal(error.cause, fault);
  const joined = lines.join("\n");
  assert.match(joined, /finishNativeRun: Stale ledger snapshot/u);
  assert.equal(
    joined.includes("REASON_UNDECLARED"),
    false,
    "a thrown guard fault has no verdict to read, so no reason line belongs here",
  );
});
