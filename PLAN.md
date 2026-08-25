# Personal Tool / Zink Knowledgebase — Development Plan

## 1. Authority

`PLAN.md` is the durable source of truth for milestone/task lifecycle state, the
one Active Task, dependencies, approval, execution authorization, the current
execution-contract pointer, blockers, and completion evidence.

When execution is authorized, `docs/contracts/execution/ACTIVE.md` is the sole
source of truth for that task's frozen implementation details. `PLAN.md` does not
duplicate the full executable plan.

Supporting authority is split deliberately:

- `AGENTS.md` — repository-wide agent behavior and safety;
- `docs/architecture/` — canonical architecture and ownership;
- `docs/contracts/` — persistent API/data/runtime/source-processing contracts;
- `docs/contracts/execution/README.md` — execution-contract lifecycle protocol;
- `docs/runbooks/` — operator procedures;
- `CHANGELOG.md` — validated completed history only.

Planning never authorizes implementation. Target trees and future milestones are
not implementation evidence.

## 2. Status model

Execution status:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
DEFERRED
CANCELLED
```

Planning and evidence are tracked separately:

```text
Planning Readiness: DRAFT | REVIEWED | APPROVED
Plan Revision: NONE | <task>-R<n>
Execution Authorization: NO | YES
Execution Contract: NONE | docs/contracts/execution/ACTIVE.md
Evidence Level: NONE | LOCAL-VERIFIED | REMOTE-BACKED
```

Legacy `COMPLETE + REMOTE-BACKED` means `Status: COMPLETE` plus
`Evidence Level: REMOTE-BACKED`.

M3/S1 security remediation has its own evidence progression:

```text
ACTIVE → LOCAL-COMPLETE → REMOTE-PENDING → REMOTE-BACKED
```

## 3. Current release gate

| Milestone                                                       | Status        | Evidence level   | Gate summary                                                                                                                                                    |
| --------------------------------------------------------------- | ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Plan and architecture baseline                             | `COMPLETE`    | `LOCAL-VERIFIED` | Repository operating model and initial V1 baseline established; future milestone wording may be refined without rewriting accepted implementation evidence.     |
| M1 — Development foundation                                     | `COMPLETE`    | `REMOTE-BACKED`  | Local verification suite and GitHub CI/Security workflows exist and passed.                                                                                     |
| M2 — Local infrastructure                                       | `COMPLETE`    | `REMOTE-BACKED`  | Accepted commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`; isolated M2 acceptance plus remote CI/Security passed.                                              |
| M3 — Markdown Knowledge Platform                                | `COMPLETE`    | `REMOTE-BACKED`  | Accepted candidate `ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`, prior merge `9cd34cebb196631e9524b095c21f1fd5aff78749`, and M3/S1 merge `3f9e018a82854f27de08f3e1ba62a7931d879626` all have remote CI/Security evidence. |
| M4 — PDF document ingestion                                     | `ACTIVE`      | `LOCAL-VERIFIED` | M4-R4/T1 completed locally with an isolated PDF runtime while preserving the M3 dependency identity; M4/T2 is authorized and in progress under M4/T2-R1. |
| M5 — Image and video ingestion                                  | `DEFERRED`    | `NONE`           | Locked until M4 is complete and M5 source contracts are approved.                                                                                               |
| M6 — Architecture consolidation                                 | `DEFERRED`    | `NONE`           | Post-Knowledge structural migration only; no M4/M5 accepted code is moved early.                                                                                |
| M7 — L&SC Data Plant core                                       | `DEFERRED`    | `NONE`           | Governed data lifecycle and deterministic control plane.                                                                                                        |
| M8 — L&SC modeling and products                                 | `DEFERRED`    | `NONE`           | Forecasting, machine learning, operations research, feature store, training data, registry and inference.                                                       |
| M9 — Agent Skill Store, Agents System integration and hardening | `DEFERRED`    | `NONE`           | Dual-store Knowledge boundary, function-scoped learned-skill persistence, ZAS integration, and cross-platform hardening.                                        |
| M10 — V1 release                                                | `DEFERRED`    | `NONE`           | Exact-candidate local and remote acceptance for the complete Knowledgebase V1.                                                                                  |

