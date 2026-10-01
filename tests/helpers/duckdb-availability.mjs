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

let cached;

/**
 * True when a DuckDB executable can actually be executed, not merely present on
 * PATH. Probing by execution is what the bridge itself does, so the harness and
 * the bridge agree on availability instead of disagreeing.
 */
export function duckDbEngineAvailable() {
  if (cached !== undefined) return cached;
  try {
    execFileSync("duckdb", ["-c", "SELECT 1"], {
      timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    cached = true;
  } catch {
    cached = false;
  }
  return cached;
}

/** `false` when the engine can run, otherwise the skip reason. */
export const duckDbSkip = () =>
  duckDbEngineAvailable()
    ? false
    : "DuckDB engine not installed on this host (NOT RUN)";
