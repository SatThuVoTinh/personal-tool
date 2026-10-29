# Phase 7 Recheck — Infrastructure <-> Skill Store and Tools Boundary

- **Mode:** Recheck
- **Finding IDs:** F-INFRA-002, F-SKILL-001, F-SKILL-002
- **Baseline:** R5 fix verified at HEAD via context.md; P2 audit at `85eb094`; R5 fix committed as `7570f73` (2026-10-27)
- **Result:** F-INFRA-002 FIXED. F-SKILL-001 remains LATENT (symlink path validation exists but residue cleanup predates catalog walk rejection). F-SKILL-002 needs owner decision—alias persistence mismatch was confirmed in P2/P3 but no fix committed yet. No boundary violations discovered. Modules remain independent.
- **Counts:** FIXED 1 (F-INFRA-002); LATENT 1 (F-SKILL-001); OPEN 1 (F-SKILL-002). Blockers: 0.

## F-INFRA-002 — shared PostgreSQL superuser access

- **Status:** FIXED
- **Fix commit:** `7570f73` (P5-01, done_verified in context.md:113)
- **What changed:** `bootstrap-postgres.sh` now creates `knowledge_app` and `skill_app` roles with LOGIN/NOSUPERUSER/NOCREATEDB/NOCREATEROLE; Compose passes role names instead of `postgres` user; Skills client `vector-sync.mjs:319-346` enforces `SKILL_DB_PASSWORD` requirement and connects as `skill_app`; n8n `CONNECT` on database `postgres` revoked from `PUBLIC`.
- **Evidence:** `infrastructure/docker/compose/compose.core.yml:155` uses `KNOWLEDGE_DATABASE_USER: knowledge_app`; `infrastructure/docker/scripts/bootstrap-postgres.sh:47-76` provisions both roles and grants schema ownership to respective users; `zink-skill-store/src/vector-sync.mjs:319-346` fails closed without `SKILL_DB_PASSWORD` and authenticates as `skill_app`; tests pass: `m11-t1-skill-vector-sql` 25 passed, `m3-t1-contract` + `m5-docker-contract` 13 passed, `bash -n` exit 0, eslint exit 0. Docker/live privilege checks NOT RUN on this host.
- **Boundary check:** Knowledge now owns `knowledge.*` objects and Skill Store owns `skills.*` objects via role-granted ownership; neither can access the other's schema without explicit grants (none provided). Blast radius analysis required `knowledge_app` changes affect Knowledge DB access and migrations (`apps/knowledge/app/database.py:453-459,2757-2819`) and `skill_app` changes affect Skill Store sync/migrations (`vector-sync.mjs`, `migrations.mjs`) plus Tools adapter that imports it (`skill-adapter.mjs:13-20`). Owner authorized cross-module edit for `vector-sync.mjs` (context.md:182, BLK-8 closed). Fix preserves architecture invariant: each module owns its schema/ledger, Tools is thin adapter only.
- **Verdict:** FIXED — cluster administrator reduced to routine module-specific roles, cross-schema access blocked by PostgreSQL role semantics. One privilege-boundary root cause resolved; blast radius respected.

## F-SKILL-001 — promotion residue healing follows a symlink

- **Status:** LATENT (unchanged since P2/P3)
- **Fix commit:** none — code review found `assertSafeStorePathComponents` validates components after realpath resolution, but `healWriterResidue` calls `readdir` and recursive `rm` before catalog walk rejection
- **Evidence:** `zink-skill-store/src/catalog.mjs:1392-1421` builds `parentDir`, calls `readdir(parentDir)` at line 1398, then checks entries via `assertSafeStorePathComponents` at lines 1403-1406. Validation happens AFTER the unsafe path component could be traversed by `recursive: true rm` at line 1407. Catalog walk refusal for symlinked root/intermediate occurs at lines 868-876 (UNSAFE_PATH) and 728-731/800-808 (DIRECTORY_GRAMMAR_INVALID), but `healWriterResidue` is called earlier at line 1832 during promotion staging. Tests `tests/m6-t1-skill-store.test.mjs:370-403,557-633` pin post-walk refusals only; `tests/agent-skill-F-580.test.mjs:118-314` never creates an outside target reached through identity symlink.
- **Root cause unchanged:** Cleanup resolves ancestry before realpath; a planted symlink escapes the store root and deletes matching directory outside `skillsRoot`. Same validation must cover `quarantineInvalidVersion` at lines 1452-1497.
- **Blast radius:** Fix here affects only Skill Store filesystem and promotion workflow. No cross-module boundary impact—Knowledge/Vault not implicated (no evidence naming Knowledge as target). Tools adapter sees fail-closed catalog outage if symlink present, not semantic-search loss.
- **Verdict:** PARTIAL — validation logic exists but executes too late in promotion flow. Code proof sufficient for LATENT status; test gap persists (no red/green probe). Not fixed because implementation would require restructuring promotion order or adding pre-sweep ancestry checks that respect canonical pair validation timing. Owner has not approved redesign of promotion lifecycle.

