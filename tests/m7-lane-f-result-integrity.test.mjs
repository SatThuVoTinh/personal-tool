import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { QueueManager } from "../integrations/openclaw/lib/queue-manager.mjs";
import { handleExecutionFinished } from "../integrations/openclaw/plugins/zink-governance/index.mjs";
import { evaluateResultGate } from "../integrations/openclaw/lib/artifact-validator.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
  readSnapshot,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  deriveTaskId,
  canonicalHash,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { validateContract } from "../integrations/openclaw/topology/lib/schema.mjs";

let snowflake = 82000000000000001n;
const nextMessageId = () => String(snowflake++);

function fixtureDir() {
  return mkdtempSync(path.join(os.tmpdir(), "lanef-"));
}

function makeCsv(dir, name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, body, "utf8");
  return file;
}

function makeQueue(dir) {
  return new QueueManager({ storagePath: path.join(dir, "queue.json") });
}

function makeGovernedTask(root, agentId = "sql") {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "a".repeat(64),
    origin_message_id: nextMessageId(),
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: agentId,
    root_session_key: `agent:${agentId}:sess`,
    root_run_id: "run-1",
  });
  return { paths, taskId, sessionKey: `agent:${agentId}:sess`, runId: "run-1" };
}

const CSV = "date,revenue\n2026-01-01,1000";
const TECH = { expectedType: "csv", expectedFields: ["date", "revenue"] };
const BIZ = { revenue: 1000 };
const BIZCFG = { kpiConstraints: { revenue: { min: 500 } } };

