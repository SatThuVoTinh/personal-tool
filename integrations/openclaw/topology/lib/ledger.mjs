import { createHash, randomBytes } from "node:crypto";
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
  statSync,
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
 * The governance versions written by a PRE-VERDICT writer.
 *
 * An event stamped with one of these was written by a writer that resolved a
 * root result DIRECTLY to its recorded outcome, so the anchored replay
 * reproduces that resolution. The list is the reader's ONE declaration of the
 * pre-verdict era, and the checkpoint carries the era it declares
 * (M12/T9 F-099).
 */
const PRE_VERDICT_VERSIONS = new Set([
  "m7-t2-r12",
  "m7-t5-r13",
  "m8-t2-r9",
  "m8-t2.1-r3",
]);

/** The pre-verdict stamps as they appear in a journal line. */
const PRE_VERDICT_STAMP_PATTERN =
  /"governance_version":"(?:m7-t2-r12|m7-t5-r13|m8-t2-r9|m8-t2\.1-r3)"/u;

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
    // M12/T9 F-099: the replay checkpoint, beside the snapshot it describes.
    checkpoint: path.join(root, "checkpoint.json"),
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
  // M12/T9 F-099: the checkpoint is a SIBLING of the snapshot, never a member
  // of it. A caller that names its own path must name the canonical one; a
  // caller that names none gets the canonical one (the plugin builds its
  // ledger paths by hand, and the checkpoint must exist there too).
  if (paths.checkpoint !== undefined) {
    if (paths.checkpoint !== path.join(paths.root, "checkpoint.json"))
      throw new Error("EXECUTION_STATE_UNKNOWN");
  }
  for (const target of [
    paths.root,
    paths.events,
    paths.snapshot,
    checkpointPath(paths),
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

/**
 * M12/T9 F-099: the replay checkpoint.
 *
 * The reader replayed the WHOLE event log on every operation: every line was
 * re-parsed, re-validated against the contract, re-hashed and re-applied,
 * including the anchored prefix the snapshot had already sealed. The cost is
 * O(total history) per operation, and a read holds the WRITER LOCK for the
 * whole of it, so the lock-hold time - and with it the FILE_LOCK_BUSY window
 * - grew linearly with the ledger.
 *
 * The checkpoint is the replay's resume point. It is a small file in the
 * ledger root, written with the snapshot, that records:
 *
 *   sequence               - the snapshot sequence the checkpoint describes
 *   last_event_digest      - the digest that snapshot anchors
 *   has_pre_verdict_stamp  - the journal's era, derived from the event stream
 *   events_offset          - the byte offset where the anchored prefix ends
 *   prefix_digest          - the chained digest over the anchored prefix
 *
 * The reader VERIFIES the anchored prefix's bytes against `prefix_digest` and
 * then replays ONLY the tail beyond `events_offset`, starting the chain at
 * the snapshot's own anchor. `prefix_digest` is not optional: without a
 * digest over the anchored prefix's bytes, a corrupted ANCHORED event would
 * no longer be detected, because the anchored prefix is no longer replayed.
 *
 * The digest is a CHAIN over the prefix's lines, so the writer can extend it
 * with ONE line instead of re-hashing the whole prefix on every append, and
 * the reader can still detect a change in ANY anchored byte.
 *
 * The checkpoint is DERIVED state: it can always be rebuilt from the journal
 * and the snapshot, so its ABSENCE is a performance regression and never a
 * corruption. A checkpoint that does not match the journal is stale, and the
 * reader falls back to the full read and rewrites it.
 */
const CHECKPOINT_FILE = "checkpoint.json";

/**
 * The checkpoint's seal.
 *
 * It covers the anchored prefix's BYTES and the snapshot's anchored task
 * states, because the checkpoint asserts BOTH of those things: that this
 * prefix is the one the snapshot sealed, and that this snapshot is the
 * projection of it.
 *
 * The bytes alone are not enough. The anchored prefix is no longer replayed,
 * so a digest over the bytes alone would let a TAMPERED SNAPSHOT through -
 * the reader would trust task states it never re-derived. Sealing the task
 * states as well keeps the existing "snapshot workflow mismatch" refusal
 * (tests/m8-t2.3-writer-semantics.test.mjs) exactly as strong as it was.
 */
export function checkpointDigest(prefixBytes, tasks) {
  return canonicalHash("zink-ledger-checkpoint-v1", {
    prefix: createHash("sha256").update(prefixBytes).digest("hex"),
    tasks: canonicalHash("zink-ledger-checkpoint-v1", tasks),
  });
}

/** The canonical checkpoint path for a ledger root. */
function checkpointPath(paths) {
  return paths.checkpoint ?? path.join(paths.root, CHECKPOINT_FILE);
}

/**
 * The checkpoint's content, or null when there is none or it is not
 * readable. A malformed checkpoint is never trusted: it is simply absent.
 */
function readCheckpoint(paths) {
  const file = checkpointPath(paths);
  if (!existsSync(file)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return null;
  const {
    sequence,
    last_event_digest,
    has_pre_verdict_stamp,
    events_offset,
    prefix_digest,
  } = parsed;
  if (!Number.isSafeInteger(sequence) || sequence < 0) return null;
  if (last_event_digest !== null && !/^[a-f0-9]{64}$/u.test(last_event_digest))
    return null;
  if (typeof has_pre_verdict_stamp !== "boolean") return null;
  if (!Number.isSafeInteger(events_offset) || events_offset < 0) return null;
  if (!/^[a-f0-9]{64}$/u.test(prefix_digest)) return null;
  return {
    sequence,
    last_event_digest,
    has_pre_verdict_stamp,
    events_offset,
    prefix_digest,
  };
}

/**
 * The checkpoint file, written atomically beside the snapshot.
 *
 * A fault here is never fatal to the caller: the snapshot is already written,
 * and a checkpoint that is missing is a performance regression the next read
 * repairs. The fault is REPORTED, never swallowed.
 */
function writeCheckpointAtomic(paths, checkpoint) {
  const file = checkpointPath(paths);
  const temp = `${file}.tmp-${process.pid}`;
  try {
    assertNoLinks(temp);
    const fd = openSync(temp, "wx", 0o600);
    let writeFault = null;
    try {
      writeFileSync(fd, `${JSON.stringify(checkpoint, null, 2)}\n`);
      fsyncSync(fd);
    } catch (error) {
      writeFault = error;
    } finally {
      closeSync(fd);
    }
    if (writeFault) {
      unlinkWriterResidue(temp);
      throw writeFault;
    }
    chmodSync(temp, 0o600);
    renameSync(temp, file);
    // The rename is only durable once the PARENT DIRECTORY is fsynced: the
    // file handle was fsynced through the temporary file, which the rename
    // replaced. The directory fsync is bound to its own handle, opened with
    // the READ flag, exactly as the snapshot's publisher does it.
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
  } catch (error) {
    console.error(
      "[zink-ledger] checkpoint write failed:",
      String(error?.code ?? error?.name ?? "unknown"),
    );
  }
}

/**
 * The journal's lines, split on the newline, with the byte offset of the end
 * of each line. The offsets are BYTES, because the checkpoint's
 * `events_offset` is a seek position in the file.
 */
function splitJournalLines(buffer) {
  const lines = [];
  const ends = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue;
    const line = buffer.subarray(start, index).toString("utf8").trim();
    if (line.length > 0) {
      lines.push(line);
      ends.push(index + 1);
    }
    start = index + 1;
  }
  if (start < buffer.length) {
    const line = buffer.subarray(start).toString("utf8").trim();
    if (line.length > 0) {
      lines.push(line);
      ends.push(buffer.length);
    }
  }
  return { lines, ends };
}

/** The size of a file, or 0 when it does not exist. */
function journalFileSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return 0;
  }
}

