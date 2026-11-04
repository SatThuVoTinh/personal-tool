# Phase 2 cross-check — Database <-> all modules

- **Mode:** Audit
- **Scope:** Database schema ownership, access identities and writers, and backup/recovery coverage across Knowledgebase, Skill Store, Tools, infrastructure, and the n8n hosting boundary.
- **Baseline:** Target HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; the dispatch context records pre-existing dirty changes (`docs/execution/context.md:5,19`). This review used the checked-out files and Phase 1 reports; shell/git status was permission-denied, so no independent status or diff verification was possible.
- **Method:** Read-only static review. No database, Docker, test, backup, restore, secret, or live-host operation was run. No source or findings/context file was modified.
- **Cross-check counts:** Critical 0; High 1; Medium 3; Low 0; blockers 1 (runtime privilege and recovery consequences were not probed). The four existing IDs are distinct defects. The additional Skill Store access site broadens F-INFRA-002 and is not counted as a fifth root cause.

## Cross-check verdicts

### F-INFRA-002 — shared PostgreSQL superuser access; scope is incomplete

- **Category:** F2 — Security & Authorization
- **Legacy register ID:** —
- **Affected modules:** Infrastructure, Zink Knowledgebase, Zink Skill Store; n8n automation database is a collateral tenant. Zink Tools consumes Skill Store APIs but does not directly own or write this PostgreSQL state.
- **Severity:** High (as registered)
- **Status:** Static access path confirmed; privilege impact not live-probed; pending Phase 3 triage.
- **Root cause:** The PostgreSQL cluster administrator is used as a routine identity by both Knowledge and Skill Store database clients. The existing F-INFRA-002 describes the Knowledge Compose credential but omits Skill Store's separate `psql` caller path. Both paths can cross the logical schema boundary if compromised; this is one shared privilege-boundary cause with two client sites, not evidence that the modules share schema ownership.
- **Evidence:** `infrastructure/docker/compose/compose.core.yml:13-18` initializes the `postgres` database/user and persistent cluster volume; `:149-153` gives the Knowledge process the same `postgres` identity; `apps/knowledge/app/database.py:453-464,2765-2769` uses that identity for its runtime pool and creates its own `knowledge` schema/ledger. The dedicated n8n identity is configured separately at `compose.core.yml:65-72` and bootstrapped at `infrastructure/docker/scripts/bootstrap-postgres.sh:28-42`. Independently, `zink-skill-store/src/vector-sync.mjs:307-335` invokes Docker with `psql -U postgres -d postgres`, and `zink-skill-store/src/migrations.mjs:75-92,205` creates/uses `skills.schema_migrations` and `skills.*` through that executor. The database service is attached to the Compose `platform` network at `compose.core.yml:31-32`; this is not a published host port, but does not constrain privileges inside PostgreSQL. Architecture requires isolated Skill Store and Knowledge ownership (`AGENTS.md:251-270`; `docs/architecture/platform-boundaries.md:5-23`).
- **Reproduction:** Static trace only. The Phase 1 scanner proposed querying `current_user`/`rolsuper` through the Knowledge connection but did not run it (`docs/execution/reports/p1/scan-db-3.md:11-20`). The Skill Store client arguments are explicit in source; no runtime role query was executed.
- **Acceptance criteria:** Routine Knowledge and Skill Store access is constrained to each owner's required objects and migration capabilities; the Knowledge runtime cannot administer the cluster or read/write n8n or Skill Store data, and Skill Store writes/migrations cannot mutate Knowledge or n8n state. Preserve separate `knowledge.*` and `skills.*` ledgers/schema ownership and the separately owned n8n database.
- **Fix blast radius:** `compose.core.yml:149-153` / bootstrap and role-grant changes affect Knowledge pool startup and Knowledge DDL migrations (`apps/knowledge/app/database.py:453-464,2765-2819`) and Skill Store deployment/sync (`zink-skill-store/src/vector-sync.mjs:307-335`; migrations at `zink-skill-store/src/migrations.mjs:75-92,205-265`). A change at the Skill Store executor affects the Skill Store sync/migration path and its OpenClaw host caller (`integrations/openclaw/plugins/zink-governance/index.mjs:1165-1182`), plus the derived vectors consumed through Tools; it should not transfer Knowledge schema ownership to Skill Store. Keep n8n's dedicated login/database behavior at `compose.core.yml:65-72` intact. Role/migration semantics cross security and schema-ownership boundaries and require coordinated verification across these callers.
- **Related evidence:** `docs/execution/reports/p1/scan-db-3.md:11-20` covers the Knowledge client; `docs/execution/reports/p1/scan-skill-3.md:13-18,24-27` confirms Skill Store's separate `skills.*` schema and routes the Knowledge superuser access question here.

### F-DB-001 — Knowledge recovery verifier omits segment row data

