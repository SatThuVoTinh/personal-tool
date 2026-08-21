# Architecture Index

Read architecture progressively. Do not load every document unless the task
crosses those boundaries.

1. `system-overview.md` — system purpose, dual Knowledge-store model, canonical target tree, migration notes.
2. `platform-boundaries.md` — canonical ownership and dependency rules.
3. `knowledge-flow.md` — Research Knowledge and Agent Skill Store lifecycles.
4. `agents-system-boundaries.md` — external Zink Agents System integration and one-function/one-subagent/one-skill-namespace rules.
5. `data-flow.md` — L&SC governed data/model lifecycle and Data AI role.

## Authority

`platform-boundaries.md` is authoritative for ownership. Detailed runtime/API
contracts live under `docs/contracts/`. `PLAN.md` controls durable task/milestone
state and authorization; a matching valid `docs/contracts/execution/ACTIVE.md`
contains the frozen implementation details for the current task. Architecture
documents describe approved structure; they do not prove implementation or
authorize future work.

When diagrams or target trees disagree with validated implementation, do not
silently rewrite runtime behavior. Record the mismatch and use the applicable
plan/contract migration gate.
