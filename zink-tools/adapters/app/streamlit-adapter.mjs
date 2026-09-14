export class StreamlitAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "StreamlitAdapterError";
    this.code = code;
  }
}

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
