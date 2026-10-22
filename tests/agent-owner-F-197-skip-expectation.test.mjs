// M12/T9 F-197 (R5-E09-03) / H3 — the per-family skip expectation.
//
// CI printed green while whole families of tests were skipped: the SQL
// statement gate and every WSL-dependent control never executed, and the
// job's conclusion was SUCCESS. `AGENTS.md` §11 requires an unavailable
// required gate to stay `NOT RUN`; here it was folded into "fail 0".
//
// The owner's answer (`H3`) is to SET AN EXPECTATION, and the measurement
// says it must be a PER-FAMILY expectation: one global number would fire on
// ~40 legitimate host-capability skips.
//
// This lane pins the three halves of the gate:
//
//   1. the expectation table exists, every family carries its reason, and the
//      family-to-lane map is DERIVED from the repository's own lane list — a
//      lane declares the family it belongs to, and the table never becomes a
//      second, hand-written copy of the test names;
//   2. the gate reads a run's own report and refuses a family that skips more
//      than declared, a family that is expected to run and was skipped
//      entirely, and a skipped lane that declares no family;
//   3. the npm `test` script CONSUMES the skip counts — a gate nobody runs is
//      not a gate.
//
// The reports here are crafted: they are what the gate has to refuse, and a
// refusal that is not proven is not a refusal.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATE = path.join(REPO, "scripts", "skip-expectation-gate.mjs");
const TABLE = path.join(REPO, "docs", "contracts", "ci-skip-expectations.json");
const PACKAGE = path.join(REPO, "package.json");

const table = JSON.parse(readFileSync(TABLE, "utf8"));
const families = table.families ?? [];
const FAMILY_MARKER = /^\/\/ SKIP-FAMILY: ([a-z0-9-]+)$/mu;

/** The lanes the repository owns, as repo-relative paths. */
function laneList(directory = path.join(REPO, "tests")) {
  const lanes = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      lanes.push(...laneList(full));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      lanes.push(path.relative(REPO, full).split(path.sep).join("/"));
    }
  }
  return lanes.sort();
}

/** The family a lane declares, or null. */
function familyOfLane(lane) {
  const source = readFileSync(path.join(REPO, lane), "utf8");
  return FAMILY_MARKER.exec(source)?.[1] ?? null;
}

/** The lanes of one declared family, derived from the lanes themselves. */
function lanesOf(family) {
  return laneList().filter((lane) => familyOfLane(lane) === family.id);
}

