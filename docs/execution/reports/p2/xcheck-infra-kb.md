# Phase 2 cross-check — Infrastructure <-> Knowledgebase

- **Mode:** Audit
- **Target:** Working tree at HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; pre-existing changes are the dispatch baseline recorded in `docs/execution/context.md`.
- **Boundary:** Infrastructure runtime configuration and recovery <-> the accepted `apps/knowledge/` runtime, its PostgreSQL-owned `knowledge` schema, and its health/API contracts.
- **Instructions:** Root `AGENTS.md` was read; `glob **/AGENTS.md` found no nested file. Read coordination context/slices, findings rules, architecture boundaries, Phase 1 infra/KB reports and `scan-db-3`.
- **Checks:** Static source/report cross-check only. No tests, Docker commands, database probes, live network probes, or secret-file reads were performed. No source/register/context files were changed.
- **Summary:** 2 existing infrastructure candidates confirmed with qualifications; 1 existing KB startup candidate confirmed at the Infrastructure health/start seam; 1 existing recovery candidate confirmed as a restore-gate coverage gap; 2 new Infrastructure/Knowledge candidates; 3 other KB candidates verified as module-local or routed to a different boundary. No evidence of a defect in configured ports, memory limits, read-only Vault mount, or declared database health dependency.

## Cross-check dispositions

| Candidate | Verdict | Cross-boundary result |
| --- | --- | --- |
| `F-INFRA-001` | Confirmed configuration boundary gap; runtime reachability not probed | Compose `platform` is a non-internal bridge. The Nginx exact-route allowlist does not prevent Knowledge from opening direct outbound connections. Default Docker bridge egress is the assumption; host firewall/daemon policy can change observed reachability. |
| `F-INFRA-002` | Confirmed; duplicate root across `scan-infra-2` and `scan-db-3` | Same `postgres` superuser/password is passed to the Knowledge runtime pool, which performs ordinary queries and schema DDL. This exposes the separate n8n database and cluster administration. Use one consolidated root; `scan-db-3`'s Medium severity conflicts with the other report and the register's High. |
| `F-KB-001` | Static mechanism confirmed; not an Infrastructure defect | Oversized-sidecar omission can enter the KB stale-source deletion path. Fix ownership is Knowledge ingestion/index publication; infrastructure volume/network configuration is unaffected. |
| `F-KB-002` | Static mechanism confirmed; startup/health crosses the boundary | ALTER replay with a missing ledger row can fail Knowledge migration startup. Infrastructure's `--wait`/healthcheck then sees the KB service unhealthy; the defect and fix site remain KB migration recovery. |
| `F-KB-003` | Conditional mechanism confirmed; module-local | NFC path-key collision depends on a filesystem preserving both names. The Vault bind is read-only; this does not implicate Infrastructure ownership or require a volume change. |
| `F-KB-004` | Serializer omission confirmed; different boundary | KB chunk/citation serializers omit fields present in `SegmentRecord`. Potential consumer effect is Knowledgebase <-> Tools; route to `xcheck-kb-tools`, not an Infrastructure finding. |
| `F-DB-001` | Restore-verification gap confirmed statically; archive-mutation probe not run | The live Knowledge recovery verifier checks `segments` table presence but excludes segment data from its content digest. This is an Infrastructure recovery guarantee for Knowledge-owned persistent state. |
| `F-DB-002` | Not assessed as a KB boundary candidate | Its cited state is n8n credentials/encryption, outside the Infrastructure <-> Knowledgebase boundary. |
| `F-INFRA-004` | Confirmed stale Infrastructure live-acceptance migration contract | The accepted Knowledge image carries migrations 004/005, but the isolated and live infrastructure drivers require exactly 001/002; the current T5 candidate is rejected before its runtime checks begin. |

## Findings (register format)

