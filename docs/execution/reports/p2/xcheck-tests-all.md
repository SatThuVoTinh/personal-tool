# Phase 2 cross-check — tests/** <-> all modules

- **Mode:** Audit (Phase 2).
- **Target:** Dispatch-time working tree at HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; the pre-existing dirty state is recorded in `docs/execution/context.md:5,19`. Findings below compare the checked-out tests/gates with the Phase 1 candidate evidence and live register.
- **Scope:** Test coverage, stale/partial fixtures, assertion strength, explicit gate inclusion, shared roots and fix blast radius for F-INFRA-001/002, F-KB-001–004, F-SKILL-001/002, F-OC-001–008, F-DB-001/002.
- **Instructions:** Read root `AGENTS.md`, coordinated context and slices, the top rules of `docs/execution/findings.md`, and the Phase 1 reports for all listed candidates. Root is the only `AGENTS.md` found.
- **Method:** Read-only static comparison of candidate source locators, shipped test bodies, package scripts, gate registry and CI workflow. No tests, Docker, PostgreSQL, restore, Vault, secret-file or live-runtime operation was run. No source or shared audit files were changed.
- **Coverage result:** 18 candidates reviewed: 5 High and 13 Medium by inherited candidate severity. None has a shipped regression that exercises its stated failure end to end. Several have adjacent partial tests; those are identified below. This is a coverage verdict, not independent runtime reproduction or a change to the candidate statuses in `findings.md`.
- **Blockers:** None for this static cross-check. Runtime claims that require Docker/PostgreSQL/filesystem fault injection remain unverified.

## Required gates and confidence limits

- `package.json:20-29` defines `format:check`, `lint`, the explicit-file `test` command, `test:knowledge`, `repo:check`, and fail-fast `verify` (`format:check -> lint -> test -> repo:check`). `docs/development/conventions.md:68-83` is the gate registry. `scripts/repository-policy.mjs:1360-1396` and `tests/repository-policy.test.mjs:796-851` reconcile the explicit Node test list against files on disk, so a new `tests/*.test.mjs` file cannot silently remain outside `npm test` when `repo:check` runs.
- `.github/workflows/ci.yml:21-46,51-103` runs blocking `quality-gate` with `npm run verify` and a separate blocking `python-quality` with `npm run test:knowledge`. The Node `verify` does not include the Knowledge Python suite; both tiers are needed for Knowledge tests. `docs/development/conventions.md:74,101-103` also marks the PDF runtime closure explicitly NOT RUN in CI.
- The postgreSQL cases in `tests/m11-t1-postgres-sql-gate.test.mjs:9-17,194-203` skip when Docker/container is unavailable. A skipped case is NOT RUN, not evidence that live PostgreSQL behavior passed. That suite currently exercises Skill Store SQL and PDF reclamation scenarios; it does not implement the candidate probes below.
- The static PowerShell source assertions in `tests/m3-t5-contract.test.mjs:185-254` can detect selected strings but do not execute the Knowledge restore driver or prove archive contents. No audit gate was run in this task; all run results are therefore NOT RUN.

## Candidate cross-checks

### F-INFRA-001 — deployed Knowledge bridge egress bypass

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Infrastructure, Zink Knowledgebase
- Severity: Medium
- Status: Coverage gap; candidate remains pending triage. No deployed direct-egress regression test found.
- Root cause: The existing acceptance isolation proof is stronger than the shipped live proof, and the current test pins only that the gateway-route proof is called in the live driver.
- Evidence: Candidate source evidence is `infrastructure/docker/compose/compose.core.yml:182-183,216-222` (ordinary bridge) versus `infrastructure/docker/compose/compose.m3-t5.acceptance.yml:52-58` (internal acceptance network); `infrastructure/docker/scripts/knowledge-t5-common.ps1:591-609` probes direct TCP/DNS only in runtime isolation, while `knowledge-t5-live.ps1:463-472` checks gateway paths. `tests/agent-owner-F-288.test.mjs:185-224` requires the deployed driver to call `Assert-T5ModelEgressAllowlist` and check disallowed proxy paths, but makes no assertion for direct TCP/DNS egress. `tests/m3-t1-contract.test.mjs:74-85` instead asserts Knowledge joins `platform` and receives `host.docker.internal`.
- Reproduction: No live container/network probe run. Existing acceptance assertions do not exercise direct egress on the deployed composition.
- Acceptance criteria for coverage: A deployed-stack-equivalent test/probe should fail when Knowledge can open direct external TCP or DNS connections while the Nginx allowlist remains correct.
- Related findings: `F-520`/`F-569` concern static Compose parsing/comparison, not runtime egress.
- Fix-site blast radius: Network topology or live-driver changes affect Knowledge, Nginx/model access, and any peer sharing `platform` (including n8n). Keep the gateway's required egress path and peer-service behavior explicit; changing only the acceptance overlay cannot validate deployed policy.

