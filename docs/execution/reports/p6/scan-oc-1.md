# OpenClaw Discord Audit Recheck Report (oc-1)

**Slice ID:** oc-1
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-OC-001** | Button payload sent with raw unregistered components when SDK resolution fails | **FIXED** | `integrations/openclaw/lib/discord-native-send.mjs:303,311,325,751` (commit `844a10f`; loop-2 regression `a9ddced`) |
| **F-463** | Governed plan-step fields render without BANNED-PATTERN redaction | **OPEN** (carried; residual half measured) | `discord-formatter.mjs:663-695`, `BANNED_PATTERNS :22-29` |
| **F-464** | Legacy routing row | **not in register** (closed upstream) | findings.md history |
| **F-399** | Delivery seam abandons in-flight send; messageId lost, no SURFACED event | **OPEN** (needs fault injection) | Register row |

## 2. Detailed Findings Recheck

### F-OC-001 — component SDK fail-closed
- **Verdict:** FIXED (mechanism re-verified at HEAD `93438dd`)
- **Evidence:** `resolveComponentSdk` throws `COMPONENT_SDK_UNAVAILABLE` listing the failures (`:303`), logs the fail-closed reason (`:325`), and the failed call site answers "This component has expired" with the symbolic code at `:751` — raw unregistered components are never posted.
- **Test Evidence:** loop-1 suite `m12-t1-discord-component-registry` 19/19 (commit `844a10f` evidence); loop-2 commit `a9ddced` fixed `F-588` in the pinning lane so `m12-t9-unregistered-button-components-fail-closed` now reports 2/2 PASS (`tests.md:11`). Register row still carries the Phase-3 OPEN text (stale) — Phase 8 reconciliation.

### F-463 — plan-step redaction residual
- **Verdict:** OPEN (carried): `renderGovernedPlanSteps` now calls `redactGovernedField`/`sanitizeDiscordText` (`:663-665`, `:690-695`) but `BANNED_PATTERNS` still matches only `/Users /home /tmp /etc /var /app`, so `/mnt /opt /srv /root` survive — measured, recorded in the register residual note.

## 3. New Defects & Blockers

- **New Defects Introduced:** None (`F-588`'s permanently-red subtest was the defect, fixed in loop 2).
- **Blockers:** None new for this slice.
