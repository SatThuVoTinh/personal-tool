# M12/T9-R5 — Phase 4 fix plan for the whole register (owner approval required)

Loop 1 of the audit-and-fix workflow, Phases 1–3 complete, Phase 4 deliverable.
Baseline HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, branch
`codex/m11-t1-audit-remediation`. Every number below was measured by parsing
`docs/execution/findings.md` and `docs/contracts/execution/ACTIVE.md` at that
HEAD; nothing here is estimated.

This plan supersedes the drafts written earlier in this session. Those drafts
carried identifiers that were never verified against the register; this one is
built from the register itself.

## 1. Approval and authorization state

| Field | Value |
| --- | --- |
| Plan Revision | `M12/T9-R5` (proposed) |
| Planning Readiness | PENDING — owner sign-off on this file |
| Execution Authorization | NO — no `ACTIVE.md` for R5 exists yet |
| Predecessor | `M12/T9-R4`, contract at `docs/contracts/execution/ACTIVE.md` |
| Source phases | 1–4 read-only; this file writes no source |

Phase 5 may start only when the owner approves this plan **and** `PLAN.md`
points at a valid `docs/contracts/execution/ACTIVE.md` whose task ID and Plan
Revision match and whose Planning Readiness is APPROVED. Appendix A holds the
materialization draft for that contract.

## 2. Inventory (measured at HEAD)

### 2.1 Register totals — 170 rows

| Status | Rows | Meaning in this plan |
| --- | ---: | --- |
| OPEN | 90 | in scope, fixable |
| CONFIRMED | 10 | loop-1 rows, mechanism proven, fixable |
| CONFIRMED-AS-LATENT | 13 | loop-1 rows, mechanism proven, needs a deterministic trigger |
| LATENT | 20 | in scope, needs fault injection or a host fact |
| PARTIAL | 3 | one half shipped, one half open |
| BLOCKED | 2 | `F-400`, `F-534` — missing OpenClaw host fact, no fix |
| REFUTED | 32 | retained as register history, no code, not in any wave |

Actionable = **138** rows. Fixable = **136** (the two BLOCKED rows stay open).

### 2.2 Actionable rows by type (§0.4 classes)

| Type | Rows | Scope of the class |
| --- | ---: | --- |
| F1 Logic & Functional | 5 | wrong predicate, wrong branch, wrong value |
| F2 Security & Authorization | 21 | role, secret, egress, path escape, guard |
| F3 State & Lifecycle | 24 | ledger, lock, queue, reducer, recovery |
| F4 Integration & Contract | 28 | envelope, schema, documented contract |
| F5 Data Integrity & Correctness | 25 | data loss, wrong rows, stale deletes |
| F6 Reliability & Performance | 13 | crash, OOM, unbounded work, fsync |
| F7 Testing & Verification | 22 | gate truth, stale fixture, weakened assert |

### 2.3 Actionable rows by severity

**35 High · 72 Medium · 31 Low.** High is ordered first inside every type.

### 2.4 Bands that already exist in the R4 contract

| Band | Theme | Actionable now | Fixer batches (≤5 rows) |
| --- | --- | ---: | ---: |
| B1 | Approval, verdict, result, queue | 22 | 7 |
| B2 | Ledger, transaction, apply durability | 14 | 5 |
| B3 | Operator ceremony, rollback, rehearsal | 13 | 6 |
| B4 | Artifact validation, Excel, preview | 8 | 6 |
| B5 | Knowledgebase ingestion/retrieval/citation | 4 | 2 |
| B6 | Skill Store catalog/vector/lock/migration | 11 | 4 |
| B7 | Tool contracts, SQL/Python guards | 13 | 5 |
| B8 | Gate truth and CI enforcement | 17 | 5 |
| B9 | Test-only assertions, docs consistency | 9 | 3 |
| **B1–B9** | | **111** | **43** |

The 78 rows of the 189-row R4 scope that are already closed are absent from the
register and are not re-planned. Band membership and per-band order stay exactly
as `ACTIVE.md` §3 defines them; this plan does not renumber or reorder them.

### 2.5 Rows outside B1–B9 — the loop-1 additions (27)

