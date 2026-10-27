import {
  assertDuckDbCallerAuthorized,
  assertDuckDbResourceAuthorized,
} from "../../sql/duckdb-bridge.mjs";
import { validateSqlQuery } from "../../sql/validator.mjs";
import { EXECUTION_STATE_SIMULATED } from "../../common/execution-state.mjs";

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
 * ignored rather than retained, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed MotherDuck Adapter
 * Remote analytical SQL execution behind zink_sql capability.
 *
 * F-446 (R9-L07a-1): `options.token` used to be assigned to an instance field
 * that no method read. It is accepted for caller compatibility and discarded;
 * an adapter that does not authenticate must not hold a credential.
 */
export class MotherDuckAdapter {
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

    // 2. Verify the target database resource against the shared allowlist.
    // F-280 (R7-C2-05): the binding resource allowlist is the one the shared
    // bridge enforces; this adapter has no resource names of its own.
    try {
      assertDuckDbResourceAuthorized(input.target_database);
    } catch (err) {
      throw new MotherDuckAdapterError(err.code, err.message);
    }

    // 3. Validate Lean Option B SQL
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

    // 4. Check timeout / mock options.
    // F-281 (R7-C2-06): the declared MOTHERDUCK_MAX_TIMEOUT_MS ceiling bounds
    // the effective timeout instead of the caller's option being echoed at face
    // value.
    const timeoutMs = Math.min(
      Number(options.timeoutMs) || MOTHERDUCK_DEFAULT_TIMEOUT_MS,
      MOTHERDUCK_MAX_TIMEOUT_MS,
    );
    if (options.simulateTimeout) {
      throw new MotherDuckAdapterError(
        "MOTHERDUCK_TIMEOUT",
        `MotherDuck query timed out after ${timeoutMs}ms`,
      );
    }

    const executionMs = Date.now() - startTime;
    // F-281 (R7-C2-06): the row bound has the sibling bridge's floor as well as
    // its ceiling, so a non-positive request cannot become a successful empty
    // result.
    const maxRows = Math.min(
      Math.max(Number(input.max_rows) || 100, 1),
      MOTHERDUCK_MAX_ROWS,
    );

    // Bounded mock Gold result
    const columns = ["metric_id", "metric_name", "gold_value", "updated_at"];
    const rows = [
      ["METRIC-01", "gold_revenue_total", 145000.25, "2026-09-14T12:00:00Z"],
      ["METRIC-02", "gold_active_users", 3420, "2026-09-14T12:00:00Z"],
    ].slice(0, maxRows);

    return Object.freeze({
      provider: "motherduck",
      // F-279 (R7-C2-04): the explicit fidelity marker. Without it a
      // governed consumer could not tell a canned Gold row set from a real
      // remote read.
      execution_state: EXECUTION_STATE_SIMULATED,
      target_database: input.target_database,
      row_count: rows.length,
      columns: Object.freeze(columns),
      rows: Object.freeze(rows),
      execution_ms: executionMs,
    });
  }
}
