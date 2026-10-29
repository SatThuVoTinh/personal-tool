# Recheck Report — tools-2 (Zink Tools capability execution and resource limits)

- **Slice:** tools-2 (`zink-tools/`)
- **Area:** Capability execution (forecast, optimization, OR, simulation) and resource limits
- **Mode:** Recheck (Phase 6)
- **Rechecked Findings:** `F-OC-002`

## Status Summary

| Finding ID | Title | Status | Severity | Category |
| --- | --- | --- | --- | --- |
| F-OC-002 | Excel ZIP validation has no aggregate expanded-byte budget and can exhaust OpenClaw memory | FIXED | High | F6 |

---

## Detailed Recheck Results

### F-OC-002 — Excel ZIP validation has no aggregate expanded-byte budget and can exhaust OpenClaw memory

- **Status:** FIXED
- **Category:** F6 — Reliability & Performance
- **Severity:** High
- **Affected Modules:** OpenClaw artifact validation (`integrations/openclaw/lib/artifact-validator.mjs`), OpenClaw Excel writer (`integrations/openclaw/lib/excel-writer.mjs`), governance plugin (`integrations/openclaw/plugins/zink-governance/index.mjs`)
- **Evidence:**
  - `integrations/openclaw/lib/artifact-validator.mjs:141-143`: Defines Option B budgets: `ENTRY_COUNT_LIMIT = 5000`, `PER_ENTRY_LIMIT = 128 * 1024 * 1024` (128 MiB), `TOTAL_UNCOMPRESSED_LIMIT = 512 * 1024 * 1024` (512 MiB).
  - `integrations/openclaw/lib/artifact-validator.mjs:174-176`: Rejects archives exceeding `ENTRY_COUNT_LIMIT` before processing central directory entries.
  - `integrations/openclaw/lib/artifact-validator.mjs:221-234`: Validates declared per-entry size against `PER_ENTRY_LIMIT` and aggregate size against `TOTAL_UNCOMPRESSED_LIMIT` before buffer inflation.
  - `integrations/openclaw/lib/artifact-validator.mjs:265-285`: Passes `maxOutputLength = Math.min(PER_ENTRY_LIMIT, remainingBeforeInflation)` to `inflateRawSync` and catches output limit errors.
  - `integrations/openclaw/lib/excel-writer.mjs:148-150`: Rejects archives with `entryCount > 5000` before entry loops.
  - `integrations/openclaw/lib/excel-writer.mjs:176-189`: Checks declared per-entry and total uncompressed budgets before inflation.
  - `integrations/openclaw/lib/excel-writer.mjs:220-236,320-321`: Defines `PER_ENTRY_LIMIT` (128 MiB) and `TOTAL_UNCOMPRESSED_LIMIT` (512 MiB), passes `maxOutputLength` to `zlib.inflateRawSync`, and catches buffer overflow errors.
  - `tests/m12-t9-r5-zip-expansion-budgets.test.mjs:1-304`: Complete test suite covering entry count limit, per-entry size limit, aggregate size limit, actual inflation bounds, and valid workbook parsing.
- **Reason Fixed:** Both ZIP readers (`artifact-validator.mjs` and `excel-writer.mjs`) enforce Option B aggregate expansion and entry count budgets before inflating and retaining buffers in memory.

### New Defects Introduced

- **New Defects:** None. Inspection of `zink-tools/` and the modified files in `integrations/openclaw/` confirms the budget enforcement functions correctly without side effects.

---

## Test Gate Citation

Per lead test report `docs/execution/reports/p6/tests.md`:
- **Affected Node tests (F-OC-002, F-OC-003, F-OC-004, F-OC-005, F-SKILL-001, F-OC-001, F-OC-006, F-585):** PASS (All affected test suites passed 100% green: `m12-t9-r5-zip-expansion-budgets` 14/14)
- **Knowledgebase tests (`test:knowledge`):** PASS (311 passed, 18 skipped, 31 subtests passed in 54.67s)
- **Repository policy (`repository-policy.mjs`):** PASS (1 suite, 1 test passed in 3.15s)
- **Repository check (`repo:check`):** FAIL (Diagnostic failures: trailing whitespace in 7 files; status vocabulary in findings.md; package.json missing 2 new test files)
- **PostgreSQL / Docker real-database lane:** NOT RUN (Host lacks live container daemon / active PostgreSQL instance)
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows host environment)

---

## Summary Counts

- **Total Rechecked:** 1
- **FIXED:** 1 (`F-OC-002`)
- **PARTIAL:** 0
- **NOT FIXED:** 0
- **NEW DEFECTS:** 0
- **Blockers:** 0
