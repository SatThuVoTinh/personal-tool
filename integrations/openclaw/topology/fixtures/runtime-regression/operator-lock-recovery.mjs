// M12/T2-R4 (owner decision C1) — the operator action `file-lock.mjs` documents but never had.
//
// The lock primitive's header is explicit: a crashed holder leaves the lock directory behind,
// every later acquisition fails loudly, "there is intentionally NO age-based stale-lock
// reclaim — reclaiming could let two processes enter the critical section together. Recovery of
// an orphaned lock is an explicit operator action, not an automatic heuristic."
//
// On 2026-10-14 an authorized apply's rollback restarted the gateway while it held the ledger
// writer lock. The orphan blocked 202 ledger appends AND every subsequent `--apply`, and the
// only way to clear it was a hand-typed `rm` against a directory next to the production ledger.
// This script is that action, made inspectable: it proves the holder is dead before it offers to
// remove anything, it removes nothing without a typed confirmation, and its default mode is
// read-only.
//
// Output is one JSON line of derived facts. The holder nonce is **omitted**, not
// masked: a four-character prefix of it is still a substring of a live credential, this
// report is pasted into terminals, logs and cards, and the confirmation value that gates
// the recovery is a fixed literal in this file rather than something derived from the
// token — so the prefix bought nothing here and could only leak.
//
// Usage:
//   node operator-lock-recovery.mjs <state-root> [--recover --confirm=ORPHAN_LOCK_RECOVERY]
//   node operator-lock-recovery.mjs --state-dir <absolute-path> [--recover ...]
//   ZINK_OPERATOR_STATE_DIR=<absolute-path> node operator-lock-recovery.mjs [...]
//
// M12/T9 F-489 (R9-L12-3): this driver used to seed its root from the homedir
// and accept only `--state-dir`, so the documented "environment or first
// argument" contract (README BƯỚC 0b / the deploy runbook) did not hold for it
// and the one mutating recovery was unreachable by its own instructions. It now
// resolves a NAMED root like every other operator driver and refuses with
// STATE_DIR_NOT_NAMED when it is given none; the homedir default is gone.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

import { ledgerPaths } from "../../lib/ledger.mjs";
import { LOCK_OWNER_FILE, lockDirFor } from "../../../lib/file-lock.mjs";
import { assertNoSymlinkComponents } from "../../../lib/policy.mjs";
import {
  STATE_DIR_NOT_NAMED,
  resolveStateRoot,
  rootDisclosure,
} from "./operator-state-root.mjs";

const CONFIRM_VALUE = "ORPHAN_LOCK_RECOVERY";

function parseArguments(argv) {
  const options = {
    stateDir: null,
    recover: false,
    confirm: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--state-dir") {
      options.stateDir = argv[++index];
      if (!path.isAbsolute(options.stateDir ?? ""))
        throw new Error("--state-dir must be an absolute path");
    } else if (argument === "--recover") options.recover = true;
    else if (argument.startsWith("--confirm="))
      options.confirm = argument.slice("--confirm=".length);
    else throw new Error(`Unknown argument ${argument}`);
  }
  return options;
}

/**
 * Liveness is `process.kill(pid, 0)`: ESRCH (and EINVAL, an pid the OS rejects outright) means
 * no such process, EPERM means a process exists under another user, and anything else is unknown.
 * Unknown is never treated as dead — a tool that guesses a holder dead could delete a lock a live
 * process is inside, which is exactly the two-writers failure `file-lock.mjs` refuses to allow.
 */
function holderState(pid) {
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

const namedRoot = resolveStateRoot({
  argv: process.argv.slice(2),
  valueFlags: ["--state-dir"],
});
const options = parseArguments(namedRoot.rest);
// The explicit `--state-dir` flag outranks the positional/env form; both are
// the operator naming a root, and the flag is the older, unambiguous spelling.
const stateDir = options.stateDir ?? namedRoot.stateDir;
const stateRootSource = options.stateDir ? "flag" : namedRoot.source;
if (!stateDir) {
  process.stderr.write(`${STATE_DIR_NOT_NAMED}\n`);
  process.exit(2);
}
const lock = lockDirFor(ledgerPaths(stateDir).root, "writer.lock");
const report = {
  state_dir: stateDir,
  ...rootDisclosure(stateDir, stateRootSource),
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

function finish(exitCode) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exit(exitCode);
}

try {
  assertNoSymlinkComponents(lock);
} catch {
  report.action = "REFUSED_SYMLINK";
  report.reason = "LOCK_PATH_SYMLINK";
  finish(1);
}

if (!existsSync(lock)) finish(0);
report.lock_present = true;

const entries = readdirSync(lock).sort();
report.stray_entries = entries.filter((name) => name !== LOCK_OWNER_FILE);
const ownerPath = path.join(lock, LOCK_OWNER_FILE);
if (!existsSync(ownerPath)) {
  // A lock with no owner record cannot be proven stale or live, so it cannot be reclaimed here.
  report.action = "INSPECT";
  report.reason = "OWNER_ENTRY_ABSENT";
  finish(1);
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
  finish(1);
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
  finish(1);
}
report.owner_token = "PRESENT";

const holder = holderState(report.owner_pid);
if (!holder.known) {
  report.action = "INSPECT";
  report.reason = "HOLDER_STATE_UNPROVABLE";
  finish(1);
}
report.holder_alive = holder.alive;
if (holder.alive) {
  report.action = "REFUSED_LIVE_HOLDER";
  report.reason = "A RUNNING PROCESS HOLDS THE LOCK";
  finish(1);
}
if (!options.recover) {
  report.action = "REPORT";
  finish(0);
}
if (options.confirm !== CONFIRM_VALUE || report.stray_entries.length > 0) {
  report.action = report.stray_entries.length
    ? "INSPECT"
    : "REFUSED_UNCONFIRMED";
  report.reason = report.stray_entries.length
    ? "STRAY_LOCK_ENTRY"
    : `--confirm=${CONFIRM_VALUE} IS REQUIRED`;
  finish(1);
}

unlinkSync(ownerPath);
rmdirSync(lock);
report.mutated = true;
report.recovered = !existsSync(lock);
report.action = report.recovered ? "RECOVERED" : "INSPECT";
report.reason = report.recovered ? null : "LOCK_STILL_PRESENT";
finish(report.recovered ? 0 : 1);
