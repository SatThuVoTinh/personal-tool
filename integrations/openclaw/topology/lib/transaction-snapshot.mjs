// M8/T2.2-R11 — transaction-scoped pre-mutation runtime snapshot.
//
// R11 replaces two false assumptions in the live apply path.
//
//   1. Rollback restores the historical r12/T1 BASELINE. Proven wrong. The
//      wired target was `backups/r12/t1-config.json`, captured 2026-09-11, and
//      `native-r12`, which holds clean upstream preimages. Restoring it installs
//      a superseded config, quarantines the governance extension and DE-PATCHES
//      the native runtime.
//
//   2. A returning restore means the runtime came back. Proven wrong.
//      `rollbackSucceeded` was set purely because the restore helpers returned,
//      so a restore to the WRONG state reported success.
//
// This module is the smallest sound correction. A snapshot captures, in memory
// and read-only, the exact live files the apply can mutate, taken BEFORE the
// first mutating call. Rollback rewrites exactly those files, and success is
// claimed only after the live bytes are compared back against the snapshot.
//
// Deliberate design choices:
//
//   * The snapshot NEVER references `backups/r12` or `native-r12`. The r12
//     baseline stays untouched as historical recovery evidence.
//   * `config validate` is not sufficient verification. It accepts any config
//     the current policy recognises, including a superseded baseline, so it
//     cannot detect a wrong-but-valid restore. Byte comparison against the
//     snapshot can.
//   * The snapshot is verified by re-hashing every body it holds, so a tampered
//     or truncated snapshot is rejected before it is used to restore anything.
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Reported when the apply could not establish a rollback target. Distinct from
 * an apply failure: nothing was attempted, and the snapshot problem must be
 * resolved before any mutation is possible.
 */
export const ROLLBACK_SAFETY_UNAVAILABLE = "ROLLBACK_SAFETY_UNAVAILABLE";

/** Reported when a restore completed but the live bytes do not match. */
export const RESTORE_UNVERIFIED = "TRANSACTION_RESTORE_UNVERIFIED";

/**
 * Every live path the apply can mutate and rollback must restore, relative to
 * the state directory or the OpenClaw runtime root. Both roots are snapshotted
 * so a partial-root apply is still reversible.
 */
export const SNAPSHOT_TARGETS = Object.freeze({
  state: Object.freeze([
    "openclaw.json",
    "extensions/zink-governance/index.mjs",
    "extensions/zink-governance/package.json",
    "extensions/zink-governance/openclaw.plugin.json",
    "extensions/zink-governance/governance-manifests.json",
  ]),
  runtime: Object.freeze([
    "dist/selection-DopzNY3I.js",
    "dist/subagent-announce-Bh1QyKiE.js",
    "dist/zink-governance-boundary.mjs",
  ]),
});

const digest = (body) => createHash("sha256").update(body).digest("hex");

/** Reject symlinked path components: a snapshot must not traverse a link. */
function noLinks(target) {
  for (
    let cursor = path.resolve(target);
    cursor !== path.dirname(cursor);
    cursor = path.dirname(cursor)
  ) {
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat?.isSymbolicLink())
      throw new Error("TRANSACTION_SNAPSHOT_SYMLINK_DENIED");
  }
}

/**
 * Discover the governance extension's files rather than trusting a fixed list, so
 * a newly added asset cannot silently escape the snapshot. An irregular entry is
 * a hard error, never a silently skipped component.
 */
function discoverExtensionAssets(extensionRoot) {
  if (!existsSync(extensionRoot)) return [];
  const found = [];
  const visit = (relative) => {
    for (const name of readdirSync(path.join(extensionRoot, relative))) {
      const child = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(path.join(extensionRoot, child));
      if (stat.isSymbolicLink())
        throw new Error("TRANSACTION_SNAPSHOT_SYMLINK_DENIED");
      if (stat.isDirectory()) visit(child);
      else if (stat.isFile()) found.push(`extensions/zink-governance/${child}`);
      else throw new Error("TRANSACTION_SNAPSHOT_TARGET_NOT_REGULAR");
    }
  };
  visit("");
  return found.sort();
}

/** Which root a recorded relative path belongs to. */
function rootForRelative(relative) {
  return SNAPSHOT_TARGETS.state.includes(relative) ||
    relative.startsWith("extensions/zink-governance/")
    ? "stateDir"
    : "runtimeRoot";
}

/**
 * Resolve a recorded path against the roots it was captured from, refusing any
 * path that would escape its root.
 */