### F-INFRA-002 — Knowledge uses PostgreSQL cluster administrator credentials

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate; scan-infra-2/scan-db-3 same root)
- Affected modules: Infrastructure, Zink Knowledgebase, n8n database; the database cross-check also identifies Skill Store's separate postgres client.
- Severity: High
- Status: Coverage gap and stale security expectation; candidate remains pending triage.
- Root cause: The Compose contract test asserts the administrator username as the expected Knowledge runtime identity; no test proves runtime privilege confinement or cross-schema denial.
- Evidence: `tests/m3-t1-contract.test.mjs:91-100` requires `KNOWLEDGE_DATABASE_USER === "postgres"` and the shared password. `infrastructure/docker/compose/compose.core.yml:13-16,149-153` and `apps/knowledge/app/database.py:453-459,2757-2768,2790-2819` are the candidate's configured runtime/migration path. `docs/execution/reports/p2/xcheck-db-all.md:11-23,77-83` identifies the same cluster-role boundary for Knowledge and Skill Store and treats it as one shared root. No `current_user`/`rolsuper`, `knowledge`-only role or n8n/skills cross-access denial test was found in the reviewed suites.
- Reproduction: No disposable PostgreSQL role probe run. The test's current assertion checks Compose text, not effective privileges.
- Acceptance criteria for coverage: Assert role capabilities through both module clients; demonstrate Knowledge cannot administer PostgreSQL or access n8n/Skill Store data and Skill Store cannot mutate Knowledge/n8n state, while each owner can perform required migrations.
- Related findings: Phase 1 scan-infra-2 and scan-db-3 reports duplicate the same Knowledge credential root; consolidate the candidate. `F-431` is a separate migration atomicity issue.
- Fix-site blast radius: Compose/bootstrap/role grants affect Knowledge pool startup and DDL, Skill Store's `psql -U postgres -d postgres` client (`zink-skill-store/src/vector-sync.mjs:307-335`), and n8n isolation. Coordinate both module clients; preserve separate schema/migration ownership and n8n's dedicated DB identity.

### F-KB-001 — oversized PDF sidecar omission can stale-delete an indexed PDF

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: Partial adjacent coverage only; candidate remains pending triage.
- Root cause: Tests cover an oversized PDF source and generic stale-source deletion, but not an oversized sidecar being silently skipped while its PDF remains present.
- Evidence: Candidate code path: `apps/knowledge/app/pdf_foundation.py:255-263`, `apps/knowledge/app/index_lifecycle.py:206-219,418-435`, `apps/knowledge/app/database.py:2202-2211`. `apps/knowledge/tests/test_pdf_foundation.py:101-114` asserts an oversized **PDF** is refused before hashing; it does not enlarge a sidecar. `apps/knowledge/tests/test_index_lifecycle.py:279-290` proves generic stale-path calculation, and `:305-331` proves deletion is deferred for a reported Markdown parse error; neither gives the lifecycle an oversized-but-silently-omitted PDF sidecar.
- Reproduction: Not run; fixtures do not construct the candidate state (previously indexed PDF + retained embed + sidecar exceeding the limit).
- Acceptance criteria for coverage: Begin with an indexed PDF, enlarge only its sidecar beyond the size ceiling, run incremental discovery/publication, and assert the prior source/segments survive or the run fails that source without stale deletion.
- Related findings: `F-440` is distinct: its oversized-PDF refusal reports the source error; it does not cover the sidecar skip.
- Fix-site blast radius: Discovery/manifest/lifecycle changes affect Knowledge ingestion and `knowledge.*` stale deletion only. Preserve incremental deletion for genuinely removed sources and the rule that uncertain scans do not prune existing rows; no Skill Store or Tools mutation is implicated.

