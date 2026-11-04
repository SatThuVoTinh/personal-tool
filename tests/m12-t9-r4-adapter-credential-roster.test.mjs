// M12/T9-R4 lane L3 (fix-tools) — F-446 (legacy R9-L07a-1).
//
// Four provider adapters used to store a credential they never read
// (`this.apiToken`, `this.token`, `this.key`, `this.token`) while the F-277
// no-retention rule was asserted for DagsHub only. The credential fields are
// gone; this roster asserts one case per adapter, in the style of the existing
// DagsHub case in tests/provider-adapter-guards.test.mjs, so the assertion
// turns red if any constructor line is restored.
//
// Placement note: the row's acceptance criteria name
// tests/provider-adapter-guards.test.mjs; that existing file is outside this
// lane's write scope (new root tests/ files only), so the roster ships here and
// the lead can fold it into the named file at integration.
import test from "node:test";
import assert from "node:assert/strict";

import { MotherDuckAdapter } from "../zink-tools/adapters/analytics/motherduck-adapter.mjs";
import { DatabricksComputeAdapter } from "../zink-tools/adapters/compute/databricks-adapter.mjs";
import { KaggleComputeAdapter } from "../zink-tools/adapters/compute/kaggle-adapter.mjs";
import { HuggingFaceAdapter } from "../zink-tools/adapters/mlops/huggingface-adapter.mjs";

test("F-446: HuggingFaceAdapter does not retain the apiToken it never reads", () => {
  const adapter = new HuggingFaceAdapter({ apiToken: "never-used" });
  assert.equal(
    Object.hasOwn(adapter, "apiToken"),
    false,
    "the adapter must not hold a credential-shaped value it never reads",
  );
});

test("F-446: DatabricksComputeAdapter does not retain the token it never reads", () => {
  const adapter = new DatabricksComputeAdapter({
    host: "descriptor-host",
    token: "never-used",
  });
  assert.equal(
    Object.hasOwn(adapter, "token"),
    false,
    "the adapter must not hold a credential-shaped value it never reads",
  );
  // The host is descriptor data the adapter reports; it stays.
  assert.equal(adapter.host, "descriptor-host");
});

test("F-446: KaggleComputeAdapter does not retain the key it never reads", () => {
  const adapter = new KaggleComputeAdapter({
    username: "descriptor-user",
    key: "never-used",
  });
  assert.equal(
    Object.hasOwn(adapter, "key"),
    false,
    "the adapter must not hold a credential-shaped value it never reads",
  );
  assert.equal(adapter.username, "descriptor-user");
});

test("F-446: MotherDuckAdapter does not retain the token it never reads", () => {
  const adapter = new MotherDuckAdapter({ token: "never-used" });
  assert.equal(
    Object.hasOwn(adapter, "token"),
    false,
    "the adapter must not hold a credential-shaped value it never reads",
  );
});