function resolveRelative(snapshot, relative) {
  const base = path.resolve(snapshot[rootForRelative(relative)]);
  const absolute = path.resolve(base, relative);
  if (absolute !== base && !absolute.startsWith(base + path.sep))
    throw new Error("TRANSACTION_SNAPSHOT_TARGET_MISMATCH");
  return absolute;
}

function rootsFrom(snapshot) {
  if (!snapshot?.stateDir || !snapshot?.runtimeRoot)
    throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
  return { stateDir: snapshot.stateDir, runtimeRoot: snapshot.runtimeRoot };
}

/**
 * Capture the exact live runtime state. Read-only: nothing is written, moved or
 * removed. An absent component is recorded as `existed: false`, so a restore can
 * remove a file the apply created.
 */
export function createTransactionSnapshot(roots) {
  const { stateDir, runtimeRoot } = roots ?? {};
  if (!stateDir || !runtimeRoot)
    throw new Error("TRANSACTION_SNAPSHOT_NO_ROOTS");
  for (const root of [stateDir, runtimeRoot]) noLinks(root);

  const fixed = [
    ...SNAPSHOT_TARGETS.state.map((relative) => ({ relative, root: stateDir })),
    ...SNAPSHOT_TARGETS.runtime.map((relative) => ({
      relative,
      root: runtimeRoot,
    })),
  ];
  const discovered = discoverExtensionAssets(
    path.join(stateDir, "extensions", "zink-governance"),
  ).map((relative) => ({ relative, root: stateDir }));

  const files = {};
  for (const { relative, root } of [...fixed, ...discovered]) {
    const absolute = path.join(root, relative);
    noLinks(absolute);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) {
      files[relative] = {
        existed: false,
        sha256: null,
        mode: null,
        body: null,
      };
      continue;
    }
    if (!stat.isFile())
      throw new Error("TRANSACTION_SNAPSHOT_TARGET_NOT_REGULAR");
    const body = readFileSync(absolute);
    files[relative] = {
      existed: true,
      sha256: digest(body),
      mode: stat.mode & 0o777,
      body: body.toString("utf8"),
    };
  }

  const snapshot = {
    schema: "zink-transaction-snapshot/1",
    stateDir: path.resolve(stateDir),
    runtimeRoot: path.resolve(runtimeRoot),
    files,
  };
  // Never hand back a snapshot that cannot already be trusted.
  verifyTransactionSnapshot(snapshot);
  return snapshot;
}

/**
 * Prove the snapshot is internally consistent and independently re-readable.
 * Every recorded body must re-hash to its recorded digest and carry a sane mode.
 * A tampered or truncated snapshot is rejected here, before it can restore
 * anything.
 */
export function verifyTransactionSnapshot(snapshot) {
  if (!snapshot || snapshot.schema !== "zink-transaction-snapshot/1")
    throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
  if (!snapshot.files || typeof snapshot.files !== "object")
    throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
  for (const entry of Object.values(snapshot.files)) {
    if (!entry || typeof entry.existed !== "boolean")
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    if (!entry.existed) continue;
    if (!/^[a-f0-9]{64}$/u.test(entry.sha256 ?? ""))
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    if (typeof entry.body !== "string")
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    if (digest(entry.body) !== entry.sha256)
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    if (!Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777)
      throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
  }
  return { verified: true, fileCount: Object.keys(snapshot.files).length };
}

/**
 * Rewrite the live runtime to the snapshot's preimage.
 *
 * Every target is validated BEFORE anything is written, so a conflict cannot
 * leave the runtime half-restored. A component the apply created (absent in the
 * snapshot) is removed; a component the apply replaced is rewritten byte-exactly
 * with its recorded mode.
 */
export function restoreTransactionSnapshot(snapshot) {
  const { stateDir, runtimeRoot } = rootsFrom(snapshot);
  verifyTransactionSnapshot(snapshot);

  const plan = [];
  for (const [relative, entry] of Object.entries(snapshot.files)) {
    const absolute = resolveRelative(snapshot, relative);
    noLinks(absolute);
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (entry.existed) {
      if (!stat || !stat.isFile())
        throw new Error("TRANSACTION_RESTORE_TARGET_MISSING");
      plan.push({ absolute, entry, remove: false });
    } else if (stat) {
      // The apply created this component; its preimage is "absent".
      plan.push({ absolute, entry, remove: true });
    }
  }

  for (const { absolute } of plan)
    if (!existsSync(path.dirname(absolute)))
      throw new Error("TRANSACTION_RESTORE_TARGET_MISSING");

  for (const { absolute, entry, remove } of plan) {
    if (remove) {
      rmSync(absolute, { force: true });
      continue;
    }
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, entry.body, "utf8");
    chmodSync(absolute, entry.mode);
  }
  return {
    restored: true,
    roots: { stateDir, runtimeRoot },
    fileCount: plan.length,
  };
}

