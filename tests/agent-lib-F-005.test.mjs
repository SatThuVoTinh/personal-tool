// M12/T9 F-005 (R1-A13-01): M12/T2-R1's "one honest tag per category" rule
// caused the live approval outage. The rule was reverted for STACK only; it
// still sat at the RISK/TYPE/STATUS siblings.
//
// A category that cannot be derived is pushed to absent, the post is refused,
// and the governed event reaches the owner NOWHERE. That is a cancellation of
// a governed post, and it is what this row removes.
//
// The BLOCKED outcome stays unmapped on purpose: `tests/m12-t2-forum-tags.test.mjs`
// pins that BLOCKED and CANCELLED are not owner judgements about a result, and
// that pin is the owner's recorded decision. See the owner decision carried
// by F-005.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approvalRiskTag,
  resultStatusTag,
  resultTypeTag,
} from "../integrations/openclaw/lib/discord-forum-tags.mjs";
import { AGENT_IDS } from "../integrations/openclaw/lib/authority.mjs";
import { riskClassesAdmittedBy } from "../integrations/openclaw/plugins/zink-governance/index.mjs";

test("F-005: an accepted-but-failed result still opens a results thread", () => {
  assert.deepEqual(
    resultStatusTag({ decision: "ACCEPT", outcomeStatus: "FAILED" }),
    { category: "STATUS", value: "FAILED" },
  );
});

test("F-005: a coordinator's own result has a TYPE", () => {
  for (const target of ["main", "o1", "o2"]) {
    assert.deepEqual(
      resultTypeTag({ target }),
      { category: "TYPE", value: "REPORT" },
      `${target} must have a derivable result type`,
    );
  }
});

test("F-005: a specialist's software still decides the TYPE", () => {
  assert.deepEqual(resultTypeTag({ target: "excel" }), {
    category: "TYPE",
    value: "DATA",
  });
  assert.deepEqual(resultTypeTag({ target: "python" }), {
    category: "TYPE",
    value: "ANALYSIS",
  });
});

test("F-005: the RISK tag is derivable for every agent in the roster", () => {
  // The RISK sibling of the same rule: the risk classes come from the policy
  // for the admitted agents, so every reachable agent set yields a class the
  // RISK tag can be derived from. An empty class set would cancel the card.
  for (const agentId of AGENT_IDS) {
    const classes = riskClassesAdmittedBy([agentId]);
    assert.ok(
      classes.length > 0,
      `${agentId} must admit at least one risk class`,
    );
    assert.notEqual(
      approvalRiskTag(classes),
      null,
      `${agentId} must yield a derivable RISK tag`,
    );
  }
});
