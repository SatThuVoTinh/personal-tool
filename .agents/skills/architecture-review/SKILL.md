# Architecture Review

This skill runs the architecture, ownership and overengineering review that
`AGENTS.md` section 5 routes here. It is a procedure, not a copy of the
architecture: it states the inputs it reads, the steps it runs in order, the
verdict it emits and the gate that closes it.

## Sources

Each list this review applies has exactly one owner, and this skill carries no
copy of any of them:

- the optimization priority order — `AGENTS.md` section 8, mirrored in
  `.agents/skills/planning/SKILL.md`;
- the repository-wide architecture invariants — `AGENTS.md` section 9;
- the anti-overengineering checklist, the task lifecycle, the Approved Plan Lock
  and the Owner Decision Protocol — `.agents/skills/planning/SKILL.md`;
- the defect register, its status vocabulary and the one-row-one-commit rule —
  `docs/execution/findings.md`;
- the review and bounded-remediation procedure —
  `.agents/skills/code-review/SKILL.md`.

## Review inputs

- the review boundary: the surfaces under review and the authority that governs
  each of them;
- the current task, Plan Revision and authorization in `PLAN.md`;
- a matching valid `docs/contracts/execution/ACTIVE.md`, when the review is
  task-scoped;
- the complete diff, or the named architecture surface under review;
- the affected source, tests and configuration, and the directly affected
  neighbouring code;
- `AGENTS.md` section 8 and section 9;
- the canonical architecture under `docs/architecture/` and the persistent
  contracts under `docs/contracts/`;
- the actual runtime behavior, where a claim under review depends on it;
- the `docs/execution/findings.md` rows for this area — navigation only, never
  authority.

## Ordered steps

1. Fix the boundary. Name the surfaces under review and the authority that
   governs them. A task-scoped review is bounded by the valid `ACTIVE.md`; an
   area review is bounded by `AGENTS.md` section 9.
2. Read the canonical architecture for every module the change touches, and
   record the ownership each touched surface must keep.
3. Check ownership. The change must not mutate state, persistence, workflow or
   policy that belongs to another module, another project or Infrastructure.
   Cross-module effects go through approved contracts, never a direct write
   into another owner's state.
4. Apply the invariants in `AGENTS.md` section 9 to the change: the logical
   module boundaries, the canonical peer-module paths, the current runtime
   location, the target-tree rule, and the read-only sources.
5. Check overengineering against the anti-overengineering checklist in
   `.agents/skills/planning/SKILL.md`: every new abstraction, service,
   dependency, queue, worker, state store, configuration layer, compatibility
   layer, generic framework and extension point must be required by current
   approved behavior, and an existing owner must be reused first.
6. Check the priority order in `AGENTS.md` section 8: the change must not trade
   correctness, data integrity or security away for a lower priority.
7. Classify every finding with the verdict vocabulary below, and record each
   actionable finding as an `### F-xxx` row in `docs/execution/findings.md` with
   the register's ten fields. A review never changes a severity or a category.
8. Escalate a finding that would alter approved scope, architecture, ownership,
   public API, schema or migration semantics, persistent state, the dependency
   set, the security boundary, a resource ceiling, a compatibility guarantee,
   milestone order or the Definition of Done, with the Owner Decision Protocol
   in `.agents/skills/planning/SKILL.md`, at the smallest safe boundary.
9. After any fix, re-review the complete final diff or state, so a fix cannot
   hide or introduce another finding.

## Verdict vocabulary

```text
ARCHITECTURE PASS
LOCAL FIX
OWNER DECISION REQUIRED
BLOCKED
```

- `ARCHITECTURE PASS` — no architecture, ownership or overengineering finding
  remains.
- `LOCAL FIX` — the finding stays inside the approved scope, and is remediated
  under `.agents/skills/code-review/SKILL.md`.
- `OWNER DECISION REQUIRED` — the finding is a RED decision under `AGENTS.md`
  section 7, and is escalated with the Owner Decision Protocol.
- `BLOCKED` — the review cannot be completed because an input it needs is
  unavailable; the missing input is named.

## Architecture invariants

The repository-wide invariants are owned by `AGENTS.md` section 9, and the
review applies section 9 as written. The rule that decides most structural
questions, in its current form:

- the accepted `apps/knowledge/` implementation remains the current
  Knowledgebase runtime until a separately approved migration; structural
  migration requires its own task and regression gate.

## Completion gate

The architecture review is complete when all of the following hold:

- every surface in the review boundary was checked against `AGENTS.md` section 9
  and the canonical architecture;
- every finding is classified with the verdict vocabulary above, and is either
  recorded in `docs/execution/findings.md` or escalated;
- every `LOCAL FIX` is applied and re-reviewed, or the owner's decision on it
  is recorded;
- no architecture, ownership or overengineering finding from this review is
  still open;
- the verdict is emitted, and the gates affected by a material change were
  re-run.

When architecture docs are insufficient:

> ask or inspect canonical sources; do not invent missing architecture.
