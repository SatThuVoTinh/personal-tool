import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { canonicalHash, utcNow } from "./canonical.mjs";

export const BUDGETS = Object.freeze({
  maxBriefRevisionsPerTask: 16,
  maxStackTransitionsPerTask: 10,
  maxTotalDelegatedRunsPerTask: 72,
});

export const RUN_STATES = Object.freeze([
  "PENDING",
  "SPAWN_UNKNOWN",
  "RUNNING",
  "BLOCKED",
  "COMPLETE",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);

export function ledgerPaths(stateDir) {
  const root = path.join(stateDir, "operator", "m7-t2", "ledger");
  return Object.freeze({
    root,
    events: path.join(root, "events.jsonl"),
    snapshot: path.join(root, "snapshot.json"),
    identityKey: path.join(stateDir, "operator", "m7-t2", "identity.key"),
  });
}

function privateDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function emptySnapshot() {
  return {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r11",
    sequence: 0,
    last_event_digest: null,
    ingress_ids: [],
    tasks: {},
    updated_at: utcNow(),
  };
}

export function ensureLedger(paths) {
  privateDir(paths.root);
  privateDir(path.dirname(paths.root));
  if (!existsSync(paths.events))
    writeFileSync(paths.events, "", { mode: 0o600 });
  if (!existsSync(paths.snapshot))
    writeFileSync(
      paths.snapshot,
      `${JSON.stringify(emptySnapshot(), null, 2)}\n`,
      { mode: 0o600 },
    );
  chmodSync(paths.events, 0o600);
  chmodSync(paths.snapshot, 0o600);
}

export function readSnapshot(paths) {
  ensureLedger(paths);
  try {
    const snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    if (
      !snapshot ||
      snapshot.schema_version !== "1.0.0" ||
      typeof snapshot.sequence !== "number"
    )
      throw new Error("invalid snapshot");
    const lines = readFileSync(paths.events, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let previous = null;
    let lastSequence = 0;
    for (const line of lines) {
      const event = JSON.parse(line);
      const { event_digest, ...unsigned } = event;
      if (
        event.sequence !== lastSequence + 1 ||
        event.previous_event_digest !== previous ||
        canonicalHash("zink-ledger-event-v1", unsigned) !== event_digest
      )
        throw new Error("event chain mismatch");
      previous = event_digest;
      lastSequence = event.sequence;
    }
    if (
      lastSequence !== snapshot.sequence ||
      previous !== snapshot.last_event_digest
    )
      throw new Error("snapshot/event sequence mismatch");
    return snapshot;
  } catch (error) {
    const failure = new Error(`Ledger corruption: ${error.message}`);
    failure.code = "EXECUTION_STATE_UNKNOWN";
    throw failure;
  }
}

export function appendEvent(paths, snapshot, type, payload = {}) {
  ensureLedger(paths);
  const event = {
    schema_version: "1.0.0",
    governance_version: "m7-t2-r11",
    sequence: snapshot.sequence + 1,
    type,
    payload,
    created_at: utcNow(),
    previous_event_digest: snapshot.last_event_digest,
  };
  const event_digest = canonicalHash("zink-ledger-event-v1", event);
  const line = `${JSON.stringify({ ...event, event_digest })}\n`;
  const fd = openSync(paths.events, "a", 0o600);
  try {
    appendFileSync(fd, line, "utf8");
    try {
      fsyncSync(fd);
    } catch (error) {
      if (!/^(EPERM|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")) throw error;
    }
  } finally {
    closeSync(fd);
  }
  const next = {
    ...snapshot,
    sequence: event.sequence,
    last_event_digest: event_digest,
    updated_at: event.created_at,
  };
  const temp = `${paths.snapshot}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, paths.snapshot);
  try {
    const directoryFd = openSync(paths.root, "r");
    try {
      fsyncSync(directoryFd);
    } finally {
      closeSync(directoryFd);
    }
  } catch (error) {
    if (!/^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? ""))
      throw error;
  }
  return next;
}

export function reserveBudget(snapshot, taskId, kind, amount = 1) {
  const task = snapshot.tasks[taskId] ?? {
    revisions_used: 1,
    transitions_used: 0,
    delegated_runs_used: 0,
  };
  const key = {
    revisions: "revisions_used",
    transitions: "transitions_used",
    delegated_runs: "delegated_runs_used",
  }[kind];
  const limit = {
    revisions: BUDGETS.maxBriefRevisionsPerTask,
    transitions: BUDGETS.maxStackTransitionsPerTask,
    delegated_runs: BUDGETS.maxTotalDelegatedRunsPerTask,
  }[kind];
  if (!key || task[key] + amount > limit) {
    const error = new Error(`Workflow budget exhausted: ${kind}`);
    error.code = "WORKFLOW_BUDGET_EXHAUSTED";
    throw error;
  }
  return {
    ...snapshot,
    tasks: {
      ...snapshot.tasks,
      [taskId]: { ...task, [key]: task[key] + amount },
    },
  };
}

export function reserveBudgetAtomically(
  paths,
  snapshot,
  taskId,
  kind,
  amount = 1,
) {
  const reserved = reserveBudget(snapshot, taskId, kind, amount);
  const task = reserved.tasks[taskId];
  return appendEvent(paths, reserved, "BUDGET_RESERVED", {
    task_id: taskId,
    kind,
    amount,
    counters: task,
  });
}
