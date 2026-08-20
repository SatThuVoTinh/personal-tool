# Agent Working State Protocol

## Purpose

`.agents/states/` is bounded **hot context** for the current task. It exists to
reduce rediscovery when Codex, Cursor, or a subagent resumes work or hands work
to another agent.

State is **memory, not authority**. `PLAN.md` owns durable lifecycle state; a
valid `docs/contracts/execution/ACTIVE.md` owns current implementation details.

State files must never:

- authorize execution;
- override `PLAN.md` or a valid `ACTIVE.md`;
- redefine architecture/contracts;
- change acceptance criteria;
- record owner approval that did not occur;
- serve as completion evidence by themselves.

When state conflicts with `PLAN.md`, a valid `ACTIVE.md`, canonical docs, Git
state, or verified implementation, the state is stale and must be refreshed or
discarded.

## Files

| File          | Purpose                                                            | Typical writer              |
| ------------- | ------------------------------------------------------------------ | --------------------------- |
| `context.md`  | verified task-specific facts that would otherwise need rediscovery | any active agent            |
| `findings.md` | open review/debug/validation findings and their status             | reviewer/debugger/validator |
| `handoff.md`  | compact transfer from one agent/role to another                    | agent handing off work      |

Do not create extra state files unless a repeated need cannot fit these four
without mixing responsibilities.

## Required freshness header

Every non-empty state file starts with:

```text
Task: <PLAN task id>
Plan revision/state: <identifier or current PLAN state>
Repository HEAD: <sha or UNKNOWN>
Working tree: <clean | dirty + scoped summary | UNKNOWN>
Last refreshed: <ISO-8601 timestamp or session marker>
Writer: <Codex | Cursor | subagent/role>
```

These fields are descriptive snapshots. `Execution Authorization` and the
execution-contract reference may be copied for convenience, but the copies never
grant authority. Before any write operation, re-read `PLAN.md` and validate the
current `ACTIVE.md` when execution is authorized.

## `context.md`

Store only **verified facts** that materially reduce rediscovery, for example:

- important implementation locations;
- verified interfaces and invariants;
- relevant dependency relationships;
- exact reproduction conditions;
- why a local implementation choice was made when the decision is GREEN;
- known baseline failures that affect the task.

Separate facts from unresolved assumptions. Unverified guesses do not belong in
`Verified facts`.

## `findings.md`

Use one record per active finding:

```text
ID:
Status: OPEN | FIXED | ACCEPTED-RISK | INVALID
Severity: critical | high | medium | low | note
Source: review | debugging | validation
Evidence:
Affected paths:
Required remediation:
Validation after remediation:
```

A finding is `FIXED` only after the relevant validation passes. Do not delete an
open finding merely because another agent cannot reproduce it; update evidence
and status.

## `handoff.md`

A handoff is concise and action-oriented:

```text
From:
To:
Task / checkpoint:
What changed:
Files changed:
Validation run and results:
Open findings/blockers:
Material risks/impacts:
Next safe action:
Owner decision required:
```

Do not paste terminal transcripts, full diffs, or whole plans. Reference the
source file/command/result when possible.

## Lifecycle

### New task

1. Read `AGENTS.md` and the Active Task in `PLAN.md`.
2. If execution/review is authorized, resolve and validate `ACTIVE.md`.
3. Clear state from unrelated completed work.
4. Initialize only the files needed for the task.
5. Record the repository/working-tree snapshot before edits.

### During work

Update state only at meaningful checkpoints:

- after material discovery;
- after a verified patch/checkpoint;
- when a finding is opened/closed;
- immediately before cross-agent handoff;
- before stopping with a blocker.

Do not update state after every command.

### Resume

1. Re-read `AGENTS.md` and current `PLAN.md`.
2. Compare HEAD/working tree with the state freshness header.
3. Verify material facts that may have changed.
4. Refresh stale state before relying on it.

### Completion

After technical completion:

1. ensure findings reflect final status;
2. record final validation in `handoff.md` when another role must review;
3. remove obsolete transient context;
4. do not convert state into `CHANGELOG.md` unless validated completion rules are
   independently satisfied.

After the task is fully accepted/closed, delete or clear the three mutable local
state files before the next unrelated task.

## Version-control policy

`README.md` is permanent repository guidance. The three mutable state files are
local hot context and are ignored by Git by default. Create them when needed and
reset/delete them when the task closes.

This keeps checkpoint churn out of product diffs and avoids false merge
conflicts between planning/review work and implementation. Agents sharing the
same working tree can still use the files directly. If agents operate in
separate clones/worktrees, handoff context must be transferred explicitly; do
not commit transient state merely to synchronize it.

## Size and content limits

State should stay small enough to read in seconds. Prefer references over copies.

Never store:

- secrets or ignored environment values;
- private Vault content;
- backups or raw datasets;
- full plans/contracts/source files;
- large logs/tool outputs;
- speculative architecture;
- future-task TODO lists unrelated to the Active Task.

## Relationship to Codex and Cursor

- Codex planning may initialize task/context state but cannot use state to grant
  Cursor execution authorization.
- Cursor updates execution checkpoints/handoffs while executing an authorized
  task.
- Codex review/debug/validation uses `findings.md` and may perform only bounded
  remediation allowed by `AGENTS.md`.
- Subagents write only the state explicitly delegated to them.

The intended flow is:

```text
PLAN.md lifecycle/authorization
    ↓
valid ACTIVE.md implementation contract
    ↓
Cursor execution ↔ .agents/states/ hot context
    ↓
Codex review/fix/validation
    ↓
commits + PLAN closeout + ACTIVE deletion
```
