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
 * Centrally constructs a PostgreSQL array literal (L16).
 *
 * M11/T1: inside a double-quoted array item the array-literal grammar escapes
 * `"` and `\` with a BACKSLASH; the pre-fix implementation doubled the quote
 * (`""`), which PostgreSQL reads as two literal quote characters. The result
 * is only valid once embedded in a SQL string constant (callers wrap it with
 * `escapeSqlLiteral`); a brace literal pasted unquoted into SQL is a syntax
 * error, which is how every sync died once the statement reached real psql.
 * Control characters are refused outright: they cannot appear in skill
 * identity segments (path-safety rejects them) and text[] array items must be
 * representable without ambiguity.
 */
export function toPostgresArrayLiteral(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "{}";
  const elements = arr.map((item) => {
    const s = String(item ?? "");
    if (
      [...s].some((c) => {
        const cp = c.codePointAt(0);
        return cp < 0x20 || cp === 0x7f;
      })
    ) {
      throw new Error(
        `ARRAY_LITERAL_CONTROL_CHARACTER: element ${JSON.stringify(
          s.slice(0, 32),
        )} contains a control character`,
      );
    }
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${elements.join(",")}}`;
}

/**
 * Asserts a value is a lowercase sha256 hex digest before it is interpolated
 * into a SQL literal (M11/T1). Digests must never ride the generic escape
 * path: anything that is not hex here is a corrupt producer, not data.
 */
export function assertHexDigest(value, label) {
  const s = String(value ?? "");
  if (!/^[a-f0-9]{64}$/u.test(s)) {
    throw new Error(
      `VECTOR_LITERAL_UNTRUSTED_INPUT: ${label} is not a sha256 hex digest`,
    );
  }
  return s;
}

/**
 * Safely escapes string literal for PostgreSQL queries (L15).
 */
export function escapeSqlLiteral(str) {
  if (str === null || str === undefined) return "NULL";
  return `'${String(str).replace(/'/g, "''")}'`;
}

/**
 * M10/T2-R21: per-segment content budget.
 *
 * `renderEmbeddingEnvelope` enforces a hard 32 KiB ceiling on the WHOLE
 * envelope (headers + content), and it THROWS above it. This chunker's own
 * documentation claimed it split "by headings or length bounds", but it had no
 * length branch at all — it only split on headings. A catalog-valid skill whose
 * section exceeded the embedding ceiling therefore produced one oversized
 * segment that could never be embedded, and the next sync failed identically:
 * proven by execution, a 42,013-byte single-section skill produced 1 segment
 * and raised `EMBEDDING_INPUT_TOO_LARGE`.
 *
 * The budget is 16 KiB — half the ceiling — because the envelope adds variable
 * header lines (domain, primary topic, subtopic, concept, secondary topics)
 * whose size is not known here. Measured in BYTES, not characters, matching the
 * ceiling it has to satisfy.
 */
const MAX_SEGMENT_CONTENT_BYTES = 16 * 1024;

