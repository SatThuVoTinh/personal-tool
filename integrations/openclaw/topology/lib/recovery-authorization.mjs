// M8/T2.2-R12 — explicit recovery authorization for the historical rollback path.
//
// This module is NOT the automatic transaction rollback. Automatic apply rollback
// restores the exact transaction preimage and needs no authorization, because it
// is the only way to return a half-applied runtime to the state it was in moments
// earlier.
//
// The historical operator rollback is a different and destructive action. It
// installs:
//
//   * the 2026-09-11 T1 config from `backups/r12/t1-config.json`,
//   * the clean upstream native BASELINE from `native-r12`, un-patching the
//     runtime and deleting the governance bridge,
//   * and no governance extension, which it quarantines away entirely.
//
// That is recovery from a known-bad runtime, not a rollback of a failed apply.
// Until R12 it ran with no authorization check at all.
//
// The gate is four separate requirements, all of which must hold:
//
//   1. an explicit recovery authorization is recorded on disk;
//   2. the requested recovery target is named, and is a known one;
//   3. the operator passes the explicit confirmation;
//   4. the exact target is disclosed BEFORE any mutation.
//
// Authorization is never inferred from `Deployment Authorized`, from
// `Execution Authorization`, or from the mere presence of a backup: those
// describe permission to build and deploy, not to dismantle a runtime. A
// deployment authorization record is explicitly REJECTED here rather than
// quietly ignored, so the two can never be confused.
//
// These functions are pure so the gate is provable without WSL, systemctl, or a
// live OpenClaw process. The filesystem is reached only through the small
// `readAuthorizationFile` seam.
import { lstatSync, readFileSync } from "node:fs";
import process from "node:process";

/** The only recovery target this repository knows how to install. */
export const KNOWN_RECOVERY_TARGETS = Object.freeze({
  "r12-t1-baseline": Object.freeze({
    label: "r12/T1 baseline (captured 2026-09-11)",
    kind: "HISTORICAL_RECOVERY",
    willInstall: "2026-09-11 T1 config",
    willRestoreNative: "CLEAN_UPSTREAM_BASELINE",
    willRemoveGovernanceExtension: true,
  }),
});

/** The confirmation an operator must pass. Never a default, never inferred. */
export const RECOVERY_CONFIRMATION = "RECOVER-T1-BASELINE";

/** Fixed, disclosable reasons. No filesystem path ever reaches the output. */
export const RECOVERY_REFUSALS = Object.freeze({
  UNSUPPORTED_ARGUMENT: "UNSUPPORTED_ARGUMENT",
  RECOVERY_NOT_AUTHORIZED: "RECOVERY_NOT_AUTHORIZED",
  DEPLOYMENT_AUTHORIZATION_IS_NOT_RECOVERY:
    "DEPLOYMENT_AUTHORIZATION_IS_NOT_RECOVERY",
  RECOVERY_TARGET_NOT_NAMED: "RECOVERY_TARGET_NOT_NAMED",
  RECOVERY_TARGET_UNKNOWN: "RECOVERY_TARGET_UNKNOWN",
  RECOVERY_TARGET_NOT_AUTHORIZED: "RECOVERY_TARGET_NOT_AUTHORIZED",
  RECOVERY_NOT_CONFIRMED: "RECOVERY_NOT_CONFIRMED",
  RECOVERY_BACKUP_MISSING: "RECOVERY_BACKUP_MISSING",
  RECOVERY_AUTHORIZATION_TIMESTAMP_INVALID:
    "RECOVERY_AUTHORIZATION_TIMESTAMP_INVALID",
  RECOVERY_AUTHORIZATION_EXPIRED: "RECOVERY_AUTHORIZATION_EXPIRED",
});

/**
 * M12/T9 F-337: an authorization record used to stay armed indefinitely. Only
 * its SHAPE was checked — an `EXPLICIT` flag, a target, the confirmation and
 * a timestamp that had to be a STRING — so a record written for one recovery
 * exercise still authorized the next one, months later, against a runtime
 * that had moved several patch generations beyond the one the operator
 * actually approved. The record is now bounded by a freshness window, and its
 * timestamp must be a real instant.
 */
export const RECOVERY_AUTHORIZATION_MAX_AGE_MS = 60 * 60 * 1000;

/** Parse `--target=<name>` and `--confirm=<CONFIRMATION>`. */
export function parseRecoveryArguments(argv) {
  const options = { target: null, confirmed: false };
  for (const argument of argv) {
    if (argument === `--confirm=${RECOVERY_CONFIRMATION}`) {
      options.confirmed = true;
      continue;
    }
    if (argument.startsWith("--target=")) {
      options.target = argument.slice("--target=".length);
      continue;
    }
    return { options: null, refusal: RECOVERY_REFUSALS.UNSUPPORTED_ARGUMENT };
  }
  return { options, refusal: null };
}

/**
 * Decide whether a recovery authorization record authorizes anything at all.
 *
 * A record that only carries a deployment decision is rejected outright, so a
 * `Deployment Authorized: YES` line can never be read as permission to tear the
 * runtime down.
 */
