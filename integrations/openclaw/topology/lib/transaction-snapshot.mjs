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
import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
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
import {
  NATIVE_DISCORD_CHANNEL_AMBIGUOUS,
  nativePatchedDiscordChannelRelatives,
  nativePatchedRuntimeRelatives,
  resolveNativeDiscordChannelRelative,
} from "./native-patch.mjs";

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
 *
 * M10/T2-R8: the runtime list is DERIVED from the native patch pins (plus the
 * bridge) instead of being a hand-maintained list. The hand-maintained list
 * named three files while the patch writes four, so the Discord preflight
 * file was mutated outside transaction tracking: runtime-verify could not see
 * the only changed component and the rollback reported success with that
 * component still mutated. Deriving from the pins makes "mutated but
 * untracked" structurally impossible.
 */
export const SNAPSHOT_TARGETS = Object.freeze({
  state: Object.freeze([
    "openclaw.json",
    "extensions/zink-governance/index.mjs",
    "extensions/zink-governance/package.json",
    "extensions/zink-governance/openclaw.plugin.json",
    "extensions/zink-governance/governance-manifests.json",
    // M12/T9 F-106: the builder's apply branch writes these four, so they are
    // mutated surfaces of the apply. The preimage did not record them, so a
    // failed apply reported `rollbackSucceeded: true` while the resolver, the
    // hotfix utility and the two auth plans stayed at the NEW revision: the
    // rollback compared only the bytes it had captured.
    "zink-auth-secret-plan.json",
    "zink-auth-order-plan.json",
    "bin/openclaw-pass-resolver",
    "bin/openclaw-gemini-stream-hotfix.mjs",
  ]),
  runtime: nativePatchedRuntimeRelatives(),
  // M10/T2-R8: the patched Discord preflight lives in the INSTALLED CHANNEL
  // PLUGIN package, which is inside the state directory, so these are extra
  // state-relative targets rather than a third governed root. Without them the
  // only file the ingress repair actually rewrites was outside transaction
  // tracking — the same "mutated but untracked" hole the derived runtime list
  // was introduced to close, one tree over.
  discordChannel: nativePatchedDiscordChannelRelatives(),
  // M12/T9 F-106: the unit drop-in is the third governed root.
  //
  // The builder writes `~/.config/systemd/user/<unit>.service.d/10-zink.conf`
  // in its apply branch, and that path is in NEITHER the state directory nor
  // the OpenClaw runtime root, so a two-root preimage could not hold it at
  // all: the drop-in was rewritten by every apply and restored by none, and
  // the rollback reported success while the unit still carried the new
  // revision. The drop-in is therefore a target of its own root, named by the
  // caller that owns it.
  systemd: Object.freeze(["openclaw-gateway-zink.service.d/10-zink.conf"]),
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
function listFilesRecursively(root, relative = "") {
  const found = [];
  for (const name of readdirSync(path.join(root, relative))) {
    const child = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(path.join(root, child));
    if (stat.isSymbolicLink())
      throw new Error("TRANSACTION_SNAPSHOT_SYMLINK_DENIED");
    if (stat.isDirectory()) found.push(...listFilesRecursively(root, child));
    else if (stat.isFile()) found.push(child);
    else throw new Error("TRANSACTION_SNAPSHOT_TARGET_NOT_REGULAR");
  }
  return found.sort();
}

function discoverExtensionAssets(extensionRoot) {
  if (!existsSync(extensionRoot)) return [];
  return listFilesRecursively(extensionRoot).map(
    (child) => `extensions/zink-governance/${child}`,
  );
}

/** Which root a recorded relative path belongs to. */
function rootForRelative(relative) {
  // M12/T9 F-106: the systemd drop-in is the third root, and it is named
  // explicitly so it can never be mistaken for a runtime-relative path.
  if (SNAPSHOT_TARGETS.systemd.includes(relative)) return "systemdRoot";
  return SNAPSHOT_TARGETS.state.includes(relative) ||
    relative.startsWith("extensions/zink-governance/") ||
    SNAPSHOT_TARGETS.discordChannel.includes(relative)
    ? "stateDir"
    : "runtimeRoot";
}

/**
 * Resolve a recorded path against the roots it was captured from, refusing any
 * path that would escape its root.
 */
function resolveRelative(snapshot, relative) {
  const root = rootForRelative(relative);
  const declared = snapshot[root];
  // M12/T9 F-106: a path whose root was never named cannot be resolved. It is
  // refused rather than guessed, so a snapshot that lost its systemd root
  // fails closed instead of resolving against the wrong tree.
  if (typeof declared !== "string" || !declared)
    throw new Error("TRANSACTION_SNAPSHOT_TARGET_MISMATCH");
  const base = path.resolve(declared);
  const absolute = path.resolve(base, relative);
  if (absolute !== base && !absolute.startsWith(base + path.sep))
    throw new Error("TRANSACTION_SNAPSHOT_TARGET_MISMATCH");
  return absolute;
}

function rootsFrom(snapshot) {
  if (!snapshot?.stateDir || !snapshot?.runtimeRoot)
    throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
  return {
    stateDir: snapshot.stateDir,
    runtimeRoot: snapshot.runtimeRoot,
    // M12/T9 F-106: the third root is OPTIONAL, so a snapshot captured before
    // the drop-in was tracked still resolves. A path that needs it and does
    // not have it is refused by `resolveRelative`.
    systemdRoot: snapshot.systemdRoot ?? null,
  };
}

/**
 * Capture the exact live runtime state. Read-only: nothing is written, moved or
 * removed. An absent component is recorded as `existed: false`, so a restore can
 * remove a file the apply created.
 */
export function createTransactionSnapshot(roots) {
  const { stateDir, runtimeRoot, systemdRoot = null } = roots ?? {};
  if (!stateDir || !runtimeRoot)
    throw new Error("TRANSACTION_SNAPSHOT_NO_ROOTS");
  for (const root of [stateDir, runtimeRoot, systemdRoot].filter(Boolean))
    noLinks(root);

  // M12/T9 F-011: the channel targets follow the INSTALLED package, so a
  // reinstall that changes the install directory is covered instead of missed.
  // An install that cannot be resolved to exactly one project fails closed;
  // an install that is simply not there contributes no live file.
  let channelTargets = SNAPSHOT_TARGETS.discordChannel;
  try {
    channelTargets = nativePatchedDiscordChannelRelatives(
      resolveNativeDiscordChannelRelative(stateDir),
    );
  } catch (error) {
    if (error?.message === NATIVE_DISCORD_CHANNEL_AMBIGUOUS) throw error;
  }
  const fixed = [
    ...SNAPSHOT_TARGETS.state.map((relative) => ({ relative, root: stateDir })),
    // M10/T2-R8: channel targets are state-relative, so they resolve inside the
    // state root that is already validated and snapshotted.
    ...channelTargets.map((relative) => ({
      relative,
      root: stateDir,
    })),
    ...SNAPSHOT_TARGETS.runtime.map((relative) => ({
      relative,
      root: runtimeRoot,
    })),
    // M12/T9 F-106: the unit drop-in is captured from the THIRD root when the
    // caller names it. A caller that does not name it captures no systemd
    // target, which is why the live apply names it explicitly.
    ...(systemdRoot
      ? SNAPSHOT_TARGETS.systemd.map((relative) => ({
          relative,
          root: systemdRoot,
        }))
      : []),
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
    // F-230: the digest is taken over the RAW bytes, so the body must be
    // recorded in a form that reproduces them. Stored as UTF-8 text, every
    // byte that is not valid UTF-8 was lost, and the re-hash of the stored
    // text then disagreed with the digest the capture had recorded - so one
    // binary asset made the whole capture fail with
    // TRANSACTION_SNAPSHOT_INCONSISTENT and left no rollback target at all.
    //
    // A body that IS valid UTF-8 round-trips through the text form exactly, so
    // it keeps the shape every snapshot already has; only a body that would
    // be lossy is stored base64-encoded.
    const text = body.toString("utf8");
    const lossless = Buffer.from(text, "utf8").equals(body);
    files[relative] = {
      existed: true,
      sha256: digest(body),
      mode: stat.mode & 0o777,
      ...(lossless ? { body: text } : { body_base64: body.toString("base64") }),
    };
  }

  const snapshot = {
    schema: "zink-transaction-snapshot/1",
    stateDir: path.resolve(stateDir),
    runtimeRoot: path.resolve(runtimeRoot),
    // M12/T9 F-106: the third root travels with the snapshot, so a restore
    // resolves the unit drop-in against the tree it was captured from.
    systemdRoot: systemdRoot ? path.resolve(systemdRoot) : null,
    files,
  };
  // Never hand back a snapshot that cannot already be trusted.
  verifyTransactionSnapshot(snapshot);
  return snapshot;
}

/**
 * F-230: the recorded BYTES of one snapshot entry.
 *
 * A snapshot written by the current capture carries the exact bytes, base64
 * encoded, so the digest it recorded and the bytes it can restore are the same
 * value. A snapshot written before that rule carries the body as UTF-8 text;
 * a body that was valid UTF-8 re-encodes to the same bytes, so it still
 * verifies and still restores byte-exactly. A body that was NOT valid UTF-8
 * could never be captured in that form, so there is nothing to preserve.
 */
function snapshotBytes(entry) {
  if (typeof entry.body_base64 === "string")
    return Buffer.from(entry.body_base64, "base64");
  if (typeof entry.body === "string") return Buffer.from(entry.body, "utf8");
  return null;
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
    const body = snapshotBytes(entry);
    if (body === null) throw new Error("TRANSACTION_SNAPSHOT_INCONSISTENT");
    if (digest(body) !== entry.sha256)
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
    // F-230: the restored bytes are the recorded bytes, not a re-encoding of
    // them, so a preimage that is not valid UTF-8 is restored byte-exactly.
    writeFileSync(absolute, snapshotBytes(entry));
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
/**
 * Compare the live runtime against a snapshot.
 *
 * Rollback (no `postApply`): `restored` is true only when EVERY tracked
 * component matches its recorded preimage. Because the tracked set now
 * includes every file the native patch can rewrite, a leftover mutation is a
 * named mismatch instead of an invisible success.
 *
 * Post-apply: the apply is verified against `options.expected` — the
 * authoritative post-image derived from the patch contract — rather than
 * against "did anything change", which reported both false negatives (an
 * idempotent apply) and false confidence. When `expected` is supplied, every
 * entry must match live: a drifted or absent component fails closed and is
 * named in `unverified`. `changed` always names every tracked component that
 * differs from the preimage, so a mutation verification was not told about is
 * still surfaced rather than silently absorbed.
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
  if (options.postApply) {
    const unverified = [];
    for (const entry of options.expected ?? []) {
      try {
        const absolute = resolveRelative(snapshot, entry.relative);
        noLinks(absolute);
        const stat = lstatSync(absolute, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) unverified.push(entry.relative);
        else if (digest(readFileSync(absolute)) !== entry.sha256)
          unverified.push(entry.relative);
      } catch {
        unverified.push(entry.relative);
      }
    }
    // With no declared expectation the apply cannot claim to be verified, so
    // the caller is forced to state what the runtime must look like.
    const applied =
      Array.isArray(options.expected) &&
      options.expected.length > 0 &&
      unverified.length === 0;
    return {
      applied,
      unrestored: mismatches.sort(),
      changed: mismatches.sort(),
      unverified: unverified.sort(),
      checked: Object.keys(snapshot.files).length,
    };
  }
  // A component whose bytes still equal the preimage was NOT changed by the
  // apply, so a self-reported success that left it untouched is unproven.
  const unchanged = mismatches.length === 0;
  return {
    restored: unchanged,
    mismatches: mismatches.sort(),
    checked: Object.keys(snapshot.files).length,
  };
}

/**
 * M12/T9 F-106: the relative path an absolute path has under a governed root,
 * or null when it lies outside every root the snapshot declares.
 */
function relativeUnderAnyRoot(roots, absolutePath) {
  const target = path.resolve(absolutePath);
  for (const root of [roots.stateDir, roots.runtimeRoot, roots.systemdRoot]) {
    if (typeof root !== "string" || !root) continue;
    const base = path.resolve(root);
    if (target === base) return "";
    if (target.startsWith(base + path.sep))
      return path.relative(base, target).split(path.sep).join("/");
  }
  return null;
}

/**
 * M12/T9 F-106: can the transaction preimage recreate this path?
 *
 * The preimage IS the rollback target, so a path it does not record cannot be
 * brought back by a rollback. A file the preimage recorded under the same
 * relative path is recreatable. A DIRECTORY is recreatable only when EVERY
 * file under it is recorded, because anything else would be deleted for good
 * with no preimage to restore it from.
 *
 * The answer is false for a path outside every governed root, and false for a
 * path the snapshot cannot resolve: an unknown path is never assumed to be
 * recreatable.
 */
export function preimageRecreates(snapshot, absolutePath) {
  const roots = rootsFrom(snapshot);
  const relative = relativeUnderAnyRoot(roots, absolutePath);
  if (relative === null) return false;
  const files = snapshot.files ?? {};
  if (Object.hasOwn(files, relative)) return true;
  const stat = lstatSync(absolutePath, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return false;
  for (const child of listFilesRecursively(absolutePath)) {
    const childRelative = relative ? `${relative}/${child}` : child;
    if (!Object.hasOwn(files, childRelative)) return false;
  }
  return true;
}

/**
 * M12/T9 F-106: delete a path ONLY when the transaction can recreate it.
 *
 * The apply's prune stages used to delete whole trees that no preimage could
 * restore - the legacy r12 quarantine among them - so a failed apply left
 * unique evidence gone for good while the rollback reported success. The
 * delete is now gated on the preimage: what the transaction cannot recreate is
 * RETAINED, and the caller is told which path was kept and why.
 *
 * The removal happens HERE, so a caller cannot delete a path without passing
 * the gate. A path outside every governed root is never recreatable, so it is
 * never deleted either.
 */
export function pruneTransactionPath(snapshot, absolutePath) {
  if (!preimageRecreates(snapshot, absolutePath))
    return {
      deleted: false,
      retained: absolutePath,
      reason: "TRANSACTION_PREIMAGE_CANNOT_RECREATE",
    };
  rmSync(absolutePath, { recursive: true, force: true });
  return { deleted: true, retained: null, reason: null };
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
const RECORD_SCHEMA = "zink-transaction-record/2";
const LEGACY_RECORD_SCHEMA = "zink-transaction-record/1";
/**
 * A legacy R12 record directory: 32 hex characters, DERIVED FROM THE PREIMAGE.
 * Those records stay readable and are never migrated, renamed or deleted.
 */
const LEGACY_TRANSACTION_ID = /^txn-[a-f0-9]{32}$/u;
/**
 * An R15 record directory: 64 hex characters of cryptographic randomness,
 * generated once per apply attempt. It identifies the ATTEMPT, not the preimage.
 */
const ATTEMPT_ID = /^txn-[a-f0-9]{64}$/u;
const TRANSACTION_ID = /^txn-[a-f0-9]{32}(?:[a-f0-9]{32})?$/u;

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
 * M8/T2.2-R15 — ATTEMPT identity and PREIMAGE identity are different things.
 *
 * R12 keyed the transaction directory on the preimage digest. That made a
 * completed, cleanly rolled-back attempt a PERMANENT blocker for any later
 * attempt from the same state: the restored runtime matches the old preimage, the
 * derived ID repeats, and `persistTransactionSnapshot` refuses. The second
 * authorized R10 deployment attempt died exactly there, before any mutation.
 *
 * The two identities are now separate:
 *
 * - `attemptId` — WHICH apply attempt this is. Cryptographically random, unique
 *   per attempt, and the filesystem uniqueness key. It uses the same primitive the
 *   governance identity key already uses, so it is collision-resistant and is
 *   neither a timestamp nor a custom scheme.
 * - `preimageDigest` — WHICH exact runtime state this attempt started from.
 *   Deterministic, and retained in full, so preimage evidence is never replaced
 *   by the attempt ID.
 *
 * Two attempts from the same preimage are legitimate: they receive distinct
 * attempt IDs and distinct directories, and both record the same preimage digest.
 */
function generateAttemptId() {
  return `txn-${randomBytes(32).toString("hex")}`;
}

/** The deterministic identity of the pre-apply runtime, over every component. */
function derivePreimageDigest(snapshot) {
  const binding = Object.entries(snapshot.files)
    .map(
      ([relative, entry]) =>
        `${relative}:${entry.existed ? entry.sha256 : "absent"}`,
    )
    .sort()
    .join("\n");
  return digest(binding);
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
 * Written `0o600` inside a `0o700` directory, created EXCLUSIVELY, so an existing
 * transaction can never be overwritten even if an attempt ID were ever forced to
 * collide. Only the preimage files required for an exact restore are written: no
 * secrets beyond those, no unrelated filesystem content, and no broad recursive
 * system snapshot.
 *
 * The record is read back and verified before returning, so persistence is proven
 * rather than assumed. A snapshot that cannot be re-read must never be allowed to
 * authorize mutation.
 *
 * `attemptId` may be supplied so a caller can pin a specific attempt, but it is
 * generated once here by default and is never derived from the preimage.
 */
export function persistTransactionSnapshot(
  stateDir,
  snapshot,
  { createdAt, attemptId } = {},
) {
  verifyTransactionSnapshot(snapshot);
  if (typeof createdAt !== "string" || !createdAt)
    throw new Error("TRANSACTION_TIMESTAMP_REQUIRED");

  const root = transactionRoot(stateDir);
  const id = attemptId ?? generateAttemptId();
  // Generated or supplied hex, never caller prose, so it cannot traverse. Asserted
  // anyway: this is the recovery path, and recovery must fail closed.
  if (!ATTEMPT_ID.test(id) || path.basename(id) !== id)
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

  // M12/T9: the preimage directory is created HERE, before the per-file loop.
  // It used to be created only inside that loop, so a snapshot whose files all
  // did not exist left the directory missing and `syncDirectory` below opened a
  // directory that was not there — a FIRST apply against an empty state root
  // could not take a transaction at all, which is the live fresh-install path.
  mkdirSync(path.join(directory, PREIMAGE_DIR), {
    recursive: true,
    mode: 0o700,
  });

  const files = {};
  let loaded;
  try {
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
      // F-409: the recorded BYTES, not the text member. A base64-captured
      // preimage carries no `body`, so passing it here handed the writer
      // `undefined` and threw mid-loop.
      writeExclusiveFile(target, snapshotBytes(entry), 0o600);
      files[relative] = {
        existed: true,
        sha256: entry.sha256,
        mode: entry.mode,
      };
    }
    syncDirectory(path.join(directory, PREIMAGE_DIR));

    const record = {
      schema: RECORD_SCHEMA,
      // WHICH attempt this is.
      attemptId: id,
      // WHICH exact runtime state it started from. Deterministic, and derived from
      // the component manifest so the two can never disagree.
      preimageDigest: derivePreimageDigest(snapshot),
      createdAt,
      status: TRANSACTION_STATUS.STARTED,
      snapshotPath: PREIMAGE_DIR,
      stateDir: snapshot.stateDir,
      runtimeRoot: snapshot.runtimeRoot,
      // M12/T9 F-106: the third root is part of the record, so a recovery that
      // reloads the preimage can restore the unit drop-in as well. It is
      // OPTIONAL, so a record written before the drop-in was tracked still
      // loads; the manifest binding covers it either way.
      systemdRoot: snapshot.systemdRoot ?? null,
      files,
    };
    record.manifestDigest = manifestDigest(record);
    writeExclusiveFile(
      path.join(directory, RECORD_NAME),
      `${JSON.stringify(record, null, 2)}\n`,
    );

    loaded = loadTransaction(stateDir, id);
  } catch (error) {
    // F-409: a throw between the mkdir and the record write used to strand a
    // directory that is neither a transaction nor empty; findOrphanedTransaction
    // reports it unreadable and every later apply refuses. The directory was
    // created by this call, so it is removed rather than left behind.
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  if (loaded.status !== TRANSACTION_STATUS.STARTED)
    throw new Error("TRANSACTION_RECORD_INVALID");
  return loaded;
}

/**
 * Load and verify a persisted transaction by its attempt ID.
 *
 * The manifest integrity binding is checked first, then every preimage file is
 * re-hashed against the record, so a corrupted snapshot is refused before it can
 * restore anything. A record whose file list is internally inconsistent is
 * rejected rather than partially trusted.
 *
 * R15 is FORWARD-COMPATIBLE with R12 records, which named the directory with a
 * preimage-derived `transactionId` and carried no `preimageDigest`. Those records
 * are read exactly as they were written: never migrated, renamed or deleted. The
 * returned object always exposes `attemptId` and `preimageDigest` so callers
 * need not care which schema they hold.
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
  const legacy = record.schema === LEGACY_RECORD_SCHEMA;
  if (
    ![RECORD_SCHEMA, LEGACY_RECORD_SCHEMA].includes(record.schema) ||
    // R15 records bind the attempt; R12 records bind the preimage-derived ID.
    (legacy
      ? record.transactionId !== id || LEGACY_TRANSACTION_ID.test(id) === false
      : record.attemptId !== id || ATTEMPT_ID.test(id) === false) ||
    !Object.values(TRANSACTION_STATUS).includes(record.status) ||
    typeof record.createdAt !== "string" ||
    record.snapshotPath !== PREIMAGE_DIR ||
    typeof record.manifestDigest !== "string" ||
    // An R15 record must carry the preimage identity it claims.
    (!legacy &&
      (typeof record.preimageDigest !== "string" ||
        record.preimageDigest.length !== 64)) ||
    manifestDigest(record) !== record.manifestDigest
  )
    throw new Error("TRANSACTION_MANIFEST_INTEGRITY_FAILED");

  const preimageRoot = path.join(directory, record.snapshotPath);
  const snapshot = {
    schema: "zink-transaction-snapshot/1",
    stateDir: record.stateDir,
    runtimeRoot: record.runtimeRoot,
    // M12/T9 F-106: the third root comes back with the record. A record
    // written before the drop-in was tracked carries none, and the paths that
    // would need it are then refused rather than resolved against a guess.
    systemdRoot: record.systemdRoot ?? null,
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
    const body = readFileSync(file);
    // F-409: the digest was recorded over RAW bytes, so the re-hash must read
    // raw bytes too. Reading as UTF-8 replaced every non-UTF-8 byte and the
    // round trip failed its own integrity check. A lossless body keeps the text
    // shape every older record has; only a lossy one is carried base64.
    if (digest(body) !== entry.sha256)
      throw new Error("TRANSACTION_SNAPSHOT_DIGEST_MISMATCH");
    const text = body.toString("utf8");
    const lossless = Buffer.from(text, "utf8").equals(body);
    snapshot.files[relative] = {
      existed: true,
      sha256: entry.sha256,
      mode: entry.mode,
      ...(lossless ? { body: text } : { body_base64: body.toString("base64") }),
    };
  }
  verifyTransactionSnapshot(snapshot);
  // Normalize across schemas: a caller always sees `attemptId` and
  // `preimageDigest`. For a legacy record the directory ID *was* the preimage
  // identity, so the two are the same value by construction.
  return {
    ...record,
    attemptId: id,
    preimageDigest: record.preimageDigest ?? id.replace(/^txn-/u, ""),
    schemaVersion: legacy ? 1 : 2,
    snapshot,
  };
}

/**
 * Mark a transaction complete, addressed by its attempt ID.
 *
 * The ONLY field that ever changes is the lifecycle status: the preimage, the
 * attempt ID, the preimage digest, the creation timestamp and the manifest
 * binding are all immutable, so a completed record stays exactly the evidence it
 * was when written.
 *
 * The preimage is RETAINED, not deleted. The repository has no retention policy
 * for transaction state yet, and silently removing a recovery target is exactly
 * the class of behaviour R11 and R12 exist to prevent. Retention is a later
 * owner decision, not something to assume here.
 */
export function markTransactionComplete(stateDir, attemptId) {
  const recordPath = path.join(
    transactionRoot(stateDir),
    attemptId,
    RECORD_NAME,
  );
  noLinks(recordPath);
  const record = JSON.parse(readFileSync(recordPath, "utf8"));
  if (record.attemptId !== attemptId && record.transactionId !== attemptId)
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
 * This is the crash detector, and R15 deliberately leaves it alone. A transaction
 * left `started` by a process that disappeared is reported so the caller can
 * refuse and ask for an explicit recovery decision.
 *
 * What R15 does NOT do is treat a COMPLETED transaction as an orphan, and does not
 * treat a shared preimage digest as one either. Several completed attempts from
 * the same preimage are history, not unresolved state: the first deployment
 * rollback was exactly that, and treating it as unresolved permanently blocked the
 * next apply.
 *
 * Read-only: it never deletes, resumes or rolls anything back.
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
        attemptId: entry.name,
        status: "unreadable",
        createdAt: null,
        reason: "TRANSACTION_RECORD_UNREADABLE",
      });
      continue;
    }
    if (record.status === TRANSACTION_STATUS.STARTED)
      orphans.push({
        attemptId: record.attemptId,
        preimageDigest: record.preimageDigest,
        status: record.status,
        createdAt: record.createdAt,
        reason: ORPHANED_TRANSACTION,
      });
  }
  return orphans.sort((left, right) =>
    left.attemptId.localeCompare(right.attemptId),
  );
}

/**
 * M12/T9 F-111: the ONE builder apply per transaction.
 *
 * The builder (`configure.mjs --apply`) could be invoked on its own: nothing tied
 * it to the transaction snapshot the apply orchestration takes, so the rollback
 * target, the native patch, the byte verification and the gateway restart could
 * all be skipped, and the "exactly one apply per grant" rule had no tool
 * support at all.
 *
 * The transaction attempt is the GRANT. The builder refuses to run without one,
 * and the attempt is marked consumed by the apply that used it, so a second
 * `--apply` against the same transaction is refused with a named code.
 */
const BUILDER_APPLY_RECEIPT = "builder-apply.consumed";

export function builderApplyReceiptPath(stateDir, attemptId) {
  if (!ATTEMPT_ID.test(attemptId) || path.basename(attemptId) !== attemptId)
    throw new Error("TRANSACTION_ID_INVALID");
  return path.join(transactionRoot(stateDir), attemptId, BUILDER_APPLY_RECEIPT);
}

/**
 * The transaction must exist and must not have been spent.
 */
export function assertBuilderApplyAvailable(stateDir, attemptId) {
  const receipt = builderApplyReceiptPath(stateDir, attemptId);
  if (existsSync(receipt))
    throw new Error(
      "APPLY_ALREADY_SPENT: this transaction already ran the builder apply",
    );
  const record = path.join(transactionRoot(stateDir), attemptId, RECORD_NAME);
  if (!existsSync(record))
    throw new Error(
      "TRANSACTION_NOT_FOUND: the apply orchestration took no such transaction",
    );
  return receipt;
}

/**
 * Mark the transaction spent. The receipt is written EXCLUSIVELY, so two applies
 * racing on the same transaction cannot both believe they own it.
 */
export function markBuilderApplyConsumed(stateDir, attemptId) {
  const receipt = builderApplyReceiptPath(stateDir, attemptId);
  writeExclusiveFile(
    receipt,
    `${JSON.stringify({ consumedAt: new Date().toISOString() })}\n`,
  );
  return receipt;
}
