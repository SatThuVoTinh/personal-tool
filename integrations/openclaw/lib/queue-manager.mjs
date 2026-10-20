import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { TASK_STATES, isExecutableCoordinator } from "./authority.mjs";
import { withFileLockSync, lockDirFor } from "./file-lock.mjs";
import {
  assertNoSymlinkComponents,
  projectGovernedCapabilities,
  QUEUE_STORE_FILE,
  resolveGovernedStoreRoot,
} from "./policy.mjs";

/**
 * M7-073: coordinator must be o1/o2 for executable queue work.
 *
 * The predicate itself lives in `lib/authority.mjs` (the canonical authority
 * module) so the queue projection, the dispatch derivation and the spawn
 * policy cannot answer "is this an executable coordinator?" differently. It
 * is re-exported here because the queue is where the queue-side callers
 * already import it from.
 */
export { isExecutableCoordinator };

/**
 * Remove a temp file this process created but could not rename. The codes are
 * the verdicts `topology/lib/ledger.mjs` documents for the same job: `EPERM` and
 * `EISDIR` mean something else owns the path, and `ENOENT` is the same outcome as
 * a successful removal — including the ordinary case, a failure that happened
 * before the temp existed. Anything else is a real fault and propagates.
 *
 * It lives here rather than being imported from the ledger because the deployed
 * plugin flattens `topology/lib/*` into `lib/*` only for the targets named in
 * `PACKAGE_REWRITES`, and neither writer is one of them; a `../topology/lib/...`
 * import would be packaged verbatim and fail to resolve at load time.
 */
function removeWriterResidue(tempPath) {
  try {
    unlinkSync(tempPath);
  } catch (error) {
    if (!["EPERM", "EISDIR", "ENOENT"].includes(error?.code)) throw error;
  }
}

/**
 * Errnos that mean the queue's own directory cannot be written at all. They can
 * only come from lock acquisition, never from a mutation, and they are reported
 * with the same code `save()` uses for a failed durable write.
 */
const ACQUISITION_STORAGE_ERRORS = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOSPC",
]);

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
 * - M10/T2-R2: withExecutionFence() is the queue's current-execution-authority
 *   seam. It runs an authoritative commit inside the queue critical section so
 *   a lease revoked by stale recovery cannot interleave with that commit.
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
 * M7-010: the claimant must be the designated coordinator or a listed
 * required capability. Returns true when the binding holds.
 */
export function isAssignedClaimant(item, agentId) {
  if (!agentId) return false;
  if (item?.primaryCoordinator && agentId === item.primaryCoordinator)
    return true;
  return (item?.requiredCapabilities ?? []).includes(agentId);
}

/**
 * M12/T9 F-002: the task queue lives under the ONE configured governance store
 * root, and there is no home-directory default.
 *
 * The queue used to default to `~/.openclaw-zink/task-queue.json` while the
 * ledger event journal and the snapshot lived under the configured
 * `ledgerRoot`: two roots for one governance state, and a module-level
 * singleton whose map was filled ONCE at import, so the queue a process
 * answered from was not the queue it wrote to.
 *
 * The root is configured explicitly (`configureGovernedStoreRoot` in
 * `lib/policy.mjs`) by whoever owns the configuration, and an unconfigured
 * store is a named refusal rather than a guessed path.
 */
export function resolveQueueStoragePath(root = null) {
  const base = root === null ? resolveGovernedStoreRoot() : root;
  return path.join(base, QUEUE_STORE_FILE);
}

