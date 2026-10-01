# Zink System Overview

## Modules

Zink has exactly three logical peer modules:

1. Zink Knowledgebase owns approved human/reference ingestion, indexing,
   retrieval, provenance and citations.
2. Zink Skill Store owns governed reusable skills and owner-built templates.
3. Zink Tools owns a thin callable adapter-contract boundary.

apps/knowledge/ remains the accepted Knowledgebase runtime until a separately
approved migration. Canonical peer paths are zink-skill-store/ and zink-tools/;
neither is nested under Knowledgebase.

## Orchestration boundary

OpenClaw owns agent orchestration, routing, permissions and model-tool execution.
n8n owns deterministic workflow execution and run state. OpenClaw reaches Skill
Store through the governed Zink Tools boundary: `zink_skill_search` for
ACTIVE-only semantic retrieval and `zink_skill_propose` for candidate proposals.
A proposal is durably stored, confirmed by the owner on the dedicated #office
learning path with an exact content binding, materialized into the canonical
Git-native store by trusted internal promotion, and then derived into the
pgvector index. The vector index is derived; the Git-native store is the source
of truth.

For M7/T2, the model-invisible `zink-governance` OpenClaw integration enforces
the approved five-stack topology. Its trusted operator ledger owns task dedupe,
budget reservation, lineage, result acceptance, cancellation and restart
reconciliation; it is not a fourth repository module and exposes no model tool.

## Skill Store governance

Skill identity is capability + namespace + version. Research/candidate output
cannot become ACTIVE until the owner explicitly promotes it. Templates use Git
for metadata/versioning and external storage for binary artifacts when needed.

## Runtime separation

A capability is not a service by default. Create a process or service only when
a concrete runtime need justifies it. Model metadata stays lightweight and beside
the decision-science capability; model training, serving, registries and
evaluation pipelines are outside this task.

## L&SC Data Plant

The historical L&SC Data Plant term refers only to the logical external
data/compute flow described in [lsc-data-flow.md](lsc-data-flow.md). It is not a
repository module, runtime, generic ETL control plane, lakehouse or MLOps
platform.
