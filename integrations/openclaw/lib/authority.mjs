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
 * 5. Specialist: Runtime execution only. Claims its own queued execution node.
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

  // Queue & execution-agent actions
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
 * A Discord snowflake, validated. The canonical shape lives in
 * `isDiscordSnowflake` below; `parseIdentifiers` in policy.mjs and every owner
 * gate use that one validator, so a configured identity and the gate that
 * admits it can never disagree about the shape (M12/T9 F-139).
 */

/**
 * The owner actor, derived from CONFIGURATION only.
 *
 * This used to be a hardcoded account snowflake in this function. Two problems,
 * one of them a security problem rather than a hygiene one:
 *
 *   1. It placed a real account identifier in production source, which this
 *      repository's own `.gitleaks.toml` deliberately does not allowlist outside
 *      `tests/`.
 *   2. `normalizeActor` feeds `validateActionAuthority`, and `ACTORS.USER` is the
 *      actor that passes owner-level governance actions. A baked-in literal
 *      therefore made the OWNER AUTHORIZATION IDENTITY a source constant instead
 *      of a deployment decision.
 *
 * The identity now comes only from `DISCORD_OWNER_ID`, and only when it is a
 * well-formed snowflake. When it is absent or malformed no account snowflake is
 * recognised as the owner at all, which is the fail-closed direction: an
 * unrecognised actor falls through `normalizeActor` unchanged and is then denied
 * by the `normActor !== ACTORS.USER` gates.
 *
 * The live approval path passes the literal role `"user"`, which is matched on
 * its own merits above, so this branch never carried live authority.
 */
function isConfiguredOwnerActor(lowerCasedActor) {
  const configured =
    typeof process !== "undefined" ? process.env?.DISCORD_OWNER_ID : undefined;
  if (!isOwnerDiscordId(configured)) return false;
  return lowerCasedActor === configured.toLowerCase();
}

/**
 * The owner id, validated by ONE canonical shape.
 *
 * M12/T9 F-139: the owner id was validated by three different regexes (17-19
 * digits anywhere in the plugin, 17-20 here, 17-20 in the configuration
 * admission), so a 20-digit configured owner was admitted by the configuration
 * and then denied by every owner gate: a fail-closed self-DoS rather than an
 * escalation. `isDiscordSnowflake` is the canonical shape; the owner id uses
 * it and nothing else.
 */
export function isOwnerDiscordId(value) {
  return isDiscordSnowflake(value);
}

/**
 * The owner id, from CONFIGURATION only, or `undefined` when it is absent or
 * malformed. The caller-facing gates read `config.ownerDiscordId`; this is the
 * one place that turns it into a usable identity.
 */
export function resolveOwnerDiscordId(config) {
  const ownerId = config?.ownerDiscordId;
  return isOwnerDiscordId(ownerId) ? ownerId : undefined;
}

/**
 * Normalizes input strings to canonical enum values.
 */
