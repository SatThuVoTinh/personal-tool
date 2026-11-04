# Phase 1 audit report — scan-skill-1

- **Mode:** Audit (Phase 1)
- **Slice:** `zink-skill-store/` — learned-skill persistence and governance
- **Observed tree:** dispatch baseline HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; source tree was already dirty at dispatch. Reviewed current working-tree source and relevant diffs; no source files changed by this audit.
- **Status:** Complete
- **Confirmed candidates:** 1 (Critical 0, High 0, Medium 1, Low 0)
- **Hypotheses:** 0
- **Blockers:** None
- **Checks:** No tests or runtime probes executed. The reproduction below is derived from the current call sequence and is suitable for an isolated scratch-root probe.

## Confirmed findings

### CAND-skill-1-01 — promotion healing follows a symlinked capability path and recursively deletes an external version directory

- **Severity:** Medium
- **Class:** 1 — security flaw (also causes data loss)
- **Confidence:** High
- **Path and evidence:** `zink-skill-store/src/catalog.mjs:1723` constructs `parentDir` from the caller's skills root and identity; `zink-skill-store/src/catalog.mjs:1733` calls `healWriterResidue` before the catalog health scan at `zink-skill-store/src/catalog.mjs:1844`. In `zink-skill-store/src/catalog.mjs:1331-1341`, `readdir(parentDir)` follows a symlink in an ancestor component, `isResidueDirectory` accepts matching names at `zink-skill-store/src/catalog.mjs:1077-1083`, and `rm(path.join(parentDir, entry), { recursive: true, force: true })` removes the target recursively. The scanner's symlink rejection occurs later: `walk` checks each directory with `lstat` and rejects symbolic links at `zink-skill-store/src/catalog.mjs:689-710`.
- **Impact:** A symlink planted as a namespace or capability directory can redirect the pre-scan cleanup outside `skillsRoot`. An owner promotion into that identity then deletes any matching `*.pending-*` or `*.stranded-*` directory under the symlink target before the subsequent catalog scan refuses the store. Matching directory contents are not checked for Skill Store ownership, so unrelated files inside them are lost.
- **Concrete reproduction/probe:** In an isolated temporary tree, create `skills/ns/cap` as a directory symlink to a separate `outside/` directory. Put a sentinel file under `outside/1.0.0.pending-attacker/`. Call the exported `promoteApprovedSkillWithLock` with `skillsRoot=skills`, namespace `ns`, capability `cap`, version `1.0.0`, non-empty content, valid owner/requesting actors, `decisionRef: PLAN:M1/T1-R1`, valid source type and references. The predicted result from the current order is that `healWriterResidue` recursively removes the external `1.0.0.pending-attacker/` directory; the later `scanCatalog` rejects the symlinked capability path and promotion fails. Assert the sentinel is gone despite the failed promotion. No repository data is needed for this probe.
- **Other modules touched:** None; the unsafe mutation and later symlink refusal are both in `zink-skill-store/src/catalog.mjs`.

## Existing register items checked to avoid duplicates

These were not filed as new candidates. The current working-tree diff changes the cited implementations for several existing rows: F-411 (directory sync/error handling), F-430 (deprecate propagation and `sync` CLI command), F-431 (DDL and ledger entry transaction), F-432 (record lock only after acquisition), F-433 (re-read/compare lock owner), F-435 (acquiring wrapper renamed), and F-580 (promotion quarantine fallback). F-436's post-lock migration call remains outside this slice's source path and was not re-audited beyond checking that its known cross-module call site remains. F-572's model identity persistence gap is also already registered and was not duplicated.

## Out-of-scope pointers

- `integrations/openclaw/plugins/zink-governance/index.mjs:1181-1184` — `syncSkillsThroughDoor` applies Skill Store DDL migrations and then syncs outside the store writer-lock section; this is the existing cross-module F-436 call-site concern, routed to the OpenClaw/plugin owner.