## 4. Current focus

```text
Milestone: M4 — PDF Document Ingestion
Task: M4/T2 — Preflight, extraction, and segmentation
Task Status: IN PROGRESS
Planning Readiness: APPROVED
Plan Revision: M4/T2-R1
Execution Authorization: YES
Authorized Task: M4/T2
Execution Contract: docs/contracts/execution/ACTIVE.md
Evidence Level: NONE
```

M3/S1 implementation commit `5c035fb2d3749d9fabe0a9ff69d9d82509465934` was
merged as `3f9e018a82854f27de08f3e1ba62a7931d879626`; exact merge-SHA CI and
Security passed. M4-R3 is invalidated by `PDF_DEPENDENCY_INCOMPATIBLE`: Docling
cannot share the exact M3 environment with immutable `tokenizers==0.23.1`.
Owner-approved M4-R4 completed M4/T1 locally with feature commit `c4ef66d`.
Owner-approved M4/T2-R1 is authorized through its matching `ACTIVE.md`.
M4/T3 and later remain unauthorized.

## 5. Current delivery sequence

```text
M0 Plan and Architecture Baseline
→ M1 Development Foundation
→ M2 Local Infrastructure
→ M3 Markdown Knowledge Platform
→ M4 PDF Document Ingestion
→ M5 Image and Video Ingestion
→ M6 Architecture Consolidation
→ M7 L&SC Data Plant Core
→ M8 L&SC Modeling and Products
→ M9 Agent Skill Store + ZAS Integration + System Hardening
  → T1 Dual-store persistence contract
  → T2 Function registry + Skill Store intake/publication
  → T3 Scoped retrieval + ZAS compatibility
  → T4 L&SC + cross-project integration
  → T5 System hardening + acceptance
→ M10 V1 Release
```

This sequence reflects the current ownership model in `docs/architecture/`:

- Zink Knowledgebase owns **Knowledge Platform** and **L&SC Data Plant**;
- the Knowledge Platform owns two logically isolated persistent stores:
  **Research Knowledge Store** and **Agent Skill Store**;
- general agents, subagent decomposition, orchestration, automation, permissions,
  learning/evaluation logic, and cross-project tool execution belong to the
  separate **Zink Agents System**;
- Research Knowledge is read-oriented for ZAS research agents and future Zink
  Q&A; Agent Skill Store accepts governed ZAS skill candidates and returns
  function-scoped ACTIVE skills;
- Knowledgebase integrates with Agents System through explicit APIs/contracts,
  not by embedding an Agents System runtime inside this repository.

Execution is strictly sequential. A milestone must reach its required completion
and acceptance gate before the next milestone may begin. Within M9, T1 through
T5 are also strictly ordered: a later task cannot start while an earlier task is
incomplete, blocked, under review, or awaiting owner acceptance. No speculative
or pre-implementation work for a later milestone/task is authorized merely
because its architecture is already documented.

There is no separate Knowledgebase-owned AI Platform, AI Query Platform,
Automation Platform, or agent control plane in the canonical V1 architecture.
An existing inherited runtime dependency may remain until an approved migration
removes it, but it does not gain new domain ownership by existing in M2.

## 6. Completed foundation

### M1 — Development Foundation

Status: `COMPLETE`
Evidence Level: `REMOTE-BACKED`

Accepted scope includes repository quality verification, deterministic toolchain
constraints, secret scanning, dependency auditing, and GitHub CI/Security
workflows. Future milestones inherit these gates.

### M2 — Local Infrastructure

Status: `COMPLETE`
Evidence Level: `REMOTE-BACKED`

