import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { BigQueryAdapter } from "../zink-tools/adapters/analytics/bigquery-adapter.mjs";
import { MotherDuckAdapter } from "../zink-tools/adapters/analytics/motherduck-adapter.mjs";
import { DatabricksComputeAdapter } from "../zink-tools/adapters/compute/databricks-adapter.mjs";
import { KaggleComputeAdapter } from "../zink-tools/adapters/compute/kaggle-adapter.mjs";
import { HuggingFaceAdapter } from "../zink-tools/adapters/mlops/huggingface-adapter.mjs";
import { DagsHubAdapter } from "../zink-tools/adapters/mlops/dagshub-adapter.mjs";
import { MLflowLocalAdapter } from "../zink-tools/adapters/mlops/mlflow-adapter.mjs";
import { StreamlitAdapter } from "../zink-tools/adapters/app/streamlit-adapter.mjs";
import { validateSqlQuery } from "../zink-tools/sql/validator.mjs";
import {
  EXECUTION_STATE_REAL,
  EXECUTION_STATE_SIMULATED,
  assertRealExecution,
  isRealExecution,
} from "../zink-tools/common/execution-state.mjs";

/**
 * F-276 (R7-C2-01) — the BigQuery adapter re-implemented the statement gate.
 *
 * F-277 (R7-C2-02) — the DagsHub adapter ignored its configured repository.
 *
 * F-278 (R7-C2-03) — the MLflow adapter returned shallow-frozen aliases of its
 * live store.
 *
 * F-279 (R7-C2-04) — the simulated provider envelopes carried no fidelity
 * field, so a governed consumer could not refuse fabricated output.
 */

const sqlContext = { agent_id: "sql", task_id: "task-test-01" };

describe("F-276 (R7-C2-01) — the BigQuery adapter delegates its statement gate", () => {
  const adapter = new BigQueryAdapter();

  test("F-276: the adapter and the canonical validator reach the same verdict", async () => {
    const statements = [
      "INSERT INTO t (id) VALUES (1)",
      "UPDATE t SET a = 1",
      "DELETE FROM t",
      "MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.a = 1",
      "DROP TABLE t",
      "ALTER TABLE t ADD COLUMN x INTEGER",
      "CREATE TABLE t (id INTEGER)",
      "TRUNCATE TABLE t",
      "REPLACE INTO t (id) VALUES (1)",
      "GRANT ALL ON t TO reader",
      "REVOKE ALL ON t FROM reader",
      "SELECT id FROM t WHERE name = 'DELETE'",
    ];

    for (const query of statements) {
      let validatorRefused = false;
      try {
        validateSqlQuery(query, []);
      } catch {
        validatorRefused = true;
      }
      let adapterRefused = false;
      let adapterCode = null;
      try {
        await adapter.executeQuery(sqlContext, {
          query,
          target_database: "analytics_read",
        });
      } catch (err) {
        adapterRefused = true;
        adapterCode = err?.code ?? null;
      }
      assert.equal(
        adapterRefused,
        validatorRefused,
        `the adapter and the validator must agree on: ${query}`,
      );
      if (adapterRefused) {
        assert.ok(
          ["BIGQUERY_MUTATION_NOT_PERMITTED", "BIGQUERY_SYNTAX_ERROR"].includes(
            adapterCode,
          ),
          `the refusal must carry an adapter code, got ${adapterCode}`,
        );
      }
    }
  });

  test("F-276: a read that merely mentions a blocked word is served", async () => {
    // The over-rejection control: measured at HEAD the private regex refused
    // this read because the whole query was uppercased and matched.
    const res = await adapter.executeQuery(sqlContext, {
      query: "SELECT id FROM knowledge WHERE name = 'DELETE ME'",
      target_database: "analytics_read",
    });
    assert.equal(res.provider, "bigquery");
  });

  test("F-276: a mutation is refused with the mutation code", async () => {
    await assert.rejects(
      () =>
        adapter.executeQuery(sqlContext, {
          query: "GRANT ALL ON knowledge TO reader",
          target_database: "analytics_read",
        }),
      { code: "BIGQUERY_MUTATION_NOT_PERMITTED" },
    );
  });
});

