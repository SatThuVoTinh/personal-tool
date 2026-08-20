# Zink Knowledgebase — Cline harness drop-in

This package is intentionally thin. It assumes the repository already contains:

```text
AGENTS.md
PLAN.md
docs/contracts/execution/ACTIVE.md   # only while execution is authorized
.agents/
├── skills/
│   ├── architecture-review/
│   ├── code-review/
│   ├── debugging/
│   ├── execution/
│   ├── planning/
│   └── validating/
└── states/
    ├── README.md
    ├── context.md
    ├── findings.md
    └── handoff.md
```

## Why this shape

`.agents/skills/` stays the reusable cross-agent procedure source. `.cline/skills/`
contains only Cline-native adapters for the roles Cline actually needs as the
executor:

- `execute-active-task`
- `debug-active-task`
- `validate-active-task`

This avoids copying the planning/review procedures into Cline and reduces role
confusion.

Workspace Cline rules are in `.clinerules/`, the primary rule format documented
for the IDE. They stay short and always-on; detailed procedures load on demand
through Skills.

## Subagents

No fake editable "subagent roles" are created. The execution/debug skills invoke
Cline's native subagents dynamically for read-only reconnaissance. The playbook
caps them at focused code-map, validation-map, and risk-map work. Main Cline is
the only implementation writer.

## Installation

Copy `.cline/` and `.clinerules/` to the repository root. Keep the existing
`.agents/` directory.

Do not copy this package over repository-specific canonical contracts or state.

## Recommended Cline execution flow

```text
AGENTS.md + PLAN.md
        ↓
validate ACTIVE.md authorization
        ↓
execute-active-task
        ↓
optional native read-only subagents
        ↓
main Cline implementation
        ↓
debug-active-task when needed
        ↓
validate-active-task
        ↓
.agents/states/handoff.md
        ↓
Codex review / bounded fix / final validation / closeout
```
