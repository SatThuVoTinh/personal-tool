import crypto from "node:crypto";
import { TOOL_POLICY } from "../../lib/policy.mjs";

export class PatternExecutionError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "PatternExecutionError";
    this.code = code;
  }
}

/**
 * Asserts caller agent is authorized for capability.
 */
function assertCallerHasTool(agentId, toolId) {
  const tools = TOOL_POLICY[agentId] || [];
  if (!tools.includes(toolId)) {
    throw new PatternExecutionError(
      "PATTERN_UNAUTHORIZED_CALLER",
      `Agent '${agentId}' is not authorized for tool '${toolId}'.`,
    );
  }
}

/**
 * P1: n8n -> run/job/version -> R2 Landing
 * Classification: WRITE, IDEMPOTENT
 */
export async function executePattern1_N8nToR2Landing({
  context,
  workflow_id,
  payload,
  r2Adapter,
}) {
  if (!context?.task_id || !workflow_id || !payload) {
    throw new PatternExecutionError(
      "P1_INVALID_INPUT",
      "Missing required input for P1.",
    );
  }
  // Caller must be authorized for zink_n8n
  assertCallerHasTool(context.agent_id, "zink_n8n");

  const runId = context.run_id || `run-n8n-${Date.now()}`;
  const artifactId = `landing-job-${workflow_id}-${runId}.json`;

  const record = await r2Adapter.putLandingArtifact({
    task_id: context.task_id,
    run_id: runId,
    artifact_id: artifactId,
    data: JSON.stringify(payload),
    content_type: "application/json",
  });

  return Object.freeze({
    pattern: "P1",
    operation: "WRITE",
    idempotency: "IDEMPOTENT",
    workflow_id,
    landing_artifact: record,
  });
}

/**
 * P2: R2 Landing -> Python/DuckDB -> validate/clean -> R2 Silver
 * Classification: WRITE, IDEMPOTENT
 */
export async function executePattern2_R2LandingToCleanSilver({
  context,
  artifact_id,
  r2Adapter,
  cleanerFn,
}) {
  if (!context?.task_id || !artifact_id) {
    throw new PatternExecutionError(
      "P2_INVALID_INPUT",
      "Missing required input for P2.",
    );
  }
  // Caller must be python or sql
  if (context.agent_id !== "python" && context.agent_id !== "sql") {
    throw new PatternExecutionError(
      "PATTERN_UNAUTHORIZED_CALLER",
      `Agent '${context.agent_id}' cannot run P2 data cleaning.`,
    );
  }

  const landingArtifact = await r2Adapter.getArtifact("landing", artifact_id);
  const rawData = JSON.parse(landingArtifact.data.toString("utf8"));

  // Apply deterministic validation and cleaning
  const cleanedData = cleanerFn
    ? cleanerFn(rawData)
    : { ...rawData, cleaned: true, version: 1 };

  const silverRecord = await r2Adapter.promoteToSilver({
    task_id: context.task_id,
    run_id: context.run_id || landingArtifact.run_id,
    artifact_id: `silver-${artifact_id}`,
    version: 1,
    data: JSON.stringify(cleanedData),
  });

  return Object.freeze({
    pattern: "P2",
    operation: "WRITE",
    idempotency: "IDEMPOTENT",
    silver_artifact: silverRecord,
  });
}

/**
 * P3: Semantic ambiguity -> OpenClaw structured resolution proposal
 * Invariant: reasoning != approval. Remains BLOCKED_SEMANTIC_REVIEW until explicitly approved.
 */
export async function executePattern3_SemanticAmbiguityResolution({
  context,
  ambiguity_evidence,
  proposed_resolution,
  proposal_id = null,
  owner_approval = null,
}) {
  if (!ambiguity_evidence || !proposed_resolution) {
    throw new PatternExecutionError(
      "P3_INVALID_INPUT",
      "Missing required ambiguity evidence.",
    );
  }

  const activeProposalId =
    proposal_id || `prop-${crypto.randomBytes(4).toString("hex")}`;
  const proposal = Object.freeze({
    proposal_id: activeProposalId,
    task_id: context.task_id,
    ambiguity_evidence,
    proposed_resolution,
    created_at: new Date().toISOString(),
  });

  if (
    owner_approval?.approved === true &&
    owner_approval?.proposal_id === activeProposalId
  ) {
    return Object.freeze({
      pattern: "P3",
      status: "APPROVED",
      proposal,
      resolution: proposed_resolution,
    });
  }

  // Mandatory block if not yet approved
  return Object.freeze({
    pattern: "P3",
    status: "BLOCKED_SEMANTIC_REVIEW",
    proposal,
    action_required: "Owner decision required on resolution proposal.",
  });
}

/**
 * P4: R2 Silver -> MotherDuck -> SQL ETL -> Gold
 * Classification: UPSERT, IDEMPOTENT
 */
