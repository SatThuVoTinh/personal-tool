import { createHash } from "node:crypto";

// ─── Contract version ────────────────────────────────────────────────────────
// B11: embedding envelope must carry a versioned semantic-contract id.
export const SEMANTIC_CONTRACT_VERSION = "zink-semantic-v2";

// ─── Canonical domain list ────────────────────────────────────────────────────
// B01: expand to cover all namespaces used by KB/policy/tools.
export const CANONICAL_DOMAINS = Object.freeze([
  "office",
  "data",
  "engineering",
  "governance",
  "lscm",          // supply-chain / logistics / LSCM
  "analytics",     // BI / reporting / KPI
  "optimization",  // OR / forecasting / simulation
  "research",      // KB ingestion / literature
  "general",
]);

// ─── Alias registry (B22) ─────────────────────────────────────────────────────
// Maps lowercase surface aliases → canonical namespace slug.
// All values MUST appear in KNOWN_TAXONOMY_MAP.
export const NAMESPACE_ALIAS_MAP = Object.freeze({
  // supply-chain family
  "supply-chain": "lscm",
  "sc/logistics": "lscm",
  "sc-logistics": "lscm",
  "logistics": "lscm",
  "lsc": "lscm",
  "supply_chain": "lscm",
  // analytics / BI family
  "bi": "power-bi",
  "powerbi": "power-bi",
  "power_bi": "power-bi",
  "business-intelligence": "power-bi",
  // OR / optimization family
  "or": "optimization",
  "operations-research": "optimization",
  "simulation": "optimization",
  "forecasting": "optimization",
  // python / scripting aliases
  "scripting": "python",
  "data-engineering": "python",
  // research / KB aliases
  "kb": "knowledge",
  "knowledge-base": "knowledge",
  "research": "knowledge",
  "literature": "knowledge",
  // sql aliases
  "database": "sql",
  "relational": "sql",
});

// ─── Taxonomy map (B02/B03/B21) ───────────────────────────────────────────────
// Expanded to cover all namespaces referenced by KB/policy/tools.
// B03: power-bi domain corrected to "analytics".
// B21: LSCM domain corrected from "office" → "lscm".
export const KNOWN_TAXONOMY_MAP = Object.freeze({
  excel: Object.freeze({
    domain: "office",
    primary_topic: "spreadsheet",
    subtopic: "formulas-and-automation",
  }),
  "power-bi": Object.freeze({
    domain: "analytics",
    primary_topic: "business-intelligence",
    subtopic: "dax-and-modeling",
  }),
  sql: Object.freeze({
    domain: "data",
    primary_topic: "database-query",
    subtopic: "relational-analytics",
  }),
  python: Object.freeze({
    domain: "engineering",
    primary_topic: "data-engineering",
    subtopic: "scripting-and-analysis",
  }),
  governance: Object.freeze({
    domain: "governance",
    primary_topic: "runtime-policy",
    subtopic: "lifecycle-and-approvals",
  }),
  // B01/B02: new namespaces
  lscm: Object.freeze({
    domain: "lscm",
    primary_topic: "supply-chain",
    subtopic: "logistics-and-operations",
  }),
  optimization: Object.freeze({
    domain: "optimization",
    primary_topic: "operations-research",
    subtopic: "linear-programming-and-simulation",
  }),
  knowledge: Object.freeze({
    domain: "research",
    primary_topic: "kb-ingestion",
    subtopic: "literature-and-provenance",
  }),
  parquet: Object.freeze({
    domain: "data",
    primary_topic: "columnar-format",
    subtopic: "big-data-storage",
  }),
  json: Object.freeze({
    domain: "engineering",
    primary_topic: "data-serialization",
    subtopic: "api-and-config",
  }),
  pdf: Object.freeze({
    domain: "office",
    primary_topic: "document",
    subtopic: "report-and-archive",
  }),
  docx: Object.freeze({
    domain: "office",
    primary_topic: "document",
    subtopic: "word-processing",
  }),
  csv: Object.freeze({
    domain: "data",
    primary_topic: "tabular-data",
    subtopic: "flat-file-exchange",
  }),
  business: Object.freeze({
    domain: "office",
    primary_topic: "business-operations",
    subtopic: "pricing-and-strategy",
  }),
  data: Object.freeze({
    domain: "data",
    primary_topic: "data-management",
    subtopic: "etl-and-quality",
  }),
  automation: Object.freeze({
    domain: "engineering",
    primary_topic: "process-automation",
    subtopic: "workflow-and-scripts",
  }),
  research: Object.freeze({
    domain: "research",
    primary_topic: "domain-research",
    subtopic: "literature-and-notes",
  }),
  system: Object.freeze({
    domain: "governance",
    primary_topic: "system-control",
    subtopic: "infrastructure-and-config",
  }),
});

