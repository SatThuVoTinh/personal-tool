// F-241 (R7-D7-01) - infrastructure/networking/networks.yml is a placeholder
// whose own premise is already false and which nothing reads.
//
// The file said the shared network definitions "will be added with the
// Compose implementation", but the Compose implementation already exists and
// defines its networks inline, so the placeholder was superseded before it
// was ever populated and no loader referenced it.
//
// The acceptance criterion offers two branches: the file is removed, or it
// declares a network that a compose file consumes by a shared name plus a
// documented step that creates it. Removal is a destructive action on a
// tracked file, so the second branch is taken: the declaration becomes real,
// a compose file consumes the network by the shared name `platform`, the
// creation step is documented, and the repository policy check keeps the
// declaration and the compose files from drifting apart.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

import {
  checkSharedNetworkDeclaration,
  compareSharedNetworks,
} from "../scripts/repository-policy.mjs";

const root = process.cwd();

const NETWORK_DECLARATION_PATH = path.join(
  "infrastructure",
  "networking",
  "networks.yml",
);
const COMPOSE_DIRECTORY = path.join("infrastructure", "docker", "compose");

function parseYaml(relativePath) {
  const document = parseDocument(
    readFileSync(path.join(root, relativePath), "utf8"),
    { uniqueKeys: true },
  );
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function sharedNetworks() {
  const parsed = parseYaml(NETWORK_DECLARATION_PATH);
  assert.ok(parsed, "the shared network declaration must parse");
  return parsed.networks;
}

function composeNetworks() {
  const networks = {};
  for (const name of readdirSync(path.join(root, COMPOSE_DIRECTORY)).sort()) {
    if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
    const parsed = parseYaml(path.join(COMPOSE_DIRECTORY, name));
    networks[name] = parsed.networks ?? {};
  }
  return networks;
}

function runbooks() {
  const directory = path.join(root, "docs", "runbooks");
  return readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .map((name) => ({
      name,
      text: readFileSync(path.join(directory, name), "utf8"),
    }));
}
test("F-241: the shared network declaration is a real declaration, not a comment", () => {
  const networks = sharedNetworks();
  assert.ok(networks, "the declaration must carry a networks mapping");
  assert.ok(
    Object.keys(networks).length > 0,
    "the declaration must declare at least one network",
  );
  assert.equal(networks.platform.driver, "bridge");
});

test("F-241: a compose file consumes the declared network by the shared name", () => {
  const networks = sharedNetworks();
  const compose = composeNetworks();
  const consumers = Object.entries(compose).filter(([, declared]) =>
    Object.hasOwn(declared, "platform"),
  );
  assert.ok(
    consumers.length > 0,
    "a compose file must consume the shared platform network by its name",
  );
  for (const [name] of consumers) {
    assert.ok(
      Object.hasOwn(networks, "platform"),
      `${name} must consume a declared network`,
    );
  }
});

test("F-241: the declaration and the compose files agree", () => {
  assert.deepEqual(
    compareSharedNetworks(sharedNetworks(), composeNetworks()),
    [],
  );
});

test("F-241: a declared network that no compose file consumes is refused", () => {
  const failures = compareSharedNetworks(
    { platform: { driver: "bridge" }, "never-used": { driver: "bridge" } },
    { "compose.core.yml": { platform: { driver: "bridge" } } },
  );
  assert.ok(
    failures.some((failure) => failure.includes("never-used")),
    `an unused declaration is another placeholder: ${failures.join(" | ")}`,
  );
});

test("F-241: a compose file that declares a different driver for the shared network is refused", () => {
  const failures = compareSharedNetworks(
    { platform: { driver: "bridge" } },
    { "compose.core.yml": { platform: { driver: "host" } } },
  );
  assert.ok(
    failures.some((failure) => failure.includes("driver")),
    `the drivers must agree: ${failures.join(" | ")}`,
  );
});

test("F-241: the repository policy check accepts the shared network declaration", () => {
  assert.deepEqual(checkSharedNetworkDeclaration(root), []);
});

test("F-241: the creation step for the shared network is documented", () => {
  const documents = runbooks();
  const documented = documents.filter(
    (document) =>
      document.text.includes("infrastructure/networking/networks.yml") &&
      document.text.includes("docker network create"),
  );
  assert.ok(
    documented.length > 0,
    "a tracked runbook must document the shared network and the step that creates it",
  );
});
