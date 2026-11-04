// F-552 (R10-T06-4): the retry verdict is the governed code's, not the status
// integer's.
//
// The service answers a code with one status and one retry verdict
// (`GOVERNED_LIFECYCLE_ERRORS`, apps/knowledge/app/main.py), but the caller
// decided retry from the status set `[0, 429, 503, 504]`. So the same permanent
// `EMBEDDING_MODEL_DRIFT` — 503 on `/v1/search` before the table landed, 409 on
// `/v1/index-runs` — was retried three times on one route and never on the
// other, and any route that re-diverged on a status would silently change how
// many times the agent hammered a permanent configuration fault.
//
// Two halves: the adapter's table must equal the service's (parsed from the
// Python source, so the two cannot drift), and the retry count must follow the
// code — with the status as the fallback for a response that carries none.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";

import {
  GOVERNED_LIFECYCLE_RETRYABLE,
  RETRYABLE_KNOWLEDGE_STATUS_CODES,
  executeGovernedKnowledgeQuery,
} from "../zink-tools/adapters/knowledge/knowledge-adapter.mjs";

const SERVICE_MAIN = path.resolve("apps/knowledge/app/main.py");

/** The service's own table, read from the source that owns it. */
function serviceLifecycleTable() {
  const source = fs.readFileSync(SERVICE_MAIN, "utf8");
  const block =
    /GOVERNED_LIFECYCLE_ERRORS:[^=]*=\s*\{(?<body>[\s\S]*?)\n\}/u.exec(source);
  assert.ok(block, "the service must declare GOVERNED_LIFECYCLE_ERRORS");
  const rows = new Map();
  for (const match of block.groups.body.matchAll(
    /"([A-Z][A-Z0-9_]{0,63})":\s*\((\d+),\s*(True|False)\),/gu,
  )) {
    rows.set(match[1], {
      status: Number(match[2]),
      retryable: match[3] === "True",
    });
  }
  return rows;
}

/**
 * Call the adapter against a loopback service that answers the same refusal
 * every time, and report how many attempts it took.
 *
 * The backoff waits are not what these cases measure, so a negative jitter
 * clamps every wait to an immediate timer; the attempt count is the observable.
 */
async function attemptsAgainst(status, body) {
  let attempts = 0;
  const server = http.createServer((_req, res) => {
    attempts += 1;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await executeGovernedKnowledgeQuery(
      { action: "search", namespace: "core", query: "topic" },
      {},
      { endpoint, jitterFn: (attempt) => -attempt * 1500 },
    );
    return { attempts, result };
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

const refusal = (code) => ({ detail: { code } });

test("F-552: the adapter's retry table is the service's table, code for code", () => {
  const service = serviceLifecycleTable();
  assert.ok(service.size > 0, "the service table must parse with its rows");
  assert.deepEqual(
    Object.keys(GOVERNED_LIFECYCLE_RETRYABLE).sort(),
    [...service.keys()].sort(),
    "every governed code must have one retry verdict in the adapter",
  );
  for (const [code, row] of service) {
    assert.equal(
      GOVERNED_LIFECYCLE_RETRYABLE[code],
      row.retryable,
      `${code}: the adapter must retry exactly when the service says it is retryable`,
    );
  }
});

test("F-552: EMBEDDING_MODEL_DRIFT carries one status and one retry verdict", () => {
  const drift = serviceLifecycleTable().get("EMBEDDING_MODEL_DRIFT");
  assert.ok(drift, "the drift code must have a service row");
  assert.equal(drift.status, 409, "the drift is a conflict, not an outage");
  assert.equal(
    GOVERNED_LIFECYCLE_RETRYABLE.EMBEDDING_MODEL_DRIFT,
    false,
    "a permanent model swap must be reported, never retried",
  );
});

test("F-552: a refusal the code calls permanent is not retried, whatever its status", async () => {
  for (const status of [503, 409]) {
    const { attempts, result } = await attemptsAgainst(
      status,
      refusal("EMBEDDING_MODEL_DRIFT"),
    );
    assert.equal(
      attempts,
      1,
      `EMBEDDING_MODEL_DRIFT at ${status} must fail after one attempt`,
    );
    assert.equal(result.governed_status, "CONTROLLED_FAILURE");
    assert.equal(
      result.error,
      "EMBEDDING_MODEL_DRIFT",
      "the envelope must name the governed code, not the status integer",
    );
  }
});

test("F-552: a refusal the code calls transient is retried, whatever its status", async () => {
  for (const status of [503, 409]) {
    const { attempts, result } = await attemptsAgainst(
      status,
      refusal("VAULT_UNAVAILABLE"),
    );
    assert.equal(
      attempts,
      3,
      `VAULT_UNAVAILABLE at ${status} must use the whole attempt budget`,
    );
    assert.equal(result.error, "VAULT_UNAVAILABLE");
  }
});

test("F-552: a response with no governed code still falls back to the status", async () => {
  const retryable = await attemptsAgainst(503, refusal("NOT_A_GOVERNED_CODE"));
  assert.equal(
    retryable.attempts,
    3,
    "an unclassified 503 keeps the transport fallback",
  );
  assert.equal(retryable.result.error, "NOT_A_GOVERNED_CODE");

  const permanent = await attemptsAgainst(409, refusal("NOT_A_GOVERNED_CODE"));
  assert.equal(permanent.attempts, 1, "an unclassified 409 is not retried");

  const emptyBody = await attemptsAgainst(503, {});
  assert.equal(
    emptyBody.attempts,
    3,
    "a body with no code at all keeps the transport fallback",
  );
  assert.equal(emptyBody.result.error, "HTTP_503");
});

test("F-552: the fallback set is exactly the transport facts it names", () => {
  assert.deepEqual([...RETRYABLE_KNOWLEDGE_STATUS_CODES], [0, 429, 503, 504]);
});