/**
 * Compare the live runtime against the snapshot. This is the only thing that may
 * license `rollbackSucceeded = true`.
 *
 * Byte identity is the contract for every component the snapshot recorded, so a
 * mismatch is reported by path. A caller may layer semantic health checks on top;
 * this function does not guess at health.
 */
/**
 * Compare the live runtime against the snapshot. This is the only thing that may
 * license `rollbackSucceeded = true`, and — with `options.postApply` — the only
 * thing that may license a successful apply either.
 *
 * Byte identity is the contract for every component the snapshot recorded, so a
 * mismatch is reported by path. A caller may layer semantic health checks on top;
 * this function does not guess at health.
 *
 * `options.postApply` inverts the question. After a rollback the live bytes must
 * EQUAL the snapshot; after an apply they must DIFFER from it, because a
 * successful apply changed the runtime. Both are byte comparisons against the
 * same preimage, which is why one implementation can serve both.
 */
export function verifyLiveRestore(roots, snapshot, options = {}) {
  void roots;
  verifyTransactionSnapshot(snapshot);
  const mismatches = [];
  for (const [relative, entry] of Object.entries(snapshot.files)) {
    let stat;
    try {
      const absolute = resolveRelative(snapshot, relative);
      noLinks(absolute);
      stat = lstatSync(absolute, { throwIfNoEntry: false });
    } catch {
      mismatches.push(relative);
      continue;
    }
    if (!entry.existed) {
      // The preimage is absent, so its presence now is a mismatch.
      if (stat) mismatches.push(relative);
      continue;
    }
    if (!stat || !stat.isFile()) {
      mismatches.push(relative);
      continue;
    }
    if (
      digest(readFileSync(resolveRelative(snapshot, relative))) !== entry.sha256
    )
      mismatches.push(relative);
  }
  // A component whose bytes still equal the preimage was NOT changed by the
  // apply, so a self-reported success that left it untouched is unproven.
  const unchanged = mismatches.length === 0;
  if (options.postApply)
    return {
      applied: !unchanged,
      unrestored: mismatches.sort(),
      checked: Object.keys(snapshot.files).length,
    };
  return {
    restored: unchanged,
    mismatches: mismatches.sort(),
    checked: Object.keys(snapshot.files).length,
  };
}

// ---------------------------------------------------------------------------
// R12 — durable transaction persistence.
//
// R11's snapshot lives in memory, which is enough for a synchronous failure the
// orchestrator survives. It is not enough if the apply process disappears after
// mutation begins: there is then no recovery target and no record that a
// mutation was in progress, so the next apply cannot distinguish a clean runtime
// from a half-mutated one.
//
// These operations persist the same preimage to a dedicated transaction-state
// directory under the operator state area, bind the record to the snapshot
// bytes, and let a later process detect a transaction that started but never
// completed. An orphan is reported and requires an explicit recovery decision:
// it is never silently deleted, resumed, or rolled back.
// ---------------------------------------------------------------------------

/** Lifecycle states a durable transaction can hold. */
export const TRANSACTION_STATUS = Object.freeze({
  STARTED: "started",
  COMPLETE: "complete",
});

/** Reported when an unfinished transaction blocks a new apply. */
export const ORPHANED_TRANSACTION = "ORPHANED_TRANSACTION";

/** Reported when durable transaction state cannot be established. */
export const DURABILITY_UNAVAILABLE = "TRANSACTION_DURABILITY_UNAVAILABLE";

const TRANSACTION_ROOT = "transactions";
const RECORD_NAME = "transaction.json";
const PREIMAGE_DIR = "preimage";
const RECORD_SCHEMA = "zink-transaction-record/1";
const TRANSACTION_ID = /^txn-[a-f0-9]{32}$/u;

/**
 * The transaction-state directory. Never `backups/r12` and never `native-r12`:
 * both are historical recovery evidence, and a transaction must not be able to
 * overwrite or be confused with either.
 */
export function transactionRoot(stateDir) {
  const root = path.join(stateDir, "operator", "m7-t2", TRANSACTION_ROOT);
  noLinks(root);
  return root;
}

