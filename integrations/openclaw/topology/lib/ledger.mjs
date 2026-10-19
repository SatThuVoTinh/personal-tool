import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { Buffer } from "node:buffer";
import path from "node:path";
import process from "node:process";
import { applyWorkflowEvent } from "./workflow.mjs";
import { schemaFile, validateContract } from "./schema.mjs";
import { withFileLockSync, lockDirFor } from "../../lib/file-lock.mjs";
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

/**
 * F-065: the ONE declaration of the governance versions this reader accepts.
 *
 * It used to exist as two independent hand-maintained literals in this file
 * (one in the upgrade inspector, one in the replay reader), derived from
 * neither the contract nor each other, so the two could drift apart silently:
 * a version the inspector called CURRENT could be one the reader refused, and
 * the whole ledger would read as corruption.
 *
 * The contract is the single source: the ledger-event schema already declares
 * the closed enum of versions an event may carry, and a reader that accepts
 * anything else is accepting an event no writer was allowed to produce. The
 * versions a writer may EMIT are still governed by canonical.mjs.
 */
export const SUPPORTED_GOVERNANCE_VERSIONS = Object.freeze(
  schemaFile("ledger-event").properties.governance_version.enum,
);

// A-6 / R6-V11-01: the segments `ledgerPaths` appends. A caller that passes an
// already-joined root gets them appended a second time, which mints a new,
// empty, permission-valid governance root nested inside the real one — the live
// state tree still carries that artifact. Matched on resolved path segments so
// a trailing separator or platform separator cannot smuggle it through.
const LEDGER_ROOT_SUFFIX = Object.freeze(["operator", "m7-t2", "ledger"]);

export function ledgerPaths(stateDir) {
  const segments = path.resolve(stateDir).split(path.sep).filter(Boolean);
  const tail = segments.slice(-LEDGER_ROOT_SUFFIX.length);
  if (
    segments.length >= LEDGER_ROOT_SUFFIX.length &&
    LEDGER_ROOT_SUFFIX.every((part, index) => tail[index] === part)
  ) {
    throw new Error(
      `LEDGER_ROOT_ALREADY_JOINED: ${stateDir} already ends with operator/m7-t2/ledger. ` +
        "Pass the STATE root — the directory that CONTAINS operator/ — because this " +
        "function appends the suffix and a second copy would create a separate, empty " +
        "governance root beside the real ledger.",
    );
  }
  const root = path.join(stateDir, "operator", "m7-t2", "ledger");
  return Object.freeze({
    root,
    events: path.join(root, "events.jsonl"),
    snapshot: path.join(root, "snapshot.json"),
    identityKey: path.join(stateDir, "operator", "m7-t2", "identity.key"),
  });
}