### F-KB-002 — applied ALTER migration replay with missing ledger row

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Zink Knowledgebase; deployment health is a downstream observer
- Severity: Medium
- Status: Partial stale fixture; candidate remains pending triage.
- Root cause: Existing replay recovery tests model duplicate objects from a CREATE migration, the exact shape the implementation recognizes; they do not model duplicate-column from migrations 004/005.
- Evidence: Candidate evidence: `apps/knowledge/app/database.py:127-155,2790-2819,2888-2897`; ALTER files `apps/knowledge/migrations/004_pdf_build_failure_cause.sql:12-15` and `005_schema_migration_digest.sql:17-18`. `apps/knowledge/tests/test_m11_index_hygiene.py:395-422,440-472` uses `ReplayMigrationConnection` that always raises `DuplicateTableError` and fixture SQL containing `CREATE TABLE`/`CREATE INDEX`; it asserts that this replay is recorded. `apps/knowledge/tests/test_m12_t9_r4_migration_digest.py:366-372` checks migration 005's ALTER column shape, not replay recovery or `42701`.
- Reproduction: No PostgreSQL migration-replay test run; no current test removes an applied 004/005 ledger row while retaining its column.
- Acceptance criteria for coverage: In disposable PostgreSQL, apply 004 or 005, remove only its ledger row, restart and assert safe ledger repair; also test a partially applied schema is still rejected.
- Related findings: `F-431` covers DDL/ledger atomicity and may cover one way of producing the missing row, but does not test the CREATE-only recovery parser against ALTER migrations.
- Fix-site blast radius: Targeted runner and regression changes affect Knowledge startup and `knowledge.schema_migrations`. If migration parsing is shared, separately preserve Skill Store's own schema, ledger, and replay semantics; Knowledge must not inspect or repair `skills.*`. Infrastructure health checks should continue to reflect Knowledge unavailability until recovery succeeds.

### F-KB-003 — NFC-normalized source-path collision

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Zink Knowledgebase
- Severity: Medium
- Status: Partial stale fixture; candidate remains pending triage.
- Root cause: Current NFC regression fixtures use one NFD input at a time; they assert canonicalization and read visibility without creating two distinct source paths that normalize to one stored key.
- Evidence: Candidate evidence: `apps/knowledge/app/database.py:1995-2024`, `apps/knowledge/app/markdown_adapter.py:296-337,368-374`, `apps/knowledge/migrations/001_initial.sql:81`. `apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py:127-157` writes one NFD Markdown path and expects its NFC form; `:299-369` exercises one NFD scanned source against one NFC stored path. No two-file NFC/NFD collision fixture appears in these cases.
- Reproduction: Not run on a filesystem that preserves both spellings. The existing fixture population cannot expose overwrite/deletion between two distinct names.
- Acceptance criteria for coverage: On a preserving filesystem, scan two distinct NFC/NFD names with distinct content in one rebuild and assert both remain addressable, or assert collision is rejected before publication and prior rows remain intact.
- Related findings: `F-576` covers individual path normalization/prefix matching; this two-source identity collision is a distinct shape. `F-KB-001` also reaches stale deletion but through sidecar omission, not normalized-key collision.
- Fix-site blast radius: A collision check or identity change affects Knowledge scanning, publication, schema identity and retrieval. `normalize_source_path` is Knowledge-local; do not alter Skill Store namespace/capability keys or shared module ownership to solve a Knowledge source-path collision.

### F-KB-004 — chunk/citation API omits index status and stable ordinal

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (possible incomplete closure of F-573)
- Affected modules: Knowledgebase API, Zink Tools Knowledge consumer
- Severity: Medium
- Status: Partial reader coverage; candidate remains pending triage.
- Root cause: DB reader tests assert the two fields exist in `SegmentRecord`, while HTTP tests assert other provenance fields. No endpoint test asserts that a superseded citation response publishes `index_status` and `chunk_ordinal`.
- Evidence: `apps/knowledge/tests/test_m12_t9_b5_db_retrieval.py:225-280` asserts reader status and ordinal. `apps/knowledge/tests/test_b5_knowledge_http_surface.py:347-382` calls both `/v1/chunk` and `/v1/citation` but asserts only source digest and line span. Candidate serializers omit fields at `apps/knowledge/app/main.py:958-977,998-1025`; reader selects/returns them at `apps/knowledge/app/database.py:1905-1925,1961-1967`. `zink-tools/adapters/knowledge/knowledge-adapter.mjs:780-821` and `zink-tools/contracts/tools/zink-knowledge.schema.json:88-118` are the downstream consumer/mapping/schema surface cited by `docs/execution/reports/p2/xcheck-kb-skill.md:32-36`.
- Reproduction: No HTTP/database request against a superseded index run. Existing HTTP fake's `SegmentRecord` does not supply the candidate fields or check response absence/presence.
- Acceptance criteria for coverage: Exercise each endpoint with a superseded record and assert status plus stable ordinal in the public payload and through the Tools mapping/schema, including ordinary active citations.
- Related findings: Triage against closed `F-573` for incomplete closure versus a distinct serializer-layer gap. This does not overlap Skill Store vector state.
- Fix-site blast radius: Adding response fields affects the public Knowledge HTTP contract, Zink Tools mapping/schema and consumers. Keep the end-to-end shapes aligned; no Skill Store index change is needed.

