import { EXECUTION_STATE_SIMULATED } from "../../common/execution-state.mjs";

export class DagsHubAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DagsHubAdapterError";
    this.code = code;
  }
}

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * DagsHub integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed DagsHub Adapter
 * Governs remote tracking sync for explicitly selected MLflow runs.
 */
export class DagsHubAdapter {
  /**
   * F-277 (R7-C2-02): the credential-shaped `token` option was stored and
   * never read, so the constructor advertised an authentication this adapter
   * does not perform. It is removed rather than kept as decoration: an
   * adapter that holds a credential it never uses is a place a real secret
   * would one day be written and forgotten.
   *
   * @param {{repoOwner?: string, repoName?: string, trackingStore?: object}} [options]
   */
  constructor(options = {}) {
    this.repoOwner = options.repoOwner || null;
    this.repoName = options.repoName || null;
    this.trackingStore = options.trackingStore || null;
  }

  /**
   * Whether a run identifier can be resolved in the configured tracking store.
   *
   * F-277 (R7-C2-02): "explicitly selected" has to mean resolvable. When no
   * tracking store is configured the adapter has nothing to resolve against,
   * so only the identifier's own shape is checked.
   *
   * @param {string} runId
   * @returns {boolean}
   */
  #canResolveRun(runId) {
    const store = this.trackingStore;
    if (!store) return true;
    if (typeof store.has === "function") return store.has(runId) === true;
    if (typeof store.hasRun === "function") return store.hasRun(runId) === true;
    if (Array.isArray(store)) return store.includes(runId);
    if (typeof store === "object") return Object.hasOwn(store, runId);
    return false;
  }

  /**
   * Syncs explicitly selected runs from local MLflow to DagsHub.
   * Blind or automatic wildcard syncing is strictly forbidden.
   *
   * @param {object} params
   * @param {string} params.repo_owner
   * @param {string} params.repo_name
   * @param {Array<string>} params.selected_run_ids
   * @param {object} [options={}]
   * @returns {Promise<object>}
   */
  async syncSelectedRuns(
    { repo_owner, repo_name, selected_run_ids },
    options = {},
  ) {
    if (!repo_owner || !repo_name) {
      throw new DagsHubAdapterError(
        "DAGSHUB_INVALID_REPOSITORY",
        "Both repo_owner and repo_name are required.",
      );
    }
    if (!Array.isArray(selected_run_ids) || selected_run_ids.length === 0) {
      throw new DagsHubAdapterError(
        "DAGSHUB_EMPTY_SELECTION",
        "At least one run_id must be explicitly selected for DagsHub sync.",
      );
    }

    // F-277 (R7-C2-02): the destination is the CONFIGURED repository. A
    // caller that names a different one is refused rather than obeyed, so a
    // configured credential cannot be pointed at another repository.
    if (this.repoOwner || this.repoName) {
      if (this.repoOwner !== repo_owner || this.repoName !== repo_name) {
        throw new DagsHubAdapterError(
          "DAGSHUB_REPOSITORY_MISMATCH",
          `Refusing to sync to '${repo_owner}/${repo_name}': this adapter is configured for '${this.repoOwner}/${this.repoName}'.`,
        );
      }
    }

    // F-277 (R7-C2-02): a wildcard entry satisfies "a non-empty array" while
    // naming no run at all, which is the blind sync this file's own comment
    // forbids. Every entry must be a concrete, resolvable run identifier.
    for (const runId of selected_run_ids) {
      if (typeof runId !== "string" || runId.trim().length === 0) {
        throw new DagsHubAdapterError(
          "DAGSHUB_INVALID_SELECTION",
          "Every selected run id must be a non-empty string.",
        );
      }
      if (runId === "*" || runId.includes("*")) {
        throw new DagsHubAdapterError(
          "DAGSHUB_WILDCARD_SELECTION",
          `Wildcard run selection '${runId}' is forbidden; select concrete run ids.`,
        );
      }
      if (!this.#canResolveRun(runId)) {
        throw new DagsHubAdapterError(
          "DAGSHUB_UNRESOLVABLE_RUN",
          `Run '${runId}' cannot be resolved in the tracking store.`,
        );
      }
    }

    if (options.simulateAuthFailure) {
      throw new DagsHubAdapterError(
        "DAGSHUB_AUTH_REQUIRED",
        "DagsHub authentication token required to complete sync.",
      );
    }

    return Object.freeze({
      provider: "dagshub",
      repository: `${repo_owner}/${repo_name}`,
      synced_run_ids: Object.freeze([...selected_run_ids]),
      synced_runs_count: selected_run_ids.length,
      synced_at: new Date().toISOString(),
      status: "SYNC_COMPLETED",
    });
  }
}
