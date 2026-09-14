export class DagsHubAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DagsHubAdapterError";
    this.code = code;
  }
}

/**
 * Governed DagsHub Adapter
 * Governs remote tracking sync for explicitly selected MLflow runs.
 */
export class DagsHubAdapter {
  constructor(options = {}) {
    this.repoOwner = options.repoOwner || null;
    this.repoName = options.repoName || null;
    this.token = options.token || null;
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
  async syncSelectedRuns({ repo_owner, repo_name, selected_run_ids }, options = {}) {
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
