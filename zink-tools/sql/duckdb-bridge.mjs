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

// F-186 (R5-E06-06): the engine child's stdio bound is an explicit, repo-owned
// ceiling instead of Node's 1 MiB default, which turned an ordinary wide result
// into spawnSync's ENOBUFS.
export const DUCKDB_MAX_STDIO_BYTES = 8 * 1024 * 1024;

export const ALLOWLISTED_DATABASES = Object.freeze([
  "knowledge",
  "analytics_read",
]);

// Patterns strictly denied to prevent filesystem escapes, arbitrary host executions, or sandbox breaches
//
// F-037 (R5-E15-03): measured at HEAD this list was a fail-open deny-list and
// five members of the dangerous class were absent: `glob`, `read_text`,
// `read_blob`, `CREATE SECRET` and `SET`. The statement validator downstream
// refuses all of them too, but the bridge's OWN guard is the one that runs
// first, and it accepted them by construction. The list now covers the class
// it claims to cover, and `assertDuckDbSafety` additionally refuses every
// table-function call, so the deny-list is no longer the only thing standing
// between a model-authored query and a host file read.
const ESCAPE_PATTERNS = [
  /\bATTACH\b/i,
  /\bDETACH\b/i,
  /\bCOPY\b/i,
  /\bread_csv\w*\b/i,
  /\bread_parquet\w*\b/i,
  /\bread_json\w*\b/i,
  /\bparquet_scan\b/i,
  // F-037: the host-file read functions the deny-list did not name.
  /\bread_text\w*\b/i,
  /\bread_blob\w*\b/i,
  /\bglob\w*\b/i,
  /\bINSTALL\b/i,
  /\bLOAD\b/i,
  /\bPRAGMA\b/i,
  /\bCALL\b/i,
  /\bEXECUTE\b/i,
  /\bIMPORT\b/i,
  /\bEXPORT\b/i,
  // F-037: a credential/configuration statement. `SET` is matched in
  // statement position only, so a query that merely mentions the word inside
  // a string literal is not refused for it.
  /^\s*SET\b/i,
  /\bCREATE\s+SECRET\b/i,
  /\bcmd\.exe\b/i,
  /\bpowershell\b/i,
  /\bwsl\b/i,
  /\bdocker\b/i,
  /\bsh\b/i,
  /\bbash\b/i,
];

// F-037 (R5-E15-03): the governed SQL subset admits no table function at all —
// the statement validator refuses every parenthesis in a projection, a WHERE
// clause or a FROM clause. A table function is therefore never legitimate
// here, and refusing the shape positively is what makes "a query using an
// unlisted table function is refused" a property of the bridge rather than a
// property of a deny-list that has to be complete.
//
// The rule is scoped to the FROM clause, because that is where a table
// function appears. A parenthesised projection or a parenthesised value list
// is a different thing and keeps the statement validator's own verdict, so the
// bridge's refusal never masks the more precise code.
const TABLE_FUNCTION_CALL = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/u;
const FROM_CLAUSE = /\bFROM\b/iu;
const CLAUSE_TERMINATOR = /\b(?:WHERE|ORDER|LIMIT|OFFSET)\b/iu;

/**
 * Replaces every single-quoted string literal with an empty placeholder, so a
 * clause keyword or a parenthesis inside a literal cannot be read as syntax.
 *
 * @param {string} sql
 * @returns {string}
 */
function stripSqlStringLiterals(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch !== "'") {
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
    while (i < sql.length) {
      if (sql[i] === "'" && sql[i + 1] === "'") {
        out += "''";
        i += 2;
        continue;
      }
      if (sql[i] === "'") {
        out += "'";
        i += 1;
        break;
      }
      out += sql[i];
      i += 1;
    }
  }
  return out;
}

/**
 * The FROM clause of a statement, with string literals blanked out.
 *
 * @param {string} sql
 * @returns {string} the clause text, or "" when the statement has no FROM
 */
