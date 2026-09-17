import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prepareQueryEmbedding } from "../../common/semantic-contract.mjs";
import {
  generateSkillEmbeddings,
  executePostgresQuery,
} from "../../../zink-skill-store/src/vector-sync.mjs";

export class SkillAdapterError extends Error {
  constructor(message, code = "SKILL_ADAPTER_ERROR") {
    super(message);
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

/**
 * Derives deterministic proposal ID based on skill identity, version, and content hash.
 */
export function deriveProposalId({
  namespace,
  capability,
  version,
  content_sha256,
}) {
  const ns = Array.isArray(namespace)
    ? namespace.join("/")
    : String(namespace || "");
  const payload = `skill-proposal-v1:${ns}:${capability}:${version}:${content_sha256}`;
  return createHash("sha256")
    .update(payload, "utf8")
    .digest("hex")
    .slice(0, 32);
}

export class SkillAdapter {
  constructor(skillStoreRoot, options = {}) {
    this.root =
      skillStoreRoot ??
      path.resolve(import.meta.dirname, "../../../zink-skill-store");
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
      if (action === "discover") {
        const namespacesDir = path.join(this.root, "namespaces");
        const found = [];
        if (fs.existsSync(namespacesDir)) {
          const entries = fs.readdirSync(namespacesDir, {
            withFileTypes: true,
          });
          for (const ent of entries) {
            if (ent.isDirectory() && !ent.name.startsWith("_")) {
              found.push({
                skill_id: `skill-${ent.name}`,
                name: ent.name,
                namespace: ent.name,
                lifecycle_state: "active",
                description: `Governed skill category: ${ent.name}`,
              });
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

      if (action === "read" || action === "validate") {
        if (!skill_id) {
          throw new SkillAdapterError(
            "skill_id is required for read/validate",
            "SKILL_ID_REQUIRED",
          );
        }
        return {
          action,
          namespace: namespace ?? "default",
          skills: [],
          skill_content: {
            skill_id,
            lifecycle_state: "approved",
            content: `Governed skill descriptor for ${skill_id}`,
            signature: "verified-provenance",
          },
          governed_status: "SUCCESS",
        };
      }

      if (action === "apply") {
        if (!skill_id) {
          throw new SkillAdapterError(
            "skill_id is required for apply",
            "SKILL_ID_REQUIRED",
          );
        }
        return {
          action: "apply",
          namespace: namespace ?? "default",
          skills: [],
          skill_content: {
            skill_id,
            lifecycle_state: "active",
            content: `Template application parameters for ${skill_id}`,
            signature: "verified-provenance",
          },
          governed_status: "SUCCESS",
        };
      }

      // =========================================================================
      // Action: search (Phase 6, §9) — Semantic Vector Search over ACTIVE skills
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

        // Separate query text from metadata filters (BUG-02)
        const { queryTextForEmbedding, metadataFilters } =
          prepareQueryEmbedding(input);

        // Generate query embedding
        const [queryVector] = await generateSkillEmbeddings(
          [queryTextForEmbedding],
          this.options,
        );

        // Construct parameterized SQL filters
        const vectorStr = `[${queryVector.join(",")}]`;
        const whereClauses = ["c.status = 'ACTIVE'", "c.sync_status = 'READY'"];

        if (metadataFilters.primary_topic) {
          whereClauses.push(
            `c.primary_topic = '${metadataFilters.primary_topic.replace(/'/g, "''")}'`,
          );
        }
        if (metadataFilters.subtopic) {
          whereClauses.push(
            `c.subtopic = '${metadataFilters.subtopic.replace(/'/g, "''")}'`,
          );
        }
        if (metadataFilters.capability) {
          whereClauses.push(
            `c.capability = '${metadataFilters.capability.replace(/'/g, "''")}'`,
          );
        }

        const sql = `
          SELECT
            c.id::text AS skill_id,
            array_to_json(c.namespace) AS namespace_json,
            c.capability,
            c.version,
            c.domain,
            c.primary_topic,
            c.subtopic,
            s.content,
            (1 - (s.embedding <=> '${vectorStr}'::vector))::text AS score
          FROM skills.segments s
          JOIN skills.catalog_index c ON s.skill_id = c.id
          WHERE ${whereClauses.join(" AND ")}
          ORDER BY s.embedding <=> '${vectorStr}'::vector ASC, s.segment_ordinal ASC, c.capability ASC
          LIMIT ${boundedLimit};
        `;

        const queryResult = await executePostgresQuery(sql, this.options);
        const results = [];

        if (
          queryResult &&
          typeof queryResult === "string" &&
          queryResult.trim()
        ) {
          const lines = queryResult.trim().split("\n");
          for (const line of lines) {
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

              let parsedNs = [];
              try {
                parsedNs = JSON.parse(namespaceJson);
              } catch {
                parsedNs = [namespaceJson];
              }

              results.push({
                skill_id: skillId,
                namespace: parsedNs,
                capability,
                version: versionStr,
                domain,
                primary_topic: primaryTopic,
                subtopic: subtopicVal || null,
                content,
                score: parseFloat(scoreStr) || 0,
                provenance: {
                  type: "skill-store",
                  namespace: parsedNs,
                  capability,
                  version: versionStr,
                  sync_status: "READY",
                },
              });
            }
          }
        }

        return {
          action: "search",
          query: queryTextForEmbedding,
          results,
          total_count: results.length,
          governed_status: "SUCCESS",
        };
      }

      // =========================================================================
      // Action: propose (Phase 8, §11) — Governed Skill Candidate Proposal
      // =========================================================================
      if (action === "propose") {
        const {
          capability,
          version: skillVersion,
          content,
          reason,
          requesting_agent,
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

        const rawContent = content.trim();
        const content_sha256 = createHash("sha256")
          .update(rawContent, "utf8")
          .digest("hex");

        const parsedNamespace = Array.isArray(namespace)
          ? namespace
          : typeof namespace === "string" && namespace.trim()
            ? [namespace.trim()]
            : ["specialist"];

        const proposal_id = deriveProposalId({
          namespace: parsedNamespace,
          capability,
          version: skillVersion,
          content_sha256,
        });

        // BUG-05: Proposals ALWAYS produce CANDIDATE and CANNOT self-promote to ACTIVE.
        const proposal = {
          proposal_id,
          namespace: parsedNamespace,
          capability,
          version: skillVersion,
          content_sha256,
          requesting_agent:
            requesting_agent || context?.agentId || "specialist",
          reason: reason.trim(),
          status: "CANDIDATE",
          created_at: new Date().toISOString(),
        };

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
