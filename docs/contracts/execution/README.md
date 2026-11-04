# Execution Contract Protocol

`docs/contracts/execution/ACTIVE.md` is the transient, owner-approved execution
contract for the one currently authorized task. It exists only between plan
approval and Codex closeout.

## Responsibility

- `PLAN.md` owns durable task/lifecycle state, approval, authorization, the
  execution-contract pointer, blockers, and completion evidence.
- `ACTIVE.md` owns the frozen implementation details for the current approved
  task. While valid, it is the sole source of truth for those implementation
  details.
- persistent contracts elsewhere under `docs/contracts/` own durable product/API/
  data/runtime behavior.
- `.agents/states/` contains transient hot context only and never grants authority.

`ACTIVE.md` cannot override `AGENTS.md`, canonical architecture, or persistent
contracts. A material conflict stops execution and requires an owner decision.

## Validity

`ACTIVE.md` authorizes implementation only when all conditions hold:

```text
PLAN.md points to docs/contracts/execution/ACTIVE.md
Planning Readiness: APPROVED
Execution Authorization: YES
ACTIVE Task ID == PLAN Active Task ID
ACTIVE Plan Revision == PLAN Plan Revision
```

A stale, orphaned, empty, mismatched, or manually copied `ACTIVE.md` grants no
authority.

## Creation

Before approval, Codex plans/revises without creating executable authority. After
the owner explicitly approves the plan, Codex:

1. assigns/records the approved Plan Revision;
2. materializes the approved implementation details into `ACTIVE.md` without
   widening or silently changing scope;
3. updates `PLAN.md` to `Planning Readiness: APPROVED`,
   `Execution Authorization: YES`, and points `Execution Contract` to `ACTIVE.md`;
4. hands execution to `dsh` (`AGENTS.md` §3's executor role; older contracts and
   plans call it Cursor — same role, one name, and §3 defines only `dsh`).

## Required ACTIVE.md body

Keep it task-specific and deterministic:

```text
Task
Plan Revision
Owner Approval
Objective / prerequisites
Allowed Scope
Excluded Scope
Change Impact
Required Context / Persistent Contracts
Implementation Details / Ordered Steps
Acceptance Criteria / Definition of Done
Required Validation Gates
Documentation Requirements
Handoff / Transition Rules
```

Do not copy roadmap history, unrelated architecture, transient logs, or future
tasks into `ACTIVE.md`.

## Ownership during execution

Only Codex may create, replace, invalidate, or delete `ACTIVE.md`. `dsh` and
subagents are read-only consumers. If a material change is required, Codex sets
`Execution Authorization: NO`, removes/invalidates the old `ACTIVE.md`, returns to
planning, obtains owner approval for a new Plan Revision, then materializes a new
contract.

## Review and closeout

`dsh` hands implementation to Codex. Codex must review/fix/re-review until the
review-convergence and Final Quality Gate are `PASS` or the task is `BLOCKED`.

After PASS:

```text
local implementation commit
→ archive ACTIVE.md into docs/contracts/execution/archive/ and run its scrub rule
→ update PLAN.md / required durable docs, citing the archived file name
→ Execution Authorization: NO
→ Execution Contract: NONE
→ delete ACTIVE.md
→ local closeout commit
→ clean working tree
→ push current non-main task branch when authorized by AGENTS.md
```

`ACTIVE.md` is Git-ignored and must not survive task closeout — but its text must: an
archived contract is the only durable record of what was authorized, so closeout copies
it first and deletes it second. An archive whose scrub rule fails is left undone, and the
closeout records it as `NOT RUN` rather than deleting the evidence. PR creation/merge,
direct `main` publication, force-push/history rewrite, release, and deployment are
separate owner-controlled actions.
