// M12/T9 F-395 (legacy R9-L02-3): the sole-abandoned-spawn lane consumes a
// WORKFLOW_NATIVE_ENDED report, so it must read the report's outcome. It used
// to reconcile any abandoned spawn to FAILED/TRANSIENT_RUNTIME_FAILURE, which
// made an ok child look crashed and made the next-attempt gate authorize a
// second execution of work that had already succeeded.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";

const TASK_ID = "1".repeat(64);
const PARENT_SESSION = "o1-session-1";

// The abandoned attempt as the ledger holds it: the reservation was written,
// the receipt never arrived, so the run has no native identity.
function projected() {
  return {
    tasks: {
      [TASK_ID]: {
        task_id: TASK_ID,
        brief_revision: 1,
        brief_state: "ACTIVE",
        workflow_status: "QUEUED",
        nodes: [],
        delegations: {
          "delegation-abandoned": {
            delegation_id: "delegation-abandoned",
            node_id: "python",
            agent_id: "python",
            brief_revision: 1,
            attempt: 1,
            parent_session_key: PARENT_SESSION,
            run_state: "SPAWN_UNKNOWN",
          },
        },
      },
    },
    sequence: 0,
  };
}

function ended(outcome) {
  return {
    task_id: TASK_ID,
    native_run_id: "python-run-1",
    child_session_key: "python-session-1",
    parent_session_key: PARENT_SESSION,
    outcome,
  };
}

// The next-attempt gate's own predicate (WORKFLOW_SPAWN_RESERVED): an
// unchanged-contract retry is authorized only by a FAILED run in the
// documented transient class.
function retryAuthorized(run) {
  return (
    run.run_state === "FAILED" &&
    run.runtime_reason_code === "TRANSIENT_RUNTIME_FAILURE"
  );
}

describe("M12/T9 F-395 - the abandoned-spawn lane reads the report's outcome", () => {
  it("an ok child reconciles as a successful terminal run and does not authorize a retry", () => {
    const next = applyWorkflowEvent(
      projected(),
      "WORKFLOW_NATIVE_ENDED",
      ended("ok"),
    );
    const run = next.tasks[TASK_ID].delegations["delegation-abandoned"];
    assert.equal(
      run.run_state,
      "COMPLETE",
      "an ok report is the terminal success the matched lane records",
    );
    assert.equal(
      run.runtime_reason_code,
      undefined,
      "a succeeded child carries no runtime failure code",
    );
    assert.equal(
      retryAuthorized(run),
      false,
      "work that succeeded must not be re-executed by the next-attempt gate",
    );
  });

  it("an error child still reconciles as a retryable transient failure", () => {
    const next = applyWorkflowEvent(
      projected(),
      "WORKFLOW_NATIVE_ENDED",
      ended("error"),
    );
    const run = next.tasks[TASK_ID].delegations["delegation-abandoned"];
    assert.equal(run.run_state, "FAILED");
    assert.equal(run.runtime_reason_code, "TRANSIENT_RUNTIME_FAILURE");
    assert.equal(retryAuthorized(run), true);
  });

  it("an unknown outcome is refused instead of being consumed by the reconcile", () => {
    assert.throws(
      () =>
        applyWorkflowEvent(
          projected(),
          "WORKFLOW_NATIVE_ENDED",
          ended("exploded"),
        ),
      { code: "SCHEMA_INVALID" },
      "the lane must not reconcile an attempt from an unvalidated report",
    );
  });
});
