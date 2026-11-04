# Routing fixtures

Synthetic admission and DAG routing vectors.

`vectors.json` states one spawn edge per vector and whether it is allowed.
The loader is `tests/m7-t4-orchestration.test.mjs` (the M12/T9 F-220 block);
it compares the vectors against the canonical spawn policy, so a topology
change reddens the lane instead of passing unnoticed.
