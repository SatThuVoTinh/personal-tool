# Phase 3 triage — bucket 03, loop 1

- Assignment: adversarially verify register candidates `F-KB-001` and `F-KB-002`.
- Baseline: dispatch HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, pre-existing dirty working tree. `git status --short` and `git diff` were denied to this lane (`permission.rejected: shell`); all evidence below was re-read from the checked-out files at `2026-10-26 22:xx +07:00`. No source, register, or context file was edited.
- Method: read root `AGENTS.md`; `glob **/AGENTS.md` found no nested contract. Re-read register rules and taxonomy (`docs/execution/findings.md:17-67`), candidate rows (`docs/execution/findings.md:2059-2083`), production call paths, shipped migrations and tests, plus `scan-kb-1`, `scan-kb-2`, `xcheck-kb-skill`, `xcheck-infra-kb`, `xcheck-db-all`, and `xcheck-tests-all`.
- Result: 2/2 mechanisms confirmed; one register severity is understated, the other is latent/conditional. No duplicate disposition was warranted.

## Verdict summary

| ID | Disposition | Post-triage severity | Red | Fixer | Blocker |
| --- | --- | --- | --- | --- | --- |
| F-KB-001 | UNDERSTATED — mechanism CONFIRMED; Medium understates silent derived-data loss | High | NO | `fix-knowledgebase` | None |
| F-KB-002 | CONFIRMED-AS-LATENT — code path proven; no live missing-ledger state or disposable-PostgreSQL proof | Medium | YES | `fix-knowledgebase` | None |

Counts: High 1, Medium 1, root-cause 0, rejected 0, blockers 0.

---

### F-KB-001 — an oversized PDF sidecar is silently skipped and its previously indexed PDF is deleted as stale

- Category: F5 — Data Integrity & Result Correctness
- Legacy register id: — (new Phase 1 candidate; source report `CAND-kb-1-01`)
- Affected modules: Zink Knowledgebase
- Severity: High — post-triage regrade from the register's Medium. The result is unattributed deletion of indexed source and segment rows, not merely a degraded or diagnostic gap.
- Status: UNDERSTATED — mechanism confirmed. The register correctly names the path but understates its consequence. It is not REFUTED, LATENT, or a duplicate.
- Root cause: `discover_pdf_sidecars()` treats every sidecar larger than `MAX_SIDECAR_BYTES` as if it does not exist (`apps/knowledge/app/pdf_foundation.py:27,255-262`). It neither raises a `PdfFoundationError` nor records a per-source error and therefore does not propagate the referenced PDF path. `IndexLifecycle.execute()` then constructs the published manifest solely from successful Markdown sources and returned sidecars (`apps/knowledge/app/index_lifecycle.py:147-152,210-219`). The incremental publication path classifies every existing shadow source absent from that manifest as stale and deletes it (`apps/knowledge/app/index_lifecycle.py:418-435`; `apps/knowledge/app/database.py:2183-2211`).
- Evidence:
  - `apps/knowledge/app/pdf_foundation.py:27`: `MAX_SIDECAR_BYTES = 64 * 1024`.
  - `apps/knowledge/app/pdf_foundation.py:255-262`: an oversized sidecar executes bare `continue` before parsing. The later explicit `PDF_SIDECAR_TOO_LARGE` path at `:174-178` belongs to `parse_pdf_sidecar()` and is bypassed by this skip.
  - `apps/knowledge/app/index_lifecycle.py:147-163`: only a raised `PdfFoundationError` becomes a run error and marks discovery failed. A silently skipped file is indistinguishable from absence.
  - `apps/knowledge/app/index_lifecycle.py:195-204`: the empty-snapshot guard runs only when there are no Markdown sources, no returned sidecars, and a non-empty active index. It does not protect the normal mixed-corpus case or a run with another valid source.
  - `apps/knowledge/app/database.py:1656-1663`: `source_hashes()` returns every source path in the incremental shadow index. `accept_incremental()` first clones live rows into that shadow at `:1518-1570`, so the previously indexed PDF is genuinely present in `existing`.
  - `apps/knowledge/app/index_lifecycle.py:210-219,418-435`: unchanged valid PDF entries absent from the new manifest enter `set(existing).difference(manifest)` and are passed to `complete_incremental()`.
  - `apps/knowledge/app/database.py:2200-2211`: stale paths are deleted from `knowledge.sources`. Cascade ownership removes the indexed segments at `apps/knowledge/migrations/001_initial.sql:136-141`, sidecar records at `:87-96`, and PDF details at `apps/knowledge/migrations/002_pdf_ingestion_foundation.sql:71-82`.
  - Error/defer countercheck: no `PDF_SIDECAR_TOO_LARGE` error is emitted, so `scan_failed` remains false and the incremental gate at `index_lifecycle.py:418-428` allows publication. The explicit oversized-PDF behavior is different: `pdf_foundation.py:226-227` raises `PDF_FILE_TOO_LARGE`, which `index_lifecycle.py:147-163` records as discovery failure and defers on an incremental run. That difference is precisely the candidate's defect.
  - Test coverage countercheck: `apps/knowledge/tests/test_pdf_foundation.py:101-114` covers the raised oversized-PDF path, not the silently skipped oversized sidecar. `apps/knowledge/tests/test_index_lifecycle.py:279-290` proves generic stale-path calculation; no test combines a retained previously indexed PDF with an oversized sidecar. The absence of a red test is a coverage gap, not counter-evidence.
