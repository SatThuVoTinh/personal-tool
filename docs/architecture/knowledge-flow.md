# Knowledge Flow

Zink Knowledgebase has two separate Knowledge-store lifecycles. They share
infrastructure and selected representation/indexing components but never share
source authority, write policy, or a queryable publication namespace.

## 1. Research Knowledge Store

```text
Approved human/reference source
    │
    ▼
Source discovery
    │
    ▼
Eligibility / source policy
    │
    ▼
Document processing
    ├─ parsing
    ├─ normalization
    ├─ metadata extraction
    └─ bounded document understanding
    │
    ▼
Canonical document representation
    │
    ▼
Chunking / embedding
    │
    ▼
Research index build
    ├─ metadata
    ├─ vectors
    └─ source provenance
    │
    ▼
Validation
    │
    ▼
Atomic Research publication
    │
    ▼
Research retrieval
    ├─ search
    ├─ filtering
    ├─ reranking
    └─ citation reconstruction
    │
    ▼
Knowledge API
    ├─ ZAS research agents
    ├─ future Zink Q&A
    └─ local diagnostics/tests
```

The source Obsidian Vault is human-owned and read-only to ingestion. Research
indexes are derived artifacts and must remain reproducible from permitted
sources and pinned processing/model identities.

### Research source policy

| Source          | Default architecture policy                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| `01. Knowledge` | Active Markdown ingestion and retrieval                                                                         |
| `02. Books`     | Sidecar/contract-controlled PDF ingestion and retrieval                                                         |
| `03. Papers`    | Sidecar/contract-controlled PDF ingestion and retrieval                                                         |
| `04. Pictures`  | Permitted image ingestion after M5 contracts/gates are approved                                                 |
| `05. Videos`    | Permitted video ingestion after M5 contracts/gates are approved                                                 |
| Templates       | Process only under an explicit template/source policy                                                           |
| Notes           | Excluded unless a later explicit source contract includes them                                                  |
| Archives        | Never scanned directly; may hold referenced physical artifacts only when an owning source contract permits them |

## 2. Agent Skill Store

The Agent Skill Store does not ingest Obsidian. Its source is a governed skill
candidate produced by ZAS after functional execution.

```text
ZAS functional subagent execution
    │
    ▼
Outcome/evidence capture
    │
    ▼
ZAS candidate extraction + semantic evaluation
    │
    ▼
Skill Store intake API
    │
    ▼
Identity/schema/provenance/idempotency validation
    │
    ▼
Versioned CANDIDATE persistence
    │
    ├─ REJECTED
    ├─ DEPRECATED
    └─ ACTIVE publication
          │
          ▼
      function-scoped embedding/index
          │
          ▼
      scoped skill retrieval
          │
          ▼
      owning ZAS subagent
```

Core invariant:

```text
1 function = 1 subagent = 1 skill namespace
```

A broader team such as `data/` is organizational grouping. The leaf functions,
for example `data/ingestion` and `data/validation`, have separate namespaces and
separate subagents.

## 3. Shared components, isolated state

The two stores may share:

- PostgreSQL/pgvector service;
- object-storage service;
- embedding/reranking model runtime;
- common Knowledge API process;
- generic indexing/retrieval libraries.

They must not share:

- a queryable ACTIVE index generation;
- write authorization;
- source identity semantics;
- publication/lifecycle state;
- provenance semantics;
- retrieval namespace.

This provides two real logical stores without duplicating infrastructure.

## 4. Ownership rules

- `knowledge-ai` may support representation/indexing/retrieval; it cannot mutate
  the source Vault or become a general agent system.
- Only Knowledge Platform code may publish either store's index generations.
- ZAS may submit skill candidates through contract but never writes vector/index
  state directly.
- Research consumers never write Research Knowledge state.
- Failed/partial source, batch, candidate publication, or generation must never
  become normally retrievable.
- Research citation provenance and Agent Skill evaluation provenance remain
  attached through their respective lifecycles.