function syncDirectory(directory) {
  let fd;
  try {
    fd = openSync(directory, "r");
    fsyncSync(fd);
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !["EPERM", "EISDIR", "EINVAL", "ENOTSUP"].includes(error.code)
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function writeExclusiveFile(file, body, mode = 0o600) {
  noLinks(file);
  const fd = openSync(file, "wx", mode);
  try {
    writeFileSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  syncDirectory(path.dirname(file));
}

/**
 * A transaction ID that is also the directory name, so a record and its
 * snapshot can never be separated.
 *
 * Derived from the preimage itself rather than a clock or counter, so the same
 * pre-apply runtime always yields the same ID. That matters for recovery: an
 * operator reading a transaction ID can be certain it names one specific
 * preimage and nothing else.
 */
function deriveTransactionId(snapshot) {
  const binding = Object.entries(snapshot.files)
    .map(
      ([relative, entry]) =>
        `${relative}:${entry.existed ? entry.sha256 : "absent"}`,
    )
    .sort()
    .join("\n");
  return `txn-${digest(binding).slice(0, 32)}`;
}

/** Integrity binding over the record's own content, excluding the binding. */
function manifestDigest(record) {
  const content = { ...record };
  delete content.manifestDigest;
  return digest(JSON.stringify(content));
}

/**
 * Persist the snapshot durably and record the transaction as `started`.
 *
 * Written `0o600` inside a `0o700` directory, exclusively, so an existing
 * transaction is never silently replaced. Only the preimage files required for
 * an exact restore are written: no secrets beyond those, no unrelated
 * filesystem content, and no broad recursive system snapshot.
 *
 * The record is read back and verified before returning, so persistence is
 * proven rather than assumed. A snapshot that cannot be re-read must never be
 * allowed to authorize mutation.
 */
export function persistTransactionSnapshot(stateDir, snapshot, { createdAt }) {
  verifyTransactionSnapshot(snapshot);
  if (typeof createdAt !== "string" || !createdAt)
    throw new Error("TRANSACTION_TIMESTAMP_REQUIRED");

  const root = transactionRoot(stateDir);
  const id = deriveTransactionId(snapshot);
  // The ID is hash-derived, never caller text, so it cannot traverse. Asserted
  // anyway: this is the recovery path, and recovery must fail closed.
  if (!TRANSACTION_ID.test(id) || path.basename(id) !== id)
    throw new Error("TRANSACTION_ID_INVALID");

  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
  }
  const directory = path.join(root, id);
  if (existsSync(directory))
    // Never silently replace a transaction. A leftover directory is an orphan
    // the caller must resolve with an explicit recovery decision.
    throw new Error("TRANSACTION_ALREADY_EXISTS");
  mkdirSync(directory, { mode: 0o700 });
  chmodSync(directory, 0o700);

  const files = {};
  for (const [relative, entry] of Object.entries(snapshot.files)) {
    if (!entry.existed) {
      files[relative] = { existed: false, sha256: null, mode: null };
      continue;
    }
    // The on-disk layout mirrors the recorded relative path, so a restore reads
    // exactly what the record names. Traversal is impossible by construction and
    // is refused again on the way back out.
    const target = path.join(directory, PREIMAGE_DIR, relative);
    noLinks(target);
    mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    writeExclusiveFile(target, entry.body, 0o600);
    files[relative] = { existed: true, sha256: entry.sha256, mode: entry.mode };
  }
  syncDirectory(path.join(directory, PREIMAGE_DIR));

  const record = {
    schema: RECORD_SCHEMA,
    transactionId: id,
    createdAt,
    status: TRANSACTION_STATUS.STARTED,
    snapshotPath: PREIMAGE_DIR,
    stateDir: snapshot.stateDir,
    runtimeRoot: snapshot.runtimeRoot,
    files,
  };
  record.manifestDigest = manifestDigest(record);
  writeExclusiveFile(
    path.join(directory, RECORD_NAME),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  const loaded = loadTransaction(stateDir, id);
  if (loaded.status !== TRANSACTION_STATUS.STARTED)
    throw new Error("TRANSACTION_RECORD_INVALID");
  return loaded;
}

/**
 * Load and verify a persisted transaction.
 *
 * The manifest integrity binding is checked first, then every preimage file is
 * re-hashed against the record, so a corrupted snapshot is refused before it
 * can restore anything. A record whose file list is internally inconsistent is
 * rejected rather than partially trusted.
 */
export function loadTransaction(stateDir, id) {
  if (!TRANSACTION_ID.test(id) || path.basename(id) !== id)
    throw new Error("TRANSACTION_ID_INVALID");
  const root = transactionRoot(stateDir);
  const directory = path.join(root, id);
  noLinks(directory);
  const recordPath = path.join(directory, RECORD_NAME);
  noLinks(recordPath);
  if (!existsSync(recordPath)) throw new Error("TRANSACTION_NOT_FOUND");

  const stat = lstatSync(recordPath);
  if (!stat.isFile()) throw new Error("TRANSACTION_RECORD_INVALID");
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
    throw new Error("TRANSACTION_PERMISSION_MISMATCH");

  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (
    record.schema !== RECORD_SCHEMA ||
    record.transactionId !== id ||
    !Object.values(TRANSACTION_STATUS).includes(record.status) ||
    typeof record.createdAt !== "string" ||
    record.snapshotPath !== PREIMAGE_DIR ||
    typeof record.manifestDigest !== "string" ||
    manifestDigest(record) !== record.manifestDigest
  )
    throw new Error("TRANSACTION_MANIFEST_INTEGRITY_FAILED");

  const preimageRoot = path.join(directory, record.snapshotPath);
  const snapshot = {
    schema: "zink-transaction-snapshot/1",
    stateDir: record.stateDir,
    runtimeRoot: record.runtimeRoot,
    files: {},
  };
  for (const [relative, entry] of Object.entries(record.files)) {
    if (!entry || typeof entry.existed !== "boolean")
      throw new Error("TRANSACTION_MANIFEST_INTEGRITY_FAILED");
    if (!entry.existed) {
      snapshot.files[relative] = {
        existed: false,
        sha256: null,
        mode: null,
        body: null,
      };
      continue;
    }
    // Resolves against the recorded root and refuses anything that escapes it.
    resolveRelative(snapshot, relative);
    const file = path.join(preimageRoot, relative);
    if (file !== preimageRoot && !file.startsWith(preimageRoot + path.sep))
      throw new Error("TRANSACTION_SNAPSHOT_TARGET_MISMATCH");
    noLinks(file);
    if (!existsSync(file)) throw new Error("TRANSACTION_SNAPSHOT_INCOMPLETE");
    const body = readFileSync(file, "utf8");
    if (digest(body) !== entry.sha256)
      throw new Error("TRANSACTION_SNAPSHOT_DIGEST_MISMATCH");
    snapshot.files[relative] = {
      existed: true,
      sha256: entry.sha256,
      mode: entry.mode,
      body,
    };
  }
  verifyTransactionSnapshot(snapshot);
  return { ...record, snapshot };
}

/**
 * Mark a transaction complete.
 *
 * The preimage is RETAINED, not deleted. The repository has no retention policy
 * for transaction state yet, and silently removing a recovery target is exactly
 * the class of behaviour R11 and R12 exist to prevent. Retention is a later
 * owner decision, not something to assume here.
 */
export function markTransactionComplete(stateDir, id) {
  const recordPath = path.join(transactionRoot(stateDir), id, RECORD_NAME);
  noLinks(recordPath);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.transactionId !== id)
    throw new Error("TRANSACTION_RECORD_INVALID");
  if (manifestDigest(record) !== record.manifestDigest)
    throw new Error("TRANSACTION_MANIFEST_INTEGRITY_FAILED");
  const completed = { ...record, status: TRANSACTION_STATUS.COMPLETE };
  completed.manifestDigest = manifestDigest(completed);
  writeFileSync(recordPath, `${JSON.stringify(completed, null, 2)}\n`, {
    mode: 0o600,
  });
  syncDirectory(path.dirname(recordPath));
  return completed;
}

/**
 * Find a transaction that started but never completed.
 *
 * This is the crash detector. It only reads: it never deletes, resumes or rolls
 * anything back. A found orphan is the caller's signal to refuse and to ask for
 * an explicit recovery decision, so a crash cannot produce an ambiguous second
 * deployment.
 */
export function findOrphanedTransaction(stateDir) {
  const root = transactionRoot(stateDir);
  if (!existsSync(root)) return [];
  const orphans = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !TRANSACTION_ID.test(entry.name)) continue;
    let record;
    try {
      record = loadTransaction(stateDir, entry.name);
    } catch {
      // An unreadable transaction directory is itself unresolved state. Report
      // it by ID so the operator can see it, rather than treating it as absent.
      orphans.push({
        transactionId: entry.name,
        status: "unreadable",
        createdAt: null,
        reason: "TRANSACTION_RECORD_UNREADABLE",
      });
      continue;
    }
    if (record.status === TRANSACTION_STATUS.STARTED)
      orphans.push({
        transactionId: record.transactionId,
        status: record.status,
        createdAt: record.createdAt,
        reason: ORPHANED_TRANSACTION,
      });
  }
  return orphans.sort((left, right) =>
    left.transactionId.localeCompare(right.transactionId),
  );
}
