import test, { describe } from "node:test";
import assert from "node:assert/strict";
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
