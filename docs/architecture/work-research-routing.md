# Work / Research Routing

## Principle

Main classifies task mode from user intent before routing when the distinction is
material.

```yaml
mode: work | research
```

No separate Work Skill Store or Research Skill Store is created.

## Work mode

Typical signals:

- real operational/business deliverable;
- current company/user data;
- Excel/Power BI output;
- KPI reporting or live analysis;
- deadline or operational decision;
- production forecast/optimization usage.

## Research mode

Typical signals:

- experiment or benchmark;
- model training/retraining;
- backtest or algorithm comparison;
- paper/method exploration;
- feature engineering experiment;
- decision-rule or methodology improvement.

## Mixed mode

A task can contain both:

```yaml
mode:
  primary: work
  secondary: research
```

Example: produce this week's production forecast while benchmarking a candidate
model in parallel.

The work path uses approved production logic. The research path remains isolated
and cannot silently replace the production model, template, business rule or
operational output.

## Routing responsibility

Main owns task-mode classification. O1 may clarify semantic/business ambiguity;
O2 routes authorized execution/intelligence specialists. Specialists preserve the
mode metadata and do not self-promote research results.
