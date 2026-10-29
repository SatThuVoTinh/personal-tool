# Infrastructure Container Audit Recheck Report

Phase 6 recheck mode - infra-1 slice
Date: 2026-10-29
Branch: codex/m11-t1-audit-remediation
Commit: 63ddf40

## Finding F-INFRA-001 — Bridge Egress Bypass

**Verdict:** NOT FIXED  
**Status:** CONFIRMED-AS-LATENT remains valid  

**Evidence:**  
`infrastructure/docker/compose/compose.core.yml:228` declares `internal: true` on the platform network. The fix is present in source code. However, no live container egress probe was run to verify runtime behavior. Host firewall policy may affect reachability measurements.

**Assessment:** Code fix applied but acceptance criteria requires a deployed-shape measurement. No regression test added to detect direct TCP/DNS egress attempts.

**Related findings:** None identified.

---

## Finding F-INFRA-003 — Hardening Overlay Omitted from Normal Start

**Verdict:** PARTIAL (code exists, not in execution path)  

**Evidence:**  
`infrastructure/docker/scripts/start.ps1:17-49` selects compose files: core + knowledge + hardening overlay (conditional). The hardening file `compose.knowledge.hardening.yml:1-10` declares all five controls (`read_only`, `cap_drop: ALL`, `no-new-privileges`, `pids_limit: 256`, `/tmp` tmpfs).

**Gap Analysis:** The hardening overlay IS referenced in `start.ps1` at line 19 and conditionally appended at line 47-48 when `Test-Path -LiteralPath $knowledgeHardeningComposeFile -PathType Leaf`. This matches the acceptance overlay proven by `tests/agent-kb-F-239.test.mjs:75-92`. However, `start.ps1:47-48` uses conditional inclusion only if the file exists at runtime — the fix depends on file presence rather than being mandatory.

**New Defect Introduced:** NONE detected inside scope.

**Status assessment:** Partial fix — the mechanism exists but lacks enforcement. A missing hardening file would silently skip hardening instead of failing fast. Recommendation: make hardening overlay mandatory or remove it as an optional dependency.

**Acceptance criteria:** Not yet satisfied — normal start must require the hardening overlay, not conditionally include it.

**Tests affected:** `tests/agent-kb-F-239.test.mjs` asserts overlay contents, not normal-start composition. No test validates that `start.ps1` fails when hardening file is absent.

---

## Summary

| Finding | Verdict | Confidence | Evidence Path |
| --- | --- | --- | --- |
| F-INFRA-001 | NOT FIXED | HIGH | `infrastructure/docker/compose/compose.core.yml:228` |
| F-INFRA-003 | PARTIAL | HIGH | `infrastructure/docker/scripts/start.ps1:47-48`, `compose.knowledge.hardening.yml:1-10` |

No NEW defects found inside infra-1 scope during recheck.

**Out-of-Scope Pointers:**

- F-INFRA-002 (PostgreSQL credential separation) — resolved in R5 commit `7570f73` but Docker/container privilege checks remain `NOT RUN` per `docs/execution/reports/p6/tests.md:13`.
- F-INFRA-004 (migration set mismatch) — infrastructure expectation update required, outside recheck scope.

**Final Reply:**  
Report: docs/execution/reports/p6/scan-infra-1.md  
Critical: 0 · High: 0 · Medium: 2 (F-INFRA-001 LATENT, F-INFRA-003 PARTIAL)  
Blockers: Live deployment probes blocked by Docker/PostgreSQL not running on this host; tests marked NOT RUN.