/**
 * The events beyond the checkpoint's anchor, or null when the checkpoint does
 * not describe this journal.
 *
 * The anchored prefix is VERIFIED, never replayed: its bytes must seal to the
 * digest the checkpoint recorded, together with the snapshot's own task
 * states. A checkpoint that does not match the journal - or a snapshot that
 * was tampered with - is stale, and the caller falls back to the full read,
 * which re-derives the anchored projection and refuses the mismatch.
 */
function readCheckpointedTail(paths, checkpoint, snapshot) {
  let buffer;
  try {
    buffer = readFileSync(paths.events);
  } catch {
    return null;
  }
  if (buffer.length < checkpoint.events_offset) return null;
  const prefix = buffer.subarray(0, checkpoint.events_offset);
  if (checkpointDigest(prefix, snapshot.tasks) !== checkpoint.prefix_digest) {
    return null;
  }
  const tail = splitJournalLines(buffer.subarray(checkpoint.events_offset));
  return { lines: tail.lines, ends: tail.ends };
}

/**
 * The events a journal's lines carry, with the torn-tail rule applied.
 *
 * A damaged FINAL line that the snapshot does not anchor is an interrupted
 * append: it was never acknowledged, never projected, and can be dropped. A
 * damaged line anywhere else is real corruption and still throws.
 */
