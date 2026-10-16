// M12/T2.2-R2 B-7 — the resource ceilings are declared once, in `BUDGETS`
// (`4.8` / `R1-A08-08`).
//
// `ledger.mjs:39-43` publishes the three ceilings, `guard.mjs:16` already reads them, and
// `workflow.mjs` re-typed all three as literals at `:1491`, `:1721` and `:1798`. A ceiling
// raised in the canonical table would have been enforced by the guard and quietly not
// enforced by the workflow, in the same process.
//
// Making `workflow.mjs` import from `ledger.mjs` does create a `ledger ↔ workflow` cycle —
// `ledger.mjs:18` already imports this module. That is the shape the owner chose (§0.5-D),
// and the last test here is what makes it safe rather than hopeful: `BUDGETS` is read inside
// functions, so nothing is dereferenced during module evaluation, and both modules load.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BUDGETS } from "../integrations/openclaw/topology/lib/ledger.mjs";

const WORKFLOW = "../integrations/openclaw/topology/lib/workflow.mjs";
const WORKFLOW_SOURCE = readFileSync(
  new URL(WORKFLOW, import.meta.url),
  "utf8",
);

test("B-7-1: the three ceilings are read from the canonical table, not retyped", () => {
  for (const literal of ["< 16", "< 10", "< 72"]) {
    assert.doesNotMatch(
      WORKFLOW_SOURCE,
      new RegExp(`requireCondition\\([^)]*${literal.replace(/\s/g, "\\s")}`),
      `an inline ceiling literal (${literal}) is a second copy of a number that has one owner`,
    );
  }
  assert.match(
    WORKFLOW_SOURCE,
    /import \{ BUDGETS \} from "\.\/ledger\.mjs";/u,
    "the workflow must read the ceilings from the module that owns them",
  );
  for (const field of [
    "maxBriefRevisionsPerTask",
    "maxStackTransitionsPerTask",
    "maxTotalDelegatedRunsPerTask",
  ]) {
    assert.match(
      WORKFLOW_SOURCE,
      new RegExp(`BUDGETS\\.${field}`),
      `each ceiling is a distinct number, so the sites must name their own field: ${field}`,
    );
  }
});

test("B-7-2: the values themselves are unchanged", () => {
  assert.deepEqual(BUDGETS, {
    maxBriefRevisionsPerTask: 16,
    maxStackTransitionsPerTask: 10,
    maxTotalDelegatedRunsPerTask: 72,
  });
});

test("B-7-3: the ledger-workflow cycle resolves because nothing is read at module scope", async () => {
  // `ledger.mjs` is already evaluated by this file's own import above, so loading
  // `workflow.mjs` now exercises the cycle in the order ESM actually has to resolve.
  const workflow = await import(new URL(WORKFLOW, import.meta.url).href);
  assert.equal(typeof workflow.applyWorkflowEvent, "function");
});
