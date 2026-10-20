// The transaction an apply is bound to (M12/T9 F-111).
//
// `configure.mjs --apply` is reachable ONLY through the apply orchestration.
// The builder refuses a bare `--apply` (`APPLY_REQUIRES_TRANSACTION`) because
// the transaction snapshot, the native patch, the byte verification and the
// gateway restart are the ORCHESTRATION's stages: without a transaction the
// documented deploy path could skip every one of them.
//
// A lane that drives the builder directly therefore has to take the same
// transaction the orchestration takes and pass its attempt id. This helper is
// exactly that step, and it calls the SAME two functions the operator driver
// calls (`operator-apply.mjs`):
//
//     createTransactionSnapshot(...)  -> the read-only preimage of the roots
//     persistTransactionSnapshot(...)  -> the durable, re-read transaction record
//
// Nothing here weakens the control:
//   * the transaction is a real record under `<stateDir>/operator/m7-t2/`,
//     written 0o600 inside a 0o700 directory and read back before it is
//     returned, so a transaction that cannot be re-read never authorizes an
//     apply;
//   * every call produces a NEW attempt id, because the builder marks the
//     transaction it is given as SPENT (`APPLY_ALREADY_SPENT`), exactly as it
//     does on the live path;
//   * the snapshot is taken by the production helper, so a lane cannot hand
//     the builder a fabricated transaction id.
//
// `runtimeRoot` and `systemdRoot` are the OTHER governed roots of the apply:
// the OpenClaw runtime bundle and the systemd user directory that carries the
// unit drop-in. A lane that drives the builder against a synthetic tree names
// synthetic roots.
//
// WHY THE RUNTIME ROOT IS MATERIALIZED HERE
//
// `persistTransactionSnapshot` writes the preimage directory only when the
// snapshot holds at least one file that EXISTED, and then syncs that
// directory. A snapshot of an empty state root therefore has no preimage
// directory to sync, and the persistence fails with ENOENT before the record is
// written - so a FIRST apply (the state root does not exist yet) cannot take a
// transaction at all. That is a defect in
// `integrations/openclaw/topology/lib/transaction-snapshot.mjs` (the preimage
// directory is created only inside the per-file branch); it is reported to the
// topology owner and NOT repaired here, because that module is not this
// agent's write scope.
//
// The helper therefore gives the transaction a runtime root that is shaped
// like the live one: the patched runtime files exist there, so the preimage
// holds real bytes and the rollback target is a real one. This is the same
// fixture the band's own F-106 lane builds ("a runtime shaped like the live
// one"), and it changes NOTHING about what the builder does: the builder
// never writes into the runtime root, so a lane's claim about the builder's
// behaviour is the same whether the root is populated or not.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { nativePatchedRuntimeRelatives } from "../../integrations/openclaw/topology/lib/native-patch.mjs";
import {
  createTransactionSnapshot,
  persistTransactionSnapshot,
} from "../../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

/**
 * Give the synthetic runtime root the files the live runtime carries, so the
 * transaction's preimage holds real bytes. Existing files are never touched.
 */
function materializeRuntimeRoot(runtimeRoot) {
  for (const relative of nativePatchedRuntimeRelatives()) {
    const target = path.join(runtimeRoot, relative);
    if (existsSync(target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, `// ${relative}\n`);
  }
}

/**
 * Take the transaction an apply is bound to, and return its attempt id.
 *
 * @param {object} roots
 * @param {string} roots.stateDir the governed state root the apply writes
 * @param {string} roots.runtimeRoot the governed OpenClaw runtime root
 * @param {string|null} [roots.systemdRoot] the governed systemd user root
 * @returns {string} the attempt id the builder accepts as `--apply-transaction`
 */
export function takeApplyTransaction({
  stateDir,
  runtimeRoot,
  systemdRoot = null,
}) {
  materializeRuntimeRoot(runtimeRoot);
  const snapshot = createTransactionSnapshot({
    stateDir,
    runtimeRoot,
    systemdRoot,
  });
  const transaction = persistTransactionSnapshot(stateDir, snapshot, {
    createdAt: new Date().toISOString(),
  });
  return transaction.attemptId;
}
