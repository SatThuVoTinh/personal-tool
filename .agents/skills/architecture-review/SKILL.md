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

- no platform directly mutates another platform's governed persistent state
  merely because it is reachable;
- cross-platform effects use approved boundaries;
- source Obsidian Vault is human-owned and read-only;
- Zink Knowledgebase owns only the Knowledge Platform and L&SC Data Plant;
- general agents, orchestration, automation, permissions, and tool execution
  belong to the external Zink Agents System;
- `knowledge-ai` is an internal Knowledge capability, not a general AI platform;
- `data-ai` is advisory and never creates governed L&SC execution authority;
- L&SC `control-plane/` owns run state, retries, promotion gates, recovery, and
  governed pipeline mutations;
- Research Knowledge and Agent Skill Store state remain logically isolated;
- `feature-store` is an L&SC data product, while feature engineering belongs to
  the modeling lifecycle;
- Infrastructure owns runtime capability, not domain policy.
- the accepted `apps/knowledge/` implementation is not moved during M4/M5;
  structural migration requires its own approved task and regression gate.

When architecture docs are insufficient:

> ask or inspect canonical sources; do not invent missing architecture.