export function normalizeActor(actor) {
  if (!actor || typeof actor !== "string") return null;
  const a = actor.toLowerCase().trim();
  if (a === "user" || a === "owner" || isConfiguredOwnerActor(a))
    return ACTORS.USER;
  if (a === "main" || a === "quanly" || a === "quản lý") return ACTORS.MAIN;
  if (a === "o1" || a === "điều phối 1" || a === "dieu phoi 1")
    return ACTORS.O1;
  if (a === "o2" || a === "điều phối 2" || a === "dieu phoi 2")
    return ACTORS.O2;
  if (a === "excel") return ACTORS.EXCEL;
  if (a === "power-bi" || a === "powerbi") return ACTORS.POWER_BI;
  if (a === "sql") return ACTORS.SQL;
  if (a === "python") return ACTORS.PYTHON;
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
  let normAction = action ? action.toUpperCase().trim() : null;
  if (normAction === "REJECT") {
    if (normChannel === CHANNELS.RESULTS) normAction = ACTIONS.REJECT_RESULT;
    else if (normChannel === CHANNELS.APPROVALS)
      normAction = ACTIONS.REJECT_APPROVAL;
  } else if (normAction === "REQUEST_REVISION") {
    if (normChannel === CHANNELS.RESULTS)
      normAction = ACTIONS.REQUEST_REVISION_RESULT;
    else if (normChannel === CHANNELS.APPROVALS)
      normAction = ACTIONS.REQUEST_REVISION_APPROVAL;
  }

  if (!normActor) return { allowed: false, reason: "UNKNOWN_ACTOR" };
  if (!normChannel) return { allowed: false, reason: "UNKNOWN_CHANNEL" };
  if (!normState) return { allowed: false, reason: "INVALID_CURRENT_STATE" };
  if (!normAction) return { allowed: false, reason: "UNKNOWN_ACTION" };

  // -------------------------------------------------------------------------
  // Rule 0: Specialist Enforcement (Specialists cannot take governance actions)
  // -------------------------------------------------------------------------
  const isSpecialist = [
    ACTORS.EXCEL,
    ACTORS.POWER_BI,
    ACTORS.SQL,
    ACTORS.PYTHON,
  ].includes(normActor);
  const executionActions = new Set([
    ACTIONS.CLAIM,
    ACTIONS.EXECUTION_FINISHED,
    ACTIONS.SUBMIT_RESULT,
  ]);
  if (isSpecialist && !executionActions.has(normAction)) {
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
  // Rule 3: Queue & Execution-Agent Claim
  // -------------------------------------------------------------------------
  if (normAction === ACTIONS.CLAIM) {
    if (
      ![
        ACTORS.O1,
        ACTORS.O2,
        ACTORS.EXCEL,
        ACTORS.POWER_BI,
        ACTORS.SQL,
        ACTORS.PYTHON,
      ].includes(normActor)
    ) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only the designated coordinator or execution agent can claim task",
      };
    }
    if (normState !== TASK_STATES.QUEUED) {
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
    if (normActor !== ACTORS.MAIN) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only Main can initiate user clarification in #office",
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
  // Rule 5: Execution Finished Event (specialist/coordinator -> Validation -> Review)
  // EXECUTION_FINISHED is an event, NOT human completion!
  // -------------------------------------------------------------------------
  if (
    normAction === ACTIONS.EXECUTION_FINISHED ||
    normAction === ACTIONS.SUBMIT_RESULT
  ) {
    if (
      ![
        ACTORS.O1,
        ACTORS.O2,
        ACTORS.EXCEL,
        ACTORS.POWER_BI,
        ACTORS.SQL,
        ACTORS.PYTHON,
      ].includes(normActor)
    ) {
      return {
        allowed: false,
        reason:
          "AUTHORITY_DENIED: Only the designated coordinator or execution agent can emit EXECUTION_FINISHED",
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

// M7-003: single tool-access authority. Direct-execution grants (L2/L3)
// must stay within the canonical callable policy (TOOL_POLICY in
// policy.mjs): L3 ⟺ listed. L2 is read-only (execute denied by the
// canonical evaluator). "delegate" is spawn topology, never direct
// execution. Contract-only tools have no entry and are always denied.
// A build-time regression test enforces this equivalence mechanically.
export const ZINK_TOOLS_ACCESS_MATRIX = Object.freeze({
  main: Object.freeze({
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "delegate",
    zink_python: "delegate",
    zink_n8n: "delegate",
  }),
  o1: Object.freeze({
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "L2",
    zink_python: "delegate",
    zink_n8n: "delegate",
  }),
  o2: Object.freeze({
    zink_excel: "delegate",
    zink_power_bi: "delegate",
    zink_sql: "L0",
    zink_python: "delegate",
    zink_n8n: "L3",
  }),
  excel: Object.freeze({
    zink_excel: "L3",
    zink_power_bi: "L0",
    zink_sql: "L2",
    zink_python: "L0",
    zink_n8n: "L0",
  }),
  "power-bi": Object.freeze({
    zink_excel: "L0",
    zink_power_bi: "L3",
    zink_sql: "L2",
    zink_python: "L0",
    zink_n8n: "L0",
  }),
  sql: Object.freeze({
    zink_excel: "L0",
    zink_power_bi: "L0",
    zink_sql: "L3",
    zink_python: "L0",
    zink_n8n: "L0",
  }),
  python: Object.freeze({
    zink_excel: "L0",
    zink_power_bi: "L0",
    zink_sql: "L0",
    zink_python: "L3",
    zink_n8n: "L3",
  }),
});

export const AGENT_STACK_POLICY = Object.freeze({
  main: [
    "infrastructure",
    "data_plant",
    "semantic",
    "intelligence",
    "decision",
  ],
  o1: ["infrastructure", "data_plant"],
  o2: ["semantic", "intelligence", "decision"],
  excel: ["data_plant", "semantic", "decision"],
  "power-bi": ["semantic", "intelligence", "decision"],
  sql: ["data_plant", "semantic", "decision"],
  python: ["data_plant", "intelligence", "decision"],
});

export const AGENT_IDS = Object.freeze([
  "main",
  "o1",
  "o2",
  "excel",
  "power-bi",
  "sql",
  "python",
]);

export const AGENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "main", name: "Main" }),
  // Display names for the two coordinators. They used to be "ETL Coordinator"
  // and "Analytics Coordinator" — retired L&SC Data Plant branding that
  // `AGENTS.md` §9 forbids for a runtime role. The names are stack-neutral
  // now so they cannot pre-judge the routing decision; the ownership lives in
  // `AGENT_STACK_POLICY` (this file) and `AGENT_SPAWN_POLICY` (policy.mjs), and
  // `docs/architecture/five-stack.md` is derived from those two tables and
  // gated against them (M12/T9 F-118: the table had been written by hand from
  // a retired roster and had drifted into the inverse of the enforced spawn
  // tree). The ingress aliases ("điều phối 1/2") already used this
  // vocabulary.
  Object.freeze({ id: "o1", name: "Coordinator O1" }),
  Object.freeze({ id: "o2", name: "Coordinator O2" }),
  Object.freeze({ id: "excel", name: "Excel" }),
  Object.freeze({ id: "power-bi", name: "Power BI" }),
  Object.freeze({ id: "sql", name: "SQL" }),
  Object.freeze({ id: "python", name: "Python" }),
]);

// Canonical agent identity registry: bot account ids, role ids and mention
// aliases for the deployed roster. These are ROUTING and RESOLUTION data, not
// authorization material: they map an observed Discord identity to an agent
// name, and every authorization decision is taken afterwards on the normalized
// NAME by `validateActionAuthority`. No entry here can grant authority on its
// own, and the OWNER's account id deliberately does NOT appear here — owner
// identity comes only from validated configuration (see `isConfiguredOwnerActor`
// and `resolveOwnerDiscordId`). Changing a bot or role id is a roster change,
// not a permission change.
export const DISCORD_BOT_IDS = Object.freeze({
  main: "1545436878835163156",
  o1: "1545437953197744248",
  o2: "1545438251966402661",
  excel: "1545438637750227104",
  "power-bi": "1545439082019164271",
  sql: "1545438861356966010",
  python: "1545439279843508235",
});

export const DISCORD_ROLE_IDS = Object.freeze({
  main: "1545471797452087390",
  o1: "1545472032223789058",
  o2: "1545606700633952389",
  excel: "1545611300951031872",
  "power-bi": "1545612740398157957",
  sql: "1545612050099609730",
  python: "1545615832556507220",
});

export const DISCORD_SURFACE_IDENTIFIERS = Object.freeze([
  "discordOfficeChannelId",
  "discordResultsForumId",
  "discordApprovalsForumId",
  "discordIncidentsForumId",
]);

export const AGENT_ROSTER_VERSION = "m8-t2.2-r4";

// A27: Explicit account ownership marker
export const ACCOUNT_OWNERSHIP_MAP = Object.freeze({
  main: Object.freeze({
    agentId: "main",
    role: "coordinator",
    isPrimaryCoordinator: true,
    domain: "office",
    accountType: "bot",
  }),
  o1: Object.freeze({
    agentId: "o1",
    role: "coordinator",
    isPrimaryCoordinator: false,
    domain: "business_etl",
    accountType: "bot",
  }),
  o2: Object.freeze({
    agentId: "o2",
    role: "coordinator",
    isPrimaryCoordinator: false,
    domain: "analytics_visualization",
    accountType: "bot",
  }),
  excel: Object.freeze({
    agentId: "excel",
    role: "specialist",
    domain: "spreadsheet",
    accountType: "bot",
  }),
  "power-bi": Object.freeze({
    agentId: "power-bi",
    role: "specialist",
    domain: "bi_analytics",
    accountType: "bot",
  }),
  sql: Object.freeze({
    agentId: "sql",
    role: "specialist",
    domain: "database",
    accountType: "bot",
  }),
  python: Object.freeze({
    agentId: "python",
    role: "specialist",
    domain: "scripting_analytics",
    accountType: "bot",
  }),
});

// A04 & A07: Schema-validated canonical agent roster
export const CANONICAL_AGENT_ROSTER = Object.freeze({
  version: AGENT_ROSTER_VERSION,
  agents: Object.freeze(
    AGENT_DEFINITIONS.map((def) => {
      const id = def.id;
      const ownership = ACCOUNT_OWNERSHIP_MAP[id];
      const botId = DISCORD_BOT_IDS[id];
      return Object.freeze({
        id,
        name: def.name,
        role: ownership.role,
        domain: ownership.domain,
        snowflakeId: botId,
        permittedStacks: Object.freeze([...(AGENT_STACK_POLICY[id] ?? [])]),
      });
    }),
  ),
});

export function validateAgentRoster(roster = CANONICAL_AGENT_ROSTER) {
  if (!roster || typeof roster !== "object") {
    throw new Error("ROSTER_INVALID: Roster must be a non-null object");
  }
  if (roster.version !== AGENT_ROSTER_VERSION) {
    throw new Error(
      `ROSTER_VERSION_DRIFT: Expected ${AGENT_ROSTER_VERSION}, got ${roster.version}`,
    );
  }
  if (
    !Array.isArray(roster.agents) ||
    roster.agents.length !== AGENT_IDS.length
  ) {
    throw new Error(
      `ROSTER_SIZE_MISMATCH: Expected ${AGENT_IDS.length} agents, got ${roster.agents?.length}`,
    );
  }
  const seenIds = new Set();
  const seenSnowflakes = new Set();
  for (const a of roster.agents) {
    if (!AGENT_IDS.includes(a.id)) {
      throw new Error(`ROSTER_UNKNOWN_AGENT: Unknown agent ID ${a.id}`);
    }
    if (seenIds.has(a.id)) {
      throw new Error(`ROSTER_DUPLICATE_AGENT: Duplicate agent ID ${a.id}`);
    }
    seenIds.add(a.id);
    if (!a.snowflakeId || !/^[1-9][0-9]{16,19}$/.test(a.snowflakeId)) {
      throw new Error(
        `ROSTER_INVALID_SNOWFLAKE: Invalid snowflake ID ${a.snowflakeId} for agent ${a.id}`,
      );
    }
    if (seenSnowflakes.has(a.snowflakeId)) {
      throw new Error(
        `ROSTER_DUPLICATE_SNOWFLAKE: Snowflake ${a.snowflakeId} already assigned`,
      );
    }
    seenSnowflakes.add(a.snowflakeId);
  }
  return true;
}

export const AGENT_ALIASES = Object.freeze({
  main: "main",
  quanly: "main",
  "quản lý": "main",
  "quan ly": "main",
  "tong quan": "main",
  "tong-quan": "main",
  "1545436878835163156": "main",
  "1545437815259664536": "main",
  "1545471797452087390": "main",
  o1: "o1",
  "điều phối 1": "o1",
  "dieu phoi 1": "o1",
  "dieu-phoi-1": "o1",
  "1545437953197744248": "o1",
  "1545438062874726471": "o1",
  "1545472032223789058": "o1",
  o2: "o2",
  "điều phối 2": "o2",
  "dieu phoi 2": "o2",
  "dieu-phoi-2": "o2",
  "1545438251966402661": "o2",
  "1545606700633952389": "o2",
  excel: "excel",
  "1545438637750227104": "excel",
  "1545611300951031872": "excel",
  "power-bi": "power-bi",
  powerbi: "power-bi",
  "power bi": "power-bi",
  "1545439082019164271": "power-bi",
  "1545612740398157957": "power-bi",
  sql: "sql",
  "1545438861356966010": "sql",
  "1545612050099609730": "sql",
  python: "python",
  "1545439279843508235": "python",
  "1545615832556507220": "python",
});

// A02, A03, A05: Hardened Mention Resolver
export function resolveMentionedAgents(
  textOrMentions,
  { executionTarget = false, allowBroadcast = true } = {},
) {
  if (!textOrMentions) {
    return Object.freeze([]);
  }

  // Support Discord event object: { content, mentions }
  if (typeof textOrMentions === "object" && !Array.isArray(textOrMentions)) {
    const content =
      textOrMentions.content ??
      textOrMentions.prompt ??
      textOrMentions.text ??
      "";
    const mentions = Array.isArray(textOrMentions.mentions)
      ? textOrMentions.mentions
      : [];
    const roleMentions = Array.isArray(
      textOrMentions.mention_roles ?? textOrMentions.roles,
    )
      ? (textOrMentions.mention_roles ?? textOrMentions.roles)
      : [];

    const isBroadcast = /@everyone\b|@here\b/u.test(content);
    if (isBroadcast) {
      // A02: broadcast must NOT fan out into 7 execution targets
      if (executionTarget || !allowBroadcast) {
        return Object.freeze([]);
      }
      return Object.freeze([...AGENT_IDS]);
    }

    const matched = new Set();

    // A03: Priority to explicit Discord mention objects when present
    if (mentions.length > 0 || roleMentions.length > 0) {
      for (const mention of mentions) {
        const candidates = [
          mention?.id,
          mention,
          mention?.username,
          mention?.name,
          mention?.global_name,
          mention?.displayName,
          mention?.nick,
        ]
          .filter((c) => typeof c === "string")
          .map((c) => c.toLowerCase().trim());

        for (const cand of candidates) {
          if (AGENT_IDS.includes(cand)) {
            matched.add(cand);
          } else if (AGENT_ALIASES[cand]) {
            matched.add(AGENT_ALIASES[cand]);
          }
        }
      }
      for (const roleId of roleMentions) {
        const cand = String(roleId).toLowerCase().trim();
        if (AGENT_ALIASES[cand]) {
          matched.add(AGENT_ALIASES[cand]);
        }
      }
    } else {
      // Fallback to text alias parsing ONLY when Discord mentions array is empty/absent
      for (const [alias, targetAgentId] of Object.entries(AGENT_ALIASES)) {
        const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(
          `(?:<@(?:!|&)?|@)${escaped}(?=$|[>\\s,.:;!?\\-—~])`,
          "ui",
        );
        if (regex.test(content)) {
          matched.add(targetAgentId);
        }
      }
    }

    // A05: never silently default to ["main"] when no mention matched
    if (matched.size === 0) {
      return Object.freeze([]);
    }
    return Object.freeze([...matched]);
  }

  if (Array.isArray(textOrMentions)) {
    const matched = textOrMentions
      .map((item) => String(item).toLowerCase().trim())
      .map((item) => AGENT_ALIASES[item] || item)
      .filter((item) => AGENT_IDS.includes(item));
    const unique = [...new Set(matched)];
    return Object.freeze(unique);
  }

  const text = String(textOrMentions).trim();

  const isBroadcast = /@everyone\b|@here\b/u.test(text);
  if (isBroadcast) {
    if (executionTarget || !allowBroadcast) {
      return Object.freeze([]);
    }
    return Object.freeze([...AGENT_IDS]);
  }

  const matched = new Set();
  for (const [alias, targetAgentId] of Object.entries(AGENT_ALIASES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(?:<@!?|@)${escaped}(?=$|[>\\s,.:;!?])`, "ui");
    if (regex.test(text)) {
      matched.add(targetAgentId);
    }
  }

  // A05: never silently default to ["main"]
  if (matched.size === 0) {
    return Object.freeze([]);
  }

  return Object.freeze([...matched]);
}

// A01, A06, Mandatory Semantic Contract (§8)
/**
 * The refusal resolveIngressRouting produces when no Main-directed mention
 * evidence exists. Exported (same text as before) so the admission layer can
 * recognise exactly this refusal without re-matching message text. Any other
 * refusal (wrong guild, broadcast, non-Main target, …) must never be treated
 * as a missing-mention case.
 */
export const MISSING_MENTION_REFUSAL =
  "MISSING_MENTION: No @main mention. Discord ingress is not admitted.";

/**
 * M10/T2-R4: deterministic Main-owned-thread continuation signal.
 *
 * Answers ONLY "is this message in a thread Main posted in?" — never "is the
 * sender authorized?" (existing sender/channel/bot checks answer that) and
 * never "what did the message say?" (no content is read). All inputs are
 * structured Discord identity metadata forwarded at the native seam; the
 * thread bindings are recorded from Main's own awaited outbound posts.
 */
export const MAIN_CONVERSATION_CONTINUATION = "MAIN_CONVERSATION_CONTINUATION";
export const MAIN_NOT_CONFIRMED = "MAIN_NOT_CONFIRMED";

const DISCORD_SNOWFLAKE_RE = /^[1-9][0-9]{16,19}$/u;

export function isDiscordSnowflake(value) {
  return typeof value === "string" && DISCORD_SNOWFLAKE_RE.test(value);
}

/**
 * M10/T2-R5: deterministic reply-to-Main signal. Answers ONLY whether the
 * inbound message replies to a Main-authored message, using the structured
 * reply-reference author id forwarded from the Discord event. Both ids must
 * be well-formed; a missing or foreign author never admits.
 */
export const MAIN_DIRECTED = "MAIN_DIRECTED";

export function resolveMainReplyAdmission({
  agentId,
  replyReferenceMessageId,
  replyReferenceAuthorId,
  mainBotId,
  missingMentionRefusal = false,
} = {}) {
  if (agentId !== "main") {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (missingMentionRefusal !== true) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (
    !isDiscordSnowflake(replyReferenceMessageId) ||
    !isDiscordSnowflake(replyReferenceAuthorId) ||
    !isDiscordSnowflake(mainBotId)
  ) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (replyReferenceAuthorId !== mainBotId) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  return Object.freeze({
    admitted: true,
    classification: MAIN_DIRECTED,
  });
}

/**
 * M10/T2-R4 established, M10/T2-R5 re-homed: deterministic Main-owned-thread
 * continuation. R4 attributed threads from Main's own outbound posts (bounded
 * memory-only map); R5 uses the host-resolved thread owner id forwarded from
 * the Discord preflight seam instead — authoritative, no memory, no eviction
 * semantics to defend. Same verdict contract.
 */
export function resolveMainConversationAdmission({
  agentId,
  threadId,
  threadOwnerId,
  mainBotId,
  missingMentionRefusal = false,
} = {}) {
  if (agentId !== "main") {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (missingMentionRefusal !== true) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  // A present owner with an absent or malformed thread is inconsistent input
  // and fails closed rather than admitting on the owner alone.
  if (!isDiscordSnowflake(threadId)) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (!isDiscordSnowflake(threadOwnerId) || !isDiscordSnowflake(mainBotId)) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  if (threadOwnerId !== mainBotId) {
    return Object.freeze({
      admitted: false,
      classification: MAIN_NOT_CONFIRMED,
    });
  }
  return Object.freeze({
    admitted: true,
    classification: MAIN_CONVERSATION_CONTINUATION,
  });
}

export function resolveIngressRouting({
  message,
  context = {},
  identifiers = {},
} = {}) {
  const content =
    typeof message === "string"
      ? message
      : (message?.content ?? message?.prompt ?? message?.text ?? "");
  const mentions = Array.isArray(message?.mentions) ? message.mentions : [];
  const messageId =
    context?.currentMessageId ?? message?.id ?? context?.messageId ?? null;
  const guildId = context?.guildId ?? message?.guildId ?? null;
  const senderId =
    context?.senderId ?? message?.author?.id ?? context?.userId ?? null;
  const threadId = context?.threadId ?? message?.threadId ?? null;

  // A10: Validate guild if provided
  const configuredGuildId =
    identifiers?.discordGuildId ?? context?.discordGuildId;
  if (configuredGuildId && guildId && guildId !== configuredGuildId) {
    throw new Error(
      `WRONG_GUILD: Expected ${configuredGuildId}, got ${guildId}`,
    );
  }

  const isBroadcast = /@everyone\b|@here\b/u.test(content);
  const mentionedAgents = resolveMentionedAgents(
    { content, mentions },
    { executionTarget: true, allowBroadcast: false },
  );

  let targetAgents = [];
  let isAmbiguous = false;
  let needsClarification = false;
  let clarificationReason = null;

  if (isBroadcast) {
    isAmbiguous = true;
    needsClarification = true;
    clarificationReason =
      "BROADCAST_NO_DELEGATION: Broadcast mentions (@everyone/@here) cannot be used for execution delegation.";
  } else if (mentionedAgents.includes("main")) {
    // Locked Decision: Main is the sole root owner at ingress. Specialist mentions are text/input for Main.
    targetAgents = ["main"];
  } else if (mentionedAgents.length === 1) {
    const candidate = mentionedAgents[0];
    if (candidate !== "main") {
      isAmbiguous = true;
      needsClarification = true;
      clarificationReason = `NON_MAIN_DIRECT_INGRESS: Agent ${candidate} cannot be directly invoked. Please direct requests to @main.`;
    } else {
      targetAgents = [candidate];
    }
  } else if (mentionedAgents.length > 1) {
    isAmbiguous = true;
    needsClarification = true;
    clarificationReason = `NON_MAIN_DIRECT_INGRESS: Only @main may own Discord ingress (mentioned: ${mentionedAgents.join(", ")}).`;
  } else {
    // R4: no mention means no model/session/spawn admission.
    isAmbiguous = true;
    needsClarification = true;
    clarificationReason = MISSING_MENTION_REFUSAL;
  }

  const primaryTarget = targetAgents[0] ?? null;
  const requiredStack = primaryTarget
    ? (AGENT_STACK_POLICY[primaryTarget] ?? [])
    : [];

  return Object.freeze({
    task_id: context?.taskId ?? null,
    message_id: messageId,
    thread_id: threadId,
    principal: senderId,
    intent: isBroadcast
      ? "BROADCAST"
      : primaryTarget
        ? `DELEGATE_TO_${primaryTarget.toUpperCase()}`
        : "CLARIFY",
    domain: isAmbiguous
      ? "AMBIGUOUS"
      : primaryTarget
        ? (ACCOUNT_OWNERSHIP_MAP[primaryTarget]?.domain ?? "general")
        : "general",
    primary_topic: isAmbiguous ? "AMBIGUOUS" : (primaryTarget ?? "general"),
    secondary_topics: Object.freeze([]),
    namespace: primaryTarget ? primaryTarget : "general",
    work_class: primaryTarget
      ? ["main", "o1", "o2"].includes(primaryTarget)
        ? "COORDINATION"
        : "SPECIALIST_EXECUTION"
      : "UNKNOWN",
    required_stack: Object.freeze([...requiredStack]),
    target_agents: Object.freeze([...targetAgents]),
    confidence: isAmbiguous ? 0.0 : 1.0,
    provenance: "discord_ingress",
    semantic_contract_version: "m8-t2.2-r4",
    ambiguous: isAmbiguous,
    needs_clarification: needsClarification,
    clarification_reason: clarificationReason,
    is_broadcast: isBroadcast,
  });
}

// A08: Cross-layer identity verification invariant
export function validateCrossLayerIdentity({
  config = null,
  agentIds = AGENT_IDS,
  kbMatrix = null,
  skillMatrix = null,
} = {}) {
  const errors = [];
  const expectedSet = new Set(agentIds);

  const defIds = new Set(AGENT_DEFINITIONS.map((d) => d.id));
  for (const id of expectedSet) {
    if (!defIds.has(id)) errors.push(`Missing in AGENT_DEFINITIONS: ${id}`);
  }

  for (const id of expectedSet) {
    if (!DISCORD_BOT_IDS[id]) errors.push(`Missing in DISCORD_BOT_IDS: ${id}`);
  }

  for (const id of expectedSet) {
    if (!Object.hasOwn(ZINK_TOOLS_ACCESS_MATRIX, id)) {
      errors.push(`Missing in ZINK_TOOLS_ACCESS_MATRIX: ${id}`);
    }
  }

  for (const id of expectedSet) {
    if (!Object.hasOwn(AGENT_STACK_POLICY, id)) {
      errors.push(`Missing in AGENT_STACK_POLICY: ${id}`);
    }
  }

  if (kbMatrix) {
    for (const id of expectedSet) {
      if (!Object.hasOwn(kbMatrix, id)) {
        errors.push(`Missing in KB_ACCESS_MATRIX: ${id}`);
      }
    }
  }

  if (skillMatrix) {
    for (const id of expectedSet) {
      if (!Object.hasOwn(skillMatrix, id)) {
        errors.push(`Missing in SKILL_STORE_ACCESS_MATRIX: ${id}`);
      }
    }
  }

  if (config) {
    if (Array.isArray(config.bindings)) {
      const bindingIds = new Set(config.bindings.map((b) => b.agentId));
      for (const id of expectedSet) {
        if (!bindingIds.has(id))
          errors.push(`Missing in config.bindings: ${id}`);
      }
    }
    const agentList = config.agents?.list;
    if (Array.isArray(agentList)) {
      const listIds = new Set(agentList.map((a) => a.id));
      for (const id of expectedSet) {
        if (!listIds.has(id))
          errors.push(`Missing in config.agents.list: ${id}`);
      }
    }
    const accounts = config.channels?.discord?.accounts;
    if (accounts && typeof accounts === "object") {
      for (const id of expectedSet) {
        if (!Object.hasOwn(accounts, id))
          errors.push(`Missing in discord accounts: ${id}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`CROSS_LAYER_IDENTITY_DRIFT:\n- ${errors.join("\n- ")}`);
  }
  return true;
}

// A10: Discord Target Guild Validator
export function validateDiscordTargetGuild({
  guildId,
  channelId,
  configuredGuildId,
  surfaceChannelIds = [],
} = {}) {
  if (!guildId || typeof guildId !== "string") {
    return { valid: false, reason: "MISSING_GUILD_ID" };
  }
  if (configuredGuildId && guildId !== configuredGuildId) {
    return {
      valid: false,
      reason: `GUILD_MISMATCH: Target guild ${guildId} does not match configured ${configuredGuildId}`,
    };
  }
  if (
    channelId &&
    surfaceChannelIds.length > 0 &&
    !surfaceChannelIds.includes(channelId)
  ) {
    return {
      valid: false,
      reason: `UNKNOWN_SURFACE_CHANNEL: Channel ${channelId} is not a recognized surface channel`,
    };
  }
  return { valid: true, reason: null };
}

// A23 & A25: Allowed Discord Sender Validator
export function isAllowedDiscordSender({
  senderId,
  isBot = false,
  ownerId,
  allowedBotSnowflakes = Object.values(DISCORD_BOT_IDS),
} = {}) {
  if (!senderId) return false;
  if (ownerId && senderId === ownerId) return true;
  if (isBot && allowedBotSnowflakes.includes(senderId)) return true;
  if (isBot) return false;
  return false;
}

// A28: Convert agents.list to agents.entries
export function convertAgentsListToEntries(config) {
  if (!config?.agents?.list || !Array.isArray(config.agents.list)) {
    throw new Error("AGENTS_LIST_MISSING: Expected config.agents.list array");
  }
  const entries = {};
  for (const agent of config.agents.list) {
    const { id, ...rest } = agent;
    entries[id] = rest;
  }
  return {
    ...config,
    agents: {
      defaults: config.agents.defaults,
      entries,
    },
  };
}

// A29: Validate OpenClaw Release Compatibility
export function validateOpenClawReleaseCompatibility(
  config,
  { targetRelease = "2026.6.34" } = {},
) {
  const REQUIRED_TOP_LEVEL_KEYS = [
    "update",
    "gateway",
    "agents",
    "tools",
    "commands",
    "secrets",
    "plugins",
    "bindings",
    "channels",
    // M10/T2-R14: `auth` was listed here but is NOT a real requirement, and the
    // canonical generator deliberately omits it — M10/T2-R9 removed
    // auth.profiles/order/cooldowns because there is one router credential and
    // the router performs its own upstream rotation, so an OpenClaw-side order
    // would be a second rotation policy that cannot take effect. The validator
    // therefore could never pass on a config this repository produces: its own
    // generator omits `auth`, and `validateConfig` rejects unexpected top-level
    // keys so `auth` could not be added to satisfy it. The only test that
    // exercised it hand-built a config containing `auth: {}`, which is why the
    // contradiction was invisible. Requiring a key that must NOT exist is a
    // landmine for whoever wires this validator in later.
  ];
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(config, key)) {
      throw new Error(
        `OPENCLAW_COMPATIBILITY_ERROR: Missing required top-level key: ${key}`,
      );
    }
  }
  if (!config.agents.list && !config.agents.entries) {
    throw new Error(
      "OPENCLAW_COMPATIBILITY_ERROR: agents must contain either list or entries",
    );
  }
  return { compatible: true, targetRelease };
}

