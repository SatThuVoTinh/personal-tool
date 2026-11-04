// F-228 (R7-D4-04) -- the published workflow policy and the runtime ceilings
// must not drift apart.
//
// `topology/policy/workflow-policy.json` publishes the budgets that
// `topology/lib/ledger.mjs` also carries as frozen literals, so the published
// policy is documentation that no behaviour consults.
//
// The loader that makes the FILE the source is DEFERRED to the
// governance-library agent: the packager (`lib/policy.mjs`, a shared surface)
// does not materialize `policy/workflow-policy.json` into the deployed plugin
// tree, so a loader without that asset breaks the deployed tree at import --
// `tests/m7-t2-plugin-packaging.test.mjs` is the lane that proves it.
//
// Until both halves land, this lane is the interim control: the two copies
// are compared, so an edit to the published policy that the runtime does not
// follow is RED instead of silent.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BUDGETS,
  reserveBudget,
} from "../integrations/openclaw/topology/lib/ledger.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = path.join(
  REPO,
  "integrations",
  "openclaw",
  "topology",
  "policy",
  "workflow-policy.json",
);

function publishedBudgets() {
  return JSON.parse(readFileSync(POLICY, "utf8")).budgets;
}

test("F-228: the runtime ceilings are the published policy's budgets", () => {
  const published = publishedBudgets();
  assert.deepEqual(
    {
      maxBriefRevisionsPerTask: BUDGETS.maxBriefRevisionsPerTask,
      maxStackTransitionsPerTask: BUDGETS.maxStackTransitionsPerTask,
      maxTotalDelegatedRunsPerTask: BUDGETS.maxTotalDelegatedRunsPerTask,
    },
    published,
    "the published policy and the runtime's ceilings must not drift apart",
  );
});

test("F-228: the OBSERVED ceiling is refused exactly at the published value", () => {
  const published = publishedBudgets();
  const limit = published.maxBriefRevisionsPerTask;
  const snapshot = {
    tasks: {
      t1: {
        revisions_used: 0,
        transitions_used: 0,
        delegated_runs_used: 0,
      },
    },
  };
  const reserved = reserveBudget(snapshot, "t1", "revisions", limit);
  assert.equal(
    reserved.tasks.t1.revisions_used,
    limit,
    "the reservation must be allowed up to the published ceiling",
  );
  assert.throws(
    () => reserveBudget(reserved, "t1", "revisions", 1),
    { code: "WORKFLOW_BUDGET_EXHAUSTED" },
    "one more revision past the published ceiling must be refused",
  );
});
