# DRAFT — `docs/contracts/execution/ACTIVE.md` for M12/T9-R5

This file is the exact text to materialize. It lives outside `docs/contracts/`
because the orchestrator role is tool-blocked from writing there
(`Permission denied: edit` on `docs/contracts/**`, measured 2026-10-27).

Materialization steps for Codex (or the owner with the permission changed):

1. Copy `docs/contracts/execution/ACTIVE.md` (R4) to
   `docs/contracts/execution/archive/2026-10-27-M12-T9-R4.md`.
2. Replace `docs/contracts/execution/ACTIVE.md` with the contract body below
   (everything under the horizontal rule).
3. Point `PLAN.md` at R5: heading, `Plan Revision`, `Planning Readiness`,
   `Execution Authorization`, `Execution Contract`, `Task Status`, and add the
   R5 band record described in `docs/execution/fix-plan.md` §Appendix A.
4. Verify: the four validity fields match `PLAN.md`, and the contract's counts
   still equal the register (`138` actionable).

---

# Execution Contract — M12/T9-R5: the full-register remediation band

Task ID: M12/T9 — Remediate all findings (owner order: sửa hết findings)
Plan Revision: M12/T9-R5
Planning Readiness: APPROVED
Execution Authorization: YES
Execution Contract: docs/contracts/execution/ACTIVE.md

Plan: `PLAN.md` §"Active task — M12/T9-R5 (owner order: sửa hết findings;
2026-10-27)" and the Phase 4 fix plan `docs/execution/fix-plan.md`.
The previous band's contract is archived verbatim at
`docs/contracts/execution/archive/2026-10-27-M12-T9-R4.md`.

This contract freezes the implementation details of the fifth band. It is valid
only while `PLAN.md` points at it, its Plan Revision matches, and the two
readiness fields above hold.

## 1. Owner approval record

The owner approved the R5 plan on 2026-10-27 in two steps: the fix plan was
approved, and the orchestrator was explicitly authorized to materialize this
contract ("được, phê duyệt materialize active.md, bám thật sát vào fix plan",
then "b" selecting the materialize option). The approval covers:

- the measured scope of §2: 138 actionable rows (136 fixable) plus the 32
  REFUTED rows retained as history;
- the band set of §2.4 and the wave order W0–W5 of §6;
- the parallel subagent topology, the lead as integration owner, and subagents
  as bounded executors;
- the environment/safety grants of R4 §1 unchanged: Docker/PostgreSQL, WSL
  Ubuntu, Python/uv, fault injection in scratch directories, read-only probes on
  copies of live state, and local commits plus push of the current non-`main`
  task branch after the closeout gate.

The lead does not approve its own work; this section is the approval.

## 2. Scope

### 2.1 In scope

- B1–B9: the rows of the R4 band that are still in `docs/execution/findings.md`
  and still actionable — 111 rows. Membership and order are the archived R4
  contract's §3, unchanged and not renumbered here.
- B10: the loop-1 audit findings and the four rows filed after R4 froze — 27
  rows — listed in §3.2.
- `F-400` and `F-534` are in scope as **blocked**, not as work: they close only
  when the OpenClaw host fact arrives.

### 2.2 Out of scope

- The 32 REFUTED rows: no code; retained as the register's record. Deleting or
  archiving them requires a separate owner decision.
- `F-400`, `F-534` until the host fact is supplied. Do not fabricate a fix.
- `F-572` and `F-576`'s CHECK half: they need a durable schema change
  (`skills.catalog_index` columns; `006_source_path_nfc.sql` plus both digest
  carriers) and take their own Plan Revision with their own regression gate.
  `F-576` stays `PARTIAL`; its shipped half stands.
- `F-523`, `F-474`, `F-467`, `F-567`, `F-512`, `F-570`, `F-571`, `F-573`,
  `F-575`: already closed and absent from the register; they are not re-planned.
- Deployment, live Discord, live ledger writes, `--apply`, live gateway restart,
  Vault writes, secret exposure, dependency/lockfile changes, and any public
  API/schema/security change not listed in §8.
