// M10/T2-R8 — observability entrypoint predecessor admission.
//
// The R8 observability deploy attempt never started: `configure.mjs
// --preflight` refused the live R5 runtime with `Governance plugin
// entrypoint` (installed_mutation false) because live `index.mjs`
// (0fb628e8, the R5 build) is not admitted in either per-mode
// entrypoint predecessor list, while the R8 candidate rebuilds it as
// 6a7968b7 (ingress-verdict observability logging). Same deadlock
// class R2 closed for six entrypoints, R3 for ten assets, R6 for the
// boundary, and R7 for authority — this time one entrypoint wide.
//
// Provenance (not inference): the digest was re-derived by materializing
// commit 4d1e64e (M10/T2-R5 host-side Discord inbound metadata exposure,
// the origin commit that introduced these exact bytes) and packaging it
// through the repository's own governancePluginFiles() — byte-identical
// to the observed live file (0fb628e8…, verified read-only against the
// live runtime before admission). See R8 P1, which re-derives it in-test.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
// This suite reads only committed source and git history; it never spawns
// `configure.mjs`, so it needs no router environment.
const REPO = process.cwd();
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const CONFIGURE_SOURCE = readFileSync(CONFIGURE, "utf8");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** The live R5 predecessor R8 admits, proven in R8 P1 below. */
const R5_OBSERVABILITY_BASELINE_SHA256 =
  "0fb628e891a93d570715937a95fc65b82acf14964f00d5de495eeead2138e946";

/** The R8 candidate build. Deliberately NOT listed (content comparison). */
const R8_CANDIDATE_ENTRYPOINT_SHA256 =
  "6a7968b7d456ff6d3f2c5b9d60c7b6046a702603b880093c33b717d9a37c13b1";

/** The origin commit whose packaged entrypoint reproduces the live digest. */
const R5_SOURCE_COMMIT = "4d1e64e";

/** Package a historical commit through the real generator (provenance). */
let r5Generated = null;
async function r5Extension() {
  if (r5Generated) return r5Generated;
  const scratch = mkdtempSync(path.join(os.tmpdir(), "zink-r8-gen-"));
  try {
    const archive = spawnSync(
      "git",
      ["archive", R5_SOURCE_COMMIT, "--", "integrations/openclaw"],
      { cwd: REPO, maxBuffer: 256 * 1024 * 1024 },
    );
    assert.equal(archive.status, 0, "git archive must succeed");
    const tar = spawnSync("tar", ["-x", "-C", scratch], {
      input: archive.stdout,
      maxBuffer: 256 * 1024 * 1024,
    });
    assert.equal(tar.status, 0, "extract must succeed");
    const { governancePluginFiles } = await import(
      pathToFileURL(
        path.join(scratch, "integrations", "openclaw", "lib", "policy.mjs"),
      ).href
    );
    r5Generated = governancePluginFiles();
    return r5Generated;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// PROVENANCE — 1/1 before admission
// ---------------------------------------------------------------------------

test("R8 P1: the live entrypoint digest is reproduced from its source commit", async () => {
  const r5 = await r5Extension();
  assert.equal(
    sha256(r5.entrypoint),
    R5_OBSERVABILITY_BASELINE_SHA256,
    "the committed R5 source must reproduce the live digest",
  );
  // Optional live cross-check: skip where the live dir is unreachable.
  let liveDigest = null;
  try {
    liveDigest = sha256(
      readFileSync(
        "/home/hoang_vinh/.openclaw-zink/extensions/zink-governance/index.mjs",
        "utf8",
      ),
    );
  } catch {
    /* not reachable from this platform */
  }
  if (liveDigest !== null)
    assert.equal(liveDigest, R5_OBSERVABILITY_BASELINE_SHA256);
});

// ---------------------------------------------------------------------------
// THE ALLOWLIST — exactly one addition, in BOTH per-mode lists
// ---------------------------------------------------------------------------

test("R8 0: provenance parity — the R5 digest is admitted in BOTH per-mode entrypoint lists", () => {
  assert.equal(
    CONFIGURE_SOURCE.split(R5_OBSERVABILITY_BASELINE_SHA256).length - 1,
    2,
    "0fb628e8 must be admitted in the preflight list AND the apply list, " +
      "or --preflight would PASS and --apply would refuse",
  );
  assert.notEqual(
    R8_CANDIDATE_ENTRYPOINT_SHA256,
    R5_OBSERVABILITY_BASELINE_SHA256,
    "predecessor is never the current build",
  );
});

test("R8 0b: the R8 candidate is now the OUTGOING build and IS listed", () => {
  // M10/T2-R8: 6a7968b7 was the current build while R8 observability was being
  // prepared, so it was deliberately absent. It has since been DEPLOYED, which
  // makes it the outgoing predecessor: the next authorized deployment changes
  // the entrypoint again, so --preflight must be able to admit it. Its presence
  // in the list is now required, in BOTH per-mode lists.
  assert.ok(
    CONFIGURE_SOURCE.includes(R8_CANDIDATE_ENTRYPOINT_SHA256),
    "the deployed R8 entrypoint must remain an admitted predecessor",
  );
  const occurrences =
    CONFIGURE_SOURCE.split(R8_CANDIDATE_ENTRYPOINT_SHA256).length - 1;
  assert.equal(
    occurrences,
    2,
    "both per-mode entrypoint lists must admit it, so the modes cannot diverge",
  );
});
