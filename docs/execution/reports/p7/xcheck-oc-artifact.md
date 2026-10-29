# Phase 7 Cross-Check Report: OpenClaw Artifact Validation / Excel Writer ↔ Zink Tools & Governance

- **Mode:** Recheck (Phase 7)
- **Boundary:** OpenClaw artifact validation / Excel writer (`integrations/openclaw/lib/`) ↔ Zink Tools contracts (`zink-tools/contracts/`) and OpenClaw governance (`integrations/openclaw/plugins/zink-governance/`)
- **Finding IDs Evaluated:** `F-OC-002`, `F-OC-003`
- **Report Path:** `docs/execution/reports/p7/xcheck-oc-artifact.md`
- **Summary Verdicts:**
  - `F-OC-002`: **FIXED** (High severity, F6 — Reliability & Performance)
  - `F-OC-003`: **FIXED** (Medium severity, F2 — Security & Authorization)
- **Blockers:** 0

---

## 1. Boundary & Module Isolation Overview

The boundary under review connects OpenClaw's artifact validation (`integrations/openclaw/lib/artifact-validator.mjs`) and Excel writer (`integrations/openclaw/lib/excel-writer.mjs`) with Zink Tools schema contracts (`zink-tools/contracts/tools/zink-excel.schema.json`) and OpenClaw governance handlers (`integrations/openclaw/plugins/zink-governance/index.mjs`).

In accordance with AGENTS.md §9:
1. **Module Ownership:** File execution and sandbox containment remain strictly within the OpenClaw hosting boundary (`~/.openclaw-zink/sandboxes`). Zink Tools remains a thin contract boundary.
2. **State Isolation:** Neither artifact validation nor Excel writing accesses or mutates Zink Knowledgebase or Zink Skill Store persistent state or vector indexes.
3. **Standalone Integrity:** Both modules maintain clear contract boundaries and operate standalone without shared runtime state or direct database coupling.

---

## 2. Detailed Finding Re-verifications

### F-OC-002 — Excel ZIP validation has no aggregate expanded-byte budget and can exhaust OpenClaw memory

- **Category / Severity:** F6 — Reliability & Performance / High
- **Verdict:** **FIXED**
- **Original Issue:** Both the result validator (`artifact-validator.mjs`) and Excel writer ZIP parser (`excel-writer.mjs`) inflated untrusted ZIP entries without aggregate expanded-byte or entry-count budgets, exposing OpenClaw to memory exhaustion from zip-bomb payloads.
- **Verification & Code Evidence:**
  1. **Option B Budgets Enforced in Both Readers:**
     - `ENTRY_COUNT_LIMIT = 5000`
     - `PER_ENTRY_LIMIT = 128 * 1024 * 1024` (128 MiB)
     - `TOTAL_UNCOMPRESSED_LIMIT = 512 * 1024 * 1024` (512 MiB)
  2. **Validator Reader Implementation:**
     - `integrations/openclaw/lib/artifact-validator.mjs:141-143`: Budget constants defined.
     - `integrations/openclaw/lib/artifact-validator.mjs:174-176`: Entry count checked prior to buffer allocation (`entryCount > 5000`).
     - `integrations/openclaw/lib/artifact-validator.mjs:220-235`: Pre-inflation checks against declared per-entry size and aggregate size.
     - `integrations/openclaw/lib/artifact-validator.mjs:248-298`: Incremental checks during inflation using `{ maxOutputLength }` with named error messages.
  3. **Writer Reader Implementation:**
     - `integrations/openclaw/lib/excel-writer.mjs:148-150`: Entry count checked (`entryCount > 5000`).
     - `integrations/openclaw/lib/excel-writer.mjs:176-190`: Pre-inflation checks against declared per-entry size and aggregate size.
     - `integrations/openclaw/lib/excel-writer.mjs:206-250`: Incremental checks during `zlib.inflateRawSync` using `maxOutputLength`.
  4. **Test Suite Verification:**
     - `tests/m12-t9-r5-zip-expansion-budgets.test.mjs:304-397`: 14 tests verifying entry count limits (5,001 entries rejected), per-entry size limits (>128 MiB rejected), aggregate output limits (>512 MiB rejected), forged declared sizes, and acceptance of valid Excel ZIPs in both readers.
- **Cross-Boundary Impact:**
  - Valid Excel artifacts, Power BI (`.pbix`), and DOCX files pass validation through `validateTechnicalArtifact` without regressions.
  - Zink Tools contracts remain thin schemas; no direct state access or ownership leaks occurred across the boundary.

---

### F-OC-003 — Excel generation can follow an in-workspace dangling symlink and create a file outside the sandbox

- **Category / Severity:** F2 — Security & Authorization / Medium
- **Verdict:** **FIXED**
- **Original Issue:** `realpathOf` reconstructed unresolved target paths after realpath errors, allowing a dangling final symlink or junction in the workspace to bypass `assertInsideWorkspace` containment checks and write files outside the sandbox.
- **Verification & Code Evidence:**
  1. **Dangling Symlink Detection & Containment Checks:**
     - `integrations/openclaw/lib/excel-writer.mjs:539-577`: `realpathOf` handles dangling symlinks by resolving link targets with `fs.readlinkSync` and recursively checking real paths.
     - `integrations/openclaw/lib/excel-writer.mjs:583-631`: `assertInsideWorkspace` checks both the resolved base and target paths, as well as every intermediate path segment. Any segment that is a dangling symlink or points outside the workspace throws `ARTIFACT_PATH_ESCAPE` before writing.
  2. **Test Suite Verification:**
     - `tests/agent-lib-F-044.test.mjs:117-176`: Explicit test verifying that a workbook target that is a dangling symlink or junction pointing outside the sandbox is refused with `ARTIFACT_PATH_ESCAPE`, and confirming the outside file is not created.
- **Cross-Boundary Impact:**
  - Standard in-sandbox Excel workbook generation, preview generation, and sheet operations succeed normally.
  - Sandbox write authority remains strictly in the OpenClaw hosting boundary; Zink Tools adapter schemas and Knowledgebase/Skill Store state remain untouched.

---

## 3. Summary of Recheck Results

| Finding ID | Severity | Category | Status | Verdict | Evidence |
| --- | --- | --- | --- | --- | --- |
| `F-OC-002` | High | F6 — Reliability & Performance | CLOSED | **FIXED** | `artifact-validator.mjs:141-298`, `excel-writer.mjs:148-250`, `tests/m12-t9-r5-zip-expansion-budgets.test.mjs` (14/14 PASS) |
| `F-OC-003` | Medium | F2 — Security & Authorization | CLOSED | **FIXED** | `excel-writer.mjs:539-631`, `tests/agent-lib-F-044.test.mjs:117-176` (PASS) |

- **Counts per severity:** High: 1 (FIXED), Medium: 1 (FIXED)
- **Blockers:** 0
- **Cross-module integrity:** Confirmed. Both modules function standalone; no cross-module contract breaks or ownership leaks were detected.