## F-SKILL-002 — namespace alias persistence mismatch in scoped search

- **Status:** OPEN (requires owner decision)
- **Fix commit:** none — defect confirmed but no band scheduled for remediation per context.md
- **Evidence:** Writer: `zink-tools/adapters/skill-store/skill-adapter.mjs:83-95,1110-1176` admits alias roots through `VETTED_ROOT_NAMESPACES` and keeps original `parsedNamespace`; `zink-skill-store/src/vector-sync.mjs:565-576,622-627` writes namespace verbatim. Query: aliases live in `semantic-contract.mjs:36-44,203-210`, resolver canonicalizes at `477-487`, adapter builds SQL predicate from resolved values at `skill-adapter.mjs:720-751`. Example: skill promoted with `['supply-chain']` (canonical → `lscm`), searches filtered by `lscm` become `['lscm']` while row stores `['supply-chain']`, so neither returns it. Tests `tests/m8-t1-skill-vector-memory.test.mjs:1031-1075` test alias metadata only; `tests/zink-tools-skill-namespace-binding.test.mjs:183-216` test authorization not persisted-alias SQL predicate; `tests/m11-t1-skill-vector-sql.test.mjs:135-227` captures SQL for `office` namespace only. No PostgreSQL probe run.
- **Acceptance criteria:** Valid skill written with approved namespace alias returned by scoped searches using that alias and its canonical namespace, OR admission rejects spelling before publishing skill; `discover`/`read`/`apply`/`search` arms must agree on one namespace-identity rule.
- **Fix options:** (a) Canonicalize stored namespace array to match query-side resolution, or (b) reject non-canonical namespace spellings at admission/proposal. Option (a) requires revising tombstone identity (`vector-sync.mjs:765-787`); option (b) requires proposal-admission contract change. Both have different blast radii on downstream consumers.
- **Blast radius:** Fix touches Skill Store writer (`vector-sync.mjs`) or Tools adapter (`skill-adapter.mjs`) and potentially Governance plugin approval (`zink-governance/index.mjs`). No Knowledge involvement. No database schema change required.
- **Verdict:** NOT FIXED — confirmed defect but no implementation work started. Requires owner decision on canonicalization strategy and whether to broaden scope of current Active Task wave. Band scheduling pending.

## Boundary summary

- **No new violations:** Re-check confirms three-phase consistency. No direct mutation of another owner state found. No shared env/config/ports/volumes beyond approved patterns. Backup coverage: `backup.ps1:7-13,101-110` dumps full `postgres` database (both schemas), `README.md:444-448` directs external operator retention of `N8N_ENCRYPTION_KEY` (F-DB-002 separate). Startup order/health: Compose handles dependency via `depends_on`; no circular health dependencies observed.
- **Module independence preserved:** Each module owns its schema/ledger (via role boundaries post-fix), Tools remains thin adapter boundary, Infrastructure owns runtime capability only. Cross-project effects use approved APIs/contracts.
- **Owner decision needed:** F-SKILL-002 requires explicit authorization for which fixer (Skill Store vs Tools) carries implementation and whether redesign of namespace-identity rule falls within scope.

**Final reply:** Report: docs/execution/reports/p7/xcheck-infra-skill-tools.md | FIXED 1 (F-INFRA-002) | LATENT 1 (F-SKILL-001) | OPEN 1 (F-SKILL-002) | Blockers 0 | Boundary integrity maintained across all three findings.
