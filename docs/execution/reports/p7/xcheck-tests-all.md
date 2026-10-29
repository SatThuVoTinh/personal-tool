# Recheck Report: Tests and Gates Against All Modules
**Date:** 2026-10-29  
**Mode:** Recheck (Phase 7)  
**Finding IDs:** F-481, F-585  
**Scope:** Cross-module boundary audit between `tests/**` and all modules

---

## Executive Summary
| Severity | Count | Status |
|----------|-------|--------|
| FIXED | 1 | PASS |
| NOT FIXED | 1 | Requires owner decision |

---

## Finding Verification Results

### ✅ F-481 — POSTGRES AND DOCKER MAY-SKIP CEILINGS EQUAL DENOMINATORS
**Status: FIXED at commit `088ecd7` (2026-10-27)**

**Evidence:**
- `docs/contracts/ci-skip-expectations.json:51`: postgres `maxSkips: 3` (was 4), docker `must-run` (was 32)
- `scripts/skip-expectation-gate.mjs:316`: enforces `maxSkips < passes + skips` with ceiling-discriminator check
- `tests/agent-owner-F-197-skip-expectation.test.mjs`: test "F-481" validates gate refusal on equal ceiling/denominator

**Boundary Impact Analysis:**
- **Test module → Gates module**: The gate script reads contract declarations; test verifies enforcement logic
- **Blast radius**: Gates + CI only (no cross-module state mutation)
- **Independence preserved**: Contract file is static declaration; test suite is isolated; no shared mutable state across Zink Knowledgebase/Skill Store/Tools boundaries

**Recheck verdict: FIXED ✓** - Both fixes did not break any other module; gates remain standalone, tests validate without external dependencies.

---

### ⚠️ F-585 — DEPENDENCY-AUDIT BASELINE ACCEPTS TWO HIGH ADVISORIES AGAINST `markdown-it`
**Status: NOT FIXED — OWNER DECISION REQUIRED**

**Evidence:**
- `package.json:34`: `"markdownlint-cli2": "0.23.3"` (outdated)
- `package-lock.json:1157`: `markdown-it@15.0.1` vulnerable to GHSA-gfr2-rv44-r23c and GHSA-r7fv-28h4-cvq7
- `.github/security/npm-audit-baseline.json:21/33`: Two high advisories recorded as accepted
- `npm audit --json` reports upgrade to `markdownlint-cli2@0.24.0` removes both vulnerabilities
- Gate never checks `fixAvailable` field from `npm audit --json`

**Boundary Impact Analysis:**
- **Test module → Build & runtime config**: Dependency set change affects entire repository (RED per AGENTS.md §7)
- **Cross-module ownership**: All three logical modules depend on devDependency for testing/linting
- **Risk assessment**: No production impact (devDependency only), but security posture degraded
- **Fix proposal requires**: Upgrade markdownlint-cli2 to 0.24.0 + re-record baseline OR explicit acceptance of cost

**Owner decision options:**
1. **Option A**: Upgrade to markdownlint-cli2@0.24.0, update lockfile, re-record empty baseline (clean)
2. **Option B**: Record refusal and accept cost of two high advisories in baseline as explicit security tradeoff

**Recheck verdict: PARTIAL** - Defect still present; awaiting owner decision per original finding scope (RED boundary).

---

## Recommendations

1. **F-481**: Mark CLOSED in `findings.md`; record closure in `CHANGELOG.md` with evidence path
2. **F-585**: Schedule review with owner for Option A/B decision within 3 business days
3. **Process improvement**: Add automated check for `fixAvailable: true` advisories in CI pipeline

---

## Boundary Integrity Confirmation

✅ All verified fixes preserve module isolation  
✅ No direct mutation of another owner's database/vector/object-store state  
✅ Test assertions remain scoped to their respective modules  
✅ Contract files are read-only declarations from downstream consumers

**Report author:** Qoder (subagent in recheck mode)  
**Next steps:** Owner decision required for F-585 only
