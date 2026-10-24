import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import {
  assertDuckDbSafety,
  executeGovernedDuckDbQuery,
  DUCKDB_MAX_TIMEOUT_MS,
} from "../zink-tools/sql/duckdb-bridge.mjs";
import { validateSqlQuery } from "../zink-tools/sql/validator.mjs";

/**
 * F-037 (R5-E15-03) — the bridge's own guard was a fail-open deny-list.
 *
 * Measured at HEAD: `ESCAPE_PATTERNS` did not name `glob`, `read_text`,
 * `read_blob`, `CREATE SECRET` or `SET`, and the only guard that refused an
 * unlisted table function was the statement validator further down the file.
 * The bridge's own first line of defence therefore admitted a host-file read
 * by construction, and no test compared the two guards.
 *
 * F-294 (R7-C5-02) — the timeout gate drove a test-supplied failure flag.
 *
 * Measured at HEAD: the only timeout assertion passed `simulateTimeout: true`,
 * a flag that raises before any subprocess exists, so the `timeout` option
 * handed to the child was never exercised and the ceiling clamp was never
 * driven. These cases run a REAL child that hangs, and prove the child is
 * killed and reaped.
 */

const context = { agent_id: "sql", task_id: "task-test-01" };

/**
 * A spawn seam that records whether the engine was reached.
 *
 * @param {{spawned: number}} counter
 * @returns {(file: string, args: string[], options: object) => string}
 */
function recordingSpawn(counter) {
  return (file, args, options) => {
    counter.spawned += 1;
    void file;
    void args;
    void options;
    return "[]";
  };
}

describe("F-037 (R5-E15-03) — the bridge refuses a host-file read by shape, not by name", () => {
  test("F-037: the host-file read functions the deny-list did not name are refused by the bridge itself", async () => {
    // The code is the discriminator: the statement validator would report
    // DUCKDB_SYNTAX_ERROR for these, so DUCKDB_FILESYSTEM_ACCESS_DENIED proves
    // the bridge's own guard fired first.
    for (const query of [
      "SELECT * FROM read_text('/etc/passwd')",
      "SELECT * FROM read_blob('/etc/passwd')",
      "SELECT * FROM glob('*.csv')",
    ]) {
      await assert.rejects(
        () =>
          executeGovernedDuckDbQuery(
            context,
            { query, target_database: "knowledge" },
            { execFileSyncImpl: recordingSpawn({ spawned: 0 }) },
          ),
        { code: "DUCKDB_FILESYSTEM_ACCESS_DENIED" },
        `the bridge must refuse ${query} itself`,
      );
    }
  });

  test("F-037: an unlisted table function is refused before any child is spawned", async () => {
    const counter = { spawned: 0 };
    for (const query of [
      "SELECT * FROM mystery_reader('/etc/passwd')",
      "SELECT * FROM range(10)",
      "SELECT * FROM knowledge_functions()",
    ]) {
      await assert.rejects(
        () =>
          executeGovernedDuckDbQuery(
            context,
            { query, target_database: "knowledge" },
            { execFileSyncImpl: recordingSpawn(counter) },
          ),
        { code: "DUCKDB_TABLE_FUNCTION_DENIED" },
        `an unlisted table function must be refused: ${query}`,
      );
    }
    assert.equal(counter.spawned, 0, "the engine must never be reached");
  });

  test("F-037: the credential and configuration statements are refused by the bridge itself", async () => {
    for (const query of [
      "CREATE SECRET my_secret (TYPE S3, KEY_ID 'k')",
      "SET memory_limit='1GB'",
    ]) {
      await assert.rejects(
        () =>
          executeGovernedDuckDbQuery(
            context,
            { query, target_database: "knowledge" },
            { execFileSyncImpl: recordingSpawn({ spawned: 0 }) },
          ),
        { code: "DUCKDB_HOST_EXECUTION_DENIED" },
        `the bridge must refuse ${query} itself`,
      );
    }
  });

  test("F-037: a statement the canonical validator refuses never reaches the engine", async () => {
    const counter = { spawned: 0 };
    const statements = [
      "INSERT INTO knowledge (id) VALUES (1)",
      "UPDATE knowledge SET name = 'test'",
      "DELETE FROM knowledge",
      "MERGE INTO knowledge USING other ON knowledge.id = other.id WHEN MATCHED THEN UPDATE SET knowledge.name = 'x'",
      "DROP TABLE knowledge",
      "ALTER TABLE knowledge ADD COLUMN x INTEGER",
      "CREATE TABLE knowledge (id INTEGER)",
      "TRUNCATE TABLE knowledge",
      "REPLACE INTO knowledge (id) VALUES (1)",
      "GRANT ALL ON knowledge TO reader",
      "REVOKE ALL ON knowledge FROM reader",
      "SELECT * FROM read_text('/etc/passwd')",
      "SELECT * FROM glob('*.csv')",
      "CREATE SECRET my_secret (TYPE S3, KEY_ID 'k')",
      "SET memory_limit='1GB'",
      "SELECT id FROM knowledge WHERE id IN (1, 2)",
    ];
    for (const query of statements) {
      assert.throws(
        () => validateSqlQuery(query, []),
        undefined,
        `fixture must be refused by the canonical validator: ${query}`,
      );
      await assert.rejects(
        () =>
          executeGovernedDuckDbQuery(
            context,
            { query, target_database: "knowledge" },
            { execFileSyncImpl: recordingSpawn(counter) },
          ),
        (err) => {
          assert.ok(
            String(err?.code ?? "").startsWith("DUCKDB_"),
            `the bridge must classify the refusal: ${query} -> ${err?.code}`,
          );
          return true;
        },
      );
    }
    assert.equal(counter.spawned, 0, "the engine must never be reached");
  });

  test("F-037: a read that merely mentions a blocked word is still served", async () => {
    // The over-rejection control: the bridge refuses the dangerous FORM, not
    // the word. A literal is data.
    const counter = { spawned: 0 };
    const res = await executeGovernedDuckDbQuery(
      context,
      {
        query: "SELECT id FROM knowledge WHERE name = 'DELETE ME'",
        target_database: "knowledge",
      },
      { execFileSyncImpl: recordingSpawn(counter) },
    );
    assert.equal(res.row_count, 0);
    assert.equal(
      counter.spawned,
      1,
      "a legitimate read still reaches the engine",
    );
  });
});

