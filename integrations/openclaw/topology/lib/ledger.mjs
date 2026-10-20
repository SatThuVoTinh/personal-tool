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
import { applyWorkflowEvent, TERMINAL_WORKFLOW_STATUSES } from "./workflow.mjs";
import { schemaFile, validateContract } from "./schema.mjs";
import {
  withFileLockSync,
  lockDirFor,
  LOCK_OWNER_FILE,
} from "../../lib/file-lock.mjs";
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

// M12/T9 F-228: the published workflow policy is NOT the source of the task
// ceilings yet.
//
// `topology/policy/workflow-policy.json` publishes the budgets that this file
// also carries as frozen literals, so the published policy is documentation that
// no behaviour consults. Loading it here is the fix, and it is NOT applied yet
// because the packager (`lib/policy.mjs`, the governance-library agent's shared
// surface) does not materialize `policy/workflow-policy.json` into the deployed
// plugin tree: a loader without the asset breaks the deployed tree at import
// (`tests/m7-t2-plugin-packaging.test.mjs` proves it).
//
// Until both halves land, the drift between the published file and this table
// is asserted by `tests/agent-topo-F-228.test.mjs`, so the two copies cannot
// diverge silently in the meantime.
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

// M12/T9 F-100: the two event types the published ledger-event CONTRACT
// accepts but the reducer never projects.
//
// `TASK_CREATED` and `DELEGATION_RESERVED` carry no declared payload shape
// (the contract states them as free-form objects) and no reducer branch, so
// they are AUDIT records: they say that something happened, and they change
// no projection. Before this rule the behaviour was defined in ONE region and
// fatal in the other - the anchored region ignored them by accident of the
// `WORKFLOW_` prefix test, and the tail region threw "unreconciled event
// after snapshot", which relabelled to EXECUTION_STATE_UNKNOWN and made every
// later read of the ledger fail forever. A crash between the fsync of an
// event and the write of the snapshot leaves exactly such an event in the
// tail, so the position was reachable, not hypothetical.
//
// The behaviour is now DEFINED and IDENTICAL in both regions: an audit record
// advances the journal and changes no projection.
const AUDIT_ONLY_EVENT_TYPES = Object.freeze([
  "TASK_CREATED",
  "DELEGATION_RESERVED",
]);

function isAuditOnlyEvent(type) {
  return AUDIT_ONLY_EVENT_TYPES.includes(type);
}

/**
 * M12/T9 F-082: the tasks whose projection is NOT terminal.
 *
 * The reducer sets a terminal `workflow_status` only when it applies a
 * terminal event, so a task whose status is not terminal has no matching
 * terminal record. The list is the reconciliation the ledger layer owes the
 * operator: 56 opens against 4 closes is invisible in the projection itself.
 */
export function tasksWithoutTerminalRecord(snapshot) {
  return Object.entries(snapshot?.tasks ?? {})
    .filter(
      ([, task]) => !TERMINAL_WORKFLOW_STATUSES.has(task?.workflow_status),
    )
    .map(([task_id]) => task_id)
    .sort();
}

/**
 * M12/T9 F-082: the reconciliation flag the replay carries.
 *
 * The flag is NON-ENUMERABLE on purpose. The returned object IS a ledger
 * snapshot: the published snapshot contract forbids extra members, the
 * digest chain covers the whole object, and the stale-snapshot check compares
 * it byte for byte. A visible member would break all three, and the flag is
 * a report about the read, never part of the state.
 */