// ─── Internal helpers ─────────────────────────────────────────────────────────
// B06: capability slug validation
const CAPABILITY_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
function validateCapabilitySlug(capability) {
  if (!capability) return true;
  return CAPABILITY_SLUG_RE.test(capability);
}

// B09/B12: byte-length helpers
const MAX_SECONDARY_TOPIC_BYTES = 128;
const MAX_EMBEDDING_INPUT_BYTES = 32_768; // 32 KiB hard ceiling
function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

// B05/B22: namespace resolution — fail-closed for unknown namespaces
function resolveNamespace(raw) {
  const ns = raw?.toLowerCase() ?? "";
  if (!ns) return { resolved: null, ambiguous: true };
  if (KNOWN_TAXONOMY_MAP[ns]) return { resolved: ns, ambiguous: false };
  const aliased = NAMESPACE_ALIAS_MAP[ns];
  if (aliased && KNOWN_TAXONOMY_MAP[aliased]) return { resolved: aliased, ambiguous: false };
  if (CANONICAL_DOMAINS.includes(ns)) return { resolved: ns, ambiguous: false };
  return { resolved: null, ambiguous: true };
}

/**
 * Derives deterministic semantic metadata from skill/document descriptors.
 * B04/B05: multi-namespace support — resolve each, expose ambiguity.
 * B06: validate capability slug.
 * B07/B08/B09: secondary_topics — canonicalize, deduplicate, byte-limit each item.
 *
 * @param {object} input
 * @param {string[]|string} [input.namespace]
 * @param {string} [input.capability]
 * @param {string} [input.title]
 * @param {string[]} [input.tags]
 * @returns {{ domain, primary_topic, subtopic, concept, secondary_topics,
 *             ambiguous, unresolved_namespaces, resolved_namespaces }}
 */
export function deriveSemanticMetadata(input = {}) {
  const nsList = Array.isArray(input.namespace)
    ? input.namespace
    : typeof input.namespace === "string"
      ? [input.namespace]
      : [];

  // B04/B05: resolve each namespace; accumulate unresolved
  const resolvedNamespaces = [];
  const unresolvedNamespaces = [];
  for (const raw of nsList) {
    const { resolved, ambiguous } = resolveNamespace(raw);
    if (ambiguous || resolved === null) {
      unresolvedNamespaces.push(raw?.toLowerCase() ?? "");
    } else {
      resolvedNamespaces.push(resolved);
    }
  }

  // B05: fail-closed — if no namespace resolved, signal AMBIGUOUS
  const ambiguous = resolvedNamespaces.length === 0 && nsList.length > 0;
  const primaryNamespace = resolvedNamespaces[0] ?? null;

  let domain = ambiguous ? "AMBIGUOUS" : "general";
  let primary_topic = ambiguous ? "AMBIGUOUS" : (primaryNamespace ?? "general");
  let subtopic = null;

  if (!ambiguous && primaryNamespace) {
    const known = KNOWN_TAXONOMY_MAP[primaryNamespace];
    if (known) {
      domain = known.domain;
      primary_topic = known.primary_topic;
      subtopic = known.subtopic;
    } else if (CANONICAL_DOMAINS.includes(primaryNamespace)) {
      domain = primaryNamespace;
    }
  }

  // B06: validate capability slug
  const rawCapability = input.capability?.toLowerCase() ?? "";
  if (rawCapability && !validateCapabilitySlug(rawCapability)) {
    throw new Error(
      `INVALID_CAPABILITY_SLUG: "${rawCapability}" must be kebab-case [a-z0-9-]`
    );
  }

  // B07/B08/B09: secondary_topics — canonicalize, deduplicate, byte-limit
  const seenTopics = new Set();
  const secondary_topics = [];
  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  for (const t of rawTags) {
    if (typeof t !== "string") continue;
    const canonical = t.trim().toLowerCase();
    if (!canonical) continue;
    if (byteLength(canonical) > MAX_SECONDARY_TOPIC_BYTES) continue; // B09
    if (seenTopics.has(canonical)) continue; // B08
    seenTopics.add(canonical);
    secondary_topics.push(canonical);
    if (secondary_topics.length >= 10) break;
  }

  const concept = rawCapability ? rawCapability.replace(/-/g, " ") : null;

  return {
    domain,
    primary_topic,
    subtopic,
    concept,
    secondary_topics,
    ambiguous,
    unresolved_namespaces: unresolvedNamespaces,
    resolved_namespaces: resolvedNamespaces,
  };
}