// A09: Discord Surface Bindings
export function getDiscordSurfaceBindings(identifiers) {
  return DISCORD_SURFACE_IDENTIFIERS.map((name) => ({
    surfaceName: name,
    channelId: identifiers[name] ?? null,
  }));
}

// A14-A16: Canonical Discord component action namespace and custom_id schema.
// All approval/result action buttons MUST use this format so action routing is
// unambiguously bound to task + revision without relying on message context alone.
//
// custom_id format: "zink:{actionType}:{taskId}:{revision}"
// actionType ∈ DISCORD_COMPONENT_ACTION_NAMESPACE
export const DISCORD_COMPONENT_ACTION_NAMESPACE = Object.freeze({
  // Approval actions (target: #approvals forum thread)
  APPROVAL_APPROVE: "zink:approval:approve",
  APPROVAL_REJECT: "zink:approval:reject",
  APPROVAL_REVISION: "zink:approval:revision",
  // Result actions (target: #results forum thread)
  RESULT_ACCEPT: "zink:result:accept",
  RESULT_REJECT: "zink:result:reject",
  RESULT_REVISION: "zink:result:revision",
  // Skill learning actions (target: #office learning confirmation).
  // A skill proposal is a governance transaction, never a workflow task,
  // so it must never share the execution approval action identity.
  SKILL_APPROVE: "zink:skill:approve",
  SKILL_REJECT: "zink:skill:reject",
});

