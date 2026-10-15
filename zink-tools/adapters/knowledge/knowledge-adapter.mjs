import http from "node:http";
import https from "node:https";
import { setTimeout } from "node:timers/promises";
import { URL } from "node:url";

export class KnowledgeAdapterError extends Error {
  constructor(message, code = "KNOWLEDGE_ADAPTER_ERROR") {
    super(message);
    this.name = "KnowledgeAdapterError";
    this.code = code;
  }
}

const ALLOWED_ACTIONS = new Set(["search", "retrieve", "citation", "metadata"]);
const FORBIDDEN_ACTIONS = new Set([
  "ingestion",
  "update",
  "delete",
  "re-index",
  "governance mutation",
]);

export const MAX_KNOWLEDGE_RESPONSE_BYTES = 50 * 1024 * 1024; // 50MB ceiling (M08)
export const MAX_RESULT_TEXT_BYTES = 64 * 1024; // 64KB ceiling per result (M15)

/**
 * Truncate to at most `maxBytes` UTF-8 bytes without splitting a character.
 *
 * M10/T2-R21: a constant named and documented in BYTES must be enforced with a
 * byte measure. `.length` counts UTF-16 units, so multi-byte content overran the
 * ceiling by the UTF-8 expansion ratio.
 *
 * The same rule lives in `topology/lib/runtime.mjs` and
 * `lib/coordinator-pickup.mjs`; this module cannot import either (the deployed
 * extension ships only `lib/` and `contracts/`), so the rule is duplicated
 * deliberately and pinned by
 * `tests/m10-t2-r21-skill-chunking-and-text-budgets.test.mjs`.
 */
function truncateUtf8Bytes(value, maxBytes) {
  const text = String(value);
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  let bytes = 0;
  let out = "";
  // Iterating a string yields whole code points, so a surrogate pair is never
  // split.
  for (const character of text) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return `${out}... [truncated]`;
}

// Search capacity in personal-tool-knowledge-1 is strictly capped at 2.
// We maintain an in-process AsyncSemaphore across adapter instances to queue
// concurrent searches and prevent HTTP 429 SEARCH_CAPACITY_EXCEEDED (M16).
class AsyncSemaphore {
  constructor(maxConcurrency = 2) {
    this.maxConcurrency = maxConcurrency;
    this.current = 0;
    this.queue = [];
  }

  acquire() {
    if (this.current < this.maxConcurrency) {
      this.current++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.current = Math.max(0, this.current - 1);
    }
  }
}

const sharedSearchSemaphore = new AsyncSemaphore(2);

export class KnowledgeAdapter {
  constructor(endpoint, options = {}) {
    this.endpoint =
      endpoint || process.env.KNOWLEDGE_ENDPOINT || "http://127.0.0.1:8000";
    this.timeout =
      options.timeout || Number(process.env.KNOWLEDGE_TIMEOUT_MS) || 120000;
    this.options = options;
  }

