/**
 * Authority & Action Matrix Enforcement
 * Implements ACTIVE.md Sections 3, 4, 5:
 * Actor + Channel + Task + Current State + Action strict tuple validation.
 *
 * Invariants:
 * 1. USER is the sole final authority for APPROVE, REJECT (approval), ACCEPT/COMPLETE (result), REJECT (result).
 * 2. MAIN is control/governance supervisor: intake, ambiguity, Primary assignment, approval coordination,
 *    REQUEST_REVISION, final office notification. MAIN CANNOT APPROVE or ACCEPT/COMPLETE.
 * 3. O1/O2 are execution supervisors: detailed plan, coordinate specialists, direct user questions in #office,
 *    emit EXECUTION_FINISHED event, submit result, propose revision. O1/O2 CANNOT APPROVE or ACCEPT/COMPLETE.
 * 4. Specialist (Excel, Power BI, SQL, Python): Capability execution only; NO governance authority.
 * 5. Worker: Runtime execution only. Claims queued tasks.
 * 6. EXECUTION_FINISHED is an event, NOT human completion.
 */

export const ACTORS = Object.freeze({
  USER: "user",
  MAIN: "main",
  O1: "o1",
  O2: "o2",
  EXCEL: "excel",
  POWER_BI: "power-bi",
  SQL: "sql",
  PYTHON: "python",
  WORKER: "worker",
});

export const CHANNELS = Object.freeze({
  OFFICE: "office",
  APPROVALS: "approvals",
  RESULTS: "results",
  INCIDENTS: "incidents",
});

export const TASK_STATES = Object.freeze({
  DRAFT: "DRAFT",
  PREFLIGHT: "PREFLIGHT",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  QUEUED: "QUEUED",
  WAITING_FOR_WORKER: "WAITING_FOR_WORKER",
  EXECUTING: "EXECUTING",
  WAITING_FOR_USER: "WAITING_FOR_USER",
  EXECUTION_FINISHED: "EXECUTION_FINISHED",
  VALIDATION_PENDING: "VALIDATION_PENDING",
  RESULT_PENDING_REVIEW: "RESULT_PENDING_REVIEW",
  COMPLETE: "COMPLETE",
  REJECTED: "REJECTED",
  REVISING: "REVISING",
  CANCELLED: "CANCELLED",
  BLOCKED: "BLOCKED",
});

export const ACTIONS = Object.freeze({
  // Approval actions
  APPROVE: "APPROVE",
  REJECT_APPROVAL: "REJECT_APPROVAL",
  REQUEST_REVISION_APPROVAL: "REQUEST_REVISION_APPROVAL",

  // Queue & Worker actions
  CLAIM: "CLAIM",

  // Office interaction actions
  ASK_USER: "ASK_USER",
  ANSWER_USER: "ANSWER_USER",
  FINAL_NOTIFICATION: "FINAL_NOTIFICATION",

  // Execution actions
  EXECUTION_FINISHED: "EXECUTION_FINISHED",
  SIGNIFICANT_PLAN_CHANGE: "SIGNIFICANT_PLAN_CHANGE",

  // Result actions
  SUBMIT_RESULT: "SUBMIT_RESULT",
  ACCEPT_RESULT: "ACCEPT_RESULT",
  REJECT_RESULT: "REJECT_RESULT",
  REQUEST_REVISION_RESULT: "REQUEST_REVISION_RESULT",

  // Incident actions
  REPORT_INCIDENT: "REPORT_INCIDENT",
  RESOLVE_INCIDENT: "RESOLVE_INCIDENT",
});

/**
 * Normalizes input strings to canonical enum values.
 */
