// F-268 (R7-D13-05) — the live acceptance restore container escaped the label
// sweeper and its removal exit code was unchecked, so a leak still reported
// PASS.
//
// The sweeper selects containers by three labels (acceptance, acceptance-run,
// persistence=temporary) and the restore container was started with only two
// of them, so cleanup depended on a single `docker rm -f` whose failure was
// swallowed; the run then printed its success line with the container still
// present.
//
// Acceptance criteria: either the restore container carries the sweeper's third
// label or its removal exit code is checked and a failure downgrades the run's
// result.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (...parts) => readFileSync(path.join(root, ...parts), "utf8");

const live = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-live.ps1",
);
const common = read(
  "infrastructure",
  "docker",
  "scripts",
  "knowledge-t5-common.ps1",
);

function restoreContainerRun() {
  const match = live.match(
    /& docker run --detach --name \$restoreContainer[^\n]*/,
  );
  assert.ok(match, "the live driver must start the restore container");
  return match[0];
}

test("F-268: the sweeper selects temporary resources by three labels", () => {
  assert.match(
    common,
    /label=com\.personal-tool\.acceptance=t5/,
    "the sweeper must select by the acceptance label",
  );
  assert.match(
    common,
    /label=com\.personal-tool\.persistence=temporary/,
    "the sweeper must select by the persistence label",
  );
});

test("F-268: the restore container carries the sweeper's third label", () => {
  const run = restoreContainerRun();
  assert.match(run, /--label com\.personal-tool\.acceptance=t5/);
  assert.match(run, /--label com\.personal-tool\.acceptance-run=\$runId/);
  assert.match(
    run,
    /--label com\.personal-tool\.persistence=temporary/,
    "the restore container must carry the label the sweeper selects on",
  );
});

test("F-268: the removal's exit code is checked", () => {
  const removal = live.match(
    /if \(\$script:restoreContainerStarted\) \{[\s\S]{0,600}?\n {4}\}/,
  );
  assert.ok(removal, "the live driver must remove the restore container");
  assert.match(
    removal[0],
    /docker rm -f \$restoreContainer[\s\S]{0,400}?\$LASTEXITCODE/,
    "a removal that fails must be observed",
  );
});

test("F-268: a leak downgrades the run's recorded result", () => {
  const removal = live.match(
    /if \(\$script:restoreContainerStarted\) \{[\s\S]{0,600}?\n {4}\}/,
  );
  assert.ok(removal, "the live driver must remove the restore container");
  assert.match(
    removal[0],
    /\$evidence\.result\s*=\s*"FAIL"/,
    "a container that could not be removed must not be recorded as a PASS",
  );
  assert.match(
    removal[0],
    /throw/,
    "a container that could not be removed must fail the run",
  );
});
