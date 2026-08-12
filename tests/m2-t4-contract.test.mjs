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
const prometheusConfigurationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "observability",
  "prometheus",
  "prometheus.yml",
);
const datasourcePath = path.join(
  repositoryRoot,
  "infrastructure",
  "observability",
  "grafana",
  "provisioning",
  "datasources",
  "prometheus.yml",
);
const dashboardPath = path.join(
  repositoryRoot,
  "infrastructure",
  "observability",
  "grafana",
  "dashboards",
  "m2-infrastructure.json",
);
const verificationPath = path.join(
  repositoryRoot,
  "infrastructure",
  "docker",
  "scripts",
  "observability.ps1",
);

function readCompose() {
  const document = parseDocument(readFileSync(composePath, "utf8"), {
    merge: true,
  });
  assert.deepEqual(document.errors, []);
  return document.toJS();
}

test("M2/T4 pins observability services and exposes only loopback UIs", () => {
  const compose = readCompose();

  assert.match(
    compose.services.prometheus.image,
    /^prom\/prometheus:v3\.13\.2@sha256:[a-f0-9]{64}$/,
  );
  assert.deepEqual(compose.services.prometheus.command, [
    "--config.file=/etc/prometheus/prometheus.yml",
    "--storage.tsdb.retention.time=7d",
    "--storage.tsdb.retention.size=512MB",
  ]);
  assert.match(
    compose.services.grafana.image,
    /^grafana\/grafana:13\.1\.3@sha256:[a-f0-9]{64}$/,
  );
  assert.match(
    compose.services.dozzle.image,
    /^amir20\/dozzle:v10\.7\.1@sha256:[a-f0-9]{64}$/,
  );
  assert.match(
    compose.services["postgres-exporter"].image,
    /^prometheuscommunity\/postgres-exporter:v0\.20\.1@sha256:[a-f0-9]{64}$/,
  );
  assert.match(
    compose.services["redis-exporter"].image,
    /^oliver006\/redis_exporter:v1\.89\.0@sha256:[a-f0-9]{64}$/,
  );
  assert.deepEqual(compose.services.prometheus.ports, ["127.0.0.1:9090:9090"]);
  assert.deepEqual(compose.services.grafana.ports, ["127.0.0.1:3000:3000"]);
  assert.deepEqual(compose.services.dozzle.ports, ["127.0.0.1:9999:8080"]);
  assert.ok(compose.services["postgres-exporter"].ports === undefined);
  assert.ok(compose.services["redis-exporter"].ports === undefined);
});

test("M2/T4 assigns intended limits and project labels to every service", () => {
  const compose = readCompose();
  const helperServices = new Set(["aistor-mc", "postgres-bootstrap"]);

  for (const [name, service] of Object.entries(compose.services)) {
    assert.equal(
      service.labels["personal-tool.project"],
      "personal-tool",
      `${name} must carry the Dozzle project label`,
    );
    assert.ok(service.mem_limit, `${name} must have a memory ceiling`);

    if (!helperServices.has(name)) {
      assert.equal(service.restart, "unless-stopped");
      assert.equal(service.logging.driver, "local");
      assert.equal(service.logging.options["max-size"], "10m");
      assert.equal(service.logging.options["max-file"], "3");
    }
  }

  assert.equal(compose.services["object-storage"].mem_limit, "1280m");
  assert.equal(compose.services.prometheus.mem_limit, "1g");
  assert.equal(compose.services.grafana.mem_limit, "1g");
  assert.equal(compose.services.dozzle.mem_limit, "256m");
});

test("M2/T4 constrains the Dozzle privileged socket boundary", () => {
  const dozzle = readCompose().services.dozzle;
  const socket = dozzle.volumes.find(
    (volume) => volume.target === "/var/run/docker.sock",
  );

  assert.equal(socket.source, "/var/run/docker.sock");
  assert.equal(socket.read_only, true);
  assert.equal(
    dozzle.environment.DOZZLE_FILTER,
    "label=personal-tool.project=personal-tool",
  );
  assert.equal(dozzle.environment.DOZZLE_ENABLE_ACTIONS, "false");
  assert.equal(dozzle.environment.DOZZLE_ENABLE_SHELL, "false");
  assert.equal(dozzle.environment.DOZZLE_ENABLE_MCP, "false");
});

test("M2/T4 provisions Prometheus and a repository-backed Grafana dashboard", () => {
  const prometheus = parseDocument(
    readFileSync(prometheusConfigurationPath, "utf8"),
  ).toJS();
  const datasource = parseDocument(readFileSync(datasourcePath, "utf8")).toJS();
  const dashboard = JSON.parse(readFileSync(dashboardPath, "utf8"));
  const jobs = prometheus.scrape_configs.map((scrape) => scrape.job_name);

  assert.deepEqual(jobs, ["prometheus", "postgres-exporter", "redis-exporter"]);
  assert.equal(datasource.datasources[0].uid, "prometheus");
  assert.equal(datasource.datasources[0].url, "http://prometheus:9090");
  assert.equal(dashboard.uid, "m2-infrastructure");
  assert.match(dashboard.panels[0].targets[0].expr, /postgres-exporter/);
  assert.match(dashboard.panels[0].targets[0].expr, /redis-exporter/);
  assert.match(dashboard.panels[1].targets[0].expr, /pg_database_size_bytes/);
  assert.match(dashboard.panels[2].targets[0].expr, /redis_memory_max_bytes/);
});

test("M2/T4 verifier reruns T3 and measures target/resource health", () => {
  const contents = readFileSync(verificationPath, "utf8");

  assert.match(
    contents,
    /localIntegrationScript -EnvironmentFile \$EnvironmentFile/,
  );
  assert.match(contents, /Assert-PrometheusTargets/);
  assert.match(contents, /api\/v1\/targets/);
  assert.match(contents, /api\/datasources\/uid\/prometheus/);
  assert.match(contents, /api\/dashboards\/uid\/m2-infrastructure/);
  assert.match(contents, /docker stats --no-stream/);
  assert.match(contents, /OOMKilled/);
  assert.match(contents, /down --remove-orphans/);
});
