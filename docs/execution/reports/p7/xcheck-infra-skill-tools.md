# Cross-Check Recheck Report — xcheck-infra-skill-tools

**Boundary:** Infrastructure database roles ↔ Skill Store executor ↔ tools-side SQL execution
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed/verified IDs on this boundary:** `F-INFRA-002` (FIXED), `F-INFRA-004` (FIXED); carried `F-DB-002` (LATENT), `F-565` (OPEN)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-INFRA-002` | Module roles provisioned consistently with the store's executor and the compose credentials | **FIXED — consistent across all three sources** | `bootstrap-postgres.sh:47-62,70-76` (roles + schema auth + CONNECT revoke), `compose.core.yml:155` (`knowledge_app`), `vector-sync.mjs:337` (`psql -U skill_app`, fails closed without `SKILL_DB_PASSWORD`) |
| `F-INFRA-004` | Driver migration expectations match the shipped set wherever the store migrates | **FIXED — consistent** | All 3 drivers accept `001/002/004/005` (`a9ddced`); `m3-t5-contract` 8/8 (`tests.md:11`) |
| `F-565` | The injected-executor arm lacks the server-side statement timeout the docker-exec arm has | **OPEN — carried** | `vector-sync.mjs:292-293` early return unchanged |
| `F-DB-002` | Backup excludes the decryption key | **LATENT — carried** | Depends_on `F-558` OPEN; untouched |

## 2. Interaction Findings

- **Role seam:** the store-side fail-closed behavior (`SKILL_DB_PASSWORD` required) matches provisioned-db reality; the tools-side SQL executor inherits the module role context implicitly — no credential escalation or role mismatch found at HEAD.
- **Operator provisioning question (fix-plan §9 q1) unchanged:** `-Profile knowledge` not running `bootstrap-postgres.sh` remains an owner decision; no code change in this loop alters it.
- **Timeout seam:** `F-565` stays OPEN — a caller injecting `options.dbExecutor` runs SQL without a database-side deadline; unchanged by the role work.
- Docker/PostgreSQL lane NOT RUN (`tests.md:13`); store suites (`m11-t1-skill-vector-sql` 25/25, `m3-t1+m5` 13/13) remain loop-1 records — flagged for a Phase-8 rerun.

## 3. Blockers

- Owner decision on role provisioning path; Docker lane for live privilege verification.