function fromClauseOf(sql) {
  const stripped = stripSqlStringLiterals(sql);
  const fromIndex = stripped.search(FROM_CLAUSE);
  if (fromIndex < 0) return "";
  const rest = stripped.slice(fromIndex + "FROM".length);
  const terminator = rest.search(CLAUSE_TERMINATOR);
  return terminator < 0 ? rest : rest.slice(0, terminator);
}

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
      if (
        /read_csv|read_parquet|read_json|parquet_scan|read_text|read_blob|glob/i.test(
          query,
        )
      ) {
        throw new DuckDbBridgeError(
          "DUCKDB_FILESYSTEM_ACCESS_DENIED",
          `Direct filesystem scan forbidden: ${pattern.source}`,
        );
      }
      if (
        /powershell|cmd|wsl|docker|sh|bash|PRAGMA|INSTALL|LOAD|SECRET|SET/i.test(
          query,
        )
      ) {
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

  // 1b. F-037 (R5-E15-03): no table function is admissible in the governed
  // subset, so a call is refused by shape rather than by name. This is what
  // makes an UNLISTED table function impossible to reach: the previous
  // deny-list could only refuse the names it happened to carry.
  if (TABLE_FUNCTION_CALL.test(fromClauseOf(query))) {
    throw new DuckDbBridgeError(
      "DUCKDB_TABLE_FUNCTION_DENIED",
      "Table functions are not part of the governed read-only subset.",
    );
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
 * Renders one bound parameter value as a DuckDB literal.
 *
 * @param {unknown} value
 * @param {string} name
 * @returns {string}
 */
function toDuckDbLiteral(value, name) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DuckDbBridgeError(
        "DUCKDB_INVALID_PARAMETER",
        `Parameter '${name}' must be a finite number.`,
      );
    }
    return String(value);
  }
  if (typeof value !== "string") {
    throw new DuckDbBridgeError(
      "DUCKDB_INVALID_PARAMETER",
      `Parameter '${name}' must be a string, number, boolean or null.`,
    );
  }
  // The control range is the point of the pattern, not an accident of it.
  // eslint-disable-next-line no-control-regex
  if (/[\0\x01-\x1F\x7F]/u.test(value)) {
    throw new DuckDbBridgeError(
      "DUCKDB_INVALID_PARAMETER",
      `Parameter '${name}' must not contain control characters.`,
    );
  }
  return `'${value.replace(/'/gu, "''")}'`;
}

/**
 * F-117 (R5-E06-05): substitutes the validated `:name` placeholders with
 * literals.
 *
 * Measured at HEAD: `parameters` was validated (`validateSqlQuery` requires
 * exact set equality between the query's placeholders and the declared
 * parameter names, and `assertDuckDbSafety` scans every value) and then
 * discarded - `initSql` interpolated `input.query` verbatim - so EVERY
 * contract-valid parameterized `zink_sql` call reached the engine with
 * `:name` unsubstituted and failed `DUCKDB_EXECUTION_ERROR`, while the values
 * the traversal scan protected never reached SQL at all.
 *
 * The scan mirrors the validator's tokenizer: a `:name` inside a string literal
 * is data, not a placeholder, and single quotes are doubled so a value cannot
 * terminate its own literal.
 *
 * @param {string} query
 * @param {Array<{name: string, value: unknown}>} [parameters]
 * @returns {string}
 */
