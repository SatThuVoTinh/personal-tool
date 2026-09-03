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
n8n owns deterministic workflow execution and run state. OpenClaw-to-Skill-Store
is a reserved thin adapter boundary through Zink Tools. It is documentation only
in M5/T1-R2 and has no implementation, API or service.

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
