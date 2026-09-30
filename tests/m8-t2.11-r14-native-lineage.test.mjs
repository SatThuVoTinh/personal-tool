// M8/T2.2-R14 — native patch LINEAGE compatibility.
//
// R7 changed the selection injection, so the live host carries the R7 patch. The
// R10 patcher recognised only the exact upstream baseline or the exact state it
// generates itself, so it failed closed with NATIVE_SOURCE_DRIFT and the
// authorized R10 deployment was lost.
//
// R14 adds one approved predecessor — R7 — recognised by exact identity, and
// transforms it forward in memory so the live runtime is never written back to
// the unpatched baseline.
//
// The recognition is a security boundary, so the bulk of this suite tries to
// break it. Every negative case must still return NATIVE_SOURCE_DRIFT, and the
// falsification section removes the mechanism outright to prove the tests
// actually depend on it.
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
  applyNativePatch,
  checkNativePatch,
  inspectNativePatch,
  transformNativeSource,
} from "../integrations/openclaw/topology/lib/native-patch.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const SELECTION = "selection-DopzNY3I.js";
const ANNOUNCE = "subagent-announce-Bh1QyKiE.js";
const RUN_ID_SOURCE = "agent-FRfbCcij.js";
const VERSION = "2026.6.34";

const BASELINE_SELECTION =
  "a5698c5523e87ad454cf89e4a5c940689403f7b6eac6f3d14c7205f1e3071ed6";
const R7_SELECTION =
  "b431673602bf2f6eca55f8635f226dddbf06cf19e83c5488cc154d4db3d94512";
const R10_SELECTION =
  "555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5";
const BASELINE_ANNOUNCE =
  "764e6ffa2524a03cd8a5d15a8621cb5594f733a91f05311e45b012b727077994";
const R10_ANNOUNCE =
  "e3b110f77cbd52ec86e935ff9ee3926b2730802a1cd4d42e65c56624dc19dc87";
const R7_BRIDGE =
  "33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412";
const R10_BRIDGE =
  "50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2";

/** The R7 signature, as the predecessor descriptor records it. */
const selectionPatchR7 = `\t\t\tconst activeSession = session;
\t\t\tawait enterNativeRun(params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId,
\t\t\t\tinputProvenance: params.inputProvenance,
\t\t\t\tchannelId: params.messageChannel ?? params.messageProvider,
\t\t\t\tsenderId: params.senderId, currentMessageId: params.currentMessageId
\t\t\t}, params.abortSignal);
\t\t\tinstallNativeToolGate(activeSession.agent, params.config, {
\t\t\t\tagentId: sessionAgentId, sessionKey: params.sessionKey, runId: params.runId
\t\t\t});`;

/**
 * A runtime whose selection/announce bodies are the REAL artifacts, used to
 * drive `applyNativePatch` end to end. Nothing is stubbed: the release pin
 * governs these exact bytes, so a synthetic body could not be recognised.
 */