  async queryKnowledge(input = {}, context = {}) {
    const {
      action,
      namespace = "core",
      query,
      chunk_id,
      top_k = 5,
      limit,
      primary_topic,
      path_prefix,
      source_types,
      rerank,
      subtopic,
      secondary_topics,
      capability,
      min_score,
    } = input;

    if (!action || FORBIDDEN_ACTIONS.has(action)) {
      throw new KnowledgeAdapterError(
        `Action '${action}' is strictly forbidden by Knowledgebase policy`,
        "KNOWLEDGE_ACTION_FORBIDDEN",
      );
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      throw new KnowledgeAdapterError(
        `Unknown Knowledgebase action: ${action}`,
        "KNOWLEDGE_ACTION_INVALID",
      );
    }

    if (action === "search") {
      if (!query || typeof query !== "string" || !query.trim()) {
        throw new KnowledgeAdapterError(
          "query is required for search",
          "KNOWLEDGE_QUERY_REQUIRED",
        );
      }
    }

    // M02: retrieve requires non-empty chunk_id
    if (action === "retrieve") {
      if (!chunk_id || typeof chunk_id !== "string" || !chunk_id.trim()) {
        throw new KnowledgeAdapterError(
          "chunk_id is required for retrieve action",
          "KNOWLEDGE_CHUNK_ID_REQUIRED",
        );
      }
    }

    // Call FastAPI service via HTTP
    try {
      const trimmedBase = this.endpoint.replace(/\/+$/, "");

      // M01: Action-specific URL routing
      let targetPath;
      if (action === "retrieve") {
        targetPath = `${trimmedBase}/v1/chunk/${encodeURIComponent(chunk_id.trim())}`;
      } else if (action === "citation") {
        targetPath = `${trimmedBase}/v1/citation/${encodeURIComponent(chunk_id || "")}`;
      } else if (action === "metadata") {
        targetPath = `${trimmedBase}/v1/metadata/${encodeURIComponent(chunk_id || "")}`;
      } else {
        targetPath = `${trimmedBase}/v1/search`;
      }

      const targetUrl = new URL(targetPath);

      // M06: SSRF / Host Allowlist Validation
      if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        throw new KnowledgeAdapterError(
          `Protocol '${targetUrl.protocol}' is forbidden by SSRF policy`,
          "KNOWLEDGE_ENDPOINT_FORBIDDEN",
        );
      }
      const allowedHosts = new Set([
        "localhost",
        "127.0.0.1",
        "host.docker.internal",
        "knowledge-api",
        "personal-tool-knowledge-1",
        ...(this.options.allowedHosts || []),
      ]);
      if (!allowedHosts.has(targetUrl.hostname) && !this.options.allowRemote) {
        throw new KnowledgeAdapterError(
          `SSRF_PROTECTION: Host '${targetUrl.hostname}' is not in trusted allowlist`,
          "KNOWLEDGE_ENDPOINT_FORBIDDEN",
        );
      }

      const boundedLimit = Math.max(
        1,
        Math.min(20, Number(limit ?? top_k ?? 5)),
      );

      // M04: Default rerank is true matching FastAPI server
      const rerankBool = rerank !== undefined ? Boolean(rerank) : true;

      const requestPayloadObj = {
        query: query ? query.trim() : "",
        limit: boundedLimit,
        rerank: rerankBool,
      };

      // M03: Forward namespace
      if (namespace) {
        requestPayloadObj.namespace = namespace;
      }
      if (primary_topic && typeof primary_topic === "string") {
        requestPayloadObj.primary_topic = primary_topic.trim();
      }
      if (path_prefix && typeof path_prefix === "string") {
        requestPayloadObj.path_prefix = path_prefix.trim();
      }
      if (Array.isArray(source_types) && source_types.length > 0) {
        requestPayloadObj.source_types = source_types;
      }

      // M05: Forward subtopic, secondary_topics, capability, min_score
      if (subtopic && typeof subtopic === "string") {
        requestPayloadObj.subtopic = subtopic.trim();
      }
      if (Array.isArray(secondary_topics) && secondary_topics.length > 0) {
        requestPayloadObj.secondary_topics = secondary_topics;
      }
      if (capability && typeof capability === "string") {
        requestPayloadObj.capability = capability.trim();
      }
      if (typeof min_score === "number") {
        requestPayloadObj.min_score = min_score;
      }

      const requestPayload = JSON.stringify(requestPayloadObj);
      const client = targetUrl.protocol === "https:" ? https : http;

      const shouldAcquireSemaphore = action === "search";
      if (shouldAcquireSemaphore) {
        await sharedSearchSemaphore.acquire();
      }

      try {
        let response;
        const maxAttempts = 3;
        const reqTimeout =
          input?.timeout || context?.timeout || this.timeout || 120000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const isPost = action === "search";
          const reqHeaders = {};
          if (isPost) {
            reqHeaders["Content-Type"] = "application/json";
            reqHeaders["Content-Length"] = Buffer.byteLength(requestPayload);
          }

          // M07: Auth binding
          const apiKey =
            this.options.apiKey ||
            input.api_key ||
            process.env.KNOWLEDGE_API_KEY;
          if (apiKey) {
            reqHeaders["Authorization"] = `Bearer ${apiKey}`;
          }

          // M17: Task lineage headers
          if (context.taskId) reqHeaders["X-Task-Id"] = String(context.taskId);
          if (context.agentId)
            reqHeaders["X-Agent-Id"] = String(context.agentId);
          if (context.attemptToken)
            reqHeaders["X-Attempt-Token"] = String(context.attemptToken);

          response = await new Promise((resolve, reject) => {
            const req = client.request(
              targetUrl,
              {
                method: isPost ? "POST" : "GET",
                headers: reqHeaders,
                timeout: reqTimeout,
              },
              (res) => {
                let data = "";
                // M08: Bounded upstream response body buffer
                res.on("data", (chunk) => {
                  data += chunk;
                  if (data.length > MAX_KNOWLEDGE_RESPONSE_BYTES) {
                    req.destroy();
                    reject(
                      new KnowledgeAdapterError(
                        "Upstream response exceeded 50MB ceiling",
                        "KNOWLEDGE_RESPONSE_TOO_LARGE",
                      ),
                    );
                  }
                });
                res.on("end", () =>
                  resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    data,
                  }),
                );
              },
            );
            req.on("error", (err) => reject(err));
            req.on("timeout", () => {
              req.destroy();
              reject(
                new KnowledgeAdapterError(
                  "Knowledge request timeout",
                  "KNOWLEDGE_SERVICE_TIMEOUT",
                ),
              );
            });
            if (isPost) {
              req.write(requestPayload);
            }
            req.end();
          });

