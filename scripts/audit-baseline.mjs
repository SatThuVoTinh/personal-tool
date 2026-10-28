// F-188 (R5-E09-06) - the recorded npm-audit baseline.
//
// A bare `npm audit --audit-level=high` returns the same non-zero exit for
// the recorded baseline and for a newly added high-severity dependency, so
// the gate cannot say which one happened. This module records the baseline
// and compares a live audit report against it: green while the baseline
// holds, red the moment a count grows.
//
// F-568 (R10-T09-3): six counts cannot tell a recorded advisory from a
// different advisory of the same severity, because the counts aggregate the
// advisory set. The baseline therefore also records the advisory identity set
// (id, package, vulnerable range, severity) taken from the same report, and
// the comparison fails on any observed advisory the record does not carry.
// The counts remain as a secondary ceiling.
//
// The comparison is a pure function over an audit report, so the gate is
// testable without a registry and without a network.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const AUDIT_BASELINE_PATH = ".github/security/npm-audit-baseline.json";

export const AUDIT_SEVERITIES = ["info", "low", "moderate", "high", "critical"];

const AUDIT_BASELINE_SCHEMA_VERSION = 2;

const BASELINE_COUNT_KEYS = [...AUDIT_SEVERITIES, "total"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function severityRank(severity) {
  const rank = AUDIT_SEVERITIES.indexOf(severity);
  return rank < 0 ? -1 : rank;
}

function advisoryId(advisory, packageName) {
  if (typeof advisory.url === "string") {
    const ghsa = advisory.url.match(/GHSA-[0-9A-Za-z-]+/u);
    if (ghsa) return ghsa[0];
  }
  if (advisory.source != null) return `source-${advisory.source}`;
  return `${packageName}:${advisory.title ?? advisory.name ?? "advisory"}`;
}

/**
 * The recorded baseline, or a thrown error when the file is missing, does not
 * carry the six counts the comparison reads, or carries no advisory identity
 * set. A record of counts alone is the defect F-568 closes, so it is refused
 * rather than silently compared as if the set were empty.
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
  if (baseline?.schema_version !== AUDIT_BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `The npm audit baseline must carry schema_version ${AUDIT_BASELINE_SCHEMA_VERSION}: ${AUDIT_BASELINE_PATH}`,
    );
  }
  const counts = baseline.vulnerabilities;
  if (!isPlainObject(counts)) {
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
  const advisories = baseline.advisories;
  if (!Array.isArray(advisories)) {
    throw new Error(
      `The npm audit baseline records no advisory identity set: ${AUDIT_BASELINE_PATH}`,
    );
  }
  const seen = new Set();
  for (const advisory of advisories) {
    if (!isPlainObject(advisory)) {
      throw new Error(
        `The npm audit baseline must record each advisory as an object: ${AUDIT_BASELINE_PATH}`,
      );
    }
    for (const field of ["id", "package", "range"]) {
      if (typeof advisory[field] !== "string" || advisory[field].length === 0) {
        throw new Error(
          `The npm audit baseline must record a non-empty ${field} for every advisory: ${AUDIT_BASELINE_PATH}`,
        );
      }
    }
    if (!AUDIT_SEVERITIES.includes(advisory.severity)) {
      throw new Error(
        `The npm audit baseline must record a known severity for ${advisory.id}: ${AUDIT_BASELINE_PATH}`,
      );
    }
    if (seen.has(advisory.id)) {
      throw new Error(
        `The npm audit baseline records ${advisory.id} twice: ${AUDIT_BASELINE_PATH}`,
      );
    }
    seen.add(advisory.id);
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
 * The advisory identities of an `npm audit --json` report, or null when the
 * report carries no per-package detail. `vulnerabilities` is the per-package
 * map; a `via` entry that is a string is a transitive reference to another
 * package's advisory, not an advisory of its own, so only object entries name
 * an advisory. Duplicate ids collapse to the highest severity, and the set is
 * sorted by id so a recorded set and an observed set can be compared whole.
 */
export function auditAdvisoryIdentities(report) {
  const packages = report?.vulnerabilities;
  if (!isPlainObject(packages)) return null;
  const byId = new Map();
  for (const [packageName, entry] of Object.entries(packages)) {
    if (!isPlainObject(entry)) return null;
    const packageFixAvailable =
      entry.fixAvailable !== undefined && entry.fixAvailable !== false
        ? entry.fixAvailable
        : null;
    const via = Array.isArray(entry.via) ? entry.via : [];
    for (const advisory of via) {
      if (typeof advisory === "string") continue;
      if (!isPlainObject(advisory)) return null;
      const fixAvailable =
        (advisory.fixAvailable !== undefined && advisory.fixAvailable !== false
          ? advisory.fixAvailable
          : null) ?? packageFixAvailable;
      const identity = {
        id: advisoryId(advisory, packageName),
        package: packageName,
        severity:
          typeof advisory.severity === "string"
            ? advisory.severity
            : String(entry.severity ?? "unknown"),
        range:
          typeof advisory.range === "string"
            ? advisory.range
            : String(entry.range ?? "*"),
      };
      if (fixAvailable) {
        identity.fixAvailable = fixAvailable;
      }
      const existing = byId.get(identity.id);
      if (
        !existing ||
        severityRank(identity.severity) > severityRank(existing.severity)
      ) {
        byId.set(identity.id, identity);
      }
    }
  }
  return [...byId.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
}

/**
 * Compare a live audit report with the recorded baseline.
 *
 * The advisory set is the primary check: an observed advisory the record does
 * not carry is red, even when it replaces a recorded advisory of the same
 * severity and the counts do not move. The counts are a secondary ceiling - a
 * count that falls is an improvement and stays green, a count that rises is a
 * branch that added one and is red. An unreadable report fails closed rather
 * than passing vacuously.
 */
export function compareAuditToBaseline(report, baseline) {
  const failures = [];
  const counts = auditVulnerabilityCounts(report);
  if (!counts) {
    return {
      ok: false,
      counts: null,
      advisories: null,
      failures: [
        "The npm audit report carries no readable vulnerability counts, so the baseline cannot be compared.",
      ],
    };
  }
  const advisories = auditAdvisoryIdentities(report);
  if (!advisories) {
    return {
      ok: false,
      counts,
      advisories: null,
      failures: [
        "The npm audit report carries no readable per-package advisory detail, so the recorded advisory set cannot be compared.",
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
  const recordedAdvisories = new Map(
    (baseline?.advisories ?? []).map((advisory) => [advisory.id, advisory]),
  );
  for (const observed of advisories) {
    const allowed = recordedAdvisories.get(observed.id);
    if (!allowed) {
      failures.push(
        `npm audit reports ${observed.id} against ${observed.package} (${observed.severity}) and the recorded baseline does not carry it.`,
      );
      continue;
    }
    if (allowed.package !== observed.package) {
      failures.push(
        `npm audit reports ${observed.id} against ${observed.package}, but the recorded baseline carries it against ${allowed.package}.`,
      );
    }
    if (allowed.severity !== observed.severity) {
      failures.push(
        `npm audit rates ${observed.id} ${observed.severity}, but the recorded baseline rates it ${allowed.severity}.`,
      );
    }
    if (observed.fixAvailable && !allowed.fixAvailable) {
      const fixDesc =
        typeof observed.fixAvailable === "object"
          ? `${observed.fixAvailable.name}@${observed.fixAvailable.version}`
          : String(observed.fixAvailable);
      failures.push(
        `npm audit reports ${observed.id} against ${observed.package} has a fix available (${fixDesc}), but the recorded baseline carries no fixAvailable acknowledgement.`,
      );
    }
  }
  return { ok: failures.length === 0, counts, advisories, failures };
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
  lines.push(
    `  advisories: ${(baseline.advisories ?? []).length} recorded, ${comparison.advisories?.length ?? "unreadable"} observed`,
  );
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