function flagUnterminatedTasks(snapshot) {
  const flagged = tasksWithoutTerminalRecord(snapshot);
  if (flagged.length === 0) return snapshot;
  Object.defineProperty(snapshot, "tasks_without_terminal_record", {
    value: flagged,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return snapshot;
}

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

/**
 * M12/T9 F-063: the replay, and the branch it discarded.
 *
 * `readSnapshot` returns the snapshot alone, and the published snapshot
 * contract forbids extra members, so the discarded branch is a separate
 * read-only report. An operator can therefore reconcile a forked journal
 * instead of the replay refusing to read it.
 */
export function readSnapshotWithReport(paths) {
  const report = { discardedBranches: [] };
  const snapshot = withWriterLock(paths, () =>
    readSnapshotLocked(paths, true, report),
  );
  return { snapshot, discardedBranches: report.discardedBranches };
}

// Builder-only, explicit R11 -> R12 transition. Never migrate a live task or
// reset counters. The owner-approved pre-apply backup must precede apply.
//
// M12/T9 F-070: the inspection now also probes the WRITER LOCK, so a
// preflight that passes is a preflight that can be applied. The lock probe is
// skipped by the one caller that already HOLDS the lock (the upgrade itself),
// because a nested acquisition would deadlock.
export function inspectLedgerUpgrade(paths, options = null) {
  validateLedgerPaths(paths);
  if (options?.probeWriterLock !== false) assertLedgerWriterLockUsable(paths);
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
  const supportedVersions = new Set(SUPPORTED_GOVERNANCE_VERSIONS);
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
    // The writer lock is HELD here, so the lock probe is skipped: it exists to
    // catch an ORPHANED lock before the apply, not to re-acquire our own.
    const state = inspectLedgerUpgrade(paths, { probeWriterLock: false });
    if (state === "EMPTY_R11")
      writeSnapshotAtomic(paths, {
        ...emptySnapshot(),
        governance_version: "m7-t2-r12",
      });
    return readSnapshotLocked(paths);
  });
}

/**
 * M12/T9 F-070: the liveness of the ledger WRITER LOCK, read without
 * touching it.
 *
 * The lock protocol is explicit that a crashed holder leaves the lock
 * directory behind and that recovery is an OPERATOR action (see
 * `lib/file-lock.mjs`). Until now nothing but the apply path ever noticed:
 * the preflight read the snapshot and the events directly, so it reported
 * CURRENT while the very next `--apply` died with "Ledger writer
 * unavailable" — one wasted deployment grant per orphan, while the ledger
 * kept failing closed in between.
 *
 * The probe is READ-ONLY on purpose:
 *
 *   - it never acquires the lock, so it cannot block a live writer and it
 *     cannot turn a read-only preflight into a mutation;
 *   - a lock whose holder is provably DEAD is an orphan and fails the
 *     preflight with the same code the apply path uses;
 *   - a lock whose holder is ALIVE is left alone: the apply path still
 *     refuses it, exactly as before, and refusing the preflight too would
 *     break the ordinary case of inspecting a running gateway;
 *   - a lock that cannot be read (no owner record yet, or an unreadable one)
 *     is UNVERIFIED and never fails closed on a guess — a fresh acquisition
 *     has a window in which the directory exists and the owner record does
 *     not, and a probe that refused there would produce false refusals.
 */
export function inspectLedgerWriterLock(paths) {
  const lock = lockDirFor(paths.root, "writer.lock");
  if (!existsSync(lock)) return { state: "ABSENT", pid: null };
  const ownerPath = path.join(lock, LOCK_OWNER_FILE);
  let owner;
  try {
    owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    return { state: "UNVERIFIED", pid: null };
  }
  const pid = Number.isInteger(owner?.pid) ? owner.pid : null;
  if (pid === null || pid <= 0) return { state: "UNVERIFIED", pid: null };
  try {
    // Signal 0 tests for existence and permission only; it never signals the
    // process. EPERM means a process exists under another user, which is
    // exactly the "alive" answer.
    process.kill(pid, 0);
    return { state: "HELD", pid };
  } catch (error) {
    if (error?.code === "ESRCH" || error?.code === "EINVAL")
      return { state: "ORPHANED", pid };
    if (error?.code === "EPERM") return { state: "HELD", pid };
    return { state: "UNVERIFIED", pid };
  }
}

/**
 * M12/T9 F-070: refuse an ORPHANED writer lock before the apply is spent.
 *
 * The message is a fixed literal — never a path, a pid or a config value —
 * because it is read by the operator-facing classifier. It keeps the
 * established "Ledger writer unavailable" wording, so the refusal reads the
 * same in the preflight and on the apply path, and it adds the reason the
 * preflight can now prove.
 */
export function assertLedgerWriterLockUsable(paths) {
  const state = inspectLedgerWriterLock(paths);
  if (state.state === "ORPHANED") {
    const error = new Error(
      "Ledger writer unavailable: the writer lock is orphaned",
      {
        cause: new Error("LEDGER_WRITER_LOCK_ORPHANED"),
      },
    );
    error.code = "EXECUTION_STATE_UNKNOWN";
    throw error;
  }
  return state;
}

