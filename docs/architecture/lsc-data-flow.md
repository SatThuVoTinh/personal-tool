# L&SC Data Flow

The historical **L&SC Data Plant** name is retained only for this logical flow.
It is not a separate repository module, service or self-built data platform.

## Default flow

```text
Operational / external source
          │
          ▼
     n8n / Python
          │
          ▼
R2 / DuckDB / MotherDuck
          │
          ▼
Kaggle / Databricks / local compute
          │
          ▼
Forecast / Optimization / OR / Simulation
          │
          ▼
        OpenClaw
          │
          ▼
Decision / recommendation
          │
          └─► Excel / Power BI delivery when required
```

This is a capability chain, not a requirement that every task pass through every
service. Use the minimum infrastructure needed for the task.

## Infrastructure roles

- **R2** — external object/file storage where appropriate.
- **DuckDB** — lightweight analytical SQL execution, often local/in-process.
- **MotherDuck** — shared/remote DuckDB-oriented analytical persistence/query when
  useful.
- **Kaggle** — external notebook/CPU/GPU experimentation or training when useful.
- **Databricks** — heavier Spark/ML/data workloads only when the task justifies it.
- **local compute** — preferred when it is sufficient and simpler.
- **n8n** — deterministic trigger/schedule/integration plumbing.
- **OpenClaw** — agent orchestration, interpretation and decision workflow.

## Decision-science capabilities

```text
forecast
optimization
operations-research
simulation
```

Training and heavy artifacts may live outside the repository. Zink retains only
lightweight metadata/config/evaluation references required to reproduce or invoke
approved work.

## Non-goals

Do not build:

- Bronze/Silver/Gold merely to imitate a lakehouse architecture;
- a generic ETL control plane;
- a generic provider abstraction layer;
- a feature store or model registry without a concrete need;
- a custom scheduler that duplicates n8n;
- a second orchestrator that duplicates OpenClaw.
