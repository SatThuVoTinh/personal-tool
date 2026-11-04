// M12/T9-R4 F-535 (legacy R10-T02-5), plugin half — the brief-activation seam
// stamps `validation_digest` with the name of `agent-result-payload.schema.
// json`, but no ingestion seam ever executed that schema. The fix: the
// ingested result envelope is validated with the real
// `validateContract("agent-result-payload", payload)` BEFORE any queue or
// ledger state moves, and a schema-invalid envelope refuses the whole result.
//
// The §9 contradiction half of the row (docs/contracts/coordinator-session-
// binding.md:278-288 vs the shipped execution_finished ingestion) is an owner
// decision on a lead-only file and is reported, not fixed here.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const load = async (rel) =>
  import(`file:///${path.join(REPO_ROOT, rel).replaceAll("\\", "/")}`);

const plugin = await load(
  "integrations/openclaw/plugins/zink-governance/index.mjs",
);
const { QueueManager } = await load(
  "integrations/openclaw/lib/queue-manager.mjs",
);

const VALID_PAYLOAD = Object.freeze({
  schema_version: "1.0.0",
  governance_version: "m8-t2.3-r5",
  outcome_claim: "COMPLETE",
  reason_claim: "NONE",
  output: "done",
  assumptions: [],
  limitations: [],
  requested_prerequisites: [],
  agent_self_validation: "ok",
});

function fixture(tag) {
  const dir = mkdtempSync(path.join(os.tmpdir(), `f535-${tag}-`));
  const queueManager = new QueueManager({
    storagePath: path.join(dir, "queue.json"),
  });
  queueManager.enqueueTask({ taskId: `t-${tag}`, primaryCoordinator: "o1" });
  const claim = queueManager.claimTaskById({
    taskId: `t-${tag}`,
    agentId: "o1",
  });
  const artifact = path.join(dir, "result.csv");
  writeFileSync(artifact, "date,revenue\n2026-01-01,10\n", "utf8");
  return { dir, queueManager, claim, artifact, taskId: `t-${tag}` };
}

function finish(f, resultPayload) {
  return plugin.handleExecutionFinished({
    taskId: f.taskId,
    agentId: "o1",
    leaseId: f.claim.leaseId,
    attempt: f.claim.task.attempt,
    artifacts: [f.artifact],
    queueManager: f.queueManager,
    ...(resultPayload === undefined ? {} : { resultPayload }),
  });
}

test("F-535: a schema-invalid result envelope refuses the result before any state moves", () => {
  const f = fixture("invalid");
  try {
    const res = finish(f, { ...VALID_PAYLOAD, outcome_claim: "MAYBE_DONE" });
    assert.equal(res.status, "FAILED", "an invalid envelope must be refused");
    assert.match(
      String(res.error),
      /RESULT_PAYLOAD_SCHEMA_INVALID/u,
      "the refusal must name the schema validation",
    );
    assert.notEqual(
      f.queueManager.getTask(f.taskId).status,
      "RESULT_PENDING_REVIEW",
      "a refused envelope must not move the queue",
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("F-535: a schema-valid result envelope is still recorded", () => {
  const f = fixture("valid");
  try {
    const res = finish(f, { ...VALID_PAYLOAD });
    assert.equal(
      res.status,
      "READY_FOR_REVIEW",
      `a valid envelope must not be refused: ${res.error ?? ""}`,
    );
    assert.equal(
      f.queueManager.getTask(f.taskId).status,
      "RESULT_PENDING_REVIEW",
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});

test("F-535: an envelope-free finish keeps its existing behavior", () => {
  const f = fixture("absent");
  try {
    const res = finish(f);
    assert.equal(
      res.status,
      "READY_FOR_REVIEW",
      `the validation gates a PRESENTED envelope, it invents none: ${res.error ?? ""}`,
    );
  } finally {
    rmSync(f.dir, { recursive: true, force: true });
  }
});
