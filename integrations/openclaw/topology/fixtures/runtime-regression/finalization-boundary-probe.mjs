// Read-only source diagnostic, not a substitute for native end-to-end tests.
// Reads only public installed package metadata and the pinned source files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.argv[2];
assert.ok(root && path.isAbsolute(root), "Supply the installed package root");
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
assert.equal(version, "2026.6.34", "Probe requires the exact pinned runtime");
const sources = {
  finalization: "dist/selection-DopzNY3I.js",
  delivery: "dist/subagent-announce-origin-mPCGgsQU.js",
  hooks: "dist/plugin-sdk/hook-types-H9SC6W-p.d.ts",
};
const content = Object.fromEntries(
  Object.entries(sources).map(([key, file]) => [
    key,
    readFileSync(path.join(root, file), "utf8"),
  ]),
);
const checks = {
  finalization_revision_limit_can_finalize:
    /revision limit reached; finalizing/u.test(content.finalization),
  finalization_side_effect_can_finalize:
    /requested revision after potential side effects; finalizing/u.test(
      content.finalization,
    ),
  delivery_target_hook_returns_origin_only:
    /type PluginHookSubagentDeliveryTargetResult = \{\s*origin\?:/u.test(
      content.hooks,
    ),
  delivery_hook_failure_falls_back_to_requester:
    /catch \{\s*return requesterOrigin;/u.test(content.delivery),
  llm_output_hook_is_observational:
    /llm_output: [^\n]+Promise<void> \| void;/u.test(content.hooks),
};
assert.ok(
  Object.values(checks).every(Boolean),
  "Installed source changed; manually re-audit hook semantics",
);
process.stdout.write(
  `${JSON.stringify(
    {
      runtime_version: version,
      diagnostic_kind: "SOURCE_ONLY",
      sources: Object.fromEntries(
        Object.entries(sources).map(([key, file]) => [
          file,
          createHash("sha256").update(content[key]).digest("hex"),
        ]),
      ),
      checks,
      conclusion:
        "These hooks do not establish a mandatory pre-delivery acceptance veto. Alternative native enforcement must be proven before live apply.",
      end_to_end_gate: "NOT RUN",
    },
    null,
    2,
  )}\n`,
);
