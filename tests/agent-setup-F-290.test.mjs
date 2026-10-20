// F-290 (R7-C4-03) - the M3/T1 acceptance driver fixes its compose project
// name and its fixture identifiers, so a second run meets the state an
// earlier run left behind and two overlapping runs share one volume.
//
// The acceptance criterion: two consecutive invocations with no manual
// cleanup both report passed, and two overlapping invocations use disjoint
// state; the invariant is asserted in a tracked lane rather than assumed.
//
// The driver therefore derives everything a run owns from a per-run
// identifier: the compose project (and with it the network, the volumes and
// the container names), the four fixture row identities, and the host port
// the acceptance stack binds, so two runs can be in flight at the same time.
// The lane below checks the derivation itself, and the tracked contract test
// that used to pin the constant project name now pins the per-run one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const DRIVER_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t1.ps1",
);
const HELPER_PATH = path.join(
  "infrastructure",
  "docker",
  "scripts",
  "acceptance-common.ps1",
);
const OVERLAY_PATH = path.join(
  "infrastructure",
  "docker",
  "compose",
  "compose.m3-t1.acceptance.yml",
);
const CONTRACT_PATH = path.join("tests", "m3-t1-contract.test.mjs");

function driverSource() {
  return readFileSync(path.join(root, DRIVER_PATH), "utf8");
}

function powerShell() {
  if (process.platform === "win32") {
    return existsSync(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
      ? "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
      : "powershell.exe";
  }
  return existsSync("/usr/bin/pwsh") ? "/usr/bin/pwsh" : null;
}

function deriveFixtures() {
  const shell = powerShell();
  if (!shell) return null;
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-290-"));
  const harness = path.join(workspace, "harness.ps1");
  const helper = path.join(root, HELPER_PATH).replace(/'/g, "''");
  writeFileSync(
    harness,
    [
      "$ErrorActionPreference = 'Stop'",
      `. '${helper}'`,
      "$runId = New-AcceptanceRunId",
      '$first = New-AcceptanceFixtureUuid "$runId-active-index"',
      '$second = New-AcceptanceFixtureUuid "$runId-interrupted-index"',
      '$again = New-AcceptanceFixtureUuid "$runId-active-index"',
      "$other = New-AcceptanceFixtureUuid 'other-run-active-index'",
      "$payload = [ordered]@{",
      "  run_id = $runId",
      "  first = $first",
      "  second = $second",
      "  again = $again",
      "  other = $other",
      "}",
      "[Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))",
      "",
    ].join("\n"),
  );
  const result = spawnSync(
    shell,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `the acceptance helper failed: ${result.stderr || result.stdout}`,
    );
  }
  const line = (result.stdout ?? "")
    .split(/\r?\n/u)
    .filter((entry) => entry.trim().length > 0)
    .pop();
  return JSON.parse(line);
}

test("F-290: the driver owns no constant compose project name", () => {
  const source = driverSource();
  assert.doesNotMatch(
    source,
    /\$projectName = "personal-tool-m3-t1"/,
    "a constant project name is what makes two runs share one volume",
  );
  assert.match(
    source,
    /\$projectName = "personal-tool-m3-t1-\$runId"/,
    "the project name must be derived from the per-run identifier",
  );
  assert.match(
    source,
    /New-AcceptanceRunId/,
    "the per-run identifier must come from the shared helper",
  );
});

test("F-290: the driver owns no hardcoded fixture identity", () => {
  const source = driverSource();
  assert.doesNotMatch(
    source,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/,
    "a literal fixture identity collides with the row an earlier run left",
  );
  for (const seed of [
    "active-index",
    "interrupted-index",
    "interrupted-run",
    "duplicate-index",
  ]) {
    assert.match(
      source,
      new RegExp(`New-AcceptanceFixtureUuid "\\$runId-${seed}"`),
      `the ${seed} fixture identity must be derived from the run identifier`,
    );
  }
});

test("F-290: the acceptance stack binds an ephemeral port, so two runs can be in flight", () => {
  const source = driverSource();
  assert.ok(
    existsSync(path.join(root, OVERLAY_PATH)),
    "the acceptance overlay must exist",
  );
  const overlay = readFileSync(path.join(root, OVERLAY_PATH), "utf8");
  assert.match(overlay, /ports: !override/);
  assert.match(overlay, /host_ip: 127\.0\.0\.1/);
  assert.match(
    source,
    /compose\.m3-t1\.acceptance\.yml/,
    "the driver must load the acceptance overlay",
  );
  assert.match(
    source,
    /@\("port", "nginx", "8080"\)/,
    "the driver must resolve the published loopback port",
  );
  assert.doesNotMatch(
    source,
    /127\.0\.0\.1:8080\/knowledge/,
    "the driver must not address a fixed host port",
  );
});

test("F-290: the tracked contract pins the per-run project name, not the constant", () => {
  const contract = readFileSync(path.join(root, CONTRACT_PATH), "utf8");
  assert.doesNotMatch(
    contract,
    /\$projectName = "personal-tool-m3-t1"/,
    "the contract must not keep pinning the constant project name",
  );
  assert.ok(
    contract.includes("personal-tool-m3-t1-\\$runId"),
    "the contract must pin the per-run project name",
  );
});

test("F-290: the fixture identities are derived, unique per seed and stable per run", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the acceptance helper");
    return;
  }
  const derived = deriveFixtures();
  assert.match(
    derived.run_id,
    /^[0-9a-f]{32}$/,
    "the run identifier must be a per-run value",
  );
  for (const identity of [derived.first, derived.second, derived.other]) {
    assert.match(
      identity,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      `${identity} must be a well-formed UUID`,
    );
  }
  assert.equal(
    derived.first,
    derived.again,
    "the same seed must derive the same identity, so a rerun is reproducible",
  );
  assert.notEqual(
    derived.first,
    derived.second,
    "two fixtures of one run must not share an identity",
  );
  assert.notEqual(
    derived.first,
    derived.other,
    "two runs must not derive the same identity",
  );
});
