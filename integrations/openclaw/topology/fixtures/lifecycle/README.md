# Lifecycle fixtures

Synthetic workflow, brief, run and result-acceptance vectors.

`vectors.json` holds the scenarios: a sequence of governed events and the
state the task must be in after them. The expected state is written in the
file by hand from the published lifecycle, so the loader compares the reducer
against a fixed truth.

The loader is `tests/m7-t4-orchestration.test.mjs` (the M12/T9 F-220 block).