/**
 * M12/T9 F-063: a forked pair in the journal.
 *
 * Two writers behind one lock emit the SAME sequence number with different
 * payloads, so the journal carries two branches from one point. The branch the
 * journal CONTINUED on is the live one - the successor event's
 * `previous_event_digest` names it - and the snapshot anchor names it when the
 * fork sits at the accepted head. The other branch is DISCARDED, and it is
 * REPORTED, so the reader answers a forked journal with a reconciliation path
 * instead of a bare "event chain mismatch".
 */
function resolveForkSurvivors(events, snapshot) {
  const bySequence = new Map();
  for (const event of events) {
    const bucket = bySequence.get(event.sequence);
    if (bucket) bucket.push(event);
    else bySequence.set(event.sequence, [event]);
  }
  const survivors = new Map();
  for (const [sequence, candidates] of bySequence) {
    if (candidates.length < 2) continue;
    const successor = (bySequence.get(sequence + 1) ?? [])[0];
    const anchored =
      sequence === snapshot.sequence &&
      typeof snapshot.last_event_digest === "string"
        ? snapshot.last_event_digest
        : null;
    const survivor =
      (successor
        ? candidates.find(
            (candidate) =>
              candidate.event_digest === successor.previous_event_digest,
          )
        : undefined) ??
      (anchored
        ? candidates.find((candidate) => candidate.event_digest === anchored)
        : undefined) ??
      candidates[0];
    survivors.set(sequence, survivor);
  }
  return { bySequence, survivors };
}

