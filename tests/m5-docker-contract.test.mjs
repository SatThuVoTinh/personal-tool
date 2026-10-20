import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");
const composeText = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.core.yml",
);
const knowledgeComposeText = read(
  "infrastructure",
  "docker",
  "compose",
  "compose.knowledge.yml",
);
const start = read("infrastructure", "docker", "scripts", "start.ps1");
const stop = read("infrastructure", "docker", "scripts", "stop.ps1");
const preflight = read("infrastructure", "docker", "scripts", "preflight.ps1");
const backup = read("infrastructure", "docker", "scripts", "backup.ps1");
const nginx = read("infrastructure", "nginx", "conf.d", "default.conf");

function compose() {
  const document = parseDocument(composeText, { merge: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

function knowledgeOverlay() {
  const document = parseDocument(knowledgeComposeText, { merge: true });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M5/T1-R2 retains only the five runtime services and the bootstrap helper", () => {
  const services = compose().services;
  assert.deepEqual(Object.keys(services).sort(), [
    "dozzle",
    "knowledge",
    "n8n",
    "nginx",
    "postgres",
    "postgres-bootstrap",
  ]);
  for (const retired of [
    "object-storage",
    "aistor-mc",
    "redis",
    "postgres-exporter",
    "redis-exporter",
    "prometheus",
    "grafana",
  ]) {
    assert.equal(services[retired], undefined);
  }
  assert.equal(services.postgres.mem_limit, "1536m");
  assert.equal(services.knowledge.mem_limit, "4g");
  assert.equal(services.n8n.mem_limit, "768m");
  assert.equal(services.nginx.mem_limit, "128m");
  assert.equal(services.dozzle.mem_limit, "128m");
  assert.deepEqual(Object.keys(compose().volumes).sort(), [
    "n8n-data",
    "postgres-data",
  ]);
});

test("M5/T1-R2 declares the approved Docker profile membership", () => {
  const services = compose().services;
  assert.deepEqual(services.knowledge.profiles, ["knowledge", "all"]);
  assert.deepEqual(services.nginx.profiles, ["knowledge", "all"]);
  assert.deepEqual(services.n8n.profiles, ["automation", "all"]);
  assert.deepEqual(services.dozzle.profiles, [
    "knowledge",
    "automation",
    "all",
  ]);
  assert.deepEqual(services["postgres-bootstrap"].profiles, ["bootstrap"]);
  assert.equal(services.postgres.profiles, undefined);
  assert.deepEqual(services.knowledge.depends_on, {
    postgres: { condition: "service_healthy" },
  });
  assert.deepEqual(services.n8n.depends_on, {
    postgres: { condition: "service_healthy" },
  });
  assert.equal(services.nginx.depends_on, undefined);
  assert.match(start, /ValidateSet\("knowledge", "automation", "all"\)/);
  assert.match(start, /postgres-bootstrap/);
  assert.doesNotMatch(stop, /down --volumes/);
});

test("M5/T1-R2 keeps Nginx scoped to Knowledge and Dozzle constrained", () => {
  const services = compose().services;
  const dozzle = services.dozzle;
  assert.match(nginx, /location \/knowledge\//);
  assert.doesNotMatch(nginx, /n8n/);
  assert.deepEqual(services.nginx.ports, ["127.0.0.1:8080:8080"]);
  assert.deepEqual(services.n8n.ports, ["127.0.0.1:5678:5678"]);
  assert.deepEqual(dozzle.ports, ["127.0.0.1:9999:8080"]);
  assert.equal(dozzle.environment.DOZZLE_ENABLE_ACTIONS, "false");
  assert.equal(dozzle.environment.DOZZLE_ENABLE_SHELL, "false");
  assert.equal(dozzle.environment.DOZZLE_ENABLE_MCP, "false");
  assert.equal(services.n8n.environment.OLLAMA_SMOKE_MODEL, undefined);
  assert.deepEqual(services.postgres.volumes, [
    "postgres-data:/var/lib/postgresql/data",
  ]);
  assert.deepEqual(services.n8n.volumes, ["n8n-data:/home/node/.n8n"]);
  const vault = knowledgeOverlay().services.knowledge.volumes.find(
    (volume) => volume.target === "/vault",
  );
  assert.ok(vault);
  assert.equal(vault.read_only, true);
  const socket = dozzle.volumes.find(
    (volume) => volume.target === "/var/run/docker.sock",
  );
  assert.ok(socket);
  assert.equal(socket.read_only, true);
});

test("M5/T1-R2 validates only environment variables used by each profile", () => {
  assert.match(
    preflight,
    /\$usesKnowledge = \$Profile -in @\("knowledge", "all"\)/,
  );
  assert.match(
    preflight,
    /\$usesAutomation = \$Profile -in @\("automation", "all"\)/,
  );
  assert.match(preflight, /\$requiredVariables = @\("POSTGRES_PASSWORD"\)/);
  assert.match(
    preflight,
    /if \(\$usesAutomation\) \{[\s\S]*"N8N_POSTGRES_PASSWORD", "N8N_ENCRYPTION_KEY"/,
  );
  assert.match(
    preflight,
    /if \(\$usesKnowledge\) \{[\s\S]*"KNOWLEDGE_VAULT_ROOT", "OLLAMA_SMOKE_MODEL"/,
  );
});

// The backup driver is the one script the operator runbook tells the owner to
// run that NO verify stage read: it is not in a prettier glob, not in an
// eslint target and not in the npm script set, so the repository could not see
// it change. The contract it has to keep is asserted here.
test("M5/T1-R2 the backup driver keeps its safety contract", () => {
  // The manifest declares that no plaintext secret is carried.
  assert.match(backup, /secrets_included = \$false/);
  // The backup directory must be empty, so a backup never overwrites another.
  assert.match(backup, /BackupDirectory must be empty to prevent overwrite/);
  // A zero-length database dump is a failed backup, not a backup.
  assert.match(backup, /PostgreSQL logical backup failed for database/);
  assert.match(backup, /\.Length -eq 0/);
  // The n8n home archive must not carry the credentials file.
  assert.match(backup, /--exclude=config/);
  // Every archived file is recorded with its digest, so the backup is
  // verifiable after the fact.
  assert.match(backup, /Get-FileHash[^\n]*-Algorithm SHA256/);
  assert.match(backup, /sha256 = /);
  // The manifest is written without a byte-order mark.
  assert.match(backup, /New-Object System\.Text\.UTF8Encoding\(\$false\)/);
});
