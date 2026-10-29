# Phase 6 Test Gates Raw Outcomes

Recorded on: 2026-10-29
Branch: codex/m11-t1-audit-remediation
Commit: 63ddf40

| Gate | Status | Raw outcome / Details |
| --- | --- | --- |
| Knowledgebase (`test:knowledge`) | PASS | 311 passed, 18 skipped, 31 subtests passed in 54.67s (`uv run --directory apps/knowledge --locked python -m pytest tests -q`) |
| Repository policy (`repository-policy.mjs`) | PASS | 1 suite, 1 test passed in 3.15s (`node scripts/repository-policy.mjs`) |
| Affected Node tests (F-OC-002, F-OC-003, F-OC-004, F-OC-005, F-SKILL-001, F-OC-001, F-OC-006, F-585) | PASS | All affected test suites passed 100% green: `m12-t9-r5-zip-expansion-budgets` (14/14), `agent-lib-F-044` (3/3), `m10-t2-r18-file-lock` (8/8), `m12-t9-r4-decision-replay-order` (4/4), `symlink-escape` (5/5), `m12-t1-discord-component-registry` (19/19), `workflow-origin-uniqueness` (2/2), `agent-setup-F-188` (19/19) |
| Repository check (`repo:check`) | FAIL | Diagnostic failures: trailing whitespace in 7 files; status vocabulary in findings.md; package.json missing 2 new test files |
| PostgreSQL / Docker real-database lane | NOT RUN | Requires live container daemon and active PostgreSQL instance not provisioned on this host |
| POSIX WSL fsync/lock lane | NOT RUN | Windows host environment; WSL lane not configured for foreground test runner |
