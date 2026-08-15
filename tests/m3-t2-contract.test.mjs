import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const knowledgeRoot = path.join(repositoryRoot, "apps", "knowledge");

function readKnowledgeFile(...parts) {
  return readFileSync(path.join(knowledgeRoot, ...parts), "utf8");
}

test("M3/T2 locks Python dependencies and tokenizer artifact", () => {
  const project = readKnowledgeFile("pyproject.toml");
  const lock = readKnowledgeFile("uv.lock");
  const dockerfile = readKnowledgeFile("Dockerfile");

  assert.match(project, /requires-python = ">=3\.13,<3\.14"/);
  assert.match(project, /"tokenizers==0\.23\.1"/);
  assert.match(project, /"pyyaml==6\.0\.3"/);
  assert.match(lock, /name = "tokenizers"[\s\S]*version = "0\.23\.1"/);
  assert.match(lock, /name = "pyyaml"[\s\S]*version = "6\.0\.3"/);
  assert.match(
    dockerfile,
    /ghcr\.io\/astral-sh\/uv:0\.12\.0@sha256:606e70c71c852d03f611b1e56a195d08648507018a7057fab82c4974c4eae105/,
  );
  assert.match(dockerfile, /uv sync --locked --no-dev --no-install-project/);
  assert.match(
    dockerfile,
    /953dc6f6f85a1b2dbfca4c34a2796e7dde08d41e\/tokenizer\.json/,
  );
  assert.match(
    dockerfile,
    /69564b696052886ed0ac63fa393e928384e0f8caada38c1f4864a9bfbf379c15/,
  );
  const runtimeStage = dockerfile.split(" AS runtime")[1];
  assert.ok(runtimeStage);
  assert.doesNotMatch(runtimeStage, /COPY --from=uv/);
});

test("M3/T2 retains the approved scanner result contract", () => {
  const adapter = readKnowledgeFile("app", "markdown_adapter.py");
  const service = readKnowledgeFile("app", "main.py");

  for (const symbol of [
    "MarkdownScanResult",
    "MarkdownSource",
    "MarkdownSegment",
    "MarkdownValidationError",
    "discovered_count",
    "valid_source_count",
    "retrieval_text",
    "content_token_count",
    "retrieval_token_count",
  ]) {
    assert.match(adapter, new RegExp(`\\b${symbol}\\b`));
  }
  assert.match(service, /FastAPI/);
});

test("M3/T2 locks tag-derived taxonomy, lexical boundaries, and token budgets", () => {
  const adapter = readKnowledgeFile("app", "markdown_adapter.py");

  assert.match(adapter, /\("Agricultural Science", "#agriculturalscience"\)/);
  assert.match(adapter, /TAG_TO_TOPIC\[raw_tag\]/);
  assert.match(adapter, /primary_topic = canonical_topics\[0\]/);
  assert.doesNotMatch(adapter, /_topic_from_path/);
  assert.match(adapter, /_CLOUD_REPARSE_TAG = 0x9000001A/);
  assert.match(adapter, /_is_cloud_placeholder/);
  assert.match(adapter, /TARGET_CHARS = 1500/);
  assert.match(adapter, /MAX_CHARS = 2000/);
  assert.match(adapter, /QUERY_MAX_TOKENS = 256/);
  assert.match(adapter, /PAIR_MAX_TOKENS = 1024/);
  assert.match(adapter, /PAIR_SPECIAL_TOKENS_EXPECTED = 4/);
  assert.match(adapter, /MAX_RETRIEVAL_TOKENS = 764/);
  assert.match(adapter, /no_truncation\(\)/);
  assert.match(adapter, /no_padding\(\)/);
  assert.match(adapter, /num_special_tokens_to_add\(is_pair=True\)/);
  assert.match(adapter, /pair=retrieval_text/);
  assert.match(adapter, /add_special_tokens=False/);
});

test("M3/T2 acceptance is read-only, isolated, and deterministic", () => {
  const acceptance = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "docker",
      "scripts",
      "knowledge-t2.ps1",
    ),
    "utf8",
  );
  const windowsAcceptance = readFileSync(
    path.join(
      repositoryRoot,
      "infrastructure",
      "docker",
      "scripts",
      "knowledge-t2-windows.ps1",
    ),
    "utf8",
  );

  assert.match(acceptance, /personal-tool-m3-t2-fixture/);
  assert.match(acceptance, /target=\/vault,readonly/);
  assert.match(acceptance, /Get-FixtureManifest/);
  assert.match(acceptance, /docker rm --force \$containerName/);
  assert.match(windowsAcceptance, /ItemType Junction/);
  assert.match(windowsAcceptance, /scan_vault\(vault_root\)/);
  assert.match(
    windowsAcceptance,
    /68200e25de594df92387186bbfb9d9df606ec1d87efaa0ae0c7f690970e53db6/,
  );
});
