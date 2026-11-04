// M12/T9-R4 lane L7 — F-561 (R10-T07-7): the derived ledger recompute is a
// declared stage of the apply ceremony, inside the mutation boundary.
//
// The defect at HEAD: `operator-apply.mjs` called
// `migrateLedgerProjection(ledgerPaths(stateDir))` at MODULE scope, before
// `applyRuntime` started, so every documented apply wrote the live state root
// before the ceremony's first stage, no preimage covered the tree it wrote,
// and a refusal at `builder-preflight` returned `mutationStarted: false` for
// a run that had already written.
//
// Pinned here, against the injected-dependency orchestration (no WSL, no
// systemctl, no live host — every effect is a harness function):
//
//   1. `ledger-projection` is a declared stage, after `transaction-snapshot`
//      and before `builder-apply`;
//   2. it is the FIRST mutating stage, and every stage before it is
//      non-mutating, so `PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION` holds
//      exactly;
//   3. a pre-flight failure reports `mutationStarted: false` AND changes no
//      file under `operator/m7-t2/ledger/` — the acceptance criterion's lane;
//   4. on the success path the recompute runs after the durable preimage and
//      before the builder writes;
//   5. a failure inside the recompute reports `mutationStarted: true` and
//      rolls back;
//   6. the optional seam keeps older harnesses' call sequences unchanged;
//   7. the driver no longer recomputes at module scope.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The default is the live tree. The red run points this at a pristine HEAD
// extraction (git archive) where the residue is absent.
const TOPO =
  process.env.L7_TOPO_ROOT ??
  path.join(REPO, "integrations", "openclaw", "topology");

const FIXTURES = path.join(TOPO, "fixtures", "runtime-regression");
const orchestration = await import(
  pathToFileURL(path.join(FIXTURES, "apply-orchestration.mjs")).href
);
const { APPLY_STAGES, FIRST_MUTATING_STAGE, applyRuntime, isMutatingStage } =
  orchestration;

function scratchState() {
  return mkdtempSync(path.join(os.tmpdir(), "l7-f561-state-"));
}

function harness(stateDir, overrides = {}) {
  const calls = [];
  const ledgerRoot = path.join(stateDir, "operator", "m7-t2", "ledger");
  const deps = {
    readIdentifiers: () => {
      calls.push("identifiers");
      return {};
    },
    runBuilder: (mode) => {
      calls.push(`runBuilder:${mode}`);
    },
    findOrphanedTransaction: () => [],
    createTransactionSnapshot: () => {
      calls.push("createSnapshot");
      return { kind: "test-snapshot" };
    },
    verifyTransactionSnapshot: () => {
      calls.push("verifySnapshot");
    },
    persistTransactionSnapshot: (snapshot) => {
      calls.push("persistSnapshot");
      return { attemptId: "t-1", status: "STARTED", snapshot };
    },
    restoreTransactionSnapshot: () => {
      calls.push("restoreSnapshot");
    },
    // Stands in for `migrateLedgerProjection(ledgerPaths(stateDir))`: it
    // WRITES under operator/m7-t2/ledger/, exactly the live effect the row is
    // about, inside the scratch root the harness owns.
    recomputeLedgerProjection: () => {
      calls.push("recompute");
      mkdirSync(ledgerRoot, { recursive: true });
      writeFileSync(
        path.join(ledgerRoot, "snapshot.json"),
        '{"derived":true}\n',
        "utf8",
      );
    },
    pruneQuarantine: () => {
      calls.push("pruneQuarantine");
    },
    pruneStaleNativeBackup: () => {
      calls.push("pruneNativeBackup");
    },
    applyNativePatch: () => {
      calls.push("applyNativePatch");
    },
    checkNativePatch: () => {
      calls.push("checkNativePatch");
    },
    restartScopedGateway: () => {
      calls.push("restart");
    },
    verifyLiveRestore: (_snapshot, options) =>
      options?.postApply ? { applied: true } : { restored: true },
    expectedNativePostImage: () => ({}),
    markTransactionComplete: (id) => {
      calls.push(`complete:${id}`);
    },
    classifyReason: (error) => `TEST:${error?.message ?? "ERR"}`,
    ...overrides,
  };
  return { deps, calls, ledgerRoot };
}

test("F-561: the ceremony declares the ledger recompute between the preimage and the builder", () => {
  const ledger = APPLY_STAGES.indexOf("ledger-projection");
  const snapshot = APPLY_STAGES.indexOf("transaction-snapshot");
  const builder = APPLY_STAGES.indexOf("builder-apply");
  assert.ok(ledger !== -1, "ledger-projection must be a declared stage");
  assert.ok(snapshot !== -1 && builder !== -1);
  assert.ok(
    snapshot < ledger && ledger < builder,
    `the recompute must run after the durable preimage and before the builder writes, got ${JSON.stringify(APPLY_STAGES)}`,
  );
});

