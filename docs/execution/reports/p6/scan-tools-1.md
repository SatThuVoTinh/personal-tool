# Phase 6 Recheck — scan-tools-1

- **Mode:** Recheck
- **Scope:** `zink-tools/` — adapter contracts, schemas, input validation
- **Finding IDs verified:** F-OC-010, F-OC-011
- **Baseline:** Current working tree at HEAD `63ddf40` (after fix commits)

## F-OC-010 Verification

**Claimed fixed:** YES — native Excel execution error envelope now emits schema-compliant shape

**Status:** FIXED ✓

**Evidence:**
- `integrations/openclaw/plugins/zink-governance/index.mjs:5329-5355` — catch block now emits `{ operation, success, error_code, error_message }` instead of generic `{status:"ERROR", tool, error, message, code}`
- Previously at `:5315-5327` the `UNAVAILABLE` path used non-schema fields; now all exit paths use schema-compatible shapes
- The output envelope validator at `:5359-5366` is reached for normal execution results
- Contract: `zink-tools/contracts/tools/zink-excel.schema.json:56-75` requires `operation` + `success` and forbids additional properties; the new error shape satisfies this with `error_code` and `error_message` as permitted by `"additionalProperties": false` only if explicitly declared (however, inspection shows the schema does NOT declare these fields — the fix introduces fields not in the schema)

**Issue detected:** The emitted error shape `{ operation, success, error_code, error_message }` contains `error_code` and `error_message` which are **not declared** in the JSON schema `zink-tools/contracts/tools/zink-excel.schema.json`. The schema has `required: ["operation", "success"]` and `"additionalProperties": false`, meaning `error_code` and `error_message` violate the schema.

**Verdict:** PARTIAL — the shape changed but still violates the published schema. The acceptance criteria states "either publish one declared Excel error output shape OR explicitly define and validate a shared terminal-error envelope". Neither was fully implemented.

## F-OC-011 Verification

**Claimed fixed:** YES — contract document and runtime now agree on executable mode

**Status:** PARTIAL ✓

**Evidence:**
- `zink-tools/excel/contract.md:24` still states "Under Model A (Contract Tool Interface), invocation returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam."
- `zink-tools/README.md:8` states "`zink_excel` Thật, một engine duy nhất" pointing to hosted writer
- Runtime dispatch at `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4863` resolves and calls the real hosted writer at `integrations/openclaw/lib/excel-writer.mjs:841-852`
- The guard's seam-based refusal at `integrations/openclaw/topology/lib/guard.mjs:2230-2242` remains for `target === "contract_seam"`

**Analysis:** The contradiction persists in documentation. Two competing claims exist:
1. Contract prose says Model A returns `ENGINE_NOT_IMPLEMENTED`
2. README and runtime execute real workbooks

The fix did not resolve which intended mode is correct. Either:
- The contract prose should be updated to reflect live execution, OR
- The README and runtime should return `ENGINE_NOT_IMPLEMENTED` (disabling live capability — would require owner decision)

**Verdict:** PARTIAL — documentation inconsistency remains unresolved. No behavioral change made because owner decision required before disabling live capability.

## New Defects Detected

None identified inside scope. Both findings relate to out-of-scope OpenClaw plugin files, but their root causes touch in-scope contract documents.

## Checks

- Tests: Not run per recheck protocol — evidence reported in `docs/execution/reports/p6/tests.md`
- Source/shared files changed: None — read-only recheck
- Report file written: Only `docs/execution/reports/p6/scan-tools-1.md`

## Summary

| Finding | Claim | Verdict | Evidence Path | Notes |
| --- | --- | --- | --- | --- |
| F-OC-010 | Error envelope fixed | PARTIAL | index.mjs:5329-5355 | Fields added (`error_code`, `error_message`) not declared in schema |
| F-OC-011 | Contract/docs aligned | PARTIAL | contract.md:24, README.md:8, index.mjs:4845-4863 | Contradiction remains; owner decision required before behavioral change |

---

Final reply (≤10 lines):
Recheck complete for F-OC-010, F-OC-011 in `docs/execution/reports/p6/scan-tools-1.md`.
F-OC-010: PARTIAL — error envelope changed but still violates schema (missing field declarations).
F-OC-011: PARTIAL — doc vs runtime contradiction unresolved; owner decision needed.
No new defects found in zink-tools scope.
Test gates reported in `docs/execution/reports/p6/tests.md`: Knowledgebase PASS, repo-policy PASS, affected Node tests PASS, repo:check FAIL (trailing whitespace/package.json).
Both findings relate to OpenClaw plugin behavior that touches in-scope contracts; fixes applied but incomplete per acceptance criteria.
Blockers: Schema must be updated to declare `error_code` and `error_message` or remove them from error envelope. Owner decision required to align contract prose with runtime.
Report written: `docs/execution/reports/p6/scan-tools-1.md`.
