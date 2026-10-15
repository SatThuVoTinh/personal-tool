import crypto from "node:crypto";

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
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed Hugging Face Adapter
 * Evaluates external candidate models/datasets as untrusted inputs without automatic promotion.
 */
export class HuggingFaceAdapter {
  constructor(options = {}) {
    this.apiToken = options.apiToken || null;
  }

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
