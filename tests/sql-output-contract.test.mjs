import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { validateContractSchema } from "../integrations/openclaw/topology/lib/guard.mjs";
import { TOOL_RESULT_ENVELOPE_MAX_BYTES } from "../integrations/openclaw/topology/lib/schema.mjs";
import { executeGovernedDuckDbQuery } from "../zink-tools/sql/duckdb-bridge.mjs";

/**
 * F-144 (R1-A10-02) — every successful `zink_sql` result was rejected by its
 * own output contract: success was punished and failure passed.
 *
 * Measured at HEAD: `zink-sql.schema.json` required `rows` to be an array of
 * OBJECTS and closed the output object, while the bridge emits an array of
 * value arrays plus five undeclared keys (`execution_state`, `data_source`,
 * `execution_ms`, `provider`, `target_database`). The bridge's row shape is
 * pinned by the repository's own lane (`tests/duckdb-bridge.test.mjs`
 * asserts `rows` deep-equals `[[1, "artifact-alpha"]]`), so the CONTRACT was
 * the side that was wrong; it now declares the shape the bridge emits.
 */

const context = { agent_id: "sql", task_id: "task-test-01" };

describe("F-144 (R1-A10-02) — a successful zink_sql result passes its own contract", () => {
  test("F-144: the bridge's own envelope passes the tool-result contract", async () => {
    const result = await executeGovernedDuckDbQuery(context, {
      query: "SELECT id, name FROM knowledge",
      target_database: "knowledge",
    });
    const envelope = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_sql",
      specialist: "sql",
      status: "success",
      output: result,
      artifacts: [],
    };
    assert.equal(
      validateContractSchema(
        "tool-result",
        envelope,
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
      "a successful zink_sql run must not be reported as INVALID_OUTPUT_SCHEMA",
    );
  });

  test("F-144: the simulation envelope passes the same contract", async () => {
    const result = await executeGovernedDuckDbQuery(
      context,
      { query: "SELECT id, name FROM knowledge", target_database: "knowledge" },
      { simulationMode: true },
    );
    const envelope = {
      call_id: "00000000-0000-4000-8000-000000000001",
      tool_id: "zink_sql",
      specialist: "sql",
      status: "success",
      output: result,
      artifacts: [],
    };
    assert.equal(
      validateContractSchema(
        "tool-result",
        envelope,
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
    );
  });

  test("F-144: an envelope that is not a declared row shape is still refused", async () => {
    await assert.throws(() =>
      validateContractSchema(
        "tool-result",
        {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          status: "success",
          output: { row_count: 1, columns: ["id"], rows: [42] },
          artifacts: [],
        },
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
    );
  });

  test("F-144: the contract still accepts the keyed row shape the other lane pins", async () => {
    assert.equal(
      validateContractSchema(
        "tool-result",
        {
          call_id: "00000000-0000-4000-8000-000000000001",
          tool_id: "zink_sql",
          specialist: "sql",
          status: "success",
          output: { row_count: 1, columns: ["col"], rows: [{ col: "val" }] },
          artifacts: [],
        },
        TOOL_RESULT_ENVELOPE_MAX_BYTES,
      ),
      true,
    );
  });
});
