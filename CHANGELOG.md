# Changelog

All notable, validated changes to Personal Tool are documented here.

`CHANGELOG.md` records completed work only. It is not a roadmap, task list, development status, or architecture proposal.

## [Unreleased]

### Added

- Completed locally verified M8/T2-R9 Governed Runtime, Authority, Memory & Reliability Hardening:
  established the strict 5-tuple action authority engine (`validateActionAuthority` in `integrations/openclaw/lib/authority.mjs`) enforcing that User is the sole final authority for plan approvals and result acceptance, routing actions across dedicated channels (`#office`, `#approvals`, `#results`, `#incidents`), and strictly prohibiting specialists from executing governance actions (`SPECIALIST_NO_GOVERNANCE`); decoupled technical execution finish from task completion so that `EXECUTION_FINISHED` transitions tasks to `RESULT_PENDING_REVIEW` and never directly to `COMPLETE`; built persistent file-backed `QueueManager` with atomic single-worker claims (`claimTask`), lease heartbeat renewal (`recordHeartbeat`), and automatic stale task recovery (`detectAndRecoverStaleTasks`), cleanly decoupling the 24/7 Control Plane from Local Laptop Worker sleep/reconnect cycles; implemented two-tier `evaluateResultGate` in `integrations/openclaw/lib/artifact-validator.mjs` verifying technical structure and enforcing the critical invariant that Technical PASS + Business FAIL yields `RESULT BLOCKED` with real data previews and zero synthetic mocks; implemented human-confirmed `DecisionLedger` (`integrations/openclaw/lib/decision-ledger.mjs`) caching confirmed operator answers and preventing redundant clarifying questions; established structured reference IDs conforming to `TOPIC(2)-EXEC(2)-TASK(4)` (`00` reserved for human-contributed documents) with retrieval context deduplication (`deduplicateRetrievalContext`) in `zink-tools/common/semantic-contract.mjs`; added governed Discord message and card formatters (`formatOfficeClarificationQuestion`, `formatOfficeFinalNotification`, `formatGovernedApprovalCard`, `formatGovernedResultCard`, `formatIncidentCard`); updated OpenClaw `zink-governance` plugin with stale-attempt protection (`STALE_ACTION_REJECTED`) and full asset materialization in `governancePluginFiles`; authored comprehensive 12-bug audit register (`tests/m8-t2-governed-runtime-audit.test.mjs`) and 20-scenario E2E workflow and failure injection suite (`tests/m8-t2-e2e-workflow.test.mjs`), validating all 156 unit and contract tests pass with zero regressions.