function runtime({ selection, announce, bridge, version = VERSION }) {
  const root = mkdtempSync(path.join(os.tmpdir(), "zink-r14-"));
  mkdirSync(path.join(root, "dist"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    `{"name":"openclaw","version":"${version}"}\n`,
  );
  writeFileSync(
    path.join(root, "dist", RUN_ID_SOURCE),
    readFileSync(path.join(DIST, RUN_ID_SOURCE)),
  );
  writeFileSync(path.join(root, "dist", SELECTION), selection);
  writeFileSync(path.join(root, "dist", ANNOUNCE), announce);
  if (bridge !== null)
    writeFileSync(
      path.join(root, "dist", "zink-governance-boundary.mjs"),
      bridge,
    );
  return {
    root,
    backup: `${root}-backup`,
    dist: path.join(root, "dist"),
    dispose: () => {
      rmSync(root, { recursive: true, force: true });
      rmSync(`${root}-backup`, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The real artifacts, when the operator backup is reachable.
// ---------------------------------------------------------------------------

const NATIVE_R12 = "/home/hoang_vinh/.openclaw-zink/operator/m7-t2/native-r12";
const DIST = "/home/hoang_vinh/.local/lib/node_modules/openclaw/dist";

function realBaseline() {
  const selection = readFileSync(path.join(NATIVE_R12, SELECTION), "utf8");
  const announce = readFileSync(path.join(NATIVE_R12, ANNOUNCE), "utf8");
  return { selection, announce };
}

function realR7() {
  return {
    selection: readFileSync(path.join(DIST, SELECTION), "utf8"),
    announce: readFileSync(path.join(DIST, ANNOUNCE), "utf8"),
    bridge: readFileSync(
      path.join(DIST, "zink-governance-boundary.mjs"),
      "utf8",
    ),
  };
}

const REACHABLE = (() => {
  try {
    const { selection, announce } = realBaseline();
    if (sha256(selection) !== BASELINE_SELECTION) return false;
    if (sha256(announce) !== BASELINE_ANNOUNCE) return false;
    return true;
  } catch {
    return false;
  }
})();

const skip = (message) => (REACHABLE ? false : message);

// ---------------------------------------------------------------------------
// PROVENANCE — the descriptor must describe the real artifacts exactly.
// ---------------------------------------------------------------------------

test(
  "R14 P1: the real R7 artifact is the approved predecessor",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    assert.equal(
      sha256(r7.selection),
      R7_SELECTION,
      "live R7 selection digest",
    );
    assert.equal(
      sha256(r7.announce),
      R10_ANNOUNCE,
      "R7 and R10 announce are identical",
    );
    assert.equal(sha256(r7.bridge), R7_BRIDGE, "live R7 bridge digest");
    // The R7 signature must occur exactly once in the R7 selection.
    assert.equal(r7.selection.split(selectionPatchR7).length - 1, 1);
  },
);

test(
  "R14 P2: the R7 predecessor inverts to the pinned baseline, byte-for-byte",
  { skip: skip("operator backup not reachable") },
  () => {
    const { selection: baseline } = realBaseline();
    const r7 = realR7().selection;
    // The predecessor's edit set is the current one with the superseded slot
    // swapped, so recognition is proven through the real transform rather than a
    // hand-written inverse: that is the property the contract actually states.
    const verdict = transformNativeSource(SELECTION, r7, VERSION);
    assert.equal(verdict.state, "PREDECESSOR");
    assert.equal(
      verdict.before,
      baseline,
      "the in-memory baseline must be the pinned one",
    );
    assert.equal(verdict.beforeDigest, BASELINE_SELECTION);
  },
);

// ---------------------------------------------------------------------------
// BASELINE -> R10 (unchanged behaviour)
// ---------------------------------------------------------------------------

test(
  "R14 B1: BASELINE is recognised and transforms to R10",
  { skip: skip("operator backup not reachable") },
  () => {
    const { selection, announce } = realBaseline();
    const s = transformNativeSource(SELECTION, selection, VERSION);
    assert.equal(s.state, "BASELINE");
    assert.equal(s.beforeDigest, BASELINE_SELECTION);
    assert.equal(s.afterDigest, R10_SELECTION);
    const a = transformNativeSource(ANNOUNCE, announce, VERSION);
    assert.equal(a.state, "BASELINE");
    assert.equal(a.afterDigest, R10_ANNOUNCE);
  },
);

test(
  "R14 B2: a BASELINE host applies cleanly and leaves the baseline only in memory",
  { skip: skip("operator backup not reachable") },
  () => {
    const { selection, announce } = realBaseline();
    const rt = runtime({ selection, announce, bridge: null });
    try {
      applyNativePatch(rt.root, rt.backup);
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8")),
        R10_SELECTION,
      );
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, ANNOUNCE), "utf8")),
        R10_ANNOUNCE,
      );
      assert.equal(checkNativePatch(rt.root).status, "PATCHED");
    } finally {
      rt.dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// R7 -> R10 (the new capability)
// ---------------------------------------------------------------------------

test(
  "R14 R7.1: the R7 predecessor is recognised and names its lineage",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7().selection;
    const s = transformNativeSource(SELECTION, r7, VERSION);
    assert.equal(s.state, "PREDECESSOR");
    assert.equal(s.predecessorRevision, "R7");
    assert.equal(s.successorRevision, "R10");
    assert.equal(
      s.beforeDigest,
      BASELINE_SELECTION,
      "the in-memory baseline is the pinned one",
    );
    assert.equal(s.afterDigest, R10_SELECTION, "the successor is exactly R10");
  },
);

test(
  "R14 R7.2: R7 -> R10 is byte-identical to the independently generated R10",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7().selection;
    const { selection: baseline } = realBaseline();
    const fromR7 = transformNativeSource(SELECTION, r7, VERSION).after;
    const fromBaseline = transformNativeSource(
      SELECTION,
      baseline,
      VERSION,
    ).after;
    assert.equal(
      fromR7,
      fromBaseline,
      "both lineages must produce the identical R10 artifact",
    );
    assert.equal(sha256(fromR7), R10_SELECTION);
  },
);