// Discriminated approval subjects. Execution-plan approval authorizes queue
// execution; skill-candidate approval authorizes canonical Skill Store
// materialization. One subject must never be honored on the other's path.
export const APPROVAL_SUBJECT_TYPES = Object.freeze({
  EXECUTION_PLAN_APPROVAL: "EXECUTION_PLAN_APPROVAL",
  SKILL_CANDIDATE_APPROVAL: "SKILL_CANDIDATE_APPROVAL",
});

// A16/A17: Build a namespaced custom_id string bound to task + revision.
// The revision argument is the approval plan_version or attempt number so that
// replayed or stale buttons for a different revision can be detected.
//
// M10/T2-R12: the id is wrapped in the host's component wire envelope
// `occomp:cid=<componentId>`. A bare `zink:...` id is REJECTED by the host on
// the interaction: `parseDiscordComponentCustomId` requires the parsed key to be
// `occomp`, so it returned null and the host answered every click with "This
// component is no longer valid." — proven live 2026-10-08 15:45:08
// (`discord component button: failed to parse component data`). `parseComponentCustomId`
// below already unwraps this prefix, so both the wire format and the internal
// format stay understood by one parser.
export const DISCORD_COMPONENT_CUSTOM_ID_PREFIX = "occomp:cid=";

/** Discord's hard ceiling on custom_id length. Exceeding it fails the POST. */
const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

