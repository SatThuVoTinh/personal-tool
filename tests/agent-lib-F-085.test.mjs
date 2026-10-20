// M12/T9 F-085 (R1-A11-02): the owner-verdict enum. The schema permitted six
// values, the reducer commits three, and the authority module used a third set
// of names for the same verdicts.
//
// Two of the three lanes below are RED at HEAD and stay red until the owner of
// the file lands their half:
//
//   - the published contract's enum must lose the three dead values
//     (`ACCEPT`, `REJECT_RESULT`, `REQUEST_REVISION_RESULT`) - the topology
//     agent owns `integrations/openclaw/topology/contracts/ledger-event.schema.json`;
//   - the plugin entrypoint must stop resolving the verdict with its own
//     inline channel ternary - the plugin agent owns
//     `integrations/openclaw/plugins/zink-governance/index.mjs`.
//
// The middle lane - the ONE reviewed mapping in `lib/authority.mjs` - is the
// library half and is green.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  ACTIONS,
  LEDGER_APPROVAL_DECISION_VALUES,
  resolveLedgerDecision,
} from "../integrations/openclaw/lib/authority.mjs";

const SCHEMA = JSON.parse(
  readFileSync(
    new URL(
      "../integrations/openclaw/topology/contracts/ledger-event.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const ENTRYPOINT_SOURCE = readFileSync(
  new URL(
    "../integrations/openclaw/plugins/zink-governance/index.mjs",
    import.meta.url,
  ),
  "utf8",
);

test("F-085: every decision the published contract admits is one the reducer commits", () => {
  const admitted = SCHEMA.allOf.find(
    (entry) =>
      entry.if?.properties?.type?.const === "WORKFLOW_USER_APPROVAL_DECIDED",
  )?.then?.properties?.payload?.properties?.decision?.enum;
  assert.ok(Array.isArray(admitted), "the contract must declare the enum");
  assert.deepEqual(
    [...admitted].sort(),
    [...LEDGER_APPROVAL_DECISION_VALUES].sort(),
    "the contract must admit exactly the decisions the reducer commits",
  );
});

test("F-085: the authority action names resolve through ONE reviewed mapping", () => {
  assert.equal(resolveLedgerDecision(ACTIONS.APPROVE), "APPROVE");
  assert.equal(resolveLedgerDecision(ACTIONS.REJECT_APPROVAL), "REJECT");
  assert.equal(
    resolveLedgerDecision(ACTIONS.REQUEST_REVISION_APPROVAL),
    "REQUEST_REVISION",
  );
  // A RESULT verdict is carried by its own event type, so it resolves to no
  // approval decision at all - and must never be minted as one.
  assert.equal(resolveLedgerDecision(ACTIONS.ACCEPT_RESULT), null);
  assert.equal(resolveLedgerDecision(ACTIONS.REJECT_RESULT), null);
  assert.equal(resolveLedgerDecision(ACTIONS.REQUEST_REVISION_RESULT), null);
});

test("F-085: the plugin entrypoint has no inline channel ternary of its own", () => {
  assert.equal(
    /action\.toUpperCase\(\)\.trim\(\) === "REJECT"/u.test(ENTRYPOINT_SOURCE),
    false,
    "the entrypoint must not resolve a verdict with its own channel ternary",
  );
  assert.match(
    ENTRYPOINT_SOURCE,
    /normalizeAuthorityAction\(/u,
    "the entrypoint must use the one reviewed action resolver",
  );
  assert.match(
    ENTRYPOINT_SOURCE,
    /resolveLedgerDecision\(/u,
    "the entrypoint must use the one reviewed decision mapping",
  );
});
