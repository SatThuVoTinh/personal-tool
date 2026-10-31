# Cross-Check Recheck Report — xcheck-oc-discord-gov

**Boundary:** Discord adapters (formatter, native-send) ↔ governance plugin publish/registration seams
**Phase:** Phase 7 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Fixed IDs on this boundary:** `F-OC-001`, `F-OC-009`, `F-OC-007`; carried `F-529`–`F-531`

---

## 1. Boundary Verdicts

| ID | Cross-check question | Verdict | Evidence |
| --- | --- | --- | --- |
| `F-OC-001` | Attribute payload with missing native-send adapter handled fail-closed without crashing the publisher | **FIXED — consistent** | `COMPONENT_SDK_UNAVAILABLE` thrown/resolved fail-closed (`discord-native-send.mjs:303,311,325,368,751`); `m12-t9-unregistered-button-components-fail-closed` 2/2 + `m12-t1-discord-component-registry` 19/19 (loop-1 record) |
| `F-OC-009` | Canonical-surface gate compares IDs against the configured set, not mere presence | **FIXED — consistent** | `isCanonical` vs `CANONICAL_DISCORD_SURFACE_IDS` (`index.mjs:10266-10292`); governed-surface 44 passed (commit `54633d7`), plugin suite 22/22 at loop 2 |
| `F-OC-007` | Superseded delegated run denied publish via run check | **FIXED — consistent** | `evaluateSpecialistProvenance` (`index.mjs:10194`) + run check `:9790`; `m7-t1-openclaw` 22/22 (`tests.md:11`) |

## 2. Interaction Findings

- **Fail-closed answer ↔ registry:** when resolution fails, the recorded card answer is "This component has expired" with the symbolic `COMPONENT_SDK_UNAVAILABLE` code (`:751`), keeping the card excerpt truthful while never posting unregistered components — the two sides no longer disagree (F-OC-001's original formatter/sender disagreement is resolved).
- **Provenance chain:** the superseded-run denial (`F-OC-007`) and the canonical-surface comparison (`F-OC-009`) compose: a superseded record on a non-canonical surface is denied at whichever predicate fires first; no bypass found between them at HEAD.
- **`F-529`–`F-531` consistency:** `F-586`'s SURFACED-anchor refusal protects the `F-529` best-effort seam; `F-530` (plan binding) and `F-531` (no WORKFLOW_CANCELLED producer) remain OPEN and were untouched — no interaction regression.
- **`F-399` (in-flight send abandonment) stays OPEN (fault injection); the fail-closed path does not add a new abandonment surface** — the SDK-unavailable branch returns before the send, not during it.

## 3. Blockers

- None new on this boundary.