The isolated `personal-tool-acceptance` project validated the accepted local
runtime foundation, including PostgreSQL/pgvector, object storage, Redis,
loopback routing, observability, Ollama connectivity, logical backup,
destroy/recreate, and restore behavior. Accepted M2 implementation/evidence is
historical fact and must not be rewritten to match later architecture cleanup.

Accepted commit:

```text
5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19
```

## 7. Knowledge Platform — M3 to M5

### M3 — Markdown Knowledge Platform

Status: `COMPLETE`
Evidence Level: `REMOTE-BACKED`

Purpose: local hybrid retrieval over permitted human-authored Markdown with
citations to original source lines.

| Task                                        | Status     | Accepted evidence summary                                                                                                                                                                       |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3/T1 — Service and index identity          | `COMPLETE` | Internal Knowledge service, readiness, immutable model identity, active-index invariant, advisory lock, and recovery passed; merge `4097862ab383e8698f2d5b1ff5adce0acd1c6579`.                  |
| M3/T2 — Markdown discovery and segmentation | `COMPLETE` | Read-only Vault discovery, path/reparse safety, canonical tags, deterministic segmentation, and original-line citations passed; merge `b446ff17146763ea762b8669207c09642d42098f`.               |
| M3/T3 — Index lifecycle                     | `COMPLETE` | Incremental replacement, side-by-side full rebuild, deletion safety, recovery, and run APIs passed; merge `242bca819b72ded9f6178221eb9cdda09b3dea38`.                                           |
| M3/T4 — Retrieval and reranking             | `COMPLETE` | Filtered vector/FTS retrieval, deterministic fusion/reranking, citations, concurrency, and resource gates passed; merge `aa73b06375321460800b9f78e8195b6837ea5125`.                             |
| M3/T5 — Acceptance and handoff              | `COMPLETE` | Fixture, RealVault, persistent-live, exact-candidate, and remote gates passed; accepted candidate `ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`, merge `9cd34cebb196631e9524b095c21f1fd5aff78749`. |
| M3/S1 — Python dependency security prerequisite | `REMOTE-BACKED` | Exact candidate FastAPI `0.133.0`, Starlette `1.3.1`, and `annotated-doc` `0.0.5` passed resolver, audit, Python 3.13 regression, repository gates, and secret scan; implementation commit `5c035fb2d3749d9fabe0a9ff69d9d82509465934`, merged as `3f9e018a82854f27de08f3e1ba62a7931d879626` with exact merge-SHA CI/Security PASS. |

Inherited M3 invariants include:

- one internal Knowledge service and one Uvicorn worker;
- no direct host port for the Knowledge service;
- PostgreSQL + pgvector as structured/vector truth;
- source Vault mounted read-only and preserved byte-for-byte;
- deterministic discovery and safe canonical paths;
- one queryable ACTIVE index generation;
- failed partial source output never becomes searchable;
- stable Markdown request/retrieval/citation behavior;
- resource, regression, exact-candidate, CI, and Security gates.

### M4 — PDF Document Ingestion

Status: `ACTIVE`
Planning Readiness: `APPROVED`
Plan Revision: `M4/T2-R1`
Execution Authorization: `YES`
Authorized Task: `M4/T2`
Execution Contract: `docs/contracts/execution/ACTIVE.md`
Evidence Level: `NONE`

Purpose: add sidecar-driven PDF ingestion for native text, scanned pages,
tables, and OCR-visible figure text while preserving all accepted M3 behavior.

M4-R3 is invalidated. The owner-approved M4-R4 plan is the direct execution
contract exception for Codex through M4/T1: the PDF dependency stack runs in an
isolated in-image runtime while M3 stays byte-for-byte unchanged. No `ACTIVE.md`
is created for M4/T1. M4/T2 and later return to the normal owner-approved
`ACTIVE.md` protocol.

Hard boundaries:

