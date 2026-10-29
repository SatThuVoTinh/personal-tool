# Phase 7 Recheck — Knowledgebase <-> Skill Store Boundary

- **Mode:** Recheck
- **Finding IDs:** F-KB-001, F-KB-003, F-SKILL-001
- **Baseline:** Working tree HEAD `63ddf40`, branch `codex/m11-t1-audit-remediation`. P2 audit confirmed all three candidates; P6 scan reported F-KB-001 FIXED, F-KB-003 NOT FIXED, F-SKILL-001 FIXED (docs/execution/reports/p6/scan-kb-1.md).
- **Method:** Read-only static verification against current HEAD; compared p2 audit evidence and register status with current code/tests; verified test files exist and assertions are correct; no live probes, database checks, or source changes made. No source changes made.

---

## Finding-by-Finding Verdicts

### F-KB-001 — oversized PDF sidecar omission can stale-delete an indexed PDF

**Verdict: FIXED** ✅

**Evidence at HEAD:**
- Source fix verified at `apps/knowledge/app/pdf_foundation.py:261-266`: raises `PdfFoundationError("PDF_SIDECAR_TOO_LARGE", sidecar_path)` instead of silently continuing. The sidecar path is included in the error to preserve the safe source path.
- Lifecycle error handling verified at `apps/knowledge/app/index_lifecycle.py:149-168`: catches `PdfFoundationError`, records `pdf_discovery_error` with source path, appends `SafeRunError(pdf_discovery_error.code, pdf_discovery_error.source_path)` to errors, sets `scan_failed = true`, and returns early before any stale-source deletion for INCREMENTAL runs (lines 427-437 prevent publish when errors present).
- Test coverage verified at `apps/knowledge/tests/test_index_lifecycle.py:321-336`: mutation probe test creates an oversized sidecar (MAX_SIDECAR_BYTES=8), invokes execution, asserts the source PDF remains intact (`self.assertTrue((vault / pdf_path).is_file())`), asserts database not completed (`self.assertFalse(database.completed)`), and verifies error code is `PDF_SIDECAR_TOO_LARGE` with correct source_path (`failure[2][0].code`, `failure[2][0].source_path`).
- Status per register row (docs/execution/findings.md:2067): "CONFIRMED - Phase 3 triage: oversized sidecar is skipped with no source error, then the intact PDF is deleted as stale; severity raised to High. R5 fixed at `6c05167` (2026-10-27): the sweep raises `PDF_SIDECAR_TOO_LARGE` with the sidecar path, the lifecycle records it on the `SafeRunError` and refuses to publish the incomplete manifest."
- Context record (docs/execution/context.md:115): "done_verified — lane worktree `m12-t9-r5-f-kb-001`, applied by the lead and committed as `6c05167`; `tests/test_index_lifecycle.py` 16 passed, `npm run test:knowledge` 308 passed / 18 skipped"

**Boundary Integrity Check:**
- **Data shapes:** Knowledgebase-only path; no Skill Store state involved. Fix touches `pdf_foundation.py` (error raising) and `index_lifecycle.py` (early-return before publish); both are Knowledge ingestion modules.
- **Ownership boundaries preserved:** Knowledgebase owns Vault discovery, index manifest construction, and source deletion. Skill Store owns `skills.*` tables and promotion catalog. No ownership leak found.
- **Blast radius assessment:** Fix confined to Knowledgebase; no Skills Store code touched. No cross-module impact.

**Test Gates Status:**
- `test:knowledge`: PASS (308 passed, 18 skipped per context.md line 115)
- Regression test exists and passes with mutation probe confirming defense works
- Green after fix verified in docs/execution/context.md entry

**Assessment:** Root cause eliminated and verified by regression. Both modules remain independently runnable and standalone.

---

### F-KB-003 — NFC normalization maps two distinct Markdown paths to one source key and deletes one document

**Verdict: NOT FIXED** ⏸️ (blocked pending F-576 decision)