describe("F-277 (R7-C2-02) — the DagsHub adapter refuses a blind or misdirected sync", () => {
  const configured = new DagsHubAdapter({
    repoOwner: "vinh-owner",
    repoName: "personal-tool-experiments",
    trackingStore: new Set(["mlf-known-run"]),
  });

  test("F-277: a wildcard selection is refused", async () => {
    await assert.rejects(
      () =>
        configured.syncSelectedRuns({
          repo_owner: "vinh-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: ["*"],
        }),
      { code: "DAGSHUB_WILDCARD_SELECTION" },
    );
    await assert.rejects(
      () =>
        configured.syncSelectedRuns({
          repo_owner: "vinh-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: ["mlf-known-run", "run-*"],
        }),
      { code: "DAGSHUB_WILDCARD_SELECTION" },
    );
  });

  test("F-277: a run the tracking store cannot resolve is refused", async () => {
    await assert.rejects(
      () =>
        configured.syncSelectedRuns({
          repo_owner: "vinh-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: ["mlf-unknown-run"],
        }),
      { code: "DAGSHUB_UNRESOLVABLE_RUN" },
    );
  });

  test("F-277: a destination other than the configured repository is refused", async () => {
    await assert.rejects(
      () =>
        configured.syncSelectedRuns({
          repo_owner: "attacker",
          repo_name: "someone-elses-repo",
          selected_run_ids: ["mlf-known-run"],
        }),
      { code: "DAGSHUB_REPOSITORY_MISMATCH" },
    );
  });

  test("F-277: the configured repository and a resolvable run are served", async () => {
    const res = await configured.syncSelectedRuns({
      repo_owner: "vinh-owner",
      repo_name: "personal-tool-experiments",
      selected_run_ids: ["mlf-known-run"],
    });
    assert.equal(res.repository, "vinh-owner/personal-tool-experiments");
    assert.deepEqual([...res.synced_run_ids], ["mlf-known-run"]);
    assert.equal(res.status, "SYNC_COMPLETED");
  });

  test("F-277: the constructor no longer retains a credential it never used", () => {
    const source = String(DagsHubAdapter.toString?.() ?? "");
    void source;
    const adapter = new DagsHubAdapter({ token: "never-used" });
    assert.equal(
      Object.hasOwn(adapter, "token"),
      false,
      "the adapter must not hold a credential-shaped value it never reads",
    );
  });
});

describe("F-278 (R7-C2-03) — the MLflow adapter hands out snapshots, not views", () => {
  test("F-278: mutating a createRun result leaves the stored run untouched", async () => {
    const adapter = new MLflowLocalAdapter();
    const created = await adapter.createRun({ experiment_name: "exp-01" });
    created.artifacts.push({ artifact_name: "forged" });
    created.tags.injected = "forged";
    const read = await adapter.getRun(created.run_id);
    assert.deepEqual(read.artifacts, []);
    assert.equal(read.tags.injected, undefined);
  });

  test("F-278: mutating a logMetrics result leaves the stored history untouched", async () => {
    const adapter = new MLflowLocalAdapter();
    const created = await adapter.createRun({ experiment_name: "exp-01" });
    const logged = await adapter.logMetrics(created.run_id, { loss: 0.1 });
    logged.metrics.loss.pop();
    const read = await adapter.getRun(created.run_id);
    assert.equal(read.metrics.loss.length, 1);
  });

  test("F-278: mutating an endRun result leaves the stored run untouched", async () => {
    const adapter = new MLflowLocalAdapter();
    const created = await adapter.createRun({ experiment_name: "exp-01" });
    const ended = await adapter.endRun(created.run_id);
    ended.tags.injected = "forged";
    ended.metrics.loss = [1];
    const read = await adapter.getRun(created.run_id);
    assert.equal(read.tags.injected, undefined);
    assert.deepEqual(read.metrics, {});
  });
});

describe("F-279 (R7-C2-04) — every simulated provider envelope carries its fidelity", () => {
  test("F-279: each provider envelope carries the simulated execution marker", async () => {
    const envelopes = [
      await new BigQueryAdapter().executeQuery(sqlContext, {
        query: "SELECT id FROM knowledge",
        target_database: "analytics_read",
      }),
      await new MotherDuckAdapter().executeQuery(sqlContext, {
        query: "SELECT id FROM knowledge",
        target_database: "knowledge",
      }),
      await new DatabricksComputeAdapter().triggerJob(
        { task_id: "task-1" },
        { job_id: "job-1" },
      ),
      await new KaggleComputeAdapter().triggerJob(
        { task_id: "task-1" },
        { kernel_slug: "slug-1" },
      ),
      await new HuggingFaceAdapter().evaluateCandidateModel({
        repo_id: "org/model",
        evaluation_dataset: "eval",
      }),
      await new StreamlitAdapter().exportGoldViewForStreamlit({
        task_id: "task-1",
        gold_dataset_id: "gold-1",
        view_name: "view-1",
        columns: ["a"],
        row_count: 1,
      }),
      await new DagsHubAdapter().syncSelectedRuns({
        repo_owner: "owner",
        repo_name: "repo",
        selected_run_ids: ["run-1"],
      }),
    ];
    for (const envelope of envelopes) {
      assert.equal(
        envelope.execution_state,
        EXECUTION_STATE_SIMULATED,
        `${envelope.provider} must say that it is a simulation`,
      );
    }
  });

  test("F-279: a governed consumer refuses every simulated envelope", async () => {
    const simulated = await new BigQueryAdapter().executeQuery(sqlContext, {
      query: "SELECT id FROM knowledge",
      target_database: "analytics_read",
    });
    assert.equal(isRealExecution(simulated.execution_state), false);
    assert.throws(() => assertRealExecution(simulated, "a dashboard"), {
      code: "EXECUTION_NOT_REAL",
    });
    // A real execution is the only value that passes.
    assert.equal(isRealExecution(EXECUTION_STATE_REAL), true);
    assert.doesNotThrow(() =>
      assertRealExecution({ execution_state: EXECUTION_STATE_REAL }),
    );
    // An envelope with no marker at all is refused rather than assumed.
    assert.throws(() => assertRealExecution({}, "a dashboard"), {
      code: "EXECUTION_NOT_REAL",
    });
  });
});
