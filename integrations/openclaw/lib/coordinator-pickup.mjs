import { isExecutableCoordinator } from "./queue-manager.mjs";

/**
 * Governed coordinator pickup.
 *
 * PARTIAL — RUNTIME CONTRACT BLOCKER (not live-verified).
 *
 * What this module IS: the repository-side pickup abstraction. Given an
 * approved task that is durably QUEUED in both the authoritative workflow
 * ledger and the queue projection, it validates the authoritative routing,
 * atomically claims the task as the designated coordinator through the existing
 * queue fencing, records the canonical WORKFLOW_TASK_CLAIMED ledger event, and
 * then starts the coordinator run through an injected runtime seam.
 *
 * What this module IS NOT: a running consumer. There is deliberately no live
 * wiring in the production plugin, because the one production seam it needs
 * does not exist in this repository: a host API that starts a governed agent
 * turn as `o1`/`o2`. The plugin host surface this repository can prove from its
 * own code is `registerTool`, `logger`, `on(...)` for governance hooks
 * (`before_tool_call`, `before_prompt_build`, `message_received`,
 * `message_sending`, `subagent_spawned`, `subagent_ended`, `gateway_stop`),
 * `registerInteractiveHandler`, and outbound channel adapters. None of those
 * starts an agent turn. Until such a seam exists, `runCoordinatorPickup`
 * requires an injected `startCoordinatorRun` and reports
 * COORDINATOR_RUNTIME_SEAM_UNAVAILABLE without claiming anything.
 *
 * Smallest contract for the missing seam (`startCoordinatorRun`):
 *  - input (authoritative only, never human-readable message text): `{ taskId, coordinator,
 *    requiredCapabilities, payload, planVersion, leaseId, attempt }`, where
 *    `leaseId`/`attempt` are the fencing issued by the atomic queue claim;
 *  - output (evidence, not a claim): an object proving a governed coordinator
 *    turn actually started, at minimum `{ runId, sessionKey, agentId }` with
 *    `agentId` equal to the designated coordinator;
 *  - failure: throw, or return a rejected outcome. The queue item is already
 *    EXECUTING under a live lease at that point, so the existing stale-lease
 *    recovery requeues it; the pickup never forces it back to QUEUED and never
 *    reports a start that did not happen.
 *
 * Invariants (all proven by tests/m10-t1-coordinator-pickup.test.mjs):
 *  - the claimant is always the ledger's `primaryCoordinator`, never a default
 *    and never a capability-matched substitute;
 *  - every requested specialist is contained in the canonical
 *    AGENT_SPAWN_POLICY for that coordinator (via the injected dispatch
 *    derivation, which production must bind to deriveGovernedDispatchTarget);
 *  - the queue moves QUEUED -> EXECUTING only through `claimTaskById`, never by
 *    manual status assignment;
 *  - the ledger moves QUEUED -> EXECUTING only through the canonical
 *    WORKFLOW_TASK_CLAIMED event;
 *  - a human-readable notification is never an input, so altering or deleting it
 *    cannot change routing;
 *  - no handoff-release status is representable anywhere in this module: the
 *    strongest outcome is a claimed, started coordinator run.
 */

/**
 * Default scan cadence for a production pickup loop, if one is ever wired.
 *
 * Justification: the existing queue lease lives 300s and stale recovery runs
 * at 600s. A 30s cadence bounds pickup latency to one tenth of a lease, so a
 * claimed task cannot expire before its coordinator turn begins, while the
 * scan itself is a single in-memory pass with no network I/O.
 */
export const PICKUP_SCAN_INTERVAL_MS = 30_000;

const QUEUED = "QUEUED";
const EXECUTING = "EXECUTING";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Run one coordinator pickup pass.
 *
 * Either picks up a single named task (`taskId`) or scans for the first
 * actionable QUEUED item. Returns a truthful outcome; never throws for
 * runtime conditions (missing programmer dependencies still throw, because a
 * miswired pickup must fail loudly rather than idle silently).
 */
