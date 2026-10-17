## Karpathy execution loop

Every implementation step follows an evidence-driven loop.

```text
OBSERVE
↓
UNDERSTAND
↓
CHOOSE SMALLEST HYPOTHESIS
↓
PATCH
↓
TEST
↓
INSPECT RESULT
↓
COMPARE AGAINST ACTIVE + PERSISTENT CONTRACTS
↓
FIX ROOT CAUSE
↓
RETEST
↓
CONTINUE
```

More explicitly:

### 1. Observe

Inspect:

* current implementation;
* surrounding code;
* tests;
* contracts;
* `.agents/states/context.md` when present;
* the relevant entry in `docs/execution/findings.md` when present;
* `.agents/states/handoff.md` when it helps reproduce the reported behavior;
* current failure/evidence.

### 2. Understand

Determine:

* expected behavior;
* existing ownership;
* existing repository pattern;
* likely root cause;
* smallest coherent change.

Do not start by writing code.

### 3. Hypothesize

Choose the smallest change likely to satisfy the current approved requirement.

Avoid broad speculative patches.

### 4. Patch

Modify only the necessary owned surface.

### 5. Focused validation

Run the smallest relevant validation first.

Examples:

```text
unit test
specific contract test
migration test
targeted runtime check
```

### 6. Inspect

Do not accept a PASS blindly.

Inspect:

* output;
* diff;
* error behavior;
* side effects;
* unexpected state;
* new complexity.

### 7. Compare

Compare actual result with:

* valid `docs/contracts/execution/ACTIVE.md`;
* applicable persistent contracts and architecture;
* expected behavior;
* resource/safety constraints.

### 8. Correct

If incorrect, fix the root cause.

Do not hide the failure.

Do not weaken the test.

### 9. Retest

Rerun affected validation.

### 10. Advance

Only after the current approved step is verified:

* update the relevant `findings.md` entry only after evidence supports the new status;
* update `context.md` when new working context is useful;
* proceed to the next bounded step or return to full code review.

Repeat until:

```text
PASS
or
BLOCKED
or
OWNER DECISION REQUIRED
```

Do not loop indefinitely.

If repeated attempts do not produce new evidence, stop and diagnose instead of
retrying blindly.

Transient state never expands authority. `findings.md` identifies work discovered
during review; it does not authorize architecture changes, contract changes, scope
expansion, or acceptance-criteria changes. Those require the Owner Decision
Protocol and, when material, a new approved Plan Revision and `ACTIVE.md`.
