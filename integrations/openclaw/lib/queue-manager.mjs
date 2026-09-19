import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { TASK_STATES } from "./authority.mjs";

/**
 * Persistent Observable Queue Manager
 * Implements ACTIVE.md Sections 13, 14, 33:
 * - Decouples 24/7 Always-On Control Plane from Local Laptop Worker.
 * - Manages task lifecycle: QUEUED -> WAITING_FOR_WORKER -> CLAIMED -> EXECUTING -> EXECUTION_FINISHED.
 * - Atomic single worker claim (concurrency / race protection).
 * - Stale execution detection and recovery.
 * - Persistent storage resistant to laptop sleep, restarts, and disconnects.
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
    this.load();
  }

  load() {
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
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.queue.values());
      writeFileSync(this.storagePath, JSON.stringify(data, null, 2), "utf8");
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
      claimedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      leaseExpiresAt: null,
      attempt: existing ? existing.attempt + 1 : 1,
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
   * Protects against dual claims.
   */
  claimTask({
    workerId,
    capabilities = [],
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
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
          // Atomic claim
          item.status = TASK_STATES.EXECUTING;
          item.claimedBy = workerId;
          item.claimedAt = new Date(now).toISOString();
          item.lastHeartbeatAt = item.claimedAt;
          item.leaseExpiresAt = new Date(
            now + leaseSeconds * 1000,
          ).toISOString();

          item.history.push({
            status: TASK_STATES.EXECUTING,
            at: item.claimedAt,
            claimedBy: workerId,
          });

          this.save();
          return { claimed: true, task: item };
        }
      }
    }

    return { claimed: false, reason: "NO_MATCHING_TASKS" };
  }

  /**
   * Worker claims a specific task by ID.
   */
  claimTaskById({ taskId, workerId, leaseSeconds = DEFAULT_LEASE_SECONDS }) {
    if (!taskId) throw new Error("TASK_ID_REQUIRED");
    if (!workerId) throw new Error("WORKER_ID_REQUIRED");

    const item = this.queue.get(taskId);
    if (!item) {
      throw new Error(`TASK_NOT_FOUND: Task ${taskId} does not exist in queue`);
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
    item.status = TASK_STATES.EXECUTING;
    item.claimedBy = workerId;
    item.claimedAt = new Date(now).toISOString();
    item.lastHeartbeatAt = item.claimedAt;
    item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();

    item.history.push({
      status: TASK_STATES.EXECUTING,
      at: item.claimedAt,
      claimedBy: workerId,
    });

    this.save();
    return { claimed: true, task: item };
  }

  /**
   * Heartbeat to extend worker lease.
   */
  heartbeat({ taskId, workerId, leaseSeconds = DEFAULT_LEASE_SECONDS }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");
    if (item.claimedBy !== workerId) {
      throw new Error(
        "WORKER_MISMATCH: Only the claiming worker can send heartbeat",
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
   * Transitions to RESULT_PENDING_REVIEW. NEVER marks task COMPLETE!
   */
  finishExecution({ taskId, workerId, artifacts = [], resultSummary = "" }) {
    const item = this.queue.get(taskId);
    if (!item) throw new Error("TASK_NOT_FOUND");
    if (item.status !== TASK_STATES.EXECUTING) {
      throw new Error(
        `INVALID_STATE: Cannot finish execution from status ${item.status}`,
      );
    }

    const now = new Date().toISOString();
    item.status = TASK_STATES.RESULT_PENDING_REVIEW;
    item.executionFinishedAt = now;
    item.artifacts = artifacts;
    item.resultSummary = resultSummary;

    item.history.push({
      status: TASK_STATES.RESULT_PENDING_REVIEW,
      at: now,
      workerId,
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
   * Auto-recovers to QUEUED or marks an incident.
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
            elapsedSeconds: elapsed,
          });

          // Recover back to QUEUED for retry, or WAITING_FOR_WORKER
          item.status = TASK_STATES.WAITING_FOR_WORKER;
          item.queueReason = `WORKER_HEARTBEAT_TIMEOUT (stale after ${Math.round(elapsed)}s)`;
          item.claimedBy = null;
          item.leaseExpiresAt = null;

          item.history.push({
            status: TASK_STATES.WAITING_FOR_WORKER,
            at: new Date(now).toISOString(),
            reason: item.queueReason,
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

  clear() {
    this.queue.clear();
    this.save();
  }
}

export const defaultQueueManager = new QueueManager();
