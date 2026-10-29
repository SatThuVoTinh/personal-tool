# Phase 6 Recheck Report: scan-infra-2

**Scope:** Infrastructure env/secrets templates, backup/restore and runbook truth
**Finding IDs evaluated:** F-INFRA-004, F-DB-002
**Test execution source:** `docs/execution/reports/p6/tests.md` (Lead-provided test report)

---

## 1. Recheck Outcomes

### F-INFRA-004 — Knowledge M3/T5 acceptance drivers reject the currently shipped migration set
- **Status:** **PARTIAL**
- **Evidence:**
  - `infrastructure/docker/scripts/knowledge-t5-common.ps1:355`: Updated `$expected` migration array to `@("001_initial.sql", "002_pdf_ingestion_foundation.sql", "004_pdf_build_failure_cause.sql", "005_schema_migration_digest.sql")`.
  - `infrastructure/docker/scripts/knowledge-t5-live.ps1:474`: Updated `$ledgerAfterStart` expected string to `"001_initial.sql\n002_pdf_ingestion_foundation.sql\n004_pdf_build_failure_cause.sql\n005_schema_migration_digest.sql"`.
  - **UNFIXED SECTIONS:**
    - `infrastructure/docker/scripts/knowledge-t5.ps1:178`: Still hardcodes `if (($ledgerBefore -join "\n") -cne "001_initial.sql\n002_pdf_ingestion_foundation.sql") { throw "Knowledge migration ledger is invalid." }`.
    - `infrastructure/docker/scripts/knowledge-t5.ps1:244`: Still hardcodes `if (($ledgerAfter -join "\n") -cne "001_initial.sql\n002_pdf_ingestion_foundation.sql") { throw "Migration was reapplied after restart." }`.
- **Impact:** Running `knowledge-t5.ps1` against the current runtime migration set (`001`, `002`, `004`, `005`) fails at lines 178 and 244 because the database ledger contains all 4 migrations.
- **New Defects Introduced:** None.

### F-DB-002 — The n8n backup excludes the encryption key required to decrypt backed-up credentials
- **Status:** **FIXED**
- **Evidence:**
  - `infrastructure/docker/scripts/backup.ps1:150-181`: Updated backup script to inspect `N8N_ENCRYPTION_KEY` from the environment file, verify key presence, compute SHA-256 digest (`Get-Sha256String`), and record `n8n_encryption_key_reference` (`key_present`, `key_sha256`, `recovery_note`) in `manifest.json`.
  - `docs/runbooks/knowledge-platform.md:65`: Confirms manual restore protocol relies on `manifest.json`'s `key_sha256` reference.
- **New Defects Introduced:** None.

---

## 2. Test Gate Citations

Per Phase 6 rules, test status is cited directly from `docs/execution/reports/p6/tests.md`:
- **Knowledgebase (`test:knowledge`):** PASS (311 passed, 18 skipped)
- **Repository Policy (`repository-policy.mjs`):** PASS (1 suite passed)
- **PostgreSQL / Docker real-database lane:** NOT RUN (Container daemon not provisioned)
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows host environment)

---

## 3. Summary

| Finding ID | Status | Severity | Modules Touched |
| --- | --- | --- | --- |
| F-INFRA-004 | PARTIAL | Medium | `infrastructure/docker/scripts/` |
| F-DB-002 | FIXED | Medium | `infrastructure/docker/scripts/` |