23 loop-1 findings plus `F-400`, `F-534` (BLOCKED) and `F-585`, `F-586` (OPEN,
recorded after R4 froze). They form **B10** in Appendix A.

| Fixer | Rows | Batches |
| --- | ---: | ---: |
| `fix-infrastructure` | F-INFRA-001..004, F-DB-001, F-DB-002 | 3 |
| `fix-knowledgebase` | F-KB-001..004 | 2 |
| `fix-skill-store` | F-SKILL-001 | 1 |
| `fix-tools` | F-SKILL-002, F-OC-011 | 2 |
| `fix-openclaw-governance-library` | F-OC-004, F-OC-005 | 2 |
| `fix-openclaw-topology` | F-OC-006, F-586 | 1 |
| `fix-openclaw-artifact-validation` | F-OC-002, F-OC-003 | 2 |
| `fix-openclaw-discord-adapters` | F-OC-001 | 1 |
| `fix-openclaw-governance-plugin` | F-OC-007, F-OC-009, F-OC-010 | 2 |
| `fix-openclaw-setup-templates` | F-OC-008 | 1 |
| `fix-tests` | F-585, F-400, F-534 | 2 |
| **B10** | **27** | **19** |

A batch is one fixer invocation covering at most five rows of one type. Batch
total for Phase 5: **43 (B1–B9) + 19 (B10) = 62**, of which the two BLOCKED
rows are carried as "not started" rather than fixed.

## 3. Ordering and dependency rules

1. **Root cause before dependent rows** — a row whose mechanism is the cause of
   another row is fixed first, in the same band order the contract records.
2. **Within a band: root cause → High → Medium → Low**, and inside one severity
   the `ACTIVE.md` §3 order string decides.
3. **A wave contains only rows with disjoint files and no `depends_on` edge
   between them.** A row that touches another wave's file waits for that wave.
4. **Five fixers need owner approval per edit** (`fix-infrastructure`,
   `fix-openclaw-governance-library`, `fix-openclaw-topology`,
   `fix-openclaw-governance-plugin`, `fix-openclaw-setup-templates`). They run
   **one at a time**, never concurrently with each other.
5. **Parallel-safe fixers** (`fix-knowledgebase`, `fix-skill-store`,
   `fix-tools`, `fix-openclaw-discord-adapters`,
   `fix-openclaw-artifact-validation`, `fix-tests`) run concurrently across
   modules, at most three at once, and only with disjoint file sets.
6. **Cross-module rows are last in their wave**: `F-KB-004` (KB + Tools + tests
   + governance library), `F-OC-011` (Tools + governance plugin),
   `F-SKILL-002` (Tools + tests), `F-OC-008` (setup templates + tests).
7. **Packaged-asset rows move their pin in the same commit** (`F-OC-004` →
   `CURRENT_FILE_LOCK_SHA256` in `configure.mjs`; `F-546` already done).

Recorded edges: `F-533` before the rest of B1; `F-402 → F-405 → F-406 → F-504`;
`F-417 → F-418`; `F-576 → F-KB-003`; `F-558 → F-DB-002`;
`F-INFRA-004 → F-DB-001` (soft); `F-INFRA-002 → F-INFRA-003/F-INFRA-004`.

## 4. Phase 5 — fix execution, wave by wave

### W0 — evidence floor (lead + `fix-tests`, 1 batch)

Only two floor rows are still live: `F-481` (OPEN) and `F-492` (PARTIAL).
`F-474`, `F-467`, `F-567` and `F-523` are already closed and out of the
register. `F-492`'s second half needs the owner's re-scope decision (§9), so
this wave ships `F-481` and leaves `F-492` carrying its measurement.

### W1 — the loop-1 roots (B10), 19 batches

Dispatch order inside W1:

