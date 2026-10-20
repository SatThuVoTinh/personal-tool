// M12/T9 F-159: the ONE classifier for a builder refusal.
//
// Both operator drivers exec the SAME child — `configure.mjs --preflight` —
// and both used to carry their own hand-maintained list of the refusals that
// child can emit:
//
//   - operator-preflight.mjs named 27 classes,
//   - apply-orchestration.mjs named 11.
//
// Every refusal only one of them named degraded to the meaningless
// `PREFLIGHT_REJECTED` / `APPLY_REJECTED`, so the operator got a different
// (or no) diagnosis for the identical refusal depending on which driver
// reported it. The two lists also drifted in the other direction: the
// preflight classifier read only the child's stderr, so its own locally
// raised `INVALID_IDENTIFIER_FILE` collapsed to `PREFLIGHT_REJECTED` while the
// apply list named it.
//
// This module is the single list and the single matching rule. The two
// drivers differ only in the FALLBACK code they report for a refusal no
// class names — that difference is the mode's own vocabulary, not a
// difference in diagnosis.
//
// Every entry is a STATIC diagnostic literal (a class name, a file name, an
// error code). No message body, path, config value or identifier is ever
// matched or emitted, so classifying a refusal can never disclose content.
export const KNOWN_REFUSAL_REASONS = Object.freeze([
  // Ordered most-specific first: `find` wins the tie, so a mode drift on the
  // hotfix is reported as the hotfix and not as a generic mode class.
  "governance instructions drift",
  "Agent governance instructions drift",
  "Governance plugin asset",
  "Governance plugin entrypoint",
  "Governance plugin manifest",
  "Governance plugin package",
  "Gemini stream hotfix utility",
  "Password-store resolver",
  "Auth order plan",
  "Auth SecretRef plan",
  "Systemd drop-in",
  "Governance identity key",
  "T2 backup manifest",
  "ROUTER_HOST_UNAVAILABLE",
  "ROUTER_PORT_UNAVAILABLE",
  "ROUTER_API_KEY_UNAVAILABLE",
  "must be a numeric Discord snowflake",
  "surface IDs must be distinct",
  "Existing config must be canonical JSON",
  "Ledger corruption",
  "INVALID_IDENTIFIER_FILE",
  "GATEWAY_NOT_ACTIVE",
  "GATEWAY_UNIT_NOT_RELOADED",
  "symlink",
  "mode drift",
  "Policy drift",
  "EXECUTION_STATE_UNKNOWN",
  "permission",
  "EACCES",
  "ENOENT",
]);

/**
 * The text a refusal is searched in: the child's stderr, its message and its
 * error code.
 *
 * Every entry in KNOWN_REFUSAL_REASONS is a STATIC diagnostic literal (a
 * class name, a file name, an error code). No message body, path, config
 * value or identifier is ever matched or emitted, so classifying a refusal
 * can never disclose content.
 */
export function refusalOutput(error) {
  return `${error?.stderr ?? ""}${error?.message ?? ""}${error?.code ?? ""}`;
}

/**
 * M12/T9 F-159: the two drivers must name the SAME classes.
 *
 * The preflight driver keeps its own statement of the classes it names (that
 * list is pinned by a tracked lane), and the apply driver reads the list
 * below. This check compares them IN ORDER — the order is part of the
 * contract, because `find` wins the tie and the most specific class must be
 * reported first. A drift is a hard failure at load time: the driver stops
 * instead of reporting a class the other driver does not know.
 */
export function assertSameRefusalClasses(local, shared) {
  const same =
    Array.isArray(local) &&
    Array.isArray(shared) &&
    local.length === shared.length &&
    local.every((entry, index) => entry === shared[index]);
  if (!same)
    throw new Error(
      "REFUSAL_CLASS_SET_DRIFT: the operator drivers name different refusal classes",
    );
  return true;
}

/**
 * Classify a child failure into a fixed, disclosable reason code.
 *
 * The child's stderr, its message and its error code are all searched, so a
 * refusal is named the same way in every mode. A refusal no class names
 * collapses to the caller's fallback code, which is the fail-closed answer:
 * an unnamed refusal is never disclosed verbatim.
 */
export function classifyRefusal(error, fallback) {
  return (
    KNOWN_REFUSAL_REASONS.find((reason) =>
      refusalOutput(error).includes(reason),
    ) ?? fallback
  );
}
