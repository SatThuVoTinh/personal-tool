import crypto from "node:crypto";

export class MLflowAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MLflowAdapterError";
    this.code = code;
  }
}

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * MLflow integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed MLflow Local Adapter
 * Logs and tracks local experiments, parameters, metrics, and artifact references.
 */
export class MLflowLocalAdapter {
  constructor(options = {}) {
    this.trackingUri = options.trackingUri || "sqlite:///mlflow.db";
    this.runs = new Map();
  }

  /**
   * F-278 (R7-C2-03): a deep, frozen copy of a run record.
   *
   * Measured at HEAD: `createRun` returned `Object.freeze({ ...runRecord })`,
   * `logMetrics` returned a frozen object whose per-key metric arrays were the
   * stored arrays, and `endRun` returned a frozen shallow copy — while
   * `getRun` already returned a deep copy. A caller could therefore push a
   * forged entry into the artifact array of a createRun result, or pop a
   * metric history array, and silently corrupt the tracking store for every
   * later reader. One copy helper, used by every method that hands run state
   * out, makes the returned value a snapshot instead of a view.
   *
   * @param {object} record
   * @returns {object} a deep-frozen copy
   */
  static #snapshot(record) {
    return Object.freeze(JSON.parse(JSON.stringify(record)));
  }

  /**
   * Starts a new run within an experiment.
   * @param {object} params
   * @param {string} params.experiment_name
   * @param {string} [params.run_name]
   * @param {object} [params.tags={}]
   * @returns {Promise<object>}
   */
  async createRun({ experiment_name, run_name, tags = {} }) {
    if (!experiment_name) {
      throw new MLflowAdapterError(
        "MLFLOW_INVALID_PARAMS",
        "experiment_name is required.",
      );
    }
    const runId = `mlf-${crypto.randomBytes(8).toString("hex")}`;
    const runRecord = {
      run_id: runId,
      experiment_name,
      run_name: run_name || `run-${runId.slice(0, 8)}`,
      status: "RUNNING",
      start_time: new Date().toISOString(),
      tags: { ...tags },
      params: {},
      metrics: {},
      artifacts: [],
    };
    this.runs.set(runId, runRecord);
    return MLflowLocalAdapter.#snapshot(runRecord);
  }

  /**
   * Logs parameters to an active run.
   */
  async logParameters(runId, params) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new MLflowAdapterError(
        "MLFLOW_RUN_NOT_FOUND",
        `Run '${runId}' not found.`,
      );
    }
    Object.assign(run.params, params);
    return MLflowLocalAdapter.#snapshot({
      run_id: runId,
      params: { ...run.params },
    });
  }

  /**
   * Logs metrics to an active run.
   */
  async logMetrics(runId, metrics, step = 0) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new MLflowAdapterError(
        "MLFLOW_RUN_NOT_FOUND",
        `Run '${runId}' not found.`,
      );
    }
    for (const [k, v] of Object.entries(metrics)) {
      if (!run.metrics[k]) run.metrics[k] = [];
      run.metrics[k].push({ value: v, step, timestamp: Date.now() });
    }
    return MLflowLocalAdapter.#snapshot({
      run_id: runId,
      metrics: { ...run.metrics },
    });
  }

  /**
   * Logs an artifact reference to an active run.
   */
  async logArtifact(runId, { artifact_name, artifact_path, checksum }) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new MLflowAdapterError(
        "MLFLOW_RUN_NOT_FOUND",
        `Run '${runId}' not found.`,
      );
    }
    const artifactRecord = {
      artifact_name,
      artifact_path,
      checksum,
      logged_at: new Date().toISOString(),
    };
    run.artifacts.push(artifactRecord);
    return Object.freeze(artifactRecord);
  }

  /**
   * Terminates a run with a given status.
   */
  async endRun(runId, status = "FINISHED") {
    const run = this.runs.get(runId);
    if (!run) {
      throw new MLflowAdapterError(
        "MLFLOW_RUN_NOT_FOUND",
        `Run '${runId}' not found.`,
      );
    }
    run.status = status;
    run.end_time = new Date().toISOString();
    return MLflowLocalAdapter.#snapshot(run);
  }

  /**
   * Fetches an immutable snapshot of a run.
   */
  async getRun(runId) {
    const run = this.runs.get(runId);
    if (!run) {
      throw new MLflowAdapterError(
        "MLFLOW_RUN_NOT_FOUND",
        `Run '${runId}' not found.`,
      );
    }
    return MLflowLocalAdapter.#snapshot(run);
  }
}