- Completed locally verified M8/T1 Governed Skill Store & Knowledgebase Semantic Vector RAG + 2-Way Memory:
  implemented PostgreSQL schema `skills` with `catalog_index`, `segments`, and 1024-dimension HNSW cosine vector index (`skills_segments_embedding_hnsw_idx`); established the shared canonical semantic contract (`zink-tools/common/semantic-contract.mjs`) with deterministic envelopes (`renderEmbeddingEnvelope`, `computeEmbeddingInputHash`) preserving raw content while structuring domain/topic envelopes for BGE-M3 embeddings; implemented Git-to-PostgreSQL vector synchronization (`zink-skill-store/src/vector-sync.mjs`) with fail-closed active catalog validation and source drift detection; added governed callable tool interfaces for `zink_skill_search` (vector cosine similarity, ACTIVE-only), `zink_skill_propose` (human-in-the-loop candidate proposal via `#approvals`, strictly preventing direct promotion to ACTIVE), and `zink_knowledge_search` (hybrid search proxying to Knowledgebase container with citation provenance); implemented Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`) with immutable content hash binding; updated OpenClaw RBAC policy granting retrieval to all 7 agents and proposal capabilities to specialists and O1; fixed Discord Mobile mention resolution (handling raw snowflakes `<@ID>` and `<@!ID>` with corrected punctuation lookahead) and eliminated Discord 50035 errors with `replyToMode: "off"`; validated 11 automated test scenarios (`tests/m8-t1-skill-vector-memory.test.mjs`) and confirmed all 123 repository tests pass with zero regressions.

- Added Discord Multi-Bot Gateway operation guide, 7-bot directory with Snowflake IDs, Linux TCP keepalive settings (60s idle threshold to eliminate 2-hour Discord dropping), sandbox tool policy admitting specialist tools into isolated containers, and Discord Mobile multi-format mention protocol (handling raw snowflake mentions, nickname mentions, and Vietnamese natural text regex matching) in `README.md`.

- Completed remotely backed M7/T5-R13 Zink Runtime Governance Remediation & Capability Enforcement:
  remediated multi-agent Discord ingress task collision with deterministic per-agent `deriveTaskId`; registered full JSON Schema parameter definitions for all 5 callable Zink tools (`zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, `zink_n8n`); enforced specialist tool allowlists (`alsoAllow`) in `openclaw.json` granting designated tools to Excel, Power BI, SQL, Python, and O2 while preserving minimal sandbox isolation; added Vietnamese natural conversational Discord message formatting hook; fixed CI shallow clone depth and `smol-toml` vulnerability advisory; verified all 173 repository tests passed and GitHub Actions CI and Security workflows passed remotely on `codex/m7-t5-governance-remediation` at commits `4037187` and `8e71759`.

- Completed remotely backed M7/T3-R16 Zink Tools Governed Callable Interfaces & Adapter Contracts:
  implemented Model A (Virtual / Contract Tool Interface) for 5 callable tools (`zink_excel`, `zink_power_bi`,
  `zink_sql`, `zink_python`, `zink_n8n`) and 4 deferred schema-only capabilities (`zink_forecast`, `zink_optimization`,
  `zink_operations_research`, `zink_simulation`); established closed invocation and result envelopes,
  Option A self-contained tool branches, pure logical path safety (`validateArtifactLogicalPath`), Lean single-statement
  SQL validation with injective parameter binding (`validateSqlQuery`), loopback-only governed n8n webhook adapter
  (`invokeN8n`), dual authorization paths (read-only for SQL vs delegated for specialists), authenticated approval
  ledger resolution with atomic anti-replay protection, deterministic `ENGINE_NOT_IMPLEMENTED` 4-tuple contract seam,
  and host tool registration on branch `codex/m7-t3-tools-contracts` at implementation commit `ac68bce0653ad3c4bfcc8d230960bcdcf7e8f71d`.

- Completed remotely backed M7/T2-R12 OpenClaw native governance runtime: attached
  trusted governance guard to native pre-tool callback and child delivery paths,
  enforced atomic ledger reservations, parent-turn yield contracts, bounded
  subagent delegations, and pre-announce acceptance vetoes; verified reversible
  native patching and full rollback (`T1_RESTORED`) via `operator-rollback.mjs` and
  `operator-apply.mjs`; passed 112 unit tests and all 8 live governance probe stages
  (7 direct role checks and nested 7-role workflow with 6 accepted children) on branch
  `codex/m7-t2-agent-topology` at implementation commit `4872314c686bcc92797acc68483b8b68fe4ee8ca`.

- Completed remotely backed M7/T2-R11 OpenClaw governance runtime: five-stack
  topology and hard spawn allowlists, exact pinned `2026.6.34` capability policy,
  model-invisible `zink-governance` hooks, append-only trusted ledger with atomic
  budgets, strict execution/result/reference schemas, canonical identity hashes,
  state/retry/cancellation/supersession rules, secret-redacted bounded handoffs,
  layered generated AGENTS contracts, rollback backup manifest, and focused/full
  repository gates on `codex/m7-t2-agent-topology`.
- Added the remotely backed M7/T2-R11 verifier correction: live OpenClaw probes
  use bounded process groups, forced timeout cleanup, batched execution, and
  asynchronous JSON checks so a hung child cannot stall the verifier indefinitely.