function parseJournalEvents(lines, unanchoredTail) {
  const events = [];
  let tornTailBytes = 0;
  for (const [index, line] of lines.entries()) {
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      const isFinalLine = index === lines.length - 1;
      if (!isFinalLine || !unanchoredTail) throw error;
      tornTailBytes = Buffer.byteLength(line, "utf8");
      break;
    }
  }
  return { events, tornTailBytes };
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
  // M12/T9 F-099: the checkpoint is the THIRD file of the trio, and it may
  // not outlive the state it describes: a checkpoint beside a ledger that does
  // not exist is the residue of a half-committed write, and it is refused
  // exactly like a half-present pair.
  //
  // The other direction is NOT an error: the checkpoint is DERIVED state, so a
  // ledger that predates it (or one whose checkpoint was lost) still reads -
  // the reader rebuilds the checkpoint from the journal and the snapshot.
  const checkpointPresent = existsSync(checkpointPath(paths));
  if (checkpointPresent && !(eventsPresent && snapshotPresent)) {
    const incomplete = new Error("Ledger state incomplete");
    incomplete.code = "EXECUTION_STATE_UNKNOWN";
    throw incomplete;
  }
  createIfMissing(paths.events, "");
  createIfMissing(
    paths.snapshot,
    `${JSON.stringify(emptySnapshot(), null, 2)}\n`,
  );
  // The trio is created together: a ledger born without its checkpoint is a
  // ledger whose first read has to hash the whole journal. A ledger that
  // already exists keeps its checkpoint absent until the reader rebuilds it
  // from the journal and the snapshot it describes.
  if (!eventsPresent && !checkpointPresent) {
    writeCheckpointAtomic(paths, {
      sequence: 0,
      last_event_digest: null,
      has_pre_verdict_stamp: false,
      events_offset: 0,
      prefix_digest: checkpointDigest(Buffer.alloc(0), {}),
    });
  }
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

/**
 * M12/T9 F-414 (R9-T03-1): drop the replay checkpoint after the migration has
 * re-derived the projection.
 *
 * The checkpoint is DERIVED state, so its absence is only a performance
 * regression the next read repairs. A failed removal is a real fault: the
 * migration must not report success while leaving a possibly mis-anchored
 * record beside the snapshot it just re-derived.
 */