describe("M8-051 — canonical ordered artifact set", () => {
  it("one artifact, many artifacts, and a forged set digest", () => {
    const dir = fixtureDir();
    try {
      const qm = makeQueue(dir);
      qm.enqueueTask({ taskId: "t-1", primaryCoordinator: "o1" });
      const { leaseId, task } = qm.claimTaskById({
        taskId: "t-1",
        agentId: "o1",
      });
      const a = makeCsv(dir, "a.csv", CSV);
      const res = qm.finishExecution({
        taskId: "t-1",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        artifacts: [a],
        artifactSet: [{ logical_path: a, sha256: "f".repeat(64) }],
        artifactSetDigest: "e".repeat(64),
        resultSummary: "ok",
      });
      assert.equal(res.status, "RESULT_PENDING_REVIEW");
      const stored = qm.getTask("t-1");
      assert.equal(stored.artifacts.length, 1);
      assert.equal(stored.resultArtifacts.length, 1);
      assert.equal(stored.artifactSetDigest, "e".repeat(64));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every artifact is validated; one bad member fails the whole set", () => {
    const dir = fixtureDir();
    try {
      const qm = makeQueue(dir);
      const base = { expectedType: "csv", expectedFields: ["date", "revenue"] };
      const good = makeCsv(dir, "good.csv", CSV);
      // Missing member: rejected, no artifact_path fallback.
      const res = handleExecutionFinished({
        taskId: "missing-artifact",
        agentId: "sql",
        artifacts: [good, path.join(dir, "absent.csv")],
        technicalConfig: base,
        businessData: BIZ,
        businessConfig: BIZCFG,
        queueManager: qm,
      });
      assert.equal(res.status, "FAILED");
      assert.match(res.error, /ARTIFACT_MISSING/u);
      // An empty-string member is rejected too.
      const bad = handleExecutionFinished({
        taskId: "empty-artifact",
        agentId: "sql",
        artifacts: [good, ""],
        technicalConfig: base,
        businessData: BIZ,
        businessConfig: BIZCFG,
        queueManager: qm,
      });
      assert.equal(bad.status, "FAILED");
      assert.match(bad.error, /ARTIFACT_INVALID/u);
      // Zero artifacts yields no set digest, and the technical gate — not the
      // artifact layer — owns that verdict.
      const none = handleExecutionFinished({
        taskId: "no-artifacts",
        agentId: "sql",
        artifacts: [],
        technicalConfig: base,
        businessData: BIZ,
        businessConfig: BIZCFG,
        queueManager: qm,
      });
      assert.equal(none.status, "FAILED");
      assert.equal(none.artifactSetDigest, undefined);
      assert.match(none.gateResult.overallStatus, /FAIL/u);
      // One valid artifact produces a set digest over that ordered set.
      qm.enqueueTask({ taskId: "single-artifact", primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({
        taskId: "single-artifact",
        agentId: "o1",
      });
      const single = handleExecutionFinished({
        taskId: "single-artifact",
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [good],
        technicalConfig: base,
        businessData: BIZ,
        businessConfig: BIZCFG,
        queueManager: qm,
      });
      assert.equal(single.status, "READY_FOR_REVIEW");
      assert.equal(single.artifactSet.length, 1);
      assert.match(single.artifactSetDigest, /^[a-f0-9]{64}$/u);
      // The path-security tier ran over the delivered set, not just one path.
      assert.equal(
        single.gateResult.technical.checks.artifactSetPathSecurity,
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an unreadable secondary artifact fails the whole set before the gate", () => {
    const dir = fixtureDir();
    try {
      const qm = makeQueue(dir);
      const base = { expectedType: "csv", expectedFields: ["date", "revenue"] };
      const good = makeCsv(dir, "primary.csv", CSV);
      for (const [taskId, secondary] of [
        ["absent-secondary", path.join(dir, "absent.csv")],
        ["unc-secondary", "\\\\server\\share\\second.csv"],
        ["empty-secondary", ""],
      ]) {
        qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
        const claim = qm.claimTaskById({ taskId, agentId: "o1" });
        const res = handleExecutionFinished({
          taskId,
          agentId: "o1",
          leaseId: claim.leaseId,
          attempt: claim.task.attempt,
          artifacts: [good, secondary],
          technicalConfig: base,
          businessData: BIZ,
          businessConfig: BIZCFG,
          queueManager: qm,
        });
        assert.equal(res.status, "FAILED", `${taskId} must not pass`);
        assert.match(
          res.error,
          /ARTIFACT_(MISSING|UNREADABLE|INVALID)/u,
          `${taskId} must fail on the artifact layer`,
        );
        // Nothing reached the queue.
        assert.notEqual(qm.getTask(taskId).status, "RESULT_PENDING_REVIEW");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the validation gate applies path security to every set member", () => {
    const dir = fixtureDir();
    try {
      const good = makeCsv(dir, "primary.csv", CSV);
      const base = { expectedType: "csv", expectedFields: ["date", "revenue"] };
      // All members clean: the set tier passes.
      const clean = evaluateResultGate({
        artifactSet: [good, makeCsv(dir, "second.csv", CSV)],
        technicalConfig: base,
        businessData: BIZ,
        businessConfig: BIZCFG,
      });
      assert.equal(clean.overallStatus, "PASS");
      assert.equal(clean.technical.checks.artifactSetPathSecurity, true);
      // A relative or UNC member fails the set even though the primary is
      // clean and passes every format and field check.
      for (const bad of ["artifacts/second.csv", "//server/share/second.csv"]) {
        const dirty = evaluateResultGate({
          artifactSet: [good, bad],
          technicalConfig: base,
          businessData: BIZ,
          businessConfig: BIZCFG,
        });
        assert.equal(
          dirty.overallStatus,
          "FAIL",
          `${bad} must fail the set tier`,
        );
        assert.equal(dirty.technical.checks.artifactSetPathSecurity, false);
        assert.match(dirty.blockedReason, /INVALID_PATH_SECONDARY_ARTIFACT/u);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reordering the set changes the canonical digest (order is authoritative)", () => {
    const dir = fixtureDir();
    try {
      const a = makeCsv(dir, "a.csv", CSV);
      const b = makeCsv(dir, "b.csv", `${CSV}\n2026-01-02,1200`);
      const one = [{ logical_path: a, sha256: "1".repeat(64) }];
      const two = [
        { logical_path: a, sha256: "1".repeat(64) },
        { logical_path: b, sha256: "2".repeat(64) },
      ];
      const d1 = canonicalHash("zink-artifact-set-v1", { artifacts: one });
      const d2 = canonicalHash("zink-artifact-set-v1", { artifacts: two });
      const d2r = canonicalHash("zink-artifact-set-v1", {
        artifacts: [...two].reverse(),
      });
      assert.notEqual(d1, d2, "different sets differ");
      assert.notEqual(d2, d2r, "reordered set must change the digest");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the ledger binds the set digest and rejects a mismatched one", () => {
    const root = fixtureDir();
    try {
      const { paths, taskId } = makeGovernedTask(root);
      // Drive the task to EXECUTING so the result event is admissible.
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "sql",
      });
      const artifacts = [
        { logical_path: "a.csv", sha256: "1".repeat(64) },
        { logical_path: "b.csv", sha256: "2".repeat(64) },
      ];
      const goodDigest = canonicalHash("zink-artifact-set-v1", { artifacts });
      // A forged set digest is rejected.
      assert.throws(
        () =>
          recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
            task_id: taskId,
            artifacts,
            artifact_set_digest: "0".repeat(64),
          }),
        { code: "RESULT_MISMATCH" },
      );
      // The genuine set commits and the task holds the set.
      const committed = recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        artifacts,
        artifact_set_digest: goodDigest,
      });
      const task = committed.tasks[taskId];
      assert.equal(task.artifact_set_digest, goodDigest);
      assert.equal(task.result_artifacts.length, 2);
      assert.equal(task.workflow_status, "RESULT_PENDING_REVIEW");
      // The durable snapshot validates against the schema.
      const snapshot = readFileSync(paths.snapshot, "utf8");
      const parsed = JSON.parse(snapshot);
      validateContract("ledger-snapshot", parsed, Number.MAX_SAFE_INTEGER);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M8-053 — durable execution replay fence", () => {
  it("an exact replay after restart is an idempotent no-op, not a second execution", () => {
    const root = fixtureDir();
    try {
      const { paths, taskId } = makeGovernedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "sql",
      });
      const artifactsDir = path.join(root, "art");
      mkdirSync(artifactsDir, { recursive: true });
      const csv = makeCsv(artifactsDir, "r.csv", CSV);
      const storagePath = path.join(root, "queue.json");
      const qm = new QueueManager({ storagePath });
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      const first = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [csv],
        technicalConfig: TECH,
        businessData: BIZ,
        businessConfig: BIZCFG,
        paths,
        queueManager: qm,
      });
      assert.equal(first.status, "READY_FOR_REVIEW");
      // Restart: a brand-new queue manager over the same durable file.
      const qm2 = new QueueManager({ storagePath });
      const replay = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [csv],
        technicalConfig: TECH,
        businessData: BIZ,
        businessConfig: BIZCFG,
        paths,
        queueManager: qm2,
      });
      assert.equal(replay.status, "ALREADY_COMPLETED");
      // A conflicting result for the same attempt is NOT a replay.
      const conflict = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [makeCsv(artifactsDir, "other.csv", `${CSV}\n2026-01-02,9`)],
        technicalConfig: TECH,
        businessData: BIZ,
        businessConfig: BIZCFG,
        paths,
        queueManager: qm2,
      });
      assert.notEqual(conflict.status, "ALREADY_COMPLETED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M8-052 — queue/ledger split-brain reconciliation", () => {
  it("a rejected ledger write converges the queue onto the authoritative state", () => {
    const root = fixtureDir();
    try {
      const { paths, taskId } = makeGovernedTask(root);
      recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
        task_id: taskId,
        actor: "user",
        channel: "approvals",
        decision: "APPROVE",
      });
      recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
        task_id: taskId,
        agent_id: "sql",
      });
      const storagePath = path.join(root, "queue.json");
      const qm = new QueueManager({ storagePath });
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      const csv = makeCsv(root, "res.csv", CSV);
      // The ledger is already at RESULT_PENDING_REVIEW while the durable
      // queue projection is rewound to EXECUTING: the two disagree before the
      // completion call even starts.
      recordWorkflowEvent(paths, "WORKFLOW_RESULT_RECORDED", {
        task_id: taskId,
        agent_id: "o1",
        attempt: claim.task.attempt,
        payload_digest: "a".repeat(64),
      });
      const durable = JSON.parse(readFileSync(storagePath, "utf8"));
      const entry = durable.find((item) => item.taskId === taskId);
      entry.status = "EXECUTING";
      delete entry.resultDigest;
      delete entry.resultAttempt;
      writeFileSync(storagePath, JSON.stringify(durable), "utf8");

      const qm2 = new QueueManager({ storagePath });
      assert.equal(qm2.getTask(taskId).status, "EXECUTING");
      const res = handleExecutionFinished({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        artifacts: [csv],
        technicalConfig: TECH,
        businessData: BIZ,
        businessConfig: BIZCFG,
        paths,
        queueManager: qm2,
      });
      // The ledger refuses the second result event, so completion fails closed.
      assert.equal(res.status, "FAILED");
      assert.match(res.error, /LEDGER_RESULT_RECORD_FAILED/u);
      // The queue no longer advertises a result the ledger rejected; it has
      // been reconciled onto the authoritative state, so the two agree.
      const authoritative = readSnapshot(paths).tasks[taskId].workflow_status;
      assert.equal(qm2.getTask(taskId).status, authoritative);
      // And the agreement is durable, not just in memory.
      const qm3 = new QueueManager({ storagePath });
      assert.equal(qm3.getTask(taskId).status, authoritative);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("M8-054 — result digest is bound to the record", () => {
  it("finish binds a digest even when the caller supplies none", () => {
    const dir = fixtureDir();
    try {
      const qm = makeQueue(dir);
      qm.enqueueTask({ taskId: "d-1", primaryCoordinator: "o1" });
      const { leaseId, task } = qm.claimTaskById({
        taskId: "d-1",
        agentId: "o1",
      });
      const res = qm.finishExecution({
        taskId: "d-1",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        resultSummary: "no digest supplied",
      });
      assert.match(res.resultDigest, /^[a-f0-9]{64}$/u);
      assert.equal(qm.getTask("d-1").resultDigest, res.resultDigest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the digest presented at completion must equal the current record", () => {
    const dir = fixtureDir();
    try {
      const qm = makeQueue(dir);
      qm.enqueueTask({ taskId: "d-2", primaryCoordinator: "o1" });
      const { leaseId, task } = qm.claimTaskById({
        taskId: "d-2",
        agentId: "o1",
      });
      const res = qm.finishExecution({
        taskId: "d-2",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        resultDigest: "a".repeat(64),
        resultSummary: "bound",
      });
      assert.equal(res.resultDigest, "a".repeat(64));
      // Completing with a different digest is denied.
      assert.throws(
        () =>
          qm.completeTask({
            taskId: "d-2",
            userConfirmationRef: "ref",
            userPrincipalRef: "123456789012345678",
            resultDigest: "b".repeat(64),
          }),
        { message: /RESULT_MISMATCH/u },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