| Step | Lane | Rows | Concurrency |
| --- | --- | --- | --- |
| 1 | `fix-infrastructure` | `F-INFRA-002` (root), then `F-INFRA-001`, `F-INFRA-003`, `F-INFRA-004`, `F-DB-001`, `F-DB-002` | serial, approval per edit |
| 2 | `fix-openclaw-governance-library` | `F-OC-004` (root), `F-OC-005` | serial, approval per edit |
| 3 | `fix-openclaw-artifact-validation` | `F-OC-002` (root), `F-OC-003` | parallel with 4–6 |
| 4 | `fix-knowledgebase` | `F-KB-001` (High), `F-KB-002`, then `F-KB-004` after 5/6/7 | parallel, cross-module row last |
| 5 | `fix-skill-store` | `F-SKILL-001` | parallel with 3, 6 |
| 6 | `fix-tools` | `F-SKILL-002`, `F-OC-011` after 7 | parallel |
| 7 | `fix-openclaw-governance-plugin` | `F-OC-007`, `F-OC-009`, `F-OC-010` | serial, approval per edit |
| 8 | `fix-openclaw-topology` | `F-OC-006`, `F-586` | serial, approval per edit |
| 9 | `fix-openclaw-setup-templates` | `F-OC-008` | serial, approval per edit |
| 10 | `fix-openclaw-discord-adapters` | `F-OC-001` | parallel with 3, 5, 6 |
| 11 | `fix-tests` | `F-585`, then the test halves of 4/6/9 | last |

`F-KB-003` waits for `F-576` to ship and stays `CONFIRMED-AS-LATENT` until then.

### W2 — MS2: live runtime + data modules (17 batches)

| Lane | Band | Rows | Batches | Concurrency |
| --- | --- | ---: | ---: | --- |
| OpenClaw approval/queue | B1 | 22 | 7 | one lane, approval per edit |
| Knowledgebase | B5 | 4 | 2 | parallel |
| Skill Store | B6 | 11 | 4 | parallel |
| Gates/evidence | B8 remainder | 15 | 4 | parallel |

B1 order is `F-533` first, then `F-402 → F-405 → F-406 → F-504`, then the
`F-393`/`F-394` chain, then `F-529`/`F-530`/`F-532`, then `F-535`, then
`F-500`/`F-501`/`F-506`/`F-543`.

### W3 — MS3: durability, ceremony, presentation, contracts (22 batches)

| Lane | Band | Rows | Batches | Concurrency |
| --- | --- | ---: | ---: | --- |
| Ledger/queue | B2 | 14 | 5 | serial, approval per edit |
| Operator ceremony | B3 | 13 | 6 | serial, approval per edit |
| Artifact/Excel/preview | B4 | 8 | 6 | parallel with B7 |
| Tool contracts | B7 | 13 | 5 | parallel with B4 |

B2 order starts `F-408 → F-414`, `F-409 → F-416`, then `F-417 → F-418`, then
`F-420`/`F-422`, `F-421`, `F-577..F-579`, `F-581`, `F-401`/`F-403`/`F-404`.
B3 order starts `F-423..F-426`, then `F-489`/`F-490`, `F-542`, the
`F-556..F-561` block, then `F-507`.

### W4 — MS4: remaining evidence and docs (3 batches)

B9 (9 rows) — test-only assertions and doc consistency, `fix-tests` plus the
templates owner for `F-557`/`F-560`/`F-561`.

### W5 — MS5: review (read-only)

Four review agents in parallel — `review-correctness`, `review-security`,
`review-regression`, `review-architecture` — then `review-chair`. No writer runs
while the reviews are open.

### Per-row definition of done (every wave)

1. Premise re-verified at the commit that fixes it.
2. A failing test/probe exists before the fix.
3. Red before → green after, captured in the row's report.
4. Mutation probe: break the new control, confirm red, revert, confirm green.
5. Affected gates run; counts read from output; `NOT RUN` is never a pass.
6. `CHANGELOG.md` entry and `PLAN.md` §4.17/§8 disposition recorded.
7. Only then is the row removed from `findings.md`.

## 5. Phase 6 — gates, then the 20 scanners in recheck mode

**Step 1 — gates (each needs owner approval before it runs).** Record raw
outcomes in `docs/execution/reports/p6/tests.md` as `PASS` / `FAIL` / `NOT RUN`:

- `npm run format:check`, `npm run lint`, `npm run repo:check`
- `npm run verify` (band end)
- `npm test` or the targeted `node --test` suites for the touched files
- `npm run test:knowledge` plus the Python/uv lane
- Docker/PostgreSQL real lanes (`tests/m11-t1-postgres-sql-gate.test.mjs`),
  one row at a time