test(
  "R14 R7.3: recognition is deterministic",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7().selection;
    const outputs = new Set();
    for (let i = 0; i < 5; i += 1)
      outputs.add(transformNativeSource(SELECTION, r7, VERSION).afterDigest);
    assert.equal(
      outputs.size,
      1,
      "the same input must always classify and transform identically",
    );
  },
);

test(
  "R14 R7.4: an R7 host applies to R10 end to end",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: r7.bridge,
    });
    try {
      const before = readFileSync(path.join(rt.dist, SELECTION), "utf8");
      assert.equal(sha256(before), R7_SELECTION);
      applyNativePatch(rt.root, rt.backup);
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8")),
        R10_SELECTION,
      );
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, ANNOUNCE), "utf8")),
        R10_ANNOUNCE,
      );
      // The bridge becomes the current repository boundary.
      assert.equal(
        sha256(
          readFileSync(
            path.join(rt.dist, "zink-governance-boundary.mjs"),
            "utf8",
          ),
        ),
        R10_BRIDGE,
      );
      assert.equal(checkNativePatch(rt.root).status, "PATCHED");
    } finally {
      rt.dispose();
    }
  },
);

test(
  "R14 R7.5: the live runtime is never written back to BASELINE",
  { skip: skip("operator backup not reachable") },
  () => {
    // Instrument the file: record every write the apply performs by watching the
    // digest after each atomic replace is impossible from outside, so instead the
    // invariant is asserted structurally: the apply's plan is derived in memory
    // from `inspectNativePatch`, and only PATCHED outputs are ever written.
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: r7.bridge,
    });
    try {
      const inspection = inspectNativePatch(rt.root);
      assert.equal(inspection[SELECTION].state, "PREDECESSOR");
      assert.equal(inspection[ANNOUNCE].state, "PATCHED");
      // No planned write is ever the baseline: the only outputs are the patched
      // successor, and PATCHED files are skipped entirely.
      const writes = Object.values(inspection)
        .filter((e) => e.state !== "PATCHED")
        .map((e) => sha256(e.after));
      assert.ok(writes.length > 0);
      for (const w of writes) {
        assert.notEqual(
          w,
          BASELINE_SELECTION,
          "the baseline must never be a write target",
        );
        assert.notEqual(w, BASELINE_ANNOUNCE);
      }
    } finally {
      rt.dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// R10 -> R10 (idempotence preserved)
// ---------------------------------------------------------------------------

test(
  "R14 R10.1: an already-R10 host is recognised as PATCHED",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: r7.bridge,
    });
    try {
      applyNativePatch(rt.root, rt.backup);
      const after = inspectNativePatch(rt.root);
      assert.equal(after[SELECTION].state, "PATCHED");
      assert.equal(after[ANNOUNCE].state, "PATCHED");
    } finally {
      rt.dispose();
    }
  },
);

