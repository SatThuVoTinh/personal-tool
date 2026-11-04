# Phase 1 database scan — db-1

- Mode: Audit
- Scope: database definitions under `infrastructure/`; angle: schema, migrations, init scripts.
- Baseline: working tree at dispatch, HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; pre-existing repository diffs were present. `infrastructure/` had no reported working-tree changes at inspection.
- Nested instructions: no nested `AGENTS.md` found under the repository.
- Checks: static inspection only; no tests, Docker commands, or database operations run.
- Counts: Critical 0; High 0; Medium 0; Low 0; new candidates 0; blockers none.

## Investigation

Inspected PostgreSQL and bootstrap definitions in `infrastructure/docker/compose/compose.core.yml:9-55` and `infrastructure/docker/scripts/bootstrap-postgres.sh:1-44`, plus the Knowledge, acceptance, and live recovery Compose overlays. PostgreSQL uses the pinned pgvector image and a persistent `postgres-data` volume; no host port is published. The bootstrap script creates the `vector` extension in the `postgres` database, provisions the `n8n` login with a password read by psql from a mode-0600 temporary file, and creates the `n8n` database if absent. The Knowledge profile does not depend on that n8n bootstrap service; Knowledge schema and extension migrations are applied by its application runner.

No new class 1–4 defect in the in-scope schema or initialization definitions was supported by concrete evidence. The potentially material adjacent observations below are already identified or outside this slice and are not counted as candidates.

## Existing findings / duplicate check

- F-431 (`docs/execution/findings.md:889-900`) already records the Knowledge migration DDL commit and separate migration-ledger insert mechanism. Its application runner location, `apps/knowledge/app/database.py:2797-2819`, is outside this scanner's infrastructure-only database-definition scope; no duplicate candidate filed.
- The Knowledge runtime's use of the PostgreSQL superuser credential at `infrastructure/docker/compose/compose.core.yml:149-153` is reported by the parallel db-3 scanner under its roles/credentials angle; not duplicated here.

## Out-of-scope pointers

- `apps/knowledge/app/database.py:2797-2819` — migration DDL transaction and subsequent ledger insert, already tracked by F-431.

## Blockers

None.
