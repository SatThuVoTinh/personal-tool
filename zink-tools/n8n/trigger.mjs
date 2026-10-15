import { Buffer } from "node:buffer";
import { N8N_WORKFLOW_REGISTRY } from "../../integrations/openclaw/lib/policy.mjs";

export class N8nAdapterError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "N8nAdapterError";
    this.code = code;
  }
}

function validateWorkflowOutputData(workflowId, data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  if (workflowId === "data_plant_ingest") {
    if (typeof data.ingest_id !== "string" || data.ingest_id.length === 0)
      return false;
    if (typeof data.status !== "string" || data.status.length === 0)
      return false;
    if (
      data.records_ingested !== undefined &&
      (!Number.isSafeInteger(data.records_ingested) ||
        data.records_ingested < 0)
    )
      return false;
    return true;
  }
  if (workflowId === "data_plant_sync") {
    if (typeof data.sync_id !== "string" || data.sync_id.length === 0)
      return false;
    if (typeof data.status !== "string" || data.status.length === 0)
      return false;
    if (
      data.synced_tables !== undefined &&
      (!Array.isArray(data.synced_tables) ||
        !data.synced_tables.every((t) => typeof t === "string"))
    )
      return false;
    return true;
  }
  if (workflowId === "pipeline_notify") {
    if (typeof data.delivered !== "boolean") return false;
    if (
      data.notification_id !== undefined &&
      typeof data.notification_id !== "string"
    )
      return false;
    return true;
  }
  return false;
}

/**
 * Triggers a governed n8n workflow over loopback HTTP POST.
 *
 * @param {object} decisionContext - Frozen authorization decision context
 * @param {object} input - Input containing workflow_id and payload
 * @param {object} [options] - Injectable options for testing
 * @returns {Promise<object>} - Validated tool-result envelope
 */