/**
 * Renders the deterministic semantic envelope string.
 * B10: sanitize metadata values to prevent newline/CR header injection.
 * B11: embed versioned semantic-contract id.
 * B12: enforce max byte ceiling on output.
 *
 * IMPORTANT: This string is strictly used as INPUT to the embedding generator
 * and MUST NEVER overwrite stored passage text, FTS text, or citation source.
 *
 * @param {object} params
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

  // B10: strip newlines/CR from metadata values
  const sanitize = (v) =>
    typeof v === "string" ? v.replace(/[\r\n]+/gu, " ").trim() : "";

  const headerLines = [
    `Semantic-Contract: ${SEMANTIC_CONTRACT_VERSION}`, // B11
    `Domain: ${sanitize(domain)}`,
    `Primary Topic: ${sanitize(primary_topic)}`,
  ];

  if (subtopic && typeof subtopic === "string" && subtopic.trim()) {
    headerLines.push(`Subtopic: ${sanitize(subtopic)}`);
  }
  if (concept && typeof concept === "string" && concept.trim()) {
    headerLines.push(`Concept: ${sanitize(concept)}`);
  }
  if (Array.isArray(secondary_topics) && secondary_topics.length > 0) {
    const sanitizedTopics = secondary_topics.map(sanitize).filter(Boolean);
    if (sanitizedTopics.length > 0) {
      headerLines.push(`Secondary Topics: ${sanitizedTopics.join(", ")}`);
    }
  }

  const rendered = `${headerLines.join("\n")}\n\n${content.trim()}`;

  // B12: enforce max byte bound
  if (byteLength(rendered) > MAX_EMBEDDING_INPUT_BYTES) {
    throw new Error(
      `EMBEDDING_INPUT_TOO_LARGE: rendered envelope exceeds ${MAX_EMBEDDING_INPUT_BYTES} bytes`
    );
  }

  return rendered;
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
 * B13: canonicalize/lowercase all filter values.
 * B14: include secondary_topics filter.
 * B15: validate namespace filter against canonical taxonomy.
 * B16: validate filters against canonical taxonomy where possible.
 *
 * IMPORTANT: Query embedding MUST use query text only.
 * Metadata filters MUST NOT be concatenated into query text.
 *
 * @param {object} params
 * @returns {{ queryTextForEmbedding: string, metadataFilters: object }}
 */
