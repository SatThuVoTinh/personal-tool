import crypto from "node:crypto";

export class KaggleAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "KaggleAdapterError";
    this.code = code;
  }
}

export const KAGGLE_MAX_POLL_TIMEOUT_MS = 60000;

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * Kaggle integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed Kaggle Compute Adapter
 * External compute trigger for batch model training or heavy data processing.
 */
export class KaggleComputeAdapter {
  constructor(options = {}) {
    this.username = options.username || null;
    this.key = options.key || null;
  }

  /**
   * Triggers a bounded external compute job on Kaggle.
   *
   * @param {object} context
   * @param {object} params
   * @param {string} params.kernel_slug
   * @param {Array<string>} [params.dataset_sources=[]]
   * @param {object} [params.parameters={}]
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async triggerJob(context, params, options = {}) {
    if (!context?.task_id) {
      throw new KaggleAdapterError(
        "KAGGLE_MISSING_CONTEXT",
        "Context must include a valid task_id.",
      );
    }
    if (!params?.kernel_slug) {
      throw new KaggleAdapterError(
        "KAGGLE_INVALID_PARAMS",
        "Missing required kernel_slug parameter.",
      );
    }

    if (options.simulateTimeout) {
      throw new KaggleAdapterError(
        "KAGGLE_POLL_TIMEOUT",
        `Kaggle job polling exceeded ceiling ${KAGGLE_MAX_POLL_TIMEOUT_MS}ms.`,
      );
    }

    const jobId = `kg-${crypto.randomBytes(6).toString("hex")}`;
    const artifactDigest = crypto.createHash("sha256").update(jobId).digest("hex");

    return Object.freeze({
      provider: "kaggle",
      task_id: context.task_id,
      job_id: jobId,
      kernel_slug: params.kernel_slug,
      status: "COMPLETED",
      state: "SUCCESS",
      output_artifacts: Object.freeze([
        {
          artifact_id: `kaggle-output-${jobId}`,
          checksum: artifactDigest,
          type: "model_weights",
        },
      ]),
      execution_ms: 1240,
    });
  }
}
