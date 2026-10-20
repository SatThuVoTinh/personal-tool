// F-317 (R7-E3-06) -- the per-mode entrypoint admission lists are checked per
// WINDOW, not by a file-wide occurrence count.
//
// The old assertion split `configure.mjs` on a marker and required the count
// to be two, with a message stating that the entry must appear in the preflight
// list AND the apply list. A count cannot bind membership to either list: two
// copies inside ONE window satisfy it while the other window is empty. The
// failure message therefore described a condition the assertion could not
// evaluate.
//
// This lane slices the two real windows (the `--preflight` call site and the
// `--apply` call site of the governance entrypoint) and asserts membership per
// window, so both entries in one window and an empty other window REDdens it.
// The sibling structural lane (`tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs`)
// binds the same structure positionally; this lane is the falsifiable form of
// the count.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIGURE = path.join(REPO, "integrations", "openclaw", "configure.mjs");
const lines = readFileSync(CONFIGURE, "utf8").split(/\r?\n/u);

// The two named predecessors the finding quotes. Both are OUTGOING builds that
// the next authorized deployment must still be able to admit, so both lists
// must carry them.
const R5_BASELINE_ENTRYPOINT_SHA256 =
  "0fb628e891a93d570715937a95fc65b82acf14964f00d5de495eeead2138e946";
const R8_CANDIDATE_ENTRYPOINT_SHA256 =
  "6a7968b7d456ff6d3f2c5b9d60c7b6046a702603b880093c33b717d9a37c13b1";

const DIGEST = /["']([0-9a-f]{64})["']/gu;

function entrypointWindow(callName) {
  const anchor = lines.findIndex(
    (line, index) =>
      line.includes("output.governancePluginEntrypointPath,") &&
      lines
        .slice(Math.max(0, index - 6), index)
        .some((previous) => previous.trim() === `${callName}(`),
  );
  assert.notEqual(
    anchor,
    -1,
    `the ${callName} governance-entrypoint call site must exist`,
  );
  const end = lines.findIndex(
    (line, index) => index > anchor && line.trim() === ");",
  );
  assert.notEqual(
    end,
    -1,
    `the ${callName} governance-entrypoint call site must be closed`,
  );
  return lines.slice(anchor, end + 1).join("\n");
}

function digestsIn(window) {
  return [...window.matchAll(DIGEST)].map((match) => match[1]);
}

const preflightWindow = entrypointWindow("assertOwnedFileMatchesOrMissing");
const applyWindow = entrypointWindow("materializeOwnedFile");
const preflightDigests = digestsIn(preflightWindow);
const applyDigests = digestsIn(applyWindow);

test("F-317: the preflight window admits the R5 and R8 predecessors", () => {
  assert.ok(
    preflightDigests.includes(R5_BASELINE_ENTRYPOINT_SHA256),
    "the R5 predecessor must be admitted by the --preflight window",
  );
  assert.ok(
    preflightDigests.includes(R8_CANDIDATE_ENTRYPOINT_SHA256),
    "the R8 predecessor must be admitted by the --preflight window",
  );
  assert.equal(
    preflightDigests.filter(
      (digest) => digest === R5_BASELINE_ENTRYPOINT_SHA256,
    ).length,
    1,
    "a predecessor must be listed once in the --preflight window",
  );
});

test("F-317: the apply window admits the R5 and R8 predecessors", () => {
  assert.ok(
    applyDigests.includes(R5_BASELINE_ENTRYPOINT_SHA256),
    "the R5 predecessor must be admitted by the --apply window",
  );
  assert.ok(
    applyDigests.includes(R8_CANDIDATE_ENTRYPOINT_SHA256),
    "the R8 predecessor must be admitted by the --apply window",
  );
  assert.equal(
    applyDigests.filter((digest) => digest === R5_BASELINE_ENTRYPOINT_SHA256)
      .length,
    1,
    "a predecessor must be listed once in the --apply window",
  );
});

test("F-317: the two per-mode windows cannot diverge", () => {
  const preflightSet = new Set(preflightDigests);
  const applySet = new Set(applyDigests);
  const missingFromApply = [...preflightSet].filter(
    (digest) => !applySet.has(digest),
  );
  const missingFromPreflight = [...applySet].filter(
    (digest) => !preflightSet.has(digest),
  );
  assert.deepEqual(
    missingFromApply,
    [],
    "every predecessor the --preflight window admits must be admitted by the --apply window, or --preflight PASSES and --apply refuses",
  );
  assert.deepEqual(
    missingFromPreflight,
    [],
    "every predecessor the --apply window admits must be admitted by the --preflight window, or the modes disagree",
  );
  assert.equal(
    preflightDigests.length,
    applyDigests.length,
    "the two per-mode windows must carry the same number of admitted predecessors",
  );
});
