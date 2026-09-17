import { createHash } from "node:crypto";

/**
 * Canonical domain definitions for Zink Knowledgebase and Skill Store.
 */
export const CANONICAL_DOMAINS = Object.freeze([
  "office",
  "data",
  "engineering",
  "governance",
  "general",
]);

/**
 * Pinned taxonomy mapping for well-known skill and knowledge namespaces.
 * Fallbacks are strict and deterministic to prevent topic hallucination (BUG-11).
 */
export const KNOWN_TAXONOMY_MAP = Object.freeze({
  excel: {
    domain: "office",
    primary_topic: "spreadsheet",
    subtopic: "formulas-and-automation",
  },
  "power-bi": {
    domain: "data",
    primary_topic: "business-intelligence",
    subtopic: "dax-and-modeling",
  },
  sql: {
    domain: "data",
    primary_topic: "database-query",
    subtopic: "relational-analytics",
  },
  python: {
    domain: "engineering",
    primary_topic: "data-engineering",
    subtopic: "scripting-and-analysis",
  },
  governance: {
    domain: "governance",
    primary_topic: "runtime-policy",
    subtopic: "lifecycle-and-approvals",
  },
});

/**
 * Derives deterministic semantic metadata from skill/document descriptors without hallucination.
 *
 * @param {object} input
 * @param {string[]|string} [input.namespace]
 * @param {string} [input.capability]
 * @param {string} [input.title]
 * @param {string[]} [input.tags]
 * @returns {object} validated semantic metadata
 */
export function deriveSemanticMetadata(input = {}) {
  const nsList = Array.isArray(input.namespace)
    ? input.namespace
    : typeof input.namespace === "string"
      ? [input.namespace]
      : [];
  const primaryNamespace = nsList[0]?.toLowerCase() ?? "general";
  const capability = input.capability?.toLowerCase() ?? "";

  const known = KNOWN_TAXONOMY_MAP[primaryNamespace];
  let domain = "general";
  let primary_topic = primaryNamespace;
  let subtopic = null;

  if (known) {
    domain = known.domain;
    primary_topic = known.primary_topic;
    subtopic = known.subtopic;
  } else if (CANONICAL_DOMAINS.includes(primaryNamespace)) {
    domain = primaryNamespace;
  }

  const secondary_topics = Array.isArray(input.tags)
    ? input.tags
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase())
        .slice(0, 5)
    : [];

  const concept = capability ? capability.replace(/-/g, " ") : null;

  return {
    domain,
    primary_topic,
    subtopic,
    concept,
    secondary_topics,
  };
}

/**
 * Renders the deterministic semantic envelope string.
 *
 * IMPORTANT (BUG-01): This string is strictly used as an INPUT to the embedding
 * generator (Ollama bge-m3) and MUST NEVER overwrite stored passage text, FTS text,
 * or citation source.
 *
 * @param {object} params
 * @param {string} params.domain
 * @param {string} params.primary_topic
 * @param {string} [params.subtopic]
 * @param {string} [params.concept]
 * @param {string[]} [params.secondary_topics]
 * @param {string} params.content
 * @returns {string} rendered envelope text
 */
export function renderEmbeddingEnvelope(params = {}) {
  const {
    domain = "general",
    primary_topic = "general",
    subtopic = null,
    concept = null,
    secondary_topics = [],
    content = "",
  } = params;

  const headerLines = [`Domain: ${domain}`, `Primary Topic: ${primary_topic}`];

  if (subtopic && typeof subtopic === "string" && subtopic.trim()) {
    headerLines.push(`Subtopic: ${subtopic.trim()}`);
  }

  if (concept && typeof concept === "string" && concept.trim()) {
    headerLines.push(`Concept: ${concept.trim()}`);
  }

  if (Array.isArray(secondary_topics) && secondary_topics.length > 0) {
    headerLines.push(`Secondary Topics: ${secondary_topics.join(", ")}`);
  }

  return `${headerLines.join("\n")}\n\n${content.trim()}`;
}

/**
 * Computes deterministic SHA-256 hash of an embedding envelope or content.
 *
 * @param {string} text
 * @returns {string} 64-character lowercase hex digest
 */
export function computeEmbeddingInputHash(text) {
  if (typeof text !== "string") {
    throw new TypeError("text must be a string");
  }
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Prepares query embedding input and validates metadata filters.
 *
 * IMPORTANT (BUG-02): Query embedding MUST use query text only.
 * Metadata filters (primary_topic, subtopic, etc.) MUST NOT be concatenated
 * into the query text for embedding, to prevent vector contamination.
 *
 * @param {object} params
 * @param {string} params.query
 * @param {string} [params.primary_topic]
 * @param {string} [params.subtopic]
 * @param {string[]} [params.secondary_topics]
 * @param {string} [params.capability]
 * @returns {{ queryTextForEmbedding: string, metadataFilters: object }}
 */
export function prepareQueryEmbedding(params = {}) {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    throw new Error("QUERY_REQUIRED");
  }

  const metadataFilters = {};
  if (params.primary_topic && typeof params.primary_topic === "string") {
    metadataFilters.primary_topic = params.primary_topic.trim();
  }
  if (params.subtopic && typeof params.subtopic === "string") {
    metadataFilters.subtopic = params.subtopic.trim();
  }
  if (
    Array.isArray(params.secondary_topics) &&
    params.secondary_topics.length > 0
  ) {
    metadataFilters.secondary_topics = params.secondary_topics;
  }
  if (params.capability && typeof params.capability === "string") {
    metadataFilters.capability = params.capability.trim();
  }

  return {
    queryTextForEmbedding: query,
    metadataFilters,
  };
}
