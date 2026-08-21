# Cline Subagent Playbook

Use this playbook only from an authorized execution/debug task.

Cline subagents are read-only reconnaissance workers. They may inspect files,
search code, list directories, run read-only commands, and use skills. They do
not own edits, architecture decisions, scope decisions, acceptance, or handoff.

## Default delegation set

Launch only the agents actually needed. Maximum: three.

### A. Implementation mapper

Use when affected code or dependencies are unclear.

Prompt shape:

```text
Read-only reconnaissance for the currently authorized Active Task.
Map the smallest implementation surface. Identify canonical owners, affected
files/symbols, dependency flow, existing patterns to reuse, and relevant
architecture/contracts. Do not redesign, broaden scope, or propose future work.
Return only verified facts, important paths/symbols, uncertainties, and blockers.
Prioritize the files main Cline should read next.
```

### B. Validation mapper

Use when test/validation impact is unclear.

Prompt shape:

```text
Read-only reconnaissance for the currently authorized Active Task.
Map existing tests, validation scripts, package/repository commands, fixtures,
and likely regression surfaces for the authorized change. Identify relevant
baseline failures only when supported by evidence. Do not edit or weaken tests.
Return exact paths/commands, what each validates, and uncertainties/blockers.
```

### C. Risk mapper

Use only when the task touches or may touch security, persistence, schema,
migrations, infrastructure, resource ceilings, cross-platform behavior, or
cross-platform/project boundaries.

Prompt shape:

```text
Read-only risk reconnaissance for the currently authorized Active Task.
Inspect only relevant security, persistence, schema/migration, infrastructure,
resource, compatibility, and ownership boundaries. Identify contract-sensitive
surfaces and any condition that would require an owner decision. Do not redesign
or recommend scope expansion. Return evidence, paths, risks, and blockers.
```

## Reconciliation rules

After subagents return:

1. Treat reports as leads, not authority.
2. Main Cline re-reads decisive files before editing.
3. Resolve contradictory reports against `AGENTS.md`, `PLAN.md`, valid
   `ACTIVE.md`, canonical architecture/contracts, and repository evidence.
4. Never merge speculative recommendations into scope.
5. If a report exposes a material missing decision, follow the Owner Decision
   Protocol and stop affected execution.
6. Do not launch another wave merely because a report is verbose; only delegate
   again for a new, focused evidence gap.
