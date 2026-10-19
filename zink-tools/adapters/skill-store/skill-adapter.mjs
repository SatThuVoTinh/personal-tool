import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  prepareQueryEmbedding,
  computeEmbeddingInputHash,
  deriveSemanticMetadata,
  CANONICAL_DOMAINS,
  KNOWN_TAXONOMY_MAP,
  NAMESPACE_ALIAS_MAP,
  RETRIEVAL_MIN_RELEVANCE,
} from "../../common/semantic-contract.mjs";
import {
  generateSkillEmbeddings,
  executePostgresQuery,
  EXPECTED_MODEL_NAME,
  toPostgresArrayLiteral,
  escapeSqlLiteral,
  checkIndexFreshness,
} from "../../../zink-skill-store/src/vector-sync.mjs";
import {
  scanCatalog,
  withSkillStoreWriterLock,
} from "../../../zink-skill-store/src/catalog.mjs";

export class SkillAdapterError extends Error {
  constructor(message, code = "SKILL_ADAPTER_ERROR") {
    super(code ? `[${code}] ${message}` : message);
    this.name = "SkillAdapterError";
    this.code = code;
  }
}

const ALLOWED_ACTIONS = new Set([
  "discover",
  "read",
  "validate",
  "apply",
  "search",
  "propose",
]);

