// M12/T9-R4 lane L3 (fix-tools) — F-447 (legacy R9-L07a-2).
//
// `validateArtifactLogicalPath` used to accept a leading- or trailing-dot
// segment, so `orders.` validated and the storage adapter's landing key became
// `landing/orders.` — a distinct Map key from `landing/orders` — which made the
// adapter's "no second spelling can address this object" invariant false. The
// validator now rejects any segment that begins or ends with `.`.
//
// Wording note for the lead: the row's acceptance sentence asks that the second
// put raise `R2_LANDING_IMMUTABLE_VIOLATION`, but the same criteria require the
// validator to REJECT the dot spelling; under rejection the second put raises
// `R2_INVALID_ARTIFACT_ID` and the immutable-violation path is never reached.
// What the row's red-when-removed clause demands — that `orders.` and `orders`
// are not both admissible, and that removing the dot check turns the assertion
// red — is asserted here literally.
import test from "node:test";
import assert from "node:assert/strict";

import {
  validateArtifactLogicalPath,
  isArtifactLogicalPathValid,
} from "../zink-tools/common/path-safety.mjs";
import { R2StorageAdapter } from "../zink-tools/adapters/storage/r2-adapter.mjs";

test("F-447: segments with an edge dot are rejected, interior dots are not", () => {
  for (const bad of [
    "orders.",
    ".orders",
    "reports/q1.",
    "reports/.hidden",
    "a/b./c",
    "orders..",
    "..orders",
  ]) {
    assert.throws(
      () => validateArtifactLogicalPath(bad),
      /SCHEMA_VALIDATION_FAILED/u,
      `edge-dot spelling must be rejected: ${bad}`,
    );
    assert.equal(isArtifactLogicalPathValid(bad), false, bad);
  }

  // Interior dots stay ordinary characters — no over-rejection.
  assert.equal(
    validateArtifactLogicalPath("reports/q1.xlsx"),
    "reports/q1.xlsx",
  );
  assert.equal(validateArtifactLogicalPath("orders"), "orders");
});

test("F-447: `orders.` and `orders` are not both admissible landing ids", async () => {
  const adapter = new R2StorageAdapter();
  const put = (artifact_id) =>
    adapter.putLandingArtifact({
      task_id: "task-1",
      run_id: "run-1",
      artifact_id,
      data: "payload",
    });

  const first = await put("orders");
  assert.equal(first.artifact_id, "orders");

  // The dot alias is refused at validation, so no second key can address the
  // object; with the dot check removed this put SUCCEEDS under a distinct key
  // and both assertions below go red.
  await assert.rejects(
    () => put("orders."),
    (error) => {
      assert.equal(error.name, "R2AdapterError");
      assert.equal(error.code, "R2_INVALID_ARTIFACT_ID");
      return true;
    },
    "the trailing-dot spelling must not be admitted beside `orders`",
  );

  const landingKeys = [...adapter.storage.keys()].filter((key) =>
    key.startsWith("landing/"),
  );
  assert.deepEqual(landingKeys, ["landing/orders"]);

  // A genuine second put of the SAME id still hits the immutability rule.
  await assert.rejects(
    () => put("orders"),
    (error) => error.code === "R2_LANDING_IMMUTABLE_VIOLATION",
  );
});
