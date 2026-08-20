---
name: execute-active-task
description: Execute the currently authorized Zink Knowledgebase Active Task without re-planning. Use when implementing an approved task, continuing authorized implementation, or resuming Cline execution from repository state. Enforces PLAN/ACTIVE authorization, canonical .agents execution procedure, bounded subagent reconnaissance, focused validation, state updates, and Codex handoff.
---

# Execute Active Task

Cline is the repository's implementation executor. This skill does not grant
execution authority and does not replace repository contracts.

## 1. Authority gate

Before any write or state-changing command:

1. Read root `AGENTS.md`.
2. Read the Active Task/lifecycle fields in `PLAN.md`.
3. Read every applicable nested `AGENTS.md` for the affected paths.
4. Verify all execution conditions required by the repository, including:
   - the current Active Task identity;
   - `Planning Readiness: APPROVED`;
   - `Execution Authorization: YES`;
   - the execution-contract pointer;
   - matching task ID and Plan Revision in `docs/contracts/execution/ACTIVE.md`.
5. Read `docs/contracts/execution/ACTIVE.md` completely for the authorized task.
6. Read `.agents/skills/execution/SKILL.md` and follow it as the canonical reusable
   execution procedure.
7. Read only relevant `.agents/states/*.md` files and referenced architecture,
   persistent contracts, runbooks, source, tests, and configuration.
8. Inspect `git status --short --branch` and the relevant current diff before edits.

If authorization is absent, stale, mismatched, materially ambiguous, or conflicts
with canonical architecture/contracts: **STOP**. Do not infer permission and do
not repair the plan yourself.

## 2. Cline role boundary

Cline may:

- inspect repository state;
- implement the authorized Active Task;
- add or update in-scope tests;
- run focused and required validation;
- debug failures caused by or blocking the authorized implementation;
- update permitted transient execution state;
- create a precise handoff for Codex.

Cline must not silently:

- redesign architecture or roadmap;
- broaden task scope or implement future work;
- weaken acceptance criteria or validation gates;
- change persistent contracts beyond explicit task authorization;
- create, modify, replace, rename, or delete `ACTIVE.md`;
- change PLAN approval, authorization, or completion state;
- perform final task commits, push, merge, release, deploy, or closeout when those
  remain owned by Codex/owner policy;
- touch unrelated user work merely to make validation green.

## 3. Subagent reconnaissance gate

Use native Cline subagents only when parallel read-only reconnaissance is worth
its context/token overhead.

Use subagents when at least one is true:

- affected paths are not yet known;
- the task crosses multiple owned layers or subsystems;
- dependency/test impact is unclear;
- failure evidence spans several areas;
- reading the necessary repository context sequentially would significantly pollute
  the main context window.

Do **not** use subagents for a small task with obvious affected files.

When used, launch at most three focused research prompts. Follow
`docs/subagent-playbook.md`.

Subagents are reconnaissance only. Main Cline owns every write and every final
implementation decision.

## 4. Build the execution map

Before editing, summarize internally from verified evidence:

- authorized objective;
- allowed and excluded paths;
- affected ownership boundaries;
- required sequence/dependencies;
- validation gates;
- known baseline failures;
- material risk surfaces;
- smallest coherent first patch.

Do not invent missing contract details. A material missing decision triggers the
Owner Decision Protocol in `.agents/skills/execution/SKILL.md`.

## 5. Execute in bounded slices

For each coherent implementation slice:

```text
INSPECT
↓
CHOOSE SMALLEST COMPLIANT CHANGE
↓
EDIT
↓
RUN FOCUSED VALIDATION
↓
INSPECT OUTPUT + DIFF
↓
CORRECT ROOT CAUSE IF NEEDED
↓
ADVANCE
```

Rules:

- inspect existing patterns before introducing new ones;
- prefer the smallest coherent patch that fully satisfies the contract;
- preserve unrelated work;
- do not mass-format unrelated files;
- do not alter dependencies/lockfiles unless authorized;
- do not hand-edit generated artifacts when an authoritative generator exists;
- do not hide failure, weaken tests, or retry blindly.

If a failure requires diagnosis, activate `debug-active-task`.

## 6. Validation

After implementation reaches the authorized end state, activate
`validate-active-task`.

Validation evidence must reflect the final relevant working tree. If a later edit
invalidates a passed gate, rerun that gate.

Never translate `NOT RUN`, unavailable, or skipped into `PASS`.

## 7. State discipline

Use `.agents/states/` only as bounded hot context under its `README.md` protocol.

During Cline execution:

- update `context.md` only with verified task-specific facts worth preserving;
- do not use `findings.md` to expand implementation authority;
- update `handoff.md` at the final execution handoff.

Do not copy the full plan, full execution contract, terminal transcripts, or large
diffs into state files.

## 8. Handoff condition

Cline stops at **IMPLEMENTATION READY FOR REVIEW**, not repository task closeout.

Before handoff:

1. inspect complete `git diff` and `git status`;
2. confirm no unexpected files changed;
3. record which validation commands actually ran and their exact outcome category;
4. record remaining blockers/limitations without disguising them;
5. update `.agents/states/handoff.md` using its schema;
6. hand the working tree to Codex for independent review/fix/final validation and
   closeout according to `AGENTS.md`.

Use only these terminal-result labels in the handoff:

```text
PASS
FAIL
NOT RUN
```

A required `FAIL` or `NOT RUN` means Cline must not claim implementation-ready
unless the approved contract explicitly defines that outcome.
