// M12/T9 F-560 (R10-T07-6) / F-489 (R9-L12-3) — ONE resolution rule for the
// operator's state root, and ONE way to disclose the root a driver resolved.
//
// F-219 made the machine-specific state root an OPERATOR INPUT. Each driver
// then read it as `process.env.ZINK_OPERATOR_STATE_DIR ?? process.argv[2]`,
// which means an ambient value from the operator's shell profile OUTRANKED the
// root they typed on the command line: an operator whose profile exports
// `/root/A` and who ran the destructive command against `/root/B` silently got
// `/root/A`, and no report field named the root that was actually used. That is
// the precedence half of F-560, and the same shape is why F-556 (a positional
// root refused by a driver that documents it) and F-489 (a driver that read
// neither the environment nor the first argument) were filed separately.
//
// The rule stated here, once:
//
//   1. a TYPED argument outranks the environment, because a stale export must
//      never redirect a destructive command away from the root it names;
//   2. the environment is the second source, never a default;
//   3. when neither names a root the driver refuses with STATE_DIR_NOT_NAMED -
//      it never guesses a machine path (F-219);
//   4. every driver discloses `resolved_root_fingerprint` (a digest, so the
//      report stays free of paths) and `state_root_source` (which input won),
//      so the operator can see WHICH root a run resolved without reading it.
//
// This module performs no I/O and has no side effect when it is executed: it is
// imported by the drivers and spawned by the F-219 lane, which requires every
// tracked fixture to terminate without input.
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";

/** The refusal every driver names when no root was given. */
export const STATE_DIR_NOT_NAMED = "STATE_DIR_NOT_NAMED";

/** How much of the sha256 identifies a root. A label, never a path. */
export const ROOT_FINGERPRINT_LENGTH = 16;

function isFlag(argument) {
  return typeof argument === "string" && argument.startsWith("--");
}

/**
 * Split a driver's argv into the state root the operator named and the flag
 * arguments the driver's own parser owns.
 *
 * The root is the first NON-FLAG argument. A flag is never a root, so a driver
 * that also has a strict flag parser (`operator-rollback.mjs`) can hand `rest`
 * to it without the positional being reported as an unsupported argument.
 *
 * `valueFlags` names the flags that take their value as the NEXT argument, so
 * that value can never be mistaken for the positional root.
 */
export function resolveStateRoot({
  argv = [],
  env = process.env,
  valueFlags = [],
} = {}) {
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (isFlag(argument)) {
      if (valueFlags.includes(argument)) index += 1;
      continue;
    }
    return {
      stateDir: argument,
      source: "argument",
      rest: [...argv.slice(0, index), ...argv.slice(index + 1)],
    };
  }
  const fromEnvironment = env?.ZINK_OPERATOR_STATE_DIR;
  if (typeof fromEnvironment === "string" && fromEnvironment !== "")
    return {
      stateDir: fromEnvironment,
      source: "environment",
      rest: [...argv],
    };
  return { stateDir: null, source: null, rest: [...argv] };
}

/**
 * The identity of a resolved root, safe to print.
 *
 * A report is pasted into terminals, logs and cards, and the state root is a
 * machine path. The digest is what lets an operator (or a lane) tell two roots
 * apart without the path ever being written down.
 */
export function resolvedRootFingerprint(stateDir) {
  return createHash("sha256")
    .update(path.resolve(stateDir))
    .digest("hex")
    .slice(0, ROOT_FINGERPRINT_LENGTH);
}

/** The two fields every mutating driver adds to the record it prints. */
export function rootDisclosure(stateDir, source) {
  return {
    resolved_root_fingerprint: resolvedRootFingerprint(stateDir),
    state_root_source: source,
  };
}
