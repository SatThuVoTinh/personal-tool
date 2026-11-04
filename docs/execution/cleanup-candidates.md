# Cleanup Candidates — Phase 9

Refreshed 2026-10-31 (loop 2, after the BLK-14 history repair); **executed
2026-10-31 with owner approval** — every approved path below was deleted with
one `Remove-Item` command per path so the permission prompt showed the exact
target. No `git add -A` was used at any step (BLK-14 lesson).

## Executed 2026-10-31 (owner-approved)

| Path | Why it existed | Verified safe | Result |
| --- | --- | --- | --- |
| `.qoder/` | IDE temp-worktree cache (agent-general-purpose snapshots); the 8,499 tracked copies were already removed from the index in the BLK-14 repair and the folder was gitignored | `git worktree list` = main worktree only; `.git/worktrees` absent; tracked `.qoder` count = 0 | Deleted; still listed in `.gitignore`; git status shows no `.qoder` noise |
| 28 `temp/` scratch directories (`agent-plugin`, `b4-backup`, `b4-mut`, `b4-mut2`, `b4-mut3`, `b5-mut`, `d-commit`, `f280-bak`, `f281-bak`, `f525probe`, `headcopy`, `int-f435`, `knowledge-t5`, `knowledge-test`, `l6-head`, `l7-head`, `l8-head`, `m4-r8-diagnostic-repo`, `prefix`, `probe-f013`, `probe-f058`, `probe-f115`, `probe-f151`, `probe-f169`, `probe-f176`, `recovered`, `snap`, `w2-snapshot-untracked`) | Fixer/lead measurement and mutation-probe rigs from R4–R5 waves | Untracked scratch; every still-referenced measurement is recorded verbatim in findings.md rows and the p1–p7 reports | All 28 deleted; 0 temp directories remain. **All `temp/` files were kept** — only directories were on the approved list |
| `docs/execution/reports/.findings-index.json` | Scratch index written by the fix-plan §8 measurement | Scratch only; findings.md and `reports/` carry the evidence | Deleted; the tracked deletion (" D") is committed as part of the 2026-10-31 docs commit |
| `scratch/legacy-empty-trees/` (incl. `models-probe/`) | Legacy scratch trees from earlier alleys | Untracked, referenced by no report or source | Deleted |

## Deliberately kept

- `temp/f568-audit.json` — the F-585 re-measurement evidence (kept per the
  plan's own rule; needed before any npm-audit/upstream-dependency decision).
- ALL other `temp/` files (R4-era probe logs, `.bak` copies, `add-*.mjs` /
  `apply-*.mjs` scripts, `admission-provenance.*`, `affected-*.txt`, the
  ~5.3 MB `uv` payload, findings/PLAN snapshots, `empty-lane.xml`, etc.) — the
  owner's approval covered the directories only. Hundreds of files remain; if
  the owner wants them gone too, the lead will first publish a separate
  per-path listing for approval (not deleted silently).
- `scratch/test-excel-unzipped/` — not on the approved list, kept.
- `docs/execution/reports/p6/` and `p7/` — git-tracked audit evidence
  (20 scanner + 12 cross-checker recheck reports at HEAD `93438dd`),
  referenced by findings.md rows; deleting them would destroy audit history,
  not clean up leftovers.