- Reproduction: Start from a disposable fixture with an indexed PDF at `02. Books/<topic>/book.pdf` and a valid sidecar at `02. Books/<topic>/book.md` that contains its embed and required topic tags. Add at least one other valid source so the empty-snapshot guard cannot stop the run. Increase only the sidecar beyond 64 KiB while preserving its required embed content, then execute `INCREMENTAL`. Discovery omits the sidecar without adding an error; the stale set contains the unchanged PDF path, and `complete_incremental()` deletes its source/segment rows. Probe status: NOT RUN — this lane has no authorized Vault/database mutation and shell commands were denied. The static call path is nonetheless complete.
- Acceptance criteria: An oversized sidecar must either be reported as a source-scoped discovery/indexing error or otherwise preserve the already-indexed PDF it owns. A routine incremental run must not classify that PDF as removed when the PDF and sidecar files are both still present. A regression must begin with the PDF indexed, enlarge only its sidecar beyond 64 KiB, run incremental publication, and assert that the prior source and segments survive or the named source error defers publication.
- Red: NO — this restores the lifecycle's established fail-closed rule that a successful publication must reflect every still-present indexed source and an incomplete/uncertain scan must not prune existing rows. It does not by itself alter architecture, ownership, public API, schema/migration semantics, persistence topology, dependencies, security boundary, or the resource ceiling.
- Fixer and files: `fix-knowledgebase`. Expected files: `apps/knowledge/app/pdf_foundation.py`, `apps/knowledge/app/index_lifecycle.py`, and regression coverage in `apps/knowledge/tests/test_pdf_foundation.py` and `apps/knowledge/tests/test_index_lifecycle.py`. `run_errors.py` or `database.py` should be touched only if the chosen design introduces a named source error; do not weaken the correct stale-deletion transaction as the fix.
- depends_on: none.
- root_cause_of: none. It shares the stale-deletion sink with `F-KB-003`, but F-KB-003's NFC identity collision is a different entry mechanism, not a symptom of this row.
- Lineage / duplicate check:
  - Not `DUPLICATE-OF` **F-440** (`R9-L09-4`). F-440 is closed in `CHANGELOG.md:2136-2137` and concerns an oversized PDF source raised before hashing; it deliberately records an explicit discovery error. The current sidecar skip is silent.
  - Not `DUPLICATE-OF` **F-443**. F-443 (`R9-T06-1`) concerns terminal PDF content-build retention (`CHANGELOG.md:2225-2226`), not source discovery or incremental stale deletion.
  - Not `WRONG-SITE`. The omission originates in Knowledge sidecar discovery; Infrastructure and Skill Store are not on the causal path.

### F-KB-002 — replaying an already-applied ALTER migration with a missing ledger row blocks Knowledgebase startup