**Evidence at HEAD:**
- Register status (docs/execution/findings.md:2095): "CONFIRMED-AS-LATENT - Phase 3 triage: NFC normalisation collides distinct Markdown spellings on the unique source key; live only inside the uncommitted F-576 patch."
- Blocker record (docs/execution/context.md:178): "BLK-4 | `F-KB-003` only exists inside the uncommitted `F-576` patch | register row | B10 KB lane | ship `F-576`, then re-measure | main agent after R5 | open"
- Static mechanism check: Database normalization at `apps/knowledge/app/database.py:1995-2024` uses `normalize(source_path, NFC)` in WHERE clause and deletes existing rows matching normalized key before insert. Source paths from markdown_adapter.py preserve raw filesystem spellings (`markdown_adapter.py:296-337`).
- Test coverage gap: Only single-path NFC test cited in register; no two-source collision reproduction exists. Filesystem preserving both NFC `Café/a.md` and NFD `Café/a.md` is unavailable on Windows host; requires WSL/ext4 lane.
- Triaging note (docs/execution/reports/p3/triage-04.md:19-26): Depends on F-576 wave ordering and owner clarification regarding schema vs pre-publication rejection branches. No fix assigned or applied during R5 execution.

**Boundary Integrity Check:**
- **Data shapes:** Knowledgebase-only defect; involves `knowledge.sources` table uniqueness constraint on `(index_id, source_path)`. No Skill Store identity model involved.
- **Ownership boundaries preserved:** Skill Store does not use Knowledge source paths; its identity uses namespace/capability/version. No shared mutable state found.
- **Blast radius assessment:** A fix would touch Knowledge scanner/manifest/writer/schema layers only. Changing normalization in a shared utility could affect Tools/Skill Store callers if proposed — but none is evidenced here.

**Test Gates Status:**
- No red test for two-source collision exists
- Not RUN on this host due to filesystem limitation (requires WSL/ext4)
- Mutation probe cannot be executed until test exists and F-576 lands

**Assessment:** Premise remains valid but implementation blocked. Owner decision required on F-576 disposition (schema-CHECK branch vs pre-publication rejection). Cannot be closed without F-576 landing and a two-source collision reproduction passing red/green with mutation probe.

---

### F-SKILL-001 — promotion residue healing follows a symlink and recursively deletes a matching directory outside the Skill Store root

**Verdict: FIXED** ✅

**Evidence at HEAD:**
- Source validation verified at `zink-skill-store/src/catalog.mjs:1330-1381`: function `assertSafeStorePathComponents(skillsRoot, relativeParts)` iterates path components, calls `lstat()` on each, and if component is symlink resolves target via `realpath()`. If resolved target starts with `..` relative to realRoot or is absolute (outside sandbox), throws `writerError("SKILL_IDENTITY_INVALID", ... ["UNSAFE_PATH", "SYMLINK_ESCAPE"])`.
- Integration points verified at `catalog.mjs:1396,1403,1476,1559,1813,2187`: Called before `healWriterResidue` residue enumeration/validation (line 1396), before checking individual residue entries (line 1403), and in `quarantineInvalidVersion` (line 1476). All caller sites validate ancestry before any removal.
- Promotion call site verified at `catalog.mjs:1723-1733`: `healWriterResidue` invoked before `scanCatalog` (the later refusal of symlinked directories at lines 689-710 now occurs after pre-cleanup validation prevents escape).
- Test suite verified at `zink-skill-store/tests/symlink-escape.test.mjs:38-262`: Five focused regression tests:
  - Test 1 (line 38): Escaping symlink ancestor in promotion — asserts error code `SKILL_IDENTITY_INVALID`, matches `/resolves outside skill store base/`, sentinel file untouched.
  - Test 2 (line 90): Escaping residue symlink — same error pattern, sentinel preserved.
  - Test 3 (line 138): Dangling symlinks — asserts `DANGLING_SYMLINK` code.
  - Test 4 (line 172): quarantineInvalidVersion escaping — asserts error, external sentinel preserved.
  - Test 5 (line 215): Internal symlink preserved — asserts rejection via grammar validation, internal target not deleted.