- discovery is sidecar-driven only under permitted Books and Papers roots;
- Archives may hold referenced physical PDFs but are never scanned as an
  independent source root;
- no new service, queue, permanent worker, cloud dependency, GPU, or VLM unless
  a later owner-approved contract revision explicitly changes this;
- CPU extraction and OCR remain bounded by the approved resource profile;
- dependencies/artifacts required for runtime are pinned and available offline;
- ACTIVE search remains available during processing;
- failed/partial PDF, batch, or OCR output never becomes searchable;
- PDF citations use page ranges and optional bounding boxes rather than Markdown
  line numbers.

Planned task sequence:

| Task                                              | Status        | Scope and gate                                                                                                                                                                    |
| ------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4/P0 — Finalize contract                         | `COMPLETE` | M4-R1 is superseded, M4-R2 invalidated, M4-R3 invalidated by the shared-runtime dependency conflict, and owner-approved M4-R4 is the direct Codex contract through T1. |
| M4/T1 — Runtime, source, schema, and identity     | `COMPLETE` | Feature commit `c4ef66d`; isolated runtime, parent-child protocol, offline artifacts, dependency/security audit, sidecars, paths, identities, migration/recovery, M3 regression, and repository gates passed. |
| M4/T2 — Preflight, extraction, and segmentation   | `IN PROGRESS` | Owner-approved M4/T2-R1: parser/security checks, bounded batching/OCR, deterministic extraction/segmentation, source-drift containment, and atomic content-build batches. |
| M4/T3 — Resume, drift, retention, and publication | `NOT STARTED` | Checkpoint reuse, source/metadata drift, last-known-good retention, idempotent publication, and resource gates.                                                                   |
| M4/T4 — Adapters, retrieval, and API              | `NOT STARTED` | Preserve Markdown adapter; add PDF filters/counters/citations without changing accepted M3 semantics.                                                                             |
| M4/T5 — Acceptance and handoff                    | `NOT STARTED` | Offline, multilingual, security, crash/recovery, concurrency, RealVault, M2/M3 regression, exact-candidate CI/Security, and remote gate.                                          |

M4/T1 is complete. M4/T2 is authorized only through its matching
owner-approved `ACTIVE.md`; T3 through T5 remain strictly gated.

### M5 — Image and Video Ingestion

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: add explicitly permitted image and video sources to the same Knowledge
Platform lifecycle without creating a parallel index authority or separate
retrieval platform.

Required design properties before implementation:

- explicit source policy and provenance;
- deterministic source identity and metadata contract;
- bounded local-first processing;
- multimodal/text representation strategy defined per source type;
- atomic publication through the existing Knowledge indexing authority;
- citations traceable to the original image/video source and location/time where
  applicable;
- no silent write-back to the source Vault;
- M3/M4 regression gates remain mandatory.

M5 implementation details remain intentionally deferred until M4 provides a
stable multi-source ingestion contract.

## 8. M6 — Architecture Consolidation

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: align accepted implementation paths with the canonical two-platform
architecture only after Knowledge ingestion M3–M5 is stable.

Planned scope:

- move the accepted `apps/knowledge/` implementation into the canonical
  `platforms/knowledge-platform/services/knowledge-api/` ownership path through
  a dedicated migration task;
- preserve API behavior, image identity, migrations, tests, data compatibility,
  and accepted Knowledge behavior during the move;
- remove or retire obsolete placeholder ownership surfaces only after verifying
  they contain no accepted runtime responsibility;
- normalize shared schemas/config paths to the two-platform ownership model;
- establish the canonical `platforms/knowledge-platform/stores/` ownership tree
  for Research Knowledge Store and Agent Skill Store without pretending the
  deferred Agent Skill Store runtime already exists;
- keep `integrations/agents-system/` thin and contract-oriented, including the
  function↔subagent↔skill-namespace compatibility boundary;
- update runtime/build paths only as needed for the structural migration.

Hard constraints:

