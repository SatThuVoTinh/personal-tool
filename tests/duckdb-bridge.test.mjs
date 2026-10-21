//
// SKIP-FAMILY: duckdb
//
// M12/T9 F-384: these cases need the DuckDB ENGINE, and a host without it
// reports NOT RUN instead of a pass. The capability is its own family, so the
// CI runner's expectation is declared once and every host agrees on it.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { executeGovernedDuckDbQuery } from "../zink-tools/sql/duckdb-bridge.mjs";
import {
  classifyDuckDbEngineProbe,
  duckDbEngineAvailable,
  duckDbSkip,
  DUCKDB_ENGINE_STATUS,
} from "./helpers/duckdb-availability.mjs";

describe("Governed DuckDB Windows Bridge (M7/T4 G4 & G5)", () => {
  const validContext = { agent_id: "sql", task_id: "task-test-01" };
  const validQuery = "SELECT id, name FROM knowledge";
  const validDatabase = "knowledge";

  // Gates that assert rows a live DuckDB engine must produce are real execution
  // gates. Where the engine is not installed they are NOT RUN, not FAIL: an
  // absent external runtime is an environment limitation, and reporting it as a
  // failure is indistinguishable from a regression. The denial gates below are
  // deliberately NOT skipped — authorization and safety are proven before the
  // engine is ever invoked, so they are verifiable on every host.
  test(
    "Gate 4.1: allowed resource + allowed query -> PASS",
    { skip: duckDbSkip() },
    async () => {
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
    },
  );

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

  test(
    "Gate RC09.1: known SELECT fixture returns exact rows labelled as a contract fixture",
    { skip: duckDbSkip() },
    async () => {
      const res = await executeGovernedDuckDbQuery(validContext, {
        query: "SELECT id, name FROM knowledge WHERE id = 1",
        target_database: validDatabase,
      });
      // The engine really executed, but the datasource is a hardcoded contract
      // fixture, so the state must not claim a real datasource. Reporting
      // REAL_EXECUTED here attested to the subprocess while presenting canned
      // rows as live analytics data.
      assert.equal(res.execution_state, "FIXTURE_CONTRACT_EXECUTED");
      assert.equal(res.data_source, "contract_fixture");
      assert.equal(res.row_count, 1);
      assert.deepEqual(res.columns, ["id", "name"]);
      assert.deepEqual(res.rows, [[1, "artifact-alpha"]]);
    },
  );

  test(
    "Gate RC09.2: query returning zero rows returns EMPTY_RESULT",
    { skip: duckDbSkip() },
    async () => {
      const res = await executeGovernedDuckDbQuery(validContext, {
        query: "SELECT id, name FROM knowledge WHERE id = 9999",
        target_database: validDatabase,
      });
      assert.equal(res.execution_state, "EMPTY_RESULT");
      assert.equal(res.row_count, 0);
      assert.deepEqual(res.rows, []);
    },
  );

  test(
    "Gate RC09.3: bad SQL referencing invalid column throws DUCKDB_EXECUTION_ERROR",
    { skip: duckDbSkip() },
    async () => {
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
    },
  );

  // T2.1-4 (R5-E06-04): the execution-failure branch used to paste the child's
  // whole stderr into the thrown message, and this seam's errors are read by the
  // model and recorded in the ledger and the cards.
  test(
    "Gate RC09.4: an engine failure forwards no stderr and names only structured fields",
    { skip: duckDbSkip() },
    async () => {
      const err = await executeGovernedDuckDbQuery(validContext, {
        query: "SELECT invalid_column_xyz FROM knowledge",
        target_database: validDatabase,
      }).then(
        () => null,
        (error) => error,
      );
      assert.equal(err?.code, "DUCKDB_EXECUTION_ERROR");
      for (const marker of [
        "invalid_column_xyz",
        "Referenced column",
        "Binder Error",
        "knowledge",
      ]) {
        assert.ok(
          !err.message.includes(marker),
          `the engine's own prose must stay host-side: ${marker}`,
        );
      }
      // The operator still gets a cause, and it is bounded to structured fields.
      assert.match(err.message, /engine status \d+/u);
      assert.match(err.message, /stderr is not forwarded/u);

      // A timeout is the same leak risk, so it must also be classifiable without
      // the child's output. Whatever shape Node reports here, it may not be
      // prose, and it may not silently become an execution error carrying bytes.
      const timedOut = await executeGovernedDuckDbQuery(
        validContext,
        { query: validQuery, target_database: validDatabase },
        { timeoutMs: 1 },
      ).then(
        () => null,
        (error) => error,
      );
      if (timedOut) {
        assert.ok(
          ["DUCKDB_TIMEOUT", "DUCKDB_EXECUTION_ERROR"].includes(timedOut.code),
          `a timed-out engine call must be classified, got ${timedOut.code}`,
        );
        for (const marker of ["Binder Error", "Referenced column"]) {
          assert.ok(
            !timedOut.message.includes(marker),
            `a timeout must not forward engine prose: ${marker}`,
          );
        }
      }
    },
  );

  // The one gate that is meaningful on every host, with or without the engine.
  // It asserts that an absent engine is reported as an explicit condition and
  // never degrades into rows, and — on a host that does have the engine — that
  // the same call really does execute, which is what proves the availability
  // probe is not quietly hiding a failure behind a skip.
  test("Gate E1: engine availability is classified, never masked", async () => {
    const call = () =>
      executeGovernedDuckDbQuery(validContext, {
        query: validQuery,
        target_database: validDatabase,
      });

    if (duckDbEngineAvailable()) {
      const res = await call();
      assert.equal(res.execution_state, "FIXTURE_CONTRACT_EXECUTED");
      assert.equal(res.data_source, "contract_fixture");
      assert.ok(res.row_count >= 0);
      return;
    }
    await assert.rejects(call, (err) => {
      assert.equal(err.code, "DUCKDB_ENGINE_NOT_AVAILABLE");
      return true;
    });
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

test("F-304: only an absent binary yields NOT RUN; a broken engine reddens the lane", () => {
  // M12/T9 F-304: the probe used to fold every failure into "not installed",
  // so a hanging or broken engine retired the SQL gates behind a skip whose
  // reason was factually wrong, and the lane still exited zero. The cause is
  // now reported, and the skip is only produced for an absent binary.
  const absent = classifyDuckDbEngineProbe(() => {
    const error = new Error("spawn duckdb ENOENT");
    error.code = "ENOENT";
    throw error;
  });
  assert.equal(absent.status, DUCKDB_ENGINE_STATUS.NOT_INSTALLED);
  assert.match(absent.detail, /not installed/u);
  assert.equal(
    duckDbSkip(absent),
    absent.detail,
    "an absent engine is still NOT RUN, with an accurate reason",
  );

  for (const code of ["ETIMEDOUT", "EACCES", "ENOEXEC", 1]) {
    const broken = classifyDuckDbEngineProbe(() => {
      const error = new Error("the engine did not answer");
      error.code = code;
      throw error;
    });
    assert.equal(
      broken.status,
      DUCKDB_ENGINE_STATUS.BROKEN,
      `a probe failure with code ${code} is BROKEN, not NOT INSTALLED`,
    );
    assert.match(broken.detail, /FAILURE, not NOT RUN/u);
    assert.equal(
      duckDbSkip(broken),
      false,
      `a broken engine must NOT be retired behind a skip (code ${code})`,
    );
  }

  const available = classifyDuckDbEngineProbe(() => {});
  assert.equal(available.status, DUCKDB_ENGINE_STATUS.AVAILABLE);
  assert.equal(duckDbSkip(available), false);
});
