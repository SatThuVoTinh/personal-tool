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
// Every runtime effect is injected so the invariant is testable without WSL,
// systemctl, or a live OpenClaw process. This module performs no I/O itself.

/** Ordered stages. The reported `stage` on failure is the one that threw. */
export const APPLY_STAGES = [
  "identifiers",
  "builder-preflight",
  "builder-apply",
  "quarantine-prune",
  "native-backup-prune",
  "native-patch",
  "native-verify",
  "gateway-restart",
];

/**
 * The first stage that writes to the live runtime. `configure.mjs` returns for
 * mode `preflight` before its first mutating call, so every stage before this
 * one is provably zero-mutation.
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
  try {
    stage = "identifiers";
    identifiers = deps.readIdentifiers();

    // Reuse the builder's own zero-mutation preflight so a policy or config
    // drift is rejected before the first write, exactly as operator-preflight
    // does. This is the stage that was previously missing here.
    stage = "builder-preflight";
    deps.runBuilder("--preflight", identifiers);

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
    };
    if (!rollbackRequired) return report;
    report.rollbackAttempted = true;
    try {
      deps.restoreNativePatch();
      await deps.restoreT1RuntimeFiles(identifiers);
      deps.restartScopedGateway();
      deps.validateConfig();
      report.rollbackSucceeded = true;
    } catch (rollbackError) {
      // A failed rollback must never mask the failure that triggered it.
      report.rollbackReason = deps.classifyReason(rollbackError);
    }
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
