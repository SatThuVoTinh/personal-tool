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
  "lscm", // supply-chain / logistics / LSCM
  "analytics", // BI / reporting / KPI
  "optimization", // OR / forecasting / simulation
  "research", // KB ingestion / literature
  "general",
]);

// ─── Alias registry (B22) ─────────────────────────────────────────────────────
// Maps lowercase surface aliases → canonical namespace slug.
//
// Two invariants, and both are load-bearing:
//   1. every VALUE is a key of KNOWN_TAXONOMY_MAP — the alias points at a
//      canonical namespace;
//   2. every KEY is NOT a key of KNOWN_TAXONOMY_MAP — an alias is a surface
//      spelling, never a canonical namespace of its own.
//
// Invariant 2 is what F-014 (R5-E07-04) was about. `resolveNamespace`
// consults the taxonomy FIRST, so an alias key that is also a taxonomy key is
// unreachable: the alias never fires and one corpus is indexed under two
// topics depending on the spelling the ingester happened to use. `research`
// was exactly that one dead entry. A test pins the disjointness, so the two
// registries cannot drift apart again.
export const NAMESPACE_ALIAS_MAP = Object.freeze({
  // supply-chain family
  "supply-chain": "lscm",
  "sc/logistics": "lscm",
  "sc-logistics": "lscm",
  logistics: "lscm",
  lsc: "lscm",
  supply_chain: "lscm",
  // analytics / BI family
  bi: "power-bi",
  powerbi: "power-bi",
  power_bi: "power-bi",
  "business-intelligence": "power-bi",
  // OR / optimization family
  or: "optimization",
  "operations-research": "optimization",
  simulation: "optimization",
  forecasting: "optimization",
  // python / scripting aliases
  scripting: "python",
  "data-engineering": "python",
  // research / KB aliases
  kb: "knowledge",
  "knowledge-base": "knowledge",
  research: "knowledge",
  literature: "knowledge",
  // sql aliases
  database: "sql",
  relational: "sql",
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
  // F-014 (R5-E07-04): there is deliberately NO `research` key here.
  // `NAMESPACE_ALIAS_MAP` declares `research` a surface spelling of the
  // `knowledge` namespace, and this map is the canonical registry — but it
  // also carried a `research` key, and `resolveNamespace` consults the
  // taxonomy first, so the alias was unreachable. One corpus was then indexed
  // under two topics: `domain-research` for the spelling "research" and
  // `kb-ingestion` for "kb" / "knowledge-base" / "literature". The taxonomy
  // key shadowed the alias; removing it makes the alias reachable and gives
  // every spelling the same canonical namespace, the same domain ("research")
  // and the same primary topic ("kb-ingestion").
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

// F-008 (R1-A10-06): a contract-layer refusal carries a machine-readable code
// beside the named code in its message, so the adapter that catches it can
// report WHICH refusal it was instead of a generic adapter error.
function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// B05/B22: namespace resolution — fail-closed for unknown namespaces.
//
// The precedence, and it is the only one:
//   1. the canonical taxonomy (KNOWN_TAXONOMY_MAP),
//   2. the surface-alias registry (NAMESPACE_ALIAS_MAP),
//   3. a canonical domain slug (CANONICAL_DOMAINS).
//
// Step 1 comes first, which is exactly why an alias key that is also a
// taxonomy key is unreachable — see the alias registry's invariants (F-014).
function resolveNamespace(raw) {
  const ns = raw?.toLowerCase() ?? "";
  if (!ns) return { resolved: null, ambiguous: true };
  if (KNOWN_TAXONOMY_MAP[ns]) return { resolved: ns, ambiguous: false };
  const aliased = NAMESPACE_ALIAS_MAP[ns];
  if (aliased && KNOWN_TAXONOMY_MAP[aliased])
    return { resolved: aliased, ambiguous: false };
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

  // B05: fail-closed — if no namespace resolved, signal AMBIGUOUS.
  // M12/T2.2-R3 R3-8: this used to carry `&& nsList.length > 0`, which made an
  // ABSENT namespace the one input that never fails closed — it fell through to
  // `domain: "general"` below, a value the consumer gate
  // (`CANONICAL_DOMAINS.includes(domain)`) accepts, so "no taxonomy supplied"
  // and "taxonomy resolved to the generic domain" were indistinguishable.
  const ambiguous = resolvedNamespaces.length === 0;
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
      `INVALID_CAPABILITY_SLUG: "${rawCapability}" must be kebab-case [a-z0-9-]`,
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
 * The primary_topic values the index can actually carry.
 *
 * Derived from the writer's own function (deriveSemanticMetadata) over every
 * namespace that resolves, so the accepted filter values and the stored values
 * cannot drift apart: a topic is accepted exactly when some namespace derives
 * it. The canonical domains are part of the sweep because a namespace that
 * resolves to a canonical domain without a taxonomy entry stores that slug
 * as its topic.
 */
function knownPrimaryTopics() {
  const topics = new Set();
  for (const namespace of [
    ...Object.keys(KNOWN_TAXONOMY_MAP),
    ...CANONICAL_DOMAINS,
  ]) {
    const meta = deriveSemanticMetadata({ namespace: [namespace] });
    if (!meta.ambiguous) topics.add(meta.primary_topic);
  }
  return topics;
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
    domain,
    primary_topic,
    subtopic = null,
    concept = null,
    secondary_topics = [],
    content,
  } = params;

  // B10: strip newlines/CR from metadata values
  const sanitize = (v) =>
    typeof v === "string" ? v.replace(/[\r\n]+/gu, " ").trim() : "";

  // M12/T2.2-R3 R3-9: the taxonomy must arrive, it may not be invented here.
  // Both fields used to default to "general", so a caller that passed neither
  // got a well-formed header for a taxonomy nobody resolved — and
  // computeEmbeddingInputHash then pinned a digest to those bytes, which makes
  // a fabricated envelope indistinguishable from a real one downstream. The
  // refusal changes no byte of an envelope that was built correctly, which is
  // exactly why this needed no SEMANTIC_CONTRACT_VERSION bump.
  const missingTaxonomy = [];
  if (!sanitize(domain)) missingTaxonomy.push("Domain");
  if (!sanitize(primary_topic)) missingTaxonomy.push("Primary Topic");
  if (missingTaxonomy.length > 0) {
    throw new Error(
      `EMBEDDING_ENVELOPE_METADATA_REQUIRED: ${missingTaxonomy.join(", ")} must come from deriveSemanticMetadata`,
    );
  }

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

  const rendered = `${headerLines.join("\n")}\n\n${String(content ?? "").trim()}`;

  // B12: enforce max byte bound
  if (byteLength(rendered) > MAX_EMBEDDING_INPUT_BYTES) {
    throw new Error(
      `EMBEDDING_INPUT_TOO_LARGE: rendered envelope exceeds ${MAX_EMBEDDING_INPUT_BYTES} bytes`,
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
 * B14 (F-008): the secondary_topics filter is WITHDRAWN — it is refused with
 * a named code instead of being forwarded, because it can never match a row.
 * B15: validate namespace filter against canonical taxonomy.
 * B16: validate primary_topic against the topics the index can carry, and
 * refuse an unrecognized one with a named code.
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
  // F-008 (R1-A10-06): the `secondary_topics` filter is WITHDRAWN here and
  // in the SQL builder (zink-tools/adapters/skill-store/skill-adapter.mjs)
  // together.
  //
  // The column it compared against is always empty: the writer passes
  // `canonicalSecondaryTopics = []` (zink-skill-store/src/vector-sync.mjs),
  // because a canonical skill manifest carries no metadata key to derive
  // topics from. So `c.secondary_topics && '{...}'` was an overlap test
  // against `{}` for every row - a predicate that could only remove rows,
  // and it removed them silently: the search answered NO_MATCH, which no
  // caller can tell from "no such skill". Honoring the filter needs a writer
  // change, so the filter is refused by name instead of being forwarded.
  const requestedSecondaryTopics = params.secondary_topics;
  const hasSecondaryTopics =
    (Array.isArray(requestedSecondaryTopics) &&
      requestedSecondaryTopics.length > 0) ||
    (typeof requestedSecondaryTopics === "string" &&
      requestedSecondaryTopics.trim() !== "");
  if (hasSecondaryTopics) {
    throw contractError(
      "SECONDARY_TOPICS_FILTER_UNSUPPORTED",
      "SECONDARY_TOPICS_FILTER_UNSUPPORTED: the secondary_topics filter cannot match any indexed skill, so it is refused instead of being applied",
    );
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
        `UNKNOWN_NAMESPACE_FILTER: "${rawNs}" is not a canonical namespace or known alias`,
      );
    }
    metadataFilters.namespace = resolved;
  }
  // B16 / F-008 (R1-A10-06): validate primary_topic against the topics the
  // index can carry.
  //
  // This used to compute the known topics and throw the result away
  // (`void knownTopics.includes(...)`): the check was not a check at all, so
  // an unrecognized topic was forwarded to SQL and answered NO_MATCH — a
  // silent false negative, indistinguishable from "no skill has that topic".
  // The refusal is at the contract layer, so the predicate never reaches the
  // statement. (The earlier note that enforcement was out of scope is
  // superseded: F-008's acceptance criteria asks for exactly this.)
  if (metadataFilters.primary_topic) {
    if (!knownPrimaryTopics().has(metadataFilters.primary_topic)) {
      throw contractError(
        "UNKNOWN_PRIMARY_TOPIC_FILTER",
        `UNKNOWN_PRIMARY_TOPIC_FILTER: "${metadataFilters.primary_topic}" is not a primary topic the index can carry`,
      );
    }
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
    domain: "lscm", // B21 fix: was "office"
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
    domain: "analytics", // was "data"
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
    description:
      "Dòng chảy xử lý dữ liệu và trích xuất tự động (O1: SQL/Python)",
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
    description:
      "Thực thi công cụ trực tiếp sinh artifact/báo cáo (Excel/Python)",
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
  topicCode, // 0-99
  executionCode, // 0-99 (00 = human-contributed)
  taskNumber, // 1-9999
}) {
  const t = String(topicCode).padStart(2, "0");
  const e = String(executionCode).padStart(2, "0");

  // B20: taskNumber must be 1-9999
  const tn = Number(taskNumber);
  if (!Number.isInteger(tn) || tn < 1 || tn > 9999) {
    throw new Error(
      "INVALID_TASK_NUMBER: taskNumber must be an integer in 1-9999",
    );
  }
  const k = String(tn).padStart(4, "0");

  if (!/^\d{2}$/.test(t) || !/^\d{2}$/.test(e) || !/^\d{4}$/.test(k)) {
    throw new Error(
      "INVALID_REFERENCE_ID_COMPONENTS: Expected 2-digit topic, 2-digit execution, 4-digit task",
    );
  }

  // B17: validate codes are registered
  if (!REFERENCE_TOPIC_CODES[t]) {
    throw new Error(
      `UNREGISTERED_TOPIC_CODE: "${t}" is not in REFERENCE_TOPIC_CODES`,
    );
  }
  if (!REFERENCE_EXECUTION_CODES[e]) {
    throw new Error(
      `UNREGISTERED_EXECUTION_CODE: "${e}" is not in REFERENCE_EXECUTION_CODES`,
    );
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
  // Resolvability, not just shape: the registries reject codes the format regex accepts,
  // so a caller that checked this and then resolved used to still throw.
  try {
    resolveReferenceIdMeaning(id);
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
      `INVALID_REFERENCE_ID: topic code "${parsed.topicCode}" is not registered`,
    );
  }
  const execution = REFERENCE_EXECUTION_CODES[parsed.executionCode];
  if (!execution) {
    throw new Error(
      `INVALID_REFERENCE_ID: execution code "${parsed.executionCode}" is not registered`,
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
 * The single relevance rule. A score-less item is 0, i.e. not evidence — the
 * conservative direction both live adapters already apply. The filter used to default
 * such an item to full confidence instead, which is how one concept ended up with two
 * opposite meanings depending on the call site.
 */
export function resolveRelevanceScore(item) {
  return item?.score ?? item?.relevance ?? item?.confidence ?? 0;
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
    return {
      canonicalFacts: [],
      procedures: [],
      toolReferences: [],
      totalCount: 0,
      provenance_conflicts: [],
    };
  }

  // B27: classify FIRST, then dedup within type classes
  const classified = items
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      item,
      typeClass: item.type || item.source_type || "fact",
    }));

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
        provenance_conflicts.push({
          key,
          first,
          duplicate: item,
          conflict: diffs,
        });
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

  // B29: sort each bucket by relevance descending, using the one shared rule
  const byRelevance = (a, b) =>
    resolveRelevanceScore(b) - resolveRelevanceScore(a);

  canonicalFacts.sort(byRelevance);
  procedures.sort(byRelevance);
  toolReferences.sort(byRelevance);

  return {
    canonicalFacts,
    procedures,
    toolReferences,
    totalCount:
      canonicalFacts.length + procedures.length + toolReferences.length,
    provenance_conflicts,
  };
}

// B30: internal provenance conflict detector
function detectProvenanceConflict(a, b) {
  const fields = [
    "namespace",
    "domain",
    "primary_topic",
    "source",
    "version",
    "updated_at",
  ];
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
    (item) => resolveRelevanceScore(item) >= RETRIEVAL_MIN_RELEVANCE,
  );
}