- WSL/POSIX lane for `F-411`, `F-417`, `F-525` and every fsync/lock row

**Step 2 — recheck.** All 20 scanners launch in one parallel launch, each with
the finding IDs of its slice and its single report under
`docs/execution/reports/p6/`:

| Scanner | Rechecked rows |
| --- | --- |
| `scan-infra-1` | `F-INFRA-001`, `F-INFRA-003`, `F-DB-001` |
| `scan-infra-2` | `F-DB-002`, backup/secret rows, `F-401`/`F-403` |
| `scan-kb-1` | `F-KB-001`, `F-437`/`F-438`, ingestion rows |
| `scan-kb-2` | `F-KB-002`, `F-KB-003`, `F-576`, migrations |
| `scan-kb-3` | `F-KB-004`, `F-512`–`F-518`, citation rows |
| `scan-skill-1` | `F-SKILL-001`, `F-541`, `F-544`, `F-547` |
| `scan-skill-2` | `F-SKILL-002`, `F-427`–`F-436`, scoped retrieval |
| `scan-skill-3` | `F-508`/`F-509`, `F-574`/`F-580`, isolation and backup |
| `scan-tools-1` | `F-446`–`F-455`, `F-536`, `F-549` |
| `scan-tools-2` | `F-459`–`F-462`, `F-510`/`F-511`, resource limits |
| `scan-tools-3` | `F-549`–`F-555`, `F-565`, n8n/OpenClaw boundary |
| `scan-oc-1` | `F-OC-001`, `F-463`, `F-464`, `F-399` |
| `scan-oc-2` | `F-OC-002`, `F-OC-003`, `F-465`/`F-466`, `F-468`/`F-469`, `F-472`/`F-473` |
| `scan-oc-3` | `F-OC-004`, `F-OC-005`, `F-401`–`F-404`, `F-577`–`F-581` |
| `scan-oc-4` | `F-OC-006`, `F-586`, `F-423`–`F-426`, `F-489`/`F-490` |
| `scan-oc-5` | `F-OC-007`, `F-OC-009`, `F-OC-010`, `F-392`–`F-398`, `F-529`–`F-535` |
| `scan-oc-6` | `F-OC-008`, `F-542`, `F-556`–`F-564`, setup and templates |
| `scan-db-1` | `F-DB-001`, schema/migration rows |
| `scan-db-2` | `F-DB-002`, restore/backup rows, `F-431` |
| `scan-db-3` | `F-INFRA-002`, roles, credentials, transaction rows |

A scanner that finds a new mechanism reports it as a candidate; it does not
edit the register.

## 6. Phase 7 — the 12 cross-checkers in recheck mode

All 12 launch in one parallel launch, each with the fixed IDs on its boundary,
writing `docs/execution/reports/p7/<agent>.md`:

`xcheck-kb-skill` (`F-KB-004`, `F-SKILL-001`, `F-544`, `F-547`),
`xcheck-kb-tools` (`F-KB-004`, `F-447`, `F-470`/`F-471`),
`xcheck-skill-tools` (`F-SKILL-002`, `F-549`–`F-553`),
`xcheck-tools-oc` (`F-459`, `F-462`, `F-OC-011`),
`xcheck-oc-gov-topo` (`F-OC-004`–`F-OC-006`, `F-586`, `F-533`),
`xcheck-oc-discord-gov` (`F-OC-001`, `F-529`–`F-531`),
`xcheck-oc-artifact` (`F-OC-002`, `F-OC-003`, `F-463`–`F-473`),
`xcheck-infra-kb` (`F-INFRA-001`–`F-INFRA-003`, `F-DB-001`),
`xcheck-infra-skill-tools` (`F-INFRA-002`, `F-INFRA-004`, `F-DB-002`),
`xcheck-infra-oc` (`F-542`, `F-546`, `F-556`–`F-564`),
`xcheck-db-all` (`F-INFRA-002`, `F-DB-001`, `F-DB-002`, `F-431`),
`xcheck-tests-all` (`F-481`, `F-492`, `F-585`, `F-OC-008`, `F-SKILL-002`).

