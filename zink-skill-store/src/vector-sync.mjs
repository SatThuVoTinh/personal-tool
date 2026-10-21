import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import { readSkillStoreIdentity, scanCatalog } from "./catalog.mjs";
import {
  deriveSemanticMetadata,
  renderEmbeddingEnvelope,
  computeEmbeddingInputHash,
  SEMANTIC_CONTRACT_VERSION,
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
 * A dollar-quote tag that cannot occur in `text`.
 *
 * PostgreSQL ends a dollar-quoted string at the first matching tag, so a
 * `DO $$ ... $$` body that carried an untrusted `$$` — a skill body, a
 * failure reason — was truncated before psql had finished reading it, and the
 * statement was rejected as a syntax error instead of doing its work. The
 * tag below is derived from the text itself and grows until it cannot be a
 * substring of it, so the body always closes exactly where it should.
 */
export function dollarQuoteTag(text) {
  const source = String(text ?? "");
  let tag = "$zink";
  while (source.includes(`${tag}$`)) tag = `${tag}z`;
  return `${tag}$`;
}

/**
 * M12/T9-R1 F-054: the docker container name.
 *
 * The name reaches `docker exec` as an argv token, where a leading `--` is
 * parsed by docker as its own option rather than as the container name. It
 * comes from the environment (or from caller options), so it is checked
 * BEFORE the spawn: an invalid name is refused, not handed to docker.
 *
 * Docker's own container-name grammar is `[a-zA-Z0-9][a-zA-Z0-9_.-]*`; the
 * value is not echoed in the refusal, because an environment value that
 * failed this check may be something else entirely.
 */
const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

export function validatePostgresContainerName(name) {
  if (typeof name !== "string" || !CONTAINER_NAME.test(name)) {
    throw new Error(
      "POSTGRES_CONTAINER_INVALID: the PostgreSQL container name is not a valid container name.",
    );
  }
  return name;
}

/**
 * M12/T9-R1 F-054: the SERVER-side bound of a query.
 *
 * Killing the `docker exec` client does not stop the query: psql is already
 * inside the container, and the server-side statement keeps running after the
 * client has reported `DB_TIMEOUT`. The advertised deadline was therefore a
 * client-side illusion. `statement_timeout` is the server's own bound — it
 * cancels the running statement — so the deadline now holds where the work
 * actually happens.
 */
export function withServerSideTimeout(sql, timeoutMs) {
  const bounded =
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000;
  return `SET statement_timeout = ${bounded};\n${sql}`;
}

/**
 * Executes a PostgreSQL command via docker exec or custom query executor (L07, L08, L09).
 */
export async function executePostgresQuery(sql, options = {}) {
  if (typeof options.dbExecutor === "function") {
    return options.dbExecutor(sql);
  }

  const containerName = validatePostgresContainerName(
    process.env.POSTGRES_CONTAINER ||
      options.postgresContainer ||
      "personal-tool-postgres-1",
  );
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
        } else if (
          /statement timeout|canceling statement due to/u.test(stderr)
        ) {
          // F-054: the server cancelled the statement at its own deadline.
          // The caller must see the same class of failure as the client-side
          // timeout, not a generic database error it cannot classify.
          reject(
            new Error(`DB_TIMEOUT: Database query exceeded ${dbTimeoutMs}ms`),
          );
        } else {
          reject(
            new Error(`Database error (code ${code}): ${stderr || stdout}`),
          );
        }
      }
    });

    child.stdin.write(withServerSideTimeout(sql, dbTimeoutMs));
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

    // M12/T9-R1 F-046: the model identity must be REPORTED, not merely
    // compared when the endpoint happens to volunteer it. The old guards were
    // both conditioned on the field being present, so a response that
    // omitted it was a PASS — exactly the case the check exists for, because
    // the vectors could then have come from any model at all.
    if (typeof data.model !== "string" || data.model.length === 0) {
      throw new Error(
        `EMBEDDING_MODEL_UNREPORTED: the endpoint did not report which model produced these vectors (expected ${modelName}).`,
      );
    }
    // Verify returned model identity (L03). M11/T1: exact equality — a
    // startsWith check accepted any "bge-m3-*" alias swap.
    if (data.model !== modelName) {
      throw new Error(
        `EMBEDDING_MODEL_MISMATCH: expected exactly ${modelName}, got ${data.model}`,
      );
    }
    // The digest pin still fires when the endpoint volunteers the digest. It
    // has no other reachable path: the live producer answers `model,
    // embeddings, total_duration, load_duration, prompt_eval_count` and never
    // `model_version`, and the pinned value does not match the artifact the
    // endpoint has installed (measured 2026-10-19: the endpoint's own model
    // list reports `sha256:7907646426070047a77226ac3e684fbbe8410524f7b4a74d
    // 02837e43f2146bab` for `bge-m3:latest`). Which artifact is approved —
    // and therefore where the digest comes from — is an owner decision, not
    // something this module may decide on its own.
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

  // M12/T9-R1 F-019: the block below is dollar-quoted, and PostgreSQL ends a
  // dollar-quoted string at the first matching tag. The skill body is
  // untrusted text that reaches this statement, so a body containing `$$`
  // used to truncate the statement before psql had finished reading it, and
  // the whole skill's transaction was rejected as a syntax error. The tag is
  // chosen so it cannot occur in ANY of the interpolated values.
  const tag = dollarQuoteTag(
    [
      nsLit,
      secLit,
      subtopicLit,
      capability,
      version,
      contentHash,
      skillEmbeddingHash,
      semanticMeta.domain,
      semanticMeta.primary_topic,
      valuesRows,
    ].join("\n"),
  );

  return `
      BEGIN;
      DO ${tag}
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
      END ${tag};
      COMMIT;
    `;
}