export async function runCoordinatorPickup({
  queueManager,
  ledgerTasks,
  deriveTarget,
  recordClaimed,
  startCoordinatorRun,
  taskId = null,
} = {}) {
  if (!queueManager || typeof queueManager.claimTaskById !== "function") {
    throw new TypeError("PICKUP_CONTRACT_INVALID: queueManager is required");
  }
  if (typeof deriveTarget !== "function") {
    throw new TypeError("PICKUP_CONTRACT_INVALID: deriveTarget is required");
  }
  if (typeof recordClaimed !== "function") {
    throw new TypeError("PICKUP_CONTRACT_INVALID: recordClaimed is required");
  }

  const items =
    taskId !== null && taskId !== undefined
      ? [queueManager.getTask(taskId)].filter(Boolean)
      : queueManager
          .listActiveTasks()
          .filter((item) => item?.status === QUEUED);

  if (items.length === 0) {
    return taskId !== null && taskId !== undefined
      ? { ok: false, error: "TASK_NOT_FOUND", taskId }
      : { ok: false, error: "NO_PICKUP_CANDIDATE", skipped: [] };
  }

  const skipped = [];
  for (const item of items) {
    const candidate = item.taskId;

    // Authority check 1: the ledger must know this task.
    const ledgerTask = isRecord(ledgerTasks)
      ? ledgerTasks[candidate]
      : undefined;
    if (!isRecord(ledgerTask)) {
      if (taskId !== null && taskId !== undefined) {
        return {
          ok: false,
          error: "AUTHORITATIVE_TASK_NOT_FOUND",
          taskId: candidate,
        };
      }
      skipped.push({
        taskId: candidate,
        reason: "AUTHORITATIVE_TASK_NOT_FOUND",
      });
      continue;
    }

    // Authority check 2: the ledger must still say QUEUED. Anything else means
    // the queue projection is stale, and a stale projection must never start
    // execution.
    if (ledgerTask.workflow_status !== QUEUED) {
      if (taskId !== null && taskId !== undefined) {
        return {
          ok: false,
          error: "STALE_PROJECTION",
          taskId: candidate,
          workflow_status: ledgerTask.workflow_status ?? null,
        };
      }
      skipped.push({
        taskId: candidate,
        reason: "STALE_PROJECTION",
        workflow_status: ledgerTask.workflow_status ?? null,
      });
      continue;
    }

    // Authority check 3: coordinator identity and canonical topology
    // containment, derived from the ledger task — never from a message.
    const dispatch = deriveTarget(ledgerTask);
    if (!isRecord(dispatch) || dispatch.ok !== true) {
      const error =
        (isRecord(dispatch) &&
          typeof dispatch.error === "string" &&
          dispatch.error) ||
        "DISPATCH_TARGET_INVALID";
      if (taskId !== null && taskId !== undefined) {
        return { ok: false, error, taskId: candidate };
      }
      skipped.push({ taskId: candidate, reason: error });
      continue;
    }
    if (!isExecutableCoordinator(dispatch.coordinator)) {
      const error = "COORDINATOR_NOT_EXECUTABLE";
      if (taskId !== null && taskId !== undefined) {
        return { ok: false, error, taskId: candidate };
      }
      skipped.push({ taskId: candidate, reason: error });
      continue;
    }

    // The queue projection must agree with the ledger on who coordinates.
    if (item.primaryCoordinator !== dispatch.coordinator) {
      const error = "COORDINATOR_PROJECTION_MISMATCH";
      if (taskId !== null && taskId !== undefined) {
        return {
          ok: false,
          error,
          taskId: candidate,
          ledger_coordinator: dispatch.coordinator,
          queue_coordinator: item.primaryCoordinator ?? null,
        };
      }
      skipped.push({ taskId: candidate, reason: error });
      continue;
    }

    // The runtime seam is required BEFORE the claim. Without a way to start a
    // governed coordinator turn, claiming would move the task to EXECUTING
    // with nobody to execute it, so the pickup refuses to claim at all.
    if (typeof startCoordinatorRun !== "function") {
      return {
        ok: false,
        error: "COORDINATOR_RUNTIME_SEAM_UNAVAILABLE",
        taskId: candidate,
        coordinator: dispatch.coordinator,
        requiredCapabilities: dispatch.requiredCapabilities,
      };
    }

    // Atomic claim as the designated coordinator, through the existing fencing.
    // `claimTaskById` enforces QUEUED-only, assignment binding, lease issuance
    // and durable write with rollback. Nothing here assigns status manually.
    let claim;
    try {
      claim = queueManager.claimTaskById({
        taskId: candidate,
        agentId: dispatch.coordinator,
      });
    } catch (claimErr) {
      const message = String(claimErr?.message ?? "");
      if (/CONCURRENT_CLAIM_DENIED/u.test(message)) {
        return {
          ok: false,
          error: "PICKUP_ALREADY_CLAIMED",
          taskId: candidate,
        };
      }
      if (/INVALID_STATE_TRANSITION/u.test(message)) {
        return {
          ok: false,
          error: "PICKUP_ALREADY_CLAIMED",
          taskId: candidate,
        };
      }
      return {
        ok: false,
        error: "PICKUP_CLAIM_FAILED",
        taskId: candidate,
        cause: message,
      };
    }

    const leaseId = claim?.leaseId;
    const attempt = claim?.task?.attempt;

    // Ledger claim event: the canonical QUEUED -> EXECUTING transition.
    try {
      await recordClaimed({ taskId: candidate, agentId: dispatch.coordinator });
    } catch (recordErr) {
      // The queue is now EXECUTING under a live lease while the ledger still
      // says QUEUED. That divergence is reported explicitly; the lease keeps
      // the task recoverable through the existing stale recovery, which is the
      // only sanctioned path back. Nothing here forces QUEUED manually.
      return {
        ok: false,
        error: "LEDGER_CLAIM_RECORD_FAILED",
        taskId: candidate,
        coordinator: dispatch.coordinator,
        leaseId,
        attempt,
        cause: String(recordErr?.message ?? recordErr),
      };
    }

    // Start the governed coordinator turn. On failure the claim stands: the
    // task is EXECUTING with a live lease and recovers through the existing
    // stale-lease contract. A failed start is never reported as a start.
    let run;
    try {
      run = await startCoordinatorRun({
        taskId: candidate,
        coordinator: dispatch.coordinator,
        requiredCapabilities: dispatch.requiredCapabilities,
        payload: item.payload ?? {},
        planVersion: item.planVersion,
        leaseId,
        attempt,
      });
    } catch (startErr) {
      return {
        ok: false,
        error: "COORDINATOR_START_FAILED",
        taskId: candidate,
        coordinator: dispatch.coordinator,
        leaseId,
        attempt,
        cause: String(startErr?.message ?? startErr),
      };
    }

    return {
      ok: true,
      status: EXECUTING,
      taskId: candidate,
      coordinator: dispatch.coordinator,
      requiredCapabilities: dispatch.requiredCapabilities,
      leaseId,
      attempt,
      run: run ?? null,
    };
  }

  return { ok: false, error: "NO_PICKUP_CANDIDATE", skipped };
}