- Completed the M7/T2-R11 live-gate hardening: gateway-secret resolution uses the
  same bounded process-group runner, OpenClaw probes run sequentially to avoid
  shared-runtime contention, and the full exact-`2026.6.34` live matrix passed.
- Completed locally verified M7/T1-R16 OpenClaw foundation: seven isolated
  minimal-tool agents and Discord bot accounts across one owner-only text channel
  and three forums, 21 partitioned Google profiles, restricted Docker sandboxes,
  fail-closed plugin/command/model policy, encrypted password-store resolution,
  systemd service controls, and semantic live verification of all 28
  account/surface permission pairs.
- Completed M6/T1-R4 Git-native governed Skill Store core: strict duplicate-key
  rejecting JSON manifests, raw-byte SHA-256-bound UTF-8 Markdown, complete
  fail-closed catalog validation, exact ACTIVE retrieval, deterministic offline
  diagnostics, and the read-only `skill-store` CLI.
- Completed locally verified M4 PDF ingestion at candidate `0a64b0b`: sidecar-driven native/scanned PDF extraction and OCR, deterministic page-local prose/table/figure segments, resumable and drift-safe atomic publication, combined Markdown/PDF retrieval with page citations, and current README operator instructions; exact-candidate Fixture/T3/T4 and five representative real PDFs passed without failed batches or duplicate source publication.
- Added locally validated M4/T2 PDF content builds: exact encrypted/protected/corrupt preflight, bounded four-page offline extraction and multilingual OCR, reading-order text/table/figure materialization, deterministic retrieval-budget segmentation with exact bbox provenance, source-drift and cumulative-deadline containment, process-group cleanup, and atomic non-searchable database batches.
- Added validated M3/T5 acceptance and operational handoff: an exact-clean-HEAD OCI-provenanced Knowledge image, isolated ownership/cleanup, machine-readable Fixture/RealVault/live evidence, candidate/deployment fingerprint separation, read-only Vault proof, migration/recovery checks, persistent rebuild safeguards, resource windows, and the Knowledge operations runbook.
- Added validated M3/T4 hybrid retrieval and ONNX reranking: filtered HNSW and FTS candidates, deterministic RRF, batched dynamic-INT8 reranking, source-line citations, capacity limits, and resource-gated runtime acceptance.
- Added validated M3/T3 index lifecycle: persistent run acceptance before `202`, incremental document replacement, side-by-side full rebuild publication, immutable model-identity gates, guarded deletion, atomic terminal transitions, restart recovery, bounded safe errors, and internal run-status APIs.
- Added locally validated M3/T2 Markdown discovery and retrieval-safe segmentation: deterministic all-or-nothing scan results, strict topic/native-tag validation, frontmatter and Markdown lexical handling, read-only path/link containment, original-line coordinates, heading-aware passages, pinned tokenizer artifacts and `uv` dependencies, actual query/passage pair-budget enforcement, and isolated Linux plus Windows-native acceptance.
- Added validated M3/T1 Knowledge-service foundation: an internal-only FastAPI/Uvicorn container; idempotent `knowledge` schema for indexes, runs, sources, sidecars, and segments; one ACTIVE-index constraint; BGE-M3 digest/dimension readiness guard; orphan-run interruption recovery; advisory-lock background-run coordination; and isolated container acceptance without Vault access.
- Established the local Git repository, private GitHub remote, and documented development conventions for M1/T1.
- Added a pinned Node/npm quality baseline with reproducible formatting, linting, testing, and repository-policy verification for M1/T2.
- Added isolated Git-fixture tests for sensitive-file allowlists, working-tree whitespace, Git whitespace, required files, and command placeholders.
- Added CI and Security workflows with exact Node 24.15.0/npm 12.0.2 provisioning, high/critical dependency audit, full-history Gitleaks scanning, and immutable Action pins for M1/T3.
- Added YAML 1.2 semantic workflow-contract validation with focused unit coverage for executable commands, ordering, permissions, Action pins, and Gitleaks safeguards.
- Added the validated M2/T1 AIStor Free and Ollama runtime preflight, including digest-pinned server/client images, ignored license and credential validation, and an ephemeral in-network `mc` S3 smoke test.
- Added validated M2/T2 core storage: digest-pinned PostgreSQL + pgvector and Redis, idempotent n8n database bootstrap, named-volume AIStor/PostgreSQL persistence, and recreation verification proving Redis remains transient.
- Added validated M2/T3 local integration: digest-pinned n8n and Nginx, PostgreSQL-backed n8n state with a persistent `.n8n` volume and required stable encryption key, loopback-only health/default-deny endpoints, container-to-host Ollama smoke, and recreation verification of encrypted synthetic n8n credentials.
- Added validated M2/T4 observability: digest-pinned Prometheus, Grafana, Dozzle, PostgreSQL exporter, and Redis exporter; repository-provisioned infrastructure metrics dashboard; loopback-only UIs; and verified target, log-filter, resource, OOM, and restart gates.
- Added validated M2/T5 operations and isolated acceptance: cumulative regression, logical PostgreSQL archives, S3-layer object backup/index with checksum and tags, protected `.n8n` archive, checksum manifest, acceptance-only restore guard, and a passing destroy-volumes → clean-recreate → restore verification of PostgreSQL, AIStor, n8n, encrypted credentials, and transient Redis behavior.

