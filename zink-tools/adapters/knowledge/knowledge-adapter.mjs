import http from "node:http";
import https from "node:https";

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

export class KnowledgeAdapter {
  constructor(endpoint) {
    this.endpoint =
      endpoint ||
      process.env.KNOWLEDGE_ENDPOINT ||
      "http://127.0.0.1:8080/knowledge";
  }

  async queryKnowledge(input = {}, context = {}) {
    const {
      action,
      namespace = "core",
      query,
      chunk_id,
      top_k = 10,
      limit,
      primary_topic,
      path_prefix,
      source_types,
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

    // Call FastAPI service via HTTP
    try {
      const trimmedBase = this.endpoint.replace(/\/+$/, "");
      const targetPath =
        action === "retrieve"
          ? `${trimmedBase}/v1/chunk/${encodeURIComponent(chunk_id ?? "")}`
          : `${trimmedBase}/v1/search`;

      const targetUrl = new URL(targetPath);
      const boundedLimit = Math.max(
        1,
        Math.min(20, Number(limit || top_k || 10)),
      );

      const requestPayloadObj = {
        query: query ? query.trim() : "",
        limit: boundedLimit,
      };

      if (primary_topic && typeof primary_topic === "string") {
        requestPayloadObj.primary_topic = primary_topic.trim();
      }
      if (path_prefix && typeof path_prefix === "string") {
        requestPayloadObj.path_prefix = path_prefix.trim();
      }
      if (Array.isArray(source_types) && source_types.length > 0) {
        requestPayloadObj.source_types = source_types;
      }

      const requestPayload = JSON.stringify(requestPayloadObj);

      const client = targetUrl.protocol === "https:" ? https : http;

      const response = await new Promise((resolve, reject) => {
        const req = client.request(
          targetUrl,
          {
            method: action === "retrieve" ? "GET" : "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(requestPayload),
            },
            timeout: 5000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => resolve({ status: res.statusCode, data }));
          },
        );
        req.on("error", (err) => reject(err));
        req.on("timeout", () => {
          req.destroy();
          reject(new Error("KNOWLEDGE_SERVICE_TIMEOUT"));
        });
        if (action !== "retrieve") {
          req.write(requestPayload);
        }
        req.end();
      });

      if (response.status >= 200 && response.status < 300) {
        const parsed = JSON.parse(response.data);
        const rawResults = parsed.results || [];
        const formattedResults = rawResults.map((r) => ({
          chunk_id: r.segment_id || r.chunk_id || "unknown",
          title: r.title || "Untitled",
          text: r.text || "",
          score: r.rerank_score ?? r.dense_score ?? 0,
          citation:
            r.citation ||
            (r.source_path
              ? `${r.source_path}${r.line_start ? `#L${r.line_start}` : ""}`
              : ""),
          metadata: {
            source_path: r.source_path,
            heading_path: r.heading_path || [],
            source_type: r.source_type,
            page_start: r.page_start,
            page_end: r.page_end,
          },
        }));

        return {
          action,
          namespace: namespace || "core",
          results: formattedResults,
          total_count: parsed.total_count ?? formattedResults.length,
          governed_status: "SUCCESS",
        };
      }

      return {
        action,
        namespace: namespace || "core",
        results: [],
        total_count: 0,
        governed_status: "CONTROLLED_FAILURE",
        error: `HTTP_${response.status}`,
        message: response.data,
      };
    } catch (error) {
      // Fail closed with CONTROLLED_FAILURE — NEVER fabricate results per ACTIVE.md BUG-07
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
  const adapter = options?.endpoint
    ? new KnowledgeAdapter(options.endpoint)
    : defaultKnowledgeAdapter;
  return adapter.queryKnowledge(input, context);
}
