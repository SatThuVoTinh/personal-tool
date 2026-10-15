import crypto from "node:crypto";

/**
 * The two governed storage zones. A bucket outside this set is a contract
 * violation, not something to coerce: silently treating an unknown bucket as
 * `landing` would hand a caller the immutable raw zone while they believed they
 * had asked for something else.
 */
export const R2_ALLOWED_BUCKETS = Object.freeze(["landing", "silver"]);

/** Contract ceiling for a Silver revision, so a runaway loop cannot mint history. */
export const R2_MAX_SILVER_VERSION = 100_000;

export class R2AdapterError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "R2AdapterError";
    this.code = code;
  }
}

/**
 * Cloudflare R2 Storage Adapter
 * Governs Landing (immutable by default) and Silver (versioned/immutable) artifact storage.
 *
 * NOT A PROVIDER INTEGRATION. This class performs no network call and holds no
 * credential; `endpoint` is accepted and never used, and `storage` is an
 * in-process Map that is empty on every restart. It is a contract test double
 * for the storage zone semantics (immutability, versioning, checksum) and must
 * not be described or reported as live R2.
 */
export class R2StorageAdapter {
  constructor(options = {}) {
    this.endpoint = options.endpoint || "localhost";
    this.storage = new Map(); // In-memory simulated storage for tests/contracts
  }

  /**
   * Puts an artifact into R2 Landing zone.
   * Landing is strictly IMMUTABLE: overwrite attempts throw R2_LANDING_IMMUTABLE_VIOLATION.
   *
   * @param {object} params
   * @param {string} params.task_id
   * @param {string} params.run_id
   * @param {string} params.artifact_id
   * @param {string|Buffer} params.data
   * @param {string} [params.content_type="application/octet-stream"]
   * @returns {Promise<object>}
   */
  async putLandingArtifact({
    task_id,
    run_id,
    artifact_id,
    data,
    content_type = "application/octet-stream",
  }) {
    if (!task_id || !run_id || !artifact_id || data === undefined) {
      throw new R2AdapterError(
        "R2_INVALID_PARAMETERS",
        "Missing required parameters: task_id, run_id, artifact_id, data",
      );
    }

    const key = `landing/${artifact_id}`;
    if (this.storage.has(key)) {
      throw new R2AdapterError(
        "R2_LANDING_IMMUTABLE_VIOLATION",
        `Landing artifact '${artifact_id}' already exists and cannot be overwritten (immutable by default).`,
      );
    }

    const payload = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");

    const record = Object.freeze({
      bucket: "landing",
      artifact_id,
      task_id,
      run_id,
      provider: "r2",
      provider_run_id: `r2-${run_id}`,
      checksum,
      size_bytes: payload.length,
      content_type,
      created_at: new Date().toISOString(),
      data: payload,
    });

    this.storage.set(key, record);

    return Object.freeze({
      bucket: record.bucket,
      artifact_id: record.artifact_id,
      task_id: record.task_id,
      run_id: record.run_id,
      provider: record.provider,
      provider_run_id: record.provider_run_id,
      checksum: record.checksum,
      size_bytes: record.size_bytes,
      created_at: record.created_at,
    });
  }

  /**
   * Promotes validated/cleaned data to Silver zone with explicit versioning.
   *
   * @param {object} params
   * @param {string} params.task_id
   * @param {string} params.run_id
   * @param {string} params.artifact_id
   * @param {number} params.version
   * @param {string|Buffer} params.data
   * @returns {Promise<object>}
   */
  async promoteToSilver({ task_id, run_id, artifact_id, version, data }) {
    if (
      !task_id ||
      !run_id ||
      !artifact_id ||
      version === undefined ||
      data === undefined
    ) {
      throw new R2AdapterError(
        "R2_INVALID_PARAMETERS",
        "Missing required parameters: task_id, run_id, artifact_id, version, data",
      );
    }
    // The version is interpolated straight into the storage key and into the
    // provider run id below, so an unvalidated value is not merely untidy: a
    // value like "../../landing/orders" injects path syntax into the namespace,
    // and a non-positive or fractional version would create a Silver revision
    // that no monotonic promotion could ever have produced. Validate before use.
    if (
      typeof version !== "number" ||
      !Number.isSafeInteger(version) ||
      version < 1
    ) {
      throw new R2AdapterError(
        "R2_INVALID_SILVER_VERSION",
        "Silver version must be a positive safe integer.",
      );
    }
    if (version > R2_MAX_SILVER_VERSION) {
      throw new R2AdapterError(
        "R2_INVALID_SILVER_VERSION",
        `Silver version exceeds the contract ceiling of ${R2_MAX_SILVER_VERSION}.`,
      );
    }

    const key = `silver/${artifact_id}/v${version}`;
    if (this.storage.has(key)) {
      throw new R2AdapterError(
        "R2_SILVER_VERSION_COLLISION",
        `Silver artifact '${artifact_id}' version ${version} already exists.`,
      );
    }

    const payload = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    const checksum = crypto.createHash("sha256").update(payload).digest("hex");

    const record = Object.freeze({
      bucket: "silver",
      artifact_id,
      version,
      task_id,
      run_id,
      provider: "r2",
      provider_run_id: `r2-silver-${run_id}-v${version}`,
      checksum,
      size_bytes: payload.length,
      created_at: new Date().toISOString(),
      data: payload,
    });

    this.storage.set(key, record);

    return Object.freeze({
      bucket: record.bucket,
      artifact_id: record.artifact_id,
      version: record.version,
      task_id: record.task_id,
      run_id: record.run_id,
      provider: record.provider,
      provider_run_id: record.provider_run_id,
      checksum: record.checksum,
      size_bytes: record.size_bytes,
      created_at: record.created_at,
    });
  }

  /**
   * Retrieves an artifact from storage.
   *
   * The bucket is validated against the governed zone set. The previous
   * implementation treated every value that was not exactly "silver" as
   * `landing`, so a typo, a wrong case, an empty string or null silently
   * returned the immutable raw zone — or produced a not-found error that was
   * indistinguishable from a genuine miss. An unknown bucket now fails closed.
   *
   * @param {string} bucket - "landing" or "silver"
   * @param {string} artifact_id
   * @param {number} [version] - required for silver
   * @returns {Promise<object>}
   */
  async getArtifact(bucket, artifact_id, version) {
    if (!R2_ALLOWED_BUCKETS.includes(bucket)) {
      throw new R2AdapterError(
        "R2_INVALID_BUCKET",
        `Unknown storage bucket '${String(bucket)}'. Allowed buckets: ${R2_ALLOWED_BUCKETS.join(", ")}.`,
      );
    }
    if (bucket === "silver") {
      if (
        typeof version !== "number" ||
        !Number.isSafeInteger(version) ||
        version < 1 ||
        version > R2_MAX_SILVER_VERSION
      ) {
        throw new R2AdapterError(
          "R2_INVALID_SILVER_VERSION",
          "Silver version must be a positive safe integer within the contract ceiling.",
        );
      }
    }

    const key =
      bucket === "silver"
        ? `silver/${artifact_id}/v${version}`
        : `landing/${artifact_id}`;

    const record = this.storage.get(key);
    if (!record) {
      throw new R2AdapterError(
        "R2_ARTIFACT_NOT_FOUND",
        `Artifact '${artifact_id}' not found in bucket '${bucket}'.`,
      );
    }
    return record;
  }
}