- no M4/M5 code move is performed during those milestones merely to satisfy the
  target tree;
- accepted migrations/history are not rewritten;
- no runtime dependency is removed until its actual consumers and regression
  gates are known;
- structural cleanup must not add new domain behavior;
- M6 may create/normalize Agent Skill Store architecture/contract paths, but
  runtime persistence, intake, publication, and retrieval remain gated by M9.

## 9. M7 — L&SC Data Plant Core

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: establish the governed Logistics & Supply Chain data lifecycle.

Canonical flow:

```text
source/connectors
→ ingestion
→ landing
→ validation
→ quarantine/remediation when required
→ anonymization
→ Bronze
→ deterministic pipelines
→ Silver
→ Gold
→ semantic layer
→ data products
```

The L&SC `control-plane/` is the execution authority for pipeline definitions,
run state, scheduling contracts, retries, promotion gates, and recovery.

`data-ai/` is an internal advisory capability. It may profile data, detect
anomalies, assess quality, suggest deduplication/remediation, evaluate business
rules, and recommend promotion. It is **not** a second control plane and is
**not** a mandatory linear pipeline stage. Governed mutations remain authorized
through deterministic control-plane/governance rules or explicit human approval
where the contract requires it.

M7 must establish at minimum:

- source/ingestion contracts and idempotent run identity;
- validation and quarantine semantics;
- anonymization boundaries for sensitive operational data;
- Bronze/Silver/Gold ownership and promotion rules;
- metadata/catalog/lineage/configuration ownership;
- semantic entities, dimensions, and metric contracts;
- observable run state, retry, recovery, and rollback behavior;
- tests/fixtures that never use real operational data as disposable state.

No forecasting/training/optimization scope is authorized by M7 unless needed as
an interface contract for M8.

## 10. M8 — L&SC Modeling and Products

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: turn governed L&SC data into reusable analytical products and versioned
model lifecycles.

Canonical ownership:

```text
Gold / semantic layer
→ products and versioned training data
→ modeling datasets/features
→ forecasting | machine-learning | operations-research
→ evaluation
→ model registry
→ inference
→ forecasting / optimization / analytics products
```

Required capabilities are justified incrementally, not as a generic MLOps
platform:

- analytics/dashboard/RAG-facing data products where concrete use cases exist;
- `feature-store` as a governed reusable data product when reusable online/offline
  features are actually needed;
- `modeling/features` for feature engineering logic and reproducibility;
- versioned training datasets;
- forecasting models;
- general machine-learning models required by L&SC use cases;
- operations-research models/solvers for optimization problems;
- evaluation/baseline comparison and reproducible model identity;
- model registry and bounded inference interfaces;
- lineage from source dataset/run through model/evaluation to product output.

A feature store does not replace feature engineering: the former publishes and
serves governed reusable features; the latter defines how features are derived.

## 11. M9 — Agent Skill Store, Agents System Integration and System Hardening

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: provide Zink Agents System with two explicit Knowledgebase knowledge
surfaces without transferring persistent-state ownership:

1. **Research Knowledge Store** — read-oriented retrieval from governed
   human/reference sources for ZAS research agents and future Zink Q&A.
2. **Agent Skill Store** — governed learned-skill persistence and scoped
   retrieval for functional ZAS subagents.

Canonical architecture and contract references:

- `docs/architecture/agents-system-boundaries.md`;
- `docs/architecture/knowledge-flow.md`;
- `docs/contracts/knowledge-platform/agent-skill-store.md`.

### M9 invariant

```text
1 function = 1 subagent = 1 skill namespace
```

A ZAS team folder is only an organizational grouping. Each executable leaf
function, such as `data/ingestion` or `data/validation`, owns a separate skill
namespace and separate subagent binding.

### M9 dependency shape

M9 begins only after M8 is complete and accepted. Its tasks execute in strict
sequence:

1. **M9/T1** freezes the dual-store persistence and authorization contract.
2. **M9/T2** builds the function registry plus governed Skill Store intake and
   publication contract on top of T1.
3. **M9/T3** adds namespace-scoped retrieval and proves Research Knowledge and
   Agent Skill retrieval remain isolated.
4. **M9/T4** integrates the now-stable Knowledge + L&SC surfaces with ZAS without
   transferring domain ownership.
5. **M9/T5** performs system-wide hardening and acceptance only after T1–T4 pass.

There is no M6→M9 fast path and no M7/M8↔M9 parallel execution. Later M9 tasks
may be documented in advance for architecture clarity, but documentation does
not authorize implementation before the preceding task is complete and
accepted.

### Planned task sequence

| Task                                                         | Status     | Scope and gate                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M9/T1 — Dual-store persistence contract                      | `DEFERRED` | Freeze store identity, logical persistence isolation, lifecycle, provenance, backup/restore, and authorization rules. Reuse existing PostgreSQL/pgvector/object storage unless evidence requires physical separation.      |
| M9/T2 — Function registry and Skill Store intake/publication | `DEFERRED` | Mirror the current 32 ZAS leaf functions; enforce one `function_id` ↔ one `subagent_id` ↔ one `namespace_id`; versioned `CANDIDATE/ACTIVE/DEPRECATED/REJECTED` lifecycle; idempotent intake; no direct ZAS storage writes. |
| M9/T3 — Scoped retrieval and ZAS compatibility               | `DEFERRED` | Return ACTIVE skills only from the authorized functional namespace; preserve Research Knowledge citation semantics; prove the two stores cannot be accidentally blended.                                                   |
| M9/T4 — L&SC and cross-project integration                   | `DEFERRED` | Integrate permitted L&SC status/run/model contracts and validate ZAS orchestration without transferring L&SC ownership.                                                                                                    |
| M9/T5 — System hardening and acceptance                      | `DEFERRED` | Cross-platform security, authorization, recovery, failure isolation, contract compatibility, full regression, and exact-candidate acceptance.                                                                              |

### Research Knowledge Store rules

Knowledgebase may expose bounded APIs/events for:

- Knowledge search/retrieval with citations;
- controlled index/rebuild operations when explicitly supported;
- health, observability, and capability discovery.

ZAS research agents are consumers only. They must not write Research Knowledge
state or mutate the source Obsidian Vault.

### Agent Skill Store rules

ZAS may submit learned-skill candidates and lifecycle requests through approved
contracts. The learning flow is:

```text
functional subagent execution
→ ZAS captures outcome/evidence
→ ZAS creates/evaluates candidate
→ Knowledgebase intake + structural/provenance validation
→ versioned persistence
→ authorized ACTIVE publication
→ function-scoped embedding/indexing
→ retrieval back to the owning subagent
```

Knowledgebase owns durable storage/index/version/publication correctness. ZAS
owns execution, semantic learning/evaluation, candidate generation, promotion
intent, and deciding when skills are requested.

Only `ACTIVE` skill versions are returned by normal retrieval. Agent Skill Store
must have a separate logical persistence/index/publication namespace from
Research Knowledge Store even when both reuse the same PostgreSQL/pgvector,
object-storage, embedding, and API runtime infrastructure.

### Forbidden direct ownership

ZAS must not directly mutate Knowledgebase vector rows, database tables,
object-storage internals, Research Knowledge index state, Agent Skill Store
index/publication state, Bronze/Silver/Gold state, model registry state, or
source Vault content.

M9 hardening also includes:

- cross-platform contract tests;
- authorization and input validation at integration boundaries;
- timeout/retry/idempotency behavior;
- function/subagent/namespace authorization tests;
- poisoned/invalid skill-candidate rejection and non-publication tests;
- skill version supersession/deprecation/rollback evidence;
- auditability of external requests that can trigger governed actions;
- failure isolation when ZAS is unavailable;
- full Knowledge + L&SC regression;
- backup/restore/recovery and resource regression;
- security review of externally invokable surfaces.