          // M09 & M10: Respect Retry-After header with configurable jitter
          if (
            (response.status === 429 ||
              response.status === 503 ||
              response.status === 504) &&
            attempt < maxAttempts
          ) {
            let retryDelayMs = attempt * 1500;
            const retryHeader = response.headers?.["retry-after"];
            if (retryHeader) {
              const seconds = parseInt(retryHeader, 10);
              if (!isNaN(seconds) && seconds > 0) {
                retryDelayMs = seconds * 1000;
              }
            }
            const jitterMs =
              typeof this.options.jitterFn === "function"
                ? this.options.jitterFn(attempt)
                : this.options.deterministicRetry
                  ? attempt * 200
                  : Math.floor(Math.random() * 1000);

            await setTimeout(retryDelayMs + jitterMs);
            continue;
          }
          break;
        }

        if (response.status >= 200 && response.status < 300) {
          const parsed = JSON.parse(response.data);
          const rawResults = parsed.results || [];

          // M12, M13, M15: Schema validation and per-result bounding
          const formattedResults = rawResults.map((r) => {
            const rawScore = Number(r.rerank_score ?? r.dense_score ?? 0);
            const validScore = Number.isFinite(rawScore)
              ? Math.max(-1, Math.min(1, rawScore))
              : 0;

            const rawText = String(r.text || "");
            // M10/T2-R21: byte-budgeted. `MAX_RESULT_TEXT_BYTES` is named and
            // documented as a 64KB ceiling (M15), but `.length` counts UTF-16
            // code units. Measured: a 65,536-character Vietnamese result is
            // 196,608 UTF-8 bytes, so 3x the declared ceiling was forwarded to
            // the caller untouched. This is the FOURTH defect of the
            // byte-vs-character class in this codebase.
            const boundedText = truncateUtf8Bytes(
              rawText,
              MAX_RESULT_TEXT_BYTES,
            );

            const headingPath = Array.isArray(r.heading_path)
              ? r.heading_path.filter((h) => typeof h === "string")
              : [];

            return {
              chunk_id: r.segment_id || r.chunk_id || "unknown",
              title: r.title || "Untitled",
              text: boundedText,
              score: validScore,
              citation:
                r.citation ||
                (r.source_path
                  ? `${r.source_path}${r.line_start ? `#L${r.line_start}` : ""}`
                  : ""),
              metadata: {
                source_path: r.source_path,
                heading_path: headingPath,
                source_type: r.source_type,
                page_start:
                  typeof r.page_start === "number" ? r.page_start : null,
                page_end: typeof r.page_end === "number" ? r.page_end : null,
              },
            };
          });

          // M14: total_count matches formattedResults length
          return {
            action,
            namespace: namespace || "core",
            semantic_contract_version:
              parsed.semantic_contract_version || "zink-semantic-v2",
            results: formattedResults,
            total_count: formattedResults.length,
            governed_status:
              formattedResults.length === 0 ? "NO_MATCH" : "SUCCESS",
          };
        }

        // M11: Sanitized HTTP error message (do not return raw upstream dump)
        const sanitizedMessage =
          (response.data || "").slice(0, 300) ||
          `HTTP error ${response.status} from Knowledge service`;

        return {
          action,
          namespace: namespace || "core",
          results: [],
          total_count: 0,
          governed_status: "CONTROLLED_FAILURE",
          error: `HTTP_${response.status}`,
          message: sanitizedMessage,
        };
      } finally {
        if (shouldAcquireSemaphore) {
          sharedSearchSemaphore.release();
        }
      }
    } catch (error) {
      if (error instanceof KnowledgeAdapterError) throw error;
      return {
        action,
        namespace: namespace || "core",
        results: [],
        total_count: 0,
        governed_status: "CONTROLLED_FAILURE",
        error: "KNOWLEDGE_SERVICE_UNAVAILABLE",
        message: error.message || "Knowledgebase service is unavailable.",
      };
    }
  }
}

export const defaultKnowledgeAdapter = new KnowledgeAdapter();

export async function executeGovernedKnowledgeQuery(input, context, options) {
  const adapter =
    options?.endpoint || options?.timeout || options?.apiKey
      ? new KnowledgeAdapter(options?.endpoint, options)
      : defaultKnowledgeAdapter;
  return adapter.queryKnowledge(input, context);
}
