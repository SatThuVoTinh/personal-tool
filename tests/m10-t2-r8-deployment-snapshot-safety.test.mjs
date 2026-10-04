// M10/T2-R8 Phase 1 — deployment snapshot / rollback safety.
//
// PROVEN production defect (attempt txn-cb59d6e7…): the transaction
// snapshot enumerated runtime targets from a FIXED three-file list while the
// pinned native patch writes FOUR runtime files. `dist/message-handler
// .preflight-C1XBiefW.js` was therefore mutated outside transaction
// tracking, which produced two false facts at once:
//
//   * runtime-verify computed `applied: !unchanged` over a target set that
//     could not see the only mutated component, so it reported
//     APPLY_NOT_VERIFIED for an apply that had in fact landed;
//   * the rollback restored 39 already-identical files, verified them,
//     and reported `rollbackSucceeded: true` while the preflight file was
//     still mutated.
//
// This suite pins the repaired contract:
//
//   1. the runtime target list is DERIVED from the native patch pins, so no
//      patched artifact can escape transaction tracking;
//   2. every declared runtime target is snapshotted and restored;
//   3. rollback success requires hash equality for EVERY tracked component,
//      including the fourth runtime file;
//   4. an orphan mutation — a tracked component that differs from the
//      preimage without being a declared expected mutation — is detected;
//   5. post-apply verification compares against an EXPECTED post-image
//      derived from the patch contract, never against "did anything
//      change".
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  NATIVE_RUNTIME_PINS,
  nativePatchedRuntimeRelatives,
  nativeRuntimePostImage,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";
import {
  SNAPSHOT_TARGETS,
  createTransactionSnapshot,
  restoreTransactionSnapshot,
  verifyLiveRestore,
} from "../integrations/openclaw/topology/lib/transaction-snapshot.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PREFLIGHT = "dist/message-handler.preflight-C1XBiefW.js";

/** A runtime whose four patched files plus the bridge all exist. */
function buildRuntime() {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r8-snap-"));
  const stateDir = path.join(root, "state");
  const runtimeRoot = path.join(root, "openclaw");
  const dist = path.join(runtimeRoot, "dist");
  const extension = path.join(stateDir, "extensions", "zink-governance");
  mkdirSync(path.join(extension, "lib"), { recursive: true });
  mkdirSync(dist, { recursive: true });
  mkdirSync(path.join(stateDir, "operator"), { recursive: true });

  writeFileSync(path.join(stateDir, "openclaw.json"), "{}\n");
  writeFileSync(path.join(extension, "index.mjs"), "// entrypoint\n");
  writeFileSync(
    path.join(extension, "lib", "native-boundary.mjs"),
    "// boundary\n",
  );
  // Every runtime file the canonical derivation must cover.
  for (const relative of nativePatchedRuntimeRelatives())
    writeFileSync(path.join(runtimeRoot, relative), `// ${relative}\n`);

  return {
    root,
    stateDir,
    runtimeRoot,
    dist,
    extension,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// 1. Coverage — the target list is derived, not hand-maintained
// ---------------------------------------------------------------------------

test("R8 S1: the runtime target list is derived from the native patch pins", () => {
  const derived = nativePatchedRuntimeRelatives();
  const expected = new Set(["dist/zink-governance-boundary.mjs"]);
  for (const pin of Object.values(NATIVE_RUNTIME_PINS))
    for (const file of Object.keys(pin.sources)) expected.add(`dist/${file}`);

  assert.deepEqual(
    [...derived].sort(),
    [...expected].sort(),
    "the runtime list must be exactly the pinned artifacts plus the bridge",
  );
  assert.equal(
    Object.isFrozen(derived),
    true,
    "the derived list is frozen so a caller cannot widen it in place",
  );
});

test("R8 S2: the preflight artifact is a tracked snapshot target", () => {
  assert.ok(
    SNAPSHOT_TARGETS.runtime.includes(PREFLIGHT),
    "the fourth patched runtime file must be tracked, or its mutation escapes rollback",
  );
  // The preflight file is pinned, so this is not a theoretical file.
  assert.ok(
    Object.values(NATIVE_RUNTIME_PINS).some((pin) =>
      Object.keys(pin.sources).includes(
        "message-handler.preflight-C1XBiefW.js",
      ),
    ),
  );
});

test("R8 S3: a snapshot captures every derived runtime target byte-exactly", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    for (const relative of nativePatchedRuntimeRelatives()) {
      const entry = snapshot.files[relative];
      assert.ok(entry, `${relative} must be captured`);
      assert.equal(entry.existed, true);
      assert.equal(
        entry.sha256,
        sha256(readFileSync(path.join(rt.runtimeRoot, relative))),
        `${relative} must be byte-exact`,
      );
    }
  } finally {
    rt.dispose();
  }
});

