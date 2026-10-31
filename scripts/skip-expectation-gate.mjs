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
// F-492 (legacy `R9-T11-2`): a JUnit case has three states this gate must tell
// apart — passed, skipped, and failed/errored. A `<failure>` or `<error>`
// child used to fall through to the pass counter, so a failed case satisfied
// the must-run tripwire and inflated the ceiling denominator. Failures are
// now their own count and are refused on every host.
//
// F-587 (owner RED decision, runner-signal arm): a childless `<testcase>` that
// returns before executing any assertion is byte-identical to a genuine pass in
// raw JUnit XML. A runner signal (e.g. `<report>.assertions.json`) carries
// per-case executed assertion counts alongside the JUnit report. The gate
// checks the runner signal for any childless `<testcase>` (neither <skipped/>
// nor <failure/>/<error/>); if the case has no executed assertions in the
// signal (or 0 assertions), the gate refuses the lane on every host.
//
// Usage: node scripts/skip-expectation-gate.mjs <junit-report> [--json]
//
// F-477 (legacy `R9-T10-1`): every refusal here is evaluated on EVERY host.
// The must-run and inert-lane refusals used to be wrapped in a test of the CI
// host variable, so the one host whose report actually carries a must-run skip
// (the operator's) was told PASS, and the runner that can create symlinks was
// told nothing. The expectation table's `may-skip` families are the declared
// NOT RUN path; a host variable is not a declaration and decides nothing.
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
 * Load the runner signal artifact (per-case assertion counts) associated with the report.
 * Checks candidate paths alongside the report (or CLI argument --signal / --assertions).
 */
