# Infrastructure Audit Recheck Report (infra-1)

**Slice ID:** infra-1
**Phase:** Phase 6 recheck mode
**Date:** 2026-10-29
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 63ddf40
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-INFRA-001** | Internal bridge egress bypass | **LATENT** | `infrastructure/docker/compose/compose.core.yml:228`, `infrastructure/networking/networks.yml:26` |
| **F-INFRA-002** | PostgreSQL cluster admin role | **FIXED** | `infrastructure/docker/scripts/bootstrap-postgres.sh:48,51,61,62`, `compose.core.yml:155`, `zink-skill-store/src/vector-sync.mjs:337` (commit `7570f73`) |
| **F-INFRA-003** | Normal start hardening overlay | **LATENT** | `infrastructure/docker/compose/compose.knowledge.hardening.yml:1-10`, `infrastructure/docker/scripts/start.ps1:19,47-49` |
| **F-INFRA-004** | T5 driver migration expectations | **FIXED** | `infrastructure/docker/scripts/knowledge-t5.ps1:178,244`, `knowledge-t5-live.ps1:451,474`, `knowledge-t5-common.ps1:355` |

---

## 2. Detailed Findings Recheck

### F-INFRA-001 — Deployed Knowledge container bridge egress bypass
- **Verdict:** LATENT (Static configuration applied; live egress probe NOT RUN)
- **Evidence:** `infrastructure/docker/compose/compose.core.yml:228` and `infrastructure/networking/networks.yml:26` enforce `internal: true` for the `platform` network.
- **Test Evidence:** Static Node suite `agent-infra-F-INFRA-001-egress` (4/4 passed) per `docs/execution/reports/p6/tests.md:11`. Docker/live container egress probe is `NOT RUN` (Docker daemon not provisioned on Windows test runner per `docs/execution/reports/p6/tests.md:13`).

### F-INFRA-002 — Knowledge service uses PostgreSQL cluster administrator
- **Verdict:** FIXED
- **Evidence:** Committed in `7570f73`. `bootstrap-postgres.sh:48,51,61,62` creates restricted `knowledge_app` and `skill_app` roles (`NOSUPERUSER NOCREATEDB NOCREATEROLE`), sets schema authorization for `knowledge` and `skills` (`:73-76`), and revokes `CONNECT` on database `n8n` from `PUBLIC` (`:70`). `compose.core.yml:155` sets `KNOWLEDGE_DATABASE_USER: knowledge_app`. `zink-skill-store/src/vector-sync.mjs:337` invokes `psql -U skill_app`.
- **Test Evidence:** Node test suites `m11-t1-skill-vector-sql` (25/25) and `m3-t1-contract` + `m5-docker-contract` (13/13) pass. Docker live PostgreSQL privilege check is `NOT RUN` per `docs/execution/reports/p6/tests.md:13`.

### F-INFRA-003 — Normal Knowledge deployment omits live-overlay hardening
- **Verdict:** LATENT (Undispatched pending owner memo)
- **Evidence:** `infrastructure/docker/compose/compose.knowledge.hardening.yml:1-10` exists declaring the 5 hardening controls (`read_only`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit: 256`, `/tmp` tmpfs). `infrastructure/docker/scripts/start.ps1:19,47-49` conditionally appends the file if present.
- **Assessment:** Per `docs/execution/context.md:5,144,210`, F-INFRA-003 was classified as RED (deployment security boundary) and was not dispatched for execution pending an owner decision memo.

### F-INFRA-004 — Knowledge M3/T5 acceptance drivers reject currently shipped migration set
- **Verdict:** FIXED
- **Evidence:** Updated in Phase 5 Loop 1. `infrastructure/docker/scripts/knowledge-t5.ps1:178,244`, `knowledge-t5-live.ps1:451,474`, and `knowledge-t5-common.ps1:355` accept the full shipped migration set `[001_initial.sql, 002_pdf_ingestion_foundation.sql, 004_pdf_build_failure_cause.sql, 005_schema_migration_digest.sql]`.
- **Test Evidence:** `m3-t5-contract` suite (8/8 passed) per `docs/execution/reports/p6/tests.md:11`. PowerShell scripts parse clean (`parse_errors=0`).

---

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** None (Live Docker and PostgreSQL container probes are `NOT RUN` due to environment constraints recorded in `docs/execution/reports/p6/tests.md:13`).