function privateDir(dir, visited = null) {
  assertNoLinks(dir, visited);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/**
 * Refuses any symlink on the path to `target`, all the way up, and returns how many paths
 * it actually inspected. `visited` is a per-call memo of ancestors already proven link-free
 * — scoped to one operation on purpose, because caching it across calls would stop
 * re-checking a link planted later. The count is returned so the dedup is observable: a
 * test that only looks at the memo cannot tell a skipped path from a re-walked one.
 */
export function assertNoLinks(target, visited = null) {
  if (!path.isAbsolute(target)) throw new Error("EXECUTION_STATE_UNKNOWN");
  let checked = 0;
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  ) {
    if (visited?.has(cursor)) continue;
    visited?.add(cursor);
    checked += 1;
    try {
      if (lstatSync(cursor).isSymbolicLink())
        throw new Error("LEDGER_SYMLINK_DENIED");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return checked;
}

function validateLedgerPaths(paths, visited = null) {
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
    assertNoLinks(target, visited);
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
  const visited = new Set();
  validateLedgerPaths(paths, visited);
  privateDir(paths.root, visited);
  privateDir(path.dirname(paths.root), visited);
  // M11/T3 B2: the pair is created together or not at all. Recreating a missing
  // half silently resumed governance at `sequence: 0` with
  // `last_event_digest: null`, and the reconciliation guard only fires when the
  // snapshot is AHEAD of the event log, so the rebuilt pair passed every check
  // and the loss looked like a fresh ledger. A half-present pair is now an
  // explicit state this process cannot resolve; recovery is an operator action.
  const eventsPresent = existsSync(paths.events);
  const snapshotPresent = existsSync(paths.snapshot);
  if (eventsPresent !== snapshotPresent) {
    const incomplete = new Error("Ledger state incomplete");
    incomplete.code = "EXECUTION_STATE_UNKNOWN";
    throw incomplete;
  }
  createIfMissing(paths.events, "");
  createIfMissing(
    paths.snapshot,
    `${JSON.stringify(emptySnapshot(), null, 2)}\n`,
  );
  if (paths.identityKey) {
    if (!existsSync(paths.identityKey)) {
      writeFileSync(paths.identityKey, `${randomBytes(32).toString("hex")}\n`, {
        mode: 0o600,
        flag: "wx",
      });
    }
    chmodSync(paths.identityKey, 0o600);
  }
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
    // m8-t2.2-r4 is RETAINED, not replaced: it is the version the deployed
    // writer emitted, and dropping it would make every ledger it wrote
    // permanently unreadable. It is ambiguous for replay semantics (see the
    // reader's compatibility path) but its events remain valid.
    "m8-t2.2-r4",
    "m8-t2.1-r3",
    "m8-t2-r9",
    "m7-t5-r13",
    "m7-t2-r12",
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
      // RETAINED for readability, including the semantically ambiguous
      // m8-t2.2-r4. Replaced versions would make the ledger they wrote
      // permanently unreadable.
      "m8-t2.2-r4",
      "m8-t2.1-r3",
      "m8-t2-r9",
      "m7-t5-r13",
      "m7-t2-r12",
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
    // Option (b) migration 2026-09-29: anchored trust is a property of a
    // ledger that HAS recorded, operator-accepted history, so it requires a
    // recorded head. A ledger with no head (sequence 0, the state of a freshly
    // created or freshly reset ledger) has no anchored history at all, so every
    // event in it is replayed under the current semantics. Without this, a root
    // result written today would be re-resolved by its own read-back into the
    // pre-verdict model, contradicting the write it just produced.
    const hasAnchoredHead = snapshot.sequence > 0;
    // Option (b) migration 2026-09-29 + Phase B (gap A) 2026-09-29: the
    // writer-semantics discriminator is the event's OWN governance_version,
    // which the event digest seals. Three classes, decided per event:
    //
    //   1. Current version  -> written by the current writer, so current
    //      semantics. Unambiguous.
    //   2. Pre-verdict version -> written by a pre-verdict writer, so
    //      pre-verdict semantics. Unambiguous.
    //   3. m8-t2.2-r4 -> AMBIGUOUS. That version was emitted by BOTH a
    //      pre-verdict writer and the verdict writer, so the stamp alone cannot
    //      say which. These keep the existing compatibility behaviour, which is
    //      proven to reproduce the deployed writer's own states.
    //
    // The compatibility heuristic is confined to class 3. It could not be
    // global: a new event lands inside the anchored prefix, so a journal-wide
    // flag re-resolved the current writer's own write into the pre-verdict
    // model and made a successful write unreadable.
    const PRE_VERDICT_VERSIONS = new Set([
      "m7-t2-r12",
      "m7-t5-r13",
      "m8-t2-r9",
      "m8-t2.1-r3",
    ]);
    // Computed ONLY from the event stream: an ambiguous-era journal is one that
    // carries any pre-verdict stamp. The snapshot under verification is never
    // consulted, so this is not circular.
    const journalHasPreVerdictStamp = lines.some((line) =>
      PRE_VERDICT_VERSIONS.has(JSON.parse(line).governance_version),
    );
    // Resolve one event's writer semantics from its own stamp alone. The
    // m8-t2.2-r4 stamp is the ambiguous one: it falls through to the
    // compatibility heuristic, because it was emitted by both writers.
    const preVerdictForEvent = (event) => {
      if (event.governance_version === GOVERNANCE_VERSION) return false;
      if (PRE_VERDICT_VERSIONS.has(event.governance_version)) return true;
      return journalHasPreVerdictStamp;
    };
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
          event.created_at,
          // Option (b) migration 2026-09-29: events at or below the snapshot
          // head are operator-accepted history — replay trusts their admission
          // (structure, effects, and the end-state hash compare below still
          // verify everything checkable) and reproduces the transitions the
          // deployed build performed. Events beyond the head are unaccepted
          // tail and stay fully strict. The flag MUST never be set for tail:
          // admission policy is enforced at write time, and re-reads must not
          // re-litigate it.
          hasAnchoredHead && event.sequence <= snapshot.sequence
            ? {
                replayAnchored: true,
                preVerdictRootResult: preVerdictForEvent(event),
              }
            : undefined,
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
          ...applyWorkflowEvent(
            snapshot,
            event.type,
            event.payload,
            event.created_at,
          ),
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
  } catch (error) {
    // M11/T3 B3: the fault class must survive. Relabelling every replay fault as
    // corruption with no cause left the operator unable to separate a genuine
    // corrupt record from `ENOSPC`, a budget exhaustion, or a snapshot write
    // failure — and the host-visible code is unchanged, so the only diagnostic
    // available was nothing.
    //
    // The logged field is the error CLASS, never its message: JSON parser errors
    // quote a snippet of the parsed content, and ledger content is untrusted
    // data that must not reach the log. The full original error stays attached as
    // `cause` for in-process consumers.
    //
    // `code` is read BEFORE `name` because `name` is truthy on every Error — an
    // fs errno and a schema refusal both answered "Error", which is the one
    // distinction this line exists to make (`R1-A14-02`).
    console.error(
      "[zink-ledger] replay fault:",
      String(error?.code ?? error?.name ?? "unknown"),
    );
    const failure = new Error(
      "Ledger corruption: trusted state cannot be verified",
    );
    failure.code = "EXECUTION_STATE_UNKNOWN";
    failure.cause = error;
    throw failure;
  }
}

function withWriterLock(paths, operation) {
  ensureLedger(paths);
  const lock = lockDirFor(paths.root, "writer.lock");
  try {
    return withFileLockSync(lock, () => operation());
  } catch (err) {
    if (err?.code === "FILE_LOCK_BUSY") {
      const error = new Error("Ledger writer unavailable", {
        cause: err,
      });
      error.code = "EXECUTION_STATE_UNKNOWN";
      throw error;
    }
    throw err;
  }
}

export function appendEvent(paths, snapshot, type, payload = {}) {
  // M7-002: single authoritative commit path. Workflow-governed event types
  // must reduce through applyWorkflowEvent via recordWorkflowEvent; the raw
  // writer persists audit/metadata events only and can never advance the
  // workflow projection on its own.
  if (typeof type === "string" && type.startsWith("WORKFLOW_")) {
    const error = new Error(
      "WORKFLOW_COMMIT_PATH_REQUIRED: workflow events must commit via recordWorkflowEvent",
    );
    error.code = "WORKFLOW_COMMIT_PATH_REQUIRED";
    throw error;
  }
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

function appendEventLocked(
  paths,
  snapshot,
  type,
  payload,
  createdAt = utcNow(),
) {
  const event = {
    schema_version: SCHEMA_VERSION,
    governance_version: GOVERNANCE_VERSION,
    sequence: snapshot.sequence + 1,
    type,
    payload,
    created_at: createdAt,
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

/**
 * Remove this writer's own temp snapshot, best-effort.
 *
 * A half-written temp file is not canonical state, but the file was opened `"wx"`,
 * so no later writer can replace it either: left in place it blocks every
 * subsequent snapshot write. `EPERM` and `EISDIR` are what Windows and POSIX
 * answer when something else owns the path, and `ENOENT` is the same verdict as a
 * successful removal. Anything else is a real fault and propagates — a cleanup
 * that swallows or invents a cause is the failure `R1-A14-02` is about.
 */
export function unlinkWriterResidue(tempPath) {
  try {
    unlinkSync(tempPath);
  } catch (error) {
    if (!["EPERM", "EISDIR", "ENOENT"].includes(error?.code)) throw error;
  }
}

function writeSnapshotAtomic(paths, snapshot) {
  validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
  const temp = `${paths.snapshot}.tmp-${process.pid}`;
  assertNoLinks(temp);
  const snapshotFd = openSync(temp, "wx", 0o600);
  let writeFault = null;
  try {
    writeFileSync(snapshotFd, `${JSON.stringify(snapshot, null, 2)}\n`);
    fsyncSync(snapshotFd);
  } catch (error) {
    writeFault = error;
  } finally {
    closeSync(snapshotFd);
  }
  if (writeFault) {
    // Cleaned only after the descriptor is closed, so the removal can succeed on
    // Windows as well as POSIX, and the caller still receives the write fault.
    unlinkWriterResidue(temp);
    throw writeFault;
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
    const createdAt = utcNow();
    const projected = applyWorkflowEvent(current, type, payload, createdAt);
    if (
      canonicalHash("zink-ledger-event-v1", current) ===
      canonicalHash("zink-ledger-event-v1", projected)
    )
      return current;
    return appendEventLocked(paths, projected, type, payload, createdAt);
  });
}