- **Category:** F5 — Data Integrity & Result Correctness
- **Legacy register ID:** —
- **Affected modules:** Infrastructure recovery tooling, Zink Knowledgebase.
- **Severity:** Medium (as registered)
- **Status:** Static verifier defect confirmed; archive fault injection was not run; pending Phase 3 triage.
- **Root cause:** The Knowledge recovery driver accepts a table definition as satisfying required table presence, then excludes `segments` from the data digest used to compare the restored archive.
- **Evidence:** `infrastructure/docker/scripts/knowledge-t5-live.ps1:288-289` accepts either `TABLE` or `TABLE DATA` for `segments`. `$criticalTables` at `:330-332` excludes `segments`; the restored digest comparison at `:362-364` compares only that list, before the driver writes `restore_verified = $true` at `:394-396`. The finding and Phase 1 scan record the concrete missing-table-data scenario (`docs/execution/findings.md:2241-2252`; `docs/execution/reports/p1/scan-db-2.md:14-24`).
- **Reproduction:** Static trace only; scan-db-2's suggested custom archive excluding only `knowledge.segments` data was not produced or restored (`docs/execution/reports/p1/scan-db-2.md:17-19`).
- **Acceptance criteria:** Restore verification must fail when segment table data is missing and prove the expected retrieval-critical segment state survives restoration.
- **Fix blast radius:** Changes to `knowledge-t5-live.ps1:288-289,330-364` affect the Knowledge schema recovery gate and its archive evidence. Keep this recovery drill schema-scoped to Knowledge; it should not imply Skill Store recovery or mutate/verify `skills.*` as Knowledge-owned state. The generic full-database backup is a separate path (`backup.ps1:12,101-110`).
- **Relationship:** Independent from F-DB-002 and F-558: this is a false-positive verification gap for segment data in a Knowledge-only archive, rather than external key retention or generic archive inventory validation.

### F-DB-002 — n8n encryption key is external to the archived database/home data

- **Category:** F5 — Data Integrity & Result Correctness
- **Legacy register ID:** —
- **Affected modules:** Infrastructure backup and the n8n workflow runtime at the OpenClaw/n8n hosting boundary; n8n is not a fourth logical repository module.
- **Severity:** Medium (as registered)
- **Status:** Archive omission confirmed; unrecoverability is conditional on loss of external key configuration, which this repository does not establish; pending Phase 3 triage.
- **Root cause:** The backup archives the n8n database and home directory while excluding `config`, and does not record a secure recovery reference for the externally configured encryption key.
- **Evidence:** `infrastructure/docker/scripts/backup.ps1:113-127` excludes `/home/node/.n8n/config`; its manifest covers generated archive files at `:138-158`. The n8n runtime reads `N8N_ENCRYPTION_KEY` from environment at `infrastructure/docker/compose/compose.core.yml:80`, and `README.md:444-448` instructs operators to set it in the environment file. The register records that operator key retention elsewhere is unverified (`docs/execution/findings.md:2254-2264`); scan-db-2 proposes a wrong-key restore but did not execute it (`docs/execution/reports/p1/scan-db-2.md:26-36`).
- **Reproduction:** Not run. It depends on restoring encrypted credential rows without the matching key.
- **Acceptance criteria:** Securely preserve the matching key or identify its recovery location without disclosing key material in backup output, and demonstrate restored credentials remain usable with that key.
- **Fix blast radius:** Changes to `backup.ps1:113-158`, its manifest, or the backup runbook affect infrastructure backup handling and n8n recovery. Preserve secret-exclusion guarantees; this fix does not require changes to Knowledge or Skill Store schema/writers.
- **Relationship:** Distinct from F-DB-001 (different archive and consumer) and F-558 (`docs/execution/findings.md:1773-1784`, which concerns empty/unreadable inventories and false inspection certification). Shared theme is recovery evidence/coverage only; no common technical root is evidenced.

### F-KB-002 — ALTER migration replay is not recognized as already applied

- **Category:** F3 — State & Lifecycle Integrity
- **Legacy register ID:** —
- **Affected modules:** Zink Knowledgebase.
- **Severity:** Medium (as registered)
- **Status:** Static migration path confirmed; PostgreSQL replay reproduction was not run; pending Phase 3 triage.
- **Root cause:** Knowledge replay recovery extracts only `CREATE` objects. Shipped ALTER ADD COLUMN migrations 004/005 yield an empty parsed-object set, which the recovery helper refuses to treat as already applied.
- **Evidence:** `apps/knowledge/app/database.py:2790-2819` replays migrations with no ledger row and invokes `_migration_is_already_applied` on PostgreSQL errors. The parser recognizes `CREATE` forms at `:137-155`; the helper rejects an empty object set at `:2888-2897`. `apps/knowledge/migrations/004_pdf_build_failure_cause.sql:12-15` and `005_schema_migration_digest.sql:17-18` are `ALTER TABLE ... ADD COLUMN`. These source locations and the expected duplicate-column/startup failure are also cited in `docs/execution/findings.md:2072-2083` and `docs/execution/reports/p1/scan-kb-2.md:14-21`.
- **Reproduction:** Suggested disposable-PostgreSQL probe—apply migration 004/005, remove only its ledger row, retain the column, and restart—was not run (`docs/execution/reports/p1/scan-kb-2.md:21`).
- **Acceptance criteria:** Recovery recognizes a fully applied ALTER migration and repairs its ledger while refusing a partial schema.
- **Fix blast radius:** The defect location is the Knowledge runner and its migrations. A targeted fix changes Knowledge startup and `knowledge.schema_migrations`; do not reuse it to read/write `skills.schema_migrations` or move Skill Store DDL into the Knowledge runner. Skill Store has a distinct runner and ledger (`zink-skill-store/src/migrations.mjs:68-92,191-265`).
- **Relationship:** Independent of F-INFRA-002's authorization boundary and the two backup/recovery defects. F-431 is adjacent migration DDL/ledger atomicity, but does not describe this specific CREATE-only replay parser (`docs/execution/findings.md:889-900`).