/** Split one over-long line into byte-budgeted pieces, never splitting a char. */
function splitByBytes(line, maxBytes) {
  const pieces = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes && current.length > 0) {
      pieces.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += size;
  }
  if (current.length > 0) pieces.push(current);
  return pieces;
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
  let currentBytes = 0;
  let ordinal = 0;

  const flush = () => {
    if (currentLines.length === 0) return;
    segments.push({
      segment_ordinal: ordinal++,
      heading_path: [...currentHeading],
      content: currentLines.join("\n").trim(),
    });
    currentLines = [];
    currentBytes = 0;
  };

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1; // +1 for the newline
    // R21: a heading always starts a new segment, and a line that would push the
    // current segment past the budget also ends it, so no single segment can ever
    // exceed the embedding ceiling.
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      // M11/T1: heading_path lands in a text[] array literal, which cannot
      // carry control characters; collapse all whitespace runs (a tab inside
      // a heading must not fail the whole skill).
      currentHeading = [headingMatch[2].replace(/\s+/g, " ").trim()];
      currentLines = [line];
      currentBytes = lineBytes;
      continue;
    }
    if (
      currentBytes + lineBytes > MAX_SEGMENT_CONTENT_BYTES &&
      currentLines.length > 0
    ) {
      flush();
    }
    if (lineBytes > MAX_SEGMENT_CONTENT_BYTES) {
      // A single line longer than the whole budget: split it by bytes, and apply
      // the same flush-BEFORE-push rule as for an ordinary line. Flushing after
      // each piece instead let two full pieces accumulate (measured 32767 bytes,
      // exactly twice the budget, which the envelope then rejected).
      for (const piece of splitByBytes(line, MAX_SEGMENT_CONTENT_BYTES)) {
        const pieceBytes = Buffer.byteLength(piece, "utf8") + 1;
        if (
          currentBytes + pieceBytes > MAX_SEGMENT_CONTENT_BYTES &&
          currentLines.length > 0
        ) {
          flush();
        }
        currentLines.push(piece);
        currentBytes += pieceBytes;
      }
      continue;
    }
    currentLines.push(line);
    currentBytes += lineBytes;
  }

  flush();

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

    // M11/T1: the declared header is only a fast pre-check. A chunked
    // response carries no content-length, so the actual body bytes are
    // counted before parsing.
    const rawBody = await res.text();
    const bodyBytes = Buffer.byteLength(rawBody, "utf8");
    if (bodyBytes > MAX_EMBEDDING_PAYLOAD_BYTES) {
      throw new Error(
        `EMBEDDING_PAYLOAD_TOO_LARGE: ${bodyBytes} bytes exceeds limit`,
      );
    }

    let data;
    try {
      data = JSON.parse(rawBody);
    } catch {
      throw new Error("EMBEDDING_INVALID_JSON_RESPONSE");
    }

    // Verify returned model identity (L03). M11/T1: exact equality — a
    // startsWith check accepted any "bge-m3-*" alias swap.
    if (data.model && data.model !== modelName) {
      throw new Error(
        `EMBEDDING_MODEL_MISMATCH: expected exactly ${modelName}, got ${data.model}`,
      );
    }
    if (
      data.model_version &&
      EXPECTED_MODEL_DIGEST &&
      data.model_version !== EXPECTED_MODEL_DIGEST
    ) {
      throw new Error(
        `EMBEDDING_MODEL_DIGEST_MISMATCH: endpoint reported ${data.model_version}, pinned ${EXPECTED_MODEL_DIGEST}`,
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
 * Builds the single all-or-nothing transaction for one ACTIVE skill (M11/T1).
 * Every interpolated literal goes through escapeSqlLiteral over the
 * array-literal grammar; the READY marker is written only after every segment
 * row landed, inside the same transaction, so no partial sync can ever be
 * observable. Callers must pass digests already validated by assertHexDigest.
 */
function buildSkillSyncTransaction({
  namespace,
  capability,
  version,
  contentHash,
  skillEmbeddingHash,
  semanticMeta,
  canonicalSecondaryTopics,
  segmentRows,
}) {
  const nsLit = escapeSqlLiteral(toPostgresArrayLiteral(namespace));
  const secLit = escapeSqlLiteral(
    toPostgresArrayLiteral(canonicalSecondaryTopics),
  );
  const subtopicLit = semanticMeta.subtopic
    ? escapeSqlLiteral(semanticMeta.subtopic)
    : "NULL";

  const valuesRows = segmentRows
    .map(
      (row) =>
        `(${row.ordinal}, ` +
        `${escapeSqlLiteral(
          toPostgresArrayLiteral(row.headingPath),
        )}::text[], ` +
        `${escapeSqlLiteral(row.content)}, ` +
        `${escapeSqlLiteral(row.vectorLiteral)}::vector(1024))`,
    )
    .join(",\n            ");

  return `
      BEGIN;
      DO $$
      DECLARE
        v_skill_id uuid;
      BEGIN
        INSERT INTO skills.catalog_index (
          namespace, capability, version, source_sha256, embedding_input_sha256,
          domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
        ) VALUES (
          ${nsLit}::text[],
          ${escapeSqlLiteral(capability)},
          ${escapeSqlLiteral(version)},
          '${contentHash}',
          '${skillEmbeddingHash}',
          ${escapeSqlLiteral(semanticMeta.domain)},
          ${escapeSqlLiteral(semanticMeta.primary_topic)},
          ${subtopicLit},
          ${secLit}::text[],
          'ACTIVE',
          'PENDING',
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
          sync_status = 'PENDING',
          synced_at = now(),
          failure_reason = NULL
        RETURNING id INTO v_skill_id;

        DELETE FROM skills.segments WHERE skill_id = v_skill_id;

        INSERT INTO skills.segments (
          skill_id, segment_ordinal, heading_path, content, embedding, created_at
        )
        SELECT v_skill_id, s.ordinal, s.heading_path, s.content, s.embedding, now()
        FROM (VALUES
            ${valuesRows}
        ) AS s(ordinal, heading_path, content, embedding);

        UPDATE skills.catalog_index
        SET sync_status = 'READY', synced_at = now()
        WHERE id = v_skill_id;
      END $$;
      COMMIT;
    `;
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
    // M10/T2-R20: the composite key joined with U+0000. PostgreSQL `text` cannot
    // store a NUL byte, so the tombstone statement aborted; and the skill
    // identity rules forbid control characters in a skill path anyway
    // (path-safety.mjs rejects /[\0\x01-\x1F\x7F]/). With any ACTIVE skill
    // present every sync failed here with VECTOR_TOMBSTONE_SYNC_FAILED and
    // ingestion was never reached.
    //
    // The SQL side was independently wrong too: it compared against
    // `namespace::text || capability || version`, and `namespace::text`
    // renders a text[] as `{a,b}` with braces and no separators, so the two
    // sides could never be equal and the predicate would have DEPRECATED every
    // ACTIVE row. It now uses `array_to_string(namespace,'/')`, which mirrors
    // `namespace.join("/")`, with the same `|` separators.
    //
    // `|` is provably unambiguous: every component is a skill path segment
    // restricted to /^[a-zA-Z0-9_.-]+$/u, so none of them can contain it.
    return `${id.namespace.join("/")}|${id.capability}|${id.version}`;
  });

  try {
    // M11/T1: two independent defects made this statement never reach a
    // successful execution against real PostgreSQL. (1) `unnest(ARRAY[{...}]
    // ::text[])` is a syntax error — a brace array literal is only legal as a
    // quoted string constant, so the literal now goes through
    // escapeSqlLiteral. (2) The pre-fix UPDATE wrote status='DEPRECATED' and
    // sync_status='TOMBSTONED', which migration 003 CHECK constraints do not
    // admit (status is ACTIVE-only; sync_status is PENDING/READY/FAILED).
    // The tombstone now DELETES the derived row (segments cascade via FK):
    // pgvector state is derived-only, canonical lifecycle truth stays in the
    // catalog, and every consumer already filters status='ACTIVE' AND
    // sync_status='READY', so removal is consumer-visible-identical.
    const tombstoneSql = `
      DELETE FROM skills.catalog_index
      WHERE status = 'ACTIVE'
      AND (array_to_string(namespace, '/') || '|' || capability || '|' || version) NOT IN (
        SELECT unnest(${escapeSqlLiteral(
          toPostgresArrayLiteral(activeKeys),
        )}::text[])
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

  // 4. Ingest and vectorize active records.
  // M11/T1: each skill is written as ONE transaction in ONE psql invocation.
  // The pre-fix loop executed one DO $$ block per segment and the ordinal-0
  // block already set sync_status='READY' before later segments were embedded
  // or inserted, so a mid-skill failure left a READY row with missing
  // segments (and the secondary failSql error was swallowed outright). All
  // embeddings are computed first; if any fails, nothing is written.
  let secondaryWriteFailed = false;
  for (const record of activeRecords) {
    const { namespace, capability, version } = record.manifest.identity;
    // M11/T1-R1 2.1: the canonical manifest schema has no `verification` key
    // (catalog.mjs enforces exact keys on `content`), and a record only reaches
    // sync through scanCatalog, which requires `content.sha256` to exist and
    // match. The old fallback read a field that can never legally be there.
    const recordedHash = record.manifest.content?.sha256;

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

      // M11/T1-R1 2.1: canonical manifests have no `metadata` key — the
      // catalog schema (exactKeys) rejects it — so this previously-dead read
      // is dropped and secondary topics are canonically empty until the
      // schema itself is extended (an approved follow-up, not done here).
      const canonicalSecondaryTopics = [];

      const semanticMeta = deriveSemanticMetadata({
        namespace,
        capability,
        tags: canonicalSecondaryTopics,
      });

      // Semantic record key tying catalog row to contract version (L17)
      const semanticRecordKey = `${namespace.join("/")}:${capability}:${version}:v1`;

      // Semantic chunk granularity (L11)
      const segments = chunkSkillContent(currentContent);

      const segmentRows = [];
      const envelopeHashes = [];
      for (const seg of segments) {
        const envelopeText = renderEmbeddingEnvelope({
          ...semanticMeta,
          content: seg.content,
        });
        const embeddingInputHash = computeEmbeddingInputHash(envelopeText);

        // M12/T2.2-R1 A-7 (owner decision `a`, 2026-10-15): every segment of
        // every active skill goes to the embedding endpoint, unconditionally.
        // A skip-when-unchanged optimization was considered and refused, because
        // the only model-identity checks in this path (`EMBEDDING_MODEL_MISMATCH`,
        // `EMBEDDING_MODEL_DIGEST_MISMATCH`, the dimension check below) live
        // INSIDE `generateSkillEmbeddings` — i.e. inside the HTTP call a skip
        // would avoid. A future skip requires a STORED model identity per row,
        // which is a schema migration and therefore outside this tier.
        const [vector] = await generateSkillEmbeddings([envelopeText], options);

        envelopeHashes.push(embeddingInputHash);
        segmentRows.push({
          ordinal: seg.segment_ordinal,
          headingPath: seg.heading_path,
          content: seg.content,
          vectorLiteral: `[${vector.join(",")}]`,
        });
      }

      // The row-level digest identifies the whole indexed representation:
      // sha256 over the per-segment envelope hashes. (Pre-fix, each segment's
      // ON CONFLICT UPDATE overwrote it, leaving the LAST segment's hash as
      // the recorded digest of the skill.)
      const skillEmbeddingHash = createHash("sha256")
        .update(envelopeHashes.join("\n"))
        .digest("hex");

      await executePostgresQuery(
        buildSkillSyncTransaction({
          namespace,
          capability,
          version,
          contentHash: assertHexDigest(currentHash, "source_sha256"),
          skillEmbeddingHash: assertHexDigest(
            skillEmbeddingHash,
            "embedding_input_sha256",
          ),
          semanticMeta,
          canonicalSecondaryTopics,
          segmentRows,
        }),
        options,
      );

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

      // Observable failure recording (BUG-08, L13). M11/T1: a failure to
      // persist the FAILED marker is itself escalated — the whole sync is
      // reported FAILED with VECTOR_FAILURE_WRITE_FAILED instead of
      // silently ignoring the secondary error.
      try {
        const nsPgArray = escapeSqlLiteral(toPostgresArrayLiteral(namespace));
        const failSql = `
          INSERT INTO skills.catalog_index (
            namespace, capability, version, source_sha256, embedding_input_sha256,
            domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
          ) VALUES (
            ${nsPgArray}::text[],
            ${escapeSqlLiteral(capability)},
            ${escapeSqlLiteral(version)},
            '${assertHexDigest(
              recordedHash || "0".repeat(64),
              "source_sha256",
            )}',
            '${"0".repeat(64)}',
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
        secondaryWriteFailed = true;
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
  if (secondaryWriteFailed) {
    syncReport.status = "FAILED";
    syncReport.error_code = "VECTOR_FAILURE_WRITE_FAILED";
  }

  return syncReport;
}