export function prepareQueryEmbedding(params = {}) {
  const query = typeof params.query === "string" ? params.query.trim() : "";
  if (!query) {
    throw new Error("QUERY_REQUIRED");
  }

  const metadataFilters = {};

  // B13: canonicalize/lowercase
  if (params.primary_topic && typeof params.primary_topic === "string") {
    metadataFilters.primary_topic = params.primary_topic.trim().toLowerCase();
  }
  if (params.subtopic && typeof params.subtopic === "string") {
    metadataFilters.subtopic = params.subtopic.trim().toLowerCase();
  }
  // B14: forward secondary_topics filter (was accepted but not forwarded)
  if (Array.isArray(params.secondary_topics) && params.secondary_topics.length > 0) {
    metadataFilters.secondary_topics = params.secondary_topics
      .filter((t) => typeof t === "string" && t.trim())
      .map((t) => t.trim().toLowerCase());
  }
  if (params.capability && typeof params.capability === "string") {
    const cap = params.capability.trim().toLowerCase();
    if (cap && !validateCapabilitySlug(cap)) {
      throw new Error(`INVALID_CAPABILITY_SLUG: "${cap}" in query filter`); // B16
    }
    metadataFilters.capability = cap;
  }
  // B15: namespace filter — validate against canonical taxonomy
  if (params.namespace && typeof params.namespace === "string") {
    const rawNs = params.namespace.trim().toLowerCase();
    const { resolved, ambiguous } = resolveNamespace(rawNs);
    if (ambiguous || resolved === null) {
      throw new Error(
        `UNKNOWN_NAMESPACE_FILTER: "${rawNs}" is not a canonical namespace or known alias`
      );
    }
    metadataFilters.namespace = resolved;
  }
  // B16: validate primary_topic against known taxonomy values (internal check only)
  if (metadataFilters.primary_topic) {
    const knownTopics = Object.values(KNOWN_TAXONOMY_MAP).map((t) => t.primary_topic);
    // Non-fatal: validation noted but not exposed in public output
    void knownTopics.includes(metadataFilters.primary_topic);
  }

  return {
    queryTextForEmbedding: query,
    metadataFilters,
  };
}

/**
 * Structured Reference ID Contract
 * Implements ACTIVE.md Sections 21 & 22:
 * Schema: TOPIC (2 digits) - EXECUTION/TOOL (2 digits) - TASK (4 digits)
 * E.g., "01-03-0042"
 * "00" is strictly reserved for Personal Experience / Human-Contributed knowledge.
 */
export const STRUCTURED_REFERENCE_ID_REGEX = /^(\d{2})-(\d{2})-(\d{4})$/u;

/**
 * Canonical Reference ID Matrix
 * Implements ACTIVE.md Sections 1, 21, 39, 40, 41:
 * - Unified Reference ID + README Matrix
 * - Compatible across KB / Skill Store / Zink Tools
 */
// B21: LSCM topic 01 domain corrected from "office" → "lscm".
// B03: power-bi topic 05 domain corrected from "data" → "analytics".
export const REFERENCE_TOPIC_CODES = Object.freeze({
  "01": Object.freeze({
    code: "01",
    name: "Supply Chain & Logistics",
    domain: "lscm",   // B21 fix: was "office"
    key: "LSCM",
  }),
  "02": Object.freeze({
    code: "02",
    name: "Knowledgebase & Research Ingestion",
    domain: "research",
    key: "KB",
  }),
  "03": Object.freeze({
    code: "03",
    name: "Office Automation & Spreadsheets",
    domain: "office",
    key: "EXCEL",
  }),
  "04": Object.freeze({
    code: "04",
    name: "Relational Analytics & SQL",
    domain: "data",
    key: "SQL",
  }),
  "05": Object.freeze({
    code: "05",
    name: "Business Intelligence & Reporting",
    domain: "analytics",  // was "data"
    key: "POWER_BI",
  }),
  "06": Object.freeze({
    code: "06",
    name: "Data Engineering & Scripting",
    domain: "engineering",
    key: "PYTHON",
  }),
  "07": Object.freeze({
    code: "07",
    name: "System Governance & Lifecycle",
    domain: "governance",
    key: "GOVERNANCE",
  }),
});

