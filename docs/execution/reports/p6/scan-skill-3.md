# Recheck Report — skill-3 (Skill Store isolation and backup/restore)

- **Slice:** skill-3 (`zink-skill-store/`)
- **Area:** Skill Store isolation from Knowledgebase indexes and state backup/restore
- **Mode:** Recheck (Phase 6)
- **Rechecked Findings:** `F-INFRA-002` (skill portion)

## Status Summary

| Finding ID | Title | Status | Severity | Category |
| --- | --- | --- | --- | --- |
| F-INFRA-002 (skill portion) | Shared PostgreSQL administrator identity reaches Skill Store executor | FIXED | High | F2 |

---

## Detailed Recheck Results

### F-INFRA-002 (skill portion) — Shared PostgreSQL administrator identity reaches Skill Store executor

- **Status:** FIXED
- **Category:** F2 — Security & Authorization
- **Severity:** High
- **Affected Modules:** Zink Skill Store (`zink-skill-store/src/vector-sync.mjs`), Infrastructure (`infrastructure/docker/scripts/bootstrap-postgres.sh`)
- **Evidence:**
  - `zink-skill-store/src/vector-sync.mjs:319-323`: `executePostgresQuery` checks `process.env.SKILL_DB_PASSWORD` and throws `SKILL_DB_PASSWORD_REQUIRED: PostgreSQL access requires the Skill Store database credential.` when absent.
  - `zink-skill-store/src/vector-sync.mjs:337`: Docker `psql` invocation passes `-U skill_app` instead of superuser `-U postgres`.
  - `zink-skill-store/src/vector-sync.mjs:346`: `PGPASSWORD` is injected in child process env via `process.env.SKILL_DB_PASSWORD`.
  - `infrastructure/docker/scripts/bootstrap-postgres.sh:6,12-15`: Requires non-empty, non-`unconfigured` `SKILL_DB_PASSWORD` at database bootstrap.
  - `infrastructure/docker/scripts/bootstrap-postgres.sh:50-52,62`: Provisions dedicated `skill_app` role with `NOSUPERUSER NOCREATEDB NOCREATEROLE`.
  - `infrastructure/docker/scripts/bootstrap-postgres.sh:69,74,76,80-114`: Restricts `skill_app` database access to `postgres` DB, assigns schema/object ownership of `skills.*` to `skill_app`, and isolates from `n8n` and `knowledge` schemas.
- **Reason Fixed:** Skill Store database client no longer defaults to or uses the `postgres` superuser account. It uses the dedicated `skill_app` non-superuser login and fails closed if `SKILL_DB_PASSWORD` is omitted.

### New Defects Introduced

- **New Defects:** None. Code inspection of `zink-skill-store/` confirms vector queries, migrations, and lock recovery operate as intended without side effects.

---

## Test Gate Citation

Per lead test report `docs/execution/reports/p6/tests.md`:
- **Affected Node tests (`m11-t1-skill-vector-sql`, `m3-t1-contract`, `m5-docker-contract`):** PASS (All affected test suites passed 100% green)
- **Knowledgebase tests (`test:knowledge`):** PASS (311 passed, 18 skipped, 31 subtests passed in 54.67s; `uv run --directory apps/knowledge --locked python -m pytest tests -q`)
- **Repository policy (`repository-policy.mjs`):** PASS (1 suite, 1 test passed in 3.15s)
- **Repository check (`repo:check`):** FAIL (Diagnostic failures: trailing whitespace in 7 files; status vocabulary in findings.md; package.json missing 2 new test files)
- **PostgreSQL / Docker real-database lane:** NOT RUN (Requires live container daemon and active PostgreSQL instance not provisioned on this host)
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows host environment)

---

## Summary Counts

- **Total Rechecked:** 1
- **FIXED:** 1 (`F-INFRA-002` skill portion)
- **PARTIAL:** 0
- **NOT FIXED:** 0
- **NEW DEFECTS:** 0
- **Blockers:** 0
