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
// R12 adds a third invariant, because an in-memory snapshot does not survive
// this process dying mid-mutation:
//
//     MUTATION REQUIRES A DURABLE TRANSACTION, AND A CRASH IS NEVER SILENT
//
// The snapshot is persisted and re-read before mutation, the transaction is
// marked complete only after a verified outcome, and a new apply refuses to
// start when it finds a transaction that started but never completed. An orphan
// is reported by ID and left in place: recovery is an explicit owner decision,
// never an automatic one.
//
// Every runtime effect is injected so both invariants are testable without WSL,
// systemctl, or a live OpenClaw process. This module performs no I/O itself.
import {
  ORPHANED_TRANSACTION,
  RESTORE_UNVERIFIED,
  ROLLBACK_SAFETY_UNAVAILABLE,
  TRANSACTION_STATUS,
} from "../../lib/transaction-snapshot.mjs";

/**
 * Reported when the apply returned success but the live runtime does not reflect
 * it. A self-reported success is not evidence of a successful deployment.
 */
export const APPLY_NOT_VERIFIED = "APPLY_NOT_VERIFIED";

/** Ordered stages. The reported `stage` on failure is the one that threw. */
export const APPLY_STAGES = [
  "identifiers",
  "builder-preflight",
  "orphan-check",
  "transaction-snapshot",
  "builder-apply",
  "quarantine-prune",
  "native-backup-prune",
  "native-patch",
  "native-verify",
  "gateway-restart",
  "runtime-verify",
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
  // `catch` needs the transaction preimage and its record. A `let` inside the
  // `try` block is not visible to its own `catch`.
  let snapshot;
  let transaction;
  try {
    stage = "identifiers";
    identifiers = deps.readIdentifiers();

    // Reuse the builder's own zero-mutation preflight so a policy or config
    // drift is rejected before the first write, exactly as operator-preflight
    // does. This is the stage that was previously missing here.
    stage = "builder-preflight";
    deps.runBuilder("--preflight", identifiers);

    // R12: refuse to start a new apply while a previous transaction is
    // unresolved. A transaction that started but never completed means the
    // process may have died mid-mutation, so the live runtime cannot be assumed
    // clean. The orphan is reported by ID and is neither deleted, resumed nor
    // rolled back: recovery is an explicit owner decision.
    stage = "orphan-check";
    const orphans = deps.findOrphanedTransaction();
    if (orphans.length > 0)
      return {
        status: "FAIL",
        stage,
        mutationStarted: false,
        rollbackRequired: false,
        rollbackAttempted: false,
        rollbackSucceeded: false,
        reason: ORPHANED_TRANSACTION,
        orphanedTransactionIds: orphans.map((entry) => entry.attemptId),
        rollbackReason: null,
        restoreValidationReason: null,
        restoreMismatches: null,
        attemptId: null,
        transactionStatus: null,
      };

    // R11: establish the rollback target BEFORE the first mutating call. A
    // transaction snapshot is the exact live runtime state immediately before
    // this apply, so rollback can restore what was actually there rather than a
    // historical r12/T1 baseline. It is read-only, so taking it is not itself a
    // mutation. If it cannot be created and verified, nothing below may run.
    //
    // R12: the snapshot is also PERSISTED, and re-read to prove durability,
    // before mutation. An in-memory snapshot does not survive this process
    // dying mid-apply, which would leave no recovery target at all.
    stage = "transaction-snapshot";
    try {
      snapshot = deps.createTransactionSnapshot();
      deps.verifyTransactionSnapshot(snapshot);
      transaction = deps.persistTransactionSnapshot(snapshot);
      deps.verifyTransactionSnapshot(transaction.snapshot);
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
        orphanedTransactionIds: null,
        rollbackReason: null,
        restoreValidationReason: null,
        restoreMismatches: null,
        attemptId: null,
        transactionStatus: null,
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

    // R12: the apply completed. Verify the live runtime, and only then mark the
    // transaction complete — an unverified apply must not be able to close its
    // own transaction and erase the evidence that it was in flight.
    stage = "runtime-verify";
    // M10/T2-R8: the expectation is what the runtime must look like AFTER this
    // apply, not a diff of what happened to change. `verifyLiveRestore` now
    // fails closed when no expectation is declared, so a self-reported apply
    // can never license itself.
    const finalVerdict = deps.verifyLiveRestore(snapshot, {
      postApply: true,
      expected: deps.expectedNativePostImage(),
    });
    if (!finalVerdict?.applied) {
      // The apply returned success but the runtime does not reflect it. Treat
      // this as a failure at or after mutation: roll back and report honestly.
      const failure = {
        status: "FAIL",
        stage,
        mutationStarted: true,
        rollbackRequired: true,
        rollbackAttempted: true,
        rollbackSucceeded: false,
        reason: APPLY_NOT_VERIFIED,
        orphanedTransactionIds: null,
        rollbackReason: null,
        restoreValidationReason: null,
        restoreMismatches: null,
        attemptId: transaction?.attemptId ?? null,
        transactionStatus: transaction?.status ?? null,
      };
      return attemptRollback(deps, snapshot, failure);
    }

    // R12: record the transaction as complete. The preimage is retained; there
    // is no repository retention policy for transaction state yet, and silently
    // deleting a recovery target is the behaviour R11/R12 exist to prevent.
    deps.markTransactionComplete(transaction.attemptId);

    return {
      status: "PASS",
      stage: "applied",
      mutationStarted: true,
      rollbackRequired: false,
      rollbackAttempted: false,
      rollbackSucceeded: false,
      reason: null,
      orphanedTransactionIds: null,
      rollbackReason: null,
      restoreValidationReason: null,
      restoreMismatches: null,
      attemptId: transaction?.attemptId ?? null,
      transactionStatus: TRANSACTION_STATUS.COMPLETE,
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
      orphanedTransactionIds: null,
      // R11: a restore failure and a restore-VALIDATION failure are distinct
      // facts and are never collapsed into one another.
      rollbackReason: null,
      restoreValidationReason: null,
      restoreMismatches: null,
      attemptId: transaction?.attemptId ?? null,
      transactionStatus: transaction?.status ?? null,
    };
    if (!rollbackRequired) return report;
    return attemptRollback(deps, snapshot, report);
  }
}

/**
 * R11 rollback semantics, factored so the failure path and the
 * apply-returned-but-unverified path share one implementation.
 *
 * Restores the exact transaction preimage, then licenses success only after the
 * live bytes match. A restore that returns while the runtime differs is a
 * failure, which is precisely the false positive the R7 rule accepted.
 */
function attemptRollback(deps, snapshot, report) {
  report.rollbackAttempted = true;
  try {
    // The snapshot is re-verified first, so a snapshot altered between capture
    // and rollback is refused instead of trusted.
    deps.verifyTransactionSnapshot(snapshot);
    deps.restoreTransactionSnapshot(snapshot);
  } catch (rollbackError) {
    // A failed rollback must never mask the failure that triggered it.
    report.rollbackReason = deps.classifyReason(rollbackError);
    return report;
  }
  // The gateway is restarted and observed before validation, so a watcher or
  // supervisor restart cannot be mistaken for a restored runtime.
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
  // R12: the rollback was verified, so this transaction is resolved. It is
  // marked complete so it cannot be mistaken for a crash-orphan and block the
  // next apply.
  try {
    deps.markTransactionComplete(report.attemptId);
    report.transactionStatus = TRANSACTION_STATUS.COMPLETE;
  } catch (error) {
    // A verified rollback with an unmarkable record leaves an orphan. That is
    // reported rather than hidden: the next apply will refuse and require an
    // explicit recovery decision, which is the safe outcome.
    report.restoreValidationReason = RESTORE_UNVERIFIED;
    report.rollbackReason ??= deps.classifyReason(error);
  }
  report.rollbackSucceeded = true;
  return report;
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
