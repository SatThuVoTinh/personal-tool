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

// F-073 (R5-E06-01): the longest wait this adapter will honour from an
// upstream `Retry-After`. Measured at HEAD: `retryDelayMs = seconds * 1000`
// was uncapped, so an upstream answering `429` with `Retry-After: 86400`
// parked an attempt for a day while still holding one of the two process-wide
// search permits; both slots sleeping meant every later `zink_knowledge_search`
// from any agent queued forever and the run died on the host deadline.
export const MAX_KNOWLEDGE_RETRY_AFTER_MS = 30_000;

// F-184 (R1-A14-07): the ceiling for ONE `zink_knowledge_search` call, not per
// attempt. Measured at HEAD: `reqTimeout` was applied to each of up to three
// attempts, so the shipped 120 s default allowed ~364 s (3 x 120 s + backoff)
// inside a run whose `runTimeoutSeconds` is 300 (lib/policy.mjs:549) - the run
// was killed mid-attempt and the host reported GOVERNANCE_COMPLETION_UNAVAILABLE
// - and a caller/model-supplied `timeout` was unbounded. 240 s keeps 60 s of the
// run budget for governance overhead. This module cannot import the plugin's
// policy module (the deployed extension ships only `lib/` and `contracts/`), so
// the relationship is recorded here and pinned by a test.
export const MAX_KNOWLEDGE_CALL_TIMEOUT_MS = 240_000;

/**
 * Resolves the per-CALL budget: the caller's requested timeout, clamped to this
 * module's ceiling.
 *
 * @param {number|undefined} adapterTimeout
 * @param {{timeout?: unknown}} [input]
 * @param {{timeout?: unknown}} [context]
 * @returns {number}
 */
export function resolveKnowledgeCallBudget(adapterTimeout, input, context) {
  const requested = Number(
    input?.timeout ?? context?.timeout ?? adapterTimeout,
  );
  if (Number.isFinite(requested) && requested > 0) {
    return Math.min(requested, MAX_KNOWLEDGE_CALL_TIMEOUT_MS);
  }
  const fallback = Number(adapterTimeout);
  if (Number.isFinite(fallback) && fallback > 0) {
    return Math.min(fallback, MAX_KNOWLEDGE_CALL_TIMEOUT_MS);
  }
  return 120_000;
}

// M06 + F-053 (R1-A03-06): the built-in trusted host set. `allowRemote` used to
// be a blanket off switch for the whole SSRF check
// (`!allowedHosts.has(host) && !this.options.allowRemote`), so a single
// operator flag disabled host validation, silently, on the only outbound path
// that reaches the internal knowledge service. A host outside this set now
// needs an explicit `allowedHosts` entry *and* the `allowRemote`
// acknowledgement, and every admitted non-local endpoint is announced once per
// adapter instead of being used invisibly.
export const KNOWLEDGE_TRUSTED_HOSTS = Object.freeze([
  "localhost",
  "127.0.0.1",
  "host.docker.internal",
  "knowledge-api",
  "personal-tool-knowledge-1",
]);

/**
 * Decides whether an endpoint may be called, and whether that decision was a
 * departure from the built-in trusted set.
 *
 * @param {URL} targetUrl
 * @param {{allowedHosts?: string[], allowRemote?: boolean}} [options]
 * @returns {{allowed: boolean, hostname: string, remote: boolean, acknowledged: boolean, reason?: string}}
 */
export function classifyKnowledgeEndpoint(targetUrl, options = {}) {
  const hostname = targetUrl.hostname;
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return {
      allowed: false,
      hostname,
      remote: false,
      acknowledged: false,
      reason: `Protocol '${targetUrl.protocol}' is forbidden by SSRF policy`,
    };
  }
  const acknowledged = options.allowRemote === true;
  if (KNOWLEDGE_TRUSTED_HOSTS.includes(hostname)) {
    return { allowed: true, hostname, remote: false, acknowledged };
  }
  const explicitlyListed =
    Array.isArray(options.allowedHosts) &&
    options.allowedHosts.includes(hostname);
  if (!explicitlyListed) {
    return {
      allowed: false,
      hostname,
      remote: true,
      acknowledged,
      reason: `SSRF_PROTECTION: Host '${hostname}' is not in trusted allowlist`,
    };
  }
  if (!acknowledged) {
    return {
      allowed: false,
      hostname,
      remote: true,
      acknowledged: false,
      reason: `SSRF_PROTECTION: Host '${hostname}' is allowlisted but not acknowledged; set allowRemote to permit a non-local knowledge endpoint`,
    };
  }
  return { allowed: true, hostname, remote: true, acknowledged: true };
}

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

