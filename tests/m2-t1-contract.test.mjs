import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const repositoryRoot = process.cwd();
const composePath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "compose",
  "compose.core.yml",
);
const environmentExamplePath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "env",
  ".env.example",
);
const preflightPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "preflight.ps1",
);

function readCompose() {
  const document = parseDocument(readFileSync(composePath, "utf8"));
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M2/T1 pins AIStor server and ephemeral mc helper", () => {
  const compose = readCompose();
  const objectStorage = compose.services["object-storage"];
  const client = compose.services["aistor-mc"];

  assert.match(
    objectStorage.image,
    /^quay\.io\/minio\/aistor\/minio:RELEASE\.[^@]+@sha256:[a-f0-9]{64}$/,
  );
  assert.match(
    client.image,
    /^quay\.io\/minio\/aistor\/mc:RELEASE\.[^@]+@sha256:[a-f0-9]{64}$/,
  );
  assert.equal(objectStorage.command.at(-1), "/minio.license");
  assert.deepEqual(objectStorage.ports, ["127.0.0.1:9001:9001"]);
  assert.equal(
    objectStorage.ports.some((port) => port.includes(":9000")),
    false,
  );
  assert.deepEqual(client.profiles, ["tools"]);
  assert.deepEqual(client.entrypoint, [
    "/bin/sh",
    "/usr/local/bin/aistor-mc-entrypoint.sh",
  ]);
  assert.equal(compose.networks.platform.driver, "bridge");
});

test("M2/T1 environment template requires non-default AIStor and Ollama inputs", () => {
  const contents = readFileSync(environmentExamplePath, "utf8");
  for (const variable of [
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "AISTOR_LICENSE_FILE",
    "OLLAMA_SMOKE_MODEL",
  ]) {
    assert.match(contents, new RegExp(`^${variable}=`, "m"));
  }
  assert.doesNotMatch(contents, /minioadmin/i);
});

test("M2/T1 preflight validates host prerequisites without host mc", () => {
  const contents = readFileSync(preflightPath, "utf8");
  assert.match(contents, /docker version --format/);
  assert.match(
    contents,
    /Invoke-RestMethod[\s`]+-Uri "http:\/\/127\.0\.0\.1:11434\/api\/tags"/,
  );
  assert.match(contents, /aistor-mc[\s`]+license info aistor/);
  assert.match(contents, /aistor-mc[\s`]+pipe/);
  assert.match(
    contents,
    /for \(\$pipeAttempt = 1; \$pipeAttempt -le 3; \$pipeAttempt\+\+\)/,
  );
  assert.match(contents, /aistor-mc[\s`]+cat/);
  assert.match(
    contents,
    /AIStor license file must be stored outside the repository/,
  );
  assert.doesNotMatch(contents, /\bmc\s+alias\s+set\b/);
});