test("F-561: the first mutating stage is the ledger projection, and every stage before it is non-mutating", () => {
  assert.equal(FIRST_MUTATING_STAGE, "ledger-projection");
  assert.equal(isMutatingStage(FIRST_MUTATING_STAGE), true);
  for (const stage of APPLY_STAGES) {
    if (stage === FIRST_MUTATING_STAGE) break;
    assert.equal(
      isMutatingStage(stage),
      false,
      `stage ${stage} runs before the first mutating stage and must not mutate`,
    );
  }
});

test("F-561: a pre-flight failure reports mutationStarted:false and changes no file under operator/m7-t2/ledger/", async () => {
  const stateDir = scratchState();
  try {
    const { deps, calls, ledgerRoot } = harness(stateDir, {
      runBuilder: (mode) => {
        calls.push(`runBuilder:${mode}`);
        if (mode === "--preflight") throw new Error("Policy drift at models");
      },
    });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.stage, "builder-preflight");
    assert.equal(report.mutationStarted, false);
    assert.equal(report.rollbackRequired, false);
    // The acceptance criterion's lane: mutationStarted:false must be TRUE of
    // the whole tree — the derived ledger cache included.
    assert.equal(
      existsSync(ledgerRoot),
      false,
      "a run reporting mutationStarted:false must not have changed anything under operator/m7-t2/ledger/",
    );
    assert.ok(!calls.includes("recompute"));
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("F-561: the recompute runs after the durable preimage and before the builder writes", async () => {
  const stateDir = scratchState();
  try {
    const { deps, calls, ledgerRoot } = harness(stateDir);
    const report = await applyRuntime(deps);
    assert.equal(report.status, "PASS", JSON.stringify(report));
    assert.equal(report.mutationStarted, true);
    const persist = calls.indexOf("persistSnapshot");
    const recompute = calls.indexOf("recompute");
    const builderApply = calls.indexOf("runBuilder:--apply");
    assert.ok(persist !== -1 && recompute !== -1 && builderApply !== -1);
    assert.ok(
      persist < recompute && recompute < builderApply,
      `the recompute must sit between the durable preimage and the builder's write, got ${JSON.stringify(calls)}`,
    );
    assert.equal(
      existsSync(path.join(ledgerRoot, "snapshot.json")),
      true,
      "the passing run performed the declared recompute",
    );
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("F-561: a failure inside the recompute reports mutationStarted:true and rolls back", async () => {
  const stateDir = scratchState();
  try {
    const { deps, calls } = harness(stateDir, {
      recomputeLedgerProjection: () => {
        calls.push("recompute");
        throw new Error("Ledger state incomplete");
      },
    });
    const report = await applyRuntime(deps);
    assert.equal(report.status, "FAIL");
    assert.equal(report.stage, "ledger-projection");
    assert.equal(
      report.mutationStarted,
      true,
      "the boundary flips BEFORE the recompute runs, so a failure inside it is a mutation-boundary failure",
    );
    assert.equal(report.rollbackRequired, true);
    assert.equal(report.rollbackAttempted, true);
    assert.equal(report.rollbackSucceeded, true);
    assert.ok(calls.includes("restart"), "the rollback restarts the gateway");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("F-561: a harness without the ledger seam keeps its exact call sequence", async () => {
  const stateDir = scratchState();
  try {
    const { deps, calls } = harness(stateDir);
    delete deps.recomputeLedgerProjection;
    const report = await applyRuntime(deps);
    assert.equal(report.status, "PASS", JSON.stringify(report));
    assert.ok(!calls.includes("recompute"));
    assert.ok(calls.includes("runBuilder:--apply"));
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("F-561: the driver no longer recomputes the ledger at module scope", () => {
  const source = readFileSync(
    path.join(FIXTURES, "operator-apply.mjs"),
    "utf8",
  );
  const applyRuntimeCall = source.indexOf("await applyRuntime(");
  const recomputeCall = source.indexOf(
    "migrateLedgerProjection(ledgerPaths(stateDir))",
  );
  assert.ok(applyRuntimeCall !== -1, "the driver must call applyRuntime");
  assert.ok(
    recomputeCall !== -1,
    "the driver must still recompute the derived snapshot (the ceremony needs it)",
  );
  assert.ok(
    applyRuntimeCall < recomputeCall,
    "the recompute must live inside the ceremony's dependency, not at module scope before applyRuntime",
  );
  assert.ok(
    source.includes("recomputeLedgerProjection"),
    "the driver must wire the recompute as the ceremony's ledger-projection dependency",
  );
});
