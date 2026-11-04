// F-525 (legacy `R10-L11-1`) — a platform refusal is a SKIP, never a pass.
//
// The junction-escape case calls the ROOT-level `test.skip(name)` from inside
// its own body, which node:test schedules as a NEW root case; the running case
// then hits a bare `return` and is reported PASSED with its four containment
// asserts unexecuted. The lane uses `t.skip()` instead, but the branch only
// fires on a platform that refuses the junction — false on this host and on
// the ubuntu CI runner — so the idiom itself had no shipped regression.
//
// This lane copies `agent-lib-F-044.test.mjs` to a temp directory, forces
// `makeJunction` to return false, runs the copy under the TAP reporter, and
// asserts the escape case is reported SKIP with no phantom sibling. Reverting
// the lane to `test.skip(name)` turns it red: the escape case is reported
// `ok` (no `# SKIP`) and a third root case appears.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ESCAPE_CASE =
  "F-044: a workbook target under a junction inside the sandbox is refused";
const ALLOWED_CASE =
  "F-044: a workbook target inside the sandbox is still allowed";
const SKIP_REASON =
  "the platform refuses to create a directory junction, so the escape case is NOT RUN here";

const lanePath = fileURLToPath(
  new URL("./agent-lib-F-044.test.mjs", import.meta.url),
);
const writerPath = fileURLToPath(
  new URL("../integrations/openclaw/lib/excel-writer.mjs", import.meta.url),
);

function forcedCopy(source) {
  const withAbsoluteImport = source.replace(
    '"../integrations/openclaw/lib/excel-writer.mjs"',
    JSON.stringify(pathToFileURL(writerPath).href),
  );
  assert.notEqual(
    withAbsoluteImport,
    source,
    "the copy must import the writer by absolute URL",
  );
  const original = [
    "function makeJunction(target, link) {",
    "  try {",
    '    symlinkSync(target, link, "junction");',
    "    return true;",
    "  } catch {",
    "    return false;",
    "  }",
    "}",
  ].join("\n");
  assert.ok(
    withAbsoluteImport.includes(original),
    "the lane must still build its junction through makeJunction",
  );
  return withAbsoluteImport.replace(
    original,
    ["function makeJunction(target, link) {", "  return false;", "}"].join(
      "\n",
    ),
  );
}

test("F-525: a refused junction reports the escape case as a skip, with no phantom case", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "zink-f525-"));
  const copy = path.join(dir, "agent-lib-F-044.test.mjs");
  try {
    writeFileSync(copy, forcedCopy(readFileSync(lanePath, "utf8")));
    // A nested `node --test` launched from inside this runner inherits
    // NODE_TEST_CONTEXT, which makes the child report to the parent channel
    // instead of stdout. The lane reads the child's stdout, so it opts out.
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(
      process.execPath,
      ["--test", "--test-reporter=tap", copy],
      { encoding: "utf8", env },
    );
    assert.equal(
      run.status,
      0,
      `the forced-failure lane must not fail:\n${run.stdout}`,
    );
    const topLevel = run.stdout
      .split(/\r?\n/u)
      .filter((line) => /^(?:not )?ok \d+ - /u.test(line));
    assert.equal(
      topLevel.length,
      2,
      `exactly the two declared cases may be reported, got:\n${topLevel.join("\n")}`,
    );
    const escape = topLevel.find((line) => line.includes(ESCAPE_CASE));
    assert.ok(escape, "the escape case must appear in the report");
    assert.match(
      escape,
      /# SKIP /u,
      `the escape case must be reported SKIP, not passed: ${escape}`,
    );
    assert.ok(
      escape.includes(SKIP_REASON),
      `the skip must carry its reason: ${escape}`,
    );
    const allowed = topLevel.find((line) => line.includes(ALLOWED_CASE));
    assert.ok(allowed, "the allowed-path case must still be reported");
    assert.ok(
      !allowed.includes("# SKIP"),
      "the allowed-path case must really run",
    );
    assert.ok(
      !topLevel.some((line) => line !== escape && line.includes(SKIP_REASON)),
      "the skip must not register a phantom root case beside the parent",
    );
    assert.match(run.stdout, /^# tests 2$/mu);
    assert.match(run.stdout, /^# pass 1$/mu);
    assert.match(run.stdout, /^# skipped 1$/mu);
    assert.match(run.stdout, /^# fail 0$/mu);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
