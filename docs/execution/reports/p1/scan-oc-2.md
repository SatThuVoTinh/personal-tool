# Phase 1 audit — oc-2

- **Scope:** `integrations/openclaw/lib/artifact-validator.mjs`, `integrations/openclaw/lib/excel-writer.mjs`
- **Mode:** Audit; target was the dispatch-time working tree at HEAD `85eb094` with pre-existing diffs.
- **Outcome:** 2 candidates (1 High, 1 Medium); no blockers.
- **Checks:** Read the root `AGENTS.md`, coordination context, findings rules/register, scoped modules, and caller sites. No tests run. The shell status/diff command was denied, so source changes could not be independently attributed against HEAD; the coordinator’s dispatch context records the dirty baseline.

## Findings

### CAND-oc-2-01 — Excel validation permits unbounded aggregate ZIP expansion

- **Severity:** High
- **Class:** 4 — defect can bring the whole system down
- **Path:** `integrations/openclaw/lib/artifact-validator.mjs:164-202`
- **Evidence:** The central-directory entry count is read at line 164 and every entry is processed in the loop at lines 168-204. Each deflated entry is independently inflated with `maxOutputLength: MAX_ARTIFACT_SIZE_BYTES` (25 MiB) at lines 191-198, then retained in `contents` under its entry name. There is no aggregate expanded-byte or entry-count budget. The input file itself is limited to 25 MiB at lines 791-800, but that bound does not constrain the accumulated buffers. Excel validation invokes this reader on the artifact bytes at lines 907-908. The production result route calls `evaluateResultGate` at `integrations/openclaw/plugins/zink-governance/index.mjs:3125-3134`, which reaches this validation for an Excel artifact.
- **Concrete reproduction:** Supply a ZIP under 25 MiB whose central directory has many distinct names, including `[Content_Types].xml` and `xl/worksheets/sheet1.xml`, but points those entries at the same small local deflate stream that expands to (for example) 24 MiB. The parser does not require unique local offsets or verify that the local name matches the central name. It inflates and retains a separate buffer for each distinct central name. With the ZIP maximum 65,535 entries, cumulative requested output can exceed 1.5 TiB despite the per-entry cap; process memory exhaustion or prolonged CPU use can take down the OpenClaw process.
- **Impact:** An attacker able to submit a governed Excel result can cause severe memory/CPU exhaustion while the result gate validates it, potentially terminating the process and interrupting unrelated OpenClaw work.
- **Other modules touched:** Reachability only: `integrations/openclaw/plugins/zink-governance/index.mjs:3125-3134`.
- **Confidence:** High.
- **Register check:** No matching aggregate ZIP expansion finding found. Existing F-502 concerns an unwired atomic publish helper and is a different mechanism.

### CAND-oc-2-02 — Excel writer follows a dangling symlink outside its sandbox

- **Severity:** Medium
- **Class:** 1 — security flaw
- **Path:** `integrations/openclaw/lib/excel-writer.mjs:454-467`
- **Evidence:** `realpathOf` catches every `realpathSync` error, climbs to an existing ancestor, and appends the unresolved suffix (lines 457-466). For a dangling final-component symlink inside the workspace pointing outside it, resolution fails and the helper reconstructs an apparently in-workspace target. `assertInsideWorkspace` therefore passes at lines 474-480, and the target check occurs at lines 660-673. The writer then calls `fs.writeFileSync(targetPath, buf)` at lines 841-842; that operation follows the dangling symlink and creates the target outside the workspace. The governed Excel tool supplies its sandbox as `baseDir` at `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4864`.
- **Concrete reproduction:** Create an existing workspace directory and an outside directory, then create a dangling file symlink `<workspace>/report.xlsx -> <outside>/new-report.xlsx`. Call `executeExcelOperation({operation: "generate", file_path: "report.xlsx", data: [["x"]]}, workspace)`. `realpathSync` of the target fails because the link target does not yet exist; `realpathOf` resolves the workspace parent and re-appends `report.xlsx`; lexical and realpath containment pass; `writeFileSync` follows the link and creates `<outside>/new-report.xlsx`.
- **Impact:** A governed Excel operation can write an artifact outside the agent sandbox when an in-sandbox dangling symlink is present, violating the workspace boundary.
- **Other modules touched:** Reachability only: `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4864`.
- **Confidence:** High.
- **Register check:** No matching dangling-destination-symlink finding found. F-563 concerns another preview writer; it does not cover `excel-writer.mjs`.

## Out-of-scope pointers

- None identified.
