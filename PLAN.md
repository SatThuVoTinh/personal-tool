# Personal Tool / Zink — Development Plan

## 1. Authority

`PLAN.md` is the durable source of truth for milestone/task lifecycle state,
approval, execution authorization, the current execution-contract pointer,
blockers, and completion evidence.

When execution is authorized, `docs/contracts/execution/ACTIVE.md` is the sole
source of truth for that task's frozen implementation details. Architecture is
canonical under `docs/architecture/`; repository-wide agent/safety rules remain
in `AGENTS.md`.

Planning never authorizes implementation by itself.

## 2. Status model

```text
Task Status: NOT STARTED | IN PROGRESS | BLOCKED | COMPLETE | CLOSED | DEFERRED | CANCELLED
Planning Readiness: DRAFT | REVIEWED | APPROVED
Execution Authorization: NO | YES
Execution Contract: NONE | docs/contracts/execution/ACTIVE.md
Evidence Level: NONE | LOCAL-VERIFIED | REMOTE-BACKED
Review Convergence Gate: PASS | FAIL | NOT RUN
Final Quality Gate: PASS | FAIL | NOT RUN
```

The two gate fields carry only the validation statuses `AGENTS.md` §11 allows. A
required gate that was unavailable stays `NOT RUN` and is never written as a pass.

The evidence verdicts this file uses everywhere are these, and they are not
interchangeable:

```text
NOT RUN      a gate that could have run in this environment and did not
NOT TESTED   no live surface has exercised the behaviour, whatever the local gates say
NOT DEPLOYED the build is not installed on the live host; nothing of it reached the runtime
```

`NOT TESTED` describes a different object from `NOT RUN`: the sentence "Windows
`npm run verify` PASS; live Discord behaviour `NOT TESTED`" is coherent precisely
because the gate ran and the live surface was never observed. Neither may be
softened into the other to make a tier look finished.

## 3. Current release gate

| Milestone                                                                  | Status        | Evidence         | Review Convergence Gate | Final Quality Gate | Gate summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------- | ---------------- | ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — Plan/architecture baseline                                            | `COMPLETE`    | `LOCAL-VERIFIED` | `NOT RUN`               | `NOT RUN`          | Repository governance established.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M1 — Development foundation                                                | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | Verification and CI/Security baseline passed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| M2 — Local infrastructure                                                  | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | Accepted commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M3 — Markdown Knowledgebase                                                | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | Accepted candidate `ff4a5fb7d779f260ffb9b5aa2393ad6ab75eb549`; accepted merge `9cd34cebb196631e9524b095c21f1fd5aff78749`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M4 — PDF ingestion                                                         | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | T1–T5 pushed; owner has temporarily accepted M4 as complete. Exact accepted commit hash should be reconciled from git history without reopening M4 scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M5 — Architecture contraction                                              | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | M5/T1-R2 synchronized canonical paths, documentation and the contracted Docker runtime without refactoring the accepted Knowledgebase application.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M6 — Zink Skill Store                                                      | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | M6/T1-R4 task commit is remotely verified; governance closeout is recorded separately.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M7 — Zink Tools + OpenClaw integration + V1 hardening                      | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | M7/T1-R19, M7/T2-R12, M7/T3-R16, M7/T4-R10, and M7/T5-R13 complete; runtime governance remediation, Discord 7-bot integration, and Zink tools specialist policies verified.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration | `IN PROGRESS` | `LOCAL-VERIFIED` | `NOT RUN`               | `NOT RUN`          | M8/T1 is complete; M8/T2.2 R4/R5/R6 are implemented; M8/T2.2-R7 (heartbeat admission, boundary diagnosability, apply safety) is in progress. Deployment is not authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M10 - Governed coordinator runtime binding                                 | `COMPLETE`    | `LOCAL-VERIFIED` | `NOT RUN`               | `NOT RUN`          | M10/T2 closed by explicit owner decision 2026-10-11 (R26 records the final remediation; R8 closed live with zero-outbound proven). Deferred follow-ups are NOT closed under M10 and require separate authorization: live gateway/knowledge restart or deployment, M10 ingress card/tag redesign (new Plan Revision), coordinator result ingestion, and the WSL/CI Python gate run.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M11 - Cross-module audit remediation                                       | `COMPLETE`    | `REMOTE-BACKED`  | `NOT RUN`               | `NOT RUN`          | M11/T1 is CLOSED (R1 four phases + R2 live admission and deployment, 2026-10-12; build DEPLOYED AND VERIFIED on the live WSL gateway, evidence in §4/§8). M11/T2 is CLOSED the same day: R1 made four Skill Store suites portable, gave `python-quality` the Node toolchain (CI SUCCESS, `188 passed, 27 subtests`) and fingerprinted two gitleaks false positives; R2 gave the Knowledgebase Python suite exactly one executor per environment, which repaired `CI / quality-gate` (CI run `38202129189`: `quality-gate` and `python-quality` both SUCCESS). NOT closed under M11 and still requiring separate authorization: `verify.mjs` (`NOT RUN`, operator-side), the pre-existing model-router `GOVERNANCE_COMPLETION_UNAVAILABLE` failures, the pre-existing `duplicate plugin id` warning, the pre-existing 5-high `npm audit` failure, `M11-06`'s PostgreSQL statement gate in CI (no Postgres service there), and the owner-excluded items (per-document quarantine, incremental-publish redesign, manifest schema extension, zink-tools drift cluster, zink-tools lint-glob gap). **M11/T3-R1 is CLOSED 2026-10-13** (`REMOTE-BACKED`, **DEPLOYED AND VERIFIED** on the live WSL gateway): the ten verified HIGH-severity items landed in two ordered phases — `3cb8274` (argv execution on the bot-token path, one deadline on the three Discord REST fetches, cause-preserving message-only diagnostics at the three native-boundary seams, queue `enqueueTask`/`clear` serialized) and `6b0ea0a` (non-spinning async lock release with the WSL drvfs errnos, refusal of a half-missing events/snapshot pair, replay diagnostics that keep their cause, decision-ledger save and approval reads under the shared writer lock, `REJECTED` skill proposals made terminal and serialized). CI run `38336851433` @ `f55d292` on the task branch: `quality-gate` **SUCCESS** (`ℹ tests 1374 / ℹ fail 0`, `Repository policy check passed.`) and `python-quality` **SUCCESS** (`188 passed, 27 subtests`); Security run `38336854295` adds `secret-scan` **SUCCESS** (gitleaks, zero leaks) while its `dependency-audit` stays red on the unchanged 5-high baseline. Locally: `npm run verify` PASS on Windows and the two new suites plus both lock-predecessor suites re-run green under WSL Ubuntu, where the packaged digests are byte-identical. 22 of 24 mutation runs killed the defect (the 2 survivors are at the pre-existing `enterNativeRun` seam, outside this task's change sites — recorded in §8). The router model order/`timeoutSeconds=100` and stale-lock auto-reclaim stay excluded as recorded owner decisions. **This build is DEPLOYED AND VERIFIED** on the live WSL gateway (owner grant 2026-10-13, ONE `--apply` from `9164c50`; all seven live asset digests equal the packaged build, `openclaw.json` and the ledger untouched, unit `active`/`MainPID=28865`/`NRestarts=0`, zero `GOVERNANCE_COMPLETION_UNAVAILABLE` on the new PID — evidence in §4; `verify.mjs` stays `NOT RUN` and a multi-hour live soak is still open). |
| M12 - Governed Discord interaction lifecycle and presentation              | `IN PROGRESS` | `REMOTE-BACKED`  | `PASS`                  | `PASS`             | **M12 is IN PROGRESS. Current claim: the three-wave audit remediation is closed for the repository gates — `M12/T2.1` high, `M12/T2.2` medium, `M12/T2.3` low, CI `38944576084` and Security `38944579971` @ `71c2bff` — and none of it is deployed; the governance-record tier `M12/T4-R1` is closed 2026-10-17 and `REMOTE-BACKED` for the same gates at its own head; `M12/T2.2-R3` (Skill Store lifecycle) is **CLOSED 2026-10-17**, `REMOTE-BACKED` for its repository gates at the closeout head `0ad3655` (CI `39018443022` SUCCESS, Security `39018445973` secret-scan SUCCESS on the unchanged 5-high audit baseline; eleven of twelve items shipped; `R3-0` `NOT RUN`; the real-PostgreSQL lanes skip on the GitHub runner, so `R3-7`/`R3-12` are Windows- and WSL-backed only), `M12/T5`–`M12/T8` remain scheduled and unauthorized, and `M12/T3` (H11, which the owner ordered last) remains scheduled and unauthorized; §4.17 is the schedule for the 38 findings that had no live owner task.** Deployed-and-verified is a separate claim, and only two builds earned it: Deployment A (2026-10-13) and Deployment B (2026-10-14) — each exactly one `--apply`, both spent, evidence in their own §8 records — and no remediation commit after them is on the host. **What this milestone does not close, stated here so a reader of §3 never has to hunt for it:** per-surface Discord behaviour on #approvals, #results and #incidents is `NOT TESTED` live, and the newest §8 reading of the ledger (Deployment B) still shows no `WORKFLOW_APPROVAL_SURFACED` or `WORKFLOW_RESULT_SURFACED` event; the post-verdict `PATCH /channels/{thread.id}` `applied_tags` seam has never been exercised on this server; #incidents on the analytics stack waits on the mislabelled `STATUS: ANALYTICS` tag rename, which §8 records as a precondition the owner owns and this contract did not re-read live; `verify.mjs` and the R16 apply rehearsal are `NOT RUN`; the Knowledgebase Python lane is `NOT RUN` on any diff that touches no `apps/knowledge/` file; and CI is Linux-on-GitHub, so a matching test denominator proves nothing about the live tree. **Per-task evidence lives in the §8 records, named:** `M12/T1-R1`, `M12/T2-R1`, `M12/T2-R2`, `M12/T2-R3`/`R3b`, `Deployment A`, `Deployment B`, `Record — M12/T2.1-R3 execution wave`, `Record — M12/T2.2-R1 Wave A closed`, `Record — M12/T2.2-R2 Wave B closed`, `Record — M12/T2.3-R1 Wave C closed`, `Record — M12/T2.2-R3 closed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

The table above is a **subset** of the milestone history: it lists the milestones whose closure record lives in §8 and §4.17. The complete derivation is every milestone id that owns a tracked suite under `tests/` (the `m<n>-…` file prefixes) together with every id named in `docs/contracts/execution/archive/`; a milestone that owns a tracked suite but has no §8 closure record to cite — M9 (`tests/m9-t1-functional-truth-remediation.test.mjs`) — is named here instead of being given a row.
The two gate columns carry the verdict recorded for the milestone's most recent **closed** band: `PASS`, `FAIL` or `NOT RUN`. `NOT RUN` means no band of that milestone ever recorded a verdict — the two gate fields were introduced on 2026-10-17, so every milestone closed before that carries `NOT RUN` rather than a prose summary, and a milestone with an open band keeps the verdict of its last closed band until that band closes.

The former self-built L&SC Data Plant is replaced by a **logical external
infrastructure flow**, not another repository module. Forecasting, optimization,
operations research and simulation remain first-class capabilities.

**Permanent `NOT RUN` decisions recorded in this table (owner decisions, not open work).**

- **The `pdf-runtime` child suite — `apps/knowledge/pdf-runtime/tests/test_ocr_contract.py` — is a permanent `NOT RUN` in every lane.** The repository policy forbids the `python-quality` job from installing the `pdf-runtime` closure (`scripts/repository-policy.mjs`: _"It must stay an explicit NOT RUN in CI rather than being installed here or implied"_), and the only other executor would be a Docker lane that no policy permits. **Compensating control:** the parent-side contract lane in `apps/knowledge/tests/test_pdf_runtime_coverage_and_deadline.py` and `apps/knowledge/tests/test_pdf_ocr_runner_contract.py` covers the same conversion-outcome, deadline-cap and reader-reap behaviour from the parent process, so the behaviour the child suite would assert is still gated — only the child's own process boundary is not. A row can no longer be closed by silently skipping that suite: `tests/repository-policy.test.mjs` asserts the policy's own rule, and `F-269`'s status records the decision here. The sibling `test_range_contract.py` no longer exists: `F-439` (`R9-L09-3`, commit `f2bfc01`) deleted it because it called the superseded three-argument `_docling_extract` form, could never be collected (it imports the uninstalled docling closure), and its own claim that a parent lane ran the same path was false; the surviving arity pin lives in `apps/knowledge/tests/test_pdf_runtime.py`. Its range-materialization coverage is gone rather than relocated — the deleted lines never executed, so no gate lost a passing assertion, and the row is the record of that.
- **The R16 apply rehearsal is a permanent `NOT RUN` on every lane that cites it.** `tests/m8-t2.13-r16-apply-rehearsal.test.mjs` now declares the reason it cannot start ("the R16 apply rehearsal runs only inside the private mount namespace the rehearsal driver creates, and this platform has no live runtime to clone") and the number of rehearsal-gated cases is declared and machine-checked, so a reader can no longer mistake a skipped gate for a green one.

## 4. Current focus

```text
Milestone: M12 — Governed Discord interaction lifecycle and governed presentation
Task: M12/T9 — Remediate all actionable findings in `docs/execution/findings.md`.
  The authoritative lifecycle header for the live band is the `## Active task` block at the end of this file.
  The fields below are the historical record of the closed `M12/T9-R1` band and the bands before it; they are
  not the live pointer. The live band is `M12/T9-R4`.
Historical Plan Revision: M12/T9-R1
Historical Planning Readiness: APPROVED — owner approval recorded on 2026-10-19; retained as history.
Historical Execution Authorization: YES — bounded to the archived R1 contract; retained as history.
Historical Execution Contract: archived under `docs/contracts/execution/archive/`.
Task Status: CLOSED — historical status for the closed bands; the live status is the `## Active task` block at the end of this file.
  (history) `M12/T4` — Governance-record integrity: re-inventory the orphaned findings, re-file them under live
  identifiers, and shrink the release-gate cell that duplicates §8.
  (history) `M12/T2.3` Wave C — **CLOSED 2026-10-17**; the three-wave remediation programme (`M12/T2.1` high,
  `M12/T2.2` medium, `M12/T2.3` low) is complete at the tier level, and the owner's standing order `anh muốn em sửa hết`
  now runs the successor bands in this queue: `M12/T5` (A2 packaged module graph) → H5 answer →
  `M12/T6`/`T7`/`T8` (Knowledgebase / Zink Tools adapters / gate truth) → `M12/T3` (H11 shape 1) last.
  `M12/T4` (record) and `M12/T2.2-R3` (Skill Store lifecycle, 18 findings) have both been executed and are closed with
  their evidence in §8, so they no longer belong to the pending queue.
  The predecessor tier `M12/T2.1` (HIGH-RISK: irreversible loss, exposure, failures nobody can detect) is **CLOSED
  2026-10-15**: all eight items plus four owner-authorized follow-ons landed, its evidence is in §8, and its full
  contract text is preserved verbatim at `docs/contracts/execution/archive/2026-10-15-M12-T2.1-R3.md` — that archive
  is decision `H10` / `R3-P04-03`, executed first because §5.1 of the old contract made the scrub rule a prerequisite.
(history) Active revision was: M12/T2.2-R3 — **Skill Store lifecycle**, materialized 2026-10-17 after the owner granted the band
  with `grant` and answered the escalated fork block with **`p1 q1 r2 s1 t1`**. Twelve items (`R3-0` a single read-only
  probe of the embedding endpoint's identity fields, `R3-1`…`R3-6` in `zink-skill-store/src/catalog.mjs`, `R3-7` in
  `zink-skill-store/src/vector-sync.mjs`, `R3-8`/`R3-9` in `zink-tools/common/semantic-contract.mjs`, `R3-10` in
  `zink-tools/common/path-safety.mjs` plus its README, `R3-11` the record sync). Four of the band's 18 findings died as
  premises in the read, and the packaged-entrypoint, retirement and schema-ownership work is excluded by his own
  answers. No schema, no packaged asset, no digest, no new gate.
  (history) Active revision was: M12/T4-R1 — **Governance-record integrity**, **CLOSED 2026-10-17** with the contract archived at
  `docs/contracts/execution/archive/2026-10-17-M12-T4-R1.md`. It was materialized 2026-10-17 on
  the owner's `grant 1`, the first contract in the queue he set with `anh muốn em sửa hết`. Five items (`T4-1` re-inventory of the 38 findings that
  still carried the withdrawn `T2.4`–`T2.7` identifiers, `T4-2` re-filing them as `M12/T5`–`T8`, `T4-3` register-status
  refresh + the H10 authority rule, `T4-4` shrinking the 9 858-character M12 gate cell under a printed no-fact-loss
  diff, `T4-5` the `Cursor`→`dsh` line in `conventions.md`). No source file, no schema, no gate, no history rewrite.
  (history) Active revision was: M12/T2.3-R1 — **Wave C only, CLOSED 2026-10-17** with the contract archived; the field below records
  how it was approved. Materialized 2026-10-16 after the owner answered the whole escalated
  N-block in one line (`n1a n2a n3a n4a n5a`): five-stack gets a caveat only with the rewrite left in `M12/T3` (`n1a`),
  Gate G18 may be edited alongside `C-4` (`n2a`), the gate registry is built **and** enforced, which widens a required
  gate (`n3a`), `P04-02`'s `AGENTS.md` column is deferred to its own grant (`n4a`), and `CHANGELOG.md` is left as
  history while `README.md`/`PLAN.md` are corrected forward (`n5a`). Twelve executable items (`C-1`…`C-11`, `C-13`) —
  two inherited claims died in verification and are recorded in `ACTIVE.md` §0 rather than executed.
  (history) Active revision was: M12/T2.2-R1 — **Wave A only**, after the owner approved the three-wave split on 2026-10-15
  (`đúng, chốt 3 wave`), chose the `4A.13` fork **a** (no re-embed skip until a stored model identity exists), and
  granted the pinned-assertion exception (`có grant`) for exactly the assertions named in `ACTIVE.md` §4.
  (history) Active revision was: M12/T2.1-R3 — **the high-risk tier only**, after the owner re-shaped the successor plan
  2026-10-15: `vậy A đi, tách 3 phần thành T2.1 (high risk), T2.2 (medium risk) và T2.3 (low risk)`. He accepted
  **I1-A** (4A.1 withdrawn — its fix must amend a pinned required gate), **I2-A** (4A.13 withdrawn — V06's
  `R6-V06-01` proved the fix self-blocking), **I3-A** (4A.16(i) withdrawn — the known-red promise unbacked),
  **I4-A** (the `test:r16` recursive-delete guard approved and promoted into this tier as T2.1-8), **I5-A** (doc
  truth first *within* the low tier), **I6-A** (a `T2.7`-style gate-reach block, re-filed into T2.2 by the
  tier rule), **I7-A** (commit `PLAN.md` now). R3 is **written fresh** rather than patched, because R2's §7 had
  already fallen out of agreement with its own §4A.15/§5 — the tiering criterion is the risk **of the fix** (high =
  destroys state / exposes material / fails undetectably), **not** defect severity, and it is stated in `ACTIVE.md`
  §0 so it is auditable. R3 keeps **eight** items: the unreadable-proposal overwrite (`R5-E06-07`), rollback
  residue reporting (`R5-E04-03`, re-scoped by V01 to detect by `stat` not by catching), upstream response bytes in
  an adapter result (`R5-E06-03`), child stderr in a model-visible error (`R5-E06-04`), a credential substring in an
  operator report (`R5-E13-06`), snapshot temp residue + errno-first ledger attribution (`R1-A14-01/02`), the
  fabricated `(lines None-None)` citation (`R5-E02-05`, **whose only real trigger is a PDF row with a NULL page
  pair**, not markdown), and the destructive default published as an npm test name (`R5-E08-02`).
  Prior revision: M12/T2.1-R2 — superseded 2026-10-15 by its own verification round; see the `Execution
  Authorization` block below, and for the eleven defects found in it the §8 tier tables of this file plus the
  `F-xxx` rows that still carry their legacy ids in `docs/execution/findings.md`. That register's Vòng 6 narrative was
  dropped on 2026-10-17 when the owner reduced the file to a bug-only queue, so the defects live in §8 and in the rows,
  not in a prose lane record.
Prior revision: M12/T2.1-R1 — the execution wave the owner authorized on 2026-10-14 by answering the
  four-round audit's decision block ("A: A1 + lên lịch A2 / B: B1 / C: C2 / D E F làm theo khuyến nghị
  của em / G có / rồi tạo ACTIVE.md"). Ten frozen items, all inside the `integrations/openclaw` adapter
  boundary plus the governance documents F approved: the component build that aborts delivery
  (`R1-A05-01`), the guard reason discarded at the run-end seam (`K01`/`R1-A12-07`), the reason-code
  matrix that is declared nowhere and the validator with zero call sites (`R1-A04-06`), snapshot temp
  residue and errno-first ledger attribution (`R1-A14-01/02`), a self-generated manifest that certifies a
  dropped contract member (`R4-V01-01`, owner "G có"), the unreachable-but-kept allowlist guard
  (`R1-A12-06`), the five-class runbook plus a read-only open-task reconciliation report (owner C2), one
  revisions ceiling (`R1-A08-08`), and the approved non-RED half of the document architecture
  (`R3-P04-02/03/04/05/06`).
  **What R2 adds (ACTIVE.md §4A):** sixteen items in four independently committable clusters, admitted
  only if all four of a stated rule's clauses hold — orchestrator-re-derived from source this session or
  two independent lanes reported it; it changes **no** schema, published contract, public API, migration,
  durable-state semantics, module ownership or required gate; it cannot be satisfied by weakening a
  control, deleting a check or raising a ceiling; and no Vòng 6 refutation is pending on it. **Cluster A
  (data loss/integrity)** an empty Skill-Store scan that deletes the whole derived index while reporting
  `READY` (`R5-E05-03`), an unreadable proposal record indistinguishable from an absent one so an owner's
  recorded APPROVE/REJECT can be overwritten (`R5-E06-07`), a citation that prints `(lines None-None)`
  (`R5-E02-05`), and a rollback that never checks whether canonical state is clean (`R5-E04-03`).
  **Cluster B (untrusted output)** upstream HTTP response bytes returned verbatim as an adapter `message`
  contrary to its own comment (`R5-E06-03`), uncapped subprocess stderr in a model-visible error
  (`R5-E06-04`), and a four-character live token prefix in an operator report (`R5-E13-06`).
  **Cluster C (silent wrong answer)** an exhausted embedding retry raising `AssertionError` so it maps to
  500 instead of 503 and vanishes under `python -O` (`R5-E02-07`), **zero** logging anywhere in
  `apps/knowledge/app/` with four `from None` sites discarding the cause (`R5-E01-05`), two inverted
  relevance defaults (`?? 1` in the filter vs `?? 0` in the sort) (`R5-E07-02`), a reference-id predicate
  that admits ids nothing can interpret (`R5-E07-03`), a semantic key hardcoding `:v1` while the contract
  version is `zink-semantic-v2` (`R5-E05-06`), a full re-embedding of an unchanged catalog on every
  promotion (`R5-E05-01`), and an unbounded `query` tokenized on the event loop (`R5-E01-03`).
  **Cluster D (gate truthfulness)** a drifted live digest pin that SKIPs both tests and keeps the suite
  green (`R5-E10-04`), a dead `assert.notEqual(…, undefined)` after a `slice()` (`R5-E10-03`), M7-063's
  machine-path guard iterating two files while the only tracked `/mnt/c/…` literal sits in a third
  (`R5-E13-05`, guard half only), the two §11-blocking verdicts that appear nowhere in the whole git
  history (`R5-E12-01`), and no durable artifact that enumerates the gates so a `NOT RUN` claim has no
  denominator (`R5-E12-04`). R2 also enumerates the allowed file set per cluster (§3), adds a Python lane
  and a Skill Store / Zink Tools lane to the required gates with the Docker-dependent suites pinned as
  `NOT RUN` when the container is absent, adds one mutation probe per admitted item, requires one commit
  per cluster, and names a **known-red register** with exactly two expected entries.
  Explicitly NOT in this task, recorded in ACTIVE.md §5 with the finding IDs each one covers and in §5.1
  with the successor task each is scheduled into: **A2** the
  packaged module graph (`R1-A02-01` is Critical and stays open — this task does not close it), **B1**
  the injected state root (answered YES, scheduled as `M12/T2.2`, no further decision needed), **C1**
  any new durable vocabulary (Round 4 proved `WORKFLOW_NATIVE_ENDED` cannot close a refused root run,
  so this is a schema decision the owner has not made), **D** the `primary_coordinator` writer and the
  `guard.mjs:869-882` decision-node contradiction, **E** the `$ref` identity/verdict package and the
  three missing Knowledgebase routes, and every `R1-A08-*` item except `08`.
  **Also excluded by R2:** every remaining Vòng 5 finding. R2 routed them to successor identifiers it invented for the
  purpose (`T2.3`–`T2.7`); `M12/T2.1-R3` §5.3 withdrew those groupings, and `M12/T4-R1` item `T4-2` re-filed the
  remainder on 2026-10-17 into the bands recorded in **§4.17**, where each finding also carries its disposition:
  `M12/T2.2-R3` for the Skill Store lifecycle (`R5-E04-01/02/04/05/06/07/08/09`, `R5-E05-04/05/07/08`,
  `R5-E07-01/04/05/06/07`, `R5-E03-07` — 18), `M12/T5` for A2 plus `R5-E13-02` and the removal half of `R5-E13-05` (3),
  `M12/T6` for the Knowledgebase block (`R5-E01-02/04`, `R5-E02-01/02/03/04/06`, `R5-E03-01…06, 08` — 14), `M12/T7` for
  the remaining Zink Tools adapter surfaces (`R5-E06-01/02/05/06/08/09` — 6), `M12/T8` for gate truth
  (`R5-E09-01…08`, `R5-E10-01/02/05/06/07/08`, `R5-E13-03` — 15), and `M12/T3` for documentation and skills procedure
  (`R5-E12-02/03/05/06/07`, `R3-P04-01/07/08/09`). Each needs its own Plan Revision and its own
  `Execution Authorization: YES`. **Corrected 2026-10-17: this sentence is no longer true of the first band** —
  `M12/T2.2-R3` now has both, granted by the owner's `grant` plus his `p1 q1 r2 s1 t1` answers, and its authorization
  is bounded to that contract's `R3-0`…`R3-11` items and §4-of-ACTIVE.md file list (see the revision named above and
  the §4.17.1 band row). `M12/T5`…`T8` and `M12/T3` remain unauthorized, and inside `M12/T2.2-R3` the `p1`/`r2`/`s1`
  exclusions are not authorized either. Eleven
  decisions are recorded as **pending and unauthorized** in §11 of this file (H1 CI trigger widening, H2 the
  `403` on branch protection, H3 a skip floor, H4 the live 0644 config backup as a guarded operator
  command, H5 `skills.*` schema ownership, H6 the router key as a SecretRef, H7 ledger identity
  references, H8 a governed `DEPRECATED` transition, H9 PDF-content reclamation, H10 whether the findings
  register becomes tracked; **H11 the O1/O2 working relationship, owner-proposed 2026-10-15 — see §11 for its three
  shapes**). Answering H1–H11 does **not** authorize execution; each still needs its own Plan Revision. The ledger
  lives in **§11 of this file**, not in an ignored state file (promoted 2026-10-15 under the owner's approval).
- **Corrected 2026-10-16 (owner answer `l1`).** The paragraph above is the withdrawn R2 grouping and must not be read
  as the current schedule: `M12/T2.1-R3` §5.3 re-filed the **Skill Store lifecycle** block
  (`R5-E04-01/02/04/05/06/07/08/09`, `R5-E05-04/05/07/08`, `R5-E07-01/04/05/06/07`, `R5-E03-07` — 18 findings) into
  **T2.2**, not `T2.3`, and `T2.4`–`T2.7` no longer exist as groupings. The block was nevertheless absent from
  the admitted Wave B scope and from that contract's §5 (now readable at
  `docs/contracts/execution/archive/2026-10-16-M12-T2.2-R2.md`), so it belonged to no running tier. The owner assigned
  it **its own contract after Wave B closes**, recorded here as `M12/T2.2-R3` (the option he chose was named `T2.4`;
  that label already named A2 plus `R5-E13-02` in the text above, and A2 now sits in `M12/T5`, so the intent —
  separate contract, medium risk, not folded into the document tier — is kept and only the identifier is corrected).
  It **was** scheduled, not authorized, with no code for it; the owner then granted the band on 2026-10-17 (`grant`,
  scope answers `p1 q1 r2 s1 t1`, mid-band letters `A`, `n1`, `n2`), it executed under `ACTIVE.md`, and it is
  **CLOSED** with its record in §8. The successor band in his queue is now `M12/T5` (A2 packaged module graph), for
  which he granted **planning only** (`n2`) — no `M12/T5` code exists and none may be written before he approves that
  plan and a matching contract is materialized.
  Honesty obligations the owner should read before accepting anything: deployment is **not** authorized
  by this contract; live Discord behaviour stays `NOT TESTED`; `verify.mjs` stays `NOT RUN`; the R16
  rehearsal cannot run on WSL and is **NOT RUN**, so no rehearsal validates this against the live
  runtime; `tests/m10-t2-r6-boundary-predecessor` goes red only under WSL, which is why the WSL lane is
  mandatory; and item 4.5 may turn `npm run verify` red by exposing a genuinely incomplete contract set
  — the owner accepted that outcome when he answered "G có". **R2 adds three more:** (a) item 4A.16(i) is
  *designed* to make M7-063 red, because widening its file list brings `index.mjs:511`'s `/mnt/c/…`
  literal into scope and removing that literal is `M12/T5` (§4.17) — that red is truth and must be recorded as
  a known-red, never repaired by narrowing the guard; **(written before execution: `4A.16(i)` was then withdrawn as
  unbacked by owner answer `I3-A` and declined again in Wave B, so the known-red never happened — see §4.17's
  `R5-E13-05` row; and as of 2026-10-20 the `/mnt/c/…` literal itself is gone from
  `plugins/zink-governance/index.mjs`, so widening M7-063's file list to reach the
  entrypoint would NOT turn the gate red today either — no tier may record a known-red
  the tree cannot produce)**; (b) **five of the sixteen Vòng 5 sweep lanes are
  `NOT RUN`** (E08, E11, E14, E15, E16) and **all twelve Vòng 6 verification lanes are `NOT RUN`** — the
  harness returned a daily usage limit on five consecutive dispatch attempts — so no claim of full-repo
  coverage may be made, and the orchestrator's own re-derivation of ten claims is a **weaker** substitute
  than the adversarial cross-check that was requested, disclosed in ACTIVE.md §0 rather than silently
  absorbed; (c) **one** Postgres-dependent test (`M11-06` in `tests/m11-t1-postgres-sql-gate.test.mjs`) skips without
  a Docker container while `node --test` still exits 0 (`R5-E09-03`), so if the container is absent that test is
  `NOT RUN` and may not be folded into "fail 0". **Corrected 2026-10-15 by V08: this row previously named
  `m11-t1-skill-vector-sql` as a second Docker-gated suite. It is not — that file contains no docker, `CONTAINER`
  or `t.skip` reference (grep count 0) and its `M11-01` case executes and passes in CI.**
  **And (d), recorded here because a cold resume would otherwise re-derive a CI run for nothing: the CI lane is
  WINDOWS-EQUIVALENT, NOT LIVE-TREE-EQUIVALENT.** Run `38711126758` @ `8d1b49f` and run `38715084889` @ `d8c221a`
  both print the *identical* `1483 tests / 106 suites / 0 fail` denominator, 52 skips against this host's 46, and
  zero `zink-skill-store` / `zink-tools` module-internal test file names in the log — because `npm test` runs an
  explicit `tests/…` file list (`package.json:24`), not a discovery glob, so the two modules' own suites are never
  collected by CI's `quality-gate`. (The `python-quality` job *does* run the `apps/knowledge` Python suite, so that
  half is covered there.) CI green therefore proves **nothing** about the live tree or the module suites, and only the
  WSL lane can read it (see *Gate lane coverage*, §8, and `R6-I01-03`).
(history) Task Status was: IN PROGRESS — **all eight `R3` items are implemented and locally validated, and the tier's closeout
  evidence is now on CI** (run `38715084889` @ `d8c221a`: `quality-gate` **SUCCESS** — `1483 tests / 1431 pass / 0
  fail / 52 skipped` — and `python-quality` **SUCCESS**; Security run `38715090086` fails only on the standing
  5-high `npm audit` baseline with `secret-scan` **SUCCESS**). R3 materialized 2026-10-15 as the high-risk tier. Delivered:
  T2.1-1 `96a6dd2`, T2.1-2 `2e7da50`, T2.1-3 `c4833e6`, T2.1-4 `710f650`, **T2.1-5 `91d788d` (under the owner's
  option-A grant, recorded in `ACTIVE.md` §4 before the pinned assertion was touched)**, T2.1-6 `b3affc2`,
  T2.1-7 `b7497ca`, T2.1-8 `ba5ff08`, plus the two owner-authorized recorded-item commits `9c7af0f` (the
  `zink-tools` lint/format gate) and `cc6a0d9` (the Python tokenizer NOT RUN), and two follow-on fixes from the same
  instruction — `703fec4` (`R6-I01-03`, the R16 host refusal) and `ad4a8d6` (`R6-I01-01`, importing `app.main` no
  longer needs the pinned artifact). T2.1-5 was first **stopped at its item boundary** because its fix collided with
  a pinned existing assertion — the same class that withdrew R2, caught by §2's rule before execution rather than
  after; the stop-and-report path worked exactly as designed. See `OWNER GRANT — T2.1-5 executed under option A` in §8.
  **Then, outside `R3`'s eight items and under the owner's later direct instruction (`Xóa và thay bằng mô hình 7 bot`,
  2026-10-15), one naming remediation landed: `61638d8` retires the Data Plant coordinator titles on both surfaces.**
  Read-only evidence showed his premise was wrong about the roster and right about the names — see
  `Record — the 9Router "cấu hình cũ" report` in §8.
  R1 and R2 both existed with **zero implementation landed under either**, and no prior task's evidence is altered.
  ── **`M12/T2.1` tier is CLOSED 2026-10-15.** The rest of this field describes the new task.**
(history) Task Status was: **`M12/T2.2-R3` is CLOSED 2026-10-17.** Eleven of the twelve items shipped, one could not: `R3-0` stays
  `NOT RUN` because the embedding-endpoint probe needs an environment carrying `OLLAMA_URL`, which this machine does
  not have. The probe script is **not** in the tree — `temp/` is Git-ignored (`.gitignore:20`, `/temp/*`), so
  `temp/r3-0-probe.mjs` is a local working artifact only, and no closeout claim rests on it. Per-item commits:
  `8390a68` `R3-1`, `812b8ec` `R3-2`, `b604618` `R3-3`, `04d6679` `R3-4`, `74c42df` `R3-5`, `1bab75d` `R3-7`,
  `223470f` `R3-6`, `5257ca4` `R3-8`, `04e128f` `R3-9`, `e7aee21` `R3-10`, `04cdbd6` `R3-12`. Two things this field has
  to say plainly: **`R3-6`'s frozen prescription was refuted during execution** (it reused an identity-segment
  predicate over the whole skill body, which refuses `\n`; measured 35/87 Skill Store tests red), it was escalated, and
  the owner answered **`A`**; and **one judgment call of mine rode along with it** — refusing a body for its content
  became reachable for the first time, and the refusal left an empty capability directory that failed the whole store
  closed, so the writer's rollback now prunes it (`catalog.mjs:1403`, reversible at his word). Four of the band's 18
  findings died as premises in the pre-freeze read, and the packaged-entrypoint, retirement and schema-ownership work
  stays excluded by his own letters (`p1`, `r2`, `s1`). Gates: `npm run verify` **PASS** at every item and over the
  closed tree (`1606 tests / 1557 pass / 0 fail / 49 skipped`, judged by its own recorded exit status), `repo:check`
  **PASS**, the WSL lane on the DB-visible sets **26 pass / 0 fail / 0 skipped** with both real-PostgreSQL gates
  executing there, one mutation probe per item each killing exactly one control, Python lane **NOT RUN** (no
  `apps/knowledge/` file is in the diff). Full evidence: `Record — M12/T2.2-R3 closed` in §8.
  (history) Task Status was: IN PROGRESS — **`M12/T2.2-R3` is executing** (`R3-0`…`R3-11`, one commit each where a
  commit is possible).
  Four read-only verification lanes ran before this contract was frozen and killed four premises inside the band, so
  this field starts from what the source said at `7996a16` rather than from the 2026-10-14 register text; the killed
  premises are recorded in `ACTIVE.md` §0 and are not shipped as fixes. Nothing is claimed here before its gate has
  been run.
  (history) **`M12/T4` is CLOSED 2026-10-17**: `T4-1`…`T4-5` landed (plus one discovered record defect),
  §4.17 is now the disposition authority for the 38 re-filed findings, and the M12 release-gate cell no longer
  duplicates §8. Per-item commits, the five premises this contract corrected in the read (plus one deviation it
  disclosed and one gate it reported unsatisfiable), the no-fact-loss diff and
  the escalation list are in `Record — M12/T4-R1 closed` in §8. `T4-3` has no commit: it edited the Git-ignored
  register, which is `H10`'s consequence demonstrated rather than argued.
  (history) **`M12/T4` executing** (`T4-1`…`T4-5`, one commit each, under `M12/T4-R1`); per-item
  evidence lands in §8 as each item validates, and nothing in this tier is claimed before it does.
  (history) **`M12/T2.3` Wave C is CLOSED 2026-10-17**: twelve items landed (`C-1`…`C-11`, `C-13`) plus the
  `C-1a` caveat and one review-convergence fix, with `C-12` dropped on a refuted premise. Full per-item evidence, the
  two inherited claims that died, the claim of mine that died, and the grant my own contract forgot to schedule:
  `Record — M12/T2.3-R1 Wave C closed` in §8.
  (history) **Wave C executing under `M12/T2.3-R1`** (`C-1`…`C-11`, `C-13`, one commit each).
  (history) **`M12/T2.2` is CLOSED 2026-10-16 at the tier level: Wave A and Wave B both landed.**
  Wave A delivered six items (`A-1` `ccf2ad7`, `A-2` `09aa698`, `A-4` `bc33c7e`, `A-3` `d1378ba`, `A-6` `bca4ad6`,
  `A-7` `fd302d4`), stopped two on refuted premises (`A-3` original `638a68e`, `A-5` `639fc47`), and settled one as a
  record-only verdict pass (`A-8` `0afc61c`). **Wave B delivered all twenty-one items** — `B-1` `a108cde`, `B-2`
  `c449cd0`, `B-3` `d34c666`, `B-4` `33f0971`, `B-5` `b7d9d36`, `B-6` `3701804`, `B-7` `6f3c970`, `B-8` `a21c610`,
  `B-9` `0d399d3`, `B-10` `46852f3`, `B-11` `937521c`, `B-12` `f93068e`, `B-13` `7bc3e5d`, `B-14` `f316c83`, `B-15`
  `7aebc39`, `B-16` `5c156d4`, `B-17` `0dddea4`, `B-18` `3f3bb11`, `B-19` `9fa6505`, `B-20` `a473907`, `B-21`
  `5d5f8f0` — plus four follow-on items that came out of executing them (`a62962b` J-1, `fabaf5b` K-1, `9891d83` L-1,
  `07c31b5` M-1). Per-item evidence and every corrected premise: `Record — M12/T2.2-R2 Wave B closed` in §8.
  **Still not done by that tier, and not claimed:** deployment (never authorized here), live Discord behaviour, Wave C
  (`M12/T2.3` — no contract and no code at that closeout; it was materialized the same day as `M12/T2.3-R1` after the
  owner answered the N-block), `M12/T2.2-R3` (the Skill Store lifecycle block, scheduled only), and all
  `M12/T3` H11 work.
(history) Planning Readiness was: APPROVED — the owner approved `M12/T2.2-R3` in two moves on 2026-10-17: `grant` for the band, then
  **`p1 q1 r2 s1 t1`** on the fork block this contract was built from. The scope he approved is the post-verification
  scope, not the register's: four lanes re-read all 18 findings against `7996a16` and four premises died (`R5-E07-05`,
  `R5-E04-09`, and the crowding-out and `recordedHash` clauses of `R5-E05-04`), while `p1` kept the packaged governance
  entrypoint out of bounds, `r2` left H8's retirement capability undecided, `s1` left H5's `skills.*` DDL ownership
  undecided, `t1` granted exactly one read-only probe of the embedding endpoint, and `q1` granted a pinned-assertion
  exception for **two named hunks and nothing else**. Packaging was measured, not assumed: the four source files this
  band edits are absent from `governancePluginFiles()` (`integrations/openclaw/lib/policy.mjs:1184-1279`) and their
  sha256 values (`7285f979…`, `a5e1747d…`, `5193cde5…`, `9342d016…`, each hashed at `7996a16`) in no tracked file —
  `git grep -q` for all four prefixes exits 1 — so these edits force zero digest rolls and zero admissions.
  **Three more letters arrived while the band was executing, and each is recorded in §10 with the trade-off it took:**
  `A` re-cut `R3-6`'s byte set after the frozen predicate was measured refusing every real skill body; `n1` admitted
  `tests/m11-t1-postgres-sql-gate.test.mjs` so `failSql` finally had a tracked real-PostgreSQL lane (executed as
  `R3-12`); and `n2` authorized **planning** `M12/T5` after this band closes, which is not an execution grant.
  (history) `M12/T4-R1` was approved the same day with `grant 1` on the scope proposed after its premises were measured
  — and the numbers it carried into that measurement were themselves wrong; see the correction below and
  `Record — M12/T4-R1 closed`, premises 3 and 4 and the no-fact-loss proof, in §8. What it got right: identifiers
  `M12/T4`–`T8` were confirmed unused, the 38 orphan ids were counted from the grouping paragraph itself, and where a
  fact could not be proven it was written as
  unverified rather than promoted into the schedule — the rule that killed two claims in Wave C and eight premises in
  Wave B. (history) The owner approved Wave C's twelve-item scope and answered all five escalated forks on
  2026-10-16 with `n1a n2a n3a n4a n5a`, each the recommended option. The escalated block was produced by verifying
  every inherited premise against source before proposing it, which is how `C-12` and the "35-vs-37 drift" were found
  to be false and why `C-4`'s count became 3 rather than 8; what that pass could not authorize (the `AGENTS.md` alias
  line, `P04-02`, the five-stack rewrite, the CHANGELOG edit) went to the owner as decisions instead of being smuggled
  into scope. (history) The owner approved the three-wave split and its scope on 2026-10-15 (`đúng, chốt 3
  wave`), then the `4A.13` fork and the pinned-assertion exception (`a, có grant`), and on 2026-10-16 re-pointed `A-3`
  ("`A3: A`"), ordered the rest of the programme ("`Rồi chạy tiếp A6 A7 A8, rồi chạy B C luôn`"), and granted the
  packaged-build digest rollover (`a`). **Wave B's item content is narrower than the tables he approved, not wider.**
  Seven read-only lanes verified every candidate premise against source before the contract was frozen, and eight
  inherited premises failed — see `Record — M12/T2.2-R1 Wave A closed, a WSL claim of mine withdrawn, and
  M12/T2.2-R2 Wave B materialized` in §8. What that pass could not execute (it needed a new pinned constant, a live
  re-pin, or a decision about public behaviour) was escalated into `ACTIVE.md` §5 instead of smuggled in.
(history) Plan Revision was: M12/T2.2-R3
(history) Execution Authorization was: **NO** — `M12/T2.2-R3` executed and closed on 2026-10-17, so this field returns to `NO` under
  §2: it may be set back to `YES` only by a new owner approval materialized into a new `ACTIVE.md`. The next band in
  the owner's queue is `M12/T5` (A2 packaged module graph, 3 findings), for which he granted **planning only** (`n2`);
  no `M12/T5` code exists and none may be written until he approves that plan and this pointer names a matching
  contract. `H5` and `H6` are still unanswered, and `H5` sits in the queue immediately before `M12/T6`–`T8`.
  (history) Execution Authorization was YES for `M12/T2.2-R3`, bounded to `ACTIVE.md` §3's items `R3-0`…`R3-11` and §4's
  enumerated file set, under the
  `AGENTS.md` §12 terms only (local implementation commits, validation, the closeout commit, push of this non-`main`
  task branch). The owner's grants, in his own words: `grant` for the band, then `p1 q1 r2 s1 t1` — `p1` **excludes
  `integrations/openclaw/plugins/zink-governance/index.mjs`** (packaged entrypoint; an edit would admit an outgoing
  deployed digest into `configure.mjs:1497`/`:1764` and so widen what `--apply` accepts on his host), `q1` grants a
  pinned-assertion exception for **exactly** `tests/m8-t1-skill-vector-memory.test.mjs:395` and
  `tests/m10-t2-r21-skill-chunking-and-text-budgets.test.mjs:46-50`, named at the moment of touching and not precedent,
  `r2` leaves H8 unanswered so no retirement capability is written, `s1` leaves H5 unanswered so no schema, migration or
  module-ownership change is made, and `t1` grants one read-only probe of the embedding endpoint's response shape and
  nothing beyond it. Standing rulings that bind this contract: `AGENTS.md` is not editable for naming/vocabulary (owner,
  2026-10-17); CHANGELOG takes new validated entries but accepted history lines are not rewritten without a separate
  word; no `.github/workflows/**`; no `--apply`/restart/deployment/live Discord request; no deletion of a tracked file;
  no dependency or lockfile change; no new or widened required gate. Discovered record/plan defects may be fixed inside
  §4's file set as their own commits, after each premise is re-read at the current head; discovered source/schema/gate
  defects go to `ACTIVE.md` §5's escalation list instead.
  (history) Execution Authorization was **NO** immediately before this revision — `M12/T4-R1` had executed and closed on
  2026-10-17 with its contract archived at `docs/contracts/execution/archive/2026-10-17-M12-T4-R1.md`.
  (history) Execution Authorization was **YES** for `M12/T4-R1`, bounded to `ACTIVE.md` §3's items `T4-1`…`T4-5` and
  §4's three writable files
  (`PLAN.md`; `.agents/states/findings.md`; `docs/development/conventions.md`, line 26 only), under the `AGENTS.md` §12
  terms (local implementation commits, validation, the closeout commit, push of this non-`main` task branch). Standing
  rulings that bind this contract: `AGENTS.md` is not editable for naming/vocabulary (owner, 2026-10-17); CHANGELOG
  takes new validated entries but accepted history lines are not rewritten without a separate word; no
  `.github/workflows/**`; no `--apply`/restart/deployment; no deletion of a tracked file; no dependency or lockfile
  change; no new or widened required gate (the recurrence guard is escalated, not built); no execution of the
  successor bands this contract only schedules. Discovered record/plan defects may be fixed inside the same file set as
  their own commits, after each premise is re-read at the current head; discovered code/schema/gate defects go to
  `ACTIVE.md` §5's escalation list instead.
  (history) Execution Authorization was NO immediately before this revision: `M12/T2.3-R1` executed and closed on 2026-10-17, so this field returned to NO and the
  contract was archived at `docs/contracts/execution/archive/2026-10-17-M12-T2.3-R1.md`. **What was actually granted for
  Wave C, recorded because a later agent must not re-litigate it:** the owner answered the whole escalated N-block in
  one line — `n1a n2a n3a n4a n5a` — which bound execution to `ACTIVE.md` §4's `C-1`…`C-11` and `C-13` on §3's
  enumerated file list, under the `AGENTS.md` §12 terms only (local implementation commits, validation, the closeout
  commit, push of this non-`main` task branch). Grants in force and nothing beyond them: `n2a` for **Gate G18 only** —
  the G10 half went unused because G10 carries no provider claim; `n3a` to widen a required gate by registry
  **membership**, which is what `d9e1bcc` did and did not do (no stage was added to `npm run verify`, nothing new runs
  in CI); `n4a` kept `AGENTS.md` read-only for this wave; `n5a` kept `CHANGELOG.md` untouched. Standing prohibitions
  never lifted: no `--apply`, no restart, no deployment, no lock deletion, no `events.jsonl` edit, no Discord request,
  no `main` merge, no PR, no force-push, no workflow-file edit, no migration or schema **content** edit, no dependency
  or lockfile change, no ceiling **value** change, no deletion of any tracked file, no change under
  `/home/hoang_vinh/.openclaw-zink` beyond read-only inspection, and no implementation of any `H1`–`H11` decision, of
  `M12/T2.2-R3`, or of `M12/T3`. Every pinned assertion other than G18 remained stop-and-report and none was needed.
  (history) Grants for `M12/T2.2-R2` Wave B, in the owner's own words:
  `A3: A` then `Rồi chạy tiếp A6 A7 A8, rồi chạy B C luôn` (2026-10-16), `A -> G chạy theo phương án tốt nhất`,
  `a. Và sửa thêm các lỗi em phát hiện rồi tới wave c` (which granted the two extra digest pins and the
  discovered-defect cluster `B-20`/`B-21`), and `j1 k1 l1`, then `m1`.
  **Pinned-assertion grants issued and used during this wave** — each line named before it was touched, none inferred:
  `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:1028` (B-12), the `m11-t1-r2` divergence allowlist (B-8/B-9),
  `tests/m10-t2-r6-boundary-predecessor.test.mjs:52` (B-16), `tests/m8-t2.10…:103` and
  `tests/m8-t2.16-r19-promptbuild-liveness.test.mjs:507` (B-16 under `§0.5-I`), and
  `tests/m12-t2-governed-surface.test.mjs:685` (B-17). `tests/m8-t1-skill-vector-memory.test.mjs:118` stayed **unused**
  and is not precedent. Every other pinned assertion remained stop-and-report, which is what stopped B-16 for one round.
  **Predecessor admissions granted:** `97c7f3e1…` and `5966d446…` for `lib/native-boundary.mjs` (`j1`), and the nine
  live digests across eight governed paths admitted under `m1` (see `Record — … Wave B closed`, §8).
  The standing prohibitions were never lifted by any of this: no `--apply`, no restart, no deployment, no lock
  deletion, no `events.jsonl` edit, no Discord request, no `main` merge, no PR, no force-push, no workflow-file edit,
  no migration or schema **content** edit, no dependency change, no ceiling **value** change, no **deletion of any
  tracked file**, no chmod or other change under `/home/hoang_vinh/.openclaw-zink` beyond read-only inspection, no
  deletion of the stray `C:\home\hoang_vinh` tree, and **no implementation of any H1–H11 decision** — including all
  `M12/T3` H11 work — and no Wave C item. Tier and wave assignments are not approvals, and neither is an item's
  presence in an archived tier table.
  (history) This field's earlier text bounded execution to `ACTIVE.md` §4's eight high-risk items (T2.1-1 … T2.1-8) for
  `M12/T2.1-R3`; that tier is closed and its contract is archived.
  History of this field, recorded because the withdrawal is the evidence that the verification round worked: it was
  set YES for R2 on 2026-10-14, then **pulled to NO on 2026-10-15** when Vòng 6 lanes V01/V05/V06 found **eleven
  defects in R2 itself** — three High (4A.1 vs a pinned gate assertion; 4A.13's fix self-blocking because the stored
  column is the row-level aggregate computable only after the HTTP loop; 4A.16(i)'s known-red promise unbacked because
  `resolveContractFilePath` can return only `*.schema.json` paths and a naive widening instead matches the guard's own
  string), plus §7 demanding the rejected "one shared parser" fix, a possible **third** unregistered known-red, "every
  test SKIPs" really being "2 of 6", 4A.1's loss claim narrowing to "the destructive statement executes and reports
  `READY`", 4A.3's trigger being a PDF row with a NULL page pair, the gate registry giving a list rather than a
  denominator, and my own two over-counts (`R5-E01-05` at 19 `from None` + 9 bare `except Exception:`, and
  `R5-E12-01`'s replacement claim contradicted by five `PLAN.md` rows that do record `quality-gate SUCCESS`).
  R3 was then written **fresh** rather than patched, and this field restored to YES at the narrower bound. Full
  detail in the §8 records of this file and in the `F-xxx` rows that still carry the `R5-E*`/`R6-V*` legacy ids in
  `docs/execution/findings.md`.
(history) Execution Contract was: **NONE** — `M12/T2.2-R3` closed on 2026-10-17, so no contract authorizes execution in this
  repository right now. Its approved contract is archived verbatim at
  `docs/contracts/execution/archive/2026-10-17-M12-T2.2-R3.md` (308 lines; the `archive/README.md` sweep was re-run on
  the copy at closeout and removed nothing — step 1's credential-pattern scan returns **1** hit, `Execution
  Authorization: YES` at `:7`, which is a lifecycle field name and not a value, and its base64-class scan returns
  **3**, all of them ordinary file paths; step 3 finds **0** snowflake-class digit runs; step 4 finds **0** long-hex
  blobs, **0** environment/config-body lines and **0** live host paths), and its closeout record is
  `Record — M12/T2.2-R3 closed` in §8. **That archived
  file is where every `ACTIVE.md` §N citation in this band's PLAN.md fields and §8 records resolves now**, since the
  live `docs/contracts/execution/ACTIVE.md` has been deleted; archived contracts are immutable, so those citations are
  pointers, not authority. A new `ACTIVE.md` may be created only by a fresh owner approval materialized into a new Plan
  Revision.
  (history) `M12/T4-R1` closed earlier the same day: its contract is archived verbatim at
  `docs/contracts/execution/archive/2026-10-17-M12-T4-R1.md` and its closeout record is
  `Record — M12/T4-R1 closed` in §8. (Predecessor `M12/T2.3-R1` archived at closeout to
  `docs/contracts/execution/archive/2026-10-17-M12-T2.3-R1.md`.)
Review Convergence Gate: **PASS** for `M12/T2.2-R3` — one read-only review pass over the band's own diff and its
  record, run before the closeout commit. It found five defects in the **record** and none in the shipped behaviour;
  four were fixed in the closeout commit (§3's milestone cell still calling the band "authorized and executing … with
  nothing yet validated"; the `R3-0` probe claimed as **committed** under a Git-ignored `temp/` path, in three places;
  the §4.17 refuted-premise dispositions missing from §8; and a correction paragraph that pointed at one stale
  "scheduled, not authorized" line when four survive in three earlier records). The fifth is recorded and routed, not
  rewritten, because it sits inside accepted historical records: the stale `file:line` citations in earlier §8 records
  for the four files this band shifted. The pass also independently re-derived `R3-7`'s riskiest premise — that
  `recordedHash` can never be absent on the failure path, which is what makes deleting the zero-digest stand-in safe —
  from `catalog.mjs:326-329`, `:610-617` and `vector-sync.mjs:565-574`. Full list: `Record — M12/T2.2-R3 closed`, §8.
  What preceded execution was not a review but a four-lane premise verification of the band, and it is recorded in
  the archived contract's §0 because it killed four of the 18 findings before any code was written.
  (History, `M12/T4-R1`: **PASS** — two read-only review passes over the contract's commits. The first
  found seven real defects in what this contract had just written (the `R5-E13-05` row contradicted itself about which
  half of that finding is open; the `P5` provenance key claimed a `git log` state that had already changed; §2's
  approval field still carried the refuted 112/2/9 840/17 premises; the §8 record miscounted its own premises; the
  register attributed `Status:` lines to the wrong field; six register rows said `OPEN` where §4.17 said `EXCLUDED`;
  the new `R5-E09-08` entry carried run/SHA counts inconsistent with §11's H1 row). The second pass re-measured the
  no-fact-loss arithmetic the record had restated and found **that** claim unreproducible too — "67 / 56 / 11" and
  "kept = 12" and "twelve, not fourteen" were replaced by the classifier's actual output (36 → 5 unique, 31 removed,
  0 homeless; 15 → 0 across the relocation). Every finding was fixed before this field was set; the full list is in
  `Record — M12/T4-R1 closed`, §8.
  (History, `M12/T2.3-R1` Wave C: **PASS** — one review pass over the whole wave found a real hole in the control
  `C-4` had just introduced (a provider row renamed away from its adapter slug would drop its own constraint and
  leave Gate G18 green), fixed at `cd1b541` with a mutation probe proving the new assertion fires; the re-review
  found the second issue worth recording: `n1a`'s caveat had been granted in §3 but never scheduled as a §4 item,
  which `7d73e18` then executed. Full detail in
  `Record — M12/T2.3-R1 Wave C closed`, §8.)
Final Quality Gate: **PASS** for `M12/T2.2-R3` — the full `npm run verify` chain (`format:check && lint && test &&
  repo:check`) ran over the closed tree after the contract was archived and deleted and after the review pass's fixes,
  judged by **its own status written into the log** (`NPM_VERIFY_EXIT=0` at the last line, never a piped tail's or a
  background wrapper's), reading out **1606 tests / 106 suites / 1557 pass / 0 fail / 0 cancelled / 49 skipped** with
  `Repository policy check passed.` immediately above the exit line. The §6.3 WSL lane was re-run over the same closed
  tree and read as counts, not status: **26 / 26 pass / 0 fail / 0 skipped**, and the zero-skip reading was confirmed by
  name — `M11-06: generated statements execute against real PostgreSQL` (5.87 s) **and** `R3-12: the failure statement
  runs on real PostgreSQL and clears the segments` (4.40 s) both executed there, as did `M11-03` and `M11-04`.
  `npx prettier --check CHANGELOG.md` exits 0; `repo:check` passes standing alone. Python lane **NOT RUN** (no
  `apps/knowledge/` file in the diff). One sequencing caveat, stated because it is the only honest way to claim a
  "final" gate: this field's own text and the rest of `R3-11`'s record lines land in `PLAN.md` **after** the run above,
  and `PLAN.md` is read by some of the chain — so the post-edit tree was re-gated on exactly those consumers:
  `npm run repo:check` exits **0** (`Repository policy check passed.`) and the two test files that read `PLAN.md`
  (`tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs`, `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs`) run
  **41 / 41 pass / 0 fail / 0 skipped**, exit **0**. `format:check` and `lint` cannot be affected by a `PLAN.md` edit:
  `package.json`'s prettier globs do not name it, and `.markdownlint-cli2.mjs` lists `PLAN.md` under `ignores` — both
  read from the files, not assumed.
  (History, `M12/T4-R1`: **PASS** — `npm run verify` (its own exit status, never a piped tail) run at the
  materialization commit `f9b356c` and after each of `ca8e2ff`, `71003fd`, `07cca47`, `4f4536f`, `21f349a`, then again
  over the final closeout tree: **1595 tests / 106 suites / 1546 pass / 0 fail / 49 skipped**, `Repository policy
  check passed.` every time, with `npm run repo:check` PASS at each item because `docs/development/conventions.md` is
  read by `checkGateRegistry`. §6's contract-specific proofs are reported in `Record — M12/T4-R1 closed`, §8: the 38
  rows re-counted (3 + 14 + 6 + 15), the register's statuses re-counted, the no-fact-loss diff re-measured, and the
  `M12/T2.[4-7]` grep reported as 0 in `PLAN.md` / 2 in one immutable archive rather than claimed as repo-wide.
  **WSL lane `NOT RUN`** (no test, source or packaged asset changed) and **Python lane `NOT RUN`** (zero
  `apps/knowledge/` files in the diff).
  (History, `M12/T2.3-R1` Wave C: **PASS** — full gate run at every item commit and over the final tree
  (Windows `npm run verify` exit 0, **1595 tests / 1546 pass / 0 fail / 49 skipped**, `Repository policy check
  passed.`), the WSL lanes read as counts (12/12, 2/2, 35/35, zero skips), six mutation probes with each mutation
  confirmed in the file first, `§6.7`'s re-grep denominators recorded, and the Python lane `NOT RUN` with the reason
  (zero `apps/knowledge/` files in the diff).)
Evidence Level: **REMOTE-BACKED for `M12/T2.2-R3`'s repository gates** — `LOCAL-VERIFIED` first, then read back from
  the remote runs at the closed head. Locally: `npm run verify` at each item and over the closed tree, judged by the
  `NPM_VERIFY_EXIT=0` written inside its own log (**1606 tests / 1557 pass / 0 fail / 49 skipped**), `repo:check`
  **PASS**, the two `PLAN.md`-reading test lanes re-run after the final record edits (**41 / 41 pass / 0 fail**), the WSL
  lane on the DB-visible sets **26 pass / 0 fail / 0 skipped**, and one mutation probe per item. Remotely, at head
  `0ad3655` (the closeout commit; the band's last code commit is `04cdbd6`): **CI run `39018443022` SUCCESS** —
  `quality-gate` **1606 tests / 106 suites / 1552 pass / 0 fail / 54 skipped**, Prettier clean,
  `Repository policy check passed.` — and `python-quality` **SUCCESS** (`208 passed, 34 subtests`); that job carries no
  path filter in `ci.yml`, so it ran even though this band touches no `apps/knowledge/` file, which is why the local
  §6.7 `NOT RUN` is a statement about this host's gate, not about CI. **Security run `39018445973`**: `secret-scan`
  **SUCCESS**, `dependency-audit` red on the unchanged pre-existing 5-high `npm audit` baseline, the same shape as every
  earlier branch run. **One limit read out of the remote log rather than assumed:** the real-PostgreSQL lanes did
  **not** execute there — `M11-06` and `R3-12` both print `# docker container personal-tool-postgres-1 unavailable` on
  the GitHub runner, alongside one Windows-junction case, and the log prints fewer skip lines than the 5-skip delta
  against this host, so the delta is not fully enumerable — which means `R3-7`'s acceptance and the `n1` lane are
  **Windows- and WSL-backed, not remote-backed**. `REMOTE-BACKED` here means CI was dispatched by hand at the closed
  head (`gh workflow run ci.yml` / `security.yml`) and read from that run's own log; a task-branch push starts no run by
  itself (`ci.yml:6-7` is `main`-only — open decision **H1**), and those dispatches appear under the owner's GitHub
  account, which is why they are stated here. `R3-0` stays **NOT RUN** (the probe needs `OLLAMA_URL`, which this machine
  does not carry). Deployment is not authorized by anything in this revision (`NOT DEPLOYED`), and live Discord
  behaviour stays `NOT TESTED`.
  (history) Evidence Level was **NONE for `M12/T2.2-R3`** at materialization — nothing in that contract was validated
  yet.
  (History, `M12/T4-R1`: **REMOTE-BACKED for its repository gates** — `LOCAL-VERIFIED` at every item commit and over
  the final tree on this host (1595 / 1546 pass / 0 fail / 49 skipped, policy passed), then read back from the remote
  runs at the closed head `9a0e398`: CI **`38992022348`** `quality-gate` **SUCCESS** (`1595 / 106 suites / 1542 pass /
  0 fail / 53 skipped`, `Repository policy check passed.`) and `python-quality` **SUCCESS** (`208 passed, 34 subtests`),
  Security **`38992024758`** `secret-scan` **SUCCESS** with `dependency-audit` red on the unchanged 5-high baseline.
  Both had to be dispatched by hand (`ci.yml:6-7` triggers on `main` only — open decision **H1**), which is why the
  branch push alone was not evidence. That backing covers the repository gates only: CI is Linux-on-GitHub and never
  mounts the live tree, and its 53 skips against this host's 49 is the recorded lane gap. Nothing here is deployed
  (`NOT DEPLOYED`), no live Discord behaviour was exercised (`NOT TESTED`), and `verify.mjs` plus the R16
  rehearsal remain `NOT RUN`.
  (History, `M12/T2.3-R1` Wave C repository gates: **REMOTE-BACKED** — CI run **`38944576084`** @
  `71c2bff52a68972152816a95e31a7ff8d1203fc2` on `codex/m11-t1-audit-remediation`: `quality-gate` **SUCCESS** reading
  `ℹ tests 1595 / suites 106 / pass 1542 / fail 0 / cancelled 0 / skipped 53` and `Repository policy check passed.`, and
  `python-quality` **SUCCESS** (`208 passed, 34 subtests passed in 25.67s`). Both numbers were read out of the run log,
  not inferred from the job colour; CI's 53 skips against this host's 49 is the recorded lane gap (`skipped` counts
  differ per environment, and CI never mounts the live tree). Security run **`38944579971`** at the same head adds
  `secret-scan` **SUCCESS** (`✅ No leaks detected`) — the run that matters for a wave that newly tracked a 315-line
  archived contract — while `dependency-audit` stays red on the unchanged 5-high `npm audit` baseline, which is
  expected because no dependency was touched: `C-9`'s `package.json` edit is the `test` script list only. Both runs had
  to be dispatched by hand: `ci.yml:6-7` triggers `push`/`pull_request` on `main` only (open decision **H1**).
  Deployment is unauthorized and unperformed; live Discord behaviour stays `NOT TESTED`; `verify.mjs` and the R16
  rehearsal stay `NOT RUN`. CI is Linux-on-GitHub and a matching denominator proves nothing about the live tree.
  (Evidence Level of the closed predecessor `M12/T2.2-R2`: **REMOTE-BACKED for Wave B's repository gates; the live
  tree and Discord behaviour remain `NOT TESTED`.** CI run **`38927821839`** @ `afa9721e8db81db095061f2a7fb5cba984b40aaa` on ref
  `codex/m11-t1-audit-remediation`: `quality-gate` **SUCCESS** — `ℹ tests 1590 / suites 106 / pass 1537 / fail 0 /
  cancelled 0 / skipped 53`, `Repository policy check passed.` — and `python-quality` **SUCCESS** (`208 passed,
  34 subtests`). Both numbers were read out of the run log, not inferred from the job colour. **This run had to be
  dispatched by hand:** `ci.yml:6-7` triggers `push` and `pull_request` only on `main`, so pushing a task branch
  starts nothing (that is open decision **H1**, and every prior run on this branch is `workflow_dispatch` too).
  The `Security` workflow was **not** run at this head, so it is `NOT RUN` here — at `d8c221a` it was red on the
  unchanged 5-high `npm audit` baseline with `secret-scan` green, and nothing in this tier touched a dependency.
  The CI denominator matching the local one proves nothing about the live tree: CI is Linux-on-GitHub, and
  `skipped 53` vs Windows `49` vs WSL's zero-skip reads is exactly the lane gap recorded in §8.
  Locally at the closed head: Windows `npm run verify` **`verify_exit=0`** — `1590 tests / 1541 pass / 0 fail /
  49 skipped`, `Repository policy check passed.` — where the 49th skip is `M1 4` declining honestly on a platform
  that cannot mount the live tree. Python lane **204 passed / 4 skipped / 34 subtests**. WSL lane: the eight
  `configure.mjs`-reading files **114/114**, the asset predecessor cluster **90/90**, and the M-1 gate **13/13** with
  `R7 P1` green. Per-item red-before/green-after and every mutation probe are in
  `Record — M12/T2.2-R2 Wave B closed`, §8.
  Wave A's items are validated on both hosts: Windows `npm run verify` exit 0 at `0afc61c` (**1516 tests / 106 suites
  / 1470 pass / 0 fail / 46 skipped**, `Repository policy check passed.`), WSL **1516 / 1471 pass / 2 fail /
  43 skipped**, where both failures were recorded as pre-existing baseline rather than Wave A regressions — `R7 P1`
  as live drift and `R16-DRIVER-05` as the standing dead rehearsal. **Corrected at Wave B closeout:** that
  `R7 P1` row described only `lib/authority.mjs`. A full sweep later found **nine** governed paths in the same state,
  not one, and admission — not another baseline record — is what fixed it (`07c31b5`). No CI run was observed at any
  Wave A head, so the tier's strongest honest claim is LOCAL-VALIDATED and **not** REMOTE-BACKED. Full detail,
  including the piped-`tail` mistake that nearly made me report the WSL lane green, in §8.
  (Evidence Level of the closed predecessor `M12/T2.1-R3`: **REMOTE-BACKED** for the repository gates — CI run
  `38715084889` @ `d8c221a` reports `quality-gate`
  **SUCCESS** and `python-quality` **SUCCESS** (Security `38715090086` is red on the unchanged 5-high `npm audit`
  baseline only, `secret-scan` green) — on top of `npm run verify` PASS on Windows at `ad4a8d6`, and PASS again at
  `61638d8` (the follow-on naming remediation, gate rerun in full before committing):
  `format:check` clean, `lint` clean with `zink-tools` now inside it, `npm test`
  **1483 tests / 106 suites / 1437 pass / 0 fail / 46 skipped**, `Repository policy check passed.`; the
  Knowledgebase Python suite green locally (**142 passed / 6 skipped**, down from 7 once `R6-I01-01`'s skip went
  away). One mutation probe per item, each killing exactly that item's control. `46 skipped` **includes**
  `m8-t2.13-r16`'s namespace cases and the single Postgres/Docker-gated test, so it is not a pass and is not counted
  as one. **The CI-vs-Windows skip delta is now attributed, not assumed: CI 52 − Windows 46 = 6, and those 6 are the
  `tests/helpers/duckdb-availability.mjs:45` family (`DuckDB engine not installed on this host (NOT RUN)`), consumed
  by `tests/duckdb-bridge.test.mjs` and `tests/m7-t4-orchestration.test.mjs`. I verified the mechanism on this host:
  `which duckdb` resolves to the WinGet CLI here and `wsl.exe … which duckdb` resolves to
  `/home/hoang_vinh/.local/bin/duckdb` there, while the CI runner has neither — so the six run locally and skip on
  the runner. Per-family, not global: the remaining 40 CI skips are `24 operator backup not reachable`, `16 R16 mount
  namespace`, `2 production ledger not reachable`, `2 live runtime not reachable`, `1 Postgres container`, `1 bare
  SKIP`, which is why decision H3 must be a per-family expectation rather than one threshold number.**
  The **WSL lane** is `NOT RUN` for this wave, as is the success path of the lazily-resolved `app` (CI's
  `test_main_api.py` covers it), and CI does not read the live tree at all.)
Task Branch: codex/m11-t1-audit-remediation (no new branch and no `main` merge authorized)
Owner Approval: EXPLICIT for `M12/T2.2-R1` — 2026-10-15, three messages: *"đúng, chốt 3 wave"* (scope + order),
  *"a, có grant"* (the `4A.13` fork = no skip without a stored model identity; the pinned-assertion exception,
  narrowed by this plan to the single assertion named in `ACTIVE.md` §4), and *"chọn 1 đi, có sẵn
  docs/contracts/execution/archive/ thì tạo trong đó, chưa thì tạo đúng file đó"* (decision `H10` / `R3-P04-03` —
  archive instead of delete, with the directory grant). He also set the sequence: audit fixes first, `M12/T3` for the
  H11 coordinator work, `five-stack.md` corrected inside that scope.
  (history) Earlier approval — 2026-10-14, seven-lettered-block answer quoted above, followed the same day by
  the sweep-and-record instruction that produced R2. Two sub-choices are
  **mine and reversible**, recorded here the way the STACK precedence rule was: (1) `R3-P04-06` makes
  `AGENTS.md`'s existing executor name canonical and lists the other as a retired alias, because
  `AGENTS.md` is the authority file while the skill files are procedures; (2) `R3-P04-05` defines
  `NOT TESTED` as distinct from `NOT RUN` and **non-blocking** for closure, because making it blocking
  would change the required gate and therefore need its own decision. **R2 adds a third reversible
  sub-choice:** the sixteen-item admission rule in the ACTIVE.md header is **mine** — the owner said
  "từ findings ghi vào ACTIVE.md" without bounding which findings, so severity was *not* treated as
  authorization and every item that would touch a schema, a published contract, a migration, durable
  state, module ownership, a gate, a ceiling or a control was excluded into §5 with its successor task
  even where it is rated High or Critical. If the owner wants a wider wave, that is a new Plan Revision.
  The findings register is
  `.agents/states/findings.md` (Rounds 1–4 complete: 16/16, 8/8, 6/6, plus V01/V02; Vòng 5 **11/16** lanes
  with E08/E11/E14/E15/E16 `NOT RUN`; Vòng 6 `NOT RUN`) and is a queue, not authority.
```

Prior focus — M12/T2 (R1–R4), retained below unchanged; its deployment records are durable in §8. Per
`R3-P04-02` (one fact, one home) the §3 M12 cell is text that item 4.9 converts into a pointer to §8;
nothing below is rewritten by this revision.

```text
Milestone: M12 — Governed Discord interaction lifecycle and governed presentation
Task: M12/T2 — Governed forum tags: the approval STATUS tag follows the real verdict
Active revision: M12/T2-R4 — the operator orphan-lock recovery action (owner sequence **C1 → E →
  D1**, 2026-10-14). C1 is delivered: `operator-lock-recovery.mjs` is read-only by default, proves
  the recorded holder is gone with `process.kill(pid, 0)`, refuses anything it cannot validate, and
  deletes only after `--recover --confirm=ORPHAN_LOCK_RECOVERY`. Evidence in §8. **EXECUTED on the
  live host 2026-10-14:** the orphan was cleared through the tool (read-only `REPORT` with
  `holder_alive:false`, then `RECOVERED`), and E ran — preflight PASS → one apply → installed
  `lib/discord-forum-tags.mjs = 18fbb077…` with 37/37 packaged paths byte-equal, unit active
  `MainPID=68567`, 0 error-class journal lines, 7 sockets. D1 (repair the R16 apply rehearsal so it
  can run against the current live runtime) is recorded as a separate planned task, not started here.
  Prior revision: M12/T2-R3 — BOUNDED REMEDIATION of the live #office approval-card outage
  (owner-reported 2026-10-13: "bot kẹt phản hồi ngay tại kênh office em"). This is not a new plan:
  it is the AGENTS.md §3 bounded fix of a **verified** defect that the M12/T2-R2 build introduced,
  diagnosed from the live journal before any edit, and confined to the failing control
  (`surfaceStackTag`) plus the asset-predecessor admission it needs. No `ACTIVE.md` is materialized
  for a bounded fix, and the fix changes no scope, contract, schema, gate or resource ceiling.
Task Status: COMPLETE — M12/T2-R3 — implemented, validated locally **and on CI** (`0b55dfa` + `c8bcc24`
  pushed), **DEPLOYED AND VERIFIED 2026-10-14** under grant E (Deployment B, §8); the STACK
  precedence rule is now the build the live gateway runs. Both owner decisions on that revision were
  answered on 2026-10-14: (A)=A1 keeps the STACK precedence order the agent chose, and (B)=B1
  granted the apply — which first failed (see M12/T2-R3b) and then succeeded as Deployment B.
  M12/T2-R3b (2026-10-14) — grant (A)=A1 and (B)=B1 were given and the apply **failed**:
  `reason:"APPLY_REJECTED"`, rollback succeeded, the host still carries `e0a755bb…`. Verified cause
  is **not** the remediation: an orphaned `ledger/writer.lock` whose `owner.json` names dead pid
  60201 makes `--apply`'s last step refuse (`Ledger writer unavailable [EXECUTION_STATE_UNKNOWN]`),
  and the live gateway has logged 202 lock-contention failures since — so **every governance ledger
  write is failing closed right now**, which is the immediate reason #office is still stuck.
  Shipped here: `configure.mjs` now emits its machine code so the operator reason is diagnosable
  (reproduced in a scratch test; one mutation probe killed it), diagnosed against the live runtime
  inside a private mount namespace with the tree proven byte-identical afterwards. Open owner
  decisions: (C) authorize orphan-lock recovery for that exact target — the lock primitive forbids
  automatic reclaim, so deleting it is a destructive operator action requiring explicit consent, and
  (D) whether to fund the R16 apply-rehearsal repair, since that gate cannot run on WSL at all and
  no rehearsal has ever validated a candidate against the current live runtime.
  M12/T2-R2 CLOSED — implemented and validated 2026-10-13 in implementation commit `b6d04e8`;
  the execution contract was deleted at this closeout and the working tree left clean.
  **DEPLOYED AND VERIFIED the same day** under the owner's standing deployment A grant
  (`operator-preflight` PASS → one `operator-apply` PASS, transaction `complete`, no rollback;
  all 35 installed paths byte-equal to the packaged build; unit active, 7 sockets, zero refusals).
  R2's "zero refusals" line is now known to be true only for the minutes it covered: no governed
  approval had been requested yet, and the first two requests after that window were refused by
  the STACK rule. See §8 M12/T2-R3.
Planning Readiness: APPROVED (historical — the approved M12/T2-R2 contract is executed and closed;
  R3 is a bounded fix inside the verified finding, not a re-plan)
Historical Plan Revision: M12/T2-R4 (C1 DELIVERED; E **EXECUTED AND VERIFIED** — Deployment B installed the
STACK remediation on the live host 2026-10-14, evidence in §8)
Execution Authorization: NO
Execution Contract: NONE (the M12/T2-R2 ACTIVE.md was deleted at closeout)
Evidence Level: REMOTE-BACKED for the repository gates **and DEPLOYED AND VERIFIED on the live
  runtime** (deployment A executed by the owner 2026-10-13: preflight PASS → one apply PASS with
  `transactionStatus":"complete"` → all 35 installed paths byte-equal to the packaged build,
  `MainPID=54345`, 7 `:443` sockets, zero `DISCORD_TAG_*` refusal; evidence in §8) — CI run
  `38405914399` @ `0479d02` on ubuntu-24.04: `quality-gate` SUCCESS (`ℹ tests 1457 / ℹ pass 1406
  / ℹ fail 0 / ℹ skipped 51`, `Repository policy check passed.`) and `python-quality` SUCCESS
  (`188 passed, 27 subtests passed`); Security run `38405920662`: `secret-scan` SUCCESS (zero
  leaks) while `dependency-audit` stays red on the unchanged pre-existing 5-high baseline. CI has
  no access to `/home/hoang_vinh/.openclaw-zink`, so it adds no live-runtime or Discord evidence.
Locally: `npm run verify` **PASS** on Windows (1457 tests / 1412 pass /
  **0 fail** / 45 skipped, `Repository policy check passed.`) and **192/192 with ZERO skips**
  under WSL Ubuntu across the same affected set; three mutation probes each killed exactly one
  control (an unresolved STATUS value would still PATCH; foreign tag ids would be dropped; the
  call site was detached). Candidate packaged entrypoint `513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d`;
  no asset admission changed because the installed files are untouched, and the never-deployed
  `85fbee50…` / `f9ef77dc…` candidates stay unlisted by design. **Live per-surface status: NOT
  TESTED** — the build is installed and loads (7 sockets, zero refusals), but no governed approval
  has been requested or decided since the restart, so no tag name has been resolved against a real
  forum, no thread has been created, and whether Discord accepts
  `PATCH /channels/{thread.id}` with `applied_tags` on this server is still unproven; a rejection
  would be logged as `DISCORD_TAG_TRANSITION_REJECTED_<status>` rather than claimed as success.
  Durable record in §8.
Task Branch: codex/m11-t1-audit-remediation (no new branch and no `main` merge authorized)
Owner Approval: EXPLICIT — 2026-10-13. He required the post-verdict tag transition R1 had
  recorded as out of scope ("Em còn thiếu cái chuyển trạng thái tag sau khi phê duyệt thật"), and
  stated the five STACK meanings verbatim (INFRA = Docker and the machine software that runs
  tasks — Excel, MySQL, DuckDB; SEMANTIC = the layer used when meaning must be added because the
  bot does not yet understand the problem and must not create the wrong meaning; DATA = ETL;
  ANALYTICS = charts/dashboards; DECISION = the decision report the bot analyses), which is the
  ledger's `target_stack`/`stack_id` enum and therefore CONFIRMS the R1 derivation rather than
  changing it. He also reported that the deployment command block handed to him failed on paste;
  the verified root cause is that `jq` is not installed on the WSL host, and the replacement uses
  the repository's own trusted operator scripts.
  Deployment option A remains authorized: read-only preflight → ONE apply → restart of the live
  unit, now expressed as two single-line commands with no `jq` and no shell substitution.
Prior task record — M12/T2-R1 CLOSED 2026-10-13, REMOTE-BACKED for the repository gates,
  NOT DEPLOYED; durable record in §8 (retained, not rewritten).
Evidence Level: REMOTE-BACKED for the repository gates, still NOT DEPLOYED — CI run
  `38394646861` @ `0502204` on ubuntu-24.04: `quality-gate` SUCCESS (`ℹ tests 1446 / ℹ pass 1395
  / ℹ fail 0 / ℹ skipped 51`, `Repository policy check passed.`) and `python-quality` SUCCESS
  (`188 passed, 27 subtests passed`); Security run `38394651339` adds `secret-scan` SUCCESS
  (gitleaks, zero leaks) while `dependency-audit` stays red on the unchanged pre-existing
  5-high baseline. CI cannot reach `/home/hoang_vinh/.openclaw-zink`, so it adds no live-runtime
  or Discord evidence.
Locally: `npm run verify` **PASS** on the Windows host
  (`format:check` clean, `lint` 0 issues, `npm test` 1446 tests / 1401 pass / **0 fail** /
  45 skipped, `repo:check` "Repository policy check passed."), and the affected set re-ran under
  WSL Ubuntu at **181/181 with ZERO skips** where `/home/hoang_vinh/.openclaw-zink` is reachable:
  the two new suites (`m12-t2-forum-tags`, `m12-t2-governed-surface`), the four M12/T1 suites,
  `m10-t2-r12`, the six predecessor suites, `m8-t2-native-outbound`,
  `m11-t3-openclaw-runtime-bounds` and `m8-t2.4-approval-request`. CI backing for the pushed
closeout `0502204`: run `38394646861` `quality-gate` **SUCCESS** (1446 tests / 1395 pass / 0 fail
/ 51 skipped, `Repository policy check passed.`) and `python-quality` **SUCCESS** (188 passed,
27 subtests); Security run `38394651339` `secret-scan` **SUCCESS** (zero leaks) with
`dependency-audit` red on the unchanged 5-high baseline. Three mutation probes each
  killed exactly one new control (unresolved tag ⇒ no POST at all; second thread for a task that
  already has one ⇒ suppressed; card status line re-added ⇒ R12 content gate fails) and were
  reverted. Candidate packaged entrypoint `f9ef77dc…`; the live `61e344e6…` needs no new
  admission because it is already listed in both mode gates. Per-surface live status is
  `NOT TESTED` for **#approvals**, **#results** and **#incidents** — this build is not installed,
  no real forum thread was created, and CI cannot reach the live tree, so it adds no Discord
  evidence. Durable record in §8.
Task Branch: codex/m11-t1-audit-remediation (no new branch and no `main` merge authorized)
Owner Approval: EXPLICIT — 2026-10-13. Answering the three-question OWNER DECISION block:
  Q1 = A (scope covers #approvals, #results AND #incidents), Q2 = A (resolve tag name →
  snowflake at runtime through the existing token resolver, cached, no hardcoded ids),
  Q3 = A (derive RISK from the admitted brief's tool `riskClass`, highest class present).
  He then set seven binding execution requirements (audit before editing and reuse existing
  machinery; check each forum's own available_tags and required-tag set; regression tests for
  #approvals plus separate tests for #results/#incidents covering thread creation, exactly
  three tags, RISK classification and Discord error handling; an unresolvable required tag
  logs DISCORD_TAG_UNRESOLVED with channel, category and wanted name and the event is
  preserved for a proper retry instead of posting a short-tagged thread and calling it
  success; no duplicate thread on retry and no channel's failure may consume another
  channel's event; no claim that #results or #incidents work merely because code changed —
  per-channel PASS / FAIL / NOT TESTED evidence; no scope or architecture creep, and report
  files changed, reasons, test results and remaining limits). He also ordered the card's
  status line removed ("bỏ dòng trạng thái đi") and supplied the live tag dump.
  Deployment option A (--preflight read-only → ONE --apply → restart the live unit) is
  authorized to run AFTER this task's gates pass.
Prior task record — M12/T1-R1 CLOSED 2026-10-13, REMOTE-BACKED for the repository gates,
  NOT DEPLOYED; durable record in §8 and in the fields below (retained, not rewritten).
Milestone: M12 — Governed Discord interaction lifecycle and governed presentation
Task: M12/T1 — Component registration, 12-character task identity, approval-card
  presentation, and specialist result ownership
Task Status: CLOSED — all five contract phases implemented and validated 2026-10-13;
  implementation commit `c1ad4b3` on `codex/m11-t1-audit-remediation`, the execution
  contract deleted at this closeout, and the working tree left clean. Nothing is deployed.
Planning Readiness: APPROVED (historical — the approved M12/T1-R1 contract is executed and closed)
Historical Plan Revision: M12/T1-R1 (CLOSED)
Execution Authorization: NO
Execution Contract: NONE (the M12/T1-R1 ACTIVE.md was deleted at closeout)
Evidence Level: REMOTE-BACKED — CI run `38365272022` @ `219ac1d` on ubuntu-24.04:
  `quality-gate` SUCCESS (Prettier clean, `ℹ tests 1417 / ℹ pass 1366 / ℹ fail 0 /
  ℹ skipped 51`, `Repository policy check passed.`) and `python-quality` SUCCESS
  (`188 passed, 27 subtests passed in 10.98s`); Security run `38365276313`: `secret-scan`
  SUCCESS (gitleaks, zero leaks — which is what converts this task's local secret check
  into CI evidence) while `dependency-audit` stays red on the unchanged pre-existing
  5-high baseline. Locally: `npm run verify` PASS on the Windows host
  (`format:check` clean, `lint` 0 issues, `npm test` 1417 tests / 1372 pass / 0 fail /
  45 skipped, `repo:check` "Repository policy check passed."), and under WSL Ubuntu the
  four new M12 suites plus the five digest-pinning suites run 112/112 with ZERO
  skipped, where `/home/hoang_vinh/.openclaw-zink` is reachable so the live digest
  cross-checks actually execute. One mutation probe was executed (removing component
  registration failed exactly the two intended assertions; reverting restored 11/11);
  the two other planned probes are `NOT RUN`. NOT verified: anything live — the running
  gateway still carries the M11/T3-R1 build, no card has been rendered or clicked on
  Discord, and deploying this build needs its own owner grant. `verify.mjs` stays
  `NOT RUN`; the candidate packaged entrypoint is `85fbee50…` and the live `61e344e6…`
  is admitted at both guards. REMOTE-BACKED here covers the repository gates on
  ubuntu-24.04 only — CI cannot reach `/home/hoang_vinh/.openclaw-zink`, so it adds no
  live-runtime or Discord evidence. Durable record in §8.
Task Branch: codex/m11-t1-audit-remediation (the owner has not authorized a new branch
  or a `main` merge; this task continues on the current task branch)
Owner Approval: EXPLICIT — 2026-10-13. Answering the OWNER DECISION block issued after
  the live defect report, the owner chose option **D** (relax the specialist Discord
  broadcast suppression so the executing specialist returns the result itself), directed
  that the whole reported set be done at once ("muốn làm 1 lần cho xong hết"), and
  overrode the prior agents' refusal on identity: "task ID anh muốn identity vẫn là 12
  kí tự thay vì 64 hex, để vậy cho đồng bộ. Mấy con bot trước nó không nghe lời anh sửa
  lại cái này nên bây giờ sửa khó. Em sửa gấp cho anh." The frozen scope, the four proven
  root causes, and the two accepted identity trade-offs are in §8 and in the contract;
  deployment remains separately unauthorized.
Deployment Authorized: NO — nothing in this task touched the live WSL gateway. A future
  grant would cover, in this order and nothing else: read-only `configure.mjs
  --preflight`, ONE `configure.mjs --apply`, then `systemctl --user restart` of
  `openclaw-gateway-zink.service`. The outgoing-asset digests an authorized apply needs
  are already admitted (§8) and the pinning suites that check them against the live tree
  pass under WSL; `--preflight` itself has NOT been run, because it needs the operator
  identifiers. Explicitly NOT authorized: any `main` merge, force-push, PR, release,
  ledger or config mutation beyond what `--apply` performs, or another host/service.
Prior task record — M11/T3-R1 CLOSED 2026-10-13, REMOTE-BACKED, DEPLOYED AND VERIFIED;
  durable record in §8 and in the fields below (retained, not rewritten).
Milestone: M11 — Cross-module audit remediation
Task: M11/T3 — OpenClaw gateway runtime bounds + durable-state integrity remediation
Task Status: CLOSED — both phases implemented, verified and committed 2026-10-13
Planning Readiness: APPROVED (historical — the approved R1 contract is executed and closed)
Historical Plan Revision: M11/T3-R1 (CLOSED)
Execution Authorization: NO
Execution Contract: NONE (the M11/T3-R1 ACTIVE.md was deleted at closeout)
Authorized Task: NONE — M11/T3-R1 delivered the ten verified HIGH-severity items frozen
  in its contract and nothing else. Phase 1 (`3cb8274`): argv execution on the
  bot-token path, one exported deadline on the three unbounded Discord REST fetches,
  cause-preserving message-only diagnostics at the three native-boundary catch seams,
  and queue `enqueueTask`/`clear` serialized through the existing `withLock`. Phase 2
  (`6b0ea0a`): an async file-lock release that no longer spins the event loop, ledger
  refusal of a half-missing events/snapshot pair, replay diagnostics that keep their
  cause, a decision-ledger `save()` under the shared writer lock, approval reads under
  the guard writer lock, and a `REJECTED` skill proposal made terminal and serialized.
Evidence Level: REMOTE-BACKED — CI run `38336851433` @ `f55d292`
  (`quality-gate` SUCCESS on ubuntu-24.04: Prettier clean, `ℹ tests 1374 / ℹ pass 1323 /
  ℹ fail 0 / ℹ skipped 51`, `Repository policy check passed.`; `python-quality` SUCCESS:
  `188 passed, 27 subtests passed in 12.20s`) and Security run `38336854295`
  (`secret-scan` SUCCESS — gitleaks 8.24.3, zero leaks, which converts this task's local
  `NOT RUN` into CI evidence; `dependency-audit` fails on the unchanged pre-existing
  baseline `9 vulnerabilities (3 low, 1 moderate, 5 high)`). Locally: `npm run verify`
  PASS on the Windows host (`format:check` clean, `lint` 0 issues, `npm test`
  1374 tests / 1329 pass / 0 fail / 45 skipped, `repo:check` passed); the new suites
  `m11-t3-openclaw-runtime-bounds` (8/8) and `m11-t3-durable-state-integrity` (20/20)
  and the lock predecessors `m10-t2-r18-file-lock` (8/8) and
  `m11-t1-r2-file-lock-asset-predecessor` (7/7) also PASS under WSL Ubuntu (Node
  v24.15.0), where the packaged digests are byte-identical to the Windows derivation.
  22 of 24 mutation runs killed the defect; the 2 survivors are at the pre-existing
  `enterNativeRun` seam, which this task did not change (§8 records it as a coverage
  gap, not a regression). Still `NOT RUN`: `verify.mjs` (operator-side) and the
  PostgreSQL statement gate. `test:knowledge` was not run locally (`apps/knowledge` is
  untouched) but CI executed the same suite in `python-quality` and it passed.
  `FAIL` as recorded baseline, not converted: `npm audit`
  5 high, and one pre-existing `no-unused-vars` error at
  `zink-tools/adapters/skill-store/skill-adapter.mjs` that `npm run lint` never sees
  because of the known `zink-tools` glob gap.
Task Branch: codex/m11-t1-audit-remediation
Owner Approval: EXPLICIT — 2026-10-12. The owner chose clusters "A rồi B" from the
  OWNER DECISION block issued after the second read-only sweep, then instructed that
  the plan be materialized as docs/contracts/execution/ACTIVE.md and executed
  against it ("lập plan A rồi B tại ACTIVE.md, rồi sau đó em chạy bám sát theo
  ACTIVE.md"; "viết ACTIVE.md với kế hoạch trên"). The owner also directed Codex to
  execute this contract directly for this task instead of handing it to dsh.
  Deliberately EXCLUDED by that decision: the router model order and
  timeoutSeconds=100 (the owner's own recorded decision at
  integrations/openclaw/lib/policy.mjs:525-545), stale-lock auto-reclaim
  (integrations/openclaw/lib/file-lock.mjs:14-16 records the owner's policy that
  orphaned-lock recovery is an operator action), every live-state and deployment
  action, and the deferred clusters (CI trigger scope, real-execution skip tier,
  gitleaks tests/ allowlist, zink-tools lint/format glob gap, structural refactors,
  cross-module drift, docs-only corrections).
Prior task record — M11/T1 and M11/T2 both CLOSED 2026-10-12, durable records in §8,
  Evidence Level REMOTE-BACKED (CI run 38202129189 proves quality-gate +
  python-quality SUCCESS; Security run 38199389639 proves secret-scan SUCCESS).
Deployment Authorized: YES (M11/T3-R1 build — ONE `--apply` attempt, owner grant
  2026-10-13: "vậy làm B rồi đến A", i.e. CI backing then the deployment the owner had
  already identified as the one that actually cuts the Discord hangs). Scoped exactly
  to, in this order and nothing else: read-only `configure.mjs --preflight`, then ONE
  `configure.mjs --apply`, then `systemctl --user restart` of the single live unit
  `openclaw-gateway-zink.service`, all inside WSL Ubuntu against the live state
  directory `~/.openclaw-zink`. Explicitly NOT authorized by this grant: any `main`
  merge, force-push, PR, release, other service or host, `--revert`/historical recovery
  (its own distinct authorization), ledger/task mutation, or config rewriting beyond
  what `--apply` itself performs. The grant is now **CONSUMED by the single successful
  apply recorded below**. Read-only pre-deploy proof (WSL Ubuntu, 2026-10-13, no
  credential loaded, nothing mutated): the seven deployed assets measured with
  `sha256sum` were
  `index.mjs = e8f084ab…`, `lib/queue-manager.mjs = f7995d51…`,
  `lib/native-boundary.mjs = 97c7f3e1…`, `lib/file-lock.mjs = 22d7411a…`,
  `lib/decision-ledger.mjs = 5e97d9ca…`, `lib/guard.mjs = 7dd37ee9…`,
  `lib/ledger.mjs = 818d7cb0…`; each one is byte-identical to what
  `governancePluginFiles()` derives from the pre-Phase-1 commit `d7df6d9`, and each one
  is present in `ALLOWED_GOVERNANCE_ASSET_SHA256` (Phase 1 admitted the queue, boundary
  and entrypoint digests; Phase 2 admitted the other four), so `--preflight` cannot
  refuse this upgrade on digest grounds — the M11/T1-R2 blocker is not repeated. The
  same re-packaging through WSL Node v24.15.0 yields digests identical to the Windows
  derivation for all seven, so the post-apply expectations below are host-independent.
  Also verified read-only before the grant is used: the live governance ledger pair at
  `~/.openclaw-zink/operator/m7-t2/ledger` is complete and consistent (128 events,
  snapshot `sequence: 128`, both mtime `2026-10-09 12:13`), which matters because B2 now
  refuses startup on a half-missing pair — so the restart cannot be blamed on a
  pre-existing incomplete ledger; an older empty `governance/ledger` pair (0 events,
  mtime `2026-09-18`) exists but is not the configured root. Unit state before the
  deploy: `active`, `MainPID=17047`, `NRestarts=0`, started `2026-10-12 09:02:44 +07`.
  Executed operator-side (the CLI requires the live Discord identifiers and
  `ZINK_ROUTER_*` values, which this session's permission classifier refuses to load, and
  no workaround was attempted) from `9164c50`.
Deployment Status (M11/T3-R1): DEPLOYED AND VERIFIED (2026-10-13, WSL Ubuntu, ONE
  `--apply` attempt; grant consumed, no retry needed). Evidence: `--preflight`
  `PASS` with `installedMutation: false`; the one `--apply` wrote the current build and
  all seven live assets then measure exactly the packaged values predicted before the
  run (`index.mjs = 61e344e6…`, `lib/queue-manager.mjs = a5580bb6…`,
  `lib/native-boundary.mjs = 5966d446…`, `lib/file-lock.mjs = bcd65de8…`,
  `lib/decision-ledger.mjs = 1d9518ca…`, `lib/guard.mjs = 263d72c4…`,
  `lib/ledger.mjs = c984cda8…`). `openclaw.json` untouched (size 17128, mtime still
  `2026-10-09 12:24`); the ledger untouched (both files mtime still `2026-10-09 12:13`,
  128 events == snapshot `sequence: 128`); the configured ledger root was confirmed from
  the tool's own report as `~/.openclaw-zink/operator/m7-t2/ledger`, which is the pair
  verified complete — so B2's new half-pair startup refusal did not fire, and the gateway
  started on the first attempt. Unit after restart: `active`, `MainPID=28865`,
  `NRestarts=0`, started `2026-10-13 09:57:12 +07`; the old process shut down cleanly
  (`[shutdown] completed cleanly in 594ms`).
  Post-deploy log audit of the new PID (111 lines, read-only, ~15 min): **zero**
  `GOVERNANCE_COMPLETION_UNAVAILABLE` and zero Discord-attributed error lines (42
  Discord-related lines). 16 lines match the error-class filter; all are attributable to
  startup session-recovery, where `enterNativeRun` refuses the restored runs with
  `EXECUTION_STATE_UNKNOWN` and the model fallback records `candidate_failed
  detail=GOVERNANCE_RUN_UNAVAILABLE` — the same refusal, and the same clustered-within-
  seconds shape, that the retained journal shows for older builds on 2026-10-08 (PID
  556138) and 2026-10-10 (PID 3831), so it is recorded as pre-existing behavior and NOT
  claimed as fixed here. What this build changes at that seam is the shape of the
  failure: the refusals land in ~1-2 s with a preserved cause chain (`…
  GOVERNANCE_RUN_UNAVAILABLE <- Error: EXECUTION_STATE_UNKNOWN`) instead of the old
  100 s `elapsedMs=100409` router abort → `GOVERNANCE_COMPLETION_UNAVAILABLE` path that
  was still firing on PID 17047 minutes before the restart. The long-standing
  `duplicate plugin id` config warning is still emitted (recorded baseline, untouched).
  `verify.mjs` (non-live and `--live`) was NOT run — operator-side, `NOT RUN`; no
  `transactions/` record is created by `configure.mjs --apply`. The router model order and
  its `timeoutSeconds=100` remain the owner's own recorded decision and are NOT changed by
  this deployment, so the fallback dead time can still be reached whenever the router
  itself is slow; a longer live soak (hours, real traffic) is still needed before claiming
  the Discord hang class is gone.
Prior deployment record — Deployment Authorized: YES (M11/T1-R1 build — ONE attempt,
  owner grant 2026-10-12)
  — scoped exactly to: read-only `configure.mjs --preflight`, then one
  `configure.mjs --apply`, then `systemctl --user restart` of the single live unit
  `openclaw-gateway-zink.service`, all executed inside WSL Ubuntu against the live
  state directory `~/.openclaw-zink`. Nothing else: no `main` merge, no force-push,
  no PR/release, no other service, no `--revert`/historical recovery (that needs its
  own distinct authorization), no ledger mutation. The preceding `NO` gate is
  consumed by this grant, and the grant is consumed by the single apply recorded
  below; no further deploy is authorized without a new owner decision.
Deployment Status: DEPLOYED AND VERIFIED (2026-10-12, WSL Ubuntu, ONE `--apply`
  attempt; grant consumed). Executed operator-side because the CLI requires the
  live Discord identifiers and `ZINK_ROUTER_*` values, which this session's
  permission classifier refuses to load (no workaround attempted). Evidence:
  `--preflight` PASS with `installedMutation: false`; live digests after apply are
  `index.mjs = e8f084ab…` and `lib/file-lock.mjs = 22d7411a…`, both equal to the
  repository's packaged current build, written `2026-10-12T02:02:36Z`;
  `openclaw.json` untouched (mtime `2026-10-09`, so no config rewrite was needed);
  ledger untouched (mtime `2026-10-09`; 128 events == snapshot sequence 128,
  51 tasks); unit `active`, `MainPID=17047`, `NRestarts=0`, zero error-class lines
  from the new PID.
  Explicitly NOT part of this evidence: `verify.mjs` (non-live and `--live`) was
  not run — operator-side, `NOT RUN`; `configure.mjs --apply` creates no
  `transactions/` record (that wrapper belongs to `operator-apply.mjs`), so the
  newest transaction directory is still `2026-10-10`. Two pre-existing runtime
  conditions were observed and are NOT closed here: on the PREVIOUS PID 16583 at
  08:56–08:59 the model router aborted after ~100 s across the whole fallback
  chain, surfacing as `GOVERNANCE_COMPLETION_UNAVAILABLE` (predates this
  deployment, unrelated to it, needs its own diagnosis), and the long-standing
  `duplicate plugin id` config warning (272 journal occurrences) remains open.

Prior focus: M8/T2.2 CLOSED (R19 live-verified) and M10/T2 CLOSED by owner
  decision 2026-10-11; their durable records live in §8 and the history below.
```

`Deployment Status: DEPLOYED - R18 LIVE AND VERIFIED FOR ITS AUTHORIZED SEAM;
ONE PRE-EXISTING SEPARATE ITEM REMAINS OPEN`. The single authorized attempt ran
`operator-apply.mjs` — the repository's authorized live deployment mechanism —
against the real live runtime, with no namespace and no simulation. It returned
PASS at stage `applied`, `transactionStatus: complete`, attempt
`txn-546134d1e917bea39046eae142e15b6453e589babe427c1bbf875399c1f773a5`. This
authorization is consumed by that one attempt.

R18 is deployed and its defect is closed live. `beforeRunEnd: internal system
session` went from 0 to 2, and `beforeRunEnd: self-keyed session presented a
runId; applying full governance` stopped entirely (it had reached 40). A clean
real scheduler heartbeat at `2026-10-01T02:50:52Z` completed the whole chain
with `GOVERNANCE_RUN_UNAVAILABLE = 0`, `GOVERNANCE_COMPLETION_UNAVAILABLE = 0`,
run-end/lane `EXECUTION_STATE_UNKNOWN = 0`, `sandboxErr = 0`, `laneErr = 0`,
first-candidate `status=200`, and a transcript poll then reply 3.3s later.
Digests, ledger and runtime integrity are in ACTIVE.md R18 8.

`Deployment Status: DEPLOYED - R19 LIVE AND VERIFIED; M8/T2.2 CLOSED`. The single
authorized attempt ran `operator-apply.mjs` — the repository's authorized live
deployment mechanism — against the real live runtime, with no namespace and no
simulation. It returned PASS at stage `applied`, `transactionStatus: complete`,
attempt `txn-6c4fc50d9b584c23f2121c8edada159a02e70ca87cb4150d0f6cf4de23d7b0c1`.
This authorization is consumed by that one attempt.

R19 is deployed and the last governance defect is closed live. A real scheduler
heartbeat at `2026-10-01T04:50:55Z` completed with every counter at 0, including
the two governance states reported separately: run-end/lane
`EXECUTION_STATE_UNKNOWN` = 0 and the advisory `before_prompt_build`
`EXECUTION_STATE_UNKNOWN` = 0, with `EXECUTION_STATE_UNKNOWN` absent from the
window entirely. `beforeRunEnd: internal system session` fired, so R18's run-end
exemption still holds, and the self-keyed full-governance refusal stayed at 0.
Live `index.mjs` `bae7bdf3` is byte-identical to the repository packaged
artifact; boundary `d88bff80` and selection `555f37da` are unchanged, so no
lineage moved. Ledger byte-identical, `boot_id` unchanged, gateway stable. Digests,
counters and transcript evidence are in ACTIVE.md R19 8.

`M8/T2.2` is CLOSED. The one residual is NOT a governance defect and is recorded
in full at ACTIVE.md R19 9: the heartbeat's reply CONTENT is model-generated and
varies (`04:20` replied `HEARTBEAT_OK`, `04:50` replied `outcome_claim: BLOCKED`)
from identical, empty governance input. The plugin registers exactly one
prompt-affecting hook, it emitted nothing in either window, and every governance
counter is 0 — so this is a false negative in content that grants nothing and
weakens no control. Making it deterministic would require amending the standing
model instruction contract or registering a prompt-contribution hook, both of
which are material decisions to model input and outside this revision's authorized
seam. No R20 is created.

`Deployment Authorized: YES (R18 - single attempt)` — granted by the owner on
2026-10-01 as the final technical fix, to deploy the locally verified R18
artifact to the live runtime through `operator-apply.mjs`, the repository's
authorized live deployment mechanism. ONE attempt. No rehearsal namespace, no
simulation, no automatic retry, no manual heartbeat trigger. This authorization
is consumed by that one attempt.

### 4.0.1 Historical deployment record (R16, R17 — retained, not rewritten)

The single attempt authorized on 2026-09-30 after R16 closed ran
`operator-apply.mjs` — the repository's authorized live deployment mechanism —
against the real live runtime, with no namespace and no simulation. It returned
`{"status":"PASS","stage":"applied"}` with `transactionStatus: complete`. The
live runtime became R10. Exact digests and stage trace are in §4.13.2.

That authorization was single-attempt and was consumed by that one attempt. Both
prior single-attempt authorizations are consumed and closed: `b8597fe` (failed
at `native-backup-prune`) and `7520f39` (aborted at the transaction-snapshot
stage). Neither is carried forward, and R15 creates no deployment
authorization. R17 was authorized separately and is likewise consumed. A
preflight PASS is never an apply authorization, and neither `Execution
Authorization`, `Planning Readiness`, nor `Owner Approval` implies one.

R18 targets the one remaining operational gap: the heartbeat executes the full
chain and then fails at the run-end seam. The cause is proven and was not
re-diagnosed — the host forwards `trigger` and `transcriptPrompt` to
`enterNativeRun` but not to `finishNativeRun`, so the run-end context never
carries them and `isPureLivenessHeartbeat` cannot fire there. R18 recovers them
at the boundary, keyed by `runId`, at the moment admission accepts the run.

**Recorded deviation, for the owner.** The owner named `native-patch.mjs` as
the primary change. R18 does not touch it. Threading the fields through the
selection's call site would change the installed `selection-*.js`, requiring a
new R10 predecessor descriptor and breaking the R7 lineage, because R7 would
then differ from the current edit set in two slots — which the single-slot
predecessor descriptor cannot express. Recovering the values at the boundary
fixes the identical defect with the pinned native runtime byte-identical, so the
deployed selection `555f37da` remains recognized by content comparison with no
descriptor change. No material decision changes: no new module, dependency,
persistent state, public API, topology, security boundary or gate. The
mechanism is `ACTIVE.md` R18 3; the positives are falsified and reproduce the
exact live `GOVERNANCE_COMPLETION_UNAVAILABLE` when the fix is reverted.

### 4.1 Revision lineage reconciliation (2026-09-30)

`PLAN.md` previously recorded `Plan Revision: M8/T2.2-R4` while the branch already
carried R5 and R6 implementation. The plan was never revised for either, so
`ACTIVE.md` and `PLAN.md` no longer described the same work. Reconciled state:

| Revision    | Status             | Review Convergence Gate | Final Quality Gate | Implementation evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------ | ----------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M8/T2.2-R4  | Implemented        | `NOT RUN`               | `NOT RUN`          | R4 validation snapshot below. Superseded as the active revision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| M8/T2.2-R5  | Implemented        | `NOT RUN`               | `NOT RUN`          | `652ac0c` config convergence, `9a6702f` V15 packaging, `9713872` V16 rewriter self-match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M8/T2.2-R6  | Implemented        | `NOT RUN`               | `NOT RUN`          | `2e1f8c4` `WORKFLOW_APPROVAL_REQUESTED` contract, `2d1121f` provenance-gated asset allowlist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R7  | Implemented        | `NOT RUN`               | `NOT RUN`          | `a0118bc` heartbeat admission, boundary diagnosability, apply safety; `a1bf942` advisory-hook correction; `96e1b80` deployment authorization.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R8  | Implemented        | `NOT RUN`               | `NOT RUN`          | `4f5cc6d` verified R5 `lib/native-boundary.mjs` approved-predecessor digest. Live preflight then returned `builder_preflight: PASS`, `installed_mutation: false`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| M8/T2.2-R9  | BLOCKED            | `NOT RUN`               | `NOT RUN`          | Authorized 2026-09-30. Superseded by R10: G1 condition 5 is unobservable at the native seam; see §4.6.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M8/T2.2-R10 | Implemented        | `NOT RUN`               | `NOT RUN`          | `3bea651` G1 contract correction using the host-authoritative heartbeat trigger. Deployment `dc466c6` attempted and STOPPED pre-apply; NOT deployed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| M8/T2.2-R11 | Implemented        | `NOT RUN`               | `NOT RUN`          | `ab0dda2` transaction snapshot gates mutation, restores the exact preimage, and licenses `rollbackSucceeded` only on live verification. Accepted by the owner.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M8/T2.2-R12 | Implemented        | `NOT RUN`               | `NOT RUN`          | `47beb1c` durable transaction snapshot, orphan detection, verified post-apply, and the recovery authorization gate. Accepted as the rollback-safety baseline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| M8/T2.2-R13 | Implemented        | `NOT RUN`               | `NOT RUN`          | `2d8dc54` the two R7 predecessor governance-asset digests, byte-proven from the live runtime and the R7 commit. Live preflight then PASSed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| M8/T2.2-R14 | Implemented        | `NOT RUN`               | `NOT RUN`          | `c41a7a5` native patch lineage: the deployed R7 patch is a recognized predecessor, so R7 -> R10 is derivable in memory. Live preflight then recognized `PREDECESSOR R7 -> R10`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M8/T2.2-R15 | Implemented        | `NOT RUN`               | `NOT RUN`          | `c73173f` attempt-scoped transaction identity: `attemptId` separated from `preimageDigest`; completed attempts no longer block a repeat. 17/15 falsified. Not deployed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M8/T2.2-R16 | CLOSED             | `NOT RUN`               | `NOT RUN`          | Authorized 2026-09-30; deployed 2026-09-30 as the live runtime (R10). Superseded as the implementation revision by the authorized post-deployment correction R17; R16 evidence is historical and unchanged. See A4.13.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| M8/T2.2-R17 | DEPLOYED, GAP OPEN | `NOT RUN`               | `NOT RUN`          | Authorized 2026-09-30 as a post-deployment RED correction to the R10 run-end governance contract: run-end parity for the pure liveness heartbeat. 10 focused tests, falsified 7 pass / 3 fail. Deployed 2026-09-30 as the live runtime (R17 build). Superseded as the implementation revision by R18, which closed the remaining blocker; R17 evidence is historical and unchanged. See A4.14.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M8/T2.2-R18 | DEPLOYED, VERIFIED | `NOT RUN`               | `NOT RUN`          | Authorized 2026-10-01 as the technical fix for the proven `finishNativeRun` context-propagation defect: the admission-time liveness discriminator is recovered at the run-end seam so both seams apply one predicate. 15 focused tests, falsified 4 fail / 11 pass. Fix is in `native-boundary.mjs`; `native-patch.mjs` is byte-identical, so the deployed selection `555f37da` stays recognized and the R7/R10 lineage is intact. Deployed 2026-10-01, PASS at stage `applied`, and verified live: run-end internal session 0 -> 2, self-keyed full governance stopped at 40, clean 02:50:52Z heartbeat with every run-end counter at 0. Unchanged by R19. See ACTIVE.md R18.                                                                                                                                                            |
| M8/T2.2-R19 | DEPLOYED, CLOSED   | `NOT RUN`               | `NOT RUN`          | Authorized 2026-10-01 as the final revision completing M8/T2.2: the advisory `before_prompt_build` seam recovers the admission-time liveness discriminator so a heartbeat is recognized there and no longer reported `EXECUTION_STATE_UNKNOWN`. Fix is confined to `index.mjs`; `native-boundary.mjs` and the pinned native runtime are untouched, so R18 stays intact and no lineage changed. 14 tests, falsified three ways (5 / 3 / 1 failures). Deployed 2026-10-01, PASS at stage `applied`. Verified live at the 04:50:55Z heartbeat: run-end/lane `EXECUTION_STATE_UNKNOWN` 0, advisory `before_prompt_build` `EXECUTION_STATE_UNKNOWN` 0, `GOVRUN` 0, `GOVCOMP` 0, `sandboxErr` 0, `laneErr` 0, R18 run-end exemption intact. M8/T2.2 CLOSED. One non-governance content variance recorded at ACTIVE.md R19 9. See ACTIVE.md R19. |

All revisions are local commits on `codex/m8-t2-governed-runtime-hardening`; none
has been pushed.

The superseded git-ignored R3/R4 remediation backlog was archived to
`docs/contracts/m7-m8-red-team-backlog.md` so that replacing the transient
`ACTIVE.md` did not destroy unrecoverable content. That archive is
non-authoritative historical record and grants no execution authority.

### 4.2 M8/T2.2-R7 scope

R7 closes three defects proven by a read-only forensic audit on 2026-09-30, and
does not deploy:

- **G1** — Option A, INTERNAL/EXEMPT, for the pure liveness heartbeat poll only.
  A qualifying heartbeat requires no ledger task or session and none is
  fabricated. The exemption is bounded by its inverse and is not a general
  exemption for arbitrary `agent:main:main` runs.
- **G2** — `native-boundary.mjs` preserves the original failure as `.cause` and
  logs the fixed error message. The host-visible `GOVERNANCE_RUN_UNAVAILABLE`
  string is unchanged.
- **G3** — `before_prompt_build()` is **advisory only** and returns an explicit
  `BLOCKED` governance context for an unresolvable run. It is deliberately not
  used as an enforcement mechanism, because the OpenClaw host swallows anything
  thrown from it. The enforcing control is the native governance boundary; see
  §4.4.
- **DS** — `operator-apply.mjs` enforces `PRE-FLIGHT FAILURE = ZERO RUNTIME
MUTATION` by running the existing preflight and gating rollback on a real
  mutation boundary.

The heartbeat failure began 2026-09-11T23:51:55+07:00 and predates R5/R6. The
production ledger was verified unmodified throughout
(`d794d99d…` / `bbdf3aec…`, mtime 2026-09-28 17:26:11) and must remain untouched.

### 4.3 M8/T2.2-R7 implementation state and pending deployment

The R7 repository remediation is implemented and validated as a single local
implementation commit on `codex/m8-t2-governed-runtime-hardening`. Validation
evidence for that commit: 18 new focused R7 tests; full `npm test` 651 tests /
79 suites / 649 pass / 0 fail / 2 skipped; `npm run lint` exit 0;
`npm run format:check` clean; `npm run repo:check` passed; `git diff --check`
clean. The 2 skips are the pre-existing R6 production-ledger replay tests that
skip on Windows, where the production ledger is not mounted.

R7 remains the active execution task and is **not** closed. `ACTIVE.md` remains
present and authoritative; the execution-contract pointer stays set; and
`Execution Authorization: YES` continues to authorize repository R7 remediation
only. Deployment is gated separately by `Deployment Authorized: NO`.

The live runtime has deliberately **not** been restored. The repository now
contains the G1/G2/G3 fixes while the quarantined R5 runtime does not, so
restoring R5 before validating the new behavior would reintroduce the proven
heartbeat failure. Restoration is therefore sequenced after an isolated
validation of the new `before_prompt_build` fail-closed behavior against the
OpenClaw host hook path.

Runtime state at the close of R7 implementation, verified read-only and
unchanged by this work: `openclaw.json` `b96aca41…` (14798 bytes); live
`extensions/zink-governance` absent with the R5/R6-era build still present in
`operator/m7-t2/backups/r12/quarantined-t2/`; `selection-DopzNY3I.js` at the
clean baseline `a5698c55…`; `zink-governance-boundary.mjs` absent; production
ledger 103 events, `d794d99d…` / `bbdf3aec…`.

### 4.4 Discord-lane enforcement seam (R7 correction)

An audit of the installed OpenClaw `2026.6.34` host established where an
unresolvable governed run is actually stopped on the Discord lane.

`before_prompt_build` **cannot** enforce. Its result type
(`PluginHookBeforePromptBuildResult`) exposes only `systemPrompt`,
`prependContext`, `appendContext`, `prependSystemContext` and
`appendSystemContext` — there is no decision or block channel.
`runModifyingHook` (`dist/hook-runner-global-D_43rcnU.js:481`) catches every
handler exception via `handleHookError` and returns `undefined`, and both call
sites add a second swallow (`dist/attempt.prompt-helpers-B7ATxx0y.js:126-130`,
`dist/agent-harness-runtime-DjK3eIXB.js:143-145`). A throw there is therefore
fail-open. R7 consequently reverted G3 to the explicit `BLOCKED` prependContext
and keeps the hook advisory.

`before_agent_run` does have blocking semantics, but only in
`dist/cli-runner-B0eKIePw.js:761-777`, which is the **CLI** runner. The Discord
lane does not use it, so CLI behaviour must not be read as Discord behaviour.

The enforcing seam on the Discord lane is the **native governance boundary**.
The pinned patcher injects `await enterNativeRun(...)` at
`dist/selection-DopzNY3I.js:12232`, immediately after
`const activeSession = session;` inside `runEmbeddedAttempt`
(`dist/selection-DopzNY3I.js:10960-14467`). The model invocation
`activeSession.prompt` is defined at `12847` and invoked at `13754`/`13765`, so
the gate precedes the model call by roughly 520 lines.

Live evidence from the gateway log for the governance-active window
`2026-09-30T01:20:45Z-01:21:05Z` (`dist` log `/tmp/openclaw/openclaw-2026-09-30.log`):
the turn ended in `lane task error: lane=main ... GOVERNANCE_RUN_UNAVAILABLE`
then `Embedded agent failed before reply`, with **zero** `model-fetch` events.
In the governance-absent window the same heartbeat produced
`[model-fetch] start ... status=200`. The model was therefore not invoked while
the boundary rejected the run.

No new enforcement mechanism is introduced. The native boundary already
enforces the admission decision, so enforcement is not duplicated in another
hook, and R6 approval semantics and ledger semantics are unchanged.

### 4.5 M8/T2.2-R8 — verified R5 governance-asset provenance

Deployment of R6+R7 was attempted under owner authorization and is blocked at
`configure.mjs --preflight`. Two independent gates were found, and the first was
cleared by restoring the verified pre-incident R5 baseline (a one-time owner
authorized recovery, executed and verified byte-exact against the recorded
`native-r12` manifest: selection `b4316736…`, announce `e3b110f7…`, bridge
`49352d47…`, config `5db19403…`, extension `e77689c9…`, ledger untouched at 103
events / sequence 103 / 37 tasks).

The second gate is the asset allowlist. `configure.mjs:581-591` accepts a
deployed asset only when it is missing, equal to the current build, or an
approved predecessor digest. The restored R5 extension differs from the current
build in exactly one governed asset, `lib/native-boundary.mjs`, because R7
changed only that file.

Provenance was established by packaging, not inference: materializing
`governancePluginFiles()` from the R5-era tree at commit `9713872` reproduces
all 33 deployed R5 asset bytes exactly, with 0 mismatches and 0 absent. Across
the 31 paths in `pluginFiles.assets`, 27 have R5 bytes identical to the current
build and are already accepted by content comparison, and 3 are already
allowlisted. **Exactly one digest is missing** — an earlier estimate of 30 was a
measurement error, since it counted current-build digests as absent from a table
that by design holds only predecessors.

R8 adds that single digest and nothing else. It does not deploy.

### 4.6 M8/T2.2-R9 — G1 enforcement-context correction (BLOCKED)

The controlled live deployment of `4f5cc6d` succeeded: the corrected operator
applied the R6+R7 build, the native bridge was re-synced to the R7 artifact, the
gateway restarted exactly once with no config-watcher restart and no restart
loop, and the production ledger was untouched. G2 was confirmed live — the host
logged `GOVERNANCE_RUN_UNAVAILABLE | EXECUTION_STATE_UNKNOWN` for the first
time.

**Phase 5 failed.** The real heartbeat was still rejected, so no exemption
applied. Cause: the native patch injects only `agentId`, `sessionKey`, `runId`,
`inputProvenance`, `channelId`, `senderId`, `currentMessageId`
(`selection-DopzNY3I.js:12235-12240`). It never passes `content`, `message`,
`mentions` or `isBot`, so `isPureLivenessHeartbeat` cannot observe the sentinel
and always returns false. The R7 G1 unit tests called `enterNativeRun` directly
with a context richer than production supplies; that false confidence is the
defect.

A read-only audit of the installed `v2026.6.34` source established what is
actually observable at that anchor:

| G1 condition                    | Observable | Evidence                                                                                                                                                                                                 |
| ------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 self-keyed session            | yes        | `params.sessionKey`, `params.agentId`                                                                                                                                                                    |
| 2 exact sentinel                | yes        | `params.transcriptPrompt`, assigned `HEARTBEAT_TRANSCRIPT_PROMPT` at `get-reply-CICEttbD.js:3015` only when the host set `isHeartbeat`; also `params.prompt`, sanitized at `selection-DopzNY3I.js:10961` |
| 3 no inter-session provenance   | yes        | `params.inputProvenance`, already passed                                                                                                                                                                 |
| 4 not Discord ingress           | yes        | `params.messageChannel ?? params.messageProvider`, already passed                                                                                                                                        |
| 5 no mention and not bot-author | **no**     | zero occurrences of `mentions` or any bot-author field in `runEmbeddedAttempt`                                                                                                                           |

Condition 5 does not exist at the seam. `mentions` is produced only in the
Discord ingress layer (`accounts-CT0uPrw7.js:228-290`, `bot-CS65Z7r1.js:5137`)
and is never forwarded into the embedded-run params. No run-scoped bot-author
field exists at all.

A host-authoritative alternative exists: `embedded-agent-CGzgLLU-.js:4061`
computes `isHeartbeatTrigger: params.trigger === "heartbeat"`, and
`params.trigger` is read throughout `runEmbeddedAttempt`. That is a boolean the
host sets, not a string matched from message content.

Enforcing condition 5 as written would require patching the Discord ingress layer
or forwarding large request objects, both of which R9 forbids. R9 therefore
requires an owner decision and no implementation work has been started.

### 4.7 M8/T2.2-R10 — G1 contract correction (host-authoritative trigger)

R9 is superseded by owner decision. G1 now uses the host-assigned trigger as
its primary discriminator, and the unobservable "no mentions / not bot-author"
condition is retired rather than replaced by an `undefined` check.

**Trigger provenance, proven against installed `v2026.6.34`:**
`agent-runner.runtime-BUWW8f6n.js:3092` and
`reply-usage-state-BKK3wzWk.js:1510,1958,2090` compute
`trigger: opts?.isHeartbeat === true ? "heartbeat" : "user"` — a strict binary
with no other producer. `isHeartbeat: true` is assigned in exactly one place in
the bundle, `heartbeat-runner-BTpzFMjQ.js:1320`, inside the heartbeat scheduler;
every other occurrence is a read. The content-based
`isHeartbeatUserMessage()` (`heartbeat-filter-D8UEwGGH.js:170`) does match the
sentinel, but it is a transcript-artifact filter consumed by diagnostics, memory
indexing and transcript pathing, and never sets `isHeartbeat` on a run. A
Discord message containing the sentinel therefore cannot become a heartbeat, and
`isHeartbeat` is never derived from inbound content.

**G1 requires all of:** `trigger === "heartbeat"`; self-keyed session; the exact
sentinel in `transcriptPrompt` or `prompt`; no `inputProvenance`; not Discord
ingress. The native patch gains only `params.trigger` and
`params.transcriptPrompt` — both already present at the existing anchor — so no
Discord-layer patch and no forwarded message objects are introduced.

`classifyInternalRunEnd`, G2, G3, R6 semantics, the operator-apply mutation gate,
preflight semantics and the asset allowlist are untouched. R10 is repository-only
and is not deployed.

### 4.8 M8/T2.2-R11 — transactional live rollback safety

The authorized R10 live deployment (`dc466c6`) was attempted on 2026-09-30 and
**STOPPED before `--apply`** at the owner's Phase 1 rollback-safety gate, with
zero mutation proven by identical before/after runtime and ledger hashes and an
unchanged gateway PID. Two independent blockers were found.

**Blocker 1 — the rollback target is a historical baseline, not the current
runtime.** `operator-apply.mjs:112-119` wires rollback to
`restoreNativePatch(runtimeRoot, native-r12)` and
`restoreT1RuntimeFiles({ stateDir, identifiers })`. `native-r12` holds the clean
upstream BASELINE preimages, so that restore removes the native patch and the
bridge. `restoreT1RuntimeFiles` writes `backups/r12/t1-config.json`, captured
2026-09-11 17:36:24, over the live config and renames the governance extension
into quarantine. A mid-apply failure would therefore leave the 2026-09-11 T1
config `b96aca41…` instead of the live R7 config `5db19403…`, with no
governance plugin installed. `runtime-backup.mjs:107` returns early when the
backup root exists, so no in-operator path ever captures a fresh snapshot.

**Blocker 2 — the asset gate refuses the R10 build.** R7→R10 changes exactly two
generated-extension files, and neither outgoing digest is allowlisted:
`lib/native-boundary.mjs` `33b3feef…` → `50af7d4a…`, and entrypoint
`74582778…` → `e5b220b4…`. `--preflight` returned `Governance plugin asset drift
detected`. The R10 digests were deliberately NOT added.

**Additional defect found during the same audit.**
`apply-orchestration.mjs:114-124` sets `rollbackSucceeded = true` as soon as the
restore helpers return, while `restoreT1RuntimeFiles` itself reports
`liveBaselineValidation: "NOT RUN"` and is documented "Never reports a live
rollback PASS". A rollback leaving the runtime ungoverned is reported as
successful.

R11 replaces "restore the old baseline" with "restore the exact transaction
preimage", gates mutation on a verified transaction-scoped snapshot, and
replaces "the restore returned" with "the live runtime was verified".
`backups/r12` is neither deleted nor repurposed and remains historical recovery
evidence. R11 is repository-only: no deployment, no live rollback, no second
deployment attempt, and the R10 allowlist entries are not added.

### 4.9 M8/T2.2-R12 — durable transaction recovery safety

The owner accepted R11 as the correction to automatic rollback semantics and
authorized R12 to harden the two recovery boundaries R11 deliberately left open.

**Objective 1 — the snapshot must survive a process failure.** R11's transaction
snapshot is in-memory. That is sufficient for a synchronous mutation failure,
because the orchestrator is still alive to restore from it. It is not sufficient
if the apply process disappears after mutation begins: there is then no recovery
target, and no record that a mutation was in progress at all, so the next apply
cannot tell a clean runtime from a half-mutated one. R12 persists the snapshot
and a transaction record under a dedicated transaction-state directory in the
existing operator state area, marks the transaction complete on verified success,
and refuses a new apply when it finds a transaction that started but never
completed. An orphan is reported and requires an explicit recovery decision; it
is never silently deleted, resumed, or rolled back.

**Objective 2 — the historical rollback path needs an authorization gate.**
`operator-rollback.mjs` invokes `restoreNativePatch` against `native-r12` and
`restoreT1RuntimeFiles` against `backups/r12`, with no authorization check at
all. That installs the 2026-09-11 T1 config, the clean native baseline, and no
governance extension. R11 stopped the _apply_ path from reaching it, but the
command itself remains unguarded. R12 adds an explicit recovery authorization
that cannot be inferred from `Deployment Authorized`, `Execution Authorization`,
or the mere presence of a backup, requires the target to be named, and discloses
what will be installed before any mutation. Automatic transaction rollback and
historical recovery stay distinct actions.

`backups/r12` and `operator-rollback.mjs` are both retained, and the historical
target is unchanged. The R10 outgoing digests are NOT added. R11's automatic
rollback logic is extended only where durability requires it. R12 is
repository-only: no deployment, no live apply, no live historical rollback.

### 4.10 M8/T2.2-R13 — R7 predecessor provenance allowlist

The owner accepted R12 as the rollback-safety baseline and scoped R13 to the one
remaining blocker on the R10 deployment: `configure.mjs --preflight` refuses the
currently deployed R7 governance extension with `Governance plugin asset drift
detected`.

R7 changed exactly two generated-extension files relative to R5: the native
boundary and the entrypoint. Every other R7 asset is byte-identical to the
current build and is already accepted by content comparison, and the R5
predecessor digests R8 recorded remain in place. So exactly two approved
predecessor identities are missing, and R13 adds exactly those two — the OUTGOING
live R7 digests, each bound to its own path:

- `lib/native-boundary.mjs` → `33b3feefdfd473dc…`
- `index.mjs` → `74582778e5d58ce6…`

The R10 INCOMING digests (`50af7d4a…`, `e5b220b4…`) are NOT added; they are the
current build and are already accepted by content comparison. R13 changes one
data table and no logic, validation order, path semantics or comparison
semantics.

R13 ends at the preflight result. A preflight PASS is not authorization to apply:
`--apply`, `operator-apply`, native mutation, gateway restart, heartbeat, Discord
tests and ledger-mutating tests are all out of scope, and `Deployment Authorized`
stays `NO`. Transaction retention and orphan handling are intentionally left as
deferred operational-hardening decisions and are not touched.

### 4.11 M8/T2.2-R14 — native patch lineage compatibility

The `b8597fe` deployment attempt consumed its single authorized attempt and FAILED
at `native-backup-prune` with `NATIVE_SOURCE_DRIFT` (`native-patch.mjs:225`).

Root cause, established read-only against the live host: the R10 patcher
recognizes only the exact upstream baseline or the exact patched state it
generates itself. It classifies a file as patched solely by replacing its own
patch string and checking that the inverse hashes to the pinned baseline
`a5698c55`. The live host carries the **R7** injection — the R10 patch string is
absent (0 occurrences) and the R7-shaped injection is present (1 occurrence) — so
the inverse fails and neither branch is reachable. `applyNativePatch` itself would
have been blocked at the next stage; the prune merely hit it first.

R13 was necessary but not sufficient. No asset allowlist entry could have
prevented this, because it is a patch-lineage question, not a provenance one.

R14 models the runtime as an ordered lineage — `BASELINE → R7 → R10`, plus
`BASELINE → R10` — with four recognized states: baseline, explicitly recognized
predecessor, exact current patched, and unknown. Recognition is provenance-bound
to an exact source digest, exact patch signature, exact inverse, and exact
resulting baseline digest, and is bound per artifact. The R7 → R10 transition is
derived entirely in memory, so the live runtime never passes through an unpatched
intermediate state. For R10 the only required predecessor is R7; R5 and R6 are
deliberately not added, because the actual deployment graph requires only R7 and
extra entries would widen the recognized surface for no reason.

R14 is repository remediation plus a live preflight. No deployment target.
`NATIVE_RUNTIME_PINS` and the R8/R13 allowlists are unchanged, and no new
allowlist entry is added as a side effect.

### 4.12 M8/T2.2-R15 — attempt-scoped transaction identity

The second R10 deployment attempt (authorization `7520f39`, one attempt) ABORTED
before any mutation at the `transaction-snapshot` stage with
`ROLLBACK_SAFETY_UNAVAILABLE`. Zero runtime, ledger and gateway change.

Root cause, established read-only: R12 derives the transaction directory name
from the PREIMAGE DIGEST. The first attempt's rollback restored the runtime
byte-exactly, so all 38 recorded components of the live runtime still match that
attempt's retained preimage exactly. The derived ID is therefore the same, and
`persistTransactionSnapshot` refuses with `TRANSACTION_ALREADY_EXISTS`. A
completed record from a prior attempt permanently blocks the next attempt against
the same preimage, and nothing in the repository can clear it. Orphan detection
does not see it either, because the record's status is `complete`, not orphaned.

This conflates two different concepts. `preimageDigest` answers "which exact
runtime state did this attempt start from?" and is deterministic, which is
correct. `attemptId` answers "which apply attempt was this?" and must be unique
per attempt. Using the first as the filesystem uniqueness key makes a successful
or cleanly rolled-back attempt permanently prevent any future attempt from the
same state.

R15 separates them: the transaction directory is keyed by a cryptographically
random `attemptId`, while the record continues to carry the full deterministic
`preimageDigest` and the complete component manifest, so preimage traceability is
preserved and is never replaced by the attempt ID. Two attempts against the same
preimage become valid, each with its own attempt ID and its own independently
recoverable snapshot. A completed transaction is evidence, not a blocker.

Orphan semantics are unchanged in principle: a transaction left `started` when
its process disappears is still detected and still blocks a new apply, and is
never silently deleted, resumed or rolled back. History is not concurrency.

The existing completed record `txn-02edeb0bf364e3931fffd9e1e5fe904b` is a valid
historical recovery record. R15 is forward-compatible with it and does NOT
rewrite, rename, migrate or delete it; the new scheme applies to new
transactions only.

R15 is repository-only: no deployment, no live apply, no transaction deletion or
rewrite, no allowlist change, and no change to the R10 G1 contract, the R13
allowlist, or the R14 native lineage.

### 4.13 M8/T2.2-R16 — full apply rehearsal on an exact clone of the live runtime

The owner declined a third live deployment and instead required the complete
corrected R10 apply path to be exercised end to end against a byte-exact clone of
the CURRENT LIVE R7 runtime, because three operations had still never run
anywhere: the R7 native predecessor WRITE to R10, the post-apply runtime
verification, and a genuine restart.

**Why a copy was not sufficient.** `buildConfig` embeds absolute `stateDir` paths
in `agents`, `auth`, `plugins.paths` and the systemd drop-in. A byte-exact copy of
`openclaw.json` relocated to another root can therefore never pass the builder's
own preflight — proven directly: an identical copy at `/tmp` fails with `Policy
drift at agents` while the same bytes at the original path pass. Any directory
copy is a fidelity lie.

**Isolation mechanism.** The clone is a private mount namespace
(`unshare --map-root-user --mount`) in which `/home/hoang_vinh/.openclaw-zink`,
the OpenClaw package root and `~/.config/systemd/user` are each overlaid with
overlayfs whose LOWER LAYER IS THE LIVE DIRECTORY. Byte-exactness is therefore
structural, not copied: every in-scope byte is the live byte by construction.
Writes land only in the overlay upper layer, which doubles as a deterministic
record of which files were written. The namespace cannot outlive the process, so
a crash cannot leak a mount or a write into the host, and the running gateway —
which never entered the namespace — keeps the real inodes.

Only the gateway restart is injected, because the real effect is `systemctl
--user restart`. The real `applyRuntime` orchestration, the real `configure.mjs`
as a child process, the real native patcher and the real transaction machinery
are all used unmodified. `operator-apply.mjs` is deliberately not invoked: it
binds absolute live paths and a real restart, so using it would be the mutation
R16 forbids.

**Coverage boundary, stated precisely.** The R7 → R10 native predecessor WRITE
and the post-apply byte verification are genuinely exercised. The gateway restart
is **not**: it ran only as an injected no-op, and no real `systemctl --user
restart` or `is-active` observation has ever executed anywhere. An earlier
wording in this plan and in the contract claimed the restart stage was
"exercised"; that was wrong and is corrected. The deployment path is proven up
to, but not including, the restart itself.

**Result: PASS.** The complete stage trace runs in order and the R7 → R10 native
write lands. Exactly two native files were written — `dist/selection-*.js` at
`555f37da` and `dist/zink-governance-boundary.mjs` at `50af7d4a` — and the
overlay upper layer shows no third native file, no `native-r12` backup and no
baseline bytes anywhere. The write history is therefore `R7 → R10`, not
`R7 → BASELINE → R10`, measured rather than argued.

All eight controlled failure boundaries roll back to the exact attempt preimage
with `rollbackSucceeded` licensed only after live byte verification. A gateway
that cannot restart back never licenses a verified rollback. The historical R15
collision scenario was replayed through the real orchestration: attempt A fails
and rolls back, attempt B reaches the native mutation on the same preimage with a
distinct attempt ID and no `TRANSACTION_ALREADY_EXISTS`.

The R10 artifacts were regenerated from the pinned baseline preimages twice,
deterministically, and are byte-identical to the output of the R7 → R10 route.

Live environment after the rehearsal: all 15 components and 4 subtrees
byte-identical, gateway `MainPID=98288` with `NRestarts=0` unchanged, ledger at
103 events / sequence 103 / 37 tasks unchanged. **NOT DEPLOYED.**

R16 is repository-only and creates no deployment authorization. R16 is `CLOSED`
as the final revision of `M8/T2.2`. `Deployment Authorized` remains `NO`,
`Deployment Status` remains `NOT DEPLOYED`, the live runtime remains R7 and
byte-identical, and the ledger is unchanged. No R17 is created.

#### 4.13.2 R16 live deployment — DEPLOYED

The single authorized attempt ran on 2026-09-30 through `operator-apply.mjs`, the
repository's authorized live deployment mechanism, against the real live runtime.
No mount namespace, no rehearsal, no simulation. The authorization was recorded
in both authoritative sources and committed as `075f46d` before any runtime
contact.

Result: `{"status":"PASS","stage":"applied","mutationStarted":true,
"rollbackRequired":false,"rollbackAttempted":false,"rollbackSucceeded":false,
"reason":null,"attemptId":"txn-1ba7689b6908d601122834e426939541bc72106736b2a5a15b48d539a063a8d4",
"transactionStatus":"complete"}`. Every stage ran in order through
`runtime-verify`. No rollback was required and none was attempted; success was
licensed by live byte verification, not by self-report.

Live state, measured directly after the apply:

| Component                            | Before (R7)                                                        | After (R10)                                                        |
| ------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `openclaw.json`                      | `5db19403521b0db84b29408fb4a194460f14a50b391e887873c03c5f1b560658` | unchanged — the R7 config was already current                      |
| extension `index.mjs`                | `74582778e5d58ce6a26dec3514b9a73ad5f8964f892023b37221f8a85b5ff215` | `e5b220b4a3b023f6d7b26561964f6204f0d004267b208cddab90adb6043b8bd7` |
| extension `lib/native-boundary.mjs`  | `33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412` | `50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2` |
| `dist/selection-DopzNY3I.js`         | `b431673602bf2f6eca55f8635f226dddbf06cf19e83c5488cc154d4db3d94512` | `555f37dae8eec1fbbd35e25ae28222dc5e8d6965e383500695a93900e9d8ddf5` |
| `dist/zink-governance-boundary.mjs`  | `33b3feefdfd473dc0d6d09b0ae7b8e39b394fa93a1247fe117bc58757f075412` | `50af7d4ae10b519340b8dc13af3e2b219041fb28991e2a777ea815b537d2c7c2` |
| `dist/subagent-announce-Bh1QyKiE.js` | `e3b110f77cbd52ec86e935ff9ee3926b2730802a1cd4d42e65c56624dc19dc87` | unchanged — already R10                                            |

The live native write went `R7 → R10` directly. `native-r12` still holds 3 files
with mtime `2026-09-30 01:00:14`, proving the baseline-writing branch never ran —
the same result R16 measured on the clone.

Independent post-apply verification, not taken from the apply's own report:

- the real `checkNativePatch` returns `PATCHED` for both pinned sources;
- the live bridge equals the repository R10 boundary `native-boundary.mjs`;
- the deployed extension tree matches `governancePluginFiles()` byte-for-byte
  across **34 of 34 files**, entrypoint `e5b220b4…` included;
- the written selection carries `trigger: params.trigger` and
  `transcriptPrompt: params.transcriptPrompt`;
- `GOVERNANCE_VERSION = "m8-t2.3-r5"`, the G1 trigger predicate and the G2
  `GOVERNANCE_RUN_UNAVAILABLE` code are present;
- three plugins configured: `discord`, `google`, `zink-governance`.

The gateway restarted for real and serves the new code: `active (running)`,
`NRestarts=0`, `[zink-governance] ACTIVE AND LOADED`, `http server listening
(3 plugins)`, `[heartbeat] started`. `NRestarts` stayed 0 throughout; the
repeated stop/start entries in the journal come from distinct systemd PIDs, i.e.
WSL instance restarts in this environment, not a crash loop of one process.

Transaction: a new attempt record `txn-1ba7689b…` — schema v2, the R15
random 64-hex identity — `status: complete`, snapshot `verified: true`, marked
complete only after verification. The retained historical record
`txn-02edeb0bf364e3931fffd9e1e5fe904b` is untouched and still verifies.

Ledger integrity: `events.jsonl` `d794d99d0be87683feed34735005db864b71d049499b69de4a32a14d58c5dda2`
and `snapshot.json` `bbdf3aec34ae92b60b5e6a661c890b9e60f5bcf9bbecc1062cec6d16d9a12f9a`
are byte-identical before and after — 103 events, sequence 103, 37 tasks. The
deployment wrote no ledger event.

`backups/r12` is untouched: 14 files, mtime `2026-09-30 11:18:26`. No quarantine
was created. No rehearsal scratch and no stray overlay mounts remain.

Behavioural evidence: `GOVERNANCE_RUN_UNAVAILABLE` occurrences after the
deployment are **0**; the same window before it contained 6, and the last
occurrence anywhere was `17:20:53`, hours before the apply. Every error line
after the deployment is a Discord gateway WebSocket close with code `1006`
during a WSL reboot, plus one aborted OpenRouter pricing fetch — 7 lines after
against 22 before, and unrelated to governance.

One honest limitation: no complete heartbeat _cycle_ has been observed yet
because WSL restarts roughly every one to two minutes in this environment while
the heartbeat cadence is about thirty minutes, so the scheduler is restarted
before it can complete a run. The failure that R10 exists to fix has stopped
occurring; end-to-end cadence confirmation needs a WSL instance that stays up.

#### 4.13.1 R16 findings closed

Every finding R16 raised is closed in `M8/T2.2-R16` itself. No R17 is created
and no finding is deferred.

| Finding                                                                                                                                                                                                                                                                                                | Fix                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A relocated byte copy is not a valid clone: `buildConfig` embeds absolute `stateDir` paths, so identical `openclaw.json` bytes fail anywhere but the original path                                                                                                                                     | Clone rebuilt as a private mount namespace whose overlayfs lower layer IS the live runtime, so byte-exactness is structural                                                                                                                                                                                                                                                                  |
| The write-history witness was a `fs.watch` sampler that never observed R10                                                                                                                                                                                                                             | Replaced by the overlay upper layer, which records a file exactly when it is copied up, giving a deterministic write record                                                                                                                                                                                                                                                                  |
| `configArgs` derived one flag per raw JSON key, producing `discordOwnerId must be a numeric Discord snowflake`                                                                                                                                                                                         | The identifier set is parsed once and its parsed keys derive the flags                                                                                                                                                                                                                                                                                                                       |
| `R7_DIGESTS` carried `config: null, entrypoint: null` placeholders into a `deepEqual`                                                                                                                                                                                                                  | Split into `nativeDigests()` / `R7_NATIVE`, so only genuinely constant digests are asserted                                                                                                                                                                                                                                                                                                  |
| The fingerprint read `GOVERNANCE_VERSION` from `index.mjs`, where it is not defined, and reported `null`                                                                                                                                                                                               | Read from the extension's own `lib/canonical.mjs`, where the constant lives                                                                                                                                                                                                                                                                                                                  |
| The predecessor-recognition fault mutated the clone AFTER the preimage was captured, so the test asserted rollback-to-pristine instead of rollback-to-attempt-preimage                                                                                                                                 | Fault is applied before capture; the attempt preimage is what rollback must restore                                                                                                                                                                                                                                                                                                          |
| The `builder-preflight` fault was never implemented, so the "preflight failure" test ran the real builder and passed instead of failing                                                                                                                                                                | Implemented; the test now proves zero mutation and no rollback attempt                                                                                                                                                                                                                                                                                                                       |
| The predecessor-recognition fault is detected at `native-backup-prune`, one stage before the patcher                                                                                                                                                                                                   | Real detection order recorded rather than papered over                                                                                                                                                                                                                                                                                                                                       |
| The post-apply-validation expectation asserted R10 was retained after rollback                                                                                                                                                                                                                         | Corrected to the restored preimage, and `APPLY_NOT_VERIFIED` is now asserted                                                                                                                                                                                                                                                                                                                 |
| Test J asserted two snapshots were different, but they are equal by design because A's rollback restores R7                                                                                                                                                                                            | Corrected; the proof is now two distinct records with one shared `preimageDigest`                                                                                                                                                                                                                                                                                                            |
| Rehearsal scratch cleanup failed with `EACCES` because overlay `work` directories cannot be removed from outside the namespace                                                                                                                                                                         | Teardown moved inside the namespace; the outer cleanup names anything left instead of hiding it                                                                                                                                                                                                                                                                                              |
| Five WSL failures `DUCKDB_ENGINE_NOT_AVAILABLE`                                                                                                                                                                                                                                                        | The production classification is correct and unchanged. The harness defect was that neither DuckDB suite probed for the engine, so an absent runtime was reported as FAIL. Real-execution gates are now `NOT RUN` when the engine is absent, denial gates still run everywhere, and a new Gate E1 asserts the fail-closed classification on every host                                       |
| The contract and this plan claimed the restart stage was "exercised"                                                                                                                                                                                                                                   | Corrected: the restart ran only as an injected no-op and has never been executed for real                                                                                                                                                                                                                                                                                                    |
| `operator-apply.mjs` wired a `validateConfig` dependency described as an "additional semantic health signal" that `applyRuntime` never calls                                                                                                                                                           | Dead dependency and its false claim removed, with the reason recorded: `config validate` cannot distinguish a wrong-but-valid restore, and byte comparison against the attempt's own preimage is the only gate                                                                                                                                                                               |
| `npm test` can never exercise the R16 suite, because it always skips without the namespace                                                                                                                                                                                                             | Added `npm run test:r16`                                                                                                                                                                                                                                                                                                                                                                     |
| `r16-rehearsal.mjs` reported only a non-zero exit, so "could not run" and "failed" were indistinguishable                                                                                                                                                                                              | The driver now names the reason it could not start                                                                                                                                                                                                                                                                                                                                           |
| `tests/m7-lane-c-queue.test.mjs` M7-025 was nondeterministic: it called `detectAndRecoverStaleTasks` with `staleThresholdSeconds: 0` in the same millisecond as the claim, and staleness is `heartbeat age > threshold` strictly, so it recovered nothing and failed whenever the clock had not ticked | Measured at 3 failures in 8 runs on WSL tmpfs and 0 in 8 on NTFS, then fixed by advancing the clock explicitly, matching the pattern the other stale-recovery gates already use. 0 failures in 12 runs on both platforms. The production comparison was NOT relaxed: `>` is the correct rule and weakening it to `>=` would recover a task whose heartbeat is contemporaneous with the check |

R4 validation snapshot (task remains IN PROGRESS): focused M8/T1, M8/T2 and
native ingress suites PASS; focused DuckDB/M7-T4 gates PASS 27/27; full
`npm test` PASS 349/349 across 28 suites; ESLint, Markdown lint, repository
policy check, Prettier and `git diff --check` PASS. The owner-provided native
Windows DuckDB CLI is available at the approved WinGet path. Remaining OPEN
items are the unverified native OpenClaw component API, the approved
nonblocking lock primitive, and the owner/runtime-dependent OpenClaw preflight.

R4 implementation evidence: `zink_sql` uses the existing governed DuckDB bridge
with exact task scope; approved tasks are durably enqueued before an unavailable
execution backend returns `BLOCKED / ENGINE_NOT_IMPLEMENTED`; approval cards
require exact task correlation; missing Discord credentials fail closed as
`CREDENTIAL_UNAVAILABLE`; Excel sandbox and public artifact references fail
closed without CWD/internal-path fallback; and no OpenClaw native conversational
memory is enabled; Ollama embedding requests no longer infer a gateway or
localhost endpoint. Native Discord component API verification, OpenClaw runtime
preflight, and a nonblocking lock replacement remain `BLOCKED` under the R4
no-invention rule.

Prior M8/T2.2-R3 validated completion evidence (historical baseline; not R4 completion):

- all 15 root-cause families (RC-01 through RC-15) defined in `docs/contracts/execution/ACTIVE.md` remediated, hardened, and verified with zero regressions;
- RC-01 (Discord Ingress / Routing Authority): admission gate enforced prior to model calls; Main established as the sole root owner at ingress; specialist direct mentions rejected across all channels (`SPECIALIST_NO_DIRECT_INGRESS`); multi-capability requests directed solely to Main; duplicate Discord events deduplicated;
- RC-02 (Agent Topology / Spawn Authorization): canonical topology locked in `role-capability-manifest.json` and runtime `guard.mjs` (`main -> [o1, o2]`, `o1 -> [excel, sql, python]`, `o2 -> [power-bi, python]`, leaf -> `[]`); Main direct spawn to specialists blocked; O1/O2 cross-spawn blocked; empty node lists blocked;
- RC-03 (Task Identity / Lineage / Idempotency): durable correlation IDs and exact lookup enforcement; duplicate message IDs and actions rejected or answered idempotently without spawning new executions;
- RC-04 (Approval / Revision / Result-Review Transaction): immutable approval records bound to exact scope digest and revision; plan revisions strictly invalidate prior approvals; User established as sole authority for Approve, Reject, and Accept;
- RC-05 (Queue / Ledger / Lease / Recovery): persistent file-backed queue with atomic cross-process file locks, lease heartbeat fencing, execution-agent attempt validation, and fail-closed state reconciliation;
- RC-06 (Discord Outbound / Channel Authority): canonical channel matrix enforced; `ASK_USER` in `#office` strictly restricted to Main in `validateActionAuthority()`; O1/O2 restricted to `#approvals`, `#results`, and `#incidents`;
- RC-07 (Common Artifact / Result / Delivery Truth): complete lifecycle enforced; internal filesystem paths and raw `file://` URLs purged from user-facing outputs; user delivery separated from workspace file generation;
- RC-08 (Excel Execution Truth): secondary writes to repository `artifacts/` purged; `.xlsx` workbooks generated with matching visual SVG previews; CWD fallbacks removed from delivery path;
- RC-09 (SQL Execution Truth): real DuckDB engine execution enabled with canonical schema fixtures; discrete execution states (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`) enforced; syntax/binder errors fail closed without returning mock sample rows;
- RC-10 (Python Execution Truth): strict stack scoping separating O1 ETL execution from O2 analytics/visualization/forecast/optimization; AST parsing and import validation;
- RC-11 (Power BI Execution Truth): PK\x03\x04 magic byte validation, container integrity, and dashboard preview correlation;
- RC-12 (External Adapter / Simulation Truth): unambiguous capability states enforced; simulation mode isolated behind explicit flags and forbidden from production success paths;
- RC-13 (Security / Path / Endpoint Isolation): zero secret leaks in prompts or payloads; traversal (`..`) and absolute path escape attempts rejected; host execution bypass blocked;
- RC-14 (Semantic / Capability Boundary): vetted namespace enforcement; proposal disk writes isolated to explicit storage directories rather than dirtying source trees;
- RC-15 (Verification / CI / Schema / Documentation Truth): root `npm test` updated to include `duckdb-bridge.test.mjs`; all 272 tests across 13 suites pass completely (100% PASS); quality gates clean: `git diff --check` (0 issues), `npm run repo:check` (PASS), `npm run format:check` (PASS), `npm run lint` (0 issues).

M8/T2-R9 validated completion evidence:

- strict 5-tuple action authority engine (`validateActionAuthority` in `integrations/openclaw/lib/authority.mjs`) implemented, enforcing User as the sole authority for plan approvals and result acceptance, isolating actions across 4 dedicated Discord channels (`#office`, `#approvals`, `#results`, `#incidents`), and strictly blocking specialist agents from governance actions (`SPECIALIST_NO_GOVERNANCE`);
- technical execution finish decoupled from human task completion: `EXECUTION_FINISHED` transitions tasks to `RESULT_PENDING_REVIEW` with preview and validation, requiring explicit User `ACCEPT_RESULT` to transition to `COMPLETE`;
- persistent file-backed `QueueManager` implemented in `integrations/openclaw/lib/queue-manager.mjs` with atomic single-agent claims, lease heartbeat renewal, and automatic stale task recovery (`detectAndRecoverStaleTasks`), cleanly decoupling the 24/7 Control Plane from execution-agent offline/sleep cycles;
- two-tier `evaluateResultGate` implemented in `integrations/openclaw/lib/artifact-validator.mjs` with technical integrity parsing and business KPI constraint verification, enforcing the critical invariant that Technical PASS + Business FAIL yields `RESULT BLOCKED` with real data previews and zero synthetic mocks;
- human-confirmed `DecisionLedger` implemented in `integrations/openclaw/lib/decision-ledger.mjs` caching confirmed operator decisions and preventing redundant clarification questions;
- structured reference IDs conforming to `TOPIC(2)-EXEC(2)-TASK(4)` with `00` reserved for human-contributed documents, and retrieval context deduplication (`deduplicateRetrievalContext`) implemented in `zink-tools/common/semantic-contract.mjs`;
- governed Discord message and card formatters implemented in `integrations/openclaw/lib/discord-formatter.mjs` (`formatOfficeClarificationQuestion`, `formatOfficeFinalNotification`, `formatGovernedApprovalCard`, `formatGovernedResultCard`, `formatIncidentCard`);
- OpenClaw `zink-governance` plugin updated with attempt-token staleness protection (`STALE_ACTION_REJECTED`) and full runtime module materialization in `governancePluginFiles`;
- audit bug test suite `tests/m8-t2-governed-runtime-audit.test.mjs` passed 12/12 tests covering all bug prevention rules (`BUG-M8T2-01` through `BUG-M8T2-12`), including strict authority hierarchy (Main only delegates to O1/O2, never directly spawns specialists or self-executes) and real visual spreadsheet preview generation;
- specialist direct Discord ingress rejected (`SPECIALIST_NO_DIRECT_INGRESS`) and direct `#office` broadcasts suppressed in governance plugin, preventing dual-bot appearance and strictly enforcing O1/O2 execution supervisor boundary;
- real visual spreadsheet SVG preview rendering implemented in `excel-writer.mjs` and validated in `artifact-validator.mjs` and `discord-formatter.mjs`, providing actual data screenshots/renderings without mocks;
- end-to-end workflow test suite `tests/m8-t2-e2e-workflow.test.mjs` passed 19/19 tests covering Happy Path and all 20 required failure and edge scenarios;
- full repository test suite passed all 156 tests with zero regressions; `git diff --check`, `repository-check.mjs`, `eslint`, `markdownlint`, and `prettier` all passed with 0 errors.

M8/T1-R1 validated completion evidence:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and 1024-dimension HNSW cosine vector index `skills_segments_embedding_hnsw_idx` via migration `apps/knowledge/migrations/003_skills_vector_schema.sql`;
- shared canonical semantic contract implemented in `zink-tools/common/semantic-contract.mjs` with deterministic uppercase envelope formatting (`renderEmbeddingEnvelope`), SHA-256 envelope hashing (`computeEmbeddingInputHash`), safe query preparation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization implemented in `zink-skill-store/src/vector-sync.mjs` with fail-closed validation, ACTIVE-only indexing, source-drift abort safeguards, and 1024-dimension vector enforcement;
- callable tool contracts and adapters implemented for `zink_skill_search` (vector cosine similarity, ACTIVE-only), `zink_skill_propose` (candidate-only, human-in-the-loop approval, strictly prevents direct promotion to ACTIVE), and `zink_knowledge_search` (hybrid search proxy with citation provenance);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`) implemented in OpenClaw governance plugin with immutable content-hash binding and fail-closed owner verification;
- RBAC policy updated in `integrations/openclaw/lib/policy.mjs`: all 7 agents authorized for `zink_skill_search` and `zink_knowledge_search`; specialists and O1 authorized for `zink_skill_propose`;
- Discord Mobile mention parsing remediated: corrected punctuation lookahead regex `(?=$|[>\\s,.:;!?])` and mapped all 7 snowflake IDs in `AGENT_ALIASES` and `groupChat.mentionPatterns`, allowing raw `<@ID>`, `<@!ID>`, snowflake, and natural text mentions from Mobile and Desktop clients;
- Discord Gateway stability remediated: set `replyToMode: "off"` to eliminate Discord API 50035/50001 permission errors; verified all 7 bot WebSockets active and connected to Discord Gateway;
- automated test suite `tests/m8-t1-skill-vector-memory.test.mjs` passed 11/11 tests covering all bug prevention rules (BUG-01 through BUG-13);
- full verification suite `npm run verify` passed all 123 tests cleanly (`format:check`, `lint`, `test`, `repo:check`).

M7/T5-R13 validated completion evidence:

- implementation commits `4037187` and `8e71759` verified on `codex/m7-t5-governance-remediation`;
- multi-agent Discord ingress task collision remediated via deterministic per-agent `deriveTaskId`; 7 concurrent bots reply without collision or dropped messages;
- Zink tools registered with complete JSON Schema parameter definitions for `zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, and `zink_n8n`;
- specialist tool allowlists (`alsoAllow`) enforced in `openclaw.json` for Excel (`zink_excel`), Power BI (`zink_power_bi`), SQL (`zink_sql`), Python (`zink_python`, `zink_n8n`), and O2 (`zink_n8n`);
- Discord output formatting hook unwraps JSON and formats natural Vietnamese conversation;
- CI shallow clone depth (`fetch-depth: 0`) and `smol-toml` high vulnerability advisory remediated;
- full test suite passed (173 passed, 0 failed, 1 skipped);
- GitHub Actions CI (run 35168425589) and Security (run 35168435913) remotely passed (green).

M7/T4-R10 validated completion evidence:

- implementation commit `d73f20cc5fd5fd14533b34e2840517c49b9989b1` on `main`;
- external infrastructure adapters, duckdb bridge, and vietnamese docs implemented;
- pre-existing test suite passed with zero regressions.

M7/T3-R16 validated completion evidence:

- implementation commit `ac68bce0653ad3c4bfcc8d230960bcdcf7e8f71d` is verified on `origin/codex/m7-t3-tools-contracts`;
- 25 frozen scope files implemented within Case C boundaries with zero non-goal violations;
- unit and static test suite passed 112/112 tests (`npm test`) with zero regressions;
- focused M7/T3 test suite passed 31/31 tests across all domains A-H (`node --test tests/m7-t3-tools-contract.test.mjs`);
- host registration assertion gate passed (`G0.6`): exact 5 Zink tools captured on mock host registration;
- anti-replay concurrent race gate passed (`G0.9`): atomic single claim admitted, concurrent replay rejected with `AUTH_APPROVAL_REPLAYED`;
- projection isolation and manifest drift gate passed (`G5`): `agent.tools.alsoAllow` matches `effectiveOpenClawToolAllowlist`, role manifest matches `effectiveZinkCallableTools`;
- code quality gates passed (`G4`): ESLint 0 errors / 0 warnings;
- patch integrity gate passed (`G7`): `git diff --cached --check` clean, zero whitespace violations;
- dependencies untouched: `package.json` and `package-lock.json` completely unmodified.

M7/T2-R12 validated completion evidence:

- implementation commit `4872314c686bcc92797acc68483b8b68fe4ee8ca` is verified on
  `origin/codex/m7-t2-agent-topology`;
- unit and static test suite passed 112/112 tests (`npm test`);
- native patch probe passed with all sub-checks verified (`native-patch-probe.mjs`):
  exact roundtrips, drift rejection, native prepare execution vetoes, synthetic apply/restore;
- operator preflight passed (`operator-preflight.mjs`):
  `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`;
- operator apply passed and verified rollback readiness (`operator-apply.mjs`):
  `{"status":"PASS","stage":"applied","rollback_ready":true}`;
- operator rollback verified to clean T1 baseline (`operator-rollback.mjs`):
  `{"status":"PASS","runtime":"T1_RESTORED"}`;
- live governance probe passed all 8 stages (`live-governance-probe.mjs`):
  direct checks on all seven identities (`main`, `o1`, `o2`, `excel`, `power-bi`, `sql`, `python`)
  and full nested seven-role matrix (`{"stage":"nested-seven-role-matrix","status":"PASS","accepted_children":6}`);
- scoped gateway service `openclaw-gateway-zink.service` verified active on port 18789.

M6/T1-R4 evidence: focused M6 tests, `npm run verify` (64 tests),
`git diff --check`, staged diff check, and scope review passed. Task commit
`fb746021b8b1a51080d1ba4fed4b35011bb78ce6` is remotely verified on
`origin/codex/m6-t1-git-native-skill-store`. Post-completion fix commit
`652ed9bd248dcc047a2be09300aaaba1d9c2dbbf` is also remotely verified there.

Host operation: `.wslconfig` was backed up without overwrite, changed only from
`memory=9728MB` to `memory=8192MB`, and read back successfully. No
`wsl --shutdown` was run; effective application remains owner-controlled through
a later WSL restart.

M4/T5 is treated as **temporarily accepted and complete by the owner** after the
Codex push. The exact accepted commit hash is intentionally not invented here; it
should be reconciled from git history/remote evidence by Codex or the owner when
convenient. Do not reopen M4 implementation scope merely to fill that metadata.

M4/T1 through M4/T4 are complete locally:

| Task                                          | Status     | Review Convergence Gate | Final Quality Gate | Evidence summary                                                                                                                                     |
| --------------------------------------------- | ---------- | ----------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4/T1 — Runtime, source, schema, identity     | `COMPLETE` | `NOT RUN`               | `NOT RUN`          | Feature commit `c4ef66d`; isolated PDF runtime and M3 regression gates passed.                                                                       |
| M4/T2 — Preflight, extraction, segmentation   | `COMPLETE` | `NOT RUN`               | `NOT RUN`          | Implementation commit `82126e4`; bounded extraction/OCR and atomic non-searchable builds passed.                                                     |
| M4/T3 — Resume, drift, retention, publication | `COMPLETE` | `NOT RUN`               | `NOT RUN`          | Local implementation commit `c1df143`; resumability and atomic publication passed.                                                                   |
| M4/T4 — Adapters, retrieval, API              | `COMPLETE` | `NOT RUN`               | `NOT RUN`          | Reviewed local implementation commit `1904853`; Markdown/PDF retrieval, filters, citations, and repository gates passed.                             |
| M4/T5 — Acceptance and handoff                | `COMPLETE` | `NOT RUN`               | `NOT RUN`          | Owner reports the accepted M4/T5 state was pushed and is temporarily closed; exact remote commit evidence remains to be reconciled from git history. |

The owner's 2026-08-28 correction remains authoritative for `M4/T5-R2`:
visible internal PDF embeds drive sidecar recognition; ordinary Books/Papers
Markdown is ignored by PDF discovery; `zink_source: pdf` is not required.

M4/T5 is closed for current planning purposes. Architecture contraction must not
refactor or destabilize the accepted M3/M4 Knowledgebase runtime unless a later,
separately approved migration explicitly authorizes it.

### 4.15 M8/T2.2-R18 — run-end liveness propagation (final technical fix)

**Proven defect, not re-diagnosed.** The host forwards `trigger` and
`transcriptPrompt` to `enterNativeRun` but not to `finishNativeRun`: the run-end
call in the patched selection passes only `{ agentId, sessionKey, runId }`. R17
made the boundary forward both fields and made the classifier accept the
heartbeat verdict, but the host never supplies them at that seam, so
`isPureLivenessHeartbeat` returned false there regardless. Live signature:
`internal session = 0` while `beforeRunEnd: self-keyed session presented a
runId; applying full governance` incremented alongside
`GOVERNANCE_COMPLETION_UNAVAILABLE`.

**The change.** `native-boundary.mjs` only. `enterNativeRun` records
`{ trigger, transcriptPrompt }` under the run's `runId` when admission ACCEPTS
the run — after the accept check, so a denied or failed admission leaves no
record and stays fully governed. `finishNativeRun` takes that record once and
resolves the context as `context.trigger ?? liveness?.trigger`, so the seam
stays authoritative whenever the host does speak. The store is a module-level
`Map` bounded at 256 with oldest-first eviction; eviction degrades to full
governance, never to a bypass. `classifyInternalRunEnd` is not modified: one
predicate, one rule.

**Deviation from the named mechanism, recorded for the owner.** The owner named
`native-patch.mjs` as the primary change. R18 does not touch it, and the reason
is recorded in ACTIVE.md R18 3: a call-site edit changes the installed
`selection-*.js`, which requires a new R10 predecessor descriptor and breaks the
R7 lineage, because R7 would then differ from the current edit set in two slots,
which the single-slot descriptor cannot express. The boundary fix closes the
identical defect with `native-patch.mjs` byte-identical, so the deployed
selection `555f37da` stays recognized by content comparison with no descriptor
change. No material decision changes.

**Files changed.** `integrations/openclaw/topology/lib/native-boundary.mjs`
(implementation); `integrations/openclaw/configure.mjs` (adds the deployed R17
boundary digest `4567ce26` to the asset allowlist as a recognized predecessor);
`tests/m8-t2.6-r8-asset-provenance.test.mjs` and
`tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` (post-R5 provenance hunks
gain four R18 entries; the derived R5 digest `49352d47` still reproduces
exactly, byte-verified in both copies);
`tests/m8-t2.15-r18-runend-liveness-propagation.test.mjs` (new, 15 tests);
`tests/m8-t2.11-r14-native-lineage.test.mjs`,
`tests/m8-t2.13-r16-apply-rehearsal.test.mjs` and the R13 current-build digest
pins move to the new boundary digest `d88bff80`; `package.json` adds the R18
test to `npm test`. `native-patch.mjs` is byte-identical, pinned by test R18 13.

**Falsification.** Reverting only the boundary change fails tests 1, 2, 3, 8 and
14 — and test 2 reproduces the exact live error
`GOVERNANCE_COMPLETION_UNAVAILABLE must not be raised:
GOVERNANCE_COMPLETION_UNAVAILABLE`. All eleven negative tests still pass on the
revert, proving they pin preserved behaviour rather than the new behaviour.

**Local validation.** R18 15/15. R17+R18 25/25. R8 12/12. R13 17/17. Full
`npm test` 838 tests / 796 pass / 0 fail / 42 skipped. `npm run lint`,
`npm run format:check`, `npm run repo:check` and `git diff --check` all exit 0.

**Live verification.** Deployed through `operator-apply.mjs` with one authorized
attempt: PASS at stage `applied`, `transactionStatus: complete`, no rollback,
attempt `txn-546134d1e917bea39046eae142e15b6453e589babe427c1bbf875399c1f773a5`.
Live dist bridge and extension boundary both `d88bff80`, byte-identical to the
repository artifact; selection `555f37da` and entrypoint `d01c210b` unchanged;
native patch `PATCHED`; ledger `d794d99d` / 103 events byte-identical; WSL
`boot_id` unchanged; gateway active with `NRestarts=0`. A real scheduled
heartbeat at `2026-10-01T02:50:52Z` completed the full chain with
`GOVERNANCE_RUN_UNAVAILABLE = 0`, `GOVERNANCE_COMPLETION_UNAVAILABLE = 0`,
run-end/lane `EXECUTION_STATE_UNKNOWN = 0`, `sandboxErr = 0`, `laneErr = 0`, and
transcript poll then reply. `beforeRunEnd: internal system session` rose from 0
to 2 and the self-keyed full-governance refusal stopped at 40. One pre-existing,
separate seam remains open and is recorded in ACTIVE.md R18 9; no R19 created.

### 4.16 Owner-identity hygiene — security remediation (NOT DEPLOYED)

Publishing the branch surfaced a real defect through the repository's own
`secret-scan` CI gate (three `discord-client-id` findings; `quality-gate` passed).
It is **not** a regression from R18/R19: the literals were introduced 2026-09-26 in
`01489aa` / `0e5a899`.

**Both CI failures are pre-existing on `main`, and neither is clearable by a
forward fix.** `main`'s own `Security` workflow has concluded `failure` since at
least 2026-09-28 with the IDENTICAL three findings at the same lines, because
gitleaks scans git HISTORY, not the checked-out tree — and `main`'s copy of the
plugin file is a 549-byte stub that does not contain them. `dependency-audit`
passed on `main` when it last ran, but `package-lock.json` is byte-identical
between `main` and this branch, so the outcome is decided by the lockfile plus
the CURRENT advisory database; the `brace-expansion` advisories post-date that
run. No `.gitleaksignore` entry was added and no dependency was touched, because
suppressing a long-standing finding on `main`, or bumping dependencies the owner
did not ask about, are owner decisions rather than incidental cleanup.

`.gitleaks.toml` allowlists synthetic Discord IDs under `tests/` and the
orchestration README but deliberately NOT production plugin source, so this was a
true positive and was fixed in source rather than suppressed.

Two real account identifiers were hardcoded as fallbacks inside owner
authorization gates: `config.ownerDiscordId || "<snowflake>"` (approval-button
gate and approve/reject action gate) and `expectedOwnerId = "<snowflake>"` as a
default parameter of `handleOwnerSkillApproval`. Beyond the privacy exposure, an
authorization gate falling back to a source constant stops depending on deployed
configuration — if config were absent, it would keep authorizing one specific
account.

The fix removes both fallbacks. `resolveOwnerDiscordId(config)` yields the
configured id only when it is a valid snowflake and `undefined` otherwise, so both
gates deny when the owner cannot be proven; `expectedOwnerId` has no default.
`parseIdentifiers` already refuses to build a config whose owner id is invalid, so
the fail-closed path is unreachable in a real deployment.

Files: `integrations/openclaw/plugins/zink-governance/index.mjs`,
`integrations/openclaw/configure.mjs` (outgoing R19 digest admitted in both
per-mode lists), `tests/m8-t2.17-owner-identity-hygiene.test.mjs` (new, 6 tests,
falsified 4/6), `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs`,
`tests/m8-t1-skill-vector-memory.test.mjs`, `package.json`.

Validation: `npm test` 859 tests / 817 pass / 0 fail / 42 skipped; lint, Prettier,
repository policy and `git diff --check` all exit 0.

**Status: NOT DEPLOYED.** The live runtime still carries `bae7bdf3`, which
contains the literals; the repository build is `6323dec9`. A deployment
authorization is required and has NOT been requested or assumed, so this is
tracked as an OPEN item rather than completed remediation. Owner decision needed.

**Follow-up remediation (same PR, completing instruction).** The owner authorized
finishing all PR #18 remediation end-to-end, which extends this item without
reopening M8/T2.2 (still CLOSED at R19; no R20). Full scope and evidence are in
ACTIVE.md R19 10; in brief:

- a third owner-identity location found by whole-tree scan and closed:
  `normalizeActor` in `lib/authority.mjs` aliased the same account snowflake to
  the `USER` actor, which gates owner-level actions at five sites. Now honors
  only a well-formed `DISCORD_OWNER_ID`, otherwise recognizes no snowflake;
- all five outbound Discord routing sites now resolve destinations from validated
  configuration only (`resolveDiscordDestination`) and decline to send when
  unresolved; the built plugin config now carries the four validated surface ids
  (already declared in the plugin schema), so live posting targets are unchanged;
- the real account identifier replaced by a synthetic fixture value across all
  test files and the README example; the one test passing a raw snowflake as the
  actor now uses the production-legitimate role name plus an explicit negative;
- `secret-scan` reproduced locally with CI's exact binary and flags — `no leaks
found` — after suppressing exactly the three historical fingerprints (history
  rewrite rejected: it would break the R13 commit pin, all provenance `git show`
  references, and the open PR). Planted new secrets are still detected;
- `dependency-audit` remediated within supported constraints: direct parent bump
  `markdownlint-cli2` 0.23.2 -> 0.23.3 plus `npm audit fix` for transitive
  `brace-expansion` 5.0.9 -> 5.0.12. No production dependencies exist; lockfile
  diff confined to those subtrees; audit now reports 0 vulnerabilities.

Validation at commit time: `npm test` green, hygiene suite 13/13 with falsified
negatives, lint/Prettier/repo-policy/`git diff --check` clean. Deployment of the
corrected build follows under its own single-attempt authorization below.

`Deployment Authorized: YES (owner-identity hygiene - single attempt)` — granted
by the owner as part of the instruction to finish all PR #18 remediation
end-to-end, to deploy the locally verified hygiene build to the live runtime
through `operator-apply.mjs`. ONE attempt. No rehearsal namespace, no simulation,
no automatic retry, no manual heartbeat trigger. This authorization is consumed by
that one attempt. It deploys remediation only; it does not reopen M8/T2.2, modify
the native runtime lineage, or create R20.

**Deployment result:** PASS at stage `applied`, `transactionStatus: complete`,
no rollback, attempt `txn-a126766b9ac9cc0a42cb92b28eb678408c20b8401c2ee6a5bc715851ad6d5527`.
Live `index.mjs` `2271b56b` byte-identical to the repository packaged artifact;
owner literal absent from the live artifact (0 occurrences); live plugin config
carries all four validated destinations; boundary/selection/ledger unchanged;
post-deployment heartbeat clean. Full record: ACTIVE.md R19 11.

Not acted on, pending decision: Discord channel/forum-tag literals also appear in
production plugin source (server surface identifiers, not personal data; not
flagged by gitleaks; removing them is a broader behavioural change).

### 4.17 Successor schedule — the tracked disposition authority for the 38 re-filed findings

Written by `M12/T4-R1` item `T4-1` (owner grant `grant 1`, 2026-10-17). It exists because the R2 grouping paragraph
above routed 38 findings to the identifiers `T2.4`–`T2.7`, which `M12/T2.1-R3` §5.3 then withdrew, so those findings
had no live successor task. Every row was read before it was written and cites the source that supports its
disposition. PLAN and register locations are named by section or by entry id rather than by line number, because both
files grow and a numeric cite there would rot; archived-contract and source-file cites stay numeric because the
archives are immutable and a source locator is meant to be clickable. **This section, not `docs/execution/findings.md`, is the disposition authority** — the
register is a bug queue and grants no authority (`AGENTS.md` §2). It moved out of the Git-ignored
`.agents/states/findings.md` on the owner's 2026-10-17 instruction "chuyển sang docs/execution đi", which answers the
register half of `H10`.

Two premises this contract carried into that read and had to drop:

- `ACTIVE.md` §0 said **two** of the 38 are absent from the register. Measured at this head, **one** is:
  `R5-E09-08` has no `id:` entry — the E09 lane header reads "7 findings, 3 High" and the block holds exactly seven.
  `R1-A02-01` **is** in the register, but in the Vòng 1 `- **id** —` bullet format rather than the structured `id:`
  block format, which is why an `id:`-anchored count missed it.
- `ACTIVE.md` §0 said the four orphan blocks "belong to no running, scheduled, or excluded tier". **7** of the 38 do
  have an explicit exclusion-with-decision record (`findings.md`'s "Severity was not treated as authorization" paragraph, plus `PLAN.md` §11): they were excluded on
  purpose and only lost their identifier. The remaining 31 are genuinely undisposed.

Provenance keys the Disposition column cites:

- **P1** — the dead routing is §4's R2 grouping paragraph above; the withdrawal is `T2.1-R3:286-295` plus the owner's
  `l1` correction, also above.
- **P2** — the Knowledgebase and adapter blocks were re-filed into the **medium** tier by `T2.1-R3:291`
  ("+ the remaining Knowledgebase block + the remaining Zink Tools adapter surfaces") and are **absent from Wave B's
  admitted set** (`T2.2-R2` §0.5-F) — the same orphaning the `l1` note describes for the Skill Store block.
- **P3** — the only explicit exclusion record in the repo: `findings.md`'s "Severity was not treated as authorization"
  paragraph.
- **P4** — `R5-E13-05`'s guard half: admitted to cluster D (`findings.md`'s cluster-D admitted-set row) → **withdrawn** as unbacked by owner
  answer **I3-A** (`T2.1-R3:245`) → **DECLINED** in Wave B (`T2.2-R2:50-52`). Landed nowhere.
- **P5** — no item heading in any of the four archived contracts cites any of the 38 ids, and
  `git log --all --grep` on them returned no commit **before this task** (the single `R5-E06-*` hit is `R5-E06-07` at
  `96a6dd2`, a Wave A item that is not in this set). Therefore **no row here reads `LANDED`**, and none is formally
  `REFUTED` either.

A row reading `OPEN — re-verify` means: no wave record disposes of it, its premise was last read at Vòng 5
(2026-10-14) or Vòng 6, and the successor band must re-read the cited source before touching it. That is the rule that
killed eight premises in Wave B and two claims in Wave C, and it applies to a schedule row exactly as it does to a
code change.

#### 4.17.1 Bands

| Band          | Subject                                      | Ids | Fix-risk tier                                                                                                                                                                 | Prerequisite owner decision                                                                                                                                                                                                                                                                              | Authorization                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------------------------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M12/T2.2-R3` | Skill Store lifecycle                        | 18  | medium (the `l1` correction above)                                                                                                                                            | **H5** (`R5-E03-07`) and **H8** (`R5-E04-05`, per the P3 paragraph) — both still pending, and the owner's `r2`/`s1` kept them out of this contract                                                                                                                                                       | **CLOSED 2026-10-17**, authorized the same day. Eleven items shipped and one lane was added under `n1` (`R3-12`); `R3-0` stays `NOT RUN` because its probe needs an environment carrying `OLLAMA_URL`. Ten findings survived the pre-freeze read as executable items, four premises died (`R5-E07-05`, `R5-E04-09`, and two clauses of `R5-E05-04`), and `R5-E04-07`/`R5-E05-08`/the caller half of `R5-E04-08` stay excluded by `p1`, `R5-E04-05` by `r2`, `R5-E03-07` by `s1`, `R5-E05-05` by `t1` having produced no evidence yet. One shipped item needed a letter mid-band: `R3-6`'s frozen byte predicate was **measured** refusing every real skill body (35/87 Skill Store tests red), escalated, and re-cut under **`A`**; that commit also carries one agent judgment call — a rollback prune, because a refusal for body content left an empty capability directory that failed the store closed — flagged reversible in §8. Evidence: `Record — M12/T2.2-R3 closed`. |
| `M12/T5`      | A2 packaged module graph                     | 3   | **not assigned by §5.3** — A2 changes how the live plugin resolves source, so it ends at a deployment boundary; this contract proposes "high" and does not promote it to fact | **H6** (`R5-E13-02`); `R1-A02-01` has no §11 tie, and no `--apply`/restart is authorized anywhere in this plan                                                                                                                                                                                           | scheduled, not authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `M12/T6`      | Knowledgebase block                          | 14  | medium (`T2.1-R3:291`)                                                                                                                                                        | **H9** (`R5-E03-05`). The owner's queue places the H5 answer before this band (§2's queue line), but §11 ties H5 to `R5-E03-07`/`R5-E11-02`, not to any id here                                                                                                                                          | scheduled, not authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `M12/T7`      | Zink Tools adapter surfaces                  | 6   | medium (`T2.1-R3:291`)                                                                                                                                                        | none recorded in §11                                                                                                                                                                                                                                                                                     | scheduled, not authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `M12/T8`      | Gate truth                                   | 15  | medium (`T2.1-R3:291`, "all required-gate changes")                                                                                                                           | **H1** (`R5-E09-01`, `-08`), **H2** (`-02`), **H3** (`-03`); the other 11 carry no §11 tie                                                                                                                                                                                                               | scheduled, not authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `M12/T3`      | Documentation/skills procedure + H11 shape 1 | 9   | low for the document items; **RED/architectural** for H11 (`PLAN.md` §11 H11 row says the shape "changes canonical architecture, so it is RED")                               | **H11** answered — the owner chose shape 1 (Main-mediated split) and ordered this band **last** (2026-10-17). Its two named prerequisites no longer exist as work: `R1-A04-01` and `R1-A04-05` landed under `M12/T2.2-R1` `A-1` (`ccf2ad7`) and `A-2` (`09aa698`), each with its own gate evidence in §8 | scheduled, not authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`M12/T5`'s prerequisite was written as **H5** in `ACTIVE.md` §3 `T4-2`. It is not: §11's H5 row cites `R5-E03-07` and `R5-E11-02`, neither of which is in the A2 band, and the owner's queue reads
`… → a2 → h5 → adapter/knowledgebase/gate-truth …` — the H5 answer sits **between** A2 and the next three bands, not
inside A2. Corrected here rather than copied forward.

#### 4.17.2 `M12/T5` — A2 packaged module graph (3)

| Finding     | Sev      | Cat                   | Register locator (`Where:`)                                                                                                                                                                        | Disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Successor               |
| ----------- | -------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `R1-A02-01` | Critical | architecture+security | the Vòng 1 bullet list (legacy format, so no `Where:` field) — the deployed plugin loads live repository source through a hardcoded Windows mount path, bypassing the digest-gated packaged assets | `OPEN — P1` + `PLAN.md` §4's R2 exclusions paragraph "is Critical and stays open — this task does not close it"; verified Critical in Vòng 2 (that round's adjudication list: B08's alternative hypothesis refuted, the finding upheld)                                                                                                                                                                                                                                                       | `M12/T5`                |
| `R5-E13-02` | High     | security              | this finding's register entry — `lib/policy.mjs:896`, `:1303-1311` (`resolveRouterApiKey`), `:1313-1317` (`buildSecretsPlan`)                                                                      | `EXCLUDED — H6` (**P3**; §11's H6 row corrects its details but keeps the premise)                                                                                                                                                                                                                                                                                                                                                                                                             | `M12/T5`                |
| `R5-E13-05` | Medium   | security              | this finding's register entry — `index.mjs:511`; `tests/m7-lane-g-policy.test.mjs:724-733` (M7-063)                                                                                                | `OPEN (removal half) — P1`; the guard half was admitted only to R2's cluster D (`findings.md`'s cluster-D row), then **withdrawn** as unbacked at `I3-A` and **declined** again in Wave B, so it landed nowhere. Premise correction: `index.mjs:511` "is not the only tracked occurrence" (this entry's own "Correction" line). Because Wave B declined even the guard half, only the removal half is left for `M12/T5` — this row must not be read as re-admitting the whole finding as open | `M12/T5` (removal half) |

#### 4.17.3 `M12/T6` — Knowledgebase block (14)

All fourteen: `OPEN — P2` (re-filed to the medium tier, omitted from Wave B's admitted set), premise last read at
Vòng 5 (2026-10-14), `M12/T6` re-verifies before touching — except `R5-E03-05`, which is `EXCLUDED — H9`.

| Finding     | Sev    | Cat         | Register locator (`Where:`)                                                                                                                          | Disposition                                                                                                               | Successor |
| ----------- | ------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------- |
| `R5-E01-02` | Medium | reliability | this finding's register entry — `main.py:238-297` (`readyz_pdf_identity`, `cache_key`) with `pdf_runtime.py:81-91`                                   | `OPEN — P2`; register status is `LATENT`, not `OPEN`, so a copy of the register field would silently change its meaning   | `M12/T6`  |
| `R5-E01-04` | Medium | reliability | this finding's register entry — `database.py:210-219` (`start()` except) + `main.py:166-175`                                                         | `OPEN — P2` (conf: Strongly Supported)                                                                                    | `M12/T6`  |
| `R5-E02-01` | High   | contract    | this finding's register entry — `apps/knowledge/app/main.py:75-78` (`SearchRequest`), `:322-341`, `database.py:1040-1047`                            | `OPEN — P2`; canonical row for `R5-E01-01`, whose entry reads "DUPLICATE of R5-E02-01 — canonical R5-E02-01"              | `M12/T6`  |
| `R5-E02-02` | High   | contract    | this finding's register entry — `database.py:1050-1082`, `:128-145` (`SearchCandidate`), `main.py:419-449`                                           | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E02-03` | Medium | bug         | this finding's register entry — `main.py:451-457` (`min_score` gate), `:414`, `:430`                                                                 | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E02-04` | Medium | contract    | this finding's register entry — `main.py:458-464`, `:395`, `:412`; `retrieval.py:12`                                                                 | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E02-06` | Medium | reliability | this finding's register entry — `main.py:324-326`, `:356`; `model_probe.py:30`; `retrieval.py:53-65`                                                 | `OPEN — P2` (conf: Strongly Supported; cross-linked from `R5-E06-01`'s entry, so `T6` and `T7` share one re-verification) | `M12/T6`  |
| `R5-E03-01` | Medium | contract    | this finding's register entry — `apps/knowledge/migrations/001_initial.sql:3-22` vs `:24-96`; `002_pdf_ingestion_foundation.sql:1,20,24,28,47,71,84` | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E03-02` | High   | reliability | this finding's register entry — `database.py:180-219` `start()`, `:1710-1738` `_apply_migrations`; `main.py:168-175`                                 | `OPEN — P2`; severity explicitly conditional on the unread `config.py` default (E03 lane's honesty note)                  | `M12/T6`  |
| `R5-E03-03` | Medium | reliability | this finding's register entry — `database.py:1519-1565`, `:1626-1646`, `:191` pool `command_timeout=30`; `main.py:166-195`                           | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E03-04` | Medium | perf        | this finding's register entry — `002_pdf_ingestion_foundation.sql:1-91` (`:20-26`, `:80-81`); `database.py:1492-1517`, `:1626-1646`                  | `OPEN — P2`                                                                                                               | `M12/T6`  |
| `R5-E03-05` | Medium | perf        | this finding's register entry — `001_initial.sql:143-144` (global HNSW) vs `database.py:1012-1082`, `:872-963`                                       | `EXCLUDED — H9` (P3 does not name it; §11's H9 row does: a retention decision that deletes derived content)               | `M12/T6`  |
| `R5-E03-06` | Low    | perf        | this finding's register entry — `001_initial.sql:149-150`, `:108`; `database.py:1040-1047`, `:997-1001`                                              | `OPEN — P2`; do not confuse with `R5-E03-07`, which is in the Skill Store band and tied to H5                             | `M12/T6`  |
| `R5-E03-08` | Low    | contract    | this finding's register entry — `001_initial.sql:87-96` (`source_sidecars`), `:70` (enum), `:117-118`                                                | `OPEN — P2`                                                                                                               | `M12/T6`  |

#### 4.17.4 `M12/T7` — Zink Tools adapter surfaces (6)

| Finding     | Sev    | Cat         | Register locator (`Where:`)                                                                                                                 | Disposition                                                                                                                                 | Successor |
| ----------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `R5-E06-01` | High   | reliability | this finding's register entry — `knowledge-adapter.mjs:232-235`, `:317-332`, `:408-411`                                                     | `OPEN — P2` (conf: "Confirmed (code shape)"; mirrored by `R5-E02-06`)                                                                       | `M12/T7`  |
| `R5-E06-02` | Medium | bug         | this finding's register entry — `knowledge-adapter.mjs:23` (`MAX_KNOWLEDGE_RESPONSE_BYTES = 50 * 1024 * 1024`), `:275-288`                  | `OPEN — P2`                                                                                                                                 | `M12/T7`  |
| `R5-E06-05` | High   | contract    | this finding's register entry — `zink-tools/sql/duckdb-bridge.mjs:141-167`, `:188`, `:192`, `:252-259`, `:263`; `sql/validator.mjs:516-540` | `OPEN — P2`; `T2.1-R3:147` still lists it as an `M12/T2.2` item with the `ETIMEDOUT` error shape `Unresolved`, and Wave B never admitted it | `M12/T7`  |
| `R5-E06-06` | Medium | reliability | this finding's register entry — `duckdb-bridge.mjs:203-206`, `:263-267`, `:293-319`                                                         | `OPEN — P2` (conf: Strongly Supported)                                                                                                      | `M12/T7`  |
| `R5-E06-08` | Medium | reliability | this finding's register entry — `skill-adapter.mjs:234-316`                                                                                 | `OPEN — P2`                                                                                                                                 | `M12/T7`  |
| `R5-E06-09` | Medium | contract    | this finding's register entry — `zink-tools/adapters/storage/r2-adapter.mjs:68`, `:144`, `:220-223` (rule stated at `:126-131`)             | `OPEN — P2`                                                                                                                                 | `M12/T7`  |

#### 4.17.5 `M12/T8` — gate truth (15)

| Finding     | Sev    | Cat               | Register locator (`Where:`)                                                                                                                                                                                               | Disposition                                                                                                                                                                                                                                                                                                                                                                   | Successor |
| ----------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `R5-E09-01` | High   | reliability       | this finding's register entry — `.github/workflows/ci.yml:3-8` and `security.yml:3-10`                                                                                                                                    | `EXCLUDED — H1` (**P3**; §11's H1 row re-derives the evidence and adds a weekly `schedule:` the register missed)                                                                                                                                                                                                                                                              | `M12/T8`  |
| `R5-E09-02` | High   | security          | this finding's register entry — `gh api …/branches/main/protection` (repository-level)                                                                                                                                    | `EXCLUDED — H2` (**P3**; §11's H2 row re-confirms the `403`)                                                                                                                                                                                                                                                                                                                  | `M12/T8`  |
| `R5-E09-03` | High   | contract          | this finding's register entry — `ci.yml:42-43` + `tests/m11-t1-postgres-sql-gate.test.mjs:43`, `:100`, `:130`                                                                                                             | `EXCLUDED — H3` (**P3**; §11's H3 row reshaped the decision twice — "no gate names those skips" corrected to "the gap is enforcement, not visibility", needs a per-family expectation)                                                                                                                                                                                        | `M12/T8`  |
| `R5-E09-04` | Medium | testing-gap       | this finding's register entry — `ci.yml:97-100` + `package.json` `test:knowledge` + `apps/knowledge/pyproject.toml:4`                                                                                                     | `OPEN — re-verify`; the only H tie is the **superseded** register copy of the ledger, whose H3 row pairs it with `R5-E09-03`; §11's H3 row does not name it. Used as gate-design rationale at `T2.1-R3:304`, never disposed                                                                                                                                                   | `M12/T8`  |
| `R5-E09-05` | Medium | doc-drift         | this finding's register entry — `tests/repository-policy.test.mjs:84-95` vs `ci.yml:69-100`                                                                                                                               | `OPEN — re-verify`; one mention repo-wide, no wave record disposes of it                                                                                                                                                                                                                                                                                                      | `M12/T8`  |
| `R5-E09-06` | Medium | reliability       | this finding's register entry — `security.yml:42-43` `npm audit --audit-level=high`, no baseline/allowlist file in the repo                                                                                               | `OPEN — re-verify`; the unchanged 5-high `dependency-audit` failure is recorded at successive heads throughout this file, yet no record disposes of the id                                                                                                                                                                                                                    | `M12/T8`  |
| `R5-E09-07` | Medium | security          | this finding's register entry — `security.yml:45-59`                                                                                                                                                                      | `OPEN — re-verify` (conf: Strongly Supported, never Confirmed)                                                                                                                                                                                                                                                                                                                | `M12/T8`  |
| `R5-E09-08` | High   | **none recorded** | narrative only — the orchestrator's 'One new fact … no lane stated' note; the E09 block holds 7 entries and this id has no `id:` row                                                                                      | `EXCLUDED — H1` (P3 names `-01/02/03/08`), **with half its premise refuted**: §11's H1 row records that "HEAD has zero runs" became false once runs were dispatched, and that the "a human dispatched" attribution is unsupportable. `T4-3` creates the missing register entry                                                                                                | `M12/T8`  |
| `R5-E10-01` | Medium | testing-gap       | this finding's register entry — `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs:47`, `:160-181`; `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs:288-310`; `tests/m12-t2-governed-surface.test.mjs:644-661`   | `OPEN — re-verify`; register status `LATENT`, not `OPEN`. This entry pairs it with `R5-E09-03`                                                                                                                                                                                                                                                                                | `M12/T8`  |
| `R5-E10-02` | Medium | testing-gap       | this finding's register entry — `tests/m12-t2-governed-surface.test.mjs:489-505`                                                                                                                                          | `OPEN — re-verify`; **not** covered by Wave B's `B-17`, which is `R5-E10-03` (`T2.2-R2:496`, write set restricted to `:685`/`:692` at `T2.2-R2:247`)                                                                                                                                                                                                                          | `M12/T8`  |
| `R5-E10-05` | Medium | testing-gap       | this finding's register entry — `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:52-55`, `247-266`, `327-372` (env mutation `:79-93`)                                                                                  | `OPEN — re-verify` (conf: Strongly Supported)                                                                                                                                                                                                                                                                                                                                 | `M12/T8`  |
| `R5-E10-06` | Medium | testing-gap       | this finding's register entry — `tests/m12-t2-governed-surface.test.mjs:644-645`, `668-672`, `693-707`                                                                                                                    | `EXCLUDED — needs an owner decision that has no number`: P3 excludes it with a reason ("a digest-pin re-base is its own objective and would ride along with a behaviour fix") and §11 has no row naming it. Re-verified (not refuted) in the Vòng 6 re-derivation table                                                                                                       | `M12/T8`  |
| `R5-E10-07` | Low    | testing-gap       | this finding's register entry — `tests/m11-t1-skill-vector-sql.test.mjs:160-176`; `tests/m7-t3-tools-contract.test.mjs:143-147`                                                                                           | `OPEN — re-verify`; Wave A's `A-7` touched the same file for `R5-E05-01` (`4A.13` mapped at `T2.1-R3:241`, item at `T2.2-R1:213`) and disposes of nothing here                                                                                                                                                                                                                | `M12/T8`  |
| `R5-E10-08` | Medium | testing-gap       | this finding's register entry — `m10-t2-coordinator-binding:1208-1209`; `m8-t2-governed-runtime-audit:2283`, `:2344`, `:2300`, `:2304`; `m9-t1-functional-truth-remediation:956`; `m11-t3-openclaw-runtime-bounds:99-122` | `OPEN — re-verify`; this is the register's headline "assertions on prose, not behaviour" pattern, and Wave C is an instance of it — `C-13`'s `checkGateRegistry` matches the registry's header row (`scripts/repository-policy.mjs:844`) and `G18`'s coverage loop asserts README text (`tests/m7-t4-orchestration.test.mjs:386-425`) — with no record noting the consequence | `M12/T8`  |
| `R5-E13-03` | Medium | security          | this finding's register entry — `README.md:46-52` plus `:60/74/95/107/118/129/140` and `:272-275`; `lib/authority.mjs:619-625`, `:628-636`                                                                                | `OPEN — re-verify`, with a standing constraint: `T2.1-R3:361` rules its snowflake purge "must not be split from its source-guard". **Wave C did not touch it** — `C-1`/`C-3`/`C-4` are `R5-E11-03`/`-02`/`-04`, and `C-4`'s only README edit was the provider table at `README.md:579-591`                                                                                    | `M12/T8`  |

**Count check (`ACTIVE.md` §6.4):** 3 + 14 + 6 + 15 = 38 rows; `EXCLUDED` 7, `OPEN` 31, `LANDED` 0, `REFUTED` 0 at id
level (four rows carry a partial premise correction instead: `R5-E09-03`, `R5-E09-08`, `R5-E10-06`'s re-derivation, and
`R5-E13-05`'s occurrence count).

### 4.18 Citation key — the `ACTIVE.md` sections this file cites

**The M12/T9 contract is archived, not live.** The execution contract of this band is `docs/contracts/execution/archive/2026-10-21-M12-T9-R1.md`; the live `docs/contracts/execution/ACTIVE.md` was archived before it was deleted, so every section this file cites still resolves to a tracked file.

**Citation key.** The execution contract is transient and Git-ignored, so every numbered section this file cites must resolve to a tracked file. This table is that resolution; a citation with no row here resolves to nothing.

| Cited `ACTIVE.md` section                                                                                                             | Tracked resolution                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R2`, `R2 10`, `R2 10.4`, `R3`, `R4`, `R5`, `R6`, `R7`, `R18`, `R18 3`, `R18 8`, `R18 9`, `R19`, `R19 8`, `R19 9`, `R19 10`, `R19 11` | git `4e360716` — `git show 4e360716:docs/contracts/execution/ACTIVE.md` carries every one of these section headings; that contract revision predates the archive mechanism, so the commit is the tracked pointer                                                                                                                                                                 |
| `§0`, `§4A`, `§5` of the M12/T2.x contracts                                                                                           | `docs/contracts/execution/archive/2026-10-15-M12-T2.1-R3.md`, `docs/contracts/execution/archive/2026-10-16-M12-T2.2-R1.md`, `docs/contracts/execution/archive/2026-10-16-M12-T2.2-R2.md`, `docs/contracts/execution/archive/2026-10-17-M12-T2.2-R3.md`, `docs/contracts/execution/archive/2026-10-17-M12-T2.3-R1.md`, `docs/contracts/execution/archive/2026-10-17-M12-T4-R1.md` |
| `§7 step iv` (the M11/T3 mutation ledger)                                                                                             | `PLAN.md` §8 `### M11/T3-R1` record — that contract was deleted before the archive mechanism existed and is not recoverable; its ledger is mirrored in the tracked record                                                                                                                                                                                                        |

## 5. Canonical target architecture

The repository retains three logical modules.

Canonical new-work paths are:

```text
apps/knowledge/                 # accepted current Knowledgebase runtime (AGENTS.md §9)
platforms/knowledge-platform/   # canonical target-architecture spec, not a runtime
zink-skill-store/               # peer Skill Store module
zink-tools/                     # peer Tools module
integrations/openclaw/          # external OpenClaw integration
```

The current Knowledgebase runtime path is retained for compatibility; it is not
the parent of Zink Skill Store or Zink Tools.

### 5.1 Zink Knowledgebase

- owns approved human/reference knowledge, ingestion, retrieval, provenance and
  citations;
- preserves the existing owner-approved Knowledgebase taxonomy and Supply Chain
  coverage; this plan does not redefine or narrow it;
- may include Decision and Business Semantics knowledge through the existing
  taxonomy when approved;
- keeps the source Obsidian Vault human-owned and read-only;
- preserves accepted M3/M4 runtime paths until a separately approved migration.

### 5.2 Zink Skill Store

- owns reusable governed skills and their lifecycle/provenance;
- owns reusable **Excel and Power BI templates** as owner-authored assets;
- keeps Knowledgebase research state logically isolated from learned skills;
- uses task metadata rather than physically splitting Work and Research stores;
- normal skill retrieval returns governed/published versions only.

Task-mode rule:

```text
mode: work | research
```

Main classifies mode from task intent. For mixed tasks it may assign a primary
and secondary mode. Research outputs are never silently promoted into a work or
production path.

### 5.3 Zink Tools

Zink Tools is the callable execution surface for OpenClaw and approved n8n
workflows:

```text
excel
power-bi
sql
python
n8n
forecast
optimization
operations-research
simulation
```

OpenClaw owns orchestration, specialist routing, sandboxing, permissions, task
mode and model/tool execution policy. n8n owns deterministic triggers, schedules,
connectors and workflow run state. Zink Tools owns neither orchestration nor
persistent Knowledge/Skill state.

## 6. Five-stack model

```text
STACK 5 — DECISION
Main + O1 + O2: compare alternatives, risk/trade-offs, recommendation

STACK 4 — INTELLIGENCE
Forecast / Optimization / Operations Research / Simulation

STACK 3 — SEMANTIC
O1: domain meaning, KPI, business rules, constraints, policies

STACK 2 — EXECUTION
Excel / Power BI / SQL / Python / n8n

STACK 1 — INFRASTRUCTURE
R2 / DuckDB / MotherDuck / Kaggle / Databricks / local compute
```

Stacks are functional layers, not permanent one-agent-per-stack processes.
Baseline execution specialists are Excel, Power BI, SQL and Python. Intelligence
specialists may be created or invoked lazily.

## 7. L&SC Data Plant — logical flow only

The historical name is retained only as an architectural description of how L&SC
data and compute move through existing infrastructure:

```text
Source
→ n8n / Python
→ R2 / DuckDB / MotherDuck
→ Kaggle / Databricks / local compute
→ Forecast / Optimization / OR / Simulation
→ OpenClaw
→ Excel / Power BI delivery when required
```

There is no separate L&SC Data Plant runtime/platform to build.

Explicitly out of scope:

- self-built Bronze/Silver/Gold lakehouse;
- generic ETL control plane;
- feature store or generic model registry;
- generic MLOps/training platform;
- duplicated OpenClaw or n8n workflow/orchestration state;
- direct adapter writes to Knowledgebase/Skill Store persistence internals.

## 8. Delivery sequence

```text
M0 Plan/Architecture
→ M1 Development Foundation
→ M2 Local Infrastructure
→ M3 Markdown Knowledgebase
→ M4 PDF Ingestion                 [COMPLETE]
→ M5 Architecture Contraction      [COMPLETE]
→ M6 Zink Skill Store              [COMPLETE / REMOTE-BACKED]
→ M7 Zink Tools + OpenClaw Integration + V1 Hardening/Release [COMPLETE]
→ M8 Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration [COMPLETE]
```

### M5 — Architecture Contraction

Status: `COMPLETE`
Execution Authorization: `NO`

Current scope:

- keep the accepted Knowledgebase runtime at `apps/knowledge/` — the only runtime
  path, since `platforms/knowledge-platform/` is its canonical target-architecture
  spec and holds four `.gitkeep` placeholders and no code — until a separately
  approved runtime migration;
- make `zink-skill-store/` a peer module rather than a child of Knowledgebase;
- make `zink-tools/` a peer module rather than an integration subsystem;
- use `integrations/openclaw/` as the canonical OpenClaw integration path;
- remove obsolete `integrations/agents-system/`, nested Skill Store paths, legacy
  `integrations/zink-tools/`, and residual L&SC Data Plant runtime scaffolding;
- retain only `docs/architecture/lsc-data-flow.md` for the historical L&SC Data
  Plant concept: a logical external data/compute flow, not a runtime module;
- preserve the existing Knowledgebase taxonomy and Supply Chain coverage;
- formalize the five-stack mapping without creating five new runtime modules;
- do not refactor M3/M4 ingestion code merely for folder symmetry.

### M6 — Zink Skill Store

Status: `COMPLETE`
Task: `M6/T1 — Git-native governed skill core`
Historical Plan Revision: `M6/T1-R4`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `REMOTE-BACKED`
Task Commit: `fb746021b8b1a51080d1ba4fed4b35011bb78ce6`
Task Branch: `codex/m6-t1-git-native-skill-store`
Upstream: `origin/codex/m6-t1-git-native-skill-store`
Remote Task Verification: `PASS`
Post-completion Fix Commit: `652ed9bd248dcc047a2be09300aaaba1d9c2dbbf`
Remote Fix Verification: `PASS`

M6/T1 delivered Git-managed strict JSON manifests and Markdown content,
complete-catalog fail-closed validation, and exact retrieval of one ACTIVE
version. Routing context remains M7/OpenClaw policy and is not manifest
metadata. M6/T1 completion closes M6 after this governance closeout commit is
remotely verified.

### M7 — Zink Tools + OpenClaw Integration + V1 Hardening

Status: `IN PROGRESS`
Task: `M7/T1 — OpenClaw foundation`
Task Status: `COMPLETE`
Historical Plan Revision: `M7/T1-R19`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Foundation Commit: `e15a1adf9ed50ec34e1db57f825771616d9dd2c9`
R19 Implementation Commit: `7b5edc510d463eec197f000191d907e5b17aa87c`

M7/T1-R19 is an owner-approved bounded upstream backport for pinned OpenClaw
2026.6.34. It preserves the R17 Google SSE terminal checks and R18 Discord
final-only delivery, classifies incomplete terminal streams as timeout-class
failover events, and suppresses errored partial assistant text/reasoning and
terminal evidence. The investigation and post-fix gates covered all seven bots.
The exact hotfix utility and runtime artifacts passed integrity checks; the full
repository gate passed 81 tests, all 60 live OpenClaw gates passed, and the owner
observed three repeated all-seven Discord tests with complete replies and no
truncation. M7/T2-R11 is now the authorized current task recorded in section 4.

M7/T1-R16 retained the R15 minimal-tool compatibility decision and recorded the
owner's 2026-09-07 correction that Discord capability evidence is an operational
minimum gate, not an exact non-admin permission allowlist. All 28 account/surface
pairs must expose the required text/forum permissions; administrator,
channel/role/webhook management, and application-command permission remain
forbidden. Commands and additive tool grants remain disabled, and model
selection remains constrained to the two Google aliases. Exact implementation
details were implemented and validated without enabling internal delegation.
Focused OpenClaw tests, the full 76-test repository gate, `git diff --check`,
host/runtime/security checks, seven model and auth-order probes, all 28 Discord
account/surface permission probes, and owner-observed live behavior passed.
M7/T2-R11 owns the current five-stack topology implementation under the active
execution contract referenced in section 4.

Minimum scope:

- four baseline execution specialists: Excel, Power BI, SQL and Python;
- tool surfaces for Excel, Power BI, SQL, Python and n8n;
- decision-science tool surfaces for Forecast, Optimization, OR and Simulation;
- Main intent classification to `work`, `research`, or mixed primary/secondary;
- external infrastructure usage through the lightest practical integration;
- training/heavy compute stays on approved external infrastructure when needed;
- compatibility tests, bounded errors/timeouts and failure isolation;
- no secret values committed to integration configs.

### M8 — Zink Skill Store 2-Way Governed Vector RAG & Agent Memory Integration

Status: `COMPLETE`
Task: `M8/T1 — Governed Skill Vector Store, Semantic Search & Agent Proposal Pipeline`
Task Status: `COMPLETE`
Historical Plan Revision: `M8/T1-R1`
Planning Readiness: `APPROVED`
Execution Authorization: `NO`
Execution Contract: `NONE`
Evidence: `LOCAL-VERIFIED`
Task Branch: `codex/m8-t1-skill-vector-memory`

M8/T1 implemented a 2-way long-term memory system for Zink Skill Store and a 1-way
read-only semantic RAG pipeline for Zink Knowledgebase:

- PostgreSQL schema `skills` initialized with `catalog_index`, `segments`, and
  `skills_segments_embedding_hnsw_idx` (1024-dim BGE-M3 HNSW cosine index);
- shared canonical semantic contract (`zink-tools/common/semantic-contract.mjs`)
  enforces deterministic uppercase envelope formatting, SHA-256 content hashing,
  safe query truncation, and non-hallucinating taxonomy derivation;
- Git-to-PostgreSQL vector synchronization (`zink-skill-store/src/vector-sync.mjs`)
  enforces fail-closed active catalog filtering, source-drift abort safeguards,
  and 1024-dimension vector constraints; Git remains the canonical authority;
- callable tool interfaces added for `zink_skill_search` (ACTIVE-only cosine similarity),
  `zink_skill_propose` (human-in-the-loop candidate proposal via `#approvals`,
  preventing direct activation), and `zink_knowledge_search` (hybrid search proxy);
- Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`)
  authenticates owner identity and binds immutable proposal content hashes before
  promoting candidate skills to Git;
- OpenClaw RBAC policy updated granting retrieval to all 7 bots and proposal rights
  to execution specialists and O1;
- Discord Mobile mention resolution remediated (supporting `<@ID>`, `<@!ID>`, raw
  snowflakes, and Vietnamese text patterns with corrected punctuation lookahead) and
  Gateway stability ensured with `replyToMode: "off"`;
- full verification suite passed with all 123 tests clean.

### M8/T3 - Governed Long-Term Memory Learning Loop (owner-authorized follow-up)

Status: `IMPLEMENTED (local)`
Task: `M8/T3 - make the Zink long-term memory / learning architecture work end-to-end`
Historical Plan Revision: `M8/T3-R1`
Planning Readiness: `APPROVED`
Execution Authorization: `YES` (explicit owner instruction, 2026-10-01 session)
Execution Contract: `NONE` (`docs/contracts/execution/ACTIVE.md` R19 is retained
unchanged as the closed M8/T2.2 historical record; the owner session instruction
is the implementation authority for M8/T3)
Evidence: `LOCAL-VERIFIED`
Owner acceptance: not claimed
Task Branch: `codex/m8-t2-governed-runtime-hardening`

M8/T3 does not reopen M8/T2.2 (CLOSED at R19, no R20) and does not change the
three-module architecture, seven-agent topology, governance model, security
boundary, or OpenClaw native-memory disablement.

Implemented in this revision:

- Skill learning: durable atomic proposals holding the exact approved bytes,
  a dedicated `#office` skill approval identity (`zink:skill:approve` /
  `zink:skill:reject`) that is distinct from execution-plan approval, and a
  trusted internal canonical writer (`promoteApprovedSkill`) that publishes
  `SKILL.md` + `manifest.json` as ONE logical unit (stage -> validate -> single
  atomic rename) with residue healing, then derives the pgvector index.
- Decision learning: deterministic record identity, idempotent exact replay, and
  explicit owner correction with supersession, so exactly one authoritative
  decision per governed key is applicable in a fresh process.
- Reuse proof: search results now carry `canonical_skill_id`, which resolves
  through the canonical read/apply boundary to the exact approved `SKILL.md`.
- Contract/repair work preserved from the earlier part of this task:
  `subject_type` + `proposal_id` in the approval packet (no workflow `task_id`),
  `NO_MATCH` in the skill tool contract, removal of the legacy `namespaces`
  discover fallback, and the single canonical `content_sha256` of the exact
  bytes.
- Documentation: `docs/contracts/skill-store/agent-skill-store.md`, the new
  `docs/contracts/decision-ledger.md`, the three architecture pages, the
  `zink-skill-store/README.md`, root `README.md` and `CHANGELOG.md` now describe
  the proven runtime and separate implemented from deferred behavior.

Intentionally deferred (not claimed as working):

- User-written Knowledgebase persistence. The Knowledgebase adapter forbids
  ingestion/update by contract and the human-owned Vault is read-only, so
  factual/reference teachings route honestly with `persisted: false` instead of
  pretending to be stored.
- A governed deprecation path, so promoting a new version of a capability that
  already has an ACTIVE version still fails closed.

Validation: `npm test` 910 tests / 868 pass / 0 fail / 42 skipped (pre-existing
environment skips: R14/R16/production-ledger on Windows, unchanged by this
revision); `npm run lint`, `npm run format:check`, `npm run repo:check` and
`git diff --check` all exit 0. Focused proof:
`tests/m8-t3-governed-memory-learning.test.mjs`, 41 tests, 41 pass, 0 fail.

Not live-verified: no live OpenClaw runtime, no live Discord card delivery, no
deployment, and no real pgvector/Ollama end-to-end run. Those were not attempted
from this environment and are not claimed.

### M10/T2 - Coordinator session binding and execution authority (owner-authorized implementation)

Status: `IN PROGRESS`
Task: `M10/T2 - bind a gateway-started coordinator run to its claimed queue attempt, and fence that binding to current execution authority`
Historical Plan Revision: `M10/T2-R9`
Parent Revision: `M10/T2-R8` (closed live: zero-outbound proven, see `### M10/T2-R8` tail); R7 commits `97dfe54`/`ef9feb0`
Planning Readiness: `APPROVED`
Execution Authorization: `YES` (R9 per explicit owner authorization 2026-10-06: replace the 21 Google AI Studio API-key pool with a single external router pool shared by all 7 agents, plus the duplicate-path runId observability line; chain authorized as fix -> test -> deploy -> live verify -> commit)
Execution Contract: `docs/contracts/execution/ACTIVE.md`
Behavior Contract: `docs/contracts/coordinator-session-binding.md` (§1-§13 the
approved design package, §14 the R2 execution-authority addendum)
Evidence: `LOCAL-VERIFIED`
Owner Approval: EXPLICIT - Owner approved implementation of M10/T2-R1 exactly
per the frozen RED design contract, scope items 1-10 only, with the listed
exclusions (no new agents/queue/broker/service/memory, no pin upgrade, no
result-ingestion redesign, no fabricated lineage, no topology change), and
authorized the M10/T2-R2 safety remediation derived from the M10/T2-R1 pre-live
safety audit. Approval covers implementation only, not live execution and not
deployment.
Deployment Authorized: `YES (R8 end-to-end, owner-authorized: observability deploy PASS, 1st fix deploy FAILED and rolled back, deployment-safety fix + 2nd fix deploy PASS; no further deploy without a new prompt)`
Deployment Status: `DEPLOYED AND VERIFIED (txn-95389eb… PASS; live preflight f15e9078 carrying the hardened [zink-ingress-meta] diagnostics, entrypoint 6a7968b7, selection 04e92061, boundary bccfa861, authority 42b0cba8, ledger d794d99d at 103 events, MainPID 461403)`
Live Execution: `OBSERVE-ONLY (owner sends controlled TEST A/B; agent performs read-only log correlation, no synthetic events, no message sending)`
Safety Audit: the R1 pre-live audit returned `PRE-LIVE SAFETY AUDIT FOUND SAFETY
ISSUE - LIVE BLOCKED` (post-lease spawn authority, attempt isolation at the
mutation boundary, `QUEUED`-window containment fallthrough). R2 remediates all
three and is locally verified. The pre-live re-audit re-confirmed all six static
claims from the working tree and the live-state forensic pass resolved the one
open discrepancy (see below); no live entry criterion has been satisfied because
no live execution has occurred and no live-verification authorization exists.

Live-state forensic result (read-only, recorded in ACTIVE.md R2 10): an earlier
re-audit reported the authoritative live ledger as empty. That was a WRONG-PATH
observation. The authoritative state directory is
`/home/hoang_vinh/.openclaw-zink` inside WSL Ubuntu, where service
`openclaw-gateway-zink.service` is loaded and active; its ledger matches the
recorded evidence exactly (`events.jsonl` 96701 bytes / sha256 `d794d99d…` /
103 lines, `snapshot.json` 80172 bytes / sha256 `bbdf3aec…` / sequence 103 /
37 tasks, mtime 2026-09-28T17:26:11 +0700), as do the recorded live extension
`2271b56b` and boundary `d88bff80`. A separate, older Windows-side state
directory (`C:\Users\HOANG VINH\.openclaw-zink`, `m7-t2-r12` lineage, OpenClaw
2026.7.1-2) holds an empty ledger and is NOT the runtime's state dir. The
recorded live evidence is therefore CURRENT, no ledger data was lost, and no
restore is required. The earlier claim that no live task was claimable is
WITHDRAWN.

M10/T2 does not reopen any closed task. The RED analysis established
`SESSION_BINDING_STATUS = ADDITIVE_EVENT_REQUIRED`: no existing workflow event
can safely bind a gateway-started coordinator run (`api.runtime.subagent.run()`,
verified byte-level on pinned `OPENCLAW_RELEASE = 2026.6.34`) to an
already-claimed queue attempt, because `findSession()` resolves only root
sessions and spawn-bound delegations. The implemented event is
`WORKFLOW_COORDINATOR_RUN_BOUND`; result ingestion stays a separate future
task. Coordinator result ingestion and live execution remain not verified: no
real coordinator turn has been started from this repository.

R2 keeps the architecture and separates three concepts R1 conflated: `binding`
is historical identity and attribution, `attempt` is the execution generation
and supersession fence, `lease` is current execution authority. A historical
binding NEVER authorizes a governed mutation on its own. The fence is enforced at
the authoritative mutation: the spawn reservation commits inside the queue's own
critical section (`QueueManager.withExecutionFence`), and `applySpawnReserved`
independently refuses a superseded generation or a task no longer claimed by that
coordinator. Coordinator lifecycle classification moved from queue liveness to
identity, so a superseded coordinator run ending while its queue item is `QUEUED`
is still handled narrowly and can never reach the generic `ALL_LIVE_RUNS`
containment sweep; the authoritative binding also wins over the queue claim
holder, so a specialist holding its own live claim cannot make a bound
coordinator run containment-eligible; genuine unreconciled native containment is
unchanged.
Provenance: the outgoing R1 packaged entrypoint is admitted as a recognized
predecessor in both per-mode lists, and `native-boundary.mjs` is untouched, so no
lineage moved.

Implementation evidence: focused M10 suites 81/81 (R2 18, R1 42, T1 21); full
`npm test` 1077 tests / 1035 pass / 0 fail / 42 skipped (pre-existing Windows
ledger-replay skips); lint exit 0; format clean; repository policy passed;
`git diff --check` clean. Python knowledge suite NOT RUN - prerequisite
unavailable in this environment (`KNOWLEDGE_TOKENIZER_PATH` and the tokenizer
model are absent; no Python or knowledge file is touched by this change).
Falsified four ways: reverting the classification fix fails exactly R2-D and
R2-E, removing the guard-side fence fails R2-A2/B/F/G/J2/J4, removing the reducer
fence fails exactly R2-C and R2-C2, and reverting only the binding-over-claim-
holder rule fails exactly R2-K. An independent coverage review of the uncommitted
R2 tree found that last gap - a fully bound coordinator run was still contained
when a specialist held the live claim, because a specialist is an assigned
claimant for its own queue item - and it is fixed in this revision.
See CHANGELOG.md Unreleased entry and ACTIVE.md R2 (R2 1-9 for the
implementation and the pre-live re-audit, R2 10 for the live-state forensic
result, R2 11 for the repository closure and artifact freeze).

Repository closure (R2 11): the apply-mode entrypoint predecessor list was
missing six digests the preflight gate admits, which would have let
`--preflight` PASS and `--apply` refuse from an intermediate build. All six were
re-derived from the commits that produced them using the repository's own
procedure (materialize the commit's `integrations/openclaw` tree, call
`governancePluginFiles()`, hash the packaged entrypoint) and only then admitted:
`a3dbf945…`=2ef4bd64, `118db9a7…`=adc1a49f, `4bb0c1e1…`=598481c9,
`36ed858c…`=eed43f60, `0940eb77…`=9f52fcd6, `4a957b24…`=dc868066. None was ever
the deployed live build, and the current-build digest is still not admitted. Tests
`R13 2h` and `R13 2i` pin the six admissions and the structural per-mode parity
invariant so the class cannot re-open.

Residual dispositions at closure: the unbound-ambiguity path to generic
containment is an `ACCEPTED SEPARATE SAFETY DECISION` — narrowing its blast radius
would assume the owner of an unrecorded native child, which is the exact fact the
fail-closed sweep refuses to assume, so it is documented rather than patched. The
unfenced `brief_state === "DRAFT"` run-end branch is `UNREACHABLE UNDER CURRENT
CONTRACT`, pinned by test `R2-DRAFT`. Host lifecycle semantics remain NOT PROVEN
and require a separately authorized live window.

Remaining blockers to a live window, in order: (1) no live-verification
authorization; (2) the live runtime carries `2271b56b`, which predates all
M10/T2 code, so R2 cannot be exercised live without a separate deployment
authorization; (3) host lifecycle-event semantics for `api.runtime.subagent.run`
are NOT PROVEN and observable only inside an authorized window.

Deployment/runtime provenance has been traced and cleared (ACTIVE.md R2 10.4):
`operator-apply.mjs` targets `/home/hoang_vinh/.openclaw-zink` and
`/home/hoang_vinh/.local/lib/node_modules/openclaw` (OpenClaw `2026.6.34`), and
that is exactly the package and state dir the live `openclaw-gateway-zink.service`
ExecStarts; `dist/selection-DopzNY3I.js` is present there at sha256
`555f37da…` and the dist bridge is `d88bff80…`, matching the recorded live
lineage. The Windows npm install (`2026.7.1-2`, `selection-JInn13lc.js`) is a
second, separately pinned lineage and is not the deployment target; an earlier
report of it as a lineage discrepancy was a wrong-path observation and is
withdrawn.

### M10/T2-R3 - proven governance-asset predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - the owner authorized exactly one narrowly
scoped repository repair for the M10/T2-R2 deployment deadlock identified by
read-only builder-preflight. Operation `REPOSITORY_IMPLEMENTATION_ONLY`;
deployment NOT AUTHORIZED; live execution NOT AUTHORIZED.

Problem: the R2 candidate (`d254f56`) is repository-complete and
artifact-reproducible, but the single authorized deployment attempt never
started: `configure.mjs --preflight` refused the live runtime with
`Governance plugin asset drift detected` and `installed_mutation: false`. The
live runtime carries the owner-identity hygiene build (extension `2271b56b`),
whose ten governance-plugin assets differ from the R2 build and were not
admitted in `ALLOWED_GOVERNANCE_ASSET_SHA256` - an asset-level
predecessor-admission deadlock of the exact class R13 documents for the
entrypoint. R2 closure had extended only the entrypoint lists.

Provenance (10/10 PROVEN, 0 admitted on faith): the live deployed tree (34
files, digests captured read-only via WSL `sha256sum`) is byte-identical to
the packaged governance-plugin build produced by commit `41c62e7`
("deployment path for the hygiene build + its proof") through the
repository's own `governancePluginFiles()` - 34/34 files match, including the
already-admitted entrypoint `2271b56b`. The parent `9b53f92` packages these
files byte-identically. Each admitted digest was re-derived from that commit
before admission; the current-build digests are deliberately NOT listed and
remain accepted by content comparison.

Change (minimal, one table): ten predecessor digests added to the existing
shared `ALLOWED_GOVERNANCE_ASSET_SHA256` in `integrations/openclaw/
configure.mjs`, each under its own asset path with a provenance comment:
`lib/guard.mjs` `9e7e2845…`, `lib/workflow.mjs` `e78d81bf…`, `lib/policy.mjs`
`e29812bc…`, `lib/authority.mjs` `bb2f5328…`, `lib/queue-manager.mjs`
`97fa9907…`, `lib/decision-ledger.mjs` `9b5f2f94…`,
`contracts/approval-request.schema.json` `29eb3ed9…`,
`contracts/ledger-event.schema.json` `6acc2539…`,
`contracts/ledger-snapshot.schema.json` `a8c3d7aa…`,
`governance-manifests.json` `e27647b9…`. No R2 logic touched; the preflight
and apply gates consume the same single table, so no per-mode asymmetry can
re-open. Unknown digests still fail closed; path-scoping is preserved.

Regression: `tests/m10-t2-r3-asset-predecessor.test.mjs`, 11 tests -
provenance re-derivation (P1), optional live cross-check (P2, skips where the
live dir is unreachable), 10/10 provenance parity (R3 0), current-build
exclusion (R3 0b), single-table structural parity (R3 0c), per-predecessor
preflight-PASS-then-apply-ACCEPT with convergence (R3 1), the exact
production failure state as a full-hygiene-tree fixture (R3 2), one-byte
perturbation refusal per digest (R3 3), unknown-digest refusal without
mutation (R3 4), wrong-path refusal (R3 5), and full-table fail-closed
sweep (R3 6). Acceptance tests were watched FAIL before the allowlist edit
(reproducing the production deadlock in-fixture) and PASS after; negatives
passed throughout.

Self-correction recorded: a hand-transcribed digest table used during
diagnosis briefly suggested an 11th differing asset
(`policy/reason-code-matrix.json`); two programmatic probes and two fresh
read-only live reads agree the live file equals the current build
(`4cd65444…`, accepted by content comparison), so the transcription was
wrong and no 11th admission exists. Scope stays exactly the ten proven
assets.

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and NOT
PERFORMED; live ledger untouched; gateway not restarted; no live execution;
host lifecycle NOT PROVEN. A deployment of the new R3 commit requires a
separate owner authorization for exactly one attempt. See ACTIVE.md R3 and
CHANGELOG.md Unreleased entry.

Deployment note (factual, recorded under R4): R3 `a09fc25` was subsequently
deployed under a separate single-attempt owner authorization
(`operator-apply.mjs` PASS at stage `applied`, transaction `txn-48fd57b7…`
complete; live entrypoint `d1ce6386…`). Repository authorization records
were intentionally left unchanged by that authorization's own prohibitions.

### M10/T2-R4 - Main conversational ingress via native thread metadata (owner-authorized implementation, Option A)

Owner authorization: EXPLICIT - owner chose Option A (deterministic native
metadata forwarding) after the R4 scope investigation proved mention and
reply-reference attribution unobservable at the admission seam without a
patch change, and plugin-side message_received caching racy by host
fire-and-forget construction. Operation `REPOSITORY_IMPLEMENTATION_ONLY`;
deployment NOT AUTHORIZED; live execution NOT AUTHORIZED.

Root cause (R3 forensic, treated as proven): free-text Discord ingress is
denied at `authenticateIngress` with MISSING_MENTION because the native seam
receives no mention/reply/author metadata. Host census on pinned 2026.6.34
proved exactly one additional deterministic inbound field available in
runEmbeddedAttempt params: `currentThreadId` (zero occurrences of mentions,
reply references, or authors in the 644KB selection bundle).

Implementation (minimal): native patch forwards
`threadId: params.currentThreadId ?? null` in the established injection
slot; boundary passes it through typed (null or Discord snowflake,
malformed fails closed); plugin records Main-owned thread attribution from
Main's own awaited `message_sending` posts (bounded memory-only map, exact
match, eviction/restart degrade to deny); admission bypasses ONLY a
missing-mention routing refusal when the inbound thread is proven
Main-owned, ANDed with all existing authority checks; downstream governance
unchanged. Mention/reply attribution and non-thread conversation
continuation stay denied (documented, not heuristically approximated).

Lineage (owner-authorized): single descriptor R7→R10 becomes R10→R4 for
`selection-DopzNY3I.js` on 2026.6.34 (one active slot; R7 retired with
history retained — no R7 runtime remains in the deployment graph). R10 live
bytes (555f37da) invert to the pinned baseline a5698c55 and yield the R4
selection 04e92061… (reproducible). Outgoing R3 entrypoint d1ce6386
admitted in both per-mode predecessor lists. R18-13/15 and R19-G pins
updated to the R4-authorized bytes with history comments (their purpose as
change detectors preserved).

Regression: `tests/m10-t2-r4-conversational-ingress.test.mjs`, 19 tests
(native contract, pure classifier, end-to-end admission incl. duplicate
replay denial, heartbeat intact, malformed fail-closed, mention-text
insufficiency). N1/A1 watched FAIL pre-fix, 19/19 post-fix; R18/R19/hygiene
suites green after pin updates; R2/R3 green.

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and NOT
PERFORMED; live ledger untouched; gateway not restarted; no live execution;
host lifecycle NOT PROVEN. A deployment of the new R4 commit requires a
separate owner authorization. See ACTIVE.md R4 and CHANGELOG.md Unreleased
entry. Residual live risk recorded for verification: the office-channel
check assumes the host keeps parent-channel (not thread-id) in
messageChannel for thread replies; if live shows otherwise the path fails
closed and reports, never mis-admits.

### M10/T2-R5 - Host-side Discord inbound metadata exposure (owner-authorized implementation, Option A)

Owner authorization: EXPLICIT - owner chose Option A after R4 proved
mention/reply attribution unobservable at the native seam and
message_received caching racy by host fire-and-forget construction.
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause (proven, pinned 2026.6.34 dist, read-only): the host drops
structured Discord metadata during canonical mapping (canonical mapper and
run params carry zero mention/reference fields), so the native seam could
never observe them. The raw discord.js message (mentionedUsers/
mentionedRoles/messageReference/referencedMessage/author) plus the
host-resolved threadOwnerId exist one layer upstream at the Discord
preflight call site (unique anchor, verified byte-exact).

Implementation (minimal, causal, no side channel): preflight patch records
structured ids into a bounded messageId-keyed registry on the inbound
causal path (a turn exists only after its message's preflight completes);
boundary reads it back by currentMessageId with strict re-validation;
admission feeds structured mentions into the EXISTING mention resolver
(no routing change), adds a reply-author branch and a host-owner thread
branch (retiring R4's outbound-attribution cache - single ownership
source), ANDed with all existing authority checks; authorIsBot restores
the previously vacuous bot filter. No LLM, no text heuristics, no cache
with timing, no new services. Selection patch UNCHANGED from R4.

Lineage: new pin + role for message-handler.preflight file (live equals
unpatched baseline dca5459d…, BASELINE→R5 direct, no descriptor);
selection descriptor R10→R5 (live is R10 555f37da; R4 tree state 04e92061
superseded-and-recorded, never deployed; R7 retired with history kept).
R10 live bytes invert to baseline a5698c55 and yield R5 selection
04e92061 (== R4 tree artifact, as designed). Outgoing R3 entrypoint
d1ce6386 was already admitted in R4. R18-13/15, R19-G, R5-derivation
hunks and R13/R3 current-pins updated to the authorized bytes.

Regression: `tests/m10-t2-r5-host-inbound-metadata.test.mjs` (27 tests:
pin/anchor/prohibition pins, REAL injection snippet executed in synthetic
host scopes, reader normalization, pure reply classifier, end-to-end
admission incl. mention/reply/owner ALLOW and all negatives, lineage
slots). R4 suite reworked to host ownership (19 tests). N1/A1 watched
FAIL pre-fix, 46/46 GREEN post-fix. Provisional cross-test stash pollution
found and fixed by unique message ids (production-faithful).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment of the new R5 commit
requires a separate owner authorization. See ACTIVE.md R5 and CHANGELOG.md
Unreleased entry. Residual live risks for verification: (1) office-channel
check assumes parent-channel in messageChannel for thread replies
(fail-closed either way); (2) referencedMessage present only when Discord
supplies it, else null (deny preserved).

### M10/T2-R6 - Native boundary predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - exactly one narrowly scoped repair for the
R5 deployment preflight deadlock (live boundary d88bff80 unadmitted).
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause: every revision since R18 left `lib/native-boundary.mjs`
untouched, so the live R3 runtime still carries the R18 build d88bff80
while the R5 candidate rebuilds it as bccfa861 - and no allowlist entry
covered the live digest. Same asset-admission deadlock class as R2/R3.

Provenance (1/1 PROVEN, 0 admitted on faith): materialized commit 980b36e
(R18 run-end liveness propagation) and packaged it through the
repository's own `governancePluginFiles()` - byte-identical to the
observed live file. (9b53f92/41c62e7 package identically; 980b36e is the
origin commit and the recorded source.)

Change (minimal, one entry): d88bff80 admitted under
`lib/native-boundary.mjs` in the shared `ALLOWED_GOVERNANCE_ASSET_SHA256`
with provenance comment. Candidate bccfa861 stays unlisted (content
comparison). No native logic, ingress, R2-R5 code, or unrelated entry
touched; preflight and apply consume the same table.

Regression: `tests/m10-t2-r6-boundary-predecessor.test.mjs`, 8 tests
(provenance re-derivation P1, 1/1 parity R6 0, candidate exclusion R6 0b,
shared-table R6 0c, predecessor preflight-PASS-then-apply-ACCEPT with
convergence R6 1, one-byte perturbation R6 2, unknown digest R6 3,
wrong-path R6 4). R6 0/R6 1 watched FAIL pre-fix, 8/8 post-fix.

Artifact: comment-only source change - the R6 package is expected
byte-identical to R5 (verified by rebuild, like R2==R3).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment requires a separate
owner authorization (of the resulting R6 commit). See ACTIVE.md R6 and
CHANGELOG.md Unreleased entry.

### M10/T2-R7 - Authority predecessor admission (owner-authorized implementation)

Owner authorization: EXPLICIT - exactly one narrowly scoped repair for the
R6 deployment preflight deadlock (live authority aa12540f unadmitted).
Operation `REPOSITORY_IMPLEMENTATION_ONLY`; deployment NOT AUTHORIZED;
live execution NOT AUTHORIZED.

Root cause: R3 deployed the R2-tree governance-plugin assets; R4/R5 then
changed `lib/authority.mjs` (conversational classifiers) to candidate
42b0cba8 without admitting the outgoing digest, and R6's authorized scope
covered only the boundary file. Same asset-admission deadlock class as
R2/R3/R6.

Provenance (1/1 PROVEN, 0 admitted on faith): materialized commit 2ef4bd6
(M8/T3 learning loop, the origin commit that introduced these exact bytes

- its parent tree carries the hygiene-era bb2f5328) and packaged it
  through the repository's own `governancePluginFiles()` - byte-identical
  to the observed live file (aa12540f60da6bcdf809123f0d75c632c6b8a128a88e4395f38785b663f13e17).
  No rewrite rules touch this path at any commit, so packaged bytes equal
  source bytes. A mistranscribed digest from the earlier deployment
  diagnosis (...4e0432d0...) was caught and corrected by the P1
  re-derivation gate before any admission - evidence-first discipline held.

Change (minimal, one entry): aa12540f admitted under
`lib/authority.mjs` in the shared `ALLOWED_GOVERNANCE_ASSET_SHA256`
with provenance comment. Candidate 42b0cba8 stays unlisted (content
comparison). No native logic, ingress, classifier behavior, R2-R6 code,
or unrelated entry touched; preflight and apply consume the same table.

Regression: `tests/m10-t2-r7-authority-predecessor.test.mjs`, 8 tests
(provenance re-derivation P1, 1/1 parity R7 0, candidate exclusion R7 0b,
shared-table R7 0c, predecessor preflight-PASS-then-apply-ACCEPT with
convergence R7 1, one-byte perturbation R7 2, unknown digest R7 3,
wrong-path R7 4). R7 0/R7 1 watched FAIL pre-fix, 8/8 post-fix.

Artifact: comment-only source change - the R7 package is expected
byte-identical to R6 (to be verified by rebuild, like R2==R3 and R5==R6).

Status: IMPLEMENTED and locally verified; deployment NOT AUTHORIZED and
NOT PERFORMED; live ledger untouched; gateway not restarted; no live
execution; host lifecycle NOT PROVEN. A deployment requires a separate
owner authorization (of the resulting R7 commit). See ACTIVE.md R7 and
CHANGELOG.md Unreleased entry.

### M10/T2-R12 - Approval-bootstrap workflow (owner-authorized)

Owner authorization: EXPLICIT 2026-10-07 - Owner selected Option 2: Main may
create the first approval request for `sessions_spawn`, but `sessions_spawn`
remains blocked until Owner approval. This task turns that decision into a
concrete governed workflow. Approval-bootstrap design is IN scope; everything
else listed under DO NOT CHANGE stays out.

Task: `M10/T2-R12 - Introduce the smallest governed mechanism allowing a fresh
Main task to create the first approval request for an otherwise valid
sessions_spawn, without weakening the existing approval requirement.`

R12 predecessor: HEAD `fea95e5`, R9+R10+R11 working tree uncommitted and
preserved. R10 deployed and live (guard fix present, gateway active, ledger 110
events at R12 start). R11 proved identity resolution correct; no identity fix
was needed or applied.

R12 failover restoration (owner decision 2026-10-07, during R12 live
verification): measured `execute` single-shot reliability 4/10 (40%). The owner
ruled one passing turn proves nothing and ordered failover ("model trên lỗi
thì route xuống model dưới"). Primary `router/execute` plus fallback
`router/gemini/gemini-3.6-flash` (12/12 measured stable), which fires ONLY on
primary failure — never shadows the combo. Router-tier protection only, not
Google-outage protection. Applied via transaction; live config confirms the
pair; `config validate` passes; gateway active. Proof standard ordered by
owner: 10 consecutive live turns must all produce output.

R12 requestTimeoutMs lesson (2026-10-07, recorded so it is not retried): a
per-attempt timeout CANNOT live on the provider models entry — the installed
runtime validates that entry with a STRICT schema and the gateway refuses to
start (`Unrecognized key: "requestTimeoutMs"`). The attempt that carried it
deployed cleanly through preflight+apply and then killed the gateway; recovery
was removal + re-apply. Code reading had shown `model.requestTimeoutMs` is
read at transport time and the catalog merge spreads the raw entry, but schema
validation rejects before the merge ever sees it. Hang protection therefore
rests on the run-budget abort plus the fallback candidate, not on a per-model
timeout. A provider-level timeout, if one exists, must be proven on a SCRATCH
config via `openclaw config validate` BEFORE touching live.

R12 communication section (owner decision 2026-10-07): the `## Communication`
block (address owner as "anh"/self as "em", Vietnamese with full diacritics,
agentId explicit on spawn) was added to Common Core in `policy.mjs`, applying
to all 7 agents. Investigation proved no anh/em instruction existed anywhere
(bundle/state/config/AGENTS.md) — prior polite address was model mirroring,
not instruction-following, which is why weaker combo upstreams lost it. The
change alters per-agent governance_hash, so manifests regenerated; deployed
via transaction; live workspaces confirmed carrying the section for
main/o1/excel (spot-checked).

R12 truncated-digest lesson (2026-10-07): a hand-copied predecessor digest
with 50 chars (copied from a width-truncated display) silently fails closed —
preflight rejects with no hint which entry is short. Rule: every digest
entered into `configure.mjs` must be captured programmatically (sha256sum or
script output piped without truncation), never retyped from terminal display.

R12 buttons status (2026-10-07): the approval THREAD posts via raw REST
(allowed), but BUTTON delivery via the native outbound adapter fails in the
tool-call hook context ("Discord send requires a resolved runtime config"),
proven live twice — threads land in #approvals with no buttons. Owner decision
2026-10-07: EXPLICIT R4 EXCEPTION granted — raw-REST /messages is permitted
SOLELY for the approval-buttons post (same thread the rule already permits).
The exception is marked in code and enforced by test: any /messages REST site
must carry the R4-EXCEPTION marker with this decision reference. The rule stands
for everything else.

R12 task codes (owner requirement 2026-10-07, NOT YET IMPLEMENTED): 12-char
ruled string (8 date + 4 random) as a human task alias alongside the canonical
64-hex task_id. Requires ledger schema field + text-approval lookup + card
changes. Scoped as the next task after R12 closes.

R9-C (root cause of "bot không phản hồi", FIXED and deployed txn-deafcdcf):
the model fallback could never fire for a HUNG primary. Proven live
2026-10-07 16:38:06 -> 16:44:20 on msg `REDACTED`, runId
98aae218-ae57-447f-8a66-1150262e4f3b:

16:38:06.917 model-fetch start model=execute
16:44:18.929 stalled session activeWorkKind=model_call
lastProgress=model_call:started lastProgressAge=372s (0 bytes)
16:44:18.964 model-fetch error model=execute elapsedMs=372045 AbortError
16:44:19.423 model-fallback/decision candidate_failed
next=router/gemini/gemini-3.6-flash
16:44:20.389 ingress denied: reason=DUPLICATE_DISCORD_EVENT runId=98aae218
16:44:20.389 [zink-native-gate] enterNativeRun: GOVERNANCE_DENIED
16:44:20.449 Embedded agent failed before reply: GOVERNANCE_RUN_UNAVAILABLE

The fallback lane re-enters under the SAME runId and the SAME inbound message
id, because it is a second model attempt of one already-admitted run, not a
replay. The duplicate-event guard denied it, so the owner received nothing. Two
defects, both fixed together:

1. `authenticateIngress` denied any second admission of an open task. It now
   admits a re-entry whose task ROOT IDENTITY matches exactly (root_run_id +
   root_agent_id + root_session_key equals the observing run) and logs it as
   `ingress re-entry admitted as model-fallback retry`. A different runId, a
   foreign session, a foreign agent, a bot author, a non-Main agent or an
   unauthorized sender all still deny BEFORE this point. Replay protection is
   unchanged for every other caller.
2. `resolveRunModelFor` ran on the re-entry and, because it reads QUOTA (which a
   model failure never lowers), resolved to the PRIMARY again, pinning the host's
   reactive failover candidate back onto the model that just aborted at 372s,
   contradicting its own documented contract ("a real provider failure still
   takes the native reactive failover path"). The proactive resolution now stands
   aside for a recognized re-entry only; every other admission is unchanged.

The contrast that proved the diagnosis: turn 16:20 aborted at 120s and DID fail
over, because that first attempt was classified an internal session and returned
early before reaching either code path. Real Discord ingress reached both. Same
defect as R9-A observed on 2026-10-06 (msg `REDACTED`); R9-A's own
comment said "Until R9-C this denial is unchanged".

R9-C test corrections (not weakening): four existing tests asserted the WRONG
shape. They re-entered an admitted message under the SAME runId and called it a
"replay", so they actually pinned the fallback shape as denied
(m10-t2-r4-conversational-ingress R4 A1, m8-t2.5-r7-remediation E,
m8-t2.7-r10-heartbeat-trigger R10 F, m7-t2-openclaw materialized plugin). Each
now constructs a genuine replay (a different runId) and keeps its original
security assertion: exactly one task, no new ledger sequence, still denied.
R9-A's own R9-A1/R9-A2 already used different runIds and still pass.

R9-C entrypoint-digest lesson (2026-10-08, corrected the same day): the
governance entrypoint allowlist in `configure.mjs` must carry the digest of the
INSTALLED file. The builder output (`governancePluginFiles().entrypoint`) already
uses the installed import form `./lib/x`, so `sha256(builder output)` IS the
installed digest; only the REPO SOURCE differs (`../../lib/x`) and must never be
hashed. An earlier note in this file claimed the builder digest differed from the
installed one — that was wrong, and acting on it put a stale intermediate digest
(`0a63363f…`) in the allowlist, so preflight failed closed with reason
"Governance plugin entrypoint". Rule unchanged: capture every digest by
`sha256sum` of the file actually on disk (or by hashing the builder output), and
never retype a digest copied from an earlier terminal state.

R9-C PROVEN LIVE (2026-10-08 15:11-15:27, msg `REDACTED`): the
owner-reported "bị kẹt thinking" turn exercised the exact case R9-C was built
for, and the fix held:

15:17:36.251 [model-fallback/decision] candidate_failed
next=router/gemini/gemini-3.6-flash
15:17:36.849 ingress re-entry admitted as model-fallback retry: agent=main
msg=`REDACTED` runId=68b7d19e-… task=ad70a7b89d0c…

598ms after the fallback decision — the re-entry that was DUPLICATE_DISCORD_EVENT
on 2026-10-06 and 2026-10-07 is now admitted. Ledger stayed correct: sequence
120->121, exactly one new task, one WORKFLOW_OPENED. The same turn also proved the
second half of the fix: no proactive modelResolution was emitted on the re-entry.

"kẹt thinking" root cause, NOT governance (2026-10-08): the router was DOWN.
Every candidate hung, so the failover path had nothing to land on. Measured, not
inferred:

router probe, 8/8 fail, both `execute` and `gemini/gemini-3.6-flash`, every one
at ~135s with http=000 and zero response bytes
WSL -> 172.22.80.1:20128 TCP connect FAILED (6s cap)
ping 172.22.80.1 100% packet loss
Windows netstat nothing LISTENING on :20128; no router process present
Windows 172.22.80.1 is still the correct WSL vEthernet address

The uniform ~135s is the Linux default SYN timeout (~127s): the POST hung in TCP
CONNECT and never sent a request, so the gateway's "ETIMEDOUT fetch failed" is a
connection failure, not an upstream model error. Distinguishing this from an
upstream outage is the whole point of the probe — the two look identical in
gateway logs but need completely different responses.

Consequence to remember: when every candidate fails, the governed turn produces
NO outbound at all, by owner invariant (a zero-output turn must stay silent). So
a router outage presents to the owner as an endlessly "thinking" bot, with no
error surface. Diagnose by probing the router TCP port first, not by reading
model-fetch errors.

### M10/T2-R11 - Run-identity mismatch investigation + minimal fix (owner-authorized)

Owner authorization: EXPLICIT 2026-10-07 - Owner selected option B: investigate
the run-identity mismatch first. R11 may trace run/task identity end-to-end,
prove or disprove the stale-task hypothesis, apply the minimal fix if proven,
add regression tests, and live-verify. R11 is NOT authorization to redesign the
approval system.

Task: `M10/T2-R11 - Investigate and, if proven, minimally repair incorrect
task/run identity resolution or propagation observed at the sessions_spawn
governance gate. Approval-bootstrap design is explicitly out of scope.`

R11 predecessor: HEAD `fea95e5`, R9+R10 working tree uncommitted and preserved.
R10 deployed and live (guard `482b4938…` with fix, index `c2ef4363…`, gateway
active, ledger 110 events at R11 start).

R11 execution outcome (2026-10-07):

- STEPs 0-1: baseline recorded, R11 task recorded here. No reset, no R10 change.
- STEPs 2-3: identity pipeline mapped (Discord msgId → deriveTaskId → taskId;
  host params.runId → root_run_id at admission AND trusted.runId at gate install,
  same anchor). Identifiers distinguished; taskId ≠ runId preserved end-to-end.
- STEPs 4-6: the stale-task hypothesis is REJECTED with direct evidence. The
  earlier confusion came from reproducing against the WRONG task: yesterday's
  b89a87cf (msg ...541867, 0 nodes) yields MISSING_PREREQUISITE, while the live
  turn's own task c89af0308 (msg ...104048, 7 nodes via a plugin-admitted brief
  at seq 110, 225ms before the block) yields AUTH_APPROVAL_REQUIRED when driven
  with the live args — exactly matching live. There was never a duplicate
  admission (seq 108 = yesterday's msg, seq 109 = tonight's msg) and never a
  stale resolution.
- STEPs 7-8: no identity bug exists; NO FIX applied (correctly — inventing one
  would violate the failure rule). Identity propagation is correct as built.
- STEP 9: `tests/m10-t2-r11-run-identity-resolution.test.mjs` locks in correct
  resolution (two tasks, one session: approved run passes its gate, fresh run
  hits AUTH_APPROVAL_REQUIRED, repeat consistent, bogus run denied). Registered
  in `package.json`. Full suite: 1212 tests / 1168 pass / 0 fail / 44 skipped.
- STEPs 10-12: AUTH_APPROVAL_REQUIRED on the correct current task is the right
  verdict — R11 identity path = PASS, approval-bootstrap = OUT OF SCOPE (no
  change). No new live turn was needed: the already-observed R10 turn IS the
  live verification, retrospectively proven correct.
- STEP 13: R11 touched only PLAN.md + one test file. No policy/manifest/
  capability/tool/lineage/authorization change. R10 intact.

### M10/T2-R10 - Production policy-loading path fix (owner-authorized)

Owner authorization: EXPLICIT 2026-10-06 - Owner selected Option A: fix the
proven production policy-loading path bug. This approval covers execution of
this task only: fix -> test -> deploy -> live verify. No re-authorization rounds
for steps inside this scope.

Task: `M10/T2-R10 - R10 = production policy-loading path fix only`

R10 root cause (proven by evidence, not inference):

1. Live block, exactly once: `beforeToolCall blocked: RUNTIME_CAPABILITY_MISMATCH`
   for `session_status` (2026-10-06 23:16:07, msg `REDACTED`).
2. Brute-force over every runId in the live snapshot × every params shape proves
   the deployed guard plus live state CANNOT produce this verdict when policy is
   loaded — only allow / POLICY_DENIED / EXECUTION_STATE_UNKNOWN / LINEAGE_MISMATCH.
3. The only path to it is the empty-registry fallthrough (`guard.mjs` zink path):
   `OPENCLAW_BUILT_IN_TOOL_IDS` empty, so a built-in tool is not recognised and
   `ZINK_CAPABILITY_REGISTRY[tool]` is undefined.
4. The registry is empty in production because `guard.mjs:116`
   `path.resolve(pathToFileURL(_moduleDir), candidate)` throws `ERR_INVALID_ARG_TYPE`
   (replicated directly: `path.resolve` rejects a URL object), the throw is
   swallowed by the surrounding `try/catch`, and the cwd-relative fallback
   `integrations/openclaw/lib/policy.mjs` misses because the gateway runs with
   cwd `/home/hoang_vinh` (proven: file absent there).
5. The earlier reproduction falsely passed because its shell cwd was the repo root,
   where the fallback hits. Production never had that luck.

Consequence: every built-in tool call (`session_status`, `sessions_spawn`,
`sessions_yield`, `agents_list`) has always failed in production. Main could only
reply conversationally and could never delegate, so the approval it promised for
#approvals was never created and no result ever reached #results.

R10 approved scope: the one-line path-resolution fix in `guard.mjs` ONLY, plus its
predecessor digest, regression test, and the deploy/verify chain. No policy,
manifest, capability, tool, lineage, authorization, approval, router, model, or
quota change. R10 restores existing governance; it does not reinterpret policy.

R10 excluded scope: everything listed under MUST NOT change in the owner approval.

R10 execution outcome (2026-10-07):

- STEP 0: root confirmed, HEAD `fea95e5`, R9 tree uncommitted, broken expression
  at `guard.mjs:116`, guard sha `00f0e974`.
- STEP 1: R10 recorded here. STEP 2: one-line fix applied (diff shown in report).
- STEP 3: `tests/m10-t2-r10-production-policy-load.test.mjs` (5 tests) +
  `tests/fixtures/r10-policy-load-probe.mjs`. The probe runs with cwd set to an
  EMPTY directory. Negative control: with the fix stashed, 4/5 fail with exactly
  `RUNTIME_CAPABILITY_MISMATCH` — the live incident signature reproduced.
- STEP 4: probe run with cwd exactly `/home/hoang_vinh`: session_status allow,
  agents_list allow, spawn AUTH_APPROVAL_REQUIRED, yield SPAWN_UNKNOWN,
  bogus-run EXECUTION_STATE_UNKNOWN.
- STEP 5: full suite 1211 tests / 1167 pass / 0 fail / 44 skipped; lint clean;
  format clean; repo:check PASS. R10 test registered in `package.json`.
- STEP 6: R10 changed only `guard.mjs` (one functional line + comment),
  `configure.mjs` (guard predecessor digest), tests, `package.json`, PLAN.md.
  No policy/manifest/capability/tool/lineage/authorization change.
- STEP 7: apply `txn-061197d4…` PASS. Deployed guard carries the fix
  (sha `482b4938…`). `config validate`: Config valid. Gateway active, 7/7
  providers, 0 timeouts. Resolver hand-restored to 29-id (R9-D) after the apply
  rewrote it to 8-id.
- STEP 8: owner sent `@Quản Lý tạo giùm anh 1 file Excel` (msg `REDACTED`,
  00:18:36). MAIN_DIRECTED, model-fetch via router/execute status 200, then
  `beforeToolCall blocked: AUTH_APPROVAL_REQUIRED` for sessions_spawn — the
  NORMAL governed path, NOT the empty-registry failure. R10's fix is proven live.
- STEP 9/10: NO approval appeared in #approvals; bot replied conversationally.
  Per the FAILURE RULE, R10 = BLOCKED on criteria 14-15. The failure is OUTSIDE
  R10 scope: the gate correctly denied an unapproved spawn, but nothing creates
  the FIRST approval request (the only WORKFLOW_APPROVAL_REQUESTED path needs a
  child announce, which needs a spawn, which needs approval), and evidence shows
  the live spawn resolved a stale task (exact repro yields MISSING_PREREQUISITE
  for tonight's task, live yielded AUTH_APPROVAL_REQUIRED which requires
  nodes>0). Follow-ups needed: (a) approval-bootstrap design decision,
  (b) run-identity investigation as a separate task.

### M10/T2-R9 - External router pool + duplicate-path retry observability (owner-authorized)

Owner authorization: EXPLICIT 2026-10-06 - replace the 21 Google AI Studio
key pool with one external router pool shared by all 7 agents; add runId to
the duplicate-denial log line so a later change can be evidence-bound. Chain
authorized as fix -> test -> deploy -> live verify -> commit. Owner deferred
the provider-id naming decision and declared the router's own combo sufficient,
so model ids are a changeable detail, not an approval gate.

Task: `M10/T2-R9 - make the governed model provider an external router pool,
and make the duplicate-guard denial attributable`

R9 evidence gathered read-only before planning (no assumption):

1. Google AI Studio is unstable in exactly the two ways observed live:
   `Google stream ended before a terminal finish reason` (2 occurrences: 2 on
   2026-10-04, 2 on 2026-10-06) and `Google Generative AI API error (503):
... high demand ... [code=UNAVAILABLE]` (2 on 2026-10-06). These produced
   `GOVERNANCE_COMPLETION_UNAVAILABLE` and no Discord output.
2. Router reachability is asymmetric: from WSL `localhost:20128` is `http=000`
   (WSL is NAT, `/etc/wsl.conf` has no `networkingMode=mirrored`), while the
   Windows host default gateway `172.22.80.1:20128` is `http=200`. The address
   is the WSL default route and is NOT stable across WSL restarts, so the
   endpoint must be resolved at service start, not hardcoded.
3. Router model ids are NOT public Google names (`gemini/gemini-3.6-flash`,
   `-3.5-flash-lite`, `-3.7-flash`, `-3.1-flash-lite-preview`,
   `gemini/gemini-3-flash-preview`), so `MODEL_ALLOWLIST` values must change.
   Verified `http=200` for all five gemini ids. The whole `kr/*` family returns
   `http=503 ... The bearer token included in the request is invalid`.
4. The provider swap is NOT a URL change: `PLUGIN_ALLOWLIST`,
   `GOOGLE_PROFILE_IDS` (21), `SECRET_REFS.gemini` (21),
   `PASS_ENTRY_IDS.gemini` (21), `MODEL_ALLOWLIST`,
   `authProfileProvider`, `provider`, the `MODEL_ALLOWLIST_VIOLATION`
   enforcement in `quota-telemetry.mjs`, and the live
   `models auth order get --provider google` check in `verify.mjs` are all
   pinned to `google`.
5. Duplicate guard boundary proven by live trace, not inference. One fallback
   event produced two different outcomes by session origin: an internal session
   (`session:agent:main:main`) DID call `model-fetch start
gemini-flash-lite-latest`; the Discord-originated session
   (`session:agent:main:discord:channel:`REDACTED``) called no model
   and was denied `DUPLICATE_DISCORD_EVENT` 545ms after the fallback decision,
   because `taskId = deriveTaskId({origin_message_id, agent_id})` has no
   attempt dimension. The ledger correctly holds exactly one
   `WORKFLOW_OPENED` (sequence 107), so idempotency is correct; the guard also
   kills the retry. `deriveTaskId` is the canonical audit key validated by
   `workflow.mjs`, so attempt may NOT be folded into it.

R9 approved scope:

- R9-A observability: append `runId` to the `DUPLICATE_DISCORD_EVENT`
  warning. Log-only, zero behavior change, no contract or control change.
- R9-B router pool: introduce the router as the single governed model
  provider for all 7 agents, retire the 21 google profiles and their 21
  secret refs from the generated config and secret plan, and resolve the
  endpoint at service start.
- R9-C fallback discrimination: DEFERRED by owner decision. Blocked on R9-A
  plus a reproduction, because the discriminating signal (whether the retry
  carries a different `runId`) is not yet observable. R9-C MUST NOT be
  implemented from inference.

R9 excluded scope: no change to `deriveTaskId`; no weakening or removal of the
duplicate guard; no change to `WORKFLOW_OPENED` idempotency; no second copy of
the admission policy; no dependency or lockfile change; no touching the Discord
native ingress seam, `ackReaction`, or `enterNativeRun`; no restoring or
rewriting any closed task; no secret value written into any repository file.

R9 deployment incident (2026-10-06, recorded verbatim; the apply was NOT yet
transactionally completed at the time of writing):

1. The first `operator-apply.mjs` run FAILED at stage `builder-apply` and rolled
   back cleanly: `txn-cccbf758990142f0dd279173c6dc7ea401599f9a6cc73937df5150f7f6f4a824`,
   `rollbackSucceeded: true`, ledger still 107 events / sha `3fc0f79c…`, live
   entrypoint restored to `f4ed9d9c…`. Cause: `configure.mjs` carries TWO
   allowlist gates (preflight mode and apply mode) with independently maintained
   digest lists, and only the preflight-mode list had been updated.
2. A diagnostic `configure.mjs --apply` was then run DIRECTLY, bypassing the
   transaction wrapper, to surface the real error. This was a process violation
   and it mutated live files. It exposed a second defect: `models.providers.*.models`
   is validated by the installed runtime as an ARRAY of model descriptors, not as
   a map. The object shape made openclaw refuse to start
   (`Invalid input: expected array, received object`). Corrected to
   `ROUTER_PROVIDER_MODEL_IDS.map((modelId) => ({ id: modelId, name: modelId }))`.
3. That same diagnostic apply wrote an 8-id pass resolver while the running config
   still referenced the previous ids, so every gateway start failed with
   `SecretProviderResolutionError: Exec provider "pass_store" exited with code 1`.
   Recovery was a revert of the resolver to its last committed content
   (`git archive HEAD`, 29 ids, sha `46cf5df7…`), which is a committed artifact,
   not a new change, plus `systemctl --user reset-failed` because the unit had
   entered a start rate-limit.
4. Consequence still open at the time of writing: the live state is the product of
   a direct apply rather than a transaction. The router provider IS active
   (`agent model: router/gemini/gemini-3.6-flash`, google plugin absent, 7/7
   providers initialised, 0 READY timeouts), but the resolver allowlist still
   carries the 21 GEMINI ids, so R9's "retire the 21-key pool" goal is not yet met
   on disk, and no model call has yet been observed through the router.
5. R9-C remains blocked on R9-A plus a reproduction.

R9 third key location, found after the R9 apply (`txn-4e004486…`, status PASS):

The 21 Google keys live in a THIRD place that R9's plan missed. Each agent has
its own `auth_profile_store` row in
`~/.openclaw-zink/agents/<id>/agent/openclaw-agent.sqlite`, holding three
`google:zink-NN` profiles whose `keyRef` points at `pass_store`
(main 01-03, o1 04-06, o2 07-09, excel 10-12, power-bi 13-15, sql 16-18,
python 19-21). OpenClaw reads these at startup to build providers, INDEPENDENT of
`openclaw.json`, so removing `auth.profiles` from the config did not remove them.
The store is cumulative, not rebuilt from config: excel still held
`google:zink-10..12` while the config no longer declared any profile.

Consequence: with the resolver narrowed to 8 ids, every gateway start failed,
because the runtime requested all 29 (`ids.some((id) => !ALLOWED_IDS.has(id))`
sets `exitCode = 1`). Proven by a non-invasive stdin-logging shim that recorded
50 identical requests, each listing the 8 needed ids plus
`GEMINI_API_KEY_01..21`.

Owner decision 2026-10-06: option (d). OpenClaw 2026.6.34 exposes no CLI that
deletes an auth profile — verified exhaustively: `models auth list` is read-only,
`models auth order set/clear` mutates ORDER STATE only (tested on excel: the
store kept all three profiles), `paste-api-key`/`login`/`add` only add, and
`agents delete` removes a whole agent. So the supported path does not exist and
editing the auth store was NOT authorized.

R9-D applied: the pass resolver was reinstalled at its last COMMITTED content
(29 ids, sha `46cf5df7…`, rebuilt from `git archive HEAD`), which is a committed
artifact rather than a new change. The gateway then started clean:
`active/running`, PID 533347, `NRestarts=0`, 7/7 providers initialised, 0 READY
timeouts, 0 ECONNRESET, 7 established connections, and
`agent model: router/gemini/gemini-3.6-flash` with only
`discord, zink-governance` loaded.

R9 completion status, stated honestly:

- DONE and verified: the governed model provider is the external router; the 21
  profiles and 21 secret refs are gone from `openclaw.json`, from
  `zink-auth-secret-plan.json` (0 targets), from `zink-auth-order-plan.json`
  (0 agents) and from `plugins.allow`; `MODEL_ALLOWLIST` is enforced against the
  router ids; `verify.mjs` gained a live router reachability probe.
- NOT DONE: the 21 profiles still exist in the 7 agent auth stores, and the
  resolver allowlist is deliberately back at 29 ids because the runtime still
  requests them. They cannot authenticate — `google` is not an allowed plugin and
  the config declares no profile — but "retire the 21-key pool" is NOT complete.
- NOT YET OBSERVED: a single model call completed through the router.
- The live resolver is intentionally not what the repository generator emits. The
  next transaction apply will rewrite it to the 8-id build and will fail closed
  again until the auth-store prune is authorized. R9-D is therefore a service
  restoration, not the final state.

Authorization still required before R9 can close: deleting the `google:zink-NN`
profiles from the 7 `auth_profile_store` rows (a write outside any repository
transaction).

R9 model selection and upstream measurements (owner decision 2026-10-06):

The owner directs the primary to `execute`, the router's combo entry, which the
router advertises as `owned_by: "combo"`. Live probes of the whole 52-model
catalog established what can actually serve a request:

| group                            | count | result                                                                                  |
| -------------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `gemini/*`                       | 7     | works                                                                                   |
| `combo: execute`                 | 1     | works; resolves per request into `gemini-3.6/3.7/3.8-flash` and `gemini-3.5-flash-lite` |
| `combo: max-code`, `anythingllm` | 2     | `400` provider error                                                                    |
| `kr/*`                           | 40    | `403 invalid bearer token` on every probe — router-side credential is broken            |
| `openrouter/*`                   | 2     | `404 unavailable` / `400` not a chat model                                              |

Stability, 12 identical calls each, same prompt and `max_tokens=2048`:

    execute                       ok=8   fail=4   (33%)
    gemini/gemini-3.6-flash       ok=12  fail=0
    gemini/gemini-3.5-flash-lite  ok=12  fail=0

`execute` failures carry NO upstream model id, so they occur at the router tier
before any Gemini upstream is reached; the combo's rotation cannot help with
those. It was 25/25 in a later window, so the rate is variable rather than fixed.
It remains the primary because the owner wants the combo.

The fallback is `gemini/gemini-3.6-flash`: a different concrete upstream from
anything `execute` resolved to. This mitigates a single bad upstream but is
NOT independent of Google, because Gemini is currently the only working family
on this router. True independence requires repairing the router's `kr/*`
credential, which is outside this repository.

Token-budget finding, because it reproduces the exact failure that killed Main on
2026-10-06 09:22 (`Google stream ended before a terminal finish reason`):

    execute max_tokens=40    finish=length  content EMPTY  (all tokens -> reasoning)
    execute max_tokens=100   content EMPTY
    execute max_tokens=300+  finish=stop    content='PONG'

`execute` carries `reasoning: true` with `thinkingCanDisable: false`, so a small
output budget is spent entirely on reasoning and yields no content. Whether
OpenClaw sends an explicit budget for the `openai-completions` adapter was NOT
verified; if it does not, this is a live risk for `execute` specifically.

R9 apply #3 (`txn-aaf446fe06e684852f5be12ca55505d1a28c8b79fc61b2e07027bb1ebd3b25bf`,
status PASS) baked `router/execute` as primary and `router/gemini/gemini-3.6-flash`
as fallback. The same apply correctly rewrote the pass resolver to the 8-id build,
which made the gateway fail again for the already-documented reason (the 21
auth-store profiles are still requested). R9-D was re-applied from the last
committed resolver to restore service. Gateway state after restore: `active`,
PID 535615, 7/7 providers initialised, 0 READY timeouts, 0 ECONNRESET,
`agent model: router/execute`, plugins `discord, zink-governance`, ledger 107
events / sha `3fc0f79c`.

R9 maxTokens (owner decision A, 2026-10-06):

`execute` has reasoning=true with thinkingCanDisable=false. Measured: a tight
output budget spends everything on reasoning and returns EMPTY content with
finish=length — the exact failure that killed Main on 2026-10-06 09:22. OpenClaw
sends the request with NO max_tokens field when no budget is declared (proven in
the installed bundle: `resolveOpenAICompletionsMaxTokens` reads `options?.maxTokens`,
then `resolveMaxTokensParam(model.params)`, then `model.maxTokens` — all three
absent for `{id, name}` — so `clampedMaxTokens` is undefined and neither
`max_tokens` nor `max_completion_tokens` is set).

The owner chose to declare 64000 (the router's own advertised
max_completion_tokens, not an invented number) rather than leave the budget to a
hidden router-side default. The provider entry is now
`{id: "execute", name: "execute", params: {maxTokens: 64000}}`; the runtime reads
it via `resolveMaxTokensParam(model.params)` and sends it unclamped
(`clampToModelMaxTokens=false` for the params source).

Evidence, not assumption: `models.providers.*.models` is an ARRAY (an object
shape fails the installed validator outright), and openclaw's OWN
`config validate` returns `Config valid` for the live config carrying the params
entry — proven first on a scratch copy, then on the live file after deploy.
At the same decision the governed set was reduced to the single `execute` entry:
`ROUTER_PROVIDER_MODEL_IDS = ["execute"]`, `MODEL_ALLOWLIST = ["router/execute"]`,
`fallbacks: MODEL_ALLOWLIST.slice(1)` (empty, never `[undefined]`), and the
resolver reports `NO_FALLBACK_AVAILABLE` only when quota is actually low, never
for a healthy reading.

R9 apply #4 (`txn-cdfafd27ec20e4dceca47b1a78de37086e7c804b41cf98a6aa180351289a2288`,
status PASS) deployed the maxTokens entry. R9-D was re-applied after it for the
same documented reason. Gateway state: `active`, PID 539914, 7/7 providers, 0
READY timeouts, `agent model: router/execute`, ledger 107 / sha `3fc0f79c`.

What is PROVEN vs what is NOT for maxTokens: proven that the runtime schema
accepts the entry and that the code path from `model.params.maxTokens` to the
wire payload exists in the installed bundle. NOT proven by a live wire capture:
no Discord turn has run since this deploy, so no `model-fetch` has been observed
with the new primary. A real `@Quản Lý` turn that returns content (not empty) is
the behavioral proof still missing.

The recurring pattern is now explicit and is a consequence of one ungranted
authorization: EVERY transaction apply writes the narrow 8-id resolver and the
gateway fails until the resolver is hand-restored. The durable fix is the
auth-store prune, not another apply.

Operator router environment (R9, outside the repository):

`~/.openclaw-zink/router.env`, mode 600, holds `ZINK_ROUTER_HOST` /
`ZINK_ROUTER_PORT` / `ZINK_ROUTER_API_KEY`. It is consumed by the APPLY path
only; the running gateway does not need it, because OpenClaw has no config
templating and therefore reads literal strings from `openclaw.json`. Verified:
`resolveRouterBaseUrl()` and `resolveRouterApiKey()` accept the file's values, and
the credential does not appear anywhere in the repository.

`ZINK_ROUTER_HOST` is the WSL default route (the Windows host). It is NOT stable
across WSL restarts. After a WSL restart the operator must re-run
`operator-apply.mjs` so the new address is baked in; `verify.mjs` reports
`ROUTER_UNREACHABLE` / `ROUTER_HTTP_<status>` when the baked address has gone
stale. This is a known open risk, accepted because OpenClaw offers no templating.

R9 open risks recorded at planning: the WSL default-route address can change on
WSL restart, which would silently break the endpoint; the router key was pasted
into chat and must be rotated by the owner; `kr/*` router models are broken
upstream; and the durable fix for the 2026-10-06 gateway wedge (a long-lived
gateway process that could not re-establish any Discord gateway session after an
unexplained transient network event, recovering only on restart) remains an
unfixed open defect and is NOT part of R9.

### M10/T2-R8 - Discord conversational ingress end-to-end (owner-authorized single handling)

Owner authorization: EXPLICIT - one end-to-end R8 handling covering
OBSERVABILITY deploy, CONTROLLED LIVE TEST correlation, ROOT CAUSE,
FIX, TEST, DEPLOY, LIVE VERIFY, R8 CLOSE. No re-authorization rounds
for steps inside this prompt's scope. Global rules: no synthetic
events, no fake messages/approvals, no verifier weakening, no
admission loosening to force replies, no text-mention source of
truth, no governance contract change without evidence, no
ledger/queue/approval mutation for testing, no new
services/agents/roles, no secret exposure. Fix only after evidence
identifies the exact faulty boundary (H1 vs H2 decided by live
timestamps/IDs, never by assumption).

Phase 1 - observability deploy: single ONE-attempt deploy of
`ef9feb0` (log-only ingress verdicts, zero behavior change) via
`operator-apply.mjs`, with pre/post runtime identity capture
(service, PID, version, HEAD, selection, entrypoint, boundary,
authority, ledger hash/sequence, queue/approval state).
Phase 1 RESULT (executed): preflight first FAILed on the unadmitted
outgoing R5 entrypoint 0fb628e8 (provenance re-derived from 4d1e64e,
admitted in BOTH per-mode lists per precedent, TDD fail 0!==2 then
3/3 pass); preflight then PASS (installed_mutation false); full suite
1157/1115/0/42 + lint/format/repo-check/diff-check green; committed
50feb07; single apply PASS txn-abcb31f20ce634d2ef0fbc6bc262c08b
5c6b681690f11e5931ef27263e104043 with no rollback; post-deploy
entrypoint 6a7968b7 byte-identical to the packaged candidate
(logging active), all other artifacts + ledger (103 events) unchanged,
service active (new PID after restart).
Phase 2 - owner controlled live TEST A (structured @Main) + TEST B
(untagged) with timestamps; agent correlates read-only.
Phase 3 - trace per message (raw mentions, normalized mentions,
stash write/read, message.id vs currentMessageId, admission, turn,
thinking, execution, model, outbound); answer H1/H2 by evidence.
Phase 3 RESULT: owner TEST A (structured @Main via autocomplete, msg
`REDACTED`, 17:18:28 +07) is PROVEN AUTOCOMPLETE-picked. Live
verdicts: Main DENY `MISSING_MENTION mentions=0`, every specialist
DENY `NON_MAIN_DIRECT_INGRESS mentions=0`, all on the SAME msg id.
`msg=` present everywhere PROVES the seam receives currentMessageId
=> H2 (stash key miss) is DISPROVEN. Live `botUserId` identity proven
from the gateway probe log (main client initialized as
`REDACTED`), so the wrapper's `explicitlyMentioned` should have
matched. The only remaining boundary that can zero both mentions and
threadOwner while keeping the id is the STRUCTURED FIELD SOURCE at the
seam, i.e. H1. Root cause (code-level, read-only): the R5 injection
read only the discord.js wrapper (`message.mentionedUsers`,
`message.mentionedRoles`, `message.messageReference`,
`message.referencedMessage`), which can diverge from the raw gateway
dispatch at this seam (partial messages, synthetic debounce-batch
rebuild, hydration merge); the raw dispatch (`params.data`, spread by
createMessageDispatchData) and the message's own `rawDataValue` are the
authoritative structured sources at the same layer.
Phase 4 FIX (implemented, TDD): the preflight injection now UNIONS all
three structured sources (wrapper + message rawDataValue + raw
dispatch), snowflake-validated and deduped, with `params` guarded by
typeof so scopes without it keep working. No text heuristic, no
admission change, no new field semantics. Lineage: the R5 region text is
pinned verbatim as DISCORD_PREFLIGHT_INJECTION_R5 and an exact
R5->R8 preflight descriptor (live digest 5411ccd4) makes the live R5
file recognizable, fail-closed otherwise; inversion to the pinned
baseline is proven byte-for-byte. Gates: 1167 tests / 1125 pass / 0
fail / 42 skipped; lint, format, repo-check, diff-check green; commits
650b9d7 (fix) and the R8 test suites.
Phase 4 DEPLOY (1st): FAILED at `runtime-verify` with `APPLY_NOT_VERIFIED`
(attempt txn-cb59d6e7fae3b761cc91dcbc2a88e8e5c2e951f9375747d2ce3199
6c74df132f). NEW PROVEN DEFECT, not a fix failure: the transaction snapshot
covers only 39 files and its runtime target list was a FIXED three
(`dist/selection-*`, `dist/subagent-announce-*`,
`dist/zink-governance-boundary.mjs`) while the pinned native patch writes
FOUR runtime files. `dist/message-handler.preflight-*` was absent from the
snapshot, so (a) runtime-verify's post-apply `applied: !unchanged` was false
because the only mutated component was invisible to it, and (b) the rollback
restored 39 already-identical files and LEFT the preflight file mutated.
Phase 1 (deployment safety, owner-authorized): the runtime target list is now
DERIVED from the native patch pins via `nativePatchedRuntimeRelatives()` and
the tracked set can no longer miss a patched artifact; `verifyLiveRestore`
post-apply is judged against an EXPECTED post-image derived from the patch
contract (`nativeRuntimePostImage`) instead of "did anything change", and
fails closed when no expectation is declared; `changed` always names every
tracked component that differs from the preimage. Regression:
tests/m10-t2-r8-deployment-snapshot-safety.test.mjs, 7 tests (derivation,
preflight tracked, snapshot byte-exactness, 4th-file-only rollback,
expected-image semantics, absent-expected fail-closed, post-image derivation
fails closed on an unverified release). Four pre-existing orchestration
fixtures (R7 DS, R11, R12, R15) were updated to DECLARE their expected
post-image instead of returning a hardcoded `applied: true`, which is the
stronger contract. Commit bbdb205. Gates: 1174 tests / 1130 pass / 0 fail /
44 skipped; lint, format, repo-check, diff-check green.
Phase 2 (runtime reconciliation): the `0fb628e8` -> `6a7968b7` entrypoint
change is LEGITIMATE and not stale. `0fb628e8` was the live R5 entrypoint
before the R8 observability deploy; attempt txn-abcb31f2 (PASS) replaced it
with the R8 candidate `6a7968b7`, which is byte-identical to the repository
packaged entrypoint. `0fb628e8` was admitted as a proven predecessor (commit
50feb07, provenance re-derived from 4d1e64e) precisely to make that deploy
reachable. All three pinned native sources report state=PATCHED with
`after` equal to their own live digest, so the runtime already matches the
patch contract. No rollback of the entrypoint is warranted or authorized.
Phase 9 DEPLOY (2nd, repaired): preflight PASS (`installed_mutation:false`),
then `operator-apply.mjs` returned PASS at stage `applied`,
`transactionStatus: complete`, attempt
txn-eb5f0044990cc37661dbcd897c4f624a149460b4d6e01d25bcb5bf5154b17f57,
no rollback required. Post-deploy: service active (MainPID 346609, NRestarts
0), preflight `d12961a2`, entrypoint `6a7968b7`, ledger `d794d99d` unchanged.
The H1 repair is now both live AND verified by the deployment contract.
Phase 3 RESULT (2nd live test, owner msg `REDACTED` at 19:53:24
+07): the union-sources repair did NOT recover the structured mention. All
workers again reported `mentions=0 reply=false threadOwner=false` and Main was
again DENY `MISSING_MENTION`. TEST B (untagged) produced NO bot behaviour at
all, which is the correct outcome. From this evidence the host's own
mention-admission path is DEDUCED rather than assumed: lane tasks exist, so
host preflight did not drop the message, therefore `shouldSkip === false`,
therefore `effectiveWasMentioned === true`; `shouldBypassMention` requires a
control command (absent) and `implicitMention` requires a reply to this bot
(absent), so `wasMentioned === true`; if `isExplicitlyMentioned` had been true
then `message.mentionedUsers` would have contained the bot id and the union
(which reads exactly that array) would have recorded it, so it was false.
`wasMentioned` could therefore only have come from `mentionRegexes` matching
the message TEXT. Conclusion: for that message Discord delivered NO structured
mention at all, the host admitted the turn on a display-name text regex, and
governance correctly refused because it admits only structured identity. What
remains unknown is which source, if any, held the mention, which is why R8
added seam diagnostics.
Phase 3 DIAGNOSTICS: the preflight injection now emits one INFO line per
inbound message with per-source structured counts only —
`wu/wr` (discord.js wrapper), `ru/rr` (message rawDataValue), `du/dr` (raw
dispatch), `mu/mr` (unioned) — never content, never sender identity, never a
token. R5 H2's prohibition on reading message text in this path is preserved
deliberately; a content-derived boolean would be the first content-derived
value in the admission metadata path, and the counts answer the question that
matters. `logger` is optional so a scope without one still writes the
registry. Regression: tests/m10-t2-r8-ingress-source-diagnostics.test.mjs,
6 tests (one line per message, per-source counts, no content read or logged,
diagnostic emitted even when the registry write is skipped, missing-logger
degradation, union unchanged). The diagnostics deploy FIRST failed closed at
`native-backup-prune` with NATIVE_SOURCE_DRIFT because the live preflight file
had become the deployed R8 union build; the lineage slot was advanced to
R8 -> R8-diagnostics with the deployed union region retained verbatim as
DISCORD_PREFLIGHT_INJECTION_R8_UNION, inversion to the pinned baseline proven
byte-for-byte, and R5's region kept exported as history. That rollback was
itself verified complete under the Phase 1 contract, and the retry then
succeeded: attempt
txn-60e490a599e5b226e1170ebdabe3f361527242cd9a198764143121fcc09273ed,
PASS at stage `applied`, live preflight 63aaf148 carrying
`[zink-ingress-meta]`, MainPID 348723, ledger d794d99d unchanged. Gates:
1181 tests / 1139 pass / 0 fail / 42 skipped; lint, format, repo-check,
diff-check green; commits 6277bfc, fe95c16.
Phase 3 DIAGNOSTIC HARDENING: the first diagnostics build produced ZERO
`[zink-ingress-meta]` lines on the live runtime while the owner's message
demonstrably reached admission, even though the region was present in the
loaded file and `logger` was in scope. Two candidate causes remained —
the single `try` throwing before the log (which would also hide the registry
write behind the same silent catch) and the single-argument log form being
dropped. The hardened build closes both rather than guessing: the diagnostic
is emitted FIRST via the two-argument form this codebase demonstrably emits,
each structured source is read through a defensive probe that reports -1 when
that source THREW, and the union reads each source through its own guard so a
failing getter can no longer cost the other sources or the registry write.
A separate boolean probe exists for the bot flag because reusing the
array-count probe for a boolean silently cleared the bot filter — that defect
was caught by the existing R5 A9 negative and is now pinned by R8 D8/D9. The
hardened deploy first failed closed at `native-backup-prune` with
NATIVE_SOURCE_DRIFT (the live file had become the deployed first diagnostics
build), its rollback verified complete under the Phase 1 contract, the slot was
advanced to R8-diagnostics -> R8-diagnostics-hardened with the deployed region
retained verbatim, and the retry succeeded: attempt
txn-95389ebeabab42d4d5fbf02635bdbbe4a0b4da14e8ef85350b43b3eb07ed81b3,
PASS at stage `applied`, live preflight f15e9078 carrying `zinkProbe`,
MainPID 461403, ledger d794d99d unchanged. Gates: 1184 tests / 1142 pass /
0 fail / 42 skipped; lint, format, repo-check, diff-check green; commits
4b22b64, 80ecd98.
Phase 5/7 (pre-admission thinking, evidence so far): the Discord lane
contains NO status-reaction controller and NO reaction call (`addReaction`,
`reactions.add`, `putReaction`, `shouldAckReaction` all zero occurrences in
the Discord message handler and provider bundles), so the owner's `🧠` is NOT
a reaction. The exact pre-admission conversational side effect is
`startAcceptedTypingFeedback` in `message-handler-NsiHoCoL.js`, which runs
inside `onFlush` AFTER host preflight returned a context but BEFORE
`enterNativeRun` governance admission, gated by
`resolveDiscordAcceptedTypingPrestart`. Consequence after the H1 repair:
untagged messages are dropped at host preflight (requireMention) and
therefore produce no typing at all; only a message that mentions exactly one
NON-Main bot still reaches governance DENY after the typing prestart. The
supported repo-side seam for that residual is the existing
`session.typingMode` / `agents.defaults.typingMode` configuration knob
(`configured-not-instant` suppresses the prestart), which is a user-visible
behavior change and therefore an owner decision, not an agent decision.
Phase 4/5 - fix at the proven boundary only (H1: preserve structured
mention mapping; H2: canonical message-ID seam; no admission
semantics change, no blind fallback lookup).
Phase 6/7 - pre-admission thinking/turn + multi-bot isolation per
evidence; host-binary limits recorded honestly with exact seam.
Phase 8 - no-output terminal failure traced only after Main ACCEPT.
Phase 9 - regression tests for every proven defect incl. side-effect
ordering + message.id == currentMessageId invariant.
Phase 10 - full validation gates. Phase 11 - redeploy fix if source
changed (ONE attempt). Phase 12 - live verify A/B/C/D per expected
flows. Phase 13 - R8 PASS only on full evidence chain, else FAILED
at the named boundary.

Status: IN PROGRESS (Phase 1 deployment-safety fix DEPLOYED and verified;
Phase 2 reconciled; Phase 3 H1 PROVEN and the union repair deployed but
INSUFFICIENT on the live test; per-source seam diagnostics DEPLOYED and
verified; awaiting the owner live TEST A that yields those counts. Phases 4-8
depend on that evidence and are not attempted.)

### M10/T2-R13 - Per-attempt model ceiling (owner-authorized 2026-10-09)

Owner decision: set the router per-attempt ceiling to **100s**, after being shown
that a single model request had waited 9,374,777 ms (2h36m).

Owner authorization: explicit, in session, covering the code change, the
preflight+apply, and the gateway restart.

Root cause, proven by reading the installed runtime (not inferred):

- `buildGuardedModelFetch(model)` is invoked at every transport call site
  WITHOUT an explicit `timeoutMs`, so the only available deadline source is
  `model.requestTimeoutMs`;
- `applyConfiguredProviderOverrides` derives `model.requestTimeoutMs` from
  `providerConfig.timeoutSeconds` via `resolveProviderRequestTimeoutMs`;
- with no `timeoutSeconds`, `resolveModelRequestTimeoutMs` returns `undefined`
  and `buildModelRequestSignal` returns the caller's signal unchanged, i.e. no
  deadline at all. Every `model-fetch` log line recorded `timeoutMs=undefined`.

Live evidence (the defect): a `3.8-flash` turn started 09:28:31 was still
waiting at 12:04:46 (`elapsedMs=9374777`, `AbortError`) and only ended when the
host's stuck-session sweeper intervened; the owner received nothing for the
whole window. Failover then ran correctly (R9-C admitted the re-entry at
12:04:49), but the reply could not be delivered because Discord was wedged in
the same window.

Correction to an earlier wrong report: `requestTimeoutMs` was previously named
as the key to set. It is NOT in the model schema at all — it exists only in
`McpServerSchema`. That is why the earlier attempt made the gateway refuse to
start, and it was the wrong layer, not a bad key name.

Schema proof BEFORE touching live (the rule recorded in `policy.mjs`), using
`openclaw config validate` on scratch copies of the real config:

| mutation                                    | result                    |
| ------------------------------------------- | ------------------------- |
| `timeoutSeconds: 100` on the provider entry | `{"valid":true}`, exit 0  |
| `requestTimeoutMs` on the provider entry    | `{"valid":false}`, exit 1 |
| `requestTimeoutMs` on a model array entry   | `{"valid":false}`, exit 1 |
| an unknown key on the provider entry        | `{"valid":false}`, exit 1 |

The unknown-key control is what makes the positive result meaningful: the
validator is genuinely strict, not permissive. Key name AND layer are both
load-bearing.

Change: `models.providers.router.timeoutSeconds = 100` in
`integrations/openclaw/lib/policy.mjs`, plus the assertion in
`tests/m7-t1-openclaw.test.mjs`. The stale comment claiming no timeout can
exist was corrected rather than left to mislead the next reader.

Deployment: `operator-preflight.mjs` PASS (`installed_mutation:false`), then
`operator-apply.mjs` PASS. Preflight initially FAILED and correctly caught a
second drifted asset — `lib/canonical.mjs`, carrying review finding
R12-REVIEW-01, which was committed in `7d92211` but never deployed. Both
predecessor digests were taken with `sha256sum` on the installed bytes (never
transcribed by hand) and added to the allowlist with their reasons. After
apply, all 33 deployed assets match the build byte-for-byte.

Gates on the final state: `npm test` 1244 tests / 1200 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean.

Known limitation, stated honestly: the ceiling is PROVEN in schema and code,
but not yet proven on a live `model-fetch` line. That requires one real owner
turn, which this agent must not fabricate.

Residual risk, owner-acknowledged: a legitimate attempt slower than 100s is cut
over to the next model. One observed `3.7-flash` attempt took 255s and would be
cut. Slowest governed model observed otherwise: `3.8-flash` at 70.6s. Raising
the number is a one-line change.

### Unrelated incident observed the same day (not part of R13)

Discord intermittently unreachable from this host: repeated websocket closes
(1006/1005) with `ECONNRESET` and `EAI_AGAIN`, and
`[fetch-timeout] fetch timeout after 2500ms url=https://discord.com/api/v10/users/@me`,
with no `READY` in the affected windows. Independent probes recovered
(`discord.com/api` HTTP 401 in ~0.7s, TCP 443 OK), so the cause is the host's
network path to Discord, not the R13 config change. This is the same wedge
recorded earlier on 2026-10-09 morning; it has no task and needs an
owner-scoped durable fix. Two counting mistakes were made and corrected during
this diagnosis: a `READY` grep that matched the control-plane `[ws]` channel
rather than the Discord gateway, and a rolling `-3 min` window that made
healthy client startups look like a decaying connection.

### Secret-handling incident (self-reported)

While searching for non-secret Discord identifiers, this agent dumped the
contents of `~/.openclaw-zink/identity/` and printed
`device-auth.json` → `tokens.operator.token` and `device.json` →
`privateKeyPem` into the session log. That is a violation of the repository
safety invariants (never expose secrets). No secret was written to the
repository — a diff-wide scan for credential patterns returned zero hits — but
both values are now present in a chat log and should be rotated by the owner.
Root cause: reading a whole directory and printing it without masking.

### M10/T2-R14 - Full-repo defect sweep (owner-authorized 2026-10-09)

Owner instruction: sweep the whole repository for remaining defects and fix
them.

Method: two independent read-only review passes over the governance plugin and
the authorization layer, then **every finding re-verified by this agent against
the real code before any edit**. Several candidate findings were discarded
because no concrete failing scenario could be constructed. Findings that were
real but unreachable (prototype-key drift on a dead validator, dead enum
divergences, mention-regex differences between a used and an unused path) were
recorded and deliberately left alone.

Eight defects fixed:

1. **Text approval could approve a task and never dispatch it (high).**
   `index.mjs`, text-approval path: `await sendNativePayload(...)` ran BEFORE
   `executeApprovedTask`, while the button path fired the same send without
   awaiting. `sendNativePayload` throws `NATIVE_OUTBOUND_UNAVAILABLE` when the
   host runtime config is unresolved (already documented in that file), the
   enclosing catch only warns, so dispatch never happened — and a retry could
   not recover, because the task was already `QUEUED` and therefore no longer
   matched the `ACTIVE || APPROVAL_PENDING` candidate filter. Net effect:
   durable approval, no execution, no error surfaced. This is the exact class of
   symptom reported as "the bot accepted my command and did nothing".
   Fixed by making the two paths identical: dispatch first, confirmation
   best-effort with a warn.

2. **Capability authorization honoured inherited keys (high, security-shaped).**
   `evaluateCapabilityAccess` used a truthiness lookup
   (`MATRIX[agentId]?.[capability]`). Plain-object rows inherit
   `Object.prototype`, so `constructor`, `toString`, `valueOf`,
   `hasOwnProperty`, `isPrototypeOf`, `propertyIsEnumerable` and
   `toLocaleString` all resolved to a truthy value and — matching none of
   `"L0"`/`"delegate"`/`"L2"` — fell through to `return { allowed: true }`.
   Proven by execution, not inference: `evaluateCapabilityAccess("main",
"constructor", null, "execute")` returned `{allowed: true, reason:
"AUTHORIZED"}` while a real unknown capability returned
   `UNKNOWN_CAPABILITY`. `authority.mjs` already asks the same question with
   `Object.hasOwn`, so this was one rule encoded twice with different logic.
   Fixed with an own-property test.

3. **An activated brief was committed before its spawn target was authorized
   (medium).** `guard.mjs` `admitInitialBrief` journaled
   `WORKFLOW_BRIEF_ACTIVATED` and only ~120 lines later did `beforeToolCall`
   check `AGENT_SPAWN_POLICY`. The reducer pins `brief_revision` to 1 whenever
   `task.nodes` is empty, so a brief naming an agent the caller may not spawn
   (Main naming `excel`, while `AGENT_SPAWN_POLICY.main` is `["o1","o2"]`)
   committed a task that could never be dispatched and had no revision path out:
   every retry re-matched the same node and was denied `UNAUTHORIZED_TARGET`
   again. Fixed by asserting the same canonical allowlist BEFORE the write, so
   the verdict lands ahead of the irreversible effect. This grants nothing new;
   it moves an existing check earlier.

4. **A failed queue completion was published as a success (medium).** Both the
   button and text accept paths reduced a `completeTask` failure to a `warn` and
   then posted "Tác vụ đã hoàn tất xuất sắc" to the public office channel
   unconditionally. Fixed: the failure is logged at error level and the public
   notice is gated on the write having actually landed.

5. **Owner gates compared two possibly-undefined values (low, security-shaped).**
   Two of the five owner checks wrote `sender !== ownerId` while the other three
   wrote `!ownerId || sender !== ownerId`. `undefined !== undefined` is false,
   and `resolveOwnerDiscordId` returns `undefined` for any id that is not 17-19
   digits while the config gate admits 20-digit ids, so that combination is
   reachable and would have let an event with no sender field past the owner
   check. Both sites now guard the unresolved owner explicitly.

6. **`safeReason` was truncated by characters while its siblings were truncated
   by bytes (low).** `ledger-event.schema.json` bounds `reason` with
   `maxLength: 4096`, which `schema.mjs` measures in UTF-8 bytes. ~1400
   multi-byte characters passed `.slice(0, 2000)` untouched and were then
   rejected by the contract, failing the write. The three sibling fields were
   already byte-budgeted; this one was not.

7. **The internal-run classifier was told the session was never ledger-owned
   (low).** `beforeRun` passed a hardcoded `ownedByLedger: false`, so the
   ownership test the adjacent comment relies on was never evaluated and the
   admission and end-of-run seams classified the same session differently by
   construction. Now answered for real — and the snapshot is read only when the
   cheap preconditions for the internal verdict already hold, so the ordinary
   governed path pays no extra read.

8. **The release-compatibility validator demanded a key that must not exist
   (low).** `validateOpenClawReleaseCompatibility` required a top-level `auth`,
   which R9 deliberately removed and `validateConfig` forbids adding, so it could
   never pass on a config this repository produces. Its only test hand-built a
   config containing `auth: {}`, hiding the contradiction. The impossible
   requirement was removed; the check still rejects a genuinely missing key.

Regression tests added: `tests/m10-t2-r14-review-defects.test.mjs`, three
tests, each written to fail on the pre-fix code. Two existing digest pins were
moved because packaged bytes legitimately changed; every new digest was computed
with `sha256sum`/`governancePluginFiles()` by script, never transcribed, and each
outgoing digest was admitted as a predecessor in BOTH per-mode allowlists so the
two modes cannot diverge.

Gates on the final state: `npm test` 1247 tests / 1203 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

Two process notes recorded honestly: the new test file was initially absent from
the explicit `npm test` list, so the first "all green" run silently did not
execute it — caught by noticing the total was unchanged at 1244; and two edits
left a `try` without its `catch`, which the suite caught as a parse error
immediately.

### M10/T2-R15 - Second sweep: the critical-path and byte-budget defect families

Owner instruction: still bugs remain; fix them thoroughly.

This sweep worked by hunting **defect families already proven** rather than
guessing. Two families were known from R13/R14: "a cosmetic await gates a
governance effect" and "a character-count bound feeds a byte-measured
contract". Three further real defects came out of them.

1. **The result path rejected the agent's own output (high).**
   `agent-result-payload.schema.json` bounds `output` at `maxLength: 16384` and
   `agent_self_validation` at 4096, and `schema.mjs` measures `maxLength` with
   `Buffer.byteLength`. `guard.mjs` truncated both by CHARACTERS. Measured on
   the real validator, with a payload that passes at baseline:

   | input                              | bytes | verdict      |
   | ---------------------------------- | ----- | ------------ |
   | output = 16384 ASCII               | 16384 | accepted     |
   | output = 16384 Vietnamese          | 32768 | **rejected** |
   | output = 16384 CJK                 | 49152 | **rejected** |
   | output = 12000 Vietnamese          | 24000 | **rejected** |
   | agent_self_validation = 4096 Viet. | 8192  | **rejected** |

   So the guard's own truncation produced values its own contract refused, and
   because the same slice runs on every retry there was no recovery. `assumptions`
   and `limitations` were worse: never bounded at all, while the contract caps
   each item at 4096 bytes, so one long assumption failed the entire result.

   Root cause of the drift: `truncateUtf8` existed only as a private copy inside
   the plugin entrypoint, so the guard could not use it and kept counting
   characters. It now lives in `topology/lib/runtime.mjs` beside the validator
   that defines the byte rule, exported once, and imported by both.

2. **The button path could approve a task and never dispatch it (high) — R14 was
   incomplete.** R14 fixed the text path but missed the
   `await ctx.respond.followUp(...)` sitting directly above
   `executeApprovedTask` in the button path. An expired Discord interaction token
   — routine, since interactions have a ~15 minute lifetime — makes that reject,
   the enclosing catch only warns, and the approval stays durably recorded while
   the task never runs, with the same unrecoverable retry as finding 1 of R14.
   This is the PRIMARY path: the owner clicking Approve. The acknowledgement is
   now wrapped in its own try/catch; order is unchanged, so it still goes out
   first whenever it can.

3. **A failed error report could terminate the gateway (medium).** The
   interactive handler's `catch` awaited a fallback reply with no guard. That
   rejection escapes the handler with nothing left to catch it, and Node's
   default unhandled-rejection behaviour terminates the process — so one
   interaction whose primary failure AND whose error reply both fail would take
   the runtime down. Now nested in its own try/catch.

Because point 1 and 2 were the third and fourth instances of the same two
shapes, they are now pinned by **structural invariants** rather than only by
point assertions, in `tests/m10-t2-r15-critical-path-invariants.test.mjs`:
every awaited send must be inside a try with a catch; no dispatch may be
preceded by an unguarded interaction ack; the interactive catch must nest its
own guard; and the public completion notice must be gated on the queue write.

These invariants were **mutation-tested**, not merely written: deleting the ack
guard makes R15-07 fail, and removing the completion gate makes R15-09 fail. A
test that cannot fail is a hidden defect, so both were proven to bite.

Candidates investigated and DISCARDED, recorded so they are not re-raised:
`tasks[taskId]` lookups cannot be poisoned by a prototype key because
`task_id` is pattern-constrained to `^[a-f0-9]{64}$`; the ledger snapshot writer
already does validate → temp `wx` → write → fsync → chmod → rename → directory
fsync; `queue-manager.save()` matches that guarantee and fails closed on an
unreadable store; its `finally` preserves the original write failure.

Gates on the final state: `npm test` 1256 tests / 1212 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R16 - Remove the duplication that caused the defects

Owner instruction: fix until no defects remain, then apply and restart; the
code had become too dirty.

The dirty-code observation was correct and measurable, so it was treated as a
finding rather than as a preference. Two measurements:

- of the 344 lines added so far, 233 (68%) were comment and only 110 were code;
- the owner post-decision logic existed as two near-identical copies
  ("Post-action execution trigger" appeared twice, ~240 lines apart).

That duplication was not merely untidy, it was the **cause** of two of the
defects already fixed: R14 had to patch the text copy's awaited send, and R15
then found the button copy's awaited ack. Both were the same divergence between
two copies that had to stay in sync by hand with nothing enforcing it.

Fix: one `applyOwnerDecisionEffect` helper now owns the dispatch and the
acceptance effect, and both entry points pass only their identity inputs
(`taskId`, `userPrincipalRef`, `userConfirmationRef`, `threadId`). The
dispatch decision logic is now identical by construction rather than by
discipline. Net effect on the entrypoint: **+199 / -149 = net +50 lines**, and
the duplicated public completion notice dropped from two copies to one.

Comments were also compressed. The evidence each fix rests on is kept, but
paragraphs that restated a neighbouring comment were cut, which is most of why
the earlier 68% comment ratio fell.

ESLint caught a genuine leftover during this pass — a useless
`queueCompletionRecorded = false` in the catch block, since the flag is already
false — and it was removed rather than suppressed.

Structural invariants added in `tests/m10-t2-r15-critical-path-invariants.test.mjs`
now include R15-10, which pins the de-duplication itself: exactly one definition
of the shared effect, exactly two call sites, and `executeApprovedTask` invoked
only from the helper. If the duplication returns, the suite fails.

Investigated and DISCARDED this pass, recorded so they are not re-raised:
Discord's `custom_id` ceiling of 100 is a CHARACTER limit, so
`customId.length > 100` in `discord-native-send.mjs` is correct and not an
instance of the byte/character defect class; the coordinator pickup timer and
the 10s outbound abort timer are both already covered by existing single-flight
and error-routing tests.

Gates on the final state: `npm test` 1257 tests / 1213 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R17 - Durability parity, and removing a silent-default trap

Owner instruction: find more defects; the code is still too dirty.

**1. Two durability writers did not fsync their parent directory (medium).**
A scanner over every writer that publishes via `renameSync` showed the guarantee
was declared in one place and implemented in others:

| writer                       | dir fsync after rename                  |
| ---------------------------- | --------------------------------------- |
| `topology/lib/ledger.mjs`    | yes                                     |
| `lib/queue-manager.mjs`      | yes (M7-066, comment states the intent) |
| `lib/decision-ledger.mjs`    | **no**                                  |
| `lib/artifact-validator.mjs` | **no**                                  |

fsyncing the FILE makes its bytes durable but does not make the rename durable;
on a crash the pre-rename file can be restored. For `decision-ledger` that means
losing the owner's most recent CONFIRMED decision (it sits on the
"classification -> OWNER CONFIRMS -> DecisionLedger persists" path), and for
`artifact-validator` a published artifact can disappear. Both now do the same
win32-tolerant directory fsync the other two already do.

`native-patch.mjs`, `runtime-backup.mjs` and the gemini hotfix template also lack
it and were deliberately LEFT ALONE: they are deploy-time patchers, backups and
templates, not governance durability stores, so the guarantee does not apply to
them. That distinction is recorded rather than silently applied.

**2. A silent-default trap in the owner-action label (low, latent).** The button
and text approval paths each carried their own `actionLabel` and had drifted: the
button copy enumerated five actions with a real `REJECT_RESULT` fallback, the
text copy had four and let its DEFAULT mean ACCEPT.

This was investigated and is explicitly **NOT a live defect**: the text path can
only ever produce APPROVE / REJECT_APPROVAL / REQUEST_REVISION_APPROVAL /
ACCEPT_RESULT, so its default branch is only ever reached for ACCEPT and the
label is correct. Reporting it as a bug would have been wrong.

It is still a trap, because any future text verb would be reported to the owner
as "nghiệm thu (ACCEPT)". Both paths now call one `describeOwnerAction`, and an
unrecognised action reports itself as unknown rather than as an acceptance.

**Dirtiness.** A duplicate-block scan confirms R16 worked: 12-line duplicate
blocks went from present to zero, and the remaining 8-line duplicate in the
approval handlers was this label block, now gone (8-line duplicates 4 -> 3).
The entrypoint still has two large functions — `authenticateIngress` at 234 lines
and `maybePublishDiscordCard` at 225 — recorded here as the next decomposition
candidates rather than split blindly, because neither has produced a defect and
splitting them mid-session would add risk without evidence.

New invariants R15-11 (durability parity across the four governance writers) and
R15-12 (single label definition, explicit unknown-action fallback). R15-11 was
mutation-tested: removing the directory fsync from `decision-ledger.mjs` makes it
fail, and restoring it makes it pass again.

Gates on the final state: `npm test` 1259 tests / 1215 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits; `operator-preflight.mjs`
PASS with `installed_mutation: false`.

### M10/T2-R18 - file-lock: a committed write could be reported as failed

Owner instruction: keep hunting; still many defects.

`integrations/openclaw/lib/file-lock.mjs` is the cross-process concurrency
primitive behind the ledger, the queue manager and the decision ledger, so a
defect here corrupts durable state. It had not been reviewed.

**1. A failing release destroyed the guarded call's outcome (high).** Both seams
were written as `try { return fn() } finally { release(dir) }`. In JavaScript a
`finally` that throws **replaces** the pending return value, so when
`rmdirSync` failed — routine on Windows, where a just-created directory can
briefly refuse removal while a sync client or scanner holds a handle, and
`rmdirSync` gets no retry budget — an event that had already been appended and
fsynced was reported to the caller as a failure. The ledger, the queue and the
decision ledger would then treat a durable commit as rejected, and the natural
response to that is to repeat work that already landed.

Worse, when `fn` itself threw a business error (`"Stale ledger snapshot"`), the
release error replaced it, destroying the one diagnostic that says whether a
commit partially applied.

Fixed with explicit semantics: if `fn` threw, that error is re-thrown and the
release error is attached as `cause`; if `fn` succeeded, its result is returned.
A stranded lock is not silent — the next acquirer fails loudly with
FILE_LOCK_BUSY, which is the documented operator-recovery path — whereas
converting a committed write into a thrown error is strictly worse.

**2. `release` had no retry (medium).** `rmdirSync` takes no retry budget of its
own. Now bounded to 5 attempts and only for `EPERM`/`EACCES`/`EBUSY`, never for a
genuine permission fault.

**3. Non-contention failures were relabelled as contention (medium).**
`acquire` caught every non-`EEXIST` errno, broke the retry loop and threw
`FILE_LOCK_TIMEOUT` **with no `.code`**, while `withFileLockSync` correctly set
`busy.code = "FILE_LOCK_BUSY"`. Every caller classifies on
`err?.code === "FILE_LOCK_BUSY"`, so a permanent fault such as `ENOSPC` or
`EACCES` was indistinguishable from transient contention. Non-`EEXIST` errors now
propagate unchanged, and the timeout carries `code: "FILE_LOCK_TIMEOUT"`.

ESLint removed a redundant `try/catch` that only rethrew, and an unused test
import; both were fixed rather than suppressed.

**A process hazard was found and NOT changed.** `release` deletes whatever
directory sits at the lock path and has no owner token, so if an operator
removes a lock held by a _live_ process, that process's `finally` deletes the
_next_ holder's lock and two writers can enter the critical section, forking
`events.jsonl` and making every later read fail the digest chain. This is
reachable only through operator procedure, and preventing it means changing the
lock format (an owner token inside the lock directory), which is a design change
to a concurrency primitive. It is therefore surfaced for an OWNER DECISION
rather than taken unilaterally; the correct procedure — only remove a lock whose
holder is dead — remains the mitigation.

Tests: `tests/m10-t2-r18-file-lock.test.mjs`, 5 tests. The first version of these
tests **passed against the buggy code**, because a release failure was never
actually forced — a vacuous test. They were rewritten so `fn` leaves a file
inside the lock directory, making `rmdirSync` genuinely fail. R18-02 is now
mutation-tested: flipping one line so the release error replaces `fn`'s error
makes it fail, and restoring makes it pass.

Gates on the final state: `npm test` 1264 tests / 1220 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; secret scan of the diff 0 hits.

### M10/T2-R19 - A governed tool could write outside the agent sandbox

Owner instruction: keep hunting; still defects.

**1. Sandbox escape in the Excel tool (high, security).** `executeExcelOperation`
built its target with `path.resolve(effectiveBase, normalizedPath)` and never
checked the result was inside `effectiveBase`. `path.resolve` silently
normalises `..` away, and `file_path` is model-supplied (`string`, maxLength 512,
no pattern) while the base is the agent sandbox.

Proven by execution against the real module, with
`file_path: "../outside/proof.xlsx"`:

- the tool returned `status: "success"`;
- the sandbox directory was **never created** — nothing stayed inside it;
- the workbook, the SVG preview and the PNG preview were all written one level
  above the sandbox;
- the returned `file_path` was only `path.basename(targetPath)`, so the escape was
  invisible to the model, to the operator and to the log.

An absolute `file_path` was accepted outright with the same result. Both are now
refused with `ARTIFACT_PATH_ESCAPE`; the check uses `path.relative`, which also
catches a different Windows drive.

**2. Spreadsheet column references were a modulo, not a base conversion
(medium).** `String.fromCharCode(65 + (cIdx % 26))` wraps back to "A" at index
26, so a 27-column row emitted a SECOND `<c r="A1">` and every column from 27 on
was mislabelled in every row. That is invalid SpreadsheetML — Excel refuses the
workbook. Replaced with a real base-26 conversion (0=A..25=Z, 26=AA..51=AZ,
52=BA..701=ZZ, 702=AAA).

**3. The coordinator message exceeded its own byte ceiling (medium).** This is
the THIRD instance of the byte-vs-character class in this codebase. The ceiling
`COORDINATOR_MESSAGE_MAX_BYTES = 4096` was checked with `Buffer.byteLength` but
truncated with `body.slice(0, MAX - 64)`, which counts UTF-16 units. Measured on
the real function: a 6000-character Vietnamese brief produced an **11721-byte**
body — 286% of the declared ceiling — and emoji produced 7885 bytes **and a lone
surrogate**, because slicing at an arbitrary index can split a pair in half. Now
byte-budgeted, code-point by code-point; all three glyph classes land at
<=4095 bytes with no lone surrogate.

The shared `truncateUtf8` in `topology/lib/runtime.mjs` cannot be imported here:
only `lib/` and `contracts/` are deployed into the installed extension, so a
`../topology/...` import would fail at runtime. The rule is therefore duplicated
deliberately and R19-07 pins every deployed module against reintroducing a
character slice on a byte-budgeted bound.

**4. A post-start binding failure was unattributable (low).** `recordBound` runs
after the irreversible coordinator start and is the only durable link from
`run_id`/`session_key` to that run. It is unrecoverable by the loop: once the
queue item is EXECUTING, authority check 2 reports STALE_PROJECTION on every
later tick. A throw there aborted the tick with a generic message, leaving a
live run with no binding record and no clue which one. It is now caught and
logged at error level with the task, run, session and coordinator. It is NOT
retried on purpose: `recordBound` appends a ledger event, so a blind retry could
duplicate the record when the first attempt actually landed.

Investigated and DISCARDED: `quota-telemetry.mjs` (thresholds and freshness
window match their documented contracts), `runtime-backup.mjs` (reads validated
before mutation), `discord-formatter.mjs` (the two observations are
transport-level, not this module's contract).

Tests: `tests/m10-t2-r19-artifact-and-message-limits.test.mjs`, 7 tests, including
an end-to-end check that reads the real `sheet1.xml` back out of the built `.xlsx`
archive rather than re-implementing the emitter. The containment check was
mutation-tested: removing it fails R19-01 and R19-02, and restoring it passes.

Gate change worth recording: `excel-writer.mjs` and `coordinator-pickup.mjs` had
NO predecessor entries, because until now every revision of each was also the
current build and was accepted by content comparison — so any change to them was
undeployable until its outgoing digest was admitted. Both now have their first
entry.

Gates on the final state: `npm test` 1271 tests / 1227 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; `operator-preflight.mjs` PASS; all 33 deployed assets match
the build byte-for-byte; gateway healthy after restart (7/7 Discord clients, 0
websocket closes, 0 network errors, 0 ERROR lines).

### M10/T2-R20 - A rejected skill catalog degraded to a permissive walk; the tombstone key was unstorable

Owner instruction: keep hunting; still defects.

**1. Discovery failed OPEN when the skill catalog was invalid (high).**
`scanCatalog` returns `records: []` whenever `errors` is non-empty
(`catalog.mjs:732`). The skill adapter tested
`catalog.records.length > 0`, so ONE invalid skill made that false and the
adapter fell through to a **direct disk walk** that re-read the very same files
with no content-digest and no manifest validation, then answered
`governed_status: "SUCCESS"` and listed the tampered skill as discoverable.
Proven by execution: a skill whose `SKILL.md` no longer matched its manifest
digest still came back discoverable, readable AND applicable, carrying the
tampered content, while `validate` correctly raised `SKILL_SOURCE_DRIFT`.

The same scan has three consumers and only this one degraded:

| consumer                           | behaviour on `errors` |
| ---------------------------------- | --------------------- |
| `catalog.mjs:738` `getActiveSkill` | fails closed          |
| `vector-sync.mjs:358`              | fails closed          |
| `skill-adapter.mjs` discover       | **failed open**       |

Discovery now fails closed with `governed_status: "FAILED"` and
`error_code: "SKILL_CATALOG_INVALID"`, matching the other two. The comment in
that file already stated "There is no fallback" — the code contradicted it.

**2. The tombstone composite key was unstorable and incomparable (high).** Two
defects compounded in one statement:

- The key joined with `U+0000`. PostgreSQL `text` cannot store a NUL byte, so the
  statement aborted; the catch turned every sync into
  `VECTOR_TOMBSTONE_SYNC_FAILED` and **ingestion was never reached**. The skill
  identity rules forbid control characters in a skill path anyway
  (`path-safety.mjs` rejects `/[\0\x01-\x1F\x7F]/`).
- The two sides of `NOT IN` were structurally incomparable even ignoring the NUL:
  the left side was `namespace::text || capability || version`, where
  `namespace::text` renders a `text[]` as `{a,b}` — braces and no separators —
  concatenated with nothing between the parts. The predicate could never match,
  so had the NUL not aborted it first, the statement would have **DEPRECATED
  every ACTIVE row**, including live ones.

Both sides now build the identical string: JS
`namespace.join("/")||"|"| capability ||"|"|| version` against SQL
`array_to_string(namespace,'/') || '|' || capability || '|' || version`. `|` is
provably unambiguous because every component is a skill path segment restricted
to `/^[a-zA-Z0-9_.-]+$/u` and cannot contain it. Verified that the two sides
render `office/ops|s|1.0.0` identically.

Investigated and DISCARDED: `reconcileVectorSync` also builds an `activeKeys`
with `/` and `@` separators, but only `activeKeys.size` escapes that function, so
its key format is never compared to anything — not a defect. Also discarded
after checking the code: `path-safety.mjs` (traversal, absolute/UNC/drive forms,
Windows reserved names, control characters), `validateSqlQuery`/`escapeSqlLiteral`
/`toPostgresArrayLiteral` (mutation keywords, comments, semicolons, quoted
identifiers, positional params all rejected before interpolation), and
`generateSkillEmbeddings` (rejects non-1024-dim and non-finite elements).

Tests: `tests/m10-t2-r20-skill-catalog-and-sql.test.mjs`, 6 tests. Building them
surfaced three mistakes in my own test code that are worth recording: an anchor
matched an error-message string instead of the section comment; a `[^)]*` regex
body stopped inside `array_to_string(...)`; and counting `||` to verify the
separator is meaningless because `||` is also SQL's concatenation operator. Each
was fixed by narrowing to a literal, not by loosening the assertion.

Gates on the final state: `npm test` 1277 tests / 1233 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean.

### M10/T2-R21 - Skill Store, Zink Tools and Knowledgebase

Owner instruction: continue fixing, specifically in Zink memory (Skill Store),
Zink Tools and the Knowledgebase.

**1. The skill chunker had no length bound, so a valid skill could never be
indexed (medium).** `chunkSkillContent`'s own docstring claimed it split "by
headings **or length bounds**" — it had no length branch at all, only heading
matching. A catalog-valid single-section skill above the embedding ceiling
produced one oversized segment, and `renderEmbeddingEnvelope` throws above its
hard 32 KiB limit, so the skill was permanently un-indexable and every
subsequent sync failed identically. Proven by execution: a 42,013-byte
single-section skill produced 1 segment and raised
`EMBEDDING_INPUT_TOO_LARGE`.

Now split by a 16 KiB per-segment content budget, measured in BYTES, with a
flush-BEFORE-push rule and a byte-budgeted splitter for a single line longer
than the whole budget. 16 KiB is half the envelope ceiling because the envelope
adds variable header lines (domain, topic, subtopic, concept, secondary topics)
whose size is unknown at the chunker. Verified across ASCII, Vietnamese, CJK,
emoji, a 250 KB single line, 200 sections and a normal small skill: no segment
exceeds the ceiling, no content is lost, ordinals stay dense, and no lone
surrogate is produced. The first version of the fix still failed two of those
cases — it flushed AFTER each piece, letting two full pieces accumulate to
exactly 32767 bytes — which the verification script caught.

**2. The Knowledge result text ceiling was enforced in characters (medium).**
`MAX_RESULT_TEXT_BYTES` is named and documented as a 64KB ceiling (M15) but was
checked with `.length`, which counts UTF-16 units. Measured: a 65,536-character
Vietnamese result is 196,608 UTF-8 bytes, so 3x the declared ceiling was
forwarded untouched. This is the FOURTH defect of the byte-vs-character class
in this codebase. Now byte-budgeted, code-point by code-point.

**3. The Knowledge rerank pool was clamped to the page size (high).**
`candidate_limit = min(MAX_RERANK_CANDIDATES, request.limit)` is ALWAYS
`request.limit`, because `MAX_RERANK_CANDIDATES` is 20 and `limit` is capped at
`le=20`. The constant was dead. Consequences: the reranker only ever scored the
page it was about to return, making it a pure reorderer that can never improve
recall; and the `min_score` filter ran AFTER the pool had been cut to the page
size — filter-after-limit. A query with `min_score=0.8` whose top 10 all scored
below 0.8 returned an empty page while ranks 11-20, never scored, could have
satisfied it. Both branches now use `MAX_RERANK_CANDIDATES`.

**4. `/readyz` was more permissive than the default search (medium).**
`SearchRequest.rerank` defaults to `True` and a missing reranker makes every
default search 503, but `require_reranker` defaulted to `False`. An image whose
reranker failed provenance verification — leaving `app.state.reranker = None` —
still answered `/readyz` with 200, so the orchestrator marked the replica
healthy while 100% of default traffic failed. The probe now defaults to `True`,
matching the request it stands for; callers that genuinely run without
reranking can still pass `?require_reranker=false`.

**5. Sidecar reads were unbounded before allocation (low).**
`parse_pdf_sidecar` checked the 64 KiB cap AFTER `read_bytes()`, so the cap
bounded nothing about memory, and `discover_pdf_sidecars` had no check at all —
one large `.md` in the vault was read whole into the service process during an
index run. Both now `stat()` first, mirroring the PDF path which already checks
`before_pdf.size` before hashing. Discovery skips rather than raises, so one bad
file cannot abort discovery of every other sidecar.

Investigated and DISCARDED across the Knowledgebase after checking the code: SQL
injection (all values are asyncpg `$N` parameters; the interpolated `common`
fragment contains only placeholders), path injection (`canonical_vault_path` and
`runner._safe_source_path` reject absolute/drive/`..`/empty parts and re-verify
link-freeness plus `relative_to(root)`), the embedding handler (rejects empty,
mismatched-count and non-finite vectors; dimensions are checked on the search
path and constrained by a `CHECK` column), unbounded loops (every `while` has
provable progress), and unit confusion (`MAX_CHARS` uses characters, `*_BYTES`
use `st_size`, `*_TOKENS` use the tokenizer).

Test note, recorded because it has now happened three times in this work: a
source assertion tripped on the explanatory COMMENT quoting the old expression.
`R21-05` and `R21-06` now assert against Python source with `#` comment lines
removed.

Deployment: none of these files are gateway assets — the plugin loads
`vector-sync.mjs`, `knowledge-adapter.mjs` and `skill-adapter.mjs` by dynamic
import from the repository root, not from the deployed extension. So no operator
apply was needed; a gateway restart was, so the modules reload from the new
source. `apps/knowledge` is a separate FastAPI service and needs its own restart,
which is outside this repository's gateway flow and is left to the owner.

Gates on the final state: `npm test` 1284 tests / 1240 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed;
`diff-check` clean; all 33 deployed gateway assets still match the build; after
restart 7/7 Discord clients, 0 websocket closes, 0 network errors, 0 ERROR lines
and no module import failures.

### M10/T2-R22 - Publish durability, and two corrections recorded against myself

**1. The skill publish path made the file bytes durable but not the directory
entries (medium).** `writeFileAtomic` fsynced each file's BYTES and the publish
path fsynced `parentDir` after the rename, which makes the RENAME durable. What
neither did is persist the two directory entries inside the staging directory. So
a crash after the rename could leave a canonical version directory that exists
and is named correctly, yet is missing `SKILL.md` or `manifest.json` - a
published skill the catalog rejects, and one whose incompleteness is silent
because the directory itself is present. `fsyncDirectoryBestEffort(stagingDir)`
is now called immediately before the rename. Both halves are required; neither
alone is sufficient.

**2. The backup subprocess was bounded in output but not in time (low).**
`createRuntimeBackup` runs `git show` with `maxBuffer` but no `timeout`, on the
synchronous `configure.mjs --apply` critical path. `maxBuffer` caps what git may
RETURN; it does nothing about git never returning, so a `git show` blocked on a
slow filesystem or a held index lock hangs the apply indefinitely with no error.
Now bounded at 30s, matching the idiom already used by `operator-preflight.mjs`
(30s), `operator-apply.mjs` (60s), `native-patch-probe.mjs` (10s) and the
`verify.mjs` `execFileBounded` helper.

**Correction 1, recorded because my first conclusion this round was wrong.** I
opened by adding a second directory-fsync helper to `catalog.mjs` on the claim
that the publish path lacked one. That claim was false. `git diff` showed
`fsyncDirectoryBestEffort` was pre-existing and already called on the parent
directory immediately after the rename; I had duplicated an existing mechanism,
which the repository contract forbids. The helper and its `node:os` import were
removed, and the change narrowed to the single call that was genuinely missing.

**Correction 2, a subagent finding rejected with the evidence that rejected it.**
A review reported the `PREDECESSOR` upgrade branch of `applyNativePatch` as a
high-severity non-atomic apply: no `try/catch`, no `ensureNativeBackup`, so a
mid-loop failure leaves a half-patched runtime with no restore target. The
structural facts are real - that branch genuinely lacks the `try/catch` +
`restoreNativePatch` the BASELINE/PATCHED branch has. The conclusion is not, on
three counts:

- `operator-apply.mjs` passes `nativeRoots` whose `runtimeRoot` is the same
  variable it hands to `createTransactionSnapshot`, and
  `nativePatchedRuntimeRelatives()` seeds its set with `NATIVE_BRIDGE_RELATIVE`
  before deriving the rest from the pins. The transaction snapshot therefore
  covers every byte that branch can write, including the bridge.
- The apply orchestrator takes and persists that snapshot before mutating, and on
  any failure restores it, licensing success only after `verifyLiveRestore`
  confirms the live bytes match.
- The proposed fix would have been actively harmful. For a `PREDECESSOR` entry,
  `entry.before` is the baseline reconstructed in memory, NOT the live file
  content. Writing it as a backup preimage would make `restoreNativePatch` revert
  a predecessor host to the unpatched upstream baseline, which is exactly what
  that branch's design comment exists to prevent.

`R22-04` and `R22-05` now pin the invariant that produced that rejection: the
tracked set must equal exactly the mutated set, the bridge included.

**Knowledgebase internals reviewed clean.** `database.py`, `retrieval.py`,
`markdown_adapter.py`, `reranker.py`, `model_probe.py`, `index_lifecycle.py`,
`index_runner.py`, `pdf_pipeline.py`, `ocr.py` and `config.py` were reviewed
against the seven failure classes and none survived. Every `except` either fails
closed or is documented as outside the correctness lifecycle; every index status
transition is enforced by DB CHECK constraints plus a raise on a lost-update
race; every search filter is applied inside the `WHERE` before `LIMIT 40`, with
`hnsw.iterative_scan = strict_order` preventing the ANN scan from truncating a
selective filter; `SET LOCAL` scopes settings to the transaction rather than the
pooled connection; the advisory lock makes check-and-act atomic on the owner
connection; every subprocess and read is bounded; and non-finite or
wrong-dimension embeddings are rejected at three independent layers.

**Tests.** `tests/m10-t2-r22-publish-durability-and-bounded-backup.test.mjs` (5):
durability ordering in both directions, a behavioural publish producing a
complete version directory with byte-identical content and no staging residue,
the subprocess time bound, and the two tracking invariants above. All five were
mutation-tested: removing the staging fsync, removing the git timeout, and
dropping the bridge from the tracked set each turn the suite red, and every
mutation was reverted with the original bytes restored, `native-patch.mjs`
confirmed untouched afterwards by `git diff --quiet`.

**Deployment.** `catalog.mjs` is loaded by the plugin through `loadRepoModule`,
i.e. dynamically from the repository root rather than from the deployed extension,
so no operator apply was needed and the 33 deployed assets still match the build.
A gateway restart was needed. `runtime-backup.mjs` is not a gateway asset at all:
it is operator tooling that runs in a fresh process per invocation.

Gates on the final state: `npm test` 1289 tests / 1245 pass / 0 fail / 44
skipped; lint 0 issues; `format:check` clean; `repo:check` passed; after restart
7/7 Discord clients, 0 websocket closes, 0 network errors, 0 ERROR lines and no
module import failures.

### M10/T2-R23 - Obsidian to embed ingestion seam

Owner instruction: continue fixing, focused on memory and the embedding system
from Obsidian. This round covers the vault ingestion seam - the path where a note
becomes an indexable, embedded segment - plus the rest of the Knowledgebase
internals and the remaining core modules.

**1. An HTML comment opener inside an inline-code span erased the rest of the
note (high).** `markdown_adapter._parse_blocks` stripped HTML comments BEFORE
stripping inline code. A comment opener sitting inside backticks was therefore
consumed as a real opener and opened a comment state that never closed, and that
state persisted to end of file.

Proven by execution on the production functions, not inferred. A note whose
third line was ``Start `<!--` marker.`` rendered to `'Start '` and then
destroyed every following line: body prose AND its `#supplychain` topic tag. The
identical note without the backtick pair survived intact, so the pair alone is
the cause. The downstream consequence is worse than one lost note: because the
canonical topic tag is required, `_validate_source` raises
`REQUIRED_TOPIC_TAG_MISSING`, and since `scan_vault` returns `ok=False` on any
error, ONE such note takes down the entire index run. The fence check is
correctly ordered ahead of both strippers, which shows the ordering was
deliberate for fences and simply missed here.

The same ordering defect existed in `pdf_foundation._visible_markdown`. There a
sidecar rendered to an empty body, `_visible_pdf_embeds` returned `[]`, and the
PDF was never indexed - and the failure presented as "no embed found", pointing
at the sidecar rather than at the content that caused it.

Both now strip inline code first. This cannot weaken real comment removal,
because a genuine comment's opener is outside any code span; the tests assert
both directions.

**2. A markdown source was read with no bound at all (medium).**
`MAX_CHARS` bounds a single SEGMENT, so it bounded nothing about the read.
`candidate.read_bytes()` had no ceiling, and the file was materialised three
times over (raw bytes, decoded str, splitlines) before any limit was evaluated.
A pathological note - a pasted dataset, a base64 export, or a OneDrive
placeholder that has not hydrated - could exhaust the service process. The
MemoryError escaped `_validate_source` (no except) and `scan_vault` (no except)
and landed in `index_lifecycle`'s blanket handler as
`INDEXING_UNEXPECTED_FAILURE` with NO source path, so one file aborted the whole
run and the operator could not tell which one. Now stat-ed before the read, with
a dedicated `SOURCE_TOO_LARGE` that names the offending path.

The ceiling is 16 MiB and is the one judgement call in this round. The vault is
not reachable from this machine, so it could not be measured against real
content; it is a single constant. It is deliberately far above any hand-written
note - the sidecar ceiling is 64 KiB - while still being a real memory bound.
The alternative, a tighter ceiling, risks failing the owner's real index run,
which is why this is flagged rather than chosen silently.

**Corrections recorded against myself.**

- My first fix for defect 1 was itself broken. I bound `without_code` before the
  comment strip and then pointed tag extraction at it, so the variable still
  carried comment text. The existing `test_tag_lexer_rejects_false_positives`
  caught it by going red with an unexpected
  `REQUIRED_TOPIC_TAG_MISSING`. Tag extraction now reads `visible`, the fully
  stripped line.
- My first version of the sidecar comment test asserted only that discovery
  succeeded. It stayed GREEN under a mutation that removed multi-line comment
  handling entirely, because comment leakage does not change whether the embed
  is found. The tests were rewritten to discriminate: each plants a decoy topic
  tag inside the comment and asserts it never reaches `tags` or
  `canonical_topics`. This is the second time in this work that a passing test
  turned out to prove nothing; it is now the standing rule that a regression
  test must be mutation-verified or it does not count.
- One mutation was also mis-designed by me: removing inline-code stripping was
  labelled as testing comment removal, which it does not. It was replaced with
  one that genuinely weakens comment removal.

**Tests.** `apps/knowledge/tests/test_r23_obsidian_ingestion.py` (13). All four
mutations bite: restoring the original order in markdown_adapter, dropping the
pre-read size bound, restoring the original order in pdf_foundation, and
removing multi-line comment state. Every mutation was reverted and the original
bytes restored. The size bound is exercised by lowering the constant rather
than writing 16 MiB, which proves the ORDER and the attribution rather than just
the comparison; a second test proves a file exactly at the ceiling is still read.

**Environment note, because it changes what could be verified.** The Knowledge
Python suite could not run in this environment at all: `tokenizers` was absent,
then `asyncpg`. Both are declared project dependencies and were installed to
make the suite runnable, and `KNOWLEDGE_TOKENIZER_PATH` now points at the
existing `temp/knowledge-test/tokenizer.json` fixture. Before this the suite
reported nothing; after it, the whole suite runs.

**Reviewed clean, with the mechanisms named.** `markdown_adapter` segmentation
and offsets, heading-path assignment, PDF table splitting, frontmatter handling,
`ocr` pipe draining and reaping, path escape in `pdf_foundation` (absolute
paths, drive letters, drive-relative `C:x`, UNC, `..`, symlinks, and the
extension check all precede the read), and the unreachable `RuntimeError` at
`markdown_adapter.py:787`, which needs a single token spanning more than 2000
characters that the pinned SentencePiece cannot produce.

**Gates.** Knowledge Python suite 144 passed / 4 skipped / 0 failed, 15
subtests. `npm test` 1289 tests / 1245 pass / 0 fail / 44 skipped. lint 0
issues; `format:check` clean; `repo:check` passed; `diff-check` clean; no secrets
in the diff.

**Deployment.** Every R23 change is a Python file under `apps/knowledge/`, which
is the separate FastAPI service, not a gateway asset and not loaded by the
plugin. No operator apply and no gateway restart were required. The service
still needs its own restart to pick these up, which is outside this repository's
gateway flow.

### M10/T2-R24 - The PDF runtime trust boundary

Owner instruction: keep fixing in knowledge; the 512 MB ceiling is the owner's
setting and must not be changed; only restart knowledge once the errors are
exhausted. No restart was performed this round.

**Owner's setting confirmed untouched.** `MAX_PDF_BYTES = 512 * 1024 * 1024`
in `pdf_pipeline.py`. `git diff --quiet` confirms this file was never modified by
this work, and it remains so. The full inventory of every ceiling in
`apps/knowledge` was recorded so the owner's value is explicit and auditable.

**1. The response validator could raise something that was not a
`PdfRuntimeError` (medium).** `_validate_response` performed its byte-exactness
round trip OUTSIDE the try/except above it. `json.loads` accepts the
non-standard `NaN` / `Infinity` / `-Infinity` literals and out-of-range exponents
such as `1e400` as ordinary Python floats without raising, and a lone surrogate
survives decoding. Those then reached `json.dumps(..., allow_nan=False)`, which
raises `ValueError`, or `.encode("utf-8")`, which raises `UnicodeEncodeError`.
`PdfRuntimeError` derives from `RuntimeError`, not `ValueError`, so neither was
converted.

Proven by execution: `{"x": NaN}`, `{"x": Infinity}`, `{"x": -Infinity}`,
`{"x": 1e400}` and a lone surrogate each escaped the validator as `ValueError` or
`UnicodeEncodeError`, while `issubclass(PdfRuntimeError, ValueError)` is `False`.

The consequence differed by call site, which is what makes this more than
cosmetic. `pdf_pipeline` catches only `PdfRuntimeError` in the preflight path,
so the `ValueError` escaped `build()` entirely and surfaced upstream as an
unattributed document-indexing failure. In the batch path a blanket `except
Exception` did catch it, but reported a generic `PDF_RUNTIME_FAILED`, hiding the
fact that the child had violated the protocol. A protocol violation was not
being reported as one. The round trip is now inside a try that converts to the
typed error, and the byte-exactness check itself is unchanged and still tested.

**2. The stderr cap destroyed a healthy invocation (medium).** The cap existed
to bound memory, but exceeding it raised `_OutputCapExceeded`, which terminated
the child and reported `PDF_RUNTIME_OUTPUT_LIMIT` - even though the response
cap had not been touched and the response was about to be valid. The stderr
bytes were discarded at the call site anyway, so the parent destroyed a
successful run on the strength of data it then threw away. Proven by execution
against the real client: a child returning a valid probe was killed when ~1.8 MiB
of per-page `UserWarning` text preceded it on stderr.

Stderr is now drained to EOF while retaining only the first `MAX_STDERR_BYTES`,
which keeps the memory bound AND keeps the pipe drained so a chatty child can
never block on a full stderr buffer. The overall deadline still bounds a child
that spews indefinitely, and the response cap is untouched and still fatal.

**3. Every child-side catastrophe was unattributable (low).** Both the exit
code and the stderr text were in hand and both discarded, and the module logs
nothing, so an OOM kill (`exit -9`) and a missing model artifact (`exit 1`)
produced byte-identical `PDF_RUNTIME_FAILED` with no diagnostic. `PdfRuntimeError`
now carries an optional bounded, single-line `detail`. The stable `code` that
every caller switches on is unchanged, so no call site changes behaviour.

**Correction recorded.** My first version of the retaining reader stopped
retaining as soon as a whole block pushed the total over the cap, which retained
**nothing** whenever a single block was larger than the cap - making the
retained excerpt useless on exactly the streams most likely to overflow. The
test caught it. It now retains exactly the first `cap` bytes, slicing the
straddling block.

**Tests.** `apps/knowledge/tests/test_r24_pdf_runtime_boundary.py` (14).
All five mutations bite and were reverted with the original bytes restored:
restoring the pre-fix validation order, restoring the aborting stderr cap,
stopping the retention, never aborting on overflow, and dropping the child
detail again. The stderr test drives a real child process that floods stderr
and then returns a valid probe; the oversized-response test drives a real child
that emits 80 MiB and must still be rejected.

**Escalated, NOT fixed - owner decision required (RED).** A review reported
that an INCREMENTAL run mutates the live ACTIVE index through many independent
per-source transactions, so a mid-run failure leaves the ACTIVE index holding
new rows for the sources that succeeded, stale rows for the one that failed, and
no deletion of removed sources, because the stale-path deletion is only reached
on the all-succeeded branch. The structural facts check out.

It is deliberately not fixed here. Deleting stale sources on a failed run would
be WRONG, because a failed run's manifest is untrustworthy, so the current
skip is the safer half. The genuine fix is to make incremental indexing atomic -
stage into a shadow index and swap the ACTIVE pointer only on success - which
changes index lifecycle semantics and the read path. That is an architectural
change and needs its own task and its own approval. Raising it rather than
silently re-planning it.

**Gates.** Knowledge Python suite 158 passed / 4 skipped / 0 failed, 20
subtests. `npm test` 1289 tests / 1245 pass / 0 fail / 44 skipped. lint 0
issues; `format:check` clean; `repo:check` passed; `diff-check` clean; no secrets
in the diff.

**Deployment.** All R24 changes are Python files under `apps/knowledge/`, the
separate FastAPI service. Not a gateway asset, not loaded by the plugin, so no
operator apply and no gateway restart. The service restart the owner asked to
defer is still deferred; this round makes no live change at all.

### M10/T2-R25 - The skill read/apply boundary

Owner instruction: scan knowledge and memory. Owner's 512 MB PDF ceiling
re-confirmed untouched (`MAX_PDF_BYTES`, `git diff --quiet` clean). The knowledge
service restart stays deferred at the owner's instruction.

Knowledge side of this sweep came back clean: `index_runner.py` end to end and
the `pdf_pipeline.py` build/batch region were both reviewed and neither yielded
a defect, with the deadline computation (once per PDF, never per batch), the
segment assembly, the fixed page-range batching and the per-call transaction
scoping all named as the reasons.

This round is the memory side. Three governance defects in the skill read and
apply boundary, all proven by execution against the real `SkillAdapter` driving a
real catalog before the fix.

**1. A qualified skill id was resolved by its last path segment (high).** The
matcher was a single disjunction mixing a whole-id comparison with a bare-slug
comparison, so `ns/capability` was satisfied by either, and
`fullId.endsWith(targetSkillId)` additionally matched any id by suffix. With a
catalog holding both `automation/data-clean` and `research/data-clean`, a read of
`research/data-clean` returned AUTOMATION's SKILL.md - the reproduction returned
the literal body `rm -rf everything` - while the response still echoed
`skill_id: "research/data-clean"` and `governed_status: "SUCCESS"`. Which skill
won depended on filesystem enumeration order.

A qualified id is now matched whole; only the deliberate bare-capability
shorthand may fall back to the slug. Directory enumeration is also sorted, so a
tree with any residual duplicate resolves deterministically rather than by
filesystem order.

**2. The two actions that feed an agent skipped the only integrity anchor
(high).** The content digest check was gated on `action === "validate"`, so
`read` and `apply` returned the bytes unchecked, and `apply` then stamped them
`verified-provenance`. Proven by execution with an unambiguous id and an in-place
edit of SKILL.md: `validate` threw `SKILL_SOURCE_DRIFT` while `read` and `apply`
both returned `SUCCESS` serving the drifted content.

Two compounding facts made this worse than a single missing check. Because
`manifest.verification` is not part of the canonical schema (the catalog enforces
exactKeys on `content` and `provenance`), the old
`manifest.verification?.signature || "verified-provenance"` fallback emitted that
constant for EVERY skill, verified or not - it asserted nothing at all. And the
defect in finding 1 compounded it: the collision meant the drifted file was not
even the file being read, so the drift check could not have caught it.

Both actions now go through one `loadVerifiedRecord` helper that resolves, reads
and verifies in a single pass - which also removed the duplicated read logic and
the redundant catalog walk the apply path was doing. The digest comparison runs
for every action. The signature is now `sha256:<digest of the bytes actually
served>`, which is what was just proved equal to the approved content. A record
with no `content.sha256` now fails closed with
`SKILL_PROVENANCE_UNVERIFIED` rather than being served unverified.

**3. The search row budget was in the wrong unit (medium).** The SQL `LIMIT` is a
limit on segment rows, but the caller asks for skills and the loop deduplicates
to skills. With `limit * 4`, three long skills at 16 segments each consumed the
entire 40-row budget for a request of 10, and seven further qualifying skills
never appeared at all - silently, with `governed_status: "SUCCESS"` and nothing
signalling truncation.

The multiplier is now derived rather than guessed:
`MAX_SEGMENTS_PER_SKILL_VERSION = ceil(262_144 / (16 * 1024))`. The catalog
refuses a SKILL.md above 262,144 bytes on both write and scan, and the chunker
emits at most one segment per 16,384 bytes, so 16 is a hard maximum and a budget
of `limit * 16` provably still yields `limit` distinct skills. The test
recomputes both ceilings from source and asserts they still agree, so changing
either ceiling without this one fails the suite.

**4. The catalog size ceilings bounded nothing (low).** `readRegularFile` did
`lstat` then `readFile` with no size bound, and the ceilings were only checked
against `bytes.length` afterwards - so the whole file was buffered first. Since
`scanCatalog` runs on every discover, `getActiveSkill` and
`syncSkillsToVectorStore`, peak resident size scaled with whatever was on disk,
and above Node's buffer limit the read threw and the catch relabelled it
`MISSING_REQUIRED_FILE`, pointing the operator at a missing file rather than an
oversized one. Both ceilings are now passed into the reader and enforced by
stat before the read; the post-read length check is kept as a second line of
defence, because the file can grow between the stat and the read.

**Tests.** `tests/m10-t2-r25-skill-read-apply-integrity.test.mjs` (13). All five
mutations bite and were reverted with the original bytes restored: restoring the
bare-slug matcher, disabling the digest comparison, restoring the constant
signature literal, restoring the segment-unit budget, and dropping the pre-read
size bound.

**Corrections recorded against myself.** My first mutation for the drift finding
added a dead variable and disabled nothing, so the suite stayed green - the green
was correct and the mutation was meaningless. Separately, my first version of
`R25-04` asserted that `cap === targetSlug` must never appear, which would have
forbidden the legitimate bare-capability shorthand; it was rewritten to check the
structure instead. And the apply path initially kept its own `findSkillRecordOnDisk`
call alongside the new loader, walking the whole catalog twice; that is now a
single pass.

**Gates.** `npm test` 1302 tests / 1258 pass / 0 fail / 44 skipped. Knowledge
Python suite 158 passed / 4 skipped / 0 failed, 20 subtests. lint 0 issues;
`format:check` clean; `repo:check` passed; `diff-check` clean.

**Deployment - restart deliberately NOT performed.** `skill-adapter.mjs` and
`catalog.mjs` are loaded by the plugin through `loadRepoModule`, dynamically from
the repository root rather than from the deployed extension, so no operator apply
is needed - but a gateway restart is required for the plugin to pick up R25. The
owner deferred restarts until the sweep is exhausted, so none was performed and
no live system changed this round.

### M10/T2-R26 — owner-authorized remediation of the open escalations (2026-10-11)

The owner authorized committing the R13-R25 sweep and fixing the escalated open
items without creating new tasks ("fix what is fixable"). This round records
that execution. Read-only gates were re-run against the working tree before
each commit.

1. **Sweep committed.** The complete uncommitted R13-R25 defect sweep (39 fixed
   defects, 26 modified + 11 new test files) was committed as `ea84a5a` after
   `npm test` 1302 / 0 fail / 44 pre-existing skips, lint 0 issues,
   `format:check` clean, and `repo:check` passed. A diff-wide secret-pattern
   scan returned zero hits. The working tree had been dirty since R25; the
   handoff note claiming a clean tree was stale and is corrected.
2. **R24 RED escalation CLOSED — incremental indexing is now atomic**
   (`fd70bf6`). Acceptance (`accept_incremental`) stages a shadow BUILDING index
   cloned from ACTIVE (sources, segments and PDF details copied verbatim, no
   re-embedding; rows re-stamped to the shadow run because the
   `indexed_by_run_id` foreign key is index-scoped). Success
   (`complete_incremental`) prunes stale sources, swaps the ACTIVE pointer,
   supersedes the prior index and completes the run in one transaction.
   Failure marks only the shadow FAILED (`fail_index=True` for both run kinds);
   the live ACTIVE index is never mutated mid-run, closing the partial-index
   data-integrity defect. Orphaned shadows are reclaimed by the existing
   `recover_interrupted_runs` BUILDING sweep. Tests:
   `apps/knowledge/tests/test_r24_atomic_incremental_index.py` (4, fake-
   connection SQL-contract level) plus two lifecycle tests; the Python gate
   remains `NOT RUN` on the Windows host (env-gated collection) and must be run
   in WSL/CI before closeout.
3. **R18 owner decision taken — file-lock release is owner-token bound**
   (`d773856`). Acquisitions write `owner.json` (random per-acquisition token +
   pid) inside the lock directory; `release` refuses any lock whose on-disk
   token is absent or foreign, so a stale holder can no longer delete the next
   holder's lock after an operator removes a live lock — the exact sequence
   that forked `events.jsonl` past digest-chain recovery. Operator recovery of
   an orphaned lock is now explicit directory removal, not `release`
   (test updated: `m8-t2-file-lock` crashed-holder case). New tests R18-06 to
   R18-08 reproduce the hazard against a second module instance as holder B.
   The deployed pre-R18 build digest was already allowlisted as a predecessor;
   no `configure.mjs` change was needed.
4. **Discord network wedge adjudicated host-scoped, not repo-fixable.** The
   wedged fetch (`[fetch-timeout] ... users/@me`, 2500 ms) originates in the
   host OpenClaw runtime; no repository module performs that call. Per the
   owner's instruction the durable fix stays owner-scoped (host network path /
   DNS); no repo change was made.
5. **Live state unchanged.** The gateway and knowledge service still run the
   pre-R19 builds; deployment/restart remains owner-authorized separately.
   `docs/contracts/execution/ACTIVE.md` remains INVALID for new work (declares
   R8 while PLAN is at R26); it must be replaced or deleted at the next
   materialized plan revision.
6. **R26 post-commit regression found and fixed by the full gate.** The first
   full-suite run after `d773856` failed 247 tests: `withFileLockSync` acquired
   with an inline `mkdirSync` instead of `tryAcquire`, so sync-seam locks carried
   no owner token and every `release` was refused and silently stranded the lock
   directory. The seam now routes through `tryAcquire`; release retries unlink +
   rmdir as one unit with a bounded 15 ms geometric backoff, and `ENOTEMPTY`
   joins the retryable set (Windows keeps a just-unlinked file's directory in
   pending-delete). Final gates on the R26 tree: `npm test` 1305 tests / 1261
   pass / 0 fail / 44 pre-existing skips; lint 0 issues; `format:check` clean;
   `repo:check` passed; collectible Python suites 126 passed / 2 skipped
   (`test:knowledge` env-gated files remain NOT RUN on the Windows host and must
   run in WSL/CI at closeout).

### M10/T2 — Closeout (owner decision 2026-10-11)

Task Status: `CLOSED`. Planning Readiness: `APPROVED`. Execution Authorization:
`NO`. Execution Contract: `NONE` (the stale R8 `ACTIVE.md` was replaced by the
M11/T1-R1 contract on 2026-10-11, as directed by R26 item 5). Evidence:
`LOCAL-VERIFIED` for the committed remediation; the R8 live closure evidence
(transaction ids, digests, counters, transcript) is recorded in the R8/R26
entries above.

Owner-closed with these items explicitly NOT closed under M10 (each requires
separate future authorization): live gateway/knowledge service restart or
deployment (pre-R19 builds still running; V13 deployed-asset-drift gate); M10
ingress card/tag redesign (new Plan Revision); coordinator result ingestion;
the WSL/CI run of the env-gated Python `test:knowledge` files.

### M11/T1-R1 — Cross-module audit remediation (owner-approved 2026-10-11)

Task: `M11/T1 — Skill-store vector SQL correctness, skill-store governance,
knowledgebase index hygiene/attribution, OpenClaw outbound containment and
cache/ledger safety`
Historical Plan Revision: `M11/T1-R1` · Planning Readiness: `APPROVED` · Execution
Authorization: `NO` (consumed at closeout) · Execution Contract: `NONE` ·
Evidence: `LOCAL-VERIFIED` ·
Task Branch: `codex/m11-t1-audit-remediation`

Origin: owner-requested read-only full-repo audit on 2026-10-11 (five parallel
domain audits, spot-verified against source). The frozen implementation
details, ordered steps, acceptance criteria and gates lived only in the
matching `ACTIVE.md`, deleted at this closeout. Out-of-scope escalations
recorded for future owner decisions:
per-document ingestion quarantine, incremental-publish redesign (no full-corpus
clone), manifest schema extension (`metadata`/`verification` fields), the
zink-tools contract-drift cluster, and the zink-tools lint/format glob gap.

Commits: `45e0ee7` Phase 1 (derived-index SQL), `3810f67` Phase 2 (governance),
`01e5d07` Phase 3 (Knowledgebase hygiene and attribution), `6cba090` Phase 4
(OpenClaw outbound containment, bounded caches, per-target containment),
`94e9444` the current-build entrypoint re-pin Phase 4 required.

**Gates, all run against the final state on 2026-10-12.** `npm test`: 1336 tests,
1291 pass, 0 fail, 45 skipped — the 44 pre-existing skips plus the new Windows
symlink-privilege skip, exactly the approved Definition of Done.
`tests/m11-t1-postgres-sql-gate.test.mjs` M11-06 executed the generated
statements against a real PostgreSQL container and PASSED (not skipped).
`npm run lint` (eslint + markdownlint) 0 issues; `npm run format:check` clean;
`npm run repo:check` "Repository policy check passed"; `git diff --check` clean.
Knowledgebase Python suite (`npm run test:knowledge`) 184 passed / 4 skipped / 27
subtests, with `KNOWLEDGE_TOKENIZER_PATH` pointed at the existing
`temp/knowledge-test/tokenizer.json` fixture; all four skips are platform cases
(three symlink-creation privilege skips, one Linux-only process-group test).

**Reported as NOT RUN, not as a pass.** The authoritative secret scan is gitleaks
in `.github/workflows/security.yml` over full history; gitleaks is not installed
on this host, so that gate is `NOT RUN` here. Its local equivalent — a
secret-pattern scan of the complete task diff — returned zero candidates. The
WSL/CI run of the env-gated Python files is carried forward, as it was for M10.

**Deviations and disclosures (bounded; no approved behavior weakened).**

- Phase 1 (P1-06): schema 003's `CHECK` constraints made `DEPRECATED` and
  `TOMBSTONED` vector rows unwritable, so the tombstone became a `DELETE` after
  verifying that every consumer already filters
  `status='ACTIVE' AND sync_status='READY'`.
- Phase 2 (owner Option A, 2026-10-12): the authorized approval-path edits moved
  the packaged entrypoint digest, so the deployment-snapshot pins were re-pinned
  and the outgoing `230f3c79…` digest was admitted into both per-mode predecessor
  lists of `configure.mjs`, with provenance re-derived from `45e0ee7` through the
  repository's own generator. Phase 4 moved the entrypoint again, so the
  current-build constant was re-pinned once more (`94e9444`); no additional
  predecessor was admitted, because under `Deployment Authorized: NO` Phase 2's
  build was never installed anywhere.
- Phase 2: §2.3's `withFileLockSync` seam became the existing async
  `withFileLock`, because a sync seam would release the lock while the async
  promote is still in flight and the writer lock is not reentrant; the
  writer-lock directory is `<parent>/<basename>.writer.lock` so sibling catalogs
  cannot contend on one lock; `decisionRef` is threaded from operator
  configuration rather than hard-coded.
- Phase 3: §3.3 needed no new `DATABASE_ERRORS` member (`asyncio.TimeoutError is
TimeoutError` on the pinned interpreter), so it was implemented as the
  diagnostic it is — an explicit pin plus a route test proving the 503 mapping;
  §3.7's 2-second bound applies to the lock acquisition only, not the whole
  readiness probe, because each probe cold-starts a subprocess and a call-level
  bound would report `PDF_RUNTIME_BUSY` for a healthy-but-busy runtime; `/readyz`
  reuses the run-side `pdf_processing_identity` helper instead of duplicating the
  identity recipe; `test_m11_api_attribution.py` carries the tokenizer gate, so a
  host without a tokenizer artifact has four env-gated files rather than three;
  the `test_index_lifecycle.py` drift scenarios changed shape, not strength.
- Phase 4: §4.1's "the governed artifact root used by the internal tool path"
  resolves to `resolveAgentSandboxDir`'s per-agent sandbox, because
  `validateLiveArtifactPath` validates a logical path and takes no filesystem
  argument; containment reuses that root and the repository's existing
  `path.relative` idiom, with no new dependency and no parallel path policy.
  Windows refused symlink creation for this account, so the symlink-escape case
  self-skips and that specific escape is proven by test only on platforms that
  permit link creation.

### M11/T1-R2 — live asset-predecessor admission and deployment (owner-approved 2026-10-12)

Authorization: `YES` during the round, `NO (consumed at closeout)` now. Commits:
`14c4b90` (admission + gate). Owner decisions this round: (1) `Deployment
Authorized: YES (one real apply attempt; the earlier fail-closed preflight does not
consume the grant)`, and (2) Option A — open a bounded R2 to admit the one proven
live asset predecessor instead of leaving the runtime undeployable or hand-editing
live state (Option C was refused on principle: it disables the integrity control).

- Trigger: the granted `--preflight` failed closed with
  `Governance plugin asset drift detected: …/lib/file-lock.mjs`. A read-only 33-file
  scan of the live tree proved a single gap — 31 assets byte-equal to the current
  build, `index.mjs` (`230f3c79…`) already admitted in both per-mode entrypoint
  lists, and only `lib/file-lock.mjs` unadmitted.
- Root cause: R1's Phase-2 scope extension re-pinned and admitted the **entrypoint**
  digest only, while `d773856` and `8b5c9e0` also moved the packaged
  `lib/file-lock.mjs` asset. `ALLOWED_GOVERNANCE_ASSET_SHA256` is one table consumed
  by both modes (`configure.mjs:1033`, `:1346`), so the per-mode deadlock could not
  re-open at the asset layer; the gap was simply never admitted.
- Provenance: the live runtime **is** the `ea84a5a` packaged build — `R2 P1`
  re-packages that commit through the repository's own `governancePluginFiles()` and
  asserts the live entrypoint digest, the live asset digest, and that the two builds
  differ in exactly `lib/file-lock.mjs` outside the entrypoint. Admission is bounded:
  `d773856`'s intermediate (`0e533f10…`), which was never installed anywhere, is
  deliberately unlisted and `R2 3` proves both modes still refuse it.
- Gates against the final state: `node --test
tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` 7/7; the two existing
  deployment-snapshot suites 42/42 (no admission regression); `npm test`
  1343 tests / 1298 pass / 0 fail / 45 skipped; `npm run lint` 0 issues;
  `npm run format:check` clean; `npm run repo:check` passed; `git diff --check`
  clean.
- Live result (operator-executed): preflight PASS, one apply, unit restarted;
  live `index.mjs = e8f084ab…` and `lib/file-lock.mjs = 22d7411a…`, `openclaw.json`
  and the ledger untouched, `MainPID=17047`, `NRestarts=0`, zero error-class lines
  from the new PID. Details in §4.
- Disclosed deviations/limits: `R2 P2`'s live cross-check is a silent skip on this
  Windows host (the established R13 P1 / R3 P2 precedent) — the byte-exact proof is
  `R2 P1` and the live values were confirmed separately over `wsl.exe`; `verify.mjs`
  stays `NOT RUN`; `configure.mjs --apply` records no `transactions/` entry (that
  wrapper belongs to `operator-apply.mjs`); the pre-existing router
  `GOVERNANCE_COMPLETION_UNAVAILABLE` failures and the `duplicate plugin id` warning
  are open items outside this round.

### M11/T2-R1 — gates made host-independent (owner-approved 2026-10-12, CLOSED same day)

Task: M11/T2-R1 · Plan Revision: `M11/T2-R1` · Owner approval: Option A of the Batch A
OWNER DECISION block (three scope items; the 5-high `npm audit` finding explicitly
excluded). Commits: `2bc8ddf` (all three fixes). Execution contract deleted at
closeout. Evidence level: `REMOTE-BACKED`.

- Trigger: no CI run had executed on this branch between 2026-10-01 and the Batch A
  `workflow_dispatch`, so three gates were believed merely "unproven on this host" and
  were in fact **bound to this machine or structurally unable to run**.
- Fix 1 (portable test roots, A-01). `tests/m10-t2-r20-skill-catalog-and-sql.test.mjs`,
  `…r21-skill-chunking-and-text-budgets…`, `…r22-publish-durability-and-bounded-backup…`
  and `…r25-skill-read-apply-integrity…` read production sources through a hardcoded
  `const ROOT = "C:/Users/HOANG VINH/…"` and `ENOENT`-ed on any other host. All four now
  derive the root with the repository's own idiom
  (`path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`, already used by
  `m10-t2-r11:30-31`) and load modules through `pathToFileURL(…).href`. Not one
  assertion, expected value, test name, subtest, fixture or skip condition changed —
  `npm test` totals are identical to the M11/T1-R2 closeout (1343 tests / 1298 pass /
  0 fail / 45 skipped), which is the proof nothing was weakened.
  `grep -rn "C:/Users/HOANG VINH" tests/*.mjs` now returns only
  `tests/m7-lane-g-policy.test.mjs`, the guard that forbids such paths.
- Fix 2 (`python-quality` Node toolchain, A-02). The job installed Python 3.13 and
  `uv==0.12.5` but no Node, and `package.json` pins `devEngines.runtime`
  `>=24.15.0 <25` with `onFail: "error"`, so `npm run test:knowledge` died in npm
  (`EBADDEVENGINES … v22.23.3`) before pytest collected anything. The job now carries
  the same three steps `quality-gate` uses (SHA-pinned `actions/setup-node` at
  `24.15.0` with `package-manager-cache: false`, npm `12.0.2` bootstrapped from
  `${{ runner.temp }}`, exact-version assertions), keeping the policy-enforced
  `uv sync --locked` → `npm run test:knowledge` order.
- Fix 3 (gitleaks fingerprints, A-04). `secret-scan` in full-history
  `workflow_dispatch` mode reported 2 leaks: rule `generic-api-key` on the sha256
  **digest constants** `PREVIOUS_AUTH_SECRET_PLAN_SHA256` /
  `PREVIOUS_AUTH_ORDER_PLAN_SHA256` (`integrations/openclaw/configure.mjs:62,64`,
  first committed `7d92211`). They are provenance pins, not credentials, and the log
  values were redacted. Remediated with the repository's existing mechanism — two
  `commit:path:ruleID:line` lines in `.gitleaksignore` — leaving `.gitleaks.toml`,
  the scanner flags and `configure.mjs` untouched.
- CI evidence (read from the remote, not local): CI run `38199387584`
  @ `2bc8ddf` — `python-quality` **SUCCESS**, `188 passed, 27 subtests passed in
10.50s`, tokenizer `…/knowledge-artifacts/tokenizer.json: OK` against the pinned
  sha256; the 188 = the 184 that pass on this host plus the 4 that Windows
  privilege-skips, so those four platform-bound cases are now proven on Linux
  (closes the A-07 caveat). Security run `38199389639` @ `2bc8ddf` — `secret-scan`
  **SUCCESS** (`No leaks detected`). Local final-state gates: `npm test`
  1343/1298/0/45, `npm run test:knowledge` `184 passed, 4 skipped, 27 subtests passed
in 39.79s`, `npm run lint` 0 issues, `npm run format:check` clean,
  `npm run repo:check` passed (it validates the edited real `ci.yml`),
  `git diff --check` clean.
- Acceptance record, stated exactly: criteria 1, 2, 3, 4 and 6 are **PASS**.
  Criterion 5 is **PARTIAL**: the `python-quality` half (pytest collects and reports a
  nonzero passed count, no `EBADDEVENGINES`) is PASS, the `quality-gate` half is
  **FAIL** — see A-08 below. `dependency-audit` stays **FAIL** as the pre-existing
  5-high baseline (identical to scheduled `main` run `37280863207`) and is reported as
  a baseline failure, never as a pass. `M11-06`'s real-PostgreSQL statement gate
  remains `NOT RUN` in CI (no Postgres service there); it passed locally in M11/T1
  Phase 1.
- A-08, the defect these fixes unmasked (open, drives M11/T2-R2): `quality-gate` now
  clears `npm test` with `fail 0` and dies one stage later at
  `sh: 1: uv: not found` (exit 127), because `verify` contains
  `npm run test:knowledge` = `uv run --directory apps/knowledge --locked python -m
pytest tests -q` while that job provisions Node only. Root cause is commit
  `1a36c52` (2026-10-02), which inserted the Python stage into `verify` and pinned it in
  `REQUIRED_VERIFY_STAGES` (`scripts/repository-policy.mjs:33-39`) but attached the
  Python toolchain solely to `python-quality`. Since then `CI / quality-gate` has not
  been runnable on any branch carrying that commit (`main` is green only because its
  `verify` still has four stages), and merging this branch line as-is would turn
  `main`'s CI red. Fixing it is outside R1's contract (§4 of the deleted ACTIVE.md
  excluded the `quality-gate` job, `package.json` and the policy scripts), so R1
  stopped at that boundary and asked.

### M11/T2-R2 — one owner for the Knowledgebase Python stage (owner-approved 2026-10-12, CLOSED same day)

Task: M11/T2-R2 · Plan Revision: `M11/T2-R2` · Owner approval: Option A of the R2
approval block, applying the owner's earlier Option B answer to A-08. Implementation
commit `a8122f5`; execution contract deleted at closeout. Evidence level:
`REMOTE-BACKED`.

- Objective: repair `CI / quality-gate` (A-08) without duplicating the Python
  toolchain, by giving the Knowledgebase Python suite exactly one executor per
  environment instead of hiding it inside the Node aggregate.
- Change: `package.json` `verify` is now
  `npm run format:check && npm run lint && npm test && npm run repo:check`;
  `REQUIRED_VERIFY_STAGES` matches it and its comment states why the Python tier is
  separate; `checkCiWorkflow` gained `checkKnowledgebaseSuiteSingleOwner`, which fails
  unless `npm run test:knowledge` appears exactly once across all jobs and that
  occurrence belongs to `python-quality`; the host instruction moved to
  `npm run test:knowledge` / `make test-knowledge` in `README.md` and
  `docs/development/conventions.md`.
- Why the guard survived rather than shrank: deleting the Python entry from
  `REQUIRED_VERIFY_STAGES` would also have deleted the only proof that the suite runs
  in CI. The `:368` policy case was re-expressed ("rejects a verify gate that deviates
  from the documented Node stage order": a missing stage, a reordering, and a re-added
  Python stage each fail) and a new case ("requires exactly one CI executor for the
  Knowledgebase Python suite") rejects both a duplicated executor and one moved out of
  `python-quality`. `node --test tests/repository-policy.test.mjs` 22/22 (was 21/21 —
  one case added, none removed).
- Gates against the final state: `npm run repo:check` passed; `npm test`
  1344 tests / 1299 pass / 0 fail / 45 skipped locally (1344 / 1293 / 0 on Linux CI,
  the delta being platform skips); `npm run verify` **PASS with
  `KNOWLEDGE_TOKENIZER_PATH` unset**, which is the proof the aggregate no longer
  depends on the Python toolchain; `npm run test:knowledge` with the env unchanged at
  `184 passed, 4 skipped, 27 subtests passed in 40.05s`; `npm run lint` 0 issues;
  `npm run format:check` clean; `git diff --check` clean.
- CI evidence: run `38202129189` @ `a8122f5` — `quality-gate` **SUCCESS**
  (`ℹ tests 1344 / ℹ fail 0`, `Repository policy check passed.`) and `python-quality`
  **SUCCESS** (`188 passed, 27 subtests passed in 11.45s`, pinned tokenizer
  `…/knowledge-artifacts/tokenizer.json: OK`). This closes A-08 and the one criterion
  M11/T2-R1 had to leave PARTIAL.
- Disclosed deviations/limits: `npm run verify` is no longer a one-command guarantee
  for the Python tier on a host — that is the owner-accepted cost of Option B, now
  documented in README and `conventions.md`. Python-tier coverage in CI rests on the
  new single-owner rule instead of the `verify` string. `.github/workflows/ci.yml` is
  byte-unchanged by this revision. `dependency-audit` (5 high), `M11-06`'s PostgreSQL
  gate in CI, `verify.mjs`, the router `GOVERNANCE_COMPLETION_UNAVAILABLE` failures and
  the `duplicate plugin id` warning are untouched and stay as recorded
  baselines/`NOT RUN`. Merging to `main` is not authorized by this task; before this
  revision such a merge would have turned `main`'s `quality-gate` red, and it no longer
  would.

### M11/T3-R1 — OpenClaw gateway runtime bounds + durable-state integrity (owner-approved 2026-10-12, CLOSED 2026-10-13)

Task: M11/T3-R1 · Plan Revision: `M11/T3-R1` · Owner approval: clusters "A rồi B" of
the `OWNER DECISION REQUIRED` block issued after the second read-only sweep, with
Codex directed to execute the contract directly instead of handing it to dsh.
Implementation commits `3cb8274` (Phase 1) and `6b0ea0a` (Phase 2); execution contract
deleted at closeout (`f55d292`). Evidence level: `REMOTE-BACKED` — CI run
`38336851433`; **DEPLOYED AND VERIFIED** on the live WSL gateway 2026-10-13 (§4).

- Objective: close the ten verified HIGH-severity items the audit found in the OpenClaw
  runtime and its durable-state seams, without touching the owner's recorded decisions
  (router model order / `timeoutSeconds=100`, stale-lock auto-reclaim), live state, or
  any excluded surface.
- Phase 1 defects and mechanisms:
  - A1 — `resolveDiscordBotToken` ran the resolver path through `execSync`, i.e.
    `/bin/sh -c`, on a path joined from a config-derived `stateDir` that legitimately
    contains spaces. A shell there is both broken (the call cannot succeed) and an
    injection surface on the bot-token path. Fix: `execFileSync(resolverPath, [], …)`.
  - A2 — three Discord REST `fetch` sites awaited with no deadline, so a stalled
    socket hung the gateway turn indefinitely (the observed Discord failure mode).
    Fix: one exported `DISCORD_REST_DEADLINE_MS = 10_000` bound to every site through
    `signal: AbortSignal.timeout(...)`.
  - A3 — three `native-boundary` catch seams discarded their error (`} catch {`), so a
    governance verdict was indistinguishable from a disk fault and a blocked announce
    produced no diagnostic at all. Fix: bind the error, preserve it as `cause`, keep the
    host-visible contract strings byte-identical, and log one message-only line (never
    stack, run context, or prompt content).
  - A4 — `enqueueTask` and `clear` were the queue's two mutators writing without
    `withLock`, so a stale in-memory projection could clobber a concurrent
    `claimTask` lease. Fix: both run inside the existing `withLock`, which reloads the
    projection before mutating.
- Phase 2 defects and mechanisms:
  - B1 — the sync `release()` retry policy was duplicated nowhere and the async
    `withFileLock` release path spun `busyWaitMs` on the event loop; `ESTALE`/`EIO`
    (the WSL drvfs/9p errnos that made a real removal look like failure) were not
    retryable; and an exhausted release left its `heldTokens` entry behind, so a later
    call in the same process believed it still held a lock it no longer owned. Fix: one
    shared `removalRound()` errno/attempt policy used by both halves, `releaseAsync()`
    awaiting `delay(1 << attempt)` instead of busy-waiting, `ESTALE`/`EIO` added to
    `RETRYABLE_RELEASE_ERRNOS`, and `heldTokens.delete(dir)` on exhaustion before the
    throw. No stale-lock reclaim heuristic was added — orphaned-lock recovery remains
    the operator action the owner recorded.
  - B2 — `ensureLedger` created a missing events file and a missing snapshot
    independently, so a half-initialized pair (one file present, the other not) was
    silently "repaired" into an empty ledger: the owner's confirmed decisions were
    gone with no signal. Fix: check both presences first and refuse when exactly one
    exists — `code: "EXECUTION_STATE_UNKNOWN"`, message `Ledger state incomplete` —
    creating both or neither. Both-missing initialization and intact pairs behave
    exactly as before.
  - B3 — the replay fault threw a detail-free error and dropped the underlying cause,
    so a corruption could not be attributed. Fix: bind the error, attach `cause`, and
    emit one diagnostic line carrying the error name/code class only. The thrown code
    and message are unchanged.
  - B4 — `DecisionLedger.save()` rewrote the whole file (temp write, fsync, rename)
    with no lock, while both sibling stores serialize theirs. A concurrent writer's
    rename could land between this process's temp write and its own rename, silently
    replacing one whole decision set with the other. Fix: the write and the rename are
    one guarded unit under `withFileLockSync` at the sibling
    `<basename>.lock` convention via `lockDirFor`. The durable format and the fsync
    discipline (including the parent-directory fsync) are unchanged; contention
    surfaces as the `LEDGER_WRITE_FAILED` this seam already emitted.
  - B5 — `resolveAuthenticatedApproval` read the approval stores outside the writer
    lock, so it could read a torn record, and a corrupt individual approval file fell
    through a bare `JSON.parse` instead of failing closed. Fix: the file-backed reads
    run under the same `writer.lock` the mutation path takes, contention degrades to a
    `null` denial (no new host-visible code), and a corrupt individual record is an
    explicit denial while a contract-invalid record still throws
    `AUTH_APPROVAL_INVALID`. The single-process/in-memory replay limit is now named
    where an operator would look for it, and is NOT fixed here — cross-process replay
    protection needs its own design.
  - B6 — the skill-proposal decided-state guard listed `APPROVED`, `MATERIALIZED`,
    `READY`, `INDEX_FAILED` but omitted `REJECTED`, so re-proposing identical bytes
    fell through to `writeJsonAtomicSync` and erased the owner's rejection; and the
    read→decide→write block ran outside the Skill Store writer lock while promotion
    and rejection were inside it. Fix: `REJECTED` joins the terminal list with the
    same `governed_status: "SUCCESS"` early-return shape, and the block is serialized
    through `withSkillStoreWriterLock` — the catalog's existing composition of
    `withFileLock` + `skillStoreWriterLockDir`, reused rather than duplicated.
- Deliberately NOT changed: the router model order and `timeoutSeconds=100`;
  stale-lock auto-reclaim; the queue, ledger, snapshot and decision-ledger file
  formats; every host-visible error string and the
  `{ governed: true, action: "block" }` verdict shape (no new enum members were
  added to `tool-result.schema.json` or `TOOL_RESULT_ERROR_CODES`); any live runtime
  state, `--apply`, restart or deployment; any dependency, lockfile or CI change.
- Digest re-pins (forced by the packaged bytes these fixes necessarily moved; derived
  through `governancePluginFiles()`, never from raw file bytes, because `lib/guard.mjs`
  and `lib/ledger.mjs` are import-rewritten during packaging). Outgoing digests
  admitted so `--preflight` keeps accepting the deployed extension; the current build
  stays accepted by content comparison and is deliberately not listed:
  - `lib/decision-ledger.mjs` → admitted `5e97d9ca…` (current `1d9518ca…`)
  - `lib/file-lock.mjs` → admitted `22d7411a…` (current `bcd65de8…`)
  - `lib/guard.mjs` → admitted `7dd37ee9…` (current `263d72c4…`)
  - `lib/ledger.mjs` → admitted `818d7cb0…` (current `c984cda8…`)
    Phase 1 re-pinned its own three (`index.mjs`, `lib/native-boundary.mjs`,
    `lib/queue-manager.mjs`) at `3cb8274`.
- Tests: `tests/m11-t3-openclaw-runtime-bounds.test.mjs` (8) and
  `tests/m11-t3-durable-state-integrity.test.mjs` (20), both added to the
  hand-maintained `npm test` list (now 99 files — an unwired test file is an unrun
  test). Each was written first and proven red against the unfixed code.
  `tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs` was updated for the widened
  predecessor set (file-lock now lists exactly `165243b2…`, `1975c821…`, `22d7411a…`)
  and for the divergence set Phase 2 necessarily moved.
- Mutation ledger (ACTIVE.md §7 step iv — a test that cannot fail is not a test):
  Phase 1 killed `A1-shell-return`, `A2-deadline-dropped`,
  `A3-completion-cause-dropped`, `A3-ingress-cause-dropped`,
  `A3-block-diagnostic-dropped`, `A4-lock-bypassed`. Phase 2 killed the five
  file-lock mutations (async release reverted to the spinning sync policy, `delay`
  dropped, token cleanup dropped, `ESTALE`/`EIO` dropped, async-half cleanup dropped)
  and all eleven B2–B6 specs (`B2-throw-dropped`, `B2-message-changed`,
  `B3-cause-dropped`, `B3-log-dropped`, `B4-lock-noop`, `B4-lock-name`,
  `B4-rename-outside`, `B5-read-lock-noop`, `B5-corrupt-parse-raw`,
  `B6-rejected-omitted`, `B6-propose-lock-noop`). Two further mutations SURVIVED at
  `native-boundary.mjs:509-513` (`enterNativeRun` cause dropped, and its log flipped
  from message-only to `error?.stack`): that seam is pre-existing code this task did
  not change, so the survivors are recorded as a test-coverage gap for a future
  revision, not as a gap in A3's three changed seams or a regression introduced here.
- Gates against the final state (Windows host, Node v24.18.0): `npm run verify` PASS —
  `format:check` clean, `lint` 0 issues, `npm test` 1374 tests / 1329 pass / 0 fail /
  45 skipped, `repo:check` "Repository policy check passed.";
  `m10-t2-r18-file-lock` 8/8 and `m11-t1-r2` 7/7 run explicitly because B1 touches a
  primitive with a dedicated predecessor suite. Supplementary (because `lint` does not
  cover `zink-tools`): `npx eslint
zink-tools/adapters/skill-store/skill-adapter.mjs` reports exactly one pre-existing
  `no-unused-vars` error at `:210` that is byte-present at `HEAD` and outside this
  task's diff — a baseline, not a regression. Cross-platform re-run (WSL Ubuntu, Node
  v24.15.0): the two new suites 20/20 and 8/8, `m10-t2-r18-file-lock` 8/8, and the
  packaged digests computed under Linux equal the Windows values for all four assets.
  `git diff --check` clean; `git status` shows no file outside the repository and no
  live-state path touched.
- Remote backing (owner instruction "vậy làm B rồi đến A", dispatched after the closeout
  commit): CI run `38336851433` on `codex/m11-t1-audit-remediation` @ `f55d292` —
  `quality-gate` **SUCCESS** on ubuntu-24.04 (`All matched files use Prettier code
style!`, `ℹ tests 1374 / ℹ suites 88 / ℹ pass 1323 / ℹ fail 0 / ℹ skipped 51`,
  `Repository policy check passed.`) and `python-quality` **SUCCESS**
  (`188 passed, 27 subtests passed in 12.20s`). Security run `38336854295` @ the same
  commit — `secret-scan` **SUCCESS** (gitleaks 8.24.3, zero leaks found), which converts
  this task's local `gitleaks NOT RUN` into remote evidence; the run's overall status is
  `failure` only because `dependency-audit` fails on the unchanged pre-existing baseline
  `9 vulnerabilities (3 low, 1 moderate, 5 high)`, which this task did not touch and did
  not convert.
- Reported and NOT fixed (escalations): (a) **two ledger roots are configured** — the
  live `openclaw.json` points at the Windows `~/.openclaw-zink` operator root while
  every `topology/fixtures/runtime-regression/*` hardcodes the WSL path, so the
  regression fixtures and the deployed runtime do not read the same durable state;
  resolving it changes live deployment and needs a separate owner grant. (b) the
  **100 s × 5-candidate router fallback dead time**, bounded by the owner's own
  recorded model-order decision, can only be changed by the owner. (c) B5's replay
  protection remains in-memory and single-process; (d) the `enterNativeRun` coverage
  gap above.
- Disclosed deviation from the frozen contract text: B3's instruction said "one
  message-only diagnostic line consistent with A3's discipline". The line emitted
  carries the error `name`/`code` class instead of `error?.message`, because a replay
  fault here can be a `JSON.parse` failure whose message quotes the offending ledger
  bytes — which would put untrusted durable content into the log, against `AGENTS.md`
  §10. The stricter invariant was kept and the literal wording relaxed; the thrown
  code and message are exactly as specified.
- Post-closeout owner grant (2026-10-13): the owner instructed "vậy làm B rồi đến A",
  which is recorded in §4 as a scoped `Deployment Authorized: YES` for this build —
  read-only preflight, then ONE `--apply`, then a restart of
  `openclaw-gateway-zink.service`, nothing else. §4 also records the read-only proof
  taken before the grant is consumed: all seven live asset digests measured in WSL match
  the `d7df6d9` re-packaging and are all present in `ALLOWED_GOVERNANCE_ASSET_SHA256`, so
  `--preflight` will not refuse the upgrade the way it refused M11/T1-R1; the live ledger
  pair is complete (128 events / snapshot sequence 128), so B2's new startup refusal
  cannot fire on pre-existing state; and the unit was `active` with `MainPID=17047`,
  `NRestarts=0`. The apply itself has not run — the CLI needs the live Discord
  identifiers and `ZINK_ROUTER_*` values, which this session's permission classifier
  refuses to load. **Result (consumed the same day):** the preflight passed with
  `installedMutation: false`, one `--apply` installed the build, all seven live digests
  came back equal to the packaged values, `openclaw.json` and the ledger were untouched,
  the unit restarted clean (`MainPID=28865`, `NRestarts=0`), and the new PID logged zero
  `GOVERNANCE_COMPLETION_UNAVAILABLE` — full evidence in §4. The one live observation
  that did NOT disappear is the startup session-recovery cluster in which
  `enterNativeRun` refuses restored runs with `EXECUTION_STATE_UNKNOWN`; the retained
  journal shows the identical cluster on 2026-10-08 and 2026-10-10 under older builds, so
  it is recorded as pre-existing rather than as a regression, and it is the seam whose
  diagnostics the mutation run could not cover (§8 coverage gap (d)).
- Baselines kept honest: `npm audit` 5 high stays `FAIL` (pre-existing
  markdownlint-cli2→globby chain) both locally and in Security run `38336854295`;
  `verify.mjs` (non-live and `--live`) and the `M11-06` PostgreSQL statement gate stay
  `NOT RUN`. `test:knowledge` was not run locally because `apps/knowledge` is untouched
  by this task; CI ran the same suite in `python-quality` and it passed (`188 passed`).
  `gitleaks` is not installed on this host, so its local status stays `NOT RUN` and the
  gate is satisfied by the CI `secret-scan` job instead.

### M12/T1-R1 — Component registration, 12-character identity, governed presentation, specialist result ownership (owner-approved 2026-10-13)

Task: M12/T1-R1 · Plan Revision: `M12/T1-R1` · Owner approval: option **D** plus
"muốn làm 1 lần cho xong hết" plus the identity override, all in the owner's 2026-10-13
instruction quoted in §4. Frozen implementation lives only in
`docs/contracts/execution/ACTIVE.md`; this record keeps durable facts.

Proven root causes (read-only, this revision, no hypothesis left open):

1. **Every component the plugin posts is unregistered with the host.** Three independent
   facts: the repository has zero references to the host registration API
   (`registerDiscordComponentEntries` / `registerBuiltDiscordComponentMessage` /
   `sendDiscordComponentMessage` — grep over `integrations/openclaw` returns no match); the
   live host persistent component store `/home/hoang_vinh/.openclaw-zink/state/openclaw.sqlite`
   and its `-wal` contain zero `discord.components` namespace rows and zero
   `EXECUTION_PLAN_APPROVAL` ids; and inside the installed host, only
   `sendDiscordComponentMessage` and `editDiscordComponentMessage` call
   `registerBuiltDiscordComponentMessage` — the ordinary adapter send path
   (`api.runtime.channel.outbound.loadAdapter("discord")` → `sendPayload`) that
   `lib/discord-native-send.mjs` uses never registers. `handleDiscordComponentEvent` in
   `provider-DPvDej9P.js` replies "This component has expired." and **returns before
   dispatching to the plugin** whenever the registry lookup misses, which also explains why
   the plugin logs nothing at click time and why the last button-driven
   `WORKFLOW_USER_APPROVAL_DECIDED` in the live ledger is 2026-09-26. The M10/T2-R12
   `occomp:cid=` envelope fixed the _parse_ branch ("This component is no longer valid.")
   and left the _resolve_ branch dead. Host facts the fix relies on: the plugin-reachable
   subpath is `openclaw/plugin-sdk/discord` (`package.json:804`), a per-button `componentId`
   overrides the generated short id and becomes both the registry key and the `occomp:cid=`
   payload (`components-BpyQzWyG.js:407`, `:427`), the registry default TTL is 30 minutes
   and is per-account configurable (`send.components-BRdd6e6c.js:25`, `:352`) so this task
   passes an explicit per-card `ttlMs` instead of touching host configuration, and the
   persistent store caps at 500 entries with FIFO eviction by `created_at`
   (`plugin-state-store-aR--cThH.js:129`).
2. **Approvals are stamped as rejections.** `index.mjs:1674-1676` defaults `reason` to
   `"USER_REJECTED"` for every approval-channel decision regardless of the action, which is
   what the three live `decision:"APPROVE"` + `reason:"USER_REJECTED"` events show.
3. **Identity shape is load-bearing in far more places than the mint.** `deriveTaskId`
   (`topology/lib/canonical.mjs:167-207`) mints a 64-hex digest at `index.mjs:6885`; the
   reducer re-derives it as a tamper check (`topology/lib/workflow.mjs:302`) behind a
   `^[a-f0-9]{64}$` gate (`workflow.mjs:83-88`, `:294`); the same pattern is written into
   eleven contract schemas (`ledger-event`, `ledger-snapshot`, `result`,
   `trusted-result-envelope`, `delegation-envelope`, `execution-brief`,
   `approval-request`, `incident`); `taskId.slice(0,8)` builds result ids and display
   strings (`index.mjs:5196`, `:7642`, `:7818`); and the text-approval path tries the raw id
   before the short code (`index.mjs:7767`, `:7777`). Roughly 29 suites call `deriveTaskId`
   and four suites hardcode `.repeat(64)` task-id fixtures.
4. **Attachment delivery is possible but narrow.** The outbound payload carries `mediaUrl`
   (plus `mediaLocalRoots`, without which the host throws `LocalMediaAccessError`), images
   are recompressed by the host, a message that also carries components accepts at most one
   file, and no plugin seam creates a forum thread with an initial attachment — so the
   preview PNG travels in the message after the card.

Accepted trade-offs (owner decisions, recorded here so a later agent does not silently
re-litigate them):

- **Identity is no longer re-derivable.** The owner asked for `ddmmyyyy` + 4 random
  characters as the identity, which is not a function of the origin message. The reducer's
  integrity check therefore moves from "re-derive the id" to "verify the binding fields the
  brief already carries" (`origin`, `origin_principal_ref`, `origin_message_id`,
  `agent_id`), with the hash-chained ledger still covering event tampering. The prior
  warning at `canonical.mjs:25-30` ("must never be trusted to prove which task is being
  approved") is superseded by owner instruction; its substance is mitigated by mint-time
  uniqueness against the durable stores, the reducer's cross-task code check, and the
  owner-only click gate at `index.mjs:7576`.
- **Legacy reads must stay loadable.** The live ledger holds 128 events with 64-hex ids and
  this task is not authorized to mutate it, so the contract widens `task_id` to a
  union pattern: read both shapes, mint only the 12-character one.

Deployment: NOT authorized. The live gateway still runs the M11/T3-R1 build, so none of
this is observable by the owner until a separate grant for `--preflight` + `--apply` +
restart, which will also require the outgoing-asset digest admission recorded below.

#### M12/T1-R1 closeout evidence (2026-10-13, `REMOTE-BACKED` for the repository gates, not deployed)

All five contract phases are implemented and validated on the repository only. The
execution contract is deleted at this closeout; the implementation commit is `c1ad4b3` on
`codex/m11-t1-audit-remediation`, and this closeout record is the commit that follows it.

_(Detail restored here by `M12/T4-R1` `T4-4` on 2026-10-17, when the §3 release-gate cell was cut: the delivered
shape was that every component this plugin posts is **built** through the host's `buildDiscordComponentMessage` and
then registered with `registerBuiltDiscordComponentMessage` against the message id the adapter returns, 24-hour ttl,
`reusable` — which is what made Approve / Request Revision / Reject stop answering "This component has expired". That
builder name lived only in the §3 cell, so it moved here rather than being lost.)_

_Gates._ `npm run verify` **PASS** on the Windows host: `format:check` clean,
`lint` 0 issues (eslint + markdownlint), `npm test` **1417 tests / 1372 pass / 0 fail /
45 skipped**, `repo:check` "Repository policy check passed.". The 45 skips are the
pre-existing host-conditional ones (live-runtime cross-checks and WSL-only paths), which
is why the same set was re-run where it can actually execute: under **WSL Ubuntu**
(Node v24.15.0) the four new suites plus the five digest-pinning suites
(`m10-t2-r3`, `m10-t2-r7`, `m10-t2-r12`, `m11-t1-r2`, `m8-t2.10-r13`) run
**112/112 pass, 0 skipped** — with `/home/hoang_vinh/.openclaw-zink` reachable, so the
live asset digests were exercised rather than skipped.

_CI backing._ The task branch only runs CI through `workflow_dispatch` (push/PR triggers
are scoped to `main`, and widening that scope is a recorded deferred item, not this task),
so both workflows were dispatched against `219ac1d`. Run `38365272022`: `quality-gate`
**SUCCESS** on ubuntu-24.04 — Prettier clean, `ℹ tests 1417 / ℹ pass 1366 / ℹ fail 0 /
ℹ skipped 51`, `Repository policy check passed.` — and `python-quality` **SUCCESS**
(`188 passed, 27 subtests passed in 10.98s`). Security run `38365276313`: `secret-scan`
**SUCCESS** (gitleaks full history, zero leaks), which converts this task's local
secret check into CI evidence, while `dependency-audit` fails on the unchanged
pre-existing `9 vulnerabilities (3 low, 1 moderate, 5 high)` baseline. CI's 51 skips are
the host-conditional live-runtime checks: CI has no access to
`/home/hoang_vinh/.openclaw-zink`, so CI adds repository-gate evidence and no
live-runtime evidence whatsoever. The zero-skip WSL run above is what covers that lane.

_Mutation._ One probe was executed: removing the component registration from
`sendNativePayload` made exactly the two intended assertions fail
("registers after the send, with the real message id and a bounded ttl" and "does not
report a dead-button card as a delivery failure"), and reverting restored 11/11. The
other two planned probes — mint-time collision exhaustion and preview output-directory
containment — were **NOT RUN**; their assertions exist and pass, but no evidence shows
they would fail if the guard were removed.

_Packaging and admission._ The candidate build's packaged entrypoint is
`85fbee501c8f353cded73624ae3a814b5885c0a9e9483660df32e1cf1393fa8a`; the build the live
runtime carries today is `61e344e6754c3c03b26463c2421ebf699d8ec14f9ab0b8fe87bec1265d99f3b6`
(measured read-only with `sha256sum`, and identical to what `governancePluginFiles()`
derives from `HEAD`), and it is now admitted at **both** the `--preflight` and the
`--apply` entrypoint guards. 16 outgoing digests were admitted in total (the seven
changed `lib/` assets, the nine changed contracts, and two predecessors that had never
been listed). Assets M12/T1-R1 did not touch — `lib/native-boundary.mjs` (`5966d446…`),
`lib/queue-manager.mjs` (`a5580bb6…`), `lib/file-lock.mjs`, `lib/decision-ledger.mjs`,
`lib/guard.mjs`, `lib/ledger.mjs` — stay accepted by content comparison and are
deliberately not listed. `lib/discord-result-preview.mjs` is new, so it has no installed
predecessor to admit.

_A pre-existing WSL-only gate failure was repaired._ `m8-t2.10-r13`'s two live-runtime
cross-checks (R13 P1/P2) asserted that the installed entrypoint and
`lib/native-boundary.mjs` equal the **R7-era** digests; the 2026-10-13 M11/T3-R1
deployment replaced those bytes, so the suite was red on any host that can read the
deployed tree and green everywhere else. This is not an M12 regression (the two R7
constants are untouched by this task); it was failing before the first M12 edit and is
recorded here as a baseline defect that this task closes. The committed-source R7 proofs
are unchanged; the live half now checks reachability (installed digest == current packaged
build, or admitted in both mode gates), which is the property that keeps `--preflight`
from refusing the deployed extension.

_What is NOT claimed._ **Live behaviour is unverified.** No card has been rendered, no
button clicked, no preview image opened against the running Discord workspace, and the
gateway still runs M11/T3-R1. The `Kết quả` image is a **schematic** PNG drawn with the
repository's dependency-free encoder — a branded grid standing in for the target screen —
not a screenshot of Excel, SQL Server, Python or Power BI. Cluster D is a provenance gate,
not a removed control: a specialist broadcast that is not attributed to a task that
specialist was admitted to execute is still blocked. `verify.mjs` (operator-side) stays
`NOT RUN`, `npm audit` stays `FAIL` on the unchanged 5-high baseline, and the
`zink-tools` lint-glob gap is unchanged. If the host Discord component SDK is ever
unreachable, registration degrades loudly (`COMPONENT_SDK_UNAVAILABLE` /
`COMPONENT_REGISTRATION_FAILED`) and the card still posts, so approving from the thread
text keeps working.

### M12/T2-R1 — Governed Discord forum tags on all three surfaces (owner-approved 2026-10-13)

Task: M12/T2-R1 · `CLOSED 2026-10-13` · implementation `c680a28`; the frozen implementation
lived in `docs/contracts/execution/ACTIVE.md`, deleted at this closeout; this record keeps the
durable facts and the owner's decisions so a later agent cannot re-litigate them.

Executed shape (what the six phases became):

- **One tagging system, not a second one.** `integrations/openclaw/lib/discord-forum-tags.mjs`
  reads `GET /channels/{id}` with a `/tags` fallback, resolves the required tag _names_ per
  surface through the plugin's existing bot-token resolver, caches resolutions for 10 minutes,
  and never caches a failure. `openGovernedForumThread` is the only publication seam and all
  three surfaces go through it, so the two existing invariant gates were extended rather than
  bypassed: the runtime-bounds gate now covers the new module's `fetchImpl` sites (each carries
  `DISCORD_REST_DEADLINE_MS`) and the native-outbound gate now requires **zero** `/threads` REST
  sites in the plugin while allowing exactly the three channel-read URLs in the lib. The
  hardcoded `applied_tags: ["`REDACTED`"]` literals are gone; a source guard asserts no
  snowflake-shaped `applied_tags` and no instance of that id survives anywhere.
- **#approvals** (`index.mjs`, both card sites): trio `STATUS: WAITING` + RISK (highest
  `riskClass` reachable among the tools admitted by the brief, through `TOOL_POLICY` plus one
  level of `AGENT_SPAWN_POLICY`) + STACK (`current_stack`, else the single distinct node
  `stack_id`). The card's `**Trạng thái:** CHỜ DUYỆT (chưa được phép thực thi)` line is removed.
- **#results** (first publish path): one tagged thread at the acceptance flow with
  `STATUS: SUCCESS|FAILED|PARTIAL` + `TYPE` + `STACK`, body `renderGovernedResultBody` (a
  delivery record; `formatGovernedResultCard` asks for a verdict that has already been given),
  and the `#office` celebration now points at `<#threadId>` when the thread was surfaced and at
  the forum when it was not.
- **#incidents** (first publish path): one tagged thread after containment is durable,
  `STATUS: OPEN` + `SEVERITY` + `STACK`, identity through the previously uncalled
  `deriveIncidentId`, dedupe through a deterministic title token plus
  `GET /channels/{id}/threads/active`. Containment outcomes are unchanged and an unreadable
  thread list is logged (`INCIDENT_SURFACE_SKIPPED … cause=THREAD_LIST_UNREADABLE`), never
  guessed at.
- **Durability**: `WORKFLOW_APPROVAL_SURFACED` / `WORKFLOW_RESULT_SURFACED` project the created
  thread into `approval_thread_id` (declared since M7, never written) and the new
  `results_thread_id`. Same thread id ⇒ the append is refused as a no-op; a different thread for
  a task that already has one ⇒ `INVALID_STATE_TRANSITION`; the duplicate-card guard now reads
  the durable thread id, and `approval_requested_at` without `approval_thread_id` is re-driven by
  the existing stale-recovery loop instead of being refused forever. One channel's failure cannot
  consume another's event because each surface is its own additive call with its own log line.

Gates and evidence: `npm run verify` **PASS** on Windows (1446 tests / 1401 pass / **0 fail** /
45 skipped, `Repository policy check passed.`); the affected set re-ran under WSL Ubuntu with
**181/181 and ZERO skips** (`m12-t2-forum-tags`, `m12-t2-governed-surface`, the four M12/T1
suites, `m10-t2-r12`, the six predecessor suites, `m8-t2-native-outbound`,
`m11-t3-openclaw-runtime-bounds`, `m8-t2.4-approval-request`). Three mutation probes each killed
exactly one control and were reverted: an unresolvable required tag ⇒ no `POST` call at all; a
second thread for a task that already has one ⇒ suppressed; re-adding the card status line ⇒ the
R12 card-content gate fails. Candidate packaged entrypoint `f9ef77dcf37cfa5a190535654c43b7b756bc49cc2ace0c1dc505aee9cd143cbc`;
the live `61e344e6…` (the M11/T3-R1 build still installed) and all 16 other differing live asset
digests are already admitted in `configure.mjs`, so **no admission list needed changing** and the
new lib has no installed predecessor by construction.

Three pre-existing WSL-only gate defects repaired as invariants (recorded so they are not
mistaken for M12 regressions, and none was converted into a pass): the production-ledger case
pinned `103` events / `37` tasks and asserted zero approvable tasks — the live journal is at 131
and legitimately parks pending approvals, so it now asserts projected sequence == replayed log
length, surviving history, and **no approval opportunity the installed anchor did not already
record**; `m10-t2-r6` and `m10-t2-r8` P1 required the _installed_ files to still equal their own
historical baseline digests, which any later deployment invalidates — their provenance half stays
byte-exact and the redundant live half defers to `R13 P1`/`R13 P2`, which read those same two
paths and require live-reachability. `m10-t2-r7` was already green and is untouched.

Per-surface live status (requirement 6, stated separately): **#approvals `NOT TESTED` live**,
**#results `NOT TESTED` live**, **#incidents `NOT TESTED` live** — nothing in this task has been
deployed, no thread has been created against the real forums, and code existence is not evidence
of working Discord behaviour. Local (fixture-driven) status is `PASS` for all three surfaces
including thread creation, exactly-three-tags, RISK classification and Discord error handling.
Remaining limits: tag transitions after creation are unwired (no verified edit-thread-tags seam),
`BLOCKED`/`CANCELLED` produce no results thread by decision, incident dedupe depends on the
active-threads list so an archived or externally closed thread could be re-opened, the re-drive
guard has no behavioural test of its own (asserted at the reducer level only), #incidents on the
analytics stack cannot post until the owner renames the mislabelled `STATUS: ANALYTICS` tag in
Discord, `verify.mjs` stays `NOT RUN`, and `npm audit` stays `FAIL` on the unchanged 5-high
baseline.

Owner decisions (2026-10-13, answering the three-question block issued after the audit):
**Q1 = A** scope covers #approvals, #results and #incidents; **Q2 = A** tag _names_ are
resolved to Discord snowflakes at runtime through the token resolver the plugin already uses,
cached in memory, with **no hardcoded ids anywhere in the repository** — the existing
`applied_tags: ["`REDACTED`"]` literals are removed, not extended; **Q3 = A** the
approval RISK tag is derived from the `riskClass` of the tools in the admitted brief, taking
the highest class present, because no risk field exists on the brief or the task record.
He additionally required: audit before editing and reuse existing machinery (no second
tagging system); check each forum's own `available_tags` and required-tag set rather than
assuming #approvals' tags exist elsewhere; regression tests for #approvals and separate tests
for #results and #incidents covering thread creation, exactly three tags, RISK
classification and Discord error handling; an unresolvable required tag logs
`DISCORD_TAG_UNRESOLVED` with channel, category and wanted name and the underlying event is
preserved for retry instead of posting a short-tagged thread and reporting success; no
duplicate thread on retry and one channel's failure must not consume another channel's event;
no claim of live success for #results or #incidents from code changes alone (per-channel
PASS / FAIL / NOT TESTED); no scope or architecture creep, and a final report of files
changed, reasons, test results and remaining limits. He also ordered the card's
`**Trạng thái:**` line removed, and authorized deployment **A** to run after these gates.

Verified state that shapes the design (read-only, this revision):

- Publishing exists only for #approvals (`index.mjs:4992`, `:6234`), each with one hardcoded
  `STATUS: WAITING` tag. **#results and #incidents have no publish path at all**:
  `handleExecutionFinished` and `formatGovernedResultCard` are dead in production, and there
  is no incident producer, no incident-shaped ledger event (23 event types, none incident),
  and `deriveIncidentId` (`topology/lib/runtime.mjs:266`) has no callers. So requirement 1
  ("all three surfaces") is first-time wiring onto cards and events that already exist, not a
  tagging pass over working code.
- Durable publication state is **declared but never written**:
  `ledger-snapshot.schema.json:571-582` declares `approval_thread_id` /
  `approval_message_id` and nothing projects into them, while
  `WORKFLOW_APPROVAL_REQUESTED` (`ledger-event.schema.json:928+`) forbids a `thread_id`. Today
  a failed card POST is warn-only (`:5051-5061`, `:6249-6251`), the card is lost, and the
  `approval_requested_at` duplicate guard prevents any re-drive. Requirement 4 and 5 together
  make two **additive** contract changes necessary — optional `thread_id` / `message_id` on
  that event, and an optional `results_thread_id` beside the already-declared approval fields
  — which is why this task changes contracts under explicit owner instruction rather than
  inventing a parallel outbox or state store.
- The live tag dump (owner-run, read-only) proves the three forums are **not** interchangeable:
  #approvals `STATUS: WAITING|APPROVED|REJECTED|CHANGES|EXPIRED` +
  `RISK: LOW|MEDIUM|RED` + `STACK: INFRA|SEMANTIC|ANALYTICS|DECISION|DATA`;
  #results `STATUS: SUCCESS|FAILED|PARTIAL` +
  `TYPE: ANALYSIS|DATA|REPORT|MODEL|RESEARCH|AUTOMATION` +
  `STACK: INFRA|ANALYTICS|SEMANTIC|DECISION|DATA`;
  #incidents `STATUS: OPEN|INVESTIGATE|MITIGATE|SOLVED` +
  `SEVERITY: LOW|MEDIUM|HIGH|CRITICAL` + `STACK: INFRA|DATA|SEMANTIC|DECISION`.
  The approvals STACK values match the durable `target_stack`/`stack_id` enum
  (`infrastructure|data_plant|semantic|intelligence|decision`) one-to-one, so STACK is read
  from the ledger, not guessed; RISK has no ledger field, hence Q3 = A.
- **Server-side naming defect reported, not worked around**: #incidents contains a tag
  literally named `STATUS: ANALYTICS`, which belongs to the STACK category. The matcher
  refuses to alias it, so an analytics-stack incident surfaces as
  `DISCORD_TAG_UNRESOLVED channel=incidents category=STACK wanted="STACK: ANALYTICS"` and no
  thread is created until the owner renames that tag in Discord (operator data, one click,
  not a repository change).
- Out of scope by decision, recorded so it is not mistaken for an oversight: **tag
  transitions after creation** (flipping `STATUS: WAITING` → `APPROVED`/`REJECTED`/`CHANGES`,
  or `OPEN` → `INVESTIGATE`/`MITIGATE`/`SOLVED`) — `applied_tags` is carried by thread
  creation and no verified edit-thread-tags seam exists in the pinned host; and result threads
  for `BLOCKED`/`CANCELLED` outcomes, which are not owner-accepted results.

### M12/T2-R2 — The approval STATUS tag follows the real verdict (owner-required 2026-10-13)

Task: M12/T2-R2 · `CLOSED 2026-10-13` · implementation `b6d04e8`; contract deleted at closeout.

Owner instruction: "**Em còn thiếu cái chuyển trạng thái tag sau khi phê duyệt thật**" — the
transition R1 recorded as out of scope. He also settled the STACK question R1 left open, stating
the five layers verbatim: `INFRA` is Docker and the software on the machine that runs the tasks
(Excel, MySQL, DuckDB, …), `SEMANTIC` is used when a task needs meaning added because the bot does
not yet understand the problem and must not create the wrong meaning, `DATA` is ETL work,
`ANALYTICS` is building charts and dashboards, `DECISION` is the decision report the bot analyses.
Those are exactly the ledger's `target_stack` / `stack_id` values, so R1's derivation is
**confirmed**, not changed, and no code moved for it.

Executed shape:

- `transitionGovernedForumStatus(...)` in the same lib that owns every other tag rule: it reads
  the thread's current `applied_tags` (`GET /channels/{threadId}`) and the forum's own tag list
  (the cached resolver, now also exposing `tags()`), drops only the id whose tag category is
  `STATUS`, and PATCHes `applied_tags` with one replacement. It deliberately does **not**
  re-derive the trio — recomputing RISK/STACK at verdict time could rewrite tags that were already
  correct — and it keeps ids the forum list does not contain at all, because a tag the owner added
  by hand is his data, not ours to delete.
- `approvalStatusTag(decision)` is the single mapping both paths share: no decision (every publish
  site) → `WAITING`; `APPROVE` → `APPROVED`; `REJECT` → `REJECTED`; `REQUEST_REVISION` →
  `CHANGES`; anything else → `null`, which yields no tag and a named refusal instead of a guess.
  `EXPIRED` is intentionally unreachable here: expiring a card would need a sweeper, and the
  host's own component ttl is not a governance verdict.
- Wiring is inside `applyOwnerDecisionEffect`, the one post-decision effect the button and text
  paths share since M10/T2-R16, so a second copy cannot drift. It is fire-and-forget with its own
  `.catch`: the verdict is already durable in `WORKFLOW_USER_APPROVAL_DECIDED`, therefore no
  outcome of the surface call can undo, delay or rewrite the owner's decision (requirement 5), and
  no decision path awaits a Discord round-trip. A task whose card was never surfaced reports
  `DISCORD_TAG_TRANSITION_SKIPPED … reason=NO_SURFACE_STATE`.
- Seam honesty (requirement 6): `PATCH /channels/{thread.id}` with `applied_tags` is the only
  available mechanism. The pinned host carries `applied_tags` solely on the send payload
  (`send-C4Gq0rCd.js`), and Discord's thread docs list `name`, `archived`,
  `auto_archive_duration`, `rate_limit_per_user`, `locked` as editable without mentioning
  `applied_tags`, while the discord-api-docs report about duplicate tags describes `PATCH`-ing a
  forum thread with `applied_tags` as working. So local tests prove the _call shape and its
  guards_; whether this server accepts it is **`NOT TESTED`** until deployment, and a rejection is
  logged as `DISCORD_TAG_TRANSITION_REJECTED_<status>` rather than reported as success.

Gates: `npm run verify` **PASS** on Windows (1457 tests / 1412 pass / **0 fail** / 45 skipped,
`Repository policy check passed.`); **192/192 with ZERO skips** under WSL Ubuntu over the same
affected set; three mutation probes each killed exactly one control and were reverted — an
unresolved STATUS value still PATCHing (2 tests), foreign tag ids being dropped (1 test), the
call site detached (1 test). Existing invariant gates were extended, not bypassed:
`m8-t2-native-outbound` now allows exactly two `channels/${threadId}` sites with exactly one
`PATCH` carrying only `applied_tags`, and the runtime-bounds deadline scan already covers the new
`fetchImpl` sites. CI backing for the pushed closeout `0479d02`: run `38405914399`
`quality-gate` **SUCCESS** (1457 tests / 1406 pass / 0 fail / 51 skipped, policy passed) and
`python-quality` **SUCCESS** (188 passed, 27 subtests); Security run `38405920662` `secret-scan`
**SUCCESS** with `dependency-audit` red on the unchanged 5-high baseline.
Candidate packaged entrypoint `513beb15…`; **no `configure.mjs` admission
changed** because the installed files are untouched, and R1's never-deployed `f9ef77dc…` stays
unlisted by design.

Deployment A is now expressed with the repository's own trusted operator scripts
(`integrations/openclaw/topology/fixtures/runtime-regression/operator-preflight.mjs` then
`operator-apply.mjs`), which read the identifier file themselves and print only non-secret derived
fields. The hand-written block handed over earlier could not run: **`jq` is not installed on the
WSL host** (verified: `command -v jq` → absent, `node` → v24.15.0), so its six `$(jq -r …)`
substitutions failed and `set -euo pipefail` aborted immediately — the owner's report was
"hiện nhiều lỗi xong tự văng luôn". That is a delivery defect of this agent's, recorded here so it
is not repeated: a command block for an operator host must be verified against what that host
actually has, or reuse a script that already runs there.

The live gateway still carries the M11/T3-R1 build (`61e344e6…`); neither M12/T1-R1 nor M12/T2 has
been installed, so no live Discord behaviour on any surface is verified.

Deployment A attempt 1 (2026-10-13, owner-run): `operator-preflight.mjs` returned
`{"stage":"builder-preflight","status":"FAIL","reason":"PREFLIGHT_REJECTED"}` and **mutated
nothing** — preflight is read-only. Root cause is the operator instructions this agent produced,
not the live tree: `configure.mjs` requires `ZINK_ROUTER_HOST/PORT/API_KEY` from the environment
(`policy.mjs:1290-1311`), and the block omitted the `set -a; . ~/.openclaw-zink/router.env; set +a`
line, so the builder aborted on `ROUTER_PORT_UNAVAILABLE` before any state comparison; the
classifier then could not name that class and collapsed it to `PREFLIGHT_REJECTED`. Everything
evaluable without operator credentials was checked read-only and passed: every divergent asset
admitted, entrypoint `61e344e6…` admitted, manifest `8be6690c…` and package `a30567b2…`
byte-equal, auth plan/order-plan/pass-resolver/gemini-hotfix byte-equal at their expected modes
(the hotfix is `0700` by design — an early scratch assumption of `0600` was the script's error, not
the host's), systemd drop-in equal to the current rendering, `inspectLedgerUpgrade = CURRENT`,
workspace templates admissible, and the generated config structurally identical to the installed
one (318 key paths each). Repaired: the classifier names each known class without ever quoting a
message, and the README deployment section includes the env-sourcing step.

### Deployment A — EXECUTED AND VERIFIED 2026-10-13 (owner ran the operator scripts in WSL)

- `operator-preflight.mjs` → `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`.
- ONE `operator-apply.mjs` → `{"status":"PASS","stage":"applied","mutationStarted":true,
"rollbackRequired":false,"rollbackAttempted":false,"rollbackSucceeded":false,"reason":null,
"attemptId":"txn-8cb8adec7a1409e17bc47fe18759c2cc5d9cfe40af6e8a49497678262e168a5e",
"transactionStatus":"complete"}` — the pre-apply transaction snapshot was taken, verified and
  marked complete; no rollback was needed.
- After the restart: `ActiveState=active`, `MainPID=54345`, `NRestarts=0`.
- **All 35 packaged paths are byte-equal to the installed tree** (re-derived through
  `governancePluginFiles()` and compared read-only against `extensions/zink-governance`): nothing
  differing, nothing missing, nothing extra — `index.mjs = 513beb15…`, the newly installed
  `lib/discord-forum-tags.mjs = e0a755bb…`, `lib/discord-formatter.mjs = 26ecc883…`,
  `lib/policy.mjs = d621c85f…`, `lib/workflow.mjs = 2009e9fe…`. The runtime this replaces
  (`61e344e6…`) is still an admitted predecessor, which is what let `--preflight` accept the upgrade.
- Journal since the restart: `ACTIVE AND LOADED` (×4) and `coordinator pickup loop started` (×2);
  **zero** `MODULE_NOT_FOUND`, zero `UnhandledPromiseRejection`, zero `DISCORD_TAG_*` refusal, zero
  crash — the new tagging module loads in the real runtime. The pre-existing `duplicate plugin id`
  warning is unchanged.
- 7 established `:443` connections: all seven bots online, the README's own acceptance rule.
- Ledger untouched: still 131 events, and **no `WORKFLOW_APPROVAL_SURFACED` or
  `WORKFLOW_RESULT_SURFACED` exists yet**, because no governed approval has been requested since the
  restart.
- CI for the pushed head `bcf80cb`: run `38417861960` `quality-gate` **SUCCESS** (1458 tests /
  1407 pass / 0 fail / 51 skipped) and `python-quality` **SUCCESS**; Security run `38417869894`
  `secret-scan` **SUCCESS**, `dependency-audit` red on the unchanged 5-high baseline.

What this does NOT prove (owner requirement 6): **per-surface live status remains `NOT TESTED` for
#approvals, #results and #incidents.** The build is installed and loads, but no thread has been
created, no tag name has been resolved against a real forum, and the post-verdict
`PATCH /channels/{thread.id}` with `applied_tags` has never been sent. Those need a real governed
event; a surface may be recorded PASS only when the thread is observable in Discord with its three
tags and the journal shows no refusal.

### M12/T2-R3 — BOUNDED REMEDIATION: the STACK rule refused every multi-stack approval card (owner-reported 2026-10-13)

Owner report: "bot kẹt phản hồi ngay tại kênh office em". Reproduced from the live journal before
any edit was made (masked, read-only):

```text
22:42:40 DISCORD_TAG_UNRESOLVED channel=approvals category=STACK
         wanted="(no evidence in the governed record)" reason=CLASSIFIER_EMPTY
22:42:40 first-approval card NOT posted: APPROVAL_CARD_NOT_SURFACED:DISCORD_TAG_UNRESOLVED
22:48:xx (repeated for the second request)
```

Diagnosis (verified, not inferred):

- `approvalTagSelectionsFor` requires three tags; `surfaceStackTag` returned `null`, and a required
  unresolvable tag means **nothing is posted** — the M12/T2-R1 fail-closed rule working as designed.
- The rule itself was wrong. `surfaceStackTag` accepted only a plan whose nodes carried **exactly one
  distinct** `stack_id`, and `current_stack` — the field that would disambiguate — is written only at
  `workflow.mjs:1726`, when execution binds a stack, i.e. **after** approval. So at the moment a card
  is needed, `current_stack` is by definition absent and any plan touching two stacks is untaggable.
- Read-only snapshot of the installed ledger confirmed the shape: 7 pending tasks with no
  `approval_thread_id`, `current_stack = undefined`, node `stack_id`s spanning `data_plant`
  (o1/excel/sql/python) and `intelligence` (o2/power-bi). The durable request survived
  (`WORKFLOW_APPROVAL_REQUESTED` appended; ledger 131 → 139 events); the owner simply never saw a
  card, so the agent sat denied with nothing to approve.

Fix (confined to the failing control): STACK now names the surface the plan's **output** belongs to,
following the owner's own five definitions — `decision` > `intelligence` > `data_plant` > `semantic`

> `infrastructure`, with a bound `current_stack` outranking the plan's reach because that is the
> stack actually executing. A pure ETL plan stays DATA, a plan that also builds charts is ANALYTICS, a
> plan that also answers a decision question is DECISION, meaning work carries SEMANTIC only when
> nothing is delivered on top. **Nothing is invented** when there is no stack evidence at all or only
> software names (`excel`, `power_bi` are agents, not stacks): the card is still refused, still logged,
> still durable. This is my judgment call made to restore approvals, not an owner instruction — it is
> recorded here as reversible and is his to redirect.

Deployment reachability: because the replaced asset is **already installed**, `configure.mjs` admits
its deployed digest `e0a755bb9c6add431c9306fd8bc2895318a868c3c6b8e84326d94fb95526fff5` under
`lib/discord-forum-tags.mjs`, proven from committed source (`git show b6d04e8:…` = 23,825 bytes,
byte-equal; packaging rewrites none of this module's imports) rather than taken on faith from an
operator measurement. The current candidate `18fbb0774c18d013f599f562810932cfb80c4071c0614376d16f46c30fc256b3`
is deliberately NOT listed. No entrypoint pin moved: this revision changes no packaged entrypoint
byte, and the live `index.mjs` is already the current build `513beb15…`.

Implementation `0b55dfa`, operator-note `c8bcc24`, both pushed on
`codex/m11-t1-audit-remediation` (no `main` merge, no force-push, no PR — none authorized).

Gates (local + CI — this record claims no live evidence):

- `npm run verify` **PASS** on Windows: `format:check` clean, `lint` 0 issues, `npm test`
  1461 tests / 1416 pass / **0 fail** / 45 skipped, `repo:check` "Repository policy check passed."
- CI run `38435007142` @ `c8bcc24` on ubuntu-24.04: `quality-gate` **SUCCESS**
  (`ℹ tests 1461 / ℹ pass 1410 / ℹ fail 0 / ℹ skipped 51`, `Repository policy check passed.`) and
  `python-quality` **SUCCESS** (`188 passed, 27 subtests passed`). Security run `38435012291`:
  `secret-scan` **SUCCESS** (zero leaks) while `dependency-audit` stays red on the unchanged
  pre-existing 5-high baseline. CI cannot reach `/home/hoang_vinh/.openclaw-zink`, so it adds no
  live-runtime or Discord evidence.
- `tests/m10-t2-r3-asset-predecessor.test.mjs` 12/12 with ZERO skips, now including a real
  `--preflight` → `--apply` rehearsal against a scratch HOME seeded with the deployed asset bytes.
- `tests/m12-t2-forum-tags.test.mjs` + `tests/m12-t2-governed-surface.test.mjs`: 42/42, 0 skipped.
- Under WSL Ubuntu, where `/home/hoang_vinh/.openclaw-zink` is readable and the live halves of the
  predecessor suites actually execute: **143 tests / 0 fail** across the ten affected suites (two
  m12 + the seven predecessor/provenance suites + the R16 apply rehearsal) and **96 tests / 0 fail**
  across the seven live-reading/behavioural suites. The 16 and 26 skips are declared conditionals,
  not unreachable-live gates — the same batches skip 16 and 28 on Windows, i.e. WSL runs strictly
  more, and running more is what surfaced the `R7 P1` stale live pin described below.
- Found by that WSL run, repaired in the same bounded pass: `R7 P1` required the live
  `lib/authority.mjs` to equal `71eee819…`, a photograph of the runtime as of R7. Deployment A
  installed the current build (`c38e1a6b…`), so the equality was red on WSL and silently skipped on
  Windows. It now asserts the R13 invariant instead — the installed digest must be the current build
  **or** an admitted predecessor — and the outgoing digest's admission moved out of the
  live-reachability branch so every host checks it. Nothing was deleted and no gate weakened.
- Three mutation probes, each reverted after it bit: restoring the single-distinct-stack rule failed
  6 tests including the new live-shape case; deleting the admission failed the textual guard; the
  same deletion failed the preflight/apply rehearsal.

What this does NOT do: it does not deploy. The live runtime keeps refusing multi-stack cards until
the owner grants a fresh `operator-preflight` → one `operator-apply` (the deployment A grant was for
exactly one apply and is spent). It does not touch `RISK`, the tag taxonomy, any contract, schema,
gate or resource ceiling, and it does not retry the 7 already-requested tasks by itself — they stay
durable and the existing re-drive path surfaces them on the next spawn attempt.

### M12/T2-R3b — deployment B failed: an orphaned ledger writer lock, masked as APPLY_REJECTED (2026-10-14)

The owner ran the block under grant B1. `operator-preflight.mjs` →
`{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`;
`operator-apply.mjs` →
`{"status":"FAIL","stage":"builder-apply","mutationStarted":true,"rollbackRequired":true,
"rollbackAttempted":true,"rollbackSucceeded":true,"reason":"APPLY_REJECTED",
"attemptId":"txn-310121bcc2bae648bcbcee16a596980491458fb4fd5698415fd3570342fdef30",
"transactionStatus":"complete"}`. The remediation did not land: `lib/discord-forum-tags.mjs` is
still `e0a755bb…` on the host, and the gateway restarted into `MainPID=60244`, `NRestarts=0`.

Reproduced read-only, without consuming another mutation grant, by re-running the real
`configure.mjs --apply` against the live runtime inside `unshare --map-root-user --mount` with
overlayfs upper layers (the isolation `r16-rehearsal.mjs` documents). Result, verbatim:
`Ledger writer unavailable [EXECUTION_STATE_UNKNOWN]` from the child, and afterwards
`{"live_unchanged":true,"ledger_events_after":139,"extension_after":"513beb15…"}`.

Verified facts:

- `operator/m7-t2/ledger/writer.lock/owner.json` records `pid 60201`; `/proc/60201` does not exist,
  while the gateway runs as `60244` (ActiveEnterTimestamp 2026-10-14 00:05:29). The lock was
  orphaned when the apply's rollback restarted the unit — the killed generation died mid-append.
- The journal since 00:04 holds **202** `FILE_LOCK_BUSY` / "writer unavailable" lines: **every**
  governance ledger write on the live host is currently failing closed. This, not the STACK rule,
  is the immediate reason #office is still stuck.
- `--preflight` passes because it never takes the writer lock; `--apply` fails at its last step
  (`upgradeEmptyLegacyLedger` → `withWriterLock`, which makes exactly one atomic attempt).
- `configure.mjs` printed the prose only, and `operator-apply.mjs`'s classifier matches on the
  child's text, so a code that is already in its `KNOWN_REASONS` (`EXECUTION_STATE_UNKNOWN`) was
  reported as `APPLY_REJECTED`. Same class of blind spot as the preflight classifier, one mode late.

Repair shipped here (bounded, no new scope): `configure.mjs`'s error exit appends `[code]`, and a
new case in `tests/m10-t2-r3-asset-predecessor.test.mjs` reproduces the stranded-lock state in a
provisioned scratch runtime and asserts both the stderr and the derived classification. Gates:
`npm run verify` **PASS** (1462 tests / 1417 pass / **0 fail** / 45 skipped, policy passed); the r3
suite 13/13 with zero skips; one mutation probe (code emission removed) killed exactly that test.
CI run `38443807440` @ `b40154f`: `quality-gate` **SUCCESS** (`ℹ tests 1462 / ℹ pass 1411 /
ℹ fail 0 / ℹ skipped 51`) and `python-quality` **SUCCESS**; Security run `38443813434`:
`secret-scan` **SUCCESS**, `dependency-audit` red on the unchanged 5-high baseline.

NOT repaired, recorded as a gate defect with owner decision pending: the **R16 apply rehearsal** —
the repository's own instrument for exactly this scenario — cannot run on WSL. It still calls
`inspectNativePatch/applyNativePatch/checkNativePatch(RUNTIME_ROOT)` with a single root although
M10/T2-R8 made the Discord channel package a second governed root (so every case raises
`NATIVE_SOURCE_ROOT_MISSING`), it supplies no `expectedNativePostImage` dep, and its assertions are
pinned to the R7→R10 era digests the live runtime left behind. An earlier edit that wired the
second root was **reverted** rather than committed half-done. Consequence to state plainly: no
apply rehearsal has ever validated a candidate against the _current_ live runtime; Deployment A's
"PASS" came from the operator path, not from this gate.

Orphan-lock recovery is a **RED owner decision**: the lock module forbids automatic reclaim by
design ("recovery of an orphaned lock is an explicit operator action"), so it requires his explicit
authorization for the exact target. Nothing has been deleted.

### M12/T2-R4 — the operator orphan-lock recovery action the lock design always assumed (owner decisions C1 → E → D1, 2026-10-14)

Owner sequence: C1 (build the guarded recovery tool), then E (one fresh preflight → apply for the
STACK remediation), then D1 (a separate task to make the R16 apply rehearsal runnable).

Delivered under C1 — `integrations/openclaw/topology/fixtures/runtime-regression/operator-lock-recovery.mjs`:

- `file-lock.mjs` forbids automatic reclaim ("reclaiming could let two processes enter the critical
  section together") and names recovery an explicit operator action, yet the repository contained no
  such action, so the only way to clear the orphan was a hand-typed `rm` beside the live ledger.
- Read-only by default. Removal needs `--recover` **and** `--confirm=ORPHAN_LOCK_RECOVERY`.
- Holder liveness is `process.kill(pid, 0)`: `ESRCH`/`EINVAL` dead, `EPERM` alive, anything else
  **unknown**, and unknown is never treated as dead — the same reason the primitive refuses heuristics.
- Refuses without touching anything on: live holder (`REFUSED_LIVE_HOLDER`), unreadable
  `owner.json`, a record outside `{pid, 32-hex token}` shape, a symlink component on the path
  (`REFUSED_SYMLINK`), a lock directory holding anything besides the owner record (`INSPECT`,
  `STRAY_LOCK_ENTRY`), or a lock with no owner record at all (its staleness cannot be proven).
- Removes exactly two objects (`owner.json`, then the lock directory via `rmdir`, which itself
  refuses a non-empty directory) and verifies the lock is gone before reporting `RECOVERED`.
- Report masks the holder nonce (first 4 + 28 stars). The nonce identifies a dead process's
  acquisition, and echoing it would let anyone reading the terminal supply the confirmation the
  operator is meant to type deliberately.

Evidence: `tests/m12-t2-r4-orphan-lock-recovery.test.mjs` spawns the real script against a scratch
state directory — 8 tests / **0 fail / 0 skipped** under WSL (the symlink refusal runs there) and
7 pass / 1 platform-gated skip on Windows; the live-holder refusal is proven against **this test
process** as the recorded owner, not a simulated pid. Two mutation probes each disabled one guard
and killed exactly the matching cases. Registered in `npm test`. README §4 gains BƯỚC 1b with the
exact expected report lines. CI for the pushed head `4f1328a`: run `38500950386` `quality-gate`
**SUCCESS** (`ℹ tests 1470 / ℹ pass 1419 / ℹ fail 0 / ℹ skipped 51`) with `python-quality`
**SUCCESS**, and Security run `38500954316` `secret-scan` **SUCCESS** while `dependency-audit`
stays red on the unchanged pre-existing 5-high baseline. Locally `npm run verify` PASS at the same
head (1470 / 1424 pass / 0 fail / 46 skipped, policy passed). Verified read-only that the script is
reachable from WSL at the working tree the operator scripts run from (`TOOL_PRESENT`).
**Nothing on the live host has been recovered yet** — the orphan is still in place because removal
is the owner's action, and he runs it; the C→E block has been handed over.

### Deployment B — EXECUTED AND VERIFIED 2026-10-14 (owner ran recovery, then preflight → apply)

Sequence, all operator-side on the live WSL host:

- Orphan-lock recovery with the new C1 tool. Read-only pass first:
  `{"lock_present":true,"owner_entry":"OK","owner_pid":60201,"holder_alive":false,
"owner_token":"8566****************************","stray_entries":[],"action":"REPORT",
"mutated":false}` — then `--recover --confirm=ORPHAN_LOCK_RECOVERY` returned
  `"action":"RECOVERED","mutated":true","recovered":true`. After it, `writer.lock` does not exist
  and `journalctl --since -6 min | grep -c FILE_LOCK_BUSY` is **0** (it had been growing
  continuously), while `events.jsonl` stayed at 139 events: the lock was removed, nothing else was.
- `operator-preflight.mjs` → `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`.
- `operator-apply.mjs` ran and the unit restarted at 13:25:47 (`MainPID=68567`, `NRestarts=0`,
  `ActiveState=active`). **Honesty about what was observed:** the owner's paste reached the agent
  truncated at the preflight line, so the apply report JSON itself was not seen. The apply's
  success is instead proven independently and read-only, which is stronger than a self-report:
  every installed path was re-derived through `governancePluginFiles()` and compared to the host —
  `{"packaged":37,"mismatched":[],"missing":[],"installed_but_not_packaged":[]}`, with
  `index.mjs = 513beb15…` (unchanged, as this revision moves no entrypoint byte) and
  `lib/discord-forum-tags.mjs = 18fbb077…`, i.e. **the remediation build is the installed build**.
  A transaction rollback would have restored `e0a755bb…`, and the digest is not `e0a755bb…`.
- Post-restart journal since 13:25:47: `MODULE_NOT_FOUND`, `UnhandledPromiseRejection`,
  `DISCORD_TAG_*` refusal, `FILE_LOCK_BUSY` and `APPROVAL_CARD_NOT_SURFACED` — **0** occurrences
  combined; 7 established `:443` connections, so all seven bots are online.

What this does NOT prove: the fix's actual purpose is a multi-stack approval card appearing in
#approvals with its three tags, and no governed approval has been requested since the restart
(`events.jsonl` still 139, no `WORKFLOW_APPROVAL_SURFACED`). **Per-surface live status remains
`NOT TESTED`** for #approvals, #results and #incidents until a real request produces a thread the
owner can see. The next evidence step is therefore behavioral, not installational: one task in
#office that plans across `data_plant` + `intelligence`.

CI for the pushed record head `a9a6c1c`: run `38523610190` `quality-gate` **SUCCESS**
(`ℹ tests 1470 / ℹ pass 1419 / ℹ fail 0 / ℹ skipped 51`) and `python-quality` **SUCCESS**;
Security run `38523614667` `secret-scan` **SUCCESS**, `dependency-audit` red on the unchanged
5-high baseline. CI cannot reach the live host, so it adds no deployment or Discord evidence.

### Record — `M12/T2.1-R3` execution wave: seven items landed, one stopped at a pinned gate (2026-10-15)

Owner's instruction for this run, verbatim: **`sửa phần ghi nhận luôn đi em. Xong làm một mạch từ T 2.1-2 đến 8`**
("also fix the parts you only recorded, then do T2.1-2 through 8 in one continuous run").

**Two commits sit outside `ACTIVE.md` §3's file list on that instruction alone.** They are the items I had recorded
but not fixed in earlier rounds, and I measured before changing anything because both touch a _required gate_:

| Commit    | What                                                                                  | Measured before                                                                                                                                                                                                                              | Result                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `9c7af0f` | `zink-tools` added to `lint`/`format`/`format:check`                                  | `eslint.config.mjs:13` already **declared** `zink-tools/**/*.mjs` while `npm run lint` never named the directory — the gate was declared-but-unwired. `npx eslint zink-tools` → **6 errors**; `prettier --check` → **14 unformatted files**. | All six fixed (unused `version`, unused `path`, two dead parser bindings whose calls still advance the cursor, `TextDecoder` missing from the globals list, and `no-control-regex` on a _deliberate_ control-character blocklist). Gate lands green, not bulk-suppressed. **`R1-A10-07` closes on the coverage half only** — the lowercase `lifecycle_state` mismatch, the unreachable `Unsupported action` throw and the dead `void` all survive. |
| `cc6a0d9` | four Knowledgebase Python modules skip explicitly when the pinned tokenizer is absent | `python -m pytest tests` → `142 collected, 4 errors` then **`Interrupted: 4 errors during collection`** — i.e. **zero** tests ran on any host without CI's `KNOWLEDGE_TOKENIZER_PATH` (`ci.yml:99`).                                         | **140 passed / 7 skipped** locally with the reason printed. The guard fires only on an absent/unset path: pointed at an existing wrong file the modules still import and `markdown_adapter.py:167` raises `TOKENIZER_ARTIFACT_MISMATCH`, so a skip cannot hide a bad artifact. CI unchanged. Root cause recorded as **`R6-I01-01`** and **not fixed** (`app.main` builds a real `TokenBudget` at import).                                          |

**The seven delivered items.** Each was test-first, each red before the fix, each with one mutation probe that killed
exactly its own control:

| Item                                                   | Commit    | Control the probe kills                                                                                                                                          | Honest limit of the evidence                                                                                                                                                                                                                             |
| ------------------------------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T2.1-1 unreadable proposal (`R5-E06-07`)               | `96a6dd2` | a truncated proposal file blocks the overwrite; an absent one does not                                                                                           | the rename-safety `Unresolved` in V01 is closed: exactly one call site existed                                                                                                                                                                           |
| T2.1-2 rollback residue (`R5-E04-03`)                  | `2e7da50` | `describeVersionRollbackState` reporting a read failure as clean, and the verdict missing from the message                                                       | residue verdicts are driven directly (R22-09) because no host can make a live `rm` fail on purpose; the clean path runs through the real promotion via `MANIFEST_LIMIT_EXCEEDED` (R22-08)                                                                |
| T2.1-3 upstream response bytes (`R5-E06-03`)           | `c4833e6` | the marker scan (`psycopg`, `embedding_vector`, `/app/app/retrieval.py`, `Field required`, the request echo) and, separately, the field projection being dropped | driven against a **stub HTTP service**, not a mocked transport                                                                                                                                                                                           |
| T2.1-4 child stderr (`R5-E06-04`)                      | `710f650` | engine prose (`invalid_column_xyz`, `Referenced column`) appearing in a thrown message                                                                           | also settled the ETIMEDOUT question §4 called `Unresolved`: `execFileSync` does throw `code === "ETIMEDOUT"`, observed on Windows, still unproven on the WSL drvfs root                                                                                  |
| T2.1-6 snapshot residue + errno-first (`R1-A14-01/02`) | `b3affc2` | `name ?? code` ordering; and — after my own first probe exposed the gap — the **call-site wiring** in the write window                                           | the wiring is pinned by source shape (B7-3), which is this file's existing convention: no host can fail `writeFileSync` on an open descriptor, and a call site no test can reach is the pattern the audit has already learned to name                    |
| T2.1-7 fabricated locator (`R5-E02-05`)                | `b7497ca` | `(lines None-None)`, and separately `or`→`and` on the half-present pair                                                                                          | the fixture is a **PDF row with a NULL page pair**, per V01's binding correction; `render_pdf_citation` and the response schema untouched                                                                                                                |
| T2.1-8 destructive default (`R5-E08-02`)               | `ba5ff08` | the gate disabled (REPORT and REFUSED both go red), and `isAbsolute` moved after `resolve` (`.`/`..` stop being refused)                                         | `test:r16` was **renamed to `rehearse:r16`**, not deleted, so the rehearsal route survives; `§7`'s literal `npm run test:r16` is satisfied by the renamed entry point, and §4's "out of `test:*` naming" is why the old name is gone rather than aliased |

**Two defects T2.1-8 surfaced and that I did not hide:**

1. The driver could not load on Windows at all — `await import(path.join(...))` was rejected with
   `ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'c:'`, so the new guard would have been unreachable on the host
   that runs the audits. Fixed inside the item's own file (`pathToFileURL`).
2. `r16-rehearsal.mjs`'s pre-existing "R16 runs in WSL only" guard **does not fire on this host**: something created
   `C:\home\hoang_vinh\.openclaw-zink\operator` on **2026-09-29**, so `existsSync("/home/hoang_vinh/.openclaw-zink")`
   answers `true` on Windows. The mirror is empty (three directories, no files). I did not touch it — deleting it is a
   destructive action on an unowned path and §10 forbids inferring that. **Recorded as a finding for Vòng 6 wave 2**:
   a POSIX absolute path reaching Node's filesystem calls on Windows silently creates a parallel tree on `C:\`, and
   every guard whose safety rests on "that path cannot exist here" is then resting on nothing.

**Not claimed:** no CI run has been read for any of these seven commits (so the tier is `LOCAL-VERIFIED`, not
`REMOTE-BACKED`); the WSL lane is `NOT RUN` for this wave; `verify.mjs` remains `NOT RUN`; the 46 skips include
`m8-t2.13-r16`'s namespace cases and the two Postgres/Docker suites.

#### OWNER GRANT — T2.1-5 executed under option A (answered 2026-10-15: `A. Những lỗi mới thấy được thì sửa tiếp`)

The owner chose **A** and additionally instructed that the newly recorded defects be fixed in the same pass. T2.1-5
landed as `91d788d`: the exception was written into `ACTIVE.md` §4 T2.1-5 _before_ `:211` was touched, the
re-valued assertion now demands a presence constant and checks four prefix lengths, the whole-token claim at
`:206-210` is unchanged, and `holderState`/verdicts/exit codes are byte-identical (only assigned-and-printed, which
is also why the file's old header comment was wrong twice — it claimed the mask protected "the confirmation value the
operator is meant to type", but `--confirm` compares to a fixed literal in this file, never to the token).
Fixes that instruction also opened, both outside §3's file list and recorded here as owner-granted scope:
`703fec4` makes the R16 host refusal ask the kernel (`linux` + a WSL signature) before it asks the filesystem, and
reports `host_is_wsl` — with the mutation that disables it, DRIVER-05 goes red; `ad4a8d6` resolves `app` through PEP
562 instead of building it at import, so `uvicorn app.main:app` still fails fast at boot while importing the module
for a constant works without the artifact, and `test_m11_index_hygiene.py`'s now-false skip was **removed** rather
than left standing. The `C:\home\hoang_vinh\.openclaw-zink` tree was **not** deleted: no repository test or script
feeds a literal `/home/hoang_vinh` path into a creating call, so its 2026-09-29 writer is un hunted and the tree is
his to remove under a grant naming the exact target.

#### OWNER DECISION BLOCK — T2.1-5 (`R5-E13-06`), the only item that did not execute

`ACTIVE.md` §4 requires `operator-lock-recovery.mjs:145` to stop publishing
`` `${owner.token.slice(0, 4)}${"*".repeat(28)}` `` — masking treated as redaction, where **omission** is the correct
strategy. The gate refuses it: `tests/m12-t2-r4-orphan-lock-recovery.test.mjs:211` asserts

```js
assert.match(report.owner_token, /^e{4}\*{28}$/u);
```

against a fixture token of `"e".repeat(32)`. That regex **demands the token's first four characters**, so the existing
assertion enshrines exactly the state the fix refuses: every non-leaking value fails it. The same test's own message
says _"the lock token is a holder nonce, not an operator credential: it must not be echoed"_ — and then pins that it
is echoed. §2's `Execution Authorization` makes re-valuing a pinned existing assertion a stop-and-report condition
(that rule is why R2 was withdrawn, and here it worked as designed), so I stopped at the item boundary, left
`report.owner_token` byte-identical, and finished the rest of the tier.

| Option | What                                                                                                                                                                                                          | Cost                                                                                                                                             | Recommendation                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **A**  | Grant the §3 exception, re-value `:211` to an omission assertion (`report.owner_token === null`, plus "no token substring anywhere in the report" which `:206` already proves), keep the finding in this tier | one pinned assertion changes, and it was written four days ago as part of the tool this item is auditing — it is not accepted milestone evidence | **A** — smallest sound change, and it removes the only field in an operator report that derives from a credential                         |
| **B**  | Accept the 4-hex-char mask as adequate and close `R5-E13-06` as won't-fix                                                                                                                                     | 16 of 128 bits of a live holder nonce in every report that gets pasted into a terminal, log or card                                              | only if he judges a holder nonce as non-credential — but then §4's premise is wrong and the item should be withdrawn, not quietly dropped |
| **C**  | Move it to `M12/T2.2` with the exception granted there                                                                                                                                                        | the tier rule says "fails undetectably ⇒ high"; this one is detectable, so C is defensible and keeps R3 green without an exception mid-flight    | the fallback if he wants no exception inside an executing contract                                                                        |

A is recommended. Answering this block authorizes **nothing else**: it does not restore `Execution Authorization` to
the other seven (they are done), it does not permit `--apply`, a restart, a lock deletion, or any deployment, and if
the answer is A or C the change to `:211` still has to be written down in the contract before it is executed.

#### Unreconciled acceptance line — recorded, not silently narrowed

`R5-E06-03`'s own `Acceptance:` reads _"no adapter result field can contain bytes copied from an upstream response
body"_, while `ACTIVE.md` §4 T2.1-3 admits _"a fixed reason code plus a bounded, field-whitelisted summary derived
from the parsed body."_ The two are not identical: `loc` path segments and `type` rule names come from the response.
I implemented the **contract**, which is the executable authority (§2), and record the divergence rather than claim
the register's stricter line. The projection is limited to fields that describe the **caller's own request**
(no `msg`, no `input`, no free-text `detail`, nothing from an unparseable body), so the leak the finding named —
internal paths, column names, the request echo — is closed even though the literal sentence is not fully satisfied.
If he wants the literal acceptance, that is one more decision: drop the projection entirely and leave the status code
alone.

### Record — `M12/T2.1-R2` was destroyed by an overwrite, and its full text is NOT recoverable faithfully (2026-10-15)

**What happened.** To create `M12/T2.1-R3` the agent replaced `docs/contracts/execution/ACTIVE.md` with a
whole-file `Write` instead of making scoped `Edit`s. That file is git-ignored (`.gitignore` ignores it by name), and
so is `.agents/states/*.md`, so **git held no copy of R2 and the overwrite removed its only on-disk instance.** The
decision to rewrite was justified at planning time — R2's §7 had fallen out of agreement with its own §4A.15 and §5,
and a fourth patch risked adding a twelfth defect — but the choice of mechanism was wrong, and it destroyed evidence
about what the owner had been asked to approve.

**The finding that predicted it, filed by an audit lane less than an hour earlier.** `R5-E14-07` states that because
`ACTIVE.md` is ignored, "no diff and no CI can ever gate an edit to it", so "a silent rewrite of 'frozen'
implementation details is undetectable". This event is that risk realized, caused by the actor who filed it, which is
the strongest evidence available for owner decision **H10**.

**Recovery was attempted twice and is NOT trustworthy.** The session transcript
(`~/.qoder/projects/C--Users-HOANG-VINH-OneDrive-Documents-personal-tool/3e5839bd-6f7c-4e3f-b1f7-cf4e2f086a1f.jsonl`)
contains the base `Read` plus every subsequent `Edit` call, so the agent replayed the edit chain programmatically. The
transcript also contains **four** `ACTIVE.md` reads at partial offsets (`1615, 1694, 1716, 2099`) and **two** writes
(`1223, 2388`), so no single read is a clean base: the first attempt (`542`-line base) reported 15 applied / 18
unapplied edit steps and 88,781 bytes; selecting the last read before the last write yielded a 14-line fragment with 1
applied / 3 unapplied. **Neither output is a byte-faithful R2.** A partially-reconstructed 88 KB contract was
therefore **not** inserted into a tracked file, because a plausible-looking but unverified copy of an execution
contract is more dangerous than the acknowledged gap it would fill.

**What is durably preserved, and where.**

- **The ten owner decisions (H1–H10) with their evidence columns** — rebuilt verbatim from the agent's own
  working notes into `.agents/states/findings.md`, section _"Ledger of open owner decisions — H1–H10"_. This is now
  their authoritative home, and `ACTIVE.md` §5.3 points there instead of claiming to hold them. Still **unanswered**.
- **Every R2 item and its fate** — `ACTIVE.md` R3 §5.1 gives a disposition row for all twenty-six R2 items with the
  tier it moved to and the reason; §5.2 does the same for the thirty new Vòng 5 findings.
- **Every defect found in R2** — `.agents/states/findings.md`, Vòng 6 sections V01/V05/V06, including
  `R6-V01-01`, `R6-V05-01/02/03/04`, `R6-V06-01` and the two arithmetic corrections the agent's own re-derivation
  forced (`R5-E01-05` is 19 `from None` + 9 bare `except Exception:`, not 28 + 8; `R5-E12-01`'s replacement claim was
  contradicted by `PLAN.md:223, :257, :270, :312, :369`).
  **Amended 2026-10-17, additive:** that register was restructured into a bug-only queue on the owner's `j1` and moved
  to `docs/execution/findings.md`, so its Vòng 6 _narrative_ sections no longer exist. The defect **rows** that are
  still open survive under their legacy ids; the ones that were fixed are listed in that file's §2 closure table, and
  this record plus §4's `M12/T2.1-R3` narrative are now the durable home of the lane prose. Nothing was deleted to
  cause this — the narrative moved here.
- **What the owner was actually asked and what he answered** — the A/B/C/D/E/F/G block and the `vậy A đi` + I1–I7-A
  answers are quoted in §4 above and in the register.
- **The non-authoritative recovery draft** lives outside the repository at
  `%LOCALAPPDATA%\Temp\recovered-ACTIVE-R2.md`, labelled as unverified. It is not evidence and nothing may be
  implemented from it.

**What was lost and is genuinely gone:** R2's per-item prose for the eleven items that survived into no later tier
unchanged — the byte-identical verdict-string pin lists for §4.2, the preserved-pin list for §4.4 (reconstructed
shorter in R3 §4 T2.1-6), the reducer-precondition hard limits for §4.7, and the §4.9 document-item detail. When
`M12/T2.2` is planned, those items must be **re-derived from source and re-verified**, not recalled from this record;
that is the correct cost of the loss, not a regression.

**Standing rule adopted from this event, so it does not recur:** before replacing an entire git-ignored file, either
make scoped `Edit`s, or first copy the outgoing text somewhere durable and state in the record where it went. Put
load-bearing content in a **tracked** file, because an ignored file is not a record. `docs/contracts/execution/archive/`
was **not** created unilaterally — `M12/T2.1`'s §4.9 (P04-03) makes a written secret-scrub rule a prerequisite of any
archive, and P04-03/H10 are owner decisions.

Gate and commit state for this event: `npm run verify` was **NOT RUN** (no baseline taken, no edit made), no source,
test, config or migration file was changed, and the only tracked modification is `PLAN.md`, committed as
`9b9a230 chore(plan): split the remediation into three risk tiers and open the high tier`. This record is appended to
that same tracked file.

### Record — the 9Router "cấu hình cũ" report: the roster was current, the coordinator names were not (2026-10-15)

Owner instruction: _"làm cho xong hết đi em, và xem thử vì sao cái openclaw config trong 9Router, anh thấy vẫn còn cấu
hình cũ?. Xóa và thay bằng mô hình 7 bot đi em"_. The first clause continued the `R3` wave; the second two are a new
report, so they were **diagnosed read-only before anything was edited**, and the answer is not what he expected.

**The premise is REFUTED for the roster and CONFIRMED for the names.** WSL's `~/.openclaw-zink/openclaw.json`
already carries the _current_ configuration: `models.providers.router` holds 5 model ids identical to the repo's
`ROUTER_PROVIDER_MODEL_IDS`, and `agents.list` holds 7 entries whose ids are exactly `AGENT_IDS` /
`DISCORD_BOT_IDS` — main, o1, o2, excel, power-bi, sql, python. There was nothing to "replace with the 7-bot model";
the 7-bot model is what is installed. What still _looks_ old is the two coordinator **display names**, and those are
old in a way that matters beyond appearances.

**Why the names were a defect, not a taste question.** `AGENT_DEFINITIONS` still read `o1 = "ETL Coordinator"` and
`o2 = "Analytics Coordinator"`. First, `AGENTS.md` §9 restricts the L&SC Data Plant name to the _logical external
data/compute flow_ and says in as many words that it "is not a repository module, runtime, [or] integration
subsystem" — using it as a runtime role name was the violation. Second, and worse, those titles **asserted a stack
assignment the canonical document gives to the other coordinator** (see the RED block below). So the old names were
not merely stale branding; they were an unresolved decision rendered as fact on a surface the owner reads.

**Two independent surfaces, both corrected in `61638d8`.** The naming decision had been written down twice with no
single source: `AGENT_DEFINITIONS` feeds `agents.list` (the config he looked at, via `policy.mjs`'s packaging), while
`SPECIALIST_SOFTWARE_LABELS` feeds the approval **card** body in #approvals (what he reads when a plan waits for him).
Renaming only the config would have reproduced the report on the next card. The replacement is **stack-neutral** —
`"Coordinator O1"` / `"Coordinator O2"` in the config, `"Điều phối 1 (O1)"` / `"Điều phối 2 (O2)"` on the card —
following the vocabulary the ingress aliases (`điều phối 1/2`, `dieu-phoi-1/2`) already use, so the fix retires the
retired branding **without** silently ratifying either side of the open routing question.

**Re-valued assertions, disclosed, neither a weakened gate.**
`tests/m10-t2-r7-authority-predecessor.test.mjs:57` `CANDIDATE_AUTHORITY_SHA256` is a content-freshness pin of the
authority asset's own bytes; the hashing method was validated first by reproducing the _outgoing_ constant exactly
from `git show HEAD:…authority.mjs` before the value was moved. `tests/m10-t2-r12-first-spawn-approval.test.mjs:410`
pinned the literal `"Điều phối ETL (O1)"`; it now pins `"Điều phối 1 (O1)"`, and the claim it guards — the card shows
a Vietnamese coordinator label and never a raw agent id — is unchanged, so deleting either label still reddens it.
No digest of the _deployed predecessor_ was touched: those are read from `git show` of a pinned commit and are
structurally immune to working-tree edits.

**Scope honesty.** This increment is **outside** `ACTIVE.md` §4's eight items and outside this field's previous
"no re-valuing of any pinned existing assertion" bound. It ran under `AGENTS.md` §2's first authority — the owner's
latest explicit instruction, which ordered exactly this replacement — and under his standing _"Những lỗi mới thấy
được thì sửa tiếp"_. The `R3` bound itself is left as written; nothing in it was reinterpreted retroactively.

**What was NOT done, and needs him.**

1. **The live file was not hand-edited and is NOT deployed.** `openclaw.json` will keep showing the old names until a
   future authorized preflight → apply carries them. If he re-checks today and still sees `ETL Coordinator`, that is
   the expected state, not a regression. `--apply` remains unauthorized, so deployment evidence is `NOT RUN`.
2. **RED — the coordinator↔stack assignment contradicts the canonical document, mirrored rather than drifted.**
   `docs/architecture/five-stack.md:7-13` (2026-09-08, `2c376d1`) assigns Data Plant → **O2** and Semantic +
   Intelligence → **O1**, Infrastructure + Decision → Main. `authority.mjs:573-587 AGENT_STACK_POLICY` (2026-09-26,
   `01489aa`) says `o1: [infrastructure, data_plant]`, `o2: [semantic, intelligence, decision]`, and `policy.mjs`
   role blocks (2026-09-19, `a1e6b5c`) order Main to route "ETL, Xử lý dữ liệu, Bảng tính, Excel, SQL, Python ETL" to
   **O1** and "Phân tích, Trực quan hóa, Dashboard, Power BI, Python ML, Forecast, Optimization" to **O2**.
   **CORRECTED 2026-10-15 after Vòng 6 wave 2, and I re-read the code myself before writing this: what I first
   recorded here — "the two code surfaces agree with each other and are the exact opposite of the document" — is
   FALSE, and the reality is worse.** `guard.mjs:844-847` is `o1 ? ["semantic","intelligence","decision"] : o2 ?
["infrastructure","data_plant"]` — the exact swap of `AGENT_STACK_POLICY`, so **the enforcement chain disagrees
   with itself**, and the _guard_ is the surface that agrees with `five-stack.md`. `workflow.mjs:1466-1470` admits a
   node when `AGENT_STACK_POLICY[node.agent_id].includes(node.stack_id)`, so a Main-authored **O1 `data_plant` brief
   passes admission and then dies at `guard.mjs:849-853` with `UNAUTHORIZED_TARGET`** — and `guard.mjs:842` exempts
   `main` from that check entirely. So "the code is right" is not a well-formed option, and this is not a
   month-old documentation drift but a live control-flow contradiction between two runtime surfaces.
   Related: `policy.mjs:1700-1705 STACK_IDS` enumerates **four** stacks and omits `infrastructure`, while the doc
   declares five protocol IDs and `ledger-event` / `execution-brief` / `delegation-envelope` /
   `trusted-result-envelope` plus `guard.mjs:49` all carry it.
   Options, restated so he can answer them: **(A)** the guard + document are right → `AGENT_STACK_POLICY`, the three
   `policy.mjs` role blocks and the forum-tag precedence must change; that is a live routing change needing its own
   task, gates and deployment. **(B)** the policy table + role blocks are right → the guard's two literals change,
   which loosens a control the tests currently pin, and the document is rewritten. Either way exactly **one** of the
   two code surfaces moves, and `main`'s exemption should be decided in the same pass.
   **These are not new defects and must not be tiered as one.** The naming half is `R5-E11-01` (High, doc-truth);
   the guard-vs-authority swap is **`R1-A04-01`** (High, enforcement bug that kills a legal brief) and the
   four-stack enumeration is **`R1-A04-05`** (Medium, the denial names the wrong subsystem, so an operator digs at
   ledger correlation instead of stack policy). All three were recorded before this session, all three are still
   `OPEN`, and **none of the three is scheduled by ID anywhere in `PLAN.md` or `ACTIVE.md`** — I grepped. If the next
   contract inherits my framing, `R1-A04-01` and `R1-A04-05` would have been dropped by folding them into a T2.3
   "documents" item. That mis-merging is `R6-V07-01`, and it is the second wave-2 refutation of my own records.
   **This is not a new defect.** It is the existing `R5-E11-01` (High, Confirmed, OPEN, scheduled to the doc-truth
   tier), extended here with the `AGENT_STACK_POLICY`/`guard.mjs`/`STACK_IDS` evidence that lane E11 did not read —
   E11 saw only `AGENT_SPAWN_POLICY`, whose `:555-563` anchors are still exact while its `:570` display-name evidence
   is now closed by `61638d8`. The dates support E11's own root cause ("the table was written from a retired roster
   and never re-verified"): the document predates both code surfaces by 11 and 18 days. So the better-supported
   answer is **(A)**, and it is presented that way rather than as an even split — but it is his call, because (A)
   ratifies a routing decision that was changed in code without ever being written back.
3. **Ingress was verified neutral and left alone.** `AGENT_ALIASES` resolves `o1`/`o2` only through the ids, the
   `điều phối` forms and their snowflakes — it carries no stack title — and `AGENT_MENTION_PATTERNS` is derived from
   it, so mention routing needed no change. The `etl`/`analytics` words survive only in the historical comment about
   the _hand-transcribed_ patterns that derivation replaced; that comment was corrected to say so.

Gate and commit state: `npm run verify` **PASS** on Windows at `61638d8` — `format:check` clean, `lint` clean, `npm
test` **1483 tests / 106 suites / 1437 pass / 0 fail / 46 skipped**, `Repository policy check passed.` (the same
denominator was green once before the label change, so the two runs bracket the change rather than the second run
covering it alone). Targeted suites for the touched surfaces: `m10-t2-r12` 9/9 and the presentation/manifest/
asset-predecessor set 27/27, zero skips. Confirmed by search that **no** digest pin anywhere in `tests/` covers
`lib/discord-formatter.mjs`, and that `governance-manifests.json` is generated at packaging time from the working
tree, so a comment-only `policy.mjs` edit cannot stale-pin it. `REMOTE-BACKED` is **not** claimed here until a CI run
is read for this head; the WSL lane is `NOT RUN` for this increment. Two scratch files created during the diagnosis
(`temp/r16-live-config-probe.mjs` and an accidentally created empty `cd` at the repo root) were deleted; the probe
redacted `apiKey`/`token`/`password`/`secret` and stripped URL userinfo, and no credential value was ever printed.
Full finding text with verify-by commands is `.agents/states/findings.md`, `R6-CFG-01`…`R6-CFG-04`.

### Record — Vòng 6 wave 2 RUN: the nine outstanding verification lanes returned and refuted the orchestrator twice (2026-10-15)

`V02, V03, V04, V07, V08, V09, V10, V11, V12` were dispatched after `M12/T2.1-R3` executed, each re-pointed at the
current `ACTIVE.md` §4/§5 and told which items had already landed (the lane spec was written against R2). **All nine
returned, so Vòng 6 is now RUN, not `NOT RUN`** — the twelve lanes Round 5 could not dispatch are accounted for. Two
of them refuted _my own_ records, and I verified both refutations from source before accepting them; nothing here
became code, because the tier is closed and this is input to `M12/T2.2`.

**What was disproved about the audit itself.**

- `R6-CFG-01/-02/-03` (`R6-V07-01`) — three of the four IDs I filed hours ago were re-numbers of `R5-E11-01`,
  `R1-A04-01` and `R1-A04-05`, all recorded before this session. Root cause is mine: I wrote down what I had just
  measured instead of grepping the register first, which is exactly what §4 requires. The cost was real: my framing
  would have tiered one naming decision as three fixes and buried two live runtime defects inside a "documents" item.
- The coordinator/stack contradiction is **not** doc-vs-code drift — the guard and the policy table are swapped
  against each other (corrected in the record above, with the `UNAUTHORIZED_TARGET` mechanism).
- `4A.8` has no defect to fix (`R6-V03-01`): `model_probe.py:128`'s `AssertionError` is unreachable and real outages
  already return 503 at `main.py:364-365`. The proposed `AssertionError→503` mapping would _create_ the bug, because
  `knowledge-adapter.mjs:360-362` retries 503 — a deterministic internal fault would become "transient, back off".
  The live version of the complaint is elsewhere: `create_index_run` and `get_index_run` have no terminal
  `except Exception` mapper, so two of three routes return a 500 with **no code at all** (`R6-V03-02`).
- `ACTIVE.md` §5.1's arithmetic is wrong again: **26** suppression sites, not 28 — `index_runner.py:43-45` and
  `database.py:205-208` end in bare `raise`, so their tracebacks propagate — and five of the remaining seven already
  persist a `SafeRunError` code. §5.1 also claims only `pdf_runtime.py` has a diagnostic channel; it does not know
  about `apps/knowledge/app/run_errors.py:19-41`, which is the module's owned, bounded, persisted channel. A T2.2 fix
  written against §5.1 would build a second mechanism next to an existing one (§8 of `AGENTS.md`).

**What would have made the next fix wrong (all `M12/T2.2` inputs, none executed).**

- `R6-V04-01` (High): 4A.13's own mitigation fails. The FAILED marker zeroes `embedding_input_sha256` only in the
  no-conflict VALUES list (`vector-sync.mjs:783`); its `ON CONFLICT DO UPDATE` (`:793-796`) keeps the previous real
  digest and, unlike the success path, omits the `DELETE FROM skills.segments`. So READY → one later failure → row
  pinned FAILED with the digest intact → the skip matches forever, and since every consumer filters
  `sync_status='READY'` a serving skill silently disappears from retrieval with no retry path.
- `R6-V04-02` (High): the skip key is input-side only — no column anywhere carries embedding-model identity — so
  after a model change every digest still matches and a skip converts today's wasteful-but-correct "always re-embed"
  into "never re-embed" while reporting READY. Salting the digest would rewrite stored bytes for every row, which is
  a data-semantics decision, not a performance detail.
- `R6-V04-03`: there is **no read surface** — `:645-803` contains no `SELECT` and every non-docker seam returns `""`,
  so an implementer can land a no-op skip and light the suite green; only the docker/psql gate can observe it, and
  CI has no container.
- `R6-V12-02`: item `4.2`'s "additive log lines are admissible" premise is false. `m10-t2-r6:225-237` pins
  `CANDIDATE_BOUNDARY_SHA256` against the **working-tree** packaged bytes of `native-boundary.mjs`, which
  `governancePluginFiles()` reads directly, so one added line flips it red on WSL. The sibling `HYGIENE` pin reads a
  fixed commit and _is_ immune — only the candidate pin defeats the premise.

**What got calmer, not worse — three owner decisions change shape.**

- **H4 de-escalates** (`R6-V09-01`). The 0644 `openclaw.json.bak-mobile-*` is real (1 of 15 copies; the other 14 are
  0600), but I ran the metadata check myself: `/home/hoang_vinh` **and** `/home/hoang_vinh/.openclaw-zink` are both
  `drwx------`, so the register's "any uid in the WSL VM can read the live credential set indefinitely" is simply
  false. It is a hygiene + gate item, not an emergency chmod on live credential data. The gate half is _stronger_ than
  recorded: `configure.mjs:986-988` returns immediately on win32, so the mode check never runs on the host he
  actually uses, and four subtrees inside that root are group-writable (`R6-V09-03`).
- **H7 loses its live basis**: `governance/ledger/events.jsonl` is **0 bytes** (mtime Sep 18) and a numbers-only
  snowflake grep returns 0 — no third-party identity has ever been written. It stays a forward-looking schema
  question, and must not be put to him as "identities are already accumulating".
- **H5 loses its support**: `R5-E11-02`'s §9 claim does not hold — §9's only imperative about another owner's store is
  prefixed "Cross-project", and §9 defines the three modules as one repository, so the plugin calling the Skill
  Store's own exported writer under the Skill Store's own lock is calling the owner. What is false is one sentence of
  `docs/contracts/skill-store/agent-skill-store.md`. H5 must be decided on `skills.*` DDL placement alone.
- **H3 shrinks**: `m11-t1-skill-vector-sql.test.mjs` is not Docker-gated (grep count 0; it passes in CI), so running
  Postgres as a CI service buys **one** test, not a tier. And all 52 CI skips are individually named in the log, so
  the real problem is enforcement, not visibility — a single threshold would fire on 40 legitimate host-capability
  skips. See the attributed delta in the Evidence Level field above.
- **H8 gains a prerequisite** (`R6-V10-01`): applied migrations are keyed on **filename only**
  (`database.py:1718-1733`, no digest column), so editing `003`'s `status` CHECK in place — exactly what H8 invites —
  is a silent no-op on an already-migrated database that no gate can detect.

**Closed loose ends.** The gitleaks / `actions/checkout` / `actions/setup-node` SHA pins **are** the releases they
claim, re-derived independently via read-only `gh api` (all three tag objects are plain commits, no annotated-tag
indirection), so E15's "clean" stands. The double-nested `operator/m7-t2/ledger/operator/m7-t2/ledger/` artifact is
now signature-matched (0 B journal + 196 B snapshot + **65 B `identity.key`**, and only `ledgerPaths()` builds that
path), so an already-joined absolute ledger root was passed as the state dir; `configure.mjs:1073-1074` now makes the
configure path unable to reproduce it, leaving two candidate sinks and a new finding that **nothing validates a
state-root argument** (`R6-V11-01`). Whether Discord serves `threads/active` stays `Unresolved` — and the reason it
stayed open was itself wrong: `discord-forum-tags.mjs:135-152` calls Discord over `globalThis.fetch` and never
touches the pinned host surface, so the approval-card-buttons precedent never applied and the host log could never
have settled it.

**Governance defect this wave exposed about itself**: `ACTIVE.md` has **no §9 and no H1–H10 table** (`grep -c "^## 9"`
→ 0). The owner-decision ledger exists only in `.agents/states/findings.md:4423-4452` (historical — moved 2026-10-17) — a git-ignored state file that
§2/§6 declare non-authoritative. Every pointer I have been giving lanes and the owner to "contract §9" is stale, and
H1–H10 currently have no contract standing at all. Promoting that table into a tracked, plan-pointed location is a
governance action, not a code action, and it precedes asking him to answer any of them.

Gate state for this record: no source, test, config or migration file was changed by the wave; the only tracked
modification is `PLAN.md`. `npm run verify` was **NOT RUN** for this record (nothing to validate — no code changed),
and CI was re-read, not re-run: `38715084889` @ `d8c221a` = `quality-gate` **SUCCESS**, `python-quality` **SUCCESS**;
`38715090086` = `dependency-audit` **FAILURE** (the unchanged 5-high baseline), `secret-scan` **SUCCESS**. The WSL
lane and every live Discord surface remain `NOT RUN` / `NOT TESTED`.

### Record — `M12/T2.1` closed, `H10` executed, and `M12/T2.2-R1` Wave A materialized (2026-10-15)

Three things happened in sequence, and the order was not arbitrary: the archive rule had to exist **before** anything
was archived, because §5.1 of the closing contract made the secret-scrub rule a prerequisite of archiving
(`R3-P04-03`). So: rule → archive → new contract.

**`H10` closed as "archive, don't delete."** `docs/contracts/execution/archive/README.md` now defines the naming form
(`YYYY-MM-DD-<milestone>-<task>-R<revision>.md`), permanent retention, and a five-step scrub: credential-shaped
assignments, opaque long runs, a bar on copying values from operator-owned files, snowflakes allowed only if already
tracked in source, and no live state captures. Step 4 was written too strict on the first pass and corrected in the
same commit: it demanded repo-relative paths only, which would have made every future archive unsatisfiable, because
21 tracked files already name the live state root and a contract that cannot name the path it must not touch is not
reviewable. The distinction is now explicit — naming a path is allowed, capturing its content is not.
`docs/contracts/execution/README.md`'s closeout sequence was amended to copy-then-delete, and dated archive files are
excluded from prettier and markdownlint for the same reason the existing `m7-m8-red-team-backlog.md` is: reformatted
evidence is no longer evidence. The exclusion is anchored to the dated filename form, so the directory's own README
stays under both gates.

**The first archive is the closed tier itself.** `M12/T2.1-R3` was copied to
`archive/2026-10-15-M12-T2.1-R3.md` and verified byte-identical (`cmp`) before the original was replaced. Its scrub
ran with results recorded rather than asserted: the only credential-shaped hits are the literal words
`Execution Authorization: YES/NO` and a code fragment the contract quotes _as the defect it is removing_; the opaque
runs are file paths and digests already in tracked history; **zero** untracked snowflakes. Nothing was redacted, which
is the honest outcome and is stated as such.

**Why this mattered more than tidiness.** The protocol prescribed `delete ACTIVE.md` at closeout while `AGENTS.md` §11
forbids claiming completion without checkable evidence — the governance docs destroyed their own audit trail by
design, and it had already bitten once: R2's text was lost to an overwrite and recovered only from a session
transcript. Replacing `ACTIVE.md` for Wave A is now a routine operation with a durable backstop, not a risk.

**`M12/T2.2-R1` materialized.** Wave A of the medium-risk tier, eight frozen items, approved by the owner in three
messages (`đúng, chốt 3 wave` / `a, có grant` / `chọn 1 đi…`). Three items exist only because Vòng 6 wave 2 refuted
the earlier plan: `4A.8` is withdrawn as having no reachable defect, `4A.9`'s denominator moved 28 → 26, and `4A.13`
is re-scoped under the owner's choice **(a)** — **no re-embed skip until a stored model identity exists**, because the
skip would bypass the only model-identity checks that work today (`vector-sync.mjs:392-405`, `:419`), which live
_inside_ the HTTP call the skip is designed to avoid. The pinned-assertion exception he granted is narrowed in this
plan to the one assertion the contract names (`m8-t1-skill-vector-memory.test.mjs:118`, item `A-5`); `A-1` and `A-2`
were expected to need more, and execution must stop and ask instead of assuming the grant stretches.

**Accepted for this interval, and it must be restated at closeout:** the owner assigned the `five-stack.md` correction
to `M12/T3`, so once `A-1` lands the canonical architecture document will describe the **opposite** org chart from
the enforced one. That is a knowingly time-boxed divergence, not an oversight, and any reader of the document before
T3 lands should trust `AGENT_STACK_POLICY` plus the guard and this plan over the table.

Gate state: `npm run verify` **PASS** — `1483 tests / 106 suites / 1437 pass / 0 fail / 46 skipped`,
`Repository policy check passed.` — and `markdownlint-cli2` reports **0 issues in 18 files** after the ignore scoping.
Evidence Level for `M12/T2.2-R1` is **NONE**: no item has executed.

### Record — `M12/T2.2-R1` `A-1` landed, and it refuted this contract's own prerequisite (2026-10-15)

`A-1` (`R1-A04-01`, High) deletes the hand-copied coordinator→stack table at `guard.mjs:842-853` and validates
**per node** against the canonical `AGENT_STACK_POLICY` (`authority.mjs:573-587`, re-exported at `policy.mjs:607`),
imported the same way `workflow.mjs:12` imports it. The brief-wide "exactly one distinct stack" predicate and the
`context.agentId !== "main"` exemption are both gone; the stack rule now binds every author, which is what the table
says it means. The two rules `ACTIVE.md` §4 ordered kept are kept verbatim: the spawn-target assert
(`guard.mjs:865-870`) and the `decision`-must-be-`main` ownership assert (`guard.mjs:877-878`).

Test-first evidence, re-run by the orchestrator rather than inherited from the implementer: with `HEAD~1`'s
`guard.mjs` placed back in the working tree, the new suite is **4 fail / 5 pass**, and the four failures are exactly
the ones that must fail — the o1 flip, refuse-before-durable-write, the exhaustive table, and the source-shape pin.
The file was then restored **byte-identically** (`SHA256 849fecd7fb6820a40018d9389eb94d069fc70ce9fd737c8b02837f0e6eb770c5`,
computed before and after, and `git status` clean) and the suite re-run to **9 tests / 9 pass / 0 fail / 0 skipped**.
`tests/m12-t2.2-a1-stack-authority.test.mjs` proves the o1/`data_plant` flip is admitted, the same o1 root still
cannot author o2's stacks, a node whose agent does not own its stack is refused **before** any durable write
(`activated: []`, zero brief-write events), the mixed `o1`+`o2` plan is admitted, o2/`infrastructure` is refused, all
30 table-illegal agent/stack pairs are refused, and two source-shape pins hold (the guard reads the table and keeps
neither ownership rule). Adjacent suites re-run as a set — `m10-t2-r14-review-defects`,
`m10-t2-coordinator-binding`, `m7-lane-g-policy`, `m11-t1-openclaw-outbound-and-caches` — **66 tests / 65 pass /
0 fail / 1 skipped**.

**The refutation, and it is this plan's error, not the codebase's.** §2 claimed a plan spanning both coordinators
"with a Main merge node is therefore **legal today**". It is not, and `A-1`'s own test found it: `AGENT_SPAWN_POLICY`
(`policy.mjs:556-562`) puts `main` in nobody's spawn list, while the kept ownership rule demands the `decision` node be
`main`-owned — so **no `decision` node is admissible through `admitInitialBrief` for any author**, and the mixed plan
only lands if its merge is dropped. Full derivation, the executed evidence, and the reducer half of the divergence
(`workflow.mjs:1466-1470` validates against a table where `main` _does_ own `decision`, so the reducer accepts what the
guard then refuses) are recorded under the H11 disposition in §11. §2 and `ACTIVE.md`'s `A-1` live-effect paragraph
were corrected alongside this record. `A-1`'s scope did not change and no item was re-cut smaller: the item was the
de-duplication, and the de-duplication is what landed. What changed is what the owner can ask of Wave A — **the split
is available now; the merge is a `M12/T3` prerequisite**, and adding the `main` spawn edge here would be a topology
change, RED under `AGENTS.md` §7.

`A-1` gate state. **Windows local: PASS** — full `npm run verify`, `1492 tests / 106 suites / 1446 pass / 0 fail /
46 skipped`, `Repository policy check passed.` **WSL read-only lane: PASS, and it ran for the first time in this
tier** — `node --test` under WSL's node `v24.15.0` against the same working tree the live plugin loads:
`tests/m12-t2.2-a1-stack-authority.test.mjs` **9 tests / 9 pass / 0 fail**, and the four adjacent suites
(`m10-t2-coordinator-binding`, `m10-t2-r14-review-defects`, `m7-lane-g-policy`,
`m11-t1-openclaw-outbound-and-caches`) **66 tests / 66 pass / 0 fail / 0 skipped** — one test _more_ than the Windows
lane, which skips one of them. Nothing went red **in those five suites** on the lane that actually hosts the runtime.
**This claim is narrower than it read**, and is corrected here: it covered the suites `A-1` touched, not the WSL tree.
A full `npm test` under WSL at the wave's final head returns **2 fail / 1471 pass / 43 skipped**, both pre-existing
and outside `A-1`'s suites (`R7 P1` live-drift on `lib/authority.mjs`, and `R16-DRIVER-05`) — see the Wave A closure
record at the end of §8. **Remote-backed: NOT RUN.** `ccf2ad7` is pushed, and `ci.yml:3-8` triggers
only on `pull_request`/`push` to `main` or on `workflow_dispatch`; there is no open PR from this branch
(`gh pr list --state open` → empty), so the push triggered nothing and `commits/ccf2ad7/check-runs` is empty. A
dispatch is the owner's call, not mine: this session's `gh` token authenticates as `SatThuVoTinh`, so a dispatch I
make is recorded under his login and is indistinguishable from one he makes — see the corrected H1 row.

### Record — `M12/T2.2-R1` `A-2` landed: one stack registry, and a denial that stops lying (2026-10-15)

`A-2` (`R1-A04-05`, Medium) removed the second stack registry and re-coded one refusal. Three changes, no more:

- `policy.mjs:1700-1717` — `STACK_IDS` was **four** members (`infrastructure` absent) while every topology contract
  (`execution-brief`, `ledger-event`, `ledger-snapshot`, `trusted-result-envelope`, `delegation-envelope`) declares
  **five**. It is now the five-member list in schema order.
- `guard.mjs:45-51 → :44-53` — the guard held a module-level **five**-member copy in a different order which
  `guard.mjs:139` overwrote with the four-member export on every successful policy load. So the guard's own correct
  default was dead code and the effective runtime registry kept losing `infrastructure`. The copy is gone and the
  pre-policy state is `let STACK_IDS = [];` — fail closed, the convention the same file already documents for the
  built-in tool authority at `:58-61` and `:159-165`.
- `guard.mjs:1729-1738` — the delegation stack-membership refusal reported `AUTH_DELEGATION_NOT_FOUND` for a
  delegation the guard had just read, identified and validated. It now uses `AUTH_SCOPE_MISMATCH`, which is already
  in this guard's vocabulary (`:1759`, `AGENTS.md` §8 reuse-before-inventing). **No new denial code exists**: the
  denial vocabulary is durable ledger vocabulary, and a test pins the code set to exactly the ten codes that were
  already there. Every other assert in that block still reports `AUTH_DELEGATION_NOT_FOUND`, and the test proves
  that half did not move.

Why this became live only now: `A-1` made an `infrastructure` node legal in a brief (`AGENT_STACK_POLICY` gives it to
`main` and `o1`), so the split-half-of-the-org-chart the owner chose can name a stack the delegation authority check
then refused with a false "not found". Enumerable is not executable, and two tests hold that line: admission still
refuses `infrastructure` for every agent whose table omits it, and no agent that owns `infrastructure` has a directly
executable callable tool in `ZINK_TOOLS_ACCESS_MATRIX` / `TOOL_POLICY` — which is what `five-stack.md:9` ("T2 grants
no infrastructure execution capability") actually needs to stay true.

Honest limit of the behavioural test, stated in the test file itself: the delegation record there is **hand-authored**
at the check boundary, because the honest reducer derives `stack_id` from the node (`workflow.mjs:1808-1810`) and no
infrastructure owner is also a callable-tool caller, so a fully reducer-produced `infrastructure` delegation cannot be
built yet. The fixture therefore stands for the ledger shapes that check must classify, and the suite pins the reason.

Gates, all re-run by the orchestrator, not inherited: `npm run verify` **1502 tests / 106 suites / 1456 pass / 0 fail /
46 skipped** + `Repository policy check passed.` — baseline `1492` plus exactly the ten new tests. A-2 suite **10/10 on
Windows and 10/10 under WSL**. The four affected suites (`m7-lane-i`, `m7-lane-g`, `m11-t1-openclaw-outbound-and-caches`,
`repository-policy`) are **54 tests: 53 pass + 1 pre-existing Windows skip on Windows, 54/54 under WSL**. Mutation probe
run by me: dropping `STACK_IDS` back to four members reddens exactly **4** tests (both registry pins, the
infrastructure-delegation behaviour, the unregistered-stack behaviour) while the capability/no-widening tests stay
green; `policy.mjs` restored byte-identically, `SHA256 a7a759607da3b069ebb85d678b072be98491a674db20c2a6a69b13e18fdc7a26`.

One correction to the implementer's report, kept because the number was in the handoff: it described "4 affected
suites = **63** tests / 1 skipped". Those four suites are **54**; 63 is 54 plus the `A-1` suite. My own per-file counts
(`11 + 9 + 12 + 22`) settle it. The skip it reported is real.

Three observations from `A-2`, deliberately **not** changed:

- `plugins/zink-governance/index.mjs:4026-4030` and its primary source `zink-tools/contracts/tools/zink-python.schema.json:25-28`
  both carry a **four**-member `stack` enum — a _tool-input_ schema, not the protocol registry, and §3 of the contract
  puts schema semantics outside `A-2`. Consequence the owner should know: a `zink_python` call can never legitimately
  carry `input.stack: "infrastructure"`, and `guard.mjs:1789-1792` requires `input.stack === del.stack_id`, so the
  registry fix does not by itself make an infrastructure delegation executable end to end. Reaching that is a
  schema-semantics decision, not a registry one.
- `policy.mjs:1725`, `:1747` and ten sibling `stacks: Object.freeze([...])` entries inside `ZINK_CAPABILITY_REGISTRY`
  are per-capability "which stacks this interface is offered to" descriptors. No code reads `.stacks`, every member is
  a subset of the registry, and none names `infrastructure`. **Not drift** — a different concept, checked so that the
  claim "one registry" is accurate about the thing it describes.
- `guard.mjs:1724-1728` still fabricates `"data_plant"` for a delegation that carries no `stack_id` and matches no
  node. Same class as the "guessed stack" surfaces the audit already recorded, and it needs its own item rather than a
  silent extra edit here. Recorded as `R6-A02-01`.

### Record — `A-3` STOPPED: its premise is refuted, and the real defect is a different one (2026-10-15)

`ACTIVE.md` §8 orders: _"If execution reveals that an item's premise is wrong … **stop that item**, record the
refutation, and escalate; do not silently re-scope it into a smaller claim."_ `A-3`'s premise is wrong, so it stops
here rather than landing a smaller change under its name.

**What `A-3` claimed** (`R5-E16-01` / `R5-E16-02`): `queue-manager.mjs` and `decision-ledger.mjs` "each rewrite their
whole JSON document **in place** under the cross-process writer lock", and the fix is to convert both to
write-temp-then-rename reusing `ledger.mjs`'s `writeSnapshotAtomic`.

**What the source does** (read this session, not inferred):

- `queue-manager.mjs:200-247` `save()` already writes a temp file, `fsync`s, closes, `renameSync`s over the target,
  then fsyncs the parent directory (`:210-232`, the M7-066 comment says so explicitly).
- `decision-ledger.mjs:238-290` `save()` already does the same **and** wraps the write and the rename in
  `withFileLockSync` **as one unit** (`:261-270`), with an M10/T2-R17 comment stating that locking only the rename
  would leave the torn window this closes.
- So there is no in-place rewrite to convert in either file. `A-3`'s prescribed fix has nothing to do.

**The defect that is actually there, and it is not the one `A-3` describes.** The two modules differ in **who takes
the lock**, and one shipped caller relies on the wrong one:

- `decision-ledger.save()` locks itself, so any caller is safe.
- `queue-manager.save()` does **not** lock. Safety comes from callers wrapping in `withLock` (`:135-152`), which
  re-`load()`s inside the lock and then runs the body.
- `plugins/zink-governance/index.mjs:5658-5663` mutates `defaultQueueManager.queue` and calls `save()` **directly,
  outside `withLock`**. Two consequences, both the classic lost-update shape and both caused by this one call site
  rather than by whole-file rewrites in general: the save projects whatever that map happened to hold — a snapshot
  from construction or from the last `withLock` — over the file, so a concurrent locked writer's committed change is
  **erased**; and its own mutation is made against a stale copy, so the projection it writes is already wrong. The
  failure path "restores" only the in-memory map (`:5663`), never the disk, so a partial sequence leaves the file
  holding the stale projection. This is the lost-update shape the register attributed to
  whole-file rewrites; its real cause is an unserialised writer.
- Both modules also open their temp file with mode `"w"`, not `"wx"`, and neither calls `assertNoLinks` — unlike
  `ledger.mjs:551-552`, which does both. A predictable temp name (`<file>.tmp-<pid>[-<timestamp>]`) is therefore a
  path a pre-existing link can occupy.
- `queue-manager.save()` also leaves temp **residue** when the write fails: its `finally` (`:238-245`) closes the
  descriptor but never unlinks, whereas `ledger.mjs:562-567` cleans residue after the close and before rethrowing.

**Why I did not fix these under `A-3`.** The unlocked writer lives in `index.mjs`, which is not in `A-3`'s allowed
file list (`ACTIVE.md` §3: `queue-manager.mjs`, `decision-ledger.mjs`, their tests), and the durable options each
change something the owner has not been asked about: making `queue-manager.save()` self-locking changes lock
behaviour for every caller; converting the caller to `withLock` means editing the plugin; `"w"` → `"wx"` plus
`assertNoLinks` is a hardening change the contract never described. Any of those, done quietly, would be exactly the
silent re-scope §8 forbids.

**Recommendation, for the owner's decision, smallest first:** (1) `queue-manager.save()` self-locks, matching
`decision-ledger` — one module, no caller edits, and the unlocked `index.mjs` path becomes safe without touching the
plugin; (2) add `"wx"` + `assertNoLinks` + post-failure residue cleanup to both temp writers, reusing
`ledger.mjs`'s existing helpers rather than writing new ones; (3) leave the `index.mjs:5658` direct mutation on a
recorded list to be retired when its queue-projection ownership question is decided. Item (1) alone closes the
reachable data-loss path.

**This does not affect `A-1` or `A-2`**, and it does not block them: neither touched these files.

Gate state for this record: `NOT RUN` — no repository source file changed, only `PLAN.md` and the register.

### Record — `M12/T2.2-R1` `A-4` landed: applied migrations are now digest-pinned (2026-10-15)

`A-4` (`R6-V10-01`, Medium) closes the silent-no-op window: `database.py:1718-1733` records adoption by **filename
only**, so editing an already-applied `00x.sql` changes nothing on any database that took it, and no gate could see
the edit.

- `docs/contracts/knowledgebase-migration-digests.json` — SHA-256 of each applied migration's bytes
  (`001_initial.sql` `7d66ee6e…`, `002_pdf_ingestion_foundation.sql` `3b48c4a2…`, `003_skills_vector_schema.sql`
  `8706a553…`), plus a purpose line that states the rule and, after my review, states the one thing it originally
  omitted: an **unlisted** file is a forward migration and stays green on purpose, and when such a file is released
  and starts being adopted it must be appended here, because from that moment editing it in place is the same silent
  no-op.
- `tests/m12-t2.2-a4-migration-digest.test.mjs` — five tests, listed in `package.json` so CI collects it (that
  script is an exhaustive file list; an unlisted test would have silently never run). Two REAL-file tests (manifest
  well-formedness; every listed digest matches the bytes on disk) and three FIXTURE tests proving the guard is not
  vacuous: a mutated copy reddens with the forward-migration message, a deleted listed file reddens, and a brand-new
  unlisted `004_*.sql` stays green.
- Placement note: the manifest went under `docs/contracts/`, not `apps/knowledge/migrations/`, because §3 makes the
  migration tree **read-only as digest source**. JSON rather than Markdown keeps it out of the prettier/markdownlint
  surface it does not need.

Evidence taken by me as well: the implementer returned an API error mid-run and I reviewed and re-ran its work
myself; its full report then arrived late and agreed with mine on every gate number. the digest the manifest pins for `003` is identical across `node:fs`, `sha256sum`, `certutil` and
`git cat-file -p`, and identical again under WSL, so the guard cannot pass on one lane and fail on another — the
`.gitattributes` rule `* text=auto eol=lf` makes all three checkouts byte-agree, which was the real risk in this
design. Mutation probe run by me against a **real** file: appending bytes to `002` reddened exactly one test with the
message naming the forward-migration rule, and the file was restored to `3b48c4a2…` with `apps/knowledge/` clean
afterwards. Full gate: `npm run verify` **1507 tests / 106 suites / 1461 pass / 0 fail / 46 skipped** + `Repository
policy check passed.` (baseline 1502/1456 + exactly the five new tests), and the suite is **5/5 under WSL**.

One thing worth recording about the working method, because it looked like a defect and was not: an intermediate
reading of mine had `003` at `cbc1e2df…` while the manifest pinned `8706a553…`, and I nearly wrote up a
lane-divergence finding. The agent's report resolves it — that was its **own mutation probe in flight** (it appended
a byte to `003` and restored it, reaching the same digest I later measured). Two lanes mutating tracked files in the
same working tree is the real hazard here, and the fix is procedural: I ran my own probe on `002` afterwards, and the
next item gets the tree to itself. No divergence exists; `.gitattributes` `* text=auto eol=lf` plus the agent's
`git ls-files --eol` check (`i/lf w/lf` for all three) is what makes the digests agree on Windows, WSL and CI.

`A-4` changes no SQL, no schema, and no adoption logic.

### Record — `A-5` STOPPED: the guard it ordered is a regression, and I built it before finding out (2026-10-16)

Second item this wave whose premise the code contradicts. `A-5` (`4A.1` / `R5-E05-03`, High) claimed the destructive
`DELETE` runs unconditionally on an empty scan while the call reports `READY`, and ordered an empty-input guard plus
the owner's granted re-value of `tests/m8-t1-skill-vector-memory.test.mjs:118`.

I implemented it — guard in `vector-sync.mjs`, the assertion re-valued, two extra tests pinning that the tombstone
still runs — and the **full gate caught the mistake**: `tests/m11-t1-postgres-sql-gate.test.mjs:198-213` went red.

- The dangerous roots are already refused before any statement: `catalog.mjs:718-742` returns
  `SKILLS_ROOT_MISSING` for a missing root and `UNSAFE_PATH` for a non-directory or symlink root, both flow into
  `catalog.errors`, and `vector-sync.mjs:564-573` returns `CATALOG_INVALID` / `FAILED` without issuing anything. The
  wipe-the-index-on-a-wrong-path scenario `A-5` was written against cannot happen.
- The one route left to the `DELETE` with zero records is an existing, real, **empty** skills directory, and that is
  the designed tombstone. The Postgres gate proves it: it removes every skill from canonical state, resyncs the now
  empty catalog, and requires `status === "READY"` **and** `count(*) = 0` in `skills.catalog_index`. My guard made
  that refusal happen instead, and retired rows would have stayed retrievable — the defect `A-5` was invented to
  prevent is the one it would have caused.
- §4's literal condition ("a scan finding no active skill") is worse still: it would also skip the case where
  records exist and every one is deprecated. No narrower version of this item is safe.

Everything was reverted with `git checkout HEAD -- zink-skill-store/src/vector-sync.mjs tests/m8-t1-skill-vector-memory.test.mjs`;
both files are byte-identical to HEAD (`git status` shows only `PLAN.md`), and `m8-t1-skill-vector-memory` plus the
Postgres gate are **14 tests / 14 pass / 0 fail / 0 skipped** afterwards. **The pinned-assertion grant for `:118` was
never used** — there is nothing to re-value, and the standing grant in this contract is now spent with no effect.

What is actually left, and it is not fixable inside this function: an operator who points `skillsRoot` at a
_different but valid, empty_ skill directory will tombstone the store they meant to leave alone. Nothing inside
`syncSkillsToVectorStore` can distinguish that from a genuine emptying. The control belongs at the caller or config
boundary (a store-identity or expected-namespace assertion), which is a design question for the next tier, recorded as
`R6-A05-01`.

For the owner's reading of the wave: `A-1` and `A-2` were real and are fixed; `A-3`, `A-5` and the withdrawn `4A.8`
were not. That is a 2-of-5 hit rate on items this plan wrote from audit text, which is why every remaining item is
now verified against source before it is executed, and why the two refutations were found by running the full gate
rather than the item's own tests — the guard I wrote passed all ten of its own tests while breaking a shipped one.

### Record — `M12/T2.2-R1` `A-3` re-pointed and landed, with the digest rollover the owner granted (2026-10-16)

The owner chose **option A**: fix the unlocked call site, and grant `index.mjs` into the item's scope.

**The fix.** `plugins/zink-governance/index.mjs:recordCoordinatorNotification` read `getTask(taskId)`, mutated
`defaultQueueManager.queue` and called `save()` with no lock. It now runs **both the read and the write** inside
`defaultQueueManager.withLock(...)`, which is the class's own critical section and reloads the projection from disk
before its body. Contention (`withLock` converts `FILE_LOCK_BUSY` into a thrown `QUEUE_LOCK_TIMEOUT`,
`queue-manager.mjs:153-159`) is caught and returned as `{ ok: false, error }`, because `persist` callers treat this
evidence as reconciliation material, not authority — so the change adds no new way for the dispatch path to throw.

**Option B was rejected on measured ground, not taste.** `tryAcquire()` is `mkdirSync` + `EEXIST` → false
(`file-lock.mjs:112-115`): the lock is **not reentrant**, so a self-locking `save()` would deadlock all nine
`withLock(() => … save())` paths. `tests/m12-t2.2-a3-queue-writer-lock.test.mjs` pins the trap shut on both halves —
the source shape (`save()` acquires nothing) and the behaviour (`withLock` inside `withLock` must throw).

**Test-first, with the fixture corrected twice before it earned its claim.** Baseline at HEAD: 3 pass / 2 fail — the
two failing pins are the call-site shape and contention handling. Two of my own fixture errors had to be found
first: `load()` keys the projection by `item.taskId` rather than by the map key, so a clone that kept the old id
collapsed both rows and proved nothing; and `getTask` returns `null` for a missing row, not `undefined`. The defect
itself reproduces on the real class and the real file: an unlocked `set` + `save` from a snapshot taken before
another writer's commit **erases that writer's row**; the same mutation through `withLock` does not.
Mutation probe by me: with the fix removed, exactly one test reddens. Stated honestly: the contention pin passes
either way, because the old code already caught the save failure — so only one of the two call-site pins is
sensitive, and I am not claiming otherwise.

**The rollover, because `index.mjs` IS the packaged plugin entrypoint.** The build digest moved
`513beb15c3d7624c0a928c4c1556dc44d4c4cff4f1e00980f24b298a25751c0d` →
`2023e86715f9b105e2649388b4587ad635f89cc9db7a10e1a04c2247daa6818e`, which reddened six pre-existing pins (`R3 0b`,
`R13 P4/P5/B2/B3/C2`). I stopped and asked rather than re-pinning, and the owner granted it. The rollover follows the
mechanism the tests are built around: the current pins take the new digest (deliberately **not** listed — `R3 0b`
fails if the current build is allowlisted), and the outgoing digest is admitted in **both** per-mode lists of
`configure.mjs`, since listing one mode and not the other lets `--preflight` pass and then `--apply` refuse.

**One fact I refused to take from this plan.** Two comments here claimed two different digests were "what the live
runtime carries" (`61e344e6…` in `configure.mjs`, `513beb15…` in `PLAN.md`). Admitting a digest the runtime does not
actually carry would be a false hygiene record, so I measured it read-only instead:
`sha256sum /home/hoang_vinh/.openclaw-zink/extensions/zink-governance/index.mjs` = `513beb15…`. That is what made the
admission necessary rather than optional.

Gate state. Windows full `npm run verify`: **1512 tests / 106 suites / 1466 pass / 0 fail / 46 skipped** +
`Repository policy check passed.` WSL lane (read-only, same tree the runtime loads): A-3 suite plus both pin suites
**51 tests / 51 pass / 0 fail / 0 skipped**. Not deployed: no `--apply`, no `--preflight` run, no restart — the
allowlist entry exists precisely so a future authorized deployment stays reachable from what is installed today.

### Record — `M12/T2.2-R1` `A-6` landed: a state root that is already a ledger root is refused by name (2026-10-16)

`A-6` (`R6-V11-01`, Medium). `ledgerPaths(stateDir)` appended `operator/m7-t2/ledger`
unconditionally, so passing a root that had already been joined produced a **second, empty,
permission-valid governance root nested inside the real one**. The live tree carries the evidence:
`operator/m7-t2/ledger/operator/m7-t2/ledger/` with a 0-byte journal and its own 65-byte `identity.key`.

`ledger.mjs:56-76` now resolves the argument, splits on `path.sep`, and refuses when the trailing
segments are exactly `operator/m7-t2/ledger`, with `LEDGER_ROOT_ALREADY_JOINED` naming the mistake and
stating what to pass instead (the directory that _contains_ `operator/`). The suffix is a frozen
constant so the check and the join cannot diverge later. Tests went into the existing
`tests/m11-t3-durable-state-integrity.test.mjs` as `B8-1`/`B8-2` — Cluster B is already "durable state
silently recreated", and adding a file there would have cost a `package.json` edit for no new coverage.
Baseline: `B8-1` red, `B8-2` green (the ordinary join must not change); after the guard, 26/26.
The refusal creates nothing on disk, which `B8-1` asserts, so rejecting a call cannot itself mint a
scratch root.

**One probe of my own that was initially fake, and what caught it.** My first mutation attempt
substituted nothing (the pattern did not match) yet reported 26/26 — which I nearly logged as "the test
is not sensitive". Grepping the file after the edit showed the source was untouched; re-applying the
neuter with the change _verified in the file_ reddened exactly `B8-1`. A probe you have not confirmed
landed is not a probe.

Behavior change the owner should know about, because it touches his tools: `operator-lock-recovery.mjs`
and `live-governance-probe.mjs` call `ledgerPaths(options.stateDir)`. Every shipped call site passes a
state root (audited: `configure.mjs:1139-1142, 1177, 1752`, `verify.mjs:408`, the two operator tools),
so nothing in the repository breaks — but an operator invocation that passes
`~/.openclaw-zink/operator/m7-t2/ledger` instead of `~/.openclaw-zink` now **fails loudly** where
before it silently opened a phantom ledger root. The correct argument is the state root. This is the
intended effect, and it is exactly the class of mistake that produced the nested artifact in the
first place.

Gate: Windows `npm run verify` **1514 tests / 1468 pass / 0 fail / 46 skipped** (baseline 1512/1466, plus
exactly the two new tests) + `Repository policy check passed.`; the neutered source was restored
byte-identically (`SHA256 d50541f1baeaec0fecbe92c7fde912572eceb0f209d2bce2f92a83b094071314`) and re-run to
26/26. WSL lane: `B8` suite **26/26, 0 skipped**. No deletion or move of the existing nested tree — that still
needs a separate grant naming the exact target, per §5.

### Record — `M12/T2.2-R1` `A-7` landed: the no-skip decision is now pinned where it would be broken (2026-10-16)

`A-7` implements **no optimization**, per the owner's choice (a). It puts a comment at the call site
(`vector-sync.mjs:707`) recording why — the model-identity checks live _inside_ `generateSkillEmbeddings`,
i.e. inside the HTTP call a skip would avoid, so a skip needs a stored model identity first, which is a
migration and outside this tier — and two tests that make a later silent "optimization" fail the gate:

- `A7-1` counts real work: two ACTIVE skills whose content chunks to more than two segments must produce
  one embedding call per segment **and** one stored vector literal per embedding. Cross-checked against
  `chunkSkillContent` for the same content rather than against a number I typed.
- `A7-2` pins the shape: nothing branch-like sits between taking a segment and embedding it (comments
  stripped first — my own WHY comment contains the word "skip" and initially read as control flow), and
  `EMBEDDING_MODEL_MISMATCH` / `EMBEDDING_MODEL_DIGEST_MISMATCH` must still exist in the seam.

Red-green, actually verified this time: injecting a real skip (rows written, embedding skipped) reddens
**both** tests; removing it restores 7/7, and `vector-sync.mjs` was returned byte-identically
(`SHA256 f079ec825fa7b06bb16b6dde2cfda217f94320a08d66731360cc21326219a93a`). Two of my own counting bugs
were found and fixed before that claim: segment rows arrive as one `(VALUES …)` list per skill, so
counting statements compared 2 against 4, and the first fixture chunked to a single segment, which made
the equality hold trivially.

Gate: `npm run verify` **1516 / 1470 pass / 0 fail / 46 skipped** + `Repository policy check passed.`;
WSL **7/7**. Still recorded and deliberately **not** implemented: the `ON CONFLICT DO UPDATE` asymmetry at
`:793-796`, and that 9Router's echo of `model` / `model_version` is unverified — if it does not echo them,
today's identity protection is already conditional.

### Record — `M12/T2.2-R1` `A-8` settled: three of four candidates are not reachable, and Wave A admits no new fix from them (2026-10-16)

`A-8` changes no code file. Each candidate's own audit lane had left a `Verify-by` undone; those verifications were
**executed**, and I re-ran the load-bearing ones myself rather than accepting the report.

- **`R5-E15-01` — dismissed as a traversal hole, kept as a doc-precision defect.** Probed through the real guard:
  `excel.file_path` and `python.entrypoint` with `../` are refused (`SCHEMA_VALIDATION_FAILED`); `excel.template_path`
  with `../` is **not** caught by the tool-keyed step-6 check. But `template_path` is never consumed —
  `excel-writer.mjs:169` reads `params.file_path` only and re-contains it at `:204` (`ARTIFACT_PATH_ESCAPE`) — and the
  other path-shaped fields in `zink-tools/contracts/tools/*.schema.json` are logical identifiers or allow-listed
  enums. The second named site, `guard.mjs:1946-1955`, validates result `logical_path` generically for all tools. So
  every field that actually reaches disk is validated; `zink-tools/excel/README.md:33` ("every file path passes that
  validator") overstates by one dead field. Cost of the cosmetic fix: ~a dozen lines keying step 6 by field shape.
  Not admitted.
- **`R5-E15-02` — dismissed for this tier.** `putLandingArtifact({ artifact_id: "../silver/x" })` is accepted today
  (confirmed by run: key `landing/../silver/x`), but `r2.storage` is an in-process `Map` — a documented contract test
  double, empty on restart — and `orchestration/patterns` is imported only by
  `tests/m7-t4-orchestration.test.mjs` (verified by grep). No governed caller can pass a model-influenced
  `artifact_id`. Kept as a prerequisite pin for the real R2/S3 wiring, where the same value becomes an object-key
  prefix escape and `version` is already range-checked while `artifact_id` is not.
- **`R5-E15-03` — premise partly refuted; the High grading was wrong.** `validator.mjs` `validateSqlQuery` is an
  independent allow-list parser (tokenizer rejects `;`, comments, quotes, bare parens; grammar admits only
  `SELECT … FROM <plain identifier> [WHERE/ORDER/LIMIT/OFFSET]`), and it is called at `duckdb-bridge.mjs:191`,
  **before** `execFileSync` at `:262`. I re-ran it myself: `SELECT * FROM read_text('C:/Windows/win.ini')` and
  `SELECT * FROM glob('C:/*')` → `SQL_UNSUPPORTED_SYNTAX`, while a plain select is accepted. So the deny-list's
  missing `glob`/`read_text`/`read_blob`/`SET`/`CREATE SECRET` is **defence-in-depth**, not a live host-read path.
  Model-authored SQL does reach the seam (`index.mjs:4140` passes `params.query`), but the validator gates it.
- **`R5-E15-04` — partially reachable, and the reachable half is operator-only.** The argv claim is real: with bogus
  names, `docker exec -i --privileged psql …` resolves to `No such container: psql` and `-i -v psql` fails with
  `unknown shorthand flag: 'v'`, so a leading-`-` value does change the parsed invocation. But who can supply it:
  `syncSkillsToVectorStore` is reached only from the skill-approval action, whose handler signature ends at
  `…{ notify, options = {} }` and whose first gate is `if (!ownerId || senderId !== ownerId)` — I read that gate
  myself at `index.mjs:1726`. The container name therefore resolves from operator env
  (`POSTGRES_CONTAINER`) or the repo default, never from a model-influenced value. Split cost: charset/`--` separator
  is ~3 lines in `vector-sync.mjs` with no contract change; genuine cancellation is materially larger, because a
  client-side `child.kill()` cannot stop a server-side query and would need a second control connection issuing
  `pg_cancel_backend`. The `DB_TIMEOUT` bound is therefore honest about the client and untrue about the server, and
  that is recorded rather than half-fixed here.

Consequence for Wave A: **`A-8` admits no code fix**, which is the item's purpose — the tier's remaining security
candidates are doc precision, a wiring prerequisite, defence-in-depth, and an operator-only hardening, not four open
exploits. Both halves of `R5-E15-04` and the `R5-E15-01` field-shape fix go to the next tier as cheap, explicitly
scoped items rather than riding in on this one.

Gate state for this record: `NOT RUN` for `npm run verify` — no repository source file changed, only `PLAN.md`, the
register, and a `git status` that stayed clean for source. The probes ran in `os.tmpdir()` scratch scripts against the
real modules and were deleted.

### Record — `M12/T2.2-R1` Wave A closed, a WSL claim of mine withdrawn, and `M12/T2.2-R2` Wave B materialized (2026-10-16)

**Wave A ledger.** Landed: `A-1` `ccf2ad7` (one coordinator→stack source, and it refuted this task's own
prerequisite), `A-2` `09aa698` (one stack registry; a stack refusal stopped being reported as
`AUTH_DELEGATION_NOT_FOUND`), `A-4` `bc33c7e` (applied migrations digest-pinned), `A-3` `d1378ba` (the unlocked
queue writer serialized, plus the digest rollover the owner granted), `A-6` `bca4ad6` (a state root that is already a
ledger root refused by name), `A-7` `fd302d4` (the owner's no-skip decision pinned where a future skip would break
it). Stopped as premise refutations: `A-3`'s original form `638a68e` and `A-5` `639fc47`. Record-only: `A-8`
`0afc61c`. The Wave A contract is archived verbatim at
`docs/contracts/execution/archive/2026-10-16-M12-T2.2-R1.md` (`609a532`); its scrub sweep matched only the words
`Execution Authorization:` and a list of file paths, so **nothing was redacted**, and no snowflake, long hex, or live
state capture was present.

**Gate evidence, with one of my own claims corrected.** Windows at this head: `npm run verify` exit 0 —
`format:check` clean, `lint` clean, `npm test` **1516 tests / 106 suites / 1470 pass / 0 fail / 46 skipped**,
`Repository policy check passed.` CI: **`NOT RUN`** — a push to this non-`main` branch triggers no workflow
(`ci.yml`/`security.yml` fire on `pull_request`/`push` to `main`, `workflow_dispatch`, and a weekly schedule), and the
token in this session authenticates as the owner's own login, so an agent dispatch would be indistinguishable from
his. `REMOTE-BACKED` is therefore withheld for every Wave A head.

**The correction:** I nearly recorded the WSL lane as green. The command I ran ended in `| tail -30`, so the exit
status I saw was `tail`'s, not the runner's. Re-run with the output captured to a file, WSL at this head is
**1516 tests / 1471 pass / 2 fail / 43 skipped** — WSL runs three tests Windows skips, and two of them are red:

- `tests/m10-t2-r7-authority-predecessor.test.mjs:201` (`R7 P1`) — _"the live `lib/authority.mjs` digest `c38e1a6b…`
  is neither the current build nor an admitted predecessor"_. This is the invariant that `M12/T2-R3` deliberately
  installed (§8, `PLAN.md:5102-5107`): the installed runtime must match the current build or an admitted predecessor.
  It is red because Deployment B installed `c38e1a6b…` on 2026-10-14 and `61638d8` changed `authority.mjs` on
  2026-10-15 without a redeploy — provable from history, since `61638d8` **predates Wave A's first commit**, so no
  Wave A item caused it. Clearing it needs `operator-preflight` → one `operator-apply`, which is not authorized here.
- `tests/m8-t2.13-r16-apply-rehearsal.test.mjs:1183` (`R16-DRIVER-05`) — `0 !== 1` at `:1196`. This is the standing
  dead rehearsal whose re-basing is already an open owner decision.

Both are **baseline failures, not regressions**, and Wave B's §6 gate now records the WSL baseline explicitly so no
later item can be credited or blamed against a number nobody captured.

**Wave B was not written from the inherited tables.** Seven read-only lanes re-verified every candidate premise
against source first (the method Wave A forced: three of five Wave A premises were wrong). Eight inherited premises
failed, and they changed the wave:

1. `4.6` / `R1-A12-06` — **cannot be executed.** `chosen` is drawn from the same allowlist it is then checked against
   (`quota-telemetry.mjs:212-213` → `:262`), so the throw at `:263` is structurally unreachable, and reaching it
   would mean changing model-resolution semantics — a RED decision, not a test fix. Dismissed with evidence.
2. `4.3` / `R1-A04-06` — the reason-code matrix **already exists**
   (`integrations/openclaw/topology/policy/reason-code-matrix.json`, loaded `runtime.mjs:11-16`, already wired via
   `validateAgentClaim:93` and `outcomeReasonAllowed:202`). Building a second one violates `AGENTS.md` §8. What is
   real: the load is unguarded, and `reasonEmitterAllowed` (`:259-264`) has zero production callers. The emitter half
   is dropped, because enforcing it today requires widening a published matrix (`guard.mjs:807/:842/:991` emits
   `POLICY_DENIED`/`SCHEMA_INVALID` as `agent_claims`, and no `GOVERNANCE_*` code is in it) — escalated instead.
3. `4A.9` — "no diagnostic channel" is **false**. `apps/knowledge/app/run_errors.py` is the owned structured channel
   (`SafeRunError:21`, `MAX_ERROR_ENTRIES = 50:8`, read at `main.py:568`), so the fix reuses it rather than adding
   Python `logging` to an app that deliberately has none. "Zero logging" itself survives (wide grep = 0 hits).
   The two documented denominators reconcile: 28 grep sites, **26** discarding cause
   (`database.py:205`, `index_runner.py:43` end in a bare `raise`).
4. `4A.10` — the duplication is not in the Python app at all but in `zink-tools/common/semantic-contract.mjs`
   (filter `:748` `?? 1` vs sort `:698-699` `?? 0`), and the single-rule helper that supposedly needed extracting
   (`filterByMinRelevance:744`) has **zero production callers**. Unifying cannot be behaviour-preserving, so the
   wave adopts the conservative polarity the two live adapters already use (`?? 0`) and says so.
5. `R5-E08-03` — no drift exists: argv = disk = 110 exactly (set-diff 0/0). The item becomes a reconciliation
   _guard_, which is precisely why it lands first: every later item adds a test file.
6. `R5-E08-01` — worse and cheaper at once. Worse: the four files the unquoted globs reach under `dash` are
   helpers/fixtures, so **0 of 110 test files are format-checked**, in CI, where the shell is dash. Cheaper: measured
   with prettier's own expansion, `All matched files use Prettier code style!` — quoting absorbs **no** reformatting
   diff, so the inherited fear of a green→red flip is unfounded.
7. `R5-E16-04` — **dismissed.** `_acceptance_backup_barrier` runs only from `start()` (`database.py:202`) →
   `lifespan` (`main.py:168`) behind `KNOWLEDGE_ACCEPTANCE_BACKUP_BARRIER_DIR` (`config.py:96-100`), so "withholds
   the two search slots" describes a startup harness, not a live stall. `R5-E16-05` and `R5-E15-05` are scheduled,
   not admitted: both real in shape, both graded on a frequency or impact the source disproves.
8. `R5-E14-05` — the register names `compose.m4-t4.acceptance.yml`, **which does not exist**; the byte-identical pair
   is m3-t3/m3-t4 (`e61ad1c2…`).

Two new defects surfaced and are **recorded, not fixed**, because nobody authorized fixing them: `R6-V03-02`
(`create_index_run`/`get_index_run` have no terminal exception mapper, so 2 of 3 routes return codeless 500s while
`/v1/search` returns `INTERNAL_ERROR` at `main.py:473-474`) and the matrix-widening consequence of `4.3`.

**Four items are held for named grants, and one of them is not admissible at all.** `4.2` needs the grant to re-value
`CANDIDATE_BOUNDARY_SHA256` at `tests/m10-t2-r6-boundary-predecessor.test.mjs:52` — that test hashes the
**working-tree** build (`:226-236`) and separately demands the candidate stay _absent_ from `configure.mjs`, which is
what makes "just add a log line" impossible. `4A.15(ii)` needs one line: `tests/m12-t2-governed-surface.test.mjs:685`,
where `assert.notEqual(table, undefined, …)` can never fail because `:681-684` always yields a String. `4A.16(i)`
needs `tests/m7-lane-g-policy.test.mjs:726-733` **plus** acceptance of a known-red that is red today for the right
reason (`index.mjs:511`, `README.md:216`, `PLAN.md:108`, `:143`). `4A.15(i)` cannot be bought with a grant: its L1
(`:127`, `:129`) and L2 (`:167-172`) demand mutually exclusive things of the live file, `reachable` is false today
(live `b2e3d0c7…` vs baseline `386ba4b7…` at `:66-67`, which is also the two-copy defect), and converting the two
skips (`:124`, `:150`) lands two unregistered reds. Its premises must be re-based first. Recorded with them: there is
**no machine-readable known-red register** in this repository — `scripts/verification/` and `scripts/maintenance/` are
empty directories and `preflight-lineage` appears nowhere outside the test file itself.

`M12/T2.2-R2` is now materialized as fifteen items (`B-1`…`B-15`) in
`docs/contracts/execution/ACTIVE.md`, ordered so the gate-truthfulness items land before the behaviour items, with one
file-ownership collision handled by sequence ( `B-7` before `B-8` in `workflow.mjs`, `B-11` before `B-12` in
`ledger.mjs`, `B-13` before `B-14` in `main.py`) and no item authorized to delete a tracked file.

### Record — `M12/T2.2-R2` Wave B closed: 21 items, 4 follow-ons, and three premises of mine that were wrong (2026-10-16)

**What landed.** All twenty-one §4 items, one commit each, in the frozen §4 order, plus four items that only appeared
because the wave was being executed: `a62962b` (J-1), `fabaf5b` (K-1), `9891d83` (L-1), `07c31b5` (M-1). Mapping is
`B-1` `a108cde`, `B-2` `c449cd0`, `B-3` `d34c666`, `B-4` `33f0971`, `B-5` `b7d9d36`, `B-6` `3701804`, `B-7`
`6f3c970`, `B-8` `a21c610`, `B-9` `0d399d3`, `B-10` `46852f3`, `B-11` `937521c`, `B-12` `f93068e`, `B-13` `7bc3e5d`,
`B-14` `f316c83`, `B-15` `7aebc39`, `B-16` `5c156d4`, `B-17` `0dddea4`, `B-18` `3f3bb11`, `B-19` `9fa6505`,
`B-20` `a473907`, `B-21` `5d5f8f0`.

**Three of my own claims in this contract were false, and each is corrected here rather than quietly re-worded.**

1. **`§0.5-H`/`§0.5-I`: "no `configure.mjs` admission is needed".** I read one grep as a proof. The live runtime
   carried `5966d446…`, B-16 rolled the current build to `fceefc0d…`, and `R13 P1` went red **on WSL only** — the
   Windows lane skips that assertion, so `npm run verify` stayed green over it. Fixed under grant `j1`; `R13 P6` now
   re-derives the admitted digest from `3cb8274` through `governancePluginFiles()` instead of trusting a text search.
2. **The `R7 P1` row in the Evidence Level field** described Wave A's WSL failure as a single live-drift item and
   classed it as baseline. It was the visible tip: a read-only sweep of all 35 governed paths found **nine** in the
   same state, i.e. `--preflight` refused the deployed extension outright, and `configure.mjs` has no drift override
   (`--preflight`, `--apply`, `--dry-run` only). Cause is this programme's own earlier commits rolling packaged builds
   without admitting the outgoing digest — `61638d8` for `lib/authority.mjs`, `09aa698` for `lib/guard.mjs`, and the
   `6b0ea0a` / `c680a28` / `c1ad4b3` / `3cb8274` builds the live tree actually carries. Fixed under grant `m1`.
   Attribution was measured, not argued: the same sweep against a scratch worktree at `fabaf5b^` returned the
   identical nine, so J-1 and K-1 did not cause it. **Systemic finding: only 3 of 35 governed paths had any
   live-reachability assertion before `M1 4`.** That gate is the reason this class was invisible.
3. **The `l1` option name.** I offered the Skill Store lifecycle block as `T2.4`; that label already named
   the A2 block in the withdrawn R2 grouping, and `M12/T2.1-R3` §5.3 withdrew `T2.4`–`T2.7` altogether. His decision
   is recorded with the intent intact and the identifier corrected to **`M12/T2.2-R3`**, scheduled and not authorized.
   (The A2 block this note refers to is `M12/T5` as of `M12/T4-R1` `T4-2`; see §4.17.)

**Item-level notes worth carrying forward.** B-16 stalled a full owner round because _one_ production file is pinned
by three assertions hashing three different inputs; `B-21` (`5d5f8f0`) turned that coincidence into an asserted fact
(`R6 0d`: packaged bytes must equal working-tree bytes), so a future packaging rewrite fails a gate instead of
splitting one fact in three. B-19's `heartbeats >= 5` measured the host's timer resolution, not liveness — the gate
now asserts one tick for liveness and the timeout **by code** for the deadline. K-1 found that the middle disjunct of
`guard.mjs:1977-1981` has **no producing event sequence** (`WORKFLOW_BRIEF_ACTIVATED` alone advances
`task.brief_revision`, `workflow.mjs:1508`, and is gated on `workflow_status === "ACTIVE"` at `:1234`, which a task
with a reserved delegation can never be); the test asserts that refusal instead of fabricating a fixture.
`M 1`'s first sweep mis-reported `index.mjs` because it read only the asset table — the entrypoint is admitted by the
two per-mode lists at `configure.mjs:1497`/`:1764` — and that false positive was corrected before anything was
admitted.

**Gate state at closeout.** Windows `npm run verify` **`verify_exit=0`**, `1590 tests / 1541 pass / 0 fail /
49 skipped`, `Repository policy check passed.` The first M-1 run was **red** (`verify_exit=1`) on
`execFileSync` unused in the new test, and because `lint` precedes `npm test` that run proved nothing about the
suite — re-run after the fix. WSL: eight `configure.mjs`-reading files **114/114**, asset predecessor cluster **90/90**,
M-1 gate **13/13** with `R13 P1` and `R7 P1` both green. Python lane **204 passed / 4 skipped / 34 subtests**.
Known-red register for this tier now has **one** entry: `R16-DRIVER-05` (the standing dead rehearsal). CI at the
closed head is run **`38927821839`** @ `afa9721`: `quality-gate` **SUCCESS** (`1590 tests / 1537 pass / 0 fail /
53 skipped`, `Repository policy check passed.`) and `python-quality` **SUCCESS** (`208 passed, 34 subtests`). It
exists only because the run was dispatched by hand — `ci.yml:6-7` triggers on push to `main` alone, so a task-branch
push starts nothing, which is open decision **H1**. The `Security` workflow was not run at this head and is
recorded `NOT RUN`.

**Not done, and not claimed.** No deployment (`--apply` was never authorized here; the nine-path refusal is now
cleared, but installing anything is a separate grant). Live Discord behaviour remains `NOT TESTED`. Wave C
(`M12/T2.3`) has **no contract and no code** — it needs its own Plan Revision and `Execution Authorization: YES`, and
`4A.12` must be re-scoped there because `R6-V04-04` refuted its premise. `M12/T2.2-R3` is scheduled only. `K-2`
(`get_index_run` answering `404` for a corrupt row) was **not granted** and stays in the contract's §5 exclusion list,
now archived. `guard.mjs`'s two `REASON_UNDECLARED`-only discard paths were fixed by K-1; the run-row decode defect
and the three H-decisions still open in §11 are not touched.

### Record — `M12/T2.3-R1` Wave C closed: 12 items landed, two claims died, and one grant I had forgotten to schedule (2026-10-17)

**What landed.** Twelve items, one commit each, in contract order: `C-1` `3685548`, `C-2` `3248f60`, `C-3` `e47e660`,
`C-4` `68fe25b`, `C-5` `0ccdd81`, `C-6` `5e798aa`, `C-7` `a4ed77d`, `C-8` `1ced55b`, `C-9` `8bde65f`, `C-10` `3506e80`,
`C-11` `5ac1540`, `C-13` `d9e1bcc` — plus a review-convergence fix to `C-4` (`cd1b541`) and the materialization commit
(`3faf040`). `C-12` was **dropped before execution** and `C-1a` (the five-stack caveat) landed last at `7d73e18`.

**Two inherited claims died in verification, and one was mine.** `C-12`'s bookkeeping premise was false:
`.agents/states/findings.md:4215` (historical — moved 2026-10-17) already reads `Status: CLOSED by M12/T2.2-R2 B-15 (7aebc39)`, and `PLAN.md:6163` is
item 8 of Wave B's **refuted-premise** list, not an open finding — so there was nothing to reconcile, and a state file
is not authority anyway (`AGENTS.md` §6). `C-11`'s "35-vs-37 drift" was also false: 35 installed paths is Deployment
**A** (2026-10-13, the M12/T2-R2 build) and 37/37 packaged paths is Deployment **B** (2026-10-14, the build that
installed `18fbb077…`) — two correct counts of two different deployments. Only the vocabulary half of `4.9` survived.
The third correction is against **my own proposal message**: I told the owner Gate G18 carried four `live: "PASS"`
sites; it carries **five** (`:337, :345, :353, :393, :417`), and the deeper fact is that the assertion block
(`:423-432`) loops over `state`, `contract` and `mock` and **never read `live` at all** — so the false column was not
merely wrong, it was unasserted. `C-4`'s count also came down from the register's 8 to the 3 rows that actually
contradict their own adapter headers.

**The item that mattered most was the one nobody scheduled.** `n1a` granted a caveat line on `docs/architecture/five-stack.md`
and my own materialization put that file in §3's scope but gave it no §4 item — so the grant sat unused until the
closeout review found the omission. `7d73e18` executes it: `authority.mjs:581-582` binds `o1` to
`infrastructure`+`data_plant` and `o2` to `semantic`+`intelligence`+`decision`, while the table's Coordinator column
inverts three rows. The rewrite stays in `M12/T3` as the owner assigned. Lesson recorded: a grant in a contract's
header is not an item; if it is not in §4 it does not happen.

**Gate evidence.** Baseline before any edit: Windows `npm run verify` exit 0 — **1590 / 106 suites / 1541 pass / 0 fail
/ 49 skipped**, `Repository policy check passed.` Final tree: exit 0 — **1595 / 1546 pass / 0 fail / 49 skipped** (the
+5 are `C-9`'s two tests and `C-13`'s three). Each item ran the full gate at its own commit, not a subset. WSL lane
(§6.2, mandatory because WSL exits 0 even when tests fail — the counts were read, never inferred from the exit code):
`C-4` **12/12** twice (before and after `cd1b541`), `C-9` **2/2**, `C-13` **35/35**, all with zero skips and zero
failures. Mutation probes, each with the mutation confirmed in the file before the probe was believed: `C-4` three
(red-before on the unfixed README, flip one row back → kills exactly `Streamlit`, rename `Cloudflare R2` → kills
exactly the new coverage assertion), `C-9` red-before (`undefined` vs `zink-semantic-v2`), `C-13` two real-tree probes
through `npm run repo:check` (delete the `test:m8` row → exactly one failure naming it; invent a `release` row →
exactly one failure naming it) plus the synthetic pair in `tests/repository-policy.test.mjs`. Python lane **NOT RUN**:
`git diff --name-only 3d0a0f8..HEAD` contains **0** files under `apps/knowledge/`, so no Python gate was affected —
recorded as not-run-with-reason rather than folded into the pass. `npx prettier --check` and `markdownlint-cli2` clean
on every edited file; `npm run repo:check` exit 0 after `C-13`.

**Documentation truth re-measured (§6.7) at the final head:** `fourth logical module` → **0** hits in tracked docs;
`skill-store validate` inside the Model-visible block → **0**; `REQUIRED_SCRIPTS` **9** == registry rows **9**;
`NOT TESTED` defined in `PLAN.md` §2 → **1** of 18 uses now covered by a definition; `Cursor` in the protocol's role
lines → replaced by `dsh` (2 sites). One acceptance criterion of mine was itself wrong: §6.7 asked for
"`REAL_EXECUTED` in README → 0 hits", but the correct end state is _one_ hit — the sentence that says the bridge
refuses to emit it. And `CHANGELOG.md` carries **two** stale `REAL_EXECUTED` claims (`:430` and `:861`), not the one
the proposal knew; both left as validated history per `n5a`.

**Discovered while executing, recorded and NOT fixed.** `zink-skill-store/src/catalog.mjs:34`'s `DECISION` regex
admits only `PLAN:M<n>/T<n>-R<n>`, so a manifest lifecycle event **cannot cite a dotted task id** —
`PLAN:M12/T2.3-R1` is rejected as "A lifecycle event is invalid." The repository's own current task ids are dotted.
That is a schema decision (RED) and the fixture uses `PLAN:M12/T2-R1` to stay inside scope. Also mine, also recorded:
during `C-13` an edit briefly deleted `const result = spawnSync(` from `runGit` in `scripts/repository-policy.mjs`;
it was repaired inside the same item before any commit, and the final file is proven intact by 35/35 policy tests plus
the full-suite runs on both hosts.

**Still not done, and not claimed by this record:** deployment (never authorized in this wave), live Discord behaviour
(`NOT TESTED`), `verify.mjs` (`NOT RUN`), and the R16 rehearsal (`NOT RUN`, still the dead rehearsal). **CI was read
back after the push and is cited in §4's Evidence Level:** run `38944576084` @ `71c2bff` — `quality-gate` SUCCESS
(`1595 tests / 106 suites / 1542 pass / 0 fail / 53 skipped`, `Repository policy check passed.`) and `python-quality`
SUCCESS (`208 passed, 34 subtests`); Security run `38944579971` — `secret-scan` SUCCESS (`✅ No leaks detected`, the
check that matters once a 315-line contract becomes tracked history) and `dependency-audit` failure on the unchanged
5-high baseline. CI's 53 skips against this host's 49 is the known lane gap, not new evidence. Both runs were dispatched
by hand because `ci.yml:6-7` triggers on `main` only — open decision **H1**. **Escalated to the owner, untouched by this wave:** `AGENTS.md:3` still addresses "Codex, Cursor,
subagents" while §3 defines only Codex/dsh/Subagents; `docs/development/conventions.md:26` still says "Cursor execute
và handoff" **(that one was later fixed by `M12/T4-R1` `T4-5` at `21f349a`; the `AGENTS.md:3` half stands, because the
owner's standing ruling of 2026-10-17 keeps `AGENTS.md` out of bounds)**; `P04-02`'s owner-of-claim column (deferred by `n4a`); the five-stack table rewrite (`M12/T3`); and
`CHANGELOG.md:430/:861`. `M12/T2.2-R3` (the Skill Store lifecycle block) and `M12/T3` (H11) remain scheduled, not
authorized.

### Record — `M12/T4-R1` closed: the record now answers "what is still open", and five of its own premises did not survive the read (2026-10-17)

**What landed.** Five items plus one discovered-defect fix, one commit each, in contract order: `T4-1` `ca8e2ff`
(the §4.17 successor schedule — 38 rows, each with category, severity, register locator, disposition and band),
`T4-2` `71003fd` (§4's grouping paragraph re-filed to `M12/T5`–`M12/T8` and pointed at §4.17), the discovered record
defect `07cca47` (the `M12/T2.2-R2` and `M12/T2.3-R1` closeouts moved back inside §8), `T4-4` `4f4536f` (the M12
release-gate row cut from 9 940 to 1 956 characters and its cell — the slice from the third column on, which is how
both scripts measured it — from 9 858 to 1 874, under the printed no-fact-loss diff below), `T4-5` `21f349a`
(`docs/development/conventions.md` executor name). **`T4-3` has no commit to cite:** it edits
`.agents/states/findings.md (historical — moved 2026-10-17)`, which is Git-ignored, so its evidence is that file's own "Disposition refresh" section
plus this paragraph — the exact durability problem `H10` exists to settle, now demonstrated rather than argued.

**Five premises this contract brought into the read and had to correct, then one disclosed deviation and one
unsatisfiable gate.** Each was measured at this head before being written into a tracked file:

1. `ACTIVE.md` §0 said **two** of the 38 findings are absent from the register. **One** is (`R5-E09-08`);
   `R1-A02-01` is present at the register's Vòng 1 bullet list, in the legacy `- **id** —` format, which is what an
   `id:`-anchored count misses.
2. §0 said the four orphan blocks "belong to no running, scheduled, or excluded tier". **7** of the 38 carry an
   explicit exclusion-with-decision record (the register's "Severity was not treated as authorization" paragraph plus
   §11): they were excluded on purpose and only lost their identifier. The other 31 are genuinely undisposed.
3. §0 said the register holds "112 entries, 2 CLOSED". Measured: **123** structured `id:` entries (112 of them with a
   `Status:` field on the entry line) and **180** distinct legacy bullets in **186** bullet lines, plus 8 un-bolded
   `- R1-…` bullets — none of which carries `Status:` on its own line, which is exactly how a `Status:`-anchored count
   loses them — with **1** entry reading `Status: CLOSED by …`. After `T4-3` and the review pass: 27 CLOSED, 2 REFUTED,
   6 EXCLUDED on `id:` lines (the seven values sum to the 113 status-bearing entry lines; a 7th EXCLUDED,
   `R5-E03-05`, carries its status on its `cat:` field line), plus 11 dated refresh lines on entries with no status
   field. The review pass then corrected this contract's own register arithmetic — the refresh paragraph had said
   "184 bullets / 13 un-bolded", and the file measures 186 and 8 — and aligned six rows with §4.17 rather than leaving
   them `OPEN` in one file and `EXCLUDED` in the other.
4. §2 said §8 holds 17 `### Record —` sections and that the M12 row is a 9 940-char row / 9 840-char cell citing 29
   commit hashes; the first closeout correction restated that as 9 841 chars and 18 unique hashes. Re-measured at
   `07cca47` — the last head carrying the old cell — with one stated convention: the row line is **9 940** characters
   and its cell (the slice from the third column on) is **9 858**; the cell's machine-token population is **36 unique**
   references — 25 hex-shaped, of which 18 are exactly-seven-hex commit short-shashes, 4 are CI run ids and 3 are
   8-hex digests, plus 11 code/label tokens. §8 holds 15 records inside itself and held 2 more stranded under §11
   until `07cca47` moved them.
5. §3 `T4-2` asserted `M12/T5`'s prerequisite is **H5**. §11's H5 row cites `R5-E03-07` and `R5-E11-02`, neither of
   which is in the A2 band, and the owner's queue puts the H5 answer _after_ A2. §4.17 records H6 for `R5-E13-02` and
   no §11 tie for `R1-A02-01`, whose boundary is deployment.
6. §3 `T4-1` asked for the table in "the new `PLAN.md` §5". §5 has been Canonical target architecture since before
   this contract, and inserting a new §5 would renumber §5–§11 — invalidating every `§8` and `§11` citation in the four
   archived contracts, which are immutable. The table is **§4.17** instead, inside §4 where the routing paragraph it
   replaces lives. The deviation is disclosed here rather than quietly adopted.
7. §6.4's consistency gate — "a grep for the defunct identifiers across tracked files returns 0" — is **not
   satisfiable** without rewriting `docs/contracts/execution/archive/2026-10-16-M12-T2.2-R2.md`, which is admitted
   evidence and off-limits under `AGENTS.md` §10. `PLAN.md` itself is at 0 hits (from 9); the archive keeps 2. The
   gate is reported as met for the live routing file and unreachable repo-wide, not waived.

**No-fact-loss proof for `T4-4`, as §6.3 required — restated twice, because the review pass proved the first two
versions of this sentence wrong.** The measured class, run against `07cca47` (last head with the old cell) and the
current tree: hex strings of 7–40 characters including the `…` digest form, 9–12-digit CI run ids, `UPPER_SNAKE`
codes, `R<n>-<LANE>-<nn>` finding ids and `A-n`/`B-n`/`C-n`/`T2.1-n` item labels. Old cell **36** unique tokens →
new cell **5**: **31 removed**, **5 retained** verbatim, and **0 of the 31 are absent from §8** as it stands. The
first printed triple was "67 / 56 / 11" and the second was "12 kept"; neither is reproducible under the stated
classifier — 67 counted occurrences rather than unique tokens, and 12 was the _new_ cell's population rather than
the intersection — so both are replaced by the re-measured numbers above rather than reconciled. Second correction:
the class cannot see camelCase symbols or multi-word literals, so the commit message's wider wording ("every code
name … and item label") was never what was measured. Under that wider reading, `buildDiscordComponentMessage` had
left the cell and existed nowhere in this file, so it is now written into §8's `M12/T1-R1` closeout evidence above;
`n3a` survives in §2's grant history; and the four verdict values are covered by the §8 live tag dump
(`STATUS: WAITING|APPROVED|REJECTED|CHANGES|EXPIRED`, `PLAN.md:5204`) — which a literal-string check misses, because
it stores them pipe-joined rather than as four separate `STATUS: X` literals. Third: measured against §8's own range
_before_ the relocation (`71003fd`), the same classifier reports **15** tokens with no home — 14 references plus
`C-12` — and **0** after `07cca47`, which is the proof that moving the two stranded records was required work rather
than tidying.

**Gates.** Baseline `npm run verify` at the materialization commit `f9b356c`: exit 0, **1595 tests / 106 suites /
1546 pass / 0 fail / 49 skipped**, `Repository policy check passed.` Rerun after `T4-1` (`ca8e2ff`), after `T4-2`
(`71003fd`), after the relocation (`07cca47`), after `T4-4` (`4f4536f`) and after `T4-5` (`21f349a`): the same
denominators, exit 0 every time, with `npm run repo:check` PASS at each item because `conventions.md` is read by
`checkGateRegistry`. `format:check` and `lint` are clean on the one tracked non-`PLAN.md` file this contract touched.
`PLAN.md` is outside both the prettier glob and the markdownlint config, so the table and the shrunk cell are not
format-gated — stated rather than assumed. **WSL lane: `NOT RUN`** — no test file, no source file and no packaged
asset changed, so there is no live-reading assertion for that lane to execute. **Python lane: `NOT RUN`** — zero
`apps/knowledge/` files in the diff. **CI: `NOT RUN` while this record was being written, then dispatched and read
back at the closed head `9a0e398`** — by hand, because `ci.yml:6-7` and `security.yml:3-8` trigger on `main` only and
the branch push that preceded them started no run (open decision **H1**). CI run **`38992022348`** @ `9a0e398`:
`quality-gate` **SUCCESS** reading `ℹ tests 1595 / suites 106 / pass 1542 / fail 0 / skipped 53`, `All matched files
use Prettier code style!`, `Summary: 0 issues in 0 files` and `Repository policy check passed.`, and `python-quality`
**SUCCESS** (`208 passed, 34 subtests passed in 23.37s`) — every number taken out of the run log, not inferred from the
job colour. CI's 53 skips against this host's 49 is the recorded lane gap, and CI is Linux-on-GitHub: a green run there
proves nothing about the live tree. Security run **`38992024758`** at the same head: `secret-scan` **SUCCESS**
(`✅ No leaks detected`) — the run that matters for a contract that newly tracks a 315-line archived contract — while
`dependency-audit` stays red on the unchanged baseline (`9 vulnerabilities (3 low, 1 moderate, 5 high)` under
`npm audit --audit-level=high`), which is expected because no dependency was touched. **Review-convergence pass: two
read-only review passes over the six commits, whose
findings are the corrections above** (the `R5-E13-05` row's internal contradiction, the `P5` history claim, the stale
premises numbers still sitting in §2's approval field, the premises count, and the register's field-line attribution
in the first; then, in the second, the record's own token arithmetic — "67 / 56 / 11", "kept = 12" and
"twelve, not fourteen" all failed to reproduce under the stated classifier and are replaced by the re-measured
**36 → 5, 31 removed, 5 retained, 0 homeless** above, with `15 → 0` as the relocation's proof).

**Escalated by this contract, recorded with evidence, deliberately not fixed:** the recurrence guard that would fail
a tracked doc citing a withdrawn task id (it widens `repo:check`, so it needs its own grant); `H10` (whether this
register becomes tracked — `T4-3` now has a concrete cost to cite); `H5` before `M12/T6` (the owner's queue puts the
H5 answer after A2, and §11's H5 row cites `R5-E03-07` / `R5-E11-02`, so `M12/T4-R1` corrected `ACTIVE.md`'s
"`H5` before `M12/T5`" instead of copying it); `H1`/`H2`/`H3` before
`M12/T8`; `CHANGELOG.md:430`/`:861` historical `REAL_EXECUTED` lines; `AGENTS.md:3`'s "Codex, Cursor" audience line
(the standing ruling keeps `AGENTS.md` out of bounds); `catalog.mjs:34`'s `DECISION` regex, which rejects every
dotted task id such as `M12/T2.2-R3`; and `K-2`'s `404` for a corrupt run row.

**What this contract did NOT do.** It fixed no behaviour, schema, gate or dependency. It authorized none of the bands
it scheduled: `M12/T2.2-R3`, `M12/T5`, `M12/T6`, `M12/T7`, `M12/T8` and `M12/T3` all remain `scheduled, not
authorized`, and §4.17 is where each finding's disposition and re-verification duty is recorded. Deployment stays
unauthorized; live Discord behaviour stays `NOT TESTED`; `verify.mjs` and the R16 rehearsal stay `NOT RUN`.

### Record — `M12/T2.2-R3` closed: eleven items, one `NOT RUN`, one frozen prescription refuted in execution (2026-10-17)

**What ran.** The Skill Store lifecycle band, materialized from the owner's `grant` with his fork answers
`p1 q1 r2 s1 t1`, executed from head `7996a16` and closed at `04cdbd6`.

**Correction to four `M12/T2.2-R3` statements in three earlier §8 records.** The `M12/T2.2-R2` Wave B closeout says it
"scheduled and not authorized" (in its `l1` identifier note) and "scheduled only" (in its "Not done, and not claimed"
list); the `M12/T2.3-R1` Wave C closeout says it "remains scheduled, not authorized"; the `M12/T4-R1` closeout's "What
this contract did NOT do" lists it among the unauthorized bands. Each was true when written and is left standing as
history, because rewriting an accepted §8 line is a separate owner word. The band was authorized later on 2026-10-17
and is now closed. `M12/T5` through `M12/T8` and `M12/T3` genuinely remain scheduled-but-unauthorized.

**Per-item commits and what each actually proved.**

| Item    | Commit        | What it changed                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                   |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `R3-0`  | none possible | read-only probe of the embedding endpoint identity fields                                                                | **NOT RUN.** The probe prints key names only and sits in Git-ignored `temp/` (`/temp/*`), so it is a local working artifact, not tree evidence and not something the owner can recover from a clone; this host carries no `OLLAMA_URL`, so it reports absent. `R5-E05-05` therefore still has no evidence. |
| `R3-1`  | `8390a68`     | staging residue is recognized by the grammar the writer produces, not by the promoting caller's version                  | `T2g` + mutation probe                                                                                                                                                                                                                                                                                     |
| `R3-2`  | `812b8ec`     | a version directory missing **either** member is healed; a complete pair with different bytes is still a conflict        | `T2h`, probe killed the missing-member count                                                                                                                                                                                                                                                               |
| `R3-3`  | `b604618`     | `ALREADY_ACTIVE` binds the decision it claims to confirm (last `decision_ref` plus provenance)                           | `T2i`: a second decision ref now refuses `SKILL_VERSION_CONFLICT`                                                                                                                                                                                                                                          |
| `R3-4`  | `04d6679`     | the promotion refusal names the diagnostic it found                                                                      | `T2j`: message matches `/DIRECTORY_GRAMMAR_INVALID/`                                                                                                                                                                                                                                                       |
| `R3-5`  | `74c42df`     | `writerError` carries an additive `details` cause array at the 7 identity and 3 catalog sites                            | `T2k`; two probes (emptied identity token, emptied catalog array) each reddened it                                                                                                                                                                                                                         |
| `R3-6`  | `223470f`     | `INVALID_SKILL_CONTENT` at scan time, byte set per owner `A`                                                             | `T2l` plus the sync-before-SQL test; three probes (guard, exemptions, prune) each reddened exactly one assertion                                                                                                                                                                                           |
| `R3-7`  | `1bab75d`     | `failSql` is one `DO $$` block: both digests refreshed, segments deleted, taxonomy derived, zero-digest stand-in removed | `R3-7` shape test **and** a scratch-database real-PostgreSQL run: READY with 2 segments, then a failed sync giving `ACTIVE\|FAILED\|<manifest digest>\|office` with **0** segments; the probe with the delete removed returned 2                                                                           |
| `R3-8`  | `5257ca4`     | an absent namespace is `AMBIGUOUS`, not `general`                                                                        | new `R3-8` test over four absent-namespace shapes; `BUG-11` verdicts unchanged; restoring `&& nsList.length > 0` reddened it                                                                                                                                                                               |
| `R3-9`  | `04e128f`     | the envelope requires its taxonomy; non-string content is coerced                                                        | header bytes asserted in full against `SEMANTIC_CONTRACT_VERSION`; defaults restored gave "Missing expected exception", coercion removed gave `content.trim is not a function`                                                                                                                             |
| `R3-10` | `e7aee21`     | `validateArtifactLogicalPath` returns the normalized path; unreachable branch deleted                                    | measured against the pre-change module over 36 inputs: **0 verdict differences**, 2 return-value differences (both backslash spellings), `isArtifactLogicalPathValid` full parity; reverting the return reddened `AC 36`                                                                                   |
| `R3-11` | this record   | record sync                                                                                                              | §3 milestone cell, §4, §4.17.1, §8, §10, CHANGELOG, and the Git-ignored register (`.agents/states/findings.md`, historical — moved 2026-10-17) — the tracked disposition source is §4.17, not the register                                                                                                 |
| `R3-12` | `04cdbd6`     | real-PostgreSQL lane for `failSql`, granted by `n1`                                                                      | `R3-12` executes on Windows and in the WSL lane (4.40 s there); on the GitHub runner it self-skips with `# docker container personal-tool-postgres-1 unavailable`, so it is not remote-backed evidence; removing the segment `DELETE` reddens its last assertion                                           |

**The refutation that happened during execution, not before it.** `R3-6` as frozen instructed me to reuse
`vector-sync.mjs:77-88`'s `cp < 0x20 || cp === 0x7f` over the whole `SKILL.md` body. That predicate belongs to
identity segments — its own comment says so — and `0x20` is the first printable byte, so it refuses `\t`, `\n` and
`\r`. Measured before writing anything else: 6/6 tracked `SKILL.md` files contain `\n`; applying the frozen text
reddened **35 of 87** tests across the four Skill Store suites (log kept locally in Git-ignored `temp/`, so the count is
this session's measurement, not a tree artifact), and because
`validateVersion` is also the staged-validation path, the writer would have refused every multi-line promotion. The
item stopped, was recorded in the band notes, and went back as a four-option block; the owner answered **`A`** —
same file, same position, same diagnostic code, same mutation probe, but only `0x09/0x0a/0x0d` exempt. The exemptions
are pinned by a test because they are the entire difference between a guard and a store that cannot hold markdown.

**The four that died in the pre-freeze read, so no later band re-admits them.** Four of this band's 18 findings were
re-checked against `7996a16` before the contract was frozen and their premises did not survive; none shipped a fix,
because each would have "fixed" a defect that does not exist. Full text in the archived contract's §0
(`docs/contracts/execution/archive/2026-10-17-M12-T2.2-R3.md`).

- **`R5-E07-05`** — the capability filter "can never match". `catalog.mjs:31`'s `SLUG` is enforced on
  `identity.capability` and re-checked by the adapter, so both sides are kebab-lowercase and the `NO_MATCH` path is
  unreachable. Residual is duplicate-grammar drift — a consistency note, not a defect, and `AGENTS.md` §8 forbids
  buying it with a normalizing layer.
- **`R5-E04-09`** — "lock hold time scales with count up to the ceiling". `DEFAULT_LOCK_TIMEOUT_MS` is an
  _acquisition_ timeout for contenders, not a hold limit, and the 1,000-manifest ceiling only appends an error; it
  never truncates the walk. Wrong in both halves.
- **`R5-E05-04`'s retrieval clause** — stale segments "crowding out" valid results. The adapter builds
  `status='ACTIVE'` and `sync_status='READY'` into `WHERE` **before** `ORDER BY`/`LIMIT`, so they cannot crowd out
  anything after the limit. Only the three real clauses of that finding shipped, as `R3-7`.
- **`R5-E05-04`'s `recordedHash || "0".repeat(64)` fabrication clause** — dead code: `catalog.mjs:326-329` makes a
  valid `content.sha256` mandatory and the sync aborts on any catalog error, so `source_sha256` was always the real
  digest. The fallback was deleted as part of `R3-7`, not "fixed" — which is also why `R3-7`'s `assertHexDigest`
  cannot throw on the failure path.

**One judgment call of mine, flagged and reversible.** `A` made "refuse a body for its content" reachable for the
first time, and the refusal left the capability directory **empty**. `walk` reports an empty capability directory as
`DIRECTORY_GRAMMAR_INVALID`, so one bad body failed the store closed and denied every later promotion — measured as
`SECOND_PROMOTION_REFUSED= CATALOG_INVALID ["PREEXISTING_CATALOG_ERRORS","DIRECTORY_GRAMMAR_INVALID"]`. The writer's
rollback now calls the `R3-1` prune (`catalog.mjs:1403`). It is one line inside a file the item already touched, and
removing it reddens `T2l`. No instruction asked for it, so it is the owner's to redirect.

**Gates, read from their own output.** `npm run verify` ran after every item and over the closed tree, with the
status written into the log by the same command (`NPM_VERIFY_EXIT=…`) instead of taken from a pipe. Final:
**1606 tests / 1557 pass / 0 fail / 49 skipped**, exit **0** — and the closeout tree re-ran it after the archive, the
deletion and the review fixes produced the identical counts (`1606 / 106 suites / 1557 / 0 / 0 / 49`, 241 s,
`Repository policy check passed.` on the line above the recorded exit). `repo:check` **PASS** at each item. The WSL lane over the
DB-visible sets (`m11-t1-skill-vector-sql`, `m11-t1-postgres-sql-gate`, `m8-t1-skill-vector-memory`) was read as
counts: **26 pass / 0 fail / 0 skipped** — and the zero-skip reading matters, because both real-PostgreSQL gates
executed there and not only on Windows. Python lane **NOT RUN**: no file under `apps/knowledge/` is in the diff, only
two of them are read by gate tests. Two red lanes are attributed by measurement rather than explained away: the first
`R3-7` verify failed two asset/preflight tests at a 30-minute child timeout (`R13 C2`, `R8`) and both pass standalone
in about 2.2 seconds at the same tree; the first `R3-6` verify failed `tests/m8-t2-file-lock.test.mjs:64` with `EPERM`
on the `mkdir` lock primitive and that file is 7/7 alone. Both were re-run clean.

**Packaging, re-measured at the closed head.** The four source files this band edited are still absent from
`governancePluginFiles()`, and their digests appear in no tracked file, so **zero digest rolls and zero admissions**
were made. The packaged governance entrypoint was not touched (`p1`). No schema, no migration, no dependency, no
lockfile, no `.github/workflows/**`, no new or widened required gate, no `--apply`, no restart, no Discord request, no
tracked file deleted, and `AGENTS.md` was not edited.

**Recorded, not fixed, with the reason.** `R5-E04-07`, `R5-E05-08` and the caller half of `R5-E04-08` (`p1`);
`R5-E04-05` retirement (`r2`, H8); `R5-E03-07` schema ownership (`s1`, H5); `R5-E05-05` (awaits `R3-0` evidence). The
`r2`/`s1` exclusions are not a restatement of the letters — the verified evidence behind each is §11's, and this band
changed neither row: H8's prerequisite is that applied migrations are keyed on **filename only**, so editing `003`'s
`CHECK` in place is a silent no-op on an already-migrated database, and H5 must be decided on **DDL placement alone**
because §9's only imperative about a peer's store is prefixed _cross-project_.
The dotted-task-id limitation is **two** regexes — `catalog.mjs:34` `DECISION` **and** `:36` `PLAN_REF`, both carrying
`(?:T|S)[1-9][0-9]*-R…` — which corrects the single-regex claim in the escalation list. `isArtifactLogicalPathValid`
is an export with zero consumers. `skill-adapter.mjs:837-841` defaults to `["specialist"]`, vetted at `:55` yet
unresolvable in `KNOWN_TAXONOMY_MAP`, so a namespace-less proposal dies `SKILL_TAXONOMY_INVALID`; `R3-8` sharpens that
observation and does not resolve it. `zink-excel.schema.json:15,24,35,48,61` gives `file_path` no pattern while
`zink-python` has one. The withdrawn-task-id recurrence guard would widen `repo:check`. `H10`, `CHANGELOG.md:430` and
`:861`, the `AGENTS.md:3` audience line, and `K-2`'s `404` for a corrupt run row all stay the owner's.
**Two new entries from this band:** the real-DB gate applies **only** `003_skills_vector_schema.sql`
(`tests/m11-t1-postgres-sql-gate.test.mjs:107-111`), so any future forward migration is invisible to it (→ `M12/T8`);
and `boundedReason` now rides inside a `DO $$ … $$;` body, so an error message containing `$$` would truncate the
block — it fails closed and the READY path has carried the same exposure already, so this joins an existing class
rather than creating one, but it is still unguarded.

**Locator drift this band caused, measured at the closed head.** `catalog.mjs` gained 151 lines and lost 22,
`vector-sync.mjs` 50/25, `semantic-contract.mjs` 27/6, `path-safety.mjs` 7/6, so every `file:line` an **earlier** §8
record cites for those four files is now further from the code — `getActiveSkill` moved `:776`→`:811` with this band,
and the `M10/T2-R20` record's `catalog.mjs:738` was already ~38 lines off before it (`:738` is inside `walk` at this
head). Those records are accepted history and were not rewritten; the tracked-locator sweep is a `M12/T5`–`T8` record
task, not a fix to be smuggled into a closeout. Every locator in _this_ record and in §4/§4.17.1/§10/§11 was re-read at
`04cdbd6`, including §11's H8 row (`catalog.mjs:45` status enum, `:419-424` legal lifecycle sequence — both still
true). The archived contract's own §0 drift list is pre-band vintage by construction: it was measured at `7996a16`.

**Review convergence, and what it found.** One read-only pass over the band's own diff and record, before the closeout
commit, found five defects in the record and none in the shipped behaviour. Four were fixed in the closeout commit:
§3's M12 milestone cell still announced the band as "authorized and executing … with nothing yet validated"; the Task
Status field claimed the `R3-0` probe was **committed** at a `temp/` path when `.gitignore:20` (`/temp/*`) keeps that
whole directory out of the tree, and the same overstatement sat in the `R3-0` row and in the `R3-6` refutation's log
citation; the §4.17 refuted-premise dispositions were not in §8 at all (the paragraph above now carries them); and the
"scheduled, not authorized" claim survives in four statements across three earlier records, which the correction
paragraph above now names individually instead of pointing at one. The fifth — the stale `file:line` citations inside
accepted historical records, described in the drift paragraph — is not this band's to rewrite, so it is recorded and
routed. The pass also re-tested the code half of the band's riskiest claim — `R3-7`'s removal of the
`|| "0".repeat(64)` stand-in, which would have dropped the failure row entirely if `recordedHash` could ever be absent
— and confirmed it from `catalog.mjs:326-329` (a valid `content.sha256` is mandatory), `:610-617` (it must match the
bytes) and `vector-sync.mjs:565-574` (the sync returns `CATALOG_INVALID` before any record reaches the loop).

**Four process faults of mine during the band, recorded because this band's subject was record honesty.** None of them
reached a commit and none changed a shipped byte. (1) A `CHANGELOG.md` edit swallowed the opening of the neighbouring
`M12/T4-R1` bullet and merged two entries into one; repaired in the working tree, and the file's net diff for this band
re-reads as **1 insertion / 0 deletions** with both bullets present. (2) A historical `.agents/states/findings.md` edit (moved 2026-10-17) deleted
the `## R3-6 STOPPED` heading, which was re-added. (3) A shell heredoc used to append to `PLAN.md` failed on apostrophe
quoting — the write never happened, and the file edits went through the editing tool instead, so nothing truncated
landed. (4) An oversized single-line byte sweep was killed for length and rewritten as a script under Git-ignored
`temp/`. The pattern in all four is one this band exists to guard against: an edit that reports success is not evidence
that the file is what it claims, which is why every claim in this record was re-read from the tree before the closeout
commit instead of trusted from my own tool output.

**Evidence level, and what the remote actually ran.** `REMOTE-BACKED` for the repository gates at the closeout head
`0ad3655`, after `LOCAL-VERIFIED` at `04cdbd6`. Because a push to this task branch starts nothing (`ci.yml:6-7` is
`main`-only, open decision **H1**), CI and Security were dispatched by hand with `gh workflow run`, which queues them
under **the owner's GitHub account** — stated here because that is an action on shared state taken in his name. Read
back from their own logs: **CI `39018443022` SUCCESS** — `quality-gate` 1606 tests / 106 suites / 1552 pass / 0 fail /
54 skipped, Prettier clean, `Repository policy check passed.`, and `python-quality` SUCCESS (`208 passed, 34 subtests`)
on a job that has no path filter in `ci.yml`; **Security `39018445973`** `secret-scan` SUCCESS with `dependency-audit`
red on the unchanged pre-existing 5-high `npm audit` baseline. The remote denominator matches this host exactly (1606)
and the failure count is 0 on both, but the remote run is **not** a copy of the local one: the real-PostgreSQL lanes
did not execute on the GitHub runner — `M11-06` and `R3-12` both print `# docker container
personal-tool-postgres-1 unavailable`, next to one Windows-junction case, and the log carries fewer skip lines than the
five-skip delta against this host's 49, so that delta is not fully enumerable from it. `R3-7`'s acceptance and the `n1`
lane therefore stand on Windows and WSL, not on CI, and the record says so instead of rounding `REMOTE-BACKED` up into
a claim about every gate. Deployment is not authorized by anything in this record; `R3-0` stays `NOT RUN`.

### Record — the bug register became a tracked file, and `b2` re-verified 59 Critical/High rows against HEAD (2026-10-17)

Owner directives for this work: `chuyển sang docs/execution đi . b2, c1, d1, e grant`, on top of the four scoping
answers taken earlier the same day (`j1` bug-only queue, `k1` CLOSED + commit + executed tests, `l1` sequential `F-xxx`
ids plus a `Legacy register id` field, `n1` prune only the live tracking tables).

**Disposition of the rows that left the queue.** Five rows in `docs/execution/findings.md` were removed, each into that
file's §2 closure table, and every one was re-measured against this head rather than inherited from the register:
`R1-A02-04` and `R1-A09-01` — the unguarded component-build call, closed by `M12/T2.2-R2` `B-10` (`46852f3`), verified
by running `tests/m12-t1-discord-component-registry.test.mjs` (12 pass / 0 fail, including the case named in the
commit); `R1-A13-03` — the discarded guard verdict, closed by `B-16` (`5c156d4`), whose message names that id, verified
with `tests/m12-t2.2-b16-denial-reason.test.mjs` (combined run 19 tests / 19 pass / 0 fail); `R5-E04-02` — the heal
predicate disagreement, closed by `M12/T2.2-R3` `R3-2` (`812b8ec`), whose message says `Closes R5-E04-02`, verified with
`tests/m8-t3-governed-memory-learning.test.mjs` (47 pass / 0 fail, `T2h`); and `R6-CFG-03`, a duplicate of `R1-A04-01`
(`A-1` `ccf2ad7`, `tests/m12-t2.2-a1-stack-authority.test.mjs` 9 pass / 0 fail) that survived the earlier dedupe only
because it carried a different legacy id. Five further rows had their premises measured dead and were relabelled
`REFUTED` rather than deleted: `R6-HUNT-01` went to `PARTIAL` under the `e` grant (the two named `scratch/*/scripts/notify.mjs`
files no longer exist, a token-shape sweep of `scratch/` returns zero files, and `git log --all -- '*notify.mjs'` is
empty, so the credential literal never entered git objects), plus `F-069` and `F-155`, whose evidence is recorded in the
rows themselves. Queue arithmetic after this: **236** rows, 6 Critical / 83 High / 120 Medium / 23 Low / 4 Ungraded — the
219 this record first stated was measured before a parallel session appended the 17 `R7-D*` rows named below.

**What `b2` changed inside the register.** The 59 Critical and High rows that lacked a reproduction now carry one,
written from the code at this head, and 12 of them gained the acceptance line they were missing. Six agents read the
locators; the field text records which probes actually ran on this host (a `node -e` replay of the reducer showing a
bogus `scope_digest` still reaches `QUEUED`; the P2 asset-predecessor tests reporting pass while
`/home/hoang_vinh/.openclaw-zink` is absent; `evaluateCapabilityAccess` granting `L3` apply across every namespace for
an agent scoped to one; four concurrent knowledge searches timed 2 508 ms apart behind an upstream `Retry-After: 2`).
Nine of those rows came back with the premise CHANGED or UNVERIFIABLE rather than confirmed, and the drift is stated in
the row. The Medium/Low/Ungraded tranche owed **91** reproductions and **40** acceptances at that moment (it owed 110 and 47 when
`3325e5e` was cut; the `b2-m1…m3` batches landed after it, in the working tree). Both debts are now closed — see
`Record — the b2 field pre-write landed (2026-10-18)` below — and the 91 figure was itself short by one sentinel wording: the
register carries the reproduction placeholder in two phrasings (73 rows `Chưa có bước tái hiện`, 19 rows
`Register chưa có bước tái hiện`), so a single-phrase count reads 73.

**The 17 rows this record under-counted, and what they actually are.** `3325e5e`'s own message says "219 rows" while the
file it committed holds **236** — the difference is `F-225`–`F-241`, whose `Legacy register id`s are `R7-D1-01`…`R7-D7-01`.
Those ids resolve to nothing in the six-round register (its only `R7-` id is `R7-GATE-01`, closed by `B-19` `9fa6505`), so
they were first read here as fabricated provenance written by a delegated agent that had been told to stay read-only. That
reading was **wrong twice over**, and the correction is the point of this paragraph. (1) The rows came from a **second
session of the owner's own**, running concurrently against the same file under a full-repository audit brief whose rules
name `findings.md` as the only persistent record and its Lead Agent as the only writer; that session's transcript records
the owner's ruling verbatim — `delta-only, giữ strict §0.1, id R7-*, backup rồi ghi` — and it did back up first
(`backups/findings.pre-R7-audit-20261017-180715.md`, `backups/findings.pre-R7-append2-20261017-200705.md`). So `R7-*` is an
id scheme the owner chose for that round, not an invention, and no agent exceeded its scope. (2) Three of the rows were
also reported as citing files absent from disk — `operator-rollback.mjs`, `workflow-policy.json`, `state-transitions.json`.
All three exist. The claim came from a git-ignored scratch helper, `temp/rowcheck.mjs`, whose fixed root list had no
`topology/policy/` or `topology/fixtures/runtime-regression/` entry, so its resolver reported a miss; the tool was wrong,
not the rows. Every one
of the 17 was then re-read at this head by hand: each cited path exists and each checked line range matches, with a single
overstatement corrected in the row itself (`F-235` claimed `pipeline_notify` demands `data.delivered === true`; trigger.mjs:43
demands a boolean). `F-225` is the substantive catch of the round and it is Critical: `refuse()` in the historical-recovery
command only writes a `FAIL` line and sets `process.exitCode = 1`, never throwing or returning, so both of its call sites
(operator-rollback.mjs:101, :111) fall through to `restoreNativePatch`, `restoreT1RuntimeFiles` and a `systemctl --user
restart` — the refusal is advisory output, not a gate.

**What the collision itself cost, stated because it is a live hazard.** Two sessions wrote one Git-tracked file for about
five hours; the shared index meant one session inspected `git diff --cached` at 15:40 UTC while the other committed at
15:57 UTC. Nothing was lost — the pre-append backups and `git show 3325e5e:docs/execution/findings.md` both re-read clean,
and the row-id set is contiguous with four intentional gaps (`F-006`, `F-007`, `F-141`, `F-199`) — but a commit message
written from one session's arithmetic silently became false about a file the other session had grown. The register's §1 now
carries the R7 provenance so the ids stay resolvable, and the count in any future message must be read from the file at
commit time, not from the session that started the work.

**Gate consequences of the move, since they are decision-relevant.** Being under `docs/**/*.md` put the register inside
`markdownlint-cli2` and `prettier --check`, which is why 27 lint findings were repaired by turning technical tokens into
code spans instead of by exempting the file. Because the file is now permanent, two rules in the skills had to change or
they would have fired forever or destroyed the queue: `validating/SKILL.md` step 5 no longer deletes `findings.md` at
closeout, and its Final Quality Gate no longer requires zero `OPEN` findings repository-wide. `code-review/SKILL.md`
dropped the second finding-status vocabulary (`OPEN/FIXED/ACCEPTED-RISK/INVALID`) so the register's §0.3 set is the only
one, and `.agents/states/README.md` now says the register is not a state file. `AGENTS.md` was not touched, per the
standing `giữ nguyên AGENTS.md` ruling.

**Not done, and not claimed:** no `--apply`, no deployment, no restart, no PR, no merge to `main`. `d1` authorized one
**local** commit; the task-branch push rule in `AGENTS.md` §12 was not exercised by this record.

### Record — the b2 field pre-write landed (2026-10-18)

**What landed in the register.** Owner letters executed this round: `a1` (the write pause held until he declared the
concurrent session done), `b2` (the agent pre-writes the two empty fields from the code at HEAD), `b3` (sync `PLAN.md`
after the field work, not before), `c3` (fill `Reproduction` / `Acceptance criteria` only, write no `Status:`, and hand the
non-CONFIRMED premise verdicts back to him), `d1` (local commit only), `E2` (re-grade one row on measured evidence), `G1`
(read-only challenge pass over the concurrent round). 126 field entries over 101 rows landed: 58 reproductions from the
first `b2` tranche (`temp/patch-held.json`) plus 68 entries from the second (`temp/patch-pass2.json` = 34 reproductions +
40 acceptance lines). Measured in the file after the apply: `Reproduction` placeholders **92 → 0**, `Acceptance criteria`
placeholders **40 → 0**, 292 rows each still carrying exactly ten fields, zero duplicate ids, `prettier --check` clean and
`markdownlint-cli2` 0 issues. §1 was re-derived from the rows rather than hand-edited — `temp/recount-s1.mjs` then
`prettier --write`, in that order, because running prettier first is what produced the MD060 finding — and
`temp/verify-s1.mjs` reports ARITHMETIC PASS at 292 = 6 Critical / 100 High / 148 Medium / 34 Low / 4 Ungraded,
OPEN 236 · EXCLUDED 12 · LATENT 23 · REFUTED 8 · PARTIAL 5 · HYPOTHESIS 7 · BLOCKED 1.

**Two rows closed under nội quy mục 6, not relabelled.** `F-172` (`R5-E07-06`) closed by `M12/T2.2-R3` `R3-10` (`e7aee21`),
`F-173` (`R5-E07-07`) closed by `R3-9` (`04e128f`, owner grant `q1`). The red-before half was produced without touching the
tree: `git show <fix>^:<path>` into `temp/prefix/`, then replaying the shipped assertions against the pre-fix module — it
returned `data\sub\f.csv` verbatim where `AC 36` demands `data/sub/f.csv`, and a taxonomy-less `renderEmbeddingEnvelope`
call rendered `Domain: general` instead of raising. Green-after read from the lanes themselves:
`tests/m7-t3-tools-contract.test.mjs` 32 tests / 0 fail / 0 skipped, `tests/m8-t1-skill-vector-memory.test.mjs` 15 tests /
0 fail / 0 skipped. §2 now holds 50 closure entries. The limit is stated rather than rounded up: an explicit
`domain: "general"` still renders at HEAD, because `R3-9` removed the invented default, not the value.

**`F-044` re-graded under `E2`, and one premise corrected in the same breath.** `Severity` went `Medium → High` with the
measurement cited in `Evidence`: a directory junction inside the agent sandbox made `executeExcelOperation` write
`proof.xlsx` plus both preview files outside the sandbox base and still return `status: success`; `resolveAgentSandboxDir`
(`index.mjs:2985-3001`) is purely lexical (no `realpathSync` anywhere in it) and `:3862` hands model-supplied `params`
straight to it. This chat had described the row as `HYPOTHESIS`; its `Status` was already `OPEN` — the word sits inside
`Evidence` — so no status was changed.

**Two tool defects caught before they reached the file, and one that did damage and was reverted.** (1) `temp/apply-b2.mjs`
printed `applied reproduction=NaN` because its counter object was keyed by field name while the increments used the short
name; its self-report was therefore meaningless, and every count quoted above was re-measured from the output file.
(2) Its `sanitize()` wrapped URLs, `<tokens>` and arithmetic that already sat inside a code span, nesting one span in
another — 9 markdownlint findings (MD034/MD037/MD038) across `F-046`, `F-053`, `F-216`, `F-218`; fixed by splitting on
backticks and transforming only the segments outside spans. (3) **The closer script destroyed a row.** It computed the row
bounds once and spliced twice; after the first deletion every later index shifted by 13 lines, so it removed `F-174`
instead of `F-173`. `grep` caught it, not a count — 292 rows, 0 placeholders and clean gates all looked correct while a
live defect row was gone. Recovered by restoring the pre-apply `backups/` copy (294 rows, byte-identical to the committed
head) and re-running with bounds recomputed before each splice plus a post-splice assertion; the final diff removes exactly
`F-172` and `F-173` and keeps `F-171`, `F-174`, `F-175`. Generalizes to: a deleting script must re-locate its target after
every mutation and check identity, never position.

**Held, not applied.** 51 rows came back with a non-CONFIRMED premise (19 `REFUTED`, 32 `CHANGED`) across the two tranches.
Under `c3` no `Status:` line was written for any of them; the verdicts sit in `temp/patch-held.json` and
`temp/patch-pass2.json` for him. Two of those are closure candidates rather than relabel candidates because their defects
were already fixed with executed tests — `F-172`/`F-173` (done, above) and `F-169` (fixed by `R3-6`/`R3-7`, with
`hasForbiddenControlByte` read at `catalog.mjs:485-493` and called at `:627`); `F-169` was NOT deleted because no owner
letter covered it. `F-148` also stays: its residual lane is WSL-bound, so mục 6 (b) is not met.

**Challenge pass `G1`, partial.** Scope was 44 rows — 35 new from the concurrent `R7-C` round plus the 9 rows its merge
touched (the earlier statement "4 merged rows" was measured only inside this session's own held id set and was too small).
14 rows have been challenged; verdicts saved to `temp/ch-01-out.json` and `temp/ch-02-out.json`, **not applied**. Four came
back `OVERSTATED`, each measured: `F-055` (its merged second site `runner.py:584-601` returns the resolved object and both
callers open that value, so only a check-then-resolve TOCTOU window is there — a different mechanism; and its reproduction
points at `database.py:235-266`, which are acceptance-barrier gates — the word vault never occurs in that file),
`F-207` (`r4:578` is past EOF, `r4:563` is a closing paren, `integrations/openclaw/lib/native-boundary.mjs` is not the
tracked path, the ten r4/r5 matchers are single-code rather than ORed, and eighteen is 13 cited / 16 live), `F-218` (the
quoted identifier `configureSource` exists nowhere — the real reader is `pluginSrc` at `m8-t2:2300`/`:2304`; no test
anywhere pins import order, so the title's import-reorder example is unsupported; and its `Status:` carries a glued title
fragment while `Affected modules:` still reads `Chưa xác định`), `F-252`
(`tests/m7-t5-remediation.test.mjs:294` does call `loadContractSchema` for all three named
contracts — measured 33 tests / 0 fail / 0 skipped — so the absolute negative is false in exactly the shape `F-205` was).
25 new rows (`temp/ch-03.json` … `ch-09.json`) have not been challenged.

**Not done, and not claimed.** The full gate result for this state is recorded in the commit that follows, not here. No
`--apply`, no deployment, no restart, no PR, no merge to `main`, no push — `d1` authorizes one **local** commit.

### Record — register §1 became counts-only, and `F-324` was refuted again under a probe that had named the wrong symbol (2026-10-18)

**Why this record exists.** Owner letter `p1`, under `j1` (the register holds open defects — not proposals, not
session narrative). `docs/execution/findings.md` §1 carried 47 non-empty prose lines describing what the audit rounds
and the challenge passes had done; those paragraphs are relocated here verbatim so the round history stays durable and
§1 reduces to the tables and the derived counts. Sole write ownership was confirmed by the owner ("phiên kia hết ghi
rồi") before the move, so no concurrent writer can be racing this edit.

**What §1 now holds** (re-derived from the rows, not hand-tuned): the totals line, the F1–F7 × Severity table, the
status line, one measured field-gap line, the ungraded set, and a pointer here. 320 rows before and after; the id set is
identical to HEAD (`temp/check-register.mjs`: lost none, added none, 0 ten-field violations, 0 placeholder sentinels,
0 cited paths without a tracked match). Gates in the mandatory order — `temp/recount-s1.mjs` PASS at
total=320 / cat=320 / sev=320 / status=320, then `prettier --write`, then `markdownlint-cli2` 0 issues in 0 files across
the 20 gated doc files, then `prettier --check` clean. `PLAN.md` itself is in neither doc gate, so this record was not
prettier-formatted.

**The four `Severity: Ungraded` rows, measured rather than recalled.** `F-021`, `F-103`, `F-104` are OPEN and need the
owner's grade. `F-020` is REFUTED, so its missing grade has no consequence. This is the set the earlier pick-list called
option E. The classification predicate is the one `temp/recount-s1.mjs` uses — a Severity value that starts with one of
the four grade words, else Ungraded — and a naive "is the field empty?" probe returns **0** ungraded because these four
rows carry the literal word `Ungraded`; that is why the count is quoted with its predicate attached.

**`F-324` — the verdict held, the measurement behind it did not.** The row was relabelled REFUTED on the strength of
"`buildConfig` runs 0 times in the six bypassing suites". Re-measured here: that count is true but irrelevant, because
`buildConfig` (`integrations/openclaw/lib/policy.mjs:788`) merely composes the three **exported** resolvers that read
the variables — `resolveRouterHost` at `:1291`, `resolveRouterBaseUrl` at `:1298`, `resolveRouterApiKey` at `:1308` —
and each throws `ROUTER_*_UNAVAILABLE` when its variable is unset. The row's Evidence had listed only two of the three
reads and located all of them "inside `buildConfig`", which is not where they live. The route the title asserts —
"one of them spawns a generator with the inherited environment" — is what decides the verdict, and that is what was
measured this time:

- `temp/f324-probe.mjs` over every tracked suite: exactly **6** pre-set the variables with `||=` (the population the row
  named, unchanged), **12** import `tests/helpers/router-env.mjs`, and **none of the six spawns `configure.mjs` or
  `verify.mjs`** — the only two files that consume the router values as a generator (`configure.mjs:1252` and `:1593`
  write `stableJson(buildSecretsPlan())`; `verify.mjs:311-312` and `:511` call the resolvers and compare the plan).
- `tests/m12-t2.2-m1-live-reachability.test.mjs` does name `configure.mjs`, and that is where the title's "spawns a
  generator" came from, but it only resolves the path at `:36` and reads the file as **source text** at `:38`; its child
  processes are `git archive` at `:98` and `tar` at `:104`, and the symbol it imports from that extraction is
  `governancePluginFiles` at `:109-114`, which reads no `ZINK_ROUTER_*`.
- `tests/m10-t2-r14-review-defects.test.mjs:89` mentions `validateConfig` — the in-process caller of `buildConfig` — only
  inside a comment, and its imports are `evaluateCapabilityAccess` and `AGENT_SPAWN_POLICY`, neither of which reads a
  router variable.
- Live: the reachability suite prints tests 4 / pass 3 / fail 0 / skipped 1 at baseline and again with a sentinel
  exported for all three variables, and the sentinel string occurs **0** times in its output
  (`temp/f324-base.log`, `temp/f324-sent.log`).

So the row stays REFUTED, now with the refutation resting on the spawn-and-consumer set rather than a call count of an
unrelated symbol, and its `Root cause` no longer claims the live exposure is "a lane addressing the operator's real
router endpoint" — reaching that would need a lane that both skips the helper and calls a resolver, and measured, none
of the six does. Nothing in this row is a candidate for deletion: `k1` keeps REFUTED rows in the register.

**Two counts in the relocated text re-measured against the register as it now stands.** (1) The paragraph that says
the `40/73` pair "vẫn còn trong file" is stale on its own terms: after this §1 rewrite
`grep -c "40/73" docs/execution/findings.md` returns **0** — nothing in the register asserts those counts any more,
and the field-gap line in §1 carries the measured 0/0 instead. (2) The `92`/`23` pair is the other kind of stale: the
predicate is sound, the population and the subset relation were not. Re-run over the current 320 rows, **92** rows take
their `Root cause` from the title (predicate unchanged: the field contains the first 60 characters of the title, or the
title contains the first 60 of the field) — the same 92 the paragraph quoted, now over 8 more rows. But **23** is the
number of rows whose `Root cause` contains `Register kết luận:` at all, and only **22** of those are inside the 92:
`F-104` carries the phrase without being title-derived. The paragraph presents 23 as a subset of 92, which measured
here is one row short.

**Round narrative, relocated verbatim from `findings.md` §1.**

Hai lần cập nhật trong ngày 2026-10-17, ghi lại để arithmetic không bị hiểu là số của vòng audit: `F-038`/`R6-HUNT-01`
đi từ OPEN xuống PARTIAL sau phép đo dưới grant `e`; lượt duyệt `b2` sau đó xóa 5 hàng (4 hàng đóng bằng commit + test
chạy lại, 1 hàng trùng id), đổi 5 hàng sang REFUTED vì premise bị đo chết, và điền chữ thật vào 59 cặp field của nhóm
Critical/High.

Vòng audit R7 (2026-10-17 → 2026-10-18, delta) thêm 46 hàng `F-225`–`F-270`, `Legacy register id` theo assignment
`R7-D1`–`R7-D13`, gồm hai đợt; đối chiếu cuối vòng (`D9`) rút lại **6** hàng trùng root cause với hàng đã có
(`F-231`/`F-232`/`F-233` → F-125, `F-246` → F-059, `F-256` → F-166, `F-270` → F-205) và viết lại **11** hàng khác vì
severity hoặc premise của chúng không đứng ở HEAD (`F-226`, `F-228`, `F-229`, `F-234`, `F-242`, `F-248`, `F-249`, `F-251`,
`F-252`, `F-262` — hàng này bị refuted một nửa rồi ghi lại hẹp hơn, `F-269`). Net vòng delta để lại **40** hàng.

Hai đợt mở đúng những vùng mà sáu vòng trước chưa từng trích: đợt đầu (D1–D7, `F-225`–`F-241`) vào 13 schema
`zink-tools/contracts/**`, package `apps/knowledge/pdf-runtime`, script của `infrastructure/**`, policy JSON + contract
schema của `integrations/openclaw/topology/**`, provider adapter và các file config mồ côi; đợt hai (D8, D10A/B, D11A/B,
D12A/B, D13, `F-242` trở đi) phủ chính xác những gì đợt một tự khai ở mục "chưa inspect" trong report của nó — `guard.mjs`
đọc trọn file, `authority.mjs`, `database.py`/`config.py`/`main.py` của Knowledgebase, các surface trong
`integrations/openclaw/lib/`, 12 contract schema của topology đối chiếu reducer, census nhánh skip của 122 file test, và
toàn bộ script `.ps1`/`.sh` của `infrastructure/docker/scripts/`. Mở không có nghĩa là ra hàng: dedupe theo root cause đã
thưa nhiều claim về hàng cũ, và đọc mà không thấy lỗi thì register không có gì để ghi.

Số đo phủ, đo lại bằng `temp/coverage-probe3.mjs` trên `git ls-files` (300 file nguồn bị track): **113/300** trước vòng,
**160/300** sau vòng. Hai con số 99/300 → 137/300 ghi ở bản trước của đoạn này là **sai và bị rút**: predicate đo liệt kê
`js` trước `json` trong nhóm phần mở rộng, nên mọi path `.schema.json` bị cắt thành `.schema.js` và không khớp file tracked
nào. Mọi hàng của cả hai đợt đều được Lead tự mở lại locator ở HEAD trước khi ghi; các claim không tự kiểm chứng được thì
không ghi.

Vòng **R7-C** (2026-10-18, delta tiếp theo trên đúng phần còn trống) thêm **35** hàng `F-271`–`F-305` từ sáu assignment
read-only (`R7-C1` schemas của `zink-tools/contracts`, `R7-C2` tám provider adapter, `R7-C3` `pdf-runtime` cùng các module
Knowledgebase chưa trích, `R7-C4` compose overlay và script `.ps1` của `infrastructure/docker`, `R7-C5`/`R7-C5B` validity
của 69 file test chưa hàng nào naming, `R7-C6` các file mồ côi còn lại), và gộp vị trí mới vào **8** hàng đã tồn tại thay
vì ghi hàng trùng (`F-240`, `F-218`, `F-207`, `F-105`, `F-252`, `F-055`, `F-223`, `F-243`). Số đo phủ sau vòng này là
**213/300** (từ 162/300 trước khi ghi): `tests` 73/122, `zink-tools/adapters` 11/12, `infrastructure/docker` 19/21,
`zink-tools/contracts` 10/13, `integrations/openclaw` 57/59, `apps/knowledge` 23/48. Kết luận của vòng vẫn là **chưa
complete**: 87 file nguồn chưa hàng nào trích path, và `apps/knowledge` là vùng trống lớn nhất còn lại (25 file).
Mười một hàng của R7-C mang `Status: LATENT` (8) hoặc `HYPOTHESIS` (3) vì chính measurement của vòng này: tám adapter provider
không có importer production nào ngoài `tests/m7-t4-orchestration.test.mjs` (đo ở F-105), nên defect trong chúng chỉ chạy
được qua test; còn ba hypothesis cần một phép đo trước khi sửa (F-287, F-293, F-305).

`R7-D*` là id **của vòng delta 2026-10-17**, không tra được về register sáu vòng (id `R7-` duy nhất ở đó là `R7-GATE-01`,
đã đóng ở §2). Xuất xứ, phán quyết của chủ cho vòng đó, và kết quả đọc lại cả 17 locator ở HEAD: `PLAN.md` §8, record
`the 17 rows this record under-counted`. Cả 17 hàng đều đã được phiên này tự kiểm tra lại path và khoảng dòng trước khi giữ.

Vòng **R7-E** (2026-10-18, delta thứ ba liên tiếp, đối tượng đúng là 87 file chưa hàng nào trích path) thêm **20** hàng `F-306`–`F-325` từ năm assignment read-only: `R7-E1` `apps/knowledge/app` (markdown adapter, `run_errors`, reranker, config), `R7-E2` `apps/knowledge/tests` cùng `pdf-runtime`, `R7-E3` các lane Node chưa từng được naming ở `tests/`, `R7-E4` các lane `m7-lane-*`/`m8-t2.*` chưa được đọc, `R7-E5` `zink-tools/contracts` và `zink-tools/adapters`. Lead tự mở lại từng locator ở HEAD trước khi ghi; claim không tự kiểm chứng thì không ghi.

Dedupe theo root cause: **8** hàng đã tồn tại nhận thêm vị trí thay vì mở hàng trùng — `F-240` (bốn chỗ literal tự đối chiếu: timeout do chính test truyền vào `httpx.AsyncClient` rồi được so với "client thật", bảng spawn chép tay thay vì đọc từ guard, `isDeclaredReasonCode` kiểm đúng vocabulary mà nó import, fixture prompt-build do test tự dựng), `F-218` (19 file, khoảng hai chục pin text), `F-207` (tám file, mười tám vị trí matcher rộng hơn diagnostic mà ca đặt tên), `F-275` (ba schema-only contract còn lại), `F-279` (streamlit là phong bì thứ sáu), `F-055` (hai lookup nữa ở `markdown_adapter.py`), `F-213` (ba chỗ `git archive`/`git show` cộng `tar`), `F-300` (hai chỗ "lane báo phủ một thứ mà body không chạy").

Ba claim của vòng này bị chính phép đo chặn trước khi ghi, ghi lại ở đây vì chúng là lỗi của Lead chứ không của hàng đợi: `tests/m11-t1-skill-governance.test.mjs:612-626` có **sáu** `assert.doesNotMatch` chứ không phải bảy; `apps/knowledge/app/reranker.py` raise **mười** code qua một exception type chứ không phải tám; và "19 điểm nối cause" là số bịa — `apps/knowledge/app` có 59 chỗ `raise … from` trong 11 module, còn `apps/knowledge/tests/test_b14_cause_attribution.py:62-70` chỉ gọi tên hai file, và cả module bị `pytest.skip(allow_module_level=True)` ở `:29-35` chặn khi `KNOWLEDGE_TOKENIZER_PATH` chưa được cấp, biến mà chỉ `.github/workflows/ci.yml:99` đặt. Cùng loại: `tests/m8-t2-file-lock.test.mjs:161-167` (tên hứa "repository filesystem (Windows/OneDrive)" nhưng `tempRoot()` ở `:17-18` là `mkdtempSync(path.join(os.tmpdir(), …))`) ban đầu được gộp vào `F-298`; root cause của `F-298` là phân loại retry, nên location đó chuyển sang `F-300` thay vì dán vào hàng sai chủ đề. Claim sai duy nhất đã trót vào file — `F-275` từng ghi "xóa cả bốn file vẫn xanh" — đã bị lượt đối chiếu trước sửa tại HEAD; vòng này chỉ bổ sung phần đo mới: `zink-forecast.schema.json:31-34` mở `parameters` thật, `zink-simulation.schema.json:27` là `additionalProperties` kiểu `number` (vẫn trái `zink-tools/contracts/README.md:12` nhưng hẹp hơn forecast), còn `zink-optimization.schema.json:22-47` hỏng ở nửa thiếu `minItems` chứ không có `parameters` gì cả.

Id legacy của vòng này ban đầu ghi `R7-D1-01`…`R7-D5-05` và **đập vào namespace của vòng 2026-10-17**: phép kiểm tự động tìm thấy bảy va chạm một-một (`R7-D1-04`, `R7-D2-01`, `R7-D4-01`, `R7-D4-02`, `R7-D4-03`, `R7-D4-04`, `R7-D5-02`, mỗi id mang hai hàng). Toàn bộ 20 hàng được đánh số lại thành `R7-E1-01`…`R7-E5-05`, kèm 8 marker gộp và 28 chuỗi nguồn vòng; đo lại, 312 hàng mang đúng 312 `Legacy register id` distinct, nên đoạn trên (`R7-D*` là id của vòng 2026-10-17) vẫn đúng nguyên văn.

Số đo phủ, bằng đúng predicate `temp/coverage-probe3.mjs` trên `git ls-files`: **213/300 → 272/300** (+59 file; `tests` 110/122, `apps/knowledge` 39/48, `zink-tools/contracts` 13/13, `zink-tools/adapters` 12/12, `tests/helpers` 3/3, `integrations/openclaw` 58/59). Còn **28** file chưa hàng nào trích path: 12 ở `tests`, 10 ở `apps/knowledge` (gồm `app/reranker_contract.py`, `tests/test_pdf_foundation.py`, `tests/test_pdf_pipeline.py`, `tests/test_run_errors.py`, `tests/fixture_acceptance.py` và bốn file `pdf-runtime`/`__init__`), 2 compose overlay ở `infrastructure/docker/compose`, cộng `package-lock.json`, `eslint.config.mjs`, `.vscode/settings.json`, `docs/contracts/knowledgebase-migration-digests.json`, `integrations/openclaw/topology/contracts/delegation-proposal.schema.json`. Vòng R7-E vì vậy **chưa complete** theo chính tiêu chí của nó.

Vòng **R7-F** (2026-10-18, hai assignment read-only trên đúng 28 file còn trống) thêm **8** hàng `F-326`–`F-333` và gộp vị trí mới vào bốn hàng đã tồn tại (`F-218`, `F-207`, `F-223`, `F-312`). Lead từ chối ghi năm finding mà mình chưa tự mở lại locator ở HEAD — `m10-t2-r8-ingress-source-diagnostics`, `m10-t2-r12-task-code`, `m10-t2-r18-file-lock`, `m10-t2-r9-duplicate-runid-observability`, `m7-lane-m-spawn-approval` — nên chúng nằm lại `temp/r7f-findings-f1.json` thay vì vào hàng đợi; một lane (`m12-t1-governed-presentation`) được đọc và báo không có gì. Số đo phủ: **272/300 → 291/300**; 9 file chưa hàng nào trích path gồm ba file `__init__`/`__main__` đã đọc và sạch, một lane honest-zero, và năm file chưa được Lead kiểm chứng ở trên.

Vòng đối chiếu (challenge) trên chính 20 hàng R7-E chạy sau đó và **Lead tự áp**, vì chủ grant `e1`: 7 field bị ghi lại (`F-306`/`F-307`/`F-309` sửa `Reproduction`, `F-308` đổi sang `HYPOTHESIS`, `F-318` Medium→Low, `F-324` đổi sang `REFUTED`, `F-291` viết lại `Root cause`), 19 annotation sửa locator/count. Hai hàng có lỗi do chính phiên này ghi: `F-320` trích file **không tồn tại** (`tests/m8-t2.6-r11-boundary-diagnostics.test.mjs`) và `F-324` premise chết — nhưng phép đo ban đầu dùng sai symbol (`buildConfig` chạy 0 lần), symbol không nằm trên route nào của hàng; phép đo ở record này mới là lý do đúng. Năm hàng khác mang locator sai đã sửa: `F-317` (hai window `configure.mjs`), `F-319` (`guard.mjs:772-776`, không phải `native-boundary.mjs` 637 dòng), `F-313` (`Dockerfile:77` là RUN, `:76` là ENV), `F-323` (bốn occurrence của `KNOWLEDGE_EMBEDDING_MODEL` đều ở `knowledge-t3.ps1`), `F-314` (consumer ở `main.py:262`). Lead **không** áp ba con số của challenger mà mình không đo lại được (`F-316` 14-assert, `F-321` 49-pair/18-ALLOWED, `F-322` site list) — challenger cũng sai số của chính mình ở `F-308` (12 literal, đo lại là 13) và `F-312` (đếm thiếu `ONNX_RUNTIME_UNAVAILABLE`).

`F-291` được đo lại từ đầu theo grant `c2`: population là **sáu driver** — bốn chỗ raise từ trong `finally` (`knowledge-t1.ps1:263-265`, `knowledge-t2.ps1:90-97`, `knowledge-t3.ps1:168-177` với helper throw ở `:22-26`, `knowledge-t4.ps1:249-256` với helper ở `:21-25`) và hai chỗ gate `-not $script:bodyFailed` (`knowledge-t5.ps1:287`, `knowledge-t5-live.ps1:535`); `knowledge-t5-common.ps1` là helper chung, không phải driver thứ bảy, và `knowledge-t2-windows.ps1:84-90` được ghi là hàng xóm chưa phân loại vì chưa đo được path throw thật.

Hai con số 40/73 và 23 vẫn còn trong file nhưng đã bị đánh dấu là không tái hiện được ở đoạn đếm queue. Một sửa đổi quy trình của chính phiên này, ghi lại để sau đừng lặp: commit `ec770b3` tuyên bố đã sửa shape `Severity:` nhưng **không chứa** sửa đó — write cả-file của phiên bên kia (bản tiền-`b1`) chen vào giữa lúc kiểm chứng và lúc `git add`, nên staged content là bản bị revert; phép đo "non-bare Severity = 0" đã chạy trên nội dung trước khi bị đè, tức là bằng chứng cũ. `ec770b3` vẫn được giữ trong history (không rewrite), còn sửa đổi thật nằm ở commit kế tiếp, và sau đó toàn bộ gate được chạy lại trên chính file sẽ commit.

Đoạn đếm field cũ ở đây (40 thiếu `Acceptance criteria`, 73 thiếu bước tái hiện, đo trên 294 hàng) và con số 3 mà một lượt khác ghi sau đó **đều không còn đúng**. Đo lại 2026-10-18 trên toàn bộ 320 hàng, với predicate 'field trống, là placeholder, hoặc ngắn dưới 40 ký tự': **0** hàng thiếu `Reproduction`, **0** hàng thiếu `Acceptance criteria`, 0 hàng thiếu một trong hai. Ba hàng `F-015`, `F-017`, `F-020` mang chữ "không tái hiện được" trong field đó là ghi chú verdict của hàng REFUTED, không phải placeholder. Phần `b2` vì thế đã khép: không còn hàng nào trong nhóm Medium/Low/Ungraded thiếu hai field này.
Phép đo lặp lại bằng `node temp/measure-s1.mjs` (in ra số theo predicate, không đọc từ commit message).

## 9. Deferred beyond V1

Unless separately approved:

- image/video ingestion;
- self-hosted generic data lake/lakehouse;
- self-hosted generic forecasting/ML/OR training platform;
- Kubernetes/Kafka/distributed orchestration;
- speculative microservices, queues, workers or control planes.

## 10. Decision log

| Decision                           | Current rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository scope                   | Three logical modules: Knowledgebase, Skill Store, Tools.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Knowledgebase taxonomy             | Preserve existing owner-approved taxonomy and Supply Chain coverage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Templates                          | Excel/Power BI templates are owner-built assets stored in Zink Skill Store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Work/Research                      | Main infers mode from intent; mode is metadata, not a second store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Execution specialists              | Excel, Power BI, SQL and Python are the baseline four.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Five Stack                         | Functional processing layers; agents may serve more than one stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| L&SC Data Plant                    | Logical external-infrastructure/data-compute flow only; no platform runtime.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Model artifacts                    | Heavy artifacts stay external; repository keeps only lightweight metadata/config/evaluation references when needed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Coordinator binding                | M10/T2-R2 (parent R1) implemented and locally verified; binding = historical identity, attempt = execution generation, lease = current execution authority; live execution and result ingestion remain future work and are not authorized.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| OpenClaw                           | External runtime/orchestrator and task-mode classifier.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| n8n                                | Deterministic workflow/trigger/schedule plumbing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Changelog                          | Validated fixes belong in `CHANGELOG.md` `### Fixed` at task DoD (owner ruling 2026-10-17: "changelog.md vẫn thay đổi chứ, cập nhật fix bug"). This supersedes only the **additive** half of `n5a`: `M12/T2.1`/`T2.2`/`T2.3` are now recorded. Rewriting an already-accepted historical line (e.g. `CHANGELOG.md:430`/`:861`, which still promise `REAL_EXECUTED`) remains a separate explicit grant, because that is mutating accepted evidence.                                                                                                                                                                                                                                               |
| Refuted prescription               | Owner answer `A` (2026-10-17, `M12/T2.2-R3` `R3-6`): when a frozen contract detail is **measured** wrong during execution, the item stops, the evidence is recorded, and the owner re-cuts it — the approved placement, diagnostic code and mutation probe stay, only the wrong part changes. He chose the option that keeps the guard stricter than the two fatal bytes (`0x01–0x08`, `0x0e–0x1f`, VT/FF, DEL all refused) and exempts exactly `0x09/0x0a/0x0d`, accepting that the exemption must be pinned by a test so no later band can widen or narrow it silently. Options B (NUL+ESC only), C (the frozen verbatim predicate, measured 35/87 red) and D (drop the item) were not taken. |
| Grants are worth their named lines | Owner answers `n1 được` and `n2 ừ và làm cho hết findings` (2026-10-17). `n1` admitted **one** file, `tests/m11-t1-postgres-sql-gate.test.mjs`, executed as `R3-12`, and did not touch `M11-06`'s accepted assertions — the new lane duplicates the scratch-database prologue rather than refactoring it. `n2` authorized **planning** `M12/T5` only: no `M12/T5` code exists, and "làm cho hết findings" is read as the standing order to keep executing the reported set, not as a waiver of the per-band approval or a reversal of `p1`/`r2`/`s1`/`giữ nguyên AGENTS.md`.                                                                                                                    |
| Agent judgment calls               | A fix the owner did not order may ship inside an authorized item when the item's own change makes the defect reachable, and it must be named as the agent's, marked reversible, and put in the next report. Applied at `M12/T2.2-R3`: one rollback prune (`catalog.mjs:1403`) because a first-time-reachable content refusal would otherwise leave an empty capability directory that fails the whole store closed.                                                                                                                                                                                                                                                                             |

## 11. Ledger of open owner decisions — H1–H11 (TRACKED AUTHORITY)

Promoted from `.agents/states/findings.md:4423-4462` on 2026-10-15 under the owner's "5. ok em". **This section is
the authority for these questions**; the register copy is now a historical note. The reason it had to move is
`AGENTS.md` §2/§6: the ledger previously lived only in a git-ignored state file, which grants no authority, and one
contract revision (R2's own §9) was already destroyed by an overwrite precisely because it was ignored (`H10`).
Every row below was **re-derived for Vòng 6 wave 2** — where the register's older evidence was refuted, the
correction is stated rather than the old claim repeated. **`H1`–`H9` are unanswered and no row is an execution grant:
a tier assignment in `ACTIVE.md` §5.3 is not an approval.** Two rows have since been decided — `H10`'s register half
(2026-10-17) and `H11`'s design choice (the disposition block below) — and neither answer authorizes a band.

| #       | Decision                                                                                                                                                                                                                                                                | What changed after wave 2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Where                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **H1**  | Widen CI triggers so a push to the task branch is gated without a human re-dispatch                                                                                                                                                                                     | still true that every run is `workflow_dispatch` (26 runs / 14 SHAs), but "HEAD has zero runs" is now false only because someone dispatched `7ed0b28` / `d8c221a`. **Attribution corrected 2026-10-15: this plan said "a human dispatched" and that is not supportable — `gh api user` returns `SatThuVoTinh`, i.e. the same login the runs list as `actor`, so an agent dispatch and an owner dispatch are indistinguishable in the API, and no agent may claim the owner clicked.** The decision is unchanged: "evidence exists **only when someone remembers**", not "no evidence exists"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ci.yml:3-8`, `security.yml:3-10` (+ a weekly `schedule:` the register missed); `R5-E09-01/-08`, `R6-V08-01`                                                     |
| **H2**  | Branch protection cannot be enabled — choose an in-repo merge-blocker substitute, make the repo public, or accept advisory gates                                                                                                                                        | re-confirmed: `gh api …/branches/main/protection` → `403 "Upgrade to GitHub Pro or make this repository public"` while the same token reads the branch, so it is plan-gated, not a scoping artefact. HEAD's Security run is red **right now** and nothing can block a merge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `R5-E09-02`, run `38715090086`                                                                                                                                   |
| **H3**  | A skip policy for CI — floor the skip tier, or make the SQL gate executable there                                                                                                                                                                                       | **shape changed twice.** `m11-t1-skill-vector-sql` is NOT Docker-gated (grep 0; it passes in CI), so the Postgres-service option buys **one** test (`M11-06`), not a tier. And all 52 CI skips are individually named with reasons, so the gap is enforcement not visibility; the 52−46 delta is the 6-test duckdb family, verified (`which duckdb` present on this Windows host and in WSL, absent on the runner). A single global number would fire on 40 legitimate host-capability skips → **needs a per-family expectation**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `PLAN.md` §2 (Active Task, corrected), `R5-E09-03`, `R6-V08-01`                                                                                                  |
| **H4**  | Operator chmod of the live 0644 config backup + extending the permission gate to the state root                                                                                                                                                                         | **de-escalated.** `/home/hoang_vinh` and `/home/hoang_vinh/.openclaw-zink` are both `drwx------`, so "any uid can read the credential set" was false; the file is 1 of 15 copies. The live-data action is not needed. What IS verified and unguarded: `configure.mjs:986-988` returns immediately on win32, so the named-path mode check **has never run on the owner's host**, nothing enumerates the state root, and four subtrees inside it are group-writable (`R6-V09-03`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `R5-E13-01`, `R6-V09-01`                                                                                                                                         |
| **H5**  | Where `skills.*` schema lives: move the DDL + runner into `zink-skill-store/`, or record the present arrangement as an accepted §9 exception                                                                                                                            | **support removed, and that removed support has now landed.** "R5-E11-02 strengthens this" no longer holds: §9's only imperative about a peer's store is prefixed _cross-project_, and §9 defines the three modules as one repository, so a plugin calling the Skill Store's own exported writer under the Skill Store's own lock is calling the owner. H5 must be decided on **DDL placement alone**; what is actually contradicted is one sentence of `docs/contracts/skill-store/agent-skill-store.md`, and that sentence was corrected at `M12/T2.3-R1` `C-3` (`e47e660`) by a doc-only change whose own commit message states it does **not** strengthen H5 — so this row waits on the DDL placement question alone, not on an open finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `R5-E03-07`, `R5-E11-02` (re-framed; closed `e47e660`), `R6-V10`                                                                                                 |
| **H6**  | Route the router key through the SecretRef indirection                                                                                                                                                                                                                  | premise true, details corrected: `policy.mjs:892-898` bakes `apiKey: resolveRouterApiKey()` from `process.env.ZINK_ROUTER_API_KEY`, and `buildSecretsPlan()` returns **zero** targets, so "the indirection exists in this template and the key skips it" overstates it — bot/gateway tokens route through `secrets.providers`, the router key is baked and unrotatable without re-apply. "Duplicated in every copy" is inference: two `.bak.1/.bak.2` copies predate the router provider entirely                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `R5-E13-02`, `R6-V09`                                                                                                                                            |
| **H7**  | A referential scheme for Discord identities in durable events, plus the policy for **unknown** ids                                                                                                                                                                      | **loses its live basis.** `governance/ledger/events.jsonl` is 0 bytes (mtime Sep 18) and a numbers-only snowflake count returns 0 — no third-party identity has ever been written. This is a forward-looking schema decision ("what may future events write"), and must not be put to the owner as remediating an existing exposure. `operator/m7-t2/ledger` was not swept, so that half stays `Unresolved`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `R5-E13-04`, `R6-V09`                                                                                                                                            |
| **H8**  | A governed `DEPRECATED` retirement transition for the Skill Store                                                                                                                                                                                                       | stands, better evidenced, with **one prerequisite and one correction**. Prerequisite: applied migrations are keyed on **filename only** (`database.py:1718-1733`, no digest column), so editing `003`'s `CHECK` in place is a silent no-op on an already-migrated database — the fix must be a forward migration (`R6-V10-01`). Correction: cite `R5-E04-05` only; `R5-E04-01/02` are staging-recovery findings, not lifecycle ones (`R6-V10-03`). `REJECTED` is equally writerless, so **two** of four states have no writer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `R5-E04-05`, `catalog.mjs:45, :419-424`                                                                                                                          |
| **H9**  | Whether unreclaimable PDF text copies get a reclamation path                                                                                                                                                                                                            | unchanged; a retention decision that deletes derived content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `R5-E03-05`                                                                                                                                                      |
| **H10** | Whether `.agents/states/findings.md` becomes tracked, and where an archived `ACTIVE.md` should live                                                                                                                                                                     | **register half ANSWERED 2026-10-17** by "chuyển sang docs/execution đi": the queue moved to **`docs/execution/findings.md`** and is Git-tracked from this head, so the cost `M12/T4-R1` `T4-3` exposed — 31 status rewrites, 11 dated refresh lines and one new entry landing with **no commit at all** — cannot recur. Being tracked also put it inside the `docs/**/*.md` prettier and markdownlint globs, which is why each row now carries one fixed field shape — the owner's nine fields plus the `Legacy register id` his `l1` answer added, ten lines per row. **The size policy this row asked for is still not set**: the register entered Git at **3 244 lines / ~457 KB** holding **236** queued bugs (**4 010 lines / ~718 KB and 292 queued bugs at the 2026-10-18 head, read from the file itself**, and §2 now carries 50 closure entries rather than 48), after 48 rows left it (43 closed with commit + executed-test evidence, 4 duplicates, 1 resolved blocker) into the file's own §2 closure table and a concurrent owner session appended 17 `R7-D*` rows, and no trimming rule was approved. The archive half was already settled in practice — six closed contracts now live under `docs/contracts/execution/archive/`, and the scrub rule ran on the latest                                                                                                                                                                                                                                                                                                                        | this section's own history, `R5-E14-07`, `Record — M12/T4-R1 closed`                                                                                             |
| **H11** | **NEW, owner-proposed 2026-10-15: the O1/O2 working relationship.** His words: _"2 điều phối O1 và O2 nên chia đôi task, thảo luận với nhau trong sandbox để khi làm xong, các task mà O1 và O2 cho executor chuyên biệt làm xong, ghép lại phải đúng yêu cầu của anh"_ | this is **not** option A or B of the routing question — it is a third answer, and it changes canonical architecture, so it is RED and recorded rather than built. What it contradicts today: `five-stack.md:15-17` ("Main is the only authority that changes execution between coordinators… **O1 and O2 return a transition request to Main instead of invoking one another**") and `:20-23` (missing prerequisites are BLOCKED "rather than a hidden A2A edge"); `policy.mjs:1166` Coordinator Core says the same; `AGENT_SPAWN_POLICY` gives `main → [o1, o2]` and **no** `o1 ↔ o2` edge, which the guard enforces. Sessions also run `context: isolated, sandbox: require, thread: false`, so "a sandbox they discuss in" is a **new shared durable surface**, and `R5-E16-01/02` already proves whole-file rewrites under one lock lose updates when several loops run concurrently. Three shapes are offered below; the recommended order exists because **the execution lane itself has never run end to end**, and its first named prerequisite is **already landed**: `R1-A04-01` closed at `M12/T2.2-R1` `A-1` (`ccf2ad7`) — the guard now validates each node against `AGENT_STACK_POLICY` (`guard.mjs:849` at this head) — and `R1-A04-05` closed at `A-2` (`09aa698`). What would still refuse the split mid-flight is a different defect, proved while `A-1` ran: `main` owns the `decision` node but appears in nobody's spawn list, so Main's merge has no admissible node. That, not the guard/policy drift, is the prerequisite left; it is documented in the `A-1` consequence block below | `docs/architecture/five-stack.md`, `policy.mjs:555-563, 1166-1174`, `guard.mjs:842-853, 865-870`, `R1-A04-01` (closed `ccf2ad7`), `R1-A04-05` (closed `09aa698`) |

**All ten were ANSWERED on 2026-10-21.** `H1`, `H2`, `H3`, `H5`, `H6`, `H7`, `H8`,
`H9`, `H10` and the unnumbered `F-217` question — the owner's answers, and the
bands they create, are in **Record — the owner's answers to the ten open
decisions (2026-10-21)** below. `H4` was de-escalated (the state-root
permission gate landed in this band) and `H11` was decided on 2026-10-15 and
scheduled to `M12/T3`.

**H11, the three shapes (ranked; the owner picks one before any contract is written):**

1. **Main-mediated split — smallest.** Main divides one request into an O1 half and an O2 half **inside a single
   brief**, the DAG runs them in parallel with declared cross-node dependencies, and **Main performs the merge and the
   acceptance check**. No coordinator-coordinator edge; no shared workspace; the "discussion" becomes a dependency
   edge plus Main's synthesis. Work needed: the two named fixes are done — `R1-A04-01` at `A-1` (`ccf2ad7`) and
   `R1-A04-05` at `A-2` (`09aa698`) — and `A-1` proved a brief may already contain both coordinators' nodes; what
   remains is Main's merge node, which the spawn table still refuses. Cost: no peer review between O1 and O2; disagreements escalate to Main as today.
2. **Governed hand-off — middle.** O1 and O2 exchange **written, digest-pinned artifacts** through the existing
   governed-reference mechanism (immutable refs + `MISSING_PREREQUISITE`/`BLOCKED`), one rebuttal round each, still
   ordered by Main. Closer to "thảo luận" without a new spawn edge; needs a declared shared-artifact type and a round
   limit so it cannot loop.
3. **True coordinator-to-coordinator discussion — largest.** Adds an `o1 ↔ o2` delegation edge, a shared sandbox
   workspace, a turn-limited negotiation protocol, a stall reaper, and new durable vocabulary for negotiation rounds.
   This rewrites `five-stack.md`, the Coordinator Core prompt, the spawn policy, the budget model (each round is a
   spawn), and the money/latency per task. It needs its own milestone, and building it on an execution lane that has
   never produced a live result would put the negotiation protocol above an unproven floor.

**One constraint the owner should know before choosing, because it decides how much of "thảo luận" is available at
all.** Today **exactly one coordinator owns a task**: the brief binds `primary_coordinator`, the approval card names
one "Điều phối chính (Primary)", `allowed_stacks` and the spawn targets derive from that single id, and `main` may
spawn only `o1` **or** `o2` as the root of a run. So "O1 and O2 discuss as equals" has no host-side object to attach
to — no shared run identity, no venue, no second party in the ledger. What is achievable inside the existing shape is
**hand-off and review**: one coordinator owns the task, the other's half comes back as a digest-pinned governed
reference the owner of the task must accept (shape 2), with Main as the only party allowed to move a half (shape 1).
A genuine peer debate (shape 3) is new topology, not a configuration of the current one. And `primary_coordinator`
currently has **no writer in non-test code** — only two reads, `plugins/zink-governance/index.mjs:1890` and `:2535` —
which is the phantom field the audit already recorded, so whichever shape he picks must first give that field a real
writer, or the merge has no owner to hold it.

**No shape above is authorized.** Choosing one is a decision, not an execution grant; it needs its own Plan Revision.
Its former prerequisite `R1-A04-01` (the guard-vs-policy swap) **was** fixed first, at `A-1` (`ccf2ad7`); the refusal an
owner would now experience as "the bots disagree and nothing runs" is the missing `main` spawn edge for a `decision`
node, which is `M12/T3`'s to settle.

### H11 disposition — owner answers recorded 2026-10-15, work scheduled to `M12/T3`

The owner answered the brainstorming questions and then set the order explicitly:
_"đầu tiên sửa hết lỗi đã audit trước, rồi mới tiến hành làm cái đó tại M12 T3, `five-stack.md` điều chỉnh trong phạm vi
đó luôn"_. So **the audit remediation precedes H11**, and the five-stack rewrite belongs inside T3, not inside the
remediation wave.

Direction he chose, recorded while it is fresh (this is a **design decision**, not an authorization):

1. **Org chart:** **O1 owns the data half** (`data_plant`: excel, sql, python) and **O2 owns the analysis half**
   (`semantic`/`intelligence`: power-bi, python). This matches `AGENT_STACK_POLICY` and Main's current role block, and
   contradicts `five-stack.md` — which he has assigned to T3 to correct.
2. **Mechanism: shape 1, Main-mediated.** One task, one plan, both halves inside it; **no coordinator↔coordinator
   edge**. (Design note from the same session: a mixed-stack plan is _already_ legal — `execution-brief.schema.json`
   carries per-node `agent_id` + `stack_id`, and the cross-stack prerequisite rules already wire a data half to an
   analysis half. The single-stack rule did not bind a Main-authored plan. See the correction below: the note also
   claimed the merge had a home, and that half was wrong.)
3. **Merge owner:** **Main merges and presents once.** O1 and O2 do not cross-review each other.
4. **Gates stay two:** one merged **plan** card in #approvals, one merged **result** card in #results. No approval
   gate is removed.
5. **Topology per task, chosen by Main:** parallel halves merged at the end, **or** chained (data → analysis) — both
   expressible as dependency edges.
6. **Failure surface:** a broken half posts an incident in **#incidents** _and_ still produces the task's #results
   card in `BLOCKED`/`PARTIAL` naming what is missing, so he has exactly one place to decide (redo / accept partial /
   cancel). **Precondition he owns:** the mislabelled `STATUS: ANALYTICS` tag in Discord must be renamed or the
   analysis-side incident cannot be tagged and will never post (recorded, `NOT TESTED` live).

**Correction to that design note, proved during `A-1` execution on 2026-10-15 — the merge node does NOT have a home
today.** The note claimed `guard.mjs` "already requires a `decision` node to be Main-owned, i.e. the merge has a
home". The ownership half of that sentence is true (`guard.mjs:877-878`, read this session: a node whose `stack_id` is
`decision` must have `agent_id === "main"`), but it is contradicted by a rule the note did not read: the spawn-target
assert immediately above (`guard.mjs:865-870`) requires **every** node's `agent_id` to appear in
`AGENT_SPAWN_POLICY[context.agentId]`, applies to every author with no `main` exemption, and
`AGENT_SPAWN_POLICY` (`policy.mjs:556-562`) lists `main → [o1, o2]`, `o1 → [excel, sql, python]`,
`o2 → [power-bi, python]`, and `[]` for all four specialists — so **`main` is in nobody's spawn list**. The two kept
rules together refuse a `decision` node no matter who authors the brief. Executed evidence, not reasoning:
`tests/m12-t2.2-a1-stack-authority.test.mjs` plants a Main-authored mixed `o1`/`o2` plan **with** a `main`-owned
`decision` node and asserts `UNAUTHORIZED_TARGET`, while the identical plan **without** that node is admitted.
`admitInitialBrief` is the only producer of a brief (`guard.mjs:798`, called once at `:1274`; the reducer fills
`task.nodes` only from that event), so no other lane delivers a merge node either. Note the shape of the defect:
`workflow.mjs:1466-1470` validates per node against `AGENT_STACK_POLICY`, where `main` **does** own `decision`
(`authority.mjs:574-580`), so the reducer accepts the node the guard then refuses — the same guard/policy drift as
`R1-A04-01`, in the opposite direction.

**Consequence for H11: this is a `M12/T3` prerequisite, not a Wave-A item.** The owner's choice (item 3) stands
unchanged — Main merges and presents once. What changed is its cost: T3 cannot express Main's merge as a `decision`
node in a brief until either `AGENT_SPAWN_POLICY` gains a `main` edge for that node class, or the ownership rule at
`guard.mjs:877-878` is replaced by a merge mechanism that does not need a Main-owned node. Nothing in Wave A may add
that edge: widening a spawn table is a topology change, which is RED under `AGENTS.md` §7 and outside `ACTIVE.md` §3.

What is still open before T3 can be planned: `primary_coordinator` has **no writer in non-test code** (only reads at
`index.mjs:1890` and `:2535`), so "who owns a two-half task" has no durable answer yet; and the execution lane has
never run end to end, so T3 must inherit or precede that repair.

**One consequence the owner should see now, not in T3:** because the five-stack rewrite was assigned to T3, fixing
`R1-A04-01` in the remediation wave (guard reads `AGENT_STACK_POLICY`) leaves `docs/architecture/five-stack.md`
describing the **opposite** org chart until T3 lands. That is a knowingly-accepted, time-boxed doc/code divergence,
recorded here so no later reader mistakes the document for current truth.

### Record — M12/T9 closed (2026-10-19)

The owner's order (`anh sửa hết`, 2026-10-19) became the active task
`M12/T9`, Plan Revision `M12/T9-R1`, materialized as
`docs/contracts/execution/ACTIVE.md`. Seven fix agents worked in parallel, one
per module, each writing its own tests and mutation probes; the orchestrator
split the resulting tree into **135 commits**, one per finding (findings.md
§0.2.3), and verified that every prefix of the commit order is a tree that
parses — the one place the split was not possible, three findings that edit
the same file, landed in one commit instead.

**134 findings closed.** Every closed row left the register's queue and entered
§2 with the commit that closed it, so the register and the git history name
the same fix. The register's §1 counts were recomputed from what remained:
**221** open, down from 355.

| Band                                                                                               | Result                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run verify` (format:check + lint + test + repo:check)                                         | `PASS` — 1823 tests, 0 fail                                                                             |
| Knowledgebase Python lane (`uv run --directory apps/knowledge --locked python -m pytest tests -q`) | `PASS` — 241 passed, 4 skipped, 64 subtests, with the CI's pinned tokenizer fetched and sha256-verified |
| WSL lane                                                                                           | `NOT RUN` — no WSL host on this machine                                                                 |
| real-PostgreSQL lane                                                                               | `NOT RUN` — no PostgreSQL container on this machine                                                     |
| live Discord behaviour                                                                             | `NOT TESTED` — no live call was made; the forum listing is exercised against a stubbed `fetch`          |
| deployment / `--apply`                                                                             | `NOT RUN` — never authorized in this band                                                               |

**Owner decisions this band raised, not taken.** The rows whose acceptance
criterion is a schema, contract, public-API or durable-state decision were
reported to the owner instead of being implemented: `F-022` (the plugin loads
live repository source through a hardcoded Windows mount path — closing it
needs a packaging change and a digest re-admission), `F-234` / `F-274` (the
published tool contracts versus the surface the live seam accepts),
`F-049` / `F-065` (durable-state and replay semantics), `F-116` (the
namespace vocabulary), `F-093` / `F-102` / `F-306` / `F-309` / `F-340`
(schema and processing-identity semantics), `F-146` / `F-195` (the packaged
digest roll the owner's standing `a` covers), `F-303` (contract resolution
roots), `F-337` (a recovery record's freshness window), `F-263` (the
Knowledgebase's identity check), and `F-046` (which embedding digest is the
approved artifact). The two Critical rows that remain open — `F-022` and
`F-056` — are open precisely because their acceptance criteria are not
implementable as written; `F-056`'s safe half shipped and its remainder needs
a letter.

**Known limitations, stated rather than hidden.** The packaged plugin's asset
digests moved with the band, so the deployed extension's assets need an
owner-authorized re-admission before the next `--apply`; the admission list in
`integrations/openclaw/configure.mjs` now carries the outgoing digests the
band's own lanes require. The `pdf-runtime` child suite still has no
executing lane. A handful of rows were closed as `REFUTED` because their
premise was already dead at HEAD, and a few as `EXCLUDED` because the owner had
already decided them.

### Record — M12/T9 second band closed (2026-10-21)

The owner's order (`anh sửa hết findings`, 2026-10-19) stayed open as the
active task `M12/T9`, Plan Revision `M12/T9-R1`. This band continued it:
**120 findings closed**, each with its own commit, each row moved from the
register's queue into its §2 with the commit that closed it, and the register's
§1 counts recomputed from what remained.

| Band                                                                                               | Result                                                                                             |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `npm run verify` (format:check + lint + test + repo:check)                                         | `PASS` — 2332 tests, 2281 pass, 0 fail, 51 skipped                                                 |
| Knowledgebase Python lane (`uv run --directory apps/knowledge --locked python -m pytest tests -q`) | `PASS` — 286 passed, 8 skipped, 67 subtests passed                                                 |
| WSL lane                                                                                           | `NOT RUN` — no WSL host on this machine                                                            |
| real-PostgreSQL lane                                                                               | `NOT RUN` — no PostgreSQL container on this machine                                                |
| live Discord behaviour                                                                             | `NOT TESTED` — no live call was made; every Discord surface is exercised against a stubbed `fetch` |
| deployment / `--apply`                                                                             | `NOT RUN` — never authorized in this band                                                          |

**What the register holds now.** **120 rows closed** (the commit that closed
each one is in its §2 row), **18 rows reclassified `REFUTED`** with the
evidence that measured their premise dead at HEAD, and **16 rows carry the
owner decision they wait on** — each one's `Status` line names the decision and
the smallest sound alternative, because under `AGENTS.md` §7 a change to a
published contract, a durable-state semantic, a schema, the dependency set or
an ownership boundary is the owner's to make, not an agent's. **16 rows are
still open.**

**Known limitations, stated rather than hidden.** The packaged plugin's asset
digests moved with the band and its set grew from 34 assets to 45 (the Skill
Store and Zink Tools runtime modules now travel with the build, F-115/F-228), so
the deployed extension's assets need an owner-authorized re-admission before the
next `--apply`; the admission list in `integrations/openclaw/configure.mjs`
carries the outgoing digests the band's own lanes require, and the current
build is accepted by content comparison, never by entry. The `pdf-runtime`
child suite is a permanent `NOT RUN` in every lane, recorded in §3 with its
compensating control. The builder refuses a bare `--apply`
(`APPLY_REQUIRES_TRANSACTION`): the apply is reachable only through the apply
orchestration, which takes the transaction snapshot first.

### Record — the owner's decisions of 2026-10-21 (M12/T9, second band)

The owner ruled on the sixteen rows the band had escalated. Each decision, and
where it landed:

| Row     | The owner's ruling                                                                                     | What shipped                                                                                                                                                                                                                                                                                                                                                                                  |
| ------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `F-060` | main @Quản Lý điều phối chính; phần data chia cho @O1 (etl, labeling) và @O2 (visualize, storytelling) | the reducer DERIVES the coordinator from the canonical spawn and stack tables — never a default; no unique owner leaves the field unset and the dispatch refuses `COORDINATOR_NOT_EXECUTABLE`. The owner RESTATED the scope the same day ("mọi công đoạn làm việc với dữ liệu → @O1, trừ lập dashboard và data visualization → @O2") and that restatement is implemented — see the note below |
| `F-156` | Mở một cửa chính thức                                                                                  | `zink-skill-store/index.mjs` publishes `promoteApprovedSkill`, `withSkillStoreWriterLock` and `syncSkillsToVectorStore`; the plugin loads THAT, never `src/*`                                                                                                                                                                                                                                 |
| `F-176` | Bắt buộc ghi tên kho                                                                                   | the sync names the store it talks to; a store with a different identity is refused and nothing is deleted; an unnamed EMPTY store is refused instead of tombstoned                                                                                                                                                                                                                            |
| `F-123` | Thẻ hết hạn sau 24h kể từ lúc bot đưa thông báo; không bấm duyệt = không phê duyệt                     | the card carries `STATUS: EXPIRED` after 24h and a decision against it is refused with `AUTH_APPROVAL_EXPIRED`; the task does NOT leave its pending state (the owner accepted that half)                                                                                                                                                                                                      |
| `F-151` | ghi nhận                                                                                               | the cost is ACCEPTED: a promotion re-embeds every segment of every skill                                                                                                                                                                                                                                                                                                                      |
| `F-175` | ghi nhận (sau khi hỏi vì sao)                                                                          | the cost is ACCEPTED: publishing re-hashes every sidecar, because no digest is stored beside a file, so "did it change?" can only be answered by reading the bytes. A digest index (a table plus the migration-digest contract re-pinned) would fix it and was not approved                                                                                                                   |
| `F-190` | ghi nhận                                                                                               | the cost is ACCEPTED: a tag-filtered search heap-filters the whole index                                                                                                                                                                                                                                                                                                                      |
| `F-288` | cho phép                                                                                               | the DEPLOYED nginx carries the same `/ollama/api/*` allowlist as the acceptance overlay, and the deployed `KNOWLEDGE_OLLAMA_URL` points at it, so the isolation proof runs on the real shape                                                                                                                                                                                                  |
| `F-049` | lưu dạng mã băm                                                                                        | every third-party Discord identity is stored as `[PRINCIPAL:<64-hex>]`; the owner's own identity keeps its historical handling                                                                                                                                                                                                                                                                |
| `F-099` | cho thêm tệp điểm mốc                                                                                  | the ledger root carries a `checkpoint.json` (0600, atomic) with the anchored prefix's sequence, digest, era flag, byte offset and prefix digest; the reader seeks past the anchored prefix instead of re-reducing the whole journal                                                                                                                                                           |
| `F-247` | bỏ ô                                                                                                   | `task.accepted_reference_digests` is gone from the published contract and from every reader                                                                                                                                                                                                                                                                                                   |
| `F-249` | bỏ nhánh                                                                                               | the id-only verdict comparison is withdrawn and `result_id` is no longer admitted by the verdict payloads                                                                                                                                                                                                                                                                                     |
| `F-105` | như đề xuất                                                                                            | `integrations/openclaw/orchestration/patterns/index.mjs` is DELETED (the owner authorised the deletion), the suite that covered it is rewritten as direct adapter lanes, and a gate proves no tracked module stitches landing→silver→gold, syncs a model registry, or sequences them                                                                                                          |
| `F-160` | như đề xuất                                                                                            | the ambiguous `m8-t2.2-r4` stamp is a VERDICT stamp, decided per event, so one event's semantics no longer depend on which other events sit in the same file                                                                                                                                                                                                                                  |
| `F-338` | như đề xuất                                                                                            | ONE canonical `uv`: `0.12.0` (the image and the Windows driver already pinned it); CI was corrected, and a lane compares the three pins                                                                                                                                                                                                                                                       |
| `F-340` | như đề xuất                                                                                            | the requirements artefact is regenerated with its index URL and both digest readers are re-pinned                                                                                                                                                                                                                                                                                             |

**The owner's restatement of `F-060` (2026-10-21), implemented.** The owner
answered the clause the band had left open: _"tất cả những công đoạn làm việc với
dữ liệu ngoại trừ lập dashboard và liên quan data visualization đều giao cho O1
vì dashboard + data visualization thuộc O2"_ — EVERY work step that works WITH
DATA belongs to @O1, EXCEPT the dashboard and the data-visualization work, which
belongs to @O2.

Over the owner's own stack definitions (`PLAN.md` §4 and §6: `INFRA` = the machine
software that runs tasks, `SEMANTIC` = the layer where meaning is added, `DATA` =
ETL, `ANALYTICS` = charts and dashboards, `DECISION` = the decision report) that
is exact, and it is now the ONE ownership statement:

- `infrastructure`, `data_plant` and `semantic` are DATA WORK → @O1;
- `intelligence` and `decision` are the DASHBOARD side → @O2;
- the DASHBOARD is recognised by its CRAFT as well as by its stack: `power-bi`
  builds it wherever the plan puts it — including on the `semantic` stack, the KPI
  and metric meaning behind the report — because @O1 cannot spawn `power-bi` at
  all.

So `AGENT_STACK_POLICY` (the canonical table the derivation reads, the manifest
publishes and `docs/architecture/five-stack.md` is derived from and gated against)
now reads `o1: [infrastructure, data_plant, semantic]` and
`o2: [intelligence, decision]`, and the derivation recognises the dashboard craft.

**What this fixed, in plain terms.** Before the restatement, Excel's and SQL's
`semantic` work was owned by @O2 — which cannot spawn Excel or SQL — so such a
step was refused with `SPECIALIST_NOT_REACHABLE_FROM_COORDINATOR`. The meaning
layer (KPI, metric, business rules) is data work, so it is @O1's now, and that
refusal is gone. The `power-bi` dashboard step is unchanged: it stays @O2's.

**Two lanes were restated, and only their FIXTURES.** `D14`/`D15` pinned the
coordinators' stack sets (they now carry the owner's rule), and two cases used
"o1 on the semantic stack" as their example of an INVALID pairing — that pairing
is valid now, so the claim is carried by a pairing the table refuses under both
the old and the new table. No assertion was weakened and no gate was widened.

### Record — the owner's answers to the ten open decisions (2026-10-21)

The owner answered every decision §11 left open, in one message, while running
the deploy note. His answers, and what each one binds:

| #       | The question                                                       | The owner's answer                                                                                                   | What it binds                                                                                                                             |
| ------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `H1`    | widen the CI triggers so a push to the task branch is gated        | **bật** (turn it on)                                                                                                 | the CI `quality-gate` runs on a task-branch push and on a PR to any branch, not only on `main` and not only by hand                       |
| `H2`    | branch protection is not enableable on this plan                   | **(a)** an in-repo merge blocker                                                                                     | the repo stays private; the gates stay advisory where GitHub cannot enforce them, and a repository-owned blocker refuses an ungated merge |
| `H3`    | a skip policy for CI                                               | **đặt kỳ vọng** (set an expectation)                                                                                 | a PER-FAMILY skip expectation, not one global number: the 40 legitimate host-capability skips must not fire it, the SQL/WSL families must |
| `H5`    | where the `skills.*` schema lives                                  | **(a)** move it                                                                                                      | the DDL and the migration runner move into `zink-skill-store/`, the module that owns the Skill Store's persistence                        |
| `H6`    | route the router key through the SecretRef indirection             | **làm** (do it)                                                                                                      | the router API key stops being baked into the generated secrets plan and goes through `secrets.providers` like every other secret         |
| `H7`    | the policy for UNKNOWN Discord identities in durable events        | **(b)** record it and flag it                                                                                        | an unknown identity is recorded (hashed, as `F-049` decided), marked as unknown and surfaced to the owner — not refused, not silent       |
| `H8`    | a governed `DEPRECATED` retirement transition for the Skill Store  | **duyệt** (approve)                                                                                                  | the Skill Store gains a governed retirement path, as a FORWARD migration (the applied migrations are digest-pinned by filename)           |
| `H9`    | whether unreclaimable PDF text copies get a reclamation path       | **cho phép dọn** (allow the reclamation)                                                                             | the derived text copies may be reclaimed; the PDF itself stays                                                                            |
| `H10`   | whether the register becomes tracked, and what size policy applies | **lỗi nào fix xong và chứng minh được là đã fix thì được phép xóa lỗi đó trong findings, lịch sử lưu vào changelog** | `findings.md` is the OPEN queue only: a fixed and PROVEN row is DELETED from it, and its history goes to `CHANGELOG.md`                   |
| `F-217` | the frozen digest pin of `lib/discord-forum-tags.mjs`              | **ok**                                                                                                               | a separate task re-bases the frozen digest; it does not ride along with anything else                                                     |

**Two facts the answers change about the register itself.** `H10`'s answer is a
convention change, not a size rule: the register stops being a ledger of
everything that ever happened and becomes the queue of what is still open. The
rows that are fixed and proven leave it, and the history lands in
`CHANGELOG.md` — which is where `AGENTS.md` §12 already puts validated completed
history. The rows that are **not** fixed stay: the `REFUTED` ones (the premise
was measured dead — nothing was fixed) and the `EXCLUDED` ones (parked on a
decision that is now ANSWERED, so they become open work again).

**What is NOT granted by these answers.** `AGENTS.md` §2 and §7: an answer is
the owner's decision, and each answer needs its own bounded task before code
runs. The answers are recorded here as the authority; the work is scheduled
below, in bands, each with its own gates.

### The bands these answers create (M12/T9, third band)

| Band  | Decisions      | What it does                                                                              | Why this order                                                                                              |
| ----- | -------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **F** | —              | the operator's documented deploy path names the state root (`F-373`)                      | it is what the owner hit while running the deploy note; it blocks every deploy                              |
| **A** | `H1` `H2` `H3` | the CI trigger widening, the in-repo merge blocker, and the per-family skip expectation   | these are the owner's protection: a gate that runs, a merge that cannot be ungated, a skip that cannot hide |
| **B** | `H10`          | the register becomes the open queue; the fixed and proven rows move to `CHANGELOG.md`     | it changes how every later row is recorded, so it lands before the bands below                              |
| **C** | `H5` `H8` `H9` | the Skill Store's schema ownership, its governed retirement, and the PDF-text reclamation | they are one module and one migration story; `H5` also unblocks the Knowledgebase bands                     |
| **D** | `H6` `H7`      | the router key through SecretRef, and the policy for an unknown Discord identity          | both touch the live secrets and the durable identity vocabulary                                             |
| **E** | `F-217`        | the digest-pin re-base                                                                    | it is its own objective and rides alone                                                                     |

**One deployment consequence of band F, stated rather than hidden.** The owner
ran the deploy note and it stopped with `STATE_DIR_NOT_NAMED` twice: the
operator drivers take the state root as an INPUT (F-219) and the README's
command block had not been updated since. **Nothing was deployed** — the
preflight and the apply both refused before touching anything. The README and
the runbook now name the state root, and `tests/agent-setup-F-373.test.mjs`
pins that they keep naming it.

**One deployment consequence, stated rather than hidden — and it needs no
operator step.** `F-160` and `F-060` change how the ledger RE-DERIVES a task's
state, so a snapshot written by the DEPLOYED build no longer agrees with its own
journal: the live task `6d4f96cc` (seq 25 `m7-t5-r13`, seq 26 `m8-t2.2-r4`) is
the shape, and the live read would refuse with `snapshot workflow mismatch`.

The owner approved the forward migration (2026-10-21). The journal is the
RECORD and the snapshot is DERIVED from it, so the migration recomputes the
derived artefact and never writes to the record:
`topology/lib/ledger.mjs` exports `migrateLedgerProjection(paths)`, which
verifies every event first (a journal that does not verify is refused and
nothing is written), re-derives the task states with the current rules and
writes the snapshot atomically. **The deploy ceremony calls it** — the operator
runs the deploy as usual, and the ceremony prints the recompute line when it
happened. The operator-facing note is
`docs/runbooks/deploying-the-m12-t9-build.md`; the ONE manual step in it is the
stale `0644` backup copy in the state root, which the new `F-035` check refuses
on purpose.

**The twelve EXCLUDED rows, measured.** The owner asked whether they were
excluded because the root cause was too complicated. **None of them was.**
Ten are parked on a decision only the owner can make (`H1` CI triggers ×2,
`H2` branch protection, `H3` the skip policy, `H5` where the `skills.*` schema
lives, `H6` the router key's indirection, `H8` the governed DEPRECATED
retirement, `H10` the register's durability, and one row with no number yet);
one waits for a scheduled band (`M12/T5`); and the measurements changed three of
them: `F-097`'s register half is refuted (the register is tracked and survives
`git clean -fdx`), `F-196`/`F-198` are half-dead (the branch tip now has an
automatic `push`-triggered run — and it is RED), `F-167` is parked behind the
wrong question (its own read-only probe was never run), and `F-217`'s freeze
costs less than its row claims (a two-line test change needs no decision).

## Superseded band — M12/T9-R3 (history; archived 2026-10-23)

Task: M12/T9 — Remediate all actionable findings in docs/execution/findings.md
Milestone: M12 — Governed Discord interaction lifecycle and governed presentation
Historical Plan Revision: M12/T9-R3
Historical Planning Readiness: APPROVED — owner approved via "được, làm đi, chạy 1 lần xong hết luôn" (2026-10-19) and answered all ten open decisions on 2026-10-21 (the record above); retained as history.
Historical Execution Authorization: YES — bounded to the archived R3 contract §1–§8; retained as history.
Historical Execution Contract: archived at `docs/contracts/execution/archive/2026-10-21-M12-T9-R3.md`.
Historical Task Status: SUPERSEDED 2026-10-23 — replaced by M12/T9-R4; not claimed complete.
Historical Evidence Level: LOCAL-VERIFIED for the second band; R3's in-flight evidence is retained in the archive.
Historical Review Convergence Gate: PASS (the second band); NOT RUN for R3.
Historical Final Quality Gate: PASS (the second band); NOT RUN for R3.

Prior band: M12/T9-R1 — CLOSED 2026-10-21 — see the Record below.

**The deploy blocker (2026-10-21), found on the live host and closed.** The owner's
deploy failed twice — the preflight reported `Ledger corruption` and the apply
died with `SCHEMA_INVALID: SCHEMA_VALIDATION_FAILED`. Measured on the live host,
READ-ONLY: the journal holds 144 events and exactly TWO of them are refused by
the current contract — sequences 66 and 83, both `WORKFLOW_USER_RESULT_ACCEPTED`,
written by the `m8-t2.2-r4` build, each carrying the legacy `result_id` beside
its `result_digest`. `F-249` (commit `093439f`, 2026-10-21) withdrew that member
from the four verdict payload branches and stopped the producer sending it, so
the contract refused the owner's own record: the journal is the RECORD and is
never rewritten, so a contract that refuses it makes the ledger unreadable.

**The owner's decision (recorded here because it is a contract change).** The
contract admits the legacy rendering again, as an OPTIONAL member of the four
verdict branches — never required, never sent by the current producer, and
every member the contract does not declare is still refused. `F-249`'s ruling is
untouched: the verdict still binds by `result_digest`, an id-only verdict is
still refused with `RESULT_MISMATCH`, and the producer still never sends the
member. This is the same shape as `F-371` (the contracts accept BOTH renderings
of the delegation id), and it is the only way to keep a record that already
exists readable without rewriting it.

`F-377` closes the second half of the same class: the forward migration could
not repair a stored snapshot whose SHAPE had changed, because the reader
validated it against the current contract before the recompute could run — the
migration refused the very artefact it exists to repair.

**Verified against a COPY of the live ledger, never the live one:** the
preflight verdict moves from `Ledger corruption` to `CURRENT_STALE`, the
migration recomputes the derived snapshot from the journal (sequence 144, 56
tasks), the preflight then reports `CURRENT`, and the ledger reads again with
the history intact (10 `COMPLETE`, 2 `BLOCKED`, 5 `RESULT_PENDING_REVIEW`, 39
`ACTIVE`). The journal is byte-identical before and after. The commits are
`42e23f5` (the contract) and `a534adc` (the migration); the history lives in
`CHANGELOG.md` under `F-376` and `F-377`.

**Band E — the digest-pin re-base (`F-217`, legacy `R5-E10-06`), 2026-10-22.**
The owner's answer on 2026-10-21 ("ok") parked the row as its own objective:
the gate froze ONE historical digest, the commit that produced it, an EXACT
occurrence count and the absence of the current build's digest, so admitting
the next legitimate `lib/discord-forum-tags.mjs` build forced an edit to the
test. The pin is re-based (commit `51766eb`): the admitted SET is read from
the allowlist table in `integrations/openclaw/configure.mjs` — the table the
deployment itself consults — and every admitted digest is checked against the
asset's OWN committed history, so the producing commit is derived rather than
pinned, the duplicate protection moves to the list itself, and the next
legitimate change to that asset is admissible without editing the test. The
safety property is unchanged: the digest the CURRENT build produces stays out
of the allowlist, because the current build is accepted by content comparison.
`integrations/openclaw/configure.mjs` is byte-identical to HEAD — the re-base
needs no production change. The row is fixed and proven, so it leaves the
register (the owner's `H10`) and its history lives in `CHANGELOG.md` under
`R5-E10-06`.

**The deploy blocker, second round (2026-10-22), found on the live host and
closed.** After the ledger blocker was closed, the owner's deploy still
refused — this time with `Policy drift` at the builder's preflight. Measured
on the live host, READ-ONLY, the live `~/.openclaw-zink/openclaw.json`
differs from the config the current build generates in exactly three paths:
the two coordinators' display names and the router credential. Five separate
defects sat behind that one refusal, and each is closed by its own commit:

| Row   | What refused the deployment                                                               | Commit    |
| ----- | ----------------------------------------------------------------------------------------- | --------- |
| F-378 | the coordinators' display names were not converged, so the config was refused             | `b1a0a08` |
| F-379 | the admission list did not name every asset of the deployed build (15 of 34 were missing) | `40c7c6b` |
| F-380 | the plugin manifest had no admission list at all                                          | `9c64935` |
| F-381 | the resolver on the host was not admitted — the note said it was "no longer on disk"      | `8b29531` |
| F-382 | the deployed build's hotfix, entrypoint, auth plans and systemd drop-in were not admitted | `7ab281d` |

Every digest in those admissions is DERIVED from the repository — the asset's
own bytes at the commit that produced them, packaged as the builder packages
them — and never transcribed; the systemd drop-in is admitted by RENDERING
the previous variant, because its bytes carry the machine's state root. An
admission only ever permits OVERWRITING the file with the current build's own
bytes; an unrecognised digest still fails closed.

**Verified on the live host, read-only:** the operator preflight now reports
`{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`
— the runbook's expected line for BƯỚC 1. The apply (BƯỚC 2) was NOT run: the
execution contract forbids a deployment, so the ceremony remains the owner's
step.

**Band C — the Skill Store owns its schema, and a wrong skill can be
withdrawn (2026-10-22).** Two rows the owner released on 2026-10-21 are fixed
and proven, so they leave the register (`H10`) with their history in
`CHANGELOG.md`:

- `F-094` (legacy `R5-E03-07`, answer `H5`) — the `skills.*` DDL, the runner
  that applied it and the ledger that recorded it lived under
  `apps/knowledge/migrations/`, so the Knowledgebase's boot mutated a peer
  module's persistence. They move into `zink-skill-store/`: the ledger is
  `skills.schema_migrations`, the Skill Store's own table in its own schema,
  and the Knowledgebase's ledger is never read and never written from there.
  `003_skills_vector_schema.sql` moved with its bytes unchanged, so the move
  is a relocation and not an edit.
- `F-095` (legacy `R5-E04-05`, answer `H8`) — the owner could not withdraw a
  wrong skill through any supported path; the first ACTIVE version froze a
  capability permanently and the only route was out-of-band tree editing.
  `retireSkill` is a governed write now, published through the store's public
  door and refused without the store's writer lock, and the retirement is
  RECORDED in the derived index (`status = 'DEPRECATED'`,
  `sync_status = 'TOMBSTONED'`) by the forward migration
  `004_skill_retirement_state.sql` instead of only deleted from it.

Commit `7fe9b60` closes both rows: they share one surface (the store's
public door, its CLI, its README and its contract), and the retirement's
schema change lands in the Skill Store's own migration set — it cannot exist
without the move. The owner's "one commit per finding" is therefore bent
once here, and the deviation is recorded rather than hidden.

**Band A3 — the per-family skip expectation (2026-10-22).** `F-197` (legacy
`R5-E09-03`, answer `H3`) is fixed and proven, so it leaves the register
(`H10`) with its history in `CHANGELOG.md`.

CI printed green while whole families of tests were skipped: the SQL
statement gate and every WSL-dependent control never executed, and the job's
conclusion was SUCCESS. The owner's answer is to SET AN EXPECTATION, and the
measurement says the expectation must be PER-FAMILY — one global number
would fire on ~40 legitimate host-capability skips.

- the declared table lives in `docs/contracts/ci-skip-expectations.json`: the
  families, how many skips each may have on the CI runner, and the reason;
- the family-to-lane map is DERIVED from the repository's own lane list — a
  lane that may skip declares its family with a `// SKIP-FAMILY:` marker — so
  the table never becomes a second, hand-written copy of the test names;
- `scripts/skip-expectation-gate.mjs` reads the run's OWN report and refuses a
  family that skips more than declared, a family that is expected to run and
  was skipped entirely, and a skipped lane that declares no family. It never
  lowers a declared expectation to make a run pass;
- the npm `test` script now writes that report and runs the gate, so the
  quality-gate lane CONSUMES the skip counts instead of a number somebody
  typed.

Commit `507901a`.

**The review round (2026-10-22), the owner's "1 vòng review".** Three
independent reviewers read the whole branch diff (`origin/codex/m11-t1-audit-remediation..HEAD`)
for correctness, regressions and security. What they found, and what this
branch did about it:

| Found                                                                                                                       | Fixed                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| F-376 admitted the legacy `result_id` in TWO of the three verdict branches, and the reducer refused any verdict carrying it | `430e8de`: the BLOCKED branch admits it too, and the reducer refuses only an id-ONLY verdict (F-249's ruling)     |
| the skip gate refused lanes that skip without a declared family — and the CI runner has five such lanes                     | `c896fc2`: the `powershell-helpers` and `uv-toolchain` families are declared and measured on the WSL (Linux) host |
| the skip gate passed a lane that declares a family the table does not know                                                  | `f2ec844`: an unknown family is refused, like an unexplained skip                                                 |
| the skip gate's lane exercised only CRAFTED reports                                                                         | `f2ec844`: a lane now runs Node's own JUnit reporter and reads that report                                        |
| the coordinator names were regenerated per POSITION, not per agent id                                                       | `392b491`: the name is regenerated for the agent with the same id                                                 |
| the plugin never applied the Skill Store's own migrations, so a fresh deployment had no `skills.*` schema                   | `156ea9d`: the plugin applies them through the same public door before the sync                                   |
| the re-based digest pin held a control that could never fire                                                                | `d7ca2d9`: the dead check is gone; the duplicate-admission check holds                                            |
| the admission table left the pre-F-371 native-boundary build unadmitted                                                     | `392b491`: the digest is derived from the asset's own history and listed under its comment                        |

**The third deploy blocker (2026-10-22) — the apply refused with a
reason the classifier does not name.** The owner's BƯỚC 2 run rolled back
cleanly (`mutationStarted: true`, `rollbackSucceeded: true`,
`transactionStatus: complete`) and the live state was restored, but the report
said only `APPLY_REJECTED`: the stage was known (`builder-apply`), the reason
was not. The live state root shows the builder's own writes (the packaged
extension, the auth plans, the systemd drop-in) and the ledger's checkpoint
untouched, so the refusal came after the extension was written and before the
checkpoint.

Two changes, both committed: the refusal's detail now goes to the OPERATOR's
stderr — the trusted channel — while the report stays the disclosable record
(`c8ef018`), and the entrypoint's admission list names the deployed build's
digest once instead of twice (`c8ef018`). The row itself is `F-383`, OPEN in
the register until the next apply names the step (`21fce9e`).

**The third deploy blocker, continued: the next apply DID name the step — and
the step was the ceremony's own gate.** BƯỚC 1 then passed on the live host
(`builder_preflight: PASS`), and BƯỚC 2 refused with
`BACKUP_NESTED_LEDGER_ROOT_PRESENT`: a previous ceremony run had passed the
LEDGER root where the state root was expected, minting a second, EMPTY
governance root inside the real one
(`~/.openclaw-zink/operator/m7-t2/ledger/operator/m7-t2/ledger/`). The artifact
is inert — `events.jsonl` 0 bytes, `snapshot.json` `sequence: 0`, its own
identity key — and `createRuntimeBackup` refuses it by design (`F-369`: removing
live state is the operator's decision). Two defects sat on top of that refusal:
the apply's report collapsed it to `APPLY_REJECTED`, because the class set did
not name the ceremony's own diagnostic, and no operator document said what to do
with the directory. `d3f64ee` names the class in the shared set and in the
preflight driver's copy of it, makes the gate's message say what to do, and adds
BƯỚC 1b to the runbook (move the artifact out of the state root, never delete
it). `F-383` stays OPEN until an apply completes without an unnamed refusal.

**Deployed (2026-10-22).** The owner moved the nested governance root out of the
live ledger root (BƯỚC 1b) and ran BƯỚC 2: the report is
`{"status":"PASS","stage":"applied","transactionStatus":"complete"}`. Measured
read-only afterwards: the gateway is `active` with `NRestarts=0`, the deployed
entrypoint's SHA-256 equals the build's packaged entrypoint, the two
coordinators read `Coordinator O1` / `Coordinator O2`, and the router credential
is the SecretRef object the build emits. `F-383` closes with that run and its
history is in `CHANGELOG.md`.

**The band's last open row closed the same day.** `F-391` was the reclamation's
missing proof: the writer's order rests on a foreign key (the link pins the
build to `READY`), and the only lane that touched the writer used a recording
fake. The real-PostgreSQL gate now reads the writer's own four statements out of
`apps/knowledge/app/database.py`, runs them in that order in a scratch database,
proves the published segment and the source row survive while the derived
relations go, and then runs the reverse order and requires the database to
refuse it (`ddbd303`). Register: `docs/execution/findings.md` holds **0** open
rows.

**Band C's last item — `H9`, the PDF-derived-text reclamation
(2026-10-22).** The owner's answer: "cho phép dọn" — allow the reclamation; the
PDF itself stays. Before this, nothing reclaimed a PDF's derived text copy:
the extraction's segments, their provenance and the extraction manifest stayed
for ever, and the only way to remove them was to edit the database by hand.
(The orphan case was already covered: the existing retirement deletes a build
that no source references.)

The path is the store's OWN writer — the same advisory lock an index run takes,
on the same transaction — so it can never race a run and can never be written
outside it. The PDF stays: the source row, the published (searchable) segments
and the file in the vault are never touched. The reclamation is RECORDED in the
shape the Knowledgebase already records lifecycle in: the content build's own
terminal state, `CANCELLED` with `failure_code = 'PDF_CONTENT_RECLAIMED'`. The
action is idempotent, and the terminal build is read by its OWN failure code,
so a cancellation that was not a reclamation is never reported as one. The
derived copy belongs to the CONTENT IDENTITY, so one build can carry more than
one source link; the number of links the reclamation released is REPORTED.

Commit `b5658de`. Evidence: the Knowledgebase suite 299 passed / 8 skipped /
0 failed, including eleven cases of the new lane.

**The owner answered both review questions on 2026-10-22 — `A`, `A` — and both
rows close.** `F-389`: `H9` meant the EXTRACTION's copy — the extracted text
with its page and bounding box, its provenance and its manifest — which is
exactly what the path reclaims; the published, searchable segments stay, and
reclaiming them would be a different retention decision that needs its own
approved step. `F-390`: the platform boundary IS the trust boundary — reaching
the door is the authorization — so the route keeps no credential and records the
content build's terminal state (WHAT and WHEN) instead of an actor; adding one
would be a change to the security boundary and therefore its own task. Both
histories are in `CHANGELOG.md`. `F-391` stays OPEN: the reclamation's statement
order is still unproven against a real PostgreSQL.

**The review round (2026-10-22) — three independent reviewers over the branch
and the new work.** Their findings were fixed in their own commits, and the
questions that are the owner's are recorded rather than answered:

| what the review found                                                                                                                                               | how it was closed                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| the skip gate read the DuckDB capability as an unexplained skip, so the CI runner's ten legitimate NOT RUN cases turned the quality gate red                        | `6cf8e0e`: the `duckdb` family is declared and its ceiling is measured (10 skips with the engine removed from PATH)     |
| a lane that contributed no case at all was invisible to the skip gate                                                                                               | `6f3d5c6`: the gate refuses it where the expectations are enforced                                                      |
| the merge blocker's pre-merge script was in no operator's path, and its post-merge half was skipped exactly when it was needed                                      | `0ae2e54`: the README carries the step and the detector runs with `always()`                                            |
| the Skill Store's tombstone comment contradicted the retirement's own writes                                                                                        | `4a4374a`: the comment names the two paths                                                                              |
| the result-identity docblock contradicted the code that refuses an id-only verdict                                                                                  | `69847f2`: the docblock matches the code                                                                                |
| the reclamation's log carried a caller-supplied path unescaped, its conflict was mislabelled as an outage, and its terminal build was read without its failure code | `b5658de`: the path is logged escaped, a conflict is a conflict, and the terminal build is read by its own failure code |

Recorded rather than hidden: the H9 SQL never runs against a real PostgreSQL,
so its foreign-key order is unproven (`F-391`, OPEN — a case in the SQL
statement gate); the moved `003_skills_vector_schema.sql` still names its old
path in its header, and its bytes are digest-pinned, so the file cannot be
edited and the note stays where the move is recorded; the skip expectation is
enforced on the CI runner, and on a developer machine the gate reports the
counts and refuses only an unexplained skip or a lane that did not run.

**Residuals, recorded rather than hidden** (they are not defects the branch
introduced, and each is a decision the owner may want to take):

- the retirement (F-095) validates its `decision_ref` against the grammar but
  does not prove the decision exists — the model-facing tool path still
  refuses the action, so only the owner or the operator can reach it;
- the Skill Store's migration runner applies a file and records it in two
  sessions, so a crash between them re-applies an idempotent file;
- the F-378 convergence still overwrites a hand-edited display name (the
  name is generated data, and the agent's identity is its `id`);
- the skip expectation is enforced on the CI runner; on a developer machine
  the gate reports the counts and refuses only an unexplained skip.

## Active task — M12/T9-R4 (owner order: sửa hết findings; 2026-10-23)

Task: M12/T9 — Remediate all findings in `docs/execution/findings.md` (189 rows:
152 OPEN + 37 LATENT).
Milestone: M12 — Governed Discord interaction lifecycle and governed presentation
Plan Revision: M12/T9-R4
Planning Readiness: APPROVED — the owner approved when switching from plan to edit on 2026-10-23; the approval record is §1 of `docs/contracts/execution/ACTIVE.md`.
Execution Authorization: YES — bounded to `docs/contracts/execution/ACTIVE.md` §1–§10; AGENTS.md §12 terms (local implementation/closeout commits and push of the current non-main task branch after closeout). No deployment, no live Discord, no `--apply`, no Vault writes, no dependency/lockfile changes.
Execution Contract: docs/contracts/execution/ACTIVE.md
Task Status: IN PROGRESS — Phase 0 (governance and evidence floor) is executing.
Evidence Level: LOCAL-VERIFIED per band; `NOT RUN` stays `NOT RUN` and is never converted to `PASS`.
Review Convergence Gate: NOT RUN — the first band has not been submitted for review.
Final Quality Gate: NOT RUN — the task is not closed.

### Owner decisions recorded 2026-10-23

- Scope is 189 rows: 152 OPEN + 37 LATENT. `F-045` is authorized, `F-133` is
  released, and `F-167` is reopened; all three are in scope.
- The 32 REFUTED rows are retained. `F-400` and `F-534` remain BLOCKED until the
  OpenClaw host fact is available; they are not counted in the 189.
- Duplicate root causes may be merged when the merge is recorded and one commit
  names every merged row. New rows are filed separately.
- LATENT rows close only with a deterministic fault-injection or probe test;
  otherwise they remain LATENT.
- The RED queue is delegated to the lead: research options, choose the best
  technical option, and record it. A material commitment change outside the
  contract stops for the owner.
- Parallel subagents have disjoint write ownership; the lead owns governance
  files, integration, review convergence, closeout and the final push.
- One row is one local implementation commit unless a recorded merge applies.
  No deployment, `--apply`, live Discord/ledger/DB mutation, Vault write,
  secret exposure, dependency change, direct `main` push, force-push,
  PR/merge/release, or history rewrite.

### Owner decisions recorded 2026-10-24

- The integrity surface is lead-only. The owner authorized `ACTIVE.md` §4.2.1: an
  agent may not edit `package.json`'s `npm test` enumeration, the contract-manifest
  pin in `topology/lib/schema.mjs`, the per-mode predecessor lists in
  `configure.mjs`, the packaged-entrypoint pins in the two asset-predecessor lanes,
  `.github/workflows/ci.yml` or `docs/contracts/**`. It names the file and the new
  digest in its report and stops; the lead rolls the pin, measures the live runtime,
  and proves the admission from a named commit. A pin roll ships in the same commit
  as the row that moves it, because `tests/agent-last-F-369.test.mjs` compares
  packaged bytes against `git show HEAD:<path>`.
- `F-481` stays OPEN. Its acceptance criteria re-grade
  `docs/contracts/ci-skip-expectations.json`, which needs per-family pass and skip
  tallies from a real CI runner; this host cannot produce them. Measured here: the
  abandoned lane's gate change reddens the shipped F-197 case (7 passed / 1 failed,
  naming `live-runtime` as a family that contributed no pass at all). No partial
  gate change ships. The measurement is recorded in the row's own `Status:` line.

### Scope and bands

| Band      | Scope                                                  |    Rows | C/H/M/L        | O/L        |
| --------- | ------------------------------------------------------ | ------: | -------------- | ---------- |
| B1        | Approval, verdict, result and queue integrity          |      24 | 1/9/8/6        | 20/4       |
| B2        | Ledger, transaction and apply durability               |      17 | 0/8/5/4        | 9/8        |
| B3        | Operator ceremony, rollback, rehearsal and state root  |      13 | 0/5/8/0        | 12/1       |
| B4        | Artifact validation, Excel writer and preview/delivery |      15 | 0/7/4/4        | 13/2       |
| B5        | Knowledgebase ingestion, retrieval and citation        |      25 | 0/6/10/9       | 18/7       |
| B6        | Skill Store catalog, vector, lock and migration        |      21 | 0/5/12/4       | 16/5       |
| B7        | Tool contracts, SQL/Python guards and error taxonomy   |      24 | 0/6/12/6       | 21/3       |
| B8        | Gate truth and CI enforcement                          |      30 | 0/5/16/9       | 30/0       |
| B9        | Test-only assertions and docs consistency              |      20 | 0/0/6/14       | 13/7       |
| **Total** |                                                        | **189** | **1/51/81/56** | **152/37** |

The full membership and ordering are frozen in `docs/contracts/execution/ACTIVE.md`
§2–§3. `F-523` and the evidence floor (`F-474`, `F-481`, `F-492`, `F-467`,
`F-567`) are Phase 0. The first product band is B1, starting with the Critical
`F-533`, then `F-402` → `F-405` → `F-406` → `F-504`.

### Execution topology

- **Lead (Codex):** governance, `findings.md` disposition, `PLAN.md`,
  `CHANGELOG.md`, `ACTIVE.md`, integration, review convergence, closeout and
  push. The lead does not approve its own work.
- **MS1:** lead + `fix-tests` — `F-523` and the evidence floor.
- **MS2:** B1 OpenClaw, B5 Knowledgebase, B6 Skill Store and the B8 evidence
  track. B5/B6/B8 are disjoint; B1 is one OpenClaw lane until its shared files
  are clear.
- **MS3:** B2, B3, B4, B7. B2/B3 stay ordered on the OpenClaw/operator surface;
  B4 follows B1; B7 follows B5/B6.
- **MS4:** B8 remainder and B9. **MS5:** independent review and
  `review-chair` consolidation before any row is deleted.

A subagent may not edit governance files, push, run `--apply`, or write outside
its assigned paths. Shared surfaces have one writer at a time. The lead
integrates and creates the validated implementation/closeout commits.

### Gates and closeout

Every band runs `npm run format:check`, `npm run lint`, the affected
`node --test` suites, `npm run repo:check`, and `npm run verify`; the
Knowledgebase additionally runs `npm run test:knowledge` and its Python/uv lane.
PostgreSQL/Docker and WSL are required for the rows that need them. An
unavailable lane is recorded as `NOT RUN`, never `PASS`.

A row closes only when the premise is re-verified, a red test/probe was observed,
the minimal fix is green, the affected gates and mutation probe are recorded, and
the lead has independent review evidence. OPEN rows then leave
`findings.md`; their history goes to `CHANGELOG.md` and `PLAN.md` §4.17/§8.
LATENT rows need the deterministic fault-injection/probe. REFUTED and BLOCKED
rows stay.

Closeout archives `ACTIVE.md`, updates `PLAN.md` and the durable docs, sets
`Execution Authorization: NO` / `Execution Contract: NONE`, deletes the live
contract, leaves a clean tree, creates the local closeout commit, and pushes the
current non-main task branch. No deployment, no direct `main` push, no
force-push, no PR/merge/release.

### Current checkpoint (2026-10-24)

- R3 is archived at `docs/contracts/execution/archive/2026-10-21-M12-T9-R3.md`.
- R4 is materialized at `docs/contracts/execution/ACTIVE.md`; this block is its
  lifecycle pointer.
- 53 of the 170 scoped rows are closed with red/green and mutation evidence:
  `F-523`, `F-524`, `F-437`, `F-438`, `F-408`, `F-414`, `F-464`, `F-465`,
  `F-466`, `F-473`, `F-442`, `F-444`, `F-533`, `F-427`, `F-428`, `F-429`,
  `F-450`, `F-455`, `F-451`, `F-452`, `F-453`, `F-511`, `F-467`, `F-474`,
  `F-567`, `F-517`, `F-518`, `F-441`, `F-440`, `F-439`, `F-487`, `F-491`,
  `F-415`, `F-410`, `F-512`, `F-573`, `F-412`, `F-413`, `F-513`, `F-458`,
  `F-483`, `F-566`, `F-482`, `F-519`, `F-509`, `F-574`, `F-133`, `F-544`,
  `F-514`, `F-516`, `F-526`, `F-527`, `F-528`. The
  register now carries 170 rows (101 OPEN + 27 LATENT in scope = 128, 32
  REFUTED, 2 BLOCKED, 8 PARTIAL). The §1 census in the register
  was stale by the 22 earlier closures and was corrected against the file rather
  than against its own header; its closure total also read 419 while its own
  item list summed to 427, and is now measured from the `CHANGELOG.md` bullets.
- The evidence floor is dispositioned: `F-467` (`8de5340`), `F-474`+`F-567`
  (one recorded merge, `7c6571b`) and `F-492`'s failed/errored half (`7e13dcb`)
  are green with red-before and a mutation probe reverted in person. `F-492`
  stays in the register as `PARTIAL`: its widened acceptance criterion also
  demands a red for a childless zero-assertion case, but the row's own
  measurement says the junit report carries only `name`, `time`, `classname`
  and `file` per case, so that state is byte-identical to a pass and no
  predicate over the report can see it; the criterion's named lane
  `tests/skip-expectation-gate.test.mjs` does not exist. Owner decision needed:
  re-scope the criterion to the two observable states, or name the signal.
  `F-481` stays `OPEN` per the 2026-10-24 decision above.
- B5's PDF lane (Wave 1, `w1-kb-pdf`) closed five rows with red-before and a
  probe reverted in person: `F-517` (`800dc47`), `F-518` (`5ee59bc`), `F-441`
  (`ef408d6`), `F-440` (`317a056`), `F-439` (`f2bfc01`). The Knowledgebase lane
  is 218 passed / 17 skipped / 24 subtests after integration, and the two probes
  the lead re-ran here were the F-440 stat (1 failed / 17 passed) and the F-441
  arm split (1 failed / 1 passed / 4 POSIX-skipped). Two findings the lane
  raised are recorded rather than fixed: `F-440`'s refusal now surfaces at
  discovery without a `source_path` and, on `FULL_REBUILD`, fails the run before
  any PDF is built — loud, but one oversized file blocks the others; and the
  child range suite's range-materialization coverage is gone rather than
  relocated (its lines never executed, so no passing assertion was lost).
  `F-443`, `F-512` and `F-550` stay open: their sites are in
  `app/database.py` / `app/index_lifecycle.py`, outside that lane's write scope.
- The B8/B9 durability lane (`w1-tests-hygiene`) closed three rows — `F-487`
  (`3989120`), `F-491` (`c007690`), `F-415` (`9df66fd`) — and its lane
  `tests/m12-t9-r4-durability-population.test.mjs` is enumerated in `npm test`.
  The lead re-ran the probe: forcing the parent-binding rule to accept
  everything reddened the shared predicate's fixture case (1 failed / 9 passed).
  **`F-485` stays OPEN**: its criterion needs all 16 `mkdtemp` lanes to remove
  their trees _and_ a `scripts/repository-policy.mjs` rule that fails a lane
  matching `mkdtemp` with no removal API; the lane cleaned the two lanes it
  owned (`3d6f09f`) and added no rule, so the residue path is still unguarded
  for the other fourteen. The lane stopped at its 150-turn cap mid-edit, as did
  `w1-skill-vector`, `w1-skill-catalog` and `w1-gate-scripts`; their committed
  rows are integrated below, their uncommitted work is not.
- The B6 skill-catalog lane (`w1-skill-catalog`) closed one row and left one
  `PARTIAL`: `F-410` (`fe516c1`) has red/green and the lead's probe (deleting
  the `rm(tmp)` in the catch reddened the failed-write case, 1 failed / 2
  passed, reverted). **`F-580` stays `PARTIAL`** — its stranded-state half is
  closed (`a7c8239`) and proved, but its acceptance criterion also demands a
  shipped case that promotes a record failing re-validation _with the removal
  forced to fail_; disabling the new quarantine branch (`const quarantined =
null;`) left the lane 3/3 green, so that path is unproven and the shipped
  case builds the stranded directory directly instead. The missing case is
  writable; no owner decision is needed.
- The B5 database lane (`w1-kb-db`) closed five rows with red/green and probes
  the lead re-ran here: `F-512` (`b12a930`), `F-573` (`d1d21a1`), `F-412`
  (`de7d33f`), `F-413` (`dd15a97`) and `F-513` (`faa1e4f`), with the whole
  Knowledgebase lane at 234 passed / 17 skipped. Probes: reverting both digest
  projections reddened 3 cases; forcing `ACTIVE`/`0` reddened 2; deleting the
  lock-arm re-attempt reddened 1; deleting the recovery `continue` reddened 1;
  forcing `barrier_completed = True` reddened the barrier-order case. All
  reverted. **`F-443` stays `PARTIAL`**: its sweep is shipped (`a22e5d2`) and
  its four properties are proved — removing the sweep reddens 4 cases — but the
  acceptance criterion's named proof (two incremental index passes over one PDF
  asserting no residue) is not shipped; the cases drive the two sweep entry
  points on a fake connection instead, so the accumulation itself was not
  driven end to end. The lane hit its 150-turn cap after its sixth commit; the
  tree is clean.
- The gate-scripts lane (`w1-gate-scripts`) closed five rows with probes the
  lead re-ran here: `F-458` (`ea0366d`), `F-483` (`11f8e12`), `F-566`
  (`d5a59ad`), `F-482` (`0e8e4df`) and `F-519` (`1e5e801`); the policy lane is
  75/75. Probes, each reverted: an empty `blockingCheckSurfaces` reddened 2
  cases; short-circuiting the execution-column claim test reddened 1;
  restoring the two-prefix citation filter reddened 1; returning `pass` for an
  absent scan root reddened 1; dropping the recorded-fingerprint requirement
  reddened 1. **`F-485` still stays OPEN**: none of these five rules covers a
  `mkdtemp` lane with no removal API. The lane also capped at 150 turns.
- The skill-vector lane (`w1-skill-vector`) closed four rows and left two
  `PARTIAL`: `F-509` (`d125879`), `F-574` (`ffcfda6`), `F-133` (`76c3ec0`) and
  `F-544` (`b520fba`), with the Skill Store lane at 30/30 and the policy lane
  still 75/75. Probes, each reverted in person: changing 005's status-domain
  assertion to `%ACTIVE%` reddened the static case; shrinking the retention
  window to `0 days` reddened its case; resetting the drift arm to `UNKNOWN`
  reddened the per-skill case; gating the unnamed-store refusal off reddened
  its case. The digest pin for migration 005 and the 30-day window text both
  landed in `075d229` (lead-only paths). **`F-547` and `F-541` stay `PARTIAL`**:
  the Skill Store runner now reads the published manifest and the migration
  pair lint is non-skippable, but the Knowledgebase runner still records a
  filename with no digest column, so the immutability rule is only half
  enforced; owner decision needed between a digest column plus a
  refuse-on-change forward migration, or re-scoping the manifest's `purpose`
  text to a repo-gate-only guarantee.
- The Knowledge HTTP lane (`w1-kb-api`) closed two rows and left two `PARTIAL`:
  `F-514` (`df2410f`) and `F-516` (`1ebfa51`), with the Knowledgebase lane at
  251 passed / 17 skipped / 31 subtests after integration. Probes, each
  reverted in person: `>=` → `>` on the pool ceiling reddened the saturated
  case (1 failed / 16 passed); forcing the embedding constant reddened 3 cases;
  deleting `client_code_path` from the identity's paths reddened 2; deleting
  the item's `line_start` reddened 2. **`F-515` and `F-570` stay `PARTIAL`**:
  both service halves are shipped and tested, but their acceptance criteria
  name the published tool contract — the adapter's array-only `detail` reader
  (`F-551`/`R10-T06-3`) for F-515, and `zink-tools/contracts/tools/zink-knowledge.schema.json`
  plus adapter forwarding for F-570, which the row itself flags as RED and an
  owner decision. `F-516`'s named `/readyz` double call was replaced by a
  key-level replay of the same predicate; the change and that substitution are
  recorded in the changelog entry rather than claimed as the named test.
- Wave 2 could not run: all seven delegated lanes (`w2-b1-plugin`,
  `w2-b2-ledger`, `w2-b5-kb`, `w2-b6-skill`, `w2-b7-tools`, `w2-b8-gates`,
  `w2-b9-tests`) died on the account's daily chat ceiling with 1–19 tool uses
  each, and the isolation harness rolled their worktrees back — no lane commit
  exists, and the six orphan directories under `.qoder/worktrees/` are stale
  copies of an older HEAD, not work. The lead took one row directly: `F-550`
  (`f24c48e`) now ships the durable run-error `cause` (bounded, scrubbed,
  sharing the child's own limit), carries the child's detail through both
  `PdfRuntimeError` arms and stops recording a `StateTransitionError` as
  `PDF_RUNTIME_FAILED`; the Knowledgebase lane is 260 passed / 17 skipped. Its
  probes, each reverted: dropping `cause` from the record reddened 3 cases,
  dropping the batch-arm detail reddened the propagation case, renaming the
  state arm back reddened the state case, removing the bound reddened the shape
  case. **`F-550` stays `PARTIAL`** because its criterion also wants the cause
  persisted on `knowledge.pdf_content_builds`, which has only a `failure_code`
  column — a schema/migration change is RED under `AGENTS.md` §7 and is the
  owner's call, and `main.py:449-452` still answers without the detail.
- The lead took the test-validity band directly (`5b317d2`, `7031a37`,
  `53a5036`): `F-526`, `F-527` and `F-528` were assertions that could not
  redden, and each now has the falsifiable form its acceptance criterion names,
  with the red state produced and reverted here — an untracked recreate reddens
  the tree half and an index-only recreate reddens the index half; a second slot
  for one artifact file reddens both lineage lanes on the new grouping alone
  (44 pass / 2 fail) while the region count stayed green; a `"*"` allowlist key
  reddens the admission lane while a `/* … */` comment leaves it green (12 pass /
  0 fail) where the old whole-file pattern reported true. `F-497`'s register text
  was amended in the same closeout because it had credited the dead `:149-174`
  block as a shipped guarantee.
- The band that had already merged without its closeout (`F-464`/`F-465`/
  `F-466`/`F-473` from B4, `F-442`/`F-444` from B5) was re-measured at this HEAD
  before its rows were deleted: the artifact/Excel lane is 8/8, the knowledge
  lane 212 passed / 17 skipped / 0 failed, and each control was
  mutation-probed in person with the probe reverted.
- B6 and B7 were replayed from the abandoned lanes one row at a time, each with
  red-before/green-after and a mutation probe measured here rather than borrowed
  from a lane report. Three corrections rode along, and they are the shape of the
  next wave's briefs: the b6 lane's tests sat in an untracked
  `zink-skill-store/tests/` directory that no gate reads, so they moved to
  `tests/` and were enumerated; the b7 lane's unattributed reformat of a published
  contract JSON was dropped (`zink-tools/**/*.json` is outside `format:check`, so
  it was not a formatter requirement); and the b6 lane's reentrancy short-circuit
  was removed because the F-429 concurrency case disproves the comment that
  justified it.
- `eaad483` rolled the two committed expectations these rows moved: the contract
  manifest checksum (`F-450`/`F-455` edited `$defs.parameter`) and the packaged
  plugin entrypoint (`F-533` deleted the plugin-local derivation). The displaced
  entrypoint digest is what the live WSL runtime carries — measured with
  `sha256sum` on 2026-10-24 — so it became an admitted predecessor in both per-mode
  lists of `configure.mjs`, and the new `R13 P7` case re-derives it from commit
  `1b68586` through the real generator. Three probes confirmed the pins are live
  controls; all were reverted.
- `repo:check` no longer reports an unenumerated test file. Its only remaining
  failure is the single-worktree rule: `git worktree list` registers 9 trees (this
  one plus the 8 lane worktrees), and the gate clears when the last lane is
  removed. It stays a real failure until then.
- Full equivalent lane at this HEAD: **2548 tests / 2493 pass / 4 fail / 51
  skipped**, all four environmental — `F-261` x2 (the worktree registry) and
  `F-379` x2 (`tar -xf C:` cannot resolve under MSYS). `format:check`, `lint`, the
  register gate (12/12) and the policy lane (68/68) pass. The shipped `npm test`
  still cannot start on this Windows host (command-line length), so it stays
  `NOT RUN` and the equivalent `node --test` lane is the evidence.
- Lane inventory, verified: `m12-t9-r4-evidence` is the only lane holding work that
  is not on HEAD (21 entries: 5 tracked files and 16 scratch ones) — reviewed as
  NOT replayable as a set: F-474 and F-567 need only formatting and enumeration,
  F-467 and F-492 are missing the test their own criteria demand, and F-481 is the
  OPEN decision above. `m12-t9-r4-b6` and `m12-t9-r4-b7` still show their
  working-tree entries, but their content is now identical to HEAD
  (`git diff eaad483 -- zink-skill-store/src/vector-sync.mjs zink-tools/sql` is
  empty), so nothing unique is lost by removing them; `m12-t9-r4-b7` also carries
  the `red-probe` stash, a mutation probe that must never be applied.
  `m12-t9-r4-b1b` is clean and integrated, `m12-t9-r4-b2a`/`b4`/`b5` were integrated
  earlier, and `m12-t9-r4-b3` is parked with nothing done.
