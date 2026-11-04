# Infrastructure Audit Recheck Report (infra-2)

**Slice ID:** infra-2
**Phase:** Phase 6 recheck mode (loop 2)
**Date:** 2026-10-31
**Branch:** codex/m11-t1-audit-remediation
**Commit:** 93438dd
**Test Reference:** `docs/execution/reports/p6/tests.md`

---

## 1. Recheck Verdicts Summary

| Finding ID | Subject | Status / Verdict | Evidence Path / Reference |
| --- | --- | --- | --- |
| **F-DB-002** | n8n backup excludes the credential decryption key | **LATENT** | No fix committed; mechanism unchanged at HEAD; depends_on `F-558` |
| **F-401** | EXECUTING items unrecoverable (recovery helper has no production call site) | **OPEN** (carried) | `integrations/openclaw/lib/queue-manager.mjs:1132` (register row) |
| **F-403** | STALE/UNKNOWN quota reading overwrites the hysteresis latch | **OPEN** (carried) | `QUOTA_FRESHNESS_MS` mechanism, register row |

## 2. Detailed Findings Recheck

### F-DB-002 — n8n backup excludes the encryption key
- **Verdict:** LATENT (fixer never dispatched; RED pending owner memo; mechanism remeasured live at HEAD via register row — no source change in loop 1/loop 2 touched the backup arm)
- **Evidence:** the n8n backup still excludes the config carrying the encryption key and records no recovery reference; `depends_on: F-558` (OPEN, coercions unfixed).
- **Test Evidence:** PostgreSQL/Docker lane `NOT RUN` per `docs/execution/reports/p6/tests.md:13`; no backup-restore probe exists on this host.

### F-401 — detectAndRecoverStaleTasks has zero production call sites
- **Verdict:** OPEN (carried; production crash-recovery gap still live)
- **Evidence:** register row unchanged: definition at `queue-manager.mjs:1132` plus only test callers; no loop-2 lane touched the queue.

### F-403 — quota latch overwrite on STALE/UNKNOWN read
- **Verdict:** OPEN (carried; `QUOTA_FRESHNESS_MS` 60000 at `quota-telemetry.mjs:31/:145`)
- **Test Evidence:** no dedicated quota suite in the W0/W1 affected list (`tests.md:11`).

### Backup/secret rows in slice
- **F-558** — OPEN: absent measurement coerced to 0/empty/true manifests a positive operator certification. Carried; no loop-2 change.
- **F-424** — OPEN: backup subsystems enumerate different governed sets (seven AGENTS.md rewrites without preimage). Carried.
- **BLK-13 related:** loop 2 raised the tracked secret-scan ceiling 360→370 in `scripts/repository-policy.mjs` (owner order "D"); `repo:check` PASS per `tests.md:12`.

## 3. New Defects & Blockers

- **New Defects Introduced:** None.
- **Blockers:** F-DB-002 stays dispatch-blocked on owner memo + F-558; Docker/PostgreSQL lanes NOT RUN (host constraint, `tests.md:13`).
