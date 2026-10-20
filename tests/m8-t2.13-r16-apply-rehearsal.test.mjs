// M8/T2.2-R16 — full apply rehearsal on an exact clone of the live R7 runtime.
//
// Two deployment attempts have been consumed by defects that only review found.
// The one operation that has never executed anywhere is the R7 native predecessor
// WRITE to R10: R14 proved the transformation is derivable in memory and that
// preflight recognizes the R7 host, but the write itself has never run.
//
// This rehearses the COMPLETE corrected apply path against that runtime, with
// every host-touching effect injected.
//
// ISOLATION. The runtime is reached through a private mount namespace in which
// `/home/hoang_vinh/.openclaw-zink`, the OpenClaw package root and the systemd
// user unit directory are each overlaid on the LIVE directories. The lower layer
// IS the live runtime, so byte-exactness is structural rather than copied, and
// every write lands in the overlay's upper layer. The namespace is created by
// `unshare --map-root-user`; it cannot outlive this process, so a crash cannot
// leak a mount into the host, and the running gateway — which never entered the
// namespace — keeps the real inodes throughout.
//
// The real `applyRuntime` orchestration, the real `configure.mjs` as a child
// process, the real native patcher and the real transaction machinery are all
// used unmodified. `operator-apply.mjs` is deliberately NOT invoked: it binds
// absolute live paths and a real `systemctl` restart, so using it would be
// exactly the mutation this rehearsal forbids. Only the gateway restart is
// injected, because no test may restart the live gateway.
//
// These tests require WSL, where the live runtime exists. They skip rather than
// pass vacuously elsewhere; `r16-rehearsal.mjs` is what runs them for real.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  APPLY_NOT_VERIFIED,
  applyRuntime,
  classifyApplyReason,
} from "../integrations/openclaw/topology/fixtures/runtime-regression/apply-orchestration.mjs";
import {
  NATIVE_DISCORD_CHANNEL_RELATIVE,
  NATIVE_RUNTIME_PINS,
  applyNativePatch,
  checkNativePatch,
  inspectNativePatch,
  transformNativeSource,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";
import {
  RESTORE_UNVERIFIED,
  createTransactionSnapshot,
  findOrphanedTransaction,
  loadTransaction,
  markTransactionComplete,
  persistTransactionSnapshot,
  restoreTransactionSnapshot,
  verifyLiveRestore,
  verifyTransactionSnapshot,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";
import {
  assertNoSymlinkComponents,
  parseIdentifiers,
} from "../integrations/openclaw/lib/policy.mjs";
import {
  fingerprint,
  R16_COMPONENTS,
  R16_ROOTS,
  R16_TREES,
} from "./helpers/r16-fingerprint.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const { stateDir: STATE_DIR, runtimeRoot: RUNTIME_ROOT } = R16_ROOTS;
const REHEARSAL = process.env.R16_REHEARSAL_ROOT ?? "";
const NATIVE_BACKUP = path.join(STATE_DIR, "operator", "m7-t2", "native-r12");
const SELECTION = "selection-DopzNY3I.js";
const ANNOUNCE_FILE = "subagent-announce-Bh1QyKiE.js";
const BRIDGE_FILE = "zink-governance-boundary.mjs";
const IDENTIFIERS_PATH = path.join(
  STATE_DIR,
  "operator",
  "m7-t2",
  "discord-identifiers.json",
);
// The retained historical record. It is evidence, not state to clean up, so it is
// named here rather than pattern-matched away.
const RETAINED_HISTORICAL_TRANSACTION = "txn-02edeb0bf364e3931fffd9e1e5fe904b";

const R7_SELECTION =
  "b431673602bf2f6eca55f8635f226dddbf06cf19e83c5488cc154d4db3d94512";
const R10_SELECTION =
  "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5";
const BASELINE_SELECTION =
  "a5698c5523e87ad454cf89e4a5c940689403f7b6eac6f3d14c7205f1e3071ed6";
const ANNOUNCE =
  "e3b110f77cbd52ec86e935ff9ee3926b2730802a1cd4d42e65c56624dc19dc87";
const R7_BRIDGE =
  "33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412";
const CURRENT_BRIDGE =
  "d88bff80aeb3d7531e5a0dceba4e7ba856d085e64a87cbb414c9f295284d81e3";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readDigest = (file) => sha256(readFileSync(file, "utf8"));

// The rehearsal only runs inside the mount namespace the driver creates. Outside
// it these tests would touch the live runtime, which is the one thing R16 forbids.
const skip = REHEARSAL
  ? false
  : "requires the R16 rehearsal mount namespace (run r16-rehearsal.mjs)";

// ---------------------------------------------------------------------------
// Overlay lifecycle
// ---------------------------------------------------------------------------

const OVERLAYS = Object.freeze([
  { key: "state", lower: STATE_DIR },
  { key: "runtime", lower: RUNTIME_ROOT },
  { key: "systemd", lower: R16_ROOTS.systemdDir },
]);

function unmountAll() {
  for (const { lower } of OVERLAYS) {
    try {
      execFileSync("umount", ["-l", lower], { stdio: "ignore" });
    } catch {
      // Already unmounted, or never mounted.
    }
  }
}

/**
 * Re-overlay the live runtime from scratch, so every test begins from the exact
 * live R7 bytes and no test can observe another's writes.
 */
function mountClones() {
  unmountAll();
  for (const { key, lower } of OVERLAYS) {
    const base = path.join(REHEARSAL, key);
    rmSync(base, { recursive: true, force: true });
    mkdirSync(path.join(base, "upper"), { recursive: true });
    mkdirSync(path.join(base, "work"), { recursive: true });
    execFileSync(
      "mount",
      [
        "-t",
        "overlay",
        `zink-r16-${key}`,
        "-o",
        `lowerdir=${lower},upperdir=${path.join(base, "upper")},workdir=${path.join(base, "work")}`,
        lower,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  }
}

process.on("exit", unmountAll);

/** The digests that identify a given runtime state. */
function stateDigests() {
  const extension = path.join(STATE_DIR, "extensions", "zink-governance");
  return {
    config: readDigest(path.join(STATE_DIR, "openclaw.json")),
    entrypoint: readDigest(path.join(extension, "index.mjs")),
    ...nativeDigests(),
  };
}

/**
 * Every file the apply actually WROTE, read from the overlay's upper layer.
 *
 * Overlay copy-up means a lower-layer file appears in the upper layer exactly
 * when it is written, and only then. That makes the upper layer a deterministic
 * write record — where a filesystem watcher would only ever be a best-effort
 * sample — and it is how R16 shows the native write sequence.
 */
function writtenFiles(key, relative = "") {
  const base = path.join(REHEARSAL, key, "upper", relative);
  if (!existsSync(base)) return [];
  const found = [];
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const child = path.join(directory, name);
      const label = prefix ? `${prefix}/${name}` : name;
      if (lstatSync(child).isDirectory()) visit(child, label);
      else found.push(label);
    }
  };
  visit(base, "");
  return found;
}

/** Only the native-pinned artifacts, whose revision is a known constant. */
function nativeDigests() {
  const dist = path.join(RUNTIME_ROOT, "dist");
  return {
    selection: readDigest(path.join(dist, SELECTION)),
    announce: readDigest(path.join(dist, ANNOUNCE_FILE)),
    bridge: readDigest(path.join(dist, BRIDGE_FILE)),
  };
}

const R7_NATIVE = Object.freeze({
  selection: R7_SELECTION,
  announce: ANNOUNCE,
  bridge: R7_BRIDGE,
});

// ---------------------------------------------------------------------------
// The rehearsal dependency set
// ---------------------------------------------------------------------------

/**
 * The same dependency surface `operator-apply.mjs` wires, against the clone.
 *
 * Everything here is the REAL implementation except `restartScopedGateway`,
 * which is injected because the real one runs `systemctl --user restart` on the
 * live gateway and no rehearsal may do that.
 *
 * `fault` injects a controlled failure. Where the real code can be made to fail
 * on demand — a native write, a native verification, a predecessor recognition,
 * the config write — the fault corrupts the clone or occupies the write target
 * so the genuine code path throws. Only the effects that cannot be provoked
 * without touching the host are injected as throws.
 */
function rehearsalDeps({ fault = null } = {}) {
  const stages = [];
  const state = { gatewayRestarts: 0, builderStderr: [] };
  const record = (name) => stages.push(name);
  const roots = { stateDir: STATE_DIR, runtimeRoot: RUNTIME_ROOT };
  const run = (mode) => {
    try {
      execFileSync(process.execPath, configArgs(mode), {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
        maxBuffer: 1 << 20,
      });
    } catch (error) {
      // The builder's own diagnostics are policy text, not identifier values or
      // config bodies, and a rehearsal that fails must say why.
      state.builderStderr.push(String(error.stderr ?? error.message).trim());
      throw error;
    }
  };

  // The real identifier read, exactly as `operator-apply.mjs` performs it: the
  // component list is closed, and the parsed result — not the raw JSON keys — is
  // what decides the flag names.
  const readIdentifiers = () => readLiveIdentifiers();
  const configArgs = (mode) => builderArgs(mode);

  return {
    stages,
    state,
    deps: {
      readIdentifiers() {
        record("readIdentifiers");
        return readIdentifiers();
      },
      runBuilder(mode) {
        record(`runBuilder:${mode}`);
        if (mode === "--preflight" && fault === "builder-preflight")
          throw new Error("PREFLIGHT_POLICY_DRIFT");
        if (mode === "--apply" && fault === "config-write") {
          // The genuine fault: the state directory cannot be written, so the
          // builder fails on its first real mutation. The mode is restored before
          // the error escapes, or the rollback could not write either.
          chmodSync(STATE_DIR, 0o500);
          try {
            run(mode);
          } finally {
            chmodSync(STATE_DIR, 0o700);
          }
          throw new Error("CONFIG_WRITE_FAILED");
        }
        run(mode);
        // A crash immediately after the governance extension landed, but before
        // the stage could return: the extension is installed and unverified.
        if (mode === "--apply" && fault === "extension-write")
          throw new Error("GOVERNANCE_EXTENSION_WRITE_FAILED");
      },
      findOrphanedTransaction() {
        record("findOrphanedTransaction");
        return findOrphanedTransaction(STATE_DIR);
      },
      createTransactionSnapshot() {
        record("createTransactionSnapshot");
        return createTransactionSnapshot(roots);
      },
      verifyTransactionSnapshot(snapshot) {
        record("verifyTransactionSnapshot");
        return verifyTransactionSnapshot(snapshot);
      },
      persistTransactionSnapshot(snapshot) {
        record("persistTransactionSnapshot");
        return persistTransactionSnapshot(STATE_DIR, snapshot, {
          createdAt: "2026-09-30T00:00:00.000Z",
        });
      },
      markTransactionComplete(attemptId) {
        record("markTransactionComplete");
        return markTransactionComplete(STATE_DIR, attemptId);
      },
      pruneQuarantine() {
        record("pruneQuarantine");
        const quarantine = path.join(
          STATE_DIR,
          "operator",
          "m7-t2",
          "backups",
          "r12",
          "quarantined-t2",
        );
        if (existsSync(quarantine))
          rmSync(quarantine, { recursive: true, force: true });
      },
      pruneStaleNativeBackup() {
        record("pruneStaleNativeBackup");
        // The REAL prune, against the clone.
        if (!existsSync(NATIVE_BACKUP)) return;
        const inspection = inspectNativePatch(RUNTIME_ROOT);
        if (
          Object.values(inspection).every((entry) => entry.state === "BASELINE")
        )
          rmSync(NATIVE_BACKUP, { recursive: true, force: true });
      },
      applyNativePatch() {
        record("applyNativePatch");
        // The REAL patcher, against the clone.
        applyNativePatch(RUNTIME_ROOT, NATIVE_BACKUP);
      },
      checkNativePatch() {
        record("checkNativePatch");
        // The REAL verifier. A corruption injected after the write makes the
        // genuine verification fail rather than a stub throwing.
        if (fault === "native-verify") {
          const file = path.join(RUNTIME_ROOT, "dist", SELECTION);
          writeFileSync(file, `${readFileSync(file, "utf8")}//corrupt\n`);
          chmodSync(file, 0o644);
        }
        checkNativePatch(RUNTIME_ROOT);
      },
      restartScopedGateway() {
        // INJECTED. The real effect is `systemctl --user restart`, which would
        // restart the live gateway.
        record("restartScopedGateway");
        state.gatewayRestarts += 1;
        if (fault === "gateway-restart" && state.gatewayRestarts === 1)
          throw new Error("GATEWAY_NOT_ACTIVE");
        if (fault === "gateway-restart-persistent")
          throw new Error("GATEWAY_NOT_ACTIVE");
      },
      restoreTransactionSnapshot(snapshot) {
        record("restoreTransactionSnapshot");
        return restoreTransactionSnapshot(snapshot);
      },
      verifyLiveRestore(snapshot, options) {
        record(
          `verifyLiveRestore:${options?.postApply ? "postApply" : "rollback"}`,
        );
        if (options?.postApply && fault === "post-apply-verify")
          return { applied: false, unrestored: ["runtime-verify"] };
        // The REAL byte comparison, in both directions.
        return verifyLiveRestore(roots, snapshot, options);
      },
      classifyReason: classifyApplyReason,
    },
  };
}

/** Inject a genuine native-write failure by occupying the atomic temp target. */
function occupyNativeWriteTarget(file) {
  const target = path.join(RUNTIME_ROOT, "dist", `${file}.zink-r12-tmp`);
  writeFileSync(target, "occupied\n");
  chmodSync(target, 0o600);
  return target;
}

/** Make the clone's selection unrecognisable, so predecessor recognition fails. */
function corruptPredecessor() {
  const file = path.join(RUNTIME_ROOT, "dist", SELECTION);
  writeFileSync(file, `${readFileSync(file, "utf8")}// not R7\n`);
  chmodSync(file, 0o644);
}

/**
 * The real identifier read, exactly as `operator-apply.mjs` performs it, and the
 * argument vector it builds for the builder. The parsed result — not the raw JSON
 * keys — decides the flag names.
 */
function readLiveIdentifiers() {
  assertNoSymlinkComponents(IDENTIFIERS_PATH);
  return parseIdentifiers(JSON.parse(readFileSync(IDENTIFIERS_PATH, "utf8")));
}

function builderArgs(mode) {
  const args = [CONFIGURE, mode, "--state-dir", STATE_DIR];
  for (const [name, value] of Object.entries(readLiveIdentifiers()))
    args.push(
      `--${name.replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`)}`,
      value,
    );
  return args;
}

const FULL_STAGE_TRACE = Object.freeze([
  "readIdentifiers",
  "runBuilder:--preflight",
  "findOrphanedTransaction",
  "createTransactionSnapshot",
  "verifyTransactionSnapshot",
  "persistTransactionSnapshot",
  "verifyTransactionSnapshot",
  "runBuilder:--apply",
  "pruneQuarantine",
  "pruneStaleNativeBackup",
  "applyNativePatch",
  "checkNativePatch",
  "restartScopedGateway",
  "verifyLiveRestore:postApply",
  "markTransactionComplete",
]);

// ---------------------------------------------------------------------------
// Phase 2 — the clone is byte-exact
// ---------------------------------------------------------------------------

test(
  "R16 B/C: every in-scope component is byte-identical to the live runtime",
  { skip },
  () => {
    mountClones();
    const expected = JSON.parse(
      readFileSync(path.join(REHEARSAL, "live-fingerprint.json"), "utf8"),
    );
    const observed = fingerprint();

    // Component by component, with modes: nothing in scope may differ.
    assert.deepEqual(observed.components, expected.components);
    // Whole subtrees: the extension, the transactions, the native backup and the
    // historical r12 backup all come through unchanged.
    assert.deepEqual(observed.trees, expected.trees);
    assert.equal(observed.governanceVersion, expected.governanceVersion);
    assert.deepEqual(observed.ledger, expected.ledger);

    // The clone really is R7, recognized as an R14 predecessor.
    const inspection = inspectNativePatch(RUNTIME_ROOT);
    assert.equal(inspection[SELECTION].state, "PREDECESSOR");
    assert.equal(inspection[SELECTION].predecessorRevision, "R7");
    assert.equal(inspection[ANNOUNCE_FILE].state, "PATCHED");
    assert.deepEqual(nativeDigests(), R7_NATIVE);

    // And no unresolved transaction carried over, so the rehearsal starts clean.
    assert.deepEqual(findOrphanedTransaction(STATE_DIR), []);
    unmountAll();
  },
);

// ---------------------------------------------------------------------------
// E/F/G — the complete apply, and the native write proof
// ---------------------------------------------------------------------------

test(
  "R16 E/F/G: the complete R7 -> R10 apply succeeds on the clone",
  { skip },
  async () => {
    mountClones();
    try {
      // G, structurally: BEFORE the apply, prove the predecessor branch is the one
      // that will run, so the baseline-writing branch is unreachable.
      const before = inspectNativePatch(RUNTIME_ROOT);
      assert.equal(before[SELECTION].state, "PREDECESSOR");
      assert.ok(
        Object.values(before).some((entry) => entry.state === "PREDECESSOR"),
        "a predecessor entry is what selects the successor-write branch",
      );

      // G, by content: the plan `applyNativePatch` will execute carries only
      // successor bytes. The baseline exists inside the transform and is never a
      // write target.
      const plan = Object.entries(before)
        .filter(([, entry]) => entry.state !== "PATCHED")
        .map(([file, entry]) => ({ file, afterDigest: entry.afterDigest }));
      assert.deepEqual(plan, [{ file: SELECTION, afterDigest: R10_SELECTION }]);

      const nativeBackupBefore = readdirSync(NATIVE_BACKUP).sort();
      const selectionPath = path.join(RUNTIME_ROOT, "dist", SELECTION);

      const { stages, state, deps } = rehearsalDeps();
      const report = await applyRuntime(deps);

      // E: the stage trace is the real one, in the real order.
      assert.equal(
        report.status,
        "PASS",
        `apply failed at ${report.stage}: ${report.reason ?? ""}\n${state.builderStderr.join("\n")}`,
      );
      assert.deepEqual(stages, FULL_STAGE_TRACE);
      assert.equal(report.stage, "applied");

      // F: exact R10 bytes.
      const after = stateDigests();
      assert.equal(after.selection, R10_SELECTION, "R7 -> R10 selection write");
      assert.equal(after.announce, ANNOUNCE, "the announce was already R10");
      assert.equal(after.bridge, CURRENT_BRIDGE, "R7 -> R10 bridge write");

      // C: the bridge is the repository-generated R10 boundary, not a copy.
      assert.equal(
        after.bridge,
        readDigest(
          path.join(
            REPO,
            "integrations",
            "openclaw",
            "topology",
            "lib",
            "native-boundary.mjs",
          ),
        ),
      );

      // E: the native injection carries the R10 fields into the runtime.
      const selection = readFileSync(selectionPath, "utf8");
      assert.ok(
        selection.includes("trigger: params.trigger"),
        "trigger present",
      );
      assert.ok(
        selection.includes("transcriptPrompt: params.transcriptPrompt"),
        "transcriptPrompt present",
      );

      // G: the deterministic write history. Exactly two native files were
      // written, both at their R10 bytes, and nothing else in the runtime was
      // touched. A baseline write would have left a third written file, and the
      // fresh-patch branch — the only branch that writes a baseline — also
      // creates the backup, which is byte-identical.
      assert.deepEqual(writtenFiles("runtime"), [
        `dist/${SELECTION}`,
        `dist/${BRIDGE_FILE}`,
      ]);
      assert.deepEqual(readdirSync(NATIVE_BACKUP).sort(), nativeBackupBefore);
      assert.ok(
        !writtenFiles("state", "operator/m7-t2/native-r12").includes(
          "manifest.json",
        ),
        "no native backup was taken",
      );
      // And no native file anywhere carries the baseline bytes.
      for (const file of writtenFiles("runtime"))
        assert.notEqual(
          readDigest(path.join(REHEARSAL, "runtime", "upper", file)),
          BASELINE_SELECTION,
          `${file} is not the baseline`,
        );
    } finally {
      unmountAll();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 6 — post-apply validation
// ---------------------------------------------------------------------------

test(
  "R16 H: the applied clone passes every post-apply check",
  { skip },
  async () => {
    mountClones();
    try {
      const { deps } = rehearsalDeps();
      const report = await applyRuntime(deps);
      assert.equal(report.status, "PASS", report.reason ?? "");

      // A: config. The real builder's own validation, re-run against the clone.
      execFileSync(process.execPath, builderArgs("--preflight"), {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });

      // B: the intended R10 governance extension is installed, and the version is
      // the one the deployment targets.
      const extension = path.join(STATE_DIR, "extensions", "zink-governance");
      const entry = readFileSync(path.join(extension, "index.mjs"), "utf8");
      assert.match(
        readFileSync(path.join(extension, "lib", "canonical.mjs"), "utf8"),
        /GOVERNANCE_VERSION\s*=\s*"m8-t2\.3-r5"/u,
      );
      assert.ok(
        entry.includes('context.trigger !== "heartbeat"'),
        "the R10 G1 predicate is installed",
      );
      // The installed boundary is the repository's, not a stale R7 copy.
      assert.equal(
        readDigest(path.join(extension, "lib", "native-boundary.mjs")),
        readDigest(
          path.join(
            REPO,
            "integrations",
            "openclaw",
            "topology",
            "lib",
            "native-boundary.mjs",
          ),
        ),
      );

      // C: native digests, and the real verifier.
      const verification = checkNativePatch(RUNTIME_ROOT);
      assert.equal(verification.status, "PATCHED");
      assert.equal(
        readDigest(path.join(RUNTIME_ROOT, "dist", SELECTION)),
        R10_SELECTION,
      );
      assert.equal(
        readDigest(path.join(RUNTIME_ROOT, "dist", BRIDGE_FILE)),
        CURRENT_BRIDGE,
      );

      // D: plugin state.
      const config = JSON.parse(
        readFileSync(path.join(STATE_DIR, "openclaw.json"), "utf8"),
      );
      assert.deepEqual(Object.keys(config.plugins.entries).sort(), [
        "discord",
        "google",
        "zink-governance",
      ]);

      // G: the transaction is complete only after verification.
      assert.equal(report.transactionStatus, "complete");
      const record = loadTransaction(STATE_DIR, report.attemptId);
      assert.equal(record.status, "complete");
      assert.equal(verifyTransactionSnapshot(record.snapshot).verified, true);

      // And the apply wrote no ledger event.
      const events = readFileSync(
        path.join(STATE_DIR, "operator", "m7-t2", "ledger", "events.jsonl"),
        "utf8",
      );
      assert.equal(
        events.split("\n").filter(Boolean).length,
        JSON.parse(
          readFileSync(path.join(REHEARSAL, "live-fingerprint.json"), "utf8"),
        ).ledger.events,
      );
    } finally {
      unmountAll();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 7 — failure injection at every mutation boundary
// ---------------------------------------------------------------------------

const FAILURES = [
  {
    label: "config mutation",
    fault: "config-write",
    stage: "builder-apply",
    // The builder failed on its first write, so nothing of its own landed.
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "governance extension mutation",
    fault: "extension-write",
    stage: "builder-apply",
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "native predecessor recognition",
    fault: "predecessor-recognition",
    // The corrupted selection is rejected by the backup-prune stage's own
    // inspection, one stage before the patcher would have seen it. That is the
    // real detection order and it is recorded rather than papered over.
    stage: "native-backup-prune",
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "native bridge write",
    fault: "bridge-write",
    stage: "native-patch",
    expect: (after, preimage) =>
      after.selection === preimage.selection &&
      after.bridge === preimage.bridge,
  },
  {
    label: "native R7 -> R10 selection write",
    fault: "selection-write",
    stage: "native-patch",
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "native verification",
    fault: "native-verify",
    stage: "native-verify",
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "gateway restart",
    fault: "gateway-restart",
    stage: "gateway-restart",
    expect: (after, preimage) => after.selection === preimage.selection,
  },
  {
    label: "final post-apply validation",
    fault: "post-apply-verify",
    stage: "runtime-verify",
    // This is the one case where the mutation DID land: the apply reached R10 and
    // was rejected only because the runtime did not verify. It is reported as its
    // own condition rather than as a generic failure.
    reason: APPLY_NOT_VERIFIED,
    expect: (after, preimage) => after.selection === preimage.selection,
  },
];

for (const failure of FAILURES) {
  test(
    `R16 I: ${failure.label} failure rolls the clone back to its exact preimage`,
    { skip },
    async () => {
      mountClones();
      try {
        // Any fault that changes the runtime is applied BEFORE the preimage is
        // taken: it is then part of this attempt's starting state, and the
        // rollback is required to restore exactly that — not the pristine R7.
        if (failure.fault === "predecessor-recognition") corruptPredecessor();
        // A genuine native write cannot be made to fail on demand, so the atomic
        // temp target the writer needs is occupied instead. The real code then
        // fails at the real boundary.
        const occupied =
          failure.fault === "bridge-write"
            ? occupyNativeWriteTarget(BRIDGE_FILE)
            : failure.fault === "selection-write"
              ? occupyNativeWriteTarget(SELECTION)
              : null;
        if (occupied)
          assert.ok(existsSync(occupied), "the write target was occupied");
        const preimage = stateDigests();

        const { deps } = rehearsalDeps({ fault: failure.fault });
        const report = await applyRuntime(deps);

        // The boundary is reported accurately.
        assert.equal(report.status, "FAIL");
        assert.equal(report.stage, failure.stage);
        if (failure.reason) assert.equal(report.reason, failure.reason);
        assert.equal(report.mutationStarted, true, "mutation had started");
        assert.equal(report.rollbackRequired, true);
        assert.equal(report.rollbackAttempted, true);
        assert.equal(
          report.rollbackSucceeded,
          true,
          report.rollbackReason ?? report.restoreValidationReason ?? "",
        );
        // The live clone was validated before success was licensed.
        assert.equal(report.restoreValidationReason, null);
        assert.equal(report.restoreMismatches, null);

        // The rollback targeted this attempt's own transaction snapshot.
        const record = loadTransaction(STATE_DIR, report.attemptId);
        assert.equal(record.status, "complete");
        assert.equal(verifyTransactionSnapshot(record.snapshot).verified, true);

        // And the preimage came back exactly.
        assert.deepEqual(stateDigests(), preimage);
        assert.ok(failure.expect(stateDigests(), preimage));
        if (occupied)
          assert.ok(
            existsSync(occupied),
            "the writer never reached the occupied target",
          );
      } finally {
        unmountAll();
      }
    },
  );
}

test(
  "R16 I: a gateway that cannot restart back never licenses a verified rollback",
  { skip },
  async () => {
    mountClones();
    try {
      const preimage = stateDigests();
      const { deps } = rehearsalDeps({ fault: "gateway-restart-persistent" });
      const report = await applyRuntime(deps);
      assert.equal(report.status, "FAIL");
      assert.equal(report.stage, "gateway-restart");
      assert.equal(report.rollbackAttempted, true);
      // The bytes were restored, but a runtime nobody has observed running is not
      // evidence, so success must stay unclaimed.
      assert.equal(report.rollbackSucceeded, false);
      assert.equal(report.restoreValidationReason, RESTORE_UNVERIFIED);
      assert.deepEqual(stateDigests(), preimage);
    } finally {
      unmountAll();
    }
  },
);

test(
  "R16 I: a preflight failure mutates nothing and rolls nothing back",
  { skip },
  async () => {
    mountClones();
    try {
      const preimage = stateDigests();
      const { stages, deps } = rehearsalDeps({ fault: "builder-preflight" });
      void stages;
      const report = await applyRuntime(deps);
      assert.equal(report.status, "FAIL");
      assert.equal(report.stage, "builder-preflight");
      assert.equal(report.mutationStarted, false);
      assert.equal(report.rollbackRequired, false);
      assert.equal(report.rollbackAttempted, false);
      assert.equal(report.rollbackSucceeded, false);
      assert.equal(report.attemptId, null);
      assert.deepEqual(stateDigests(), preimage);
    } finally {
      unmountAll();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 8 — the historical collision, through the real orchestration
// ---------------------------------------------------------------------------

test(
  "R16 J: a completed attempt no longer blocks the next attempt",
  { skip },
  async () => {
    mountClones();
    try {
      // ATTEMPT A: fails after mutation, rolls back to the exact preimage, resolves.
      const first = await applyRuntime(
        rehearsalDeps({ fault: "native-verify" }).deps,
      );
      assert.equal(first.rollbackSucceeded, true, first.rollbackReason ?? "");
      assert.equal(first.transactionStatus, "complete");
      const recordA = loadTransaction(STATE_DIR, first.attemptId);
      assert.deepEqual(nativeDigests(), R7_NATIVE);

      // ATTEMPT B: the same preimage, a new attempt, and this time it completes.
      const second = await applyRuntime(rehearsalDeps().deps);
      assert.equal(second.status, "PASS", second.reason ?? "");

      // R15, proven through the deployment path that previously blocked production.
      assert.notEqual(second.attemptId, first.attemptId, "attempt IDs differ");
      const recordB = loadTransaction(STATE_DIR, second.attemptId);
      assert.equal(
        recordB.preimageDigest,
        recordA.preimageDigest,
        "the preimage digest is identical",
      );
      assert.ok(
        recordB.preimageDigest,
        "the preimage digest is not preimage-keyed",
      );
      assert.equal(recordA.status, "complete", "attempt A remains intact");
      assert.equal(verifyTransactionSnapshot(recordA.snapshot).verified, true);
      assert.equal(verifyTransactionSnapshot(recordB.snapshot).verified, true);
      // Both attempts are independently recoverable: restoring either preimage is
      // still possible, and the live clone verifies as R10.
      assert.equal(
        readDigest(path.join(RUNTIME_ROOT, "dist", SELECTION)),
        R10_SELECTION,
      );
      // A's rollback put the runtime back to R7, so B's preimage is A's preimage
      // — and it still got its own record instead of colliding with A's.
      assert.deepEqual(recordA.snapshot.files, recordB.snapshot.files);
      const attempts = readdirSync(
        path.join(STATE_DIR, "operator", "m7-t2", "transactions"),
      ).filter((name) => name !== RETAINED_HISTORICAL_TRANSACTION);
      assert.equal(attempts.length, 2, "one record per attempt");
      assert.ok(attempts.includes(first.attemptId));
      assert.ok(attempts.includes(second.attemptId));
    } finally {
      unmountAll();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 10 — the contracts the rehearsal must not disturb
// ---------------------------------------------------------------------------

test(
  "R16 Phase 10: G1/G2/G3 and the lineage, allowlist and identity contracts hold",
  { skip },
  async () => {
    mountClones();
    try {
      const report = await applyRuntime(rehearsalDeps().deps);
      assert.equal(report.status, "PASS", report.reason ?? "");
      const entry = readFileSync(
        path.join(STATE_DIR, "extensions", "zink-governance", "index.mjs"),
        "utf8",
      );
      // G1: the R10 heartbeat contract survived deployment, unchanged.
      assert.ok(
        entry.includes('context.trigger !== "heartbeat"'),
        "G1 trigger",
      );
      assert.ok(
        entry.includes(
          "context.transcriptPrompt === HEARTBEAT_LIVENESS_SENTINEL",
        ),
        "G1 corroborating sentinel",
      );
      // G2: cause preservation.
      assert.ok(entry.includes("cause"), "G2 cause preservation");
      // G3: advisory BLOCKED, and no throw-based enforcement was introduced.
      assert.ok(entry.includes("BLOCKED"), "G3 advisory context");
      // R14: an R7 host is still recognized as a predecessor.
      assert.equal(
        inspectNativePatch(RUNTIME_ROOT)[SELECTION].state,
        "PATCHED",
      );
      // R15: attempt identity is random; two attempts from one preimage differ.
      const snapshot = createTransactionSnapshot({
        stateDir: STATE_DIR,
        runtimeRoot: RUNTIME_ROOT,
      });
      const first = persistTransactionSnapshot(STATE_DIR, snapshot, {
        createdAt: "2026-09-30T00:00:00.000Z",
      });
      const second = persistTransactionSnapshot(STATE_DIR, snapshot, {
        createdAt: "2026-09-30T00:00:00.000Z",
      });
      assert.notEqual(first.attemptId, second.attemptId);
      assert.equal(first.preimageDigest, second.preimageDigest);
    } finally {
      unmountAll();
    }
  },
);

// ---------------------------------------------------------------------------
// Phase 11 — the artifacts are repository-generated, not hand-built
// ---------------------------------------------------------------------------

test(
  "R16 K: the R10 artifacts regenerate deterministically from the repository",
  { skip },
  () => {
    mountClones();
    const scratch = path.join(REHEARSAL, "scratch");
    try {
      const generate = (round) => {
        // An independent runtime built from the pinned BASELINE preimages held in
        // `native-r12` — never from a copy of the expected R10 output.
        const root = path.join(scratch, String(round), "runtime");
        mkdirSync(path.join(root, "dist"), { recursive: true });
        writeFileSync(
          path.join(root, "package.json"),
          readFileSync(path.join(RUNTIME_ROOT, "package.json")),
        );
        writeFileSync(
          path.join(root, "dist", ANNOUNCE_FILE),
          readFileSync(path.join(NATIVE_BACKUP, ANNOUNCE_FILE)),
        );
        writeFileSync(
          path.join(root, "dist", SELECTION),
          readFileSync(path.join(NATIVE_BACKUP, SELECTION)),
        );
        writeFileSync(
          path.join(root, "dist", "agent-FRfbCcij.js"),
          readFileSync(path.join(RUNTIME_ROOT, "dist", "agent-FRfbCcij.js")),
        );
        // Confirm this really is the baseline route, not an already-patched file.
        const state = transformNativeSource(
          SELECTION,
          readFileSync(path.join(root, "dist", SELECTION), "utf8"),
          JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
            .version,
        ).state;
        assert.equal(
          state,
          "BASELINE",
          "round " + round + " starts from BASELINE",
        );
        applyNativePatch(root, path.join(scratch, String(round), "backup"));
        return {
          selection: readDigest(path.join(root, "dist", SELECTION)),
          bridge: readDigest(path.join(root, "dist", BRIDGE_FILE)),
          announce: readDigest(path.join(root, "dist", ANNOUNCE_FILE)),
        };
      };

      const first = generate(0);
      const second = generate(1);
      // Deterministic on repeated generation.
      assert.deepEqual(first, second);
      // And byte-identical to what the R7 -> R10 route produced in the apply above.
      assert.equal(first.selection, R10_SELECTION, "selection");
      assert.equal(first.bridge, CURRENT_BRIDGE, "bridge");
      assert.equal(first.announce, ANNOUNCE, "announce");
      // The baseline preimage really is a different artifact.
      assert.equal(
        readDigest(path.join(NATIVE_BACKUP, SELECTION)),
        BASELINE_SELECTION,
      );
      // The repository boundary source is the bridge.
      assert.equal(
        first.bridge,
        readDigest(
          path.join(
            REPO,
            "integrations",
            "openclaw",
            "topology",
            "lib",
            "native-boundary.mjs",
          ),
        ),
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      unmountAll();
    }
  },
);

test("R16-SCOPE: the fingerprint covers every root the real patcher writes", () => {
  // The isolation proof is a comparison of two fingerprints, so it can only
  // speak about the roots it enumerates. The Discord channel package is one of
  // the roots the patcher writes: it lives inside the state root, and the
  // patched preflight in it is the file the ingress repair rewrites. A scope
  // that omits it proves nothing about the tree that actually changes.
  const channelComponents = R16_COMPONENTS.filter(([label]) =>
    label.startsWith("discord-channel/"),
  );
  assert.ok(
    channelComponents.length > 0,
    "the fingerprint must enumerate the Discord channel package",
  );
  for (const [label, relative, root] of channelComponents) {
    assert.equal(root, "state", `${label} must be a state-relative component`);
    assert.ok(
      relative.startsWith(NATIVE_DISCORD_CHANNEL_RELATIVE),
      `${label} must live under the installed channel package: ${relative}`,
    );
  }
  assert.ok(
    R16_TREES.some(
      ([label, relative]) =>
        label === "discord-channel" &&
        relative === NATIVE_DISCORD_CHANNEL_RELATIVE,
    ),
    "the channel package must also be fingerprinted as a whole subtree",
  );
  // Every channel-scoped pin must be covered, so a new governed artifact in
  // that package cannot drop out of the scope silently.
  const pinnedChannelFiles = Object.values(NATIVE_RUNTIME_PINS)
    .flatMap((pin) => Object.entries(pin.sources ?? {}))
    .filter(([, entry]) => entry.scope === "discordChannel")
    .map(([file]) => file);
  assert.ok(
    pinnedChannelFiles.length > 0,
    "the pins must declare at least one channel-scoped artifact",
  );
  for (const file of pinnedChannelFiles) {
    assert.ok(
      channelComponents.some(([label]) => label.endsWith(`/${file}`)),
      `the pinned channel artifact ${file} must be in the fingerprint scope`,
    );
  }
});

test("R16-08: the operator preflight names every known refusal class and leaks no message", () => {
  // Provenance of this guard: a real deployment refusal arrived as
  // `PREFLIGHT_REJECTED` because the classifier knew only nine classes, so the
  // operator could not tell a missing router env from asset drift without burning
  // a round trip. Naming the class is the fix; quoting the message never is.
  const source = readFileSync(
    path.join(
      REPO,
      "integrations",
      "openclaw",
      "topology",
      "fixtures",
      "runtime-regression",
      "operator-preflight.mjs",
    ),
    "utf8",
  );
  for (const className of [
    "ROUTER_HOST_UNAVAILABLE",
    "ROUTER_PORT_UNAVAILABLE",
    "ROUTER_API_KEY_UNAVAILABLE",
    "must be a numeric Discord snowflake",
    "surface IDs must be distinct",
    "Existing config must be canonical JSON",
    "Agent governance instructions drift",
    "mode drift",
    "Governance plugin package",
    "Gemini stream hotfix utility",
    "Password-store resolver",
    "Systemd drop-in",
    "Ledger corruption",
    "symlink",
  ])
    assert.ok(
      source.includes(`"${className}"`),
      `the preflight classifier must name ${className}`,
    );
  assert.match(
    source.replace(/\s+/gu, " "),
    /const reason = known\.find/u,
    "the report may only ever carry a whitelisted class, never raw stderr",
  );
  assert.equal(
    /reason:\s*(error|output)\./.test(source),
    false,
    "a raw error message could quote config content or identifiers",
  );
});

// ---------------------------------------------------------------------------
// The driver's own gate (M12/T2.1 T2.1-8, `R5-E08-02`).
//
// These run on every host because they assert the ABSENCE of an effect: no mount
// namespace, no live runtime and no scratch tree is touched. The suite above is
// the one that needs WSL.
// ---------------------------------------------------------------------------

const DRIVER = path.join(
  import.meta.dirname,
  "..",
  "integrations",
  "openclaw",
  "topology",
  "fixtures",
  "runtime-regression",
  "r16-rehearsal.mjs",
);

const runDriver = (args, env = {}) => {
  const childEnv = { ...process.env, ...env };
  // These cases must be seen by the driver as an operator invocation even when
  // this suite itself is running inside the rehearsal namespace, where both
  // variables are set: inherited `R16_INSIDE=1` would waive the gate and put a
  // nested rehearsal in the child.
  delete childEnv.R16_INSIDE;
  delete childEnv.R16_REHEARSAL_ROOT;
  return spawnSync(process.execPath, [DRIVER, ...args], {
    encoding: "utf8",
    env: childEnv,
  });
};

test("R16-DRIVER-01: no `test:` script names the recursive-delete driver", () => {
  const scripts = JSON.parse(
    readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8"),
  ).scripts;
  assert.deepEqual(
    Object.entries(scripts).filter(
      ([name, command]) =>
        name.startsWith("test:") && command.includes("r16-rehearsal"),
    ),
    [],
    "a destructive operator entry must not be reachable under a `test:` name",
  );
  assert.ok(
    Object.values(scripts).some((command) =>
      command.includes("r16-rehearsal.mjs"),
    ),
    "the rehearsal route must still exist: renaming is not deleting",
  );
});

test("R16-DRIVER-02: the default mode reports and touches nothing", () => {
  const root = path.join(os.tmpdir(), `r16-gate-report-${process.pid}`);
  const result = runDriver(["--rehearsal-root", root]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.mode, "REPORT");
  assert.equal(report.action, "NONE");
  assert.equal(report.deletes_on_run, root);
  assert.match(report.requires, /--run --confirm=R16_REHEARSAL_RUN/u);
  if (process.platform !== "linux") {
    assert.equal(
      report.host_is_wsl,
      false,
      "a non-Linux host must be reported as not-WSL even where the POSIX runtime path exists",
    );
  }
  assert.equal(
    existsSync(root),
    false,
    "a report may not create the tree it describes",
  );
});

test("R16-DRIVER-03: --run without the token is refused and deletes nothing", () => {
  const root = path.join(os.tmpdir(), `r16-gate-refuse-${process.pid}`);
  const missing = runDriver(["--rehearsal-root", root, "--run"]);
  assert.equal(missing.status, 1);
  assert.equal(
    JSON.parse(missing.stdout.trim()).reason,
    "CONFIRMATION_REQUIRED",
    "a missing confirmation must be named as such",
  );
  assert.equal(existsSync(root), false);

  // A wrong token is not a missing one, and must not open the gate either.
  const wrong = runDriver([
    "--rehearsal-root",
    root,
    "--run",
    "--confirm=R16_REHEARSAL",
  ]);
  assert.equal(wrong.status, 1);
  assert.equal(existsSync(root), false);
});

test("R16-DRIVER-05: the host refusal comes from the platform, not from a path", () => {
  // `R16_ROOTS.stateDir` is `/home/hoang_vinh/.openclaw-zink`. On Windows Node
  // resolves that against the current drive, and a stray `C:\home\…` tree made the
  // answer `true` here since 2026-09-29 (`R6-I01-03`), so the driver's only
  // host-safety guard reported "this is the live runtime" while running on Windows.
  // The refusal must name the platform even when that path exists.
  const root = path.join(os.tmpdir(), `r16-hostgate-${process.pid}`);
  const result = runDriver([
    "--rehearsal-root",
    root,
    "--run",
    "--confirm=R16_REHEARSAL_RUN",
  ]);
  assert.equal(result.status, 1);
  if (process.platform !== "linux") {
    assert.match(
      result.stdout,
      /FATAL: this host is not WSL/u,
      "a non-WSL host must be refused for a platform reason",
    );
    assert.doesNotMatch(
      result.stdout,
      /live runtime is not present/u,
      "the path must not be the thing that decides the host",
    );
  }
  assert.equal(
    existsSync(root),
    false,
    "a refused host must not create its scratch tree",
  );
});

test("R16-DRIVER-04: a root that can resolve upward is refused before it is read", () => {
  // `force: true` makes a wrong root silent, so the value's shape is the guard.
  // `.` and `..` matter most: both resolve to absolute paths, and `..` against
  // npm's working directory is the parent of the repository.
  for (const candidate of ["..", ".", "", os.homedir(), "C:\\", "/"]) {
    const result = runDriver([
      "--rehearsal-root",
      candidate,
      "--run",
      "--confirm=R16_REHEARSAL_RUN",
    ]);
    assert.notEqual(
      result.status,
      0,
      `the driver must refuse ${JSON.stringify(candidate)}`,
    );
    assert.match(
      `${result.stderr}${result.stdout}`,
      /absolute|refusing to treat|non-empty/u,
      `the refusal must name why ${JSON.stringify(candidate)} is not a root`,
    );
  }
});
