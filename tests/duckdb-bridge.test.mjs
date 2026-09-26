import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { executeGovernedDuckDbQuery } from "../zink-tools/sql/duckdb-bridge.mjs";

describe("Governed DuckDB Windows Bridge (M7/T4 G4 & G5)", () => {
  const validContext = { agent_id: "sql", task_id: "task-test-01" };
  const validQuery = "SELECT id, name FROM knowledge";
  const validDatabase = "knowledge";

  test("Gate 4.1: allowed resource + allowed query -> PASS", async () => {
    const result = await executeGovernedDuckDbQuery(validContext, {
      query: validQuery,
      target_database: validDatabase,
      max_rows: 50,
    });

    assert.ok(result);
    assert.equal(result.provider, "duckdb");
    assert.equal(result.target_database, "knowledge");
    assert.ok(Array.isArray(result.columns));
    assert.ok(Array.isArray(result.rows));
    assert.ok(result.row_count >= 0);
  });

  test("Gate 4.2: unauthorized caller agent -> DENY (DUCKDB_UNAUTHORIZED_CALLER)", async () => {
    const unauthorizedContexts = [
      { agent_id: "main", task_id: "task-test-01" },
      { agent_id: "excel", task_id: "task-test-01" },
      { agent_id: "power-bi", task_id: "task-test-01" },
      { agent_id: "unknown-agent", task_id: "task-test-01" },
    ];

    for (const ctx of unauthorizedContexts) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(ctx, {
            query: validQuery,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_UNAUTHORIZED_CALLER");
          return true;
        },
      );
    }
  });

  test("Gate 4.3: unauthorized resource database -> DENY (DUCKDB_UNAUTHORIZED_RESOURCE)", async () => {
    const unauthorizedDbs = [
      "production_db",
      "system",
      "admin",
      "c:\\Users\\HOANG VINH\\data.db",
      "/var/data.duckdb",
      "temp_scratch",
    ];

    for (const db of unauthorizedDbs) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query: validQuery,
            target_database: db,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_UNAUTHORIZED_RESOURCE");
          return true;
        },
      );
    }
  });

  test("Gate 5.1: ATTACH arbitrary path -> DENY (DUCKDB_FILESYSTEM_ACCESS_DENIED)", async () => {
    const attachQueries = [
      "ATTACH 'C:\\sensitive\\data.db' AS secret_db",
      "ATTACH '/etc/shadow' AS shadow",
      "attach 'foo.db' as foo",
    ];

    for (const query of attachQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_FILESYSTEM_ACCESS_DENIED");
          return true;
        },
      );
    }
  });

  test("Gate 5.2: COPY arbitrary path -> DENY (DUCKDB_FILESYSTEM_ACCESS_DENIED)", async () => {
    const copyQueries = [
      "COPY knowledge TO 'C:\\temp\\dump.csv'",
      "COPY knowledge TO '/tmp/dump.csv'",
      "copy (select * from knowledge) to 'out.parquet'",
    ];

    for (const query of copyQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_FILESYSTEM_ACCESS_DENIED");
          return true;
        },
      );
    }
  });

  test("Gate 5.3: read_csv arbitrary path -> DENY (DUCKDB_FILESYSTEM_ACCESS_DENIED)", async () => {
    const readCsvQueries = [
      "SELECT * FROM read_csv('C:\\Users\\passwords.csv')",
      "SELECT * FROM read_csv('/etc/passwd')",
      "select * from read_csv_auto('dump.csv')",
    ];

    for (const query of readCsvQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_FILESYSTEM_ACCESS_DENIED");
          return true;
        },
      );
    }
  });

  test("Gate 5.4: read_parquet arbitrary path -> DENY (DUCKDB_FILESYSTEM_ACCESS_DENIED)", async () => {
    const readParquetQueries = [
      "SELECT * FROM read_parquet('C:\\data\\lake.parquet')",
      "SELECT * FROM read_parquet('/root/data.parquet')",
      "select * from parquet_scan('dump.parquet')",
    ];

    for (const query of readParquetQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_FILESYSTEM_ACCESS_DENIED");
          return true;
        },
      );
    }
  });

  test("Gate 5.5: host process/command attempt -> DENY (DUCKDB_HOST_EXECUTION_DENIED)", async () => {
    const hostCommandQueries = [
      "SELECT * FROM powershell('Get-Process')",
      "SELECT * FROM cmd.exe('/c whoami')",
      "SELECT * FROM wsl('id')",
      "SELECT * FROM docker('ps')",
      "PRAGMA threads=8",
      "INSTALL httpfs",
      "LOAD httpfs",
    ];

    for (const query of hostCommandQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_HOST_EXECUTION_DENIED");
          return true;
        },
      );
    }
  });

  test("Gate 5.6: filesystem traversal in parameter value -> DENY (DUCKDB_FILESYSTEM_ACCESS_DENIED)", async () => {
    await assert.rejects(
      async () => {
        await executeGovernedDuckDbQuery(validContext, {
          query: "SELECT id FROM knowledge WHERE name = :param",
          target_database: validDatabase,
          parameters: [
            { name: "param", type: "string", value: "../../etc/passwd" },
          ],
        });
      },
      (err) => {
        assert.equal(err.code, "DUCKDB_FILESYSTEM_ACCESS_DENIED");
        return true;
      },
    );
  });

  test("Gate 5.7: mutation query is denied by Lean Option B parser", async () => {
    const mutationQueries = [
      "INSERT INTO knowledge (id) VALUES (1)",
      "UPDATE knowledge SET name = 'test'",
      "DELETE FROM knowledge",
      "DROP TABLE knowledge",
      "TRUNCATE TABLE knowledge",
    ];

    for (const query of mutationQueries) {
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(validContext, {
            query,
            target_database: validDatabase,
          });
        },
        (err) => {
          assert.equal(err.code, "DUCKDB_MUTATION_NOT_PERMITTED");
          return true;
        },
      );
    }
  });

  test("Gate 12.1: Bounded execution timeout simulation", async () => {
    await assert.rejects(
      async () => {
        await executeGovernedDuckDbQuery(
          validContext,
          {
            query: validQuery,
            target_database: validDatabase,
          },
          { simulateTimeout: true, timeoutMs: 1000 },
        );
      },
      (err) => {
        assert.equal(err.code, "DUCKDB_TIMEOUT");
        return true;
      },
    );
  });

  test("Gate RC09.1: known SELECT fixture returns exact real rows and REAL_EXECUTED", async () => {
    const res = await executeGovernedDuckDbQuery(validContext, {
      query: "SELECT id, name FROM knowledge WHERE id = 1",
      target_database: validDatabase,
    });
    assert.equal(res.execution_state, "REAL_EXECUTED");
    assert.equal(res.row_count, 1);
    assert.deepEqual(res.columns, ["id", "name"]);
    assert.deepEqual(res.rows, [[1, "artifact-alpha"]]);
  });

  test("Gate RC09.2: query returning zero rows returns EMPTY_RESULT", async () => {
    const res = await executeGovernedDuckDbQuery(validContext, {
      query: "SELECT id, name FROM knowledge WHERE id = 9999",
      target_database: validDatabase,
    });
    assert.equal(res.execution_state, "EMPTY_RESULT");
    assert.equal(res.row_count, 0);
    assert.deepEqual(res.rows, []);
  });

  test("Gate RC09.3: bad SQL referencing invalid column throws DUCKDB_EXECUTION_ERROR", async () => {
    await assert.rejects(
      async () => {
        await executeGovernedDuckDbQuery(validContext, {
          query: "SELECT invalid_column_xyz FROM knowledge",
          target_database: validDatabase,
        });
      },
      (err) => {
        assert.equal(err.code, "DUCKDB_EXECUTION_ERROR");
        return true;
      },
    );
  });

  test("Gate RC09.4: explicit simulationMode returns TEST_SIMULATION", async () => {
    const res = await executeGovernedDuckDbQuery(
      validContext,
      {
        query: validQuery,
        target_database: validDatabase,
      },
      { simulationMode: true },
    );
    assert.equal(res.execution_state, "TEST_SIMULATION");
    assert.equal(res.row_count, 2);
  });
});