- Category: F3 — State & Lifecycle Integrity
- Legacy register id: — (new Phase 1 candidate; source report `CAND-kb-2-01`)
- Affected modules: Zink Knowledgebase
- Severity: Medium — confirmed conditional startup outage. The current code path prevents the process from becoming ready only when an applied migration's ledger row is absent; it is not evidence of a normal boot failure in every deployment.
- Status: CONFIRMED-AS-LATENT — mechanism proven statically. The register's HYPOTHESIS status is upgraded; no live PostgreSQL replay was run.
- Root cause: Knowledge replay recovery accepts a duplicate-object error only if the migration file yields a non-empty list of parsed CREATE objects and all of them already exist (`apps/knowledge/app/database.py:2874-2901`). The object parser recognizes only `CREATE UNIQUE INDEX|INDEX|TABLE|TYPE|SCHEMA|EXTENSION` (`:137-155`). Shipped migrations 004 and 005 are pure `ALTER TABLE ... ADD COLUMN`; their replay raises duplicate-column SQLSTATE `42701`, already included in the recovery set (`:127-133`), but the parser returns no objects and `_migration_is_already_applied()` returns false (`:2888-2892`). The caller re-raises, startup records `DATABASE_UNAVAILABLE` (`:483-492`), and the reconnect loop repeats the same migration/rejection (`:516-561`).
- Evidence:
  - `apps/knowledge/app/database.py:2790-2796`: every `.sql` file without a matching `knowledge.schema_migrations.version` row is replayed.
  - `:2797-2815`: the migration transaction catches `asyncpg.PostgresError`; unrecognized failures re-raise.
  - `:2816-2819`: the ledger INSERT is separate from the migration transaction.
  - `:127-133`: recovery accepts SQLSTATES `42P06`, `42P07`, `42701`, and `42710`.
  - `:137-142`: the regex starts with `CREATE\s+...`; `:145-155` only iterates that pattern. It genuinely does not parse ALTER statements.
  - `:2888-2892`: after a duplicate-column error, `objects = _migration_objects(sql)` and `if not objects: return False`.
  - `apps/knowledge/migrations/004_pdf_build_failure_cause.sql:12-15`: `ALTER TABLE knowledge.pdf_content_builds ADD COLUMN failure_cause ...`.
  - `apps/knowledge/migrations/005_schema_migration_digest.sql:17-18`: `ALTER TABLE knowledge.schema_migrations ADD COLUMN digest ...`.
  - Migration census: the accepted Knowledge set contains only `001_initial.sql`, `002_pdf_ingestion_foundation.sql`, `004_pdf_build_failure_cause.sql`, and `005_schema_migration_digest.sql`. Case-insensitive searches found no CREATE object pattern in 004 or 005; 001 and 002 each contain multiple CREATE statements. Thus 004 and 005 are the only currently shipped Knowledge migrations with the empty-object recovery shape. This scope statement is version-specific: future pure-ALTER migrations inherit the same flaw until the runner is fixed.
  - `apps/knowledge/app/database.py:483-492`: the exception is collapsed to `DATABASE_UNAVAILABLE`; `:516-561` retries the same boot path after the five-second interval. No counter-evidence was found that an ALTER replay self-repairs.
  - Test coverage countercheck: `apps/knowledge/tests/test_m11_index_hygiene.py:440-491` tests recovery only for a fixture migration made of CREATE TABLE/CREATE INDEX statements. It proves the existing recovery heuristic but cannot exercise `42701` or an ALTER object list. No shipped test applies 004/005, deletes only its ledger row, and restarts. The gap confirms why the candidate had not already been caught.
  - Lineage countercheck: the closed R5-E03-01 repair created the CREATE-only replay heuristic (`CHANGELOG.md:1553-1554`; self-tagged at `database.py:2801-2811`). Its own test fixture at `test_m11_index_hygiene.py:441-468` deliberately models CREATE. This is a residual uncovered shape, not a duplicate of the closed row.