## 7. Phase 8 — aggregation and closure

- Merge phase 6 and 7 evidence per row against the seven-point definition of
  done. No row closes on a fixer claim or a scanner verdict.
- Re-verify the premise at the final HEAD; if the mechanism is gone for an
  unrelated reason, record that measurement instead of claiming a fix.
- Respect `REFUTED`, `BLOCKED`, `EXCLUDED` and owner-controlled dispositions.
- Keep any row whose gates are `NOT RUN` or whose mutation probe is missing; it
  stays in `findings.md` with its actual status.
- Return actionable, authorized, unresolved rows to Phase 5 with the next loop
  number.

## 8. Phase 9 — cleanup (list first, delete only on approval)

Candidates to list in `docs/execution/cleanup-candidates.md` with path, why it
exists, why it is safe to delete, and risk:

- `docs/execution/reports/.findings-index.json` (scratch index written by this
  plan's measurement, safe to delete);
- per-wave temp fixtures under the scratch probe directories;
- the 26 stale lane worktrees already authorized for removal after recovery
  (`ACTIVE.md` §8.1) — removal stays a separate, approved command;
- superseded scan reports from earlier loops, if the final report supersedes
  them.

Nothing is deleted before the owner approves each path, one command per path.

## 9. RED queue — owner decisions needed before dispatch

**10 live rows inherited from `ACTIVE.md` §8:** `F-406`, `F-529`, `F-530`,
`F-531`, `F-535`, `F-542`, `F-546`, `F-549`, `F-560`, `F-578`.
(`F-512`, `F-523`, `F-570`, `F-571`, `F-573`, `F-575` are already closed.)

**18 loop-1 rows:** `F-INFRA-001`, `F-INFRA-002`, `F-INFRA-003`, `F-INFRA-004`,
`F-KB-002`, `F-KB-004`, `F-SKILL-001`, `F-OC-001`, `F-OC-002`, `F-OC-003`,
`F-OC-004`, `F-OC-006`, `F-OC-008`, `F-OC-009`, `F-OC-010`, `F-OC-011`,
`F-DB-001`, `F-DB-002`.

Non-RED loop-1 rows that can start immediately: `F-KB-001` (High, data loss),
`F-KB-003` (blocked on `F-576`), `F-SKILL-002`, `F-OC-005`, `F-OC-007`.

The three questions that block the most work:

1. **`F-INFRA-002`** — after the `postgres` role is reduced, which owner
   provisions the Knowledge/Skill Store roles? `-Profile knowledge` never runs
   `bootstrap-postgres.sh`; `pg_hba` is not in the repository.
2. **`F-OC-002`** — the expansion budgets (entry count, per-entry size, total
   bytes) must be chosen by the owner; they change a published acceptance
   behaviour.
3. **`F-OC-006`** — origin uniqueness needs a durable-state decision: reducer
   invariant only, or a new uniqueness constraint plus migration.

Also pending: `F-492`'s re-scope (the second half is unobservable in the junit
signal) and `F-572`/`F-576`'s schema change, both already deferred by the owner.

## 10. Dispatch schedule

| Phase | Agents | Concurrency |
| --- | --- | --- |
| 5 / W0 | `fix-tests` ×1 | 1 |
| 5 / W1 | up to 6 lanes; 5 approval-serial fixers + 3 parallel-safe | max 4 concurrent |
| 5 / W2 | 4 lanes (B1, B5, B6, B8) | 4 |
| 5 / W3 | 2 lanes (B2+B3 serial, B4+B7 parallel) | max 3 |
| 5 / W4 | `fix-tests` + templates owner | 2 |
| 5 / W5 | 4 review agents + chair | 4 read-only |
| 6 | 20 scanners, one launch | 20 |
| 7 | 12 cross-checkers, one launch | 12 |
| 8 | lead only | 1 |
| 9 | lead only, owner approval per path | 1 |

If a provider or runtime limit blocks a full launch, the lead reports how many
agents actually started and which ones did not; the roster is never silently
reduced.

## Appendix A — `ACTIVE.md` materialization draft (R5)