export function buildComponentCustomId(actionType, taskId, revision) {
  if (!Object.values(DISCORD_COMPONENT_ACTION_NAMESPACE).includes(actionType))
    throw new Error(`Unknown action type: ${actionType}`);
  if (typeof taskId !== "string" || taskId.length === 0)
    throw new Error("taskId must be a non-empty string");
  if (typeof revision !== "string" || revision.length === 0)
    throw new Error("revision must be a non-empty string");
  const componentId = `${actionType}:${taskId}:${revision}`;
  // `occomp:cid=` is the only envelope the host understands, so a component id
  // that does not fit can never be delivered. Fail closed here instead of
  // posting a button Discord silently refuses.
  assertCustomIdFits(
    `${DISCORD_COMPONENT_CUSTOM_ID_PREFIX}${componentId}`,
    componentId,
  );
  return `${DISCORD_COMPONENT_CUSTOM_ID_PREFIX}${componentId}`;
}

/**
 * Fail closed when a custom_id would exceed Discord's ceiling. The longest
 * governed namespace (APPROVAL_REVISION) with the legacy 64-hex task id measured
 * 100 characters at a one-digit revision and 101 at a two-digit one, so that
 * namespace was already refusing a card. M12/T1-R1: with the 12-character identity
 * the same worst case measures 49 characters, which leaves the ceiling far behind.
 */