export const REFERENCE_EXECUTION_CODES = Object.freeze({
  "00": Object.freeze({
    code: "00",
    type: "Personal Experience / Human-Contributed",
    isHuman: true,
    description:
      "Bất biến, dành riêng cho tri thức do con người trực tiếp đóng góp",
  }),
  "01": Object.freeze({
    code: "01",
    type: "Automated Pipeline / ETL",
    isHuman: false,
    description: "Dòng chảy xử lý dữ liệu và trích xuất tự động (O1: SQL/Python)",
  }),
  "02": Object.freeze({
    code: "02",
    type: "Analytical & Statistical Modeling",
    isHuman: false,
    description: "Mô hình phân tích dữ liệu, DAX và thống kê (O2: Power BI)",
  }),
  "03": Object.freeze({
    code: "03",
    type: "Tool Direct Execution / Artifact Generation",
    isHuman: false,
    description: "Thực thi công cụ trực tiếp sinh artifact/báo cáo (Excel/Python)",
  }),
  "04": Object.freeze({
    code: "04",
    type: "ML & Predictive Forecasting",
    isHuman: false,
    description:
      "Học máy, huấn luyện ngoại vi và dự báo chuỗi thời gian (O2/Python)",
  }),
  "05": Object.freeze({
    code: "05",
    type: "Optimization & Simulation",
    isHuman: false,
    description:
      "Thuật toán quy hoạch tuyến tính/phi tuyến, mô phỏng hoạt động (O2)",
  }),
});

/**
 * Formats a structured reference ID.
 * B17: validate topic and execution codes against registry.
 * B20: reject taskNumber=0 (contract says 1-9999).
 */
export function formatStructuredReferenceId({
  topicCode,    // 0-99
  executionCode, // 0-99 (00 = human-contributed)
  taskNumber,    // 1-9999
}) {
  const t = String(topicCode).padStart(2, "0");
  const e = String(executionCode).padStart(2, "0");

  // B20: taskNumber must be 1-9999
  const tn = Number(taskNumber);
  if (!Number.isInteger(tn) || tn < 1 || tn > 9999) {
    throw new Error("INVALID_TASK_NUMBER: taskNumber must be an integer in 1-9999");
  }
  const k = String(tn).padStart(4, "0");

  if (!/^\d{2}$/.test(t) || !/^\d{2}$/.test(e) || !/^\d{4}$/.test(k)) {
    throw new Error(
      "INVALID_REFERENCE_ID_COMPONENTS: Expected 2-digit topic, 2-digit execution, 4-digit task"
    );
  }

  // B17: validate codes are registered
  if (!REFERENCE_TOPIC_CODES[t]) {
    throw new Error(`UNREGISTERED_TOPIC_CODE: "${t}" is not in REFERENCE_TOPIC_CODES`);
  }
  if (!REFERENCE_EXECUTION_CODES[e]) {
    throw new Error(`UNREGISTERED_EXECUTION_CODE: "${e}" is not in REFERENCE_EXECUTION_CODES`);
  }

  return `${t}-${e}-${k}`;
}

export function parseStructuredReferenceId(id) {
  if (typeof id !== "string") {
    throw new TypeError("Reference ID must be a string");
  }
  const match = id.trim().match(STRUCTURED_REFERENCE_ID_REGEX);
  if (!match) {
    throw new Error(
      `INVALID_REFERENCE_ID_FORMAT: "${id}" does not match TOPIC(2)-EXECUTION(2)-TASK(4)`,
    );
  }
  return {
    rawId: match[0],
    topicCode: match[1],
    executionCode: match[2],
    taskNumber: match[3],
    isHumanContributed: match[2] === "00",
  };
}

