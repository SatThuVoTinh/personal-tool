// R7 DS — deployment apply orchestration with an explicit mutation boundary.
//
// The invariant this module exists to enforce:
//
//     PRE-FLIGHT FAILURE = ZERO RUNTIME MUTATION
//
// The 2026-09-30 incident: `operator-apply.mjs` gated rollback on
// `if (identifiers)`, and `identifiers` is assigned BEFORE the builder runs. It
// was therefore a read-succeeded flag, not a mutation-started flag. A
// `Policy drift` rejection — raised by `configure.mjs` validation that provably
// runs before its first write — satisfied the gate and executed
// `restoreNativePatch` + `restoreT1RuntimeFiles` + `restartScopedGateway`,
// replacing the live config with an older backup, quarantining the governance
// extension and reverting the native patch on a healthy runtime.
//
// R11 adds a second invariant, on top of the R7 one above:
//
//     MUTATION REQUIRES A VERIFIED ROLLBACK TARGET, AND SUCCESS IS PROVEN
//
// The 2026-09-30 audit found the rollback wired to `backups/r12/t1-config.json`
// (captured 2026-09-11) and to `native-r12` clean preimages, so a mid-apply
// failure installed a superseded config, quarantined the governance extension
// and de-patched the native runtime — and `rollbackSucceeded` was set purely
// because the restore helpers returned, with no comparison against the
// pre-apply state.
//
// R11 therefore takes a transaction snapshot of the exact live runtime before
// the first mutating call, refuses to mutate without it, restores that preimage
// on failure, and emits `rollbackSucceeded: true` only after the live bytes
// match the snapshot.
//
// Every runtime effect is injected so both invariants are testable without WSL,
// systemctl, or a live OpenClaw process. This module performs no I/O itself.
import {
  RESTORE_UNVERIFIED,
  ROLLBACK_SAFETY_UNAVAILABLE,
} from "../../lib/transaction-snapshot.mjs";

/** Ordered stages. The reported `stage` on failure is the one that threw. */
export const APPLY_STAGES = [
  "identifiers",
  "builder-preflight",
  "transaction-snapshot",
  "builder-apply",
  "quarantine-prune",
  "native-backup-prune",
  "native-patch",
  "native-verify",
  "gateway-restart",
];

/**
 * The first stage that writes to the live runtime. `configure.mjs` returns for
 * mode `preflight` before its first mutating call, and the transaction snapshot
 * is read-only, so every stage before this one is provably zero-mutation.
 */
export const FIRST_MUTATING_STAGE = "builder-apply";

const MUTATING_STAGES = new Set([
  "builder-apply",
  "quarantine-prune",
  "native-backup-prune",
  "native-patch",
  "gateway-restart",
]);

export function isMutatingStage(stage) {
  return MUTATING_STAGES.has(stage);
}

/**
 * Run the apply sequence.
 *
 * Resolves with a structured report. It never rejects: a deployment failure is
 * a reportable outcome, and the caller must always be able to print both the
 * original failure and any rollback failure.
 */