### F-INFRA-001 — deployed Knowledge can bypass the model gateway through bridge egress

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Infrastructure, Zink Knowledgebase; Nginx model gateway is the affected infrastructure peer
- Severity: Medium
- Status: CONFIRMED CONFIGURATION GAP — exact network controls are absent in the deployed Compose definition; direct egress was not probed and host policy may restrict it.
- Root cause: Knowledge and Nginx share `platform`, declared as a normal `bridge` network. The configured Nginx URL allowlist constrains calls made through Nginx only; it does not constrain direct sockets from Knowledge.
- Evidence: `infrastructure/docker/compose/compose.core.yml:157-165,182-183,216-222` sets the gateway URL, maps `host.docker.internal` into Knowledge, and puts Knowledge on `platform`, whose only driver setting is `bridge`. `infrastructure/nginx/conf.d/default.conf:29-47` permits only exact `tags`/`embed` paths through that proxy. By contrast, `infrastructure/docker/compose/compose.m3-t5.acceptance.yml:18-20,52-63` makes the KB network internal and gives Nginx a separate egress network; `infrastructure/docker/scripts/knowledge-t5-common.ps1:591-609` probes external TCP/DNS there. The operational check at `infrastructure/docker/scripts/knowledge-t5-live.ps1:467-472` checks the gateway route and refused proxy paths but does not run the direct TCP/DNS checks. Docker bridge egress is a default assumption, not a host measurement.
- Reproduction: In a disposable deployment with standard Docker bridge masquerading and no blocking host firewall, attempt direct TCP and DNS from the Knowledge container to external destinations, then compare with the same destinations through the Nginx URL. Not run.
- Acceptance criteria: The deployed Knowledge workload cannot make unapproved direct network connections, and the deployed-stack probe checks direct TCP/DNS as well as the exact model gateway paths.
- Related findings: `F-520` and `F-569` concern Compose policy parsing/comparison and do not enforce runtime egress. A blanket `internal: true` on the shared `platform` would also affect n8n and prevent Nginx reaching host Ollama; preserve n8n egress and the Nginx model path by isolating Knowledge and giving only the gateway an egress-capable network, as the acceptance topology demonstrates.

### F-INFRA-002 — Knowledge uses PostgreSQL's cluster administrator for routine access

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate; merged infra-2/db-3 reports)
- Affected modules: Infrastructure, Zink Knowledgebase, n8n automation database
- Severity: High
- Status: CONFIRMED; duplicate root in `scan-infra-2` and `scan-db-3`. The db-3 report's Medium rating is inconsistent with the High rating in scan-infra-2 and the candidate register row.
- Root cause: Compose gives Knowledge the initialized `postgres` account and cluster password; one Knowledge pool uses that identity for ordinary reads/writes and migrations, so a Knowledge process compromise inherits cluster-wide privileges and access to n8n's separate database.
- Evidence: `infrastructure/docker/compose/compose.core.yml:13-16,149-153` initializes PostgreSQL as `postgres` and passes the same identity/password to Knowledge; `apps/knowledge/app/database.py:451-464` supplies those values to the routine pool, and `:2757-2768,2790-2819` performs schema/table migration DDL through it. The separate n8n database/login is configured at `compose.core.yml:65-72`; bootstrap grants it at `infrastructure/docker/scripts/bootstrap-postgres.sh:26-42`. `infrastructure/docker/scripts/start.ps1:85-89` runs that bootstrap only for `automation`/`all`, not `knowledge`; once Knowledge no longer has superuser authority, a fresh Knowledge-only profile also needs Infrastructure to provision `vector` and the scoped schema owner before the KB migrations. No live `current_user`/`rolsuper` probe was run; the role privilege follows the PostgreSQL image initialization contract used by this Compose file.
- Reproduction: On a disposable stack, inspect `current_user`/`rolsuper` through the Knowledge connection and attempt access to n8n-owned data; do not run this against live state. Not run.
- Acceptance criteria: Knowledge runtime access is restricted to Knowledge-owned objects and required migration operations, and a regression proves it cannot administer the cluster or read/write n8n-owned data.
- Related findings: `scan-infra-2` candidate and `scan-db-3` candidate describe the same role/configuration/data-access chain and should consolidate into this single root. `F-431` is a separate DDL/ledger concurrency failure. **Blast radius:** changing privileges affects Knowledge's migration and vector-extension setup, `start.ps1` bootstrap ordering, backup/recovery tooling that currently uses `postgres`, and the n8n isolation guarantee; do not grant Knowledge ownership over n8n state.

### F-INFRA-003 — routine Knowledge startup omits the hardening validated by the live acceptance overlay