function readSnapshotLocked(paths, repairSnapshot = true, report = null) {
  if (repairSnapshot) ensureLedger(paths);
  else validateLedgerPaths(paths);
  try {
    let snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
    const supportedVersions = new Set(SUPPORTED_GOVERNANCE_VERSIONS);
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
    const rawLines = readFileSync(paths.events, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // F-143: a torn tail. The writer appends AND fsyncs the event BEFORE the
    // snapshot that anchors it, so a partially written FINAL line provably has
    // no snapshot anchor: it was never acknowledged, never projected, and can
    // be dropped instead of making every read and every write fail forever.
    // A damaged line anywhere else is real corruption and still throws, and a
    // damaged FINAL line the snapshot DID anchor is real corruption too — the
    // snapshot proves the event existed, so dropping it would silently lose
    // acknowledged history.
    const events = [];
    let tornTailBytes = 0;
    for (const [index, line] of rawLines.entries()) {
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        const isFinalLine = index === rawLines.length - 1;
        const isUnanchored = rawLines.length > snapshot.sequence;
        if (!isFinalLine || !isUnanchored) throw error;
        tornTailBytes = Buffer.byteLength(line, "utf8");
        break;
      }
    }
    if (tornTailBytes > 0) {
      // The dropped remainder is REPORTED, never silently swallowed: the byte
      // count is a measurement, the content is untrusted ledger data and is
      // deliberately not logged.
      console.error(
        "[zink-ledger] torn journal tail dropped:",
        `JOURNAL_TORN_TAIL bytes=${tornTailBytes}`,
      );
    }
    let previous = null;
    let lastSequence = 0;
    const tail = [];
    let journalBudget = { tasks: {} };
    let anchoredBudget = journalBudget.tasks;
    // M12/T9 F-063: the fork map is computed from the journal itself, so a
    // forked pair is recognised before the chain check refuses it.
    const { bySequence, survivors } = resolveForkSurvivors(events, snapshot);
    const discardedBranches = [];
    if (report) report.discardedBranches = discardedBranches;
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
    const journalHasPreVerdictStamp = events.some((event) =>
      PRE_VERDICT_VERSIONS.has(event.governance_version),
    );
    // Resolve one event's writer semantics from its own stamp alone. The
    // m8-t2.2-r4 stamp is the ambiguous one: it falls through to the
    // compatibility heuristic, because it was emitted by both writers.
    const preVerdictForEvent = (event) => {
      if (event.governance_version === GOVERNANCE_VERSION) return false;
      if (PRE_VERDICT_VERSIONS.has(event.governance_version)) return true;
      return journalHasPreVerdictStamp;
    };
    for (const event of events) {
      validateContract("ledger-event", event);
      const { event_digest, ...unsigned } = event;
      const forkCandidates = bySequence.get(event.sequence) ?? [];
      if (forkCandidates.length > 1) {
        const survivor = survivors.get(event.sequence);
        if (event !== survivor) {
          if (survivor && survivor.event_digest === event_digest) {
            // The same event twice is corruption, not a fork: the fail-stop
            // shape stays.
            throw new Error("event chain mismatch");
          }
          if (
            canonicalHash("zink-ledger-event-v1", unsigned) !== event_digest
          ) {
            throw new Error("event chain mismatch");
          }
          // M12/T9 F-063: the branch the journal did not continue on. It is
          // reported, never replayed.
          discardedBranches.push({
            sequence: event.sequence,
            event_digest,
            type: event.type,
            created_at: event.created_at,
          });
          continue;
        }
      }
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
      // M12/T9 F-100: the audit-only types are recognised EXPLICITLY here, so
      // the anchored region has the same defined behaviour as the tail: an
      // audit record changes no projection.
      if (isAuditOnlyEvent(event.type)) {
        // nothing to project
      } else if (event.type.startsWith("WORKFLOW_"))
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
    if (discardedBranches.length > 0) {
      // The discarded branch is REPORTED, never silently swallowed: the
      // sequence numbers are a measurement, the event content is untrusted
      // ledger data and is deliberately not logged.
      console.error(
        "[zink-ledger] forked branch discarded:",
        `LEDGER_FORK_DISCARDED count=${discardedBranches.length} sequences=${[
          ...new Set(discardedBranches.map((branch) => branch.sequence)),
        ].join(",")}`,
      );
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
      if (event.type !== "BUDGET_RESERVED") {
        // M12/T9 F-100: the audit-only types are RECONCILED here, exactly as
        // the anchored region reconciles them. They advance the journal and
        // change no projection, so a crash between the fsync of an event and
        // the write of the snapshot no longer bricks every later read.
        if (!isAuditOnlyEvent(event.type))
          throw new Error("unreconciled event after snapshot");
        snapshot = {
          ...snapshot,
          sequence: event.sequence,
          last_event_digest: event.event_digest,
          updated_at: event.created_at,
        };
        continue;
      }
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
    return flagUnterminatedTasks(snapshot);
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

/**
 * F-143: refuse to append to a journal that ends in an unterminated record.
 *
 * The writer emits every event as one newline-terminated record, so a file
 * that does NOT end with a newline ends in a partially written record: the
 * append was interrupted (crash, ENOSPC, drvfs EIO) after the bytes reached
 * the file but before the newline did.
 *
 * The READER tolerates that record - it was never acknowledged and never
 * anchored by a snapshot, so dropping it and reporting it is safe, and it is
 * what stops one interrupted append from making the whole ledger unreadable
 * forever.
 *
 * The WRITER does not. The journal is append-only durable state, and a
 * committed lane requires a broken event log to refuse new appends and to be
 * left exactly as it is - "not silently repaired or extended". So the writer
 * refuses with a named code and leaves the residue in place for an operator
 * to repair; it never truncates the file behind the operator's back.
 */
function assertJournalAppendable(paths) {
  if (!existsSync(paths.events)) return;
  const fd = openSync(paths.events, "r");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return;
    const buffer = Buffer.alloc(1);
    readSync(fd, buffer, 0, 1, size - 1);
    if (buffer[0] !== 0x0a) {
      const error = new Error(
        "JOURNAL_TORN_TAIL: the event log ends in an unterminated record; new appends are refused until it is repaired",
      );
      error.code = "JOURNAL_TORN_TAIL";
      throw error;
    }
  } finally {
    closeSync(fd);
  }
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
  assertJournalAppendable(paths);
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
    ) {
      // M12/T9 F-081: the receipt ARRIVED and was IGNORED.
      //
      // The writer used to return the unchanged snapshot as SUCCESS, so the
      // ledger could not tell "arrived and was ignored" from "never happened",
      // and the event-count reconciliation the terminal forensics need was
      // impossible. The caller now gets an explicit `discarded: true`.
      //
      // The flag is NON-ENUMERABLE on purpose: the returned object IS a
      // ledger snapshot, and it must stay byte-identical to the one the
      // ledger holds - the published snapshot contract forbids extra members,
      // the digest chain covers the whole object, and the stale-snapshot check
      // compares it. A visible member would break all three.
      const discarded = { ...current };
      Object.defineProperty(discarded, "discarded", {
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
      });
      return discarded;
    }
    return appendEventLocked(paths, projected, type, payload, createdAt);
  });
}