> The orchestrator is tool-blocked from writing `PLAN.md`,
> `docs/contracts/execution/ACTIVE.md` and `docs/contracts/**`
> (`Permission denied: edit`, measured 2026-10-27). The **exact** contract text
> to materialize is `docs/execution/active-r5-draft.md`; the condensed skeleton
> below is a map of it, not a second source of truth. Codex copies the draft,
> archives R4 to `archive/2026-10-27-M12-T9-R4.md`, and points `PLAN.md` at R5.

```markdown
# Execution Contract — M12/T9-R5: the full-register remediation band

Task ID: M12/T9 — Remediate all findings (owner order: sửa hết findings)
Plan Revision: M12/T9-R5
Planning Readiness: APPROVED
Execution Authorization: YES
Execution Contract: docs/contracts/execution/ACTIVE.md

Plan: PLAN.md §"Active task — M12/T9-R5"; fix plan: docs/execution/fix-plan.md.
Predecessor: docs/contracts/execution/archive/2026-10-27-M12-T9-R4.md.

## 1. Owner approval record
Owner approved the R5 plan on 2026-10-27 ("phê duyệt materialize active.md,
bám thật sát vào fix plan"), covering: 138 actionable rows (136 fixable,
F-400/F-534 blocked), the W0–W5 wave order, the parallel topology and
approval-serial fixers, and the environment grants of R4 §1 unchanged.

## 2. Scope
### 2.1 In scope
- B1–B9 carried verbatim from R4 §3 (111 actionable rows remaining).
- B10: F-INFRA-001..004, F-KB-001..004, F-SKILL-001..002, F-OC-001..011,
  F-DB-001..002, F-585, F-586, plus F-400/F-534 as blocked.
### 2.2 Out of scope
- The 32 REFUTED rows (retained; deleting them needs a separate decision).
- F-400/F-534 until the OpenClaw host fact arrives.
- F-572 and F-576's CHECK half: own revision, durable schema change.
- Deployment, live Discord, live ledger writes, --apply, live gateway restart,
  Vault writes, dependency/lockfile changes, and any public API/schema/security
  change not listed in §8.
### 2.3 Counts
| Type | Rows | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| F1 | 5 | 1 | 3 | 1 |
| F2 | 21 | 4 | 14 | 3 |
| F3 | 24 | 14 | 8 | 2 |
| F4 | 28 | 6 | 19 | 3 |
| F5 | 25 | 6 | 11 | 8 |
| F6 | 13 | 2 | 7 | 4 |
| F7 | 22 | 2 | 10 | 10 |
| Total | 138 | 35 | 72 | 31 |

## 3. Band membership
B1–B9: unchanged from R4 §3, in the same order.
B10 (27): F-INFRA-001, F-INFRA-002, F-INFRA-003, F-INFRA-004, F-KB-001,
F-KB-002, F-KB-003, F-KB-004, F-SKILL-001, F-SKILL-002, F-OC-001, F-OC-002,
F-OC-003, F-OC-004, F-OC-005, F-OC-006, F-OC-007, F-OC-008, F-OC-009,
F-OC-010, F-OC-011, F-DB-001, F-DB-002, F-585, F-586, F-400, F-534.
Order inside B10: F-INFRA-002 → F-DB-001/F-DB-002 → F-INFRA-001/F-INFRA-003/
F-INFRA-004; F-OC-004 → F-OC-005; F-OC-002 → F-OC-003; F-KB-001 → F-KB-002 →
F-KB-004; F-SKILL-001; F-SKILL-002 → F-OC-011; F-OC-007 → F-OC-009 → F-OC-010;
F-OC-006 → F-586; F-OC-008; F-OC-001; F-585; F-400/F-534 blocked.

## 4. Write ownership and parallel execution
R4 §4.1, §4.2 and §4.2.1 apply verbatim. Addition: `fix-infrastructure` owns
infrastructure/** and the database definitions; it runs one edit at a time with
owner approval, and never concurrently with the other four approval-serial
fixers.

## 5. Per-row protocol
R4 §5 applies verbatim (re-verify, dedupe, red first, smallest fix, gates,
mutation probe, disposition, one commit per row or recorded merge).

## 6. Ordered execution and gates
W0 evidence floor; W1 loop-1 roots; W2 (B1+B5+B6+B8); W3 (B2+B3 serial,
B4+B7 parallel); W4 (B9); W5 review. Gates: R4 §6.2 unchanged, plus the
PostgreSQL real lane for F-INFRA-002 and the WSL lane for F-OC-004.

## 7. Disposition and documentation
R4 §7 applies verbatim.

## 8. RED queue
F-406, F-529, F-530, F-531, F-535, F-542, F-546, F-549, F-560, F-578,
F-INFRA-001, F-INFRA-002, F-INFRA-003, F-INFRA-004, F-KB-002, F-KB-004,
F-SKILL-001, F-OC-001, F-OC-002, F-OC-003, F-OC-004, F-OC-006, F-OC-008,
F-OC-009, F-OC-010, F-OC-011, F-DB-001, F-DB-002.
Each needs a short memo with options and a recommendation before implementation.
```

