# L&SC Governed Data and Model Flow

The L&SC Data Plant owns deterministic ingestion, governed transformations,
data products, and model lifecycle. `data-ai` may advise these stages, but it is
not a second control plane and its output never authorizes a governed mutation
by itself.

## Governed data lifecycle

```text
Approved L&SC source
    → Control-plane run authorization
    → Ingestion
    → Landing
    → Validation
        ├─ invalid → Quarantine → governed remediation → Re-validation
        └─ valid   → Anonymization → Bronze
                                      → Bronze-to-Silver pipeline
                                      → Silver
                                      → Silver-to-Gold pipeline
                                      → Gold
                                      → Semantic layer / products
```

The `control-plane/` owns pipeline definitions, run state, ordering, retries,
promotion gates, idempotency, failure recovery, and governed state transitions.
Connectors, validators, transformations, Data AI, and model runners act only
inside authority issued by that control plane or an explicit human/governance
decision represented through it.

## Data AI sidecar role

`data-ai/` may consume permitted governed evidence for profiling, quality
assessment, anomaly detection, deduplication, business-rule analysis,
remediation suggestions, and operational recommendations. Its output is
advisory evidence. It cannot directly:

- advance Bronze, Silver, or Gold promotion state;
- own pipeline runs, retries, rollback, or recovery;
- bypass validation, approval, or lineage requirements;
- mutate another platform's persistent state;
- turn model output into execution authorization.

## Data products and model lifecycle

Gold and the semantic layer may feed analytics, dashboards, L&SC RAG, APIs,
feature-store publication, training data, forecasting, and optimization. The
`feature-store` remains a data product; feature engineering belongs to
`modeling/features/` and follows the versioned dataset, evaluation, registry,
and inference lifecycle.

```text
Governed dataset
    → feature engineering
    → forecasting / machine learning / operations research
    → evaluation
    → approved registry transition
    → bounded inference or optimization product
```

Zink Agents System may inspect exposed status or request permitted operations
through approved APIs/contracts. It never receives direct ownership of L&SC
tables, object-store objects, lineage, run state, feature-store state, or model
registry state.

## Persistence boundary

Object storage holds approved physical data artifacts. PostgreSQL holds
structured run state, metadata, lineage, configuration, policy references, and
other relational records. Physical reachability never grants write authority;
all mutations remain owned by the L&SC Data Plant and its governed contracts.