- Category: F2 — Security & Authorization
- Legacy register id: — (new Phase 2 cross-check candidate)
- Affected modules: Infrastructure, Zink Knowledgebase
- Severity: Medium
- Status: CANDIDATE — the Compose-file selection/configuration mismatch is directly evidenced; no container reconciliation was run.
- Root cause: The documented operational `start.ps1` composes only `compose.core.yml` and `compose.knowledge.yml`, while the read-only root filesystem, dropped capabilities, no-new-privileges setting, PID ceiling, and `/tmp` tmpfs are declared only in `compose.m4-t5.live.yml`. The live acceptance driver uses that third file, so its hardening assertions do not establish the configuration produced by the normal start command.
- Evidence: `infrastructure/docker/scripts/start.ps1:17-18,39-46` selects and passes only the core and Knowledge compose files; `docs/runbooks/knowledge-platform.md:19-22` publishes this script as the operational start path. `infrastructure/docker/compose/compose.core.yml:136-184` gives Knowledge its image, environment, 4 GiB memory limit and network but does not declare the hardening keys. Those keys are at `infrastructure/docker/compose/compose.m4-t5.live.yml:10-17`; the live driver loads this overlay at `infrastructure/docker/scripts/knowledge-t5-live.ps1:21-23` and checks privilege hardening at `:466-472`. `tests/agent-kb-F-239.test.mjs:75-92` asserts the overlay itself, not the compose inputs assembled by `start.ps1`.
- Reproduction: Render/inspect the service configuration used by the normal Knowledge start command and compare its `ReadonlyRootfs`, `CapDrop`, `SecurityOpt`, `PidsLimit`, and tmpfs settings with the live-overlay values. Static file selection already demonstrates the difference; no Compose render was run.
- Acceptance criteria: The normal operational deployment and the live acceptance deployment share the intended Knowledge hardening, with the acceptance-only writable backup-barrier bind kept out of ordinary startup; a configuration test covers the actual `start.ps1` compose-file set.
- Related findings: Closed `F-239`/`R7-D3-02` added enforcement for the live overlay but does not establish that the normal start path includes it. **Blast radius:** moving hardening into the operational Knowledge service affects its writable `/tmp`/PDF runtime needs and the Knowledge container lifecycle; preserve the test-only barrier mount and do not alter n8n/PostgreSQL service settings.

### F-INFRA-004 — Knowledge acceptance drivers reject the current migration set

- Category: F4 — Integration & Contract Violations
- Legacy register id: — (new Phase 2 cross-check candidate)
- Affected modules: Infrastructure acceptance/recovery tooling, Zink Knowledgebase migration contract
- Severity: Medium
- Status: CONFIRMED STATICALLY — current source and driver predicates are incompatible; the script was not run.
- Root cause: Both M3/T5 drivers hardcode the historical 001/002 migration set as the complete current runtime set. The accepted Knowledge runtime now has migrations 001, 002, 004 and 005, and its startup applies every SQL file in the migration directory. Therefore the T5 candidate builder rejects the current migration directory before building the candidate identity; if that check is bypassed, the live driver's pre-start ledger allowlist and post-start exact-ledger assertion still reject the upgraded schema.
- Evidence: `apps/knowledge/app/database.py:2762-2768,2790-2819` enumerates and applies all SQL migration files. The current directory contains `001_initial.sql`, `002_pdf_ingestion_foundation.sql`, `004_pdf_build_failure_cause.sql`, and `005_schema_migration_digest.sql`; the latter two are ALTER migrations at `apps/knowledge/migrations/004_pdf_build_failure_cause.sql:12-15` and `005_schema_migration_digest.sql:17-18`. `infrastructure/docker/scripts/knowledge-t5-common.ps1:350-359` rejects any directory not exactly 001/002, and `:404-410` calls this before candidate evidence is formed. Separately, `infrastructure/docker/scripts/knowledge-t5.ps1:177-179,243-246` pins both ledger checks to 001/002; `infrastructure/docker/scripts/knowledge-t5-live.ps1:450-452,473-476` allows only 001 or 001/002 before start and demands 001/002 after start. The Knowledge migration manifest already lists 004/005 at `apps/knowledge/contracts/knowledgebase-migration-digests.json:17-24`.
- Reproduction: Run either T5 candidate path against the current tracked migration directory: `Get-T5MigrationIdentity` compares its four filenames to the two-name `$expected` list and throws `M4/T5 expects the exact approved migration 001/002 ledger.` Not run.
- Acceptance criteria: The infrastructure acceptance and live-recovery gates derive the currently approved Knowledge migration set and compare the expected pre/post migration transition explicitly; they accept a current 001/002/004/005 Knowledge schema and still reject missing, unknown, or digest-drifted migrations.
- Related findings: `F-KB-002` is a separate runtime replay-recovery defect for a missing ledger row; this candidate rejects valid later migrations even with a consistent ledger. **Blast radius:** update only the Infrastructure T5 candidate/ledger expectations and compatible fixtures; preserve Knowledge's forward-only migration and digest ownership, and do not make Knowledge delete or suppress its migrations to satisfy the infrastructure harness.