### F-SKILL-001 — promotion residue healing follows a symlink

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Zink Skill Store
- Severity: Medium
- Status: Partial adjacent coverage only; candidate remains pending triage.
- Root cause: Tests prove a catalog walk rejects links after walking begins, but do not test promotion's earlier residue-healing mutation through a symlinked identity ancestor.
- Evidence: Candidate source/order: `zink-skill-store/src/catalog.mjs:1331-1341,1723-1733` precedes the scan at `:1844`; later walk refusal is `:689-710`. `tests/m6-t1-skill-store.test.mjs:370-403,557-633` rejects symlinked catalog/root/content paths during catalog validation. `tests/agent-skill-F-580.test.mjs:118-155,157-220,283-314` tests stranded/quarantine handling and promotion rollback removal faults, but its fixtures do not create an outside target reached by a namespace/capability symlink before cleanup.
- Reproduction: No isolated outside-sentinel symlink promotion probe run.
- Acceptance criteria for coverage: Create an external matching residue sentinel, symlink an identity ancestor to that directory, invoke promotion, and assert refusal leaves every outside byte untouched.
- Related findings: `F-580` covers quarantine fallback and promotion rollback residue, not pre-scan cleanup through an external symlink.
- Fix-site blast radius: Path validation/order changes affect Skill Store promotion and its residue repair. Any shared lock change also affects other lock users; do not broaden cleanup outside the canonical store root or implicate Knowledge Vault state without evidence.

### F-SKILL-002 — namespace alias persistence mismatch in scoped Skill Store search

- Category: F1 — Logic & Functional Bugs
- Legacy register id: — (Phase 1 candidate)
- Affected modules: Zink Skill Store, Zink Tools
- Severity: Medium
- Status: Partial neighboring alias coverage only; candidate remains pending triage.
- Root cause: Tests cover alias-to-canonical semantic metadata and namespace authorization, but not writing the alias unchanged to the vector row and then searching through the SQL namespace predicate.
- Evidence: Writer stores the supplied namespace at `zink-skill-store/src/vector-sync.mjs:575-576,622-627`; Tools canonicalizes query scope and builds the predicate at `zink-tools/adapters/skill-store/skill-adapter.mjs:720-751`; alias mapping is `zink-tools/common/semantic-contract.mjs:36-44,203-210`. `tests/m8-t1-skill-vector-memory.test.mjs:1031-1075` asserts alias metadata resolution only. `tests/zink-tools-skill-namespace-binding.test.mjs:183-216` tests `power-bi`/`bi` authorization on an alias pair but does not exercise `supply-chain` persisted namespace in `skills.catalog_index` or scoped semantic-search SQL. `tests/m11-t1-skill-vector-sql.test.mjs:135-148,154-227` captures generated SQL but fixtures use office namespace and do not test alias search.
- Reproduction: No PostgreSQL write/search probe run; tests do not pair an alias-backed stored row with alias and canonical scoped queries.
- Acceptance criteria for coverage: Promote/sync a valid `supply-chain` skill, inspect its stored namespace, then query scopes `supply-chain` and `lscm` through the adapter and assert the documented match/refusal behavior.
- Related findings: `F-015` is REFUTED capability casing; F-434/F-572 cover freshness/embedding identity. None covers the writer/query alias mismatch.
- Fix-site blast radius: Canonicalizing Skill Store writes affects derived `skills.catalog_index` and sync/reindex semantics; query normalization affects Tools' Skill Store adapter and namespace contract. Keep changes coordinated across those owners; do not write or migrate `knowledge.*`.

### F-OC-001 — raw Discord buttons may be sent without a resolved host SDK

- Category: F4 — Integration & Contract Violations
- Legacy register id: — (Phase 1 candidate; same mechanism as scan-oc-1-02)
- Affected modules: OpenClaw Discord adapter and governance plugin caller
- Severity: Medium
- Status: Adjacent test currently confirms no registration but does not assert safe outbound payload; candidate remains pending triage.
- Root cause: The missing-SDK test logs the failure and asserts registration did not occur, but it never captures/asserts the adapter's sent payload or refusal of button-bearing content.
- Evidence: `tests/m12-t1-discord-component-registry.test.mjs:285-307` sets a throwing SDK resolver, asserts a receipt and `COMPONENT_SDK_UNAVAILABLE`, and only checks no register call. It does not assert no send or no raw `channelData.discord.components`. The candidate path is `integrations/openclaw/lib/discord-native-send.mjs:730-756,779-814`; caller supplies raw buttons at `integrations/openclaw/plugins/zink-governance/index.mjs:6636-6645`.
- Reproduction: No adapter-payload capture for the SDK-failure branch was performed. The current test's successful receipt is not proof buttons are registered/actionable.
- Acceptance criteria for coverage: Under throwing SDK resolution, capture transport input and assert button controls are refused or stripped; retain a separate positive test for registered components.
- Related findings: Phase 1 scan-oc-1-02 is the same candidate; `F-399` covers a different late-send failure.
- Fix-site blast radius: Adapter behavior changes affect all OpenClaw sends with native components and the governance plugin's approval/result callers. Preserve text-only delivery, registration success semantics, and owner-visible failure reporting; this is not a Zink Tools or persistent-state change.