### Changed

- Completed M5/T1-R2 architecture contraction: synchronized the three peer Zink modules and reserved OpenClaw boundary, rewrote the Vietnamese operator README, reduced Docker to PostgreSQL/Knowledge/Nginx/n8n/Dozzle profiles with a 6.5 GiB maximum ceiling, retained constrained Dozzle and reusable PostgreSQL/n8n backup logic, and retired unused ZAS/Data Plant runtime, AIStor, Redis, Prometheus/Grafana/exporter configuration. Implementation `4a331d7` and closeout `2ad4247` are remote-backed on `origin/codex/architecture-sync-m4`; repository, Knowledge and isolated runtime gates passed.
- Recorded M3/T5 and M3 remote completion: accepted candidate `ff4a5fb` passed failure cleanup, Fixture, RealVault isolated, persistent live acceptance, and 60 repository/contract tests; PR `#15` merge `9cd34ce` preserved the accepted SHA and is backed by successful GitHub CI run `31894926039`, Security run `31894925985`, and the exact-main remote gate.
- Recorded M3/T4 remote validation: PR `#12` merge `aa73b06` is backed by successful GitHub CI and Security runs after 53 Python tests, 55 repository/contract tests, builder/runtime acceptance, predecessor regressions, and cumulative M2 backup/restore regression.
- Recorded M3/T3 remote validation: PR `#10` merge `242bca8` is backed by successful GitHub CI and Security runs after 42 Python tests, 51 repository/contract tests, isolated M3/T1–T3 acceptance, Windows-native junction/reparse coverage, and cumulative M2/T1–T5 backup/restore regression.
- Recorded M3/T2 remote validation: PR `#8` merge `b446ff1` is backed by successful GitHub CI and Security runs after its 22 Python/golden tests, isolated read-only and Windows-native acceptance, M3/T1 regression, and cumulative M2/T1–T5 local acceptance checks.
- Recorded M3/T1 remote validation: merge `4097862` is backed by successful GitHub CI and Security runs after its isolated M3/T1 and cumulative M2/T1–T5 local acceptance checks.
- Updated backup manifests to record a locally built service image's immutable local image ID when it has no registry digest, preserving M2 backup/restore compatibility after adding the Knowledge container.
- Consolidated the approved V1 roadmap into one authoritative M3 architecture contract, recorded the verified remote M2 backup/CI evidence, and aligned the README with the Markdown-only M3 boundary and deferred multimodal roadmap.
- Replaced the Makefile placeholder with functional quality-gate targets backed by npm scripts and a committed lockfile.
- Replaced the initial partial scaffold with the approved Personal Tool architecture.
- Centralized observability under `infrastructure/observability/`.
- Separated document-oriented Knowledge RAG from L&SC Data Product RAG.
- Added cross-platform tests, experimental workspaces, and CI workflow placeholders.
- Replaced the CI, Security, and redundant test-workflow placeholders with the validated `CI / quality-gate`, `Security / dependency-audit`, and `Security / secret-scan` checks.
- Hardened the reviewed M2 runtime with automatic recovery for long-running services, graceful durable-service shutdown, bounded Docker logs, PostgreSQL shared memory, explicit n8n execution pruning/concurrency/display limits, bounded transient Redis memory with LRU eviction, Prometheus retention capped at 7 days or 512 MiB, and Grafana panels for PostgreSQL size and Redis memory pressure.
- Made normal M2 startup use locally cached immutable images instead of forcing a registry pull; image refresh remains an explicit validated `build.ps1` operation.
- Changed PostgreSQL backup/restore to operate directly on the mounted backup directory, preflight archives before destructive restore, restore with two workers, and run `ANALYZE` afterward so large archives no longer require duplicate staging space in the container writable layer.
- Aligned the eight requested M2 service memory ceilings and raised the global WSL2 VM cap to 9.5 GiB, reserving 2 GiB above their combined 7.5 GiB ceiling.

