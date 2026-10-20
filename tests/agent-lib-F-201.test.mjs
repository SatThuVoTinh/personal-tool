// M12/T9 F-201 (R1-A02-06): the packaging whitelist had no completeness gate,
// and the deployed entrypoint's module graph was never imported by any test.
//
// Adding one module imported from the entrypoint shipped green through CI and
// then died at gateway start with ERR_MODULE_NOT_FOUND, taking all seven bots
// with it.
//
// The static-specifier gate already exists in
// `tests/m7-t2-plugin-packaging.test.mjs`. This lane closes the OTHER half:
// the modules the entrypoint loads at RUN TIME by repository-relative path
// (`loadRepoModule("zink-tools/sql/validator.mjs")` and the sibling calls).
// Those are invisible to a static import scan, and they were the whole
// runtime dependency set.
import assert from "node:assert/strict";
import { test } from "node:test";

import { governancePluginFiles } from "../integrations/openclaw/lib/policy.mjs";

/** Every repository-relative module path the entrypoint names. */
function runtimeModulesNamedByEntrypoint(source) {
  return [
    ...new Set(
      [
        ...source.matchAll(
          /["'`]((?:zink-tools|zink-skill-store)\/[^"'`\s]+)["'`]/gu,
        ),
      ].map((match) => match[1]),
    ),
  ];
}

test("F-201: every runtime module the packaged entrypoint loads is a packaged asset", () => {
  const { assets, entrypoint } = governancePluginFiles();
  const named = runtimeModulesNamedByEntrypoint(entrypoint);
  assert.ok(
    named.length > 0,
    "the entrypoint must name runtime modules for this gate to mean anything",
  );
  const missing = named.filter((relative) => !assets[relative]);
  assert.deepEqual(
    missing,
    [],
    `the entrypoint loads modules the package does not carry: ${missing.join(", ")}`,
  );
});

test("F-201: a module the package does not carry is refused by the gate", () => {
  // The gate must be able to SEE a missing module: an entrypoint that names a
  // module nobody packages has to fail the parity check, not pass it silently.
  const named = runtimeModulesNamedByEntrypoint(
    'const m = await loadRepoModule("zink-tools/sql/not-packaged.mjs");',
  );
  assert.deepEqual(named, ["zink-tools/sql/not-packaged.mjs"]);
  const { assets } = governancePluginFiles();
  assert.equal(
    assets["zink-tools/sql/not-packaged.mjs"],
    undefined,
    "the missing module must not be a packaged asset",
  );
});
