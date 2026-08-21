# Zink Knowledgebase — System Overview

## 1. Purpose

Zink Knowledgebase is the persistent knowledge and Logistics & Supply Chain data
foundation of the Zink ecosystem. The current repository is still named
`personal-tool`; runtime and persistent identifiers keep their accepted names
until a dedicated migration is approved and validated.

This repository owns two domain platforms:

1. **Knowledge Platform** — governed knowledge persistence and retrieval. It now
   has two logically isolated stores:
   - **Research Knowledge Store** for human/reference knowledge, primarily
     derived from the read-only Obsidian Vault;
   - **Agent Skill Store** for reusable functional skills learned by Zink Agents
     System.
2. **L&SC Data Plant** — governed Logistics & Supply Chain data lifecycle,
   analytical data products, and forecasting/ML/operations-research model
   lifecycle.

General-purpose agents, subagent orchestration, task execution, learning logic,
automation, permissions, and tool execution belong to the separate **Zink Agents
System (ZAS)**. Knowledgebase owns the durable stores; ZAS owns how agents use
and learn from them.

## 2. System context

```text
                              ZINK ECOSYSTEM

 Human/reference sources
 (Obsidian, Books, Papers, ...)
             │
             ▼
   Research Knowledge Store ────────────────┐
   read-oriented + citations               │
                                           │
                                           ▼
                                  Zink Agents System
                                  orchestration / tools
                                  / learning / subagents
                                           │
                                           │ skill candidate
                                           ▼
                                  Agent Skill Store
                                  function-scoped memory
                                           │
                                           │ scoped retrieval
                                           └───────────────► owning subagent

 L&SC sources ──► L&SC Data Plant ── approved APIs/contracts ──► ZAS

 Future Zink Q&A ── retrieval only ──► Research Knowledge Store
```

Both Knowledge stores may reuse the same PostgreSQL/pgvector and object-storage
infrastructure. They are still separate logical stores: store identity,
persistence namespace, publication state, provenance, access policy, and
retrieval path must not be mixed.

## 3. Knowledge-store model

### 3.1 Research Knowledge Store

The Research Knowledge Store is derived from approved human/reference sources.
The source Obsidian Vault remains human-owned and read-only to ingestion. ZAS
research agents retrieve factual/reference evidence from this store with
provenance/citations; they do not write learned skills into it. Research
subagents may also retrieve **procedural learned skills** from their own
function-scoped Agent Skill Store namespace, but the two retrievals remain
separate. Zink Q&A is expected to consume the Research Knowledge Store in a
later project phase.

### 3.2 Agent Skill Store

The Agent Skill Store is a separate persistent knowledge domain for skills
learned during ZAS execution.

Its core invariant is:

```text
1 function = 1 subagent = 1 skill namespace
```

Each ZAS leaf function receives one stable `function_id`, one stable
`subagent_id`, and one persistent skill namespace. A functional subagent retrieves
only its own namespace by default. Cross-function skill sharing is not implicit;
if a capability is truly a separate reusable function, it should have its own
subagent/namespace or be invoked through an explicit ZAS handoff.

The learning lifecycle is:

```text
subagent execution
→ ZAS captures outcome/evidence
→ ZAS creates/evaluates skill candidate
→ Knowledgebase skill-intake API/contract
→ structural + provenance validation
→ versioned persistence
→ ACTIVE publication when authorized
→ embedding/indexing inside the owning function namespace
→ scoped retrieval back to that subagent
```

Only `ACTIVE` skills are returned by normal retrieval. ZAS never writes database,
vector-index, or object-storage internals directly.

## 4. Ownership model

- `platforms/knowledge-platform/` owns source policy, deterministic processing,
  `knowledge-ai`, both Knowledge stores, persistent store identity, indexing,
  retrieval, provenance/citations, and storage-level access contracts.
- `platforms/lsc-data-plant/` owns L&SC control-plane state, ETL, governed data
  layers, semantic models, data products, `data-ai`, and model lifecycle.
- `infrastructure/` owns runtime capabilities such as containers, networking,
  PostgreSQL/pgvector, object storage, Redis, Nginx, observability, and local
  model runtime. Infrastructure does not own domain policy.
