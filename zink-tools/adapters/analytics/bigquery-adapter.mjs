import { assertDuckDbCallerAuthorized } from "../../sql/duckdb-bridge.mjs";

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

    // 2. Reject mutation keywords for read-only safety
    const upper = input.query.toUpperCase();
    if (
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/.test(upper)
    ) {
      throw new BigQueryAdapterError(
        "BIGQUERY_MUTATION_NOT_PERMITTED",
        "Mutations are not permitted on BigQuery read interface.",
      );
    }

    if (options.simulateTimeout) {
      throw new BigQueryAdapterError(
        "BIGQUERY_TIMEOUT",
        `BigQuery query timed out after ${options.timeoutMs || BIGQUERY_DEFAULT_TIMEOUT_MS}ms`,
      );
    }

    const executionMs = Date.now() - startTime;
    const maxRows = Math.min(Number(input.max_rows) || 100, BIGQUERY_MAX_ROWS);

    const columns = ["dataset_name", "partition_date", "total_records", "processed_bytes"];
    const rows = [
      ["cloud_analytics_lake", "2026-09-14", 1250000, 48920100],
    ].slice(0, maxRows);

    return Object.freeze({
      provider: "bigquery",
      project_id: this.projectId,
      dataset: input.target_database || "cloud_analytics_lake",
      row_count: rows.length,
      columns: Object.freeze(columns),
      rows: Object.freeze(rows),
      total_bytes_billed: 10485760, // 10 MB billed
      execution_ms: executionMs,
    });
  }
}
