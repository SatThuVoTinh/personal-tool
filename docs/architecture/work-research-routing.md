# Work / Research Routing (proposal)

Status: proposal — not implemented.

Main classifies task mode before routing when the distinction is material:

```yaml
mode: work | research
```

Work mode covers operational/business deliverables, current data, KPI reports,
live analysis and production decisions. Research mode covers experiments,
benchmarks, backtests, methodology and model improvements. A mixed task keeps
production output isolated from research output.

Routing remains subject to the five-stack topology. Semantic facts are resolved
before Data Plant work when meaning is missing or ambiguous; Data Plant never
invents business semantics. Intelligence requests missing validated datasets
through Main, and Decision cannot compensate for missing mandatory evidence.
Specialists preserve mode metadata and do not self-promote research evidence.

**No runtime carries this mode.** No schema, persistent contract or source file
in this repository declares a `mode` field, and no routing test distinguishes the
two cases, so the classification above is a proposal for a future contract rather
than current behaviour. It is kept here so the vocabulary is not lost, and no
other canonical document delegates to it.
