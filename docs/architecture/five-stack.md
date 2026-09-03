# Five-Stack Operating Model

The five stacks are **functional processing layers**, not five permanent agent
processes and not five repository modules.

## Stack 1 — Infrastructure

Existing infrastructure used directly when practical:

```text
R2 | DuckDB | MotherDuck | Kaggle | Databricks | local compute
```

Purpose: storage, query, CPU/GPU/notebook compute and external execution capacity.

## Stack 2 — Execution

Baseline execution specialists:

```text
Excel Specialist
Power BI Specialist
SQL Specialist
Python Specialist
```

n8n provides deterministic trigger/schedule/workflow plumbing. Stack 2 turns a
bounded business/analytical requirement into reproducible execution and
artifacts.

## Stack 3 — Semantic

O1 resolves domain meaning, KPI definitions, business rules, constraints,
policies and ambiguity before execution where required.

An execution specialist must not invent business semantics merely because it can
write the code or file.

## Stack 4 — Intelligence

```text
Forecast
Optimization
Operations Research
Simulation
```

These capabilities may use external compute and may be invoked lazily. The same
Stack 4 supports operational work and after-hours R&D.

## Stack 5 — Decision

Main + O1 + O2 compare evidence, scenarios, operational risk and trade-offs to
produce the recommendation or decision support.

Model accuracy alone is not final decision quality. Operational constraints,
risk and downstream outcome remain part of Stack 5 evaluation.

## Agent-to-stack rule

`agent != stack`.

One specialist may serve multiple stacks. For example, Python may perform Stack 2
transformation and execute a Stack 4 forecast/simulation. Stack identity describes
the role of the processing stage, not who permanently owns a process.
