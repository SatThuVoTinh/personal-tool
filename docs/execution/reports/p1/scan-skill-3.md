# Phase 1 audit — scan-skill-3

- **Scope:** `zink-skill-store/`; isolation from Knowledgebase indexes and backup/restore of Skill Store state.
- **Baseline:** dispatched against HEAD `85eb094` and the pre-existing dirty working tree recorded in `docs/execution/context.md:19`.
- **Result:** no confirmed in-scope findings; no hypotheses retained; no blockers. No tests or runtime probes were run.

## Confirmed findings

None.

## Isolation and backup evidence

- The module-specific runner declares and creates only `skills.schema_migrations`; it explicitly does not read or write `knowledge.schema_migrations` (`zink-skill-store/src/migrations.mjs:68-92`).
- The Skill Store migration file creates `skills.catalog_index` and `skills.segments`, with no Knowledgebase table operations (`zink-skill-store/migrations/003_skills_vector_schema.sql:5-39`). The sole other in-scope `knowledge.*` references found are explanatory comments (`zink-skill-store/README.md:401-404`, `zink-skill-store/src/migrations.mjs:71-74`, and the migration header at `zink-skill-store/migrations/003_skills_vector_schema.sql:1-3`).
- Vector writes, tombstones and retention deletes target `skills.*` (`zink-skill-store/src/vector-sync.mjs:622-667`, `:800-815`, and `:1024-1033`). A targeted search of `zink-skill-store/` found no `pg_dump`, `pg_restore`, or backup/restore implementation.
- Canonical skill lifecycle is stored in the Skill Store's filesystem catalog; the README describes materializing `SKILL.md` plus `manifest.json` before syncing a derived PostgreSQL vector index (`zink-skill-store/README.md:128-143`). Its documented migration runner applies the module's own schema (`zink-skill-store/README.md:399-417`).
- The general infrastructure backup defaults to dumping the full `postgres` database, so that dump includes the `skills` schema as well as `knowledge` (`infrastructure/docker/scripts/backup.ps1:12`, `:101-110`). The separate Knowledge recovery drill explicitly scopes its dump and verification to `knowledge`; this is a Knowledge recovery-point procedure, not evidence that the general database backup omits Skill Store rows (`infrastructure/docker/scripts/knowledge-t5-live.ps1:284`, `:298-299`, `:354-364`).
- The tracked Knowledge runbook says restore automation is not implemented in the current runtime contract (`docs/runbooks/knowledge-platform.md:65`). I found no in-scope Skill Store recovery command; available evidence does not establish that this causes Skill Store data loss because canonical skills are filesystem state and the general database backup includes the derived `skills` schema.

## Hypotheses

None. No concrete in-scope isolation or Skill Store backup/restore defect was established from the inspected code and documented paths.

## Out-of-scope pointers

- `infrastructure/docker/compose/compose.core.yml:148-153` — Knowledgebase is configured with the shared `postgres` database account; route to database/infrastructure reviewers to assess whether this privilege defeats schema-level isolation from `skills.*`.
- `apps/knowledge/app/config.py:40-45` — Knowledgebase defaults its database user to `postgres`; same privilege-boundary question, outside this slice.

## Checks

Read-only source and documentation inspection only. No tests run and no source or shared files modified.
