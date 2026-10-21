// M12/T9 F-196 (legacy `R5-E09-01`) — H1: a push to the TASK branch must be
// gated by CI.
//
// The owner's answer to `H1` (2026-10-21) is "bật": turn the widening on.
// Before it, `.github/workflows/ci.yml` triggered on `pull_request` to `main`,
// `push` to `main` and `workflow_dispatch` ONLY, so a push to the task branch
// ran nothing at all. The measured evidence is the register row this implements
// (F-196, legacy `R5-E09-01`): every CI run on the task branch was a
// `workflow_dispatch` — a human re-pressing the button — and the
// `quality-gate` lane never ran on a branch push.
//
// The target shape is the one the secret scan already uses for `push`: the
// trigger is NOT narrowed to a branch list, so every branch push and every
// pull request is gated.
//
// This lane asserts the OWNED PROPERTY, not a copy of the file. It PARSES the
// shipped workflow and requires:
//
//   1. a `push` trigger with no branch filter;
//   2. a `pull_request` trigger with no branch filter;
//   3. the `workflow_dispatch` trigger still there;
//   4. `concurrency` still cancelling the superseded run for the same ref;
//   5. the `quality-gate` job still there, on `ubuntu-24.04`, with its steps.
//
// The YAML is read with `parseDocument` from the `yaml` package, the approach
// the repository's other lanes already use (`scripts/repository-policy.mjs`
// and `tests/agent-setup-F-188.test.mjs`).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseDocument } from "yaml";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATH = path.join(REPO, ".github", "workflows", "ci.yml");

// A trigger that names a branch list, or a path list, is NARROWED: it does not
// run for every branch push and every pull request, which is the property the
// owner's answer binds.
const NARROWING_KEYS = ["branches", "branches-ignore", "paths", "paths-ignore"];

// Why each narrowing matters, so a failure says what the trigger lost.
const NARROWING_REASON = {
  push: "a `push` trigger narrowed to a branch list runs NOTHING for a task branch, so the quality-gate lane exists only when a human re-dispatches it",
  pull_request:
    "a `pull_request` trigger narrowed to a branch list ignores every pull request that does not target `main`",
};

function readWorkflow() {
  const source = readFileSync(WORKFLOW_PATH, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(document.errors, [], "the CI workflow must be valid YAML");
  const workflow = document.toJS();
  assert.ok(
    workflow !== null && typeof workflow === "object",
    "the CI workflow must parse into a mapping",
  );
  return workflow;
}

/** The value of one named trigger, or a failure that says it is missing. */
function trigger(workflow, event) {
  const triggers = workflow.on;
  assert.ok(
    triggers !== null &&
      typeof triggers === "object" &&
      !Array.isArray(triggers),
    `the workflow must declare its triggers as a mapping, so the \`${event}\` trigger is readable`,
  );
  assert.ok(
    Object.hasOwn(triggers, event),
    `the workflow must declare a \`${event}\` trigger`,
  );
  const value = triggers[event];
  assert.ok(
    value === null || (typeof value === "object" && !Array.isArray(value)),
    `the \`${event}\` trigger must be a mapping or empty, not a list`,
  );
  return value;
}

/** The narrowing filters a trigger carries, if any. */
function narrowingKeys(value) {
  if (value === null) {
    return [];
  }
  return NARROWING_KEYS.filter((key) => Object.hasOwn(value, key));
}

test("F-196: the CI workflow gates every branch push and every pull request", () => {
  const workflow = readWorkflow();
  for (const event of ["push", "pull_request"]) {
    const narrowed = narrowingKeys(trigger(workflow, event));
    assert.deepEqual(
      narrowed,
      [],
      `the \`${event}\` trigger must not be narrowed (${narrowed.join(", ")}): ${NARROWING_REASON[event]}`,
    );
  }
});

test("F-196: the CI workflow keeps the manual dispatch trigger", () => {
  const workflow = readWorkflow();
  trigger(workflow, "workflow_dispatch");
});

test("F-196: the CI workflow keeps cancelling the superseded run for the same ref", () => {
  const workflow = readWorkflow();
  const concurrency = workflow.concurrency;
  assert.ok(
    concurrency !== null &&
      typeof concurrency === "object" &&
      !Array.isArray(concurrency),
    "the workflow must keep a `concurrency` block",
  );
  assert.equal(
    concurrency["cancel-in-progress"],
    true,
    "a superseded run for the same ref must be cancelled, or a task branch accumulates stale runs",
  );
  assert.match(
    String(concurrency.group ?? ""),
    /github\.ref/u,
    "the concurrency group must name the ref, or a push to one branch cancels the run of another",
  );
});

test("F-196: the quality-gate job is still there, on ubuntu-24.04, with its steps", () => {
  const workflow = readWorkflow();
  const job = workflow.jobs?.["quality-gate"];
  assert.ok(
    job !== null && typeof job === "object" && !Array.isArray(job),
    "the workflow must keep the `quality-gate` job",
  );
  assert.equal(
    job["runs-on"],
    "ubuntu-24.04",
    "the quality gate must stay runnable on ubuntu-24.04",
  );
  assert.ok(
    Array.isArray(job.steps) && job.steps.length > 0,
    "the quality-gate job must keep its steps",
  );
  assert.ok(
    job.steps.some((step) => step?.run?.trim() === "npm run verify"),
    "the quality-gate job must still run the repository's own verify gate",
  );
  assert.notEqual(
    job["continue-on-error"],
    true,
    "the quality-gate job must block the workflow",
  );
  for (const [index, step] of job.steps.entries()) {
    assert.notEqual(
      step?.["continue-on-error"],
      true,
      `quality-gate step ${index} (${step?.name}) must not continue on error: the gate has to block`,
    );
  }
});
