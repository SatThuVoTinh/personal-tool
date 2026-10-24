import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { N8N_WORKFLOW_REGISTRY } from "../../integrations/openclaw/lib/policy.mjs";

// F-451 (R9-L07b-2): the output bound is the published contract, not a
// hand-copied second vocabulary. The adapter used to check only "non-empty
// string", so an upstream envelope that exceeded `maxLength` or carried an
// undeclared key was reported as success and only rejected by the guard AFTER
// the POST had fired. Reading the same definition the contract publishes makes
// the adapter and the post-dispatch guard answer one question.
const N8N_CONTRACT = JSON.parse(
  readFileSync(
    new URL("../contracts/tools/zink-n8n.schema.json", import.meta.url),
    "utf8",
  ),
);

/**
 * The published output-data definition for one workflow.
 *
 * @param {string} workflowId
 * @returns {object|undefined}
 */
function outputDataDefinition(workflowId) {
  return N8N_CONTRACT.$defs[`${workflowId}_output_data`];
}

/**
 * The string bounds the guard applies: a minimum in code points and a maximum
 * in UTF-8 bytes, because governance ceilings are bytes (schema.mjs).
 *
 * @param {unknown} value
 * @param {object} rule
 * @returns {boolean}
 */
function satisfiesStringBounds(value, rule) {
  if (typeof value !== "string") return false;
  if ([...value].length < (rule.minLength ?? 0)) return false;
  if (
    rule.maxLength !== undefined &&
    Buffer.byteLength(value, "utf8") > rule.maxLength
  ) {
    return false;
  }
  return true;
}

/**
 * Enforces the published object definition: declared keys only, required
 * keys present, and the field bounds the contract states.
 *
 * @param {object|undefined} definition
 * @param {unknown} data
 * @returns {boolean}
 */
function satisfiesOutputDefinition(definition, data) {
  if (!definition || !data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const properties = definition.properties ?? {};
  if (definition.additionalProperties === false) {
    for (const key of Object.keys(data)) {
      if (!Object.hasOwn(properties, key)) return false;
    }
  }
  for (const key of definition.required ?? []) {
    if (!Object.hasOwn(data, key)) return false;
  }
  for (const [key, rule] of Object.entries(properties)) {
    if (!Object.hasOwn(data, key)) continue;
    const value = data[key];
    if (rule.type === "string") {
      if (!satisfiesStringBounds(value, rule)) return false;
      continue;
    }
    if (rule.type === "integer") {
      if (!Number.isSafeInteger(value)) return false;
      if (rule.minimum !== undefined && value < rule.minimum) return false;
      if (rule.maximum !== undefined && value > rule.maximum) return false;
      continue;
    }
    if (rule.type === "boolean") {
      if (typeof value !== "boolean") return false;
      continue;
    }
    if (rule.type === "array") {
      if (!Array.isArray(value)) return false;
      for (const item of value) {
        if (rule.items?.type === "string") {
          if (!satisfiesStringBounds(item, rule.items)) return false;
        } else if (rule.items?.type && typeof item !== rule.items.type) {
          return false;
        }
      }
      continue;
    }
    return false;
  }
  return true;
}

export class N8nAdapterError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "N8nAdapterError";
    this.code = code;
  }
}

/**
 * F-235 (R7-D5-01): the workflow's own state, mapped to an outcome.
 *
 * Measured at HEAD: `validateWorkflowOutputData` required only a non-empty
 * `data.status` string and the success envelope was returned unconditionally
 * afterwards, so a workflow that had merely ACCEPTED a job ("accepted",
 * "queued", "pending") was reported to the owner as completed work.
 *
 * The vocabulary below is the conservative reading: only a state that names
 * completion is terminal success, only a state that names failure is terminal
 * failure, and everything else is PENDING. The contract declares `status` as
 * a free string, so an unrecognised state is pending rather than success.
 */
export const N8N_TERMINAL_SUCCESS_STATES = Object.freeze([
  "completed",
  "complete",
  "success",
  "succeeded",
  "finished",
  "done",
]);

export const N8N_TERMINAL_FAILURE_STATES = Object.freeze([
  "failed",
  "failure",
  "error",
  "cancelled",
  "canceled",
  "aborted",
]);

/**
 * Classifies a workflow's reported state.
 *
 * @param {string} state
 * @returns {"success"|"failure"|"pending"}
 */
export function classifyWorkflowState(state) {
  if (typeof state !== "string") return "pending";
  const normalized = state.trim().toLowerCase();
  if (N8N_TERMINAL_SUCCESS_STATES.includes(normalized)) return "success";
  if (N8N_TERMINAL_FAILURE_STATES.includes(normalized)) return "failure";
  return "pending";
}

/**
 * F-451 (R9-L07b-2): the adapter validates the upstream data against the
 * definition the contract publishes, so the response cannot be reported as a
 * success envelope and only rejected later by the post-dispatch guard.
 */
function validateWorkflowOutputData(workflowId, data) {
  return satisfiesOutputDefinition(outputDataDefinition(workflowId), data);
}

/**
 * The outcome the workflow's own data describes.
 *
 * @param {string} workflowId
 * @param {object} data
 * @returns {"success"|"failure"|"pending"|null} null when the data is invalid
 */
export function classifyWorkflowOutcome(workflowId, data) {
  if (!validateWorkflowOutputData(workflowId, data)) return null;
  if (workflowId === "pipeline_notify") {
    // The notification workflow reports completion with a boolean, and the
    // boolean is the completion signal.
    return data.delivered === true ? "success" : "failure";
  }
  return classifyWorkflowState(data.status);
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

    // F-235 (R7-D5-01): the workflow's own state decides the outcome. A job
    // that has only been accepted is not completed work, so it is reported as
    // pending and NEVER as a success envelope.
    const outcome = classifyWorkflowOutcome(input.workflow_id, parsed.data);
    if (outcome === "failure") {
      throw new N8nAdapterError(
        "N8N_UPSTREAM_ERROR",
        "Upstream workflow reported a terminal failure.",
      );
    }
    if (outcome === "pending") {
      // The envelope's status vocabulary is pinned to
      // success | error | timeout | cancelled (tests/m9-t1:1079-1083), so a
      // pending outcome is carried in the `error` member under its own code
      // rather than as a fifth status value. It is still a refusal to report
      // completed work, and the code names the state.
      return {
        call_id: decisionContext.correlation.call_id,
        tool_id: decisionContext.scope.common.toolId,
        specialist: decisionContext.scope.common.agentId,
        status: "error",
        error: {
          code: "N8N_WORKFLOW_PENDING",
          message: `Upstream workflow is not terminal (state '${parsed.data.status ?? "pending"}'); the run is queued, not completed.`,
        },
        artifacts: [],
      };
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
