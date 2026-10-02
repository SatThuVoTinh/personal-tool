export class StreamlitAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StreamlitAdapterError";
    this.code = code;
  }
}

/**
 * SIMULATION_CONTRACT: this adapter is a contract test double, NOT a live
 * Streamlit integration. It opens no network connection, reads no credential, and
 * returns canned in-memory values. Any credential-shaped option it accepts is
 * stored and never used, which is not integration. A governed path must treat
 * its output as simulation and must never present it as provider execution.
 * Wiring a real provider requires a separately approved backend.
 */
/**
 * Governed Streamlit Adapter
 * Exposes verified Gold analytical layer data to localhost-only Streamlit applications.
 */
export class StreamlitAdapter {
  constructor(options = {}) {
    this.port = options.port || 8501;
    this.host = "127.0.0.1"; // Localhost only
  }

  /**
   * Publishes or verifies a Gold dataset view for Streamlit consumption.
   *
   * @param {object} params
   * @param {string} params.task_id
   * @param {string} params.gold_dataset_id
   * @param {string} params.view_name
   * @param {Array<string>} params.columns
   * @param {number} params.row_count
   * @returns {Promise<object>}
   */
  async exportGoldViewForStreamlit({
    task_id,
    gold_dataset_id,
    view_name,
    columns,
    row_count,
  }) {
    if (!task_id || !gold_dataset_id || !view_name) {
      throw new StreamlitAdapterError(
        "STREAMLIT_INVALID_PARAMS",
        "task_id, gold_dataset_id, and view_name are required.",
      );
    }

    return Object.freeze({
      provider: "streamlit",
      task_id,
      gold_dataset_id,
      view_name,
      endpoint: `http://${this.host}:${this.port}/views/${encodeURIComponent(view_name)}`,
      columns: Object.freeze([...(columns || [])]),
      row_count: Number(row_count) || 0,
      exported_at: new Date().toISOString(),
      status: "READY",
    });
  }
}
