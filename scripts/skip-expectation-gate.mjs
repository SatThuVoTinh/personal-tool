#!/usr/bin/env node
// M12/T9 F-197 (R5-E09-03) / H3 — the per-family skip expectation.
//
// CI printed green while whole families of tests were skipped: the SQL
// statement gate and every WSL-dependent control never executed, and the
// job's conclusion was SUCCESS. `AGENTS.md` §11 requires an unavailable
// required gate to stay `NOT RUN`; here it was folded into "fail 0". The
// owner's answer (`H3`) is to SET AN EXPECTATION, and the measurement says it
// must be a PER-FAMILY expectation — one global number would fire on ~40
// legitimate host-capability skips.
//
// This gate reads the run's OWN report (node's JUnit reporter writes every
// test case with its lane file and its skip marker) and compares each family
// with its declaration.
//
// The family-to-lane map is DERIVED from the repository's own lane list: a
// lane that may skip declares its family with a `// SKIP-FAMILY: <id>`
// marker, and the table declares the families themselves — capabilities, not
// test names. A skipped lane that declares no family is an UNEXPLAINED skip
// and fails on every host.
//
// The gate never lowers a declared expectation to make a run pass: an
// expectation changes only in the same commit that explains why.
//
// Usage: node scripts/skip-expectation-gate.mjs <junit-report> [--json]
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TABLE_PATH = path.join(
  REPOSITORY_ROOT,
  "docs",
  "contracts",
  "ci-skip-expectations.json",
);
const FAMILY_MARKER = /^\/\/ SKIP-FAMILY: ([a-z0-9-]+)$/mu;

/** The report to read: the first argument, or the default the suite writes. */
function reportPathFrom(argv) {
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  return positional[0] ?? path.join(REPOSITORY_ROOT, ".skip-expectation.xml");
}

/** Every lane the repository owns, as repo-relative paths. */
function laneList(directory = path.join(REPOSITORY_ROOT, "tests")) {
  const lanes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      lanes.push(...laneList(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      lanes.push(
        path.relative(REPOSITORY_ROOT, full).split(path.sep).join("/"),
      );
    }
  }
  return lanes.sort();
}

/** The family a lane declares, or null. */
function familyOfLane(lane) {
  const source = readFileSync(path.join(REPOSITORY_ROOT, lane), "utf8");
  return FAMILY_MARKER.exec(source)?.[1] ?? null;
}

/**
 * The attributes of one XML element, and where the element's tag ends.
 *
 * A test name can contain a `>` (the arrows in `agent -> DENY`), so the
 * attribute area is scanned with the quoted values honoured instead of being
 * cut at the first `>`.
 */
