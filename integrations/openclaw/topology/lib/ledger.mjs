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
  rmdirSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { applyWorkflowEvent } from "./workflow.mjs";
import { validateContract } from "./schema.mjs";
import {
  canonicalHash,
  utcNow,
  GOVERNANCE_VERSION,
  SCHEMA_VERSION,
} from "./canonical.mjs";

const BUDGET_FIELDS = [
  "revisions_used",
  "transitions_used",
  "delegated_runs_used",
];
const INITIAL_BUDGET = Object.freeze({
  revisions_used: 1,
  transitions_used: 0,
  delegated_runs_used: 0,
});

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
  assertNoLinks(dir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

function assertNoLinks(target) {
  if (!path.isAbsolute(target)) throw new Error("EXECUTION_STATE_UNKNOWN");
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  ) {
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("LEDGER_SYMLINK_DENIED");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function validateLedgerPaths(paths) {
  if (
    paths.events !== path.join(paths.root, "events.jsonl") ||
    paths.snapshot !== path.join(paths.root, "snapshot.json")
  )
    throw new Error("EXECUTION_STATE_UNKNOWN");
  for (const target of [
    paths.root,
    paths.events,
    paths.snapshot,
    path.join(paths.root, "writer.lock"),
  ])
    assertNoLinks(target);
}

function createIfMissing(target, contents) {
  try {
    writeFileSync(target, contents, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  if (!lstatSync(target).isFile()) throw new Error("EXECUTION_STATE_UNKNOWN");
}

export function emptySnapshot() {
  return {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence: 0,
    last_event_digest: null,
    ingress_ids: [],
    tasks: {},
    updated_at: utcNow(),
  };
}

export function ensureLedger(paths) {
  validateLedgerPaths(paths);
  privateDir(paths.root);
  privateDir(path.dirname(paths.root));
  createIfMissing(paths.events, "");
  createIfMissing(
    paths.snapshot,
    `${JSON.stringify(emptySnapshot(), null, 2)}\n`,
  );
  chmodSync(paths.events, 0o600);
  chmodSync(paths.snapshot, 0o600);
}

export function readSnapshot(paths) {
  return withWriterLock(paths, () => readSnapshotLocked(paths));
}

// Builder-only, explicit R11 -> R12 transition. Never migrate a live task or
// reset counters. The owner-approved pre-apply backup must precede apply.
export function inspectLedgerUpgrade(paths) {
  validateLedgerPaths(paths);
  if (!existsSync(paths.snapshot) && !existsSync(paths.events))
    return "MISSING";
  if (!existsSync(paths.snapshot) || !existsSync(paths.events))
    throw new Error("EXECUTION_STATE_UNKNOWN");
  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
  } catch {
    throw new Error("EXECUTION_STATE_UNKNOWN");
  }
  const supportedVersions = new Set([
    GOVERNANCE_VERSION,
    "m7-t2-r12",
    "m7-t5-r13",
  ]);
  if (supportedVersions.has(snapshot?.governance_version)) {
    readSnapshotLocked(paths, false);
    return "CURRENT";
  }
  const expectedKeys = Object.keys(emptySnapshot()).sort();
  if (
    !snapshot ||
    snapshot.schema_version !== SCHEMA_VERSION ||
    snapshot.governance_version !== "m7-t2-r11" ||
    JSON.stringify(Object.keys(snapshot).sort()) !==
      JSON.stringify(expectedKeys) ||
    snapshot.sequence !== 0 ||
    snapshot.last_event_digest !== null ||
    !Array.isArray(snapshot.ingress_ids) ||
    snapshot.ingress_ids.length !== 0 ||
    !snapshot.tasks ||
    Array.isArray(snapshot.tasks) ||
    Object.keys(snapshot.tasks).length !== 0 ||
    readFileSync(paths.events, "utf8") !== ""
  )
    throw new Error("EXECUTION_STATE_UNKNOWN");
  return "EMPTY_R11";
}

export function upgradeEmptyLegacyLedger(paths) {
  return withWriterLock(paths, () => {
    const state = inspectLedgerUpgrade(paths);
    if (state === "EMPTY_R11")
      writeSnapshotAtomic(paths, {
        ...emptySnapshot(),
        governance_version: "m7-t2-r12",
      });
    return readSnapshotLocked(paths);
  });
}

function readSnapshotLocked(paths, repairSnapshot = true) {
  if (repairSnapshot) ensureLedger(paths);
  else validateLedgerPaths(paths);
  try {
    let snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
    const supportedVersions = new Set([
      GOVERNANCE_VERSION,
      "m7-t2-r12",
      "m7-t5-r13",
    ]);
    if (
      !snapshot ||
      snapshot.schema_version !== SCHEMA_VERSION ||
      !supportedVersions.has(snapshot.governance_version) ||
      !snapshot.tasks ||
      typeof snapshot.tasks !== "object" ||
      Array.isArray(snapshot.tasks) ||
      !Number.isSafeInteger(snapshot.sequence) ||
      snapshot.sequence < 0
    )
      throw new Error("invalid snapshot");
    const lines = readFileSync(paths.events, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    let previous = null;
    let lastSequence = 0;
    const tail = [];
    let journalBudget = { tasks: {} };
    let anchoredBudget = journalBudget.tasks;
    for (const line of lines) {
      const event = JSON.parse(line);
      validateContract("ledger-event", event);
      const { event_digest, ...unsigned } = event;
      if (
        event.schema_version !== SCHEMA_VERSION ||
        !supportedVersions.has(event.governance_version) ||
        event.sequence !== lastSequence + 1 ||
        event.previous_event_digest !== previous ||
        canonicalHash("zink-ledger-event-v1", unsigned) !== event_digest
      )
        throw new Error("event chain mismatch");
      previous = event_digest;
      lastSequence = event.sequence;
      if (event.type === "BUDGET_RESERVED") {
        const { task_id, kind, amount, counters } = event.payload;
        journalBudget = reserveBudget(journalBudget, task_id, kind, amount);
        if (
          BUDGET_FIELDS.some(
            (field) =>
              counters?.[field] !== journalBudget.tasks[task_id][field],
          )
        )
          throw new Error("journal budget mismatch");
      }
      if (event.type.startsWith("WORKFLOW_"))
        journalBudget = applyWorkflowEvent(
          journalBudget,
          event.type,
          event.payload,
        );
      if (event.sequence <= snapshot.sequence)
        anchoredBudget = journalBudget.tasks;
      if (
        event.sequence === snapshot.sequence &&
        event_digest !== snapshot.last_event_digest
      )
        throw new Error("snapshot anchor mismatch");
      if (event.sequence > snapshot.sequence) tail.push(event);
    }
    if (
      snapshot.sequence > lastSequence ||
      (snapshot.sequence === 0 && snapshot.last_event_digest !== null)
    )
      throw new Error("snapshot/event sequence mismatch");
    for (const taskId of new Set([
      ...Object.keys(anchoredBudget),
      ...Object.keys(snapshot.tasks),
    ])) {
      const expected = anchoredBudget[taskId] ?? INITIAL_BUDGET;
      if (
        BUDGET_FIELDS.some(
          (field) => snapshot.tasks[taskId]?.[field] !== expected[field],
        )
      )
        throw new Error("snapshot budget mismatch");
      if (
        expected.workflow_status &&
        canonicalHash("zink-ledger-event-v1", expected) !==
          canonicalHash("zink-ledger-event-v1", snapshot.tasks[taskId])
      )
        throw new Error("snapshot workflow mismatch");
    }
    // Recover only transitions whose complete state delta is in the journal.
    // Unknown event kinds must reconcile with the operator, never be skipped.
    for (const event of tail) {
      if (event.type.startsWith("WORKFLOW_")) {
        snapshot = {
          ...applyWorkflowEvent(snapshot, event.type, event.payload),
          sequence: event.sequence,
          last_event_digest: event.event_digest,
          updated_at: event.created_at,
        };
        continue;
      }
      if (event.type !== "BUDGET_RESERVED")
        throw new Error("unreconciled event after snapshot");
      const { task_id, kind, amount, counters } = event.payload;
      const recovered = reserveBudget(snapshot, task_id, kind, amount);
      if (
        canonicalHash("zink-ledger-event-v1", recovered.tasks[task_id]) !==
        canonicalHash("zink-ledger-event-v1", counters)
      )
        throw new Error("budget replay mismatch");
      snapshot = {
        ...recovered,
        sequence: event.sequence,
        last_event_digest: event.event_digest,
        updated_at: event.created_at,
      };
    }
    if (tail.length > 0 && repairSnapshot) writeSnapshotAtomic(paths, snapshot);
    return snapshot;
  } catch {
    // JSON parser errors may echo persisted content. Keep diagnostics content-free.
    const failure = new Error(
      "Ledger corruption: trusted state cannot be verified",
    );
    failure.code = "EXECUTION_STATE_UNKNOWN";
    throw failure;
  }
}

function withWriterLock(paths, operation) {
  ensureLedger(paths);
  const lock = path.join(paths.root, "writer.lock");
  const deadline = Date.now() + 5000;
  let acquired = false;
  let lastCause;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      acquired = true;
      break;
    } catch (cause) {
      if (cause?.code !== "EEXIST") {
        lastCause = cause;
        break;
      }
      lastCause = cause;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  if (!acquired) {
    const error = new Error("Ledger writer unavailable", { cause: lastCause });
    error.code = "EXECUTION_STATE_UNKNOWN";
    throw error;
  }
  try {
    return operation();
  } finally {
    rmdirSync(lock);
  }
}

export function appendEvent(paths, snapshot, type, payload = {}) {
  return withWriterLock(paths, () => {
    const current = readSnapshotLocked(paths);
    if (
      current.sequence !== snapshot.sequence ||
      current.last_event_digest !== snapshot.last_event_digest ||
      canonicalHash("zink-ledger-event-v1", { ...current, updated_at: 0 }) !==
        canonicalHash("zink-ledger-event-v1", { ...snapshot, updated_at: 0 })
    ) {
      const error = new Error("Stale ledger snapshot");
      error.code = "EXECUTION_STATE_UNKNOWN";
      throw error;
    }
    return appendEventLocked(paths, snapshot, type, payload);
  });
}

function appendEventLocked(paths, snapshot, type, payload) {
  const event = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence: snapshot.sequence + 1,
    type,
    payload,
    created_at: utcNow(),
    previous_event_digest: snapshot.last_event_digest,
  };
  const event_digest = canonicalHash("zink-ledger-event-v1", event);
  validateContract("ledger-event", { ...event, event_digest });
  validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
  const line = `${JSON.stringify({ ...event, event_digest })}\n`;
  const fd = openSync(paths.events, "a", 0o600);
  try {
    appendFileSync(fd, line, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const next = {
    ...snapshot,
    sequence: event.sequence,
    last_event_digest: event_digest,
    updated_at: event.created_at,
  };
  writeSnapshotAtomic(paths, next);
  return next;
}

function writeSnapshotAtomic(paths, snapshot) {
  validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
  const temp = `${paths.snapshot}.tmp-${process.pid}`;
  assertNoLinks(temp);
  const snapshotFd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(snapshotFd, `${JSON.stringify(snapshot, null, 2)}\n`);
    fsyncSync(snapshotFd);
  } finally {
    closeSync(snapshotFd);
  }
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
    if (
      process.platform !== "win32" ||
      !/^(EPERM|EISDIR|EINVAL|ENOTSUP)$/u.test(error?.code ?? "")
    )
      throw error;
  }
}

export function reserveBudget(snapshot, taskId, kind, amount = 1) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TypeError("Budget reservation must be a positive safe integer");
  }
  const task = snapshot.tasks[taskId] ?? INITIAL_BUDGET;
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
  if (
    !key ||
    !Number.isSafeInteger(task[key]) ||
    task[key] < 0 ||
    task[key] > limit - amount
  ) {
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
  _snapshot,
  taskId,
  kind,
  amount = 1,
) {
  return withWriterLock(paths, () => {
    const current = readSnapshotLocked(paths);
    const reserved = reserveBudget(current, taskId, kind, amount);
    return appendEventLocked(paths, reserved, "BUDGET_RESERVED", {
      task_id: taskId,
      kind,
      amount,
      counters: reserved.tasks[taskId],
    });
  });
}

export function recordWorkflowEvent(paths, type, payload) {
  return withWriterLock(paths, () => {
    const current = readSnapshotLocked(paths);
    const projected = applyWorkflowEvent(current, type, payload);
    if (
      canonicalHash("zink-ledger-event-v1", current) ===
      canonicalHash("zink-ledger-event-v1", projected)
    )
      return current;
    return appendEventLocked(paths, projected, type, payload);
  });
}
