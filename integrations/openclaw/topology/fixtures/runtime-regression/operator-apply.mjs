// Trusted operator-only live apply. Identifier values, config bodies, secrets
// and raw child-process errors must never enter model-visible output.
//
// R7 DS: the sequence, the mutation boundary and the rollback condition live in
// apply-orchestration.mjs, which is covered by tests that never touch WSL. This
// file supplies the real, trusted effects only.
//
// R11: the rollback target is the transaction snapshot of the exact live runtime
// taken immediately before this apply. The historical `backups/r12` T1 baseline
// and the `native-r12` clean preimages are NOT rollback targets for this path;
// they remain deliberate historical-recovery evidence.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import {
  applyNativePatch,
  checkNativePatch,
  inspectNativePatch,
  nativeDiscordChannelRoot,
  nativeRuntimePostImage,
} from "../../lib/native-patch.mjs";
import {
  assertNoSymlinkComponents,
  parseIdentifiers,
} from "../../../lib/policy.mjs";
import {
  createTransactionSnapshot,
  findOrphanedTransaction,
  markTransactionComplete,
  persistTransactionSnapshot,
  restoreTransactionSnapshot,
  verifyLiveRestore,
  verifyTransactionSnapshot,
} from "../../lib/transaction-snapshot.mjs";
import { applyRuntime, classifyApplyReason } from "./apply-orchestration.mjs";

// F-219: the machine-specific state root is NOT a literal. The operator
// names it (ZINK_OPERATOR_STATE_DIR or the first argument) and the driver
// refuses to run without one, exactly like live-governance-probe.mjs: a
// driver that silently points at one operator's machine root says nothing
// about any other, and a hardcoded root is what let these files drift.
const stateDir = process.env.ZINK_OPERATOR_STATE_DIR ?? process.argv[2] ?? null;
if (!stateDir) {
  process.stderr.write("STATE_DIR_NOT_NAMED\n");
  process.exit(2);
}
const runtimeRoot = "/home/hoang_vinh/.local/lib/node_modules/openclaw";
// M10/T2-R8: the Discord channel is a separately installed plugin package, not
// part of the runtime bundle, so the patch is given that root explicitly. It
// lives inside the state directory, which is why the transaction snapshot needs
// no third root to cover it.
const discordChannelRoot = nativeDiscordChannelRoot(stateDir);
// M12/T9 F-011: the state directory is part of the governed roots, so
// the post-image is stated against the INSTALLED channel package.
const nativeRoots = { runtimeRoot, discordChannelRoot, stateDir };
const nativeBackup = path.join(stateDir, "operator", "m7-t2", "native-r12");
const identifiersPath = path.join(
  stateDir,
  "operator/m7-t2/discord-identifiers.json",
);
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const service = "openclaw-gateway-zink.service";
// M12/T9 F-182: the drop-in this apply writes. It is the authoritative
// statement of the unit definition the apply intended, so the loaded-unit
// check compares the manager's own view against THIS file.
const dropInPath = path.join(
  path.dirname(stateDir),
  ".config",
  "systemd",
  "user",
  `${service}.d`,
  "10-zink.conf",
);