/**
 * Minimal bounded in-process pickup scheduler.
 *
 * Not wired into the production plugin: without the runtime start seam there
 * is nothing truthful for a live loop to do. It exists so that, once the seam
 * exists, the loop that drives `runCoordinatorPickup` is already proven:
 * single-flight (overlapping ticks are skipped, never run concurrently),
 * errors are routed to `onError` instead of becoming unhandled rejections, and
 * `stop()` clears the timer so nothing survives plugin unload.
 */
export function createPickupScheduler({
  runOnce,
  intervalMs = PICKUP_SCAN_INTERVAL_MS,
  onError,
} = {}) {
  if (typeof runOnce !== "function") {
    throw new TypeError(
      "PICKUP_SCHEDULER_CONTRACT_INVALID: runOnce is required",
    );
  }
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new TypeError(
      "PICKUP_SCHEDULER_CONTRACT_INVALID: intervalMs must be a positive integer",
    );
  }

  let timer = null;
  let running = false;
  let stopped = true;
  let inFlight = false;

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await runOnce();
    } catch (err) {
      try {
        onError?.(err);
      } catch {
        // An onError handler must never break the loop or throw outward.
      }
    } finally {
      inFlight = false;
      if (!stopped) {
        schedule();
      }
    }
  }

  function schedule() {
    timer = setTimeout(tick, intervalMs);
    // Never keep the process alive on the scheduler's behalf: after stop() the
    // timer is cleared, and unref means a pending tick cannot hold the loop.
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stopped = false;
      void tick();
    },
    stop() {
      stopped = true;
      running = false;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    isRunning() {
      return running && !stopped;
    },
    isTickInFlight() {
      return inFlight;
    },
  };
}
