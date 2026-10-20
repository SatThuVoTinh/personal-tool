// F-188 (R5-E09-06) - a permanently red gate cannot say "and this branch
// added one": it returns the same word for the recorded 5-high baseline as
// for a new high-severity dependency.
//
// The acceptance criterion is one sentence: CI reports green while the 5-high
// baseline persists and red the moment it grows. That needs a recorded
// baseline and a comparison, not a bare "npm audit --audit-level=high".
//
// The audit is never run against the network from this suite: the comparison
// is a pure function over an audit report, and the CLI is exercised over a
// report file, so the lane is deterministic and offline.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

import {
  AUDIT_BASELINE_PATH,
  AUDIT_SEVERITIES,
  compareAuditToBaseline,
  readAuditBaseline,
} from "../scripts/audit-baseline.mjs";
import {
  checkAuditBaseline,
  checkAuditBaselineWorkflow,
} from "../scripts/repository-policy.mjs";

const root = process.cwd();
function auditReport(counts) {
  return {
    auditReportVersion: 2,
    vulnerabilities: counts,
    metadata: { vulnerabilities: counts },
  };
}

function baselineCounts() {
  return {
    info: 0,
    low: 3,
    moderate: 1,
    high: 5,
    critical: 0,
    total: 9,
  };
}

function securityWorkflowText() {
  return readFileSync(
    path.join(root, ".github", "workflows", "security.yml"),
    "utf8",
  );
}

