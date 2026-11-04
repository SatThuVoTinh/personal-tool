// F-266 (R7-D13-03) — the preflight validated an embedding model variable no
// runtime component consumes.
//
// The preflight required and probed `OLLAMA_SMOKE_MODEL`, while the service
// reads `KNOWLEDGE_EMBEDDING_MODEL`. The two are independent variables with
// no equality check, so an operator who changed one got a green preflight and
// a knowledge readiness failure at index/embed time.
//
// Acceptance criteria: preflight asserts the model the runtime will actually
// use (or refuses when the two variables differ), with the check visible in
// its output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const preflight = read("infrastructure", "docker", "scripts", "preflight.ps1");
const config = read("apps", "knowledge", "app", "config.py");
const compose = read("infrastructure", "docker", "compose", "compose.core.yml");

test("F-266: the variable the preflight checks is the one the service reads", () => {
  assert.match(
    config,
    /os\.environ\.get\(\s*"KNOWLEDGE_EMBEDDING_MODEL"/,
    "the Knowledge service must read KNOWLEDGE_EMBEDDING_MODEL",
  );
  assert.match(
    compose,
    /KNOWLEDGE_EMBEDDING_MODEL: \$\{KNOWLEDGE_EMBEDDING_MODEL:-/,
    "the deployed service must receive KNOWLEDGE_EMBEDDING_MODEL",
  );
});

test("F-266: the preflight requires the runtime embedding model", () => {
  const required = preflight.match(/\$requiredVariables\s*\+=\s*@\(([^)]*)\)/g);
  assert.ok(required, "the preflight must declare required variables");
  const knowledgeRequirement = required.find((entry) =>
    entry.includes("KNOWLEDGE_VAULT_ROOT"),
  );
  assert.ok(
    knowledgeRequirement,
    "the knowledge profile must declare its required variables",
  );
  assert.match(
    knowledgeRequirement,
    /"KNOWLEDGE_EMBEDDING_MODEL"/,
    "the preflight must require the model the runtime will use",
  );
});

test("F-266: the preflight probes the installed models for the runtime model", () => {
  assert.match(
    preflight,
    /Where-Object\s*\{\s*\$_\.name\s*-eq\s*\$values\.KNOWLEDGE_EMBEDDING_MODEL\s*\}/,
    "the installed-model probe must compare against KNOWLEDGE_EMBEDDING_MODEL",
  );
});

test("F-266: the preflight refuses when the two model variables differ", () => {
  assert.match(
    preflight,
    /OLLAMA_SMOKE_MODEL/,
    "the smoke model must still be read so a divergence can be refused",
  );
  assert.match(
    preflight,
    /throw[^\n]*OLLAMA_SMOKE_MODEL[^\n]*KNOWLEDGE_EMBEDDING_MODEL/,
    "a divergence between the two variables must stop the preflight with both names",
  );
});

test("F-266: the checked model is visible in the preflight output", () => {
  assert.match(
    preflight,
    /Write-Output[^\n]*embedding model/i,
    "the preflight output must name the model it checked",
  );
});
