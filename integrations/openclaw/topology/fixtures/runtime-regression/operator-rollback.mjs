// M8/T2.2-R12 — explicit recovery authorization for the historical rollback path.
//
// This command is NOT the automatic transaction rollback. Automatic apply rollback
// restores the exact transaction preimage and needs no authorization, because it
// is the only way to return a half-applied runtime to the state it was in moments
// earlier.
//
// This command is a different and destructive action. It installs:
//
//   * the 2026-09-11 T1 config from `backups/r12/t1-config.json`,
//   * the clean upstream native BASELINE from `native-r12`, un-patching the
//     runtime and deleting the governance bridge,
//   * and no governance extension, which it quarantines away entirely.
//
// That is recovery from a known-bad runtime, not a rollback of a failed apply.
// Until R12 it ran with no authorization check at all. The gate lives in
// `recovery-authorization.mjs` and requires, before any mutation:
//
//   1. an explicit recovery authorization recorded on disk,
//   2. the recovery target named and known,
//   3. the operator's explicit confirmation,
//   4. disclosure of exactly what will be installed.
//
// Authorization is never inferred from `Deployment Authorized`, from
// `Execution Authorization`, or from the presence of a backup.
//
// `backups/r12` and this command are both retained, and the historical target is
// unchanged. It is merely guarded.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  restoreNativePatch,
  inspectNativePatch,
  NATIVE_DISCORD_CHANNEL_RELATIVE,
} from "../../lib/native-patch.mjs";
import { restoreT1RuntimeFiles } from "../../lib/runtime-backup.mjs";
import {
  authorizeHistoricalRecovery,
  parseRecoveryArguments,
  readRecoveryAuthorization,
} from "../../lib/recovery-authorization.mjs";
import {
  assertNoSymlinkComponents,
  parseIdentifiers,
} from "../../../lib/policy.mjs";

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
// M10/T2-R8: restore must resolve the SAME governed roots that produced the
// patch, including the installed Discord channel package, or the ingress repair
// would survive a rollback as an untracked mutation.
const discordChannelRoot = path.join(stateDir, NATIVE_DISCORD_CHANNEL_RELATIVE);
const nativeRoots = { runtimeRoot, discordChannelRoot };
const nativeBackup = path.join(stateDir, "operator", "m7-t2", "native-r12");
const t1Config = path.join(
  stateDir,
  "operator",
  "m7-t2",
  "backups",
  "r12",
  "t1-config.json",
);
const identifiersPath = path.join(
  stateDir,
  "operator/m7-t2/discord-identifiers.json",
);
// Deliberately NOT `PLAN.md`, and deliberately not derived from any deployment
// decision. A separate artifact, so a deployment authorization cannot be mistaken
// for permission to dismantle the runtime.
const authorizationPath = path.join(
  stateDir,
  "operator/m7-t2/recovery-authorization.json",
);

// A refusal is terminal, so it unwinds out of the try below instead of running on
// into the restore it was meant to gate. `configure.mjs` and `verify.mjs` stop the
// same way — throw, report once from the one catch — and neither calls `process.exit`.
class RecoveryRefused extends Error {}

function refuse(refusal, extra = {}) {
  process.stdout.write(
    `${JSON.stringify({
      status: "FAIL",
      reason: refusal,
      action: "HISTORICAL_RECOVERY",
      isTransactionRollback: false,
      installed_mutation: false,
      ...extra,
    })}\n`,
  );
  process.exitCode = 1;
  throw new RecoveryRefused(refusal);
}

function identifiers() {
  assertNoSymlinkComponents(identifiersPath);
  const stat = lstatSync(identifiersPath);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
    throw new Error("INVALID_IDENTIFIER_FILE");
  return parseIdentifiers(JSON.parse(readFileSync(identifiersPath, "utf8")));
}

try {
  const { options, refusal } = parseRecoveryArguments(process.argv.slice(2));
  if (refusal) refuse(refusal);

  assertNoSymlinkComponents(authorizationPath);
  const verdict = authorizeHistoricalRecovery({
    authorization: readRecoveryAuthorization(authorizationPath),
    options,
    backupPresent:
      existsSync(t1Config) &&
      existsSync(path.join(nativeBackup, "manifest.json")),
  });
  if (!verdict.proceed) refuse(verdict.refusal, { ...verdict });

  // Disclose the target before anything is written.
  process.stdout.write(`${JSON.stringify(verdict.disclosure)}\n`);

  const values = identifiers();
  restoreNativePatch(nativeRoots, nativeBackup);
  await restoreT1RuntimeFiles({ stateDir, identifiers: values });
  execFileSync(
    "systemctl",
    ["--user", "restart", "openclaw-gateway-zink.service"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
      maxBuffer: 65536,
    },
  );
  const baseline = inspectNativePatch(nativeRoots);
  if (!Object.values(baseline).every((entry) => entry.state === "BASELINE"))
    throw new Error("NATIVE_RESTORE_FAILED");
  process.stdout.write(
    `${JSON.stringify({
      status: "PASS",
      action: "HISTORICAL_RECOVERY",
      requestedTarget: options.target,
      runtime: "T1_RESTORED",
      isTransactionRollback: false,
    })}\n`,
  );
} catch (error) {
  if (error instanceof RecoveryRefused) {
    // `refuse()` already wrote the single record this command may emit for a
    // refusal, and nothing was installed. Reporting again here would claim a
    // mutation the refusal prevented.
    process.exitCode = 1;
  } else {
    // Only a fixed, disclosable reason. Never a path, never child stderr.
    const known = [
      "NATIVE_RESTORE_FAILED",
      "RESTORE_QUARANTINE_CONFLICT",
      "RESTORE_VERIFICATION_FAILED",
      "BACKUP_MANIFEST_INVALID",
      "NATIVE_BACKUP_MANIFEST_INVALID",
      "INVALID_IDENTIFIER_FILE",
    ];
    process.stdout.write(
      `${JSON.stringify({
        status: "FAIL",
        reason: known.includes(error?.message)
          ? error.message
          : "HISTORICAL_RECOVERY_FAILED",
        action: "HISTORICAL_RECOVERY",
        isTransactionRollback: false,
        installed_mutation: true,
      })}\n`,
    );
    process.exitCode = 1;
  }
}