function readIdentifiers() {
  assertNoSymlinkComponents(identifiersPath);
  const stat = lstatSync(identifiersPath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
    throw new Error("INVALID_IDENTIFIER_FILE");
  const parsed = JSON.parse(readFileSync(identifiersPath, "utf8"));
  const identifiers = parseIdentifiers(parsed);
  if (Object.keys(parsed).length !== 6)
    throw new Error("INVALID_IDENTIFIER_FILE");
  return identifiers;
}

function configArgs(mode, identifiers, applyTransaction = null) {
  const args = [
    "integrations/openclaw/configure.mjs",
    mode,
    "--state-dir",
    stateDir,
  ];
  // F-111: the apply carries the transaction the orchestration took, so the
  // builder can refuse a bare apply and can refuse a spent transaction.
  if (mode === "--apply" && applyTransaction)
    args.push("--apply-transaction", applyTransaction);
  for (const [name, value] of Object.entries(identifiers))
    args.push(
      `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  return args;
}

function runBuilder(mode, identifiers, applyTransaction = null) {
  execFileSync(
    process.execPath,
    configArgs(mode, identifiers, applyTransaction),
    {
      cwd: repository,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
}

function restartScopedGateway() {
  // M12/T9 F-182: the unit is RELOADED before it is restarted. A changed unit
  // file is not the running unit until the manager has read it, so a restart
  // without a reload silently keeps the PREVIOUS definition — an apply that
  // changed MemoryMax or added the ExecStartPre gate would report `applied`
  // while the running unit still carried the old one.
  execFileSync("systemctl", ["--user", "daemon-reload"], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 65536,
  });
  execFileSync("systemctl", ["--user", "restart", service], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 65536,
  });
  const state = execFileSync("systemctl", ["--user", "is-active", service], {
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30000,
    maxBuffer: 4096,
  })
    .toString("utf8")
    .trim();
  if (state !== "active") throw new Error("GATEWAY_NOT_ACTIVE");
  verifyLoadedUnit();
}

/**
 * M12/T9 F-182: the LOADED unit, not the on-disk file.
 *
 * The transaction snapshot verifies BYTES: the file on disk is what the
 * builder wrote. That is not the same claim as "the running unit carries
 * that definition" — a unit file the manager never re-read is a file and
 * nothing else. So the post-apply check reads what the manager actually has
 * (`systemctl show`) and compares it with the drop-in this apply wrote.
 *
 * The expected values are read from the DROP-IN FILE (the authoritative
 * statement of what the apply wrote), never hardcoded here, so the check
 * cannot drift from the builder.
 */
function parseMemoryBytes(value) {
  const match = /^(\d+)([KMGT])?$/u.exec(String(value ?? "").trim());
  if (!match) return null;
  const scale =
    { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 }[match[2] ?? ""] ?? 1;
  return Number(match[1]) * scale;
}

function readDropInExpectations() {
  const source = readFileSync(dropInPath, "utf8");
  const expectations = { memoryMax: null, execStartPre: [] };
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("MemoryMax="))
      expectations.memoryMax = trimmed.slice("MemoryMax=".length).trim();
    if (trimmed.startsWith("ExecStartPre="))
      expectations.execStartPre.push(
        trimmed.slice("ExecStartPre=".length).trim(),
      );
  }
  return expectations;
}

function verifyLoadedUnit() {
  const expectations = readDropInExpectations();
  const shown = execFileSync(
    "systemctl",
    [
      "--user",
      "show",
      service,
      "--property=MemoryMax",
      "--property=ExecStartPre",
    ],
    { stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 65536 },
  ).toString("utf8");
  const loaded = {};
  for (const line of shown.split("\n")) {
    const index = line.indexOf("=");
    if (index === -1) continue;
    loaded[line.slice(0, index)] = line.slice(index + 1);
  }
  if (expectations.memoryMax) {
    const expected = parseMemoryBytes(expectations.memoryMax);
    const actual = Number(loaded.MemoryMax);
    if (expected === null || !Number.isFinite(actual) || actual !== expected)
      throw new Error("GATEWAY_UNIT_NOT_RELOADED");
  }
  for (const command of expectations.execStartPre) {
    const argv = command.split(/\s+/u).filter(Boolean);
    const marker = argv[argv.length - 1] === "--ensure" ? argv.at(-2) : argv[0];
    if (!marker || !String(loaded.ExecStartPre ?? "").includes(marker))
      throw new Error("GATEWAY_UNIT_NOT_RELOADED");
  }
}

const oldQuarantine = path.join(
  stateDir,
  "operator",
  "m7-t2",
  "backups",
  "r12",
  "quarantined-t2",
);

const report = await applyRuntime({
  readIdentifiers,
  runBuilder,
  pruneQuarantine() {
    if (existsSync(oldQuarantine))
      rmSync(oldQuarantine, { recursive: true, force: true });
  },
  pruneStaleNativeBackup() {
    if (!existsSync(nativeBackup)) return;
    const inspection = inspectNativePatch(nativeRoots);
    if (
      Object.values(inspection).every((entry) => entry.state === "BASELINE")
    ) {
      rmSync(nativeBackup, { recursive: true, force: true });
    }
  },
  applyNativePatch: () => applyNativePatch(nativeRoots, nativeBackup),
  checkNativePatch: () => checkNativePatch(nativeRoots),
  // R11: the rollback target is the exact live state captured immediately before
  // this apply, not `backups/r12/t1-config.json` (captured 2026-09-11) and not
  // the `native-r12` clean preimages. `restoreNativePatch` and
  // `restoreT1RuntimeFiles` are deliberately NOT wired here: the first
  // de-patches the runtime and drops the bridge, the second installs a
  // superseded config and quarantines the governance extension. Both remain
  // available for deliberate historical recovery via operator-rollback.mjs.
  createTransactionSnapshot: () =>
    createTransactionSnapshot({ stateDir, runtimeRoot }),
  verifyTransactionSnapshot,
  // R12: the preimage is persisted and re-read before mutation, so a process
  // that dies mid-apply still leaves a usable recovery target. `persist`
  // re-reads and verifies what it wrote, so a snapshot that cannot be re-loaded
  // never authorizes mutation.
  persistTransactionSnapshot: (snapshot) =>
    persistTransactionSnapshot(stateDir, snapshot, {
      createdAt: new Date().toISOString(),
    }),
  findOrphanedTransaction: () => findOrphanedTransaction(stateDir),
  markTransactionComplete: (id) => markTransactionComplete(stateDir, id),
  restoreTransactionSnapshot,
  // R12: the same byte comparison serves both directions. After a rollback it
  // asks "was the preimage restored?"; after a successful apply it asks "did
  // the mutation actually land?". A self-reported apply is not evidence.
  //
  // M10/T2-R8: the post-apply direction is no longer satisfied by "some
  // tracked component changed". It is verified against the expected post-image
  // the patch contract itself produces for the installed release, so a drifted
  // or absent patched runtime file fails closed and is named. The expectation
  // is derived AFTER the patch is applied and before the gateway is restarted,
  // from the same `inspectNativePatch` that `checkNativePatch` verifies, so it
  // cannot disagree with the patch that was actually written.
  verifyLiveRestore: (snapshot, options) =>
    verifyLiveRestore({ stateDir, runtimeRoot }, snapshot, options),
  // M10/T2-R8: the authoritative post-image of every patched runtime file for
  // the installed release, derived from the patch contract itself. Declaring it
  // is what makes `applied` mean "the runtime matches the patch" instead of
  // "something changed". An unverified release throws here, so the apply fails
  // closed at runtime-verify rather than verifying against a guess.
  expectedNativePostImage: () => nativeRuntimePostImage(nativeRoots),
  restartScopedGateway,
  // R16: there is deliberately NO external `openclaw config validate` step here.
  // It used to be wired as a dependency described as an "additional semantic
  // health signal", but `applyRuntime` never called it, so the deployment path
  // performed no such validation while the comment implied it did.
  //
  // Removing it is the correct fix rather than calling it: `config validate`
  // accepts any config the current policy recognises, including a superseded
  // baseline, so it cannot detect a wrong-but-valid restore and would add a
  // failure mode to a path whose gate must be byte comparison. `verifyLiveRestore`
  // compares bytes against the attempt's own preimage and is the only thing that
  // licenses `rollbackSucceeded` or a successful apply. Config correctness is
  // separately enforced at build time by the builder's own `--preflight` and
  // `policy.validateConfig`, which run before the mutation boundary.
  classifyReason: classifyApplyReason,
});

process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.status !== "PASS") process.exitCode = 1;