export function isValidStructuredReferenceId(id) {
  try {
    parseStructuredReferenceId(id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves full semantic meaning from a structured reference ID.
 * B18: unregistered codes → INVALID_REFERENCE (not silently Custom/Unregistered).
 * B19: executionCode=00 flags human origin requirement but cannot prove it here.
 *
 * @param {string} id
 * @returns {object}
 */
export function resolveReferenceIdMeaning(id) {
  const parsed = parseStructuredReferenceId(id);

  // B18: reject unregistered codes instead of returning Custom fallback
  const topic = REFERENCE_TOPIC_CODES[parsed.topicCode];
  if (!topic) {
    throw new Error(
      `INVALID_REFERENCE_ID: topic code "${parsed.topicCode}" is not registered`
    );
  }
  const execution = REFERENCE_EXECUTION_CODES[parsed.executionCode];
  if (!execution) {
    throw new Error(
      `INVALID_REFERENCE_ID: execution code "${parsed.executionCode}" is not registered`
    );
  }

  // B19: human-origin claim; caller must supply verified provenance proof
  const humanOriginNote =
    parsed.executionCode === "00"
      ? "human-contributed claim; caller must supply verified provenance proof"
      : null;

  return {
    ...parsed,
    topic,
    execution,
    humanOriginNote,
    summary: `[${topic.key}] ${topic.name} | ${execution.type} | Task #${parsed.taskNumber}`,
  };
}

/**
 * Retrieval Deduplication.
 * B27: classify type BEFORE deduplication to prevent losing procedure/tool items.
 * B28: dedup key uses content_hash/passage_id/full-text-SHA256 (not 100-char prefix).
 * B29: sort each bucket by relevance score descending after dedup.
 * B30: emit provenance_conflicts for content-identical but metadata-different items.
 */
export function deduplicateRetrievalContext(items = []) {
  if (!Array.isArray(items)) {
    return { canonicalFacts: [], procedures: [], toolReferences: [], totalCount: 0, provenance_conflicts: [] };
  }

  // B27: classify FIRST, then dedup within type classes
  const classified = items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ item, typeClass: item.type || item.source_type || "fact" }));

  // B28: stable dedup key — content_hash > passage_id > full-text SHA-256
  const getKey = (item) => {
    if (item.content_hash) return `hash:${item.content_hash}`;
    if (item.passage_id) return `pid:${item.passage_id}`;
    if (typeof item.text === "string" && item.text.length > 0) {
      return `sha256:${createHash("sha256").update(item.text, "utf8").digest("hex")}`;
    }
    return null; // no dedup key — always include
  };

  const seenKeys = new Map();
  const provenance_conflicts = [];
  const canonicalFacts = [];
  const procedures = [];
  const toolReferences = [];

  for (const { item, typeClass } of classified) {
    const key = getKey(item);

    if (key !== null && seenKeys.has(key)) {
      // B30: detect provenance conflict (same content, different metadata)
      const first = seenKeys.get(key);
      const diffs = detectProvenanceConflict(first, item);
      if (diffs) {
        provenance_conflicts.push({ key, first, duplicate: item, conflict: diffs });
      }
      continue;
    }
    if (key !== null) seenKeys.set(key, item);

    if (typeClass === "skill" || typeClass === "procedure") {
      procedures.push(item);
    } else if (typeClass === "tool") {
      toolReferences.push(item);
    } else {
      canonicalFacts.push(item);
    }
  }

  // B29: sort each bucket by relevance/score descending
  const byRelevance = (a, b) =>
    (b.score ?? b.relevance ?? b.confidence ?? 0) -
    (a.score ?? a.relevance ?? a.confidence ?? 0);

  canonicalFacts.sort(byRelevance);
  procedures.sort(byRelevance);
  toolReferences.sort(byRelevance);

  return {
    canonicalFacts,
    procedures,
    toolReferences,
    totalCount: canonicalFacts.length + procedures.length + toolReferences.length,
    provenance_conflicts,
  };
}

// B30: internal provenance conflict detector
function detectProvenanceConflict(a, b) {
  const fields = ["namespace", "domain", "primary_topic", "source", "version", "updated_at"];
  const diffs = [];
  for (const f of fields) {
    if ((a[f] !== undefined || b[f] !== undefined) && a[f] !== b[f]) {
      diffs.push({ field: f, first: a[f], duplicate: b[f] });
    }
  }
  return diffs.length > 0 ? diffs : null;
}

// ─── Semantic relevance thresholds (B23/B26) ─────────────────────────────────
// B23: minimum confidence before routing should proceed
export const SEMANTIC_MIN_CONFIDENCE = 0.5;
// B26: minimum retrieval relevance — items below this are not treated as evidence
export const RETRIEVAL_MIN_RELEVANCE = 0.3;

/**
 * Filters retrieval items by minimum relevance threshold.
 * B26: items below threshold must not be treated as evidence.
 */
export function filterByMinRelevance(items = []) {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (item) => (item?.score ?? item?.relevance ?? item?.confidence ?? 1) >= RETRIEVAL_MIN_RELEVANCE
  );
}
