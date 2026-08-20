### Planning

Codex must inspect the actual repository before designing a plan.

Before recommending implementation, challenge the proposal against:

* existing functionality;
* existing ownership;
* existing abstractions;
* completed milestones;
* planned overlapping tasks;
* persistent-state ownership;
* dependency cost;
* operational cost;
* resource ceilings;
* validation burden;
* architecture boundaries.

Codex should recommend the best repository-level solution even when it differs from the owner's initial implementation idea.

Before owner approval, Codex may freely propose and revise plans.

After approval, the Approved Plan Lock applies.

## Requirement
Agents are engineers, not passive instruction followers.

Evaluate proposed work in the context of the **whole repository**.

A design is not optimal merely because it is good in isolation.

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

## Anti over-engineering
Before introducing a new:

* abstraction;
* service;
* dependency;
* queue;
* worker;
* state store;
* configuration layer;
* compatibility layer;
* generic framework;
* extension point;

evaluate:

```text
Is it required by current approved behavior?

Does an existing component already own this responsibility?

Can an existing mechanism satisfy the requirement?

Does it remove more complexity than it adds?

Is it justified by concrete current requirements?

Does it duplicate state, policy, validation, or ownership?

Is the operational and maintenance cost justified?
```

If the answer is unclear, prefer the smaller design.

Do not build infrastructure merely for hypothetical future requirements.

If the approved plan itself requires something that now appears unnecessary, do not silently remove it.

Use the Owner Decision Protocol.

# Owner Decision Protocol

When a material decision is required, stop at the smallest safe boundary.

Ask the owner using:

```text
OWNER DECISION REQUIRED

Issue:
<what was discovered>

Why it matters:
<why the current decision may be wrong, redundant, unsafe, or inefficient>

Current approved approach:
<what PLAN/contracts currently require>

Recommended approach:
<best technical recommendation>

Why recommended:
<concise technical reasoning>

Impact if changed:
<scope/files/contracts/schema/dependencies/tests/roadmap>

Impact if unchanged:
<risk/cost/complexity/limitation>

Options:
A. <recommended option>
B. <alternative>
C. Keep current approved approach

Recommendation:
A

Question:
Which option should be applied?
```

The owner decides.

Do not treat silence as approval.

After the owner answers, follow the decision.

If the answer requires a plan revision:

```text
STOP execution
↓
Execution Authorization = NO
↓
Codex removes/invalidates the stale ACTIVE.md
↓
Codex planning mode
↓
bounded revised plan
↓
owner approval
↓
new Plan Revision
↓
Codex materializes the new ACTIVE.md and sets authorization to YES
↓
resume
```
# Approved Execution Contract

Codex planning mode is read-only by default. Before owner approval, Codex may
inspect the repository and propose/revise the plan, but `ACTIVE.md` must not be
created as executable authority.

After explicit owner approval, Codex must materialize the approved plan without
silently changing scope into:

```text
docs/contracts/execution/ACTIVE.md
```

At the same transition, Codex updates `PLAN.md` with:

```text
Planning Readiness: APPROVED
Plan Revision: <task>-R<n>
Execution Authorization: YES
Execution Contract: docs/contracts/execution/ACTIVE.md
```

`ACTIVE.md` is transient and Git-ignored. Codex owns its creation, replacement,
and deletion. Cursor and subagents are read-only consumers.

## ACTIVE.md content

The approved execution contract contains only the information required to execute
the current task deterministically:

- task ID and Plan Revision;
- objective and prerequisites;
- allowed scope and excluded scope;
- Change Impact surfaces;
- required context and persistent contracts;
- frozen implementation details and ordered steps;
- acceptance criteria / Definition of Done;
- required validation gates;
- documentation requirements;
- transition and handoff rules.

For implementation details, this valid `ACTIVE.md` is the sole source of truth.
`PLAN.md` keeps durable lifecycle state and a pointer only; do not copy the full
approved implementation body back into `PLAN.md` or state files.

Materialization is a faithful freeze, not a second planning pass. If Codex discovers
that a material approved detail must change while generating or executing
`ACTIVE.md`, it must set `Execution Authorization: NO`, invalidate/remove the
current `ACTIVE.md`, use the Owner Decision Protocol, obtain approval for a new
Plan Revision, and materialize a replacement contract.

Lifecycle fields in `PLAN.md` may change only to record actual repository state.
They must never redefine the approved implementation details.

## Transient state use

Planning authority lives in `PLAN.md`; approved implementation details live only
in the matching valid `docs/contracts/execution/ACTIVE.md`. Do not create or use
`.agents/states/active-task.md`.

Transient state is optional working memory only:

- `.agents/states/context.md` may be created/updated when a long task needs compact
  hot context or resolved discoveries;
- `.agents/states/findings.md` belongs to review/remediation, not planning authority;
- `.agents/states/handoff.md` belongs to execution/review handoff, not planning
  authority.

No state file may authorize execution, redefine scope, or duplicate the frozen
implementation body from `ACTIVE.md`.