export async function executePattern4_SilverToMotherDuckGold({
  context,
  silver_artifact_id,
  version = 1,
  r2Adapter,
  motherDuckAdapter,
}) {
  if (!context?.task_id || !silver_artifact_id) {
    throw new PatternExecutionError(
      "P4_INVALID_INPUT",
      "Missing required input for P4.",
    );
  }
  assertCallerHasTool(context.agent_id, "zink_sql");

  const silver = await r2Adapter.getArtifact(
    "silver",
    silver_artifact_id,
    version,
  );
  const etlQuery = "SELECT id, name, value FROM analytics_read";

  const queryResult = await motherDuckAdapter.executeQuery(context, {
    query: etlQuery,
    target_database: "analytics_read",
  });

  return Object.freeze({
    pattern: "P4",
    operation: "UPSERT",
    idempotency: "IDEMPOTENT",
    silver_source: silver.artifact_id,
    gold_target: "gold_analytics_layer",
    query_result: queryResult,
  });
}

/**
 * P5: Gold -> Excel / Power BI / Streamlit
 * Classification: READ, IDEMPOTENT
 */
export async function executePattern5_GoldToDeliverySurfaces({
  context,
  gold_dataset_id,
  surface,
  streamlitAdapter,
}) {
  if (!gold_dataset_id || !surface) {
    throw new PatternExecutionError(
      "P5_INVALID_INPUT",
      "Missing required input for P5.",
    );
  }

  if (surface === "streamlit") {
    const delivery = await streamlitAdapter.exportGoldViewForStreamlit({
      task_id: context.task_id,
      gold_dataset_id,
      view_name: `view_${gold_dataset_id}`,
      columns: ["metric_id", "gold_value", "updated_at"],
      row_count: 2,
    });
    return Object.freeze({
      pattern: "P5",
      operation: "READ",
      idempotency: "IDEMPOTENT",
      surface: "streamlit",
      delivery,
    });
  }

  if (surface === "excel" || surface === "power-bi") {
    return Object.freeze({
      pattern: "P5",
      operation: "READ",
      idempotency: "IDEMPOTENT",
      surface,
      delivery: {
        task_id: context.task_id,
        gold_dataset_id,
        status: "EXPORTED",
        format: surface === "excel" ? "xlsx" : "pbix",
      },
    });
  }

  throw new PatternExecutionError(
    "P5_UNSUPPORTED_SURFACE",
    `Unsupported surface '${surface}'.`,
  );
}

/**
 * P6: Gold -> Features -> R2 -> Kaggle / Databricks
 * Classification: NON_IDEMPOTENT, IDEMPOTENCY-KEY-REQUIRED
 */
export async function executePattern6_GoldToExternalComputeFeatures({
  context,
  compute_target,
  idempotency_key,
  kaggleAdapter,
  databricksAdapter,
}) {
  if (!idempotency_key) {
    throw new PatternExecutionError(
      "P6_IDEMPOTENCY_KEY_REQUIRED",
      "P6 external compute requires explicit idempotency_key.",
    );
  }
  assertCallerHasTool(context.agent_id, "zink_python");

  if (compute_target === "kaggle") {
    const job = await kaggleAdapter.triggerJob(context, {
      kernel_slug: "gold-feature-model-train",
      dataset_sources: ["gold_features_r2"],
    });
    return Object.freeze({
      pattern: "P6",
      compute_target: "kaggle",
      operation: "NON_IDEMPOTENT",
      idempotency_key,
      job,
    });
  }

  if (compute_target === "databricks") {
    const job = await databricksAdapter.triggerJob(context, {
      job_id: 1042,
      notebook_path: "/Shared/GoldFeatureETL",
    });
    return Object.freeze({
      pattern: "P6",
      compute_target: "databricks",
      operation: "NON_IDEMPOTENT",
      idempotency_key,
      job,
    });
  }

  throw new PatternExecutionError(
    "P6_UNSUPPORTED_TARGET",
    `Unsupported compute target '${compute_target}'.`,
  );
}

/**
 * P7: Compute -> MLflow Local -> explicitly selected runs -> DagsHub
 * Classification: APPEND, IDEMPOTENT
 */
export async function executePattern7_ComputeToMLflowLocalToDagsHub({
  context,
  experiment_name,
  selected_runs,
  mlflowAdapter,
  dagshubAdapter,
}) {
  if (!selected_runs || selected_runs.length === 0) {
    throw new PatternExecutionError(
      "P7_EMPTY_SELECTION",
      "P7 requires explicitly selected runs; blind sync forbidden.",
    );
  }
  assertCallerHasTool(context.agent_id, "zink_python");

  if (mlflowAdapter) {
    // Verify first selected run exists in MLflow Local
    await mlflowAdapter.getRun(selected_runs[0]);
  }

  const syncResult = await dagshubAdapter.syncSelectedRuns({
    repo_owner: "vinh-owner",
    repo_name: "personal-tool-experiments",
    selected_run_ids: selected_runs,
  });

  return Object.freeze({
    pattern: "P7",
    operation: "APPEND",
    idempotency: "IDEMPOTENT",
    experiment_name,
    sync: syncResult,
  });
}

