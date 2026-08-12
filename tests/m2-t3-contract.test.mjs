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
const nginxConfigurationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "nginx",
  "conf.d",
  "default.conf",
);
const verificationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "local-integration.ps1",
);

function readCompose() {
  const document = parseDocument(readFileSync(composePath, "utf8"));
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M2/T3 pins n8n and Nginx with loopback-only interfaces", () => {
  const compose = readCompose();
  const n8n = compose.services.n8n;
  const nginx = compose.services.nginx;

  assert.match(n8n.image, /^n8nio\/n8n:2\.33\.0@sha256:[a-f0-9]{64}$/);
  assert.match(nginx.image, /^nginx:1\.30\.4-alpine@sha256:[a-f0-9]{64}$/);
  assert.deepEqual(n8n.ports, ["127.0.0.1:5678:5678"]);
  assert.deepEqual(nginx.ports, ["127.0.0.1:8080:8080"]);
  assert.equal(n8n.mem_limit, "1280m");
  assert.equal(nginx.mem_limit, "256m");
  assert.ok(n8n.volumes.includes("n8n-data:/home/node/.n8n"));
  assert.equal(compose.volumes["n8n-data"], null);
});

test("M2/T3 makes stable n8n encryption and Postgres persistence explicit", () => {
  const compose = readCompose();
  const environmentExample = readFileSync(environmentExamplePath, "utf8");
  const n8n = compose.services.n8n;

  assert.match(environmentExample, /^N8N_ENCRYPTION_KEY=/m);
  assert.equal(n8n.environment.DB_TYPE, "postgresdb");
  assert.equal(n8n.environment.DB_POSTGRESDB_HOST, "postgres");
  assert.match(n8n.environment.N8N_ENCRYPTION_KEY, /^\$\{N8N_ENCRYPTION_KEY/);
  assert.equal(n8n.environment.N8N_USER_FOLDER, "/home/node");
  assert.equal(n8n.environment.N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS, "true");
  assert.equal(n8n.environment.EXECUTIONS_DATA_PRUNE, "true");
  assert.equal(n8n.environment.EXECUTIONS_DATA_MAX_AGE, "336");
  assert.equal(n8n.environment.EXECUTIONS_DATA_PRUNE_MAX_COUNT, "10000");
  assert.equal(n8n.environment.EXECUTIONS_DATA_MAX_DISPLAY_SIZE, "33554432");
  assert.equal(n8n.environment.N8N_CONCURRENCY_PRODUCTION_LIMIT, "2");
  assert.equal(n8n.stop_grace_period, "1m");
  assert.ok(n8n.extra_hosts === undefined);
  assert.ok(n8n.networks.includes("platform"));
});

test("M2/T3 Nginx permits only health and default-denies other paths", () => {
  const configuration = readFileSync(nginxConfigurationPath, "utf8");

  assert.match(configuration, /listen 8080;/);
  assert.match(configuration, /location = \/healthz/);
  assert.match(configuration, /return 200 "ok\\n";/);
  assert.match(configuration, /location \/ \{[\s\S]*return 404;/);
  assert.doesNotMatch(configuration, /proxy_pass/);
});

test("M2/T3 verifier reruns T2 and uses recreation without persisting plaintext", () => {
  const contents = readFileSync(verificationPath, "utf8");

  assert.match(
    contents,
    /coreStorageScript -EnvironmentFile \$EnvironmentFile/,
  );
  assert.match(
    contents,
    /N8N_ENCRYPTION_KEY must contain at least 32 characters/,
  );
  assert.match(contents, /host\.docker\.internal:11434\/api\/embed/);
  assert.match(contents, /ToBase64String/);
  assert.match(contents, /Buffer\.from\(process\.argv\[1\],`base64`\)/);
  assert.match(contents, /"down", "--remove-orphans"/);
  assert.match(contents, /n8n could not decrypt the synthetic credential/);
  assert.match(contents, /m2-t3-recreation-marker/);
  assert.match(contents, /n8n import:credentials/);
  assert.match(contents, /id = \[guid\]::NewGuid\(\)\.ToString\(\)/);
  assert.match(contents, /ConvertTo-Json[\s\S]*-InputObject @\(/);
  assert.match(contents, /"export:credentials",\s*"--all",\s*"--decrypted"/);
  assert.match(contents, /decryptedExport\.IndexOf\("\["\)/);
  assert.doesNotMatch(contents, /Set-Content.*credential/i);
  assert.doesNotMatch(contents, /Out-File.*credential/i);
  assert.doesNotMatch(contents, /\brestart\b/);
});
