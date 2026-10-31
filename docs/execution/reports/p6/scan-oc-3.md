# Phase 6 Recheck Report — OpenClaw authority, policy, ledger, lock (slice oc-3)

**Mode:** recheck
**Date:** 2026-10-29
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 63ddf40
**Finding IDs under review:** F-OC-004, F-OC-005

---

## Summary

| Finding  | Previous Status (findings.md)  | Recheck Verdict | Evidence Path                                             | Notes                                                                                                                               |
| -------- | ------------------------------ | --------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| F-OC-004 | CONFIRMED - Fixed at f5bf41a   | FIXED           | integrations/openclaw/lib/file-lock.mjs:219-234, :285-288 | Compare-and-remove guard in `removalRound()` verifies token before unlink; throws FILE_LOCK_NOT_OWNER on mismatch                   |
| F-OC-005 | CONFIRMED-AS-LATENT (outdated) | FIXED           | integrations/openclaw/lib/decision-ledger.mjs:449-461     | Inside writer lock (after readDurableEntries), canonical comparison rejects duplicate deterministic ID with different decision text |

---

## F-OC-004 — file-lock release can delete a replacement holder's lock after its token check

**Verdict:** FIXED ✅

**Evidence:**

- `integrations/openclaw/lib/file-lock.mjs:220-234` (`removalRound()` function): reads current on-disk `owner.json`, compares token to `expectedToken` before any unlink. Returns `{refused: true}` if tokens differ.
- `integrations/openclaw/lib/file-lock.mjs:285-288`: if `round.refused` during retry loop, deletes registry entries and throws `FILE_LOCK_NOT_OWNER`.
- Git commit `f5bf41a` confirms fix landed.

**Impact:** Prevention of interleaving-replacement race where an old holder could delete a new holder's lock directory, allowing two writers into critical section simultaneously.

**Tests:** `tests/m10-t2-r18-file-lock.test.mjs` shows 8/8 passed including R18-08 (mutation probe confirmed).

---

## F-OC-005 — concurrent conflicting DecisionLedger writes overwrite the same deterministic ID

**Verdict:** FIXED ✅

**Evidence:**

- `integrations/openclaw/lib/decision-ledger.mjs:446-463` (inside `withFileLockSync` in `save()` method):
  - Line 448: `const durable = this._replaceDurableSet ? new Map() : this.readDurableEntries();`
  - Lines 456-461: For each record being saved, checks if `durable.get(id)` exists; if yes, compares canonical bytes and throws `DECISION_ID_CONFLICT` if different content.
  - Only after conflict check passes does it call `durable.set(id, record)`.

**Note:** The previous status in findings.md (`CONFIRMED-AS-LATENT`) is outdated. The fix at commit `565f203` moved the conflict check INSIDE the writer lock where it belongs, ensuring concurrent writes cannot silently overwrite.

**Tests:** Gate `m12-t9-r4-decision-replay-order` reported 4/4 passed in docs/execution/reports/p6/tests.md.

---

## New Defects Introduced by Fixes (Inside Scope)

None identified. Both fixes follow existing patterns:

- F-OC-004 uses the same retryable-errno policy as pre-existing code
- F-OC-005 reuses the already-established `readDurableEntries()` pattern and error enum

---

## Out-of-Scope Pointers

N/A — both findings fully within oc-3 scope.

---

## Final Gate Status Reference

From `docs/execution/reports/p6/tests.md`:

- Affected Node tests (F-OC-002, F-OC-003, F-OC-004, F-OC-005, ...): PASS — All affected test suites passed 100% green
- Specifically: `m10-t2-r18-file-lock` (8/8), `m12-t9-r4-decision-replay-order` (4/4)

---

**Report file:** docs/execution/reports/p6/scan-oc-3.md