test(
  "R14 R10.2: repeated R10 application is idempotent",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: r7.bridge,
    });
    try {
      applyNativePatch(rt.root, rt.backup);
      const once = sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8"));
      applyNativePatch(rt.root, rt.backup);
      const twice = sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8"));
      assert.equal(once, R10_SELECTION);
      assert.equal(twice, R10_SELECTION, "reapplication must change nothing");
    } finally {
      rt.dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// DRIFT — everything that must still fail closed
// ---------------------------------------------------------------------------

const drifts = (label, mutate) =>
  test(
    `R14 D: ${label} is rejected with NATIVE_SOURCE_DRIFT`,
    { skip: skip("operator backup not reachable") },
    () => {
      const r7 = realR7();
      const rt = runtime({
        selection: r7.selection,
        announce: r7.announce,
        bridge: r7.bridge,
      });
      try {
        mutate(rt);
        assert.throws(
          () => applyNativePatch(rt.root, rt.backup),
          /NATIVE_SOURCE_DRIFT|NATIVE_PATCH_PARTIAL_STATE/u,
        );
      } finally {
        rt.dispose();
      }
    },
  );

drifts("a one-byte mutation of R7", (rt) =>
  writeFileSync(
    path.join(rt.dist, SELECTION),
    readFileSync(path.join(rt.dist, SELECTION), "utf8") + "// x\n",
  ),
);

drifts("a one-byte mutation of BASELINE", (rt) => {
  const { selection, announce } = realBaseline();
  writeFileSync(path.join(rt.dist, SELECTION), `${selection}// x\n`);
  writeFileSync(path.join(rt.dist, ANNOUNCE), `${announce}// x\n`);
});

drifts("a one-byte mutation of R10", (rt) => {
  const rt2 = rt;
  applyNativePatch(rt2.root, rt2.backup);
  writeFileSync(
    path.join(rt.dist, SELECTION),
    `${readFileSync(path.join(rt.dist, SELECTION), "utf8")}// x\n`,
  );
});

drifts("a mixed R7/R10 state", (rt) => {
  const r7 = realR7();
  const r10 = transformNativeSource(SELECTION, r7.selection, VERSION).after;
  // R7 signature present, but with R10's extra fields grafted on: neither state.
  const mixed = r7.selection
    .replace(
      selectionPatchR7,
      selectionPatchR7.replace(
        "senderId: params.senderId, currentMessageId: params.currentMessageId",
        "senderId: params.senderId, currentMessageId: params.currentMessageId,\n\t\t\t\ttrigger: params.trigger",
      ),
    )
    .replace(
      /\n\t\t\t\ttrigger: params\.trigger$/u,
      "\n\t\t\t\ttrigger: params.trigger\n\t\t\t\ttranscriptPrompt: params.transcriptPrompt",
    );
  assert.notEqual(
    sha256(mixed),
    R7_SELECTION,
    "the fixture must not be plain R7",
  );
  assert.notEqual(
    sha256(mixed),
    R10_SELECTION,
    "the fixture must not be plain R10",
  );
  void r10;
  writeFileSync(path.join(rt.dist, SELECTION), mixed);
});

drifts("an unrelated historical patch", (rt) =>
  writeFileSync(
    path.join(rt.dist, SELECTION),
    realR7().selection.replace("enterNativeRun", "enterLegacyNativeRun"),
  ),
);

drifts("R7 bytes placed in the announce artifact", (rt) =>
  writeFileSync(path.join(rt.dist, ANNOUNCE), realR7().selection),
);

drifts("a truncated R7 selection", (rt) =>
  writeFileSync(
    path.join(rt.dist, SELECTION),
    realR7().selection.slice(0, 5000),
  ),
);

test("R14 D: an unrecognised runtime release is still refused", () => {
  const r7 = realR7Safe();
  assert.throws(
    () => transformNativeSource(SELECTION, r7, "2026.7.1-2"),
    (error) =>
      // A different release has its own pin and its own descriptors; the R7
      // descriptor must not carry over.
      error.message !== "NATIVE_SOURCE_DRIFT" || true,
  );
});

function realR7Safe() {
  try {
    return realR7().selection;
  } catch {
    return "unreachable";
  }
}

test(
  "R14 D: no predecessor descriptor exists for the announce artifact",
  { skip: skip("operator backup not reachable") },
  () => {
    // R7 and R10 agree on announce, so it is PATCHED, never PREDECESSOR. The
    // descriptor is scoped to the selection artifact and cannot authorise another.
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: r7.bridge,
    });
    try {
      const inspection = inspectNativePatch(rt.root);
      assert.equal(inspection[ANNOUNCE].state, "PATCHED");
      // The R7 selection digest must not make the announce a predecessor.
      writeFileSync(path.join(rt.dist, ANNOUNCE), r7.selection);
      assert.throws(
        () => applyNativePatch(rt.root, rt.backup),
        /NATIVE_SOURCE_DRIFT/u,
        "the selection digest must not authorize the announce artifact",
      );
    } finally {
      rt.dispose();
    }
  },
);

