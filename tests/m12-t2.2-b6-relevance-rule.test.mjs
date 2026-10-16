import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RETRIEVAL_MIN_RELEVANCE,
  deduplicateRetrievalContext,
  filterByMinRelevance,
  resolveRelevanceScore,
} from "../zink-tools/common/semantic-contract.mjs";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTRACT_PATH = path.join(
  REPO_ROOT,
  "zink-tools/common/semantic-contract.mjs",
);
const SKILL_ADAPTER_PATH = path.join(
  REPO_ROOT,
  "zink-tools/adapters/skill-store/skill-adapter.mjs",
);

function codeOnly(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
}

// R5-E07-02: the same three-field score chain existed twice with opposite defaults for a
// score-less item -- the filter treated it as full evidence (`?? 1`) while the sort ranked it
// last (`?? 0`). One rule now decides, and it decides the conservative way, which is what
// both live adapters already do.

test("the shared rule prefers score, then relevance, then confidence", () => {
  assert.equal(
    resolveRelevanceScore({ score: 0.9, relevance: 0.4, confidence: 0.2 }),
    0.9,
  );
  assert.equal(resolveRelevanceScore({ relevance: 0.4, confidence: 0.2 }), 0.4);
  assert.equal(resolveRelevanceScore({ confidence: 0.2 }), 0.2);
});

test("an item with no score is not evidence", () => {
  assert.equal(resolveRelevanceScore({}), 0);
  assert.equal(resolveRelevanceScore(undefined), 0);
});

test("the relevance filter drops a score-less item instead of keeping it as full confidence", () => {
  const scored = {
    passage_id: "p1",
    text: "scored",
    score: RETRIEVAL_MIN_RELEVANCE,
  };
  const unscored = { passage_id: "p2", text: "unscored" };
  assert.deepEqual(filterByMinRelevance([scored, unscored]), [scored]);
});

test("the dedup sort ranks the same item last, by the rule the filter uses", () => {
  const { canonicalFacts } = deduplicateRetrievalContext([
    { passage_id: "b", text: "unscored", type: "fact" },
    { passage_id: "a", text: "strong", type: "fact", score: 0.8 },
    { passage_id: "c", text: "weak", type: "fact", score: 0.4 },
  ]);
  assert.deepEqual(
    canonicalFacts.map((item) => item.passage_id),
    ["a", "c", "b"],
  );
});

test("the score chain exists once, so the filter and the sort cannot drift apart again", () => {
  const code = codeOnly(readFileSync(CONTRACT_PATH, "utf8"));
  const chains = code.match(/\.score\s*\?\?/gu) ?? [];
  assert.equal(
    chains.length,
    1,
    `expected exactly one score chain, inside resolveRelevanceScore; found ${chains.length}`,
  );
  assert.ok(
    !/confidence\s*\?\?\s*1\)/u.test(code),
    "the permissive `?? 1` default must not survive anywhere",
  );
});

test("the skill-store adapter reads the shared threshold instead of repeating 0.3", () => {
  const code = codeOnly(readFileSync(SKILL_ADAPTER_PATH, "utf8"));
  assert.match(code, /RETRIEVAL_MIN_RELEVANCE/u);
  assert.doesNotMatch(code, /minScore \?\? 0\.3/u);
});
