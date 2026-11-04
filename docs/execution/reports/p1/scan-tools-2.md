# Phase 1 audit — scan-tools-2

- **Mode:** Audit
- **Scope:** `zink-tools/` — capability execution (forecast, optimization, operations research, simulation) and resource limits
- **Baseline:** Current working tree at dispatch, HEAD `85eb094` (pre-existing changes present)
- **Result:** 0 new confirmed findings; 0 hypotheses; no blockers. Static inspection only; tests not run.

## Investigation and evidence

- The four mathematical capabilities are explicitly schema-only in [`zink-tools/README.md:35-42`](../../../../zink-tools/README.md), and each schema has bounded scalar/string values where defined. The simulation schema caps `iterations` at 10,000,000 (`zink-tools/contracts/tools/zink-simulation.schema.json:13-16`). The capability schemas have no runtime executor under `zink-tools/`; no solver, forecast engine, or simulation loop was found in the scoped files.
- Dispatch cross-check: `integrations/openclaw/lib/policy.mjs:2447-2487` marks all four capabilities `schema_only` / `none_schema_only`; `:2490-2504` builds the callable registry from callable entries and lists only the five callable IDs. `integrations/openclaw/topology/lib/guard.mjs:1864-1869` rejects schema-only capability calls. This confirms their lack of execution is intentional and fail-closed, not a startup or execution defect.
- The compute provider adapters are documented as simulation doubles, not live providers (`zink-tools/adapters/compute/kaggle-adapter.mjs:14-20`, `zink-tools/adapters/compute/databricks-adapter.mjs:14-20`). Their `triggerJob` methods return fixed in-memory envelopes with `execution_state: EXECUTION_STATE_SIMULATED` (`kaggle-adapter.mjs:67-90`, `databricks-adapter.mjs:67-90`); the simulated-timeout options throw directly rather than poll (`:60-65` in each). No uncontrolled provider execution or unbounded compute loop was found in these scoped adapters.
- Scope/resource boundary: `zink-tools/contracts/tools/zink-simulation.schema.json:13-16` permits up to 10 million iterations, but this is an inert specification under the guarded schema-only capability path above. I found no evidence that the repository executes this value or hands it to a live provider; therefore this is not reported as a resource exhaustion defect. The schema input envelope is also preflighted to 262,144 UTF-8 bytes at `integrations/openclaw/topology/lib/guard.mjs:1874-1885` (out of slice; checked only to confirm the boundary).

## Existing register items checked (not new findings)

- **F-449 (LATENT):** Existing MLflow fidelity-roster item at `docs/execution/findings.md:1019-1029`. Current `zink-tools/adapters/mlops/mlflow-adapter.mjs:64-76` still creates a `RUNNING` record without `execution_state`; the register already classifies it as latent and records the absence of production enforcement. Duplicate; no new defect filed.
- **F-446:** Existing credential-retention item at `docs/execution/findings.md:980-991`. In the dispatch working tree, the cited credential fields are no longer assigned: the constructors retain only `host` (`zink-tools/adapters/compute/databricks-adapter.mjs:30-33`), `username` (`kaggle-adapter.mjs:30-33`), and no instance fields in Hugging Face (`huggingface-adapter.mjs:30-46`) or MotherDuck (`motherduck-adapter.mjs:36-45`). The new roster at `tests/m12-t9-r4-adapter-credential-roster.test.mjs:22-65` asserts all four fields are absent. No duplicate candidate; lead can verify the existing row’s disposition against the task diff.

## Confirmed findings

None.

## Hypotheses

None. The schema iteration ceiling alone does not establish a reachable resource exhaustion path because execution is intentionally disabled for this capability and no consumer of the field was found in scope.

## Out-of-scope pointers

None. The OpenClaw policy and guard files above were read solely to confirm the scoped schema-only execution boundary; no out-of-scope defect was found.
