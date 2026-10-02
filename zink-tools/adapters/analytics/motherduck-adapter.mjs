import { assertDuckDbCallerAuthorized } from "../../sql/duckdb-bridge.mjs";
import { validateSqlQuery } from "../../sql/validator.mjs";

export class MotherDuckAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MotherDuckAdapterError";
    this.code = code;
  }
}

export const MOTHERDUCK_DEFAULT_TIMEOUT_MS = 10000;
export const MOTHERDUCK_MAX_TIMEOUT_MS = 60000;
export const MOTHERDUCK_MAX_ROWS = 1000;

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * MotherDuck integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed MotherDuck Adapter
 * Remote analytical SQL execution behind zink_sql capability.
 */
export class MotherDuckAdapter {
  constructor(options = {}) {
    this.token = options.token || null;
  }

  /**
   * Executes a bounded remote query on MotherDuck.
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
      throw new MotherDuckAdapterError(
        "MOTHERDUCK_UNAUTHORIZED_CALLER",
        `Caller '${context?.agent_id}' is not authorized for SQL capabilities: ${err.message}`,
      );
    }

    if (!input?.query || typeof input.query !== "string") {
      throw new MotherDuckAdapterError(
        "MOTHERDUCK_INVALID_INPUT",
        "Missing or invalid query parameter.",
      );
    }

    // 2. Validate Lean Option B SQL
    try {
      validateSqlQuery(input.query, input.parameters || []);
    } catch (err) {
      throw new MotherDuckAdapterError(
        err.message === "SQL_MUTATION_NOT_PERMITTED"
          ? "MOTHERDUCK_MUTATION_NOT_PERMITTED"
          : "MOTHERDUCK_SYNTAX_ERROR",
        `Query validation failed: ${err.message}`,
      );
    }

    // 3. Check timeout / mock options
    if (options.simulateTimeout) {
      throw new MotherDuckAdapterError(
        "MOTHERDUCK_TIMEOUT",
        `MotherDuck query timed out after ${options.timeoutMs || MOTHERDUCK_DEFAULT_TIMEOUT_MS}ms`,
      );
    }

    const executionMs = Date.now() - startTime;
    const maxRows = Math.min(Number(input.max_rows) || 100, MOTHERDUCK_MAX_ROWS);

    // Bounded mock Gold result
    const columns = ["metric_id", "metric_name", "gold_value", "updated_at"];
    const rows = [
      ["METRIC-01", "gold_revenue_total", 145000.25, "2026-09-14T12:00:00Z"],
      ["METRIC-02", "gold_active_users", 3420, "2026-09-14T12:00:00Z"],
    ].slice(0, maxRows);

    return Object.freeze({
      provider: "motherduck",
      target_database: input.target_database || "gold",
      row_count: rows.length,
      columns: Object.freeze(columns),
      rows: Object.freeze(rows),
      execution_ms: executionMs,
    });
  }
}
