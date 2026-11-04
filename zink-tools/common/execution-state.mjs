/**
 * Execution fidelity vocabulary.
 *
 * F-279 (R7-C2-04): the provider adapters in this module are contract test
 * doubles. Measured at HEAD, five of them (and later a sixth) returned a
 * provider-shaped envelope with no field that distinguished fabricated output
 * from real provider output. Two of them stamped a provider lifecycle status
 * and state, but those values describe the fabricated job's own lifecycle, not
 * whether a real provider ran — so a governed consumer had nothing to refuse.
 *
 * The shared DuckDB bridge in this same module already stamped a fidelity
 * marker (`FIXTURE_CONTRACT_EXECUTED`) and its own comment states that "a
 * governed consumer that needs business data must see FIXTURE_CONTRACT_EXECUTED
 * and refuse to treat it as live". The rule was therefore already known; the
 * provider envelopes simply did not carry it.
 *
 * One vocabulary, one marker, one refusal helper:
 * - every simulated envelope carries `execution_state`;
 * - `assertRealExecution` refuses anything that is not a real execution;
 * - the marker set is derived from the values the repository actually emits,
 *   so a new simulated envelope cannot silently omit the field.
 */

/** The only value a governed consumer may treat as live provider output. */
export const EXECUTION_STATE_REAL = "REAL_EXECUTED";

/**
 * The marker the contract test doubles carry. It is the same spelling the
 * DuckDB bridge already emits for a contract-fixture execution, so a consumer
 * has one value to recognise rather than one per adapter.
 */
export const EXECUTION_STATE_SIMULATED = "FIXTURE_CONTRACT_EXECUTED";

/**
 * Every execution state this repository emits that is NOT a real provider
 * execution. The DuckDB bridge's in-process simulation marker is here too:
 * a simulated row set is not a real one however it is labelled.
 */
export const SIMULATED_EXECUTION_STATES = Object.freeze([
  EXECUTION_STATE_SIMULATED,
  "TEST_SIMULATION",
]);

export class ExecutionStateError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ExecutionStateError";
    this.code = code;
  }
}

/**
 * Whether a value names a real provider execution.
 *
 * @param {unknown} executionState
 * @returns {boolean}
 */
export function isRealExecution(executionState) {
  return executionState === EXECUTION_STATE_REAL;
}

/**
 * Refuses an envelope that does not name a real provider execution.
 *
 * This is the governed-consumer half of the rule: a result that needs
 * business data must be refused rather than presented, and the refusal is
 * by name rather than by the absence of a field.
 *
 * @param {{execution_state?: unknown}} result
 * @param {string} [context] - what the consumer needed the data for
 * @returns {void}
 */
export function assertRealExecution(result, context = "business data") {
  const state = result?.execution_state;
  if (isRealExecution(state)) return;
  const described =
    typeof state === "string" && state.length > 0
      ? `execution_state '${state}'`
      : "no execution_state at all";
  throw new ExecutionStateError(
    "EXECUTION_NOT_REAL",
    `Refusing to present ${described} as provider execution for ${context}; only '${EXECUTION_STATE_REAL}' is a real execution.`,
  );
}