export class QueueManager {
  constructor({ storagePath = null } = {}) {
    // M12/T9 F-002: the store path is EXPLICIT or it is resolved from the ONE
    // configured governance store root. There is no home-directory default and
    // no import-time file access, so importing this module never creates or
    // reads a directory.
    this._explicitStoragePath =
      typeof storagePath === "string" && storagePath.trim().length > 0
        ? storagePath
        : null;
    this.queue = new Map();
    this._projectionVersion = 0;
    // M12/T9 F-154: how many queue critical sections THIS instance currently
    // holds. The lock itself is a directory on disk and is NOT reentrant, so a
    // `save()` issued from inside `withLock()` must not try to take it again -
    // it would deadlock against the lock its own caller holds. The counter
    // records that the caller already holds it, so `save()` writes inside the
    // held section instead of competing for it.
    this._lockDepth = 0;
    if (this._explicitStoragePath) this.load();
  }

  /**
   * The durable location of this projection.
   *
   * With no explicit path it is resolved from the configured governance store
   * root on every access, so a projection that is configured late still reads
   * and writes the ONE configured root.
   */
  get storagePath() {
    return this._explicitStoragePath ?? resolveQueueStoragePath();
  }

  set storagePath(value) {
    this._explicitStoragePath =
      typeof value === "string" && value.trim().length > 0 ? value : null;
  }

  withLock(fn) {
    const dir = path.dirname(this.storagePath);
    const lockDir = lockDirFor(dir, `${path.basename(this.storagePath)}.lock`);
    // The lock lives beside the queue file, so the directory `save()` creates on
    // its first write has to exist before acquisition.
    let bodyReached = false;
    try {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      return withFileLockSync(lockDir, () => {
        bodyReached = true;
        this.load();
        // M12/T9 F-154: the critical section is entered here, so `save()` calls
        // made from the body must write INSIDE it rather than take the lock
        // again. The counter is released in a `finally` so a throwing body
        // never leaves the instance believing it still holds the lock.
        this._lockDepth += 1;
        try {
          return fn();
        } finally {
          this._lockDepth -= 1;
        }
      });
    } catch (err) {
      if (err?.code === "FILE_LOCK_BUSY") {
        throw new Error(
          "QUEUE_LOCK_TIMEOUT: Failed to acquire queue file lock",
          { cause: err },
        );
      }
      // M11/T3 A4: an unwritable queue directory fails here, before any
      // mutation ran. It is the same durable-write failure `save()` reports, so
      // it keeps that host-visible code instead of surfacing a raw errno that
      // every caller would have to reclassify on its own.
      if (!bodyReached && ACQUISITION_STORAGE_ERRORS.has(err?.code)) {
        throw new Error(`QUEUE_STORAGE_WRITE_FAILED: ${err?.message}`, {
          cause: err,
        });
      }
      throw err;
    }
  }

  /**
   * M12/T9 F-002: read the durable projection and REPLACE the in-memory view.
   *
   * The load is a replacement, not an accumulation, and every read path calls
   * it first: the map this projection holds is a cache of the file, never the
   * authority on its own.
   *
   * The replacement happens IN PLACE. A captured reference to `this.queue`
   * stays the live map, so a caller that read a row and then wrote it back
   * cannot lose the write to a map object that is no longer current — which
   * is exactly the shape the plugin's notification seam uses.
   */
  load() {
    // Resolved OUTSIDE the read: an unconfigured store is a configuration
    // refusal and keeps its own name, never "the file is unreadable".
    const storagePath = this.storagePath;
    let rebuilt;
    try {
      if (existsSync(storagePath)) {
        const raw = readFileSync(storagePath, "utf8");
        const data = JSON.parse(raw);
        if (!Array.isArray(data)) {
          throw new Error("QUEUE_STORAGE_SCHEMA_INVALID");
        }
        rebuilt = new Map();
        for (const item of data) {
          if (!item || typeof item.taskId !== "string" || !item.taskId) {
            throw new Error("QUEUE_STORAGE_SCHEMA_INVALID");
          }
          rebuilt.set(item.taskId, item);
        }
      } else {
        rebuilt = new Map();
      }
    } catch (err) {
      throw new Error(`QUEUE_STORAGE_READ_FAILED: ${err?.message}`, {
        cause: err,
      });
    }
    this.queue.clear();
    for (const [taskId, item] of rebuilt) {
      this.queue.set(taskId, item);
    }
  }