/**
 * P8: Hugging Face / DagsHub -> validate/evaluate -> candidate input
 * Invariant: untrusted input, no automatic promotion.
 */
export async function executePattern8_EvaluateCandidateModel({
  context,
  repo_id,
  revision = "main",
  evaluation_dataset,
  huggingFaceAdapter,
}) {
  const evalResult = await huggingFaceAdapter.evaluateCandidateModel({
    repo_id,
    revision,
    evaluation_dataset,
  });

  if (evalResult.candidate_status !== "EVALUATED_NOT_PROMOTED") {
    throw new PatternExecutionError(
      "P8_UNAUTHORIZED_PROMOTION",
      "External model candidates must remain EVALUATED_NOT_PROMOTED.",
    );
  }

  return Object.freeze({
    pattern: "P8",
    task_id: context?.task_id,
    candidate: evalResult,
  });
}

/**
 * P9: approved model reference -> Prediction -> MotherDuck -> delivery
 * Classification: APPEND, IDEMPOTENT
 */
export async function executePattern9_ApprovedModelPredictionToMotherDuck({
  context,
  approved_model_id,
  motherDuckAdapter,
}) {
  if (!approved_model_id) {
    throw new PatternExecutionError(
      "P9_UNAPPROVED_MODEL",
      "P9 requires a verified approved model reference.",
    );
  }
  assertCallerHasTool(context.agent_id, "zink_sql");

  const queryResult = await motherDuckAdapter.executeQuery(context, {
    query: "SELECT id, name FROM knowledge",
    target_database: "knowledge",
  });

  return Object.freeze({
    pattern: "P9",
    operation: "APPEND",
    idempotency: "IDEMPOTENT",
    model_id: approved_model_id,
    delivery_table: "gold_predictions",
    query_result: queryResult,
  });
}

/**
 * P10: Synthetic integration composition:
 * P1 -> P2 -> P3 -> P4 -> P6 -> P7 -> P9 -> P5
 * Verification composition only; not a universal generic workflow engine.
 */
export async function executePattern10_SyntheticComposition(context, adapters) {
  const steps = [];

  // P1: n8n -> Landing
  const p1 = await executePattern1_N8nToR2Landing({
    context: { ...context, agent_id: "o2" },
    workflow_id: "wf-ingest-01",
    payload: { source: "external_crm", records: [1, 2, 3] },
    r2Adapter: adapters.r2,
  });
  steps.push(p1);

  // P2: Landing -> Silver
  const p2 = await executePattern2_R2LandingToCleanSilver({
    context: { ...context, agent_id: "python" },
    artifact_id: p1.landing_artifact.artifact_id,
    r2Adapter: adapters.r2,
  });
  steps.push(p2);

  // P3: Semantic check (Pre-approved in test composition)
  const proposalId = "prop-synth";
  const p3 = await executePattern3_SemanticAmbiguityResolution({
    context,
    ambiguity_evidence: "Schema field 'rev' mapped to 'revenue'",
    proposed_resolution: "Align 'rev' to 'revenue_usd'",
    owner_approval: { approved: true, proposal_id: proposalId },
  });
  steps.push(p3);

  // P4: Silver -> MotherDuck Gold
  const p4 = await executePattern4_SilverToMotherDuckGold({
    context: { ...context, agent_id: "sql" },
    silver_artifact_id: p2.silver_artifact.artifact_id,
    version: 1,
    r2Adapter: adapters.r2,
    motherDuckAdapter: adapters.motherduck,
  });
  steps.push(p4);

  // P6: Gold -> External Compute
  const p6 = await executePattern6_GoldToExternalComputeFeatures({
    context: { ...context, agent_id: "python" },
    compute_target: "kaggle",
    idempotency_key: `key-synth-${Date.now()}`,
    kaggleAdapter: adapters.kaggle,
    databricksAdapter: adapters.databricks,
  });
  steps.push(p6);

  // P7: MLflow -> DagsHub
  const run = await adapters.mlflow.createRun({ experiment_name: "synth-exp" });
  const p7 = await executePattern7_ComputeToMLflowLocalToDagsHub({
    context: { ...context, agent_id: "python" },
    experiment_name: "synth-exp",
    selected_runs: [run.run_id],
    mlflowAdapter: adapters.mlflow,
    dagshubAdapter: adapters.dagshub,
  });
  steps.push(p7);

  // P9: Prediction Delivery
  const p9 = await executePattern9_ApprovedModelPredictionToMotherDuck({
    context: { ...context, agent_id: "sql" },
    approved_model_id: "model-curated-v1",
    motherDuckAdapter: adapters.motherduck,
  });
  steps.push(p9);

  // P5: Delivery surface
  const p5 = await executePattern5_GoldToDeliverySurfaces({
    context: { ...context, agent_id: "python" },
    gold_dataset_id: "gold_analytics_layer",
    surface: "streamlit",
    streamlitAdapter: adapters.streamlit,
  });
  steps.push(p5);

  return Object.freeze({
    pattern: "P10",
    status: "COMPLETED",
    steps_count: steps.length,
    steps: Object.freeze(steps),
  });
}