### F-OC-002 — aggregate ZIP expansion can exhaust OpenClaw memory

- Category: F6 — Reliability & Performance
- Legacy register id: — (same issue as scan-oc-2-01)
- Affected modules: OpenClaw artifact validation, Excel writer, governance result route
- Severity: High
- Status: Structural ZIP tests exist, but no expansion-budget regression; candidate remains pending triage.
- Root cause: Tests build valid/invalid ZIP structures and test artifact/path/Excel semantics without a repeated-stream or aggregate-expanded-byte adversarial fixture.
- Evidence: Validator inflate/retention path is `integrations/openclaw/lib/artifact-validator.mjs:153-204`; Excel writer independently inflates without an output bound at `integrations/openclaw/lib/excel-writer.mjs:123-174`. `tests/m8-t2-governed-runtime-audit.test.mjs:899-945,1003-1061` covers Power BI archive structure; `:3780-3843` covers an Excel cell-size rule. `tests/m12-t9-r4-f564-preview-verdict.test.mjs:23-41,102-176` builds small structural ZIPs. None asserts an entry-count or aggregate expansion cap. The governed production route is `integrations/openclaw/plugins/zink-governance/index.mjs:3125-3134`.
- Reproduction: No compressed bomb/reused local-stream fixture or resource probe run.
- Acceptance criteria for coverage: Test both live readers for a single over-limit inflate, many small entries exceeding the aggregate budget, repeated local stream references, and ordinary valid workbook compatibility; assert bounded refusal before unbounded buffers are retained.
- Related findings: Same Phase 1 issue `CAND-oc-2-01`; the Excel writer parser is an additional same-class sink, not a separate root. No Knowledgebase or Skill Store index evidence is involved.
- Fix-site blast radius: Shared ZIP parser/count policy affects Excel plus Power BI and DOCX readers in `artifact-validator.mjs`; writer limits affect Excel load/validate/populate/template parsing. Keep resource behavior in OpenClaw's hosting boundary; Tool schema-only changes do not bound either parser.

### F-OC-003 — Excel writer follows a dangling symlink outside its sandbox

- Category: F2 — Security & Authorization
- Legacy register id: — (same issue as scan-oc-2-02)
- Affected modules: OpenClaw Excel writer and governance plugin caller
- Severity: Medium
- Status: Partial adjacent path coverage only; candidate remains pending triage.
- Root cause: Existing tests cover lexical traversal, absolute escape and directory junctions, not a dangling final-component file symlink with an outside target.
- Evidence: Candidate path: `integrations/openclaw/lib/excel-writer.mjs:454-480,660-673,841-842`; governed sandbox caller: `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4864`. `tests/agent-lib-F-044.test.mjs:39-88` uses a directory junction; `tests/m10-t2-r19-artifact-and-message-limits.test.mjs:49-88` tests `../` and absolute paths. These do not create the candidate's dangling final link. The latter test file is included in `package.json:24`; inclusion does not make its fixtures equivalent.
- Reproduction: No dangling-link write probe run. `F-525` provides a valid testing lesson: `tests/m12-t9-r4-skip-idiom.test.mjs:1-14` forces a skipped platform branch; that test verifies skip behavior, not this dangling-symlink sink.
- Acceptance criteria for coverage: Precreate a dangling `<workspace>/report.xlsx` link to an absent file under an existing outside directory, generate, and assert refusal plus no outside file/preview.
- Related findings: `F-563` is a distinct Discord preview writer. Phase 1 scan-oc-2-02 is same as this candidate.
- Fix-site blast radius: Excel write-target checks affect generate/create/append/write/populate and preview outputs; preserve legitimate new in-sandbox targets. If a helper is shared, separately test the Discord preview output root. Do not relax either sandbox.

