# L&SC Data Flow

```text
Source
  → Ingestion
  → Landing
  → Validation
      ├─ invalid → Quarantine → Data AI remediation → Re-validation
      └─ valid   → Anonymization → Bronze → Pipeline → Silver
                                             → Data AI → Gold
                                                          → Semantic Layer
                                                          → Data Products
```

Data Products support analytics, dashboards, LSC Data Product RAG, feature generation, training data, forecasting, optimization, and APIs. Physical data files belong in MinIO buckets; PostgreSQL stores structured state, metadata, lineage, configuration, and other relational records.
