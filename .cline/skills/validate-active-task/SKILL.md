---
name: validate-active-task
description: Validate Cline's implementation of the currently authorized Zink Knowledgebase Active Task before handoff to Codex. Use after implementation changes or debugging fixes. Applies canonical .agents validation integrity rules, selects gates from ACTIVE.md/repository scripts, reports PASS/FAIL/NOT RUN truthfully, inspects final diff/status, and stops before Codex-owned commit/closeout operations.
---

# Validate Active Task

This is **Cline execution validation**, not final Codex closeout.

## 1. Canonical validation policy

Read `.agents/skills/validating/SKILL.md` before validation.

Apply its:

- secret/untrusted-input safeguards;
- validation integrity rules;
- baseline-failure discipline;
- requirement that evidence correspond to the final relevant repository state;
- `PASS | FAIL | NOT RUN` vocabulary.

Do **not** execute sections reserved by `AGENTS.md` for Codex final review,
commits, PLAN closeout, ACTIVE deletion, push, PR, merge, release, or deployment.

## 2. Determine required gates

Derive gates from this authority order:

1. valid `docs/contracts/execution/ACTIVE.md`;
2. applicable persistent contracts/runbooks;
3. repository scripts/configuration for the affected surface;
4. established tests/checks for changed files.

Never invent success criteria and never omit a required gate silently.

Typical categories, only when applicable:

```text
format/check
lint
static analysis
typecheck
unit tests
integration/contract tests
build
runtime smoke
docker compose/config validation
data/schema/migration validation
security/secret/dependency checks
git diff --check
```

## 3. Validation order

Run cheapest/focused gates first, then broader affected gates.

```text
FOCUSED CHECKS
↓
AFFECTED TESTS
↓
BROADER REQUIRED GATES
↓
SECURITY / RUNTIME GATES WHEN REQUIRED
↓
FINAL DIFF + STATUS INSPECTION
```

If implementation changes after a gate passes, rerun every gate invalidated by
that change.

## 4. Integrity rules

Never:

- weaken a test/assertion/policy to manufacture PASS;
- hide or swallow an error;
- ignore a non-zero exit;
- retry until a single lucky PASS and discard failures;
- label an unavailable/skipped check as PASS;
- expose ignored secrets or private data while validating;
- fix unrelated baseline failures without separate authority.

## 5. Final Cline handoff check

Before Cline hands off:

- inspect `git status --short --branch`;
- inspect the complete task diff;
- run `git diff --check` when applicable;
- ensure changed files stay inside authorized scope or explicitly approved impact;
- ensure no secret/runtime/generated junk was unintentionally added;
- ensure all required Cline-stage gates are truthfully classified;
- update `.agents/states/handoff.md` with commands/results and blockers.

Cline's terminal state is one of:

```text
IMPLEMENTATION READY FOR CODEX REVIEW
IMPLEMENTATION BLOCKED
OWNER DECISION REQUIRED
```

Cline must never label the repository task `COMPLETE`; independent review and
closeout remain governed by `AGENTS.md`.
