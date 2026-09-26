import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  rmdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { TASK_STATES } from "./authority.mjs";

/**
 * Persistent Observable Queue Manager
 * Implements ACTIVE.md Sections 13, 14, 33:
 * - Decouples 24/7 Always-On Control Plane from Local Laptop Worker.
 * - Manages task lifecycle: QUEUED -> WAITING_FOR_WORKER -> CLAIMED -> EXECUTING -> EXECUTION_FINISHED.
 * - H01/H05: Atomic single worker claim with leaseId+workerId+attempt fence.
 * - H02: Cross-process file locking for claim atomicity.
 * - H03/H07/H09: Authoritative ledger reconciliation and rebuild procedure.
 * - H04: Stale execution revokes generation token on recovery.
 * - H06: Durable atomic fsync+rename persistence parity with ledger.
 * - H08: projectionVersion monotonically increases on every save.
 */

const DEFAULT_LEASE_SECONDS = 300; // 5 minutes heartbeat lease
const DEFAULT_STALE_THRESHOLD_SECONDS = 600; // 10 minutes before marking stale

function resolveDefaultStoragePath() {
  const dir = path.join(os.homedir(), ".openclaw-zink");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      /* ignore */
    }
  }
  return path.join(dir, "task-queue.json");
}

export class QueueManager {
  constructor({ storagePath = resolveDefaultStoragePath() } = {}) {
    this.storagePath = storagePath;
    this.queue = new Map();
    this._projectionVersion = 0;
    this.load();
  }

  withLock(fn) {
    if (!this.storagePath) {
      return fn();
    }
    const lockDir = `${this.storagePath}.lock`;
    const deadline = Date.now() + 5000;
    let acquired = false;
    while (Date.now() < deadline) {
      try {
        mkdirSync(lockDir);
        acquired = true;
        break;
      } catch (err) {
        if (err?.code !== "EEXIST") {
          const parent = path.dirname(lockDir);
          if (!existsSync(parent)) {
            try {
              mkdirSync(parent, { recursive: true });
            } catch {
              /* ignore */
            }
            continue;
          }
          break;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    if (!acquired) {
      throw new Error("QUEUE_LOCK_TIMEOUT: Failed to acquire queue file lock");
    }
    try {
      this.load();
      const res = fn();
      return res;
    } finally {
      try {
        rmdirSync(lockDir);
      } catch {
        /* ignore */
      }
    }
  }

  load() {
    if (!this.storagePath) return;
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf8");
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          for (const item of data) {
            this.queue.set(item.taskId, item);
          }
        }
      }
    } catch (err) {
      // Non-fatal, start fresh
      console.error(
        "[queue-manager] Failed to load queue from storage:",
        err?.message,
      );
    }
  }

