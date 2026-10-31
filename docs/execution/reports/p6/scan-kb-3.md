# Knowledgebase Audit Recheck Report (kb-3)

**Slice ID:** kb-3
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-KB-004** | Citation/chunk API responses omit index status and stable chunk ordinal | **OPEN** (RED, owner memo missing) | Register row; no fix dispatched |
| **F-515** | Embedding arms collapse the 7-code ModelProbeError vocabulary | **PARTIAL** | Service half closed `cb812ad`; producer-dist half open |
| **F-512–F-518** (others) | Citation family legacy rows | **not in register** (closed upstream) | findings.md history |

## 2. Detailed Findings Recheck

### F-KB-004 — index status + chunk ordinal omitted
- **Verdict:** OPEN — RED row still awaiting the owner decision memo (listed in `docs/execution/context.md:211`); the multi-fixer dispatch (kb + tools + tests + governance-library) was never started.
- **Evidence:** chunk/citation/metadata serialisers still omit the DB-supplied index status and stable chunk ordinal; no committed change touches the cite/chunk path in loop 1 or loop 2.
- **Test Evidence:** `test:knowledge` PASS 311/18 (`tests.md:9`) is the standing baseline gate; no F-KB-004 red test exists (fixer not dispatched).

### F-515 — embedding error-code collapse
- **Verdict:** PARTIAL (carried)
- **Evidence:** the service half is closed by `cb812ad` — both embedding arms raise and carry the code through `_embedding_error_code`; the producer-distribution half (no log record on the search/readyz arm) remains open.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** `F-KB-004` cannot be dispatched until the owner supplies its RED memo; adjacent API-surface row `F-495` (platforms README six response keys) also stays OPEN and untouched.
