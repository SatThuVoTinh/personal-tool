import crypto from "node:crypto";
import { EXECUTION_STATE_SIMULATED } from "../../common/execution-state.mjs";

export class HuggingFaceAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HuggingFaceAdapterError";
    this.code = code;
  }
}

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * Hugging Face integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * ignored rather than retained, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed Hugging Face Adapter
 * Evaluates external candidate models/datasets as untrusted inputs without automatic promotion.
 *
 * F-446 (R9-L07a-1): the constructor used to assign `options.apiToken` to an
 * instance field no method ever read. A credential the adapter does not
 * authenticate with is not a configuration knob — it is a value kept alive in
 * process memory and in any serialization of the instance. The option is
 * accepted (callers may forward a shared provider config) and discarded.
 */
export class HuggingFaceAdapter {
  /**
   * Evaluates an external candidate model against an evaluation dataset.
   * Untrusted boundary: records checksum, provenance, evaluation metrics,
   * and tags candidate as candidate_status: "EVALUATED_NOT_PROMOTED".
   *
   * @param {object} params
   * @param {string} params.repo_id
   * @param {string} [params.revision="main"]
   * @param {string} params.evaluation_dataset
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async evaluateCandidateModel(
    { repo_id, revision = "main", evaluation_dataset },
    options = {},
  ) {
    if (!repo_id) {
      throw new HuggingFaceAdapterError(
        "HUGGINGFACE_INVALID_REPO",
        "repo_id is required.",
      );
    }
    if (!evaluation_dataset) {
      throw new HuggingFaceAdapterError(
        "HUGGINGFACE_MISSING_DATASET",
        "evaluation_dataset is required for model validation.",
      );
    }

    if (options.simulateTimeout) {
      throw new HuggingFaceAdapterError(
        "HUGGINGFACE_TIMEOUT",
        "Hugging Face model evaluation timed out.",
      );
    }

    const checksum = crypto
      .createHash("sha256")
      .update(`${repo_id}@${revision}`)
      .digest("hex");

    return Object.freeze({
      provider: "huggingface",
      // F-279 (R7-C2-04): the explicit fidelity marker. `candidate_status`
      // says the candidate was not promoted; it never said that no real
      // provider evaluation ran.
      execution_state: EXECUTION_STATE_SIMULATED,
      repo_id,
      revision,
      checksum,
      evaluation_dataset,
      eval_metrics: Object.freeze({
        accuracy: 0.892,
        f1_score: 0.884,
        inference_latency_ms: 42,
      }),
      // Mandatory non-promotion invariant:
      candidate_status: "EVALUATED_NOT_PROMOTED",
      evaluated_at: new Date().toISOString(),
      provenance: Object.freeze({
        source: `https://huggingface.co/${repo_id}`,
        revision,
        untrusted_input: true,
      }),
    });
  }
}
