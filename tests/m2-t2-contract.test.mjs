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
const redisConfigurationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "databases",
  "redis",
  "redis.conf",
);
const bootstrapPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "bootstrap-postgres.sh",
);
const verificationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "core-storage.ps1",
);

function readCompose() {
  const document = parseDocument(readFileSync(composePath, "utf8"));
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M2/T2 pins core storage images and keeps storage ports internal", () => {
  const compose = readCompose();
  const postgres = compose.services.postgres;
  const redis = compose.services.redis;

  assert.match(
    postgres.image,
    /^pgvector\/pgvector:0\.8\.1-pg17@sha256:[a-f0-9]{64}$/,
  );
  assert.match(redis.image, /^redis:8\.4\.0@sha256:[a-f0-9]{64}$/);
  assert.equal(postgres.ports, undefined);
  assert.equal(redis.ports, undefined);
  assert.equal(postgres.mem_limit, "2g");
  assert.equal(redis.mem_limit, "512m");
  assert.deepEqual(postgres.volumes, [
    "postgres-data:/var/lib/postgresql/data",
  ]);
  assert.equal(redis.volumes.length, 1);
  assert.equal(compose.volumes["postgres-data"], null);
  assert.equal(compose.volumes["object-storage-data"], null);
});

test("M2/T2 declares persistent and transient storage contracts", () => {
  const compose = readCompose();
  const objectStorage = compose.services["object-storage"];
  const redisConfiguration = readFileSync(redisConfigurationPath, "utf8");

  assert.ok(objectStorage.volumes.includes("object-storage-data:/data"));
  assert.match(redisConfiguration, /^save ""$/m);
  assert.match(redisConfiguration, /^appendonly no$/m);
  assert.match(redisConfiguration, /^maxmemory 192mb$/m);
  assert.match(redisConfiguration, /^maxmemory-policy allkeys-lru$/m);
  assert.match(redisConfiguration, /^maxmemory-clients 5%$/m);
  assert.doesNotMatch(redisConfiguration, /requirepass/i);
  assert.ok(compose.services.redis.healthcheck.test[1].includes("PONG"));
  assert.equal(compose.services.postgres.shm_size, "256m");
  assert.equal(compose.services.postgres.stop_grace_period, "1m");
});

test("M2/T2 bootstrap enables vector only in postgres and is idempotent", () => {
  const contents = readFileSync(bootstrapPath, "utf8");

  assert.match(contents, /CREATE EXTENSION IF NOT EXISTS vector;/);
  assert.match(
    contents,
    /IF NOT EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'n8n'\)/,
  );
  assert.match(contents, /ALTER ROLE n8n LOGIN PASSWORD/);
  assert.match(
    contents,
    /WHERE NOT EXISTS \(SELECT 1 FROM pg_database WHERE datname = 'n8n'\)/,
  );
  assert.doesNotMatch(contents, /template1/);
});

test("M2/T2 verifier requires T1 regression and tests recreation", () => {
  const contents = readFileSync(verificationPath, "utf8");

  assert.match(
    contents,
    /preflightScript -EnvironmentFile \$EnvironmentFile -Runtime/,
  );
  assert.match(contents, /"down", "--remove-orphans"/);
  assert.match(
    contents,
    /PostgreSQL marker did not survive container recreation/,
  );
  assert.match(contents, /AIStor marker did not survive container recreation/);
  assert.match(
    contents,
    /Redis transient marker survived container recreation/,
  );
  assert.match(contents, /postgres-bootstrap/);
  assert.match(contents, /pipeAttempt = 1; \$pipeAttempt -le 3/);
  assert.doesNotMatch(contents, /\brestart\b/);
});
