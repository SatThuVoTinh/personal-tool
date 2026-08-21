# Platform Boundaries

This document is the canonical ownership contract for Zink Knowledgebase. Other
architecture documents may explain these boundaries but must not silently
redefine them.

| Area                               | Owns                                                                                                                                                                                                                                      | Does not own                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure                     | Docker/runtime, networking, PostgreSQL/pgvector, Redis, object storage, Nginx, observability, backup, local model runtime                                                                                                                 | Knowledge semantics, store access policy, L&SC ETL policy, model/domain decisions, agent orchestration                                         |
| Knowledge Platform                 | Research Knowledge Store; Agent Skill Store; source policy; document/skill representation; embeddings; indexing; retrieval; citations/provenance; store publication/version state; storage-level authorization                            | General agent runtime, task planning, subagent orchestration, ZAS learning/evaluation logic, L&SC transformations/models                       |
| Research Knowledge Store           | Derived reference knowledge from approved sources; reproducible index generations; source provenance/citations; research retrieval                                                                                                        | Agent self-learned skills, ZAS task memory, write-back to Obsidian                                                                             |
| Agent Skill Store                  | Versioned learned-skill records; one function/subagent/namespace mapping; intake contract; structural/provenance validation; lifecycle persistence; scoped indexing/retrieval                                                             | Executing agents, deciding tasks, evaluating task success, generating skill candidates, silently sharing skills across functions               |
| L&SC Data Plant                    | L&SC control plane, ingestion, validation, quarantine, anonymization, Bronze/Silver/Gold, semantic layer, data products, `data-ai`, model lifecycle, lineage/governance                                                                   | Knowledge indexing, general agent orchestration, generic automation platform                                                                   |
| Zink Agents System                 | Agent/subagent runtime, team/function decomposition, task planning/delegation, tools/permissions, workflow state, automation, outcome evaluation, skill-candidate generation, promotion intent, deciding when a subagent retrieves skills | Knowledgebase persistent-store internals, Obsidian ingestion/index authority, direct pgvector/table/object-store mutation, L&SC governed state |
| Agents System integration boundary | Zink Knowledgebase-side API/contract mapping, compatibility tests, function↔subagent↔skill-namespace mapping compatibility                                                                                                                | Agent runtime, duplicated domain logic, cross-project workflow state                                                                           |
| Shared                             | Domain-neutral libraries, schemas, utilities, templates, telemetry clients                                                                                                                                                                | Domain state, ETL, indexing, model training, agent runtime ownership                                                                           |
| Experiments                        | Isolated evaluation of candidate techniques using disposable/approved data                                                                                                                                                                | Governed production state or implicit promotion into production                                                                                |

## Dependency rules

1. Knowledge and L&SC persistent state is mutated only by the owning platform
   through approved contracts.
2. ZAS may submit Agent Skill Store candidates and lifecycle requests only
   through the Knowledge Platform API/contract; it never writes storage internals
   directly.
3. Research Knowledge Store is read-only to ZAS. Its write path remains the
   Knowledge ingestion/index publication pipeline from approved sources.
4. Agent Skill Store is not an Obsidian-derived store and must not share a
   queryable index generation with Research Knowledge Store.
5. Both stores may reuse the same physical PostgreSQL/pgvector/object-storage
   infrastructure, provided logical persistence, index publication, provenance,
   authorization, and retrieval remain isolated.
6. Every active functional skill namespace maps one-to-one to one stable ZAS
   `function_id` and one stable `subagent_id`.
7. Functional subagents retrieve only their own skill namespace by default.
   Cross-function retrieval requires an explicit ZAS orchestration contract and
   must not collapse namespace ownership.
8. Infrastructure may be depended on by platforms; Infrastructure does not
   depend on domain implementation.
9. `shared/` remains domain-neutral. Domain-specific policy belongs to its owner.
10. Experiments must not write directly to governed production stores.
11. Integration adapters must not duplicate platform business logic or become a
    second source of truth.

## Knowledge-store rules

### Research Knowledge Store

`platforms/knowledge-platform/stores/research-knowledge-store/` represents the
human/reference knowledge domain. Existing Markdown/PDF/image/video ingestion
belongs to this lineage. Normal outputs require source provenance and citation
reconstruction.

Primary consumers:

- ZAS research agents;
- future Zink Q&A;
- local diagnostics/tests.

### Agent Skill Store

`platforms/knowledge-platform/stores/agent-skill-store/` represents learned
functional skill memory.

The invariant is:

```text
1 function = 1 subagent = 1 skill namespace
```

ZAS owns semantic learning/evaluation. Knowledgebase owns durable storage and
retrieval correctness. Normal retrieval returns only published `ACTIVE` skill
versions from the caller's authorized namespace.

`.agents/skills/` is not part of this runtime store; it is only the repository
coding-agent harness.

## Internal AI rules

### Knowledge AI

`platforms/knowledge-platform/knowledge-ai/` is an internal Knowledge capability
for document/skill representation, chunking, embedding, and reranking. It does
not become a general agent runtime and does not own ZAS learning policy.

### Data AI

`platforms/lsc-data-plant/data-ai/` is an internal advisory capability. It may
analyze governed evidence and produce recommendations, but it does not own run
state, approvals, retries, promotion, rollback, or governed mutations.

The L&SC `control-plane/` remains the only orchestration/execution authority for
the governed data pipeline. Human approval or deterministic policy belongs in
control-plane/governance, not in Data AI.
