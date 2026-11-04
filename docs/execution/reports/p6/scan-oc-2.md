# OpenClaw Artifact Survey Recheck Report (oc-2) — artifact validation and Excel writer

**Slice ID:** oc-2
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-002** | Excel ZIP validation has no aggregate expanded-byte budget | **FIXED** | `artifact-validator.mjs:265-271`, `excel-writer.mjs:220-223` (commit `5b3f72b`) |
| **F-OC-003** | Excel write path follows an in-workspace dangling symlink outside the sandbox | **FIXED** | `excel-writer.mjs:546-607` symlink/dangling guards (commit `adc7e84`) |
| **F-465 / F-466 / F-468 / F-472 / F-473** | Legacy artifact rows | **not in register** (closed upstream) | findings.md history |
| **F-469 / F-471** | Adjacent artifact rows | **OPEN** (carried) | Register rows |

## 2. Detailed Findings Recheck

### F-OC-002 — ZIP expansion budgets (owner Option B)
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** both readers enforce Option B budgets before retaining buffers — 5,000 entries max, 128 MiB per entry max, 512 MiB aggregate max — with errors naming the measurement and the limit (`artifact-validator.mjs:265-271`, `excel-writer.mjs:220-223`).
- **Test Evidence:** `m12-t9-r5-zip-expansion-budgets` 14/14 PASS in the loop-2 W0/W1 rerun (`tests.md:11`). Register row carries "R5 fixed at `5b3f72b`"; closure waits for the band gate per §0.5.

### F-OC-003 — dangling symlink escape
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** the write path walks with `lstatSync`, detects `isSymbolicLink()` and the dangling-symlink case where `realpathSync` fails on a symbolic link, and refuses before creating anything outside the sandbox (`excel-writer.mjs:546-560-607`).
- **Test Evidence:** committed lane recorded at loop 1 (`adc7e84`); not in the loop-2 rerun list — flagged for a Phase-8 gate run at HEAD before closure.

### Adjacent artifact rows
- **F-469** OPEN (evidenceDigest stamped before path-security mutation; conditional) — carried. **F-471** OPEN (raw error text persisted into untracked trees) — carried. **F-502** LATENT (declared-but-unwired `publishArtifactAtomic`) — carried.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** F-OC-003's dedicated suite not rerun at the loop-2 commit (Phase 8 gate-run item).
