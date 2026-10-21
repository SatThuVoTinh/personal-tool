// M12/T9 F-288 (R7-C4-01) - the deployed stack must carry the model-egress
// allowlist the acceptance overlay proves.
//
// The acceptance overlay rewrote the model-service URL to an allowlisted
// proxy route and the isolation proof (Assert-T5RuntimeIsolation) ran
// against THAT shape. The deployed composition kept the direct host route
// and shipped no allowlisted gateway at all, so the boundary evidence
// transferred to nothing that ships.
//
// The owner authorised the deployed egress change ("cho phAcp"): the deployed
// Nginx now serves the SAME /ollama/api/* allowlist the acceptance overlay
// has, the deployed Knowledge service reaches the model service through that
// gateway, and the egress proof runs against the DEPLOYED composition (the
// live driver) as well as against the acceptance overlay.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const coreCompose = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.core.yml",
);
const knowledgeCompose = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.knowledge.yml",
);
const deployedNginx = read("infrastructure", "nginx", "conf.d", "default.conf");
const acceptanceNginx = read(
  "infrastructure",
  "nginx",
  "conf.d",
  "t5-acceptance.conf",
);
const common = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-common.ps1",
);
const isolated = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5.ps1",
);
const live = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-live.ps1",
);

function parseCompose(source) {
  const document = parseDocument(source, { merge: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function merge(base, overlay) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const bothPlainObjects =
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] !== null &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key]);
    merged[key] = bothPlainObjects ? merge(merged[key], value) : value;
  }
  return merged;
}

/** The deployed composition: the two files the live driver actually merges. */
const deployed = merge(
  parseCompose(coreCompose),
  parseCompose(knowledgeCompose),
);

/**
 * A source-text assertion that does not print the whole file when it fails:
 * the failure names the rule, not the kilobytes.
 */
function assertSourceHas(source, pattern, message) {
  assert.ok(pattern.test(source), message);
}

/** The opposite rule: the source must NOT carry the pattern. */
function assertSourceLacks(source, pattern, message) {
  assert.equal(pattern.test(source), false, message);
}

/**
 * The directive block of one `location = <route> { ... }` block, with the
 * comments and the blank lines removed so two configurations can be compared
 * on what they DO rather than on how they are annotated.
 */
function locationBlock(source, route) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex(
    (line) => line.trim() === `location = ${route} {`,
  );
  if (start < 0) return null;
  const block = [];
  let depth = 0;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    block.push(line);
    depth += (line.match(/\{/gu) ?? []).length;
    depth -= (line.match(/\}/gu) ?? []).length;
    if (depth === 0) break;
  }
  return block
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}
test("F-288: the deployed composition reaches the model service through the allowlisted gateway", () => {
  const knowledge = deployed.services.knowledge;
  const nginx = deployed.services.nginx;

  assert.equal(
    knowledge.environment.KNOWLEDGE_OLLAMA_URL,
    "http://nginx:8080/ollama",
    "the deployed Knowledge service must use the allowlisted gateway route",
  );
  assert.ok(
    knowledge.networks.includes("platform"),
    "the Knowledge service and the gateway must share a network",
  );
  assert.ok(
    nginx.networks.includes("platform"),
    "the gateway must be reachable from the Knowledge service",
  );
});

test("F-288: the deployed Nginx serves the SAME model allowlist as the acceptance overlay", () => {
  for (const route of ["/ollama/api/tags", "/ollama/api/embed"]) {
    const deployedBlock = locationBlock(deployedNginx, route);
    const acceptanceBlock = locationBlock(acceptanceNginx, route);
    assert.ok(
      deployedBlock,
      `the deployed Nginx must declare the ${route} allowlist`,
    );
    assert.equal(
      deployedBlock,
      acceptanceBlock,
      `the deployed ${route} allowlist must be the acceptance allowlist, directive for directive`,
    );
  }
  // The allowlist is exact-match only: a prefix route would expose every
  // model API under /ollama/.
  assertSourceLacks(
    deployedNginx,
    /location \/ollama\//u,
    "the deployed Nginx must not expose a prefix route under /ollama/",
  );
  assertSourceHas(
    deployedNginx,
    /location \/ \{[\s\S]*return 404;/u,
    "the deployed Nginx must still refuse every other route",
  );
});

test("F-288: the deployed gateway can reach the host's model service", () => {
  const nginx = deployed.services.nginx;
  assert.ok(
    Array.isArray(nginx.extra_hosts) &&
      nginx.extra_hosts.includes("host.docker.internal:host-gateway"),
    "the deployed gateway needs the host-gateway mapping to reach the model service",
  );
});

test("F-288: the egress proof runs against the DEPLOYED composition, not only the acceptance overlay", () => {
  assertSourceHas(
    common,
    /function Assert-T5ModelEgressAllowlist/u,
    "the shared egress proof must exist",
  );
  assertSourceHas(
    common,
    /Assert-T5ModelEgressAllowlist \$KnowledgeContainerId/u,
    "the acceptance proof must run the shared egress proof",
  );
  assertSourceHas(
    isolated,
    /Assert-T5RuntimeIsolation \$knowledgeId \$nginxId/u,
    "the acceptance driver must keep the full isolation proof",
  );
  assertSourceHas(
    live,
    /Assert-T5ModelEgressAllowlist \$knowledgeId/u,
    "the deployed driver must run the egress proof too",
  );
  // The proof must run against a started Knowledge container, not before it.
  assert.ok(
    live.indexOf("Assert-T5ModelEgressAllowlist $knowledgeId") >
      live.indexOf('up", "knowledge"'),
    "the egress proof must run after the Knowledge container is started",
  );
  // The refused cases are the proof: a generic forward proxy and any model
  // API the allowlist does not name.
  assertSourceHas(
    common,
    /generic forward proxy/u,
    "the proof must refuse a generic forward proxy",
  );
  assertSourceHas(
    common,
    /non-allowlisted Ollama API/u,
    "the proof must refuse a model API the allowlist does not name",
  );
});

test("F-288: the deployed driver runs the deployed composition", () => {
  assertSourceHas(
    live,
    /compose\.core\.yml/u,
    "the live driver must run the deployed core composition",
  );
  assertSourceHas(
    live,
    /compose\.knowledge\.yml/u,
    "the live driver must run the deployed knowledge composition",
  );
  assertSourceLacks(
    live,
    /compose\.m3-t5\.acceptance\.yml/u,
    "the live driver must not prove the acceptance overlay's shape",
  );
});