function discardCheckpoint(paths) {
  try {
    unlinkSync(checkpointPath(paths));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

/**
 * M12/T9 (the owner's ruling of 2026-10-21): recompute the DERIVED snapshot
 * from the authoritative journal.
 *
 * F-160 changed how a task's state is re-derived from its events, and F-060
 * changed what a task carries. A snapshot written by an older build therefore
 * no longer agrees with its own journal, and the reader refuses with
 * `snapshot workflow mismatch` - the ledger becomes unreadable even though the
 * record it is derived from is intact.
 *
 * The journal is the record. The snapshot is derived from it. So the forward
 * migration recomputes the derived artefact:
 *
 *   1. EVERY event is verified first - the chain, the digests and the budget.
 *      A journal that does not verify is refused and NOTHING is written.
 *   2. the task states are re-derived with the CURRENT rules;
 *   3. the snapshot is written atomically, beside the journal.
 *
 * The journal is never written, and no state is invented: a snapshot that was
 * edited by hand is REPAIRED from the journal rather than reported, because
 * the journal is the record and the snapshot is a cache of it.
 */
export function migrateLedgerProjection(paths) {
  ensureLedger(paths);
  const buffer = readFileSync(paths.events);
  const { lines } = splitJournalLines(buffer);
  if (lines.length === 0) {
    return { changed: false, sequence: 0, tasks: 0 };
  }
  // A FULL read, in the recompute mode: the whole journal is replayed with the
  // current rules, so the derived state is the one the current build produces.
  // It is the READER's own replay - the same code, the same anchored rule - so
  // the two cannot drift apart. It used to be a second, independent copy of
  // the rules, and the copy diverged: it replayed the accepted history under
  // the strict rules, so the reducer demanded a post-approval state that
  // history never had and the migration died with AUTH_APPROVAL_REQUIRED.
  const before = readFileSync(paths.snapshot, "utf8");
  const derived = deriveLedgerProjection(paths);
  // M12/T9 F-414 (R9-T03-1): the migration just re-derived the projection
  // from the whole journal, so the checkpoint that described the PREVIOUS
  // derivation may not survive it. The reader's checkpoint writer is gated on
  // `!recompute`, and the migration derives in the recompute mode, so a
  // checkpoint that mis-anchors the journal (the F-408 shape) used to stay
  // behind even when the migration reported `changed:false` - and the next
  // read still sliced the journal mid-line. The checkpoint is DERIVED state
  // (the reader rebuilds it), so discarding it after a verified replay is
  // safe: the next read either resumes from a rebuilt one or replays whole.
  //
  // This runs on BOTH migration outcomes: `changed:false` reports that the
  // snapshot bytes already agree with the journal, not that the anchor beside
  // it does.
  discardCheckpoint(paths);
  const after = `${JSON.stringify(derived, null, 2)}\n`;
  if (after === before) {
    return {
      changed: false,
      sequence: derived.sequence,
      tasks: Object.keys(derived.tasks).length,
    };
  }
  writeSnapshotAtomic(paths, derived);
  return {
    changed: true,
    sequence: derived.sequence,
    tasks: Object.keys(derived.tasks).length,
  };
}

/**
 * M12/T9 F-160: derive the snapshot from the journal, with the reader's own
 * replay.
 *
 * The reader wraps every fault as "Ledger corruption", which is right for the
 * operator and wrong here: the migration must name the CAUSE (the chain
 * mismatch, the budget mismatch), so the operator knows what is wrong with the
 * record instead of being told the trusted state cannot be verified.
 */
function deriveLedgerProjection(paths) {
  try {
    return readSnapshotLocked(paths, false, null, { recompute: true });
  } catch (error) {
    throw error?.cause ?? error;
  }
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
    try {
      readSnapshotLocked(paths, false);
      return "CURRENT";
    } catch (error) {
      // M12/T9 F-160: the stored snapshot disagrees with the journal it is
      // derived from. That is a STALE DERIVATION, not corruption: the record
      // still verifies, and the apply recomputes the cache from it. So the
      // preflight recomputes the projection (read-only) and reports the
      // staleness; a record that does not verify still refuses the
      // deployment, exactly as before.
      if (!isStaleProjection(error)) throw error;
      const report = {};
      try {
        readSnapshotLocked(paths, false, report, { recompute: true });
      } catch {
        // The RECORD does not verify: the deployment is refused, and the
        // operator sees the fault the reader reported.
        throw error;
      }
      return report.projectionStale === true ? "CURRENT_STALE" : "CURRENT";
    }
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

/**
 * M12/T9 F-160: is this fault a stale DERIVATION rather than a broken record?
 *
 * The reader refuses a stored snapshot that disagrees with its journal with
 * "snapshot workflow mismatch" or "snapshot budget mismatch", and wraps every
 * fault as "Ledger corruption". Those two are a stale derivation; every other
 * fault (the chain, the digests, the budget of the journal itself) is
 * corruption, and it still refuses the deployment.
 *
 * The CONTRACT fault belongs to the stale derivation too, and only for the
 * STORED snapshot: an older build wrote it, so it does not have the current
 * shape - a different derivation is a different shape, and the migration
 * could not repair it.
 *
 * The contract fault on a JOURNAL EVENT is a different thing - the record
 * itself does not verify - and the recompute mode re-verifies the record, so
 * that case still refuses the deployment.
 */
function isStaleProjection(error) {
  let cause = error;
  for (let depth = 0; cause && depth < 4; depth += 1) {
    const message = String(cause?.message ?? "");
    if (
      message === "snapshot workflow mismatch" ||
      message === "snapshot budget mismatch"
    )
      return true;
    if (cause?.code === "SCHEMA_VALIDATION_FAILED") return true;
    cause = cause?.cause;
  }
  return false;
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
    // M12/T9 F-099: the checkpoint of an empty ledger describes an empty
    // anchored prefix.
    writeCheckpointAtomic(paths, {
      sequence: 0,
      last_event_digest: null,
      has_pre_verdict_stamp: false,
      events_offset: 0,
      prefix_digest: checkpointDigest(Buffer.alloc(0), {}),
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

/**
 * M12/T9 F-160: the ONE per-event projection.
 *
 * The reader and the forward migration both project the journal, and they used
 * to do it with two independent copies of the same rules. The copies drifted:
 * the migration replayed the ANCHORED history under the CURRENT rules, so the
 * reducer demanded a post-approval state the accepted history never had, and
 * the migration died with AUTH_APPROVAL_REQUIRED on a healthy ledger - the
 * drift was only visible on a live host.
 *
 * One function, two callers: the reader and the migration cannot disagree
 * about what an event means.
 *
 * `anchored` marks an event at or below the snapshot's head: operator-accepted
 * history, whose ADMISSION the replay trusts (its structure, its effects and
 * the end-state comparison still verify everything checkable). A tail event is
 * unaccepted and stays fully strict.
 */
function projectLedgerEvent(state, event, options = null) {
  const anchored = options?.anchored === true;
  if (event.type === "BUDGET_RESERVED") {
    const { task_id, kind, amount, counters } = event.payload;
    const budgeted = reserveBudget(state, task_id, kind, amount);
    if (
      BUDGET_FIELDS.some(
        (field) => counters?.[field] !== budgeted.tasks[task_id][field],
      )
    )
      throw new Error("journal budget mismatch");
    return budgeted;
  }
  // M12/T9 F-100: the audit-only types project nothing, so the anchored
  // region has the same defined behaviour as the tail.
  if (isAuditOnlyEvent(event.type)) return state;
  if (!event.type.startsWith("WORKFLOW_")) return state;
  return applyWorkflowEvent(
    state,
    event.type,
    event.payload,
    event.created_at,
    anchored
      ? {
          replayAnchored: true,
          preVerdictRootResult: options?.preVerdictRootResult === true,
        }
      : undefined,
  );
}

/**
 * M12/T9 F-160: the RECOMPUTE mode.
 *
 * The reader normally VERIFIES the stored snapshot against the journal and
 * refuses when the two disagree. The recompute mode instead DERIVES the
 * snapshot from the journal - the record is the authority, the snapshot is a
 * cache of it - and reports whether the stored one was stale.
 *
 * It is the mode the forward migration and the preflight use: a stale
 * DERIVATION is not corruption, and refusing it would make a ledger that is
 * perfectly readable after the recompute unreachable. A record that does not
 * verify still refuses, in this mode exactly as in the normal one.
 */
function readSnapshotLocked(
  paths,
  repairSnapshot = true,
  report = null,
  options = null,
) {
  const recompute = options?.recompute === true;
  if (repairSnapshot) ensureLedger(paths);
  else validateLedgerPaths(paths);
  try {
    let snapshot = JSON.parse(readFileSync(paths.snapshot, "utf8"));
    // M12/T9 F-377: the STALENESS verdict, decided in one place.
    let projectionStale = false;
    // M12/T9 F-160: in the recompute mode the STORED snapshot is NOT
    // validated against the current contract. It is the DERIVATION an older
    // build wrote, and a different derivation is a different SHAPE.
    //
    // M12/T9 F-377: that difference is reachable. The snapshot contract
    // itself changes (F-247 removed a member from it), so a snapshot an
    // older build wrote does not have the current shape - and the reader
    // refused it at the contract check, before the comparison even ran, so
    // the migration could not repair the very artefact it exists to repair
    // and the deploy could not complete.
    //
    // The RECORD is what must verify, and the record is the journal; the
    // current shape is what this replay produces.
    //
    // The verdict still says whether the stored one was stale: a snapshot that
    // does not have the current shape IS a stale derivation, and the report
    // says so.
    try {
      validateContract("ledger-snapshot", snapshot, Number.MAX_SAFE_INTEGER);
    } catch (error) {
      if (!recompute) throw error;
      projectionStale = true;
    }
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
    // M12/T9 F-099: the replay checkpoint. When it describes THIS snapshot and
    // still matches the journal, the anchored prefix is verified (its bytes
    // must chain to the digest the checkpoint recorded) and the replay starts
    // at the snapshot's own anchor, so the work scales with the UNANCHORED
    // tail instead of with the whole history. A checkpoint that does not
    // describe this snapshot, or that no longer matches the journal, is stale:
    // the full read below runs and the checkpoint is rewritten.
    // M12/T9 F-160: the recompute mode replays the WHOLE journal - the
    // anchored prefix included - because the anchored projection is exactly what
    // it recomputes. A checkpoint skips that prefix, so it is not read here.
    const checkpoint = recompute ? null : readCheckpoint(paths);
    const checkpointed =
      checkpoint &&
      checkpoint.sequence === snapshot.sequence &&
      checkpoint.last_event_digest === snapshot.last_event_digest
        ? readCheckpointedTail(paths, checkpoint, snapshot)
        : null;
    // The journal's lines, and the byte offset of the end of each one.
    let journalLines = [];
    let journalLineEnds = [];
    let previous = null;
    let lastSequence = 0;
    let journalHasPreVerdictStamp = false;
    if (checkpointed) {
      journalLines = checkpointed.lines;
      journalLineEnds = checkpointed.ends;
      previous = snapshot.last_event_digest;
      lastSequence = snapshot.sequence;
      journalHasPreVerdictStamp = checkpoint.has_pre_verdict_stamp;
    } else {
      const buffer = readFileSync(paths.events);
      const split = splitJournalLines(buffer);
      journalLines = split.lines;
      journalLineEnds = split.ends;
    }
    // F-143: a torn tail. The writer appends AND fsyncs the event BEFORE the
    // snapshot that anchors it, so a partially written FINAL line provably has
    // no snapshot anchor: it was never acknowledged, never projected, and can
    // be dropped instead of making every read and every write fail forever.
    // A damaged line anywhere else is real corruption and still throws, and a
    // damaged FINAL line the snapshot DID anchor is real corruption too — the
    // snapshot proves the event existed, so dropping it would silently lose
    // acknowledged history.
    //
    // M12/T9 F-099: with the checkpoint in play the journal's lines are the
    // TAIL only, and every one of them is beyond the anchor.
    const parsed = parseJournalEvents(
      journalLines,
      checkpointed ? true : journalLines.length > snapshot.sequence,
    );
    const events = parsed.events;
    const tornTailBytes = parsed.tornTailBytes;
    if (tornTailBytes > 0) {
      // The dropped remainder is REPORTED, never silently swallowed: the byte
      // count is a measurement, the content is untrusted ledger data and is
      // deliberately not logged.
      console.error(
        "[zink-ledger] torn journal tail dropped:",
        `JOURNAL_TORN_TAIL bytes=${tornTailBytes}`,
      );
    }
    const tail = [];
    // M12/T9 F-099: with the checkpoint in play the anchored projection is
    // the SNAPSHOT's own tasks - the anchored prefix is not replayed, it is
    // VERIFIED - so the budget counters and the workflow states of the
    // anchored region are taken from the snapshot the checkpoint describes.
    let journalBudget = checkpointed
      ? { tasks: globalThis.structuredClone(snapshot.tasks) }
      : { tasks: {} };
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
    // M12/T9 F-160: the pre-verdict stamps are declared ONCE, at the module
    // level, so the reader and the checkpoint's era declaration cannot drift.
    // M12/T9 F-160: the writer semantics are SEALED IN THE EVENT.
    //
    // Two stamps are unambiguous. A pre-verdict stamp names a pre-verdict
    // writer, so the event is replayed under the pre-verdict model; the current
    // stamp names the current writer, so the event is replayed under the
    // verdict model. The third, `m8-t2.2-r4`, was emitted by BOTH writers, so
    // the stamp alone cannot say which model wrote the event.
    //
    // It used to be resolved by the JOURNAL's scope: a journal carrying any
    // pre-verdict stamp re-resolved EVERY r4 event as pre-verdict. That made
    // the semantics of one event depend on which OTHER events happened to sit
    // in the same file, so deleting one legacy line - compaction, tail surgery,
    // a mixed backup restore - silently re-resolved the governance history of
    // every other event, and the reader then died on `snapshot workflow
    // mismatch` or re-resolved a root result.
    //
    // The owner's ruling (2026-10-21) is that the r4 stamp is a VERDICT
    // stamp: an r4 event is classified as a verdict in EVERY path, so the
    // classification of an event depends on that event alone. A journal that
    // PREDATES the verdict model still resolves as pre-verdict, because its
    // own events carry a pre-verdict stamp: the era is declared per event
    // instead of per journal, and the journal-scope discriminator is gone.
    const preVerdictForEvent = (event) =>
      PRE_VERDICT_VERSIONS.has(event.governance_version);
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
      // M12/T9 F-063 with F-099: a fork AT THE ANCHOR. The checkpoint's byte
      // offset skips the anchored prefix, so the anchor's twin - a tail event
      // carrying the anchor's OWN sequence - is the only visible half of the
      // pair. The anchor the snapshot sealed is the survivor; the twin is the
      // branch the journal did not continue on, so it is DISCARDED and
      // REPORTED, exactly like any other branch. Without this the reader
      // meets a sequence it already verified and refuses with a bare
      // "event chain mismatch".
      if (
        checkpointed &&
        event.sequence === snapshot.sequence &&
        typeof snapshot.last_event_digest === "string" &&
        event.event_digest !== snapshot.last_event_digest
      ) {
        discardedBranches.push({
          sequence: event.sequence,
          event_digest,
          type: event.type,
          created_at: event.created_at,
        });
        console.error(
          "[zink-ledger] forked branch discarded:",
          `LEDGER_FORK_DISCARDED count=1 sequences=[${event.sequence}]`,
        );
        continue;
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
      // M12/T9 F-160: the projection is the SHARED one, so the reader and the
      // forward migration cannot drift apart.
      //
      // Option (b) migration 2026-09-29: events at or below the snapshot
      // head are operator-accepted history - replay trusts their admission
      // (structure, effects, and the end-state hash compare below still
      // verify everything checkable) and reproduces the transitions the
      // deployed build performed. Events beyond the head are unaccepted tail
      // and stay fully strict. The flag MUST never be set for tail: admission
      // policy is enforced at write time, and re-reads must not re-litigate it.
      journalBudget = projectLedgerEvent(journalBudget, event, {
        anchored: hasAnchoredHead && event.sequence <= snapshot.sequence,
        preVerdictRootResult: preVerdictForEvent(event),
      });
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
    // M12/T9 F-160: in the recompute mode a disagreement is not a fault, it is
    // the FINDING: the stored snapshot is a stale DERIVATION of a record that
    // verifies. The normal mode still refuses it.
    if (recompute) {
      // A task the journal does not describe is NOT a stale derivation: it is
      // governance history the record lost. Recomputing it away would destroy
      // it, so the recompute refuses instead of repairing it.
      const lost = Object.keys(snapshot.tasks).filter(
        (taskId) => !anchoredBudget[taskId],
      );
      if (lost.length > 0)
        throw new Error("snapshot task missing from journal");
    }
    for (const taskId of new Set([
      ...Object.keys(anchoredBudget),
      ...Object.keys(snapshot.tasks),
    ])) {
      const expected = anchoredBudget[taskId] ?? INITIAL_BUDGET;
      if (
        BUDGET_FIELDS.some(
          (field) => snapshot.tasks[taskId]?.[field] !== expected[field],
        )
      ) {
        if (!recompute) throw new Error("snapshot budget mismatch");
        projectionStale = true;
      }
      if (
        expected.workflow_status &&
        canonicalHash("zink-ledger-event-v1", expected) !==
          canonicalHash("zink-ledger-event-v1", snapshot.tasks[taskId])
      ) {
        if (!recompute) throw new Error("snapshot workflow mismatch");
        projectionStale = true;
      }
    }
    if (report) report.projectionStale = projectionStale;
    // M12/T9 F-160: the recompute mode replaces the STORED anchored
    // projection with the REPLAYED one - that is the whole point of it - and
    // the tail is then applied to it exactly as the reader applies the tail to
    // the stored snapshot. The ANCHOR does not move: the derived snapshot
    // still describes the same anchor, so the reader's next read reproduces
    // it instead of disagreeing with it.
    if (recompute) {
      // M12/T9 F-377: the derived snapshot is a CURRENT-shaped artefact. The
      // stored one is an older build's derivation, so its shape is not carried
      // forward - but its ANCHOR is: the derived snapshot still describes the
      // same head, so the reader's next read reproduces it instead of
      // disagreeing with it.
      //
      // The anchor's own fields are carried forward only when they are
      // well-typed, so a derived artefact cannot inherit a value the current
      // contract would refuse.
      snapshot = {
        ...emptySnapshot(),
        ingress_ids: Array.isArray(snapshot.ingress_ids)
          ? snapshot.ingress_ids
          : [],
        sequence: snapshot.sequence,
        last_event_digest:
          typeof snapshot.last_event_digest === "string"
            ? snapshot.last_event_digest
            : null,
        updated_at:
          typeof snapshot.updated_at === "string"
            ? snapshot.updated_at
            : utcNow(),
        tasks: anchoredBudget,
      };
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
    if (tail.length > 0 && repairSnapshot && !recompute)
      writeSnapshotAtomic(paths, snapshot);
    // M12/T9 F-099: the checkpoint for the anchor the snapshot describes.
    //
    // The chain covers the ANCHORED PREFIX only, so a checkpoint always
    // describes exactly the prefix the snapshot sealed. A checkpoint that did
    // not describe this journal is rebuilt here; one that did is extended
    // with the tail the replay just recovered. The era flag is derived from
    // the event stream - the whole stream in a full read, the checkpoint's own
    // declaration plus the tail in a checkpointed one - so the era a journal
    // declares survives the anchored prefix it is no longer replayed from.
    const eraFlag =
      journalHasPreVerdictStamp ||
      events.some((event) =>
        PRE_VERDICT_VERSIONS.has(event.governance_version),
      );
    if (!recompute && (!checkpointed || (tail.length > 0 && repairSnapshot))) {
      // The anchored prefix's bytes, and the offset where they end.
      //
      // M12/T9 F-408 (R9-L02-4): `journalLineEnds` are byte offsets into the
      // buffer they were split from. A checkpointed read splits the TAIL, so
      // those ends are relative to `checkpoint.events_offset`; adding the
      // checkpoint's own offset back makes the anchor absolute. The digest
      // below then seals exactly the bytes up to that absolute offset - the
      // same bytes `readCheckpointedTail` verifies on the next read. Storing
      // the tail-relative end made the record self-consistent but sliced the
      // journal mid-line on the next read.
      const buffer = readFileSync(paths.events);
      const baseOffset = checkpointed ? checkpoint.events_offset : 0;
      const anchoredCount = Math.min(journalLines.length, snapshot.sequence);
      const offset =
        anchoredCount > 0
          ? baseOffset + journalLineEnds[anchoredCount - 1]
          : baseOffset;
      writeCheckpointAtomic(paths, {
        sequence: snapshot.sequence,
        last_event_digest: snapshot.last_event_digest,
        has_pre_verdict_stamp: eraFlag,
        events_offset: offset,
        prefix_digest: checkpointDigest(
          buffer.subarray(0, offset),
          snapshot.tasks,
        ),
      });
    }
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
  // M12/T9 F-099: the checkpoint for the anchor this append creates. The
  // anchored prefix grows by exactly one line and the snapshot's task states
  // change with it, so the seal is recomputed over the journal as it now
  // stands. A checkpoint that does not describe the journal (a ledger that
  // predates it, or one whose checkpoint was lost) is replaced by this one.
  const preAppendSize = journalFileSize(paths.events);
  const previousCheckpoint = readCheckpoint(paths);
  let eraFlag = previousCheckpoint?.has_pre_verdict_stamp ?? false;
  if (!previousCheckpoint) {
    // The era of a journal that has no checkpoint: derived from the event
    // stream, which is the only place it is declared.
    eraFlag = splitJournalLines(readFileSync(paths.events)).lines.some(
      (journalLine) => PRE_VERDICT_STAMP_PATTERN.test(journalLine),
    );
  }
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
  // The checkpoint is written WITH the snapshot: the snapshot first, so a
  // crash between the two leaves a checkpoint that is stale (and therefore
  // ignored) rather than one that outlives its state.
  const journalBytes = readFileSync(paths.events);
  writeCheckpointAtomic(paths, {
    sequence: next.sequence,
    last_event_digest: next.last_event_digest,
    has_pre_verdict_stamp: eraFlag,
    events_offset: preAppendSize + Buffer.byteLength(line, "utf8"),
    prefix_digest: checkpointDigest(journalBytes, next.tasks),
  });
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
