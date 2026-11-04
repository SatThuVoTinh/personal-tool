// M12/T9 F-114 - Discord root tasks were opened DURABLY inside the admission
// predicate.
//
// The plugin wrote WORKFLOW_OPENED before it asked the guard for a verdict, so
// a REFUSED admission left a task whose whole event history was one
// WORKFLOW_OPENED - and the ledger is append-only, so nothing could take it
// back.
//
// The fix is shape (a): the guard evaluates a PROSPECTIVE root task - the task
// the caller is about to open - and the caller opens it AFTER the verdict. The
// guard writes nothing while it evaluates the claim, so a refused admission
// leaves the sequence and the task count untouched.
//
// The lanes below prove:
//   1. a run with a matching prospective task is ADMITTED;
//   2. the admission writes NOTHING: the sequence and the task count are
//      unchanged, so a denied admission leaves the ledger untouched;
//   3. a prospective task that names another identity is REFUSED;
//   4. the signature the plugin agent calls is stable.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGovernanceGuard } from "../integrations/openclaw/topology/lib/guard.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import { TOOL_POLICY } from "../integrations/openclaw/lib/policy.mjs";

const TASK_ID = "20261021ABCD1234";

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "f114-guard-"));
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const guard = createGovernanceGuard({
    paths,
    manifestFor: (agentId) => ({
      expected_governance_hash: "0".repeat(64),
      observed_governance_hash: "0".repeat(64),
      allowed_tools: TOOL_POLICY[agentId] ?? [],
    }),
  });
  return { root, paths, guard };
}

const context = {
  agentId: "main",
  sessionKey: "agent:main:sess-1",
  runId: "run-1",
};

const prospectiveTask = {
  task_id: TASK_ID,
  brief_revision: 1,
  brief_state: "ACTIVE",
  root_agent_id: "main",
  root_session_key: "agent:main:sess-1",
  root_run_id: "run-1",
};

test("F-114: a run with a matching prospective task is admitted", () => {
  const { root, paths, guard } = fixture();
  try {
    const verdict = guard.beforeRun({}, context, undefined, {
      prospectiveTask,
    });
    assert.equal(verdict.allow, true, "the run must be admitted");
    // The ledger is untouched: the task is opened by the caller AFTER the
    // verdict, so the admission itself records nothing.
    const after = readSnapshot(paths);
    assert.equal(after.sequence, 0, "the admission must not write an event");
    assert.deepEqual(
      Object.keys(after.tasks),
      [],
      "the admission must not leave a task behind",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-114: a refused admission leaves the sequence and the task count untouched", () => {
  const { root, paths, guard } = fixture();
  try {
    const before = readSnapshot(paths);
    let thrown = null;
    try {
      guard.beforeRun({}, context, undefined, {
        prospectiveTask: {
          ...prospectiveTask,
          // The claim names ANOTHER run: it must not be admitted.
          root_run_id: "run-other",
        },
      });
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "a mismatched prospective task must be refused");
    assert.equal(thrown.message, "LINEAGE_MISMATCH");
    const after = readSnapshot(paths);
    assert.equal(after.sequence, before.sequence);
    assert.equal(Object.keys(after.tasks).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-114: a prospective task for another agent or session is refused", () => {
  const { root, guard } = fixture();
  try {
    for (const override of [
      { root_agent_id: "o1" },
      { root_session_key: "agent:main:other" },
      { brief_state: "CLOSED" },
    ]) {
      let thrown = null;
      try {
        guard.beforeRun({}, context, undefined, {
          prospectiveTask: { ...prospectiveTask, ...override },
        });
      } catch (error) {
        thrown = error;
      }
      assert.ok(
        thrown,
        `a prospective task with ${JSON.stringify(override)} must be refused`,
      );
      assert.notEqual(thrown.message, "EXECUTION_STATE_UNKNOWN");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("F-114: the options may be passed as the third or the fourth argument", () => {
  const { root, guard } = fixture();
  try {
    assert.equal(
      guard.beforeRun({}, context, { prospectiveTask }).allow,
      true,
      "the options may be the third argument when it is not a signal",
    );
    assert.equal(
      guard.beforeRun({}, context, undefined, { prospectiveTask }).allow,
      true,
      "the options may be the fourth argument",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
