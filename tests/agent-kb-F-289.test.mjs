// F-289 (R7-C4-02) — the acceptance helper treated any nonzero exit as proof
// that the database rejected the statement.
//
// The negative-case helper set error handling aside, ran a statement through
// the container exec path, discarded the error stream, and asserted only that
// the exit code was not zero. Exec failure, malformed SQL, a missing column,
// an authentication problem and the intended unique violation all produced the
// same green result, so the one-ACTIVE-index invariant could go unexercised
// while the lane printed "passed".
//
// Acceptance criteria: the helper asserts the specific constraint-violation
// signature and reddens on any other failure mode.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const t1 = read("infrastructure", "docker", "scripts", "knowledge-t1.ps1");

function sqlFailureHelper() {
  const match = t1.match(/function Assert-SqlFailure \{[\s\S]*?\n\}/);
  assert.ok(match, "knowledge-t1.ps1 must declare its SQL failure helper");
  return match[0];
}

test("F-289: the helper keeps the database's error text", () => {
  const helper = sqlFailureHelper();
  assert.match(helper, /2>&1/, "the helper must capture the error stream");
  assert.doesNotMatch(
    helper,
    /2>&1\s*\|\s*Out-Null/,
    "the error stream must not be discarded: the text is the only evidence",
  );
});

test("F-289: the helper requires the constraint-violation exit code", () => {
  const helper = sqlFailureHelper();
  assert.match(
    helper,
    /\$exitCode\s*-ne\s*3\b/,
    "psql exits 3 when ON_ERROR_STOP turned a SQL error into a failed script",
  );
  assert.match(
    helper,
    /throw[^\n]*exit/i,
    "another exit code must stop the helper with the code named",
  );
});

test("F-289: the helper requires the constraint signature in the error text", () => {
  const helper = sqlFailureHelper();
  assert.match(
    helper,
    /ExpectedSignature/,
    "the helper must be told which signature it is waiting for",
  );
  assert.match(
    helper,
    /\$output\s+-notmatch/,
    "the captured error text must be compared with the expected signature",
  );
});

test("F-289: the call site names the constraint the statement must violate", () => {
  const call = t1.match(
    /Assert-SqlFailure\s+-Command[\s\S]{0,400}?ExpectedSignature[^\n]*/,
  );
  assert.ok(call, "the one-ACTIVE-index check must call the helper");
  assert.match(
    call[0],
    /knowledge_indexes_one_active_idx/,
    "the expected signature must be the partial unique index the statement violates",
  );
});
