# Architecture Review

## Requirements

Optimize for:

1. correctness;
2. security and data integrity;
3. architectural consistency;
4. simplicity;
5. maintainability;
6. operational reliability;
7. resource efficiency;
8. implementation cost;
9. future extensibility only when justified by concrete requirements.

## Architecture invariants

Detailed canonical architecture lives under `docs/`.

Do not recreate it inside this file.

Repository-wide invariants:

- the repository has three peer logical modules: **Zink Knowledgebase**,
  **Zink Skill Store**, and **Zink Tools**;
- Zink Knowledgebase owns approved reference ingestion, indexing, retrieval,
  provenance, and citations;
- Zink Skill Store owns governed learned-skill persistence and scoped retrieval,
  isolated from research Knowledgebase indexes;
- skill identity is `capability + namespace + version`; there is no canonical
  one-to-one ZAS mapping;
- Zink Tools is a thin adapter-contract boundary for OpenClaw and n8n; the
  OpenClaw-to-Skill-Store adapter is reserved architecture, not current runtime
  evidence;
- OpenClaw owns agent orchestration and model/tool execution behavior; n8n owns
  deterministic workflow execution;
- the historical L&SC Data Plant name describes only the documented logical
  external data/compute flow, not a repository module or self-built runtime;
- forecasting, optimization, operations research, and simulation remain
  first-class Zink Tool capabilities, while provider-specific heavy compute is
  external;
- no module directly mutates another module's governed persistent state merely
  because it is reachable; cross-module effects use approved contracts;
- source Obsidian Vault is human-owned and read-only;
- `knowledge-ai` is an internal Knowledge capability, not a general AI platform;
- Infrastructure owns runtime capability, not domain policy;
- the accepted `apps/knowledge/` implementation is not moved during M5;
  structural migration requires its own approved task and regression gate.

When architecture docs are insufficient:

> ask or inspect canonical sources; do not invent missing architecture.