describe("F-294 (R7-C5-02) — the subprocess timeout is applied to a real child", () => {
  test("F-294: the timeout kills a real hanging child and the call returns", async () => {
    let observedTimeout = null;
    let childError = null;
    const startedAt = Date.now();
    await assert.rejects(
      () =>
        executeGovernedDuckDbQuery(
          context,
          {
            query: "SELECT id, name FROM knowledge",
            target_database: "knowledge",
          },
          {
            timeoutMs: 500,
            execFileSyncImpl: (file, args, options) => {
              void file;
              void args;
              observedTimeout = options?.timeout;
              try {
                // A real child that would run for a minute. The spawn is the
                // real one, so the timeout and the kill are the real ones.
                return execFileSync(
                  process.execPath,
                  ["-e", "setTimeout(() => {}, 60000)"],
                  options,
                );
              } catch (err) {
                childError = err;
                throw err;
              }
            },
          },
        ),
      { code: "DUCKDB_TIMEOUT" },
    );
    const elapsed = Date.now() - startedAt;
    assert.equal(
      observedTimeout,
      500,
      "the timeout must reach the child spawn",
    );
    assert.equal(childError?.code, "ETIMEDOUT");
    assert.equal(childError?.signal, "SIGTERM", "the child must be killed");
    assert.ok(
      elapsed < 30000,
      `the call must return when the child is reaped, took ${elapsed}ms`,
    );
  });

  test("F-294: an oversized requested timeout is clamped to the declared ceiling", async () => {
    let observedTimeout = null;
    await assert.rejects(
      () =>
        executeGovernedDuckDbQuery(
          context,
          {
            query: "SELECT id, name FROM knowledge",
            target_database: "knowledge",
          },
          {
            timeoutMs: 10 ** 9,
            execFileSyncImpl: (file, args, options) => {
              void file;
              void args;
              observedTimeout = options?.timeout;
              throw new Error("stop-before-spawn");
            },
          },
        ),
      { code: "DUCKDB_EXECUTION_ERROR" },
    );
    assert.equal(
      observedTimeout,
      DUCKDB_MAX_TIMEOUT_MS,
      "the declared ceiling must bind the child timeout",
    );
  });

  test("F-294: the flag-driven case still holds, but it is not the control's evidence", async () => {
    // The flag case remains as a cheap guard. The proof that the timeout
    // plumbing works is the real-child case above; this one only pins the
    // reported code.
    await assert.rejects(
      () =>
        executeGovernedDuckDbQuery(
          context,
          {
            query: "SELECT id, name FROM knowledge",
            target_database: "knowledge",
          },
          { simulateTimeout: true, timeoutMs: 1000 },
        ),
      { code: "DUCKDB_TIMEOUT" },
    );
  });
});

describe("F-452 (R9-L07b-3) — a string literal is data for the FROM-clause guard", () => {
  test("F-452: a literal that spells a table function reaches the engine", async () => {
    const counter = { spawned: 0 };
    const query = "SELECT 'FROM x(' FROM knowledge";
    assert.doesNotThrow(() => validateSqlQuery(query, []));
    const res = await executeGovernedDuckDbQuery(
      context,
      { query, target_database: "knowledge" },
      { execFileSyncImpl: recordingSpawn(counter) },
    );
    assert.equal(res.row_count, 0);
    assert.equal(
      counter.spawned,
      1,
      "the masked clause must not refuse a read whose data spells FROM x(",
    );
  });

  test("F-452: doubled-quote escapes stay delimiters, not clause text", async () => {
    const counter = { spawned: 0 };
    const query = "SELECT 'it''s FROM x(' FROM knowledge";
    assert.doesNotThrow(() => validateSqlQuery(query, []));
    const res = await executeGovernedDuckDbQuery(
      context,
      { query, target_database: "knowledge" },
      { execFileSyncImpl: recordingSpawn(counter) },
    );
    assert.equal(res.row_count, 0);
    assert.equal(counter.spawned, 1);
  });

  test("F-452: a host-file read in syntax position is still refused", () => {
    assert.throws(
      () => assertDuckDbSafety("SELECT * FROM read_text('/etc/passwd')"),
      { code: "DUCKDB_FILESYSTEM_ACCESS_DENIED" },
    );
  });
});
