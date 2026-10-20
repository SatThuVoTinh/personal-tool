# T2 topology fixtures

Synthetic-only fixtures for canonical hashing, routing, lifecycle and exact
OpenClaw 2026.6.34 runtime regressions. Real credentials, Discord identities,
raw datasets and secret-bearing content are forbidden.

The three vector families carry their expectations in the files themselves
(the digest of a canonicalization vector, the state a lifecycle scenario must
reach, the spawn edge a routing vector states), so a lane compares the
production behaviour against a fixed truth instead of against a value it
regenerates itself:

- `canonical-hash/vectors.json` — canonicalization digests;
- `lifecycle/vectors.json` — workflow, brief, run and result-acceptance
  scenarios;
- `routing/vectors.json` — admission and DAG routing edges.

The loader is `tests/m7-t4-orchestration.test.mjs` (the M12/T9 F-220 block).
`runtime-regression/` holds the exact-runtime regression drivers.
