# Cross-Check Recheck Report — xcheck-tools-oc

**Boundary:** Zink Tools (zink_excel contract) ↔ OpenClaw hosting (published contract vs hosted runtime)
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** carried `F-459` (OPEN), `F-462` (closed upstream), `F-OC-011` (OPEN, owner memo pending)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-459` | Two SQL scanners with opposite literal/comment semantics | **OPEN — carried** | Artifact SQL scanner and canonical lexer untouched in loop 1/loop 2 |
| `F-OC-011` | Published Excel contract says the engine is unimplemented while the hosted runtime writes real workbooks | **OPEN — owner memo still missing** | Contract text and hosted behavior unchanged; not dispatched |
| `F-462` | (part of the F-459–F-462 clause) — fine sub-row | **closed upstream** — not in the register; no call sites remain | findings.md history |

## 2. Interaction Findings

- **Partial overlap with `F-OC-010`:** the loop-1 envelope fix (`54633d7`, `index.mjs:5338-5353`) makes the hosted runtime's emitted error obey the published zink_excel schema family — the portion of the F-OC-011/F-462 mismatch about error shapes is narrowed. The remaining F-OC-011 premise (the contract version claim "engine is unimplemented") is untouched and still OPEN.
- **No new interaction defect:** no `zink-tools/` file changed; the contract document was not edited; cross-boundary schema validation sites (`guard.mjs:1892` dispatch, source validation `:3007`) unchanged.
- `F-540` (projection vocabulary literal) also OPEN on adjacent seam, carried.

## 3. Blockers

- `F-OC-011` requires the owner RED memo (both the wording fix and the policy choice) before any dispatch.
