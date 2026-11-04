# Phase 1 database scan — db-3

- Mode: Audit
- Scope: database definitions under `infrastructure/` and application database access; angle: roles, credentials, network exposure, injection, transactions.
- Baseline: working tree at dispatch, HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; pre-existing diffs were present. No source files changed.
- Nested instructions: no nested `AGENTS.md` found under the repository.
- Checks: static review only; no tests or database operations run.

## Candidates

### CAND-db-3-01 — Knowledge runtime receives the PostgreSQL cluster superuser credential

- Path: `infrastructure/docker/compose/compose.core.yml:151-153`
- Evidence: The PostgreSQL service initializes with `POSTGRES_USER: postgres` (`compose.core.yml:13-16`); the Knowledge service receives that same role and cluster password as `KNOWLEDGE_DATABASE_USER: postgres` and `KNOWLEDGE_DATABASE_PASSWORD: ${POSTGRES_PASSWORD:-unconfigured}` (`:149-153`). Its connection pool uses those configured values for normal runtime database access (`apps/knowledge/app/database.py:453-459`). The runtime also applies schema DDL and migrations through that pool (`apps/knowledge/app/database.py:2757-2768,2790-2819`), and migration 001 creates the `vector` extension (`apps/knowledge/migrations/001_initial.sql:1`). With the PostgreSQL container image's initialized `postgres` superuser, any code execution in the Knowledge process inherits cluster-level database and role administration, including access to the separate `n8n` database; the same role is not limited to the Knowledge schema.
- Impact: A compromise or SQL execution flaw in the Knowledge process can use the in-process database credential to read or alter n8n data and perform cluster-wide database/role changes, expanding a Knowledge service compromise across database tenants.
- Severity: Medium.
- Class: 1 — security flaw.
- Other modules touched: Zink Knowledgebase; n8n automation database.
- Confidence: high.
- Reproduction: Static trace of Compose environment → `asyncpg.create_pool` arguments → migration DDL on the same connection. No live database probe was run. A disposable deployment would confirm the role with `SELECT current_user, rolsuper FROM pg_roles WHERE rolname = current_user;` from the Knowledge connection.

## Reviewed without a new candidate

- Knowledge SQL reads and writes use asyncpg positional parameters for external values; the only f-string SQL sites inspected interpolate a fixed query predicate, not user-supplied SQL. No injection candidate had concrete evidence.
- The Knowledge migration DDL/ledger commit split overlaps existing finding F-431 (`docs/execution/findings.md:889-900`); not duplicated here.
- Skill Store SQL literal/transaction handling was reviewed within the database access angle. Existing findings F-431 and F-565 cover the observed migration-ledger and executor-timeout mechanisms (`docs/execution/findings.md:889-900,1864-1874`); no distinct new candidate identified.
- Database services have no host-published port in `compose.core.yml`; PostgreSQL is attached to the Compose `platform` bridge (`:17-18,31-32`). No additional network-exposure candidate identified.

## Out-of-scope pointers

None identified.

## Counts

- Critical: 0
- High: 0
- Medium: 1
- Low: 0
- Candidates: 1
- Blockers: none