### F-KB-002 — replaying an applied ALTER migration can block Knowledge startup

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: — (Phase 1 KB candidate)
- Affected modules: Zink Knowledgebase; Infrastructure deployment health/start orchestration is affected by the outage
- Severity: Medium
- Status: CONFIRMED STATICALLY — candidate's stated replay path is present; no disposable PostgreSQL reproduction was run.
- Root cause: The duplicate-object recovery parser recognizes `CREATE` objects only. For an applied `ALTER TABLE ... ADD COLUMN` migration with its ledger row missing, PostgreSQL raises duplicate-column and the parser finds no object to verify, so startup aborts and the reconnect loop retries the same unrecoverable path.
- Evidence: `apps/knowledge/app/database.py:2790-2819` retries migrations lacking a ledger row and dispatches PostgreSQL errors to `_migration_is_already_applied`; `:127-155,2888-2901` recognizes duplicate-column SQLSTATE but returns false when the CREATE-object list is empty. The live migrations use `ALTER TABLE` at `apps/knowledge/migrations/004_pdf_build_failure_cause.sql:12-15` and `005_schema_migration_digest.sql:17-18`. `database.py:451-464,483-492,516-561` records startup failure and retries. Infrastructure waits for PostgreSQL health at `infrastructure/docker/compose/compose.core.yml:145-147`, while the Knowledge healthcheck calls `/healthz` at `:166-177`; `apps/knowledge/app/main.py:508-515` reports unhealthy while the database is unavailable. Normal Compose startup waits on those service health checks through `infrastructure/docker/scripts/start.ps1:91`.
- Reproduction: On disposable PostgreSQL, apply migration 004 or 005, delete only its `knowledge.schema_migrations` row while retaining the added column, then exercise Knowledge startup. Not run.
- Acceptance criteria: Recovery recognizes only a fully applied ALTER migration, repairs its ledger row, and still refuses partial schema state; the deployment health path reports the service unhealthy only until recovery succeeds, then healthy.
- Related findings: `F-431` covers the DDL/ledger transaction boundary, not this unsupported ALTER replay form. **Blast radius:** the behavioral fix belongs to Knowledge migration recovery; Infrastructure's service-health wait must continue to expose startup failure rather than treating PostgreSQL readiness as Knowledge readiness.

### F-DB-001 — Knowledge restore verification does not compare segment data

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 database candidate)
- Affected modules: Infrastructure recovery tooling, Zink Knowledgebase
- Severity: Medium
- Status: CONFIRMED AS A VERIFICATION GAP — the verifier's checks omit segment content; its archive-tampering reproduction was not run.
- Root cause: `segments` is required only as a `TABLE` or `TABLE DATA` inventory entry, while the metadata digest and restored comparison exclude the table. A schema-only segments entry can therefore satisfy those particular checks without proving retrieval rows survived.
- Evidence: `infrastructure/docker/scripts/knowledge-t5-live.ps1:284-289` creates the archive and accepts either `TABLE` or `TABLE DATA` for `segments`; `:296-299` checks expected tables only; `:330-332` builds `$criticalTables` without `segments`; `:362-364` compares only the resulting metadata digest before `:396` records `restore_verified = $true`. The KB table contains source/segment foreign keys and embeddings at `apps/knowledge/migrations/001_initial.sql:98-140`.
- Reproduction: In a disposable verifier fixture, supply a valid archive with the `knowledge.segments` table definition but no `TABLE DATA` entry, and check whether the restore gate can still produce its success evidence. Not run; the current driver creates its archive internally with `pg_dump`, so this reproduction requires an explicit test seam or controlled fixture.
- Acceptance criteria: Recovery verification proves segment data and its retrieval-critical relationships match the snapshot, and a schema-only/missing-segment-data archive fixture fails before `restore_verified` is set.
- Related findings: `F-558` concerns generic backup-inventory false certification and is a different mechanism. The generic `infrastructure/docker/scripts/backup.ps1:101-107,138-154` includes the `postgres` database holding the Knowledge schema in its archive set; `docs/runbooks/knowledge-platform.md:65` correctly says restore automation is not implemented. Keep the recovery scope limited to Knowledge-owned rows and do not alter live data.

