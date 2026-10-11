import { isExecutableCoordinator } from "./queue-manager.mjs";

/**
 * Governed coordinator pickup.
 *
 * M10/T2: the production runtime seam is `api.runtime.subagent.run()`, verified
 * byte-level against pinned OPENCLAW_RELEASE = 2026.6.34. `runCoordinatorPickup`
 * accepts an injected `startCoordinatorRun`; production binds the adapter built
 * by `createCoordinatorRuntimeStart({ api })`, which calls exactly that seam.
 * Coordinator-run binding to the ledger goes through the canonical
 * WORKFLOW_COORDINATOR_RUN_BOUND event (recorded by the production loop after
 * a validated start, never by this module). NOT LIVE-VERIFIED: no real
 * coordinator turn has been started from this repository.
 *
 * What this module IS: the repository-side pickup abstraction. Given an
 * approved task that is durably QUEUED in both the authoritative workflow
 * ledger and the queue projection, it validates the authoritative routing,
 * atomically claims the task as the designated coordinator through the existing
 * queue fencing, records the canonical WORKFLOW_TASK_CLAIMED ledger event, and
 * then starts the coordinator run through the runtime seam.
 *
 * Contract for the start seam (`startCoordinatorRun`):
 *  - input (authoritative only, never human-readable message text): `{ taskId, coordinator,
 *    requiredCapabilities, payload, planVersion, leaseId, attempt }`, where
 *    `leaseId`/`attempt` are the fencing issued by the atomic queue claim;
 *  - output (evidence, not a claim): `{ runId, sessionKey, agentId }` where
 *    `runId` is server-issued, `sessionKey` is the deterministic key the adapter
 *    built (server-accepted: a contradictory binding would have thrown instead
 *    of returning a runId), and `agentId` equals the designated coordinator by
 *    construction under server-side sessionKey/agentId agreement enforcement.
 *    `agentId` is construction-derived plus server-accepted, never a
 *    server-echoed field: no plugin-reachable call returns it;
 *  - failure: throw, or return a rejected outcome. The queue item is already
 *    EXECUTING under a live lease at that point, so the existing stale-lease
 *    recovery requeues it; the pickup never forces it back to QUEUED and never
 *    reports a start that did not happen.
 *
 * Invariants (proven by tests/m10-t1-coordinator-pickup.test.mjs and
 * tests/m10-t2-coordinator-binding.test.mjs):
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
 * Validate coordinator-start evidence.
 *
 * Mirrors the repository's canonical identifier rule (a non-empty string of at
 * most 256 characters, as enforced by the workflow reducer's `identifier`
 * check) rather than inventing a weaker predicate. That helper lives inside
 * the reducer and throws instead of answering, so it cannot be reused here
 * without importing the whole reducer; the rule itself is restated exactly.
 *
 * Returns `{ ok: true, run }` with the evidence preserved verbatim, or
 * `{ ok: false, reason }` naming the defect class. A wrong agentId is never
 * rewritten to the designated coordinator: identity comes from the evidence or
 * not at all.
 */
