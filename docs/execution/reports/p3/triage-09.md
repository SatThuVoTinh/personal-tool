# Phase 3 triage — bucket 09 (loop 1)

- Agent: `triage-09` (phase 3, loop 1). Read-only on source; only this file was written.
- Assigned register rows: `F-OC-007` (`docs/execution/findings.md:2215-2226`), `F-OC-008`
  (`docs/execution/findings.md:2228-2239`).
- Baseline: dispatch tree HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a` on branch
  `codex/m11-t1-audit-remediation`, already dirty before dispatch (`docs/execution/context.md:21`).
  HEAD and branch were confirmed by reading `.git/HEAD` and `.git/refs/heads/codex/m11-t1-audit-remediation`.
  The `shell` tool was permission-denied in this lane, so `git status --short` / `git diff` could not be run and
  dirty-tree hunks cannot be separated from HEAD. Every cited locator was re-opened in the working tree and
  matched. No nested `AGENTS.md` exists under `integrations/` or `docs/` (glob returned none).
- Lanes read: P1 `scan-oc-5.md:19-30`, `scan-oc-6.md:1-20`; P2 `xcheck-oc-gov-topo.md:51-56`,
  `xcheck-oc-discord-gov.md:40-56`, `xcheck-infra-oc.md:35-36`, `xcheck-tests-all.md:216-242,276`.
- Counts: CONFIRMED-AS-LATENT 2 (F-OC-007 Medium, F-OC-008 High). REFUTED / OVERSTATED / UNDERSTATED /
  DUPLICATE-OF / WRONG-SITE / BLOCKED: 0. Blockers: two external-dependent probes remain NOT RUN (see §Blockers).

---

## F-OC-007 — a superseded delegated run can pass specialist message provenance and publish to Discord

**Verdict: CONFIRMED-AS-LATENT** (the authorization gap is code-proven; the firing depends on the host
presenting a late message from the superseded run).

### Evidence re-verification (every locator, working tree)

- `integrations/openclaw/plugins/zink-governance/index.mjs:10157-10162` — `specialistExecutionProvenance`
  calls `findSession(readSnapshot(paths), sessionKey, ctx.runId, true)`. CONFIRMED: the fourth argument is the
  literal `true`.
- `index.mjs:10163-10175` — only `owner?.task` and `owner?.delegation?.agent_id` are extracted and passed to
  `evaluateSpecialistProvenance({agentId, task, delegationAgentId})`. CONFIRMED: no run id, no attempt, no
  `native_run_id` comparison reaches the evaluator.
- `index.mjs:876-903` — `evaluateSpecialistProvenance` checks agent identity, `delegationAgentId !== agentId`,
  `task.approved_at`, and the task-wide status set (`EXECUTING`, `RESULT_PENDING_REVIEW`, or `ACTIVE` with
  `claimed_at`). CONFIRMED: there is no run/attempt condition anywhere in the function.
- `index.mjs:10133-10138` — `SPECIALIST_AGENT_IDS = ["excel","power-bi","sql","python"]`; `index.mjs:10178-10182`
  registers `api.on("message_sending", ...)`. CONFIRMED: this is the live registered hook, not a dead export.
- `index.mjs:10205-10216` — on `provenance.allowed` the handler logs and falls through; `index.mjs:10241-10252`
  is the separate destination gate; `index.mjs:10307-10310` returns the formatted content. CONFIRMED allow-to-publish
  path.
- `integrations/openclaw/topology/lib/workflow.mjs:323-344` — `findSession(..., includePrevious)` matches
  `delegation.previous_native_run_ids` at `:340-343` (and `task.previous_root_run_ids` at `:333-334`). CONFIRMED.
- `workflow.mjs:404-419` — `ownerRunIds(owner, includePrevious = true)` and the `D07` comment show historical
  resolution is deliberate; `:345-355` documents the third (coordinator) owner shape, which has no previous ids.
- `workflow.mjs:421-435` — `isSupersededAttempt` (higher `attempt` for the same `node_id` + `brief_revision`).
  CONFIRMED (the row cites `:421-434`; the function closes at `:435`).
- `workflow.mjs:1924-1980` — `WORKFLOW_CONTINUATION_STARTED` requires `run_state === "RUNNING"` (`:1962`), pushes
  the current `native_run_id` into `previous_native_run_ids` (`:1963-1972`) and then replaces it (`:1973`). The
  delegation stays `RUNNING` with the same `child_session_key`. CONFIRMED: after a continuation, the retained old
  run id still resolves to the same RUNNING delegation, same agent, same still-executing task.
- Contrast arms: `workflow.mjs:737`, `:1614`, `:1650` all gate on `isSupersededAttempt`. CONFIRMED that the
  current-attempt condition exists elsewhere in the same module and is missing only at this seam.

### DUPLICATE-OF check — no

- `F-532` (`findings.md:1526-1537`) is the `execution_finished` finish-fence self-comparison (queue-item fence
  fields into `finishExecution`) and the dead `activeClaims` guard. Different seam, different sink (result commit vs
  outbound message admission), different files (`index.mjs:9913-9926`, `queue-manager.mjs:902-916`). Not a duplicate,
  and F-OC-007 is not a symptom of it. No relation to F-296, F-417 or F-106.

### WRONG-SITE check — no

Decision site is the governance plugin's registered `message_sending` hook; current-vs-previous run identity is
topology-owned state. Both paths are inside `integrations/openclaw/` (AGENTS §9 hosting boundary), so the row is
correctly sited and correctly routed away from the three logical modules.

### Refutation attempt and its exact limit

The strongest refutation is that nothing in this repository can *produce* the firing event. The ledger only gains
`previous_native_run_ids` from a host-observed continuation, and publication then requires the OpenClaw host to call
the `message_sending` hook with `ctx.runId` equal to the superseded run while the delegated session key is unchanged.
Whether the pinned host delivers a late outbound message attributed to a run it already replaced is not established
by any in-repo caller, fixture or test. Test coverage confirms the gap is untested rather than covered:
`tests/m12-t1-result-preview-and-ownership.test.mjs:295-407` calls the pure evaluator with fixtures that carry no
`native_run_id` at all; `tests/m7-lane-j-attempt-semantics.test.mjs:268-365` drives supersession through the reducer
(`WORKFLOW_RESULT_RECORDED`, `WORKFLOW_NATIVE_ENDED`), not message admission;
`tests/m11-t1-openclaw-outbound-and-caches.test.mjs:213-260` is the only lane that drives the real hook (via
`registerPlugin`, `:520-539`) and it uses `agentId: "main"` with no `runId`, so the specialist provenance branch at
`:10205` is never entered. No host-level message probe was run here.

Therefore the surviving, verified half is the missing current-attempt condition in an authorization gate that the same
codebase enforces three lines away in the reducer; the contingent half is host delivery. Under the register's §0.3
vocabulary that is `LATENT` (code-proven, not live-fired), not plain `OPEN`, and not `REFUTED`. The P2 wording "active
stale-run-to-message provenance defect" (`xcheck-oc-discord-gov.md:55`) and "reachable"
(`xcheck-oc-gov-topo.md:54`) should be re-worded to "code-proven, host-delivery conditional"; that is a wording
qualification, not a downgrade of the mechanism.

### Finding fields

- type: `security` (register §0.4 category `F2 — Security & Authorization`; keep F2).
- severity: **medium** — conditional, degraded owner trust (a superseded run could report to the owner as the live
  task owner); no data loss, no state mutation, no outage. Not root-cause of any other row.
- root_cause_of: none.
- depends_on: none. Constraint, not a dependency: the fix must not change `findSession`'s global
  `includePrevious` default (`workflow.mjs:323-358`) or `ownerRunIds` history semantics, and must not weaken the
  supersession arms at `:737/:1614/:1650`.
- red: **NO**. The smallest sound fix is plugin-local and preserves approved scope, ownership, public API,
  persistence semantics, dependencies, topology, resource ceilings and the security boundary — it narrows admission to
  the intent already documented at `index.mjs:10140-10147`. Escalation trigger: if instead the fix introduces a new
  "current-only resolution" contract/export in `topology/lib/workflow.mjs` (a module public surface used by other
  hooks), that is RED and needs the owner decision before execution.
- fixer: **fix-openclaw-governance-plugin** (decision site is the plugin's message hook). Files the fix would touch:
  `integrations/openclaw/plugins/zink-governance/index.mjs` (`:10149-10176`, using the resolved
  `owner.delegation.native_run_id` already in hand at `:10164`, or the already-imported
  `resolveCurrentRunOwner` — `index.mjs:91`, `workflow.mjs:482-513`); plus the regression lane in
  `tests/m12-t1-result-preview-and-ownership.test.mjs` (or a new lane reusing `registerPlugin` from
  `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:520-539`). `tests/**` is a shared write surface — coordinate the
  test edit with **fix-tests** under one integration owner. No topology file needs to change, so
  `fix-openclaw-topology` is not required for this row.

---

## F-OC-008 — a post-rename directory-fsync failure leaves an untracked hotfix artifact mixture that blocks gateway startup

**Verdict: CONFIRMED-AS-LATENT** (ordering, bookkeeping, classifier and boot wiring are all code-proven exactly as
registered; no fault was injected and no live instance exists).

### Evidence re-verification (every locator, working tree)

- `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:275-289` — `syncDirectory` opens the parent
  directory read-only, fsyncs it, and rethrows every error **except** win32 `EPERM`/`EISDIR`/`EINVAL`/`ENOTSUP`.
  CONFIRMED: an `EIO` propagates on any platform, including the WSL/Linux host where the systemd unit runs.
- `:290-317` — `writeAtomically`: `openSync(temp,"wx")` `:294`, file fsync `:296`, `closeSync` `:297`,
  `chmodSync` `:299`, **`renameSync(temporaryPath, filePath)` at `:300`**, `syncDirectory(path.dirname(filePath))`
  at `:301`. The catch at `:302-315` closes a still-open descriptor, `unlinkSync(temporaryPath)` (a no-op after a
  successful rename, as its own comment at `:313` says) and rethrows. CONFIRMED: rename precedes the directory fsync,
  and nothing restores or records `filePath`.
- `:416-446` — `writeTransaction`: `writeAtomically(...)` at `:425` and **`changed.push(record)` only at `:426`**;
  the rollback loop at `:430-432` iterates only `[...changed].reverse()`. CONFIRMED: a failure inside the first
  `writeAtomically` call for a record leaves that already-renamed record invisible to rollback.
- `:379-395` — `classifyState` accepts `patched` when every digest matches `:384`, `original` when none does `:385`,
  and `r18-predecessor` **only** for `states[0] === "patched"` with all later entries `original` (`:386-391`);
  otherwise it throws `OpenClaw hotfix artifacts are in an unsupported partial state` (`:392-394`). CONFIRMED.
- `:116-153` — the four artifacts are ordered `transport`, `error-classification`, `payloads`, `embedded-runner`, and
  `resolveRuntime` maps that list in order (`:243-257`). CONFIRMED: a second-artifact-only mixture
  `[original, patched, original, original]` matches none of the three accepted shapes, so the reproduction's state
  vector is correct.
- Boot wiring: `runEnsure` calls `classifyState(records)` at `:489` **before** any repair, and `hotfixBootAction`
  (`:357-366`) throws for any state that is not `patched` / `original` / `r18-predecessor`.
  `integrations/openclaw/lib/policy.mjs:1979-1989` renders
  `ExecStartPre=${nodeBinary} ${hotfix} --ensure`, and `run("ensure")` routes to `runEnsure` at `:500-503`.
  `configure.mjs:2022-2039` (preflight) and `:2330-2351` (apply) materialize that drop-in and the hotfix utility, and
  `policy.mjs:2014-2024` keeps the `--check` variant only as a recognised previous rendering. CONFIRMED: the mixed
  state is a preflight failure on the next start. `policy.mjs:1975-1977` documents `Restart=always` +
  `StartLimitBurst=5`, i.e. five failed `ExecStartPre` attempts within 60 s lock the unit out — outage until manual
  repair.

### DUPLICATE-OF check — no

- `F-296` proves rename→directory-fsync **presence** per site (`tests/agent-topo-F-296.test.mjs:172-215`; the hotfix
  template is in `PROVEN_WRITERS` at `:43`). It says nothing about what happens when that fsync fails, and it is
  satisfied while this defect stands. Not a duplicate.
- `F-417` is the post-rename failure **error policy**, and it was closed only for the queue writer and the ledger
  snapshot writer (`CHANGELOG.md:2292-2293`; `tests/agent-topo-F-296.test.mjs:383,539`; the changelog records that
  `ledger.mjs` throws unconditionally). The template writer has no `err.committed` marking at all. Same ordering
  family, different store and different consequence. Not a duplicate.
- `F-106` covers apply/rollback restoration of the *setup* surfaces (resolver, hotfix utility file, drop-in) —
  `tests/agent-last-F-106.test.mjs:263-322` fails at `native-verify` and asserts those three files return to their
  preimage. Its targets are the `stateDir/bin` copies, not the four vendor `dist` artifacts, and it never injects a
  directory-fsync fault. Not a duplicate.
- `F-421` / `F-425` are `runtime-backup.mjs` quarantine rename atomicity — different file and different state set.

### WRONG-SITE check — no

`templates/**` is the `scan-oc-6` slice and the routed `fix-openclaw-setup-templates` area;
`lib/policy.mjs:1989` is cited only as the reachability wire, not as the defect. Correctly sited.

### Refutation attempt and its exact limit

Two candidate refutations fail. First, self-healing: `--ensure` cannot repair this state, because `runEnsure` classifies
before it acts (`:489`), so the throw happens ahead of any `writeTransaction`. Second, accidental coverage: the
existing fault-injection harness in this repository (`POST_RENAME_FAULT_PRELUDE`,
`tests/agent-topo-F-296.test.mjs:331-381`) is armed only for the queue and ledger writers; `tests/m7-t1-openclaw.test.mjs:989-1027`
asserts the boot-action table (including that an unknown state throws) but never produces a mixed state through a
failing apply. So no lane today would redden on this ordering.

What is *not* established: that the fsync ever fails with a non-tolerated errno on a real host. No `EIO` was injected
here and no live occurrence is recorded in the register or changelog, so the outcome is conditional on a durability
error class the code itself anticipates (it tolerates four win32 codes and rethrows the rest). That is why the verdict
is CONFIRMED-AS-LATENT rather than OPEN: mechanism and consequence chain proven, trigger unobserved.

### Finding fields

- type: `startup-failure` (register §0.4 category `F6 — Reliability & Performance`; keep F6. The consequence is also a
  data-integrity/transaction-state defect, so F5 is arguable; the nature is a failed transaction leaving unusable
  state, which §0.4 maps through F6 retry/race/durability, and the register's F2/F3/F4/F5/F6/F7 mapping keeps F6).
- severity: **high** — when it fires the gateway unit cannot start and `StartLimitBurst` locks it out until manual
  repair (`policy.mjs:1975-1989`). The High grade is for the outcome; the row text should state it as conditional on a
  non-tolerated directory-fsync error, not as an observed outage.
- root_cause_of: none. (It is a sibling of, not a cause of, F-421/F-425; each has its own file and mechanism.)
- depends_on: none.
- red: **YES** (AGENTS §7). Any conforming fix changes persistence/rollback semantics of the four managed vendor
  runtime artifacts and/or the accepted-state contract of the boot preflight gate, which is a required gate
  (`ExecStartPre --ensure`). Options that widen `classifyState`'s accepted set would additionally change the
  admission contract that `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` pins. Smallest sound alternative:
  make the transaction see the record before it publishes — push the record onto `changed` (or otherwise capture the
  original bytes for restore) **before** `writeAtomically` renames, so a post-rename failure rolls the artifact back and
  the state remains one `classifyState` accepts (all-original, all-patched, or the supported `r18-predecessor`) and
  `--ensure` passes afterwards; keep the four-artifact allowlist, the win32 tolerance list and the `--ensure` flag
  unchanged, and add the fault-injection regression that reddens if the ordering reverts. Owner decision required
  because this is a persistence-semantics/gate change.
- fixer: **fix-openclaw-setup-templates** (owns `templates/**`, `configure.mjs`, `verify.mjs`). Files the fix would
  touch: `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs` (`writeAtomically` catch `:302-316` and
  `writeTransaction` `:416-446`); the regression lane in `tests/agent-topo-F-296.test.mjs` (reuse the existing
  `POST_RENAME_FAULT_PRELUDE` at `:331-381` for the template writer) or a dedicated new test file; and possibly
  `tests/m7-t1-openclaw.test.mjs:989-1027` if boot-action expectations are restated. `integrations/openclaw/lib/policy.mjs`
  needs no change (the wire is already `--ensure`). `tests/**` is shared — coordinate those edits with **fix-tests**
  under one integration owner, and sequence the wave so only one writer owns
  `tests/agent-topo-F-296.test.mjs` (F-296/F-417 lanes live in that same file).

---

## Wave-planning notes

- The two rows have disjoint source ownership (`plugins/zink-governance/index.mjs` vs
  `templates/openclaw-gemini-stream-hotfix.mjs`) and can run in the same wave, **but** both want a `tests/**` edit.
  `fix-tests` must be the single integration owner for test additions in this bucket; F-OC-008 additionally contends
  with any other candidate editing `tests/agent-topo-F-296.test.mjs`.
- Neither fix should touch `workflow.mjs` state semantics (F-OC-007) or `policy.mjs` boot rendering (F-OC-008).
- F-OC-008 is RED (owner decision on transaction/rollback and gate semantics). F-OC-007 is GREEN only if kept
  plugin-local.

## Blockers / limitations

1. `shell` permission-denied in this lane: `git status --short` / `git diff` could not be run. HEAD and branch were
   confirmed from `.git/HEAD` and the branch ref; every cited locator was re-read in the working tree and matched, but
   no claim is made that these lines are HEAD bytes rather than pre-existing dirty-tree edits.
2. `F-OC-007`: the host behavior that would deliver `message_sending` for a superseded run id is outside this
   repository. Status stays `NOT RUN` for that probe (AGENTS §11); it must not be converted into a pass, and it is the
   reason the verdict is LATENT rather than OPEN.
3. `F-OC-008`: no directory-fsync `EIO` fault injection was executed against the template writer in this lane, and no
   live mixed-state occurrence exists in the register or changelog. The recovery drill stays `NOT RUN`.