- Any path outside the write ownership in §4.

### 2.3 Counts (measured from the register at `85eb094`)

| Type | Rows | High | Medium | Low |
| --- | ---: | ---: | ---: | ---: |
| F1 — Logic & Functional | 5 | 1 | 3 | 1 |
| F2 — Security & Authorization | 21 | 4 | 14 | 3 |
| F3 — State & Lifecycle | 24 | 14 | 8 | 2 |
| F4 — Integration & Contract | 28 | 6 | 19 | 3 |
| F5 — Data Integrity & Correctness | 25 | 6 | 11 | 8 |
| F6 — Reliability & Performance | 13 | 2 | 7 | 4 |
| F7 — Testing & Verification | 22 | 2 | 10 | 10 |
| **Total** | **138** | **35** | **72** | **31** |

By status: 90 OPEN, 20 LATENT, 13 CONFIRMED-AS-LATENT, 10 CONFIRMED, 3 PARTIAL,
2 BLOCKED. Fixable: 136.

### 2.4 Bands

| Band | Scope | Actionable rows | Fixer batches (≤5 rows) |
| --- | --- | ---: | ---: |
| B1 | Approval, verdict, result and queue integrity | 22 | 7 |
| B2 | Ledger, transaction and apply durability | 14 | 5 |
| B3 | Operator ceremony, rollback, rehearsal and state root | 13 | 6 |
| B4 | Artifact validation, Excel writer and preview/delivery | 8 | 6 |
| B5 | Knowledgebase ingestion, retrieval and citation | 4 | 2 |
| B6 | Skill Store catalog, vector, lock and migration | 11 | 4 |
| B7 | Tool contracts, SQL/Python guards and error taxonomy | 13 | 5 |
| B8 | Gate truth and CI enforcement | 17 | 5 |
| B9 | Test-only assertions and docs consistency | 9 | 3 |
| B10 | Loop-1 audit findings | 27 | 19 |
| **Total** | | **138** | **62** |

## 3. Band membership

### 3.1 B1–B9

Carried verbatim from `docs/contracts/execution/archive/2026-10-27-M12-T9-R4.md`
§3, including each band's order string. A row that has since been re-verified as
REFUTED leaves its band with a written record; it is not silently dropped. The
rows closed since R4 are already absent from the register.

### 3.2 B10 — loop-1 findings (27)

`F-INFRA-001`, `F-INFRA-002`, `F-INFRA-003`, `F-INFRA-004`, `F-KB-001`,
`F-KB-002`, `F-KB-003`, `F-KB-004`, `F-SKILL-001`, `F-SKILL-002`, `F-OC-001`,
`F-OC-002`, `F-OC-003`, `F-OC-004`, `F-OC-005`, `F-OC-006`, `F-OC-007`,
`F-OC-008`, `F-OC-009`, `F-OC-010`, `F-OC-011`, `F-DB-001`, `F-DB-002`,
`F-585`, `F-586`, and the blocked `F-400`, `F-534`.

Order:

1. `F-INFRA-002` (root) → `F-DB-001` / `F-DB-002` → `F-INFRA-001` /
   `F-INFRA-003` / `F-INFRA-004`;
2. `F-OC-004` (root) → `F-OC-005`;
3. `F-OC-002` (root) → `F-OC-003`;
4. `F-KB-001` (High) → `F-KB-002` → `F-KB-004` (after its Tools/plugin/test peers);
5. `F-SKILL-001`;
6. `F-SKILL-002` → `F-OC-011` (after the plugin lane);
7. `F-OC-007` → `F-OC-009` → `F-OC-010`;
8. `F-OC-006` → `F-586`;
9. `F-OC-008` (its test half is owned by `fix-tests`);
10. `F-OC-001`;
11. `F-585`;
12. `F-400`, `F-534` — blocked, not started.

`F-KB-003` depends on `F-576` shipping; until then it stays
`CONFIRMED-AS-LATENT` and is not dispatched.

## 4. Write ownership and parallel execution

### 4.1 Lead (integration owner)