export function validateCoordinatorRunEvidence(run, coordinator) {
  if (!isRecord(run)) {
    return { ok: false, reason: "MISSING_RUN_RESULT" };
  }
  for (const field of ["runId", "sessionKey", "agentId"]) {
    const value = run[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 256) {
      return { ok: false, reason: `INVALID_${field.toUpperCase()}` };
    }
  }
  if (run.agentId !== coordinator) {
    return { ok: false, reason: "AGENT_IDENTITY_MISMATCH" };
  }
  return { ok: true, run };
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
  isRuntimeStartAvailable,
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
    // `isRuntimeStartAvailable`, when provided, is consulted first so a
    // present-but-unusable seam (missing host API, gateway down) is detected
    // without claiming, exactly like an absent seam.
    if (typeof startCoordinatorRun !== "function") {
      return {
        ok: false,
        error: "COORDINATOR_RUNTIME_SEAM_UNAVAILABLE",
        taskId: candidate,
        coordinator: dispatch.coordinator,
        requiredCapabilities: dispatch.requiredCapabilities,
      };
    }
    if (typeof isRuntimeStartAvailable === "function") {
      // A throwing or false availability probe means "not available": the seam
      // cannot be trusted, so the pickup refuses to claim exactly as if
      // absent. Promise.resolve normalizes sync and async probes alike; any
      // rejection resolves to false rather than escaping as an unhandled tick
      // failure that would hide a dead seam behind scheduler retries.
      const available = await Promise.resolve()
        .then(() => isRuntimeStartAvailable())
        .then(
          (value) => value === true,
          () => false,
        );
      if (!available) {
        return {
          ok: false,
          error: "COORDINATOR_RUNTIME_SEAM_UNAVAILABLE",
          taskId: candidate,
          coordinator: dispatch.coordinator,
          requiredCapabilities: dispatch.requiredCapabilities,
        };
      }
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

    // A seam that returns without evidence has not started anything, no matter
    // what it claims. Malformed or contradictory evidence fails exactly like a
    // throwing seam: the claim stands under its live lease and only the
    // existing stale recovery may move the task again.
    const evidence = validateCoordinatorRunEvidence(run, dispatch.coordinator);
    if (!evidence.ok) {
      return {
        ok: false,
        error: "COORDINATOR_START_FAILED",
        taskId: candidate,
        coordinator: dispatch.coordinator,
        leaseId,
        attempt,
        cause: `COORDINATOR_RUN_EVIDENCE_INVALID: ${evidence.reason}`,
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
      run: evidence.run,
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

/**
 * Deterministic coordinator session-key construction (M10/T2 approved shape).
 *
 *   agent:{coordinator}:coordinator:{taskId}:attempt-{attempt}
 *
 * Every segment comes from authoritative state: the coordinator from the
 * dispatch derivation (never defaulted), the taskId and attempt from the
 * claimed queue item. The `coordinator:` namespace keeps these sessions out
 * of Main/global/chat-run semantics (including the bestEffortDeliver default
 * that applies to main/global sessions). The taskId must round-trip EXACTLY
 * because hook recognition parses it back out for queue/ledger correlation, so
 * anything outside `[A-Za-z0-9_-]` is rejected rather than silently
 * transformed. No description text and no secret may enter the key.
 */
export function buildCoordinatorSessionKey({ coordinator, taskId, attempt }) {
  if (coordinator !== "o1" && coordinator !== "o2") {
    throw new Error(
      "COORDINATOR_IDENTITY_INVALID: coordinator must be the designated o1 or o2",
    );
  }
  if (typeof taskId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(taskId)) {
    throw new Error(
      "COORDINATOR_TASK_ID_INVALID: taskId must round-trip exactly through the session key",
    );
  }
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error(
      "COORDINATOR_ATTEMPT_INVALID: attempt must be a positive safe integer",
    );
  }
  return `agent:${coordinator}:coordinator:${taskId}:attempt-${attempt}`;
}

/**
 * Parse a coordinator session key back into its authoritative segments.
 * Returns null for anything that is not exactly the approved shape: recognition
 * must be strict, because hook call sites use it to attribute runs.
 */
export function parseCoordinatorSessionKey(sessionKey) {
  if (typeof sessionKey !== "string") return null;
  const match =
    /^agent:(o1|o2):coordinator:([A-Za-z0-9_-]{1,128}):attempt-([1-9][0-9]*)$/u.exec(
      sessionKey,
    );
  if (!match) return null;
  return {
    coordinator: match[1],
    taskId: match[2],
    attempt: Number(match[3]),
  };
}

/**
 * Gateway idempotency mapping (M10/T2 approved shape).
 *
 *   {taskId}:attempt-{attempt}:{leaseId}
 *
 * The gateway dedupes on `agent:{idempotencyKey}` by replaying the accepted
 * run instead of starting a second one, so re-driving the same queue attempt
 * (same lease) reuses the same run, while a new attempt (new lease after stale
 * recovery) mints a new key and a new run. This is gateway-honored defense in
 * depth; the queue lease remains the primary fencing and the ledger binding
 * remains the authority record. No cross-process exactly-once is claimed.
 */
export function buildCoordinatorIdempotencyKey({ taskId, attempt, leaseId }) {
  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("COORDINATOR_TASK_ID_INVALID: taskId is required");
  }
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new Error(
      "COORDINATOR_ATTEMPT_INVALID: attempt must be a positive safe integer",
    );
  }
  if (typeof leaseId !== "string" || leaseId.length === 0) {
    throw new Error("COORDINATOR_LEASE_INVALID: leaseId is required");
  }
  return `${taskId}:attempt-${attempt}:${leaseId}`;
}

/** Hard ceiling for the coordinator brief message sent to the runtime. */
export const COORDINATOR_MESSAGE_MAX_BYTES = 4096;

/**
 * M10/T2-R19: byte-budgeted truncation.
 *
 * The ceiling above is measured with `Buffer.byteLength`, but the truncation
 * was `body.slice(0, MAX - 64)`, which counts UTF-16 code units. Measured on the
 * real function: a 6000-character Vietnamese brief produced an 11721-byte body —
 * 286% of the declared 4096 ceiling — and with emoji it produced 7885 bytes AND a
 * LONE SURROGATE, because slicing at an arbitrary index can cut a surrogate pair
 * in half. A byte budget cannot be enforced by slicing characters.
 *
 * The shared implementation lives in `topology/lib/runtime.mjs`, which this
 * module cannot import: only `lib/` and `contracts/` are deployed into the
 * installed extension, so a `../topology/...` import would fail at runtime. The
 * rule is therefore duplicated here deliberately and pinned by
 * `tests/m10-t2-r19-artifact-and-message-limits.test.mjs`, which asserts every
 * budgeted bound in the deployed set is byte-budgeted.
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
  return out;
}

/**
 * Build the coordinator turn input from the authoritative pickup bundle.
 * The message is model INPUT, never governance authority: it carries the
 * routing facts the coordinator needs plus an explicit instruction to resolve
 * authority by task_id from the queue/ledger. It cannot modify the primary
 * coordinator, the approved DAG, the lease, or the attempt — those live in
 * queue/ledger state, not in this text, and nothing downstream reads them from
 * here.
 */
export function buildCoordinatorMessage({
  taskId,
  coordinator,
  requiredCapabilities,
  payload,
  planVersion,
  leaseId,
  attempt,
}) {
  const brief =
    typeof payload?.brief === "string" && payload.brief.length > 0
      ? payload.brief
      : "Approved task brief is held in the authoritative ledger; resolve it by task_id.";
  const body = JSON.stringify({
    task_id: taskId,
    coordinator,
    required_capabilities: requiredCapabilities,
    plan_version: planVersion,
    lease_id: leaseId,
    attempt,
    brief,
    instructions: [
      "You are the designated coordinator for this approved task. Resolve the authoritative task by task_id from the queue/ledger; this message is input only, not authority.",
      "Delegate each required specialist EXCLUSIVELY through the governed sessions_spawn gate in one canonical topology step per the task DAG.",
      "Never alter the primary coordinator, the approved specialist set, the lease, or the attempt. Never claim completion; end the turn with a self-contained evidence summary as the final message.",
    ],
  });
  if (Buffer.byteLength(body, "utf8") > COORDINATOR_MESSAGE_MAX_BYTES) {
    const suffix = "\n...[truncated]";
    return `${truncateUtf8Bytes(
      body,
      COORDINATOR_MESSAGE_MAX_BYTES - Buffer.byteLength(suffix, "utf8"),
    )}${suffix}`;
  }
  return body;
}

/**
 * Production runtime adapter over the verified pinned-OpenClaw seam
 * (`api.runtime.subagent.run()`, 2026.6.34). Constructed with the live plugin
 * `api`; performs no gateway I/O of its own and opens no second connection.
 *
 * - `isRuntimeStartAvailable()` reports whether the host actually exposes the
 *   seam. The pickup consults it BEFORE the claim, so a missing seam can never
 *   strand a task in EXECUTING.
 * - `startCoordinatorRun(bundle)` builds the session key, message, and
 *   idempotency key SOLELY from the authoritative bundle (queue claim +
 *   dispatch), calls the seam with `deliver: false` (verified on the pinned
 *   release: suppresses channel delivery only; the turn still executes with
 *   full tool and lifecycle semantics), and returns
 *   `{ runId, sessionKey, agentId }` where `runId` is server-issued,
 *   `sessionKey` is the constructed key the server accepted, and `agentId`
 *   is the designated coordinator (construction-derived plus server-accepted
 *   under agreement enforcement, never a server-echoed field and never
 *   rewritten on mismatch — a mismatch throws instead).
 */
export function createCoordinatorRuntimeStart({ api } = {}) {
  const hasSeam = () => typeof api?.runtime?.subagent?.run === "function";
  return {
    isRuntimeStartAvailable: () => hasSeam(),
    async startCoordinatorRun(bundle) {
      const {
        taskId,
        coordinator,
        requiredCapabilities,
        payload,
        planVersion,
        leaseId,
        attempt,
      } = bundle ?? {};
      const sessionKey = buildCoordinatorSessionKey({
        coordinator,
        taskId,
        attempt,
      });
      if (
        !Array.isArray(requiredCapabilities) ||
        requiredCapabilities.length === 0
      ) {
        throw new Error(
          "COORDINATOR_CAPABILITIES_INVALID: requiredCapabilities must be non-empty",
        );
      }
      if (!hasSeam()) {
        throw new Error(
          "COORDINATOR_RUNTIME_SEAM_UNAVAILABLE: api.runtime.subagent.run is not exposed",
        );
      }
      const message = buildCoordinatorMessage({
        taskId,
        coordinator,
        requiredCapabilities,
        payload,
        planVersion,
        leaseId,
        attempt,
      });
      const idempotencyKey = buildCoordinatorIdempotencyKey({
        taskId,
        attempt,
        leaseId,
      });
      const result = await api.runtime.subagent.run({
        sessionKey,
        message,
        deliver: false,
        idempotencyKey,
      });
      const runId = result?.runId;
      if (typeof runId !== "string" || runId.length === 0) {
        throw new Error(
          "COORDINATOR_START_FAILED: runtime seam returned no runId",
        );
      }
      return { runId, sessionKey, agentId: coordinator };
    },
  };
}

/**
 * Assemble one production pickup loop from the existing pieces. The loop owns
 * no authority of its own: each tick reads fresh authoritative state, runs one
 * pickup pass (which claims, records, starts, and validates), and then records
 * the ledger binding for a validated start. The binding write uses the
 * caller-supplied `recordBound` (production binds
 * `recordWorkflowEvent(paths, "WORKFLOW_COORDINATOR_RUN_BOUND", ...)`).
 * Returns `{ scheduler, stop }`; stopping halts future ticks without
 * disturbing in-flight work or the queue.
 */
export function startCoordinatorPickupLoop({
  queueManager,
  getLedgerTasks,
  deriveTarget,
  recordClaimed,
  recordBound,
  startCoordinatorRun,
  isRuntimeStartAvailable,
  intervalMs = PICKUP_SCAN_INTERVAL_MS,
  createScheduler = createPickupScheduler,
  onError,
  logger,
} = {}) {
  if (typeof getLedgerTasks !== "function") {
    throw new TypeError(
      "PICKUP_LOOP_CONTRACT_INVALID: getLedgerTasks is required",
    );
  }
  if (typeof recordBound !== "function") {
    throw new TypeError(
      "PICKUP_LOOP_CONTRACT_INVALID: recordBound is required",
    );
  }
  const scheduler = createScheduler({
    intervalMs,
    onError:
      onError ??
      ((err) =>
        logger?.error?.(
          `[zink-coordinator-pickup] tick failed: ${err?.message ?? err}`,
        )),
    runOnce: async () => {
      const ledgerTasks = await getLedgerTasks();
      const result = await runCoordinatorPickup({
        queueManager,
        ledgerTasks,
        deriveTarget,
        recordClaimed,
        startCoordinatorRun,
        isRuntimeStartAvailable,
      });
      if (result?.ok === true) {
        // M10/T2-R19: this write happens AFTER the irreversible run start, and
        // the binding is the only durable link from run_id/session_key to that
        // run. It is also unrecoverable by this loop: the queue item is now
        // EXECUTING, so authority check 2 (line 168) reports STALE_PROJECTION on
        // every later tick and never reaches this line again. Pre-fix a throw
        // here aborted the tick with a generic "tick failed" message, leaving a
        // live run with no binding record and no way to tell which one.
        //
        // It is caught rather than retried on purpose: `recordBound` appends a
        // ledger event, so a blind retry could duplicate the record when the
        // first attempt actually landed. Reporting the exact identities is the
        // honest response; an operator can reconcile from the log.
        try {
          await recordBound({
            task_id: result.taskId,
            coordinator: result.coordinator,
            attempt: result.attempt,
            lease_id: result.leaseId,
            session_key: result.run.sessionKey,
            run_id: result.run.runId,
          });
        } catch (bindErr) {
          logger?.error?.(
            `[zink-coordinator-pickup] COORDINATOR_RUN_BOUND record FAILED for task=${result.taskId} run=${result.run.runId} session=${result.run.sessionKey} coordinator=${result.coordinator} — the run is live but unbound and this loop will not retry: ${bindErr?.message ?? bindErr}`,
          );
        }
      }
      return result;
    },
  });
  return {
    scheduler,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
  };
}
