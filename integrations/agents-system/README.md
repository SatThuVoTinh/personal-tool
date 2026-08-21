# Zink Agents System Integration

This directory is the Zink Knowledgebase side of the cross-project integration
boundary.

It may contain:

- compatibility matrices;
- cross-repository contract/version notes;
- `function_id` ↔ `subagent_id` ↔ skill-namespace compatibility mappings;
- integration fixtures and tests;
- event/API compatibility evidence.

It must not contain:

- agent orchestration or workflow state;
- ZAS team/subagent runtime definitions;
- ZAS learning/evaluation policy;
- duplicated Knowledge or L&SC domain logic;
- direct database/vector/object-store mutation clients;
- a second copy of canonical platform schemas.

## Knowledge-store integration

ZAS consumes two explicit Knowledgebase contracts:

1. **Research Knowledge** — read-oriented retrieval with citations for research
   agents and future Zink Q&A consumers.
2. **Agent Skill Store** — function-scoped skill intake/lifecycle/retrieval for
   ZAS functional subagents.

Agent Skill Store mappings obey:

```text
1 function_id = 1 subagent_id = 1 skill namespace
```

Team-level grouping is not a substitute for a leaf function namespace.

Canonical Knowledge/L&SC APIs and schemas remain under their owning platform.
ZAS owns its clients, agents, learning logic, permissions, automation, and
cross-project orchestration.
