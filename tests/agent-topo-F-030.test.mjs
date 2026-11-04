// M12/T9 F-030 (legacy R1-A11-04) - a cancel record may not claim any channel
// and any message id.
//
// MEASURED AT HEAD: `ledger-event.schema.json` declared the WORKFLOW_CANCELLED
// payload's `channel` and `message_id` as bare strings, and the reducer listed
// both as optional keys without checking either, so a cancel record could name
// a fabricated surface and a fabricated message id - while every other verdict
// is bound to a real one.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";
import { applyWorkflowEvent } from "../integrations/openclaw/topology/lib/workflow.mjs";
import {
  canonicalHash,
  deriveTaskId,
} from "../integrations/openclaw/topology/lib/canonical.mjs";

const OPENED = {
  origin: "discord",
  origin_principal_ref: "a".repeat(64),
  origin_message_id: "123456789012345678",
  root_agent_id: "main",
  root_session_key: "root-session",
  root_run_id: "root-run",
};

function opened() {
  const payload = { ...OPENED };
  const task_id = deriveTaskId(payload);
  const snapshot = applyWorkflowEvent(
    { tasks: {}, sequence: 0 },
    "WORKFLOW_OPENED",
    {
      ...payload,
      task_id,
    },
  );
  return { task_id, snapshot };
}

const cancel = (task_id, extra = {}) => ({
  task_id,
  reason_code: "OWNER_CANCELLED",
  actor: "user",
  ...extra,
});

const event = (task_id, payload) => {
  const body = {
    schema_version: "1.0.0",
    governance_version: "m8-t2.3-r5",
    sequence: 1,
    type: "WORKFLOW_CANCELLED",
    payload,
    created_at: "2026-09-29T00:00:00.000Z",
    previous_event_digest: null,
  };
  return { ...body, event_digest: canonicalHash("zink-ledger-event-v1", body) };
};

describe("F-030 - a cancel record is bound to a real surface", () => {
  it("the contract refuses a fabricated channel and message id", () => {
    const { task_id } = opened();
    assert.throws(
      () =>
        validateContract(
          "ledger-event",
          event(
            task_id,
            cancel(task_id, {
              channel: "fabricated-channel",
              message_id: "not-a-snowflake",
            }),
          ),
        ),
      { code: "SCHEMA_VALIDATION_FAILED" },
    );
    assert.equal(
      validateContract(
        "ledger-event",
        event(
          task_id,
          cancel(task_id, {
            channel: "approvals",
            message_id: "123456789012345678",
          }),
        ),
      ),
      true,
    );
    // The channel and the message id are pinned SEPARATELY: a payload that
    // carries only a fabricated channel, and one that carries only a
    // fabricated message id, are each refused on their own.
    assert.throws(
      () =>
        validateContract(
          "ledger-event",
          event(task_id, cancel(task_id, { channel: "fabricated-channel" })),
        ),
      { code: "SCHEMA_VALIDATION_FAILED" },
      "a fabricated channel alone must be refused",
    );
    assert.throws(
      () =>
        validateContract(
          "ledger-event",
          event(task_id, cancel(task_id, { message_id: "not-a-snowflake" })),
        ),
      { code: "SCHEMA_VALIDATION_FAILED" },
      "a fabricated message id alone must be refused",
    );
  });

  it("the reducer refuses a fabricated channel", () => {
    const { task_id, snapshot } = opened();
    assert.throws(
      () =>
        applyWorkflowEvent(
          snapshot,
          "WORKFLOW_CANCELLED",
          cancel(task_id, { channel: "fabricated-channel" }),
        ),
      { code: "SCHEMA_INVALID" },
    );
  });

  it("the reducer refuses a fabricated message id", () => {
    const { task_id, snapshot } = opened();
    assert.throws(
      () =>
        applyWorkflowEvent(
          snapshot,
          "WORKFLOW_CANCELLED",
          cancel(task_id, { message_id: "not-a-snowflake" }),
        ),
      { code: "SCHEMA_INVALID" },
    );
  });

  it("a cancellation without surface provenance is still accepted", () => {
    const { task_id, snapshot } = opened();
    const cancelled = applyWorkflowEvent(
      snapshot,
      "WORKFLOW_CANCELLED",
      cancel(task_id),
    );
    assert.equal(cancelled.tasks[task_id].workflow_status, "CANCELLED");
  });
});
