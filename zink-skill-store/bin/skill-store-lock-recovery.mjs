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
//   - nothing is removed without the typed confirmation.
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

  let owner;
  try {
    const stat = lstatSync(ownerPath);
    if (!stat.isFile()) throw new Error("not a regular file");
    owner = JSON.parse(readFileSync(ownerPath, "utf8"));
  } catch {
    report.owner_entry = "MALFORMED";
    report.action = "INSPECT";
    report.reason = "OWNER_ENTRY_UNREADABLE";
    return { report, exitCode: 1 };
  }
  report.owner_entry = "OK";
  report.owner_pid = typeof owner?.pid === "number" ? owner.pid : null;
  if (
    typeof owner?.token !== "string" ||
    !/^[0-9a-f]{32}$/u.test(owner.token) ||
    report.owner_pid === null
  ) {
    report.owner_entry = "MALFORMED";
    report.action = "INSPECT";
    report.reason = "OWNER_RECORD_SHAPE";
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

  unlinkSync(ownerPath);
  rmdirSync(lock);
  report.mutated = true;
  report.recovered = !existsSync(lock);
  report.action = report.recovered ? "RECOVERED" : "INSPECT";
  report.reason = report.recovered ? null : "LOCK_STILL_PRESENT";
  return { report, exitCode: report.recovered ? 0 : 1 };
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
