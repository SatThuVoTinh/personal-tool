import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { scanCatalog } from "./catalog.mjs";
import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
  computeEmbeddingInputHash,
} from "../../zink-tools/common/semantic-contract.mjs";

export const EXPECTED_MODEL_NAME = "bge-m3:latest";
export const EXPECTED_MODEL_DIGEST =
  "sha256:ba41a6b0c6ca7e35b71c2ba7093222ddff8dd42bb8d8ec9f2a4e9ef45b74ee9a";
export const EXPECTED_DIMENSIONS = 1024;
export const MAX_EMBEDDING_PAYLOAD_BYTES = 50 * 1024 * 1024; // 50MB ceiling
export const MAX_DB_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB ceiling
export const MAX_FAILURE_REASON_LENGTH = 500;
export const DEFAULT_INDEX_FRESHNESS_SLA_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function resolveDefaultOllamaUrl() {
  const configured = process.env.OLLAMA_URL?.trim();
  return configured || null;
}

export const DEFAULT_OLLAMA_URL = resolveDefaultOllamaUrl();

/**
 * Validates Ollama endpoint URL to prevent SSRF and arbitrary remote requests (L06, T53).
 */
export function validateOllamaUrl(rawUrl, options = {}) {
  const urlStr = rawUrl ?? DEFAULT_OLLAMA_URL;
  if (typeof urlStr !== "string" || urlStr.trim().length === 0) {
    throw new Error(
      "OLLAMA_URL_REQUIRED: Configure an approved Ollama endpoint",
    );
  }
  const parsed = new URL(urlStr);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `OLLAMA_URL_INVALID_PROTOCOL: Protocol ${parsed.protocol} not supported`,
    );
  }
  const allowedHosts = new Set([
    "localhost",
    "127.0.0.1",
    "host.docker.internal",
    ...(options.allowedHosts || []),
  ]);
  if (!allowedHosts.has(parsed.hostname) && !options.allowRemote) {
    throw new Error(
      `OLLAMA_URL_FORBIDDEN_HOST: Host '${parsed.hostname}' is not in trusted allowlist`,
    );
  }
  return urlStr;
}

/**
 * Centrally constructs safe PostgreSQL array literal (L16).
 */
export function toPostgresArrayLiteral(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "{}";
  const elements = arr.map((item) => {
    const s = String(item ?? "");
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '""')}"`;
  });
  return `{${elements.join(",")}}`;
}

/**
 * Safely escapes string literal for PostgreSQL queries (L15).
 */
export function escapeSqlLiteral(str) {
  if (str === null || str === undefined) return "NULL";
  return `'${String(str).replace(/'/g, "''")}'`;
}

/**
 * Splits skill markdown content into semantic segments by headings or length bounds (L11).
 */
export function chunkSkillContent(rawContent) {
  if (!rawContent || typeof rawContent !== "string") {
    return [{ segment_ordinal: 0, heading_path: [], content: "" }];
  }

  const lines = rawContent.split("\n");
  const segments = [];
  let currentHeading = [];
  let currentLines = [];
  let ordinal = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (currentLines.length > 0) {
        segments.push({
          segment_ordinal: ordinal++,
          heading_path: [...currentHeading],
          content: currentLines.join("\n").trim(),
        });
        currentLines = [];
      }
      currentHeading = [headingMatch[2].trim()];
    }
    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    segments.push({
      segment_ordinal: ordinal,
      heading_path: currentHeading,
      content: currentLines.join("\n").trim(),
    });
  }

  return segments.length > 0
    ? segments
    : [{ segment_ordinal: 0, heading_path: [], content: rawContent.trim() }];
}

/**
 * Executes a PostgreSQL command via docker exec or custom query executor (L07, L08, L09).
 */
export async function executePostgresQuery(sql, options = {}) {
  if (typeof options.dbExecutor === "function") {
    return options.dbExecutor(sql);
  }

  const containerName =
    process.env.POSTGRES_CONTAINER ||
    options.postgresContainer ||
    "personal-tool-postgres-1";
  const dbTimeoutMs = options.dbTimeoutMs || 30000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        containerName,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "--set=ON_ERROR_STOP=1",
        "-t",
        "-A",
      ],
      { shell: false },
    );

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(
          new Error(`DB_TIMEOUT: Database query exceeded ${dbTimeoutMs}ms`),
        );
      }
    }, dbTimeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > MAX_DB_BUFFER_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error("DB_BUFFER_OVERFLOW: stdout exceeded 10MB limit"));
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > MAX_DB_BUFFER_BYTES) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error("DB_BUFFER_OVERFLOW: stderr exceeded 10MB limit"));
        }
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(`Database error (code ${code}): ${stderr || stdout}`),
          );
        }
      }
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

