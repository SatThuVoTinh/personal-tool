# Zink Agents System Boundaries

## Principle

Zink Knowledgebase owns governed persistent knowledge. Zink Agents System (ZAS)
owns agents, execution, learning behavior, and orchestration.

The integration relationship is:

```text
ZAS consumer/producer
→ explicit Knowledgebase API/contract
→ owning Knowledge store
```

It is never shared database ownership.

## Dual-store relationship

ZAS connects to two different Knowledgebase stores for two different purposes:

| Store                    | ZAS usage                                                                                                         | ZAS write access                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Research Knowledge Store | Research agents retrieve human/reference knowledge with citations                                                 | No                                         |
| Agent Skill Store        | Functional subagents retrieve their own learned skills; ZAS submits versioned skill candidates/lifecycle requests | Contract-only; never direct storage writes |

Future Zink Q&A is expected to consume the Research Knowledge Store, not the
Agent Skill Store, unless a later explicit product contract says otherwise.

## Zink Agents System owns

- agent and subagent orchestration;
- the `teams/<team>/<function>` decomposition and leaf functional identities;
- task planning and delegation;
- permissions/tool policy;
- cross-project workflow/run state;
- general automation and schedules;
- browser/tool execution;
- task outcome/evidence capture;
- skill extraction/candidate generation;
- semantic evaluation of whether a candidate is useful/correct;
- promotion/deprecation intent;
- deciding when a subagent requests research or functional skill context.

## Zink Knowledgebase owns

- Research Knowledge ingestion, embeddings, indexing, retrieval, and citations;
- Agent Skill Store durable records, versions, provenance, publication state,
  index generations, scoped retrieval, and storage-level authorization;
- the canonical function↔subagent↔skill-namespace persistence mapping accepted
  through the integration contract;
- L&SC ETL, governed layers, semantic/data products;
- L&SC Data AI advisory logic;
- forecasting, machine-learning, and operations-research model lifecycle;
- its own persistent data and runtime contracts.

## One function = one subagent = one skill namespace

Every ZAS leaf function maps to one and only one skill namespace.

Example:

```text
ZAS teams/data/ingestion  ──► skill namespace data/ingestion
ZAS teams/data/validation ──► skill namespace data/validation
```

The data-ingestion subagent does not write or retrieve data-validation skills by
default, even though both belong to the broader Data team.

A team directory is organizational grouping only. It is not itself a skill
namespace unless the team is also an actual executable leaf function with its
own subagent.

## Skill learning/write flow

```text
1. Functional subagent executes a task.
2. ZAS captures outcome, evidence, constraints, and reusable lesson.
3. ZAS creates and evaluates a skill candidate for that function_id/subagent_id.
4. ZAS submits the candidate through the Knowledgebase Skill Store contract.
5. Knowledgebase validates identity/schema/provenance/idempotency and persists a
   versioned candidate.
6. ZAS requests promotion/deprecation according to its learning policy and
   evidence.
7. Knowledgebase persists the lifecycle transition and publishes only approved
   ACTIVE versions into that function's retrieval index.
8. Later executions retrieve ACTIVE skills from the same function namespace.
```

This prevents an executing subagent from turning arbitrary output directly into
trusted long-term memory.

## Allowed integration

ZAS may use approved interfaces to:

- query Research Knowledge with citations;
- request permitted Research index/rebuild operations where an explicit admin
  contract allows it;
- submit Agent Skill Store candidates with stable function/subagent identity,
  evidence, and idempotency identity;
- request skill promotion, deprecation, or rejection transitions when authorized;
- retrieve ACTIVE skills scoped to the owning functional namespace;
- inspect skill versions/provenance needed for evaluation or rollback;
- inspect L&SC run/data-quality/model status;
- request permitted pipeline/model operations;
- receive exposed events/notifications when such contracts exist.

## Forbidden integration

ZAS must not:

- write Research Knowledge vector/index tables directly;
- write Agent Skill Store tables/vector rows/object-storage internals directly;
- create an independent embedding/index pipeline for the same Knowledgebase
  stores;
- mix Research Knowledge and Agent Skill Store records in one queryable index
  generation;
- allow a leaf subagent to use another function's skill namespace by default;
- publish a raw candidate as trusted skill memory without lifecycle state;
- mutate the source Obsidian Vault through retrieval interfaces;
- write Bronze/Silver/Gold or L&SC lineage directly;
- bypass L&SC control-plane promotion/approval gates;
- treat Data AI recommendations as execution authorization;
- train/deploy L&SC models by bypassing the L&SC model lifecycle;
- duplicate Knowledge/L&SC domain logic inside agent workflows.

## Repository integration folder

`integrations/agents-system/` stays thin. It may contain:

- compatibility matrices;
- cross-repository contract/version notes;
- function/subagent/skill-namespace mapping compatibility;
- integration fixtures and tests;
- event/API compatibility evidence.

Canonical Knowledge APIs/schemas remain with Knowledge Platform. Agent runtime,
team definitions, learning policy, and orchestration remain in the ZAS
repository.
