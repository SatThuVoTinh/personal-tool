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

const stateDir = "/home/hoang_vinh/.openclaw-zink";
const runtimeRoot = "/home/hoang_vinh/.local/lib/node_modules/openclaw";
const nativeBackup = path.join(stateDir, "operator", "m7-t2", "native-r12");
const identifiersPath = path.join(
  stateDir,
  "operator/m7-t2/discord-identifiers.json",
);
const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const service = "openclaw-gateway-zink.service";

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

function configArgs(mode, identifiers) {
  const args = [
    "integrations/openclaw/configure.mjs",
    mode,
    "--state-dir",
    stateDir,
  ];
  for (const [name, value] of Object.entries(identifiers))
    args.push(
      `--${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
      value,
    );
  return args;
}

function runBuilder(mode, identifiers) {
  execFileSync(process.execPath, configArgs(mode, identifiers), {
    cwd: repository,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 60000,
    maxBuffer: 65536,
  });
}

function restartScopedGateway() {
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
    const inspection = inspectNativePatch(runtimeRoot);
    if (
      Object.values(inspection).every((entry) => entry.state === "BASELINE")
    ) {
      rmSync(nativeBackup, { recursive: true, force: true });
    }
  },
  applyNativePatch: () => applyNativePatch(runtimeRoot, nativeBackup),
  checkNativePatch: () => checkNativePatch(runtimeRoot),
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
  expectedNativePostImage: () => nativeRuntimePostImage(runtimeRoot),
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
