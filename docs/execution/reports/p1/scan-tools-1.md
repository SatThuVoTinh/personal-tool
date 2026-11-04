# Phase 1 audit — scan-tools-1

- **Mode:** Audit
- **Scope:** `zink-tools/` — adapter contracts, schemas, input validation
- **Baseline:** Current working tree at dispatch, HEAD `85eb094` (pre-existing changes present)
- **Result:** 0 new confirmed findings; 0 hypotheses; no blockers. Static inspection only; tests not run.

## Investigation and evidence

- Read the scoped schemas in `zink-tools/contracts/`, adapter entry points and validation helpers, including the Knowledge and Skill Store adapters, SQL validator/bridge, n8n trigger, path safety, and provider adapters. Cross-scope OpenClaw registration and schema dispatch were followed only to confirm whether the in-scope contracts and guards are live.
- The schema-only math capability schemas are intentionally non-executable; their dispatch refusal is documented in the sibling report [scan-tools-2.md](scan-tools-2.md:10-13). No new startup, security, data-loss, or system-wide failure defect was established in this slice.
- Contract validation defects already in the register remain candidates for the lead to consolidate, not new findings: **F-536** covers `default` keyword rejection for the SQL `max_rows` and Knowledge `top_k` input fields (`zink-tools/contracts/tools/zink-sql.schema.json:76-81`, `zink-tools/contracts/tools/zink-knowledge.schema.json:47-52`; register `docs/execution/findings.md:1565-1575`). **F-538** covers broader schema-interpreter versus JSON Schema dialect differences; its enforcement sites are in `integrations/openclaw/topology/lib/schema.mjs` (outside this slice), register `docs/execution/findings.md:1591-1602`. These are not duplicates of each other: F-536 is the concrete `default` rejection, while F-538 records the broader interpreter semantics.
- F-539's error-code vocabulary drift is already registered at `docs/execution/findings.md:1604-1615`; no separate tool-schema defect was established here. F-494's result-size bypass is also already registered (`docs/execution/findings.md:1318-1329`) and concerns the OpenClaw SQL result seam, outside this slice.

## Existing register items checked (not new findings)

- **F-446:** The current working tree no longer stores the cited unused credentials: MotherDuck has no credential field (`zink-tools/adapters/analytics/motherduck-adapter.mjs:36-45`), Databricks retains only `host` (`zink-tools/adapters/compute/databricks-adapter.mjs:30-33`), Kaggle only `username` (`zink-tools/adapters/compute/kaggle-adapter.mjs:30-33`), and Hugging Face has no constructor field (`zink-tools/adapters/mlops/huggingface-adapter.mjs:30-46`). This appears fixed in the dispatch tree; it is already registered at `docs/execution/findings.md:980-991`.
- **F-447:** The current `validateArtifactLogicalPath` rejects leading/trailing-dot segments at `zink-tools/common/path-safety.mjs:49-60`; the cited alias input is refused. Existing row: `docs/execution/findings.md:993-1004`.
- **F-448 / F-555:** The current Skill Store adapter routes raw errors to the trusted logger/callback (`zink-tools/adapters/skill-store/skill-adapter.mjs:368-387`) and returns a fixed sentence with a token-shaped code (`:1277-1299`). The raw-message envelope issue is not present in the current source. Existing rows: `docs/execution/findings.md:1006-1017` and `:1734-1745`.
- **F-171:** The current storage adapter validates `artifact_id` at all three key-building entry points (`zink-tools/adapters/storage/r2-adapter.mjs:74-93`, `:138-140`, `:222-224`, `:308-328`), consistent with the register’s REFUTED disposition at `docs/execution/findings.md:343-353`.
- **F-013:** Rechecked current semantic derivation: an absent or wholly unresolved namespace produces `ambiguous: true`, `domain: "AMBIGUOUS"` (`zink-tools/common/semantic-contract.mjs:228-269`), and the proposal path requires its domain to be canonical (`zink-tools/adapters/skill-store/skill-adapter.mjs:1125-1137`). The registered row is REFUTED, but its old `Evidence` line still describes the pre-fix `nsList.length > 0` condition (`docs/execution/findings.md:128-132`); no new defect follows from that stale locator.

## Confirmed findings

None.

## Hypotheses

None.

## Out-of-scope pointers

None. Cross-scope OpenClaw files were consulted only to verify reachability of already-registered schema/contract candidates; no additional out-of-scope defect was found.

## Checks

- Tests and runtime probes: not run. This was a static audit; no test result is claimed.
- Source/shared files changed: none. Only this assigned report was written.
