import assert from "node:assert/strict";
import test from "node:test";

import {
  REFERENCE_EXECUTION_CODES,
  REFERENCE_TOPIC_CODES,
  isValidStructuredReferenceId,
  resolveReferenceIdMeaning,
} from "../zink-tools/common/semantic-contract.mjs";

const TASK_NUMBER = "0001";

// R5-E07-03: `isValidStructuredReferenceId` wrapped only the format parser, so it returned
// true for ids that `resolveReferenceIdMeaning` refuses. A caller that checked validity and
// then resolved still crashed -- the predicate asserted a property it could not check.
// Validity now means resolvable, which is what every caller already assumed.

test("every id the resolver can resolve is reported valid", () => {
  for (const topicCode of Object.keys(REFERENCE_TOPIC_CODES)) {
    for (const executionCode of Object.keys(REFERENCE_EXECUTION_CODES)) {
      const id = `${topicCode}-${executionCode}-${TASK_NUMBER}`;
      assert.equal(isValidStructuredReferenceId(id), true, id);
    }
  }
});

test("a well-formed id with an unregistered topic code is not valid", () => {
  const id = "08-01-0001";
  // M12/T9 F-330: the diagnostic names the registry that refused the id.
  assert.throws(
    () => resolveReferenceIdMeaning(id),
    /topic code "08" is not registered/u,
  );
  assert.equal(isValidStructuredReferenceId(id), false, id);
});

test("a well-formed id with an unregistered execution code is not valid", () => {
  const id = "01-06-0001";
  // M12/T9 F-330: the diagnostic names the registry that refused the id.
  assert.throws(
    () => resolveReferenceIdMeaning(id),
    /execution code "06" is not registered/u,
  );
  assert.equal(isValidStructuredReferenceId(id), false, id);
});

test("an id outside both registries is refused, not merely shape-checked", () => {
  const id = "99-99-0001";
  // M12/T9 F-330: the old case probed only the topic registry and then
  // asserted the boolean predicate, which wraps the resolver and therefore
  // cannot say WHICH registry refused. Each assertion now names the registry
  // it probes, and the resolver's own diagnostic is asserted.
  assert.equal(
    Object.hasOwn(REFERENCE_TOPIC_CODES, "99"),
    false,
    "the TOPIC registry must not hold 99",
  );
  assert.equal(
    Object.hasOwn(REFERENCE_EXECUTION_CODES, "99"),
    false,
    "the EXECUTION registry must not hold 99",
  );
  assert.throws(
    () => resolveReferenceIdMeaning(id),
    /topic code "99" is not registered/u,
    "the resolver must name the registry that refused the id",
  );
  assert.equal(isValidStructuredReferenceId(id), false, id);
});

test("malformed ids are still refused", () => {
  for (const id of ["invalid-id", "01-03", "1-3-0001", "", "0a-01-0001"]) {
    assert.equal(isValidStructuredReferenceId(id), false, id);
  }
});
