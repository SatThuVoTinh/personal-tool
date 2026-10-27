#!/usr/bin/env node
// M12/T9-R1 F-067 — the Skill Store's own guarded lock recovery.
//
// `file-lock.mjs` is explicit about the failure it cannot repair by itself:
// "a crashed holder leaves the lock directory behind and the next acquirer
// times out with an explicit error. There is intentionally NO age-based
// stale-lock reclaim — reclaiming could let two processes enter the critical
// section together. Recovery of an orphaned lock is an explicit operator
// action, not an automatic heuristic."
//
// The operator tool that exists today recovers ONE governed lock root (the
// ledger's `writer.lock`). The Skill Store's writer lock is a DIFFERENT root
// — it lives beside the skills tree, named after the tree it guards — so a
// stranded one had no guarded recovery at all: every later promotion failed
// with `FILE_LOCK_TIMEOUT` and no operator action could clear it.
//
// This is that action, made inspectable, and it follows the same rules the
// ledger tool follows:
//   - the default mode is READ-ONLY and prints one JSON line of derived facts;
//   - the holder is PROVEN dead before anything is offered (a live holder is
//     refused, never guessed);
//   - a lock with an unreadable owner record or a stray entry is INSPECTED,
//     not reclaimed;
//   - nothing is removed without the typed confirmation;
//   - the owner record is re-read and compared immediately before the
//     removal, so a lock a NEW writer acquired after the inspection is never
//     deleted (F-433).
//
// The holder's token is NOT printed: a prefix of it is still a substring of a
// live credential, and this report is pasted into terminals and cards.
//
// Usage:
//   node skill-store-lock-recovery.mjs [--root <absolute-path>]
//   node skill-store-lock-recovery.mjs --recover --confirm=ORPHAN_LOCK_RECOVERY
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { skillStoreWriterLockDir } from "../src/catalog.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../skills/", import.meta.url));
const CONFIRM_VALUE = "ORPHAN_LOCK_RECOVERY";
const LOCK_OWNER_FILE = "owner.json";

/**
 * Liveness is `process.kill(pid, 0)`: ESRCH (and EINVAL, a pid the OS
 * rejects outright) means no such process, EPERM means a process exists under
 * another user, and anything else is unknown. Unknown is never treated as
 * dead — a tool that guesses a holder dead could delete a lock a live process
 * is inside, which is exactly the two-writers failure the lock protocol
 * refuses to allow.
 */
export function holderState(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { known: false, alive: null };
  try {
    process.kill(pid, 0);
    return { known: true, alive: true };
  } catch (error) {
    if (error?.code === "ESRCH" || error?.code === "EINVAL")
      return { known: true, alive: false };
    if (error?.code === "EPERM") return { known: true, alive: true };
    return { known: false, alive: null };
  }
}

