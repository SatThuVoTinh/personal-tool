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
const nginxPath = path.join(
  repositoryRoot,
  "infrastructure",
  "nginx",
  "conf.d",
  "default.conf",
);
const migrationPath = path.join(
  repositoryRoot,
  "apps",
  "knowledge",
  "migrations",
  "001_initial.sql",
);
const servicePath = path.join(
  repositoryRoot,
  "apps",
  "knowledge",
  "app",
  "main.py",
);
const databasePath = path.join(
  repositoryRoot,
  "apps",
  "knowledge",
  "app",
  "database.py",
);
const coordinatorPath = path.join(
  repositoryRoot,
  "apps",
  "knowledge",
  "app",
  "index_runner.py",
);
const validationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t1.ps1",
);

function readCompose() {
  const document = parseDocument(readFileSync(composePath, "utf8"), {
    merge: true,
  });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M3/T1 declares an internal-only Knowledge service", () => {
  const knowledge = readCompose().services.knowledge;

  assert.equal(knowledge.image, "personal-tool/knowledge:m3");
  assert.equal(knowledge.ports, undefined);
  assert.equal(knowledge.mem_limit, "4g");
  assert.equal(knowledge.labels["personal-tool.project"], "personal-tool");
  assert.deepEqual(knowledge.networks, ["platform"]);
  assert.equal(knowledge.depends_on.postgres.condition, "service_healthy");
  assert.ok(
    knowledge.extra_hosts.includes("host.docker.internal:host-gateway"),
  );
  assert.equal(knowledge.environment.KNOWLEDGE_EMBEDDING_DIMENSIONS, "1024");
  assert.equal(
    knowledge.environment.KNOWLEDGE_EMBEDDING_MODEL,
    "${KNOWLEDGE_EMBEDDING_MODEL:-bge-m3:latest}",
  );
  assert.equal(knowledge.environment.KNOWLEDGE_DATABASE_HOST, "postgres");
  assert.equal(knowledge.environment.KNOWLEDGE_DATABASE_NAME, "postgres");
  assert.equal(
    knowledge.environment.KNOWLEDGE_DATABASE_PASSWORD,
    "${POSTGRES_PASSWORD:-unconfigured}",
  );
  assert.equal(knowledge.environment.KNOWLEDGE_DATABASE_PORT, "5432");
  assert.equal(knowledge.environment.KNOWLEDGE_DATABASE_USER, "postgres");
  assert.equal(knowledge.environment.KNOWLEDGE_DATABASE_DSN, undefined);
});

test("M3/T1 keeps Nginx loopback-only and proxies only the Knowledge route", () => {
  const nginx = readFileSync(nginxPath, "utf8");

  assert.match(nginx, /listen 8080;/);
  assert.match(nginx, /location = \/healthz/);
  assert.match(nginx, /location \/knowledge\//);
  assert.match(nginx, /resolver 127\.0\.0\.11/);
  assert.match(nginx, /set \$knowledge_upstream knowledge:8000;/);
  assert.match(nginx, /rewrite \^\/knowledge\/\(\.\*\)\$ \/\$1 break;/);
  assert.match(nginx, /proxy_pass http:\/\/\$knowledge_upstream;/);
  assert.match(nginx, /location \/ \{[\s\S]*return 404;/);
});

test("M3/T1 migration scopes sources and segments by index identity", () => {
  const migration = readFileSync(migrationPath, "utf8");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge\.indexes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge\.index_runs/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge\.sources/);
  assert.match(
    migration,
    /CREATE TABLE IF NOT EXISTS knowledge\.source_sidecars/,
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS knowledge\.segments/);
  assert.doesNotMatch(migration, /created_by_run_id/);
  assert.match(migration, /embedding_model_digest text NOT NULL/);
  assert.match(
    migration,
    /embedding_dimensions integer NOT NULL CHECK \(embedding_dimensions = 1024\)/,
  );
  assert.match(migration, /UNIQUE \(index_id, source_path\)/);
  assert.match(migration, /UNIQUE \(index_id, source_id, chunk_ordinal\)/);
  assert.match(migration, /knowledge_indexes_one_active_idx/);
  assert.match(migration, /WHERE status = 'ACTIVE'/);
  assert.match(migration, /knowledge_index_runs_one_running_idx/);
  assert.match(migration, /heading_path text\[\]/);
  assert.match(migration, /heading_text text NOT NULL/);
  assert.match(migration, /source_sidecars/);
  assert.match(migration, /USING hnsw \(embedding vector_cosine_ops\)/);
});

test("M3/T1 readiness verifies the active index embedding digest and dimensions", () => {
  const service = readFileSync(servicePath, "utf8");

  // `/healthz` returns `JSONResponse | dict[...]`, which the pinned
  // FastAPI/Pydantic pair rejects during route registration unless response
  // model generation is disabled. Pin the exact bootable form so the route
  // cannot silently regress into a service that cannot import `app.main`.
  assert.match(service, /@app\.get\("\/healthz", response_model=None\)/);
  assert.match(service, /@app\.get\("\/readyz", response_model=None\)/);
  assert.match(service, /NO_ACTIVE_INDEX/);
  assert.match(service, /EMBEDDING_MODEL_UNAVAILABLE/);
  assert.match(service, /EMBEDDING_MODEL_DRIFT/);
  assert.match(
    service,
    /active_index\.embedding_model_name\s*!= configured_settings\.embedding_model/,
  );
  assert.match(
    service,
    /actual_model\.digest != active_index\.embedding_model_digest/,
  );
  assert.match(
    service,
    /actual_model\.dimensions != active_index\.embedding_dimensions/,
  );
  assert.match(
    service,
    /actual_model\.dimensions != configured_settings\.embedding_dimensions/,
  );
});

test("M3/T1 recovers orphan runs and holds an advisory lock for background work", () => {
  const database = readFileSync(databasePath, "utf8");
  const coordinator = readFileSync(coordinatorPath, "utf8");

  assert.match(database, /SET status = 'INTERRUPTED'/);
  assert.match(database, /failure_code = 'PROCESS_RESTART'/);
  assert.match(database, /WHERE status = 'RUNNING'/);
  assert.match(database, /SELECT pg_try_advisory_lock\(\$1\)/);
  assert.match(database, /SELECT pg_advisory_unlock\(\$1\)/);
  assert.match(
    coordinator,
    /asyncio\.create_task\(self\._run\(work, cleanup, connection\)\)/,
  );
  assert.match(coordinator, /INDEX_RUN_ALREADY_ACTIVE/);
  assert.match(coordinator, /await self\._database\.release_advisory_lock\(/);
});

test("M3/T1 acceptance validates readiness and cleans only its isolated project", () => {
  const script = readFileSync(validationPath, "utf8");

  assert.match(script, /\$projectName = "personal-tool-m3-t1"/);
  assert.match(script, /"build", "knowledge"/);
  assert.match(script, /"knowledge",\s*"nginx"/);
  assert.match(script, /NO_ACTIVE_INDEX/);
  assert.match(script, /function Assert-SqlFailure/);
  assert.match(script, /Expected SQL command to fail but it succeeded/);
  assert.match(script, /embedding_model_digest = repeat\('0', 64\)/);
  assert.match(script, /EMBEDDING_MODEL_DRIFT/);
  assert.match(script, /PROCESS_RESTART/);
  assert.match(script, /"stop", "knowledge"/);
  assert.match(script, /down --volumes --remove-orphans/);
});