/** A crafted JUnit report: one case per lane, skipped or passed. */
function craftReport(cases) {
  const body = cases
    .map((entry) => {
      const attributes = `name="${entry.name}" time="0.1" classname="test" file="${path.join(REPO, entry.lane)}"`;
      if (!entry.skipped) return `\t<testcase ${attributes}/>`;
      return `\t<testcase ${attributes}>\n\t\t<skipped type="skipped" message="crafted"/>\n\t</testcase>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<testsuites>\n${body}\n</testsuites>\n`;
}

/** The gate's verdict on a crafted report. */
function verdict(cases, { ci = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "zink-f197-"));
  try {
    const report = path.join(root, "report.xml");
    writeFileSync(report, craftReport(cases), "utf8");
    const environment = { ...process.env };
    if (ci) environment.CI = "true";
    else delete environment.CI;
    const result = spawnSync(process.execPath, [GATE, report], {
      cwd: REPO,
      encoding: "utf8",
      env: environment,
    });
    return {
      code: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A family whose lanes are all expected to run on the CI runner. */
const mustRunFamily = families.find(
  (family) => family.expectation === "must-run" && lanesOf(family).length > 0,
);
const maySkipFamily = families.find(
  (family) => family.expectation === "may-skip" && lanesOf(family).length > 0,
);

test("F-197: every declared family carries its reason, and its lanes come from the lane list", () => {
  assert.ok(families.length > 0, "the expectation table must declare families");
  const declared = new Set();
  for (const family of families) {
    assert.equal(typeof family.id, "string", "every family needs an id");
    assert.ok(
      typeof family.reason === "string" && family.reason.length > 40,
      `${family.id} must carry the reason it may skip`,
    );
    assert.ok(
      ["must-run", "may-skip"].includes(family.expectation),
      `${family.id} must declare an expectation the gate understands`,
    );
    assert.equal(
      typeof family.maxSkips,
      "number",
      `${family.id} must declare how many skips it may have`,
    );
    assert.equal(
      declared.has(family.id),
      false,
      `the family id ${family.id} is declared twice`,
    );
    declared.add(family.id);
    const members = lanesOf(family);
    assert.ok(
      members.length > 0,
      `${family.id} names no lane in the repository: its expectation is stale`,
    );
  }
  // A lane may belong to only ONE family, or the counts would be ambiguous.
  const seen = new Map();
  for (const lane of laneList()) {
    const family = familyOfLane(lane);
    if (!family) continue;
    assert.ok(
      declared.has(family),
      `the lane \`${lane}\` declares the family \`${family}\`, which the table does not`,
    );
    assert.equal(
      seen.has(lane),
      false,
      `the lane \`${lane}\` declares two families`,
    );
    seen.set(lane, family);
  }
});

test("F-197: the gate refuses a family that skips more than declared", () => {
  assert.ok(maySkipFamily, "the table must declare a family that may skip");
  const lane = lanesOf(maySkipFamily)[0];
  const cases = [];
  for (let index = 0; index <= (maySkipFamily.maxSkips ?? 0); index += 1) {
    cases.push({ lane, name: `a skipped case ${index}`, skipped: true });
  }
  const result = verdict(cases);
  assert.notEqual(
    result.code,
    0,
    `the gate must refuse a run where \`${maySkipFamily.id}\` skips more than \
declared: ${result.stdout}${result.stderr}`,
  );
  assert.match(
    result.stderr,
    /may skip at most/iu,
    `the refusal must name the expectation: ${result.stderr}`,
  );
});

test("F-197: the gate refuses a family that is expected to run and was skipped entirely", () => {
  assert.ok(
    mustRunFamily,
    "the table must declare a family that is expected to run",
  );
  const lane = lanesOf(mustRunFamily)[0];
  const result = verdict([{ lane, name: "a skipped case", skipped: true }]);
  assert.notEqual(
    result.code,
    0,
    `the gate must refuse a run where \`${mustRunFamily.id}\` was skipped entirely: \
${result.stdout}${result.stderr}`,
  );
  assert.match(
    result.stderr,
    /expected to RUN/iu,
    `the refusal must name the expectation: ${result.stderr}`,
  );
});

test("F-197: the gate refuses a skipped lane that declares no family", () => {
  const lane = "tests/agent-owner-F-197-skip-expectation.test.mjs";
  assert.equal(
    familyOfLane(lane),
    null,
    "this lane must not declare a family: it is the lane that proves the \
unexplained-skip refusal",
  );
  const result = verdict([{ lane, name: "a skipped case", skipped: true }]);
  assert.notEqual(
    result.code,
    0,
    `the gate must refuse an unexplained skip: ${result.stdout}${result.stderr}`,
  );
  assert.match(
    result.stderr,
    /unexplained/iu,
    `the refusal must say the skip is unexplained: ${result.stderr}`,
  );
});

test("F-197: the gate passes a run that matches the declarations", () => {
  const cases = [];
  for (const family of families) {
    for (const lane of lanesOf(family)) {
      cases.push({
        lane,
        name: `a case of ${family.id}`,
        skipped: family.expectation === "may-skip",
      });
    }
  }
  // Every lane of the repository contributes a case: a lane that did not run
  // is a refusal of its own, so a report that leaves one out must not be
  // able to claim to match the declarations.
  for (const lane of laneList()) {
    if (cases.some((entry) => entry.lane === lane)) continue;
    cases.push({
      lane,
      name: "a case of a lane without a family",
      skipped: false,
    });
  }
  const result = verdict(cases);
  assert.equal(
    result.code,
    0,
    `a run that matches the declarations must pass: ${result.stdout}${result.stderr}`,
  );
  assert.match(result.stdout, /SKIP EXPECTATION GATE: PASS/u);
});

test("F-197: the gate refuses a lane that did not run at all", () => {
  // A lane that contributed no case has no skip to count: its absence looks
  // exactly like a lane with nothing to skip. A whole lane going inert would
  // then leave the gate green, which is the defect this gate exists to close.
  const cases = [];
  for (const family of families) {
    for (const lane of lanesOf(family)) {
      cases.push({
        lane,
        name: `a case of ${family.id}`,
        skipped: family.expectation === "may-skip",
      });
    }
  }
  const absent = laneList().find(
    (lane) => !cases.some((entry) => entry.lane === lane),
  );
  assert.ok(absent, "the repository must own a lane that declares no family");

  const result = verdict(cases);
  assert.notEqual(
    result.code,
    0,
    `the gate must refuse a lane that did not run: ${result.stdout}${result.stderr}`,
  );
  assert.match(
    result.stderr,
    /did not run/u,
    `the refusal must say the lane did not run: ${result.stderr}`,
  );
});

test("F-197: the npm test script consumes the skip counts", () => {
  // A gate nobody runs is not a gate: the `test` script must produce the
  // report and run the gate over it.
  const packageJson = JSON.parse(readFileSync(PACKAGE, "utf8"));
  const command = packageJson.scripts.test;
  assert.match(
    command,
    /skip-expectation-gate\.mjs/u,
    "the npm test script must run the skip-expectation gate",
  );
  assert.match(
    command,
    /--test-reporter=junit/u,
    "the npm test script must write the run's own report for the gate to read",
  );
  const source = readFileSync(GATE, "utf8");
  assert.match(source, /ci-skip-expectations\.json/u);
  assert.match(
    source,
    /process\.env\.CI/u,
    "the gate must know whether it runs on the CI runner, whose expectations \
the table declares",
  );
  assert.match(
    source,
    /SKIP-FAMILY/u,
    "the gate must read the family each lane declares",
  );
  assert.ok(
    execFileSync(
      "git",
      ["ls-files", "--error-unmatch", path.relative(REPO, GATE)],
      { cwd: REPO, encoding: "utf8" },
    )
      .trim()
      .endsWith("skip-expectation-gate.mjs"),
    "the gate must be tracked",
  );
});

test("F-197: the gate reads a REAL Node JUnit report", () => {
  // The crafted reports above prove what the gate must refuse; this case
  // proves the gate can READ what Node actually writes. The report is
  // produced by the real reporter, not by hand.
  const root = mkdtempSync(path.join(tmpdir(), "zink-f197-real-"));
  try {
    const lane = "real-lane.test.mjs";
    writeFileSync(
      path.join(root, lane),
      `import test from "node:test";
test("a case that passed", () => {});
test("a case that skipped", { skip: "crafted" }, () => {});
`,
      "utf8",
    );
    const report = path.join(root, "report.xml");
    // The child must NOT look like a test file of THIS run: node isolates a
    // child that carries the test context, and an isolated child writes no
    // report of its own.
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    execFileSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=junit",
        "--test-reporter-destination=report.xml",
        lane,
      ],
      { cwd: root, encoding: "utf8", stdio: "pipe", env: environment },
    );
    const xml = readFileSync(report, "utf8");
    assert.match(xml, /<testcase\b/u, "the real report must carry test cases");
    assert.match(
      xml,
      /file="[^"]*real-lane\.test\.mjs"/u,
      "the real report must name the lane",
    );
    assert.match(
      xml,
      /<skipped\b/u,
      "the real report must mark the skipped case",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
