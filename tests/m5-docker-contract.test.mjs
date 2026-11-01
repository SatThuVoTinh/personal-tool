import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.ok(
    services.postgres.volumes.includes(
      "postgres-data:/var/lib/postgresql/data",
    ),
    "the data volume stays a named volume",
  );
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

const SENTINEL_HELPER = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "credential-sentinels.ps1",
);

function sentinelHelperSource() {
  return readFileSync(path.join(root, SENTINEL_HELPER), "utf8");
}

test("M5/T1-R2 validates only environment variables used by each profile", () => {
  // F-522 (R10-L09-6): the credential name set lives in the one carrier both
  // entrypoint scripts dot-source, so the pin reads that carrier rather than
  // whichever script happened to declare it.
  const helper = sentinelHelperSource();
  assert.match(
    preflight,
    /\$usesKnowledge = \$Profile -in @\("knowledge", "all"\)/,
  );
  assert.match(
    helper,
    /\$usesAutomation = \$Profile -in @\("automation", "all"\)/,
  );
  assert.match(
    preflight,
    /\$requiredVariables = @\(Get-CredentialVariableNames \$Profile\)/,
    "preflight must assemble its own list from the shared carrier",
  );
  assert.match(helper, /function Get-CredentialVariableNames/);
  for (const name of [
    "POSTGRES_PASSWORD",
    "N8N_POSTGRES_PASSWORD",
    "KNOWLEDGE_DB_PASSWORD",
    "SKILL_DB_PASSWORD",
  ]) {
    assert.match(helper, new RegExp(`"${name}"`));
  }
  assert.match(
    helper,
    /if \(\$usesAutomation\) \{[\s\S]*\$names \+= @\("N8N_ENCRYPTION_KEY"\)/,
  );
  assert.doesNotMatch(
    helper,
    /if \(\$usesAutomation\) \{[\s\S]*"N8N_POSTGRES_PASSWORD"/,
  );
  assert.match(helper, /function Test-SentinelValue/);
  assert.match(helper, /function Read-EnvironmentFile/);
  assert.match(
    preflight,
    /if \(\$usesKnowledge\) \{[\s\S]*"KNOWLEDGE_VAULT_ROOT", "OLLAMA_SMOKE_MODEL"/,
  );
});

test("F-522: start.ps1 refuses a missing or sentinel credential before its first up", () => {
  assert.match(
    start,
    /Join-Path \$PSScriptRoot "credential-sentinels\.ps1"/,
    "start.ps1 must dot-source the credential carrier",
  );
  const guardIndex = start.indexOf("Assert-CredentialValues");
  assert.ok(
    guardIndex >= 0,
    "start.ps1 must call the credential guard, not only check that the env file exists",
  );
  const firstUp = start.indexOf('"up",');
  assert.ok(firstUp >= 0, "the first compose up must still be in the script");
  assert.ok(
    guardIndex < firstUp,
    "the guard must run before the first `up`, or the stack is created unchecked",
  );
});

test("F-522: no entrypoint script re-declares the sentinel grammar", () => {
  for (const [name, source] of [
    ["start.ps1", start],
    ["preflight.ps1", preflight],
  ]) {
    assert.match(
      source,
      /credential-sentinels\.ps1/,
      `${name} must source the shared credential carrier`,
    );
    assert.doesNotMatch(
      source,
      /^function Test-SentinelValue/mu,
      `${name} must not carry its own copy of the sentinel grammar`,
    );
    assert.doesNotMatch(
      source,
      /^function Read-EnvironmentFile/mu,
      `${name} must not carry its own copy of the env-file reader`,
    );
    assert.doesNotMatch(
      source,
      /\$requiredVariables = @\("POSTGRES_PASSWORD"\)/u,
      `${name} must not re-declare the credential name set the carrier already owns`,
    );
  }
});

test("F-INFRA-002: first boot provisions the module roles", () => {
  const services = compose().services;
  const environment = services.postgres.environment;
  // Owner decision 2026-11-01 (option C): the image entrypoint runs the
  // bootstrap from /docker-entrypoint-initdb.d, so the postgres container now
  // carries the same fail-closed module passwords as the one-shot
  // postgres-bootstrap helper. The superuser can already reset those roles,
  // so this does not widen the effective boundary.
  for (const name of [
    "KNOWLEDGE_DB_PASSWORD",
    "N8N_POSTGRES_PASSWORD",
    "SKILL_DB_PASSWORD",
  ]) {
    assert.equal(
      environment[name],
      `\${${name}:-unconfigured}`,
      `${name} must reach the first-boot bootstrap with a fail-closed default`,
    );
  }

  const binds = services.postgres.volumes.filter(
    (volume) => typeof volume === "object",
  );
  const helper = binds.find(
    (volume) => volume.target === "/usr/local/bin/bootstrap-postgres.sh",
  );
  assert.ok(helper, "the init wrapper must reach the bootstrap script");
  assert.equal(helper.source, "../scripts/bootstrap-postgres.sh");
  assert.equal(helper.read_only, true);
  const init = binds.find(
    (volume) =>
      volume.target === "/docker-entrypoint-initdb.d/10-bootstrap-postgres.sh",
  );
  assert.ok(
    init,
    "an empty volume must get its module roles from the image init phase",
  );
  assert.equal(init.source, "../scripts/bootstrap-postgres-init.sh");
  assert.equal(init.read_only, true);

  const wrapperPath = path.join(
    "infrastructure",
    "docker",
    "scripts",
    "bootstrap-postgres-init.sh",
  );
  assert.ok(existsSync(path.join(root, wrapperPath)), "the wrapper must exist");
  const wrapper = readFileSync(path.join(root, wrapperPath), "utf8");
  // The image sources a non-executable init file, so the wrapper must not exec
  // into the bootstrap (that would replace the image entrypoint) and must not
  // source it (its EXIT trap would replace the entrypoint cleanup). It runs
  // the bootstrap as a child and aborts the first boot when it fails.
  assert.match(wrapper, /\/bin\/sh \/usr\/local\/bin\/bootstrap-postgres\.sh/);
  assert.doesNotMatch(wrapper, /^\s*exec\s/mu);
  assert.doesNotMatch(wrapper, /^\s*\.\s+\/usr\/local/mu);
  assert.match(wrapper, /exit "\$status"/);
});

//
// SKIP-FAMILY: docker
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// The backup driver is the one script the operator runbook tells the owner to
// run that NO verify stage read: it is not in a prettier glob, not in an
// eslint target and not in the npm script set, so the repository could not see
// it change. The contract it has to keep is asserted here.
test("M5/T1-R2 the backup driver keeps its safety contract", () => {
  // F-265 (R7-D13-02): the manifest's secret claim is computed by inspecting
  // the archives the script produces, and it names what is actually known.
  assert.match(
    backup,
    /plaintext_secrets_excluded = \$secretInspection\.plaintext_secrets_excluded/,
  );
  assert.match(backup, /pg_restore/);
  assert.match(backup, /tar -tzf/);
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