/**
 * Probes and generates embeddings from Ollama bge-m3.
 *
 * Validates immutable dimensions (1024), finiteness (NaN/Infinity), timeout, and model identity (L01-L06).
 */
export async function generateSkillEmbeddings(texts, options = {}) {
  let opts = options;
  if (typeof options === "function") {
    opts = { embedFn: options };
  }

  const textList = Array.isArray(texts) ? texts : [texts];
  let embeddings;

  if (typeof opts.embedFn === "function") {
    embeddings = await opts.embedFn(textList);
  } else {
    const rawUrl = opts.ollamaUrl ?? DEFAULT_OLLAMA_URL;
    const validatedUrl = validateOllamaUrl(rawUrl, opts);
    const modelName = opts.modelName || EXPECTED_MODEL_NAME;
    const timeoutMs = opts.timeoutMs || 30000;

    const res = await fetch(`${validatedUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        input: textList,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`EMBEDDING_HTTP_ERROR_${res.status}`);
    }

    const contentLength = Number(res.headers.get("content-length"));
    if (contentLength && contentLength > MAX_EMBEDDING_PAYLOAD_BYTES) {
      throw new Error(
        `EMBEDDING_PAYLOAD_TOO_LARGE: ${contentLength} bytes exceeds limit`,
      );
    }

    const data = await res.json();

    // Verify returned model identity against requested model (L03)
    if (data.model && !data.model.startsWith("bge-m3")) {
      throw new Error(
        `EMBEDDING_MODEL_MISMATCH: expected bge-m3 family, got ${data.model}`,
      );
    }

    embeddings = data.embeddings;
  }

  if (!Array.isArray(embeddings) || embeddings.length !== textList.length) {
    throw new Error("EMBEDDING_INVALID_RESPONSE");
  }

  // Validate dimension and finiteness of every float vector element (L02, T52)
  for (let eIdx = 0; eIdx < embeddings.length; eIdx++) {
    const emb = embeddings[eIdx];
    if (!Array.isArray(emb) || emb.length !== EXPECTED_DIMENSIONS) {
      throw new Error(
        `EMBEDDING_MODEL_DRIFT: expected ${EXPECTED_DIMENSIONS} dimensions, got ${emb?.length}`,
      );
    }
    for (let i = 0; i < emb.length; i++) {
      const val = emb[i];
      if (typeof val !== "number" || !Number.isFinite(val)) {
        throw new Error(
          `EMBEDDING_VECTOR_INVALID: non-finite float at index ${i}: ${val}`,
        );
      }
    }
  }

  return embeddings;
}

/**
 * Checks whether an index sync timestamp satisfies the freshness SLA (L20).
 */
export function checkIndexFreshness(
  syncedAt,
  maxAgeMs = DEFAULT_INDEX_FRESHNESS_SLA_MS,
) {
  if (!syncedAt)
    return { fresh: false, ageMs: Infinity, reason: "NO_SYNC_TIMESTAMP" };
  const syncTime = new Date(syncedAt).getTime();
  if (isNaN(syncTime))
    return { fresh: false, ageMs: Infinity, reason: "INVALID_SYNC_TIMESTAMP" };
  const ageMs = Date.now() - syncTime;
  return {
    fresh: ageMs <= maxAgeMs,
    ageMs,
    maxAgeMs,
    reason: ageMs <= maxAgeMs ? "FRESH" : "STALE",
  };
}

/**
 * Reconciles canonical catalog against vector database index (L19).
 */
export async function reconcileVectorSync(skillsRoot) {
  const catalog = await scanCatalog(skillsRoot);
  const activeKeys = new Set(
    catalog.records
      .filter((r) => r.manifest?.lifecycle?.at(-1)?.status === "ACTIVE")
      .map((r) => {
        const id = r.manifest.identity;
        return `${id.namespace.join("/")}/${id.capability}@${id.version}`;
      }),
  );

  return {
    reconciled_at: new Date().toISOString(),
    canonical_active_count: activeKeys.size,
    catalog_errors: catalog.errors,
  };
}

/**
 * Synchronizes canonical Git-native ACTIVE skills into derived PostgreSQL vector tables.
 * Implements K24, K25, L10-L20.
 */
export async function syncSkillsToVectorStore(options = {}) {
  const skillsRoot = options.skillsRoot;
  if (!skillsRoot) {
    throw new Error("SKILLS_ROOT_REQUIRED");
  }

  const syncGenerationId =
    options.syncGenerationId ||
    `sync_${Date.now()}_${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}`;

  // 1. Scan and validate canonical catalog (Phase 5, §8)
  const catalog = await scanCatalog(skillsRoot);
  if (catalog.errors.length > 0) {
    return {
      status: "FAILED",
      error_code: "CATALOG_INVALID",
      details: catalog.errors,
      sync_generation_id: syncGenerationId,
      synced_count: 0,
      failed_count: 0,
    };
  }

  // 2. Filter strictly for ACTIVE skills (BUG-04)
  const activeRecords = catalog.records.filter((record) => {
    const lifecycle = record.manifest?.lifecycle;
    return Array.isArray(lifecycle) && lifecycle.at(-1)?.status === "ACTIVE";
  });

  const syncReport = {
    status: "RUNNING",
    sync_generation_id: syncGenerationId,
    scanned_count: catalog.records.length,
    active_count: activeRecords.length,
    synced_count: 0,
    failed_count: 0,
    skills: [],
  };

  // 3. Tombstone synchronization for removed or deprecated skills (K24)
  const activeKeys = activeRecords.map((r) => {
    const id = r.manifest.identity;
    return `${id.namespace.join("/")}\u0000${id.capability}\u0000${id.version}`;
  });

  try {
    const tombstoneSql = `
      UPDATE skills.catalog_index
      SET status = 'DEPRECATED', sync_status = 'TOMBSTONED', synced_at = now()
      WHERE status = 'ACTIVE'
      AND (namespace::text || capability || version) NOT IN (
        SELECT (unnest(ARRAY[${toPostgresArrayLiteral(activeKeys)}]::text[]))
      );
    `;
    await executePostgresQuery(tombstoneSql, options);
  } catch (error) {
    syncReport.status = "FAILED";
    syncReport.error_code = "VECTOR_TOMBSTONE_SYNC_FAILED";
    syncReport.error = String(
      error?.message || "Tombstone synchronization failed",
    ).slice(0, MAX_FAILURE_REASON_LENGTH);
    syncReport.failed_count = 1;
    return syncReport;
  }

  // 4. Ingest and vectorize active records
  for (const record of activeRecords) {
    const { namespace, capability, version } = record.manifest.identity;
    const recordedHash =
      record.manifest.content?.sha256 ||
      record.manifest.verification?.content_sha256;

    try {
      const skillPath = path.join(
        skillsRoot,
        ...namespace,
        capability,
        version,
        "SKILL.md",
      );
      const currentContent = await readFile(skillPath, "utf8");
      const currentHash = createHash("sha256")
        .update(currentContent, "utf8")
        .digest("hex");

      if (recordedHash && currentHash !== recordedHash) {
        throw new Error(
          `SOURCE_DRIFT_DETECTED: file hash ${currentHash} does not match manifest ${recordedHash}`,
        );
      }

      // Canonicalize secondary topics (L12)
      const rawSecTopics = record.manifest.metadata?.tags || [];
      const canonicalSecondaryTopics = Array.from(
        new Set(
          rawSecTopics
            .map((t) => String(t).toLowerCase().trim())
            .filter(Boolean),
        ),
      ).sort();

      const semanticMeta = deriveSemanticMetadata({
        namespace,
        capability,
        tags: canonicalSecondaryTopics,
      });

      // Semantic record key tying catalog row to contract version (L17)
      const semanticRecordKey = `${namespace.join("/")}:${capability}:${version}:v1`;

      // Semantic chunk granularity (L11)
      const segments = chunkSkillContent(currentContent);

      for (const seg of segments) {
        const envelopeText = renderEmbeddingEnvelope({
          ...semanticMeta,
          content: seg.content,
        });
        const embeddingInputHash = computeEmbeddingInputHash(envelopeText);

        const [vector] = await generateSkillEmbeddings([envelopeText], options);

        const nsPgArray = toPostgresArrayLiteral(namespace);
        const secTopicsPgArray = toPostgresArrayLiteral(
          canonicalSecondaryTopics,
        );
        const headingPgArray = toPostgresArrayLiteral(seg.heading_path);
        const vectorStr = `[${vector.join(",")}]`;

        const subtopicSql = semanticMeta.subtopic
          ? escapeSqlLiteral(semanticMeta.subtopic)
          : "NULL";
        const escapedContent = escapeSqlLiteral(seg.content);

        const upsertSql = `
          DO $$
          DECLARE
            v_skill_id uuid;
          BEGIN
            INSERT INTO skills.catalog_index (
              namespace, capability, version, source_sha256, embedding_input_sha256,
              domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
            ) VALUES (
              '${nsPgArray}'::text[],
              ${escapeSqlLiteral(capability)},
              ${escapeSqlLiteral(version)},
              '${currentHash}',
              '${embeddingInputHash}',
              ${escapeSqlLiteral(semanticMeta.domain)},
              ${escapeSqlLiteral(semanticMeta.primary_topic)},
              ${subtopicSql},
              '${secTopicsPgArray}'::text[],
              'ACTIVE',
              'READY',
              now(),
              NULL
            )
            ON CONFLICT (namespace, capability, version) DO UPDATE SET
              source_sha256 = EXCLUDED.source_sha256,
              embedding_input_sha256 = EXCLUDED.embedding_input_sha256,
              domain = EXCLUDED.domain,
              primary_topic = EXCLUDED.primary_topic,
              subtopic = EXCLUDED.subtopic,
              secondary_topics = EXCLUDED.secondary_topics,
              status = 'ACTIVE',
              sync_status = 'READY',
              synced_at = now(),
              failure_reason = NULL
            RETURNING id INTO v_skill_id;

            IF ${seg.segment_ordinal} = 0 THEN
              DELETE FROM skills.segments WHERE skill_id = v_skill_id;
            END IF;

            INSERT INTO skills.segments (
              skill_id, segment_ordinal, heading_path, content, embedding, created_at
            ) VALUES (
              v_skill_id,
              ${seg.segment_ordinal},
              '${headingPgArray}'::text[],
              ${escapedContent},
              '${vectorStr}'::vector(1024),
              now()
            );
          END $$;
        `;

        await executePostgresQuery(upsertSql, options);
      }

      syncReport.synced_count += 1;
      syncReport.skills.push({
        namespace,
        capability,
        version,
        semantic_record_key: semanticRecordKey,
        sync_status: "READY",
      });
    } catch (err) {
      syncReport.failed_count += 1;
      const boundedReason = (err.message || "Unknown error").slice(
        0,
        MAX_FAILURE_REASON_LENGTH,
      );
      syncReport.skills.push({
        namespace,
        capability,
        version,
        sync_status: "FAILED",
        error: boundedReason,
      });

      // Observable failure recording (BUG-08, L13)
      try {
        const nsPgArray = toPostgresArrayLiteral(namespace);
        const failSql = `
          INSERT INTO skills.catalog_index (
            namespace, capability, version, source_sha256, embedding_input_sha256,
            domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
          ) VALUES (
            '${nsPgArray}'::text[],
            ${escapeSqlLiteral(capability)},
            ${escapeSqlLiteral(version)},
            '${recordedHash || "0000000000000000000000000000000000000000000000000000000000000000"}',
            '0000000000000000000000000000000000000000000000000000000000000000',
            'general',
            'general',
            NULL,
            '{}'::text[],
            'ACTIVE',
            'FAILED',
            now(),
            ${escapeSqlLiteral(boundedReason)}
          )
          ON CONFLICT (namespace, capability, version) DO UPDATE SET
            sync_status = 'FAILED',
            failure_reason = ${escapeSqlLiteral(boundedReason)},
            synced_at = now();
        `;
        await executePostgresQuery(failSql, options);
      } catch {
        // Ignore secondary recording error
      }
    }
  }

  // K25: If any failed, overall status must reflect partial/failure, never READY!
  if (syncReport.failed_count > 0) {
    if (syncReport.synced_count > 0) {
      syncReport.status = "PARTIAL";
    } else {
      syncReport.status = "FAILED";
    }
  } else {
    syncReport.status = "READY";
  }

  return syncReport;
}
