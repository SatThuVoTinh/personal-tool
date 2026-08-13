# Changelog

All notable, validated changes to Personal Tool are documented here.

`CHANGELOG.md` records completed work only. It is not a roadmap, task list, development status, or architecture proposal.

## [Unreleased]

### Added

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
