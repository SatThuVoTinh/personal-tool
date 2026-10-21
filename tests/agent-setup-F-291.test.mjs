//
// SKIP-FAMILY: powershell-helpers
//
// M12/T9 F-197 (R5-E09-03) / H3: this lane may skip, and it declares WHICH
// family it belongs to, so the skip-expectation gate can tell an explained
// skip from an unexplained one. The family-to-lane map is derived from the
// repository's own lane list; the expectation lives in
// `docs/contracts/ci-skip-expectations.json`.
// F-291 (R7-C4-04) - the six acceptance drivers implement finalisation in six
// different ways, and two of those ways lose a cleanup failure.
//
// Shape A (four drivers) raises the cleanup error from inside the outer
// `finally` block, so in PowerShell the teardown complaint replaces whatever
// the body was propagating. Shape B (two drivers) records the finalisation
// error but rethrows it only when the body did not fail, so on exactly the run
// where both went wrong the leak is never reported and never written to the
// evidence.
//
// The acceptance criterion: one shared finalisation contract across all six
// drivers - cleanup and leak conditions are always written to the evidence and
// named in the output, never silently dropped, and never substituted for the
// body's own failure.
//
// The contract lives in `acceptance-common.ps1` and every driver calls it.
// The lane below checks the three properties that matter: the shared helper
// is the only implementation, the helper captures a failing cleanup instead of
// raising it, and no driver raises from inside a `finally` block (checked
// against the PowerShell AST, not against a text search).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const SCRIPT_DIRECTORY = path.join("infrastructure", "docker", "scripts");
const HELPER_PATH = path.join(SCRIPT_DIRECTORY, "acceptance-common.ps1");
const DRIVERS = [
  "knowledge-t1.ps1",
  "knowledge-t2.ps1",
  "knowledge-t3.ps1",
  "knowledge-t4.ps1",
  "knowledge-t5.ps1",
  "knowledge-t5-live.ps1",
];

function read(relative) {
  return readFileSync(path.join(root, relative), "utf8");
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

function runPowerShell(body, arguments_ = []) {
  const shell = powerShell();
  if (!shell) return null;
  const workspace = mkdtempSync(path.join(os.tmpdir(), "f-291-"));
  const harness = path.join(workspace, "harness.ps1");
  writeFileSync(harness, body);
  const result = spawnSync(
    shell,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      harness,
      ...arguments_,
    ],
    { encoding: "utf8" },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function finalizationContract(cleanup) {
  const helper = path.join(root, HELPER_PATH).replace(/'/g, "''");
  return runPowerShell(
    [
      "$ErrorActionPreference = 'Stop'",
      `. '${helper}'`,
      "$evidence = [ordered]@{ result = 'PASS'; acceptance_run_id = 'run-1' }",
      `Invoke-AcceptanceFinalization -Label 'M3/T1' -RunId 'run-1' -Evidence $evidence -Cleanup { ${cleanup} }`,
      "[Console]::Out.WriteLine(($evidence | ConvertTo-Json -Depth 10 -Compress))",
      "",
    ].join("\n"),
  );
}

test("F-291: every acceptance driver calls the one shared finalisation contract", () => {
  assert.ok(
    existsSync(path.join(root, HELPER_PATH)),
    "the shared finalisation helper must exist",
  );
  for (const driver of DRIVERS) {
    const source = read(path.join(SCRIPT_DIRECTORY, driver));
    assert.match(
      source,
      /acceptance-common\.ps1/,
      `${driver} must load the shared finalisation contract`,
    );
    assert.match(
      source,
      /Invoke-AcceptanceFinalization/,
      `${driver} must finalise through the shared contract`,
    );
  }
});

test("F-291: a failing cleanup is captured, recorded and named, never raised", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the shared contract");
    return;
  }
  const run = finalizationContract("throw 'the acceptance container leaked'");
  assert.equal(
    run.status,
    0,
    `the shared contract must never raise the cleanup failure: ${run.stderr}`,
  );
  assert.match(
    run.stdout,
    /M3\/T1 acceptance finalization: cleanup failed: the acceptance container leaked/,
    `the condition must be named in the output: ${run.stdout}`,
  );
  const evidence = JSON.parse(
    run.stdout
      .split(/\r?\n/u)
      .filter((entry) => entry.trim().length > 0)
      .pop(),
  );
  assert.equal(evidence.result, "FAIL");
  assert.equal(evidence.finalization.conditions.length, 1);
  assert.equal(evidence.finalization.conditions[0].step, "cleanup");
  assert.match(
    evidence.finalization.conditions[0].error,
    /the acceptance container leaked/,
  );
  assert.equal(evidence.finalization.completed, false);
});

test("F-291: a clean cleanup leaves the result alone and names nothing", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to run the shared contract");
    return;
  }
  const run = finalizationContract("'nothing to clean'");
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(
    run.stdout,
    /acceptance finalization:/,
    `a clean cleanup must name nothing: ${run.stdout}`,
  );
  const evidence = JSON.parse(
    run.stdout
      .split(/\r?\n/u)
      .filter((entry) => entry.trim().length > 0)
      .pop(),
  );
  assert.equal(evidence.result, "PASS");
  assert.equal(evidence.finalization.conditions.length, 0);
  assert.equal(evidence.finalization.completed, true);
});