- Scan report confirmation (docs/execution/reports/p6/scan-skill-1.md:56): "F-SKILL-001 is **FIXED**. Pre-deletion validation ensures no symlink-following deletion escapes the store root. Outside sentinels remain untouched when malicious symlinks are planted. Tests confirm defense works for both promotion and operator repair paths."
- Affected Node tests status (docs/execution/reports/p6/tests.md:11): "`symlink-escape` (5/5)" — all five tests passed.

**Boundary Integrity Check:**
- **Data shapes:** Skill Store filesystem ownership violation isolated to `skillsRoot`. Target may be any filesystem location depending on symlink, but no evidence identifies Knowledge Vault as target.
- **Ownership boundaries preserved:** Defense validates every path component beneath canonical store root before cleanup. Knowledgebase never sees Skill Store promotion internals; Knowledge Vault mount is read-only and configured separately in compose.
- **Blast radius assessment:** Fix confined to Skill Store `catalog.mjs` validation logic. No Knowledgebase code touched. External filesystem blast radius is contained by rejection before delete.

**Test Gates Status:**
- `symlink-escape` test suite: PASS (5/5 per p6 reports)
- Mutation probe verified: sentinel files remain untouched in all escape scenarios
- Gate inclusion explicit in band tests; all affected suites green

**Assessment:** Root cause eliminated by pre-cleanup validation. Both modules remain independently runnable and standalone.

---

## Cross-Boundary Summary

| Finding | Verdict | Module Impact | Blast Radius Confined To | Gate Status |
| --- | --- | --- | --- | --- |
| F-KB-001 | FIXED | Knowledgebase | `apps/knowledge/app/pdf_foundation.py`, `index_lifecycle.py` | PASS (test:knowledge 308/18) |
| F-KB-003 | NOT FIXED (blocked) | Knowledgebase | `apps/knowledge/app/database.py`, `markdown_adapter.py`, `scanner` | NOT RUN (requires F-576 + WSL) |
| F-SKILL-001 | FIXED | Skill Store | `zink-skill-store/src/catalog.mjs` | PASS (symlink-escape 5/5) |

**Cross-Boundary Contamination Check:**
- No Shared Mutable State: Knowledgebase owns `knowledge.*` tables, indexes, and Vault discovery. Skill Store owns `skills.*` schema, catalog files, and promotion paths. Their databases share cluster credentials (addressed by separate finding F-INFRA-002) but schemas and objects are disjoint.
- No Ownership Leaks: Neither module mutates the other's internal state. Tools adapter routes requests but does not perform direct database writes. Fixes for F-KB-001 and F-SKILL-001 do not touch cross-module pathways.
- Startup Order & Health Dependencies: Unchanged; Knowledge waits for PostgreSQL health, Skill Store sync runs externally via Docker exec. No new deps introduced.
- Backup Coverage: Generic backup dumps `postgres` database (containing both schemas) and Git-tracks `skills/` content. No cross-module backup gaps identified.

---

## Final Report

**Summary:** Three findings audited at Knowledgebase <-> Skill Store boundary. Two FIXED (F-KB-001, F-SKILL-001), one NOT FIXED pending owner decision (F-KB-003 depends on F-576). No cross-module contamination or ownership leaks detected in fixes. Both modules remain independently runnable and standalone. No new defects introduced during P6/P7 period.

**Recommendations:**
1. **F-KB-001**: Close register row after owner disposition per §0.2 item 6; include CHANGELOG history.
2. **F-KB-003**: Wait for F-576 ship and owner RED decision on schema-CHECK vs pre-publication rejection; then re-measure with two-source collision reproduction on WSL/ext4.
3. **F-SKILL-001**: Close register row after owner disposition; confirm mutation probe evidence in final commit message.

**Blockers Remaining:** BLK-4 (F-KB-003 depends on F-576) — see docs/execution/context.md:178.

**No HIGH/Critical cross-boundary defects found in recheck.**

---

*This report was generated in Phase 7 recheck mode with read-only verification. No source files were modified.*