- Reproduction: On a disposable PostgreSQL database, apply through migration 004 or 005. Confirm the added column exists, then delete only that file's row from `knowledge.schema_migrations` without changing schema objects. Start the Knowledge database runner. Expected PostgreSQL fault is `42701` duplicate_column; `_migration_objects()` returns `[]`, recovery returns false, and startup transitions to `DATABASE_UNAVAILABLE`. Probe status: NOT RUN — database mutation is outside this read-only triage lane and shell/PostgreSQL access was unavailable.
- Acceptance criteria: Replay recovery must distinguish a fully applied ALTER migration from a partial/drifted schema and repair the missing ledger row idempotently. For 004, verify `knowledge.pdf_content_builds.failure_cause` and its intended CHECK constraint; for 005, verify `knowledge.schema_migrations.digest` and its intended CHECK constraint. Any missing required column/constraint must still abort. Add a disposable PostgreSQL red-before/green-after case for each migration plus a partial-schema negative case; a mocked CREATE-only replay test is insufficient.
- Red: YES — any change here modifies migration replay, schema verification and ledger-repair semantics, expressly within `AGENTS.md` §7. The smallest sound alternative is owner-decision between (a) making Knowledge's migration apply plus ledger insert atomic with an idempotent ledger write, while retaining a targeted ALTER verification hook, or (b) extending the existing duplicate-object recovery with an explicit, forward-compatible ALTER verification form. Do not simply treat every duplicate-column error as applied; that could falsely stamp a partial schema.
- Fixer and files: `fix-knowledgebase`. Expected files: `apps/knowledge/app/database.py` and `apps/knowledge/tests/test_m11_index_hygiene.py`; a disposable PostgreSQL gate should target the relevant migration test/suite identified during fix. Do not edit migration bytes in place because digest pins are contract inputs.
- depends_on: none as a prerequisite to repair this recovery gap. **F-431** is a related upstream mechanism and may remove one way of creating the missing row, but a repaired/excluded ledger or renamed migration still triggers this independent flaw.
- root_cause_of: none.
- Lineage / duplicate check:
  - Not `DUPLICATE-OF` **F-431** (`R9-L06-6`). F-431 concerns DDL/ledger atomicity and concurrent first-run behavior (`docs/execution/findings.md:889-900`). This row concerns whether a missing-row replay is safely recognized; their fixes are complementary, not the same mechanism.
  - Not `DUPLICATE-OF` closed **F-166** (`R5-E03-01`). That closed repair introduced the CREATE-only recovery heuristic; this candidate reports its uncovered ALTER shape.
  - Not `F-440` or `F-443`; neither concerns migration replay.
  - Not `WRONG-SITE`. Although the Infrastructure T5 acceptance drivers reject the newer migration set under `F-INFRA-004`, the runtime recovery defect and its repair belong to the Knowledge runner, per `xcheck-kb-skill.md:18-23` and `xcheck-infra-kb.md:78-89`. Skill Store migrations and its separate `skills.schema_migrations` runner must not be made a Knowledge recovery target; its current runner already performs DDL+ledger in one transaction at `zink-skill-store/src/migrations.mjs:246-266`.

## Cross-lane consistency

- `scan-kb-1` and `scan-kb-2` named the candidate mechanisms at their dispatched working tree; `xcheck-kb-skill` (`:11-24`) and `xcheck-db-all` (`:53-65`) rechecked the paths and confirmed module ownership without shared Skill Store state.
- `xcheck-infra-kb` (`:16-17`, `:78-89`) confirms F-KB-002's startup observation through `/healthz` but does not relocate the defect to Infrastructure.
- `xcheck-tests-all` (`:48-74`) confirms both candidate paths have only adjacent/CREATE coverage, and correctly warns that neither existing green test proves the F-KB-001 sidecar case nor a pure ALTER replay case.
- The P1/P2 lanes did not execute tests, PostgreSQL, Docker, or Vault probes. Their static findings remain valid, but this triage deliberately stops short of claiming live runtime reproduction.

## Blockers and next action

- Assignment blockers: 0. Both mechanisms are established from current source; missing live probes qualify status and test obligations rather than refuting either row.
- Verification gaps: no shell/Git diff access, disposable PostgreSQL replay, or Vault/index probe was permitted in this lane.
- Recommended routing: `F-KB-001` proceeds as a High Knowledge data-integrity fix (GREEN). `F-KB-002` remains Medium latent but requires an owner RED decision on migration-replay/ledger semantics before implementation.
