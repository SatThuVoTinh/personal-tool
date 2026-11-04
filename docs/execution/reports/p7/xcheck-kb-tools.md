# Cross-Check Recheck Report — xcheck-kb-tools

**Boundary:** Zink Knowledgebase ↔ Zink Tools (adapter contracts, path safety, envelope)
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** none fixed yet; carried `F-KB-004` (OPEN, shared), `F-447` (OPEN), `F-470`/`F-471` (OPEN)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-KB-004` | The incomplete citation/chunk output flows into the tools-side envelope unmasked? | **OPEN — premise live, no conflict change** | Serialiser omissions persist; the tools envelope does not compensate for the missing fields |
| `F-447` | Logical-path validator dot-segment acceptance contradicts the KB "single spelling" invariant? | **OPEN — carried** | `path-safety.mjs:3,44-47` unchanged |
| `F-470` | The tool-result envelope sink redaction gap | **OPEN — carried** | Dispatch tree unchanged for this row |
| `F-471` | Raw error text persisted into untracked durable trees | **OPEN — carried** | Skill-proposal persistence unchanged |

## 2. Interaction Findings

- No loop-1/loop-2 commit touched `zink-tools/` or the KB dispatch/envelope seam of these rows; all statuses carry forward exactly.
- Adjacent note: the plugin-side error envelope simplification (`F-OC-010`, index.mjs) does not change the boundary question here — `F-470`'s sink is the governing plan/result render path, untouched.
- Standing loop-2 gates (`tests.md:9-14`) measure none of these mechanisms.

## 3. Blockers

- `F-KB-004` needs its owner memo; others are scheduled for later dispatch waves (fix-plan §10).