export function normalizeActor(actor) {
  if (!actor || typeof actor !== "string") return null;
  const a = actor.toLowerCase().trim();
  if (a === "user" || a === "owner") return ACTORS.USER;
  if (a === "main" || a === "quanly" || a === "quản lý") return ACTORS.MAIN;
  if (a === "o1" || a === "điều phối 1" || a === "dieu phoi 1")
    return ACTORS.O1;
  if (a === "o2" || a === "điều phối 2" || a === "dieu phoi 2")
    return ACTORS.O2;
  if (a === "excel") return ACTORS.EXCEL;
  if (a === "power-bi" || a === "powerbi") return ACTORS.POWER_BI;
  if (a === "sql") return ACTORS.SQL;
  if (a === "python") return ACTORS.PYTHON;
  if (a === "worker" || a === "local-worker") return ACTORS.WORKER;
  return a;
}

export function normalizeChannel(channel) {
  if (!channel || typeof channel !== "string") return null;
  const c = channel.toLowerCase().trim().replace(/^#/, "");
  if (c === "office") return CHANNELS.OFFICE;
  if (c === "approvals" || c === "approval") return CHANNELS.APPROVALS;
  if (c === "results" || c === "result") return CHANNELS.RESULTS;
  if (c === "incidents" || c === "incident") return CHANNELS.INCIDENTS;
  return c;
}

/**
 * Validates whether an action matches the required Actor + Channel + Task + State tuple.
 *
 * @param {Object} params
 * @param {string} params.actor - Acting entity (user, main, o1, o2, etc.)
 * @param {string} params.channel - Discord channel (office, approvals, results, incidents)
 * @param {string} params.taskId - Unique task ID
 * @param {string} params.currentState - Current state of the task
 * @param {string} params.action - Action being attempted
 * @param {string} [params.primaryCoordinator] - Assigned primary coordinator (o1 or o2)
 * @returns {{ allowed: boolean, reason?: string, nextState?: string }}
 */
export function validateActionAuthority({
  actor,
  channel,
  taskId,
  currentState,
  action,
  primaryCoordinator,
}) {
  if (!taskId || typeof taskId !== "string" || !taskId.trim()) {
    return { allowed: false, reason: "TASK_ID_REQUIRED" };
  }

  const normActor = normalizeActor(actor);
  const normChannel = normalizeChannel(channel);
  const normState = currentState ? currentState.toUpperCase().trim() : null;
  const normAction = action ? action.toUpperCase().trim() : null;

  if (!normActor) return { allowed: false, reason: "UNKNOWN_ACTOR" };
  if (!normChannel) return { allowed: false, reason: "UNKNOWN_CHANNEL" };
  if (!normState) return { allowed: false, reason: "INVALID_CURRENT_STATE" };
  if (!normAction) return { allowed: false, reason: "UNKNOWN_ACTION" };

  // -------------------------------------------------------------------------
  // Rule 0: Specialist Enforcement (Specialists cannot take governance actions)
  // -------------------------------------------------------------------------
  if (
    normActor === ACTORS.EXCEL ||
    normActor === ACTORS.POWER_BI ||
    normActor === ACTORS.SQL ||
    normActor === ACTORS.PYTHON
  ) {
    return {
      allowed: false,
      reason: `SPECIALIST_NO_GOVERNANCE: Specialist ${normActor} has execution capability only and cannot take governance action ${normAction}`,
    };
  }

  // -------------------------------------------------------------------------
  // Rule 1: USER-ONLY Actions
  // -------------------------------------------------------------------------
  // APPROVE and REJECT_APPROVAL are strictly USER ONLY
  if (
    normAction === ACTIONS.APPROVE ||
    normAction === ACTIONS.REJECT_APPROVAL
  ) {
    if (normActor !== ACTORS.USER) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only User can approve or reject execution plans",
      };
    }
    if (normChannel !== CHANNELS.APPROVALS) {
      return {
        allowed: false,
        reason: "CHANNEL_MISMATCH: Approval actions must occur in #approvals",
      };
    }
    if (normState !== TASK_STATES.APPROVAL_PENDING) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot approve/reject task in state ${normState}`,
      };
    }
    const nextState =
      normAction === ACTIONS.APPROVE
        ? TASK_STATES.QUEUED
        : TASK_STATES.REJECTED;
    return { allowed: true, nextState };
  }

  // ACCEPT_RESULT and REJECT_RESULT are strictly USER ONLY
  if (
    normAction === ACTIONS.ACCEPT_RESULT ||
    normAction === ACTIONS.REJECT_RESULT
  ) {
    if (normActor !== ACTORS.USER) {
      return {
        allowed: false,
        reason: "AUTHORITY_DENIED: Only User can accept or reject task results",
      };
    }
    if (normChannel !== CHANNELS.RESULTS) {
      return {
        allowed: false,
        reason: "CHANNEL_MISMATCH: Result review must occur in #results",
      };
    }
    if (normState !== TASK_STATES.RESULT_PENDING_REVIEW) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot accept/reject result when state is ${normState} (must be RESULT_PENDING_REVIEW)`,
      };
    }
    const nextState =
      normAction === ACTIONS.ACCEPT_RESULT
        ? TASK_STATES.COMPLETE
        : TASK_STATES.REJECTED;
    return { allowed: true, nextState };
  }

  // -------------------------------------------------------------------------
  // Rule 2: REQUEST_REVISION Actions (User & Main allowed; O1/O2 propose only)
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.REQUEST_REVISION_APPROVAL) {
    if (normActor !== ACTORS.USER && normActor !== ACTORS.MAIN) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only User or Main can formally request plan revision",
      };
    }
    if (normChannel !== CHANNELS.APPROVALS) {
      return {
        allowed: false,
        reason:
          "CHANNEL_MISMATCH: Plan revisions must be coordinated in #approvals",
      };
    }
    if (
      normState !== TASK_STATES.APPROVAL_PENDING &&
      normState !== TASK_STATES.EXECUTING
    ) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot request plan revision in state ${normState}`,
      };
    }
    return { allowed: true, nextState: TASK_STATES.REVISING };
  }

  if (normAction === ACTIONS.REQUEST_REVISION_RESULT) {
    if (normActor !== ACTORS.USER && normActor !== ACTORS.MAIN) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only User or Main can formally request result revision",
      };
    }
    if (normChannel !== CHANNELS.RESULTS) {
      return {
        allowed: false,
        reason:
          "CHANNEL_MISMATCH: Result revisions must be requested in #results",
      };
    }
    if (normState !== TASK_STATES.RESULT_PENDING_REVIEW) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot request result revision in state ${normState}`,
      };
    }
    return { allowed: true, nextState: TASK_STATES.REVISING };
  }

  // -------------------------------------------------------------------------
  // Rule 3: Queue & Worker Claim
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.CLAIM) {
    if (
      normActor !== ACTORS.WORKER &&
      normActor !== ACTORS.O1 &&
      normActor !== ACTORS.O2
    ) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only worker or designated execution coordinator can claim task",
      };
    }
    if (
      normState !== TASK_STATES.QUEUED &&
      normState !== TASK_STATES.WAITING_FOR_WORKER
    ) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot claim task in state ${normState}`,
      };
    }
    return { allowed: true, nextState: TASK_STATES.EXECUTING };
  }

  // -------------------------------------------------------------------------
  // Rule 4: Direct O1/O2 Clarification in #office
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.ASK_USER) {
    if (
      normActor !== ACTORS.O1 &&
      normActor !== ACTORS.O2 &&
      normActor !== ACTORS.MAIN
    ) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only O1, O2 or Main can initiate user clarification",
      };
    }
    if (normChannel !== CHANNELS.OFFICE) {
      return {
        allowed: false,
        reason:
          "CHANNEL_MISMATCH: User clarification must occur directly in #office",
      };
    }
    if (
      normState !== TASK_STATES.EXECUTING &&
      normState !== TASK_STATES.PREFLIGHT
    ) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot ask clarification when state is ${normState}`,
      };
    }
    return { allowed: true, nextState: TASK_STATES.WAITING_FOR_USER };
  }

  if (normAction === ACTIONS.ANSWER_USER) {
    if (normActor !== ACTORS.USER) {
      return {
        allowed: false,
        reason: "AUTHORITY_DENIED: Only User can answer clarification requests",
      };
    }
    if (normChannel !== CHANNELS.OFFICE) {
      return {
        allowed: false,
        reason:
          "CHANNEL_MISMATCH: Clarification answers must be posted in #office",
      };
    }
    if (normState !== TASK_STATES.WAITING_FOR_USER) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Task is not currently waiting for user (state: ${normState})`,
      };
    }
    return { allowed: true, nextState: TASK_STATES.EXECUTING };
  }

  // -------------------------------------------------------------------------
  // Rule 5: Execution Finished Event (O1/O2/Worker -> Validation -> Review)
  // EXECUTION_FINISHED is an event, NOT human completion!
  // -------------------------------------------------------------------------
  if (
    normAction === ACTIONS.EXECUTION_FINISHED ||
    normAction === ACTIONS.SUBMIT_RESULT
  ) {
    if (
      normActor !== ACTORS.O1 &&
      normActor !== ACTORS.O2 &&
      normActor !== ACTORS.WORKER &&
      normActor !== ACTORS.MAIN
    ) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only execution supervisors or worker can emit EXECUTION_FINISHED",
      };
    }
    if (
      primaryCoordinator &&
      (normActor === ACTORS.O1 || normActor === ACTORS.O2)
    ) {
      if (normActor !== primaryCoordinator) {
        return {
          allowed: false,
          reason: `PRIMARY_OWNERSHIP_MISMATCH: Task is owned by ${primaryCoordinator}, not ${normActor}`,
        };
      }
    }
    if (normState !== TASK_STATES.EXECUTING) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot finish execution when state is ${normState}`,
      };
    }
    // Execution finished transitions to VALIDATION_PENDING, which leads to RESULT_PENDING_REVIEW.
    // IT NEVER TRANSITIONS DIRECTLY TO COMPLETE!
    return { allowed: true, nextState: TASK_STATES.RESULT_PENDING_REVIEW };
  }

  // -------------------------------------------------------------------------
  // Rule 6: Significant Plan Change during Execution
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.SIGNIFICANT_PLAN_CHANGE) {
    if (normActor !== ACTORS.O1 && normActor !== ACTORS.O2) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only execution supervisor can propose significant plan changes",
      };
    }
    if (normState !== TASK_STATES.EXECUTING) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Cannot request plan change when state is ${normState}`,
      };
    }
    // Pauses execution and transitions to REVISING for re-approval in #approvals
    return { allowed: true, nextState: TASK_STATES.REVISING };
  }

  // -------------------------------------------------------------------------
  // Rule 7: Final Office Notification
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.FINAL_NOTIFICATION) {
    if (normActor !== ACTORS.MAIN) {
      return {
        allowed: false,
        reason: "AUTHORITY_DENIED: Only Main emits final office notifications",
      };
    }
    if (normChannel !== CHANNELS.OFFICE) {
      return {
        allowed: false,
        reason:
          "CHANNEL_MISMATCH: Final notifications must be posted in #office",
      };
    }
    if (
      normState !== TASK_STATES.COMPLETE &&
      normState !== TASK_STATES.REJECTED
    ) {
      return {
        allowed: false,
        reason: `INVALID_STATE_TRANSITION: Final notification requires terminal state (current: ${normState})`,
      };
    }
    return { allowed: true, nextState: normState };
  }

  return {
    allowed: false,
    reason: `INVALID_ACTION_COMBINATION: Action ${normAction} not allowed for actor ${normActor} in channel ${normChannel} during state ${normState}`,
  };
}
