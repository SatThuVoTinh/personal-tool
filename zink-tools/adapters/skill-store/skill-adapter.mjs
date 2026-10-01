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
} from "../../common/semantic-contract.mjs";
import {
  generateSkillEmbeddings,
  executePostgresQuery,
  EXPECTED_MODEL_NAME,
  toPostgresArrayLiteral,
  escapeSqlLiteral,
} from "../../../zink-skill-store/src/vector-sync.mjs";
import { scanCatalog } from "../../../zink-skill-store/src/catalog.mjs";

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

function findSkillRecordOnDisk(skillsDir, targetSkillId) {
  if (!fs.existsSync(skillsDir)) return null;
  const targetSlug = targetSkillId.split("/").pop();

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const full = path.join(dir, ent.name);
        const manifestPath = path.join(full, "manifest.json");
        const skillMdPath = path.join(full, "SKILL.md");
        if (fs.existsSync(manifestPath) && fs.existsSync(skillMdPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
            const idInfo = manifest.identity || {};
            const cap = idInfo.capability || ent.name;
            const ns = Array.isArray(idInfo.namespace)
              ? idInfo.namespace.join("/")
              : String(idInfo.namespace || "");
            const fullId = `${ns}/${cap}`;
            if (
              fullId === targetSkillId ||
              cap === targetSkillId ||
              fullId.endsWith(targetSkillId) ||
              cap === targetSlug
            ) {
              return { dir: full, manifest, skillMdPath };
            }
          } catch {}
        }
        const sub = walk(full);
        if (sub) return sub;
      }
    }
    return null;
  }
  return walk(skillsDir);
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
    const { action, namespace, skill_id, version } = input;

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

        if (fs.existsSync(skillsDir)) {
          let catalog = null;
          try {
            catalog = await scanCatalog(skillsDir);
          } catch {}

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
                description:
                  rec.manifest?.metadata?.description ||
                  `Governed skill: ${idInfo.capability}`,
              });
            }
          } else {
            // Direct disk walk when scanCatalog has partial diagnostics or errors
            function walkActive(dir) {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const ent of entries) {
                if (ent.isDirectory()) {
                  const full = path.join(dir, ent.name);
                  const manifestPath = path.join(full, "manifest.json");
                  const skillMdPath = path.join(full, "SKILL.md");
                  if (
                    fs.existsSync(manifestPath) &&
                    fs.existsSync(skillMdPath)
                  ) {
                    try {
                      const manifest = JSON.parse(
                        fs.readFileSync(manifestPath, "utf8"),
                      );
                      const lifecycle = manifest.lifecycle;
                      const isActive =
                        Array.isArray(lifecycle) &&
                        lifecycle.at(-1)?.status === "ACTIVE";
                      if (isActive) {
                        const idInfo = manifest.identity || {};
                        const nsArr = Array.isArray(idInfo.namespace)
                          ? idInfo.namespace
                          : [idInfo.namespace];
                        const nsStr = nsArr.join("/");

                        if (
                          !namespace ||
                          namespace === "all" ||
                          nsStr === namespace ||
                          nsArr.includes(namespace)
                        ) {
                          found.push({
                            skill_id: `${nsStr}/${idInfo.capability}`,
                            name: idInfo.capability,
                            namespace: nsArr,
                            capability: idInfo.capability,
                            version: idInfo.version,
                            lifecycle_state: "ACTIVE",
                            description:
                              manifest.metadata?.description ||
                              `Governed skill: ${idInfo.capability}`,
                          });
                        }
                      }
                    } catch {}
                  } else {
                    walkActive(full);
                  }
                }
              }
            }
            walkActive(skillsDir);
          }
        }

        // Fallback: check namespaces directory if skillsDir is empty
        if (found.length === 0) {
          const namespacesDir = path.join(this.root, "namespaces");
          if (fs.existsSync(namespacesDir)) {
            const entries = fs.readdirSync(namespacesDir, {
              withFileTypes: true,
            });
            for (const ent of entries) {
              if (ent.isDirectory() && !ent.name.startsWith("_")) {
                const manifestPath = path.join(
                  namespacesDir,
                  ent.name,
                  "manifest.json",
                );
                let isActive = true;
                let desc = `Governed skill category: ${ent.name}`;
                if (fs.existsSync(manifestPath)) {
                  try {
                    const mf = JSON.parse(
                      fs.readFileSync(manifestPath, "utf8"),
                    );
                    isActive =
                      mf.lifecycle?.at(-1)?.status === "ACTIVE" ||
                      mf.status === "ACTIVE";
                    desc = mf.description || desc;
                  } catch {
                    isActive = false;
                  }
                }
                if (isActive) {
                  found.push({
                    skill_id: `skill-${ent.name}`,
                    name: ent.name,
                    namespace: ent.name,
                    lifecycle_state: "active",
                    description: desc,
                  });
                }
              }
            }
          }
        }

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
        const record = findSkillRecordOnDisk(this.skillsRoot, skill_id);

        if (record) {
          const content = fs.readFileSync(record.skillMdPath, "utf8");
          const currentHash = createHash("sha256")
            .update(content, "utf8")
            .digest("hex");
          const recordedHash =
            record.manifest?.content?.sha256 ||
            record.manifest?.verification?.content_sha256;

          if (
            action === "validate" &&
            recordedHash &&
            currentHash !== recordedHash
          ) {
            throw new SkillAdapterError(
              `SOURCE_DRIFT_DETECTED: content hash ${currentHash} does not match manifest ${recordedHash}`,
              "SKILL_SOURCE_DRIFT",
            );
          }

          const lifecycle = record.manifest?.lifecycle;
          const lifecycleState = Array.isArray(lifecycle)
            ? lifecycle.at(-1)?.status
            : "active";

          storedSkill = {
            skill_id,
            lifecycle_state: lifecycleState,
            content,
            signature:
              record.manifest?.verification?.signature || "verified-provenance",
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
        const record = findSkillRecordOnDisk(this.skillsRoot, skill_id);

        if (record) {
          const lifecycle = record.manifest?.lifecycle;
          const status = Array.isArray(lifecycle)
            ? lifecycle.at(-1)?.status
            : null;
          if (status !== "ACTIVE") {
            throw new SkillAdapterError(
              `Skill ${skill_id} is in status ${status}, must be ACTIVE to apply`,
              "SKILL_NOT_ACTIVE",
            );
          }
          const content = fs.readFileSync(record.skillMdPath, "utf8");

          storedSkill = {
            skill_id,
            lifecycle_state: "active",
            content,
            signature:
              record.manifest?.verification?.signature || "verified-provenance",
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
            : (this.options.minScore ?? 0.3); // K05: minimum similarity threshold

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

        // K09: both namespace and secondary_topics applied in SQL
        const targetNs = metadataFilters.namespace || input.namespace;
        if (targetNs && targetNs !== "all") {
          const nsList = Array.isArray(targetNs) ? targetNs : [targetNs];
          whereClauses.push(
            `c.namespace @> ${toPostgresArrayLiteral(nsList)}::text[]`,
          );
        }

        const targetSecTopics =
          metadataFilters.secondary_topics || input.secondary_topics;
        if (Array.isArray(targetSecTopics) && targetSecTopics.length > 0) {
          whereClauses.push(
            `c.secondary_topics && ${toPostgresArrayLiteral(targetSecTopics)}::text[]`,
          );
        }

        // K08: Use json_build_object to prevent pipe-character splitting corruption
        const sql = `
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
          LIMIT ${boundedLimit * 4};
        `;

        const queryResult = await executePostgresQuery(sql, this.options);
        const parsedRows = [];

        if (
          queryResult &&
          typeof queryResult === "string" &&
          queryResult.trim()
        ) {
          const lines = queryResult.trim().split("\n");
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

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

        // K06: Deduplicate multiple segments from the same skill
        const seenSkillIds = new Set();
        const results = [];
        const queryInputHash = computeEmbeddingInputHash(queryTextForEmbedding);

        for (const item of parsedRows) {
          if (seenSkillIds.has(item.skill_id)) continue;
          seenSkillIds.add(item.skill_id);

          // K05: Filter by minimum similarity threshold
          if (item.score < minScore) continue;

          // K11: Include embedding model, version, and input hash provenance
          results.push({
            skill_id: item.skill_id,
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
          query: queryTextForEmbedding,
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
          requesting_agent,
          nonce: inputNonce,
          expires_at: inputExpiresAt,
          tags: inputTags,
        } = input;

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

        // K14: Expiry, nonce, and proposal replay token
        const nonce = inputNonce || null;
        const expires_at =
          inputExpiresAt ||
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const proposal_token = createHash("sha256")
          .update(
            `${parsedNamespace.join("/")}:${capability}:${skillVersion}:${content_sha256}:${nonce || "none"}:${expires_at}`,
          )
          .digest("hex");

        // K17: Proposal ID with nonce support to avoid collapsing independent proposals
        const proposal_id = deriveProposalId({
          namespace: parsedNamespace,
          capability,
          version: skillVersion,
          content_sha256,
          nonce,
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
          requesting_agent:
            requesting_agent || context?.agentId || "specialist",
          reason: reason.trim(),
          status: "CANDIDATE",
          created_at: new Date().toISOString(),
        };

        // Proposal persistence is part of the governed transaction.
        const proposalsDir = this.options.proposalStorageDir;
        if (!proposalsDir || typeof proposalsDir !== "string") {
          throw new SkillAdapterError(
            "A governed proposal storage directory is required",
            "SKILL_PROPOSAL_PERSIST_FAILED",
          );
        }
        try {
          fs.mkdirSync(proposalsDir, { recursive: true });
          fs.writeFileSync(
            path.join(proposalsDir, `${proposal_id}.json`),
            JSON.stringify(proposal, null, 2),
            "utf8",
          );
        } catch (error) {
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