// The only projection of an upstream failure body that reaches a caller: which
// field of the caller's OWN request was rejected, and by which schema rule.
// `msg`, `input`, `url`, a `detail` that is free text, and any unparseable body
// contribute nothing, because those carry upstream prose — internal module
// paths, database column names, and the echo of what the adapter sent
// (`R5-E06-03`).
const KNOWLEDGE_FAILURE_FIELD = /^[A-Za-z0-9_.-]{1,64}$/u;
const KNOWLEDGE_FAILURE_MAX_FIELDS = 3;
const KNOWLEDGE_FAILURE_MAX_CHARS = 200;

// F-551 (R10-T06-3): the governed code an OBJECT `detail` carries. This reader
// was written for FastAPI's `RequestValidationError` array body and never
// reconciled with the `detail={"code": …}` object bodies the same routes raise
// by hand — 44 of them at HEAD — so every code the Knowledgebase settled on was
// replaced by the status integer one hop after the service produced it
// (`R10-L07-4`). The shape is the allowlist: it is the same predicate the
// producer applies to itself (`_code_shaped`, apps/knowledge/app/main.py), so a
// free-text `detail` still contributes nothing and no upstream sentence can
// ride through this branch.
const KNOWLEDGE_FAILURE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/u;

function projectKnowledgeFailureCode(data) {
  let body;
  try {
    body = JSON.parse(data);
  } catch {
    return "";
  }
  if (!body || typeof body !== "object" || Array.isArray(body.detail)) {
    return "";
  }
  if (!body.detail || typeof body.detail !== "object") return "";
  const { code } = body.detail;
  return typeof code === "string" && KNOWLEDGE_FAILURE_CODE.test(code)
    ? code
    : "";
}

function summarizeKnowledgeFailure(data) {
  let body;
  try {
    body = JSON.parse(data);
  } catch {
    return "";
  }
  if (!body || typeof body !== "object" || !Array.isArray(body.detail)) {
    return "";
  }
  const parts = [];
  for (const item of body.detail) {
    if (parts.length >= KNOWLEDGE_FAILURE_MAX_FIELDS) break;
    if (!item || typeof item !== "object") continue;
    const { type, loc } = item;
    if (typeof type !== "string" || !KNOWLEDGE_FAILURE_FIELD.test(type)) {
      continue;
    }
    const path = (Array.isArray(loc) ? loc : [])
      .filter(
        (segment) =>
          typeof segment === "string" && KNOWLEDGE_FAILURE_FIELD.test(segment),
      )
      .join(".");
    if (!path) continue;
    parts.push(`${path}: ${type}`);
  }
  // The ASCII-only field pattern is what makes a character cap safe here; a
  // byte cap would be the wrong measure for a string that cannot hold
  // multi-byte characters.
  return parts.join("; ").slice(0, KNOWLEDGE_FAILURE_MAX_CHARS);
}