export function assertCustomIdFits(customId, componentId) {
  if (typeof customId !== "string" || customId.length === 0)
    throw new Error("CUSTOM_ID_REQUIRED");
  if (customId.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new Error(
      `CUSTOM_ID_TOO_LONG: ${customId.length} > ${DISCORD_CUSTOM_ID_MAX_LENGTH}`,
    );
  }
  // The envelope is only valid when the component id itself carries no `;` or
  // `%`, which the host would otherwise require to be percent-encoded.
  if (/[%;]/u.test(componentId)) {
    throw new Error(`CUSTOM_ID_REQUIRES_ENCODING: ${componentId}`);
  }
  return customId;
}

// A16: Parse a custom_id back to its components. Returns null if malformed.
export function parseComponentCustomId(customId) {
  if (typeof customId !== "string") return null;
  let normalized = customId.trim();
  if (normalized.startsWith("occomp:cid=")) {
    normalized = normalized.slice("occomp:cid=".length).split(";")[0];
  }
  if (
    !normalized.startsWith("zink:") &&
    (normalized.startsWith("approval:") || normalized.startsWith("result:"))
  ) {
    normalized = `zink:${normalized}`;
  }
  // Find the matching prefix from the namespace
  for (const [key, prefix] of Object.entries(
    DISCORD_COMPONENT_ACTION_NAMESPACE,
  )) {
    if (normalized.startsWith(prefix + ":")) {
      const rest = normalized.slice(prefix.length + 1);
      // rest is "{taskId}:{revision}" but taskId may contain colons → split from end
      const lastColon = rest.lastIndexOf(":");
      if (lastColon === -1) return null;
      const taskId = rest.slice(0, lastColon);
      const revision = rest.slice(lastColon + 1);
      if (!taskId || !revision) return null;
      return { actionKey: key, actionType: prefix, taskId, revision };
    }
  }
  return null;
}

