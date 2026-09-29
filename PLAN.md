# Personal Tool / Zink — Development Plan

## 1. Authority

`PLAN.md` is the durable source of truth for milestone/task lifecycle state,
approval, execution authorization, the current execution-contract pointer,
blockers, and completion evidence.

When execution is authorized, `docs/contracts/execution/ACTIVE.md` is the sole
source of truth for that task's frozen implementation details. Architecture is
canonical under `docs/architecture/`; repository-wide agent/safety rules remain
in `AGENTS.md`.

Planning never authorizes implementation by itself.

## 2. Status model

```text
Task Status: NOT STARTED | IN PROGRESS | BLOCKED | COMPLETE | DEFERRED | CANCELLED
Planning Readiness: DRAFT | REVIEWED | APPROVED
Execution Authorization: NO | YES
Execution Contract: NONE | docs/contracts/execution/ACTIVE.md
Evidence Level: NONE | LOCAL-VERIFIED | REMOTE-BACKED
```

## 3. Current release gate

| Milestone                                                                  | Status        | Evidence         | Gate summary                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Plan/architecture baseline                                            | `COMPLETE`    | `LOCAL-VERIFIED` | Repository governance established.                                                                                                                                          |
| M1 — Development foundation                                                | `COMPLETE`    | `REMOTE-BACKED`  | Verification and CI/Security baseline passed.                                                                                                                               |
| M2 — Local infrastructure                                                  | `COMPLETE`    | `REMOTE-BACKED`  | Accepted commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`.                                                                                                                 |
| M3 — Markdown Knowledgebase                                                | `COMPLETE`    | `REMOTE-BACKED`  | Accepted candidate `ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`; accepted merge `9cd34cebb196631e9524b095c21f1fd5aff78749`.                                                   |
| M4 — PDF ingestion                                                         | `COMPLETE`    | `REMOTE-BACKED`  | T1–T5 pushed; owner has temporarily accepted M4 as complete. Exact accepted commit hash should be reconciled from git history without reopening M4 scope.                   |
| M5 — Architecture contraction                                              | `COMPLETE`    | `REMOTE-BACKED`  | M5/T1-R2 synchronized canonical paths, documentation and the contracted Docker runtime without refactoring the accepted Knowledgebase application.                          |
| M6 — Zink Skill Store                                                      | `COMPLETE`    | `REMOTE-BACKED`  | M6/T1-R4 task commit is remotely verified; governance closeout is recorded separately.                                                                                      |
| M7 — Zink Tools + OpenClaw integration + V1 hardening                      | `COMPLETE`    | `REMOTE-BACKED`  | M7/T1-R19, M7/T2-R12, M7/T3-R16, M7/T4-R10, and M7/T5-R13 complete; runtime governance remediation, Discord 7-bot integration, and Zink tools specialist policies verified. |
| M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration | `IN PROGRESS` | `LOCAL-VERIFIED` | M8/T1 is complete; M8/T2.2-R4 implementation and final verification are in progress.                                                                                        |

The former self-built L&SC Data Plant is replaced by a **logical external
infrastructure flow**, not another repository module. Forecasting, optimization,
operations research and simulation remain first-class capabilities.

## 4. Current focus

```text
Milestone: M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration
Task: M8/T2.2 — Root-Cause Governed Runtime, Discord, Semantic & Artifact Integrity Hardening
Task Status: IN PROGRESS
Planning Readiness: APPROVED
Plan Revision: M8/T2.2-R4
Execution Authorization: YES
Authorized Task: M8/T2.2 — Root-Cause Governed Runtime, Discord, Semantic & Artifact Integrity Hardening
Execution Contract: docs/contracts/execution/ACTIVE.md
Evidence Level: LOCAL-VERIFIED
Task Branch: codex/m8-t2-governed-runtime-hardening
Owner Approval: EXPLICIT — Owner approved executing ACTIVE.md (M8/T2.2-R4) strictly as plan
```

R4 validation snapshot (task remains IN PROGRESS): focused M8/T1, M8/T2 and
native ingress suites PASS; focused DuckDB/M7-T4 gates PASS 27/27; full
`npm test` PASS 349/349 across 28 suites; ESLint, Markdown lint, repository
policy check, Prettier and `git diff --check` PASS. The owner-provided native
Windows DuckDB CLI is available at the approved WinGet path. Remaining OPEN
items are the unverified native OpenClaw component API, the approved
nonblocking lock primitive, and the owner/runtime-dependent OpenClaw preflight.

R4 implementation evidence: `zink_sql` uses the existing governed DuckDB bridge
with exact task scope; approved tasks are durably enqueued before an unavailable
execution backend returns `BLOCKED / ENGINE_NOT_IMPLEMENTED`; approval cards
require exact task correlation; missing Discord credentials fail closed as
`CREDENTIAL_UNAVAILABLE`; Excel sandbox and public artifact references fail
closed without CWD/internal-path fallback; and no OpenClaw native conversational
memory is enabled; Ollama embedding requests no longer infer a gateway or
localhost endpoint. Native Discord component API verification, OpenClaw runtime
preflight, and a nonblocking lock replacement remain `BLOCKED` under the R4
no-invention rule.

Prior M8/T2.2-R3 validated completion evidence (historical baseline; not R4 completion):

- all 15 root-cause families (RC-01 through RC-15) defined in `docs/contracts/execution/ACTIVE.md` remediated, hardened, and verified with zero regressions;
- RC-01 (Discord Ingress / Routing Authority): admission gate enforced prior to model calls; Main established as the sole root owner at ingress; specialist direct mentions rejected across all channels (`SPECIALIST_NO_DIRECT_INGRESS`); multi-capability requests directed solely to Main; duplicate Discord events deduplicated;
- RC-02 (Agent Topology / Spawn Authorization): canonical topology locked in `role-capability-manifest.json` and runtime `guard.mjs` (`main -> [o1, o2]`, `o1 -> [excel, sql, python]`, `o2 -> [power-bi, python]`, leaf -> `[]`); Main direct spawn to specialists blocked; O1/O2 cross-spawn blocked; empty node lists blocked;
- RC-03 (Task Identity / Lineage / Idempotency): durable correlation IDs and exact lookup enforcement; duplicate message IDs and actions rejected or answered idempotently without spawning new executions;
- RC-04 (Approval / Revision / Result-Review Transaction): immutable approval records bound to exact scope digest and revision; plan revisions strictly invalidate prior approvals; User established as sole authority for Approve, Reject, and Accept;
- RC-05 (Queue / Ledger / Lease / Recovery): persistent file-backed queue with atomic cross-process file locks, lease heartbeat fencing, execution-agent attempt validation, and fail-closed state reconciliation;
- RC-06 (Discord Outbound / Channel Authority): canonical channel matrix enforced; `ASK_USER` in `#office` strictly restricted to Main in `validateActionAuthority()`; O1/O2 restricted to `#approvals`, `#results`, and `#incidents`;
- RC-07 (Common Artifact / Result / Delivery Truth): complete lifecycle enforced; internal filesystem paths and raw `file://` URLs purged from user-facing outputs; user delivery separated from workspace file generation;
- RC-08 (Excel Execution Truth): secondary writes to repository `artifacts/` purged; `.xlsx` workbooks generated with matching visual SVG previews; CWD fallbacks removed from delivery path;
- RC-09 (SQL Execution Truth): real DuckDB engine execution enabled with canonical schema fixtures; discrete execution states (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`) enforced; syntax/binder errors fail closed without returning mock sample rows;
- RC-10 (Python Execution Truth): strict stack scoping separating O1 ETL execution from O2 analytics/visualization/forecast/optimization; AST parsing and import validation;
- RC-11 (Power BI Execution Truth): PK\x03\x04 magic byte validation, container integrity, and dashboard preview correlation;
- RC-12 (External Adapter / Simulation Truth): unambiguous capability states enforced; simulation mode isolated behind explicit flags and forbidden from production success paths;
- RC-13 (Security / Path / Endpoint Isolation): zero secret leaks in prompts or payloads; traversal (`..`) and absolute path escape attempts rejected; host execution bypass blocked;
- RC-14 (Semantic / Capability Boundary): vetted namespace enforcement; proposal disk writes isolated to explicit storage directories rather than dirtying source trees;
- RC-15 (Verification / CI / Schema / Documentation Truth): root `npm test` updated to include `duckdb-bridge.test.mjs`; all 272 tests across 13 suites pass completely (100% PASS); quality gates clean: `git diff --check` (0 issues), `npm run repo:check` (PASS), `npm run format:check` (PASS), `npm run lint` (0 issues).

M8/T2-R9 validated completion evidence:

- strict 5-tuple action authority engine (`validateActionAuthority` in `integrations/openclaw/lib/authority.mjs`) implemented, enforcing User as the sole authority for plan approvals and result acceptance, isolating actions across 4 dedicated Discord channels (`#office`, `#approvals`, `#results`, `#incidents`), and strictly blocking specialist agents from governance actions (`SPECIALIST_NO_GOVERNANCE`);
- technical execution finish decoupled from human task completion: `EXECUTION_FINISHED` transitions tasks to `RESULT_PENDING_REVIEW` with preview and validation, requiring explicit User `ACCEPT_RESULT` to transition to `COMPLETE`;
- persistent file-backed `QueueManager` implemented in `integrations/openclaw/lib/queue-manager.mjs` with atomic single-agent claims, lease heartbeat renewal, and automatic stale task recovery (`detectAndRecoverStaleTasks`), cleanly decoupling the 24/7 Control Plane from execution-agent offline/sleep cycles;
- two-tier `evaluateResultGate` implemented in `integrations/openclaw/lib/artifact-validator.mjs` with technical integrity parsing and business KPI constraint verification, enforcing the critical invariant that Technical PASS + Business FAIL yields `RESULT BLOCKED` with real data previews and zero synthetic mocks;
- human-confirmed `DecisionLedger` implemented in `integrations/openclaw/lib/decision-ledger.mjs` caching confirmed operator decisions and preventing redundant clarification questions;
- structured reference IDs conforming to `TOPIC(2)-EXEC(2)-TASK(4)` with `00` reserved for human-contributed documents, and retrieval context deduplication (`deduplicateRetrievalContext`) implemented in `zink-tools/common/semantic-contract.mjs`;
- governed Discord message and card formatters implemented in `integrations/openclaw/lib/discord-formatter.mjs` (`formatOfficeClarificationQuestion`, `formatOfficeFinalNotification`, `formatGovernedApprovalCard`, `formatGovernedResultCard`, `formatIncidentCard`);
- OpenClaw `zink-governance` plugin updated with attempt-token staleness protection (`STALE_ACTION_REJECTED`) and full runtime module materialization in `governancePluginFiles`;
- audit bug test suite `tests/m8-t2-governed-runtime-audit.test.mjs` passed 12/12 tests covering all bug prevention rules (`BUG-M8T2-01` through `BUG-M8T2-12`), including strict authority hierarchy (Main only delegates to O1/O2, never directly spawns specialists or self-executes) and real visual spreadsheet preview generation;
- specialist direct Discord ingress rejected (`SPECIALIST_NO_DIRECT_INGRESS`) and direct `#office` broadcasts suppressed in governance plugin, preventing dual-bot appearance and strictly enforcing O1/O2 execution supervisor boundary;
- real visual spreadsheet SVG preview rendering implemented in `excel-writer.mjs` and validated in `artifact-validator.mjs` and `discord-formatter.mjs`, providing actual data screenshots/renderings without mocks;
- end-to-end workflow test suite `tests/m8-t2-e2e-workflow.test.mjs` passed 19/19 tests covering Happy Path and all 20 required failure and edge scenarios;
- full repository test suite passed all 156 tests with zero regressions; `git diff --check`, `repository-check.mjs`, `eslint`, `markdownlint`, and `prettier` all passed with 0 errors.

M8/T1-R1 validated completion evidence:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and 1024-dimension HNSW cosine vector index `skills_segments_embedding_hnsw_idx` via migration `apps/knowledge/migrations/003_skills_vector_schema.sql`;
- shared canonical semantic contract implemented in `zink-tools/common/semantic-contract.mjs` with deterministic uppercase envelope formatting (`renderEmbeddingEnvelope`), SHA-256 envelope hashing (`computeEmbeddingInputHash`), safe query preparation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization implemented in `zink-skill-store/src/vector-sync.mjs` with fail-closed validation, ACTIVE-only indexing, source-drift abort safeguards, and 1024-dimension vector enforcement;
- callable tool contracts and adapters implemented for `zink_skill_search` (vector cosine similarity, ACTIVE-only), `zink_skill_propose` (candidate-only, human-in-the-loop approval, strictly prevents direct promotion to ACTIVE), and `zink_knowledge_search` (hybrid search proxy with citation provenance);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`) implemented in OpenClaw governance plugin with immutable content-hash binding and fail-closed owner verification;
- RBAC policy updated in `integrations/openclaw/lib/policy.mjs`: all 7 agents authorized for `zink_skill_search` and `zink_knowledge_search`; specialists and O1 authorized for `zink_skill_propose`;
- Discord Mobile mention parsing remediated: corrected punctuation lookahead regex `(?=$|[>\\s,.:;!?])` and mapped all 7 snowflake IDs in `AGENT_ALIASES` and `groupChat.mentionPatterns`, allowing raw `<@ID>`, `<@!ID>`, snowflake, and natural text mentions from Mobile and Desktop clients;
- Discord Gateway stability remediated: set `replyToMode: "off"` to eliminate Discord API 50035/50001 permission errors; verified all 7 bot WebSockets active and connected to Discord Gateway;
- automated test suite `tests/m8-t1-skill-vector-memory.test.mjs` passed 11/11 tests covering all bug prevention rules (BUG-01 through BUG-13);
- full verification suite `npm run verify` passed all 123 tests cleanly (`format:check`, `lint`, `test`, `repo:check`).

M7/T5-R13 validated completion evidence:

- implementation commits `4037187` and `8e71759` verified on `codex/m7-t5-governance-remediation`;
- multi-agent Discord ingress task collision remediated via deterministic per-agent `deriveTaskId`; 7 concurrent bots reply without collision or dropped messages;
- Zink tools registered with complete JSON Schema parameter definitions for `zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, and `zink_n8n`;
- specialist tool allowlists (`alsoAllow`) enforced in `openclaw.json` for Excel (`zink_excel`), Power BI (`zink_power_bi`), SQL (`zink_sql`), Python (`zink_python`, `zink_n8n`), and O2 (`zink_n8n`);
- Discord output formatting hook unwraps JSON and formats natural Vietnamese conversation;
- CI shallow clone depth (`fetch-depth: 0`) and `smol-toml` high vulnerability advisory remediated;
- full test suite passed (173 passed, 0 failed, 1 skipped);
- GitHub Actions CI (run 35168425589) and Security (run 35168435913) remotely passed (green).

M7/T4-R10 validated completion evidence:

- implementation commit `d73f20cc5fd5fd14533b34e2840517c49b9989b1` on `main`;
- external infrastructure adapters, duckdb bridge, and vietnamese docs implemented;
- pre-existing test suite passed with zero regressions.

M7/T3-R16 validated completion evidence:

- implementation commit `ac68bce0653ad3c4bfcc8d230960bcdcf7e8f71d` is verified on `origin/codex/m7-t3-tools-contracts`;
- 25 frozen scope files implemented within Case C boundaries with zero non-goal violations;
- unit and static test suite passed 112/112 tests (`npm test`) with zero regressions;
- focused M7/T3 test suite passed 31/31 tests across all domains A-H (`node --test tests/m7-t3-tools-contract.test.mjs`);
- host registration assertion gate passed (`G0.6`): exact 5 Zink tools captured on mock host registration;
- anti-replay concurrent race gate passed (`G0.9`): atomic single claim admitted, concurrent replay rejected with `AUTH_APPROVAL_REPLAYED`;
- projection isolation and manifest drift gate passed (`G5`): `agent.tools.alsoAllow` matches `effectiveOpenClawToolAllowlist`, role manifest matches `effectiveZinkCallableTools`;
- code quality gates passed (`G4`): ESLint 0 errors / 0 warnings;
- patch integrity gate passed (`G7`): `git diff --cached --check` clean, zero whitespace violations;
- dependencies untouched: `package.json` and `package-lock.json` completely unmodified.

M7/T2-R12 validated completion evidence:

- implementation commit `4872314c686bcc92797acc68483b8b68fe4ee8ca` is verified on
  `origin/codex/m7-t2-agent-topology`;
- unit and static test suite passed 112/112 tests (`npm test`);
- native patch probe passed with all sub-checks verified (`native-patch-probe.mjs`):
  exact roundtrips, drift rejection, native prepare execution vetoes, synthetic apply/restore;
- operator preflight passed (`operator-preflight.mjs`):
  `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`;
- operator apply passed and verified rollback readiness (`operator-apply.mjs`):
  `{"status":"PASS","stage":"applied","rollback_ready":true}`;
- operator rollback verified to clean T1 baseline (`operator-rollback.mjs`):
  `{"status":"PASS","runtime":"T1_RESTORED"}`;
- live governance probe passed all 8 stages (`live-governance-probe.mjs`):
  direct checks on all seven identities (`main`, `o1`, `o2`, `excel`, `power-bi`, `sql`, `python`)
  and full nested seven-role matrix (`{"stage":"nested-seven-role-matrix","status":"PASS","accepted_children":6}`);
- scoped gateway service `openclaw-gateway-zink.service` verified active on port 18789.

M6/T1-R4 evidence: focused M6 tests, `npm run verify` (64 tests),
`git diff --check`, staged diff check, and scope review passed. Task commit
`fb746021b8b1a51080d1ba4fed4b35011bb78ce6` is remotely verified on
`origin/codex/m6-t1-git-native-skill-store`. Post-completion fix commit
`652ed9bd248dcc047a2be09300aaaba1d9c2dbbf` is also remotely verified there.

Host operation: `.wslconfig` was backed up without overwrite, changed only from
`memory=9728MB` to `memory=8192MB`, and read back successfully. No
`wsl --shutdown` was run; effective application remains owner-controlled through
a later WSL restart.

M4/T5 is treated as **temporarily accepted and complete by the owner** after the
Codex push. The exact accepted commit hash is intentionally not invented here; it
should be reconciled from git history/remote evidence by Codex or the owner when
convenient. Do not reopen M4 implementation scope merely to fill that metadata.

M4/T1 through M4/T4 are complete locally:

| Task                                          | Status     | Evidence summary                                                                                                                                     |
| --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4/T1 — Runtime, source, schema, identity     | `COMPLETE` | Feature commit `c4ef66d`; isolated PDF runtime and M3 regression gates passed.                                                                       |
| M4/T2 — Preflight, extraction, segmentation   | `COMPLETE` | Implementation commit `82126e4`; bounded extraction/OCR and atomic non-searchable builds passed.                                                     |
| M4/T3 — Resume, drift, retention, publication | `COMPLETE` | Local implementation commit `c1df143`; resumability and atomic publication passed.                                                                   |
| M4/T4 — Adapters, retrieval, API              | `COMPLETE` | Reviewed local implementation commit `1904853`; Markdown/PDF retrieval, filters, citations, and repository gates passed.                             |
| M4/T5 — Acceptance and handoff                | `COMPLETE` | Owner reports the accepted M4/T5 state was pushed and is temporarily closed; exact remote commit evidence remains to be reconciled from git history. |

The owner's 2026-08-28 correction remains authoritative for `M4/T5-R2`:
visible internal PDF embeds drive sidecar recognition; ordinary Books/Papers
Markdown is ignored by PDF discovery; `zink_source: pdf` is not required.

M4/T5 is closed for current planning purposes. Architecture contraction must not
refactor or destabilize the accepted M3/M4 Knowledgebase runtime unless a later,
separately approved migration explicitly authorizes it.

## 5. Canonical target architecture

The repository retains three logical modules.

Canonical new-work paths are:

```text
platforms/knowledge-platform/   # accepted current Knowledgebase runtime
zink-skill-store/               # peer Skill Store module
zink-tools/                     # peer Tools module
integrations/openclaw/          # external OpenClaw integration
```

The current Knowledgebase runtime path is retained for compatibility; it is not
the parent of Zink Skill Store or Zink Tools.

### 5.1 Zink Knowledgebase

- owns approved human/reference knowledge, ingestion, retrieval, provenance and
  citations;
- preserves the existing owner-approved Knowledgebase taxonomy and Supply Chain
  coverage; this plan does not redefine or narrow it;
- may include Decision and Business Semantics knowledge through the existing
  taxonomy when approved;
- keeps the source Obsidian Vault human-owned and read-only;
- preserves accepted M3/M4 runtime paths until a separately approved migration.

### 5.2 Zink Skill Store

- owns reusable governed skills and their lifecycle/provenance;
- owns reusable **Excel and Power BI templates** as owner-authored assets;
- keeps Knowledgebase research state logically isolated from learned skills;
- uses task metadata rather than physically splitting Work and Research stores;
- normal skill retrieval returns governed/published versions only.

Task-mode rule:

```text
mode: work | research
```

Main classifies mode from task intent. For mixed tasks it may assign a primary
and secondary mode. Research outputs are never silently promoted into a work or
production path.

### 5.3 Zink Tools

Zink Tools is the callable execution surface for OpenClaw and approved n8n
workflows:

```text
excel
power-bi
sql
python
n8n
forecast
optimization
operations-research
simulation
```

OpenClaw owns orchestration, specialist routing, sandboxing, permissions, task
mode and model/tool execution policy. n8n owns deterministic triggers, schedules,
connectors and workflow run state. Zink Tools owns neither orchestration nor
persistent Knowledge/Skill state.

## 6. Five-stack model

```text
STACK 5 — DECISION
Main + O1 + O2: compare alternatives, risk/trade-offs, recommendation

STACK 4 — INTELLIGENCE
Forecast / Optimization / Operations Research / Simulation

STACK 3 — SEMANTIC
O1: domain meaning, KPI, business rules, constraints, policies

STACK 2 — EXECUTION
Excel / Power BI / SQL / Python / n8n

STACK 1 — INFRASTRUCTURE
R2 / DuckDB / MotherDuck / Kaggle / Databricks / local compute
```

Stacks are functional layers, not permanent one-agent-per-stack processes.
Baseline execution specialists are Excel, Power BI, SQL and Python. Intelligence
specialists may be created or invoked lazily.

## 7. L&SC Data Plant — logical flow only

The historical name is retained only as an architectural description of how L&SC
data and compute move through existing infrastructure:

```text
Source
→ n8n / Python
→ R2 / DuckDB / MotherDuck
→ Kaggle / Databricks / local compute
→ Forecast / Optimization / OR / Simulation
→ OpenClaw
→ Excel / Power BI delivery when required
```

There is no separate L&SC Data Plant runtime/platform to build.

Explicitly out of scope:

- self-built Bronze/Silver/Gold lakehouse;
- generic ETL control plane;
- feature store or generic model registry;
- generic MLOps/training platform;
- duplicated OpenClaw or n8n workflow/orchestration state;
- direct adapter writes to Knowledgebase/Skill Store persistence internals.

## 8. Delivery sequence

```text
M0 Plan/Architecture
→ M1 Development Foundation
→ M2 Local Infrastructure
→ M3 Markdown Knowledgebase
→ M4 PDF Ingestion                 [COMPLETE]
→ M5 Architecture Contraction      [COMPLETE]
→ M6 Zink Skill Store              [COMPLETE / REMOTE-BACKED]
→ M7 Zink Tools + OpenClaw Integration + V1 Hardening/Release [COMPLETE]
→ M8 Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration [COMPLETE]
```

### M5 — Architecture Contraction

Status: `COMPLETE`
Execution Authorization: `NO`

Current scope:

- keep the accepted Knowledgebase runtime under `apps/knowledge/` and
  `platforms/knowledge-platform/` until a separately approved runtime migration;
- make `zink-skill-store/` a peer module rather than a child of Knowledgebase;
- make `zink-tools/` a peer module rather than an integration subsystem;
- use `integrations/openclaw/` as the canonical OpenClaw integration path;
- remove obsolete `integrations/agents-system/`, nested Skill Store paths, legacy
  `integrations/zink-tools/`, and residual L&SC Data Plant runtime scaffolding;
- retain only `docs/architecture/lsc-data-flow.md` for the historical L&SC Data
  Plant concept: a logical external data/compute flow, not a runtime module;
- preserve the existing Knowledgebase taxonomy and Supply Chain coverage;
- formalize the five-stack mapping without creating five new runtime modules;
- do not refactor M3/M4 ingestion code merely for folder symmetry.

### M6 — Zink Skill Store

Status: `COMPLETE`
Task: `M6/T1 — Git-native governed skill core`
Plan Revision: `M6/T1-R4`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `REMOTE-BACKED`
Task Commit: `fb746021b8b1a51080d1ba4fed4b35011bb78ce6`
Task Branch: `codex/m6-t1-git-native-skill-store`
Upstream: `origin/codex/m6-t1-git-native-skill-store`
Remote Task Verification: `PASS`
Post-completion Fix Commit: `652ed9bd248dcc047a2be09300aaaba1d9c2dbbf`
Remote Fix Verification: `PASS`

M6/T1 delivered Git-managed strict JSON manifests and Markdown content,
complete-catalog fail-closed validation, and exact retrieval of one ACTIVE
version. Routing context remains M7/OpenClaw policy and is not manifest
metadata. M6/T1 completion closes M6 after this governance closeout commit is
remotely verified.

### M7 — Zink Tools + OpenClaw Integration + V1 Hardening

Status: `IN PROGRESS`
Task: `M7/T1 — OpenClaw foundation`
Task Status: `COMPLETE`
Plan Revision: `M7/T1-R19`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Foundation Commit: `e15a1adf9ed50ec34e1db57f825771616d9dd2c9`
R19 Implementation Commit: `7b5edc510d463eec197f000191d907e5b17aa87c`

M7/T1-R19 is an owner-approved bounded upstream backport for pinned OpenClaw
2026.6.34. It preserves the R17 Google SSE terminal checks and R18 Discord
final-only delivery, classifies incomplete terminal streams as timeout-class
failover events, and suppresses errored partial assistant text/reasoning and
terminal evidence. The investigation and post-fix gates covered all seven bots.
The exact hotfix utility and runtime artifacts passed integrity checks; the full
repository gate passed 81 tests, all 60 live OpenClaw gates passed, and the owner
observed three repeated all-seven Discord tests with complete replies and no
truncation. M7/T2-R11 is now the authorized current task recorded in section 4.

M7/T1-R16 retained the R15 minimal-tool compatibility decision and recorded the
owner's 2026-09-07 correction that Discord capability evidence is an operational
minimum gate, not an exact non-admin permission allowlist. All 28 account/surface
pairs must expose the required text/forum permissions; administrator,
channel/role/webhook management, and application-command permission remain
forbidden. Commands and additive tool grants remain disabled, and model
selection remains constrained to the two Google aliases. Exact implementation
details were implemented and validated without enabling internal delegation.
Focused OpenClaw tests, the full 76-test repository gate, `git diff --check`,
host/runtime/security checks, seven model and auth-order probes, all 28 Discord
account/surface permission probes, and owner-observed live behavior passed.
M7/T2-R11 owns the current five-stack topology implementation under the active
execution contract referenced in section 4.

Minimum scope:

- four baseline execution specialists: Excel, Power BI, SQL and Python;
- tool surfaces for Excel, Power BI, SQL, Python and n8n;
- decision-science tool surfaces for Forecast, Optimization, OR and Simulation;
- Main intent classification to `work`, `research`, or mixed primary/secondary;
- external infrastructure usage through the lightest practical integration;
- training/heavy compute stays on approved external infrastructure when needed;
- compatibility tests, bounded errors/timeouts and failure isolation;
- no secret values committed to integration configs.

### M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration

Status: `COMPLETE`
Task: `M8/T1 — Governed Skill Vector Store, Semantic Search & Agent Proposal Pipeline`
Task Status: `COMPLETE`
Plan Revision: `M8/T1-R1`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Task Branch: `codex/m8-t1-skill-vector-memory`

M8/T1 implemented a 2-way long-term memory system for Zink Skill Store and a 1-way
read-only semantic RAG pipeline for Zink Knowledgebase:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and
  `skills_segments_embedding_hnsw_idx` (1024-dim BGE-M3 HNSW cosine index);
- shared canonical semantic contract (`zink-tools/common/semantic-contract.mjs`)
  enforces deterministic uppercase envelope formatting, SHA-256 content hashing,
  safe query truncation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization (`zink-skill-store/src/vector-sync.mjs`)
  enforces fail-closed active catalog filtering, source-drift abort safeguards,
  and 1024-dimension vector constraints; Git remains the canonical authority;
- callable tool interfaces added for `zink_skill_search` (ACTIVE-only cosine similarity),
  `zink_skill_propose` (human-in-the-loop candidate proposal via `#approvals`,
  preventing direct activation), and `zink_knowledge_search` (hybrid search proxy);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`)
  authenticates owner identity and binds immutable proposal content hashes before
  promoting candidate skills to Git;
- OpenClaw RBAC policy updated granting retrieval to all 7 bots and proposal rights
  to execution specialists and O1;
- Discord Mobile mention resolution remediated (supporting `<@ID>`, `<@!ID>`, raw
  snowflakes, and Vietnamese text patterns with corrected punctuation lookahead) and
  Gateway stability ensured with `replyToMode: "off"`;
- full verification suite passed with all 123 tests clean.

## 9. Deferred beyond V1

Unless separately approved:

- image/video ingestion;
- self-hosted generic data lake/lakehouse;
- self-hosted generic forecasting/ML/OR training platform;
- Kubernetes/Kafka/distributed orchestration;
- speculative microservices, queues, workers or control planes.

## 10. Decision log

| Decision               | Current rule                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Repository scope       | Three logical modules: Knowledgebase, Skill Store, Tools.                                                           |
| Knowledgebase taxonomy | Preserve existing owner-approved taxonomy and Supply Chain coverage.                                                |
| Templates              | Excel/Power BI templates are owner-built assets stored in Zink Skill Store.                                         |
| Work/Research          | Main infers mode from intent; mode is metadata, not a second store.                                                 |
| Execution specialists  | Excel, Power BI, SQL and Python are the baseline four.                                                              |
| Five Stack             | Functional processing layers; agents may serve more than one stack.                                                 |
| L&SC Data Plant        | Logical external-infrastructure/data-compute flow only; no platform runtime.                                        |
| Model artifacts        | Heavy artifacts stay external; repository keeps only lightweight metadata/config/evaluation references when needed. |
| OpenClaw               | External runtime/orchestrator and task-mode classifier.                                                             |
| n8n                    | Deterministic workflow/trigger/schedule plumbing.                                                                   |
