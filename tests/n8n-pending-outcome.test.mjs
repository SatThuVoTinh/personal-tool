import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  invokeN8n,
  N8nAdapterError,
  classifyWorkflowState,
  classifyWorkflowOutcome,
} from "../zink-tools/n8n/trigger.mjs";
import { validateContractSchema } from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_RESULT_ENVELOPE_MAX_BYTES } from "../integrations/openclaw/topology/lib/schema.mjs";

const Response = globalThis.Response;

/**
 * F-235 (R7-D5-01) — `zink_n8n` reported tool success the moment a workflow
 * was accepted.
 *
 * Measured at HEAD: `validateWorkflowOutputData` required only a non-empty
 * `data.status` string and the success envelope was returned unconditionally
 * afterwards, so a loopback 200 carrying `{ data: { ingest_id: "i", status:
 * "accepted" } }` was reported to the owner as completed work.
 */

const decisionContext = {
  scope: {
    common: {
      taskId: "task-01",
      sessionKey: "sess-01",
      runId: "run-01",
      agentId: "o2",
      toolId: "zink_n8n",
    },
    delegated: { delegationId: "del-01" },
  },
  correlation: { call_id: "00000000-0000-4000-8000-000000000001" },
  effective_constraints: { timeout_ms: 5000, memory_mb: 512 },
};

/**
 * A loopback response carrying the given upstream data.
 *
 * @param {object} data
 * @returns {() => Promise<Response>}
 */
function upstream(data) {
  return async () =>
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

const ingestInput = {
  workflow_id: "data_plant_ingest",
  payload: { source: "src-01", dataset: "ds-01" },
};

describe("F-235 (R7-D5-01) — an accepted workflow is pending, never success", () => {
  test("F-235: a non-terminal status cannot produce tool success", async () => {
    const res = await invokeN8n(decisionContext, ingestInput, {
      fetchImpl: upstream({ ingest_id: "i-1", status: "accepted" }),
    });
    assert.notEqual(res.status, "success");
    assert.equal(res.status, "error");
    assert.equal(res.error.code, "N8N_WORKFLOW_PENDING");
    assert.match(res.error.message, /not terminal/u);
    assert.equal(res.output, undefined, "a pending run publishes no output");
  });

  test("F-235: the pending envelope passes the tool-result contract", async () => {
    const res = await invokeN8n(decisionContext, ingestInput, {
      fetchImpl: upstream({ ingest_id: "i-1", status: "accepted" }),
    });
    assert.equal(
      validateContractSchema(
        "tool-result",
        res,
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
    );
  });

  test("F-235: every non-terminal spelling is pending", async () => {
    for (const status of [
      "PENDING",
      "queued",
      "accepted",
      "running",
      "in_progress",
      "processing",
      "started",
      "something-unknown",
    ]) {
      assert.equal(classifyWorkflowState(status), "pending", status);
    }
  });

  test("F-235: a terminal completion is still reported as success", async () => {
    for (const status of ["completed", "COMPLETED", "success", "succeeded"]) {
      const res = await invokeN8n(decisionContext, ingestInput, {
        fetchImpl: upstream({ ingest_id: "i-1", status }),
      });
      assert.equal(res.status, "success", status);
    }
  });

  test("F-235: a terminal failure is reported as an upstream error", async () => {
    await assert.rejects(
      () =>
        invokeN8n(decisionContext, ingestInput, {
          fetchImpl: upstream({ ingest_id: "i-1", status: "failed" }),
        }),
      { code: "N8N_UPSTREAM_ERROR" },
    );
  });

  test("F-235: an undelivered notification is a failure, not a success", async () => {
    await assert.rejects(
      () =>
        invokeN8n(
          decisionContext,
          {
            workflow_id: "pipeline_notify",
            payload: { event: "e", severity: "info", message: "m" },
          },
          { fetchImpl: upstream({ delivered: false }) },
        ),
      { code: "N8N_UPSTREAM_ERROR" },
    );
  });

  test("F-235: the outcome classifier is the single decision point", () => {
    assert.equal(
      classifyWorkflowOutcome("data_plant_ingest", {
        ingest_id: "i-1",
        status: "accepted",
      }),
      "pending",
    );
    assert.equal(
      classifyWorkflowOutcome("data_plant_ingest", {
        ingest_id: "i-1",
        status: "completed",
      }),
      "success",
    );
    assert.equal(
      classifyWorkflowOutcome("pipeline_notify", { delivered: true }),
      "success",
    );
    assert.equal(
      classifyWorkflowOutcome("data_plant_ingest", { ingest_id: "i-1" }),
      null,
      "invalid data is not an outcome",
    );
  });

  test("F-235: the adapter still refuses a malformed upstream payload", async () => {
    await assert.rejects(
      () =>
        invokeN8n(decisionContext, ingestInput, {
          fetchImpl: upstream({ ingest_id: "i-1" }),
        }),
      (err) => {
        assert.ok(err instanceof N8nAdapterError);
        assert.equal(err.code, "SCHEMA_VALIDATION_FAILED");
        return true;
      },
    );
  });
});
