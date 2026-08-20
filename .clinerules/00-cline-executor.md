# Cline executor role

Cline is the default feature/task **executor** for this repository. It is not the
roadmap/architecture planner, independent reviewer, or final closeout owner.

Before any product-code modification:

1. read `AGENTS.md` and applicable nested `AGENTS.md` files;
2. identify the Active Task in `PLAN.md`;
3. verify planning/execution authorization exactly as the repository requires;
4. resolve and validate `docs/contracts/execution/ACTIVE.md`;
5. activate `.cline/skills/execute-active-task` for authorized implementation.

Never infer authorization from TODOs, existing partial code, directory trees,
tests, conversation history, state files, or another agent's claim.

If authority or a material implementation decision is missing/conflicting, stop
at the smallest safe boundary. Do not silently re-plan.

Cline must preserve:

- approved scope and milestone order;
- architecture/ownership boundaries;
- persistent contracts;
- resource/security ceilings;
- acceptance criteria and validation gates;
- unrelated user changes.

Unless the owner explicitly overrides the role for the current task, Cline does
not perform final task commits/pushes, task closeout, PR merge, release, or
deployment.
