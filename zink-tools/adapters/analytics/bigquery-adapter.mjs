import {
  assertDuckDbCallerAuthorized,
  assertDuckDbResourceAuthorized,
  DUCKDB_MAX_TIMEOUT_MS,
} from "../../sql/duckdb-bridge.mjs";
import { assertReadOnlyStatement } from "../../sql/validator.mjs";
import { EXECUTION_STATE_SIMULATED } from "../../common/execution-state.mjs";

export class BigQueryAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BigQueryAdapterError";
    this.code = code;
  }
}

export const BIGQUERY_DEFAULT_TIMEOUT_MS = 15000;
export const BIGQUERY_MAX_ROWS = 1000;

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * BigQuery integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed BigQuery Adapter
 * Cloud analytical SQL execution behind zink_sql capability.
 */
export class BigQueryAdapter {
  constructor(options = {}) {
    this.projectId = options.projectId || "personal-tool-prod";
    this.location = options.location || "US";
  }

  /**
   * Executes a bounded query on BigQuery.
   *
   * @param {object} context
   * @param {object} input
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async executeQuery(context, input, options = {}) {
    const startTime = Date.now();

    // 1. Authorize caller
    try {
      assertDuckDbCallerAuthorized(context?.agent_id);
    } catch (err) {
      throw new BigQueryAdapterError(
        "BIGQUERY_UNAUTHORIZED_CALLER",
        `Caller '${context?.agent_id}' is not authorized for SQL capabilities: ${err.message}`,
      );
    }

    if (!input?.query || typeof input.query !== "string") {
      throw new BigQueryAdapterError(
        "BIGQUERY_INVALID_INPUT",
        "Missing or invalid query parameter.",
      );
    }

    // 2. Verify the target database resource against the shared allowlist.
    // F-280 (R7-C2-05): the binding resource allowlist is the one the shared
    // bridge enforces; this adapter has no resource names of its own.
    try {
      assertDuckDbResourceAuthorized(input.target_database);
    } catch (err) {
      throw new BigQueryAdapterError(err.code, err.message);
    }

    // 3. Delegate the statement gate to the shared validator.
    // F-276 (R7-C2-01): this used to be a private seven-keyword regex over
    // the uppercased whole query, so MERGE, REPLACE, GRANT and REVOKE were
    // admitted, and a read whose literal text merely mentioned a blocked word
    // was refused. The shared tokenizer answers both questions the canonical
    // way, and the sibling MotherDuck adapter already delegated here.
    try {
      assertReadOnlyStatement(input.query);
    } catch (err) {
      throw new BigQueryAdapterError(
        err.message === "SQL_MUTATION_NOT_PERMITTED"
          ? "BIGQUERY_MUTATION_NOT_PERMITTED"
          : "BIGQUERY_SYNTAX_ERROR",
        `Query validation failed: ${err.message}`,
      );
    }

    // 4. Check timeout / mock options.
    // F-281 (R7-C2-06): the effective timeout is bounded, not taken from the
    // caller at face value. This adapter declares no timeout ceiling of its own,
    // so the shared SQL capability ceiling applies.
    const timeoutMs = Math.min(
      Number(options.timeoutMs) || BIGQUERY_DEFAULT_TIMEOUT_MS,
      DUCKDB_MAX_TIMEOUT_MS,
    );
    if (options.simulateTimeout) {
      throw new BigQueryAdapterError(
        "BIGQUERY_TIMEOUT",
        `BigQuery query timed out after ${timeoutMs}ms`,
      );
    }

    const executionMs = Date.now() - startTime;
    // F-281 (R7-C2-06): the row bound has the sibling bridge's floor as well as
    // its ceiling, so a non-positive request cannot become a successful empty
    // result.
    const maxRows = Math.min(
      Math.max(Number(input.max_rows) || 100, 1),
      BIGQUERY_MAX_ROWS,
    );

    const columns = [
      "dataset_name",
      "partition_date",
      "total_records",
      "processed_bytes",
    ];
    const rows = [
      ["cloud_analytics_lake", "2026-09-14", 1250000, 48920100],
    ].slice(0, maxRows);

    return Object.freeze({
      provider: "bigquery",
      // F-279 (R7-C2-04): the envelope now says, in a field a consumer can
      // refuse on, that these rows were fabricated by a contract test double.
      // `status` and `state` describe the fabricated job's own lifecycle and
      // never carried that information.
      execution_state: EXECUTION_STATE_SIMULATED,
      project_id: this.projectId,
      dataset: input.target_database,
      row_count: rows.length,
      columns: Object.freeze(columns),
      rows: Object.freeze(rows),
      total_bytes_billed: 10485760, // 10 MB billed
      execution_ms: executionMs,
    });
  }
}
