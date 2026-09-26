import path from "node:path";
import { execFileSync } from "node:child_process";
import { TOOL_POLICY } from "../../integrations/openclaw/lib/policy.mjs";
import { validateSqlQuery } from "./validator.mjs";

/**
 * Governed DuckDB Windows Bridge
 * Enforces localhost-only, authenticated, authorized, capability-based, bounded execution.
 * Reuses M7/T2 and M7/T3 policy and authorization semantics.
 */

export const DUCKDB_DEFAULT_TIMEOUT_MS = 5000;
export const DUCKDB_MAX_TIMEOUT_MS = 30000;
export const DUCKDB_DEFAULT_MAX_ROWS = 100;
export const DUCKDB_MAX_ROWS_CEILING = 1000;

export const ALLOWLISTED_DATABASES = Object.freeze([
  "knowledge",
  "analytics_read",
]);

// Patterns strictly denied to prevent filesystem escapes, arbitrary host executions, or sandbox breaches
const ESCAPE_PATTERNS = [
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bCOPY\b/i,
  /\bread_csv\w*\b/i,
  /\bread_parquet\w*\b/i,
  /\bread_json\w*\b/i,
  /\bparquet_scan\b/i,
  /\bINSTALL\b/i,
  /\bLOAD\b/i,
  /\bPRAGMA\b/i,
  /\bCALL\b/i,
  /\bEXECUTE\b/i,
  /\bIMPORT\b/i,
  /\bEXPORT\b/i,
  /\bcmd\.exe\b/i,
  /\bpowershell\b/i,
  /\bwsl\b/i,
  /\bdocker\b/i,
  /\bsh\b/i,
  /\bbash\b/i,
];

export class DuckDbBridgeError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "DuckDbBridgeError";
    this.code = code;
  }
}

/**
 * Validates whether the caller agent is authorized to invoke zink_sql capability.
 * @param {string} agentId
 */
export function assertDuckDbCallerAuthorized(agentId) {
  if (!agentId || typeof agentId !== "string") {
    throw new DuckDbBridgeError(
      "DUCKDB_UNAUTHORIZED_CALLER",
      "Missing or invalid agent identifier",
    );
  }
  const allowedTools = TOOL_POLICY[agentId] || [];
  if (!allowedTools.includes("zink_sql")) {
    throw new DuckDbBridgeError(
      "DUCKDB_UNAUTHORIZED_CALLER",
      `Agent '${agentId}' is not authorized to use zink_sql`,
    );
  }
}

/**
 * Validates the target database resource against the strict allowlist.
 * @param {string} targetDatabase
 */
export function assertDuckDbResourceAuthorized(targetDatabase) {
  if (!targetDatabase || typeof targetDatabase !== "string") {
    throw new DuckDbBridgeError(
      "DUCKDB_UNAUTHORIZED_RESOURCE",
      "Missing target database resource",
    );
  }
  if (!ALLOWLISTED_DATABASES.includes(targetDatabase)) {
    throw new DuckDbBridgeError(
      "DUCKDB_UNAUTHORIZED_RESOURCE",
      `Target database '${targetDatabase}' is not in allowlist: [${ALLOWLISTED_DATABASES.join(", ")}]`,
    );
  }
}

/**
 * Scans query string and parameters for escape or injection vectors.
 * @param {string} query
 * @param {Array<{name: string, value: any}>} parameters
 */
export function assertDuckDbSafety(query, parameters = []) {
  if (typeof query !== "string") {
    throw new DuckDbBridgeError(
      "DUCKDB_INVALID_QUERY",
      "Query must be a string",
    );
  }

  // 1. Check escape patterns in query
  for (const pattern of ESCAPE_PATTERNS) {
    if (pattern.test(query)) {
      if (/ATTACH|DETACH|COPY/i.test(query)) {
        throw new DuckDbBridgeError(
          "DUCKDB_FILESYSTEM_ACCESS_DENIED",
          `Forbidden database manipulation statement detected: ${pattern.source}`,
        );
      }
      if (/read_csv|read_parquet|read_json|parquet_scan/i.test(query)) {
        throw new DuckDbBridgeError(
          "DUCKDB_FILESYSTEM_ACCESS_DENIED",
          `Direct filesystem scan forbidden: ${pattern.source}`,
        );
      }
      if (/powershell|cmd|wsl|docker|sh|bash|PRAGMA|INSTALL|LOAD/i.test(query)) {
        throw new DuckDbBridgeError(
          "DUCKDB_HOST_EXECUTION_DENIED",
          `Host execution or configuration command forbidden: ${pattern.source}`,
        );
      }
      throw new DuckDbBridgeError(
        "DUCKDB_ESCAPE_ATTEMPT_DENIED",
        `Disallowed pattern in query: ${pattern.source}`,
      );
    }
  }

  // 2. Check parameter values for path traversal or command escape vectors
  if (Array.isArray(parameters)) {
    for (const param of parameters) {
      if (typeof param?.value === "string") {
        const val = param.value;
        if (
          val.includes("..") ||
          val.includes("\\..") ||
          val.includes("/..") ||
          /^[A-Za-z]:[\\/]/.test(val) ||
          val.startsWith("/") ||
          val.startsWith("\\")
        ) {
          throw new DuckDbBridgeError(
            "DUCKDB_FILESYSTEM_ACCESS_DENIED",
            `Filesystem traversal path in parameter '${param.name}' is strictly forbidden`,
          );
        }
        for (const pattern of ESCAPE_PATTERNS) {
          if (pattern.test(val)) {
            throw new DuckDbBridgeError(
              "DUCKDB_ESCAPE_ATTEMPT_DENIED",
              `Disallowed pattern in parameter '${param.name}'`,
            );
          }
        }
      }
    }
  }
}

