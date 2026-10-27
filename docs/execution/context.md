# Parallel Run Context

## 1. Current run

**Run status: ACTIVE — Phase 4 complete; the owner approved the fix plan and the R5 execution contract is materialized and valid, so Phase 5 (fix execution) is authorized.** The audit stage (Phases 1–4, loop 1) is closed. Audit target is the working tree as observed immediately before Phase 1 dispatch; it is already dirty, and those pre-existing changes are recorded here as baseline. The main agent compares repository status after each full audit-phase launch and stops if a source change occurs during an audit phase.

Phase 1 produced 18 candidate mechanisms; Phase 2 cross-checks added 5 more (F-OC-009/010/011, F-INFRA-003/004), widened F-OC-002 to a second live ZIP reader, widened F-INFRA-002 to the Skill Store client, recorded the `/mnt`-`/opt`-`/srv`-`/root` sanitizer residual under the live F-463, and reclassified F-OC-005 and F-OC-006 as LATENT after the reducer/ingress paths were re-read. Phase 3 applied 23 verdicts to the register: 10 `CONFIRMED`, 13 `CONFIRMED-AS-LATENT`, 0 rejected. The register now carries 170 rows, 138 of them actionable (90 OPEN, 20 LATENT, 13 CONFIRMED-AS-LATENT, 10 CONFIRMED, 3 PARTIAL, 2 BLOCKED) and 32 REFUTED. Phase 4 wrote `docs/execution/fix-plan.md`; the owner approved it on 2026-10-27, and the R5 contract was materialized from `docs/execution/active-r5-draft.md` with R4 archived verbatim. The pre-R5 working tree was preserved as baseline commit `79241ab` (owner decision A), so every Phase 5 row commits onto a clean tree.

| Field          | Current value |
| -------------- | ------------- |
| Session ID     | N/A — not exposed to the coordinator |
| Objective      | Full repository read-only audit, Phases 1–4 |
| Coordinator    | Main agent |
| Started at     | 2026-10-26 20:54 +07:00 |
| Last updated   | 2026-10-27 11:54 +07:00 |
| Workflow phase | 5 — fix execution (W1 running; W0 blocked on the `scripts/**` permission) |
| Loop number    | 1 |
| Counts         | Register 170 rows: 138 actionable (90 OPEN, 20 LATENT, 13 CONFIRMED-AS-LATENT, 10 CONFIRMED, 3 PARTIAL, 2 BLOCKED), 32 REFUTED; 23 loop-1 verdicts applied; 0 rejected |
| Overall status | ACTIVE — R5 contract valid; Phase 5 authorized |

**Dispatch baseline:** HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, branch `codex/m11-t1-audit-remediation`. `git status --short` already showed extensive modified, staged and untracked work, including edits under source modules and tests, plus `.qoder/`; these are pre-existing and are not attributable to the audit. Agents may edit only their assigned `docs/execution/reports/p1/*.md` report. No source writes are authorized.

This file records the current coordinated run only. It is not permanent project memory, an execution authorization, or a replacement for `PLAN.md`, `docs/contracts/execution/ACTIVE.md`, or `docs/execution/findings.md`.

## 2. Run lifecycle

At the beginning of a coordinated run, the main agent must complete these steps in order before dispatching any subagent:

1. Read this file and confirm whether a previous run is still active. Do not reset an active run.
2. Read `docs/execution/slices.md` and the actual OpenCode agent definitions at `%USERPROFILE%\.config\opencode\opencode.json`. This configuration is outside the repository; inspect its current contents when validating agent names, models, permissions, or routing. Do not assume a repository copy exists.
3. Read the applicable `PLAN.md` task and validate the execution authorization and, when required, the matching `docs/contracts/execution/ACTIVE.md`.
4. Set this file to the actual run status and record the real objective, session ID if available, coordinator, start time, and exact assignments with scope, dependencies, write ownership, and acceptance criteria.
5. Check that assignments follow the approved slices, agent permissions, and disjoint-write requirements. Resolve overlaps before dispatch.
6. Only then spawn subagents.

When resuming, retain the active run and update its existing assignments and reports. Before starting a new run, confirm the previous run has ended and unresolved bugs have been recorded or assigned in `docs/execution/findings.md`.

## 3. Coordination responsibilities

### Main agent

The main agent is the coordinator and the sole writer of this shared context file. It must:

