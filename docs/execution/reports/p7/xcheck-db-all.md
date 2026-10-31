# Cross-Check Recheck Report — xcheck-db-all

**Boundary:** the whole database plane (roles, schema/migrations, backup/restore, integrity)
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed/verified IDs on this boundary:** `F-INFRA-002` (FIXED), `F-DB-001` (FIXED, live lane pending); carried `F-DB-002` (LATENT), `F-431` (OPEN)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-INFRA-002` | Roles vs schema ownership vs credentials consistent across bootstrap/compose/executor | **FIXED — consistent** | Roles `knowledge_app`/`skill_app` (`bootstrap-postgres.sh:47-62`), `compose.core.yml:155`, `vector-sync.mjs:337` |
| `F-DB-001` | Restore verification inventory matches the shipped migration set (incl. segments + PDF family) | **FIXED — consistent** | `knowledge-t5-live.ps1:288-331` conditional on `002_pdf_ingestion_foundation.sql` — same branch condition as the drivers |
| `F-DB-002` | Backup decryption-key coverage | **LATENT — carried** | Key still excluded; depends_on `F-558` OPEN; owner decision pending |
| `F-431` | Migration ledger INSERT unlocked, no ON CONFLICT | **OPEN — carried** | `applySkillStoreMigrations` invoked outside the lock (`index.mjs:1175`) — unchanged |

## 2. Interaction Findings

- **Complementary fixed halves:** the restore verifier (`F-DB-001`) and the drivers' migration set (`F-INFRA-004`) branch on the same `002_pdf_ingestion_foundation.sql` presence predicate, so a database at either migration era is verified against the table inventory it actually has — the cross-row conflict the loop-1 report flagged is resolved.
- **Roles↔backup seam:** `F-DB-002` (encryption key) is a host-config question independent of the role fix; its LATENT status is unchanged and does not conflict with the provisioned module roles.
- **Concurrency:** `F-431` (unlocked INSERT), `F-433` (lock-recovery TOCTOU), `F-436` (migration inside post-lock window) all carried OPEN/LATENT without interaction regression from the role fix.
- **Gates:** loop-1 store/SQL suites remain the last recorded runs for the role rows (`m11-t1-skill-vector-sql` 25/25, `m3-t1+m5` 13/13); the Docker/PostgreSQL lane is NOT RUN (`tests.md:13`); `m3-t5-contract` 8/8 was rerun in the loop-2 W0/W1 list (`tests.md:11`).

## 3. Blockers

- Docker/PostgreSQL lane NOT RUN blocks live verification of all four rows; `F-DB-002` waits on the owner.