## Module ownership, writer, and backup matrix

| State/schema | Owner and writer evidence | Backup/recovery coverage and boundary result |
| --- | --- | --- |
| `knowledge.*` | Knowledge runner creates `knowledge.schema_migrations` and applies its own migration set (`apps/knowledge/app/database.py:2765-2819`). Knowledge owns ingestion/index/retrieval state (`docs/architecture/platform-boundaries.md:3-7`). | Generic backup defaults to `n8n` and full `postgres` DB (`infrastructure/docker/scripts/backup.ps1:7-13,101-110`), so the dump includes the database containing Knowledge and Skill Store schemas. The T5 recovery gate is scoped to `knowledge` (`knowledge-t5-live.ps1:284,296-299`) and has the F-DB-001 verification hole. Runbook says ordinary restore automation is not implemented (`docs/runbooks/knowledge-platform.md:51-65`).
| `skills.*` derived vectors | Skill Store alone owns `skills.schema_migrations` and its migration runner (`zink-skill-store/src/migrations.mjs:68-92,191-265`); sync writes `skills.catalog_index` and `skills.segments` (`zink-skill-store/src/vector-sync.mjs:622-667`). Canonical lifecycle is Git-native; PostgreSQL vectors are derived (`docs/architecture/system-overview.md:23-27`; `zink-skill-store/README.md:128-143`). | Full `postgres` dump includes derived Skill Store rows (`backup.ps1:12,101-110`; confirmed by `scan-skill-3.md:15-18`). No Skill Store-specific pg dump/restore was found in its scanner (`scan-skill-3.md:15-22`). No concrete loss of canonical Git state or omission from the full database dump was established. The Knowledge-only T5 drill is not a Skill Store restore claim.
| Skill Store canonical `skills/` files/manifests | Skill Store's Git-native catalog is the canonical lifecycle state; promotion materializes `SKILL.md` and `manifest.json` before vector sync (`zink-skill-store/README.md:128-143`; `docs/architecture/system-overview.md:23-27`). | Not included in PostgreSQL archives by design because they are canonical Git state. No evidence in this audit proves the repository's Git backup/remote recovery contract absent or broken, so no finding is raised for this state.
| n8n database/home/credentials | n8n connects as its dedicated `n8n` login/database (`compose.core.yml:65-72`; bootstrap at `bootstrap-postgres.sh:28-42`). | Database and home archive exist, but encryption key is externally configured and omitted from archives: F-DB-002. This affects the hosting workflow runtime, not module-owned Knowledge/Skill persistence.
| Zink Tools | SQL adapter currently reports contract-fixture execution in an ephemeral in-memory DuckDB (`zink-tools/sql/duckdb-bridge.mjs:458-469,551-584`); architecture says Tools owns no persistent Knowledge/Skill internals (`platform-boundaries.md:14-23`). | No live Tools-owned PostgreSQL state or backup omission was evidenced. Tools must continue using approved module APIs and must not acquire direct write ownership of either schema.

## Shared-cause and independence assessment

- **Privilege/access:** F-INFRA-002 is a shared database privilege-boundary cause. Knowledge receives the cluster `postgres` credential via Compose, and Skill Store independently invokes `psql` as `postgres`. Both module runners maintain their own schema/ledger, so current writer ownership is logically separated in code but not enforced by PostgreSQL role rights. Widen F-INFRA-002's affected surface/evidence to the Skill Store caller; do not duplicate it as an unrelated privilege root cause. Fixes must coordinate both module callers and preserve schema ownership.
- **Recovery:** F-DB-001 and F-DB-002 are independent defects. One is a Knowledge archive verifier that does not compare segment rows; the other is n8n encryption-key recovery material absent from generic backups. They share only the broad recovery domain, not a technical mechanism.
- **Knowledge migration replay:** F-KB-002 is an independent Knowledge startup/recovery defect, not caused by the shared superuser identity or backup coverage. F-431 is nearby but covers a separate transaction/ledger atomicity window.
- **Skill Store recovery:** Existing evidence indicates its canonical Git state and derived `skills.*` database state have distinct owners, and the generic full `postgres` dump contains the latter. No independent Skill Store backup data-loss finding is supported. The database privilege flaw is nevertheless an isolation violation because the other module's runtime credential can access the schema.
- **Unverified behavior:** No live role privilege probe, cross-schema write/read, archive fault injection, wrong-key restore, or real PostgreSQL migration replay was run. Treat runtime consequences as unverified until triage/follow-up executes the corresponding disposable-environment checks.