// ---------------------------------------------------------------------------
// 2. Rollback — every mutated file is restored, and honesty is enforced
// ---------------------------------------------------------------------------

test("R8 S4: mutating ONLY the preflight file still rolls back completely", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    // The exact production shape: a single mutated component, the fourth file.
    writeFileSync(path.join(rt.runtimeRoot, PREFLIGHT), "// R8 union\n");

    // Before the repair the rollback would have "verified" here and left the
    // mutation in place; with the derived target list it is a real mismatch.
    assert.equal(verifyLiveRestore(rt, snapshot).restored, false);
    assert.deepEqual(verifyLiveRestore(rt, snapshot).mismatches, [PREFLIGHT]);

    restoreTransactionSnapshot(snapshot);
    const verdict = verifyLiveRestore(rt, snapshot);
    assert.equal(verdict.restored, true, "rollback must restore the 4th file");
    assert.deepEqual(verdict.mismatches, []);
    assert.equal(
      sha256(readFileSync(path.join(rt.runtimeRoot, PREFLIGHT))),
      snapshot.files[PREFLIGHT].sha256,
      "rollback verification is hash equality, not a self-report",
    );
  } finally {
    rt.dispose();
  }
});

test("R8 S5: post-apply verification judges the EXPECTED image, not 'anything changed'", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    const expected = nativePatchedRuntimeRelatives().map((relative) => ({
      relative,
      sha256: sha256(`// ${relative}\n`),
    }));

    // Nothing mutated yet, but every expected post-image already matches:
    // an idempotent apply is verified, not failed on a technicality.
    const idempotent = verifyLiveRestore(rt, snapshot, {
      postApply: true,
      expected,
    });
    assert.equal(
      idempotent.applied,
      true,
      "an idempotent apply is still a verified apply",
    );

    // A tracked component changes that verification was never told about is
    // surfaced by name rather than silently absorbed.
    writeFileSync(path.join(rt.extension, "openclaw.plugin.json"), "{}\n");
    const orphan = verifyLiveRestore(rt, snapshot, {
      postApply: true,
      expected,
    });
    assert.deepEqual(
      orphan.changed,
      ["extensions/zink-governance/openclaw.plugin.json"],
      "a change verification was not told about must be named",
    );

    // An expected file that does NOT match its declared post-image fails.
    writeFileSync(path.join(rt.runtimeRoot, PREFLIGHT), "// wrong\n");
    const drifted = verifyLiveRestore(rt, snapshot, {
      postApply: true,
      expected,
    });
    assert.equal(drifted.applied, false, "a wrong post-image must not verify");
    assert.ok(
      drifted.unverified.includes(PREFLIGHT),
      "the unverified component must be named",
    );
  } finally {
    rt.dispose();
  }
});

test("R8 S6: an expected post-image entry that is absent fails closed", () => {
  const rt = buildRuntime();
  try {
    const snapshot = createTransactionSnapshot(rt);
    rmSync(path.join(rt.runtimeRoot, PREFLIGHT));
    const verdict = verifyLiveRestore(rt, snapshot, {
      postApply: true,
      expected: [{ relative: PREFLIGHT, sha256: "0".repeat(64) }],
    });
    assert.equal(verdict.applied, false);
    assert.deepEqual(verdict.unverified, [PREFLIGHT]);
  } finally {
    rt.dispose();
  }
});

test("R8 S7: the expected post-image is derived from the patch contract", () => {
  const rt = buildRuntime();
  try {
    // A host that is not a recognized release cannot produce an expectation,
    // so the post-image derivation fails closed instead of guessing.
    writeFileSync(
      path.join(rt.runtimeRoot, "package.json"),
      JSON.stringify({ version: "1999.1.1" }),
    );
    assert.throws(
      () => nativeRuntimePostImage(rt.runtimeRoot),
      /NATIVE_VERSION_MISMATCH/,
    );
  } finally {
    rt.dispose();
  }
});
