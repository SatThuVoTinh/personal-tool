import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const app = read("apps", "knowledge", "app", "main.py");
const database = read("apps", "knowledge", "app", "database.py");
const retrieval = read("apps", "knowledge", "app", "retrieval.py");
const reranker = read("apps", "knowledge", "app", "reranker.py");
const exporter = read("apps", "knowledge", "scripts", "export_reranker.py");
const adapter = read("apps", "knowledge", "app", "markdown_adapter.py");
const dockerfile = read("apps", "knowledge", "Dockerfile");
const config = read("apps", "knowledge", "app", "config.py");
const compose = read("infrastructure", "docker", "compose", "compose.core.yml");
const acceptance = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t4.ps1",
);

test("M3/T4 preserves the one canonical tokenizer and retrieval renderer", () => {
  assert.match(
    adapter,
    /def encode_pair\(self, query: str, retrieval_text: str\)/,
  );
  assert.match(adapter, /def pair_count_for_query/);
  assert.match(app, /render_retrieval_text/);
  assert.match(reranker, /PAIR_MAX_TOKENS/);
  assert.match(
    reranker,
    /Exactly one ONNX call handles the complete candidate set/,
  );
});

test("M3/T4 locks filtered HNSW, FTS, and deterministic RRF", () => {
  assert.match(database, /SET LOCAL hnsw\.iterative_scan = strict_order/);
  assert.match(database, /SET LOCAL hnsw\.ef_search = 100/);
  assert.match(database, /SET LOCAL hnsw\.max_scan_tuples = 20000/);
  assert.match(database, /SET LOCAL hnsw\.scan_mem_multiplier = 1/);
  assert.match(database, /repeatable_read/);
  assert.match(database, /websearch_to_tsquery\('simple'/);
  assert.match(database, /ORDER BY dense_distance ASC, id ASC/);
  assert.match(database, /ORDER BY fts_score DESC, segments\.id ASC/);
  assert.match(retrieval, /RRF_K = 60/);
  assert.match(retrieval, /best_branch_rank=min\(ranks\)/);
});

test("M3/T4 keeps public errors and capacity boundaries safe", () => {
  assert.match(app, /SEARCH_CAPACITY_EXCEEDED/);
  assert.match(app, /PAIR_TOKEN_BUDGET_EXCEEDED/);
  assert.match(app, /ACTIVE_INDEX_CHANGED/);
  assert.match(app, /RERANKER_UNAVAILABLE/);
  assert.match(app, /await lease\.release\(\)/);
  assert.match(retrieval, /async def try_acquire/);
  assert.match(reranker, /ThreadPoolExecutor\(\s*max_workers=1/);
});

test("M3/T4 pins and isolates the reranker artifact", () => {
  assert.match(dockerfile, /953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e/);
  assert.match(
    dockerfile,
    /d9e3e081faff1eefb84019509b2f5558fd74c1a05a2c7db22f74174fcedb5286/,
  );
  assert.match(config, /model\.int8\.onnx/);
  assert.match(dockerfile, /runtime-artifacts/);
  assert.match(dockerfile, /ml-dtypes==0\.5\.3/);
  assert.match(dockerfile, /download\.pytorch\.org\/whl\/cpu/);
  assert.match(exporter, /torch\.onnx\.export\([\s\S]*str\(fp32\)/);
  assert.match(compose, /personal-tool\/knowledge:m3/);
  assert.match(compose, /mem_limit: 4g/);
  assert.match(acceptance, /personal-tool-m3-t4/);
  assert.match(acceptance, /\/v1\/search/);
  assert.match(acceptance, /Search ordering is not deterministic/);
  assert.match(
    acceptance,
    /\$mounts \| Where-Object \{ \$_\.Destination -eq "\/vault" \}/,
  );
  assert.match(acceptance, /\$mount\[0\]\.RW/);
  assert.match(acceptance, /cat \/sys\/fs\/cgroup\/memory\.peak/);
  assert.doesNotMatch(acceptance, /docker exec \$containerId sh -c/);
});