## Appendix B — loop-1 verdicts now recorded in `findings.md`

| ID | Verdict | Type | Severity | RED | Fixer | depends_on |
| --- | --- | --- | --- | --- | --- | --- |
| F-INFRA-001 | CONFIRMED-AS-LATENT | F2 | Medium | yes | fix-infrastructure | — |
| F-INFRA-002 | CONFIRMED | F2 | High | yes | fix-infrastructure → KB/Skill/Tools | — |
| F-INFRA-003 | CONFIRMED-AS-LATENT | F2 | Medium | yes | fix-infrastructure + fix-tests | F-INFRA-002 |
| F-INFRA-004 | CONFIRMED | F4 | Medium | yes | fix-infrastructure + fix-tests | F-INFRA-002 |
| F-KB-001 | CONFIRMED (UNDERSTATED → High) | F5 | High | no | fix-knowledgebase | — |
| F-KB-002 | CONFIRMED-AS-LATENT | F3 | Medium | yes | fix-knowledgebase | — |
| F-KB-003 | CONFIRMED-AS-LATENT | F5 | Medium | no | fix-knowledgebase | F-576 |
| F-KB-004 | CONFIRMED | F5 | Medium | yes | fix-knowledgebase + fix-tools + fix-tests + fix-openclaw-governance-library | — |
| F-SKILL-001 | CONFIRMED-AS-LATENT | F2 | Medium | yes | fix-skill-store + fix-tests | — |
| F-SKILL-002 | CONFIRMED | F1 | Medium | no | fix-tools + fix-tests | — |
| F-OC-001 | CONFIRMED | F4 | Medium | yes | fix-openclaw-discord-adapters | — |
| F-OC-002 | CONFIRMED | F6 | High | yes | fix-openclaw-artifact-validation | — |
| F-OC-003 | CONFIRMED-AS-LATENT | F2 | Medium | yes | fix-openclaw-artifact-validation | — |
| F-OC-004 | CONFIRMED | F3 | High | yes | fix-openclaw-governance-library | — |
| F-OC-005 | CONFIRMED-AS-LATENT | F5 | Medium | no | fix-openclaw-governance-library | — |
| F-OC-006 | CONFIRMED-AS-LATENT | F3 | Medium | yes | fix-openclaw-topology | — |
| F-OC-007 | CONFIRMED-AS-LATENT | F2 | Medium | no | fix-openclaw-governance-plugin | — |
| F-OC-008 | CONFIRMED-AS-LATENT | F6 | High | yes | fix-openclaw-setup-templates | — |
| F-OC-009 | CONFIRMED-AS-LATENT | F2 | Medium | yes | fix-openclaw-governance-plugin | — |
| F-OC-010 | CONFIRMED | F4 | Low | yes | fix-openclaw-governance-plugin | — |
| F-OC-011 | CONFIRMED | F4 | Low | yes | fix-tools | — |
| F-DB-001 | CONFIRMED-AS-LATENT | F5 | Medium | yes | fix-infrastructure | F-INFRA-004 (soft) |
| F-DB-002 | CONFIRMED-AS-LATENT | F5 | Medium | yes | fix-infrastructure | F-558 |

No loop-1 row was REJECTED, so `findings-rejected.md` is unchanged.

---

**Status:** DRAFT — awaiting owner sign-off. No fixer starts from this file.