function loadAssertionSignal(reportPath, argv = process.argv) {
  let signalPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--signal" || argv[index] === "--assertions") {
      signalPath = argv[index + 1];
      break;
    }
    if (argv[index].startsWith("--signal=")) {
      signalPath = argv[index].slice("--signal=".length);
      break;
    }
    if (argv[index].startsWith("--assertions=")) {
      signalPath = argv[index].slice("--assertions=".length);
      break;
    }
  }

  if (!signalPath) {
    const candidates = [
      `${reportPath}.assertions.json`,
      path.join(
        path.dirname(reportPath),
        `${path.basename(reportPath, path.extname(reportPath))}.assertions.json`,
      ),
      path.join(REPOSITORY_ROOT, ".skip-expectation-assertions.json"),
      path.join(REPOSITORY_ROOT, ".skip-expectation.assertions.json"),
    ];
    for (const candidate of candidates) {
      try {
        readFileSync(candidate, "utf8");
        signalPath = candidate;
        break;
      } catch {
        // try next candidate
      }
    }
  }

  if (!signalPath) return null;

  try {
    const content = JSON.parse(readFileSync(signalPath, "utf8"));
    const map = new Map();
    const cases = Array.isArray(content)
      ? content
      : Array.isArray(content?.cases)
        ? content.cases
        : null;

    if (cases) {
      for (const item of cases) {
        const lane = laneOf(item.file);
        const name = item.name ?? "";
        const count =
          typeof item.assertions === "number"
            ? item.assertions
            : (item.count ?? 0);
        map.set(`${lane}::${name}`, count);
      }
    } else if (content?.assertions && typeof content.assertions === "object") {
      for (const [key, count] of Object.entries(content.assertions)) {
        map.set(key, typeof count === "number" ? count : 0);
      }
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * The report's cases: the lane file, name, whether the case was skipped or
 * failed/errored, and executed assertion count from the runner signal.
 *
 * The JUnit report is XML, and this gate reads it without an XML dependency:
 * a `<testcase>` element carries the lane in its `file` attribute, a skipped
 * case carries a `<skipped/>` child, and a failed or errored case carries a
 * `<failure>`/`<error>` child. For a case carrying neither child, the gate
 * looks up executed assertions in the runner signal (F-587).
 */
function reportCases(xml, signalMap = null) {
  const cases = [];
  const element = /<testcase\b/gu;
  for (const match of xml.matchAll(element)) {
    const start = match.index + match[0].length;
    const { attributes, end, selfClosing } = attributesOf(xml, start);
    let skipped = false;
    let failed = false;
    if (!selfClosing) {
      const close = xml.indexOf("</testcase>", end);
      const body = xml.slice(end, close === -1 ? undefined : close);
      failed = /<(?:failure|error)\b/u.test(body);
      skipped = /<skipped\b/u.test(body);
    }
    const file = attributes.file ?? "";
    const name = attributes.name ?? "";
    const lane = laneOf(file);
    let assertions = 1;
    if (signalMap) {
      assertions =
        signalMap.get(`${lane}::${name}`) ?? signalMap.get(name) ?? 0;
    }
    cases.push({ file, name, skipped, failed, assertions });
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

  const signalMap = loadAssertionSignal(reportPath, process.argv);
  const cases = reportCases(xml, signalMap);
  const perLane = new Map();
  for (const lane of lanes) {
    perLane.set(lane, {
      passes: 0,
      skips: 0,
      failures: 0,
      zeroAssertions: 0,
      family: familyOfLane(lane),
    });
  }
  for (const testCase of cases) {
    const lane = laneOf(testCase.file);
    if (!lane) continue;
    const entry = perLane.get(lane) ?? {
      passes: 0,
      skips: 0,
      failures: 0,
      zeroAssertions: 0,
      family: null,
    };
    if (testCase.failed) entry.failures += 1;
    else if (testCase.skipped) entry.skips += 1;
    else if (testCase.assertions > 0) entry.passes += 1;
    else entry.zeroAssertions += 1;
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

  // A failed or errored case is never a pass, on any host. It cannot satisfy
  // the must-run tripwire, it cannot inflate a ceiling denominator, and the
  // gate must not publish "N passed" over it (F-492).
  for (const [lane, entry] of perLane) {
    if (entry.failures === 0) continue;
    failures.push(
      `the lane \`${lane}\` contributed ${entry.failures} failed or errored case(s): ` +
        "a failure is not a pass, a skip, or execution evidence",
    );
  }

  // A childless zero-assertion case is never a pass: a test case that executed
  // zero assertions is indistinguishable from a pass in raw JUnit XML, so the
  // runner signal carries executed assertion counts. A case with neither
  // <skipped/> nor <failure/>/<error/> children and no executed assertions in the
  // signal is refused on every host (F-587).
  for (const [lane, entry] of perLane) {
    if (entry.zeroAssertions === 0) continue;
    failures.push(
      `the lane \`${lane}\` contributed ${entry.zeroAssertions} childless zero-assertion case(s): ` +
        "a case with no executed assertions is not a pass",
    );
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

  // A lane that contributed NO case at all did not run. Its skips are then
  // counted against nothing, so a whole lane going inert would leave the gate
  // green — the very defect this gate exists to close. This refusal is
  // unconditional (F-477, legacy `R9-T10-1`): it used to sit behind a test of
  // the CI host variable, which is a host fact, not a declaration, so the
  // operator's host was never judged against the lanes it did not run and the
  // control contributed zero executed assertions there. A run over a report
  // that holds every lane the repository owns is exactly what this gate is for;
  // a partial report must be refused, and the table's `may-skip` families are
  // the only declared NOT RUN path.
  for (const [lane, entry] of perLane) {
    if (
      entry.passes === 0 &&
      entry.skips === 0 &&
      entry.failures === 0 &&
      entry.zeroAssertions === 0
    ) {
      failures.push(
        `the lane \`${lane}\` contributed no case at all: it did not run, so \
its skips are counted against nothing`,
      );
    }
  }

  for (const family of families) {
    const members = [...perLane.entries()].filter(
      ([, entry]) => entry.family === family.id,
    );
    let passes = 0;
    let skips = 0;
    let failed = 0;
    for (const [, entry] of members) {
      passes += entry.passes;
      skips += entry.skips;
      failed += entry.failures;
    }
    report.push({
      id: family.id,
      lanes: members.length,
      passes,
      skips,
      failed,
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
    if (family.expectation === "must-run") {
      if (skips > 0) {
        failures.push(
          `the family \`${family.id}\` is expected to RUN and skipped ${skips} \
case(s): ${family.reason}`,
        );
      }
      if (passes === 0) {
        failures.push(
          `the family \`${family.id}\` is expected to RUN and contributed no \
pass at all: it was skipped entirely`,
        );
      }
    } else if (passes + skips > 0 && (family.maxSkips ?? 0) >= passes + skips) {
      failures.push(
        `the family \`${family.id}\` has a skip ceiling of ${family.maxSkips ?? 0} that is greater than or equal to its report denominator of ${passes + skips} (passes + skips)`,
      );
    } else if (skips > (family.maxSkips ?? 0)) {
      failures.push(
        `the family \`${family.id}\` skipped ${skips} case(s) and may skip at \
most ${family.maxSkips ?? 0}: ${family.reason}`,
      );
    }
  }

  const lines = report.map(
    (family) =>
      `  ${family.id}: ${family.passes} passed, ${family.skips} skipped, \
${family.failed} failed (${family.expectation}, at most ${family.maxSkips})`,
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