export async function applyRuntime(deps) {
  let stage = APPLY_STAGES[0];
  let mutationStarted = false;
  let identifiers;
  // Declared out here, not inside the `try`, because the rollback path in the
  // `catch` needs the transaction preimage. A `let` inside the `try` block is
  // not visible to its own `catch`.
  let snapshot;
  try {
    stage = "identifiers";
    identifiers = deps.readIdentifiers();

    // Reuse the builder's own zero-mutation preflight so a policy or config
    // drift is rejected before the first write, exactly as operator-preflight
    // does. This is the stage that was previously missing here.
    stage = "builder-preflight";
    deps.runBuilder("--preflight", identifiers);

    // R11: establish the rollback target BEFORE the first mutating call. A
    // transaction snapshot is the exact live runtime state immediately before
    // this apply, so rollback can restore what was actually there rather than a
    // historical r12/T1 baseline. It is read-only, so taking it is not itself a
    // mutation. If it cannot be created and verified, nothing below may run.
    stage = "transaction-snapshot";
    try {
      snapshot = deps.createTransactionSnapshot();
      deps.verifyTransactionSnapshot(snapshot);
    } catch {
      // Do not surface the underlying cause: it can carry a filesystem path.
      // The operator needs one fact — rollback safety is not established.
      return {
        status: "FAIL",
        stage,
        mutationStarted: false,
        rollbackRequired: false,
        rollbackAttempted: false,
        rollbackSucceeded: false,
        reason: ROLLBACK_SAFETY_UNAVAILABLE,
        rollbackReason: null,
        restoreValidationReason: null,
        restoreMismatches: null,
      };
    }

    stage = "builder-apply";
    mutationStarted = true;
    deps.runBuilder("--apply", identifiers);

    stage = "quarantine-prune";
    deps.pruneQuarantine();

    stage = "native-backup-prune";
    deps.pruneStaleNativeBackup();

    stage = "native-patch";
    deps.applyNativePatch();

    stage = "native-verify";
    deps.checkNativePatch();

    stage = "gateway-restart";
    deps.restartScopedGateway();

    return {
      status: "PASS",
      stage: "applied",
      mutationStarted: true,
      rollbackRequired: false,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      reason: null,
      rollbackReason: null,
      restoreValidationReason: null,
      restoreMismatches: null,
    };
  } catch (error) {
    // Only a failure at or after the mutation boundary may restore anything.
    const rollbackRequired = mutationStarted;
    const report = {
      status: "FAIL",
      stage,
      mutationStarted,
      rollbackRequired,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      reason: deps.classifyReason(error),
      rollbackReason: null,
      // R11: a restore failure and a restore-VALIDATION failure are distinct
      // facts and are never collapsed into one another.
      restoreValidationReason: null,
      restoreMismatches: null,
    };
    if (!rollbackRequired) return report;
    report.rollbackAttempted = true;
    try {
      // R11: restore the exact transaction preimage. The historical r12/T1
      // baseline is NOT a rollback target; it is recovery evidence.
      //
      // The snapshot is re-verified first, so a snapshot altered between capture
      // and rollback is refused instead of trusted.
      deps.verifyTransactionSnapshot(snapshot);
      deps.restoreTransactionSnapshot(snapshot);
    } catch (rollbackError) {
      // A failed rollback must never mask the failure that triggered it.
      report.rollbackReason = deps.classifyReason(rollbackError);
      return report;
    }
    // R11: a completed restore is not a successful rollback. The live runtime
    // is compared against the snapshot, and the gateway is observed afterwards
    // so a watcher or supervisor restart cannot be mistaken for a restored one.
    let verdict;
    try {
      deps.restartScopedGateway();
      verdict = deps.verifyLiveRestore(snapshot);
    } catch (validationError) {
      report.rollbackReason ??= deps.classifyReason(validationError);
      report.restoreValidationReason = RESTORE_UNVERIFIED;
      return report;
    }
    if (!verdict?.restored) {
      report.restoreValidationReason = RESTORE_UNVERIFIED;
      report.restoreMismatches = verdict?.mismatches ?? null;
      return report;
    }
    report.rollbackSucceeded = true;
    return report;
  }
}

/**
 * Classify a failure into a fixed, disclosable reason code.
 *
 * Identifier values, config bodies, secrets and raw child-process stderr must
 * never reach model-visible output, so only known static diagnostics are
 * named and everything else collapses to PREFLIGHT_REJECTED.
 */
export const KNOWN_REASONS = [
  "governance instructions drift",
  "Governance plugin asset",
  "Governance plugin entrypoint",
  "Governance plugin manifest",
  "Policy drift",
  "EXECUTION_STATE_UNKNOWN",
  "INVALID_IDENTIFIER_FILE",
  "GATEWAY_NOT_ACTIVE",
  "permission",
  "EACCES",
  "ENOENT",
];

export function classifyApplyReason(error) {
  const output = `${error?.stderr ?? ""}${error?.message ?? ""}${error?.code ?? ""}`;
  return (
    KNOWN_REASONS.find((reason) => output.includes(reason)) ?? "APPLY_REJECTED"
  );
}
