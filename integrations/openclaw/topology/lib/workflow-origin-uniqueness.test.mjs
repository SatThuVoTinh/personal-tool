import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyWorkflowEvent } from "./workflow.mjs";

const emptyProjection = () => ({ tasks: {}, sequence: 0 });

const DATE = "13102026";
const SUFFIX = "CDEF";

function openPayload(taskId, overrides = {}) {
  return {
    task_id: taskId,
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "1234567890123456789",
    root_agent_id: "main",
    root_session_key: "root-session",
    root_run_id: "root-run",
    ...overrides,
  };
}

describe("F-OC-006: reducer enforces origin-binding uniqueness", () => {
  it("same task_id with same lineage is idempotent", () => {
    const id = `${DATE}${SUFFIX}`;
    const payload = openPayload(id);
    const first = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      payload,
      "2026-10-13T02:00:00.000Z",
      "current",
    );
    const replay = applyWorkflowEvent(
      first,
      "WORKFLOW_OPENED",
      payload,
      "2026-10-13T02:00:01.000Z",
      "current",
    );
    assert.deepEqual(replay, first);
  });

  it("different task_id with same origin binding throws ORIGIN_BINDING_CONFLICT", () => {
    const id1 = `${DATE}${SUFFIX}`;
    const id2 = `${DATE}JKMN`;
    const payload1 = openPayload(id1);
    const first = applyWorkflowEvent(
      emptyProjection(),
      "WORKFLOW_OPENED",
      payload1,
      "2026-10-13T02:00:00.000Z",
      "current",
    );
    const payload2 = openPayload(id2);
    assert.throws(
      () =>
        applyWorkflowEvent(
          first,
          "WORKFLOW_OPENED",
          payload2,
          "2026-10-13T02:00:01.000Z",
          "current",
        ),
      (err) => {
        assert.equal(err.code, "ORIGIN_BINDING_CONFLICT");
        return true;
      },
    );
  });
});