## Remaining Knowledge candidates and boundary notes

- `F-KB-001`: source call chain rechecked at `apps/knowledge/app/pdf_foundation.py:255-263`, `apps/knowledge/app/index_lifecycle.py:206-219,418-435`, and `apps/knowledge/app/database.py:2200-2211`. It is a Knowledge ingestion/data-retention defect; the Vault bind remains read-only at `infrastructure/docker/compose/compose.knowledge.yml:10-17`, and no infrastructure fix is implicated.
- `F-KB-003`: collision mechanism rechecked at `apps/knowledge/app/database.py:1995-2024` and schema uniqueness at `apps/knowledge/migrations/001_initial.sql:67-85`. Reachability is filesystem-dependent; no change to the infrastructure volume is justified by the evidence.
- `F-KB-004`: API omission rechecked at `apps/knowledge/app/database.py:1905-1925,1961-1967` and `apps/knowledge/app/main.py:958-977,998-1025`; it is an API/consumer boundary candidate for the Knowledgebase <-> Tools checker. No Infrastructure effect is evidenced.

## Infrastructure contract checks with no additional finding

- **Volumes/state:** `postgres-data` is persistent (`infrastructure/docker/compose/compose.core.yml:17-18,224-226`); the operational Vault bind is explicitly read-only (`infrastructure/docker/compose/compose.knowledge.yml:10-17`). Knowledge rows, sources, segments and migration ledger live in the `postgres` database/schema; the generic backup includes that database (`infrastructure/docker/scripts/backup.ps1:7-12,101-107`). Vault content remains human-owned source and is not a backup write target.
- **Ports:** PostgreSQL and Knowledge have no host-published ports in the core Compose service blocks (`compose.core.yml:10-32,136-184`). Nginx, n8n and Dozzle publish only on loopback (`:85-86,111-112,196-197`); the deployed egress check also asserts Knowledge has no port binding (`infrastructure/docker/scripts/knowledge-t5-common.ps1:550-566`).
- **Resource ceilings:** Knowledge is capped at 4 GiB (`compose.core.yml:178`), PostgreSQL at 1536 MiB plus 256 MiB shared memory (`:25-26`); no cross-module ceiling conflict was evidenced. The live acceptance verifier checks Knowledge's 4 GiB ceiling and observed memory window (`knowledge-t5-common.ps1:492-536`).
- **Health/start order:** Knowledge waits for PostgreSQL's healthy state (`compose.core.yml:145-147`); Postgres health is `pg_isready` (`:19-24`). Knowledge `/healthz` is database availability, while `/readyz` additionally requires an active index, reranker and matching model identity (`apps/knowledge/app/main.py:508-515,524-585`). Nginx's local health endpoint is intentionally independent of Knowledge (`infrastructure/nginx/conf.d/default.conf:5-8,10-20`), allowing the gateway to start first. No extra ordering defect is established beyond the migration failure consequence in `F-KB-002`.
- **Environment/credentials:** `start.ps1` rejects missing/example credentials before `compose up` (`infrastructure/docker/scripts/start.ps1:61-66`; shared checks in `credential-sentinels.ps1:39-68`). The ignored real `.env` was not opened. Knowledge's DB identity is the exception captured by `F-INFRA-002`.
- **Recovery coverage:** The generic archive carries both `n8n` and `postgres` databases, plus the n8n home archive (`backup.ps1:101-127`); the Knowledge-specific live gate writes/restores a schema-scoped Knowledge archive (`knowledge-t5-live.ps1:284-286,347-364`). The Knowledge runbook discloses absent restore automation (`docs/runbooks/knowledge-platform.md:51-65`). The only additional evidenced recovery weakness at this boundary is `F-DB-001`'s segment-data comparison gap.