// M8/T3: compact skill-button identity. A full proposal+digest binding
// (`zink:skill:approve:<32hex>:<64hex>`) is 116 characters and Discord
// native buttons cap custom_id at 100. The button therefore carries the
// 32-hex proposal id plus a 16-hex digest corroborator (68 chars total);
// the approval itself always binds the exact bytes stored server-side.
// A click corroborates identity; it never substitutes for the stored digest.
export const SKILL_BUTTON_DIGEST_PREFIX_LENGTH = 16;

export function buildSkillComponentCustomId(
  actionType,
  proposalId,
  contentSha256,
) {
  if (
    actionType !== DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_APPROVE &&
    actionType !== DISCORD_COMPONENT_ACTION_NAMESPACE.SKILL_REJECT
  )
    throw new Error(`Unknown skill action type: ${actionType}`);
  if (typeof proposalId !== "string" || !/^[a-f0-9]{32}$/u.test(proposalId))
    throw new Error("proposalId must be a 32-character hex digest");
  if (
    typeof contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(contentSha256)
  )
    throw new Error("contentSha256 must be a 64-character hex digest");
  // M10/T2-R12: same host wire envelope as buildComponentCustomId — see the note
  // there. Without it every skill button click answers "This component is no
  // longer valid."
  const componentId = `${actionType}:${proposalId}:${contentSha256.slice(0, SKILL_BUTTON_DIGEST_PREFIX_LENGTH)}`;
  return assertCustomIdFits(
    `${DISCORD_COMPONENT_CUSTOM_ID_PREFIX}${componentId}`,
    componentId,
  );
}