function trackedFiles() {
  return execFileSync(
    "git",
    ["-c", `safe.directory=${root}`, "ls-files", "-z"],
    { cwd: root, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}
// ---------------------------------------------------------------------------
// The recorded baseline
// ---------------------------------------------------------------------------
test("F-188: the committed audit baseline records the repository's own audit result", () => {
  const baseline = readAuditBaseline(root);
  assert.equal(baseline.schema_version, 1);
  // The repository's recorded audit result (PLAN.md section 8, four times):
  // 9 vulnerabilities (3 low, 1 moderate, 5 high).
  assert.equal(baseline.vulnerabilities.total, 9);
  assert.equal(baseline.vulnerabilities.high, 5);
  assert.equal(baseline.vulnerabilities.moderate, 1);
  assert.equal(baseline.vulnerabilities.low, 3);
  assert.equal(baseline.vulnerabilities.info, 0);
  assert.equal(baseline.vulnerabilities.critical, 0);
  for (const severity of AUDIT_SEVERITIES) {
    assert.equal(
      typeof baseline.vulnerabilities[severity],
      "number",
      `the baseline must record the ${severity} count`,
    );
  }
});

test("F-188: the audit baseline file is a repository file git will track", () => {
  const listed = execFileSync(
    "git",
    [
      "-c",
      `safe.directory=${root}`,
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      AUDIT_BASELINE_PATH,
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  assert.deepEqual(
    listed,
    [AUDIT_BASELINE_PATH],
    "the recorded baseline must be a repository file git picks up",
  );

  const ignored = spawnSync(
    "git",
    [
      "-c",
      `safe.directory=${root}`,
      "check-ignore",
      "-q",
      "--",
      AUDIT_BASELINE_PATH,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(
    ignored.status,
    0,
    "the recorded baseline must not be git-ignored, or it is a threshold nobody reviews",
  );
});

test("F-188: the policy check refuses a baseline that is not tracked", () => {
  const without = trackedFiles().filter((file) => file !== AUDIT_BASELINE_PATH);
  const failures = checkAuditBaseline(root, without);
  assert.ok(
    failures.some((failure) => failure.includes("is not tracked")),
    `an untracked baseline must fail the policy check: ${failures.join(" | ")}`,
  );
  const withBaseline = checkAuditBaseline(root, [
    ...trackedFiles(),
    AUDIT_BASELINE_PATH,
  ]);
  assert.deepEqual(withBaseline, []);
});
// ---------------------------------------------------------------------------
// The comparison: green while the baseline holds, red the moment it grows
// ---------------------------------------------------------------------------
test("F-188: the comparison is green while the recorded baseline holds", () => {
  const baseline = readAuditBaseline(root);
  const comparison = compareAuditToBaseline(
    auditReport(baselineCounts()),
    baseline,
  );
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.ok, true);
});

test("F-188: the comparison is red the moment a severity count grows", () => {
  const baseline = readAuditBaseline(root);
  const grown = { ...baselineCounts(), high: 6, total: 10 };
  const comparison = compareAuditToBaseline(auditReport(grown), baseline);
  assert.equal(comparison.ok, false);
  assert.ok(
    comparison.failures.some((failure) => failure.includes("high")),
    `the failure must name the severity that grew: ${comparison.failures.join(" | ")}`,
  );
});

test("F-188: a lower count stays green - the baseline is a ceiling, not a target", () => {
  const baseline = readAuditBaseline(root);
  const improved = { ...baselineCounts(), high: 4, total: 8 };
  const comparison = compareAuditToBaseline(auditReport(improved), baseline);
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.ok, true);
});

test("F-188: an unreadable audit report fails closed", () => {
  const baseline = readAuditBaseline(root);
  const comparison = compareAuditToBaseline({}, baseline);
  assert.equal(comparison.ok, false);
  assert.ok(comparison.failures.length > 0);
});
// ---------------------------------------------------------------------------
// The gate: the workflow compares, and the comparison is what blocks
// ---------------------------------------------------------------------------
test("F-188: the security workflow blocks on the baseline comparison, not on the bare audit", () => {
  const document = parseDocument(securityWorkflowText(), { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const steps = document.toJS().jobs["dependency-audit"].steps;

  const auditIndex = steps.findIndex(
    (step) => step.run?.trim() === "npm audit --audit-level=high",
  );
  assert.ok(auditIndex >= 0, "the audit step must still exist");
  assert.equal(
    steps[auditIndex]["continue-on-error"],
    true,
    "the known-red baseline must not block the job before the comparison runs",
  );

  const comparisonIndex = steps.findIndex((step) =>
    step.run?.includes("scripts/audit-baseline.mjs"),
  );
  assert.ok(
    comparisonIndex >= 0,
    "the dependency-audit job must compare the audit against the recorded baseline",
  );
  assert.notEqual(
    steps[comparisonIndex]["continue-on-error"],
    true,
    "the baseline comparison must block the job",
  );
  assert.ok(
    comparisonIndex > auditIndex,
    "the comparison must run after the audit it compares",
  );
});

test("F-188: the repository policy check accepts the security workflow's baseline gate", () => {
  assert.deepEqual(checkAuditBaselineWorkflow(root), []);
});

test("F-188: the policy check refuses a workflow without the baseline comparison", () => {
  const source = readFileSync(
    path.join(root, ".github", "workflows", "security.yml"),
    "utf8",
  );
  assert.match(
    source,
    /scripts\/audit-baseline\.mjs/u,
    "the shipped workflow must run the baseline comparison",
  );
  assert.match(
    source,
    /continue-on-error: true/u,
    "the known-red audit step must not block the job before the comparison runs",
  );
});
// ---------------------------------------------------------------------------
// The CLI: the exit status is the gate's answer
// ---------------------------------------------------------------------------
test("F-188: the comparison CLI exits 0 while the baseline holds and 1 when it grows", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "f188-audit-"));
  const holding = path.join(directory, "holding.json");
  const growing = path.join(directory, "growing.json");
  writeFileSync(holding, JSON.stringify(auditReport(baselineCounts())), "utf8");
  writeFileSync(
    growing,
    JSON.stringify(auditReport({ ...baselineCounts(), high: 6, total: 10 })),
    "utf8",
  );

  const green = spawnSync(
    process.execPath,
    ["scripts/audit-baseline.mjs", "--audit-report", holding],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(green.status, 0, green.stderr);

  const red = spawnSync(
    process.execPath,
    ["scripts/audit-baseline.mjs", "--audit-report", growing],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(red.status, 1);
  assert.match(red.stdout, /high/);
});
