// F-188 (R5-E09-06) - a permanently red gate cannot say "and this branch
// added one": it returns the same word for the recorded baseline as for a new
// high-severity dependency.
//
// The acceptance criterion is one sentence: CI reports green while the
// baseline persists and red the moment it grows. That needs a recorded
// baseline and a comparison, not a bare "npm audit --audit-level=high".
//
// F-568 (R10-T09-3) - a baseline of six counts cannot tell a recorded
// advisory from a different advisory of the same severity, so the record also
// carries the advisory identity set (id, package, vulnerable range, severity)
// taken from the same report the count comparison reads, and the comparison
// fails on any observed advisory the record does not carry. The counts stay
// as a secondary ceiling.
//
// The audit is never run against the network from this suite: the comparison
// is a pure function over an audit report, and the CLI is exercised over a
// report file, so the lane is deterministic and offline.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseDocument } from "yaml";

import {
  AUDIT_BASELINE_PATH,
  AUDIT_SEVERITIES,
  auditAdvisoryIdentities,
  compareAuditToBaseline,
  readAuditBaseline,
} from "../scripts/audit-baseline.mjs";
import {
  checkAuditBaseline,
  checkAuditBaselineWorkflow,
} from "../scripts/repository-policy.mjs";

const root = process.cwd();

// The advisories the recorded baseline carries, transcribed from the report
// measured on 2026-10-25 (`npm audit --json`).
const RECORDED_ADVISORIES = [
  {
    id: "GHSA-238p-pmpm-9mq7",
    package: "katex",
    severity: "low",
    range: ">=0.11.0 <0.18.2",
  },
  {
    id: "GHSA-gfr2-rv44-r23c",
    package: "markdown-it",
    severity: "high",
    range: ">=15.0.0 <15.0.3",
  },
  {
    id: "GHSA-r4xh-jqrq-34v2",
    package: "smol-toml",
    severity: "moderate",
    range: "<=1.8.0",
  },
  {
    id: "GHSA-r7fv-28h4-cvq7",
    package: "markdown-it",
    severity: "high",
    range: ">=15.0.0 <15.0.2",
  },
  {
    id: "GHSA-vfgh-jcmw-g37q",
    package: "markdown-it",
    severity: "low",
    range: ">=15.0.0 <15.0.3",
  },
];

// `metadata.vulnerabilities` counts vulnerable packages, not advisories: three
// of the six packages are vulnerable only through a dependency (`via` is a
// package-name string), which is why six packages carry five advisories.
const RECORDED_COUNTS = {
  info: 0,
  low: 3,
  moderate: 2,
  high: 1,
  critical: 0,
  total: 6,
};

const TRANSITIVE_PACKAGES = {
  markdownlint: {
    severity: "low",
    via: ["micromark-extension-math"],
    range: ">=0.37.0",
  },
  "markdownlint-cli2": {
    severity: "moderate",
    via: ["markdown-it", "markdownlint", "smol-toml"],
    range: ">=0.17.0",
  },
  "micromark-extension-math": {
    severity: "low",
    via: ["katex"],
    range: "*",
  },
};

