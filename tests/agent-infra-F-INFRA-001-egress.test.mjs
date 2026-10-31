import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const COMPOSE_CORE_PATH = path.join(
  REPO_ROOT,
  "infrastructure/docker/compose/compose.core.yml",
);
const NETWORKS_YML_PATH = path.join(
  REPO_ROOT,
  "infrastructure/networking/networks.yml",
);

/**
 * Validates compose topology content for F-INFRA-001 egress restrictions.
 * Returns an array of error messages (empty if valid).
 */
export function validateComposeEgressTopology(yamlContent) {
  const errors = [];

  // Check 1: platform network must be marked internal: true
  const platformNetworkMatch = yamlContent.match(
    /platform:\s*\n(?:\s+#[^\n]*\n)*\s*driver:\s*bridge\s*\n\s*internal:\s*(true|false)/m,
  );

  if (!platformNetworkMatch) {
    errors.push(
      "platform network declaration with 'driver: bridge' and 'internal: <bool>' was not found",
    );
  } else if (platformNetworkMatch[1] !== "true") {
    errors.push(
      `platform network 'internal' property is '${platformNetworkMatch[1]}', must be 'true'`,
    );
  }

  // Check 2: no service may use network_mode: host
  if (/network_mode:\s*["']?host["']?/im.test(yamlContent)) {
    errors.push(
      "a service declares 'network_mode: host', which bypasses internal network isolation",
    );
  }

  return errors;
}

test("F-INFRA-001: compose.core.yml enforces platform network internal bridge constraint", () => {
  const content = readFileSync(COMPOSE_CORE_PATH, "utf-8");
  const errors = validateComposeEgressTopology(content);
  assert.deepStrictEqual(
    errors,
    [],
    `compose.core.yml topology validation failed: ${errors.join("; ")}`,
  );
});

test("F-INFRA-001: infrastructure/networking/networks.yml enforces internal: true", () => {
  const content = readFileSync(NETWORKS_YML_PATH, "utf-8");
  assert.match(
    content,
    /internal:\s*true/m,
    "networks.yml must declare internal: true for platform network",
  );
});

test("F-INFRA-001: knowledge workload routes egress exclusively through Nginx model gateway", () => {
  const content = readFileSync(COMPOSE_CORE_PATH, "utf-8");

  // Extract the knowledge service block
  const knowledgeMatch = content.match(
    /knowledge:\s*\n(?:\s+.+\n)*?(?=\n\s\s\w+:|\nnetworks:|\nvolumes:|$)/m,
  );
  assert.ok(
    knowledgeMatch,
    "knowledge service definition must exist in compose.core.yml",
  );

  const knowledgeBlock = knowledgeMatch[0];

  // Must reference platform network
  assert.match(
    knowledgeBlock,
    /networks:\s*\n\s*-\s*platform/m,
    "knowledge service must be attached to platform network",
  );

  // KNOWLEDGE_OLLAMA_URL must route to http://nginx:8080/ollama
  const ollamaMatch = knowledgeBlock.match(
    /KNOWLEDGE_OLLAMA_URL:\s*(http:\/\/nginx:8080\/ollama)/m,
  );
  assert.ok(
    ollamaMatch,
    "KNOWLEDGE_OLLAMA_URL in knowledge service must be 'http://nginx:8080/ollama'",
  );
});

test("F-INFRA-001: mutation probe - detecting network_mode: host or internal: false in topology", () => {
  const validContent = readFileSync(COMPOSE_CORE_PATH, "utf-8");

  // Mutation 1: Flip internal: true to internal: false
  const mutatedInternalFalse = validContent.replace(
    /(platform:\s*\n(?:\s+#[^\n]*\n)*\s*driver:\s*bridge\s*\n\s*internal:\s*)true/,
    "$1false",
  );
  const errorsFalse = validateComposeEgressTopology(mutatedInternalFalse);
  assert.ok(
    errorsFalse.length > 0,
    "Topology validator must reject topology with internal: false",
  );
  assert.match(
    errorsFalse[0],
    /internal.*must be 'true'/,
    "Error should identify internal: false violation",
  );

  // Mutation 2: Add network_mode: host to knowledge service
  const mutatedHostNetwork = validContent.replace(
    /knowledge:\s*\n/,
    "knowledge:\n    network_mode: host\n",
  );
  const errorsHost = validateComposeEgressTopology(mutatedHostNetwork);
  assert.ok(
    errorsHost.length > 0,
    "Topology validator must reject topology with network_mode: host",
  );
  assert.match(
    errorsHost[0],
    /network_mode: host/,
    "Error should identify network_mode: host violation",
  );
});

