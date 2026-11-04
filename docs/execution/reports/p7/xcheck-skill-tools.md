# Cross-Check Recheck Report — xcheck-skill-tools

**Boundary:** Zink Skill Store ↔ Zink Tools (skill adapter, retrieval grammar, error carriers)
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** `F-SKILL-002`; carried `F-549`–`F-553` (OPEN)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-SKILL-002` | Store-side alias canonicalization removes the store↔tools grammar disagreement? | **FIXED — consistent** | Aliases canonicalized on storage (`30dbd99`, `vector-sync.mjs`), so the tools-side canonical query and the stored rows now agree; scoped retrieval matches the alias spelling again |
| `F-549` | Shared error-code carrier existence | **OPEN — carried** | Three throw conventions consumed by five private discriminators; unchanged |
| `F-553` | Classifier matching by prose + substring shadow | **OPEN — carried** | `queue-manager.mjs:608` seam unchanged |

## 2. Interaction Findings

- **Adapter grammar seam:** with storage-time canonicalization, the freshness gate (`skill-adapter.mjs:718-722`, `F-434` OPEN separately) still aggregates over ACTIVE/READY rows but the alias rows are no longer invisible to canonical queries; row `F-434`'s aggregate remains its own OPEN row (no regression introduced).
- **`F-555` (raw `error.message` forwarded) stays OPEN** on this boundary; the loop-2 envelope work touched the plugin-side catch only, not the skill adapter's failures.
- **`F-448`/`F-555` pairing:** the Knowledge adapter's fixed sentence (`F-448` row context) remains the un-applied template for the Skill adapter — carried OPEN without contradiction.
- No suite in the loop-2 rerun list covers the store↔tools seam; evidence basis = workspace inspection + loop-1 committed records.

## 3. Blockers

- None new; the carried rows await their scheduled dispatch waves.
