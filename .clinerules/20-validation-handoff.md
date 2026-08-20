# Validation and handoff

Implementation is not complete merely because code was written or one test
passed.

After implementation/debugging changes, Cline must activate
`.cline/skills/validate-active-task` and run every applicable gate required by the
valid execution contract and repository.

Use only:

```text
PASS
FAIL
NOT RUN
```

Never manufacture PASS by weakening tests, swallowing errors, skipping required
checks, hiding failures, or treating unavailable validation as successful.

Before handoff, inspect the complete diff and working-tree status, then update the
permitted `.agents/states/handoff.md` with concise evidence.

Cline hands off as implementation ready for **independent Codex review**. It does
not self-approve or mark the repository task complete.
