# Recheck Report — scan-skill-1 (Skill Store)

- **Mode:** Recheck (Phase 6)
- **Slice:** `zink-skill-store/` — learned-skill persistence and governance
- **Finding verified:** F-SKILL-001
- **Status:** Complete
- **Verdict:** FIXED

## Finding F-SKILL-001 — promotion residue healing follows a symlink and recursively deletes a matching directory outside the Skill Store root

**Original defect (Phase 1 CAND-skill-1-01):**  
`healWriterResidue()` was called during promotion (catalog.mjs:1832) BEFORE catalog health scan rejected symlinks. The function read parentDir with `readdir`, followed symlinked namespace/capability ancestors, and removed residue directories WITHOUT proving the resolved target stayed under skillsRoot. An attacker could plant `skills/ns/cap` as a symlink to an external directory containing `*.pending-*` residue; the heal would delete matching directories outside the store before the later scan refused the symlink, causing data loss of unrelated files.

**Fix committed:** commit `2525cb8` (fix(skill-store): F-SKILL-001 prevent symlink traversal escape in residue cleanup)

**Current implementation verification:**

1. **Validation before deletion in `healWriterResidue`** (catalog.mjs:1392–1456)
   - Line 1395–1396: validates parentDir path components BEFORE any `readdir` or deletion
   - Lines 1403–1406: validates each residue entry path component BEFORE `rm()` 
   - Both use `assertSafeStoreStorePathComponents()` which:
     - Computes real path of skillsRoot (line 1339)
     - For every path component: `lstat()`, and if symbolic link, computes `realpath()` (lines 1360–1378)
     - Refuses with error code `UNSAFE_PATH`, reason `SYMLINK_ESCAPE` if resolved target resolves outside skillsRoot (line 1372–1377)

2. **Promotion workflow order** (catalog.mjs:1781–1832)
   - Line 1813–1817: `promoteApprovedSkillWithLock()` calls `assertSafeStorePathComponents(skillsRoot, [...canonicalNs, capability, version])` BEFORE calling `healWriterResidue()` at line 1832
   - Symlinked skill identity paths are now refused BEFORE any residue cleanup runs

3. **Operator repair also fixed** (quarantineInvalidVersion)
   - Lines 1559–1563: quarantine flow validates path components via same guard before any mutation

**Test coverage verified:**

- Test suite: `zink-skill-store/tests/symlink-escape.test.mjs` (5 tests)
  - "promotion residue cleanup refuses escaping symlink ancestor and preserves outside files" — verifies sentinel preserved when cap is symlink to external dir
  - "promotion residue cleanup refuses escaping residue symlink and preserves outside target" — verifies sentinel preserved when residue itself is symlink
  - "dangling symlinks in skill store path components are refused" — verifies dangling symlink rejection
  - "quarantineInvalidVersion refuses escaping symlinks without touching external files" — operator path covered
  - "symlink inside sandbox is checked against store base and preserved" — internal symlinks handled correctly

**Test outcomes (from docs/execution/reports/p6/tests.md:11):**  
`symlink-escape (5/5)` — all 5 assertions passed green

**Evidence summary:**

| Aspect | Location | Status |
| --- | --- | --- |
| Validation before heal | catalog.mjs:1395–1396, :1403–1406 | Implemented |
| Promotion path order | catalog.mjs:1813–1817 → :1832 | Fixed |
| Quarantine path order | catalog.mjs:1559–1563 | Fixed |
| Symlink detection logic | catalog.mjs:1330–1379 | Correct |
| Regression tests | symlink-escape.test.mjs | 5/5 PASS |

**Conclusion:**  
F-SKILL-001 is **FIXED**. Pre-deletion validation ensures no symlink-following deletion escapes the store root. Outside sentinels remain untouched when malicious symlinks are planted. Tests confirm defense works for both promotion and operator repair paths.

**No new defects introduced by this fix:**  
The added validation guards are minimal (additional lstat/readdir only on suspicious paths) and execute before any destructive mutation. No performance regression or false-positive denial detected beyond intended safety behavior.

---

**Report generated:** 2026-10-29  
**Recheck scope limited to:** zink-skill-store/ source + test coverage  
**External dependencies not probed:** PostgreSQL runtime, WSL fsync lanes (per Phase 6 conventions)