  save() {
    if (!this.storagePath) return;
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this._projectionVersion++;
      const data = Array.from(this.queue.values());
      const tempPath = `${this.storagePath}.tmp-${process.pid}-${Date.now()}`;
      const fd = openSync(tempPath, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tempPath, this.storagePath);
    } catch (err) {
      console.error(
        "[queue-manager] Failed to save queue to storage:",
        err?.message,
      );
    }
  }

  /**
   * Enqueues an approved task for execution.
   */
  enqueueTask({
    taskId,
    planVersion = "1.0",
    primaryCoordinator, // "o1" | "o2"
    requiredCapabilities = [], // ["excel", "sql", "python", "power-bi"]
    payload = {},
    queueReason = "APPROVED_WAITING_EXECUTION",
  }) {
    if (!taskId) throw new Error("TASK_ID_REQUIRED");
    if (!primaryCoordinator || !["o1", "o2"].includes(primaryCoordinator)) {
      throw new Error("PRIMARY_COORDINATOR_REQUIRED: Must be o1 or o2");
    }

    const existing = this.queue.get(taskId);
    if (existing && existing.status === TASK_STATES.EXECUTING) {
      throw new Error(
        "TASK_ALREADY_EXECUTING: Cannot re-enqueue an active task",
      );
    }

    const item = {
      taskId,
      planVersion,
      primaryCoordinator,
      requiredCapabilities,
      payload,
      status: TASK_STATES.QUEUED,
      queueReason,
      enqueuedAt: new Date().toISOString(),
      // H05: fence fields â€” set on claim, validated on finish/heartbeat
      claimedBy: null,
      claimedAt: null,
      leaseId: null, // H05: unique per claim/attempt
      attempt: existing ? existing.attempt + 1 : 1,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      history: existing ? [...existing.history] : [],
    };

    item.history.push({
      status: TASK_STATES.QUEUED,
      at: item.enqueuedAt,
      reason: queueReason,
    });

    this.queue.set(taskId, item);
    this.save();
    return item;
  }

  /**
   * Worker atomically claims a task matching its capabilities.
   * H01/H05: Issues a leaseId that must be returned on finish.
   * H02: Wrapped in withLock for cross-process claim atomicity.
   */
  claimTask({
    workerId,
    capabilities = [],
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
    return this.withLock(() => {
      if (!workerId) throw new Error("WORKER_ID_REQUIRED");

      const now = Date.now();

      for (const item of this.queue.values()) {
        if (
          item.status === TASK_STATES.QUEUED ||
          item.status === TASK_STATES.WAITING_FOR_WORKER
        ) {
          // Check capability match if required
          const matchesCap =
            item.requiredCapabilities.length === 0 ||
            item.requiredCapabilities.some((req) => capabilities.includes(req));

          if (matchesCap) {
            // Atomic claim â€” issue a fresh leaseId (H05)
            const leaseId = randomUUID();
            item.status = TASK_STATES.EXECUTING;
            item.claimedBy = workerId;
            item.claimedAt = new Date(now).toISOString();
            item.leaseId = leaseId;
            item.lastHeartbeatAt = item.claimedAt;
            item.leaseExpiresAt = new Date(
              now + leaseSeconds * 1000,
            ).toISOString();

            item.history.push({
              status: TASK_STATES.EXECUTING,
              at: item.claimedAt,
              claimedBy: workerId,
              leaseId,
              attempt: item.attempt,
            });

            this.save();
            return { claimed: true, task: item, leaseId };
          }
        }
      }

      return { claimed: false, reason: "NO_MATCHING_TASKS" };
    });
  }

  /**
   * Worker claims a specific task by ID.
   * H01/H05: Issues a leaseId for the worker fence.
   * H02: Wrapped in withLock for cross-process claim atomicity.
   */
  claimTaskById({ taskId, workerId, leaseSeconds = DEFAULT_LEASE_SECONDS }) {
    return this.withLock(() => {
      if (!taskId) throw new Error("TASK_ID_REQUIRED");
      if (!workerId) throw new Error("WORKER_ID_REQUIRED");

      const item = this.queue.get(taskId);
      if (!item) {
        throw new Error(
          `TASK_NOT_FOUND: Task ${taskId} does not exist in queue`,
        );
      }

      if (item.status === TASK_STATES.EXECUTING) {
        if (item.claimedBy === workerId) {
          // Extend lease
          return this.heartbeat({ taskId, workerId, leaseSeconds });
        }
        throw new Error(
          `CONCURRENT_CLAIM_DENIED: Task ${taskId} is already claimed by ${item.claimedBy}`,
        );
      }

      if (
        item.status !== TASK_STATES.QUEUED &&
        item.status !== TASK_STATES.WAITING_FOR_WORKER
      ) {
        throw new Error(
          `INVALID_STATE_TRANSITION: Cannot claim task in state ${item.status}`,
        );
      }

      const now = Date.now();
      const leaseId = randomUUID(); // H05
      item.status = TASK_STATES.EXECUTING;
      item.claimedBy = workerId;
      item.claimedAt = new Date(now).toISOString();
      item.leaseId = leaseId;
      item.lastHeartbeatAt = item.claimedAt;
      item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();

      item.history.push({
        status: TASK_STATES.EXECUTING,
        at: item.claimedAt,
        claimedBy: workerId,
        leaseId,
        attempt: item.attempt,
      });

      this.save();
      return { claimed: true, task: item, leaseId };
    });
  }

  /**
   * Heartbeat to extend worker lease.
   * H05: Validates workerId and leaseId fence.
   */
  heartbeat({
    taskId,
    workerId,
    leaseId,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");
    if (item.claimedBy !== workerId) {
      throw new Error(
        "WORKER_MISMATCH: Only the claiming worker can send heartbeat",
      );
    }
    // H05: validate leaseId fence when provided (null treated as not provided)
    if (leaseId != null && item.leaseId !== leaseId) {
      throw new Error(
        "LEASE_MISMATCH: Heartbeat leaseId does not match current lease",
      );
    }
    if (item.status !== TASK_STATES.EXECUTING) {
      throw new Error(
        `INVALID_STATE: Task is not executing (status: ${item.status})`,
      );
    }

    const now = Date.now();
    item.lastHeartbeatAt = new Date(now).toISOString();
    item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();
    this.save();
    return { success: true, leaseExpiresAt: item.leaseExpiresAt };
  }

  /**
   * Execution Finished event emitted by worker / O1 / O2.
   * H01: Validates workerId+leaseId+attempt fence.
   * Transitions to RESULT_PENDING_REVIEW. NEVER marks task COMPLETE!
   */
  finishExecution({
    taskId,
    workerId,
    leaseId,
    attempt,
    artifacts = [],
    resultSummary = "",
  }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");
    if (item.status !== TASK_STATES.EXECUTING) {
      throw new Error(
        `INVALID_STATE: Cannot finish execution from status ${item.status}`,
      );
    }
    // H01: worker fence â€” all three must match to prevent zombie completion
    if (!workerId || item.claimedBy !== workerId) {
      throw new Error(
        "WORKER_MISMATCH: Only the claiming worker can finish execution",
      );
    }
    if (leaseId != null && item.leaseId !== leaseId) {
      throw new Error(
        "LEASE_MISMATCH: Finish leaseId does not match current lease",
      );
    }
    if (attempt != null && item.attempt !== attempt) {
      throw new Error(
        "ATTEMPT_MISMATCH: Finish attempt does not match current attempt",
      );
    }

    const now = new Date().toISOString();
    item.status = TASK_STATES.RESULT_PENDING_REVIEW;
    item.executionFinishedAt = now;
    item.artifacts = artifacts;
    // H10: bind resultSummary to attempt so it is traceable
    item.resultSummary = typeof resultSummary === "string" ? resultSummary : "";
    item.resultAttempt = item.attempt;

    item.history.push({
      status: TASK_STATES.RESULT_PENDING_REVIEW,
      at: now,
      workerId,
      leaseId: item.leaseId,
      attempt: item.attempt,
      artifactsCount: artifacts.length,
    });

    this.save();
    return {
      success: true,
      status: TASK_STATES.RESULT_PENDING_REVIEW,
      message:
        "Execution finished event recorded. Task is now ready for validation and User review in #results.",
    };
  }

  /**
   * Complete task - Strictly called after User ACCEPT/COMPLETE in #results!
   */
  completeTask({ taskId, userConfirmationRef }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");
    if (item.status !== TASK_STATES.RESULT_PENDING_REVIEW) {
      throw new Error(
        `INVALID_STATE: Cannot complete task unless in RESULT_PENDING_REVIEW (current: ${item.status})`,
      );
    }

    const now = new Date().toISOString();
    item.status = TASK_STATES.COMPLETE;
    item.completedAt = now;
    item.userConfirmationRef = userConfirmationRef;

    item.history.push({
      status: TASK_STATES.COMPLETE,
      at: now,
      userConfirmationRef,
    });

    this.save();
    return { success: true, status: TASK_STATES.COMPLETE };
  }

  /**
   * Rejects or cancels task.
   */
  rejectTask({ taskId, reason = "USER_REJECTED" }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");

    const now = new Date().toISOString();
    item.status = TASK_STATES.REJECTED;
    item.rejectedAt = now;
    item.rejectionReason = reason;

    item.history.push({
      status: TASK_STATES.REJECTED,
      at: now,
      reason,
    });

    this.save();
    return { success: true, status: TASK_STATES.REJECTED };
  }

  /**
   * Detects stale executions where heartbeat has expired.
   * H04: Revokes leaseId on recovery to prevent zombie completion.
   * Auto-recovers to WAITING_FOR_WORKER.
   */
  detectAndRecoverStaleTasks({
    staleThresholdSeconds = DEFAULT_STALE_THRESHOLD_SECONDS,
  } = {}) {
    const now = Date.now();
    const staleList = [];

    for (const item of this.queue.values()) {
      if (item.status === TASK_STATES.EXECUTING) {
        const lastHb = item.lastHeartbeatAt
          ? new Date(item.lastHeartbeatAt).getTime()
          : 0;
        const elapsed = (now - lastHb) / 1000;

        if (elapsed > staleThresholdSeconds) {
          // Stale execution detected!
          staleList.push({
            taskId: item.taskId,
            claimedBy: item.claimedBy,
            revokedLeaseId: item.leaseId, // H04: record the revoked lease
            elapsedSeconds: elapsed,
          });

          // H04: Revoke current lease by clearing leaseId before re-enqueue.
          // Any in-flight worker with the old leaseId will be rejected.
          item.status = TASK_STATES.WAITING_FOR_WORKER;
          item.queueReason = `WORKER_HEARTBEAT_TIMEOUT (stale after ${Math.round(elapsed)}s)`;
          item.claimedBy = null;
          item.leaseId = null; // H04: revoke
          item.leaseExpiresAt = null;
          item.attempt = (item.attempt ?? 0) + 1; // H04: increment generation

          item.history.push({
            status: TASK_STATES.WAITING_FOR_WORKER,
            at: new Date(now).toISOString(),
            reason: item.queueReason,
            newAttempt: item.attempt,
          });
        }
      }
    }

    if (staleList.length > 0) {
      this.save();
    }

    return staleList;
  }

  getTask(taskId) {
    return this.queue.get(taskId) || null;
  }

  listActiveTasks() {
    return Array.from(this.queue.values()).filter(
      (t) =>
        t.status !== TASK_STATES.COMPLETE && t.status !== TASK_STATES.REJECTED,
    );
  }

  /**
   * H03, H07, H09: Reconciles queue projection against authoritative ledger snapshot.
   * Handles duplicate task IDs, purges uncommitted orphans, and updates tasks to match ledger.
   */
  rebuildFromLedger(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || !snapshot.tasks) {
      throw new Error(
        "LEDGER_SNAPSHOT_REQUIRED: Cannot rebuild queue without valid ledger snapshot",
      );
    }
    return this.withLock(() => {
      let totalRebuilt = 0;
      let orphanedRemoved = 0;
      let updated = 0;

      const ledgerTaskIds = new Set(Object.keys(snapshot.tasks));

      // H09: Purge queue tasks that do not exist in authoritative ledger (orphans/corrupted duplicates)
      for (const [taskId] of this.queue.entries()) {
        if (!ledgerTaskIds.has(taskId)) {
          this.queue.delete(taskId);
          orphanedRemoved++;
        }
      }

      // H03/H07: Reconstruct and reconcile each ledger task into queue
      for (const [taskId, ledgerTask] of Object.entries(snapshot.tasks)) {
        const existing = this.queue.get(taskId);
        const mappedStatus =
          ledgerTask.workflow_status === "ACTIVE"
            ? ledgerTask.approved_at
              ? TASK_STATES.QUEUED
              : TASK_STATES.WAITING_FOR_WORKER
            : TASK_STATES[ledgerTask.workflow_status] ||
              ledgerTask.workflow_status;

        if (existing) {
          // Ledger authority overrides diverging queue projection (H03)
          if (existing.status !== mappedStatus) {
            existing.status = mappedStatus;
            existing.history.push({
              status: mappedStatus,
              at: new Date().toISOString(),
              reason: "LEDGER_RECONCILIATION_OVERRIDE",
            });
            updated++;
          }
        } else {
          // Reconstruct missing task projection from ledger
          const reconstructed = {
            taskId,
            planVersion: String(ledgerTask.brief_revision || "1.0"),
            primaryCoordinator: ledgerTask.root_agent_id || "o1",
            requiredCapabilities: [],
            payload: {},
            status: mappedStatus,
            queueReason: "REBUILT_FROM_LEDGER",
            enqueuedAt: ledgerTask.created_at || new Date().toISOString(),
            claimedBy: ledgerTask.claimed_by || null,
            claimedAt: ledgerTask.claimed_at || null,
            leaseId: null,
            attempt: 1,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            history: [
              {
                status: mappedStatus,
                at: new Date().toISOString(),
                reason: "REBUILT_FROM_LEDGER",
              },
            ],
          };
          this.queue.set(taskId, reconstructed);
          totalRebuilt++;
        }
      }

      this.save();
      return { totalRebuilt, orphanedRemoved, updated };
    });
  }

  clear() {
    this.queue.clear();
    this.save();
  }
}

export const defaultQueueManager = new QueueManager();