  /**
   * M12/T9 F-002: re-read the durable projection.
   *
   * Every read path calls this first, so an answer is always derived from the
   * file on disk and never from a map that was populated at import time.
   */
  refresh() {
    this.load();
    return this;
  }

  /**
   * M12/T9 F-154: the durable writer takes the queue lock ITSELF.
   *
   * It used to rely on every caller wrapping its work in `withLock()`, and one
   * shipped caller did not: the plugin's notification seam set the projection
   * and called `save()` bare, so its write could land INSIDE another writer's
   * critical section and erase a committed row. `decision-ledger.mjs` already
   * self-locks; the queue now does the same, so a concurrent unlocked writer is
   * serialised against the critical section instead of interleaving with it.
   *
   * The lock is a directory on disk and is NOT reentrant, so this method does
   * not take it when the caller already holds it: `withLock()` counts the
   * sections this instance holds, and a `save()` issued from inside one writes
   * inside that section. That is the same discipline the nested-lock refusal
   * pins: the lock is still not reentrant, only the writer knows when it is
   * already inside it.
   *
   * Contention surfaces as the pre-existing QUEUE_LOCK_TIMEOUT, so an
   * unlocked writer is REFUSED rather than silently losing its write to a
   * concurrent one.
   */
  save() {
    // Resolved OUTSIDE the write: an unconfigured store is a configuration
    // refusal and keeps its own name, never "the file could not be written".
    const storagePath = this.storagePath;
    const dir = path.dirname(storagePath);
    const tempPath = `${storagePath}.tmp-${process.pid}-${Date.now()}`;
    if (this._lockDepth > 0) {
      // The caller already holds this instance's queue critical section.
      return this._saveUnlocked(storagePath, tempPath);
    }
    // The link guard runs BEFORE the lock is taken: the lock directory lives
    // beside the queue file, so acquiring it first would create a directory
    // inside the very linked path the guard exists to refuse.
    try {
      assertNoSymlinkComponents(tempPath);
    } catch (err) {
      throw new Error(`QUEUE_STORAGE_WRITE_FAILED: ${err?.message}`, {
        cause: err,
      });
    }
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const lockDir = lockDirFor(dir, `${path.basename(storagePath)}.lock`);
    try {
      return withFileLockSync(lockDir, () =>
        this._saveUnlocked(storagePath, tempPath),
      );
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

  /**
   * The write itself, with the queue lock already held by the caller.
   *
   * Every mutator reaches this through `withLock()`, which reloads the durable
   * projection first; `save()` reaches it through the lock it takes itself.
   * Splitting it out is what lets `save()` self-lock without deadlocking the
   * `withLock(() => { ... save() })` paths.
   */
  _saveUnlocked(storagePath = this.storagePath, tempPath = null) {
    // M12/T2.2-R2 B-12: `.tmp-<pid>-<ms>` is predictable, so the temp has to be
    // created (`"wx"`) rather than adopted from whatever is already at that path,
    // and a failed attempt has to remove what it made. `topology/lib/ledger.mjs`
    // already wrote its snapshot this way; this is the same discipline, not a new
    // atomic writer.
    const temp = tempPath ?? `${storagePath}.tmp-${process.pid}-${Date.now()}`;
    let fd = null;
    let tempIsOurs = false;
    try {
      const dir = path.dirname(storagePath);
      // Before anything is created: `mkdirSync(recursive)` would otherwise happily
      // materialize the queue through a symlinked ancestor.
      assertNoSymlinkComponents(temp);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const nextProjectionVersion = this._projectionVersion + 1;
      const data = Array.from(this.queue.values());
      fd = openSync(temp, "wx", 0o600);
      tempIsOurs = true;
      writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(temp, storagePath);
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
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* preserve the original write failure */
        }
      }
      // Closed first, so the removal can succeed on Windows as well as POSIX.
      // Only ever a temp this process created: an `EEXIST` refusal is someone
      // else's file, and deleting it would turn a refusal into a side effect.
      if (tempIsOurs) removeWriterResidue(temp);
      throw new Error(`QUEUE_STORAGE_WRITE_FAILED: ${err?.message}`, {
        cause: err,
      });
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
    // M11/T3 A4: the queue is shared durable state and withLock reloads the
    // projection before mutating. enqueueTask was the one mutator that wrote
    // without it, so a concurrent claimTask lease could be clobbered by a stale
    // in-memory projection.
    return this.withLock(() => {
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
    });
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
   * M10/T2-R2: run `operation` inside the queue critical section, and only
   * while the named execution still holds CURRENT execution authority.
   *
   * Why this exists. A queue lease answers "does this execution still possess
   * current execution authority?", which is a different question from the one a
   * ledger binding answers ("which task/run did this session belong to?").
   * Stale recovery revokes the lease and increments the attempt generation, but
   * the historical binding survives as audit history — so a governance consumer
   * that trusted the binding alone kept authorizing governed mutation for a run
   * whose authority had already been revoked.
   *
   * Why the operation runs HERE and not in a caller-side pre-check. A pre-check
   * is a TOCTOU hole: recovery could revoke the lease between the check and the
   * authoritative write. `withExecutionFence` therefore holds the SAME queue
   * file lock that `claimTaskById` and `detectAndRecoverStaleTasks` hold, and it
   * runs the caller's authoritative commit inside that critical section, so a
   * revocation cannot interleave with the commit. This is the existing
   * cross-process mechanism, not a new lock or service.
   *
   * Lock ordering: queue lock is always taken BEFORE the ledger writer lock
   * (the operation it wraps commits a ledger event). No path in this repository
   * takes the ledger writer lock and then the queue lock, so the ordering has no
   * cycle.
   *
   * `withLock` reloads the projection from durable storage first, so a revoked
   * or superseded lease can never be observed as live through a stale in-memory
   * copy. Every failure mode denies: an absent task, a non-EXECUTING status, a
   * different claimant, a mismatched or absent lease, a superseded attempt
   * generation, and an elapsed lease expiry. Contention surfaces as the
   * pre-existing QUEUE_LOCK_TIMEOUT, which is also a denial.
   *
   * @param {{taskId: string, claimedBy: string, leaseId: string, attempt: number}} fence
   * @param {() => unknown} operation
   */
  withExecutionFence(fence, operation) {
    if (typeof operation !== "function") {
      throw new TypeError(
        "QUEUE_FENCE_CONTRACT_INVALID: operation is required",
      );
    }
    const taskId = fence?.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new TypeError("QUEUE_FENCE_CONTRACT_INVALID: taskId is required");
    }
    return this.withLock(() => {
      const item = this.queue.get(taskId);
      if (!item) {
        throw new Error(
          `EXECUTION_FENCE_REVOKED: ${taskId} is absent from the queue projection`,
        );
      }
      // The attempt generation is checked first: it is the fence that
      // supersession actually moves, and a higher generation means this
      // execution is history no matter what the rest of the item still says.
      if (
        !Number.isSafeInteger(fence.attempt) ||
        item.attempt !== fence.attempt
      ) {
        throw new Error(
          `EXECUTION_FENCE_SUPERSEDED: ${taskId} is at attempt ${item.attempt}, not ${fence.attempt}`,
        );
      }
      if (item.status !== TASK_STATES.EXECUTING) {
        throw new Error(
          `EXECUTION_FENCE_REVOKED: ${taskId} is ${item.status}, not EXECUTING`,
        );
      }
      if (item.claimedBy !== fence.claimedBy) {
        throw new Error(
          `EXECUTION_FENCE_REVOKED: ${taskId} is claimed by ${item.claimedBy}, not ${fence.claimedBy}`,
        );
      }
      if (
        typeof fence.leaseId !== "string" ||
        fence.leaseId.length === 0 ||
        item.leaseId !== fence.leaseId
      ) {
        throw new Error(
          `EXECUTION_FENCE_REVOKED: ${taskId} no longer holds the presented lease`,
        );
      }
      if (
        typeof item.leaseExpiresAt === "string" &&
        !Number.isNaN(Date.parse(item.leaseExpiresAt)) &&
        Date.parse(item.leaseExpiresAt) <= Date.now()
      ) {
        throw new Error(
          `EXECUTION_FENCE_EXPIRED: ${taskId} lease expired at ${item.leaseExpiresAt}`,
        );
      }
      // F-056 (legacy R1-A06-01): the lease clock moved only through
      // `heartbeat()`, and `heartbeat()` had no production caller, so
      // `lastHeartbeatAt` stood at `claimedAt` for the whole life of every
      // EXECUTING item. The lease therefore expired DEFAULT_LEASE_SECONDS
      // after the CLAIM rather than after the owner's last activity, and the
      // stale detector - which keys on heartbeat age - could not tell a live
      // execution from a dead one.
      //
      // Committing a governed mutation under this fence IS the owner's proof
      // of liveness: it presented the current leaseId, the current attempt
      // and the current claimant, and every one of them was just verified
      // against durable state inside the queue's own critical section. So the
      // lease is renewed here, from that proof.
      //
      // What this deliberately does not do:
      //  - it never extends an EXPIRED lease: the check above throws
      //    EXECUTION_FENCE_EXPIRED first, so a resurrected owner cannot
      //    reclaim a lease it already lost;
      //  - it never revives a REVOKED or SUPERSEDED lease: the attempt,
      //    status, claimant and leaseId checks above throw first;
      //  - it never mints a lease, an attempt or an owner: only the two
      //    timestamps of the lease that is already held move;
      //  - it never requeues anything: recovery stays the only path back to
      //    QUEUED, and a live execution is no longer mistaken for a dead one.
      this._renewLeaseUnderFence(item);
      return operation(item);
    });
  }

  /**
   * F-056 (legacy R1-A06-01): renew the lease of the execution that has just
   * proved, under the current-execution fence, that it is still alive.
   *
   * The lease window is read back from the lease the item already holds
   * (`leaseExpiresAt - lastHeartbeatAt`), so this introduces no second source
   * of truth for how long a lease lasts and cannot lengthen it: a dead owner
   * still loses its authority exactly DEFAULT_LEASE_SECONDS after its last
   * action.
   *
   * Anything that would make the renewal ambiguous leaves the lease exactly as
   * it was. An item whose two timestamps are missing or unparsable is not a
   * lease this queue issued, and guessing a window for it would be worse than
   * not renewing.
   */
  _renewLeaseUnderFence(item) {
    const expiresAt = Date.parse(item?.leaseExpiresAt ?? "");
    const lastBeat = Date.parse(item?.lastHeartbeatAt ?? "");
    if (!Number.isFinite(expiresAt) || !Number.isFinite(lastBeat)) return;
    const windowMs = expiresAt - lastBeat;
    if (!Number.isFinite(windowMs) || windowMs <= 0) return;
    const now = Date.now();
    item.lastHeartbeatAt = new Date(now).toISOString();
    item.leaseExpiresAt = new Date(now + windowMs).toISOString();
    try {
      this.save();
    } catch (err) {
      // A durable write that failed must not leave process memory ahead of
      // persisted authority, and the caller's commit must not run against a
      // lease that only exists in memory. Reloading restores the projection
      // and the failed write denies the mutation.
      try {
        this.load();
      } catch {
        // The projection could not be re-read either. The original write
        // failure is the one that matters, so it is the one that is reported.
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
   *
   * M12/T9 F-026: completion is bound to the AUTHORITATIVE owner and to a
   * result digest the queue itself recorded.
   *
   * Before this, the identity check ran only when `item.ownerPrincipalRef` was
   * non-empty, so a task with no recorded owner accepted ANY non-empty
   * principal: the queue recorded an identity instead of verifying one. Now a
   * task with no authoritative owner is refused outright - an owner that was
   * never projected from the ledger cannot be presented by anyone.
   *
   * The digest half is bound the same way. The digest must be the one the
   * queue recorded when the execution finished (`finishExecution` wrote both
   * the digest and the finish timestamp, and no other path writes either), so a
   * caller cannot satisfy the check with a value it minted, and the recorded
   * digest must belong to the CURRENT attempt rather than a superseded one.
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
        // M7-012: fake or stale confirmation references are denied. The
        // digest must equal the current authoritative result digest.
        if (typeof item.resultDigest !== "string" || !item.resultDigest) {
          throw new Error(
            "RESULT_DIGEST_REQUIRED: No authoritative result digest is recorded for this task",
          );
        }
        // M12/T9 F-026: the digest must be the one the queue's OWN finish path
        // recorded. `finishExecution` writes the digest together with the
        // finish timestamp and the attempt it belongs to, so a digest that is
        // not accompanied by that record was not produced by the authoritative
        // execution, and a digest bound to a superseded attempt is history.
        if (
          typeof item.executionFinishedAt !== "string" ||
          !item.executionFinishedAt
        ) {
          throw new Error(
            "RESULT_DIGEST_REQUIRED: No authoritative finished execution is recorded for this task",
          );
        }
        if (
          Number.isSafeInteger(item.resultAttempt) &&
          item.resultAttempt !== item.attempt
        ) {
          throw new Error(
            "RESULT_MISMATCH: The recorded result digest belongs to a superseded attempt",
          );
        }
        if (resultDigest !== item.resultDigest) {
          throw new Error(
            "RESULT_MISMATCH: Confirmation does not reference the current authoritative result",
          );
        }
        // M12/T9 F-026: Lane H2. The authoritative owner principal is projected
        // onto this task from the ledger; when it is ABSENT there is nobody to
        // verify against, so completion is refused rather than accepted from
        // whoever presented a non-empty string. When it is present, the
        // presented principal must BE it.
        if (
          typeof item.ownerPrincipalRef !== "string" ||
          !item.ownerPrincipalRef
        ) {
          throw new Error(
            "OWNER_PRINCIPAL_REQUIRED: Completion requires an authoritative task owner",
          );
        }
        if (userPrincipalRef !== item.ownerPrincipalRef) {
          throw new Error(
            "USER_PRINCIPAL_MISMATCH: Completion principal is not the authoritative task owner",
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

  /**
   * M12/T9 F-002: the durable queue item for one task id, or `null`.
   *
   * The read re-reads the file, so this never answers from a map that was
   * populated when the instance was created — the projection a process reads
   * is the projection every writer wrote.
   */
  getTask(taskId) {
    this.refresh();
    return this.queue.get(taskId) || null;
  }

  /**
   * M12/T9 F-002: the durable active-task set, read from the file.
   */
  listActiveTasks() {
    this.refresh();
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
          const capabilities = projectGovernedCapabilities(ledgerTask.nodes);
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
    // M11/T3 A4: serialized like every other queue mutator, so a concurrent
    // writer cannot have its durable projection erased from a stale copy.
    this.withLock(() => {
      this.queue.clear();
      this.save();
    });
  }
}

/**
 * M12/T9 F-002: the process-wide queue projection.
 *
 * It is NOT a load-once singleton any more: the instance holds no state until
 * the governance store root is configured, it touches no file at import, and
 * every read re-reads the durable file. Until the root is configured, every
 * use is a named refusal (`GOVERNANCE_STORE_ROOT_UNCONFIGURED`) rather than a
 * silent home-directory default.
 */
export const defaultQueueManager = new QueueManager();
