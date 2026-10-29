# Phase 7 Recheck — xcheck-tools-oc (Tools ↔ OpenClaw boundary)

- **Mode:** Recheck (Phase 7)
- **Boundary:** Zink Tools (`zink-tools/`) ↔ OpenClaw hosting/adapter boundary (`integrations/openclaw/`)
- **Finding IDs verified:** F-OC-010, F-OC-011
- **Baseline:** Current working tree at HEAD `63ddf40` (after fix commits recorded in fix-plan.md)
- **Task status:** `M12/T9-R4` approved for closure by owner; this lane confirms fixes did not break cross-module boundaries

---

## F-OC-010 — native Excel execution error envelope schema compliance

**Claimed fixed:** YES — catch block emits schema-compliant shape instead of generic `{status:"ERROR", tool, error, message, code}`

### Verdict: PARTIAL

**Evidence:**

- `integrations/openclaw/plugins/zink-governance/index.mjs:5343-5355` — catch now returns `JSON.stringify({ operation, success, error_code, error_message })`
- Contract: `zink-tools/contracts/tools/zink-excel.schema.json:56-75` has `"required": ["operation","success"]` and `"additionalProperties": false`
- Schema declares these output properties (lines 58-71): `operation`, `status`, `success`, `tool`, `file_path`, `container_path`, preview fields, `error`, `summary`
- **Problem:** The error envelope introduces `error_code` and `error_message` which are **NOT declared** in the schema (lines 56-75), violating `additionalProperties: false`

**Root cause assessment:** Fix addressed the old problem (unstructured `message`/`code` violation) but created a new one (undeclared `error_code`/`error_message`). Acceptance criteria states "either publish one declared Excel error output shape OR explicitly define and validate a shared terminal-error envelope". Neither path was completed.

**Blast radius:** Changing the schema affects Zink Tools contract surface consumed by OpenClaw callers. Changing the emit shape affects all five callable tools sharing the same validator (`index.mjs:5292-5367`). Neither change alone is sufficient without coordinated update.

**Comparison with p6 scan-report:** Phase 6 scan reported the same issue (scan-tools-1.md:18-20). The fix attempt introduced fields not in schema — still PARTIAL.

---

## F-OC-011 — published Excel semantic contract states unimplemented while hosted runtime writes workbooks

**Claimed fixed:** YES — contract document updated to reflect executable mode

### Verdict: NOT FIXED

**Evidence:**

- `zink-tools/excel/contract.md:24` still states "Under Model A (Contract Tool Interface), invocation returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam."
- `zink-tools/README.md:8` states "`zink_excel` Thật, một engine duy nhất" pointing to hosted writer at `integrations/openclaw/lib/excel-writer.mjs`
- Runtime dispatch at `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4863` resolves and calls real hosted writer (`excel-writer.mjs:841-852`)
- Guard's seam-based refusal at `integrations/openclaw/topology/lib/guard.mjs:2230-2242` remains for `target === "contract_seam"` only

**Analysis:** Contradiction persists:
1. Contract prose says Model A returns `ENGINE_NOT_IMPLEMENTED`
2. README and runtime execute real workbooks
3. Seam-based refusal reachable only for separate dispatch target

Acceptance criteria requires "one published description of `zink_excel`'s executable mode, consistent across contract.md, README.md, policy registry and guard/plugin dispatch, with a doc-versus-runtime consistency check". No such alignment achieved.

**Fix-site decision required:** Either:
- Update `contract.md` to reflect live execution (preserves capability, changes semantic contract), OR
- Make runtime return `ENGINE_NOT_IMPLEMENTED` (disables live capability, requires owner decision per AGENTS.md §7 RED boundary)

**Blast radius:** Changing contract.md affects Zink Tools semantic contract surface. Changing runtime behavior would disable user-visible capability. Boundary decision needed before any change.

**Comparison with p6 scan-report:** Phase 6 correctly identified PARTIAL status requiring owner decision. Same conclusion here.

---

## Boundary integrity checks

### Hosting boundary preserved ✓

- Excel writer hosted under `integrations/openclaw/lib/excel-writer.mjs` — consistent with documented hosting boundary (AGENTS.md:283-285; `docs/architecture/zink-tools-boundaries.md:5-8,86-108`)
- OpenClaw owns orchestration, tool invocation policy, persisted workflow state
- Zink Tools supplies callable contracts/adapters — does not own workflow or persistence
- Workbook execution and filesystem authority stay in OpenClaw hosting boundary

### Adapter contract shape preserved ✓

- Tool schemas in `zink-tools/contracts/` remain source of truth for interface shapes
- Output validation uses OpenClaw guard consuming these schemas (`guard.mjs:2277-2301`)
- Validator skipped for ERROR status when `status?.toUpperCase?.() !== "ERROR"` fails (line 5400-5417) — pre-existing bypass pattern noted in original finding

### Cross-module ownership preserved ✓

- No direct Tools mutation of Knowledgebase/Skill Store state observed
- No shared env/config/ports/volumes/credentials found
- Skill adapter delegates to Skill Store code; Knowledge adapter is HTTP client — no ownership change
- Database access and schema ownership unchanged (Knowledgebase owns PostgreSQL, n8n owns its workflow store)

### State and lifecycle integrity ✓

- OpenClaw workflow state persisted under `integrations/openclaw/` paths
- No ledger/state corruption detected in reviewed paths
- Plugin hooks maintain bounded authorization model

---

## New defects detected

None discovered inside scope during recheck. Both findings relate to OpenClaw plugin files that touch in-scope contract documents. Root causes remain within boundary definitions:
- F-OC-010: OpenClaw emit shape vs. Zink Tools schema declaration — requires coordinated update
- F-OC-011: Published prose vs. runtime behavior — requires owner decision before behavioral change

---

## Summary table

| Finding ID | Claim | Verdict | Evidence Path | Notes | Blast radius |
|------------|-------|--------|---------------|-------|--------------|
| F-OC-010 | Error envelope fixed | PARTIAL | `index.mjs:5343-5355` + `zink-excel.schema.json:56-75` | Fields added (`error_code`, `error_message`) not declared in schema | Schema must be updated OR remove fields from envelope |
| F-OC-011 | Contract/docs aligned | NOT FIXED | `contract.md:24`, `README.md:8`, `index.mjs:4845-4863` | Contradiction persists; owner decision required | Decision required before touching capability or contract |

---

## Checks

- Tests: Not run per recheck protocol — Phase 6 tests reported in `docs/execution/reports/p6/tests.md` (Knowledgebase PASS, repo-policy PASS, affected Node tests PASS)
- Source/shared files modified: None — read-only recheck as per role constraints
- Report file written: Only `docs/execution/reports/p7/xcheck-tools-oc.md` (permission-enforced)

---

## Final reply to parent (≤10 lines)

Report: `docs/execution/reports/p7/xcheck-tools-oc.md`
F-OC-010: PARTIAL — error envelope changed but still violates schema (missing field declarations `error_code`, `error_message`)
F-OC-011: NOT FIXED — documentation inconsistency persists; owner decision required before behavioral change
No new defects found in Tools scope
Boundary integrity preserved: hosting, adapter contract, ownership, state lifecycle intact
Blockers: (1) Schema must declare error fields or remove them from envelope; (2) Owner must decide intended Excel mode (live execution vs. contract-only)
