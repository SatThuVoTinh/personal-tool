---
name: debug-active-task
description: Diagnose and fix failures within the currently authorized Zink Knowledgebase execution scope. Use when Cline encounters a failing test, runtime error, regression, or implementation blocker during an authorized Active Task. Follows the canonical .agents debugging loop, limits subagents to read-only evidence gathering, fixes root cause, and revalidates without widening scope.
---

# Debug Active Task

This skill is bounded remediation inside an already authorized execution scope.
It does not grant authority to fix unrelated defects.

## 1. Preconditions

Before patching:

1. Reconfirm the current Active Task and execution authorization.
2. Reconfirm the matching valid `docs/contracts/execution/ACTIVE.md`.
3. Read `.agents/skills/debugging/SKILL.md`; it is the canonical debugging
   procedure.
4. Read the relevant failure evidence, implementation, tests, and applicable
   contracts.
5. Preserve unrelated user changes and known baseline failures.

If the failure is outside authorized scope, record it as evidence/blocker and stop
rather than converting it into new work.

## 2. Evidence loop

Follow:

```text
OBSERVE
↓
REPRODUCE WHEN PRACTICAL
↓
TRACE OWNERSHIP + DATA/CONTROL FLOW
↓
FORM SMALLEST TESTABLE HYPOTHESIS
↓
PATCH ROOT CAUSE
↓
RUN FOCUSED VALIDATION
↓
INSPECT RESULT + DIFF
↓
RETEST AFFECTED GATES
```

Never start with a broad speculative patch.

## 3. Subagents during debugging

Use at most two native read-only subagents only when the failure crosses layers
or the root cause is genuinely unclear.

Useful split:

- **trace agent**: reproduce/trace call path, state transitions, logs, ownership;
- **validation agent**: locate relevant tests, known baselines, contracts, and
  validation commands.

Tell each subagent explicitly:

- read-only;
- current authorized task only;
- no architecture redesign;
- no scope expansion;
- return evidence with paths/symbols/commands and uncertainty.

Main Cline must verify decisive evidence before editing.

## 4. Stop conditions

Stop and escalate when the required fix would materially change:

- authorized scope;
- architecture/ownership;
- public API or persistent contract;
- schema/migration semantics beyond authorization;
- security boundary;
- resource ceiling;
- acceptance criteria or required validation gate.

Use the Owner Decision Protocol from `.agents/skills/execution/SKILL.md`.

## 5. Exit

A debug cycle exits only as:

```text
PASS
BLOCKED
OWNER DECISION REQUIRED
```

If repeated attempts produce no new evidence, stop retrying and report the
remaining uncertainty. After a successful fix, activate `validate-active-task`
for every affected gate.
