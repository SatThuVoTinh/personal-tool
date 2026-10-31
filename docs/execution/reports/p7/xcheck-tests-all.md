# Cross-Check Recheck Report — xcheck-tests-all

**Boundary:** test gates, skip-expectation, audit baselines
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** `F-481`, `F-492`, `F-585`, `F-OC-008`, `F-SKILL-002`; plus `F-588` (regression lane) and `F-587` (OPEN child of `F-492`)

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-481` | Denominator rule counted skips against a denominator that equals the whole family | **FIXED — consistent across gates** | `scripts/skip-expectation-gate.mjs:316-320` applies the failed+errored+skipped+executed denominator rule; pinned by `agent-owner-F-197-skip-expectation` 13/13 in the loop-2 W0/W1 rerun (`tests.md:11`) |
| `F-492` | Skip gate recognised only pass/skip case states | **FIXED (re-scoped by owner option 1)** | a failed/errored case is its own count and refuses the gate on every host (register row); second half (childless zero-assertion) re-filed as `F-587` |
| `F-587` | junit reporter emits only `name/time/classname/file`, so a childless zero-assertion case is byte-identical to a pass | **OPEN — premise live at HEAD** | Register row `findings.md` (measured); no gate measures executed assertions; stays OPEN, no dispatch scheduled |
| `F-588` | The committed F-OC-001 regression lane kept a permanently-red subtest | **FIXED — lane green** | `tests/m12-t9-unregistered-button-components-fail-closed.test.mjs` rewritten (`a9ddced`), reports 2/2 PASS (`tests.md:11`) |
| `F-585` | Accepted dependency advisories are never re-asked for fix availability | **FIXED (probe committed)** | `63ddf40` — the advisory fix-availability comparison lives in the audit-baseline script; `repo:check` PASS at loop 2 (`tests.md:12`); npm audit live probe is NOT RUN on this host |
| `F-OC-008` | Hotfix template rollback accounting + its test lanes | **FIXED — consistent** | `changed.push` before `_writeAtomically` (`openclaw-gemini-stream-hotfix.mjs:439-440`); `agent-topo-F-296` 5/5 + `m7-t1-openclaw` 22/22 (`tests.md:11`) |
| `F-SKILL-002` | Store-side alias canonicalization vs tools-side query | **FIXED — no cross-gate conflict** | Storage path canonicalizes (`30dbd99`); no schema/gate regression recorded at loop 2 |

## 2. Interaction Findings

- The 13-suite W0/W1 rerun list (`tests.md:11`) is green 100%: egress 4/4, m3-t5 8/8, zip-budgets 14/14, F-044 3/3, file-lock 8/8, decision-replay 4/4, origin-uniqueness 2/2, result-preview 14/14, approval-surface-record 4/4, m7-t1 22/22, F-296 5/5, unregistered-button 2/2, skip-expectation 13/13.
- Gate outcomes `NOT RUN` remain: Knowledgebase pytest lane recorded at the pre-fixed commit (the interim `database.py` change is whitespace-only) plus Docker/PostgreSQL and WSL lanes (`tests.md:13-14`). No row may close on those lanes.
- No cross-module inconsistency found on this boundary; no new defect introduced.

## 3. Blockers

- `F-587` owner decision (acceptance of the junit-observable scope) still pending.