function auditReport(
  advisories = RECORDED_ADVISORIES,
  counts = RECORDED_COUNTS,
) {
  const vulnerabilities = {};
  for (const advisory of advisories) {
    vulnerabilities[advisory.package] ??= {
      name: advisory.package,
      severity: advisory.severity,
      via: [],
      effects: [],
      range: advisory.range,
      nodes: [],
    };
    vulnerabilities[advisory.package].via.push({
      source: 1,
      name: advisory.package,
      dependency: advisory.package,
      title: `advisory ${advisory.id}`,
      url: `https://github.com/advisories/${advisory.id}`,
      severity: advisory.severity,
      range: advisory.range,
    });
  }
  for (const [name, entry] of Object.entries(TRANSITIVE_PACKAGES)) {
    vulnerabilities[name] ??= { name, effects: [], nodes: [], ...entry };
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: counts },
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
  assert.equal(baseline.schema_version, 2);
  // The repository's own measured audit result on 2026-10-25: 6 vulnerable
  // packages (3 low, 2 moderate, 1 high).
  assert.equal(baseline.vulnerabilities.total, 6);
  assert.equal(baseline.vulnerabilities.high, 1);
  assert.equal(baseline.vulnerabilities.moderate, 2);
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

test("F-568: the baseline records the advisory identity set, not only counts", () => {
  const baseline = readAuditBaseline(root);
  assert.deepEqual(
    baseline.advisories,
    RECORDED_ADVISORIES,
    "the recorded set must name every advisory the count comparison aggregates",
  );
  for (const advisory of baseline.advisories) {
    assert.match(advisory.id, /^GHSA-/u);
    assert.equal(typeof advisory.package, "string");
    assert.ok(AUDIT_SEVERITIES.includes(advisory.severity));
    assert.equal(typeof advisory.range, "string");
  }
  const ids = baseline.advisories.map((advisory) => advisory.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "an identity set with a duplicate id cannot say which advisory it records",
  );
});

test("F-568: today's report is the recorded state, and the comparison reads the same set", () => {
  const baseline = readAuditBaseline(root);
  const report = auditReport();
  assert.deepEqual(
    auditAdvisoryIdentities(report),
    baseline.advisories,
    "the extraction must reproduce the recorded set from the same report shape",
  );
  const comparison = compareAuditToBaseline(report, baseline);
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.ok, true);
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
test("F-188: the comparison is red the moment a severity count grows", () => {
  const baseline = readAuditBaseline(root);
  const grown = { ...RECORDED_COUNTS, high: 2, total: 7 };
  const comparison = compareAuditToBaseline(
    auditReport(undefined, grown),
    baseline,
  );
  assert.equal(comparison.ok, false);
  assert.ok(
    comparison.failures.some((failure) => failure.includes("high")),
    `the failure must name the severity that grew: ${comparison.failures.join(" | ")}`,
  );
  assert.ok(
    comparison.failures.every((failure) => !failure.includes("GHSA-")),
    `a count-only growth must not be reported as an unknown advisory: ${comparison.failures.join(" | ")}`,
  );
});

test("F-188: a lower count stays green - the baseline is a ceiling, not a target", () => {
  const baseline = readAuditBaseline(root);
  const remaining = RECORDED_ADVISORIES.filter(
    (advisory) => advisory.id !== "GHSA-238p-pmpm-9mq7",
  );
  const improved = { ...RECORDED_COUNTS, low: 2, total: 5 };
  const comparison = compareAuditToBaseline(
    auditReport(remaining, improved),
    baseline,
  );
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.ok, true);
});

test("F-568: two recorded highs swapped for two different highs redden at unchanged counts", () => {
  const baseline = readAuditBaseline(root);
  const swapped = RECORDED_ADVISORIES.map((advisory) => {
    if (advisory.id === "GHSA-gfr2-rv44-r23c") {
      return { ...advisory, id: "GHSA-aaaa-bbbb-cccc" };
    }
    if (advisory.id === "GHSA-r7fv-28h4-cvq7") {
      return { ...advisory, id: "GHSA-dddd-eeee-ffff" };
    }
    return advisory;
  });
  const comparison = compareAuditToBaseline(
    auditReport(swapped, RECORDED_COUNTS),
    baseline,
  );
  assert.equal(comparison.ok, false);
  for (const id of ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"]) {
    assert.ok(
      comparison.failures.some((failure) => failure.includes(id)),
      `the failure must name the unrecorded advisory ${id}: ${comparison.failures.join(" | ")}`,
    );
  }
  assert.ok(
    comparison.failures.every((failure) => !failure.includes("grew")),
    `the counts are unchanged, so the failure must not be a count failure: ${comparison.failures.join(" | ")}`,
  );
});

test("F-568: an advisory the record does not carry reddens even when the counts hold", () => {
  const baseline = readAuditBaseline(root);
  const extra = [
    ...RECORDED_ADVISORIES,
    {
      id: "GHSA-9999-zzzz-0000",
      package: "left-pad",
      severity: "low",
      range: "<1.0.0",
    },
  ];
  const comparison = compareAuditToBaseline(
    auditReport(extra, RECORDED_COUNTS),
    baseline,
  );
  assert.equal(comparison.ok, false);
  assert.ok(
    comparison.failures.some(
      (failure) =>
        failure.includes("GHSA-9999-zzzz-0000") && failure.includes("left-pad"),
    ),
    `the failure must name the advisory and its package: ${comparison.failures.join(" | ")}`,
  );
});

test("F-568: a report without per-package advisories fails closed", () => {
  const baseline = readAuditBaseline(root);
  const comparison = compareAuditToBaseline(
    { metadata: { vulnerabilities: RECORDED_COUNTS } },
    baseline,
  );
  assert.equal(comparison.ok, false);
  assert.ok(
    comparison.failures.some((failure) => failure.includes("advisory")),
    `a counts-only report cannot prove the set: ${comparison.failures.join(" | ")}`,
  );
});

test("F-188: an unreadable audit report fails closed", () => {
  const baseline = readAuditBaseline(root);
  const comparison = compareAuditToBaseline({}, baseline);
  assert.equal(comparison.ok, false);
  assert.ok(comparison.failures.length > 0);
});

test("F-568: the baseline reader refuses a record without an advisory set", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "f568-baseline-"));
  mkdirSync(path.join(directory, ".github", "security"), { recursive: true });
  writeFileSync(
    path.join(directory, AUDIT_BASELINE_PATH),
    JSON.stringify({
      schema_version: 2,
      vulnerabilities: RECORDED_COUNTS,
    }),
    "utf8",
  );
  assert.throws(
    () => readAuditBaseline(directory),
    /advisory/u,
    "a baseline that records only counts is the defect this row exists for",
  );
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
  writeFileSync(holding, JSON.stringify(auditReport()), "utf8");
  writeFileSync(
    growing,
    JSON.stringify(
      auditReport(undefined, { ...RECORDED_COUNTS, high: 2, total: 7 }),
    ),
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

// ---------------------------------------------------------------------------
// F-585: fixAvailable detection and remediation checking
// ---------------------------------------------------------------------------
test("F-585: auditAdvisoryIdentities extracts fixAvailable from package entries", () => {
  const reportWithFix = {
    vulnerabilities: {
      "markdown-it": {
        name: "markdown-it",
        severity: "high",
        range: ">=15.0.0 <15.0.3",
        fixAvailable: {
          name: "markdownlint-cli2",
          version: "0.24.0",
          isSemVerMajor: true,
        },
        via: [
          {
            source: 1,
            name: "markdown-it",
            dependency: "markdown-it",
            title: "advisory GHSA-gfr2-rv44-r23c",
            url: "https://github.com/advisories/GHSA-gfr2-rv44-r23c",
            severity: "high",
            range: ">=15.0.0 <15.0.3",
          },
        ],
      },
    },
  };

  const extracted = auditAdvisoryIdentities(reportWithFix);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0].id, "GHSA-gfr2-rv44-r23c");
  assert.deepEqual(extracted[0].fixAvailable, {
    name: "markdownlint-cli2",
    version: "0.24.0",
    isSemVerMajor: true,
  });
});

