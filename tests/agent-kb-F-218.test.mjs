// F-218 (R5-E10-08) — the Knowledgebase's contract tests must not pin source
// text.
//
// A comment reword, an import-line edit or a units rename turned suites red
// while nothing behavioural changed, and the converse is worse: a code change
// could keep the pinned text, drop the enforcement and stay green. Three
// instances sit in the Knowledgebase's own test files:
//
//   1. `test_b14_cause_attribution.py`: a whole-file text scan for the literal
//      `from None` — a reworded comment in `main.py` would redden it;
//   2. `test_pdf_migration_contract.py`: substring containment on the RAW TEXT
//      of the migration SQL — a reformatted migration statement would
//      redden it;
//   3. `test_r24_pdf_runtime_boundary.py`: the NAME of the private exception
//      class the reader raises — a rename of that class would redden it.
//
// The conversions themselves belong to the Knowledgebase agent: `apps/
// knowledge/**` is outside this lane's write scope. This lane is the half
// that keeps the conversion in place. It fails while any of the three pin
// shapes survives in the file it names, and passes when the assertion is
// behavioural: the cause is observed on the exception chain, the migration is
// observed through its effect, and the cap is observed through the exception
// it raises rather than through the string of its class name.
//
// Each rule below matches the PIN SHAPE, not the file's prose, so a comment
// that explains the rule cannot redden the lane.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const KNOWLEDGE_TESTS = path.join(REPO_ROOT, "apps", "knowledge", "tests");

function readKnowledgeTest(name) {
  return readFileSync(path.join(KNOWLEDGE_TESTS, name), "utf8");
}

test("F-218: the cause-attribution suite does not scan source text", () => {
  const source = readKnowledgeTest("test_b14_cause_attribution.py");
  // The pin: `self.assertNotIn("from None", body)` over a file read as text.
  assert.doesNotMatch(
    source,
    /assert(?:Not)?In\(\s*f?["']from None["']/u,
    "the cause rule must be observed on the exception chain (the suite already asserts `__cause__` on the search route and on the model probe), not by scanning the source text for the literal 'from None'",
  );
  // The behavioural half must still be there: a conversion that only removes
  // the text scan would leave the property unproven.
  assert.match(
    source,
    /__cause__/u,
    "the suite must assert the cause on the exception chain itself",
  );
});

test("F-218: the migration contract suite does not assert on raw SQL text", () => {
  const source = readKnowledgeTest("test_pdf_migration_contract.py");
  // The pin: `self.assertIn("...", self.sql)` — the subject is the raw
  // migration text.
  assert.doesNotMatch(
    source,
    /assert(?:Not)?In\(\s*f?"[^"]{0,400}"\s*,\s*self\.sql\b/su,
    "the migration contract must be observed through the migration's effect (the schema it creates, or the statements it executes), not through substring containment on the raw SQL text",
  );
});

test("F-218: the PDF runtime boundary suite does not pin the exception class name", () => {
  const source = readKnowledgeTest("test_r24_pdf_runtime_boundary.py");
  // The pin: `assertEqual(type(caught.exception).__name__, "_OutputCapExceeded")`
  // — a rename of a private class is not a behaviour change, but this
  // assertion makes it one.
  assert.doesNotMatch(
    source,
    /type\(\s*\w+\.exception\s*\)\.__name__/u,
    "the cap must be observed through the exception it raises (an isinstance assertion against the imported class), not through the NAME of that class",
  );
  // The behavioural half: the end-to-end effect is already proven elsewhere in
  // the same file, and it must stay.
  assert.match(
    source,
    /PDF_RUNTIME_OUTPUT_LIMIT/u,
    "the suite must keep proving that an oversized response is rejected as PDF_RUNTIME_OUTPUT_LIMIT",
  );
});