Owns and is the only writer of:

- `PLAN.md`, `docs/contracts/execution/ACTIVE.md`, `docs/execution/findings.md`,
  `docs/execution/fix-plan.md`, `docs/execution/context.md`, `CHANGELOG.md`,
  `README.md`;
- `docs/contracts/**` (including `ci-skip-expectations.json` when the change is
  a contract decision);
- `package.json` and lockfiles (only with an owner decision; no dependency
  change is authorized);
- the integration/closeout commits and the final push.

### 4.2 Subagents (bounded executors)

A subagent may write only its assigned paths and its assigned test files. It
must not edit the governance files in §4.1, must not push, and must not run
`--apply` or any live command. If a fix needs a change outside its write scope,
it stops and reports the exact need to the lead.

| Agent | Write scope |
| --- | --- |
| `fix-openclaw-governance-plugin` | `integrations/openclaw/plugins/zink-governance/**`; Discord adapter files under `integrations/openclaw/lib/`; its plugin/Discord tests |
| `fix-openclaw-governance-library` | `integrations/openclaw/topology/lib/**` except files assigned to topology; queue/ledger/policy tests |
| `fix-openclaw-topology` | `integrations/openclaw/topology/**` except `lib/ledger.mjs` and `lib/queue-manager.mjs` while the library agent owns them; workflow/topology tests |
| `fix-openclaw-artifact-validation` | `integrations/openclaw/lib/artifact-validator.mjs`, `integrations/openclaw/lib/excel-writer.mjs`, and their tests |
| `fix-openclaw-setup-templates` | `integrations/openclaw/setup/**`, `integrations/openclaw/README.md` (with lead review), verification/template tests |
| `fix-openclaw-discord-adapters` | `integrations/openclaw/lib/discord-formatter.mjs`, `integrations/openclaw/lib/discord-native-send.mjs`, and their tests |
| `fix-knowledgebase` | `apps/knowledge/**`; Knowledgebase migrations and tests |
| `fix-skill-store` | `zink-skill-store/**`; its migrations and tests |
| `fix-tools` | `zink-tools/**`; its tests |
| `fix-tests` | `tests/**` except files explicitly owned by a module agent; `scripts/**`; `.github/workflows/**`; gate contracts under `docs/contracts/` only with lead review |
| `fix-infrastructure` | `infrastructure/**`, database definitions and their scripts; asks the owner before each edit |

Shared surfaces (`integrations/openclaw/plugins/zink-governance/index.mjs`,
`integrations/openclaw/topology/lib/workflow.mjs`, `ledger.mjs`,
`queue-manager.mjs`, `integrations/openclaw/configure.mjs`) have one writer at a
time. The lead assigns the writer in the task brief; every other agent is
read-only on that file.

### 4.3 Approval-serial fixers

`fix-infrastructure`, `fix-openclaw-governance-library`,
`fix-openclaw-topology`, `fix-openclaw-governance-plugin` and
`fix-openclaw-setup-templates` ask the owner per edit and run **one at a time**,
never concurrently with each other. The parallel-safe lanes
(`fix-knowledgebase`, `fix-skill-store`, `fix-tools`,
`fix-openclaw-artifact-validation`, `fix-openclaw-discord-adapters`,
`fix-tests`) run concurrently across modules with disjoint file sets, at most
three at once.

### 4.4 Integrity surface (owner decision 2026-10-24, still in force)

These paths are lead-only and no agent brief may change that:

| Path | Why it is serial |
| --- | --- |
| `package.json` (the `npm test` enumeration) | a test the list omits never runs |
| `integrations/openclaw/topology/lib/schema.mjs` (`PINNED_SCHEMA_MANIFEST_CHECKSUM`) | the committed contract-manifest expectation |
| `integrations/openclaw/configure.mjs` (both per-mode predecessor lists) | an admission asserts what the live host carries |
| `tests/m10-t2-r3-asset-predecessor.test.mjs`, `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` | the packaged-entrypoint digests |
| `.github/workflows/ci.yml`, `docs/contracts/**` including `*-digests.json` | they change what blocks a merge |