export async function invokeN8n(
  decisionContext,
  input,
  { fetchImpl = globalThis.fetch } = {},
) {
  // 1. Admissibility Verification
  if (decisionContext?.scope?.common?.toolId !== "zink_n8n") {
    throw new N8nAdapterError(
      "RUNTIME_CAPABILITY_MISMATCH",
      "Invalid tool ID for n8n adapter.",
    );
  }

  const workflow = N8N_WORKFLOW_REGISTRY[input?.workflow_id];
  if (!workflow) {
    throw new N8nAdapterError(
      "RUNTIME_CAPABILITY_MISMATCH",
      "Unknown workflow ID.",
    );
  }

  const callerAgentId = decisionContext.scope.common.agentId;
  if (!workflow.allowedAgents.includes(callerAgentId)) {
    throw new N8nAdapterError(
      "AUTH_POLICY_DENIED",
      "Agent not permitted to trigger this workflow.",
    );
  }

  // 2. Canonical Origin Validation & URL Parsing
  let url;
  try {
    url = new URL(process.env.N8N_WEBHOOK_BASE_URL || "http://127.0.0.1:5678");
  } catch {
    throw new N8nAdapterError(
      "N8N_CONFIGURATION_INVALID",
      "Invalid N8N_WEBHOOK_BASE_URL environment variable.",
    );
  }

  if (
    url.origin !== "http://127.0.0.1:5678" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new N8nAdapterError(
      "N8N_CONFIGURATION_INVALID",
      "Invalid n8n loopback origin configuration.",
    );
  }

  const targetUrl = url.origin + workflow.path;

  // 3. Deterministic UTF-8 JSON Serialization for Request Size (64KB ceiling)
  let bodyStr;
  try {
    bodyStr = JSON.stringify(input.payload);
  } catch {
    throw new N8nAdapterError(
      "SCHEMA_VALIDATION_FAILED",
      "Payload JSON serialization failed.",
    );
  }

  if (Buffer.byteLength(bodyStr, "utf8") > 65536) {
    throw new N8nAdapterError(
      "SCHEMA_VALIDATION_FAILED",
      "Payload exceeds 64KB ceiling.",
    );
  }

  // 4. Header Policy & Correlation
  const headers = {
    "Content-Type": "application/json",
    "X-Correlation-ID": decisionContext.correlation.call_id,
  };

  // 5. Execution Order, Timeout Signal & Dispatch
  const effectiveTimeoutMs =
    decisionContext.effective_constraints?.timeout_ms ?? 30000;
  const timeoutSignal = AbortSignal.timeout(effectiveTimeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(targetUrl, {
        method: "POST",
        headers,
        body: bodyStr,
        redirect: "error",
        signal: timeoutSignal,
      });
    } catch (fetchErr) {
      if (
        fetchErr.name === "TypeError" &&
        fetchErr.message.includes("redirect")
      ) {
        throw new N8nAdapterError(
          "N8N_REDIRECT_BLOCKED",
          "HTTP redirects are forbidden.",
        );
      }
      throw fetchErr;
    }

    // Check for HTTP 3xx redirect status
    if (response.status >= 300 && response.status < 400) {
      throw new N8nAdapterError(
        "N8N_REDIRECT_BLOCKED",
        "HTTP redirects are forbidden.",
      );
    }

    if (!response.ok) {
      throw new N8nAdapterError(
        "N8N_UPSTREAM_ERROR",
        `Upstream returned status ${response.status}`,
      );
    }

    // Pre-stream Content-Length check
    const contentLength = response.headers?.get?.("content-length");
    if (
      contentLength &&
      /^\d+$/u.test(contentLength) &&
      Number(contentLength) > 1048576
    ) {
      throw new N8nAdapterError(
        "N8N_RESPONSE_TOO_LARGE",
        "Content-Length exceeds 1MB limit.",
      );
    }

    // Exact media type check
    const contentType = response.headers?.get?.("content-type") || "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      throw new N8nAdapterError(
        "N8N_UPSTREAM_ERROR",
        "Invalid content-type from upstream.",
      );
    }

    if (response.body === null) {
      throw new N8nAdapterError("N8N_TRANSPORT_ERROR", "Null response body.");
    }

    // Stream body via reader with fatal UTF-8 decoding and 1MB limit
    let bodyText = "";
    if (typeof response.body?.getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > 1048576) {
            throw new N8nAdapterError(
              "N8N_RESPONSE_TOO_LARGE",
              "Maximum consumed response-body bytes (1MB) exceeded.",
            );
          }
          try {
            bodyText += decoder.decode(value, { stream: true });
          } catch {
            throw new N8nAdapterError(
              "N8N_UPSTREAM_ERROR",
              "Malformed UTF-8 sequence from upstream.",
            );
          }
        }
        try {
          bodyText += decoder.decode();
        } catch {
          throw new N8nAdapterError(
            "N8N_UPSTREAM_ERROR",
            "Malformed UTF-8 sequence from upstream.",
          );
        }
      } catch (streamErr) {
        await reader.cancel().catch(() => {});
        throw streamErr;
      } finally {
        reader.releaseLock();
      }
    } else if (typeof response.text === "function") {
      bodyText = await response.text();
      if (Buffer.byteLength(bodyText, "utf8") > 1048576) {
        throw new N8nAdapterError(
          "N8N_RESPONSE_TOO_LARGE",
          "Maximum consumed response-body bytes (1MB) exceeded.",
        );
      }
    } else {
      throw new N8nAdapterError(
        "N8N_TRANSPORT_ERROR",
        "Unsupported response body stream.",
      );
    }

    // Malformed JSON check
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      throw new N8nAdapterError(
        "N8N_UPSTREAM_ERROR",
        "Malformed JSON from upstream.",
      );
    }

    // Upstream domain output validation
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new N8nAdapterError(
        "SCHEMA_VALIDATION_FAILED",
        "Upstream response must be an object.",
      );
    }

    const rootKeys = Object.keys(parsed);
    if (
      rootKeys.length !== 1 ||
      rootKeys[0] !== "data" ||
      parsed.data === null ||
      typeof parsed.data !== "object" ||
      Array.isArray(parsed.data)
    ) {
      throw new N8nAdapterError(
        "SCHEMA_VALIDATION_FAILED",
        "Upstream response must only contain 'data' object.",
      );
    }

    if (!validateWorkflowOutputData(input.workflow_id, parsed.data)) {
      throw new N8nAdapterError(
        "SCHEMA_VALIDATION_FAILED",
        "Upstream domain data failed schema validation.",
      );
    }

    // Construct and return trusted tool-result envelope
    return {
      call_id: decisionContext.correlation.call_id,
      tool_id: decisionContext.scope.common.toolId,
      specialist: decisionContext.scope.common.agentId,
      status: "success",
      output: {
        workflow_id: input.workflow_id,
        data: parsed.data,
      },
      artifacts: [],
    };
  } catch (err) {
    if (err instanceof N8nAdapterError) {
      throw err;
    }
    if (
      timeoutSignal.aborted &&
      timeoutSignal.reason?.name === "TimeoutError"
    ) {
      throw new N8nAdapterError("N8N_TIMEOUT", "Adapter timeout.");
    }
    if (
      err.name === "AbortError" ||
      (timeoutSignal.aborted && err.name === "TimeoutError")
    ) {
      throw new N8nAdapterError("N8N_TIMEOUT", "Adapter timeout.");
    }
    const networkCode = err?.code ?? err?.cause?.code;
    if (networkCode === "ECONNREFUSED" || networkCode === "ENOTFOUND") {
      throw new N8nAdapterError("N8N_UNAVAILABLE", "n8n server unavailable.");
    }
    if (networkCode === "ECONNRESET") {
      throw new N8nAdapterError("N8N_TRANSPORT_ERROR", "Connection reset.");
    }
    // Sanitized diagnostic error message
    throw new N8nAdapterError(
      "N8N_TRANSPORT_ERROR",
      "Network transport error.",
    );
  }
}