- inspect repository state and this context before dispatch;
- assign clear objectives, file ownership, dependencies, and acceptance criteria;
- maintain assignment status and consolidate subagent reports here;
- review and deduplicate candidate bugs, verify their evidence, and update `docs/execution/findings.md` through its required workflow;
- verify fixes or arrange independent verification before recording a task as verified;
- resolve assignment conflicts and preserve blockers and unresolved work.

### Subagents

Subagents must stay within their delegated scope and file ownership. They report progress, findings, changed files, checks and exact results, evidence, and blockers to the main agent. They do not edit this context file or another agent's report. The main agent owns verification, deduplication, and updates to `docs/execution/findings.md` under its mandatory workflow; a subagent may make a specific register edit only when the main agent explicitly delegates that permitted edit. Delegation does not grant authority to change owner-approved scope, decisions, authorization, or finding status.

### Shared-file safety

The main agent is the default sole writer of `docs/execution/context.md`. Never replace the full file with a partial report. Avoid concurrent edits to shared files; if overlap is necessary, the main agent must coordinate it explicitly. Record only meaningful checkpoints, not repetitive status chatter.

## 4. Task assignments

No assignments exist while the run status is `NOT STARTED`. The main agent records one row per real assignment before dispatch.

| Task ID | Agent | Objective | Owned files or modules | Dependencies | Acceptance criteria | Status |
| ------- | ----- | --------- | ---------------------- | ------------ | ------------------- | ------ |
| P1-01 | scan-infra-1 | Audit infrastructure containers, network, volumes, health and resource limits | infrastructure/; report docs/execution/reports/p1/scan-infra-1.md | None | Read-only audit report; no source changes | done_verified |
| P1-02 | scan-infra-2 | Audit infrastructure env/secrets templates, backup/restore and runbook truth | infrastructure/, docs/runbooks/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-03 | scan-kb-1 | Audit Knowledgebase ingestion, Vault read-only and input trust | apps/knowledge/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-04 | scan-kb-2 | Audit Knowledgebase indexing, embeddings, storage and migrations | apps/knowledge/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-05 | scan-kb-3 | Audit Knowledgebase retrieval, provenance, citations and API | apps/knowledge/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-06 | scan-skill-1 | Audit Skill Store persistence and governance | zink-skill-store/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-07 | scan-skill-2 | Audit Skill Store scoped retrieval and API | zink-skill-store/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-08 | scan-skill-3 | Audit Skill Store isolation and backup/restore | zink-skill-store/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-09 | scan-tools-1 | Audit adapter contracts, schemas and input validation | zink-tools/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-10 | scan-tools-2 | Audit tool capability execution and resource limits | zink-tools/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-11 | scan-tools-3 | Audit provider/n8n/OpenClaw boundary, timeouts and errors | zink-tools/; own P1 report | None | Read-only audit report; no source changes | done_verified |
| P1-12 | scan-oc-1 | Audit Discord formatting, native send, routing and fail-closed behavior | integrations/openclaw/lib/discord-formatter.mjs, discord-native-send.mjs; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-13 | scan-oc-2 | Audit artifact validation, Excel writing, paths and status truth | integrations/openclaw/lib/artifact-validator.mjs, excel-writer.mjs; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-14 | scan-oc-3 | Audit OpenClaw authority, policy, ledger, lock, queue and quota | assigned integrations/openclaw/lib files; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-15 | scan-oc-4 | Audit topology/orchestration graph, identity and state transitions | integrations/openclaw/topology/**, orchestration/**; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-16 | scan-oc-5 | Audit governance plugin authorization, sandbox and provenance | integrations/openclaw/plugins/zink-governance/index.mjs; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-17 | scan-oc-6 | Audit OpenClaw setup, preflight, rollback, templates | integrations/openclaw/configure.mjs, verify.mjs, templates/**; own P1 report | None | Read-only audit report; out-of-scope pointers routed to owner | done_verified |
| P1-18 | scan-db-1 | Audit database schema, migrations and init scripts | database definitions under infrastructure/; own P1 report | None | Read-only audit report | done_verified |
| P1-19 | scan-db-2 | Audit database backup, restore, integrity and recovery | database definitions under infrastructure/ and app usage; own P1 report | None | Read-only audit report | done_verified |
| P1-20 | scan-db-3 | Audit database roles, credentials, exposure, injection and transactions | database definitions under infrastructure/ and app data access; own P1 report | None | Read-only audit report | done_verified |
| P2-01 | xcheck-kb-skill | Cross-check Knowledgebase and Skill Store index/state isolation | both module slices; report docs/execution/reports/p2/xcheck-kb-skill.md | Phase 1 reports | verify candidates, shared causes and blast radius | done_verified |
| P2-02 | xcheck-kb-tools | Cross-check Knowledgebase and Tools retrieval/citation contracts | KB and Tools boundary; own P2 report | Phase 1 reports | verify candidates, contract gaps and blast radius | done_verified |
| P2-03 | xcheck-skill-tools | Cross-check Skill Store retrieval and Tools governance | Skill Store and Tools boundary; own P2 report | Phase 1 reports | verify candidates, shared causes and blast radius | done_verified |
| P2-04 | xcheck-tools-oc | Cross-check Tools/OpenClaw adapter boundary | Tools and OpenClaw; own P2 report | Phase 1 reports | verify candidates and hosting-boundary effects | done_verified |
| P2-05 | xcheck-oc-gov-topo | Cross-check governance library/plugin with topology/orchestration | OpenClaw governance and topology; own P2 report | Phase 1 reports | verify candidates, shared causes and blast radius | done_verified |
| P2-06 | xcheck-oc-discord-gov | Cross-check Discord adapters with governance | Discord adapters and plugin; own P2 report | Phase 1 reports | verify candidates, auth/routing effects and duplicates | done_verified |
| P2-07 | xcheck-oc-artifact | Cross-check artifact validation/Excel with Tools and governance | artifact/Excel and consumers; own P2 report | Phase 1 reports | verify candidates and end-to-end reachability | done_verified |
| P2-08 | xcheck-infra-kb | Cross-check infrastructure and Knowledgebase | infrastructure and KB; own P2 report | Phase 1 reports | verify egress, DB privilege and recovery blast radius | done_verified |
| P2-09 | xcheck-infra-skill-tools | Cross-check infrastructure with Skill Store and Tools | infra, Skill Store, Tools; own P2 report | Phase 1 reports | verify isolation, backup and DB access | done_verified |
| P2-10 | xcheck-infra-oc | Cross-check infrastructure with OpenClaw setup/runtime | infra and OpenClaw; own P2 report | Phase 1 reports | verify deploy/runtime and host-boundary effects | done_verified |
| P2-11 | xcheck-db-all | Cross-check database ownership/access/backup across all modules | database and all module callers; own P2 report | Phase 1 reports | verify role, migration and recovery blast radius | done_verified |
| P2-12 | xcheck-tests-all | Cross-check tests and gates against all module findings | tests/** and all modules; own P2 report | Phase 1 reports | identify coverage gaps, false confidence and duplicates | done_verified |

| P3-01 | triage-01 | Triage bucket 1 of the 23 loop-1 candidates | docs/execution/reports/p3/triage-01.md | Phase 1–2 reports | CONFIRMED / LATENT / REFUTED verdict with evidence | done_verified |
| P3-02 | triage-02 | Triage bucket 2 | docs/execution/reports/p3/triage-02.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-03 | triage-03 | Triage bucket 3 | docs/execution/reports/p3/triage-03.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-04 | triage-04 | Triage bucket 4 | docs/execution/reports/p3/triage-04.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-05 | triage-05 | Triage bucket 5 | docs/execution/reports/p3/triage-05.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-06 | triage-06 | Triage bucket 6 | docs/execution/reports/p3/triage-06.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-07 | triage-07 | Triage bucket 7 | docs/execution/reports/p3/triage-07.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-08 | triage-08 | Triage bucket 8 | docs/execution/reports/p3/triage-08.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-09 | triage-09 | Triage bucket 9 | docs/execution/reports/p3/triage-09.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-10 | triage-10 | Triage bucket 10 | docs/execution/reports/p3/triage-10.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-11 | triage-11 | Triage bucket 11 | docs/execution/reports/p3/triage-11.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P3-12 | triage-12 | Triage bucket 12 | docs/execution/reports/p3/triage-12.md | Phase 1–2 reports | verdict with evidence | done_verified |
| P4-01 | main agent | Apply the 23 triage verdicts to the register (status, type, severity, RED, fixer, depends_on, evidence) | docs/execution/findings.md | Phase 3 reports | every loop-1 row carries its verdict; 0 rejected | done_verified |
| P4-02 | main agent | Write the Phase 4 fix plan covering the whole register | docs/execution/fix-plan.md | P4-01 | counts measured from the register; waves ordered root-cause → High → Medium → Low; RED list separate | done_verified |
| P4-03 | main agent | Materialize the R5 execution contract and point `PLAN.md` at it | docs/contracts/execution/ACTIVE.md, PLAN.md | owner approval of P4-02 | task ID and revision match; Planning Readiness APPROVED; Execution Authorization YES | done_verified — R5 at `docs/contracts/execution/ACTIVE.md` (351 lines), R4 archived at `docs/contracts/execution/archive/2026-10-27-M12-T9-R4.md`, `PLAN.md` active block at line 8571 |
| P5-01 | fix-infrastructure | Fix `F-INFRA-002` (Option A: module roles inside the existing `postgres` database, no migration), then the remaining infra/DB rows | infrastructure/** plus `zink-skill-store/src/vector-sync.mjs` (row-scoped owner exception) | R5 contract §8.4 item 1 and item 5 | red/green + mutation probe + gates; the lead commits the row | done_verified — committed as `7570f73`; `bash -n` exit 0, `m11-t1-skill-vector-sql` 25 passed, `m3-t1-contract` + `m5-docker-contract` 13 passed, eslint exit 0; Docker/live PostgreSQL checks `NOT RUN` on this host |
| P5-02 | fix-tests | Fix `F-481` under the static declaration rule | tests/** and scripts/** (owner opened it 11:57) | R5 contract §8.4 item 4; owner decision 2026-10-27 | gate reddens 4/4 and 32/32, green after the re-declaration; mutation probe | review — gate rule in `scripts/skip-expectation-gate.mjs` (7 lines) and the `matchingCases()` fixture fixed; `node --test tests/agent-owner-F-197-skip-expectation.test.mjs` 13 passed / 0 failed; mutation probe red then green; lint/format blocked only by the F-OC-002 lane's untracked test file; the JSON re-declaration waits for the owner's 1/2/3 answer |
| P5-03 | fix-knowledgebase | Fix `F-KB-001` (High) | apps/knowledge/** | R5 contract §5 | red/green + mutation probe + `test:knowledge`; lead commits | done_verified — lane worktree `m12-t9-r5-f-kb-001`, applied by the lead and committed as `6c05167`; `tests/test_index_lifecycle.py` 16 passed, `npm run test:knowledge` 308 passed / 18 skipped |

Use only the statuses `planned`, `in_progress`, `blocked`, `review`, and `done_verified`:

- `planned`: assigned but not started;
- `in_progress`: currently executing;
- `blocked`: unable to proceed because of a recorded blocker or dependency;
- `review`: reported complete and awaiting review or verification;
- `done_verified`: acceptance criteria checked and evidence recorded.

A subagent's completion report alone does not make an assignment `done_verified`.

**Lane worktrees (observed 2026-10-27).** Some fixers run in an isolated git worktree under `%USERPROFILE%\.local\share\opencode\worktree\<id>\<name>` (observed: `m12-t9-r5-f-kb-001`, `f-oc-002-zip-budgets`) instead of the main tree. A lane's report can therefore be green while the main working tree shows no change. The lead integrates a finished lane by copying its diff into the main tree, re-running the row's gate there, and committing the row; the lane worktree is never committed by the fixer.

## 5. Agent reports

The main agent keeps one concise report for each real assignment. Include the following fields as applicable, without creating empty or speculative reports:

- objective and current status;
- investigation performed and evidence;
- confirmed bugs and suspected root cause, distinguishing confirmed findings from hypotheses;
- files modified and fix implemented;
- exact tests or checks run and their observed results, or `Not run`;
- blockers, unresolved issues, and recommended next action;
- last meaningful checkpoint.

Do not copy entire investigation logs or large raw command output into this file.

## 6. Bug consolidation workflow

Subagents send candidate bugs and supporting evidence to the main agent. The main agent owns consolidation into `docs/execution/findings.md` and must:

1. Check whether the candidate already exists in the register.
2. Deduplicate overlapping reports.
3. Re-verify the affected code, reproduction, evidence, and suspected root cause.
4. Follow the register's mandatory per-bug workflow and preserve its format.
5. Record the finding ID and resulting status in the relevant assignment report only after the register is actually updated.

Use these dispositions when tracking candidates in an active run: `pending_review`, `recorded`, `duplicate`, or `rejected` with the reason. A bug is not `recorded` until the register contains the corresponding update. Do not change owner-approved decisions or finding statuses without the authority required by `PLAN.md` and the valid execution contract.

## 7. Verification and completion

Before marking an assignment `done_verified`, the main agent checks that:

- the intended change is present;
- the relevant tests or gates actually ran and their output supports the claim;
- remaining limitations and regression risks are recorded;
- newly discovered bugs have been consolidated into `docs/execution/findings.md` or explicitly assigned for follow-up.

Distinguish implementation from verification. A passing test does not establish unrelated behavior. Report unavailable checks as `Not run`; never imply the whole effort is complete while assignments remain unresolved or unverified.

## 8. Blockers and dependencies

For each significant blocker, record its ID, description and evidence, affected assignments, required action, responsible owner, and status. Do not silently drop blocked work or report it complete.

| ID | Blocker | Evidence | Affected | Required action | Owner | Status |
| --- | --- | --- | --- | --- | --- | --- |
| BLK-1 | No R5 execution contract exists | **closed 2026-10-27**: the owner opened `PLAN.md` and `docs/contracts/**` in the `audit-lead` block (config saved 11:51), R5 was written from the draft, R4 archived, and the four validity fields match `PLAN.md`. | P4-03, all of Phase 5 | none | owner / Codex | closed |
| BLK-2 | 25 RED rows undecided | 3 of 28 decided 2026-10-27 and recorded in `ACTIVE.md` §8.4 (`F-INFRA-002` Option A, `F-OC-002` Option B, `F-OC-006` Option A); the other 25 wait for a memo per row | W1–W4 lanes that own those rows | owner memo per row | owner | open |
| BLK-3 | `F-400`, `F-534` need an OpenClaw host fact | register status lines | B1, B10 | supply the fact or keep them BLOCKED | owner | open |
| BLK-4 | `F-KB-003` only exists inside the uncommitted `F-576` patch | register row | B10 KB lane | ship `F-576`, then re-measure | main agent after R5 | open |
| BLK-5 | `F-492`'s second half is unobservable in the junit signal | `ACTIVE.md` §8.1 | W0 | re-scope the criterion or name the signal | owner | open |
| BLK-6 | `fix-tests` cannot edit `scripts/**` | **closed 2026-10-27 11:57** — the owner added `"scripts/**": "allow"` at line 2136 of the `fix-tests` edit block; verified in the config. | W0 `F-481`, the B8 gate rows | none | owner | closed |
| BLK-7 | No fixer can commit | every fixer `bash` block carries `"git commit": "deny"` (for example `fix-tests` lines 2170–2171); a lane that follows the "one commit naming the row" instruction stalls at the commit step | all Phase 5 lanes | **resolved 2026-10-27** by making the lead the only committer (`ACTIVE.md` §4.5 and §5 item 8); fixers stop at a verified working-tree change | main agent | closed |
| BLK-8 | `fix-infrastructure` cannot edit `vector-sync.mjs` | **closed 2026-10-27 12:29** — the owner added `"zink-skill-store/src/vector-sync.mjs": "ask",` at line 5386 of the `fix-infrastructure` edit block (option A). It is `ask`, not `allow`, so a background lane may stall on the prompt; the lead watches for that. | `F-INFRA-002` | none (watch the prompt) | owner | closed |

## 9. Next actions

Next actions, in priority order:

1. **Owner** — add `"zink-skill-store/src/vector-sync.mjs": "allow",` after line 5385 of the `fix-infrastructure` edit block, then reload. Reload can end the two running lanes (`F-KB-001`, `F-OC-002`); re-dispatch them if it does.
2. **Main agent** — after the reload, dispatch `fix-infrastructure` for `F-INFRA-002` (bootstrap roles + `start.ps1` + `vector-sync.mjs`), then `F-DB-001` / `F-DB-002` / `F-INFRA-001` / `F-INFRA-003` / `F-INFRA-004`, one row per commit by the lead.
3. **Main agent** — re-dispatch `fix-tests` for `F-481` with the lead-commits rule: implement the static declaration rule in `scripts/skip-expectation-gate.mjs`, keep or re-author the `F-481` regression test (the earlier session deleted 66 lines of it from the working tree), capture red then green. The lead applies the `ci-skip-expectations.json` re-declaration (`postgres` `maxSkips` 4 → 3, `docker` → `must-run`) and commits the row.
4. **Owner** — decide `F-492`'s re-scope (BLK-5) and the remaining 25 RED rows.
5. **Main agent** — keep `docs/execution/findings.md` untouched except for verdict/closure edits; no row leaves the register before its seven-point evidence exists.

## 10. Session handoff

Before ending a coordinated run, the main agent records the final run status, each assignment's status, verified changes and evidence, bugs consolidated and candidates still pending, blockers and next actions, and any uncommitted changes or file conflicts. Keep this file scoped to that run until it has ended; do not replace an active run prematurely.