### Fixed

- Fixed truncated OpenClaw Discord replies across all seven bots by backporting
  exact-version Gemini terminal-stream recovery and suppressing errored partial
  answer, reasoning, and final-evidence payloads. The patch is hash-guarded,
  reversible, enforced before service start, and validated by 81 repository
  tests, 60 live gates, and three owner-observed all-seven Discord runs.
- Hardened the M6 Skill Store validator to stop before decoding oversized
  content, reject URI-shaped repository references, suppress partial catalogs,
  preserve operational error classification, and order diagnostics without
  locale dependence.
- Isolated T5 Nginx now uses a validated ephemeral loopback port, remote evidence resolves exact workflow-run IDs, and schema-present live recovery dumps run inside operational PostgreSQL without Compose helper reconciliation.
- Made partial validation startups eligible for cleanup, added a bounded retry for transient AIStor marker writes immediately after bucket readiness, and made acceptance fail if its isolated project or volumes cannot be destroyed, preventing leaked test stacks, flaky recreation checks, and false backup/restore passes.

---

## Changelog Rules

### Completed Changes Only

An entry may be added only after the corresponding task reaches its Definition of Done in `PLAN.md`.

Do not record:

- planned work;
- work in progress;
- blocked work;
- placeholders;
- empty directories;
- unverified code;
- speculative architecture;
- future milestones.

### Categories

Use the following categories:

- `Added` — new validated functionality.
- `Changed` — validated changes to existing functionality.
- `Fixed` — validated bug fixes.
- `Security` — validated security improvements or fixes.

### Source of Truth

`PLAN.md` is the authoritative source for:

- current progress;
- Active Task;
- milestone status;
- component status;
- dependencies;
- completion evidence.

`CHANGELOG.md` is only the historical record of changes that have already been completed and validated.

Do not use this file to determine what should be implemented next.

### Evidence

Every changelog entry must correspond to verified repository state.

A file, directory, configuration declaration, placeholder, or documentation entry does not by itself prove that functionality is implemented.

Validation evidence is maintained in `PLAN.md`.

### Update Timing

When a task reaches Definition of Done:

1. update `PLAN.md`;
2. record the completion evidence;
3. add the corresponding changelog entry;
4. keep these changes in the same change set whenever practical.

Do not add a changelog entry before validation is complete.

This file records material architectural changes rather than individual commits.