- `integrations/agents-system/` owns only the Zink Knowledgebase side of the
  cross-project contract: compatibility notes/tests and function/subagent/store
  mapping rules. Agent runtime remains in the ZAS repository.
- `shared/` contains only domain-neutral code, schemas, utilities, and telemetry
  clients.
- `experiments/` is isolated from governed production state until explicitly
  promoted.

One capability has one canonical owner.

## 5. Internal AI boundaries

Zink Knowledgebase does **not** contain a general AI Platform.

Two bounded AI-assisted capabilities remain inside their owning domains:

- `knowledge-platform/knowledge-ai/` supports document/skill representation,
  chunking, embeddings, and reranking required by Knowledge storage/retrieval.
  It does not decide what ZAS should learn or when a learned skill is useful.
- `lsc-data-plant/data-ai/` assists profiling, quality assessment, anomaly
  detection, deduplication, remediation suggestions, and operational
  recommendations.

`data-ai` is advisory. It is **not a control plane** and is not a mandatory ETL
stage. The deterministic L&SC `control-plane/` owns pipeline execution, run
state, retries, promotion gates, recovery, and governed mutations.

## 6. Canonical target directory tree

The tree below is the target ownership map, not proof that every directory is
implemented today.

```text
personal-tool/
├── AGENTS.md
├── PLAN.md
├── README.md
├── CHANGELOG.md
├── .agents/
│   ├── skills/                         # repository coding-agent harness only
│   │   ├── planning/SKILL.md
│   │   ├── architecture-review/SKILL.md
│   │   ├── execution/SKILL.md
│   │   ├── code-review/SKILL.md
│   │   ├── debugging/SKILL.md
│   │   └── validating/SKILL.md
│   └── states/
│       ├── README.md
│       ├── context.md
│       ├── findings.md
│       └── handoff.md
├── infrastructure/
│   ├── docker/{compose,env,scripts,volumes}/
│   ├── databases/{postgres,redis,object-storage}/
│   ├── nginx/
│   ├── observability/
│   ├── networking/
│   ├── gpu/
│   └── deployment/
├── platforms/
│   ├── knowledge-platform/
│   │   ├── ingestion/
│   │   │   ├── connectors/{obsidian,books,papers,pictures,videos,templates}/
│   │   │   └── processing/{parsers,cleaners,normalizers,metadata-extraction}/
│   │   ├── knowledge-ai/{document-understanding,chunking,embeddings,reranking}/
│   │   ├── stores/
│   │   │   ├── README.md
│   │   │   ├── research-knowledge-store/
│   │   │   │   ├── README.md
│   │   │   │   ├── policies/
│   │   │   │   ├── namespaces/
│   │   │   │   ├── provenance/
│   │   │   │   └── publication/
│   │   │   └── agent-skill-store/
│   │   │       ├── README.md
│   │   │       ├── function-registry/
│   │   │       ├── intake/
│   │   │       ├── validation/
│   │   │       ├── lifecycle/
│   │   │       ├── provenance/
│   │   │       ├── publication/
│   │   │       └── namespaces/
│   │   │           ├── _template/
│   │   │           ├── automation/{integrations,operations,triggers,workflow}/
│   │   │           ├── business/{financial-analysis,market-analysis,operations-analysis,performance}/
│   │   │           ├── data/
│   │   │           │   ├── {analysis,ingestion,transformation,validation}/
│   │   │           │   └── reporting/{excel,power-bi}/
│   │   │           ├── lscm/{demand-planning,inventory,logistics-operations,optimization,procurement,production-planning,supplier-management,supply-planning,transportation,warehouse}/
│   │   │           ├── research/{evidence-review,research-planning,synthesis,validation}/
│   │   │           └── system/{configuration,diagnostics,maintenance,monitoring}/
│   │   │               # 32 current ZAS leaf functions; one subagent per leaf
│   │   ├── indexing/{metadata-store,vector-store,index-runs,publication}/
│   │   ├── retrieval/{search,filters,citations,source-policy}/
│   │   ├── services/knowledge-api/
│   │   └── {policies,configs,schemas,tests,docs}/
│   └── lsc-data-plant/
│       ├── control-plane/{pipeline-definitions,run-state-machine,scheduling-contracts,retries,promotion-gates,recovery}/
│       ├── ingestion/{connectors,source-contracts,ingestion-runs}/
│       ├── landing/
│       ├── validation/{schema-validation,data-quality-rules,validation-runs}/
│       ├── quarantine/
│       ├── anonymization/
│       ├── bronze/
│       ├── pipelines/{bronze-to-silver,silver-to-gold,pipeline-runs}/
│       ├── silver/
│       ├── data-ai/{profiling,quality-assessment,anomaly-detection,deduplication,business-rules,remediation,recommendations}/
│       ├── gold/
│       ├── semantic-layer/{metrics,dimensions,entities,semantic-models}/
│       ├── products/{analytics,dashboards,rag,feature-store,training-data,forecasting,optimization,api}/
│       ├── modeling/{datasets,features,forecasting,machine-learning,operations-research,evaluation,model-registry,inference}/
│       ├── governance/{catalog,metadata,lineage,configuration,approval-policies,documentation}/
│       ├── services/{pipeline-runner,data-api,model-runner}/
│       └── {configs,schemas,tests,docs}/
├── integrations/
│   └── agents-system/
│       ├── README.md
│       ├── compatibility/
│       ├── function-skill-mapping/
│       └── tests/
├── shared/{libraries,schemas,prompts,templates,constants,utilities,telemetry,assets}/
├── configs/{external-resources,model-profiles,system-defaults}/
├── docs/{architecture,contracts,adr,runbooks,roadmap,glossary,development}/
├── experiments/{rag,data-quality,forecasting,machine-learning,operations-research,optimization}/
├── tests/{integration,e2e,smoke,fixtures,helpers}/
└── scripts/{bootstrap,development,maintenance,verification}/
```