### F-OC-004 — release can delete a replacement file-lock holder after token validation

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: — (Phase 1 candidate)
- Affected modules: OpenClaw shared file lock; decision ledger, queue and topology-ledger callers
- Severity: High
- Status: Partial stale interleaving; candidate remains pending triage.
- Root cause: The existing stale-holder test replaces B's lock before A validates its token. It proves validation refuses an already-replaced holder, not the reported interleaving after A passes validation and before unlink.
- Evidence: `tests/m10-t2-r18-file-lock.test.mjs:197-222` removes A's lock and lets B acquire before calling A's `release`; A then fails ownership validation. The candidate's check/removal sequence is `integrations/openclaw/lib/file-lock.mjs:188-212,220-240,264-270`, with callers at `decision-ledger.mjs:436-438`, `queue-manager.mjs:246-259,382-383`, topology ledger `:1503-1507`.
- Reproduction: No deterministic hook/interleaving between `ownsRecordedLock` and `removalRound` is present in this test; no race probe run.
- Acceptance criteria for coverage: Pause A after successful token check, replace the directory with B's token, resume A through removal, and assert B's owner record/directory survive; then verify a third writer remains excluded.
- Related findings: `F-433` covers analogous recovery-driver read/check/delete timing, not this shared lock release site. `m11-t3-durable-state-integrity.test.mjs:95-170` covers async release behavior, not replacement after the successful check.
- Fix-site blast radius: The primitive is shared by OpenClaw decision/queue/topology stores and Skill Store callers using the lock implementation; a lock fix must preserve sync/async acquisition and release contracts for all owners. Keep each module's state format and ownership separate.

### F-OC-005 — conflicting DecisionLedger writes with same deterministic ID can overwrite

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 candidate)
- Affected modules: OpenClaw decision ledger/policy; governance confirmation caller
- Severity: Medium
- Status: Partial distinct-case coverage; candidate remains pending triage.
- Root cause: Tests exercise sequential conflicts with an explicit ID and concurrent/independent writes with different IDs; they do not have two stale ledger instances save different decisions sharing the deterministic topic/question/scope ID.
- Evidence: Candidate check-before-lock/save path is `integrations/openclaw/lib/decision-ledger.mjs:405-459,583-638`. `tests/m7-lane-d-decision.test.mjs:84-113` makes two sequential writes with explicit `decisionId: "D1"`; `tests/agent-lib-F-002.test.mjs:109-140` uses two writers with different explicit IDs and asserts both persist. `tests/m12-t9-r4-decision-replay-order.test.mjs:62-78` checks sequential changed content conflict. None asserts under-lock conflict detection between independently refreshed same-ID instances.
- Reproduction: No two-instance concurrent/interleaved same-identity, different-decision test run.
- Acceptance criteria for coverage: Refresh two instances from an empty ledger; stage different decisions for identical identity; save in sequence under the lock; assert one receives conflict and the original durable decision remains.
- Related findings: `F-404` is key-order-dependent replay equality and is distinct. Do not merge with F-OC-004's lock-removal race solely because both involve concurrent writers.
- Fix-site blast radius: Save/conflict policy changes affect all decision-ledger callers, owner confirmation semantics and durable ledger replay; preserve explicit correction/supersession behavior. Do not change queue or topology state ownership as a workaround.

### F-OC-006 — concurrent ingress can persist two tasks for one origin binding

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: — (Phase 1 candidate)
- Affected modules: OpenClaw topology ledger/reducer and governance ingress
- Severity: High
- Status: Partial sequential duplicate coverage; candidate remains pending triage.
- Root cause: Current tests show sequential re-delivery is refused/idempotent; they do not synchronize concurrent handlers after both read an empty snapshot but before either append.
- Evidence: Candidate lookup/mint/append and reducer paths are `integrations/openclaw/plugins/zink-governance/index.mjs:9535-9555,9619-9627`, `integrations/openclaw/topology/lib/workflow.mjs:329-357,631-655`, and serialized append `integrations/openclaw/topology/lib/ledger.mjs:1973-2004`. `tests/m10-t2-r9-duplicate-runid-observability.test.mjs:188-202` delivers a second event only after first entry completes and expects one `WORKFLOW_OPENED`. `tests/m12-t1-task-identity.test.mjs:385-434` checks sequential origin-binding lookup; `tests/m7-lane-a-workflow.test.mjs:33-53` tests same-task-ID replay/conflict, not distinct IDs with same origin.
- Reproduction: No barrier-based concurrent-ingress test run; the existing sequential duplicate test does not reach the two-lookups-before-append interleaving.
- Acceptance criteria for coverage: Hold two admitted handlers after both return no origin binding, release both appends, and assert one durable owner task, unique resolvable session/run identity, and deterministic duplicate outcome.
- Related findings: F-393–F-398 and F-532 cover other state/outcome boundaries; sequential identity tests are not duplicates of this race.
- Fix-site blast radius: An origin uniqueness fix at reducer/ledger affects topology event semantics and governance ingress id allocation. Preserve the event ledger's append/lock protocol and do not couple it to Skill Store/Knowledge persistence.