An agent that touches a packaged asset, a contract JSON or adds a test file
names the file and the new digest in its report and stops. The pin roll ships in
the same commit as the row that moves it; `tests/agent-last-F-369.test.mjs`
compares packaged bytes with `git show HEAD:<path>`.

The real-database lane is a single shared container, so rows needing it run one
at a time.

### 4.5 Commits

Each row is one commit whose message names `F-xxx` (and the legacy id when one
exists). A shared root cause may merge rows only when the lead records the merge
and the commit names every row. Subagents commit only in their own lane; the
lead creates the integration/closeout commits. Nothing is pushed until the
lead's band gate is green.

## 5. Per-row protocol

1. Re-verify the premise at HEAD using the row's `Where` locators. If dead,
   write a refutation record with the measurement; no code.
2. Check for a duplicate or a closed predecessor in `CHANGELOG.md`, `PLAN.md`
   and the register. Merge before fixing.
3. Write the red test or deterministic probe first. If no red can be built, stop
   and report; do not guess.
4. Make the smallest fix that satisfies the acceptance criteria.
5. Run the affected gates; read counts from the output, not from exit status.
6. Mutation probe: break the new control, confirm the test goes red, revert.
7. Report the disposition to the lead. The lead deletes the row only when all
   seven closure conditions hold, and records the history in `CHANGELOG.md` and
   `PLAN.md` §4.17/§8.
8. Commit one row (or the recorded merge).

LATENT rows follow the same protocol with a fault-injection/probe test. If no
deterministic trigger can be built, the row stays LATENT with a written reason;
it is not closed.

## 6. Ordered execution and gates

### 6.1 Waves

| Wave | Content | Rows | Batches |
| --- | --- | ---: | ---: |
| W0 | Evidence floor: `F-481`; `F-492` carries its measurement | 2 | 1 |
| W1 | B10 loop-1 roots | 27 | 19 |
| W2 | B1 + B5 + B6 + B8 | 67 | 17 |
| W3 | B2 + B3 + B4 + B7 | 48 | 22 |
| W4 | B9 | 9 | 3 |
| W5 | `review-correctness`, `review-security`, `review-regression`, `review-architecture`, then `review-chair` | — | 5 read-only |

W0 runs first. W1 starts only after the three blocking RED decisions in §8 are
recorded. W2–W4 follow the milestone order in `PLAN.md` and the per-band order
strings. Row-level detail is `docs/execution/fix-plan.md` §4; this contract fixes
the scope, ownership and gates, not a second copy of the plan.

### 6.2 Gates

- Node: `npm run format:check`, `npm run lint`, the affected `node --test`
  suites, `npm run repo:check`.
- Band end: `npm run verify`.
- Knowledgebase: `npm run test:knowledge` and the Python/uv lane.
- PostgreSQL/Docker: the real-database lane, for B2/B5/B6 and every
  role/transaction row, one row at a time.
- POSIX: the WSL lane for `F-411`, `F-417`, `F-525` and any fsync/lock row.
- A gate row must be proven by making the gate red when the control is removed; a
  green suite alone is not enough.
- A required gate that is unavailable stays `NOT RUN`. It is never converted to
  `PASS`. A pre-existing failure is recorded as baseline, not as a patch
  regression.

Raw outcomes for the Phase 6 run are recorded in
`docs/execution/reports/p6/tests.md`.

## 7. Disposition and documentation

- OPEN / CONFIRMED / CONFIRMED-AS-LATENT: fixed + red-before/green-after +
  mutation probe + gate evidence + independent review → delete the row from
  `findings.md`, record the history in `CHANGELOG.md`, update `PLAN.md`
  §4.17/§8.
- LATENT: same, with the fault-injection/probe evidence.
- REFUTED: keep the row; record the measurement in its Status line.
- BLOCKED: keep the row until the host fact arrives; do not fabricate a fix.
- `README.md` and `docs/` change only when behavior or operator procedure changes;
  no transient history.
- The lead owns all register/PLAN/CHANGELOG edits.

