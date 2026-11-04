# Database Audit Recheck Report (db-3) — roles, credentials, transactions

**Slice ID:** db-3
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-INFRA-002** | Knowledge uses the PostgreSQL cluster administrator | **FIXED** | `bootstrap-postgres.sh:47-76`, `compose.core.yml:155`, `vector-sync.mjs:337` (commit `7570f73`) |
| **F-432** | Door marks lock held before acquisition | **LATENT** (carried) | `index.mjs:1434-1443` |
| **F-433** | Lock recovery TOCTOU on owner.json | **OPEN** (carried) | `:142-144` |
| **F-434 / F-435 / F-436** | Freshness/export/migration rows | **OPEN** (carried) | Register rows |

## 2. Detailed Findings Recheck

### F-INFRA-002 — module roles replace the superuser
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `bootstrap-postgres.sh` creates restricted module logins `knowledge_app` / `skill_app` (`NOSUPERUSER NOCREATEDB NOCREATEROLE`, `:47-62`), owns schema authorization for `knowledge` and `skills`, revokes `CONNECT` on `n8n` from `PUBLIC` (`:70-76`); `compose.core.yml:155` wires `KNOWLEDGE_DATABASE_USER: knowledge_app`; the Skill Store executor fails closed without credentials and connects as `skill_app` (`vector-sync.mjs:337`).
- **Test Evidence:** loop-1 committed suites `m11-t1-skill-vector-sql` 25/25 + `m3-t1-contract`/`m5-docker-contract` 13/13 (record of `7570f73`); Docker live privilege check `NOT RUN` (`tests.md:13`). Register row carries "R5 fixed at `7570f73`"; closure waits for the band gate. Owner question 1 of fix-plan §9 (who provisions the module roles when `-Profile knowledge` never runs the bootstrap) remains an operational item for the owner.

### Carried transaction rows
- `F-432` LATENT, `F-433` OPEN, `F-434` OPEN, `F-435` OPEN, `F-436` OPEN — untouched in loop 1/loop 2; verdicts carry forward.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** Docker/PostgreSQL lane NOT RUN (host constraint); role-provisioning operator path is an owner decision (fix-plan §9 question 1).