test("F-291: no driver raises from inside a finally block", (t) => {
  const shell = powerShell();
  if (!shell) {
    t.skip("PowerShell is not available to parse the acceptance drivers");
    return;
  }
  const harness = [
    "$ErrorActionPreference = 'Stop'",
    "$path = $args[0]",
    "$tokens = $null",
    "$parseErrors = $null",
    "$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors)",
    "$findings = @()",
    "foreach ($try in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.TryStatementAst] }, $true)) {",
    "  if (-not $try.Finally) { continue }",
    "  foreach ($throw in $try.Finally.FindAll({ param($node) $node -is [System.Management.Automation.Language.ThrowStatementAst] }, $true)) {",
    "    $shared = $false",
    "    $parent = $throw.Parent",
    "    while ($parent) {",
    "      if ($parent -is [System.Management.Automation.Language.ScriptBlockExpressionAst]) {",
    "        $owner = $parent.Parent",
    "        if ($owner -is [System.Management.Automation.Language.CommandAst] -and $owner.GetCommandName() -eq 'Invoke-AcceptanceFinalization') { $shared = $true }",
    "      }",
    "      $parent = $parent.Parent",
    "    }",
    '    if (-not $shared) { $findings += "$($throw.Extent.StartLineNumber): $($throw.Extent.Text)" }',
    "  }",
    "}",
    "$payload = [ordered]@{ findings = @($findings) }",
    "[Console]::Out.WriteLine(($payload | ConvertTo-Json -Compress))",
    "",
  ].join("\n");
  for (const driver of DRIVERS) {
    const run = runPowerShell(harness, [
      path.join(root, SCRIPT_DIRECTORY, driver),
    ]);
    assert.equal(run.status, 0, `${driver}: ${run.stderr}`);
    const findings = JSON.parse(
      run.stdout
        .split(/\r?\n/u)
        .filter((entry) => entry.trim().length > 0)
        .pop(),
    ).findings;
    assert.deepEqual(
      findings,
      [],
      `${driver} must not raise from inside a finally block`,
    );
  }
});

test("F-291: the finalisation failure is raised after the body, never inside it", () => {
  for (const driver of DRIVERS) {
    const source = read(path.join(SCRIPT_DIRECTORY, driver));
    const finallyIndex = source.indexOf("\nfinally {");
    const guardIndex = source.indexOf(
      "if ($null -ne $finalizationError -and -not $script:bodyFailed)",
    );
    assert.ok(finallyIndex >= 0, `${driver} must have a finally block`);
    assert.ok(
      guardIndex > finallyIndex,
      `${driver} must raise the finalisation failure after the finally block, so the body's own failure is never replaced`,
    );
    assert.match(
      source,
      /\$finalizationError = \$evidence\["finalization"\]\.error/,
      `${driver} must take the finalisation error from the shared record`,
    );
  }
});
