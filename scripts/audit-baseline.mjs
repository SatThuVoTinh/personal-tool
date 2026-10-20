// F-188 (R5-E09-06) - the recorded npm-audit baseline.
//
// A bare `npm audit --audit-level=high` returns the same non-zero exit for
// the recorded 5-high baseline and for a newly added high-severity
// dependency, so the gate cannot say which one happened. This module records
// the baseline and compares a live audit report against it: green while the
// baseline holds, red the moment a count grows.
//
// The comparison is a pure function over an audit report, so the gate is
// testable without a registry and without a network.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUDIT_BASELINE_PATH = ".github/security/npm-audit-baseline.json";

export const AUDIT_SEVERITIES = ["info", "low", "moderate", "high", "critical"];

const BASELINE_COUNT_KEYS = [...AUDIT_SEVERITIES, "total"];

/**
 * The recorded baseline, or a thrown error when the file is missing or does
 * not carry the six counts the comparison reads.
 */
export function readAuditBaseline(repositoryRoot) {
  const filePath = path.join(repositoryRoot, AUDIT_BASELINE_PATH);
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `The npm audit baseline is missing or unreadable: ${AUDIT_BASELINE_PATH} (${error.message})`,
      { cause: error },
    );
  }
  if (baseline?.schema_version !== 1) {
    throw new Error(
      `The npm audit baseline must carry schema_version 1: ${AUDIT_BASELINE_PATH}`,
    );
  }
  const counts = baseline.vulnerabilities;
  if (!counts || typeof counts !== "object") {
    throw new Error(
      `The npm audit baseline carries no vulnerability counts: ${AUDIT_BASELINE_PATH}`,
    );
  }
  for (const key of BASELINE_COUNT_KEYS) {
    const value = counts[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(
        `The npm audit baseline must record a non-negative integer count for ${key}: ${AUDIT_BASELINE_PATH}`,
      );
    }
  }
  return baseline;
}
/**
 * The vulnerability counts of an `npm audit --json` report, or null when the
 * report carries none. npm writes the counts under `metadata.vulnerabilities`
 * and mirrors them under `vulnerabilities`; both are read so the comparison
 * does not depend on which npm version produced the report.
 */
export function auditVulnerabilityCounts(report) {
  const source =
    report?.metadata?.vulnerabilities ?? report?.vulnerabilities ?? null;
  if (!source || typeof source !== "object") return null;
  const counts = {};
  for (const key of BASELINE_COUNT_KEYS) {
    const value = source[key];
    if (!Number.isInteger(value) || value < 0) return null;
    counts[key] = value;
  }
  return counts;
}

/**
 * Compare a live audit report with the recorded baseline.
 *
 * The baseline is a ceiling: a count that falls is an improvement and stays
 * green, a count that rises is a branch that added one and is red. An
 * unreadable report fails closed rather than passing vacuously.
 */
export function compareAuditToBaseline(report, baseline) {
  const failures = [];
  const counts = auditVulnerabilityCounts(report);
  if (!counts) {
    return {
      ok: false,
      counts: null,
      failures: [
        "The npm audit report carries no readable vulnerability counts, so the baseline cannot be compared.",
      ],
    };
  }
  const recorded = baseline?.vulnerabilities ?? {};
  for (const severity of AUDIT_SEVERITIES) {
    const observed = counts[severity];
    const allowed = recorded[severity];
    if (typeof allowed !== "number") continue;
    if (observed > allowed) {
      failures.push(
        `npm audit ${severity} vulnerabilities grew from the recorded baseline of ${allowed} to ${observed}.`,
      );
    }
  }
  if (typeof recorded.total === "number" && counts.total > recorded.total) {
    failures.push(
      `npm audit total vulnerabilities grew from the recorded baseline of ${recorded.total} to ${counts.total}.`,
    );
  }
  return { ok: failures.length === 0, counts, failures };
}

/**
 * The live audit report. `npm audit --json` exits non-zero when it finds
 * vulnerabilities, which is exactly the case the baseline exists for, so the
 * exit status is ignored and the report is read from stdout.
 */
export function readAuditReport(repositoryRoot) {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  const stdout = String(result.stdout ?? "").trim();
  if (!stdout) {
    throw new Error(
      `npm audit produced no report (exit ${result.status}): ${String(result.stderr ?? "").trim()}`,
    );
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `npm audit produced an unreadable report: ${error.message}`,
      { cause: error },
    );
  }
}
function formatSummary(comparison, baseline) {
  const recorded = baseline.vulnerabilities;
  const observed = comparison.counts;
  const lines = [
    "npm audit baseline comparison",
    `  baseline: ${BASELINE_COUNT_KEYS.map((key) => `${key}=${recorded[key]}`).join(" ")}`,
  ];
  if (observed) {
    lines.push(
      `  observed: ${BASELINE_COUNT_KEYS.map((key) => `${key}=${observed[key]}`).join(" ")}`,
    );
  }
  if (comparison.ok) {
    lines.push("  result: the recorded baseline holds.");
  } else {
    for (const failure of comparison.failures)
      lines.push(`  result: ${failure}`);
  }
  return lines.join("\n");
}

function main(argv) {
  const repositoryRoot = process.cwd();
  const reportIndex = argv.indexOf("--audit-report");
  const baseline = readAuditBaseline(repositoryRoot);
  let report;
  if (reportIndex >= 0) {
    const reportPath = argv[reportIndex + 1];
    if (!reportPath) {
      console.error("--audit-report needs a path to an npm audit report.");
      process.exitCode = 1;
      return;
    }
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } else {
    report = readAuditReport(repositoryRoot);
  }
  const comparison = compareAuditToBaseline(report, baseline);
  console.log(formatSummary(comparison, baseline));
  if (!comparison.ok) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
