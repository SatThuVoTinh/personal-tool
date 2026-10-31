# Cross-Check Recheck Report — xcheck-oc-artifact

**Boundary:** OpenClaw governance plugin ↔ artifact validation / Excel writer / zink-tools artifact contract
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** `F-OC-002`, `F-OC-003`, `F-OC-010`; carried rows `F-463`–`F-473`

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-OC-002` | ZIP expansion budgets enforced on both readers without breaking the tools-side caller | **FIXED — consistent** | Budget errors name measurement and limits (`artifact-validator.mjs:265-271`, `excel-writer.mjs:220-223`); `m12-t9-r5-zip-expansion-budgets` 14/14 (`tests.md:11`) |
| `F-OC-003` | Symlink/dangling guards on the write path do not reject legitimate in-sandbox writes | **FIXED — consistent** | `excel-writer.mjs:546-607` walks with `lstatSync`; refuses only out-of-sandbox traversal (committed `adc7e84`; dedicated suite not rerun at loop-2 — flagged) |
| `F-OC-010` | The emitted error envelope now matches the published zink_excel output schema on both sides of the boundary | **FIXED — consistent** | `registerTools` catch emits `{operation, success:false, error_code, error_message}` (`index.mjs:5338-5353`) — the schema-forbidden `status:"ERROR"+tool+error+message+code` shape is gone; owner memo pending for closure |

## 2. Interaction Findings

- **F-OC-002 budget refusal path → tools boundary:** the budget refusal now flows outward with a named error (limit + measured value), so the plugin-side envelope keeps a symbolic code; no raw message leakage observed on the refusal sites checked at HEAD.
- **F-OC-010 envelope ↔ F-460/F-539 vocabulary:** the old generic 5-field envelope was one of the disagreeing declarations; the new shape reduces the disagreement but `F-539` (4 disagreeing vocabularies) remains OPEN by itself.
- **F-463 residual (redaction) and `F-459` (SQL scanner semantics) stay OPEN on adjacent seams; not regressed** by the loop-1/loop-2 edits — the changed files (`artifact-validator.mjs`, `excel-writer.mjs`, `index.mjs` catch/registry seams) do not touch those mechanisms.
- **`F-468 / F-472 / F-473` closed upstream** and absent from the register; no cross-boundary call site remains for them.

## 3. Blockers

- `F-OC-010` closure needs the owner's RED memo (register row is RED-undecided); `F-OC-003` needs a loop-2 gate rerun of its dedicated suite before §0.5 closure.
