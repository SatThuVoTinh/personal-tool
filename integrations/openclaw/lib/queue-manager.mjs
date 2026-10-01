import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
} from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { TASK_STATES } from "./authority.mjs";
import { withFileLockSync, lockDirFor } from "./file-lock.mjs";

/**
 * Persistent Observable Queue Manager
 * Implements ACTIVE.md Sections 13, 14, 33:
 * - Decouples 24/7 Always-On Control Plane from governed execution agents.
 * - Manages task lifecycle: QUEUED -> EXECUTING -> RESULT_PENDING_REVIEW.
 * - H01/H05: Atomic single execution-agent claim with leaseId+agentId+attempt fence.
 * - H02: Cross-process file locking for claim atomicity.
 * - H03/H07/H09: Authoritative ledger reconciliation and rebuild procedure.
 * - H04: Stale execution revokes generation token on recovery.
 * - H06: Durable atomic fsync+rename persistence parity with ledger.
 * - H08: projectionVersion is an explicitly process-local monotonic counter
 *   (M7-064). It is NOT durable across restart by design; restart resets it
 *   to 0. Durable ordering authority is the ledger event sequence.
 * - M7-009/M7-073/M7-074: rebuildFromLedger() only projects approved ledger
 *   states to executable queue states and validates coordinator identity.
 * - M7-010: claim is bound to the authoritative assignment
 *   (primaryCoordinator or listed requiredCapabilities). Capability matching
 *   is a routing aid (M8-057: ANY-match), never the final authorization.
 * - M7-028/M7-029/M7-030: heartbeat/finish/reclaim require the current
 *   leaseId fence; finish additionally requires agentId + attempt.
 * - M8-054: finishExecution binds an explicit resultDigest over the result.
 */

const DEFAULT_LEASE_SECONDS = 300; // 5 minutes heartbeat lease
const DEFAULT_STALE_THRESHOLD_SECONDS = 600; // 10 minutes before marking stale

/**
 * M7-031: canonical terminal/non-executable queue states, shared with the
 * workflow authority (COMPLETE/PARTIAL/FAILED/CANCELLED/REJECTED).
 */
const QUEUE_TERMINAL_STATES = Object.freeze([
  "COMPLETE",
  "PARTIAL",
  "FAILED",
  "CANCELLED",
  "REJECTED",
]);

function sha256hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

/**
 * M7-009: project an authoritative ledger workflow_status to a queue state.
 * Only explicitly approved/execution-ready ledger states become executable.
 * Unapproved ACTIVE and unknown states map to non-executable states.
 */
export function mapLedgerStatusToQueue(ledgerTask) {
  const s = ledgerTask?.workflow_status;
  if (s === "ACTIVE") {
    return ledgerTask.approved_at ? TASK_STATES.QUEUED : "APPROVAL_PENDING";
  }
  if (
    s === TASK_STATES.QUEUED ||
    s === TASK_STATES.EXECUTING ||
    s === TASK_STATES.RESULT_PENDING_REVIEW ||
    s === "REVISING" ||
    s === TASK_STATES.WAITING_FOR_USER ||
    s === "APPROVAL_PENDING" ||
    s === TASK_STATES.BLOCKED
  ) {
    return s;
  }
  if (QUEUE_TERMINAL_STATES.includes(s)) return s;
  return TASK_STATES.BLOCKED;
}

/**
 * M7-073: coordinator must be o1/o2 for executable queue work.
 */
export function isExecutableCoordinator(rootAgentId) {
  return rootAgentId === "o1" || rootAgentId === "o2";
}

/**
 * M7-010: the claimant must be the designated coordinator or a listed
 * required capability. Returns true when the binding holds.
 */
export function isAssignedClaimant(item, agentId) {
  if (!agentId) return false;
  if (item?.primaryCoordinator && agentId === item.primaryCoordinator)
    return true;
  return (item?.requiredCapabilities ?? []).includes(agentId);
}