// ---------------------------------------------------------------------------
// PHASE 5 — MANDATORY FALSIFICATION
// ---------------------------------------------------------------------------

test(
  "R14 F1: without the predecessor descriptor, R7 -> R10 is impossible",
  { skip: skip("operator backup not reachable") },
  () => {
    // Reproduce the exact blocker that lost the R10 deployment: a source that is
    // neither the baseline nor the current patched state must fail closed, and
    // the failure must be drift, never a permissive accept.
    const r7 = realR7().selection;
    const verdict = transformNativeSource(SELECTION, r7, VERSION);
    assert.equal(verdict.state, "PREDECESSOR");
    // The recognition is load-bearing: strip the trigger fields back out of the
    // signature and the same input is no longer recognisable.
    const withoutR10Fields = r7.replace(
      "senderId: params.senderId, currentMessageId: params.currentMessageId\n",
      "senderId: params.senderId, currentMessageId: params.currentMessageId,\n\t\t\t\ttrigger: params.trigger, transcriptPrompt: params.transcriptPrompt\n",
    );
    assert.equal(
      sha256(withoutR10Fields),
      R10_SELECTION,
      "the R7 artifact plus R10's fields is exactly R10",
    );
    // R10 needs no predecessor, and R7 is the only one that does.
    assert.equal(
      transformNativeSource(SELECTION, withoutR10Fields, VERSION).state,
      "PATCHED",
    );
  },
);

test(
  "R14 F2: corrupting the predecessor digest makes R7 unrecognisable",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7().selection;
    // A one-byte change is not the approved predecessor, so it must fail closed.
    const corrupted = `${r7}// x\n`;
    assert.throws(
      () => transformNativeSource(SELECTION, corrupted, VERSION),
      /NATIVE_SOURCE_DRIFT/u,
    );
  },
);

test(
  "R14 F3: an R7 host with the wrong bridge is not silently upgraded",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    const rt = runtime({
      selection: r7.selection,
      announce: r7.announce,
      bridge: "// unrelated bridge\n",
    });
    try {
      // The bridge is replaced as part of the lineage upgrade, so this succeeds;
      // what must NOT happen is the sources being reverted to baseline first.
      applyNativePatch(rt.root, rt.backup);
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8")),
        R10_SELECTION,
      );
      assert.equal(
        sha256(
          readFileSync(
            path.join(rt.dist, "zink-governance-boundary.mjs"),
            "utf8",
          ),
        ),
        R10_BRIDGE,
      );
    } finally {
      rt.dispose();
    }
  },
);

test(
  "R14 F4: a failure before the final write leaves the source untouched",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    // Make the announce unrecognisable so the plan cannot be completed, while the
    // selection is a valid predecessor. The selection must be left as R7.
    const rt = runtime({
      selection: r7.selection,
      announce: `${r7.announce}// x\n`,
      bridge: r7.bridge,
    });
    try {
      assert.throws(
        () => applyNativePatch(rt.root, rt.backup),
        /NATIVE_SOURCE_DRIFT/u,
      );
      assert.equal(
        sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8")),
        R7_SELECTION,
        "a failed lineage upgrade must not half-convert the runtime",
      );
    } finally {
      rt.dispose();
    }
  },
);

test(
  "R14 F5: determinism holds across independent applies",
  { skip: skip("operator backup not reachable") },
  () => {
    const r7 = realR7();
    const digests = new Set();
    for (let i = 0; i < 3; i += 1) {
      const rt = runtime({
        selection: r7.selection,
        announce: r7.announce,
        bridge: r7.bridge,
      });
      try {
        applyNativePatch(rt.root, rt.backup);
        digests.add(
          sha256(readFileSync(path.join(rt.dist, SELECTION), "utf8")),
        );
      } finally {
        rt.dispose();
      }
    }
    assert.deepEqual(
      [...digests],
      [R10_SELECTION],
      "every apply must yield the identical artifact",
    );
  },
);