## 8. RED queue

### 8.1 Live rows inherited from R4

`F-406`, `F-529`, `F-530`, `F-531`, `F-535`, `F-542`, `F-546`, `F-549`,
`F-560`, `F-578`. The R4 decisions already recorded for `F-406`, `F-529`,
`F-530`, `F-531`, `F-535`, `F-542`, `F-546` and `F-560` stand and are carried in
the R4 archive §8.1; only `F-549` and `F-578` still need a memo.

### 8.2 Rows added by the loop-1 audit

`F-INFRA-001`, `F-INFRA-002`, `F-INFRA-003`, `F-INFRA-004`, `F-KB-002`,
`F-KB-004`, `F-SKILL-001`, `F-OC-001`, `F-OC-002`, `F-OC-003`, `F-OC-004`,
`F-OC-006`, `F-OC-008`, `F-OC-009`, `F-OC-010`, `F-OC-011`, `F-DB-001`,
`F-DB-002`.

For each, the lead writes a short memo with options, trade-offs, impact on
schema/API/security and a recommendation, records the chosen option here and in
`CHANGELOG.md`, and implements it. If the choice changes a commitment outside
this contract, the lead stops and asks the owner.

### 8.3 Decisions that block whole lanes

1. **`F-INFRA-002`** — after the `postgres` role is reduced, which owner
   provisions the Knowledge and Skill Store roles? `-Profile knowledge` never
   runs `bootstrap-postgres.sh`, and `pg_hba` is not in the repository.
2. **`F-OC-002`** — the ZIP expansion budgets (entry count, per-entry size,
   total bytes). They change a published acceptance behaviour.
3. **`F-OC-006`** — origin uniqueness: reducer invariant only, or a uniqueness
   constraint plus a forward migration.

### 8.4 Recorded R5 decisions

Taken by the owner on 2026-10-27; implemented by the lead and recorded in
`CHANGELOG.md` with the row that lands them.

1. **`F-INFRA-002` — Option A (owner: "1 A").** `bootstrap-postgres.sh` grows
   idempotent per-module role provisioning and `start.ps1` calls it for every
   profile (`knowledge`, `skill`, `all`). The `postgres` superuser stops being
   the application login. Credentials come from `KNOWLEDGE_DB_PASSWORD` and
   `SKILL_DB_PASSWORD`; an unset variable fails the bootstrap closed instead of
   falling back to a default or to `postgres`. Acceptance: a test logs in as
   each module role and proves `rolsuper = false`, that it cannot read the n8n
   schema, and that it cannot cross-write the other module's tables. No new
   service is added to the compose topology.
2. **`F-OC-002` — Option B (owner: "2. B").** ZIP expansion budgets: **5,000
   entries**, **128 MiB per entry**, **512 MiB total uncompressed**. The reader
   enforces the declared sizes *and* the bytes it actually reads, so a forged
   header cannot pass. A rejection names the measurement and the budget
   ("archive exceeds budget: 5,120 entries > 5,000"). The limits are constants in
   `artifact-validator.mjs`, not environment knobs, so the published behaviour
   is fixed; raising them is a new owner decision.
3. **`F-OC-006` — Option A, Option B deferred (owner: "3. như em đề xuất").**
   The reducer enforces origin uniqueness: a second task for an origin already
   bound to a different `task_id` is refused with `DENIED`, while an identical
   replay may return the existing task. **No schema change and no migration in
   R5.** The unique index on origin plus its backfill is a deferred follow-up
   recorded in `PLAN.md`; it needs its own Plan Revision because it changes
   schema semantics, and its own regression gate. No new register row is filed
   for it.

## 9. Closeout

Closeout archives this contract, updates `PLAN.md` and the durable docs, sets
`Execution Authorization: NO` / `Execution Contract: NONE`, deletes the live
contract, leaves a clean tree, creates the local closeout commit, and pushes the
current non-`main` task branch. No deployment, no direct `main` push, no
force-push, no PR/merge/release. `AGENTS.md` §12 terms apply unchanged.
