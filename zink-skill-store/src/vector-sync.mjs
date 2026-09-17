import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { scanCatalog } from "./catalog.mjs";
import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
  computeEmbeddingInputHash,
} from "../../zink-tools/common/semantic-contract.mjs";

export const EXPECTED_MODEL_NAME = "bge-m3:latest";
export const EXPECTED_DIMENSIONS = 1024;
export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Executes a PostgreSQL command via docker exec or custom query executor.
 *
 * @param {string} sql
 * @param {object} [options]
 * @param {Function} [options.dbExecutor]
 * @returns {Promise<string>} stdout of query
 */
export async function executePostgresQuery(sql, options = {}) {
  if (typeof options.dbExecutor === "function") {
    return options.dbExecutor(sql);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        "personal-tool-postgres-1",
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Database error (code ${code}): ${stderr || stdout}`));
      }
    });

    child.stdin.write(sql);
    child.stdin.end();
  });
}

/**
 * Probes and generates embeddings from Ollama bge-m3.
 *
 * Validates immutable dimensions (1024) to protect against model drift (BUG-09).
 *
 * @param {string[]} texts
 * @param {object} [options]
 * @param {string} [options.ollamaUrl]
 * @param {string} [options.modelName]
 * @param {Function} [options.embedFn]
 * @returns {Promise<number[][]>}
 */
export async function generateSkillEmbeddings(texts, options = {}) {
  let embeddings;

  if (typeof options.embedFn === "function") {
    embeddings = await options.embedFn(texts);
  } else {
    const ollamaUrl = options.ollamaUrl || DEFAULT_OLLAMA_URL;
    const modelName = options.modelName || EXPECTED_MODEL_NAME;

    const res = await fetch(`${ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelName,
        input: texts,
      }),
    });

    if (!res.ok) {
      throw new Error(`EMBEDDING_HTTP_ERROR_${res.status}`);
    }

    const data = await res.json();
    embeddings = data.embeddings;
  }

  if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
    throw new Error("EMBEDDING_INVALID_RESPONSE");
  }

  for (const emb of embeddings) {
    if (!Array.isArray(emb) || emb.length !== EXPECTED_DIMENSIONS) {
      throw new Error(
        `EMBEDDING_MODEL_DRIFT: expected ${EXPECTED_DIMENSIONS} dimensions, got ${emb?.length}`,
      );
    }
  }

  return embeddings;
}

/**
 * Synchronizes canonical Git-native ACTIVE skills into derived PostgreSQL vector tables.
 *
 * Strictly enforces:
 * - Fail closed if catalog has errors (BUG-03).
 * - Excludes non-ACTIVE skills (BUG-04).
 * - Verifies source drift prior to publishing (BUG-07).
 * - Embedding envelope is used ONLY for vector generation; raw content is stored (BUG-01).
 * - Observable sync status READY vs FAILED (BUG-08).
 *
 * @param {object} options
 * @param {string} options.skillsRoot - absolute path to zink-skill-store/skills
 * @param {string} [options.ollamaUrl]
 * @param {Function} [options.embedFn]
 * @param {Function} [options.dbExecutor]
 * @returns {Promise<object>} sync report
 */
export async function syncSkillsToVectorStore(options = {}) {
  const skillsRoot = options.skillsRoot;
  if (!skillsRoot) {
    throw new Error("SKILLS_ROOT_REQUIRED");
  }

  // 1. Scan and validate canonical catalog (Phase 5, §8)
  const catalog = await scanCatalog(skillsRoot);
  if (catalog.errors.length > 0) {
    return {
      status: "FAILED",
      error_code: "CATALOG_INVALID",
      details: catalog.errors,
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
    status: "READY",
    scanned_count: catalog.records.length,
    active_count: activeRecords.length,
    synced_count: 0,
    failed_count: 0,
    skills: [],
  };

  for (const record of activeRecords) {
    const { namespace, capability, version } = record.manifest.identity;
    const recordedHash =
      record.manifest.content?.sha256 ||
      record.manifest.verification?.content_sha256;

    try {
      // 3. Source drift check (BUG-07)
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

      // 4. Derive semantic metadata & render envelope (Phase 1, Phase 2)
      const semanticMeta = deriveSemanticMetadata({
        namespace,
        capability,
        tags: record.manifest.metadata?.tags,
      });

      // Envelope is strictly for embedding input (BUG-01)
      const envelopeText = renderEmbeddingEnvelope({
        ...semanticMeta,
        content: currentContent,
      });
      const embeddingInputHash = computeEmbeddingInputHash(envelopeText);

      // 5. Generate vector embedding with dimension validation (BUG-09)
      const [vector] = await generateSkillEmbeddings([envelopeText], options);

      // 6. Persist to derived PostgreSQL schema
      const nsPgArray = `{${namespace.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")}}`;
      const secTopicsPgArray = `{${semanticMeta.secondary_topics.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")}}`;
      const vectorStr = `[${vector.join(",")}]`;

      const subtopicSql = semanticMeta.subtopic
        ? `'${semanticMeta.subtopic.replace(/'/g, "''")}'`
        : "NULL";

      // Escape raw content for SQL
      const escapedRawContent = currentContent.replace(/'/g, "''");

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
            '${capability.replace(/'/g, "''")}',
            '${version.replace(/'/g, "''")}',
            '${currentHash}',
            '${embeddingInputHash}',
            '${semanticMeta.domain.replace(/'/g, "''")}',
            '${semanticMeta.primary_topic.replace(/'/g, "''")}',
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

          DELETE FROM skills.segments WHERE skill_id = v_skill_id;

          INSERT INTO skills.segments (
            skill_id, segment_ordinal, heading_path, content, embedding, created_at
          ) VALUES (
            v_skill_id,
            0,
            '{}'::text[],
            '${escapedRawContent}',
            '${vectorStr}'::vector(1024),
            now()
          );
        END $$;
      `;

      await executePostgresQuery(upsertSql, options);

      syncReport.synced_count += 1;
      syncReport.skills.push({
        namespace,
        capability,
        version,
        sync_status: "READY",
      });
    } catch (err) {
      syncReport.failed_count += 1;
      syncReport.skills.push({
        namespace,
        capability,
        version,
        sync_status: "FAILED",
        error: err.message,
      });

      // Record observable failure state in catalog_index (BUG-08)
      try {
        const nsPgArray = `{${namespace.map((s) => `"${s.replace(/"/g, '""')}"`).join(",")}}`;
        const failSql = `
          INSERT INTO skills.catalog_index (
            namespace, capability, version, source_sha256, embedding_input_sha256,
            domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
          ) VALUES (
            '${nsPgArray}'::text[],
            '${capability.replace(/'/g, "''")}',
            '${version.replace(/'/g, "''")}',
            '${recordedHash || "0000000000000000000000000000000000000000000000000000000000000000"}',
            '0000000000000000000000000000000000000000000000000000000000000000',
            'general',
            'general',
            NULL,
            '{}'::text[],
            'ACTIVE',
            'FAILED',
            now(),
            '${err.message.replace(/'/g, "''")}'
          )
          ON CONFLICT (namespace, capability, version) DO UPDATE SET
            sync_status = 'FAILED',
            failure_reason = '${err.message.replace(/'/g, "''")}',
            synced_at = now();
        `;
        await executePostgresQuery(failSql, options);
      } catch {
        // Ignore secondary recording error
      }
    }
  }

  if (syncReport.failed_count > 0 && syncReport.synced_count === 0) {
    syncReport.status = "FAILED";
  }

  return syncReport;
}
