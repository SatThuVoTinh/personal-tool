# Phase 6 Test Gates Raw Outcomes

Recorded on: 2026-10-29
Branch: codex/m11-t1-audit-remediation
Commit: 63ddf40

| Gate | Status | Raw outcome / Details |
| --- | --- | --- |
| Knowledgebase (`test:knowledge`) | PASS | 311 passed, 18 skipped, 31 subtests passed in 54.67s (`uv run --directory apps/knowledge --locked python -m pytest tests -q`) |
| Repository policy (`repository-policy.mjs`) | PASS | 1 suite, 1 test passed in 3.15s (`node scripts/repository-policy.mjs`) |
| Affected Node tests (W0/W1: F-INFRA-001, F-INFRA-004, F-OC-001, F-OC-002, F-OC-003, F-OC-004, F-OC-005, F-OC-006, F-OC-007, F-OC-008, F-585, F-586, F-588, F-481, F-492) | PASS | All affected test suites passed 100% green: `agent-infra-F-INFRA-001-egress` (4/4), `m3-t5-contract` (8/8), `m12-t9-r5-zip-expansion-budgets` (14/14), `agent-lib-F-044` (3/3), `m10-t2-r18-file-lock` (8/8), `m12-t9-r4-decision-replay-order` (4/4), `workflow-origin-uniqueness` (2/2), `m12-t1-result-preview-and-ownership` (14/14), `m12-t9-r4-f529-approval-surface-record` (4/4), `m7-t1-openclaw` (22/22), `agent-topo-F-296` (5/5), `m12-t9-unregistered-button-components-fail-closed` (2/2), `agent-owner-F-197-skip-expectation` (13/13) |
| Repository check (`repo:check`) | PASS | 76 tests passed in 16.94s (`node --test tests/repository-policy.test.mjs`), `node scripts/repository-check.mjs` passed with 0 errors, secret ceiling re-measured to 370 |
| PostgreSQL / Docker real-database lane | NOT RUN | Requires live container daemon and active PostgreSQL instance not provisioned on this host |
| POSIX WSL fsync/lock lane | NOT RUN | Windows host environment; WSL lane not configured for foreground test runner |