const FORBIDDEN_ACTIONS = new Set(["publish", "deprecate", "admin"]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

export const VETTED_ROOT_NAMESPACES = new Set([
  "automation",
  "business",
  "data",
  "lscm",
  "research",
  "system",
  "specialist",
  "general",
  ...CANONICAL_DOMAINS,
  ...Object.keys(KNOWN_TAXONOMY_MAP),
  ...Object.keys(NAMESPACE_ALIAS_MAP),
]);

// R25: how many SEGMENT rows one skill can contribute to a search.
//
// The search LIMIT is a limit on rows, but the caller asks for skills and the
// loop deduplicates to skills. With the old `limit * 4`, three long skills at
// 16 segments each consumed the entire 40-row budget for a request of 10, and
// seven further qualifying skills never appeared at all - silently, with
// governed_status SUCCESS and nothing signalling truncation.
//
// Derived rather than guessed: the catalog refuses a SKILL.md above 262_144
// bytes (catalog.mjs, enforced on both write and scan) and the chunker emits
// at most one segment per MAX_SEGMENT_CONTENT_BYTES = 16_384
// (vector-sync.mjs). So 262144 / 16384 = 16 is the hard maximum, and a row
// budget of limit * 16 provably still yields `limit` distinct skills.
//
// If either ceiling changes, this must change with it.
const MAX_SEGMENTS_PER_SKILL_VERSION = Math.ceil(262_144 / (16 * 1024));
export const MAX_PROPOSAL_CONTENT_BYTES = 128 * 1024; // 128KB
export const MAX_PROPOSAL_REASON_BYTES = 4 * 1024; // 4KB

/**
 * Derives proposal ID based on skill identity, version, content hash, and optional nonce (K17).
 */
export function deriveProposalId({
  namespace,
  capability,
  version,
  content_sha256,
  nonce,
}) {
  const ns = Array.isArray(namespace)
    ? namespace.join("/")
    : String(namespace || "");
  const base = `skill-proposal-v1:${ns}:${capability}:${version}:${content_sha256}`;
  const payload = nonce ? `${base}:${nonce}` : base;
  return createHash("sha256")
    .update(payload, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/**
 * Read a record's bytes and PROVE they are the approved ones — through the
 * canonical catalog, never a private disk walk.
 *
 * M11/T1-R1 2.1: the previous implementation re-read `SKILL.md` and
 * `manifest.json` itself with lax `JSON.parse`, so a manifest that
 * `scanCatalog` refuses (extra keys, bad lifecycle, oversized, symlinked)
 * could still be served to an agent by `read`/`apply` while `discover`
 * failed closed on the same bytes. Resolution now goes through the catalog
 * validator, strict JSON parser, `lstat` non-link rules and per-file byte
 * ceilings, and the content is the one the scanner decoded after digest
 * verification. Any catalog error ⇒ fail closed, no fallback: a digest
 * mismatch keeps the R25 `SKILL_SOURCE_DRIFT` taxonomy, everything else is
 * reported as `SKILL_CATALOG_INVALID`.
 *
 * M11/T1-R1 2.5: a bare (unqualified) slug matching capabilities under more
 * than one namespace is `SKILL_ID_AMBIGUOUS`, never an enumeration-order
 * pick. Qualified ids are matched whole (R25 behavior preserved).
 */
async function loadVerifiedRecord(skillsDir, targetSkillId) {
  const catalog = await scanCatalog(skillsDir);
  if (catalog.errors.length > 0) {
    if (catalog.errors.some((e) => e.code === "CONTENT_DIGEST_MISMATCH")) {
      throw new SkillAdapterError(
        `SOURCE_DRIFT_DETECTED: the catalog refused bytes that do not match their manifest digest (${targetSkillId})`,
        "SKILL_SOURCE_DRIFT",
      );
    }
    throw new SkillAdapterError(
      `Skill catalog is invalid (${catalog.errors[0]?.code ?? "unknown"}); refusing to serve ${targetSkillId}`,
      "SKILL_CATALOG_INVALID",
    );
  }

  // R25: a qualified id must be matched WHOLE. Matching on the bare last
  // segment let two namespaces that share a capability slug collide, and
  // `fullId.endsWith(targetSkillId)` matched any id by suffix.
  const qualified = targetSkillId.includes("/");
  const targetSlug = targetSkillId.split("/").pop();
  const resolved = [];
  const identitiesSeen = new Set();

  for (const rec of catalog.records) {
    const idInfo = rec.manifest?.identity || {};
    const cap = idInfo.capability;
    const ns = Array.isArray(idInfo.namespace)
      ? idInfo.namespace.join("/")
      : String(idInfo.namespace || "");
    const fullId = `${ns}/${cap}`;
    const matches = qualified
      ? fullId === targetSkillId
      : cap === targetSkillId || cap === targetSlug;
    if (!matches) continue;
    resolved.push(rec);
    identitiesSeen.add(fullId);
    if (qualified) break;
  }

  if (resolved.length === 0) return null;
  if (!qualified && identitiesSeen.size > 1) {
    throw new SkillAdapterError(
      `SKILL_ID_AMBIGUOUS: '${targetSkillId}' resolves under multiple namespaces: ${[...identitiesSeen].sort().join(", ")} — use a qualified id`,
      "SKILL_ID_AMBIGUOUS",
    );
  }

  // Catalog records are sorted by relative path, so the first match is the
  // lowest version in the namespace — the same deterministic pick the old
  // sorted walk made. The caller enforces the ACTIVE lifecycle gate.
  const record = resolved[0];
  const content = record.markdown;
  const digest = createHash("sha256").update(content, "utf8").digest("hex");
  return { record: { manifest: record.manifest }, content, digest };
}
/**
 * Atomically persists one JSON record: temp file, write, fsync, rename.
 * A partially written file is never treated as a valid proposal.
 */
function writeJsonAtomicSync(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

function readProposalRecordSync(filePath) {
  // Absent and unreadable are not the same answer. Returning null for both made
  // the caller's sameBytes check false, so both terminal-status guards fell
  // through and an owner's recorded decision was overwritten.
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new SkillAdapterError(
      `Skill proposal record exists but cannot be read (${error?.code ?? "unknown"}).`,
      "SKILL_PROPOSAL_UNREADABLE",
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new SkillAdapterError(
      "Skill proposal record exists but is not valid JSON.",
      "SKILL_PROPOSAL_UNREADABLE",
    );
  }
}

export class SkillAdapter {
  constructor(skillStoreRoot, options = {}) {
    this.root =
      skillStoreRoot ??
      path.resolve(import.meta.dirname, "../../../zink-skill-store");
    this.skillsRoot = options.skillsRoot ?? path.join(this.root, "skills");
    this.options = options;
  }

  async querySkillStore(input = {}, context = {}) {
    const { action, namespace, skill_id } = input;

    if (!action || FORBIDDEN_ACTIONS.has(action)) {
      throw new SkillAdapterError(
        `Action '${action}' is strictly forbidden by Skill Store policy`,
        "SKILL_ACTION_FORBIDDEN",
      );
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      throw new SkillAdapterError(
        `Unknown Skill Store action: ${action}`,
        "SKILL_ACTION_INVALID",
      );
    }

    try {
      // =========================================================================
      // Action: discover (K01) — Read canonical lifecycle manifests
      // =========================================================================
      if (action === "discover") {
        const found = [];
        const skillsDir = this.skillsRoot;

        const rootAvailable = isReadableDirectory(skillsDir);
        if (rootAvailable) {
          let catalog = null;
          try {
            catalog = await scanCatalog(skillsDir);
          } catch (err) {
            catalog = { records: [], errors: [String(err?.message ?? err)] };
          }

          // M10/T2-R20: an INVALID catalog must never degrade to the permissive
          // disk walk below. `scanCatalog` returns `records: []` whenever
          // `errors` is non-empty (catalog.mjs:732), so ONE tampered skill made
          // this branch fall through to a walk that re-reads the very same files
          // with NO content-digest and NO manifest validation, then reported
          // `governed_status: "SUCCESS"` and listed the tampered skill as
          // discoverable. Proven by execution: a skill whose SKILL.md no longer
          // matched its manifest digest still came back discoverable, readable
          // and applicable, while `validate` correctly raised drift.
          //
          // The other two consumers of the same scan already fail closed —
          // `getActiveSkill` (catalog.mjs:738) and `syncSkillsToVectorStore`
          // (vector-sync.mjs:358). Discovery now matches them.
          const catalogErrors = catalog?.errors ?? [];
          if (catalogErrors.length > 0) {
            // F-125 (R1-A10-03): the shape here is pinned by the repository's
            // own closed evidence (F-187's runtime assertions and R20-01's
            // source-text assertions), so the CONTRACT is the side that was
            // wrong: `zink-skill.schema.json` declared a vocabulary the
            // adapter never used and omitted the key it always emits. The
            // contract now declares what is actually emitted, so this envelope
            // passes its own declared output schema.
            return {
              action: "discover",
              namespace: namespace ?? "all",
              skills: [],
              governed_status: "FAILED",
              error_code: "SKILL_CATALOG_INVALID",
            };
          }

          if (catalog && catalog.records && catalog.records.length > 0) {
            for (const rec of catalog.records) {
              const lifecycle = rec.manifest?.lifecycle;
              const isActive =
                Array.isArray(lifecycle) &&
                lifecycle.at(-1)?.status === "ACTIVE";
              if (!isActive) continue;

              const idInfo = rec.manifest?.identity || {};
              const nsArr = Array.isArray(idInfo.namespace)
                ? idInfo.namespace
                : [idInfo.namespace];
              const nsStr = nsArr.join("/");

              if (
                namespace &&
                namespace !== "all" &&
                nsStr !== namespace &&
                !nsArr.includes(namespace)
              ) {
                continue;
              }

              found.push({
                skill_id: `${nsStr}/${idInfo.capability}`,
                name: idInfo.capability,
                namespace: nsArr,
                capability: idInfo.capability,
                version: idInfo.version,
                lifecycle_state: "ACTIVE",
                // M11/T1-R1 2.1: canonical manifests carry no `metadata` key
                // (the catalog schema forbids it), so this description source
                // is the capability name — the old `metadata?.description`
                // read could only ever be undefined.
                description: `Governed skill: ${idInfo.capability}`,
              });
            }
          }
        }

        // The legacy `namespaces/` tree is not a canonical source. It bypasses
        // catalog validation, lifecycle rules and content hashing, so it must
        // never yield a discoverable skill. There is no fallback: when the
        // canonical `skills/` tree holds no ACTIVE skill, discovery is empty.

        return {
          action: "discover",
          namespace: namespace ?? "all",
          skills: found,
          governed_status: "SUCCESS",
        };
      }

      // =========================================================================
      // Action: read / validate (K02) — Read canonical stored skill & verify hash
      // =========================================================================
      if (action === "read" || action === "validate") {
        if (!skill_id) {
          throw new SkillAdapterError(
            "skill_id is required for read/validate",
            "SKILL_ID_REQUIRED",
          );
        }

        let storedSkill = null;
        // R25: digest verified for EVERY action, not just validate.
        // M11/T1-R1: resolution/verification now runs through the catalog.
        const verified = await loadVerifiedRecord(this.skillsRoot, skill_id);

        if (verified) {
          const { record, content, digest } = verified;
          const lifecycle = record.manifest?.lifecycle;
          const lifecycleState = Array.isArray(lifecycle)
            ? lifecycle.at(-1)?.status
            : "active";

          storedSkill = {
            skill_id,
            lifecycle_state: lifecycleState,
            content,
            // R25: the digest of the bytes actually served, which is what was
            // just proved to equal the approved content. The old literal
            // "verified-provenance" was a constant: manifest.verification
            // does not exist in the canonical schema, so EVERY skill was
            // stamped with it, verified or not.
            signature: `sha256:${digest}`,
            namespace: record.manifest?.identity?.namespace,
            capability: record.manifest?.identity?.capability,
            version: record.manifest?.identity?.version,
          };
        }

        if (!storedSkill) {
          throw new SkillAdapterError(
            `Skill ${skill_id} was not found in the governed store`,
            "SKILL_NOT_FOUND",
          );
        }

        if (storedSkill.lifecycle_state !== "ACTIVE") {
          throw new SkillAdapterError(
            `Skill ${skill_id} is not ACTIVE`,
            "SKILL_NOT_ACTIVE",
          );
        }

        return {
          action,
          namespace: namespace ?? "default",
          skills: [],
          skill_content: storedSkill,
          governed_status: "SUCCESS",
        };
      }

      // =========================================================================
      // Action: apply (K03) — Validate ACTIVE lifecycle before template apply
      // =========================================================================
      if (action === "apply") {
        if (!skill_id) {
          throw new SkillAdapterError(
            "skill_id is required for apply",
            "SKILL_ID_REQUIRED",
          );
        }

        let storedSkill = null;
        // R25: apply served unverified bytes and labelled them
        // "verified-provenance". It now goes through the same loader, so the
        // procedure handed to an agent is the one the owner approved. The
        // loader resolves, reads and verifies in one pass through the catalog
        // (M11/T1-R1); the separate disk walk it replaces never validated.
        const verified = await loadVerifiedRecord(this.skillsRoot, skill_id);

        if (verified) {
          const { record: verifiedRecord, content, digest } = verified;
          const lifecycle = verifiedRecord.manifest?.lifecycle;
          const status = Array.isArray(lifecycle)
            ? lifecycle.at(-1)?.status
            : null;
          if (status !== "ACTIVE") {
            throw new SkillAdapterError(
              `Skill ${skill_id} is in status ${status}, must be ACTIVE to apply`,
              "SKILL_NOT_ACTIVE",
            );
          }

          storedSkill = {
            skill_id,
            lifecycle_state: "active",
            content,
            signature: `sha256:${digest}`,
            namespace: verifiedRecord.manifest?.identity?.namespace,
            capability: verifiedRecord.manifest?.identity?.capability,
            version: verifiedRecord.manifest?.identity?.version,
          };
        }

        if (!storedSkill) {
          throw new SkillAdapterError(
            `Skill ${skill_id} was not found in the governed store`,
            "SKILL_NOT_FOUND",
          );
        }

        return {
          action,
          namespace: namespace ?? "default",
          skills: [],
          skill_content: storedSkill,
          governed_status: "SUCCESS",
        };
      }

      // =========================================================================
      // Action: search (K04-K11) — Semantic Vector Search over ACTIVE skills
      // =========================================================================
      if (action === "search") {
        const { query, limit = 10 } = input;

        if (!query || typeof query !== "string" || !query.trim()) {
          throw new SkillAdapterError(
            "query is required for search",
            "SKILL_QUERY_REQUIRED",
          );
        }

        const boundedLimit = Math.max(1, Math.min(20, Number(limit) || 10));
        const minScore =
          typeof input.min_score === "number"
            ? input.min_score
            : (this.options.minScore ?? RETRIEVAL_MIN_RELEVANCE); // K05: minimum similarity threshold

        // Separate query text from metadata filters (BUG-02)
        const { queryTextForEmbedding, metadataFilters } =
          prepareQueryEmbedding(input);

        // Generate query embedding
        const [queryVector] = await generateSkillEmbeddings(
          [queryTextForEmbedding],
          this.options,
        );

        // Construct parameterized SQL filters (K07, K09)
        const vectorStr = `[${queryVector.join(",")}]`;
        const whereClauses = ["c.status = 'ACTIVE'", "c.sync_status = 'READY'"];

        if (metadataFilters.primary_topic) {
          whereClauses.push(
            `c.primary_topic = ${escapeSqlLiteral(metadataFilters.primary_topic)}`,
          );
        }
        if (metadataFilters.subtopic) {
          whereClauses.push(
            `c.subtopic = ${escapeSqlLiteral(metadataFilters.subtopic)}`,
          );
        }
        if (metadataFilters.capability) {
          whereClauses.push(
            `c.capability = ${escapeSqlLiteral(metadataFilters.capability)}`,
          );
        }

        // K09: the namespace filter is applied in SQL. (The secondary_topics
        // half of this clause was withdrawn — F-008, see below.)
        // M11/T1: array-valued namespaces used to skip the B15 taxonomy
        // validation (which only covers the string form) and the literal was
        // interpolated unquoted — invalid SQL for any real psql, and a
        // quote-breakout channel for tool-controlled strings. Elements are
        // now validated through the shared semantic contract and the whole
        // array literal passes through escapeSqlLiteral.
        const targetNs = metadataFilters.namespace || input.namespace;
        if (targetNs && targetNs !== "all") {
          const nsList = Array.isArray(targetNs) ? targetNs : [targetNs];
          for (const ns of nsList) {
            if (typeof ns !== "string" || !ns.trim()) {
              throw new SkillAdapterError(
                "namespace filter elements must be non-empty strings",
                "SKILL_NAMESPACE_FILTER_INVALID",
              );
            }
          }
          const nsCheck = deriveSemanticMetadata({
            namespace: nsList,
            capability: "filter-validation",
          });
          if (
            Array.isArray(nsCheck.unresolved_namespaces) &&
            nsCheck.unresolved_namespaces.length > 0
          ) {
            throw new SkillAdapterError(
              `UNKNOWN_NAMESPACE_FILTER: ${JSON.stringify(
                nsCheck.unresolved_namespaces,
              )} are not canonical namespaces or known aliases`,
              "SKILL_NAMESPACE_FILTER_INVALID",
            );
          }
          // Match the canonical form the writer stored, not the raw alias.
          const canonicalNs = nsCheck.resolved_namespaces ?? nsList;
          whereClauses.push(
            `c.namespace @> ${escapeSqlLiteral(
              toPostgresArrayLiteral(canonicalNs),
            )}::text[]`,
          );
        }

        // F-008 (R1-A10-06): the `secondary_topics` predicate is WITHDRAWN
        // here, together with the contract-layer forwarding it depended on
        // (zink-tools/common/semantic-contract.mjs).
        //
        // The column it compared against is always empty: the writer passes
        // `canonicalSecondaryTopics = []` (zink-skill-store/src/vector-sync.mjs),
        // because a canonical skill manifest carries no metadata key to derive
        // topics from. So the overlap test could only remove rows — and it
        // removed them silently, answering NO_MATCH, which no caller can tell
        // from "no such skill". The contract layer refuses the filter by name,
        // so no statement can carry it any more.

        // K08: Use json_build_object to prevent pipe-character splitting corruption
        //
        // M11/T1-R1 2.2 (H5): the same psql invocation also reads the newest
        // READY sync timestamp. `to_char` renders a fixed, parseable UTC shape
        // (Postgres' native timestamptz text carries a "+07"-style offset that
        // JS Date cannot reliably parse), and the marker row is consumed by
        // the freshness gate below before any row is served.
        const sql = `
          SELECT 'ZINK_FRESHNESS|' || COALESCE(
            to_char(max(synced_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            ''
          ) FROM skills.catalog_index WHERE status = 'ACTIVE' AND sync_status = 'READY';
          SELECT json_build_object(
            'skill_id', c.id::text,
            'namespace', array_to_json(c.namespace),
            'capability', c.capability,
            'version', c.version,
            'domain', c.domain,
            'primary_topic', c.primary_topic,
            'subtopic', c.subtopic,
            'content', s.content,
            'score', (1 - (s.embedding <=> '${vectorStr}'::vector))
          )::text AS row_json
          FROM skills.segments s
          JOIN skills.catalog_index c ON s.skill_id = c.id
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY s.embedding <=> '${vectorStr}'::vector ASC, s.segment_ordinal ASC, c.capability ASC
          -- R25: the budget is in SEGMENT rows, so it must be scaled by the
          -- maximum number of segments one skill can contribute, or a few long
          -- skills can consume the whole budget and starve every other skill.
          LIMIT ${boundedLimit * MAX_SEGMENTS_PER_SKILL_VERSION};
        `;

        const queryResult = await executePostgresQuery(sql, this.options);
        const parsedRows = [];
        let freshnessSyncedAt = null;

        if (
          queryResult &&
          typeof queryResult === "string" &&
          queryResult.trim()
        ) {
          const lines = queryResult.trim().split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed.startsWith("ZINK_FRESHNESS|")) {
              const stamp = trimmed.slice("ZINK_FRESHNESS|".length).trim();
              freshnessSyncedAt = stamp.length > 0 ? stamp : null;
              continue;
            }

            // Attempt JSON parsing (K08)
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
              try {
                const obj = JSON.parse(trimmed);
                const scoreNum = Number(obj.score);
                // K10: Score finiteness validation
                if (!Number.isFinite(scoreNum)) {
                  throw new SkillAdapterError(
                    `Invalid similarity score: ${obj.score}`,
                    "SKILL_SCORE_INVALID",
                  );
                }
                let ns = obj.namespace;
                if (typeof ns === "string") {
                  try {
                    ns = JSON.parse(ns);
                  } catch {
                    ns = [ns];
                  }
                }
                parsedRows.push({
                  skill_id: obj.skill_id,
                  namespace: Array.isArray(ns) ? ns : [ns],
                  capability: obj.capability,
                  version: obj.version,
                  domain: obj.domain,
                  primary_topic: obj.primary_topic,
                  subtopic: obj.subtopic || null,
                  content: obj.content,
                  score: scoreNum,
                });
                continue;
              } catch (e) {
                if (e instanceof SkillAdapterError) throw e;
              }
            }

            // Fallback pipe parser for mock db responses
            const parts = line.split("|");
            if (parts.length >= 9) {
              const [
                skillId,
                namespaceJson,
                capability,
                versionStr,
                domain,
                primaryTopic,
                subtopicVal,
                content,
                scoreStr,
              ] = parts;

              const scoreNum = parseFloat(scoreStr);
              if (!Number.isFinite(scoreNum)) {
                throw new SkillAdapterError(
                  `Invalid similarity score: ${scoreStr}`,
                  "SKILL_SCORE_INVALID",
                );
              }

              let parsedNs = [];
              try {
                parsedNs = JSON.parse(namespaceJson);
              } catch {
                parsedNs = [namespaceJson];
              }

              parsedRows.push({
                skill_id: skillId,
                namespace: parsedNs,
                capability,
                version: versionStr,
                domain,
                primary_topic: primaryTopic,
                subtopic: subtopicVal || null,
                content,
                score: scoreNum,
              });
            }
          }
        }

        // M11/T1-R1 (2.2): freshness gate. The ZINK_FRESHNESS marker came from
        // the SAME psql invocation as the rows, so it cannot describe a newer
        // index than the one just read. An absent, empty, or stale stamp means
        // the derived index is not provably current, and serving it would let
        // an agent act on deleted or drifted skill content with no signal —
        // so this fails closed instead of stale-serving.
        const freshness = checkIndexFreshness(freshnessSyncedAt);
        if (!freshness.fresh) {
          throw new SkillAdapterError(
            `SKILL_INDEX_STALE: derived skill index is not fresh (${freshness.reason}); refusing to serve possibly stale rows`,
            "SKILL_INDEX_STALE",
          );
        }

        // K06: Deduplicate multiple segments from the same skill
        const seenSkillIds = new Set();
        const results = [];
        const queryInputHash = computeEmbeddingInputHash(queryTextForEmbedding);

        for (const item of parsedRows) {
          if (seenSkillIds.has(item.skill_id)) continue;
          seenSkillIds.add(item.skill_id);

          // K05: Filter by minimum similarity threshold.
          //
          // R25: the dedup above is correct only because the rows arrive
          // ordered by ascending vector distance, so the first row seen for a
          // skill is that skill's BEST segment. If it were ordered any other
          // way, claiming the skill id before the threshold test would discard
          // a skill on the strength of a weaker segment. Pinned by test.
          if (item.score < minScore) continue;

          // K11: Include embedding model, version, and input hash provenance
          const hitNamespace = Array.isArray(item.namespace)
            ? item.namespace
            : [item.namespace];
          results.push({
            skill_id: item.skill_id,
            // Canonical reuse identity: the search hit alone is a segment
            // excerpt, never the procedure. This id resolves through the
            // canonical read/apply boundary to the exact approved SKILL.md.
            canonical_skill_id: `${hitNamespace.join("/")}/${item.capability}`,
            namespace: item.namespace,
            capability: item.capability,
            version: item.version,
            domain: item.domain,
            primary_topic: item.primary_topic,
            subtopic: item.subtopic,
            content: item.content,
            score: item.score,
            provenance: {
              type: "skill-store",
              namespace: item.namespace,
              capability: item.capability,
              version: item.version,
              sync_status: "READY",
              embedding_model: EXPECTED_MODEL_NAME,
              embedding_version: "1.0.0",
              query_input_hash: queryInputHash,
            },
          });

          if (results.length >= boundedLimit) break;
        }

        // K04: NO_MATCH semantic status for zero results
        const governed_status = results.length === 0 ? "NO_MATCH" : "SUCCESS";

        return {
          action: "search",
          // F-125 (R1-A10-03): the top-level `query` key was outside the
          // declared output object (which closes it), so the search envelope
          // could not pass its own contract. The query text is not part of
          // the answer.
          results,
          total_count: results.length,
          governed_status,
        };
      }

      // =========================================================================
      // Action: propose (K12-K17) — Governed Skill Candidate Proposal
      // =========================================================================
      if (action === "propose") {
        const {
          capability,
          version: skillVersion,
          content,
          reason,
          tags: inputTags,
        } = input;
        // F-010 (R1-A16-08): the proposal's requester identity comes from
        // trusted runtime context only. A model-supplied `requesting_agent` is
        // business metadata and is never read here — the plugin supplies the
        // identity under `requestingAgent` (`index.mjs:3687-3693`). When the
        // trusted context carries none, the field is omitted rather than
        // replaced by a constant such as "specialist" or "unknown".
        const trustedRequestingAgent =
          typeof context?.requestingAgent === "string" &&
          context.requestingAgent.trim()
            ? context.requestingAgent.trim()
            : undefined;

        // NOTE: nonce/expiry are never accepted from model input. Replay
        // boundaries are generated in trusted code below; a model must not
        // decide its own replay window.

        if (!capability || !SLUG_PATTERN.test(capability)) {
          throw new SkillAdapterError(
            `Invalid capability slug: '${capability}'. Must match ^[a-z0-9]+(?:-[a-z0-9]+)*$`,
            "SKILL_SLUG_INVALID",
          );
        }

        if (!skillVersion || !VERSION_PATTERN.test(skillVersion)) {
          throw new SkillAdapterError(
            `Invalid version: '${skillVersion}'. Must follow SemVer (e.g. 1.0.0)`,
            "SKILL_VERSION_INVALID",
          );
        }

        if (!content || typeof content !== "string" || !content.trim()) {
          throw new SkillAdapterError(
            "content is required for skill proposal",
            "SKILL_CONTENT_REQUIRED",
          );
        }

        if (!reason || typeof reason !== "string" || !reason.trim()) {
          throw new SkillAdapterError(
            "reason is required for skill proposal",
            "SKILL_REASON_REQUIRED",
          );
        }

        // K15: Byte ceilings for content (128KB) and reason (4KB)
        const contentBytes = Buffer.byteLength(content, "utf8");
        if (contentBytes > MAX_PROPOSAL_CONTENT_BYTES) {
          throw new SkillAdapterError(
            `Proposal content exceeds maximum ceiling of 128KB (${contentBytes} bytes)`,
            "SKILL_CONTENT_SIZE_EXCEEDED",
          );
        }

        const reasonBytes = Buffer.byteLength(reason, "utf8");
        if (reasonBytes > MAX_PROPOSAL_REASON_BYTES) {
          throw new SkillAdapterError(
            `Proposal reason exceeds maximum ceiling of 4KB (${reasonBytes} bytes)`,
            "SKILL_REASON_SIZE_EXCEEDED",
          );
        }

        const rawContent = content.trim();
        const content_sha256 = createHash("sha256")
          .update(rawContent, "utf8")
          .digest("hex");

        const parsedNamespace = Array.isArray(namespace)
          ? namespace
          : typeof namespace === "string" && namespace.trim()
            ? [namespace.trim()]
            : ["specialist"];

        // K12: Namespace taxonomy validation against vetted catalog
        const rootNs = parsedNamespace[0];
        if (!VETTED_ROOT_NAMESPACES.has(rootNs)) {
          throw new SkillAdapterError(
            `Namespace '${rootNs}' is not vetted in namespace governance catalog`,
            "SKILL_NAMESPACE_INVALID",
          );
        }

        // K16: Canonical semantic taxonomy validation
        const semanticMeta = deriveSemanticMetadata({
          namespace: parsedNamespace,
          capability,
          tags: inputTags,
        });

        if (!semanticMeta || !CANONICAL_DOMAINS.includes(semanticMeta.domain)) {
          throw new SkillAdapterError(
            `Proposal violates canonical semantic taxonomy (invalid domain '${semanticMeta?.domain}')`,
            "SKILL_TAXONOMY_INVALID",
          );
        }

        // K14: trusted replay boundary. Expiry and nonce are generated here,
        // never taken from model input.
        const nonce = randomBytes(8).toString("hex");
        const expires_at = new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        const proposal_token = createHash("sha256")
          .update(
            `${parsedNamespace.join("/")}:${capability}:${skillVersion}:${content_sha256}:${nonce}:${expires_at}`,
          )
          .digest("hex");

        // K17: proposal identity is deterministic over skill identity plus
        // exact content bytes, so an identical repeat proposal is the same
        // proposal rather than a duplicate.
        const proposal_id = deriveProposalId({
          namespace: parsedNamespace,
          capability,
          version: skillVersion,
          content_sha256,
        });

        const proposal = {
          proposal_id,
          proposal_token,
          nonce,
          expires_at,
          namespace: parsedNamespace,
          capability,
          version: skillVersion,
          domain: semanticMeta.domain,
          primary_topic: semanticMeta.primary_topic,
          content_sha256,
          // The exact bytes the owner will approve. The durable proposal is
          // the authority for what materialization may write.
          content: rawContent,
          // F-010: only ever the trusted requester, never the payload's claim;
          // the key is omitted — not defaulted to a constant — when the trusted
          // context carries no identity.
          ...(trustedRequestingAgent
            ? { requesting_agent: trustedRequestingAgent }
            : {}),
          reason: reason.trim(),
          status: "CANDIDATE",
          created_at: new Date().toISOString(),
        };

        // Proposal persistence is part of the governed transaction and is
        // atomic: temp file, fsync, rename. An identical live CANDIDATE is
        // returned as-is so repeats keep one stable identity.
        const proposalsDir = this.options.proposalStorageDir;
        if (!proposalsDir || typeof proposalsDir !== "string") {
          throw new SkillAdapterError(
            "A governed proposal storage directory is required",
            "SKILL_PROPOSAL_PERSIST_FAILED",
          );
        }
        try {
          // M11/T3 B6: the read, the decision and the write are one unit under
          // the canonical Skill Store writer lock — the same lock promotion and
          // rejection already take. Unguarded, a propose could read a still
          // undecided record and then write over a rejection committing in
          // another process, erasing the owner's decision.
          const alreadyDecided = await withSkillStoreWriterLock(
            this.skillsRoot,
            () => {
              const proposalPath = path.join(
                proposalsDir,
                `${proposal_id}.json`,
              );
              const existing = readProposalRecordSync(proposalPath);
              const sameBytes =
                existing?.proposal_id === proposal_id &&
                existing?.content_sha256 === content_sha256 &&
                typeof existing?.content === "string";
              if (
                sameBytes &&
                existing?.status === "CANDIDATE" &&
                typeof existing?.expires_at === "string" &&
                Date.parse(existing.expires_at) > Date.now()
              ) {
                return {
                  action: "propose",
                  proposal: existing,
                  governed_status: "SUCCESS",
                };
              }
              if (
                sameBytes &&
                (existing?.status === "APPROVED" ||
                  existing?.status === "MATERIALIZED" ||
                  existing?.status === "READY" ||
                  existing?.status === "INDEX_FAILED" ||
                  // M11/T3 B6: a rejection is as terminal as an approval. It was
                  // missing here, so re-proposing the identical bytes fell
                  // through to the atomic write below and silently erased the
                  // owner's rejection.
                  existing?.status === "REJECTED")
              ) {
                // Already decided past candidacy: never regress the durable
                // record back to CANDIDATE.
                return {
                  action: "propose",
                  proposal: existing,
                  governed_status: "SUCCESS",
                };
              }
              writeJsonAtomicSync(proposalPath, proposal);
              return null;
            },
          );
          if (alreadyDecided) return alreadyDecided;
        } catch (error) {
          if (error instanceof SkillAdapterError) throw error;
          throw new SkillAdapterError(
            `Skill proposal persistence failed: ${error?.message}`,
            "SKILL_PROPOSAL_PERSIST_FAILED",
          );
        }

        if (typeof this.options.onProposal === "function") {
          await this.options.onProposal(proposal);
        }

        return {
          action: "propose",
          proposal,
          governed_status: "SUCCESS",
        };
      }

      throw new SkillAdapterError(
        `Unsupported action: ${action}`,
        "SKILL_ACTION_INVALID",
      );
    } catch (error) {
      if (error instanceof SkillAdapterError) throw error;
      return {
        action,
        skills: [],
        results: [],
        governed_status: "CONTROLLED_FAILURE",
        error: error.code || "SKILL_ADAPTER_ERROR",
        message: error.message,
      };
    }
  }
}

export const defaultSkillAdapter = new SkillAdapter();

export async function executeGovernedSkillQuery(input, context, options) {
  const adapter = options
    ? new SkillAdapter(undefined, options)
    : defaultSkillAdapter;
  return adapter.querySkillStore(input, context);
}
