# Zink Knowledgebase (`personal-tool`)

Local-first, single-user knowledge and Logistics & Supply Chain data system.
The repository still uses the historical `personal-tool` runtime/repository
identity where changing it would affect accepted infrastructure or persistent
state. A naming migration is separate from architecture cleanup.

## Current status

| Milestone                        | Status                              |
| -------------------------------- | ----------------------------------- |
| M1 — Development Foundation      | `COMPLETE / REMOTE-BACKED`          |
| M2 — Local Infrastructure        | `COMPLETE / REMOTE-BACKED`          |
| M3 — Markdown Knowledge Platform | `COMPLETE / REMOTE-BACKED`          |
| M4 — PDF Document Ingestion      | approved; implementation authorized |
| M5+                              | deferred                            |

M2 accepted commit:
`5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`.

M3 accepted candidate:
`ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`; accepted merge:
`9cd34cebb196631e9524b095c21f1fd5aff78749`.

See [PLAN.md](PLAN.md) for exact milestone state, evidence, and the current
execution gate. Do not infer implementation authorization from this README.

## Architecture

Zink Knowledgebase owns two domain platforms:

```text
Zink Knowledgebase
├── Knowledge Platform
│   ├── Research Knowledge Store (Obsidian/reference → research agents/Q&A)
│   ├── Agent Skill Store (ZAS learned skills → functional subagents)
│   ├── source ingestion and processing
│   ├── knowledge-ai
│   ├── indexing/publication
│   └── retrieval/citations/provenance
└── L&SC Data Plant
    ├── deterministic control plane
    ├── governed data lifecycle
    ├── data-ai advisory capabilities
    ├── semantic/data products
    └── forecasting / machine learning / operations research
```

General agents, subagents, cross-project orchestration, permissions/tools,
learning/evaluation logic, and general automation belong to the separate **Zink
Agents System**. ZAS reads Research Knowledge and submits/retrieves learned
functional skills through the Agent Skill Store contract. This repository owns
the persistent stores but not the ZAS runtime.

Important L&SC distinction:

- `control-plane/` manages pipeline definitions, run state, retries, promotion
  gates, recovery, and governed ETL actions;
- `data-ai/` assists with profiling, quality/anomaly analysis, remediation, and
  recommendations; it does not become a second control plane and its output does
  not authorize governed mutations by itself.

`feature-store` remains a data product. Feature engineering belongs to the model
lifecycle that produces versioned features.

Read architecture in this order:

1. [Architecture index](docs/architecture/README.md)
2. [System overview](docs/architecture/system-overview.md)
3. [Platform boundaries](docs/architecture/platform-boundaries.md)
4. [Knowledge flow](docs/architecture/knowledge-flow.md)
5. [L&SC data flow](docs/architecture/data-flow.md)
6. [Agents System boundary](docs/architecture/agents-system-boundaries.md)

## Repository agent harness

Coding-agent control is separate from the Zink Agents System runtime:

```text
AGENTS.md
PLAN.md
docs/contracts/execution/
├── README.md              # tracked lifecycle protocol
└── ACTIVE.md              # generated only while an approved task is executable; ignored
.agents/
├── skills/
│   ├── planning/SKILL.md
│   ├── architecture-review/SKILL.md
│   ├── execution/SKILL.md
│   ├── code-review/SKILL.md
│   ├── debugging/SKILL.md
│   └── validating/SKILL.md
└── states/
    ├── README.md
    ├── context.md         # local/ignored when active
    ├── findings.md        # local/ignored when active
    └── handoff.md         # local/ignored when active
.cline/skills/                  # Cline executor adapters
.clinerules/                    # always-on Cline role rules
```

`AGENTS.md` defines authority and routing. `PLAN.md` owns durable task/lifecycle
state. While execution is authorized, a matching `docs/contracts/execution/ACTIVE.md`
is the sole source of truth for approved implementation details. Skills define
procedures; `.agents/states/` is bounded local/ignored working memory only.

## Development

Before changing repository state, read:

- [AGENTS.md](AGENTS.md) — agent authority, roles, safety, and skill routing;
- [PLAN.md](PLAN.md) — Active Task, lifecycle state, authorization, and execution-contract pointer;
- [Execution contract protocol](docs/contracts/execution/README.md) — `ACTIVE.md` lifecycle and implementation source-of-truth rule;
- [Development conventions](docs/development/conventions.md) — Git, formatting,
  verification, and secret handling;
- only the architecture/contracts/runbooks relevant to the task.

Toolchain baseline:

```text
Node >=24.15.0 <25
npm 12.0.2
```

Repository verification:

```powershell
$npm = "$env:APPDATA\npm\npm.cmd"
& $npm ci
& $npm run verify
```

## Local infrastructure

The accepted local runtime foundation includes PostgreSQL + pgvector, AIStor
Free object storage, Redis, Nginx, Ollama, Prometheus, Grafana, Dozzle, and
inherited n8n runtime support from M2. Existing n8n runtime compatibility does
not make an Automation Platform part of the canonical Knowledgebase domain
architecture.

Copy `infrastructure/docker/env/.env.example` to the ignored sibling `.env` and
supply required local credentials/license values. Never commit or print those
values.

Primary runtime scripts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/preflight.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
```

Use the applicable runbook rather than improvising destructive recovery steps.

## Knowledge Platform operation

The current accepted implementation remains under `apps/knowledge/`. It is not
moved during M4/M5 because those milestones must preserve accepted M3 behavior.
A dedicated post-M5 architecture-consolidation milestone owns that structural
migration.

The `knowledge` profile starts the runtime required for Knowledge retrieval and
mounts the configured Obsidian Vault read-only. The source Vault remains
human-owned; ingestion must not write back to it.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Operational and acceptance procedures are in the
[Knowledge Platform runbook](docs/runbooks/knowledge-platform.md).

## M4 execution

M4 adds sidecar-driven PDF ingestion while preserving the accepted Markdown
path. The owner-approved implementation contract is transiently materialized at
`docs/contracts/execution/ACTIVE.md`; `PLAN.md` is the durable source for its
task identity, revision, and authorization state.

At the current repository gate:

```text
Task: M4 — PDF Document Ingestion
Planning Readiness: APPROVED
Plan Revision: M4-R1
Execution Authorization: YES
```

Authorization does not claim that PDF implementation or any M4 gate has passed.

## Security and persistent-state rules

- Never commit `.env`, credentials, licenses, private Vault content, backups, or
  runtime secrets.
- Real user/operational data is read-only by default unless a bounded approved
  task explicitly authorizes mutation.
- Do not delete volumes, drop databases, rewrite accepted migrations, or write
  to the source Vault as a shortcut for tests or recovery.
- Use fixtures and isolated acceptance projects for destructive tests.

## Validation and history

`npm run verify` is the repository quality baseline. Milestone-specific runtime
and exact-candidate gates are defined in `PLAN.md`, contracts, and runbooks.
Local PASS does not imply remote CI/Security PASS.

Validated completed history belongs in [CHANGELOG.md](CHANGELOG.md). Planned or
unvalidated architecture changes must not be recorded there as completed work.