function attributesOf(text, from) {
  const attributes = {};
  let index = from;
  while (index < text.length) {
    const character = text[index];
    if (character === ">") {
      return { attributes, end: index, selfClosing: text[index - 1] === "/" };
    }
    if (character === '"') {
      const end = text.indexOf('"', index + 1);
      if (end === -1) break;
      // The attribute's name is the word before the `=`, and the scan goes
      // BACKWARDS over that short word: a forward scan over the whole report
      // for every attribute of every case is quadratic.
      const letters = [];
      let cursor = index - 1;
      if (text[cursor] === "=") cursor -= 1;
      for (; cursor >= from; cursor -= 1) {
        const candidate = text[cursor];
        if (/[\w-]/u.test(candidate)) {
          letters.push(candidate);
          continue;
        }
        break;
      }
      const name = letters.reverse().join("");
      if (name !== "") attributes[name] = text.slice(index + 1, end);
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return { attributes, end: index, selfClosing: false };
}

/**
 * The report's cases: the lane file and whether the case was skipped.
 *
 * The JUnit report is XML, and this gate reads it without an XML dependency:
 * a `<testcase>` element carries the lane in its `file` attribute, and a
 * skipped case carries a `<skipped/>` child.
 */
function reportCases(xml) {
  const cases = [];
  const element = /<testcase\b/gu;
  for (const match of xml.matchAll(element)) {
    const start = match.index + match[0].length;
    const { attributes, end, selfClosing } = attributesOf(xml, start);
    let skipped = false;
    if (!selfClosing) {
      const close = xml.indexOf("</testcase>", end);
      const body = xml.slice(end, close === -1 ? undefined : close);
      skipped = /<skipped\b/u.test(body);
    }
    cases.push({ file: attributes.file ?? "", skipped });
  }
  return cases;
}

/** The lane a report case belongs to, as a repo-relative path. */
function laneOf(file) {
  if (!file) return "";
  const absolute = path.isAbsolute(file)
    ? file
    : path.resolve(REPOSITORY_ROOT, file);
  const relative = path
    .relative(REPOSITORY_ROOT, absolute)
    .split(path.sep)
    .join("/");
  return relative.startsWith("..") ? "" : relative;
}

function main() {
  const reportPath = reportPathFrom(process.argv.slice(2));
  const table = JSON.parse(readFileSync(TABLE_PATH, "utf8"));
  const lanes = laneList();
  let xml;
  try {
    xml = readFileSync(reportPath, "utf8");
  } catch {
    process.stderr.write(
      `SKIP EXPECTATION GATE: the run's report is missing: ${reportPath}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const cases = reportCases(xml);
  const perLane = new Map();
  for (const lane of lanes) {
    perLane.set(lane, { passes: 0, skips: 0, family: familyOfLane(lane) });
  }
  for (const testCase of cases) {
    const lane = laneOf(testCase.file);
    if (!lane) continue;
    const entry = perLane.get(lane) ?? {
      passes: 0,
      skips: 0,
      family: null,
    };
    if (testCase.skipped) entry.skips += 1;
    else entry.passes += 1;
    perLane.set(lane, entry);
  }

  const families = table.families ?? [];
  const failures = [];
  const report = [];

  // A skipped lane that declares no family is an UNEXPLAINED skip: the
  // fail-closed half, enforced on every host.
  for (const [lane, entry] of perLane) {
    if (entry.skips === 0) continue;
    if (!entry.family) {
      failures.push(
        `the lane \`${lane}\` skipped ${entry.skips} case(s) and declares no \
skip family: the skip is unexplained`,
      );
    }
  }

  // A lane that declares a family the TABLE does not know is just as
  // unexplained: its skips would be counted against no family, and the gate
  // would print PASS — the very "a whole tier went inert and CI stayed
  // green" defect this gate exists to close.
  const declared = new Set(families.map((family) => family.id));
  for (const [lane, entry] of perLane) {
    if (!entry.family) continue;
    if (!declared.has(entry.family)) {
      failures.push(
        `the lane \`${lane}\` declares the family \`${entry.family}\`, which the \
expectation table does not: its skips are counted against nothing`,
      );
    }
  }

  for (const family of families) {
    const members = [...perLane.entries()].filter(
      ([, entry]) => entry.family === family.id,
    );
    let passes = 0;
    let skips = 0;
    for (const [, entry] of members) {
      passes += entry.passes;
      skips += entry.skips;
    }
    report.push({
      id: family.id,
      lanes: members.length,
      passes,
      skips,
      expectation: family.expectation,
      maxSkips: family.maxSkips ?? 0,
    });
    if (members.length === 0) {
      failures.push(
        `the family \`${family.id}\` names no lane in the repository: its \
expectation is stale`,
      );
      continue;
    }
    if (!process.env.CI) continue;
    if (family.expectation === "must-run") {
      if (skips > 0) {
        failures.push(
          `the family \`${family.id}\` is expected to RUN on the CI runner and \
skipped ${skips} case(s): ${family.reason}`,
        );
      }
      if (passes === 0) {
        failures.push(
          `the family \`${family.id}\` is expected to RUN on the CI runner and \
contributed no pass at all: it was skipped entirely`,
        );
      }
    } else if (skips > (family.maxSkips ?? 0)) {
      failures.push(
        `the family \`${family.id}\` skipped ${skips} case(s) and may skip at \
most ${family.maxSkips ?? 0} on the CI runner: ${family.reason}`,
      );
    }
  }

  const lines = report.map(
    (family) =>
      `  ${family.id}: ${family.passes} passed, ${family.skips} skipped \
(${family.expectation}, at most ${family.maxSkips})`,
  );
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ report, failures }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `SKIP EXPECTATION GATE: ${families.length} declared families\n${lines.join("\n")}\n`,
    );
  }
  if (failures.length > 0) {
    process.stderr.write(
      `SKIP EXPECTATION GATE: FAIL\n${failures.map((line) => `  - ${line}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write("SKIP EXPECTATION GATE: PASS\n");
}

main();