export function evaluateRecoveryAuthorization(
  record,
  { now = Date.now(), maxAgeMs = RECOVERY_AUTHORIZATION_MAX_AGE_MS } = {},
) {
  if (record === null || record === undefined)
    return {
      authorized: false,
      refusal: RECOVERY_REFUSALS.RECOVERY_NOT_AUTHORIZED,
    };
  if (record?.recoveryAuthorization !== "EXPLICIT") {
    // Distinguish "this is a deployment authorization" from "this is nothing",
    // because the operator needs to know which mistake they made.
    const looksLikeDeploymentDecision =
      record?.deploymentAuthorization !== undefined ||
      record?.DeploymentAuthorized !== undefined;
    return {
      authorized: false,
      refusal: looksLikeDeploymentDecision
        ? RECOVERY_REFUSALS.DEPLOYMENT_AUTHORIZATION_IS_NOT_RECOVERY
        : RECOVERY_REFUSALS.RECOVERY_NOT_AUTHORIZED,
    };
  }
  if (
    typeof record.target !== "string" ||
    record.confirmation !== RECOVERY_CONFIRMATION ||
    typeof record.authorizedAt !== "string"
  )
    return {
      authorized: false,
      refusal: RECOVERY_REFUSALS.RECOVERY_NOT_AUTHORIZED,
    };
  // M12/T9 F-337: the timestamp must be a real instant, and the record must
  // still be fresh. A non-ISO value is refused, and a record older than the
  // window no longer arms the destructive path.
  const authorizedAt = Date.parse(record.authorizedAt);
  if (!Number.isFinite(authorizedAt)) {
    return {
      authorized: false,
      refusal: RECOVERY_REFUSALS.RECOVERY_AUTHORIZATION_TIMESTAMP_INVALID,
    };
  }
  const ageMs = now - authorizedAt;
  if (ageMs > maxAgeMs || ageMs < -maxAgeMs) {
    return {
      authorized: false,
      refusal: RECOVERY_REFUSALS.RECOVERY_AUTHORIZATION_EXPIRED,
    };
  }
  if (!Object.hasOwn(KNOWN_RECOVERY_TARGETS, record.target))
    return {
      authorized: false,
      refusal: RECOVERY_REFUSALS.RECOVERY_TARGET_UNKNOWN,
      requestedTarget: record.target,
    };
  return { authorized: true, refusal: null, target: record.target };
}

/**
 * The complete gate. Returns `{ proceed: true, disclosure }` only when all four
 * requirements hold, otherwise a fixed refusal and never a target.
 *
 * `backupPresent` is passed in rather than probed, so the decision is pure and
 * testable. A missing backup fails closed even when everything else is in order.
 */
export function authorizeHistoricalRecovery({
  authorization,
  options,
  backupPresent,
  now = Date.now(),
  maxAgeMs = RECOVERY_AUTHORIZATION_MAX_AGE_MS,
}) {
  const denial = (refusal, extra = {}) => ({
    proceed: false,
    refusal,
    disclosure: null,
    installed_mutation: false,
    ...extra,
  });

  const verdict = evaluateRecoveryAuthorization(authorization, {
    now,
    maxAgeMs,
  });
  if (!verdict.authorized) return denial(verdict.refusal);

  if (!options || !options.target)
    return denial(RECOVERY_REFUSALS.RECOVERY_TARGET_NOT_NAMED);
  if (!Object.hasOwn(KNOWN_RECOVERY_TARGETS, options.target))
    return denial(RECOVERY_REFUSALS.RECOVERY_TARGET_UNKNOWN, {
      requestedTarget: options.target,
    });
  if (verdict.target !== options.target)
    return denial(RECOVERY_REFUSALS.RECOVERY_TARGET_NOT_AUTHORIZED, {
      requestedTarget: options.target,
      authorizedTarget: verdict.target,
    });
  if (options.confirmed !== true)
    return denial(RECOVERY_REFUSALS.RECOVERY_NOT_CONFIRMED);
  if (backupPresent !== true)
    return denial(RECOVERY_REFUSALS.RECOVERY_BACKUP_MISSING, {
      requestedTarget: options.target,
    });

  const target = KNOWN_RECOVERY_TARGETS[options.target];
  return {
    proceed: true,
    refusal: null,
    installed_mutation: false,
    disclosure: {
      status: "DISCLOSED",
      // Always a historical recovery, never a transaction rollback. These are
      // different actions and must never be reported as the same one.
      action: target.kind,
      isTransactionRollback: false,
      requestedTarget: options.target,
      targetLabel: target.label,
      willInstall: target.willInstall,
      willRestoreNative: target.willRestoreNative,
      willRemoveGovernanceExtension: target.willRemoveGovernanceExtension,
    },
  };
}

/**
 * Read and parse a recovery authorization record.
 *
 * A missing file, a wrong mode, an oversized file, or malformed JSON all return
 * `null`, which the gate treats as "not authorized". Returning `null` rather than
 * throwing keeps the refusal reason uniform.
 */
export function readRecoveryAuthorization(filePath) {
  const stat = lstatSync(filePath, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 8192) return null;
  // Windows has no POSIX mode bits, so the restriction is only enforceable on
  // the platform that has them. Elsewhere it is a hard requirement.
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o600)
    return null;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}
