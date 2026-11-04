# Skill Store Audit Recheck Report (skill-2)

**Slice ID:** skill-2
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-SKILL-002** | Namespace aliases stored raw, scoped searches miss the skill | **FIXED** | `zink-skill-store/src/vector-sync.mjs` canonicalization on storage (commit `30dbd99`) |
| **F-427–F-436** | Legacy lock/migration rows | **carried unchanged** (F-430–F-436 OPEN/LATENT per register) | Register rows `findings.md:876-966` |

## 2. Detailed Findings Recheck

### F-SKILL-002 — alias canonicalization
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** vector-sync now canonicalizes namespace aliases when storing (so stored rows and the canonical query name agree — the register's premise "alias-stored rows are queried by canonical name" no longer drives divergence); connections use the module-role login `skill_app` via `psql -U skill_app` at `vector-sync.mjs:337` (part of `F-INFRA-002`'s loop-1 lane).
- **Test Evidence:** loop-1 committed-evidence suite `m11-t1-skill-vector-sql` 25/25 (record of `30dbd99` lane); not in the loop-2 rerun list (`tests.md:11`) — flagged for Phase 8 gate freshness. Register row still carries the Phase-3 OPEN text (stale) — Phase 8 reconciliation.

### F-430–F-436 — legacy rows of this slice
- **F-430** OPEN (CLI deprecate triggers no sync), **F-431** OPEN (migration ledger INSERT unlocked), **F-432** LATENT (door marks held before acquisition), **F-433** OPEN (lock recovery TOCTOU), **F-434** OPEN (freshness aggregate), **F-435** OPEN (dual-export locking contracts), **F-436** OPEN (schema migration inside post-lock window). No loop-2 change touched any of them.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** None new; legacy rows stay in the queue untouched.