/**
 * The derived-index tombstone key, in ONE place.
 *
 * The tombstone compares a row's identity against the set of skills the
 * canonical catalog still holds, and the comparison is only sound when the
 * JavaScript key and the SQL key are the SAME string. They are built from the
 * same three components and the same separator, and the separator is `|`,
 * which no identity component can contain (the catalog's identity grammar
 * admits only lowercase kebab-case segments and SemVer versions).
 *
 * Exported so the guarantee is provable by execution rather than by reading
 * two copies of the same template literal: a test can build the SQL side from
 * `TOMBSTONE_KEY_SQL_EXPRESSION` and compare it with this function's answer
 * for the same identity.
 */
export function tombstoneKey(identity) {
  return `${identity.namespace.join("/")}|${identity.capability}|${identity.version}`;
}

/**
 * The SQL side of `tombstoneKey`.
 *
 * `array_to_string(namespace, '/')` renders the namespace array the way
 * `namespace.join("/")` renders it in JavaScript. `namespace::text` would NOT:
 * it renders a `text[]` with braces and no separators (`{a,b}`), so the two
 * sides could never be equal and the predicate would have retired every
 * ACTIVE row. The separator literal appears exactly twice because the key has
 * three components.
 */
export const TOMBSTONE_KEY_SQL_EXPRESSION =
  "array_to_string(namespace, '/') || '|' || capability || '|' || version";

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

  // M12/T9 F-176: the sync must be told WHICH store it is talking to.
  //
  // The store carries its own identity beside its root, and the caller may
  // name the store it expects. A caller that names one and the store that
  // does not carry it is REFUSED HERE, before any statement runs: nothing is
  // synced and nothing is deleted. The refusal is a named code, not a prose
  // error, so the operator can tell "the wrong root" from "the index is
  // broken".
  const expectedStoreId =
    typeof options.expectedStoreId === "string" &&
    options.expectedStoreId.trim() !== ""
      ? options.expectedStoreId.trim()
      : null;
  const storeIdentity = await readSkillStoreIdentity(skillsRoot);
  if (expectedStoreId !== null && storeIdentity !== expectedStoreId) {
    return {
      status: "FAILED",
      error_code: "SKILL_STORE_IDENTITY_MISMATCH",
      error:
        "the Skill Store does not carry the expected store identity; nothing was synced and nothing was deleted",
      expected_store_id: expectedStoreId,
      actual_store_id: storeIdentity,
      tombstone_status: "REFUSED",
      tombstone_error_code: "SKILL_STORE_IDENTITY_MISMATCH",
      sync_generation_id: syncGenerationId,
      scanned_count: 0,
      active_count: 0,
      synced_count: 0,
      failed_count: 0,
      skills: [],
    };
  }

  // 1. Scan and validate canonical catalog (Phase 5, §8)
  const catalog = await scanCatalog(skillsRoot);
  const catalogErrors = catalog.errors ?? [];

  // 2. Filter strictly for ACTIVE skills (BUG-04)
  const activeRecords = catalog.records.filter((record) => {
    const lifecycle = record.manifest?.lifecycle;
    return Array.isArray(lifecycle) && lifecycle.at(-1)?.status === "ACTIVE";
  });

  // M12/T9-R1 F-152: the skills the catalog proves are RETIRED. Their derived
  // rows must be removed even when an unrelated record is invalid, otherwise
  // one bad file freezes every retirement in the store for the whole SLA
  // window and the adapter keeps serving retired skills.
  //
  // Only a readable manifest counts: a skill whose manifest cannot be read
  // is NOT provably retired, so its row is left alone rather than deleted on
  // a guess.
  const retiredKeys = catalog.records
    .filter(
      (record) => record.manifest?.lifecycle?.at(-1)?.status === "DEPRECATED",
    )
    .map((record) => tombstoneKey(record.manifest.identity));

  const syncReport = {
    status: "RUNNING",
    sync_generation_id: syncGenerationId,
    scanned_count: catalog.records.length,
    active_count: activeRecords.length,
    synced_count: 0,
    failed_count: 0,
    skills: [],
  };

  // M12/T9 F-095 (R5-E04-05) / H8 — the governed retirement is RECORDED in
  // the derived index, not only deleted from it.
  //
  // `003_skills_vector_schema.sql` could only admit `status = 'ACTIVE'` and
  // `sync_status IN ('PENDING','READY','FAILED')`, so a retired skill had
  // exactly ONE representation in the derived index: the row was DELETED, and
  // the index could not say WHY the skill was gone. The Skill Store's own
  // forward migration (`zink-skill-store/migrations/004_skill_retirement_state.sql`)
  // widened the two CHECK constraints, so the retirement is now WRITTEN:
  // `status = 'DEPRECATED'`, `sync_status = 'TOMBSTONED'`.
  //
  // The segments are dropped in the SAME statement: the foreign key cascades
  // on a DELETE of the parent row, and this statement UPDATES the parent, so
  // the vectors of a retired skill would otherwise survive their retirement.
  //
  // The canonical lifecycle truth stays in the catalog's manifest; the derived
  // row now carries the retirement as well, and the consumers that filter on
  // `status = 'ACTIVE' AND sync_status = 'READY'` keep serving exactly what
  // they served before.
  if (retiredKeys.length > 0) {
    const retirementMarkerSql = `
      WITH retired AS (
        SELECT id FROM skills.catalog_index
        WHERE status = 'ACTIVE'
        AND (${TOMBSTONE_KEY_SQL_EXPRESSION}) IN (
          SELECT unnest(${escapeSqlLiteral(
            toPostgresArrayLiteral(retiredKeys),
          )}::text[])
        )
      ), dropped AS (
        DELETE FROM skills.segments WHERE skill_id IN (SELECT id FROM retired)
      )
      UPDATE skills.catalog_index
      SET status = 'DEPRECATED', sync_status = 'TOMBSTONED'
      WHERE id IN (SELECT id FROM retired);
    `;
    try {
      await executePostgresQuery(retirementMarkerSql, options);
    } catch (error) {
      syncReport.status = "FAILED";
      syncReport.error_code = "VECTOR_RETIREMENT_MARK_FAILED";
      syncReport.error = String(
        error?.message || "Retirement marking failed",
      ).slice(0, MAX_FAILURE_REASON_LENGTH);
      syncReport.failed_count = 1;
      return syncReport;
    }
  }

  if (catalogErrors.length > 0) {
    // F-152: the tombstone used to be skipped entirely whenever the scan
    // reported anything, so ONE invalid file anywhere left every previously
    // READY row in place — including the rows of skills the owner had
    // retired — while the index still reported FRESH for up to the 7-day SLA
    // and the adapter kept serving them.
    //
    // The narrow statement deletes ONLY the rows it can prove are retired.
    // A row whose skill could not be read is left alone: the catalog is
    // incomplete, so "not in the active set" would mean "not known", and
    // deleting on that basis would destroy a live skill's vectors.
    if (retiredKeys.length > 0) {
      const retirementSql = `
        DELETE FROM skills.catalog_index
        WHERE status = 'ACTIVE'
        AND (${TOMBSTONE_KEY_SQL_EXPRESSION}) IN (
          SELECT unnest(${escapeSqlLiteral(
            toPostgresArrayLiteral(retiredKeys),
          )}::text[])
        );
      `;
      try {
        await executePostgresQuery(retirementSql, options);
      } catch (error) {
        return {
          status: "FAILED",
          error_code: "VECTOR_TOMBSTONE_SYNC_FAILED",
          error: String(
            error?.message || "Tombstone synchronization failed",
          ).slice(0, MAX_FAILURE_REASON_LENGTH),
          details: catalogErrors,
          sync_generation_id: syncGenerationId,
          synced_count: 0,
          failed_count: 1,
        };
      }
    }
    return {
      status: "FAILED",
      error_code: "CATALOG_INVALID",
      details: catalogErrors,
      sync_generation_id: syncGenerationId,
      synced_count: 0,
      failed_count: 0,
    };
  }

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
    //
    // M12/T9-R1 F-240: both sides are now built from the shipped constants
    // (`tombstoneKey` / `TOMBSTONE_KEY_SQL_EXPRESSION`) instead of from two
    // copies of the same template literal, so the two sides can be compared by
    // execution rather than by reading the source.
    return tombstoneKey(id);
  });

  // M12/T9 F-176: the zero-row tombstone is the destructive one.
  //
  // With no ACTIVE skill the key set is empty, so the statement below removes
  // EVERY active derived row the index holds. That is correct for a store the
  // owner emptied, and catastrophic for a `skillsRoot` that points at a
  // DIFFERENT empty store: the sync would delete the intended store's whole
  // derived index while believing it had synced an empty catalog.
  //
  // So the statement runs only when the store is CONFIRMED: the caller named
  // the store and the store carries that identity. An unnamed store keeps the
  // ordinary behaviour when it holds skills (the existing behaviour the owner
  // kept), and an EMPTY store is tombstoned only under the explicit opt-in.
  const storeIsEmpty = catalog.records.length === 0;
  const storeIsConfirmed =
    expectedStoreId !== null && storeIdentity === expectedStoreId;
  const tombstoneAllowed =
    !storeIsEmpty ||
    storeIsConfirmed ||
    options.allowUnnamedEmptyTombstone === true;

  if (tombstoneAllowed) {
    syncReport.tombstone_status = "APPLIED";
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
      AND (${TOMBSTONE_KEY_SQL_EXPRESSION}) NOT IN (
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
  } else {
    // The refusal is named, and the report says so: a sync that skipped the
    // tombstone must never read as "the index matches the catalog".
    syncReport.tombstone_status = "REFUSED";
    syncReport.tombstone_error_code = "SKILL_STORE_IDENTITY_UNNAMED";
    syncReport.tombstone_error =
      "the store carries no confirmed identity, so the zero-row tombstone was not run";
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
        semantic_contract_version: SEMANTIC_CONTRACT_VERSION,
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
        // M12/T2.2-R3 R3-7: the failure row must describe the failure it
        // records, and it must leave nothing retrievable behind. As upserted
        // per statement, the pre-fix form (1) refreshed only sync_status /
        // failure_reason / synced_at on conflict, so a row could report FAILED
        // while still carrying the PREVIOUS successful sync's digests, and
        // (2) touched only `catalog_index`, so every segment vector of that
        // previous sync stayed selectable under a row that had just disowned
        // them. It is now one DO block, mirroring the READY path: upsert with
        // both digests, take the id, delete the segments.
        // `source_sha256` is the manifest's digest — the failure path may have
        // died before the file was ever read, and `recordedHash` is the only
        // digest that is always a governed value here (the catalog enforces it
        // and the old `"0".repeat(64)` stand-in could not be reached).
        const failureSemantic = deriveSemanticMetadata({
          namespace,
          capability,
          tags: [],
        });
        // M12/T9-R1 F-019: the failure reason is untrusted text (it carries an
        // upstream error message) and the block below is dollar-quoted, so a
        // reason containing `$$` truncated the statement before psql had
        // finished reading it. The tag cannot occur in the reason, so the
        // block closes exactly where it should and the reason reaches the
        // failure row intact.
        const failureTag = dollarQuoteTag(
          [nsPgArray, capability, version, boundedReason].join("\n"),
        );
        const failSql = `
          DO ${failureTag}
          DECLARE
            v_skill_id uuid;
          BEGIN
            INSERT INTO skills.catalog_index (
              namespace, capability, version, source_sha256, embedding_input_sha256,
              domain, primary_topic, subtopic, secondary_topics, status, sync_status, synced_at, failure_reason
            ) VALUES (
              ${nsPgArray}::text[],
              ${escapeSqlLiteral(capability)},
              ${escapeSqlLiteral(version)},
              '${assertHexDigest(recordedHash, "source_sha256")}',
              '${"0".repeat(64)}',
              ${escapeSqlLiteral(failureSemantic.domain)},
              ${escapeSqlLiteral(failureSemantic.primary_topic)},
              NULL,
              '{}'::text[],
              'ACTIVE',
              'FAILED',
              now(),
              ${escapeSqlLiteral(boundedReason)}
            )
            ON CONFLICT (namespace, capability, version) DO UPDATE SET
              source_sha256 = EXCLUDED.source_sha256,
              embedding_input_sha256 = EXCLUDED.embedding_input_sha256,
              sync_status = 'FAILED',
              failure_reason = ${escapeSqlLiteral(boundedReason)},
              synced_at = now()
            RETURNING id INTO v_skill_id;

            DELETE FROM skills.segments WHERE skill_id = v_skill_id;
          END ${failureTag};
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
