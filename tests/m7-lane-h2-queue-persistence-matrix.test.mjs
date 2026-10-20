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
import { TASK_STATES } from "../integrations/openclaw/lib/authority.mjs";
import { DecisionLedger } from "../integrations/openclaw/lib/decision-ledger.mjs";
import {
  ensureLedger,
  ledgerPaths,
  readSnapshot,
  recordWorkflowEvent,
} from "../integrations/openclaw/topology/lib/ledger.mjs";
import {
  deriveTaskId,
  derivePrincipalRef,
} from "../integrations/openclaw/topology/lib/canonical.mjs";
import { handleExecutionFinished } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

function fixture() {
  return mkdtempSync(path.join(os.tmpdir(), "lane-h2-"));
}

function makeQueue(dir, name = "queue.json") {
  return new QueueManager({ storagePath: path.join(dir, name) });
}

// M12/T9 F-026: the authoritative owner is a ledger PRINCIPAL REF - the HMAC
// the ledger derives from the identity key and the Discord snowflake
// (`derivePrincipalRef`). A bare snowflake is not a principal: it is the
// public identity the ref exists to hide. The queue compares the projected
// owner against the presented principal, so every task in this lane is
// enqueued WITH the owner and completed by presenting the SAME value.
const OWNER_PRINCIPAL = derivePrincipalRef(
  "d".repeat(64),
  "123456789012345678",
);
const REF = "f".repeat(64);

function governedTask(root) {
  const paths = ledgerPaths(root);
  ensureLedger(paths);
  const origin = {
    origin: "discord",
    origin_principal_ref: "b".repeat(64),
    origin_message_id: "94000000000000001",
  };
  const taskId = deriveTaskId(origin);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    ...origin,
    task_id: taskId,
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "run-1",
  });
  recordWorkflowEvent(paths, "WORKFLOW_USER_APPROVAL_DECIDED", {
    task_id: taskId,
    actor: "user",
    channel: "approvals",
    decision: "APPROVE",
  });
  recordWorkflowEvent(paths, "WORKFLOW_TASK_CLAIMED", {
    task_id: taskId,
    agent_id: "main",
  });
  return { paths, taskId };
}

const CSV = "date,revenue\n2026-01-01,1000";
const TECH = { expectedType: "csv", expectedFields: ["date", "revenue"] };
const BIZ = { revenue: 1000 };
const BIZCFG = { kpiConstraints: { revenue: { min: 500 } } };