function resolveDefaultStoragePath() {
  const dir = path.join(os.homedir(), ".openclaw-zink");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
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
    const lockDir = lockDirFor(
      path.dirname(this.storagePath),
      `${path.basename(this.storagePath)}.lock`,
    );
    try {
      return withFileLockSync(lockDir, () => {
        this.load();
        return fn();
      });
    } catch (err) {
      if (err?.code === "FILE_LOCK_BUSY") {
        throw new Error(
          "QUEUE_LOCK_TIMEOUT: Failed to acquire queue file lock",
          { cause: err },
        );
      }
      throw err;
    }
  }

  load() {
    if (!this.storagePath) return;
    try {
      if (existsSync(this.storagePath)) {
        const raw = readFileSync(this.storagePath, "utf8");
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) {
          throw new Error("QUEUE_STORAGE_SCHEMA_INVALID");
        }
        const rebuilt = new Map();
        for (const item of data) {
          if (!item || typeof item.taskId !== "string" || !item.taskId) {
            throw new Error("QUEUE_STORAGE_SCHEMA_INVALID");
          }
          rebuilt.set(item.taskId, item);
        }
        this.queue = rebuilt;
      } else {
        this.queue = new Map();
      }
    } catch (err) {
      throw new Error(`QUEUE_STORAGE_READ_FAILED: ${err?.message}`, {
        cause: err,
      });
    }
  }

  save() {
    if (!this.storagePath) return;
    let fd = null;
    try {
      const dir = path.dirname(this.storagePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const nextProjectionVersion = this._projectionVersion + 1;
      const data = Array.from(this.queue.values());
      const tempPath = `${this.storagePath}.tmp-${process.pid}-${Date.now()}`;
      fd = openSync(tempPath, "w", 0o600);
      writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tempPath, this.storagePath);
      // M7-066: fsync the parent directory after rename so the rename itself
      // is durable, matching the ledger writer guarantee (win32-tolerant).
      try {
        const directoryFd = openSync(dir, "r");
        try {
          fsyncSync(directoryFd);
        } finally {
          closeSync(directoryFd);
        }
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !/^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")
        )
          throw error;
      }
      this._projectionVersion = nextProjectionVersion;
    } catch (err) {
      throw new Error(`QUEUE_STORAGE_WRITE_FAILED: ${err?.message}`, {
        cause: err,
      });
    } finally {
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* preserve the original write failure */
        }
      }
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
    // Lane H2: the authoritative owner principal, projected from the ledger.
    // When it is known, completion must present THAT principal, so an
    // arbitrary non-empty string cannot close a task.
    ownerPrincipalRef = null,
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
      ownerPrincipalRef:
        typeof ownerPrincipalRef === "string" && ownerPrincipalRef
          ? ownerPrincipalRef
          : null,
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

    const previousItem = existing;
    this.queue.set(taskId, item);
    try {
      this.save();
    } catch (err) {
      // A failed durable write must not leave an in-memory task that was never
      // committed to the authoritative queue projection.
      if (previousItem) {
        this.queue.set(taskId, previousItem);
      } else {
        this.queue.delete(taskId);
      }
      throw err;
    }
    return item;
  }

  /**
   * Execution agent atomically claims a task matching its capabilities.
   * H01/H05: Issues a leaseId that must be returned on finish.
   * H02: Wrapped in withLock for cross-process claim atomicity.
   */
  claimTask({
    agentId,
    capabilities = [],
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
    return this.withLock(() => {
      if (!agentId) throw new Error("AGENT_ID_REQUIRED");

      const now = Date.now();

      for (const item of this.queue.values()) {
        if (item.status === TASK_STATES.QUEUED) {
          // Check capability match if required (M8-057: ANY-match is the
          // documented routing contract — a routing aid, not authorization).
          const matchesCap =
            item.requiredCapabilities.length === 0 ||
            item.requiredCapabilities.some((req) => capabilities.includes(req));

          // M7-010: capability matching never authorizes by itself. The
          // claimant must be the designated coordinator or a listed
          // required capability for this queue item.
          if (matchesCap && isAssignedClaimant(item, agentId)) {
            // Atomic claim â€” issue a fresh leaseId (H05)
            const leaseId = randomUUID();
            item.status = TASK_STATES.EXECUTING;
            item.claimedBy = agentId;
            item.claimedAt = new Date(now).toISOString();
            item.leaseId = leaseId;
            item.lastHeartbeatAt = item.claimedAt;
            item.leaseExpiresAt = new Date(
              now + leaseSeconds * 1000,
            ).toISOString();

            item.history.push({
              status: TASK_STATES.EXECUTING,
              at: item.claimedAt,
              claimedBy: agentId,
              leaseId,
              attempt: item.attempt,
            });

            try {
              this.save();
            } catch (err) {
              this.load();
              throw err;
            }
            return { claimed: true, task: item, leaseId };
          }
        }
      }

      return { claimed: false, reason: "NO_MATCHING_TASKS" };
    });
  }

  /**
   * Execution agent claims a specific task by ID.
   * H01/H05: Issues a leaseId for the execution-agent fence.
   * H02: Wrapped in withLock for cross-process claim atomicity.
   */
  claimTaskById({
    taskId,
    agentId,
    leaseId = null,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
    return this.withLock(() => {
      if (!taskId) throw new Error("TASK_ID_REQUIRED");
      if (!agentId) throw new Error("AGENT_ID_REQUIRED");

      const item = this.queue.get(taskId);
      if (!item) {
        throw new Error(
          `TASK_NOT_FOUND: Task ${taskId} does not exist in queue`,
        );
      }

      if (item.status === TASK_STATES.EXECUTING) {
        if (item.claimedBy === agentId) {
          // M7-030: reclaim/renew requires the current lease fence.
          // Possessing only task ID + agent ID is not enough.
          return this._heartbeatInner({
            taskId,
            agentId,
            leaseId,
            leaseSeconds,
          });
        }
        throw new Error(
          `CONCURRENT_CLAIM_DENIED: Task ${taskId} is already claimed by ${item.claimedBy}`,
        );
      }

      if (item.status !== TASK_STATES.QUEUED) {
        throw new Error(
          `INVALID_STATE_TRANSITION: Cannot claim task in state ${item.status}`,
        );
      }

      // M7-010: bind the claim to the authoritative assignment.
      if (!isAssignedClaimant(item, agentId)) {
        throw new Error(
          `ASSIGNMENT_MISMATCH: Agent ${agentId} is not assigned to task ${taskId}`,
        );
      }

      const now = Date.now();
      const freshLeaseId = randomUUID(); // H05
      item.status = TASK_STATES.EXECUTING;
      item.claimedBy = agentId;
      item.claimedAt = new Date(now).toISOString();
      item.leaseId = freshLeaseId;
      item.lastHeartbeatAt = item.claimedAt;
      item.leaseExpiresAt = new Date(now + leaseSeconds * 1000).toISOString();

      item.history.push({
        status: TASK_STATES.EXECUTING,
        at: item.claimedAt,
        claimedBy: agentId,
        leaseId: freshLeaseId,
        attempt: item.attempt,
      });

      try {
        this.save();
      } catch (err) {
        this.load();
        throw err;
      }
      return { claimed: true, task: item, leaseId: freshLeaseId };
    });
  }

  /**
   * M7-032: run a mutation with copy-on-write rollback. A durable write
   * failure must not leave process memory ahead of persisted authority.
   */
  _mutateWithRollback(taskId, mutate) {
    const item = this.queue.get(taskId);
    const snapshot = item ? JSON.parse(JSON.stringify(item)) : undefined;
    try {
      const result = mutate(item);
      this.save();
      return result;
    } catch (err) {
      if (snapshot === undefined) {
        this.queue.delete(taskId);
      } else {
        this.queue.set(taskId, snapshot);
      }
      throw err;
    }
  }

  /**
   * Heartbeat to extend execution-agent lease.
   * M7-028: the current leaseId fence is mandatory, never optional.
   */
  heartbeat({
    taskId,
    agentId,
    leaseId,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  }) {
    return this.withLock(() =>
      this._heartbeatInner({ taskId, agentId, leaseId, leaseSeconds }),
    );
  }

  _heartbeatInner({ taskId, agentId, leaseId, leaseSeconds }) {
    return this._mutateWithRollback(taskId, (item) => {
      if (!item) throw new Error("TASK_NOT_FOUND");
      if (item.claimedBy !== agentId) {
        throw new Error(
          "AGENT_MISMATCH: Only the claiming agent can send heartbeat",
        );
      }
      // M7-028: missing or stale leaseId is rejected — no optional fence.
      if (typeof leaseId !== "string" || item.leaseId !== leaseId) {
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
      return { success: true, leaseExpiresAt: item.leaseExpiresAt };
    });
  }

  /**
   * Execution Finished event emitted by the execution agent / coordinator.
   * M7-029: agentId + leaseId + attempt are ALL mandatory and must match.
   * M8-054: binds an explicit resultDigest over the result record.
   * Transitions to RESULT_PENDING_REVIEW. NEVER marks task COMPLETE!
   */
  finishExecution({
    taskId,
    agentId,
    leaseId,
    attempt,
    artifacts = [],
    resultSummary = "",
    resultDigest = null,
    artifactSet = null,
    artifactSetDigest = null,
  }) {
    return this.withLock(() =>
      this._mutateWithRollback(taskId, (item) => {
        if (!item) throw new Error("TASK_NOT_FOUND");
        if (item.status !== TASK_STATES.EXECUTING) {
          throw new Error(
            `INVALID_STATE: Cannot finish execution from status ${item.status}`,
          );
        }
        // M7-029: all three fence fields are mandatory for an executing task.
        if (!agentId || item.claimedBy !== agentId) {
          throw new Error(
            "AGENT_MISMATCH: Only the claiming agent can finish execution",
          );
        }
        if (typeof leaseId !== "string" || item.leaseId !== leaseId) {
          throw new Error(
            "LEASE_MISMATCH: Finish leaseId does not match current lease",
          );
        }
        if (!Number.isSafeInteger(attempt) || item.attempt !== attempt) {
          throw new Error(
            "ATTEMPT_MISMATCH: Finish attempt does not match current attempt",
          );
        }

        const now = new Date().toISOString();
        const summary = typeof resultSummary === "string" ? resultSummary : "";
        item.status = TASK_STATES.RESULT_PENDING_REVIEW;
        item.executionFinishedAt = now;
        item.artifacts = artifacts;
        // H10: bind resultSummary to attempt so it is traceable
        item.resultSummary = summary;
        item.resultAttempt = item.attempt;
        // M8-051: the ordered artifact set and its single digest are part of
        // the authoritative result record, not a singular path.
        if (Array.isArray(artifactSet) && artifactSet.length > 0) {
          item.resultArtifacts = artifactSet.map((artifact) => ({
            ...artifact,
          }));
          item.artifactSetDigest = artifactSetDigest ?? null;
        }
        // M8-054: the digest is part of the validated result record. When
        // the caller supplies no digest, bind a digest over the summary +
        // attempt so the record is never digest-less.
        item.resultDigest =
          typeof resultDigest === "string" && resultDigest
            ? resultDigest
            : sha256hex(`${summary}\0${item.attempt}`);

        item.history.push({
          status: TASK_STATES.RESULT_PENDING_REVIEW,
          at: now,
          agentId,
          leaseId: item.leaseId,
          attempt: item.attempt,
          artifactsCount: artifacts.length,
        });

        return {
          success: true,
          status: TASK_STATES.RESULT_PENDING_REVIEW,
          resultDigest: item.resultDigest,
          message:
            "Execution finished event recorded. Task is now ready for validation and User review in #results.",
        };
      }),
    );
  }

  /**
   * Complete task - only from a verified user ACCEPT decision tied to the
   * current result (M7-012). The queue never invents completion authority:
   * the caller proves the user principal and the current result digest.
   */
  completeTask({
    taskId,
    userConfirmationRef,
    userPrincipalRef,
    resultDigest,
  }) {
    return this.withLock(() =>
      this._mutateWithRollback(taskId, (item) => {
        if (!item) throw new Error("TASK_NOT_FOUND");
        if (item.status !== TASK_STATES.RESULT_PENDING_REVIEW) {
          throw new Error(
            `INVALID_STATE: Cannot complete task unless in RESULT_PENDING_REVIEW (current: ${item.status})`,
          );
        }
        // M7-012: non-user actors and unverified principals are denied.
        if (typeof userPrincipalRef !== "string" || !userPrincipalRef) {
          throw new Error(
            "USER_PRINCIPAL_REQUIRED: Completion requires a verified user principal",
          );
        }
        // Lane H2: when the authoritative owner principal is projected onto
        // this task, completion must present THAT principal. A non-empty string
        // is not an identity, so the queue verifies the identity it was given
        // rather than merely recording it.
        if (
          typeof item.ownerPrincipalRef === "string" &&
          item.ownerPrincipalRef &&
          userPrincipalRef !== item.ownerPrincipalRef
        ) {
          throw new Error(
            "USER_PRINCIPAL_MISMATCH: Completion principal is not the authoritative task owner",
          );
        }
        // M7-012: fake or stale confirmation references are denied. The
        // digest must equal the current authoritative result digest.
        if (typeof item.resultDigest !== "string" || !item.resultDigest) {
          throw new Error(
            "RESULT_DIGEST_REQUIRED: No authoritative result digest is recorded for this task",
          );
        }
        if (resultDigest !== item.resultDigest) {
          throw new Error(
            "RESULT_MISMATCH: Confirmation does not reference the current authoritative result",
          );
        }

        const now = new Date().toISOString();
        item.status = TASK_STATES.COMPLETE;
        item.completedAt = now;
        item.userConfirmationRef = userConfirmationRef;
        item.completedBy = userPrincipalRef;

        item.history.push({
          status: TASK_STATES.COMPLETE,
          at: now,
          userConfirmationRef,
          completedBy: userPrincipalRef,
        });

        return { success: true, status: TASK_STATES.COMPLETE };
      }),
    );
  }

  /**
   * Rejects or cancels a task (M7-011). The queue never invents governance
   * transitions: rejection requires an explicit authorized user actor and a
   * decision reference, and is only valid from non-executing,
   * non-terminal source states. The authoritative ledger decision path owns
   * execution cancellation; the queue only mirrors user review outcomes.
   */
  rejectTask({ taskId, reason = "USER_REJECTED", actor, decisionRef }) {
    return this.withLock(() =>
      this._mutateWithRollback(taskId, (item) => {
        if (!item) throw new Error("TASK_NOT_FOUND");
        if (QUEUE_TERMINAL_STATES.includes(item.status)) {
          throw new Error(
            `INVALID_STATE_TRANSITION: Cannot reject terminal task (status: ${item.status})`,
          );
        }
        if (item.status === TASK_STATES.EXECUTING) {
          throw new Error(
            "INVALID_STATE_TRANSITION: Cannot reject an executing task through the queue; use the authoritative workflow cancellation path",
          );
        }
        if (actor !== "user") {
          throw new Error(
            "POLICY_DENIED: Queue rejection requires the verified user actor",
          );
        }
        if (typeof decisionRef !== "string" || !decisionRef) {
          throw new Error(
            "DECISION_REF_REQUIRED: Queue rejection requires an explicit review decision reference",
          );
        }

        const now = new Date().toISOString();
        item.status = TASK_STATES.REJECTED;
        item.rejectedAt = now;
        item.rejectionReason = reason;
        item.rejectedBy = actor;
        item.rejectionDecisionRef = decisionRef;

        item.history.push({
          status: TASK_STATES.REJECTED,
          at: now,
          reason,
          rejectedBy: actor,
          decisionRef,
        });

        return { success: true, status: TASK_STATES.REJECTED };
      }),
    );
  }

  /**
   * Detects stale executions where heartbeat has expired.
   * H04: Revokes leaseId on recovery to prevent zombie completion.
   * M7-025: reconciles against the authoritative workflow ledger before
   * requeueing. Cancelled/rejected/result-pending/terminal ledger tasks are
   * never resurrected. Pass ledgerTasks (ledger snapshot .tasks map) when
   * available; without it only the heartbeat-age rule applies.
   */
  detectAndRecoverStaleTasks({
    staleThresholdSeconds = DEFAULT_STALE_THRESHOLD_SECONDS,
    ledgerTasks = null,
  } = {}) {
    return this.withLock(() => {
      const now = Date.now();
      const staleList = [];
      let mutated = false;

      for (const item of this.queue.values()) {
        if (item.status === TASK_STATES.EXECUTING) {
          const lastHb = item.lastHeartbeatAt
            ? new Date(item.lastHeartbeatAt).getTime()
            : 0;
          const elapsed = (now - lastHb) / 1000;

          if (elapsed > staleThresholdSeconds) {
            // M7-025: ledger reconciliation first — never resurrect work the
            // authority has closed, rejected, or moved to result review.
            const ledgerStatus = ledgerTasks?.[item.taskId]?.workflow_status;
            if (
              ledgerStatus !== undefined &&
              (QUEUE_TERMINAL_STATES.includes(ledgerStatus) ||
                ledgerStatus === TASK_STATES.RESULT_PENDING_REVIEW)
            ) {
              continue;
            }
            // Stale execution detected!
            staleList.push({
              taskId: item.taskId,
              claimedBy: item.claimedBy,
              revokedLeaseId: item.leaseId, // H04: record the revoked lease
              elapsedSeconds: elapsed,
            });

            // H04: Revoke current lease by clearing leaseId before re-enqueue.
            // Any in-flight agent with the old leaseId will be rejected.
            item.status = TASK_STATES.QUEUED;
            item.queueReason = `AGENT_HEARTBEAT_TIMEOUT (stale after ${Math.round(elapsed)}s)`;
            item.claimedBy = null;
            item.leaseId = null; // H04: revoke
            item.leaseExpiresAt = null;
            item.attempt = (item.attempt ?? 0) + 1; // H04: increment generation

            item.history.push({
              status: TASK_STATES.QUEUED,
              at: new Date(now).toISOString(),
              reason: item.queueReason,
              newAttempt: item.attempt,
            });
            mutated = true;
          }
        }
      }

      if (mutated) {
        try {
          this.save();
        } catch (err) {
          this.load();
          throw err;
        }
      }

      return staleList;
    });
  }

  getTask(taskId) {
    return this.queue.get(taskId) || null;
  }

  listActiveTasks() {
    // M7-031: every terminal state is excluded; RESULT_PENDING_REVIEW stays.
    return Array.from(this.queue.values()).filter(
      (t) => !QUEUE_TERMINAL_STATES.includes(t.status),
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
        // M7-009: only approved/execution-ready ledger states project to
        // executable queue states. Unapproved ACTIVE never becomes QUEUED.
        let mappedStatus = mapLedgerStatusToQueue(ledgerTask);
        // M7-073: executable work requires a valid o1/o2 coordinator. Never
        // guess "o1" for main/missing/unknown root agents.
        const coordinator = isExecutableCoordinator(ledgerTask.root_agent_id)
          ? ledgerTask.root_agent_id
          : null;
        if (
          (mappedStatus === TASK_STATES.QUEUED ||
            mappedStatus === TASK_STATES.EXECUTING) &&
          !coordinator
        ) {
          mappedStatus = "APPROVAL_PENDING";
        }

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
          // Lane H2: the owner principal is also ledger authority. A stale
          // queue entry must not keep verifying against an old owner.
          const ownerRef =
            typeof ledgerTask.origin_principal_ref === "string" &&
            ledgerTask.origin_principal_ref
              ? ledgerTask.origin_principal_ref
              : null;
          if (existing.ownerPrincipalRef !== ownerRef) {
            existing.ownerPrincipalRef = ownerRef;
            updated++;
          }
        } else {
          // M7-026/M7-074: preserve the authoritative execution assignment,
          // node capability set, and lease/attempt fence. Missing fence
          // information for an executing ledger task rebuilds as BLOCKED —
          // never as a fresh underconstrained runnable task.
          //
          // The fence and the capability set are DERIVED from the fields the
          // closed snapshot contract actually declares. The attempt lives on a
          // delegation, not on the task, and the executing agents live in the
          // brief's nodes; reading a task-level `attempt`/`capabilities` that
          // the schema forbids made the read permanently `undefined`, so every
          // EXECUTING task rebuilt as BLOCKED and the capability set was always
          // empty.
          const liveRuns = Object.values(ledgerTask.delegations ?? {}).filter(
            (run) => run?.run_state === "RUNNING",
          );
          const fencedAttempt = liveRuns
            .map((run) => run.attempt)
            .find((value) => Number.isSafeInteger(value));
          const capabilities = [
            ...new Set(
              (ledgerTask.nodes ?? [])
                .map((node) => node?.agent_id)
                .filter(
                  (agentId) =>
                    typeof agentId === "string" &&
                    // Coordinators are the assignment, not a capability.
                    !isExecutableCoordinator(agentId),
                ),
            ),
          ].sort();
          let status = mappedStatus;
          let leaseId = null;
          let attempt = Number.isSafeInteger(fencedAttempt) ? fencedAttempt : 1;
          if (mappedStatus === TASK_STATES.EXECUTING) {
            const hasFence =
              typeof ledgerTask.claimed_by === "string" &&
              Number.isSafeInteger(fencedAttempt);
            if (!hasFence) {
              status = TASK_STATES.BLOCKED;
            } else {
              leaseId = null;
              attempt = fencedAttempt;
            }
          }
          // Reconstruct missing task projection from ledger
          const reconstructed = {
            taskId,
            planVersion: String(ledgerTask.brief_revision || "1.0"),
            primaryCoordinator: coordinator,
            requiredCapabilities: capabilities,
            payload: {},
            // Lane H2: project the authoritative owner principal so completion
            // can verify the identity instead of merely recording it.
            ownerPrincipalRef:
              typeof ledgerTask.origin_principal_ref === "string" &&
              ledgerTask.origin_principal_ref
                ? ledgerTask.origin_principal_ref
                : null,
            status,
            queueReason: "REBUILT_FROM_LEDGER",
            enqueuedAt: ledgerTask.created_at || new Date().toISOString(),
            claimedBy: ledgerTask.claimed_by || null,
            claimedAt: ledgerTask.claimed_at || null,
            leaseId,
            attempt,
            lastHeartbeatAt: null,
            leaseExpiresAt: null,
            history: [
              {
                status,
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