General workflow scheduling, agent planning, subagent delegation, tool routing,
content/browser automation, and learning algorithms remain ZAS responsibilities.

## 12. M10 — V1 Release

Status: `DEFERRED`
Execution Authorization: `NO`
Evidence Level: `NONE`

Purpose: release the complete Knowledgebase V1 from one exact candidate.

Release gate requires, at minimum:

- all required M1–M9 milestones complete at their required evidence level;
- canonical architecture/contracts/runbooks synchronized with implemented
  behavior;
- no unresolved critical/high findings and no unowned persistent state;
- repository verification clean for the exact candidate;
- full local runtime acceptance on the exact candidate;
- backup/restore/recovery evidence;
- resource and security gates;
- exact remote `main` SHA backed by required CI/Security checks;
- owner acceptance.

Repository/runtime naming migration from `personal-tool` to a final Zink naming
scheme is a separate controlled migration if still desired. Do not couple
identity renames to functional release unless explicitly planned because Compose
project names, volumes, routes, image labels, backup metadata, and scripts may
carry persistent compatibility semantics.

## 13. Deferred beyond V1

Unless a future approved requirement justifies them, V1 does not require:

- Kubernetes;
- Kafka or a distributed streaming platform;
- a generic enterprise lakehouse/MLOps platform;
- multi-user SaaS/multi-tenant authorization;
- unrestricted autonomous agents inside Knowledgebase;
- direct Agents System ownership of Knowledgebase persistent state;
- speculative microservices, queues, workers, or control planes;
- cloud-only dependencies for core local operation.

## 14. Decision log

| Decision               | Current rule                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Domain ownership       | Knowledgebase owns Knowledge Platform and L&SC Data Plant only.                                                                      |
| Knowledge stores       | Knowledge Platform owns two logically isolated stores: Research Knowledge Store and Agent Skill Store.                               |
| Research Knowledge     | Derived from approved human/reference sources; read-only to ZAS; future Zink Q&A consumer.                                           |
| Agent Skill Store      | Knowledgebase owns persistence/index/retrieval; ZAS owns learning/evaluation; one function = one subagent = one skill namespace.     |
| Physical storage       | Reuse existing PostgreSQL/pgvector/object storage by default; logical store isolation is mandatory, separate servers are not.        |
| General AI/automation  | External Zink Agents System owns general agents, orchestration, permissions/tools, learning logic, and general automation.           |
| Knowledge AI           | Internal capability of Knowledge Platform; not a separate general AI platform.                                                       |
| Data AI                | Internal advisory capability of L&SC Data Plant; not a control plane.                                                                |
| Pipeline authority     | L&SC `control-plane/` owns governed ETL/pipeline execution and transitions.                                                          |
| Feature store          | Remains an L&SC data product; feature engineering stays in modeling.                                                                 |
| L&SC model families    | Forecasting, machine learning, and operations research are first-class modeling scopes when their milestone is approved.             |
| Cross-project mutation | API/contract boundary only; ZAS may submit skill candidates/lifecycle requests but never receives direct persistent-state ownership. |
| `apps/knowledge/`      | Preserve during M4/M5; migrate only in M6 with dedicated regression evidence.                                                        |
| Source Vault           | Human-owned and read-only to ingestion.                                                                                              |
| Runtime complexity     | Add services/dependencies/control planes only for concrete current requirements.                                                     |

## 15. End rule

M3/S1 is remote-backed by merge `3f9e018a82854f27de08f3e1ba62a7931d879626`
with exact CI/Security PASS. M4-R4/T1 is locally complete; later M4 tasks and
later milestones remain unauthorized.

If plan, architecture, contracts, state files, and verified implementation
disagree, apply the authority order in `AGENTS.md`, preserve accepted evidence,
and stop at the smallest safe boundary for any material conflict.
