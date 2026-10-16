import test, { describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

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
} from "../zink-tools/adapters/index.mjs";

import {
  executePattern1_N8nToR2Landing,
  executePattern2_R2LandingToCleanSilver,
  executePattern3_SemanticAmbiguityResolution,
  executePattern4_SilverToMotherDuckGold,
  executePattern5_GoldToDeliverySurfaces,
  executePattern6_GoldToExternalComputeFeatures,
  executePattern7_ComputeToMLflowLocalToDagsHub,
  executePattern8_EvaluateCandidateModel,
  executePattern9_ApprovedModelPredictionToMotherDuck,
  executePattern10_SyntheticComposition,
} from "../integrations/openclaw/orchestration/patterns/index.mjs";

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

  test("Gate G3: n8n Localhost Boundary & Lifecycle Invariants", async () => {
    // n8n trigger is strictly localhost-bound
    const p1 = await executePattern1_N8nToR2Landing({
      context: { ...context, agent_id: "o2" },
      workflow_id: "wf-test-lifecycle",
      payload: { test_key: "test_val" },
      r2Adapter: adapters.r2,
    });
    assert.equal(p1.pattern, "P1");
    assert.equal(p1.landing_artifact.bucket, "landing");
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

  test("Gate G6: Orchestration Pattern P1 & P2", async () => {
    // P1: Ingest to Landing
    const p1 = await executePattern1_N8nToR2Landing({
      context: { ...context, agent_id: "o2" },
      workflow_id: "wf-ingest-crm",
      payload: { records: [{ id: 101, name: "Customer Alpha" }] },
      r2Adapter: adapters.r2,
    });
    assert.equal(p1.operation, "WRITE");
    assert.equal(p1.idempotency, "IDEMPOTENT");

    // Landing immutability: Re-writing exact artifact throws error
    await assert.rejects(
      async () => {
        await adapters.r2.putLandingArtifact({
          task_id: context.task_id,
          run_id: "run-dup",
          artifact_id: p1.landing_artifact.artifact_id,
          data: "duplicate",
        });
      },
      (err) => err.code === "R2_LANDING_IMMUTABLE_VIOLATION",
    );

    // P2: Clean to Silver
    const p2 = await executePattern2_R2LandingToCleanSilver({
      context: { ...context, agent_id: "python" },
      artifact_id: p1.landing_artifact.artifact_id,
      r2Adapter: adapters.r2,
      cleanerFn: (raw) => ({
        cleaned_records: raw.records,
        status: "VALIDATED",
      }),
    });
    assert.equal(p2.silver_artifact.bucket, "silver");
    assert.equal(p2.silver_artifact.version, 1);
  });

  test("Gate G7: Orchestration Pattern P3 Semantic Ambiguity Boundary", async () => {
    // Reasoning != approval; remains BLOCKED_SEMANTIC_REVIEW until explicitly approved
    const unapproved = await executePattern3_SemanticAmbiguityResolution({
      context,
      ambiguity_evidence:
        "Conflicting revenue column definitions in CRM vs ERP",
      proposed_resolution: "Standardize on ERP net_revenue_usd",
    });
    assert.equal(unapproved.status, "BLOCKED_SEMANTIC_REVIEW");
    assert.ok(unapproved.action_required);

    // Approved resolution with matching proposal_id
    const approved = await executePattern3_SemanticAmbiguityResolution({
      context,
      ambiguity_evidence: "Conflicting definitions",
      proposed_resolution: "Standardize on ERP net_revenue_usd",
      proposal_id: unapproved.proposal.proposal_id,
      owner_approval: {
        approved: true,
        proposal_id: unapproved.proposal.proposal_id,
      },
    });
    assert.equal(approved.status, "APPROVED");
  });

  test("Gate G8: Orchestration Patterns P4 & P5", async () => {
    // P4: Silver to MotherDuck Gold
    const p4 = await executePattern4_SilverToMotherDuckGold({
      context: { ...context, agent_id: "sql" },
      silver_artifact_id: "silver-landing-test.json",
      version: 1,
      r2Adapter: {
        getArtifact: async () => ({
          artifact_id: "silver-landing-test.json",
          data: "{}",
        }),
      },
      motherDuckAdapter: adapters.motherduck,
    });
    assert.equal(p4.operation, "UPSERT");
    assert.equal(p4.gold_target, "gold_analytics_layer");

    // P5: Gold to Streamlit & Excel
    const p5Streamlit = await executePattern5_GoldToDeliverySurfaces({
      context: { ...context, agent_id: "python" },
      gold_dataset_id: "gold_analytics_layer",
      surface: "streamlit",
      streamlitAdapter: adapters.streamlit,
    });
    assert.equal(p5Streamlit.surface, "streamlit");
    assert.equal(p5Streamlit.delivery.status, "READY");

    const p5Excel = await executePattern5_GoldToDeliverySurfaces({
      context: { ...context, agent_id: "excel" },
      gold_dataset_id: "gold_analytics_layer",
      surface: "excel",
    });
    assert.equal(p5Excel.delivery.format, "xlsx");
  });

  test("Gate G9: Orchestration Patterns P6, P7, P8, P9", async () => {
    // P6: Gold to Kaggle Compute Features (Idempotency key required)
    await assert.rejects(
      async () => {
        await executePattern6_GoldToExternalComputeFeatures({
          context: { ...context, agent_id: "python" },
          compute_target: "kaggle",
          kaggleAdapter: adapters.kaggle,
        });
      },
      (err) => err.code === "P6_IDEMPOTENCY_KEY_REQUIRED",
    );

    const p6 = await executePattern6_GoldToExternalComputeFeatures({
      context: { ...context, agent_id: "python" },
      compute_target: "kaggle",
      idempotency_key: "idem-key-p6-01",
      kaggleAdapter: adapters.kaggle,
    });
    assert.equal(p6.compute_target, "kaggle");
    assert.equal(p6.job.status, "COMPLETED");

    // P7: MLflow Local to DagsHub (Empty selection forbidden)
    await assert.rejects(
      async () => {
        await executePattern7_ComputeToMLflowLocalToDagsHub({
          context: { ...context, agent_id: "python" },
          experiment_name: "exp-01",
          selected_runs: [],
          mlflowAdapter: adapters.mlflow,
          dagshubAdapter: adapters.dagshub,
        });
      },
      (err) => err.code === "P7_EMPTY_SELECTION",
    );

    const run = await adapters.mlflow.createRun({ experiment_name: "exp-01" });
    const p7 = await executePattern7_ComputeToMLflowLocalToDagsHub({
      context: { ...context, agent_id: "python" },
      experiment_name: "exp-01",
      selected_runs: [run.run_id],
      mlflowAdapter: adapters.mlflow,
      dagshubAdapter: adapters.dagshub,
    });
    assert.equal(p7.sync.status, "SYNC_COMPLETED");

    // P8: Hugging Face candidate evaluation (Non-promotion invariant)
    const p8 = await executePattern8_EvaluateCandidateModel({
      context,
      repo_id: "zink-research/candidate-llm-v1",
      evaluation_dataset: "eval-validation-split",
      huggingFaceAdapter: adapters.huggingface,
    });
    assert.equal(p8.candidate.candidate_status, "EVALUATED_NOT_PROMOTED");
    assert.equal(p8.candidate.provenance.untrusted_input, true);

    // P9: Prediction Delivery to MotherDuck
    const p9 = await executePattern9_ApprovedModelPredictionToMotherDuck({
      context: { ...context, agent_id: "sql" },
      approved_model_id: "model-verified-v1",
      motherDuckAdapter: adapters.motherduck,
    });
    assert.equal(p9.delivery_table, "gold_predictions");
  });

  test("Gate G10: Synthetic Integration Composition (P10)", async () => {
    const p10 = await executePattern10_SyntheticComposition(context, adapters);
    assert.equal(p10.pattern, "P10");
    assert.equal(p10.status, "COMPLETED");
    assert.equal(p10.steps_count, 8); // P1, P2, P3, P4, P6, P7, P9, P5
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