// A19: Stale interaction rejection — returns true when the parsed custom_id's
// revision does NOT match the currently active revision for the task.
// Callers must supply the activeRevision from authoritative ledger state.
export function isStaleComponentAction(customId, activeRevision) {
  const parsed = parseComponentCustomId(customId);
  if (!parsed) return true; // malformed → treat as stale/invalid
  return parsed.revision !== String(activeRevision);
}

// A18: Build a message-level idempotency key from task + origin_message_id +
// actionType. This prevents duplicate delivery of the same button click
// across reconnects or API retries.
export function buildMessageIdempotencyKey(
  taskId,
  originMessageId,
  actionType,
) {
  if (typeof taskId !== "string" || !taskId) throw new Error("taskId required");
  if (typeof originMessageId !== "string" || !originMessageId)
    throw new Error("originMessageId required");
  if (typeof actionType !== "string" || !actionType)
    throw new Error("actionType required");
  return `idempkey:${taskId}:${originMessageId}:${actionType}`;
}

// A21: Forum target validation — components must target a thread (reply to an
// existing post), never the forum parent channel directly.
// Returns { valid: true } or { valid: false, reason: string }.
export function validateDiscordForumTarget({
  targetChannelId,
  threadId,
  forumSurfaceIds,
}) {
  const surfaceSet = new Set(
    Array.isArray(forumSurfaceIds) ? forumSurfaceIds : [],
  );
  if (!targetChannelId)
    return { valid: false, reason: "MISSING_TARGET_CHANNEL" };
  // If targeting a known forum parent directly (not a thread) → invalid for components
  if (surfaceSet.has(targetChannelId) && !threadId)
    return { valid: false, reason: "FORUM_PARENT_NOT_ALLOWED_FOR_COMPONENTS" };
  return { valid: true };
}

// A22: Reply-to/thread correlation validator.
// Ensures the component action reply_to/thread_id matches the task's origin thread.
export function validateComponentThreadCorrelation({
  replyToThreadId,
  expectedThreadId,
}) {
  if (!replyToThreadId || !expectedThreadId)
    return { valid: false, reason: "MISSING_THREAD_CORRELATION" };
  if (replyToThreadId !== expectedThreadId)
    return { valid: false, reason: "THREAD_CORRELATION_MISMATCH" };
  return { valid: true };
}

// A24: Context visibility guard — warns when contextVisibility=allowlist and
// no explicit allowlist entry covers an execution-agent/coordinator session thread.
// This is informational; the OpenClaw runtime enforces actual access control.
export function validateContextVisibilityForThread({
  contextVisibility,
  allowlistChannelIds,
  threadChannelId,
}) {
  if (contextVisibility !== "allowlist") return { covered: true };
  const covered =
    Array.isArray(allowlistChannelIds) &&
    allowlistChannelIds.includes(threadChannelId);
  return { covered, reason: covered ? null : "THREAD_NOT_IN_ALLOWLIST" };
}