### F-OC-007 — superseded delegated run can pass specialist message provenance

- Category: F2 — Security & Authorization
- Legacy register id: — (Phase 1 candidate)
- Affected modules: OpenClaw governance message hook and topology run identity
- Severity: Medium
- Status: Partial unit-level provenance coverage; candidate remains pending triage.
- Root cause: `evaluateSpecialistProvenance` unit tests cover agent, approval, claim and workflow status only. They do not exercise `ctx.runId`, historical run resolution, superseded attempt status, or the production `message_sending` hook.
- Evidence: Candidate production path is `integrations/openclaw/plugins/zink-governance/index.mjs:10157-10175,10205-10215`; historical IDs and superseded attempts are `integrations/openclaw/topology/lib/workflow.mjs:337-344,426-434,1961-1973`. `tests/m12-t1-result-preview-and-ownership.test.mjs:295-407` directly calls provenance with no native run ID; `tests/m7-lane-j-attempt-semantics.test.mjs:268-365` checks stale result/state transitions, not Discord message admission. Search of `tests/**` found `message_sending` adapter tests for destinations/attachments, but no stale-run provenance case.
- Reproduction: No plugin-hook test with prior and current native run IDs was run.
- Acceptance criteria for coverage: After continuation supersedes a delegation, invoke the real message hook using its retained old run ID and assert refusal/no publish; assert the current run is still admitted.
- Related findings: `F-532` covers stale execution-finished result commits, not specialist message authorization.
- Fix-site blast radius: Hook/run-binding changes affect governance plugin's Discord message path and topology's historical/current identity contract. Preserve legitimate current-run messages and do not weaken result-commit fences or delegate topology ownership.

### F-OC-008 — post-rename hotfix fsync failure can leave boot-blocking mixed artifacts

- Category: F6 — Reliability & Performance
- Legacy register id: — (Phase 1 candidate)
- Affected modules: OpenClaw hotfix template/setup transaction and gateway startup policy
- Severity: High
- Status: Partial durability and boot-state coverage; candidate remains pending triage.
- Root cause: Shipped durability tests prove directory fsync presence or committed-write behavior in other stores; setup tests prove unsupported mixed state blocks boot. None injects a hotfix directory-fsync failure after the second artifact rename and then checks transaction rollback/recovery.
- Evidence: Candidate operation order is `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:290-315,379-394,421-432`; boot wiring is `integrations/openclaw/lib/policy.mjs:1989`. `tests/agent-topo-F-296.test.mjs:34-58,172-215` statically includes the hotfix rename writer in the directory-fsync census, and `:217-318` runtime-probes topology-ledger directory fsync; neither injects the hotfix transaction fault. `tests/m7-t1-openclaw.test.mjs:984-1027` confirms unsupported partial state throws at boot, but does not make the failing apply transaction. `tests/agent-last-F-106.test.mjs:263-322` injects a different runtime-config rollback failure, not the hotfix post-rename fsync seam.
- Reproduction: No second-rename EIO injection run against the hotfix template.
- Acceptance criteria for coverage: Inject EIO from the parent-directory fsync after the second rename; assert rollback leaves all original bytes or a supported recoverable state, then exercise `--ensure` successfully.
- Related findings: `F-296` requires directory fsync presence; `F-417` tests committed-write error policy in queue/ledger writers. Neither covers hotfix transaction bookkeeping after rename. `F-106` is a different setup rollback target.
- Fix-site blast radius: Template write/rollback changes affect the four managed OpenClaw artifacts and the gateway `ExecStartPre --ensure` path. Preserve supported predecessor/fully-patched states and avoid broadening rollback into unrelated runtime files.

### F-DB-001 — Knowledge restore gate can certify missing segment rows

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 database candidate)
- Affected modules: Infrastructure recovery tooling, Zink Knowledgebase
- Severity: Medium
- Status: Broad static contract assertions only; candidate remains pending triage.
- Root cause: Contract tests assert that recovery and a metadata-digest message exist, but not that `knowledge.segments` table data is required and included in the restored digest.
- Evidence: Candidate verifier lines: `infrastructure/docker/scripts/knowledge-t5-live.ps1:288-289,330-332,362-364,396`. `tests/m3-t5-contract.test.mjs:202-214,221-225` asserts generic migration/restore/digest/truncated-archive phrases but no `segments` data requirement or inclusion in `$criticalTables`. `tests/agent-setup-F-265.test.mjs:154-168` includes `postgres: ["sources", "segments"]` as synthetic credential-inspection inventory; it tests plaintext-secret classification, not Knowledge restore verification. `tests/m11-t1-postgres-sql-gate.test.mjs:752-771,774-775` and later reclamation cases create segment rows for a separate SQL path, not a schema-only restore archive.
- Reproduction: No custom archive excluding only `knowledge.segments` data was created/restored; no current test uses such an archive fixture.
- Acceptance criteria for coverage: Use a valid Knowledge archive with the segment table definition but no segment table data and assert the live recovery verifier refuses to write `restore_verified`; positive control compares populated segment content/count and retrieval-critical relations.
- Related findings: `F-558` is generic empty/unreadable backup inventory certification and has a separate mechanism; F-DB-002 is n8n key recovery.
- Fix-site blast radius: Verifier/archive-fixture changes affect Infrastructure's Knowledge recovery contract and Knowledge-owned `knowledge.*` content. Keep the T5 drill schema-scoped; do not make it claim restoration of Skill Store's `skills.*` state.

