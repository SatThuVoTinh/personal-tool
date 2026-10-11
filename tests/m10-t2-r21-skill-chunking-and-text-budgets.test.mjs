// M10/T2-R21 — skill chunking byte budget, and knowledge result text budget.
//
// Both defects were measured against the pre-fix code by execution.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const ROOT = "C:/Users/HOANG VINH/OneDrive/Documents/personal-tool";
// Windows absolute paths must be file:// URLs for the ESM loader.
const { chunkSkillContent } = await import(
  `file:///${ROOT}/zink-skill-store/src/vector-sync.mjs`
);
const { renderEmbeddingEnvelope } = await import(
  `file:///${ROOT}/zink-tools/common/semantic-contract.mjs`
);

const KB_MAIN = readFileSync(`${ROOT}/apps/knowledge/app/main.py`, "utf8");
const KB_PDF = readFileSync(
  `${ROOT}/apps/knowledge/app/pdf_foundation.py`,
  "utf8",
);

test("R21-01: no chunk ever exceeds the embedding envelope ceiling", () => {
  // Proven pre-fix: chunkSkillContent had NO length branch at all — its own
  // docstring claimed "by headings or length bounds". A 42,013-byte
  // single-section skill produced 1 segment and raised
  // EMBEDDING_INPUT_TOO_LARGE, so it was permanently un-indexable.
  const cases = [
    ["ASCII single section", "# Big\n\n" + "a".repeat(42000)],
    ["Vietnamese", "# Kỹ\n\n" + "ế".repeat(20000)],
    ["CJK", "# 技能\n\n" + "中".repeat(20000)],
    ["emoji", "# S\n\n" + "😀".repeat(15000)],
    ["one very long line", "# X\n\n" + "z".repeat(250000)],
    [
      "many sections",
      Array.from({ length: 200 }, (_, i) => `## S${i}\nt${i}`).join("\n"),
    ],
    ["small", "# S\n\nA short skill body."],
  ];
  for (const [label, content] of cases) {
    const segments = chunkSkillContent(content);
    assert.ok(segments.length > 0, `${label}: must produce segments`);
    for (const s of segments) {
      assert.doesNotThrow(
        () =>
          renderEmbeddingEnvelope({
            skillId: "office/s",
            headingPath: s.heading_path,
            content: s.content,
          }),
        `${label}: segment ${s.segment_ordinal} must be embeddable`,
      );
    }
  }
});

test("R21-02: chunking preserves the content", () => {
  const content = "# A\n\n" + "x".repeat(40000) + "\n# B\n\nshort tail";
  const segments = chunkSkillContent(content);
  const kept = segments.reduce(
    (a, s) => a + s.content.replace(/\s/gu, "").length,
    0,
  );
  const original = content.replace(/\s/gu, "").length;
  assert.ok(
    kept >= original * 0.98,
    `content lost: kept ${kept} of ${original} non-space chars`,
  );
});

test("R21-03: ordinals are dense, ordered and headings are carried", () => {
  const segments = chunkSkillContent(
    "# A\n\n" + "x".repeat(40000) + "\n# B\n\ntail",
  );
  assert.deepEqual(
    segments.map((s) => s.segment_ordinal),
    segments.map((_, i) => i),
    "ordinals must be dense and ordered",
  );
  assert.equal(
    segments.at(-1).heading_path[0],
    "B",
    "the trailing heading must survive",
  );
  assert.ok(
    segments.slice(0, -1).every((s) => s.heading_path[0] === "A"),
    "split segments keep the heading they were produced under",
  );
});

test("R21-04: a single over-long line is split, not truncated", () => {
  const one = "w".repeat(200000);
  const segments = chunkSkillContent("# T\n\n" + one);
  assert.ok(segments.length > 1, "a 200KB single line must be split");
  const kept = segments.reduce(
    (a, s) => a + s.content.replace(/\s/gu, "").length,
    0,
  );
  assert.ok(kept >= one.length * 0.98, "splitting must not drop content");
  for (const s of segments) {
    assert.doesNotMatch(
      s.content,
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u,
      "splitting must never leave a lone surrogate",
    );
  }
});

/** Python source with `#` comment lines removed, so an explanatory comment
 *  quoting the old expression cannot satisfy (or trip) a source assertion. */
const pyCode = (src) =>
  src
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

test("R21-05: the knowledge rerank pool is wider than the page", () => {
  // Proven pre-fix: `min(MAX_RERANK_CANDIDATES, request.limit)` is always
  // `request.limit`, because MAX_RERANK_CANDIDATES is 20 and `limit` is capped
  // at le=20. The reranker therefore only scored the page it was about to
  // return — a pure reorderer that could never improve recall — and the
  // `min_score` filter ran AFTER the pool had been cut to the page size.
  const code = pyCode(KB_MAIN);
  assert.doesNotMatch(
    code,
    /min\(MAX_RERANK_CANDIDATES,\s*request\.limit\)/u,
    "the rerank pool must not be clamped to the page size",
  );
  const assignments =
    code.match(/candidate_limit = MAX_RERANK_CANDIDATES/gu) || [];
  assert.equal(
    assignments.length,
    2,
    "both the reranked and the non-reranked branch must use the pool constant",
  );
  // The filter must still run before the final page cut.
  const filterAt = code.indexOf("request.min_score is not None");
  const limitAt = code.indexOf("bounded_results = results[:request.limit]");
  assert.ok(
    filterAt > 0 && limitAt > filterAt,
    "min_score must filter before the limit",
  );
});

test("R21-06: /readyz is at least as strict as the default search", () => {
  // `SearchRequest.rerank` defaults to True and a missing reranker makes every
  // default search 503. The probe defaulted to `require_reranker=False`, so an
  // image with a failed-provenance reranker reported ready while 100% of
  // default traffic failed.
  assert.match(
    pyCode(KB_MAIN),
    /async def readyz\(require_reranker: bool = True\)/u,
    "the readiness probe must default to requiring the reranker",
  );
  assert.match(
    pyCode(KB_MAIN),
    /rerank: bool = True/u,
    "the default search must still ask for rerank",
  );
});

test("R21-07: sidecar reads are bounded BEFORE the allocation", () => {
  // The 64 KiB cap ran after `read_bytes()`, so it bounded nothing; and the
  // discovery sweep had no check at all, so one large `.md` in the vault was
  // read whole into the service process during an index run.
  const sweep = KB_PDF.slice(KB_PDF.indexOf('rglob("*.md")'));
  const sweepLines = sweep.slice(
    0,
    sweep.indexOf("raw = sidecar.read_bytes()"),
  );
  assert.match(
    sweepLines,
    /st_size > MAX_SIDECAR_BYTES/u,
    "discovery must stat before reading",
  );
  const parse = KB_PDF.slice(KB_PDF.indexOf("def parse_pdf_sidecar"));
  const guard = parse.indexOf("st_size > MAX_SIDECAR_BYTES");
  const read = parse.indexOf("raw = sidecar_path.read_bytes()");
  assert.ok(guard > 0 && guard < read, "the size check must precede the read");
});
