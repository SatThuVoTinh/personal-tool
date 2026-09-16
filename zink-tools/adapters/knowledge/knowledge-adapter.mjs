import http from "node:http";

export class KnowledgeAdapterError extends Error {
  constructor(message, code = "KNOWLEDGE_ADAPTER_ERROR") {
    super(message);
    this.name = "KnowledgeAdapterError";
    this.code = code;
  }
}

const ALLOWED_ACTIONS = new Set(["search", "retrieve", "citation", "metadata"]);
const FORBIDDEN_ACTIONS = new Set(["ingestion", "update", "delete", "re-index", "governance mutation"]);

export class KnowledgeAdapter {
  constructor(endpoint = "http://localhost:8000") {
    this.endpoint = endpoint;
  }

  async queryKnowledge(input = {}, context = {}) {
    const { action, namespace, query, chunk_id, top_k = 10 } = input;

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

    if (!namespace) {
      throw new KnowledgeAdapterError(
        "Namespace is required for Knowledgebase operations",
        "KNOWLEDGE_NAMESPACE_REQUIRED",
      );
    }

    // Probe/call local FastAPI service
    try {
      const url = new URL(
        action === "retrieve" ? `/api/v1/chunk/${encodeURIComponent(chunk_id ?? "")}` : `/api/v1/search`,
        this.endpoint,
      );

      const requestPayload = JSON.stringify({
        query: query ?? "",
        namespace,
        top_k,
      });

      const response = await new Promise((resolve, reject) => {
        const req = http.request(
          url,
          {
            method: action === "retrieve" ? "GET" : "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(requestPayload),
            },
            timeout: 2000,
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
        return {
          action,
          namespace,
          results: parsed.results ?? [],
          total_count: parsed.total_count ?? (parsed.results?.length || 0),
          governed_status: "SUCCESS",
        };
      }

      return {
        action,
        namespace,
        results: [],
        total_count: 0,
        governed_status: "CONTROLLED_FAILURE",
        error: `HTTP_${response.status}`,
      };
    } catch (error) {
      // Fail closed with CONTROLLED_FAILURE — NEVER fabricate results per ACTIVE.md BUG-07
      return {
        action,
        namespace,
        results: [],
        total_count: 0,
        governed_status: "CONTROLLED_FAILURE",
        error: "KNOWLEDGE_SERVICE_UNAVAILABLE",
        message: "Local Knowledgebase service is unavailable on localhost:8000.",
      };
    }
  }
}

export const defaultKnowledgeAdapter = new KnowledgeAdapter();

export async function executeGovernedKnowledgeQuery(input, context) {
  return defaultKnowledgeAdapter.queryKnowledge(input, context);
}