function parseArguments(argv) {
  const options = { root: DEFAULT_ROOT, recover: false, confirm: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root") {
      options.root = argv[++index];
      if (!path.isAbsolute(options.root ?? ""))
        throw new Error("--root must be an absolute path");
    } else if (argument === "--recover") options.recover = true;
    else if (argument.startsWith("--confirm="))
      options.confirm = argument.slice("--confirm=".length);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

/**
 * Reads and shape-checks a lock's owner record.
 *
 * Returns the parsed record plus the shape verdict, because the two answers are
 * different facts and both callers need them separately: a record that cannot
 * be read is INSPECTed, and a record of the wrong shape is INSPECTed too, but
 * only a shaped record can be compared with the one the scan approved.
 */
function readOwnerRecord(ownerPath) {
  let owner;
  try {
    const stat = lstatSync(ownerPath);
    if (!stat.isFile())
      return { owner: null, reason: "OWNER_ENTRY_UNREADABLE" };
    owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    return { owner: null, reason: "OWNER_ENTRY_UNREADABLE" };
  }
  const shaped =
    typeof owner?.token === "string" &&
    /^[0-9a-f]{32}$/u.test(owner.token) &&
    typeof owner?.pid === "number";
  return { owner, reason: shaped ? null : "OWNER_RECORD_SHAPE" };
}

/**
 * Removes an orphaned lock ONLY while it still belongs to the holder the scan
 * proved dead.
 *
 * M12/T9-R4 F-433: the inspection above is a SNAPSHOT — it reads `owner.json`,
 * checks that holder's pid and then deletes. Between that read and this delete
 * another writer can acquire the very same lock, and deleting it then erases a
 * LIVE writer's mutex while that writer believes it is protected: two writers
 * inside the critical section. So the record is re-read immediately before the
 * removal and compared with the snapshot by token AND pid. A lock created after
 * the scan is never touched, and the comparison is what enforces it — not the
 * snapshot's liveness check, which vouched for the OLD holder.
 *
 * Exported so the compare-before-delete contract is testable without a
 * multi-process interleaving.
 */
export function removeOrphanedLock(lockDir, expectedOwner) {
  const ownerPath = path.join(lockDir, LOCK_OWNER_FILE);
  const current = readOwnerRecord(ownerPath);
  if (!current.owner) {
    return { mutated: false, removed: false, reason: "OWNER_ENTRY_UNREADABLE" };
  }
  if (current.reason) {
    return { mutated: false, removed: false, reason: "OWNER_RECORD_SHAPE" };
  }
  if (
    current.owner.token !== expectedOwner?.token ||
    current.owner.pid !== expectedOwner?.pid
  ) {
    return {
      mutated: false,
      removed: false,
      reason: "OWNER_CHANGED_BEFORE_REMOVAL",
    };
  }
  unlinkSync(ownerPath);
  rmdirSync(lockDir);
  const removed = !existsSync(lockDir);
  return {
    mutated: true,
    removed,
    reason: removed ? null : "LOCK_STILL_PRESENT",
  };
}

/**
 * Inspects (and, on request, clears) the Skill Store's writer lock.
 *
 * Returns the report and the exit code the CLI uses; the function is
 * exported so the guard is testable without spawning a process.
 */
export function recoverSkillStoreLock(options = {}) {
  const skillsRoot = options.root ?? DEFAULT_ROOT;
  const recover = options.recover === true;
  const confirm = options.confirm ?? null;
  const report = {
    skills_root: skillsRoot,
    lock_dir: null,
    lock_present: false,
    owner_entry: "ABSENT",
    owner_pid: null,
    holder_alive: null,
    owner_token: null,
    stray_entries: [],
    action: "NONE",
    reason: null,
    mutated: false,
    recovered: false,
  };

  let lock;
  try {
    lock = skillStoreWriterLockDir(skillsRoot);
  } catch (error) {
    report.action = "REFUSED_INVALID_ROOT";
    report.reason = error?.code ?? "SKILLS_ROOT_REQUIRED";
    return { report, exitCode: 1 };
  }
  report.lock_dir = lock;

  if (!existsSync(lock)) {
    report.action = "REPORT";
    report.reason = "NO_LOCK_PRESENT";
    return { report, exitCode: 0 };
  }
  report.lock_present = true;

  const entries = readdirSync(lock).sort();
  report.stray_entries = entries.filter((name) => name !== LOCK_OWNER_FILE);
  const ownerPath = path.join(lock, LOCK_OWNER_FILE);
  if (!existsSync(ownerPath)) {
    // A lock with no owner record cannot be proven stale or live, so it
    // cannot be reclaimed here.
    report.action = "INSPECT";
    report.reason = "OWNER_ENTRY_ABSENT";
    return { report, exitCode: 1 };
  }

  const read = readOwnerRecord(ownerPath);
  const owner = read.owner;
  if (!owner) {
    report.owner_entry = "MALFORMED";
    report.action = "INSPECT";
    report.reason = read.reason;
    return { report, exitCode: 1 };
  }
  report.owner_entry = "OK";
  report.owner_pid = typeof owner?.pid === "number" ? owner.pid : null;
  if (read.reason) {
    report.owner_entry = "MALFORMED";
    report.action = "INSPECT";
    report.reason = read.reason;
    return { report, exitCode: 1 };
  }
  report.owner_token = "PRESENT";

  const holder = holderState(report.owner_pid);
  if (!holder.known) {
    report.action = "INSPECT";
    report.reason = "HOLDER_STATE_UNPROVABLE";
    return { report, exitCode: 1 };
  }
  report.holder_alive = holder.alive;
  if (holder.alive) {
    report.action = "REFUSED_LIVE_HOLDER";
    report.reason = "A RUNNING PROCESS HOLDS THE LOCK";
    return { report, exitCode: 1 };
  }
  if (!recover) {
    report.action = "REPORT";
    report.reason = "ORPHANED_LOCK";
    return { report, exitCode: 0 };
  }
  if (confirm !== CONFIRM_VALUE || report.stray_entries.length > 0) {
    report.action = report.stray_entries.length
      ? "INSPECT"
      : "REFUSED_UNCONFIRMED";
    report.reason = report.stray_entries.length
      ? "STRAY_LOCK_ENTRY"
      : `--confirm=${CONFIRM_VALUE} IS REQUIRED`;
    return { report, exitCode: 1 };
  }

  const removal = removeOrphanedLock(lock, owner);
  report.mutated = removal.mutated;
  report.recovered = removal.removed;
  report.action = removal.removed ? "RECOVERED" : "INSPECT";
  report.reason = removal.reason;
  return { report, exitCode: removal.removed ? 0 : 1 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        action: "REFUSED_ARGUMENTS",
        reason: error?.message ?? "invalid arguments",
      })}\n`,
    );
    process.exitCode = 2;
  }
  if (options) {
    const { report, exitCode } = recoverSkillStoreLock(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = exitCode;
  }
}
