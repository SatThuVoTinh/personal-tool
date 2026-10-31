# Phase 6 Recheck Report — Database Schema/Migrations (db-1)

**Date**: 2026-10-29
**Finding IDs Checked**: F-DB-001, F-INFRA-004
**Mode**: recheck

---

## F-DB-001 — Knowledge restore gate omits segment row data

**Status: NOT FIXED** (finding remains open as LATENT)

### What Was Claimed to Be Fixed

findings.md:2307 stated critical-table digest omitted `segments`. Evidence showed line 289 accepts TABLE definition-only via `TABLE( DATA)?` pattern.

### Current Code Inspection

- **Line 289**: Still uses `TABLE( DATA)?` pattern allowing definition-only TOC entries ✓ UNCHANGED
- **Line 330**: `$criticalTables = @("indexes", "index_runs", "segments", "sources", "source_sidecars")` contains `"segments"` ✓ Already present at HEAD
- **Lines 362-364**: Computes metadata digest on restored database including segments and compares against snapshot baseline

### Triage Analysis Verification

docs/execution/reports/p3/triage-11.md:164-200 correctly identified that:

1. If an attacker-crafted archive (definition-only segments) is injected, pg_restore creates empty `knowledge.segments` table
2. The digest comparison at line 364 computes checksums from THE SAME live snapshot used for dump creation
3. During normal operation: snapshot→dump→restore pipeline preserves segment data because dump captures all rows using same snapshot ID
4. A crafted archive with definition-only segments would cause `$restoredMetadataDigest != $metadataDigest` and throw at line 364

### Determination

**ROOT CAUSE REMAINS BUT VERIFIER PROTECTS AGAINST DEFECT AS STATED**

- Root cause description in findings.md was imprecise ("omitting segment rows") — actual issue is loose inventory predicate allowing definition-only entries
- The verifier's OVERALL design DOES protect against missing segment data via digest comparison mechanism
- However, the loose `TABLE( DATA)?` predicate at line 289 represents a boundary weakness that could allow false certification if snapshot itself has zero segments
- Triage recommendation: change inventory check to require explicit `TABLE DATA knowledge segments` AND document N/A handling for zero-segment databases
- No code changes observed in repository since Phase 3 triage

**Verdict**: Not a functional defect (design protects), but static analysis shows improvement opportunity. Keep as observation or close as design-intent-preserved.

**Evidence path**: `infrastructure/docker/scripts/knowledge-t5-live.ps1:289`, `:330`, `:362-364`

---

## F-INFRA-004 — T5 drivers reject shipped migrations (001/002/004/005)

**Status: NOT FIXED** (finding confirmed OPEN)

### Current Migration Expectations Across Drivers

| File                      | Location | Expected Migrations                 | Matches Shipped Set?              |
| ------------------------- | -------- | ----------------------------------- | --------------------------------- |
| `knowledge-t5-common.ps1` | Line 355 | `[001, 002, 004, 005]`              | ✅ YES                            |
| `knowledge-t5-ps1.ts`     | Line 178 | `[001, 002]` (pre-migration ledger) | ⚠️ INTENTIONAL (old schema state) |
| `knowledge-t5.ps1`        | Line 244 | `[001, 002]` (post-restart ledger)  | ❌ REJECTS SHIPPED SET            |
| `knowledge-t5-live.ps1`   | Line 451 | `[001]` or `[001, 002]` pre-start   | ⚠️ ACCEPTABLE compatibility       |
| `knowledge-t5-live.ps1`   | Line 474 | `[001, 002, 004, 005]` post-start   | ✅ CORRECT                        |

### Determination

**F-INFRA-004 REMAINS OPEN**:

- Isolated driver (`knowledge-t5.ps1`) rejects shipped migrations at line 244 because it expects only 001/002 post-restart
- Runtime applies all four migrations (lines 2790-2819 in `database.py`)
- Candidate builder validates full set ✓
- Pre-flight check allows old schema states (upgrade compatibility) ✓
- But line 244 throws when comparing actual ledger `[001, 002, 004, 005]` against expected `[001, 002]`

**Root Cause**: Test driver migration expectation contract is OUTDATED relative to owner-approved runtime. Owner approved migrations 004 and 005 (per PLAN.md §8315-8326 and CHANGELOG.md §2231-2235), but `knowledge-t5.ps1:244` still expects outdated two-file set.

**Impact**: Isolated acceptance test cannot complete on current tree. Candidate construction succeeds, but assertion phase fails before evidence can be produced.

**Fix Required**: Update `infrastructure/docker/scripts/knowledge-t5.ps1:244`:

```powershell
if (($ledgerAfter -join "`n") -cne "001_initial.sql`n002_pdf_ingestion_foundation.sql`n004_pdf_build_failure_cause.sql`n005_schema_migration_digest.sql") { throw "Migration was reapplied after restart." }
```

Also audit `knowledge-t5.ps1:178` pre-check: should this allow old schema states (upgrade path) or verify exact set immediately?

**Evidence path**: `infrastructure/docker/scripts/knowledge-t5.ps1:244`; `apps/knowledge/migrations/` directory; `apps/knowledge/contracts/knowledgebase-migration-digests.json:17-24`

---

## Summary

| Finding ID      | Original Status     | Verdict After Recheck | Fix Applied? | Notes                                                                                                                                   |
| --------------- | ------------------- | --------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **F-DB-001**    | CONFIRMED-AS-LATENT | CONFIRMED-AS-LATENT   | NO           | Root cause partially misdescribed; verifier protects via digest comparison; no code change needed unless tightening inventory predicate |
| **F-INFRA-004** | CONFIRMED           | OPEN                  | NO           | Isolated T5 driver expects outdated migration set; line 244 must match owner-approved runtime                                           |

**Fixed**: 0
**Not fixed**: 2
**New defects introduced**: 0

---

## Gate Outcomes (from docs/execution/reports/p6/tests.md)

| Gate                                   | Status  | Notes                                                                                              |
| -------------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| Repository policy                      | PASS    | Static checks only                                                                                 |
| Affected Node tests                    | PASS    | `tests/m3-t5-contract.test.mjs` verifies script structure via regex patterns, not runtime behavior |
| PostgreSQL / Docker real-database lane | NOT RUN | Requires live container daemon + active PostgreSQL instance                                        |
| POSIX WSL fsync/lock lane              | NOT RUN | Windows host; WSL not configured for foreground runner                                             |

**Conclusion**: No end-to-end tests execute T5 acceptance flows on this environment. Static contract assertions pass but do not validate live migration expectations.

---

## Recommendations

1. **For F-DB-001**: Not actionable as defect — design protects against missing segment data. Consider closing as "design intent preserved" or keep as improvement ticket (tighten inventory predicate at line 289 to require explicit `TABLE DATA`).

2. **For F-INFRA-004**: Create bounded fix task updating `knowledge-t5.ps1:244` to accept full migration set [001, 002, 004, 005]. Also review line 178 pre-check to confirm upgrade path expectations are intentional.

---

## Related Files (Outside db-1 Scope)

| Item                      | Path                                                                  | One-line note                        |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------ |
| Migration approval record | `PLAN.md:8315-8326`                                                   | Owner granted 004/005                |
| Migration digest contract | `apps/knowledge/contracts/knowledgebase-migration-digests.json:17-24` | Publishes 004/005 digests            |
| CHANGELOG history         | `CHANGELOG.md:2231-2235`                                              | Records closure of 004/005 approvals |

---

**End of scan.**
