import crypto from "node:crypto";

export class DatabricksAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DatabricksAdapterError";
    this.code = code;
  }
}

export const DATABRICKS_MAX_POLL_TIMEOUT_MS = 120000;

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * Databricks integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed Databricks Compute Adapter
 * External distributed compute trigger for large-scale spark/feature pipelines.
 */
export class DatabricksComputeAdapter {
  constructor(options = {}) {
    this.host = options.host || null;
    this.token = options.token || null;
  }

  /**
   * Triggers a bounded external compute job on Databricks.
   *
   * @param {object} context
   * @param {object} params
   * @param {string|number} params.job_id
   * @param {string} [params.notebook_path]
   * @param {object} [params.parameters={}]
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async triggerJob(context, params, options = {}) {
    if (!context?.task_id) {
      throw new DatabricksAdapterError(
        "DATABRICKS_MISSING_CONTEXT",
        "Context must include a valid task_id.",
      );
    }
    if (!params?.job_id) {
      throw new DatabricksAdapterError(
        "DATABRICKS_INVALID_PARAMS",
        "Missing required job_id parameter.",
      );
    }

    if (options.simulateTimeout) {
      throw new DatabricksAdapterError(
        "DATABRICKS_POLL_TIMEOUT",
        `Databricks job polling exceeded ceiling ${DATABRICKS_MAX_POLL_TIMEOUT_MS}ms.`,
      );
    }

    const runId = `dbr-run-${crypto.randomBytes(6).toString("hex")}`;
    const artifactDigest = crypto
      .createHash("sha256")
      .update(runId)
      .digest("hex");

    return Object.freeze({
      provider: "databricks",
      task_id: context.task_id,
      job_id: params.job_id,
      run_id: runId,
      status: "TERMINATED",
      state: "SUCCESS",
      output_artifacts: Object.freeze([
        {
          artifact_id: `databricks-features-${runId}`,
          checksum: artifactDigest,
          type: "feature_table",
        },
      ]),
      execution_ms: 2150,
    });
  }
}