## 7. Current-to-target migration notes

These are architecture notes, not immediate execution authorization.

- The accepted M3 implementation currently lives under `apps/knowledge/`. Do
  **not** move it during M4. A dedicated post-M5 structural task must migrate it
  to `platforms/knowledge-platform/services/knowledge-api/` while preserving
  behavior, imports, migrations, runtime identity, tests, and rollback.
- The two-store architecture is an additive target. Existing M3–M5 research
  indexing remains the Research Knowledge Store lineage; it must not be silently
  reinterpreted as agent-skill storage.
- Agent Skill Store implementation is deferred to its approved milestone. The
  directory/architecture contract may exist before runtime tables/indexes do.
- Two logical stores do **not** require two PostgreSQL servers, two pgvector
  services, or duplicate embedding infrastructure. Physical separation is added
  only if isolation/performance evidence later requires it.
- Empty/stale `applications/`, AI-query, automation-platform, and agent-specific
  runtime placeholders do not belong to the canonical Zink Knowledgebase target.
- General agent/automation runtime belongs to ZAS. Existing n8n runtime inherited
  from accepted infrastructure may remain temporarily for regression
  compatibility but gains no new Knowledgebase ownership.
- `feature-store` remains an L&SC **data product**. Feature engineering belongs
  under `modeling/features/`.
- `data-ai/approval` and any separate `data-ai-control-plane/` are not canonical.
  Approval/promotion authority belongs to deterministic control-plane or
  governance policy.

## 8. Non-goals

Zink Knowledgebase does not own:

- general-purpose agents or subagent orchestration;
- ZAS task planning, delegation, tool routing, or learning algorithms;
- autonomous browser/tool execution;
- general automation workflows;
- a generic AI gateway/platform;
- a second agent runtime hidden inside the Agent Skill Store;
- a separate database/service per functional subagent unless future evidence
  requires it;
- Kubernetes/Kafka-scale infrastructure without a demonstrated requirement.

## 9. Architecture documents

- `platform-boundaries.md` — canonical ownership and dependency rules.
- `knowledge-flow.md` — dual Knowledge-store ingestion/learning/retrieval flows.
- `agents-system-boundaries.md` — ZK ↔ ZAS ownership and API boundary.
- `data-flow.md` — L&SC governed data/model lifecycle and Data AI sidecar role.
