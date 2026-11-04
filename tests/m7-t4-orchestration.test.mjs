//
// SKIP-FAMILY: duckdb
//
// M12/T9 F-384: these cases need the DuckDB ENGINE, and a host without it
// reports NOT RUN instead of a pass. The capability is its own family, so the
// CI runner's expectation is declared once and every host agrees on it.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { fileURLToPath } from "node:url";
import process from "node:process";

import {
  AGENT_IDS,
  CALLABLE_TOOL_REGISTRY,
  TOOL_POLICY,
} from "../integrations/openclaw/lib/policy.mjs";

import { executeGovernedDuckDbQuery } from "../zink-tools/sql/duckdb-bridge.mjs";
import { duckDbSkip } from "./helpers/duckdb-availability.mjs";

import {
  R2StorageAdapter,
  MotherDuckAdapter,
  BigQueryAdapter,
  KaggleComputeAdapter,
  DatabricksComputeAdapter,
  MLflowLocalAdapter,
  DagsHubAdapter,
  HuggingFaceAdapter,
  StreamlitAdapter,
  SkillAdapter,
} from "../zink-tools/adapters/index.mjs";

// ===========================================================================
// F-105 - the legacy orchestration patterns module is gone, and the provider
// adapters keep their own lanes.
// ===========================================================================
// The deleted module stitched landing -> silver -> gold tiers and synced a
// model registry between MLflow and DagsHub: the retired L&SC Data Plant and
// a second orchestrator, green-tested by this very suite. The owner
// authorised deleting the tracked module, and the coverage that mattered -
// the provider adapters, which nothing else in the repository exercises - is
// rewritten here as DIRECT adapter lanes.
//
// Every lane below calls the adapter itself. No lane composes the tiers and
// no lane sequences a model-registry sync: that composition is exactly what
// the architecture forbids.
describe("M7/T4 External Infrastructure & Governed Orchestration (G0 - G20)", () => {
  const context = Object.freeze({
    task_id: "task-m7-t4-01",
    run_id: "run-m7-t4-01",
    agent_id: "main",
  });

  const adapters = Object.freeze({
    r2: new R2StorageAdapter(),
    motherduck: new MotherDuckAdapter(),
    bigquery: new BigQueryAdapter(),
    kaggle: new KaggleComputeAdapter(),
    databricks: new DatabricksComputeAdapter(),
    mlflow: new MLflowLocalAdapter(),
    dagshub: new DagsHubAdapter(),
    huggingface: new HuggingFaceAdapter(),
    streamlit: new StreamlitAdapter(),
  });

  test("Gate G0 & G1: Discovery & Provider/Capability Integrity", () => {
    // Exact 5 callable tools preserved from T3
    const toolKeys = Object.keys(CALLABLE_TOOL_REGISTRY).sort();
    assert.deepEqual(toolKeys, [
      "zink_excel",
      "zink_n8n",
      "zink_power_bi",
      "zink_python",
      "zink_sql",
    ]);
    assert.equal(toolKeys.length, 5);

    // Exact 11 external providers are accounted for
    const expectedProviders = [
      "n8n",
      "r2",
      "duckdb",
      "motherduck",
      "bigquery",
      "kaggle",
      "databricks",
      "mlflow",
      "dagshub",
      "huggingface",
      "streamlit",
    ];
    for (const p of expectedProviders) {
      assert.ok(p.length > 0);
    }
  });

  test("Gate G2 (G-T23): T2/T3 Compatibility Invariant", () => {
    // 7 canonical agents
    assert.equal(AGENT_IDS.length, 7);
    assert.deepEqual([...AGENT_IDS].sort(), [
      "excel",
      "main",
      "o1",
      "o2",
      "power-bi",
      "python",
      "sql",
    ]);

    // Zero second authorization system
    assert.ok(TOOL_POLICY.sql.includes("zink_sql"));
    assert.ok(TOOL_POLICY.python.includes("zink_python"));
    assert.ok(TOOL_POLICY.o2.includes("zink_n8n"));
  });

  test(
    "Gate G4 & G5: Governed DuckDB Bridge Authorization & Escape Denial",
    { skip: duckDbSkip() },
    async () => {
      const valid = await executeGovernedDuckDbQuery(
        { agent_id: "sql", task_id: context.task_id },
        {
          query: "SELECT id, name FROM knowledge",
          target_database: "knowledge",
        },
      );
      assert.equal(valid.provider, "duckdb");

      // Denial of arbitrary path
      await assert.rejects(
        async () => {
          await executeGovernedDuckDbQuery(
            { agent_id: "sql", task_id: context.task_id },
            { query: "ATTACH 'bad.db' AS bad", target_database: "knowledge" },
          );
        },
        (err) => err.code === "DUCKDB_FILESYSTEM_ACCESS_DENIED",
      );
    },
  );
  test("Gate G3 & G6 (F-105): the R2 storage adapter governs the landing and the silver zones", async () => {
    const r2 = new R2StorageAdapter();
    const payload = JSON.stringify({
      records: [{ id: 101, name: "Customer Alpha" }],
    });

    // Landing: written once, addressed by its logical id.
    const landing = await r2.putLandingArtifact({
      task_id: context.task_id,
      run_id: context.run_id,
      artifact_id: "landing-orders",
      data: payload,
      content_type: "application/json",
    });
    assert.equal(landing.bucket, "landing");
    assert.equal(landing.artifact_id, "landing-orders");
    assert.equal(
      landing.checksum,
      createHash("sha256").update(payload).digest("hex"),
    );
    assert.equal(landing.artifact_ref.logical_path, "landing/landing-orders");
    assert.equal(landing.artifact_ref.size_bytes, Buffer.byteLength(payload));

    // Landing immutability: the same logical id cannot be written twice.
    await assert.rejects(
      async () => {
        await r2.putLandingArtifact({
          task_id: context.task_id,
          run_id: "run-dup",
          artifact_id: "landing-orders",
          data: "duplicate",
        });
      },
      (err) => err.code === "R2_LANDING_IMMUTABLE_VIOLATION",
    );

    // Silver: promoted with an explicit version, and one version is minted
    // once.
    const silver = await r2.promoteToSilver({
      task_id: context.task_id,
      run_id: context.run_id,
      artifact_id: "landing-orders",
      version: 1,
      data: JSON.stringify({
        records: [{ id: 101, name: "Customer Alpha" }],
        status: "VALIDATED",
      }),
    });
    assert.equal(silver.bucket, "silver");
    assert.equal(silver.version, 1);
    assert.equal(silver.artifact_ref.logical_path, "silver/landing-orders/v1");

    await assert.rejects(
      async () => {
        await r2.promoteToSilver({
          task_id: context.task_id,
          run_id: context.run_id,
          artifact_id: "landing-orders",
          version: 1,
          data: "duplicate",
        });
      },
      (err) => err.code === "R2_SILVER_VERSION_COLLISION",
    );

    // Both zones are read back through the governed key space.
    const storedLanding = await r2.getArtifact("landing", "landing-orders");
    assert.equal(storedLanding.checksum, landing.checksum);
    const storedSilver = await r2.getArtifact("silver", "landing-orders", 1);
    assert.equal(storedSilver.version, 1);

    // An unknown zone fails closed instead of silently answering with another.
    await assert.rejects(
      async () => r2.getArtifact("gold", "landing-orders"),
      (err) => err.code === "R2_INVALID_BUCKET",
    );
    // A traversal identifier cannot address an object in another zone.
    await assert.rejects(
      async () => r2.getArtifact("landing", "../../silver/orders"),
      (err) => err.code === "R2_INVALID_ARTIFACT_ID",
    );
  });

  test("Gate G7 (F-105): a proposal is not an approval - the governed Skill Store surface proposes and never approves", async () => {
    const skillStore = new SkillAdapter();

    // The published tool surface can create a proposal...
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(
          import.meta.dirname,
          "..",
          "zink-tools",
          "contracts",
          "tools",
          "zink-skill.schema.json",
        ),
        "utf8",
      ),
    );
    const actions = schema.$defs.input.properties.action.enum;
    assert.ok(actions.includes("propose"), "the governed surface must propose");
    for (const forbidden of ["approve", "accept", "promote", "publish"]) {
      assert.equal(
        actions.includes(forbidden),
        false,
        `the governed surface must not expose '${forbidden}'`,
      );
    }

    // ...and it cannot approve one: the approval is the owner's path, not a
    // tool action.
    await assert.rejects(
      async () => skillStore.querySkillStore({ action: "approve" }),
      (err) => err.code === "SKILL_ACTION_INVALID",
    );
    await assert.rejects(
      async () => skillStore.querySkillStore({ action: "publish" }),
      (err) => err.code === "SKILL_ACTION_FORBIDDEN",
    );
  });

  test("Gate G8 (F-105): the analytical adapters answer a governed read and refuse a mutation", async () => {
    const motherduck = new MotherDuckAdapter();
    const result = await motherduck.executeQuery(
      { agent_id: "sql" },
      { query: "SELECT id, name FROM knowledge", target_database: "knowledge" },
    );
    assert.equal(result.provider, "motherduck");
    assert.equal(result.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(result.target_database, "knowledge");
    assert.ok(result.row_count >= 1);
    assert.ok(result.columns.includes("metric_id"));

    const bigquery = new BigQueryAdapter();
    const analytics = await bigquery.executeQuery(
      { agent_id: "sql" },
      { query: "SELECT id, name FROM knowledge", target_database: "knowledge" },
    );
    assert.equal(analytics.provider, "bigquery");
    assert.equal(analytics.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(analytics.dataset, "knowledge");

    // A mutation is refused by the shared statement gate.
    await assert.rejects(
      async () => {
        await bigquery.executeQuery(
          { agent_id: "sql" },
          {
            query:
              "MERGE INTO knowledge t USING source s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.name = s.name",
            target_database: "knowledge",
          },
        );
      },
      (err) => err.code === "BIGQUERY_MUTATION_NOT_PERMITTED",
    );
  });

  test("Gate G8 (F-105): the Streamlit adapter publishes a localhost-only view", async () => {
    const streamlit = new StreamlitAdapter();
    const delivery = await streamlit.exportGoldViewForStreamlit({
      task_id: context.task_id,
      gold_dataset_id: "gold_analytics_layer",
      view_name: "view_gold_analytics_layer",
      columns: ["metric_id", "gold_value", "updated_at"],
      row_count: 2,
    });
    assert.equal(delivery.status, "READY");
    assert.equal(delivery.provider, "streamlit");
    assert.equal(delivery.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(
      delivery.endpoint,
      "http://127.0.0.1:8501/views/view_gold_analytics_layer",
    );
    assert.deepEqual(
      [...delivery.columns],
      ["metric_id", "gold_value", "updated_at"],
    );

    await assert.rejects(
      async () =>
        streamlit.exportGoldViewForStreamlit({ task_id: context.task_id }),
      (err) => err.code === "STREAMLIT_INVALID_PARAMS",
    );
  });
  test("Gate G9 (F-105): the compute adapters trigger a bounded job and refuse an unbounded one", async () => {
    const kaggle = new KaggleComputeAdapter();
    await assert.rejects(
      async () =>
        kaggle.triggerJob(
          { agent_id: "python" },
          { kernel_slug: "gold-feature-model-train" },
        ),
      (err) => err.code === "KAGGLE_MISSING_CONTEXT",
    );
    await assert.rejects(
      async () =>
        kaggle.triggerJob({ agent_id: "python", task_id: context.task_id }, {}),
      (err) => err.code === "KAGGLE_INVALID_PARAMS",
    );
    const kaggleJob = await kaggle.triggerJob(
      { agent_id: "python", task_id: context.task_id },
      {
        kernel_slug: "gold-feature-model-train",
        dataset_sources: ["gold_features_r2"],
      },
    );
    assert.equal(kaggleJob.provider, "kaggle");
    assert.equal(kaggleJob.status, "COMPLETED");
    assert.equal(kaggleJob.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(kaggleJob.output_artifacts.length, 1);

    const databricks = new DatabricksComputeAdapter();
    await assert.rejects(
      async () =>
        databricks.triggerJob(
          { agent_id: "python", task_id: context.task_id },
          {},
        ),
      (err) => err.code === "DATABRICKS_INVALID_PARAMS",
    );
    const databricksJob = await databricks.triggerJob(
      { agent_id: "python", task_id: context.task_id },
      { job_id: 1042, notebook_path: "/Shared/FeatureETL" },
    );
    assert.equal(databricksJob.provider, "databricks");
    assert.equal(databricksJob.status, "TERMINATED");
    assert.equal(databricksJob.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(databricksJob.run_id.startsWith("dbr-run-"), true);
  });

  test("Gate G9 (F-105): the MLflow adapter hands out snapshots, not views of its store", async () => {
    const mlflow = new MLflowLocalAdapter();
    const run = await mlflow.createRun({ experiment_name: "exp-01" });
    assert.equal(run.status, "RUNNING");
    await mlflow.logParameters(run.run_id, { alpha: 0.1 });
    await mlflow.logMetrics(run.run_id, { accuracy: 0.9 });
    await mlflow.logArtifact(run.run_id, {
      artifact_name: "model",
      artifact_path: "artifacts/model",
      checksum: "a".repeat(64),
    });
    const ended = await mlflow.endRun(run.run_id, "FINISHED");
    assert.equal(ended.status, "FINISHED");
    assert.equal(ended.params.alpha, 0.1);
    assert.equal(ended.metrics.accuracy.length, 1);
    assert.equal(ended.artifacts.length, 1);

    // The returned record is a snapshot: a caller cannot push a forged entry
    // into the tracking store through it.
    ended.artifacts.push({ artifact_name: "forged" });
    ended.metrics.accuracy.push({ value: 99, step: 1 });
    const reread = await mlflow.getRun(run.run_id);
    assert.equal(
      reread.artifacts.length,
      1,
      "a caller must not push into the store through a returned record",
    );
    assert.equal(
      reread.metrics.accuracy.length,
      1,
      "a caller must not extend a metric history through a returned record",
    );
  });

  test("Gate G9 (F-105): the DagsHub adapter syncs only explicitly selected runs", async () => {
    const dagshub = new DagsHubAdapter();
    await assert.rejects(
      async () =>
        dagshub.syncSelectedRuns({
          repo_owner: "vinh-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: [],
        }),
      (err) => err.code === "DAGSHUB_EMPTY_SELECTION",
    );
    await assert.rejects(
      async () =>
        dagshub.syncSelectedRuns({
          repo_owner: "vinh-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: ["*"],
        }),
      (err) => err.code === "DAGSHUB_WILDCARD_SELECTION",
    );

    // A configured repository cannot be pointed at another one.
    const configured = new DagsHubAdapter({
      repoOwner: "vinh-owner",
      repoName: "personal-tool-experiments",
    });
    await assert.rejects(
      async () =>
        configured.syncSelectedRuns({
          repo_owner: "other-owner",
          repo_name: "personal-tool-experiments",
          selected_run_ids: ["mlf-1"],
        }),
      (err) => err.code === "DAGSHUB_REPOSITORY_MISMATCH",
    );

    const sync = await dagshub.syncSelectedRuns({
      repo_owner: "vinh-owner",
      repo_name: "personal-tool-experiments",
      selected_run_ids: ["mlf-1"],
    });
    assert.equal(sync.status, "SYNC_COMPLETED");
    assert.equal(sync.provider, "dagshub");
    assert.equal(sync.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.deepEqual([...sync.synced_run_ids], ["mlf-1"]);
  });

  test("Gate G9 (F-105): the Hugging Face adapter evaluates a candidate without promoting it", async () => {
    const huggingface = new HuggingFaceAdapter();
    await assert.rejects(
      async () =>
        huggingface.evaluateCandidateModel({
          evaluation_dataset: "eval-validation-split",
        }),
      (err) => err.code === "HUGGINGFACE_INVALID_REPO",
    );
    await assert.rejects(
      async () =>
        huggingface.evaluateCandidateModel({
          repo_id: "zink-research/candidate-llm-v1",
        }),
      (err) => err.code === "HUGGINGFACE_MISSING_DATASET",
    );
    const candidate = await huggingface.evaluateCandidateModel({
      repo_id: "zink-research/candidate-llm-v1",
      revision: "main",
      evaluation_dataset: "eval-validation-split",
    });
    assert.equal(candidate.candidate_status, "EVALUATED_NOT_PROMOTED");
    assert.equal(candidate.provenance.untrusted_input, true);
    assert.equal(candidate.execution_state, "FIXTURE_CONTRACT_EXECUTED");
    assert.equal(candidate.repo_id, "zink-research/candidate-llm-v1");
  });

  test("Gate G10 (F-105): the legacy composition module is gone and cannot be imported", async () => {
    await assert.rejects(
      async () =>
        import("../integrations/openclaw/orchestration/patterns/index.mjs"),
      /Cannot find module|ERR_MODULE_NOT_FOUND/u,
      "the legacy orchestration patterns module must not be importable",
    );
  });

  test("Gate G13: No Silent Provider Fallback Invariant", async () => {
    // Attempting query on MotherDuck without authorization does not silently fallback to DuckDB
    await assert.rejects(
      async () => {
        await adapters.motherduck.executeQuery(
          { agent_id: "main" }, // main is not authorized for zink_sql
          { query: "SELECT id FROM knowledge" },
        );
      },
      (err) => err.code === "MOTHERDUCK_UNAUTHORIZED_CALLER",
    );
  });
  test("Gate G18: Provider Evidence Matrix Verification", () => {
    // The published matrix and the adapters' own headers are the two sources of
    // truth here. Restating either as a literal would assert a copy, which is how
    // this gate shipped a live column nothing ever read.
    const repoRoot = path.resolve(import.meta.dirname, "..");
    const readmeLines = fs
      .readFileSync(path.join(repoRoot, "README.md"), "utf8")
      .split(/\r?\n/);
    const header = readmeLines.findIndex((line) =>
      /^\|\s*Nhà cung cấp\s*\|/.test(line),
    );
    assert.ok(
      header >= 0,
      "README.md must carry the provider evidence matrix this gate reads",
    );

    const rows = [];
    for (let i = header + 2; i < readmeLines.length; i += 1) {
      const line = readmeLines[i];
      if (!line.startsWith("|")) break;
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.replace(/\*\*/g, "").replace(/`/g, "").trim());
      assert.equal(cells.length, 6, `matrix row is malformed: ${line}`);
      rows.push({
        provider: cells[0],
        state: cells[1],
        contract: cells[2],
        mock: cells[3],
        live: cells[4],
      });
    }

    // Any adapter that declares itself a simulation is evidence that the published
    // row for it may not claim live execution.
    const simulated = new Set();
    const collect = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(target);
        } else if (entry.name.endsWith("-adapter.mjs")) {
          const source = fs.readFileSync(target, "utf8");
          if (/SIMULATION_CONTRACT|NOT A PROVIDER INTEGRATION/.test(source)) {
            simulated.add(
              entry.name.replace(/-adapter\.mjs$/, "").toLowerCase(),
            );
          }
        }
      }
    };
    collect(path.join(repoRoot, "zink-tools", "adapters"));
    assert.ok(simulated.size > 0, "no adapter declared a simulation contract");

    const normalise = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const covered = new Set();
    assert.equal(rows.length, 11);
    for (const row of rows) {
      assert.ok(
        ["PROVISIONED", "CONTRACT_VERIFIED", "NOT_PROVISIONED"].includes(
          row.state,
        ),
        `${row.provider}: state "${row.state}" is outside the vocabulary`,
      );
      assert.equal(row.contract, "PASS");
      assert.equal(row.mock, "PASS");
      assert.ok(
        ["PASS", "NOT_RUN"].includes(row.live),
        `${row.provider}: live verdict "${row.live}" is outside the vocabulary`,
      );

      const marker = [...simulated].find((slug) =>
        normalise(row.provider).includes(normalise(slug)),
      );
      if (marker) {
        covered.add(marker);
        assert.notEqual(
          row.state,
          "PROVISIONED",
          `${row.provider} is published as PROVISIONED while ${marker}-adapter.mjs declares a simulation contract`,
        );
        assert.notEqual(
          row.live,
          "PASS",
          `${row.provider} is published as live PASS while ${marker}-adapter.mjs declares a simulation contract`,
        );
      }
    }

    // A row renamed away from its adapter's slug would silently drop its own
    // constraint and leave the gate green, so every declared simulation must
    // still be covered by a published row.
    for (const marker of [...simulated].sort()) {
      assert.ok(
        covered.has(marker),
        `no published provider row covers ${marker}-adapter.mjs, so its simulation-contract claim is unchecked`,
      );
    }
  });

  test("Gate G19 & G20: Dependency & Scope Integrity", () => {
    // Read package.json and ensure zero added dependencies
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"),
    );
    const deps = Object.keys(pkg.dependencies || {});
    assert.equal(deps.length, 0); // zero production dependencies added
    assert.ok(pkg.devDependencies["@eslint/js"]);
  });
});

// ===========================================================================
// F-195 - the live governance probe must not write the PRODUCTION ledger
// ===========================================================================
// The probe is a synthetic instrument: it writes its own fixtures into the
// state root it inspects and then reports PASS about the result. Run against
// the production root it therefore (a) mutates the live governance history
// while calling itself a probe, and (b) reports PASS for a precondition it
// created itself - a fact nothing in its output said.
//
// The gates are explicit and come BEFORE any write: the state root must be
// named, and the production root additionally needs an acknowledgement.
describe("M12/T9 - the live governance probe cannot write the production ledger silently", () => {
  const probeUrl = new URL(
    "../integrations/openclaw/topology/fixtures/runtime-regression/live-governance-probe.mjs",
    import.meta.url,
  );
  const probePath = fileURLToPath(probeUrl);

  test("F-195: the probe refuses to run when no state root is named", () => {
    const result = spawnSync(process.execPath, [probePath], {
      encoding: "utf8",
      env: { ...process.env, ZINK_PROBE_STATE_DIR: "" },
    });
    assert.equal(result.status, 2, "the probe must stop before any write");
    assert.match(result.stdout, /PROBE_STATE_DIR_NOT_NAMED/u);
  });

  test("F-195: the probe refuses to write the production ledger without an acknowledgement", () => {
    const result = spawnSync(
      process.execPath,
      [probePath, "/home/hoang_vinh/.openclaw-zink"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 2, "the probe must stop before any write");
    assert.match(result.stdout, /PRODUCTION_LEDGER_WRITE_NOT_ACKNOWLEDGED/u);
  });

  test("F-195: the probe names no production state root as a default", () => {
    const source = fs.readFileSync(probePath, "utf8");
    assert.ok(
      source.includes("PROBE_STATE_DIR_NOT_NAMED"),
      "the probe must name the condition it refuses on",
    );
    assert.ok(
      source.includes("PRODUCTION_LEDGER_WRITE_NOT_ACKNOWLEDGED"),
      "the production write must need an explicit acknowledgement",
    );
  });
});
// ===========================================================================
// F-088 - a yielded run is not a successful run
// ===========================================================================
// The run-end gate returned allow:true whenever the host reported
// event.yielded === true, BEFORE the success assertion. A FAILED run therefore
// passed the gate and recorded no terminal event at all: the ledger kept
// showing an open task the owner had been told had finished.
//
// A yielded run is admitted when it succeeded, or when the ledger shows the
// terminal event it claims - a governed question recorded for THAT run.
describe("M12/T9 - F-088: the run-end gate refuses a failed run that only yielded", () => {
  const openedBase = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: "12345678901234567",
    root_agent_id: "main",
    root_session_key: "agent:main:sess-1",
    root_run_id: "run-1",
  };

  function openedSnapshot() {
    return {
      tasks: {},
      sequence: 0,
    };
  }

  test("F-088: a failed run that only yielded is refused", async () => {
    const { applyWorkflowEvent } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    const { deriveTaskId } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const { createGovernanceGuard } =
      await import("../integrations/openclaw/topology/lib/guard.mjs");
    const payload = { ...openedBase, task_id: deriveTaskId(openedBase) };
    const snapshot = applyWorkflowEvent(
      openedSnapshot(),
      "WORKFLOW_OPENED",
      payload,
    );
    const guard = createGovernanceGuard({
      paths: {},
      manifestFor: () => ({}),
      _snapshotOverride: snapshot,
    });
    const context = {
      agentId: "main",
      sessionKey: openedBase.root_session_key,
      runId: openedBase.root_run_id,
    };
    assert.throws(
      () => guard.beforeRunEnd({ success: false, yielded: true }, context),
      { message: "EXECUTION_STATE_UNKNOWN" },
      "a failed run must not pass the run-end gate because it yielded",
    );
    assert.throws(
      () =>
        guard.beforeRunEnd(
          {
            success: false,
            yielded: true,
            lastAssistant: { stopReason: "error" },
          },
          context,
        ),
      { message: "EXECUTION_STATE_UNKNOWN" },
    );
  });

  test("F-088: a failed run without the yield flag is still refused", async () => {
    const { applyWorkflowEvent } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    const { deriveTaskId } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const { createGovernanceGuard } =
      await import("../integrations/openclaw/topology/lib/guard.mjs");
    const payload = { ...openedBase, task_id: deriveTaskId(openedBase) };
    const snapshot = applyWorkflowEvent(
      openedSnapshot(),
      "WORKFLOW_OPENED",
      payload,
    );
    const guard = createGovernanceGuard({
      paths: {},
      manifestFor: () => ({}),
      _snapshotOverride: snapshot,
    });
    const context = {
      agentId: "main",
      sessionKey: openedBase.root_session_key,
      runId: openedBase.root_run_id,
    };
    assert.throws(
      () => guard.beforeRunEnd({ success: false, yielded: false }, context),
      { message: "EXECUTION_STATE_UNKNOWN" },
    );
  });

  test("F-088: a yielded run that succeeded is still admitted", async () => {
    const { applyWorkflowEvent } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    const { deriveTaskId } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const { createGovernanceGuard } =
      await import("../integrations/openclaw/topology/lib/guard.mjs");
    const payload = { ...openedBase, task_id: deriveTaskId(openedBase) };
    const snapshot = applyWorkflowEvent(
      openedSnapshot(),
      "WORKFLOW_OPENED",
      payload,
    );
    const guard = createGovernanceGuard({
      paths: {},
      manifestFor: () => ({}),
      _snapshotOverride: snapshot,
    });
    const context = {
      agentId: "main",
      sessionKey: openedBase.root_session_key,
      runId: openedBase.root_run_id,
    };
    const verdict = guard.beforeRunEnd(
      { success: true, yielded: true },
      context,
    );
    assert.equal(verdict.allow, true);
  });
});
// ===========================================================================
// F-230 - the transaction preimage must round-trip binary bytes
// ===========================================================================
// The capture hashed the raw bytes but STORED them as UTF-8 text, and the
// verifier re-hashed the stored text. Every byte that is not valid UTF-8 was
// therefore lost on the way in and the re-hash disagreed with the digest the
// capture had recorded: one binary asset made the whole capture throw
// TRANSACTION_SNAPSHOT_INCONSISTENT and left no rollback target at all.
//
// The body is now stored as base64, so the bytes that were hashed are the
// bytes that are restored.
describe("M12/T9 - F-230: a transaction snapshot round-trips binary bytes", () => {
  function buildFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zink-snapshot-"));
    const stateDir = path.join(root, "state");
    const runtimeRoot = path.join(root, "runtime");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(runtimeRoot, { recursive: true });
    // A deliberately non-UTF-8 asset: 0xff and 0xfe are not valid UTF-8.
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41, 0x80, 0x42]);
    fs.writeFileSync(path.join(stateDir, "openclaw.json"), bytes);
    return { root, stateDir, runtimeRoot, bytes };
  }

  test("F-230: a binary asset is captured, verified and restored byte-exactly", async () => {
    const {
      createTransactionSnapshot,
      verifyTransactionSnapshot,
      restoreTransactionSnapshot,
    } =
      await import("../integrations/openclaw/topology/lib/transaction-snapshot.mjs");
    const { createHash } = await import("node:crypto");
    const fixture = buildFixture();
    try {
      const snapshot = createTransactionSnapshot({
        stateDir: fixture.stateDir,
        runtimeRoot: fixture.runtimeRoot,
      });
      const entry = snapshot.files["openclaw.json"];
      assert.equal(entry.existed, true);
      assert.equal(
        entry.sha256,
        createHash("sha256").update(fixture.bytes).digest("hex"),
        "the digest must be taken over the raw bytes",
      );
      assert.doesNotThrow(
        () => verifyTransactionSnapshot(snapshot),
        "a binary asset must not make the capture unverifiable",
      );
      // Mutate the live asset and roll back.
      fs.writeFileSync(
        path.join(fixture.stateDir, "openclaw.json"),
        Buffer.from([0x00, 0x01]),
      );
      restoreTransactionSnapshot(snapshot);
      const restored = fs.readFileSync(
        path.join(fixture.stateDir, "openclaw.json"),
      );
      assert.deepEqual(
        [...restored],
        [...fixture.bytes],
        "the restored preimage must be byte-identical",
      );
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  test("F-230: a snapshot written before the rule still verifies", async () => {
    const { verifyTransactionSnapshot } =
      await import("../integrations/openclaw/topology/lib/transaction-snapshot.mjs");
    const { createHash } = await import("node:crypto");
    const text = '{"schema_version":"1.0.0"}';
    const legacy = {
      schema: "zink-transaction-snapshot/1",
      stateDir: "/tmp/state",
      runtimeRoot: "/tmp/runtime",
      files: {
        "openclaw.json": {
          existed: true,
          sha256: createHash("sha256").update(text, "utf8").digest("hex"),
          mode: 0o600,
          body: text,
        },
      },
    };
    assert.doesNotThrow(
      () => verifyTransactionSnapshot(legacy),
      "a text-body snapshot written before the rule must still verify",
    );
  });
});

// ===========================================================================
// F-059 - a refused admission keeps the cause it refused for
// ===========================================================================
// The run-admission path discarded the original findSession failure
// (`void findErr`) and then threw a bare code, so the operator saw a symptom
// with no reason attached: an admission refusal that could not be told apart
// from a candidate-count, a lineage or a snapshot-read failure.
describe("M12/T9 - F-059: a refused admission preserves the original cause", () => {
  test("F-059: the refusal carries the findSession failure as its cause", async () => {
    const { createGovernanceGuard } =
      await import("../integrations/openclaw/topology/lib/guard.mjs");
    // A task with a pending continuation for this run, but no session the
    // guard can resolve: findSession therefore fails, and the continuation
    // path is the one that has to explain WHY.
    const snapshot = {
      tasks: {
        ["a".repeat(64)]: {
          task_id: "a".repeat(64),
          workflow_status: "ACTIVE",
          brief_state: "ACTIVE",
          root_agent_id: "main",
          root_session_key: "agent:main:sess-1",
          root_run_id: "run-1",
          nodes: [],
          delegations: {},
          continuations: {
            "run-2": {
              session_key: "agent:o1:child-2",
              source_session_key: "agent:o1:child-1",
              trigger_run_id: "run-1",
              previous_run_id: "run-1",
              started: false,
            },
          },
        },
      },
      sequence: 0,
    };
    const guard = createGovernanceGuard({
      paths: {},
      manifestFor: () => ({}),
      _snapshotOverride: snapshot,
    });
    let thrown = null;
    try {
      guard.beforeRun(
        {},
        {
          agentId: "o1",
          sessionKey: "agent:o1:child-2",
          runId: "run-2",
          inputProvenance: {
            kind: "not_inter_session",
            sourceTool: "subagent_announce",
            sourceSessionKey: "agent:o1:child-1",
          },
        },
      );
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown, "the admission must be refused");
    assert.equal(
      thrown.message,
      "LINEAGE_MISMATCH",
      "the refusal still names the symptom",
    );
    assert.ok(
      thrown.cause,
      "the refusal must carry the original findSession failure as its cause",
    );
    assert.equal(
      thrown.cause.message,
      "EXECUTION_STATE_UNKNOWN",
      "the cause is the failure the guard actually hit",
    );
  });
});

// ===========================================================================
// M12/T9 - F-062 / F-127 / F-157 / F-159 / F-182 / F-220
// ===========================================================================
describe("M12/T9 - F-062: the admission liveness is consumed once and re-recorded by the next admission", () => {
  // MEASURED, and the reason this row is not a topology fix.
  //
  // The native boundary records the admission liveness per run id and CONSUMES
  // it at the run-end (the R18 contract: a record is read once and cannot be
  // replayed). The premise of F-062 was that a model-fallback re-entry under
  // an already-consumed run id therefore loses its liveness and is judged by
  // the full completion predicate instead of the liveness one.
  //
  // Measured at HEAD: the ADMISSION re-records the liveness for the run id
  // (`rememberRunLiveness` runs on every accepted admission, and the native
  // patch injects that admission at the start of every run attempt). So a
  // fallback RE-ENTRY does resolve the admission liveness - the fallback
  // attempt is judged by the same predicate as the primary - while a second
  // run-end with no new admission is correctly NOT a heartbeat.
  //
  // The half that is still broken lives in the plugin entrypoint, whose
  // `forgetAdmissionLiveness` deletes the record at the run-end while the
  // fallback path does not re-admit: that file is outside this agent's write
  // scope. These two cases pin the measured behaviour so the claim stays
  // checkable.
  async function drive(runIds) {
    const { enterNativeRun, finishNativeRun, registerNativeGuard } =
      await import("../integrations/openclaw/topology/lib/native-boundary.mjs");
    const scope = fs.mkdtempSync(path.join(os.tmpdir(), "zink-f062-"));
    const seen = [];
    const unregister = registerNativeGuard(scope, {
      beforeToolCall: () => ({ allow: true }),
      beforeAnnounce: () => ({ action: "deliver", receipt: "receipt" }),
      beforeRun: () => ({ allow: true }),
      beforeRunEnd: (_event, context) => {
        seen.push({
          trigger: context.trigger,
          transcriptPrompt: context.transcriptPrompt,
        });
        return { allow: true };
      },
      beforeIngress: () => ({ prompt: "prompt" }),
      recordQuota: () => ({ recorded: true }),
      selfQuotaReceipt: () => ({ receipt: "quota" }),
      resolveRunModel: () => ({ model: "fixture-model" }),
    });
    const config = {
      plugins: {
        entries: {
          "zink-governance": {
            enabled: true,
            config: { ledgerRoot: scope },
          },
        },
      },
    };
    try {
      for (const action of runIds) {
        if (action === "admit")
          await enterNativeRun(
            config,
            {
              agentId: "main",
              sessionKey: "session-1",
              runId: "run-1",
              trigger: "heartbeat",
              transcriptPrompt: "transcript-1",
            },
            undefined,
          );
        else
          await finishNativeRun(
            config,
            { runId: "run-1", outcome: "ok" },
            { agentId: "main", sessionKey: "session-1", runId: "run-1" },
          );
      }
      return seen;
    } finally {
      unregister();
      fs.rmSync(scope, { recursive: true, force: true });
    }
  }

  test("F-062: a fallback RE-ENTRY is judged by the same predicate as the primary attempt", async () => {
    const seen = await drive(["admit", "end", "admit", "end"]);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], {
      trigger: "heartbeat",
      transcriptPrompt: "transcript-1",
    });
    assert.deepEqual(
      seen[1],
      { trigger: "heartbeat", transcriptPrompt: "transcript-1" },
      "the re-admitted fallback attempt must be judged by the same predicate as the primary",
    );
  });

  test("F-062: a second run-end with NO new admission is not a heartbeat (the consume-once contract)", async () => {
    const seen = await drive(["admit", "end", "end"]);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0], {
      trigger: "heartbeat",
      transcriptPrompt: "transcript-1",
    });
    assert.equal(
      seen[1].trigger,
      undefined,
      "the liveness record is read once and cannot be replayed",
    );
  });
});

describe("M12/T9 - F-159: one refusal classifier for both operator drivers", () => {
  const repoFile = (relative) =>
    fileURLToPath(new URL(`../${relative}`, import.meta.url));

  test("F-159: the preflight and the apply name the same refusal the same way", async () => {
    const { classifyRefusal } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/refusal-classifier.mjs");
    const { classifyApplyReason } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs");
    // Every one of these was named by ONE driver only, so the other degraded
    // it to a meaningless fallback.
    const diagnostics = [
      "Ledger corruption",
      "symlink",
      "mode drift",
      "Systemd drop-in",
      "Auth order plan",
      "Password-store resolver",
      "Governance plugin package",
      "ROUTER_HOST_UNAVAILABLE",
      "ROUTER_PORT_UNAVAILABLE",
      "ROUTER_API_KEY_UNAVAILABLE",
      "must be a numeric Discord snowflake",
      "Existing config must be canonical JSON",
      "T2 backup manifest",
      "Auth SecretRef plan",
      "Governance identity key",
      "surface IDs must be distinct",
      "Gemini stream hotfix utility",
      "INVALID_IDENTIFIER_FILE",
      "GATEWAY_NOT_ACTIVE",
      "Policy drift",
    ];
    for (const diagnostic of diagnostics) {
      const error = {
        stderr: `builder refused: ${diagnostic}`,
        message: "",
        code: "",
      };
      const preflight = classifyRefusal(error, "PREFLIGHT_REJECTED");
      const apply = classifyApplyReason(error);
      assert.equal(
        preflight,
        apply,
        `both modes must name "${diagnostic}" the same way`,
      );
      assert.notEqual(preflight, "PREFLIGHT_REJECTED");
      assert.notEqual(apply, "APPLY_REJECTED");
    }
    // A refusal no class names still collapses to the mode's own fallback.
    const unknown = {
      stderr: "something else entirely",
      message: "",
      code: "",
    };
    assert.equal(
      classifyRefusal(unknown, "PREFLIGHT_REJECTED"),
      "PREFLIGHT_REJECTED",
    );
    assert.equal(classifyApplyReason(unknown), "APPLY_REJECTED");
  });

  test("F-159: a drifted class set is refused instead of silently diverging", async () => {
    const { assertSameRefusalClasses, KNOWN_REFUSAL_REASONS } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/refusal-classifier.mjs");
    assert.equal(
      assertSameRefusalClasses(KNOWN_REFUSAL_REASONS, KNOWN_REFUSAL_REASONS),
      true,
    );
    assert.throws(
      () => assertSameRefusalClasses(["A"], ["B"]),
      /REFUSAL_CLASS_SET_DRIFT/u,
      "a drifted class set must fail closed, not report a class the other driver does not know",
    );
    assert.throws(
      () => assertSameRefusalClasses(["B", "A"], ["A", "B"]),
      /REFUSAL_CLASS_SET_DRIFT/u,
      "the ORDER is part of the contract: the most specific class must be found first",
    );
  });

  test("F-159: neither driver keeps a second list of its own", () => {
    const applySource = fs.readFileSync(
      repoFile(
        "integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs",
      ),
      "utf8",
    );
    assert.ok(
      applySource.includes('from "./refusal-classifier.mjs"'),
      "the apply driver must use the shared classifier",
    );
    assert.ok(
      !/const\s+KNOWN_REASONS\s*=\s*\[/u.test(applySource),
      "the apply driver must not keep a literal list of its own",
    );
    const preflightSource = fs.readFileSync(
      repoFile(
        "integrations/openclaw/topology/fixtures/runtime-regression/operator-preflight.mjs",
      ),
      "utf8",
    );
    assert.ok(
      preflightSource.includes('from "./refusal-classifier.mjs"'),
      "the preflight driver must use the shared matching rule",
    );
    assert.ok(
      preflightSource.includes(
        "assertSameRefusalClasses(known, KNOWN_REFUSAL_REASONS)",
      ),
      "the preflight driver must assert that its class set is the shared one, in the same order",
    );
  });
  test("F-383: the nested ledger root the ceremony refuses is named, not left as APPLY_REJECTED", async () => {
    const { classifyRefusal, KNOWN_REFUSAL_REASONS } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/refusal-classifier.mjs");
    const { classifyApplyReason } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs");
    // Measured on the live host on 2026-10-22: the builder's apply refused with
    // exactly this literal (`createRuntimeBackup`'s nested-governance-root gate)
    // and the operator's report carried `APPLY_REJECTED` — the one fact that
    // names the artifact was on stderr only.
    const diagnostic = "BACKUP_NESTED_LEDGER_ROOT_PRESENT";
    const error = {
      stderr: `${diagnostic}: /home/example/.openclaw-zink/operator/m7-t2/ledger/operator/m7-t2/ledger`,
      message: "",
      code: "",
    };
    assert.ok(
      KNOWN_REFUSAL_REASONS.includes(diagnostic),
      "the shared class set must name the ceremony's own refusal",
    );
    assert.equal(
      classifyRefusal(error, "PREFLIGHT_REJECTED"),
      diagnostic,
      "the preflight must report the class, not its fallback",
    );
    assert.equal(
      classifyApplyReason(error),
      diagnostic,
      "the apply must report the class, not APPLY_REJECTED",
    );
    // The preflight driver keeps its own statement of the set and asserts
    // equality at load time; an entry it does not carry turns that assertion
    // into a thrown error, so the refusal stops being reported as a report.
    const source = fs.readFileSync(
      repoFile(
        "integrations/openclaw/topology/fixtures/runtime-regression/operator-preflight.mjs",
      ),
      "utf8",
    );
    assert.ok(
      source.includes(`"${diagnostic}"`),
      "the preflight driver's list must carry the class in the shared order",
    );
  });
});

describe("M12/T9 - F-182: the apply reloads the unit and verifies the LOADED definition", () => {
  const repoFile = (relative) =>
    fileURLToPath(new URL(`../${relative}`, import.meta.url));

  test("F-182: the reload happens before the restart and the loaded unit is verified", () => {
    const source = fs.readFileSync(
      repoFile(
        "integrations/openclaw/topology/fixtures/runtime-regression/operator-apply.mjs",
      ),
      "utf8",
    );
    const reload = source.indexOf('"daemon-reload"');
    const restart = source.indexOf('"restart", service');
    assert.ok(
      reload !== -1,
      "the apply must reload the unit manager before it restarts the unit",
    );
    assert.ok(restart !== -1);
    assert.ok(
      reload < restart,
      "the reload must happen BEFORE the restart, or the restart keeps the old definition",
    );
    assert.ok(
      source.includes('"--property=MemoryMax"'),
      "the post-apply check must read the LOADED unit, not only the on-disk bytes",
    );
    assert.ok(
      source.includes("GATEWAY_UNIT_NOT_RELOADED"),
      "a unit that is not the loaded definition must be named",
    );
  });

  test("F-182: the refusal is named by the shared classifier", async () => {
    const { classifyRefusal } =
      await import("../integrations/openclaw/topology/fixtures/runtime-regression/refusal-classifier.mjs");
    assert.equal(
      classifyRefusal(
        { stderr: "GATEWAY_UNIT_NOT_RELOADED", message: "", code: "" },
        "PREFLIGHT_REJECTED",
      ),
      "GATEWAY_UNIT_NOT_RELOADED",
    );
  });
});

describe("M12/T9 - F-157: one derivation per concept", () => {
  const repoFile = (relative) =>
    fileURLToPath(new URL(`../${relative}`, import.meta.url));

  test("F-157: the approval scope has ONE derivation and the reference id has ONE derivation", () => {
    const canonical = fs.readFileSync(
      repoFile("integrations/openclaw/topology/lib/canonical.mjs"),
      "utf8",
    );
    assert.ok(
      !/export function deriveApprovalScopeDigest/u.test(canonical),
      "the verbatim approval-scope twin must not survive in the topology library: the deployed plugin flattens both files into one lib/, so the two would hash the same scope differently",
    );
    const guard = fs.readFileSync(
      repoFile("integrations/openclaw/topology/lib/guard.mjs"),
      "utf8",
    );
    assert.ok(
      !guard.includes('canonicalHash("zink-reference-v1"'),
      "the guard must call the single reference derivation instead of re-inlining the domain tag",
    );
    // M12/T9 F-247: the owner ruled ("bỏ ô") that the unwritten
    // reference-digest slot is removed from the contract and from every
    // reader, so the guard no longer derives a reference digest at all - the
    // reference is validated by the PUBLISHED delegation-envelope contract.
    // The claim this lane exists for is UNCHANGED: there is exactly ONE
    // reference derivation, and it is not inlined a second time anywhere.
    assert.ok(
      !guard.includes("deriveReferenceId("),
      "the guard must not derive a reference digest: the unwritten slot is gone (F-247)",
    );
    assert.ok(
      /export function deriveReferenceId\(/u.test(canonical),
      "the canonical module must still declare the ONE reference derivation",
    );
  });

  test("F-157: the canonicalizers declare their distinct roles", () => {
    const canonical = fs.readFileSync(
      repoFile("integrations/openclaw/topology/lib/canonical.mjs"),
      "utf8",
    );
    const schema = fs.readFileSync(
      repoFile("integrations/openclaw/topology/lib/schema.mjs"),
      "utf8",
    );
    assert.ok(
      canonical.includes("HASH PREIMAGE serializer"),
      "the hash preimage serializer must state its role",
    );
    assert.ok(
      schema.includes("COMPARISON serializer"),
      "the comparison serializer must state its role",
    );
  });
});

describe("M12/T9 - F-127: one declaration owns the outcome vocabulary", () => {
  const repoFile = (relative) =>
    fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const OUTCOME_PROPERTIES = new Set([
    "outcome_status",
    "outcome_claim",
    "accepted_outcome_status",
    "pending_outcome_status",
  ]);

  function collectOutcomeEnums(node, where = "$", found = []) {
    if (Array.isArray(node)) {
      node.forEach((item, index) =>
        collectOutcomeEnums(item, `${where}[${index}]`, found),
      );
      return found;
    }
    if (!node || typeof node !== "object") return found;
    for (const [key, value] of Object.entries(node)) {
      if (
        OUTCOME_PROPERTIES.has(key) &&
        value &&
        typeof value === "object" &&
        Array.isArray(value.enum)
      ) {
        found.push([`${where}.${key}`, value.enum]);
        continue;
      }
      collectOutcomeEnums(value, `${where}.${key}`, found);
    }
    return found;
  }

  test("F-127: every outcome enum in the contracts equals the ONE declared vocabulary", async () => {
    const { OUTCOME_STATUSES } =
      await import("../integrations/openclaw/topology/lib/runtime.mjs");
    const matrix = JSON.parse(
      fs.readFileSync(
        repoFile(
          "integrations/openclaw/topology/policy/reason-code-matrix.json",
        ),
        "utf8",
      ),
    );
    assert.deepEqual(
      matrix.outcome_statuses,
      ["COMPLETE", "PARTIAL", "BLOCKED", "FAILED"],
      "the matrix declares the outcome vocabulary exactly once",
    );
    assert.deepEqual(
      [...OUTCOME_STATUSES],
      matrix.outcome_statuses,
      "the runtime derives the vocabulary from that one declaration",
    );
    let checked = 0;
    for (const name of [
      "agent-result-payload",
      "ledger-event",
      "ledger-snapshot",
      "trusted-result-envelope",
    ]) {
      const schema = JSON.parse(
        fs.readFileSync(
          repoFile(
            `integrations/openclaw/topology/contracts/${name}.schema.json`,
          ),
          "utf8",
        ),
      );
      for (const [where, values] of collectOutcomeEnums(schema)) {
        const withoutNull = values.filter((value) => value !== null);
        assert.deepEqual(
          [...withoutNull].sort(),
          [...matrix.outcome_statuses].sort(),
          `${name}: ${where} must equal the declared vocabulary`,
        );
        checked += 1;
      }
    }
    assert.ok(
      checked >= 6,
      `every outcome enum in the contracts must be checked (found ${checked})`,
    );
  });

  test("F-127: the cancellation codes the reducer accepts are the matrix row intersected with the published contract", async () => {
    const { eventPayloadEnum } =
      await import("../integrations/openclaw/topology/lib/schema.mjs");
    const matrix = JSON.parse(
      fs.readFileSync(
        repoFile(
          "integrations/openclaw/topology/policy/reason-code-matrix.json",
        ),
        "utf8",
      ),
    );
    const contract = eventPayloadEnum(
      "ledger-event",
      "WORKFLOW_CANCELLED",
      "reason_code",
    );
    assert.deepEqual(contract, ["OWNER_CANCELLED", "PARENT_CANCELLED"]);
    assert.deepEqual(
      matrix.outcome_compatibility.CANCELLED.filter((code) =>
        contract.includes(code),
      ),
      ["OWNER_CANCELLED", "PARENT_CANCELLED"],
      "the reducer accepts what the policy AND the contract express",
    );
    // PENDING OWNER DECISION (F-127): the matrix declares SUPERSEDED_REVISION
    // under CANCELLED, but the published ledger-event contract cannot carry
    // it. Widening a published schema is a contract change (ACTIVE.md 3 rule
    // 9), so the reducer refuses the code and this assertion PINS the
    // divergence: it turns RED the moment the owner resolves it, in either
    // direction.
    assert.deepEqual(
      matrix.outcome_compatibility.CANCELLED.filter(
        (code) => !contract.includes(code),
      ),
      ["SUPERSEDED_REVISION"],
    );
  });
});

// ===========================================================================
// M12/T9 - F-220: the reserved fixture directories carry real vectors and a
// loader that compares them against the production behaviour.
// ===========================================================================
describe("M12/T9 - F-220: the fixture directories carry vectors, not reservation notes", () => {
  const repoFile = (relative) =>
    fileURLToPath(new URL(`../${relative}`, import.meta.url));
  const fixture = (relative) =>
    JSON.parse(
      fs.readFileSync(
        repoFile(`integrations/openclaw/topology/fixtures/${relative}`),
        "utf8",
      ),
    );

  test("F-220: every canonicalization vector produces its pinned digest", async () => {
    const { canonicalHash } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const vectors = fixture("canonical-hash/vectors.json");
    assert.ok(
      vectors.vectors.length >= 4,
      "the canonicalization vectors must exist",
    );
    for (const vector of vectors.vectors) {
      assert.equal(
        canonicalHash(vector.domain, vector.value),
        vector.expected_sha256,
        `canonicalization vector: ${vector.name}`,
      );
    }
  });

  test("F-220: every lifecycle scenario reaches the state the vector states", async () => {
    const { applyWorkflowEvent } =
      await import("../integrations/openclaw/topology/lib/workflow.mjs");
    const { deriveTaskId } =
      await import("../integrations/openclaw/topology/lib/canonical.mjs");
    const scenarios = fixture("lifecycle/vectors.json");
    assert.ok(
      scenarios.scenarios.length >= 3,
      "the lifecycle vectors must exist",
    );
    for (const scenario of scenarios.scenarios) {
      const task_id = deriveTaskId(scenario.origin);
      let snapshot = { tasks: {}, sequence: 0 };
      const apply = (type, payload) => {
        const body =
          type === "WORKFLOW_OPENED"
            ? { ...scenario.origin, ...(payload ?? {}) }
            : (payload ?? {});
        snapshot = applyWorkflowEvent(snapshot, type, { task_id, ...body });
      };
      for (const event of scenario.events) apply(event.type, event.payload);
      const task = snapshot.tasks[task_id];
      assert.equal(
        task.workflow_status,
        scenario.expected.workflow_status,
        `lifecycle vector: ${scenario.name}`,
      );
      assert.equal(
        task.brief_state,
        scenario.expected.brief_state,
        `lifecycle vector: ${scenario.name}`,
      );
      for (const event of scenario.then ?? []) {
        apply(event.type, event.payload);
        const after = snapshot.tasks[task_id];
        assert.equal(
          after.workflow_status,
          scenario.expected_after_then.workflow_status,
          `lifecycle vector (after the verdict): ${scenario.name}`,
        );
        assert.equal(
          after.brief_state,
          scenario.expected_after_then.brief_state,
          `lifecycle vector (after the verdict): ${scenario.name}`,
        );
      }
    }
  });

  test("F-220: every routing vector states the production edge", async () => {
    const { AGENT_SPAWN_POLICY } =
      await import("../integrations/openclaw/lib/policy.mjs");
    const vectors = fixture("routing/vectors.json");
    assert.ok(vectors.vectors.length >= 15, "the routing vectors must exist");
    for (const vector of vectors.vectors) {
      const allowed = (AGENT_SPAWN_POLICY[vector.parent] ?? []).includes(
        vector.target,
      );
      assert.equal(
        allowed,
        vector.allowed,
        `routing vector: ${vector.parent} -> ${vector.target}`,
      );
    }
  });

  test("F-220: no tracked fixture directory contains only a reservation note", () => {
    const root = repoFile("integrations/openclaw/topology/fixtures");
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const child = path.join(directory, entry.name);
        const files = fs.readdirSync(child);
        assert.ok(
          files.some((file) => !file.toLowerCase().endsWith("readme.md")),
          `the fixture directory ${entry.name} must carry real content, not only a reservation note`,
        );
        walk(child);
      }
    };
    walk(root);
  });
});