// F-145 (R1-A14-08): the citation a row can actually prove, or "" when it can
// prove none. The provenance gate and the formatter both read it, so the gate
// cannot admit a row the formatter would then have to cite with an invention.
function rowCitation(row) {
  if (typeof row.citation === "string" && row.citation) return row.citation;
  if (typeof row.source_path === "string" && row.source_path) {
    return `${row.source_path}${row.line_start ? `#L${row.line_start}` : ""}`;
  }
  return "";
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
    // F-053 (R1-A03-06): the last non-local host this adapter announced, so a
    // departure from the trusted host set is reported once, not once per call.
    this.announcedRemoteEndpoint = null;
  }

  /**
   * F-053 (R1-A03-06): an admitted non-local endpoint is a bypass of the
   * built-in trusted host set, so it is announced. `onRemoteEndpoint` and
   * `logger.warn` are both optional sinks; the announcement is idempotent per
   * adapter instance.
   *
   * @param {string} hostname
   * @param {boolean} acknowledged
   */
  announceRemoteEndpoint(hostname, acknowledged) {
    if (this.announcedRemoteEndpoint === hostname) return;
    this.announcedRemoteEndpoint = hostname;
    if (typeof this.options.onRemoteEndpoint === "function") {
      this.options.onRemoteEndpoint(hostname);
    }
    if (typeof this.options.logger?.warn === "function") {
      this.options.logger.warn(
        `KNOWLEDGE_ENDPOINT_REMOTE: outbound knowledge calls target non-local host '${hostname}'${
          acknowledged ? " (allowRemote acknowledged)" : ""
        }`,
      );
    }
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

      // M06: SSRF / Host Allowlist Validation. F-053 (R1-A03-06): the check is
      // no longer skippable — `allowRemote` cannot admit a host that is not
      // explicitly allowlisted, and an admitted non-local host is announced.
      const endpointDecision = classifyKnowledgeEndpoint(
        targetUrl,
        this.options,
      );
      if (!endpointDecision.allowed) {
        throw new KnowledgeAdapterError(
          endpointDecision.reason,
          "KNOWLEDGE_ENDPOINT_FORBIDDEN",
        );
      }
      if (endpointDecision.remote) {
        this.announceRemoteEndpoint(
          endpointDecision.hostname,
          endpointDecision.acknowledged,
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
      // F-073 (R5-E06-01): tracked as a flag rather than "did we acquire",
      // because the permit is returned before an upstream-chosen retry wait and
      // re-acquired after it — a sleeping attempt must never occupy a search
      // slot.
      let holdsSearchPermit = shouldAcquireSemaphore;

      try {
        let response;
        const maxAttempts = 3;
        // F-184 (R1-A14-07): one deadline for the whole call. Every attempt is
        // capped to what remains of it and a retry is only taken while budget
        // remains, so no `zink_knowledge_search` can outlive its budget however
        // many attempts it makes.
        const callBudgetMs = resolveKnowledgeCallBudget(
          this.timeout,
          input,
          context,
        );
        const callDeadlineAt = Date.now() + callBudgetMs;
        const perAttemptCapMs =
          Number(this.timeout) > 0 ? Number(this.timeout) : 120_000;
        const remainingBudgetMs = () => callDeadlineAt - Date.now();

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptTimeoutMs = Math.max(
            1,
            Math.min(perAttemptCapMs, remainingBudgetMs()),
          );
          const isPost = action === "search";
          const reqHeaders = {};
          if (isPost) {
            reqHeaders["Content-Type"] = "application/json";
            reqHeaders["Content-Length"] = Buffer.byteLength(requestPayload);
          }

          // M07: Auth binding.
          //
          // F-029 (R1-A10-04): the bearer token came from
          // `this.options.apiKey || input.api_key || env`, so a model-supplied
          // `api_key` in the tool payload became the credential on the only
          // outbound internal-service call this adapter makes. The token is
          // now the governance-supplied one (the adapter's own option) or the
          // operator's environment; the payload never supplies it.
          const apiKey = this.options.apiKey || process.env.KNOWLEDGE_API_KEY;
          if (apiKey) {
            reqHeaders["Authorization"] = `Bearer ${apiKey}`;
          }

          // M17 + F-103 (R2-B01-02): identity and correlation come from the
          // trusted runtime context only. Measured at HEAD: `if (context.agentId)`
          // never fired on the live path (the plugin derives the trusted identity
          // and stores it as `requestingAgent`, `index.mjs:3565`), so every
          // governed call reached the service with no identity, while `X-Task-Id`
          // forwarded `params.task_id` — a declared tool parameter the model
          // supplies (`index.mjs:3549-3563`) — as bare correlation. Identity is
          // now read from the key the runtime actually writes, and a task id the
          // caller's own payload named is not forwarded as the task this call is
          // attributed to: this seam has no ledger to bind it against.
          const trustedAgent =
            typeof context.requestingAgent === "string" &&
            context.requestingAgent.trim()
              ? context.requestingAgent.trim()
              : typeof context.agentId === "string" && context.agentId.trim()
                ? context.agentId.trim()
                : "";
          if (trustedAgent) reqHeaders["X-Agent-Id"] = trustedAgent;
          const payloadNamedTaskId =
            typeof input?.task_id === "string" && input.task_id.trim()
              ? input.task_id.trim()
              : "";
          if (context.taskId && !payloadNamedTaskId) {
            reqHeaders["X-Task-Id"] = String(context.taskId);
          }
          if (context.attemptToken)
            reqHeaders["X-Attempt-Token"] = String(context.attemptToken);

          response = await new Promise((resolve, reject) => {
            // F-184 (R1-A14-07): ECONNREFUSED/ECONNRESET - the common
            // container-restart case - used to reject straight out of the retry
            // loop, so the most frequent transient failure got no retry at all
            // while the rarest (a 503) was retried three times. A transport error
            // is now a retryable outcome like any other: it resolves as a
            // status-less response, and the original error is re-thrown once the
            // attempts or the budget are exhausted, so the caller-visible
            // CONTROLLED_FAILURE / KNOWLEDGE_SERVICE_UNAVAILABLE is unchanged.
            let settled = false;
            const settle = (fn, value) => {
              if (settled) return;
              settled = true;
              fn(value);
            };
            const req = client.request(
              targetUrl,
              {
                method: isPost ? "POST" : "GET",
                headers: reqHeaders,
                timeout: attemptTimeoutMs,
              },
              (res) => {
                // M08 + F-170 (R5-E06-02): the ceiling is named in BYTES, so the
                // body is accumulated as bytes. `data += chunk` decoded every
                // chunk on its own — a multi-byte character spanning two chunks
                // became U+FFFD — and `data.length` counted UTF-16 code units,
                // so ~150 MB of Vietnamese text fitted under a 50 MB ceiling and
                // the corrupted body was then parsed, formatted and counted as
                // SUCCESS.
                const chunks = [];
                let receivedBytes = 0;
                let aborted = false;
                res.on("data", (chunk) => {
                  if (aborted) return;
                  const buffer = Buffer.isBuffer(chunk)
                    ? chunk
                    : Buffer.from(String(chunk), "utf8");
                  receivedBytes += buffer.length;
                  if (receivedBytes > MAX_KNOWLEDGE_RESPONSE_BYTES) {
                    aborted = true;
                    chunks.length = 0;
                    req.destroy();
                    settle(
                      reject,
                      new KnowledgeAdapterError(
                        "Upstream response exceeded 50MB ceiling",
                        "KNOWLEDGE_RESPONSE_TOO_LARGE",
                      ),
                    );
                    return;
                  }
                  chunks.push(buffer);
                });
                res.on("end", () => {
                  if (aborted) return;
                  settle(resolve, {
                    status: res.statusCode,
                    headers: res.headers,
                    data: Buffer.concat(chunks).toString("utf8"),
                  });
                });
              },
            );
            req.on("error", (err) =>
              settle(resolve, {
                status: 0,
                headers: {},
                data: "",
                transportError: err,
              }),
            );
            req.on("timeout", () => {
              req.destroy();
              settle(
                reject,
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

          // M09 & M10: Respect Retry-After header with configurable jitter.
          // F-184 (R1-A14-07): a transport failure (status 0) is retryable, and
          // each attempt is bounded by the call budget rather than by a
          // per-attempt timeout of its own.
          const retryableOutcome =
            response.status === 0 ||
            response.status === 429 ||
            response.status === 503 ||
            response.status === 504;
          if (retryableOutcome && attempt < maxAttempts) {
            let retryDelayMs = attempt * 1500;
            const retryHeader = response.headers?.["retry-after"];
            if (retryHeader) {
              const seconds = parseInt(retryHeader, 10);
              if (!isNaN(seconds) && seconds > 0) {
                // F-073 (R5-E06-01): clamped, because an upstream-chosen wait
                // is not a repo-owned ceiling. The permit is returned before
                // the wait begins, below.
                retryDelayMs = Math.min(
                  seconds * 1000,
                  MAX_KNOWLEDGE_RETRY_AFTER_MS,
                );
              }
            }
            const jitterMs =
              typeof this.options.jitterFn === "function"
                ? this.options.jitterFn(attempt)
                : this.options.deterministicRetry
                  ? attempt * 200
                  : Math.floor(Math.random() * 1000);

            const remainingBeforeWaitMs = remainingBudgetMs();
            if (remainingBeforeWaitMs <= 0) break;
            if (holdsSearchPermit) {
              sharedSearchSemaphore.release();
              holdsSearchPermit = false;
            }
            // F-184 (R1-A14-07): the wait never outlives the call budget.
            await setTimeout(
              Math.min(retryDelayMs + jitterMs, remainingBeforeWaitMs),
            );
            if (remainingBudgetMs() <= 0) break;
            if (shouldAcquireSemaphore) {
              await sharedSearchSemaphore.acquire();
              holdsSearchPermit = true;
            }
            continue;
          }
          break;
        }

        if (response.status === 0) {
          // F-184 (R1-A14-07): the transport never produced an HTTP status. The
          // original error is re-thrown so the outer catch keeps mapping this to
          // CONTROLLED_FAILURE / KNOWLEDGE_SERVICE_UNAVAILABLE.
          throw (
            response.transportError ??
            new Error("Knowledge transport failure without a status")
          );
        }

        if (response.status >= 200 && response.status < 300) {
          const parsed = JSON.parse(response.data);
          const rawResults = parsed.results || [];

          // F-145 (R1-A14-08): provenance is the guarantee this module exists
          // to enforce. HEAD substituted `chunk_id: ... || "unknown"`,
          // `title: ... || "Untitled"` and an empty citation for a row that
          // carried none, counted that row in `total_count` and returned the
          // envelope under `governed_status: "SUCCESS"`, so an uncited row read
          // as retrieved evidence. A row with no chunk identity and no citation
          // is not evidence; refusing it is reported, never silent.
          const provenanceRows = [];
          let unprovenancedRows = 0;
          for (const raw of rawResults) {
            if (!raw || typeof raw !== "object") {
              unprovenancedRows += 1;
              continue;
            }
            if (!(raw.segment_id || raw.chunk_id) || !rowCitation(raw)) {
              unprovenancedRows += 1;
              continue;
            }
            provenanceRows.push(raw);
          }
          if (unprovenancedRows > 0) {
            return {
              action,
              namespace: namespace || "core",
              results: [],
              total_count: 0,
              governed_status: "CONTROLLED_FAILURE",
              error: "KNOWLEDGE_PROVENANCE_MISSING",
              message: `${unprovenancedRows} of ${rawResults.length} retrieved rows carried no chunk identity or no citation; such a row is never returned as evidence.`,
            };
          }

          // M12, M13, M15: Schema validation and per-result bounding
          const formattedResults = provenanceRows.map((r) => {
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
              // F-125 (R1-A10-03): the declared output item types the chunk
              // id as a string. An upstream id that arrived as a number was
              // copied through unchanged, so the envelope could not pass the
              // tool's own output contract.
              chunk_id: String(r.segment_id || r.chunk_id),
              title: typeof r.title === "string" ? r.title : "",
              text: boundedText,
              score: validScore,
              citation: rowCitation(r),
              // F-125 (R1-A10-03): a key whose value is `undefined` is still
              // a key, and the contract's closed metadata object refused it
              // (the wire would have dropped it, the validated object would
              // not). Only the values the upstream actually carried are
              // emitted.
              metadata: {
                ...(typeof r.source_path === "string"
                  ? { source_path: r.source_path }
                  : {}),
                heading_path: headingPath,
                ...(typeof r.source_type === "string"
                  ? { source_type: r.source_type }
                  : {}),
                // F-570 (R10-T10-1): the identity the service publishes on the
                // item is forwarded, not re-invented. Without it a governed
                // agent holding a citation could not re-verify the source it
                // came from: a moved or edited file produced an identical
                // citation string with no digest anywhere in the envelope. A
                // digest that is not one is dropped rather than carried — the
                // declared pattern is the guard, and the envelope answers with
                // `null` instead of an upstream sentence.
                source_id:
                  typeof r.source_id === "string" && r.source_id
                    ? r.source_id
                    : null,
                source_sha256:
                  typeof r.source_sha256 === "string" &&
                  /^[a-f0-9]{64}$/u.test(r.source_sha256)
                    ? r.source_sha256
                    : null,
                line_start:
                  typeof r.line_start === "number" ? r.line_start : null,
                line_end: typeof r.line_end === "number" ? r.line_end : null,
                page_start:
                  typeof r.page_start === "number" ? r.page_start : null,
                page_end: typeof r.page_end === "number" ? r.page_end : null,
              },
            };
          });

          // F-571 (R10-T10-2): pool and page are the SERVICE's answer, not this
          // module's. M14 set `total_count` to the number of rows it formatted,
          // which is exactly the reading F-132/F-140/F-514 removed at the
          // service: a candidate pool of 20 cut to a two-row page read as "two
          // matches exist". The five completeness fields the service publishes
          // are forwarded, and only the ones it actually carried are emitted — a
          // key whose value is `undefined` is still a key, and the closed output
          // object refuses it (F-125). A signal that arrives out of shape is
          // dropped rather than passed through, so the envelope cannot carry an
          // upstream value its own contract would reject.
          const counts = {};
          if (Number.isInteger(parsed.total_count) && parsed.total_count >= 0) {
            counts.total_count = parsed.total_count;
          } else {
            counts.total_count = formattedResults.length;
          }
          if (
            Number.isInteger(parsed.returned_count) &&
            parsed.returned_count >= 0
          ) {
            counts.returned_count = parsed.returned_count;
          }
          if (typeof parsed.has_more === "boolean") {
            counts.has_more = parsed.has_more;
          }
          if (
            Number.isInteger(parsed.candidate_pool_count) &&
            parsed.candidate_pool_count >= 0
          ) {
            counts.candidate_pool_count = parsed.candidate_pool_count;
          }
          if (typeof parsed.truncated === "boolean") {
            counts.truncated = parsed.truncated;
          }

          return {
            action,
            namespace: namespace || "core",
            semantic_contract_version:
              parsed.semantic_contract_version || "zink-semantic-v2",
            results: formattedResults,
            ...counts,
            governed_status:
              formattedResults.length === 0 ? "NO_MATCH" : "SUCCESS",
          };
        }

        // M11: the failure envelope carries a fixed code and a field
        // projection, never upstream response bytes.
        // F-551 (R10-T06-3): the code the service raised names the failure when
        // it carried one; the status integer is the fallback, not the default.
        const failureCode = projectKnowledgeFailureCode(response.data);
        const summary = summarizeKnowledgeFailure(response.data);

        return {
          action,
          namespace: namespace || "core",
          results: [],
          total_count: 0,
          governed_status: "CONTROLLED_FAILURE",
          error: failureCode || `HTTP_${response.status}`,
          message: summary
            ? `Knowledge service rejected the request (HTTP ${response.status}). Rejected fields: ${summary}.`
            : `Knowledge service failed the request (HTTP ${response.status}); its response body is not forwarded.`,
        };
      } finally {
        if (holdsSearchPermit) {
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
        // F-145 (R1-A14-08): the fixed sentence, never `error.message`. A
        // JSON.parse SyntaxError quotes the upstream body it choked on, and a
        // socket error names the host and port; both reached the caller, and
        // therefore the model and the cards, as failure text.
        message: "Knowledgebase service is unavailable.",
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