### F-DB-002 — n8n backup omits external encryption-key recovery reference

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (Phase 1 database candidate)
- Affected modules: Infrastructure backup and n8n automation runtime
- Severity: Medium
- Status: Adjacent exclusion/preflight tests only; candidate remains pending triage.
- Root cause: Existing tests assert `config` is excluded and that the runtime key variable is required, but do not prove the matching key is securely retained/recoverable or that restored credentials work with it.
- Evidence: `tests/m5-docker-contract.test.mjs:226-247` asserts `backup.ps1` contains `--exclude=config`, digesting, archive-list and `pg_restore` operations. `tests/m5-docker-contract.test.mjs:140-165` and `infrastructure/docker/compose/compose.core.yml:80` cover presence of `N8N_ENCRYPTION_KEY` in automation preflight/runtime, but do not bind a backup to a recovery key reference. `tests/agent-setup-F-265.test.mjs:154-168` tests plaintext secret-carrier inspection; it does not test n8n credential decryption after restore. Candidate backup omission is `infrastructure/docker/scripts/backup.ps1:113-158`, key binding `compose.core.yml:80`, operator setting `README.md:444-448`.
- Reproduction: No n8n restore with a different/missing key was run; operator retention outside this repository is unverified.
- Acceptance criteria for coverage: In a disposable n8n restore, pair backed-up credential rows with the approved recovery-key source and assert credentials remain usable; ensure test output and archive manifest never reveal the key itself.
- Related findings: `F-558` concerns backup inventory/secret-inspection false certification, not whether encrypted n8n credentials can be decrypted after recovery. F-DB-001 is a separate Knowledge restore gate.
- Fix-site blast radius: Backup manifest/runbook/recovery changes affect Infrastructure backup handling and n8n credential recovery only. Preserve secret exclusion and do not add Knowledge or Skill Store schema ownership to the n8n recovery path.

## Shared-root, stale-fixture and gate disposition

- **One cross-reporter duplicate root:** F-INFRA-002 was independently reported by scan-infra-2 and scan-db-3; Phase 2 database review widens the evidence to the Skill Store `postgres` executor. Consolidate into the one privilege-boundary root, with both module clients in coverage. Do not count scan duplicates as separate test gaps.
- **Same candidate / additional sink:** F-OC-002 is one aggregate ZIP expansion candidate from scan-oc-2; the cross-check at `docs/execution/reports/p2/xcheck-oc-artifact.md:18-30` found a second unbounded Excel-writer reader. Add coverage for both parser sinks under the same resource-safety root.
- **Related, distinct mechanisms:** F-KB-003/F-576 (two-path identity collision vs one-path normalization), F-KB-004/F-573 (HTTP serialization vs loader fields), F-KB-002/F-431 (ALTER replay recognition vs DDL/ledger crash window), and F-OC-008/F-296/F-417 (hotfix transaction state vs generic fsync/committed-write behavior) must not be declared covered solely because adjacent items have tests.
- **Shared symptom, distinct roots:** F-KB-001 and F-KB-003 can both end at stale deletion but enter through sidecar omission versus normalized identity collision. F-OC-004/005/006 all concern concurrent writers but respectively exercise lock replacement after validation, same-ID decision conflict under writer lock, and ingress uniqueness across lookup/append. Regression coverage must target each interleaving and owner boundary.
- **Gate conclusion:** The required Node and Knowledge Python gates are wired as described above, and explicit test-list reconciliation prevents silent test omission. Gate presence does not supply missing behavioral fixtures. Docker-dependent Postgres cases can be NOT RUN; CI Python quality does not install the PDF runtime closure. No gate output was produced for this audit, so no pass/fail claim is made.
- **No behavior promotion:** The assessment above identifies unsupported test assertions/fixtures and coverage holes. It does not establish all conditional runtime outcomes through execution and does not change any candidate status in `docs/execution/findings.md`.
