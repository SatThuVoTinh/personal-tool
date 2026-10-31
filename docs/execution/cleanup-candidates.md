# Cleanup Candidates — Phase 9

Refreshed 2026-10-31 (loop 2, after the BLK-14 history repair). Nothing on this list is
deleted until the owner approves each path, one command per path (workflow rule).

| Path | Why it exists | Why safe to delete | Risk |
| --- | --- | --- | --- |
| `.qoder/` (untracked, gitignored since BLK-14) | IDE temp-worktree cache; the 8,499 tracked copies were removed from the index in the BLK-14 repair (option B) and the folder was gitignored | No tracked file references it (verified tracked count = 0); contains only stale worktree snapshots (agent-general-purpose-*) | Low — deleting the folder does not touch the repository or current history; do NOT combine with any `git add -A` (BLK-14 lesson) |
| `temp/` scratch trees (26 dirs: `agent-plugin`, `b4-backup`, `b4-mut`.., `b5-mut`, `d-commit`, `f280-bak`, `f281-bak`, `f525probe`, `headcopy`, `int-f435`, `knowledge-t5`, `knowledge-test`, `l6-head`, `probe-f013`…) | Fixer/lead measurement and mutation probes from R4–R5 waves (temp copies of HEAD, mutation rigs, npm-audit JSON) | All untracked scratch; every still-referenced measurement result is recorded verbatim in findings.md rows (e.g. `temp/f568-audit.json` numbers) and in the p1–p7 reports | Low/Medium — deleting removes the raw probe files; keep `temp/f568-audit.json` if the owner wants to re-measure it before any dependency decision (F-585), else delete |
| `docs/execution/reports/.findings-index.json` | Scratch index written by this plan's measurement (fix-plan §8 first candidate) | Scratch only; findings.md and reports/ carry the evidence | Low |
| `scratch/legacy-empty-trees/` (incl. `models-probe/`) | Legacy scratch trees from earlier alleys | Untracked scratch referenced by no report or source | Low |

Removed from the previous list (not candidates any more): the entire
`docs/execution/reports/p6/` and `p7/` directories — they are git-tracked audit
evidence updated in place at HEAD `93438dd` (20 scanner + 12 cross-checker
recheck reports), referenced by findings.md rows and the Phase 8 records;
deleting them would destroy audit history, not clean up leftovers.
