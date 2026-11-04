// M12/T9-R4 B1b — the shared harness for the plugin-driven approval lanes.
//
// The rows in this group are only provable END TO END: F-533's dispatch, F-402's
// owner principal, F-405's reconcile and F-406's accepted outcome all live on
// the seam between the governance plugin, the ledger and the queue. Calling the
// queue directly would prove the double, not the seam, so every lane here
// registers the real plugin, drives the real text handler, and reads the real
// queue projection.
//
// Everything is rooted in a scratch STATE directory (mkdtemp), never a live
// ledger, and every durable identifier is non-routable.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { canonicalHash } from "../../integrations/openclaw/topology/lib/canonical.mjs";
import {
  ensureLedger,
  ledgerPaths,
  recordWorkflowEvent,
} from "../../integrations/openclaw/topology/lib/ledger.mjs";
import { defaultQueueManager } from "../../integrations/openclaw/lib/queue-manager.mjs";
import governancePlugin, {
  mintUserPrincipalRef,
} from "../../integrations/openclaw/plugins/zink-governance/index.mjs";

export const OWNER_DISCORD_ID = "123456789012345678";
export const APPROVALS_CHANNEL_ID = "1556249093729427459";
export const RESULTS_CHANNEL_ID = "1556249093729427460";
export const OFFICE_CHANNEL_ID = "1556249093729427461";
export const APPROVAL_THREAD_ID = "900000000000000001";
export const RESULTS_THREAD_ID = "900000000000000002";
export const TASK_ID = "21102026CDEF";

/** The identity secret is pinned so a ref is reproducible inside one lane. */
const IDENTITY_KEY = "1".repeat(64);

const NODE_DIGESTS = {
  input_digest: canonicalHash("zink-input-v1", "b1b-work"),
  constraints_digest: canonicalHash("zink-constraints-v1", "{}"),
  validation_digest: canonicalHash(
    "zink-validation-v1",
    "agent-result-payload.schema.json",
  ),
};

/**
 * A brief node in the shape WORKFLOW_BRIEF_ACTIVATED accepts. `agent_id` and
 * `stack_id` are caller-chosen so a lane can present the exact DAG it needs.
 */
export function briefNode({
  nodeId,
  agentId,
  stackId,
  dependencies = [],
  required = true,
}) {
  return {
    node_id: nodeId,
    agent_id: agentId,
    stack_id: stackId,
    dependencies,
    required,
    ...NODE_DIGESTS,
  };
}

/** The coordinator-named node DAG that F-533 is about: `o1 -> [o1, excel]`. */
export const COORDINATOR_NAMED_NODES = [
  briefNode({ nodeId: "n1", agentId: "o1", stackId: "data_plant" }),
  briefNode({ nodeId: "n2", agentId: "excel", stackId: "data_plant" }),
];

/**
 * A scratch governance store: the real ledger trio plus the identity key, under
 * a temporary STATE directory the caller removes.
 */
export function createGovernanceState(prefix) {
  const stateDir = mkdtempSync(path.join(os.tmpdir(), `zink-b1b-${prefix}-`));
  const paths = ledgerPaths(stateDir);
  mkdirSync(path.dirname(paths.identityKey), { recursive: true });
  writeFileSync(paths.identityKey, `${IDENTITY_KEY}\n`, "utf8");
  ensureLedger(paths);
  return {
    stateDir,
    paths,
    /** The authoritative owner principal the ledger projects. */
    ownerPrincipalRef: mintUserPrincipalRef(paths, OWNER_DISCORD_ID),
    cleanup: () => rmSync(stateDir, { recursive: true, force: true }),
  };
}

/**
 * Seed one ACTIVE task whose brief is activated, whose card is requested and
 * surfaced, and whose owner principal is the minted ref.
 */
export function seedGovernedTask(
  paths,
  {
    taskId = TASK_ID,
    nodes = COORDINATOR_NAMED_NODES,
    briefRevision = 1,
    threadId = APPROVAL_THREAD_ID,
  } = {},
) {
  const originPrincipalRef = mintUserPrincipalRef(paths, OWNER_DISCORD_ID);
  recordWorkflowEvent(paths, "WORKFLOW_OPENED", {
    task_id: taskId,
    origin: "discord",
    origin_principal_ref: originPrincipalRef,
    origin_message_id: "1556249093729427470",
    root_agent_id: "main",
    root_session_key: "main-session",
    root_run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_BRIEF_ACTIVATED", {
    task_id: taskId,
    brief_revision: briefRevision,
    nodes,
    semantic_contract_status: "VALID",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_REQUESTED", {
    task_id: taskId,
    agent_id: "main",
    session_key: "main-session",
    run_id: "main-run",
  });
  recordWorkflowEvent(paths, "WORKFLOW_APPROVAL_SURFACED", {
    task_id: taskId,
    channel: "approvals",
    thread_id: threadId,
  });
  return { taskId, originPrincipalRef };
}

/**
 * Register the REAL plugin over one scratch store. The root is process-global,
 * so a lane registers immediately before driving its handler.
 */
export function registerGovernancePlugin(paths) {
  const hooks = new Map();
  const logs = [];
  const push = (line) => logs.push(String(line));
  governancePlugin.register({
    pluginConfig: {
      ledgerRoot: paths.root,
      ownerDiscordId: OWNER_DISCORD_ID,
      approvalsChannelId: APPROVALS_CHANNEL_ID,
      resultsChannelId: RESULTS_CHANNEL_ID,
      officeChannelId: OFFICE_CHANNEL_ID,
      enabled: true,
    },
    on: (name, handler) => hooks.set(name, handler),
    registerTool: () => {},
    // No host outbound transport: a delivery attempt refuses by name, which is
    // the production fail-closed answer and never a network call.
    logger: { warn: push, info: push, error: push },
  });
  return { hooks, logs };
}

let messageSequence = 0;

/**
 * Drive the plugin's own text handler as the owner. `channelId` decides which
 * surface the verdict was observed in, and the thread must be the one the card
 * was surfaced in.
 */
export async function sendOwnerText(
  hooks,
  { text, channelId = APPROVALS_CHANNEL_ID, threadId = APPROVAL_THREAD_ID },
) {
  const handler = hooks.get("message_received");
  if (!handler) throw new Error("MESSAGE_HANDLER_NOT_REGISTERED");
  messageSequence += 1;
  await handler(
    {
      content: text,
      messageId: `15562490937294274${String(80 + messageSequence).padStart(2, "0")}`,
      senderId: OWNER_DISCORD_ID,
      channelId,
      threadId,
    },
    { channelId, conversationId: channelId },
  );
}

/**
 * Poll a predicate for a fire-and-forget effect. Returns null on timeout so the
 * caller fails with its own message rather than hanging the lane.
 */
export async function waitFor(
  predicate,
  { timeoutMs = 5000, intervalMs = 10 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** The queue item the plugin's approval produced, or null. */
export async function waitForQueueTask(taskId) {
  return waitFor(() => defaultQueueManager.getTask(taskId));
}

/** One lane's scratch store, removed even when an assertion fails. */
export async function withGovernanceState(prefix, body) {
  const state = createGovernanceState(prefix);
  try {
    return await body(state);
  } finally {
    state.cleanup();
  }
}
