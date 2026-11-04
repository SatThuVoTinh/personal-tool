# Phase 1 scan — kb-2

- Mode: Audit
- Scope: `apps/knowledge/` — indexing, embeddings, storage, persistence, migrations
- Target: working tree dispatched at HEAD `85eb094` (pre-existing changes noted by coordinator)
- Status: Complete; source read-only
- Checks: Static source and migration-path review; tests/probes not executed
- Duplicate review: Read the mandatory rules and searched `docs/execution/findings.md`. The closest row is F-431 (migration DDL/ledger transaction boundary); the candidate below is a distinct replay-handling defect, not the concurrent insert race described by F-431.

## Confirmed findings

### CAND-kb-2-01 — replay of an already-applied ALTER migration fails boot when its ledger row is missing

- Path:line: `apps/knowledge/app/database.py:2800-2815`
- Evidence: `_apply_migrations` reexecutes a migration when its filename has no `knowledge.schema_migrations` row (`:2790-2796`). On a PostgreSQL error it delegates recovery to `_migration_is_already_applied` (`:2800-2815`), which only accepts the replay if `_migration_objects` finds created objects and every such object exists (`:2888-2897`). That parser recognizes only `CREATE ...` (`:137-155`). The duplicate SQLSTATE set includes `42701` (`duplicate_column`) (`:127-133`), but both shipped `004_pdf_build_failure_cause.sql:12-15` and `005_schema_migration_digest.sql:17-18` are `ALTER TABLE ... ADD COLUMN` statements, so their object list is empty and replay recovery returns false. A missing ledger row with the column still present therefore aborts migration instead of repairing the ledger.
- Impact: A recoverable database state explicitly contemplated by the runner (ledger row removed/repaired, excluded from a dump, or migration renamed; `database.py:2801-2804`) prevents Knowledgebase startup after an `004` or `005` replay. `start()` maps the exception to `DATABASE_UNAVAILABLE` and starts reconnect attempts (`database.py:483-492`); the retry repeats the same migration and cannot self-heal (`database.py:516-561`). Knowledgebase remains unavailable until manual schema/ledger repair.
- Class: 3 — defect that stops the component from running (conditional on a missing migration ledger row with the migration's column already installed).
- Severity: Medium — a migration-apply crash between DDL commit and ledger insert can leave this state and make subsequent starts fail until repaired.
- Other modules touched: None; the runtime and migration are within Zink Knowledgebase.
- Confidence: High.
- Concrete static reproduction/probe: On a disposable PostgreSQL database, apply migrations through `004` or `005`, then delete only that migration's row from `knowledge.schema_migrations` while retaining its added column. Run the Knowledgebase boot migration path. PostgreSQL reports duplicate column (`42701`); `_migration_objects` returns `[]` for the `ALTER TABLE` file, `_migration_is_already_applied` returns false, and startup records `DATABASE_UNAVAILABLE`. No live database was touched for this audit.
- Register overlap: Related to F-431's migration DDL/ledger boundary, but that row's Knowledgebase note says the duplicate-object heuristic survives the crash gap; this candidate identifies the uncovered `ALTER TABLE` replay shape.

## Hypotheses (not findings)

- `apps/knowledge/contracts/knowledgebase-migration-digests.json:14-15` and `docs/contracts/knowledgebase-migration-digests.json:14-15` list `003_skills_vector_schema.sql`, but that file is absent from the current `apps/knowledge/migrations/` listing. `database.py:2853-2858` deliberately skips ledger rows whose migration file is absent, and manifest validation checks current files against listed digests without requiring every manifest entry to have a file (`:2774-2789`). The listed migration name suggests it may belong to the peer Skill Store; without establishing whether this is a stale historical carrier or a Knowledgebase schema omission, no runtime impact is confirmed and this is not reported as a finding.

## Out-of-scope pointers

- None.
