# Execution

The Owner Decision Protocol is owned by `.agents/skills/planning/SKILL.md`; use that
template verbatim when a material decision is required.

# Mandatory preflight

Before modifying repository state:

```text
Read AGENTS.md + PLAN.md
↓
identify Active Task
↓
confirm Planning Readiness = APPROVED
↓
confirm Plan Revision
↓
confirm Execution Authorization = YES
↓
resolve Execution Contract pointer
↓
read ACTIVE.md
↓
confirm ACTIVE task ID + Plan Revision match PLAN.md
↓
read `.agents/states/context.md` if present; identify allowed scope / Change Impact / gates from ACTIVE.md
↓
read referenced persistent contracts and architecture
↓
inspect git status/diff + relevant implementation/tests
↓
preserve unrelated work
```

Any missing/mismatched condition means `STOP`; do not infer authorization.

## Execution source of truth

For implementation details, a valid `docs/contracts/execution/ACTIVE.md` is the
sole executable source of truth. `PLAN.md` confirms task/lifecycle authorization;
persistent contracts and architecture constrain the implementation.

Cursor must not create, edit, replace, rename, or delete `ACTIVE.md`. If a material
detail is missing, contradictory, or requires scope/architecture/contract change,
use the Owner Decision Protocol instead of inventing or broadening the plan.

## Transient execution state

Files under `.agents/states/` are optional working memory, never authority.

- `context.md`: Cursor may create/update compact hot context when useful for a long
  execution. It must not restate the full contract.
- `handoff.md`: Cursor should create/update this at the execution handoff with what
  changed, validation actually run, known limitations/blockers, and review notes.
- The defect register is `docs/execution/findings.md`, outside this directory: tracked, and
  never transient-deleted. **Accountable writer:** Codex review/remediation.
  **Serialization:** one row, one writer — a second lane that finds the same `F-xxx` block already being edited does not edit it and hands the conflict to the orchestrator.
  dsh must not use the register to broaden implementation scope, and a row's existence is
  not an execution grant.

**State is historical:** `PLAN.md` wins without comparison — a state file is working memory, never a second source to reconcile against.

If any transient state conflicts with `PLAN.md`, the valid `ACTIVE.md`, architecture,
or persistent contracts, ignore the transient state and follow the authoritative
source.

## Scope and implementation discipline

One Active Task at a time unless approved parallel execution explicitly says
otherwise.

Make the smallest coherent patch.

Inspect before editing.

Reuse existing patterns before creating alternatives.

Do not perform:

- unrelated cleanup;
- opportunistic refactoring;
- mass formatting;
- speculative future-proofing;
- unrelated bug fixing.

Do not create placeholder production code and claim completion.

Do not materially change a Change Impact surface marked `NONE`.

Do not silently alter:

- public API;
- schema/migration semantics;
- persistent identifiers;
- storage ownership;
- network exposure;
- security boundaries;
- resource ceilings;
- runtime topology;
- compatibility guarantees.

Do not add/remove/upgrade/re-resolve dependencies unless authorized by the task.

Do not regenerate lockfiles unless dependency resolution is intentionally in
scope.

Do not hand-edit generated artifacts when an authoritative generator exists.

# Cross-platform and resource safety

Supported operator environments include Windows PowerShell and POSIX shells
where repository equivalents exist.

- Use UTF-8 and LF.
- Follow `.editorconfig` and `.gitattributes`.
- Prefer repository-relative portable paths.
- Quote paths and arguments.
- Do not assume drive letters, shell syntax, case sensitivity, executable
  suffixes, current directory, or symlink behavior.
- Prefer checked-in Node/Python logic over complex shell logic.
- Do not alter host/global configuration merely to make a task pass.
- Do not remove resource ceilings merely because a workload exceeds them.
- Retries must be bounded and diagnostic.

Host-facing V1 HTTP entry points remain loopback-only unless an owner-approved
contract changes that model.

Client-side code must never receive infrastructure or internal-service secrets.