/**
 * Executes a governed query against the DuckDB bridge.
 * @param {object} context - Execution context containing agent_id, task_id
 * @param {object} input - Input conforming to zink-sql.schema.json
 * @param {object} [options={}] - Optional bridge configuration overrides
 * @returns {Promise<object>} - Result conforming to zink-sql.schema.json output
 */
export async function executeGovernedDuckDbQuery(context, input, options = {}) {
  const startTime = Date.now();

  // 1. Verify caller authorization
  assertDuckDbCallerAuthorized(context?.agent_id);

  // 2. Verify target database authorization
  assertDuckDbResourceAuthorized(input?.target_database);

  // 3. Verify query safety against escape attempts
  assertDuckDbSafety(input?.query, input?.parameters);

  // 4. Validate syntax against Lean Option B safe subset
  try {
    validateSqlQuery(input.query, input.parameters || []);
  } catch (err) {
    throw new DuckDbBridgeError(
      err.message === "SQL_MUTATION_NOT_PERMITTED"
        ? "DUCKDB_MUTATION_NOT_PERMITTED"
        : "DUCKDB_SYNTAX_ERROR",
      `Query failed syntax validation: ${err.message}`,
    );
  }

  // 5. Bounded constraints
  const maxRows = Math.min(
    Math.max(Number(input.max_rows) || DUCKDB_DEFAULT_MAX_ROWS, 1),
    DUCKDB_MAX_ROWS_CEILING,
  );
  const timeoutMs = Math.min(
    Number(options.timeoutMs) || DUCKDB_DEFAULT_TIMEOUT_MS,
    DUCKDB_MAX_TIMEOUT_MS,
  );

  // 6. Execute bounded query (in contract/mock mode or via direct engine)
  if (options.simulateTimeout) {
    throw new DuckDbBridgeError(
      "DUCKDB_TIMEOUT",
      `Query timed out after ${timeoutMs}ms`,
    );
  }

  if (options.simulationMode) {
    const executionMs = Date.now() - startTime;
    const mockColumns = ["id", "name", "category", "value", "created_at"];
    const mockRows = [
      [1, "artifact-alpha", "silver", 100.5, "2026-09-14T00:00:00Z"],
      [2, "artifact-beta", "silver", 250.0, "2026-09-14T01:00:00Z"],
    ].slice(0, maxRows);

    return Object.freeze({
      execution_state: "TEST_SIMULATION",
      row_count: mockRows.length,
      columns: Object.freeze(mockColumns),
      rows: Object.freeze(mockRows),
      execution_ms: executionMs,
      provider: "duckdb",
      target_database: input.target_database,
    });
  }

  // 7. Real DuckDB execution with schema fixtures for allowlisted databases
  const initSql = [
    "CREATE TABLE IF NOT EXISTS knowledge (id INTEGER, name VARCHAR, category VARCHAR, value DOUBLE, created_at VARCHAR);",
    "INSERT INTO knowledge VALUES (1, 'artifact-alpha', 'silver', 100.5, '2026-09-14T00:00:00Z'), (2, 'artifact-beta', 'silver', 250.0, '2026-09-14T01:00:00Z');",
    "CREATE TABLE IF NOT EXISTS analytics_read AS SELECT * FROM knowledge;",
    input.query.trim().endsWith(";") ? input.query.trim() : `${input.query.trim()};`,
  ].join(" ");

  let parsedRows = [];
  try {
    const rawOut = execFileSync("duckdb", ["-json", "-c", initSql], {
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const trimmed = rawOut.trim();
    if (trimmed) {
      parsedRows = JSON.parse(trimmed);
    }
  } catch (err) {
    if (err.code === "ETIMEDOUT") {
      throw new DuckDbBridgeError(
        "DUCKDB_TIMEOUT",
        `Query timed out after ${timeoutMs}ms`,
      );
    }
    if (err.code === "ENOENT") {
      // If duckdb binary is unavailable in host, fallback to controlled simulation only if permitted
      if (options.allowFallbackSimulation) {
        return Object.freeze({
          execution_state: "TEST_SIMULATION",
          row_count: 0,
          columns: Object.freeze([]),
          rows: Object.freeze([]),
          execution_ms: Date.now() - startTime,
          provider: "duckdb",
          target_database: input.target_database,
        });
      }
      throw new DuckDbBridgeError(
        "DUCKDB_ENGINE_NOT_AVAILABLE",
        "DuckDB executable not found in PATH",
      );
    }
    const stderr = err.stderr ? String(err.stderr) : err.message;
    throw new DuckDbBridgeError(
      "DUCKDB_EXECUTION_ERROR",
      `DuckDB engine execution failed: ${stderr.trim()}`,
    );
  }

  const executionMs = Date.now() - startTime;
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    return Object.freeze({
      execution_state: "EMPTY_RESULT",
      row_count: 0,
      columns: Object.freeze([]),
      rows: Object.freeze([]),
      execution_ms: executionMs,
      provider: "duckdb",
      target_database: input.target_database,
    });
  }

  const sliced = parsedRows.slice(0, maxRows);
  const columns = Object.keys(sliced[0]);
  const rows = sliced.map((item) => Object.values(item));

  return Object.freeze({
    execution_state: "REAL_EXECUTED",
    row_count: rows.length,
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    execution_ms: executionMs,
    provider: "duckdb",
    target_database: input.target_database,
  });
}
