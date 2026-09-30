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
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

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
export function verifyLiveRestore(roots, snapshot) {
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
  return {
    restored: mismatches.length === 0,
    mismatches: mismatches.sort(),
    checked: Object.keys(snapshot.files).length,
  };
}