export function bindParameters(query, parameters = []) {
  const byName = new Map();
  for (const param of parameters || []) {
    if (param && typeof param.name === "string") {
      byName.set(param.name, param.value);
    }
  }

  let out = "";
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (ch === "'") {
      const start = i;
      i += 1;
      while (i < query.length) {
        if (query[i] === "'") {
          if (query[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      out += query.slice(start, i);
      continue;
    }
    if (ch === ":") {
      let j = i + 1;
      let name = "";
      while (j < query.length && /[A-Za-z0-9_]/u.test(query[j])) {
        name += query[j];
        j += 1;
      }
      if (name && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) && byName.has(name)) {
        out += toDuckDbLiteral(byName.get(name), name);
        i = j;
        continue;
      }
    }
    out += ch;
    i += 1;
  }
  return out;
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
  // F-186 (R5-E06-06): a repo-owned stdio bound, so a buffer overrun means the
  // result genuinely exceeded a declared ceiling rather than silently tripping
  // Node's 1 MiB default.
  const maxBuffer =
    Number(options.maxBuffer) > 0
      ? Number(options.maxBuffer)
      : DUCKDB_MAX_STDIO_BYTES;

  // 5b. F-117 (R5-E06-05): bind the declared parameters into the statement. The
  // validator has already required exact placeholder/parameter set equality, so
  // every `:name` in the query has a value here.
  const boundQuery = bindParameters(input.query, input.parameters || []);

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
      data_source: "in_process_simulation",
      row_count: mockRows.length,
      columns: Object.freeze(mockColumns),
      rows: Object.freeze(mockRows),
      execution_ms: executionMs,
      provider: "duckdb",
      target_database: input.target_database,
    });
  }

  // 7. Contract-fixture DuckDB execution.
  //
  // The engine here IS a real DuckDB process: the SQL is really parsed, bound
  // and executed, and a real error really fails. What is NOT real is the
  // datasource. The rows below are a hardcoded contract fixture created inside
  // an ephemeral in-memory database that is destroyed when the process exits.
  // No business or analytics datasource is wired to this boundary yet, so the
  // result is reported as a contract-fixture execution. Reporting it as
  // "REAL_EXECUTED" would attest to the engine subprocess while presenting two
  // canned rows as live analytics data, which is exactly the false-success
  // claim this seam must not make. A governed consumer that needs business data
  // must see FIXTURE_CONTRACT_EXECUTED and refuse to treat it as live.
  const initSql = [
    "CREATE TABLE IF NOT EXISTS knowledge (id INTEGER, name VARCHAR, category VARCHAR, value DOUBLE, created_at VARCHAR);",
    "INSERT INTO knowledge VALUES (1, 'artifact-alpha', 'silver', 100.5, '2026-09-14T00:00:00Z'), (2, 'artifact-beta', 'silver', 250.0, '2026-09-14T01:00:00Z');",
    "CREATE TABLE IF NOT EXISTS analytics_read AS SELECT * FROM knowledge;",
    boundQuery.trim().endsWith(";")
      ? boundQuery.trim()
      : `${boundQuery.trim()};`,
  ].join(" ");

  let parsedRows = [];
  try {
    // F-294 (R7-C5-02): the child is spawned through an injectable seam so a
    // lane can prove the timeout is applied to a REAL child and that the child
    // is reaped. Measured at HEAD: the only timeout assertion drove
    // `simulateTimeout`, a flag that raises before any subprocess exists, so
    // the `timeout` option below was never exercised and removing it changed
    // no count in any lane. The seam is an internal option of this function
    // (never a model-reachable field); the default is the real spawn.
    const spawn =
      typeof options.execFileSyncImpl === "function"
        ? options.execFileSyncImpl
        : execFileSync;
    const rawOut = spawn("duckdb", ["-json", "-c", initSql], {
      timeout: timeoutMs,
      maxBuffer,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const trimmed = rawOut.trim();
    if (trimmed) {
      parsedRows = JSON.parse(trimmed);
    }
  } catch (err) {
    // Measured on this host: a buffer overrun and a timeout both terminate the
    // child with `signal: "SIGTERM"` and `status: null`, so the signal cannot
    // separate them; the spawn `code` is the discriminator. The overrun is a
    // local plumbing limit and must not be reported as an engine failure
    // (`R5-E06-06`).
    if (err.code === "ENOBUFS") {
      throw new DuckDbBridgeError(
        "DUCKDB_RESULT_TOO_LARGE",
        `Query result exceeded the ${maxBuffer} byte engine output ceiling.`,
      );
    }
    if (err.code === "ETIMEDOUT") {
      throw new DuckDbBridgeError(
        "DUCKDB_TIMEOUT",
        `Query timed out after ${timeoutMs}ms`,
      );
    }
    if (err.code === "ENOENT") {
      throw new DuckDbBridgeError(
        "DUCKDB_ENGINE_NOT_AVAILABLE",
        "DuckDB executable not found in PATH",
      );
    }
    // The child's stderr is uncapped engine prose, and this seam's errors are
    // read by the model and recorded in the ledger and the cards. Only
    // structured fields cross the boundary; the engine's own output stays
    // host-side (`R5-E06-04`).
    const cause = [
      Number.isInteger(err.status) ? `engine status ${err.status}` : null,
      typeof err.code === "string" && /^[A-Z][A-Z0-9_]{0,31}$/u.test(err.code)
        ? `spawn code ${err.code}`
        : null,
      typeof err.signal === "string" ? `signal ${err.signal}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    throw new DuckDbBridgeError(
      "DUCKDB_EXECUTION_ERROR",
      `DuckDB engine execution failed${
        cause ? ` (${cause})` : " (cause not classified)"
      }; the engine's own stderr is not forwarded.`,
    );
  }

  const executionMs = Date.now() - startTime;
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    return Object.freeze({
      execution_state: "EMPTY_RESULT",
      data_source: "contract_fixture",
      row_count: 0,
      columns: Object.freeze([]),
      rows: Object.freeze([]),
      execution_ms: executionMs,
      provider: "duckdb",
      target_database: input.target_database,
    });
  }

  // F-186 (R5-E06-06): measured at HEAD, `parsedRows.slice(0, maxRows)` returned
  // the first max_rows rows with `row_count` equal to that page, so a caller
  // could not tell "2 rows total" from "1 of 2 shown" and the model asserted the
  // page was the table. The ceiling is now enforced instead of applied
  // silently: a returned result is always the whole result.
  if (parsedRows.length > maxRows) {
    throw new DuckDbBridgeError(
      "DUCKDB_RESULT_LIMIT_EXCEEDED",
      `Query produced ${parsedRows.length} rows, above max_rows ${maxRows}; add a LIMIT to the query or raise max_rows.`,
    );
  }

  const columns = Object.keys(parsedRows[0]);
  const rows = parsedRows.map((item) => Object.values(item));

  return Object.freeze({
    execution_state: "FIXTURE_CONTRACT_EXECUTED",
    data_source: "contract_fixture",
    row_count: rows.length,
    columns: Object.freeze(columns),
    rows: Object.freeze(rows),
    execution_ms: executionMs,
    provider: "duckdb",
    target_database: input.target_database,
  });
}
