# Cleanup Candidates — Phase 9

| Path | Why it exists | Why safe to delete | Risk |
| --- | --- | --- | --- |
| `.qoder/` | Untracked temporary workspace cache created by Qoder / IDE tooling during run | Contains no source code, tracked files, or repository state | Low / Safe — temporary IDE cache only |
| `docs/execution/reports/p6/` | Phase 6 test gate results and recheck scanner reports (20 files) | Audit artifacts from Phase 6 recheck run | Low — git-tracked record of Phase 6 rechecks if committed, or cleanable if ephemeral |
| `docs/execution/reports/p7/` | Phase 7 cross-checker recheck reports (12 files) | Audit artifacts from Phase 7 recheck run | Low — git-tracked record of Phase 7 rechecks if committed, or cleanable if ephemeral |
