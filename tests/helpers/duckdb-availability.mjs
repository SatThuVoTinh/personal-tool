// Shared external-runtime availability probing for the test suites.
//
// The DuckDB gates are REAL execution gates: they assert rows that only a live
// DuckDB engine can produce. When the engine is not installed, `execFileSync`
// raises `ENOENT` and the bridge correctly reports `DUCKDB_ENGINE_NOT_AVAILABLE`
// — the production classification is right and must not change.
//
// The defect was in the harness: neither DuckDB suite probed for the engine, so
// on a host without it the gates reported FAIL. A missing external runtime is
// `NOT RUN`, never a pass and never a regression. That is what `AGENTS.md`
// requires and what the R14 suite already does.
//
// This module performs no mutation and makes no assertion. It only reports
// whether the engine can be executed, so a caller can turn an unavailable gate
// into an explicit skip while still asserting the fail-closed contract, which is
// verifiable on every host.

import { execFileSync } from "node:child_process";

/**
 * M12/T9 F-304: the probe used to fold EVERY failure into "not installed", so
 * a hanging, broken or mis-installed engine retired six SQL gates behind a
 * skip that asserted a factually wrong reason, and the lane still exited zero.
 * The cause is now reported, and only an ABSENT binary is a NOT RUN.
 */
export const DUCKDB_ENGINE_STATUS = Object.freeze({
  AVAILABLE: "AVAILABLE",
  NOT_INSTALLED: "NOT_INSTALLED",
  BROKEN: "BROKEN",
});

/**
 * Classify one presence probe.
 *
 * `ENOENT` is the only "the engine is not on this host" signal. Every other
 * failure — a timeout, a non-zero exit, a permission fault — means the engine
 * IS installed and does not answer, which is a FAILURE of the lane, not an
 * environment limitation.
 */
export function classifyDuckDbEngineProbe(probe) {
  try {
    probe();
    return { status: DUCKDB_ENGINE_STATUS.AVAILABLE, detail: null };
  } catch (error) {
    const code = error?.code ?? null;
    if (code === "ENOENT") {
      return {
        status: DUCKDB_ENGINE_STATUS.NOT_INSTALLED,
        detail: "DuckDB engine is not installed on this host (NOT RUN)",
      };
    }
    return {
      status: DUCKDB_ENGINE_STATUS.BROKEN,
      detail:
        `DuckDB engine is installed but the presence probe failed ` +
        `(${code ?? "unknown error"}): an installed-but-broken engine is a ` +
        `FAILURE, not NOT RUN`,
    };
  }
}

let cached;

/**
 * True when a DuckDB executable can actually be executed, not merely present on
 * PATH. Probing by execution is what the bridge itself does, so the harness and
 * the bridge agree on availability instead of disagreeing.
 */
export function duckDbEngineStatus() {
  if (cached !== undefined) return cached;
  cached = classifyDuckDbEngineProbe(() =>
    execFileSync("duckdb", ["-c", "SELECT 1"], {
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  if (cached.status === DUCKDB_ENGINE_STATUS.BROKEN) {
    process.emitWarning?.(cached.detail, { code: "DUCKDB_ENGINE_BROKEN" });
  }
  return cached;
}

export function duckDbEngineAvailable() {
  return duckDbEngineStatus().status === DUCKDB_ENGINE_STATUS.AVAILABLE;
} /**
 * `false` when the engine can run, the skip reason when it is genuinely
 * absent, and `false` when it is INSTALLED BUT BROKEN — a broken engine must
 * not be retired behind a skip, the gate has to run and fail.
 */
export const duckDbSkip = (status = duckDbEngineStatus()) =>
  status.status === DUCKDB_ENGINE_STATUS.AVAILABLE
    ? false
    : status.status === DUCKDB_ENGINE_STATUS.NOT_INSTALLED
      ? status.detail
      : false;