test("F-585: compareAuditToBaseline fails when an advisory has fixAvailable but baseline does not acknowledge it", () => {
  const baseline = readAuditBaseline(root);
  const reportWithFix = auditReport();
  reportWithFix.vulnerabilities["markdown-it"].fixAvailable = {
    name: "markdownlint-cli2",
    version: "0.24.0",
  };

  const comparison = compareAuditToBaseline(reportWithFix, baseline);
  assert.equal(comparison.ok, false);
  assert.ok(
    comparison.failures.some(
      (failure) =>
        failure.includes("GHSA-gfr2-rv44-r23c") &&
        failure.includes("has a fix available") &&
        failure.includes("markdownlint-cli2@0.24.0"),
    ),
    `failure must name the advisory and the available fix: ${comparison.failures.join(" | ")}`,
  );
});

test("F-585: compareAuditToBaseline passes when fixAvailable is acknowledged in the baseline", () => {
  const baseline = JSON.parse(JSON.stringify(readAuditBaseline(root)));
  for (const advisory of baseline.advisories) {
    if (advisory.package === "markdown-it") {
      advisory.fixAvailable = true;
    }
  }

  const reportWithFix = auditReport();
  reportWithFix.vulnerabilities["markdown-it"].fixAvailable = {
    name: "markdownlint-cli2",
    version: "0.24.0",
  };

  const comparison = compareAuditToBaseline(reportWithFix, baseline);
  assert.deepEqual(comparison.failures, []);
  assert.equal(comparison.ok, true);
});