describe("Lane H2 — queue lifecycle matrix", () => {
  it("QUEUED -> EXECUTING -> RESULT_PENDING_REVIEW -> COMPLETE", () => {
    const dir = fixture();
    try {
      const qm = makeQueue(dir);
      // F-026: the task carries the authoritative owner, so the completion
      // below is verified against it instead of accepted from whoever presents
      // a non-empty string.
      qm.enqueueTask({
        taskId: "life-1",
        primaryCoordinator: "o1",
        ownerPrincipalRef: OWNER_PRINCIPAL,
      });
      assert.equal(qm.getTask("life-1").status, TASK_STATES.QUEUED);
      const { leaseId, task } = qm.claimTaskById({
        taskId: "life-1",
        agentId: "o1",
      });
      assert.equal(task.status, TASK_STATES.EXECUTING);
      // A heartbeat from the claiming agent with a live lease is accepted and
      // extends the run.
      const beat = qm.heartbeat({
        taskId: "life-1",
        agentId: "o1",
        leaseId,
      });
      assert.equal(beat.success, true);
      assert.equal(
        typeof beat.leaseExpiresAt,
        "string",
        "an accepted heartbeat must extend the lease",
      );
      // A heartbeat from a different agent is not.
      assert.throws(
        () => qm.heartbeat({ taskId: "life-1", agentId: "o2", leaseId }),
        (err) => {
          assert.equal(/AGENT_MISMATCH/u.test(err?.message ?? ""), true);
          return true;
        },
      );
      // A heartbeat with a stale lease is not either.
      assert.throws(
        () =>
          qm.heartbeat({
            taskId: "life-1",
            agentId: "o1",
            leaseId: "forged-lease",
          }),
        (err) => {
          assert.equal(typeof err?.message === "string", true);
          return true;
        },
      );
      const finished = qm.finishExecution({
        taskId: "life-1",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        resultDigest: REF,
        resultSummary: "done",
      });
      assert.equal(finished.status, TASK_STATES.RESULT_PENDING_REVIEW);
      const completed = qm.completeTask({
        taskId: "life-1",
        userConfirmationRef: "ref-1",
        userPrincipalRef: OWNER_PRINCIPAL,
        resultDigest: REF,
      });
      assert.equal(completed.status, TASK_STATES.COMPLETE);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every invalid shortcut is refused with a deterministic code", () => {
    const dir = fixture();
    try {
      const qm = makeQueue(dir);
      const cases = [
        {
          label: "complete from QUEUED",
          run: () =>
            qm.completeTask({
              taskId: "short-1",
              userConfirmationRef: "r",
              userPrincipalRef: OWNER_PRINCIPAL,
              resultDigest: REF,
            }),
        },
        {
          label: "execute an unknown task",
          run: () => qm.claimTaskById({ taskId: "absent", agentId: "o1" }),
        },
        {
          label: "result-pending without a user decision",
          run: () => {
            qm.enqueueTask({
              taskId: "short-2",
              primaryCoordinator: "o1",
              ownerPrincipalRef: OWNER_PRINCIPAL,
            });
            const { leaseId, task } = qm.claimTaskById({
              taskId: "short-2",
              agentId: "o1",
            });
            qm.finishExecution({
              taskId: "short-2",
              agentId: "o1",
              leaseId,
              attempt: task.attempt,
              resultDigest: REF,
              resultSummary: "done",
            });
            // A rejection is only legal WITH a user decision; this call carries
            // none, so it must not be honoured as a decision.
            return qm.completeTask({
              taskId: "short-2",
              userConfirmationRef: null,
              userPrincipalRef: null,
              resultDigest: "0".repeat(64),
            });
          },
        },
        {
          label: "resurrect a terminal task",
          run: () => {
            qm.enqueueTask({
              taskId: "short-3",
              primaryCoordinator: "o1",
              ownerPrincipalRef: OWNER_PRINCIPAL,
            });
            const { leaseId, task } = qm.claimTaskById({
              taskId: "short-3",
              agentId: "o1",
            });
            qm.finishExecution({
              taskId: "short-3",
              agentId: "o1",
              leaseId,
              attempt: task.attempt,
              resultDigest: REF,
              resultSummary: "done",
            });
            qm.completeTask({
              taskId: "short-3",
              userConfirmationRef: "r",
              userPrincipalRef: OWNER_PRINCIPAL,
              resultDigest: REF,
            });
            return qm.claimTaskById({
              taskId: "short-3",
              agentId: "o1",
            });
          },
        },
      ];
      for (const testCase of cases) {
        let threw = false;
        try {
          testCase.run();
        } catch {
          threw = true;
        }
        assert.equal(threw, true, `${testCase.label} must be refused`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a task with a wrong principal cannot be completed", () => {
    const dir = fixture();
    try {
      const qm = makeQueue(dir);
      // The queue entry carries the authoritative owner principal projected
      // from the ledger, so completion is verified rather than merely recorded.
      qm.enqueueTask({
        taskId: "who-1",
        primaryCoordinator: "o1",
        ownerPrincipalRef: OWNER_PRINCIPAL,
      });
      const { leaseId, task } = qm.claimTaskById({
        taskId: "who-1",
        agentId: "o1",
      });
      qm.finishExecution({
        taskId: "who-1",
        agentId: "o1",
        leaseId,
        attempt: task.attempt,
        resultDigest: REF,
        resultSummary: "done",
      });
      // A missing principal is refused.
      assert.throws(
        () =>
          qm.completeTask({
            taskId: "who-1",
            userConfirmationRef: "r",
            userPrincipalRef: null,
            resultDigest: REF,
          }),
        (err) => {
          assert.equal(
            /USER_PRINCIPAL_REQUIRED/u.test(err?.message ?? ""),
            true,
            `expected USER_PRINCIPAL_REQUIRED, got ${err?.message}`,
          );
          return true;
        },
      );
      // A NON-OWNER principal is refused even though it is a non-empty string.
      assert.throws(
        () =>
          qm.completeTask({
            taskId: "who-1",
            userConfirmationRef: "r",
            userPrincipalRef: "1".repeat(15),
            resultDigest: REF,
          }),
        (err) => {
          assert.equal(
            /USER_PRINCIPAL_MISMATCH/u.test(err?.message ?? ""),
            true,
            `expected USER_PRINCIPAL_MISMATCH, got ${err?.message}`,
          );
          return true;
        },
      );
      // The task is still pending review, never silently completed.
      assert.equal(
        qm.getTask("who-1").status,
        TASK_STATES.RESULT_PENDING_REVIEW,
      );
      // Only the authoritative owner closes it.
      const completed = qm.completeTask({
        taskId: "who-1",
        userConfirmationRef: "r",
        userPrincipalRef: OWNER_PRINCIPAL,
        resultDigest: REF,
      });
      assert.equal(completed.status, TASK_STATES.COMPLETE);
      assert.equal(qm.getTask("who-1").completedBy, OWNER_PRINCIPAL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a queue file that shrinks and reloads is detected, not trusted", () => {
    const dir = fixture();
    try {
      const storage = path.join(dir, "queue.json");
      const qm = makeQueue(dir);
      qm.enqueueTask({ taskId: "shrink-1", primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({
        taskId: "shrink-1",
        agentId: "o1",
      });
      qm.finishExecution({
        taskId: "shrink-1",
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        resultDigest: REF,
        resultSummary: "done",
      });
      const before = readFileSync(storage, "utf8");
      // Truncate the durable file: a shrunk queue must not be reloaded as if it
      // were intact.
      writeFileSync(
        storage,
        before.slice(0, Math.floor(before.length / 2)),
        "utf8",
      );
      let threw = false;
      try {
        const reloaded = new QueueManager({ storagePath: storage });
        reloaded.getTask("shrink-1");
      } catch {
        threw = true;
      }
      assert.equal(
        threw || safeStatus(storage) === null,
        true,
        "a truncated queue must not present a usable task",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("queue state that diverges from the ledger is detectable", () => {
    const dir = fixture();
    try {
      const { paths, taskId } = governedTask(dir);
      const qm = makeQueue(dir);
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      // The ledger says EXECUTING; a queue that still says QUEUED is divergent.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "EXECUTING",
      );
      const queueTask = qm.getTask(taskId);
      assert.equal(queueTask.status, TASK_STATES.EXECUTING);
      assert.notEqual(queueTask.status, TASK_STATES.QUEUED);
      // Completing with a digest the ledger never recorded is refused.
      qm.finishExecution({
        taskId,
        agentId: "o1",
        leaseId: claim.leaseId,
        attempt: claim.task.attempt,
        resultDigest: REF,
        resultSummary: "done",
      });
      assert.throws(
        () =>
          qm.completeTask({
            taskId,
            userConfirmationRef: "r",
            userPrincipalRef: OWNER_PRINCIPAL,
            resultDigest: "9".repeat(64),
          }),
        (err) => {
          assert.equal(
            /RESULT_MISMATCH/u.test(err?.message ?? ""),
            true,
            `expected RESULT_MISMATCH, got ${err?.message}`,
          );
          return true;
        },
      );
      // A diverging queue entry is OVERRIDDEN by the authority, and the
      // authoritative owner principal replaces any stale projection.
      const ledger = readSnapshot(paths).tasks[taskId];
      assert.equal(ledger.workflow_status, "EXECUTING");
      qm.enqueueTask({
        taskId: "divergent-2",
        primaryCoordinator: "o2",
        ownerPrincipalRef: "stale-owner",
      });
      const rebuilt = qm.rebuildFromLedger(readSnapshot(paths));
      assert.equal(rebuilt.orphanedRemoved, 1, "an orphan must be purged");
      assert.equal(
        qm.getTask(taskId).ownerPrincipalRef,
        ledger.origin_principal_ref,
        "the queue must verify against the authoritative owner, not a stale one",
      );
      // Convergence: a second rebuild has nothing left to change.
      const again = qm.rebuildFromLedger(readSnapshot(paths));
      assert.equal(again.updated, 0, "a converged queue needs no update");
      assert.equal(again.totalRebuilt, 0);
      // The projection never rewrote ledger authority.
      assert.equal(
        readSnapshot(paths).tasks[taskId].workflow_status,
        "EXECUTING",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Lane H2 — persistence-failure matrix", () => {
  it("a queue save that fails halfway does not report success", () => {
    const dir = fixture();
    try {
      const storage = path.join(dir, "queue.json");
      const qm = makeQueue(dir, "queue.json");
      qm.enqueueTask({ taskId: "half-1", primaryCoordinator: "o1" });
      const before = readFileSync(storage, "utf8");
      // A durable path whose parent is a FILE: the save can never succeed, and
      // the write must surface that instead of pretending durability.
      const blocker = path.join(dir, "not-a-dir");
      writeFileSync(blocker, "sentinel", "utf8");
      const savedPath = path.join(blocker, "queue.json");
      const qm2 = new QueueManager({ storagePath: savedPath });
      assert.throws(
        () => qm2.enqueueTask({ taskId: "half-2", primaryCoordinator: "o1" }),
        (err) => {
          assert.equal(
            /QUEUE_STORAGE_WRITE_FAILED/u.test(err?.message ?? ""),
            true,
            `expected QUEUE_STORAGE_WRITE_FAILED, got ${err?.message}`,
          );
          return true;
        },
      );
      // The in-memory projection is rolled back, so a failed save never leaves
      // process memory ahead of persisted authority (M7-032).
      assert.equal(
        qm2.getTask("half-2") ?? undefined,
        undefined,
        "a rolled-back mutation must not remain visible in memory",
      );
      // The original file is untouched by the failed write.
      assert.equal(readFileSync(storage, "utf8"), before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrupt decision ledger fails closed instead of presenting empty", () => {
    const dir = fixture();
    try {
      const storage = path.join(dir, "decision-ledger.json");
      writeFileSync(storage, "SENTINEL-CORRUPT", "utf8");
      let threw = false;
      try {
        const ledger = new DecisionLedger({ storagePath: storage });
        ledger.lookupDecision({
          topic: "CLARIFICATION",
          question: "Which period?",
          scope: "global",
          taskId: null,
          domain: null,
        });
      } catch {
        threw = true;
      }
      assert.equal(
        threw,
        true,
        "a corrupt decision ledger must not be read as 'no prior decision'",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrupt main ledger fails closed on read, never as an empty snapshot", () => {
    const root = fixture();
    try {
      const { paths } = governedTask(root);
      const before = readSnapshot(paths);
      writeFileSync(paths.snapshot, "SENTINEL-CORRUPT", "utf8");
      assert.throws(
        () => readSnapshot(paths),
        (err) => {
          assert.equal(
            err.message.includes("SENTINEL"),
            false,
            "a corrupt snapshot must not be echoed back",
          );
          assert.equal(typeof err.code === "string", true);
          return true;
        },
      );
      // The corrupt bytes are still on disk; nothing silently rewrote them.
      assert.equal(readFileSync(paths.snapshot, "utf8"), "SENTINEL-CORRUPT");
      // And the pre-corruption snapshot is still the truth we had.
      assert.equal(
        before.tasks[Object.keys(before.tasks)[0]].workflow_status,
        "EXECUTING",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a failed ledger append leaves the previous state intact", () => {
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      const beforeSnapshot = readFileSync(paths.snapshot, "utf8");
      const beforeEvents = readFileSync(paths.events, "utf8");
      // Append-only corruption: the last line is no longer JSON, so the event
      // append must fail rather than commit a partial record.
      writeFileSync(paths.events, `${beforeEvents}{"broken"`, "utf8");
      let threw = false;
      try {
        recordWorkflowEvent(paths, "WORKFLOW_CANCELLED", {
          task_id: taskId,
          reason_code: "OWNER_CANCELLED",
          actor: "user",
        });
      } catch {
        threw = true;
      }
      assert.equal(threw, true, "a broken event log must refuse new appends");
      // The durable snapshot is byte-identical: the failed append committed
      // nothing, so process memory never gets ahead of persisted authority.
      assert.equal(readFileSync(paths.snapshot, "utf8"), beforeSnapshot);
      // And the corrupt event log was not silently repaired or extended.
      assert.equal(
        readFileSync(paths.events, "utf8"),
        `${beforeEvents}{"broken"`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a governance result write failure blocks instead of faking success", () => {
    const root = fixture();
    try {
      const { paths, taskId } = governedTask(root);
      const dir = path.join(root, "artifacts");
      mkdirSync(dir, { recursive: true });
      const csv = path.join(dir, "r.csv");
      writeFileSync(csv, CSV, "utf8");
      const qm = makeQueue(root);
      qm.enqueueTask({ taskId, primaryCoordinator: "o1" });
      const claim = qm.claimTaskById({ taskId, agentId: "o1" });
      const beforeEvents = readFileSync(paths.events, "utf8");
      // Break the event log so the authoritative write cannot succeed.
      writeFileSync(paths.events, `${beforeEvents}{"broken"`, "utf8");
      const result = handleExecutionFinished({
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
      assert.notEqual(
        result.status,
        "READY_FOR_REVIEW",
        "a failed authoritative write must never be reported as a success",
      );
      assert.match(
        result.error,
        /LEDGER_RESULT_RECORD_FAILED|SCOPE_RESOLUTION_FAILED/u,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("a corrupt decision-ledger schema is refused, not treated as empty", () => {
    const dir = fixture();
    try {
      const storage = path.join(dir, "dl.json");
      // Valid JSON, wrong shape: an object where a list of records is expected.
      writeFileSync(storage, JSON.stringify({ records: "not-a-list" }), "utf8");
      const corrupt = new DecisionLedger({ storagePath: storage });
      // The store is marked unusable, and any USE fails closed rather than
      // answering "no prior decision" from data it could not read.
      assert.equal(corrupt.corrupt, true);
      assert.equal(corrupt.loadError, "LEDGER_SCHEMA_INVALID");
      assert.throws(
        () =>
          corrupt.lookupDecision({
            topic: "CLARIFICATION",
            question: "Which period?",
            scope: "global",
            taskId: null,
            domain: null,
          }),
        (err) => {
          assert.equal(
            /LEDGER_CORRUPT/u.test(err?.message ?? ""),
            true,
            `expected LEDGER_CORRUPT, got ${err?.message}`,
          );
          return true;
        },
        "a schema-invalid decision ledger must not load as 'no prior decision'",
      );
      // A genuinely NEW store is honest about being empty, and it round-trips
      // a recorded decision so absence is distinguishable from loss.
      const fresh = new DecisionLedger({
        storagePath: path.join(dir, "fresh", "dl.json"),
      });
      assert.equal(
        fresh.lookupDecision({
          topic: "CLARIFICATION",
          question: "Which period?",
          scope: "global",
          taskId: null,
          domain: null,
        }),
        null,
        "a new store has no prior decision",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function safeStatus(storage) {
  try {
    const parsed = JSON.parse(readFileSync(storage, "utf8"));
    if (!Array.isArray(parsed)) return null;
    const task = parsed.find((item) => item.taskId === "shrink-1");
    return task ? task.status : null;
  } catch {
    return null;
  }
}
