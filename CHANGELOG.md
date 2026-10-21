# Changelog

All notable, validated changes to Personal Tool are documented here.

`CHANGELOG.md` records completed work only. It is not a roadmap, task list, development status, or architecture proposal.

## [Unreleased]

### Added

- Deployed the STACK remediation (M12/T2-R3) to the live WSL gateway as **deployment B**
  (2026-10-14, owner grant E), after clearing the orphaned ledger lock with the new C1 tool.
  Sequence, all operator-side: recovery `REPORT` (`holder_alive:false`, `owner_pid:60201`,
  token masked) → `--recover --confirm=ORPHAN_LOCK_RECOVERY` → `RECOVERED`; then
  `operator-preflight.mjs` → `{"identifiers":"VALID","builder_preflight":"PASS",
"installed_mutation":false}`; then one `operator-apply.mjs`, after which the unit is
  `active` (`MainPID=68567`, `NRestarts=0`, ActiveEnterTimestamp 13:25:47). **The apply's own
  report JSON was never seen** — the owner's paste reached the agent truncated at the preflight
  line — so success is asserted only from independent read-only comparison, which is stronger than
  a self-report: re-deriving the build through `governancePluginFiles()` gives
  `{"packaged":37,"mismatched":[],"missing":[],"installed_but_not_packaged":[]}`, with
  `lib/discord-forum-tags.mjs = 18fbb077…` (the remediation; a rollback would have left
  `e0a755bb…`) and `index.mjs = 513beb15…` unchanged, exactly as this revision promised.
  Journal since the restart: **0** `MODULE_NOT_FOUND`, 0 `UnhandledPromiseRejection`, 0
  `DISCORD_TAG_*`, 0 `FILE_LOCK_BUSY`, 0 `APPROVAL_CARD_NOT_SURFACED`; 7 `:443` sockets (all seven
  bots online); `events.jsonl` still 139, untouched. **Not claimed:** the per-surface live result.
  The point of the build is a multi-stack approval card in #approvals with three tags, and no
  governed approval has been requested since — #approvals, #results and #incidents each remain
  `NOT TESTED` live until one real cross-stack task produces a visible thread. CI for this record
  head `a9a6c1c`: run `38523610190` `quality-gate` **SUCCESS** (1470 tests / 1419 pass / 0 fail /
  51 skipped) + `python-quality` **SUCCESS**; Security `38523614667`: `secret-scan` **SUCCESS**,
  `dependency-audit` red on the unchanged 5-high baseline.

- M12/T2-R4 (owner decision C1, 2026-10-14): `operator-lock-recovery.mjs` is the operator action
  `file-lock.mjs` has always documented but the repository never had — "recovery of an orphaned
  lock is an explicit operator action, not an automatic heuristic". When the apply/rollback restart
  killed the gateway mid-append it left `ledger/writer.lock` behind, and that single orphan blocked
  202 ledger appends **and** every later `--apply`. Default mode is read-only
  (`"action":"REPORT"`); deletion requires `--recover --confirm=ORPHAN_LOCK_RECOVERY` and is
  reached only after the tool proves the recorded holder is gone with `process.kill(pid, 0)`
  (ESRCH/EINVAL dead, EPERM alive, anything else **unknown**, and unknown is never treated as dead,
  because guessing is exactly the two-writers failure the no-reclaim design prevents). It refuses
  to touch a lock it cannot validate: live holder, unreadable `owner.json`, a record outside its
  `{pid, 32-hex token}` shape, a symlink anywhere on the path, or a lock directory holding anything
  besides the owner record. It removes exactly two objects and verifies the directory is gone, and
  its report masks the holder nonce (`d***…`) — that nonce is a dead process's acquisition token,
  not a credential, and echoing it would hand anyone reading the terminal the confirmation value the
  operator is meant to type on purpose. `tests/m12-t2-r4-orphan-lock-recovery.test.mjs` runs the
  real script as a child against a scratch state directory: 8/8 with **zero skips** under WSL
  (including the symlink refusal) and 7 pass / 1 platform skip on Windows; two mutation probes each
  disabled one guard and killed exactly the matching cases (live-holder refusal; confirmation +
  stray-entry refusal). The live holder case uses **this test process** as the owner, so the
  refusal is proven against a running process rather than a simulated one. CI run `38500950386`
  @ `4f1328a`: `quality-gate` **SUCCESS** (1470 tests / 1419 pass / **0 fail** / 51 skipped) with
  `python-quality` **SUCCESS**; Security run `38500954316`: `secret-scan` **SUCCESS**,
  `dependency-audit` red on the unchanged pre-existing 5-high baseline.

- Deployed the M12/T2-R2 governance build to the live WSL gateway under the owner's deployment A
  grant (2026-10-13). Sequence and evidence, all operator-side: `operator-preflight.mjs` returned
  `{"identifiers":"VALID","builder_preflight":"PASS","installed_mutation":false}`; ONE
  `operator-apply.mjs` returned `{"status":"PASS","stage":"applied","mutationStarted":true,
"rollbackRequired":false,"reason":null,"attemptId":"txn-8cb8adec7a1409e1…",
"transactionStatus":"complete"}`, i.e. the pre-apply transaction snapshot was taken, verified and
  completed with no rollback; after the restart the unit is `active` with `MainPID=54345`,
  `NRestarts=0`, and **all 35 installed paths are byte-equal to the packaged build** re-derived
  through `governancePluginFiles()` (`index.mjs = 513beb15…`, newly installed
  `lib/discord-forum-tags.mjs = e0a755bb…`, `lib/discord-formatter.mjs = 26ecc883…`,
  `lib/policy.mjs = d621c85f…`, `lib/workflow.mjs = 2009e9fe…`) with nothing missing and nothing
  extra. The journal since the restart shows `ACTIVE AND LOADED` and `coordinator pickup loop
started`, **zero** `MODULE_NOT_FOUND`, zero `UnhandledPromiseRejection`, zero `DISCORD_TAG_*`
  refusal and zero crash — which is what proves the tagging module loads in the real runtime —
  while the pre-existing `duplicate plugin id` warning is unchanged; 7 established `:443`
  connections means all seven bots are online. The ledger was not touched (131 events) and records
  no `WORKFLOW_APPROVAL_SURFACED` / `WORKFLOW_RESULT_SURFACED` yet. **Not claimed by this record:**
  any live per-surface Discord behaviour — no governed thread has been created since the upgrade,
  no tag name has been resolved against a real forum, and `PATCH /channels/{thread.id}` with
  `applied_tags` has never been sent, so #approvals, #results and #incidents each remain
  `NOT TESTED` live; `verify.mjs` stays `NOT RUN`; no multi-hour soak under real traffic.
- M12/T2-R2 (owner-required 2026-10-13, `b6d04e8`, **deployed 2026-10-13**): the approval thread's
  `STATUS` tag now follows the real verdict — APPROVE → `STATUS: APPROVED`, REJECT →
  `STATUS: REJECTED`, REQUEST REVISION → `STATUS: CHANGES` — while every opened card still starts
  at `STATUS: WAITING`. `transitionGovernedForumStatus` reads the thread's own `applied_tags` and
  the forum's tag list through the cached resolver, replaces **only** the STATUS-category id and
  keeps every other id, including ids absent from the forum list, because a tag the owner added by
  hand is his data. It does not re-derive RISK/STACK at verdict time: that could rewrite tags that
  were already correct. If the forum has no such STATUS value the `PATCH` is not sent and the
  reason is named (`VALUE_ABSENT` / `CATEGORY_ABSENT`), the same rule that stops an under-tagged
  thread from being called a success. Wiring sits in `applyOwnerDecisionEffect`, the one
  post-decision effect the button and text paths already share, fire-and-forget with its own
  `.catch`: the verdict is durable in `WORKFLOW_USER_APPROVAL_DECIDED` first, so no surface result
  can undo, delay or rewrite the owner's decision, and no decision path awaits a Discord
  round-trip. Honesty about the seam: `PATCH /channels/{thread.id}` with `applied_tags` is the only
  mechanism available — the pinned host carries `applied_tags` solely on the send payload and
  Discord's thread docs do not list it as editable, though the discord-api-docs duplicate-tag
  report describes PATCHing a forum thread with it as working — so live acceptance is
  **`NOT TESTED`** and a rejection logs `DISCORD_TAG_TRANSITION_REJECTED_<status>` instead of
  claiming success. `STATUS: EXPIRED` and the #results/#incidents transitions stay unwired:
  expiring a card needs a sweeper, and he asked for the approval case. Gates: `npm run verify`
  PASS (1457 tests / 1412 pass / 0 fail / 45 skipped) and **192/192 with ZERO skips** under WSL;
  three mutation probes each killed exactly one control (unresolved STATUS still PATCHing, foreign
  ids dropped, call site detached) and were reverted. CI run `38405914399` @ `0479d02`:
  `quality-gate` SUCCESS (`ℹ tests 1457 / ℹ pass 1406 / ℹ fail 0 / ℹ skipped 51`, policy passed)
  and `python-quality` SUCCESS (`188 passed, 27 subtests`); Security run `38405920662` adds
  `secret-scan` SUCCESS (zero leaks) with `dependency-audit` red on the unchanged 5-high baseline.
- M12/T2-R1 (owner-approved 2026-10-13, A/A/A decisions, **not deployed**): every governed
  Discord thread now carries **exactly three forum tags**, one per category, and the two
  surfaces that had no publish path at all got one. `integrations/openclaw/lib/discord-forum-tags.mjs`
  is the single tagging system: it reads each forum's own `available_tags` (falling back to
  `/tags`) through the plugin's existing bot-token resolver, resolves the tag _names_ the
  owner requires to their snowflakes at runtime, caches them for 10 minutes, and never stores
  an id in the repository — the two hardcoded `applied_tags: ["REDACTED"]` literals
  are gone. Categories are per-forum and are never assumed to be shared:
  #approvals `STATUS`+`RISK`+`STACK`, #results `STATUS`+`TYPE`+`STACK`,
  #incidents `STATUS`+`SEVERITY`+`STACK`. A required tag that cannot be resolved means **no
  POST at all** plus `DISCORD_TAG_UNRESOLVED channel=… category=… wanted=… reason=…`, and the
  underlying event stays durable for retry. Publication itself is now recorded:
  `WORKFLOW_APPROVAL_SURFACED` / `WORKFLOW_RESULT_SURFACED` (both additive,
  `required: ["task_id","channel","thread_id"]`) project into the schema slots that had been
  declared since M7 with no writer, `approval_thread_id` and the new `results_thread_id`, so a
  retry re-uses the same thread instead of opening a second one, and "requested but never
  shown" is a re-drivable state rather than a lost card. #incidents stays idempotent without
  inventing an incident store: deterministic title token plus an active-threads pre-check, and
  containment behaviour is unchanged — publication is additive and its failure is logged.
  Gates: `npm run verify` PASS (1446 tests / 1401 pass / 0 fail / 45 skipped,
  `Repository policy check passed.`) and 181/181 with ZERO skips under WSL Ubuntu across the
  two new suites (`m12-t2-forum-tags`, `m12-t2-governed-surface`) plus the M12/T1, R12,
  six predecessor, native-outbound, runtime-bounds and approval-request suites. CI run
  `38394646861` @ `0502204`: `quality-gate` SUCCESS (`ℹ tests 1446 / ℹ pass 1395 / ℹ fail 0 /
ℹ skipped 51`, `Repository policy check passed.`) and `python-quality` SUCCESS
  (`188 passed, 27 subtests`); Security run `38394651339` adds `secret-scan` SUCCESS (zero
  leaks) while `dependency-audit` stays red on the unchanged 5-high baseline. Three mutation
  probes each killed exactly one control (unresolved tag ⇒ no POST; duplicate thread ⇒
  suppressed; status line re-added ⇒ card gate fails). Per-surface live status: #approvals
  `NOT TESTED` live, #results `NOT TESTED` live, #incidents `NOT TESTED` live — code
  existence is not evidence of working Discord behaviour.
- M12/T1-R1 (2026-10-13, `c1ad4b3`, **not deployed**): the approval card now carries an
  expected-result preview PNG rendered for the target screen — Excel, SQL, Python or
  Power BI — through the repository's existing dependency-free PNG encoder, written inside
  the governed sandbox root. A card and its preview are two messages of one thread,
  because the host carries components on only the first media item.
- M12/T1-R1 (owner decision D, 2026-10-13, **not deployed**): the governed result of an ETL
  or dashboard task is reported by the specialist that executed it (`accountId` `o1` or
  `o2`, with Excel/SQL/Python/Power BI) instead of only by Main. Suppression stays in force
  as a provenance gate: a specialist broadcast is still blocked unless it is attributed to
  a task that specialist was admitted to execute.
- Deployed the M11/T3-R1 build to the live WSL gateway under a fresh, explicitly scoped
  owner grant (`9164c50`, 2026-10-13). Before consuming it, the seven deployed governance
  assets were measured read-only with `sha256sum` (`index.mjs = e8f084ab…`,
  `lib/queue-manager.mjs = f7995d51…`, `lib/native-boundary.mjs = 97c7f3e1…`,
  `lib/file-lock.mjs = 22d7411a…`, `lib/decision-ledger.mjs = 5e97d9ca…`,
  `lib/guard.mjs = 7dd37ee9…`, `lib/ledger.mjs = 818d7cb0…`), re-derived byte-for-byte
  from the pre-Phase-1 commit through the repository's own `governancePluginFiles()`, and
  confirmed present in `ALLOWED_GOVERNANCE_ASSET_SHA256` — so this upgrade did not repeat
  the M11/T1-R2 blocker. The live ledger pair was also checked read-only first (128 events
  == snapshot `sequence: 128`), which matters because this build newly refuses startup on
  a half-missing events/snapshot pair. Operator-side result: `--preflight` `PASS` with
  `installedMutation: false`, one `--apply`, and after the restart all seven live digests
  equal the packaged build (`61e344e6…`, `a5580bb6…`, `5966d446…`, `bcd65de8…`,
  `1d9518ca…`, `263d72c4…`, `c984cda8…`); `openclaw.json` (17128 bytes, mtime
  `2026-10-09 12:24`) and both ledger files (mtime `2026-10-09 12:13`) untouched; unit
  `active` with `MainPID=28865`, `NRestarts=0`, and a clean 594 ms shutdown of the old
  process. In the first ~15 minutes the new PID logged **zero**
  `GOVERNANCE_COMPLETION_UNAVAILABLE` and zero Discord-attributed errors, and the
  governance-run refusals that do occur land in 1–2 s with a preserved cause chain instead
  of the 100 s router abort that was still firing on the previous PID minutes before the
  restart. Not claimed by this record: the startup `enterNativeRun` /
  `EXECUTION_STATE_UNKNOWN` session-recovery cluster persists (the retained journal shows
  the identical cluster on 2026-10-08 and 2026-10-10 under older builds, so it is
  pre-existing, not a regression), the `duplicate plugin id` config warning is unchanged,
  `verify.mjs` was not run (`NOT RUN`, operator-side), and no multi-hour live soak under
  real traffic has been completed.

- Deployed the M11/T1-R1 build to the live WSL gateway and closed the one gap that
  blocked it (`14c4b90`, M11/T1-R2). `configure.mjs --preflight` refused the running
  runtime with `Governance plugin asset drift detected: …/lib/file-lock.mjs`: the
  live tree is the `ea84a5a` packaged build, whose `lib/file-lock.mjs` digest was
  never admitted, while every other asset is byte-equal to the current build and the
  live entrypoint was already admitted. R2 admits exactly that one digest — proven by
  re-packaging `ea84a5a` through the repository's own `governancePluginFiles()`, not
  transcribed — and keeps the never-installed `d773856` intermediate refused, so the
  control stays bounded to revisions that actually ran
  (`tests/m11-t1-r2-file-lock-asset-predecessor.test.mjs`, 7/7; existing
  deployment-snapshot suites 42/42; `npm test` 1343 / 1298 pass / 0 fail / 45
  skipped; lint, format, repo-policy and `git diff --check` clean). Operator-side
  result: preflight `PASS` with `installedMutation: false`, one `--apply`, unit
  restarted, live `index.mjs = e8f084ab…` and `lib/file-lock.mjs = 22d7411a…`,
  `openclaw.json` and the decision ledger untouched, `MainPID=17047`, `NRestarts=0`.
  `verify.mjs` was not run, and two pre-existing runtime conditions (model-router
  `GOVERNANCE_COMPLETION_UNAVAILABLE` aborts observed on the previous PID, and the
  long-standing `duplicate plugin id` config warning) remain open.

- Completed M11/T1-R1, the four-phase remediation of the 2026-10-11 read-only
  full-repository audit, as `45e0ee7` (skill-store vector SQL), `3810f67`
  (skill-store governance), `01e5d07` (Knowledgebase index hygiene and error
  attribution), `6cba090` (OpenClaw outbound containment, bounded caches,
  per-target containment) and `94e9444` (the current-build digest re-pin Phase 4
  required). Derived skill-index SQL became executable against real PostgreSQL:
  tombstones are `DELETE`s, literals are escaped, one transaction per skill
  embeds then writes and only then marks `READY`, and a failure write that itself
  fails escalates to `VECTOR_FAILURE_WRITE_FAILED`. Skill read/apply are
  catalog-bound (an invalid catalog can no longer be served through a permissive
  disk walk), ambiguous bare ids fail closed with `SKILL_ID_AMBIGUOUS`, the
  freshness gate reports `SKILL_INDEX_STALE` instead of serving stale rows,
  promotion runs inside the Skill Store writer lock, and approvals require an
  explicit `decisionRef` instead of defaulting one. On the Knowledgebase, a
  FAILED index is purged in the same transaction that marks it and both startup
  sweeps prune pre-existing FAILED content; `executemany` replaced per-segment
  round-trips; a statement timeout answers 503 `DATABASE_UNAVAILABLE` rather than
  a raw 500; `/readyz` bounds only its lock wait and can answer 503
  `PDF_RUNTIME_BUSY`; `min_score` thresholds reranker scores only; and a vanished
  or unreadable source is attributed to that document instead of aborting the
  scan unattributed. In the governance plugin, outbound attachments are now
  resolved and confined to the agent's governed sandbox root (the existence check
  alone followed `..` and symlinked components, so any readable host file could be
  published to #office), the pending-proposal and completed-execution caches have
  explicit ceilings with oldest-first eviction and terminal proposals leave the
  cache, and an unreconciled-run containment sweep reports `UNKNOWN` plus the
  names of every task whose ledger write failed instead of claiming `BLOCKED`.
  Final gates on this host: `npm test` 1336 tests / 0 failures / 45 skips (44
  pre-existing plus the new Windows symlink-privilege skip); the Phase 1
  real-PostgreSQL statement gate ran and passed; `npm run lint`,
  `npm run format:check`, `npm run repo:check` and `git diff --check` clean;
  Knowledgebase Python suite 184 passed / 4 skipped / 27 subtests with
  `KNOWLEDGE_TOKENIZER_PATH` pointed at the existing local tokenizer fixture (all
  four skips are symlink-privilege or Linux-only platform cases). Carried forward,
  unchanged: the CI-only gitleaks scan is `NOT RUN` locally (gitleaks is not
  installed here; the local equivalent — a secret-pattern scan of the complete
  diff — returned zero candidates), the Python gate still belongs in WSL/CI, and
  symlink-escape refusals are proven by test only on platforms that permit link
  creation. `Deployment Authorized: NO` held throughout: no `operator-apply`, no
  live runtime mutation, no service restart, no production ledger write.

- Closed the two owner-authorized M10/T2-R26 escalations and committed the
  pending R13-R25 sweep. `ea84a5a` admitted the 39-defect sweep after gates
  passed. `fd70bf6` made Knowledgebase incremental indexing atomic:
  `accept_incremental` stages a shadow BUILDING index cloned from ACTIVE
  (no re-embedding) and `complete_incremental` prunes stale sources, swaps
  the ACTIVE pointer, and supersedes the prior index in one transaction, so
  a failed run never mutates the live index (closes the R24 RED data-
  integrity escalation). `d773856` bound file-lock release to a per-
  acquisition owner token (`owner.json` inside the lock directory), so a
  stale holder can no longer delete the next holder's lock and fork
  `events.jsonl` (closes the R18 hazard by owner decision); the R26 gate
  run then caught and fixed the sync seam (`withFileLockSync` had to route
  through `tryAcquire`) and added a bounded Windows pending-delete backoff.
  Final gates: `npm test` 1305 / 0 fail / 44 pre-existing skips; lint,
  format:check, repo:check pass; collectible Python suite 126 passed / 2
  skipped with the env-gated files NOT RUN on the Windows host. Restarts and
  deployment remain owner-deferred.
- Implemented the owner-authorized M10/T2-R7 authority predecessor
  admission repair, closing the asset-level deployment deadlock that kept
  the frozen R6 candidate undeployable: `configure.mjs --preflight`
  refused the live R3 runtime because live `lib/authority.mjs`
  (aa12540f, the R2-tree build installed by the R3 deployment, changed by
  R4/R5's conversational classifiers) was not admitted while the candidate
  rebuilds it as 42b0cba8. The digest was proven before admission by
  packaging origin commit 2ef4bd6 through the repository's own
  `governancePluginFiles()` (byte-identical to live); exactly one
  predecessor entry was added under its own path. Eight regression tests
  prove provenance, 1/1 parity, preflight-PASS-then-apply-ACCEPT with
  convergence, and that perturbed/unknown/wrong-path digests still fail
  closed without mutation. No native/ingress/classifier logic touched.
  Deployment Authorized: NO. Not deployed; no live execution; host
  lifecycle NOT PROVEN.
- Implemented the owner-authorized M10/T2-R6 native-boundary predecessor
  admission repair, closing the asset-level deployment deadlock that kept
  the frozen R5 candidate undeployable: `configure.mjs --preflight`
  refused the live R3 runtime because live `lib/native-boundary.mjs`
  (d88bff80, the R18 build, untouched by every later revision) was not
  admitted while the candidate rebuilds it as bccfa861. The digest was
  proven before admission by packaging commit 980b36e through the
  repository's own `governancePluginFiles()` (byte-identical to live);
  exactly one predecessor entry was added under its own path. Eight
  regression tests prove provenance, 1/1 parity, preflight-PASS-then-
  apply-ACCEPT with convergence, and that perturbed/unknown/wrong-path
  digests still fail closed without mutation. No native logic touched.
  Deployment Authorized: NO. Not deployed; no live execution; host
  lifecycle NOT PROVEN.
- Implemented the owner-authorized M10/T2-R5 host-side Discord inbound
  metadata exposure (explicit Option A): the pinned host drops structured
  Discord metadata during canonical mapping, so the native seam could never
  observe mentions/replies/authorship. A minimal preflight-seam patch now
  records structured ids (mentioned users/roles, reply-reference
  message/author, thread owner, author bot flag) into a bounded
  messageId-keyed registry on the causal inbound path; the boundary reads it
  back with strict re-validation and admission accepts @main mentions,
  replies to Main, and Main-owned threads while everything else stays
  denied. No LLM, no text heuristics, no timing-dependent cache, no new
  services. Lineage: new preflight pin (live equals baseline, direct
  upgrade); selection R10→R5 single slot yielding `04e92061…`. 27 new
  regression tests; R4 suite re-homed to host ownership. Deployment
  Authorized: NO. Not deployed; no live execution; host lifecycle NOT
  PROVEN.
- Implemented the owner-authorized M10/T2-R4 Main conversational ingress
  repair (explicit Option A): the native admission seam structurally lacked
  mention/reply/author metadata, so every free-text Discord ingress turn was
  denied with MISSING_MENTION. A pinned-host census proved exactly one more
  deterministic inbound field available (`currentThreadId`); the native patch
  now forwards it, the boundary types it (null-or-snowflake, fail-closed),
  and admission accepts an owner message in a proven Main-owned thread
  (attribution recorded from Main's own awaited outbound posts, bounded,
  memory-only, exact-match, degrading to deny) while every other authority
  check still applies. Mention/reply attribution and non-thread continuation
  stay denied by design. Lineage: single R10→R4 selection descriptor (R7
  retired); R4 selection `04e92061…` reproducible from R10 `555f37da…`;
  outgoing R3 entrypoint admitted in both per-mode lists. 19 regression
  tests; R18/R19 pins updated to the authorized bytes. Deployment
  Authorized: NO. Not deployed; no live execution; host lifecycle NOT
  PROVEN.
- Implemented the owner-authorized M10/T2-R3 proven governance-asset
  predecessor admission repair, closing the asset-level deployment deadlock
  that kept the frozen M10/T2-R2 candidate undeployable: `configure.mjs
--preflight` refused the live hygiene-build runtime with `Governance plugin
asset drift detected` (`installed_mutation: false`) because ten live
  governance-plugin assets differed from the R2 build and were not admitted
  in `ALLOWED_GOVERNANCE_ASSET_SHA256`. All ten digests were proven before
  admission — the live deployed tree (34 files) is byte-identical to the
  packaged build at commit `41c62e7` through the repository's own
  `governancePluginFiles()` (34/34 match) — and only the existing shared
  allowlist was extended, each digest under its own path, with preflight and
  apply consuming the same table so no per-mode asymmetry can re-open. Eleven
  regression tests prove provenance re-derivation, 10/10 provenance parity,
  current-build exclusion, per-predecessor preflight-PASS-then-apply-ACCEPT
  with convergence, the exact production failure state as a fixture, and that
  perturbed, unknown, and wrong-path digests still fail closed without
  mutation. No R2 logic was touched. Deployment Authorized: NO. Not deployed;
  no live execution; live ledger untouched; host lifecycle NOT PROVEN.
- Implemented the owner-authorized M10/T2-R2 coordinator execution-authority
  remediation, closing the safety issue the M10/T2-R1 pre-live audit proved: a
  coordinator runtime could outlive its queue lease and, because every governed
  consumer resolved identity from the historical binding alone, could still
  reserve governed work, write onto a task a newer attempt owned, and — in the
  `QUEUED` window between stale recovery and the next pickup — be misclassified
  at run end into the generic `ALL_LIVE_RUNS` containment sweep. Binding
  (historical identity and attribution), attempt (execution generation) and
  lease (current execution authority) are now distinct: a binding alone never
  authorizes a mutation. The fence sits at the authoritative mutation — the
  spawn reservation commits inside the queue's own critical section through
  `QueueManager.withExecutionFence`, so stale recovery cannot interleave with
  the commit, and the ledger independently refuses a superseded generation or a
  task no longer claimed by that coordinator. Historical bindings are preserved
  and remain resolvable for attribution; the new attempt executes normally;
  idempotency is unchanged; a coordinator run still cannot produce a completion
  claim or a result; and genuine unreconciled native containment is untouched.
  An independent coverage review of the uncommitted tree additionally found that
  a fully bound coordinator run was still routed into generic containment when a
  specialist held the live claim on the same queue item — legitimate, because a
  listed required capability is itself an assigned claimant — and that the
  authoritative binding must win over the claim holder; it is fixed here and
  covered in both directions. 18 regression tests, including deterministic
  fencing and TOCTOU evidence, falsified four ways. Deployment Authorized: NO.
  Not deployed; no live execution. A read-only pre-live re-audit re-confirmed
  every static safety claim, and a read-only forensic pass established that the
  authoritative live state directory is `/home/hoang_vinh/.openclaw-zink` inside
  WSL, where the ledger matches the recorded digests, event count and task count
  exactly; an earlier "empty live ledger" finding is therefore withdrawn as a
  wrong-path observation against a separate, older Windows-side state directory.
  No historical evidence, digest, lineage or native artifact was altered.
  Closed the remaining repository-level gaps and froze the artifact: the
  apply-mode entrypoint predecessor list was missing six digests the preflight
  gate admits (the per-mode deadlock class R13 documents). Each was re-derived
  from the commit that produced it — materializing that commit's
  `integrations/openclaw` tree and hashing the packaged entrypoint — and only then
  admitted; none was ever the deployed live build and the current build is still
  admitted by content comparison rather than by entry. Two regression tests pin
  the six admissions and the structural invariant that the apply-mode list never
  admits fewer predecessors than the preflight list. The unbound-ambiguity path to
  generic `ALL_LIVE_RUNS` containment is recorded as an accepted separate safety
  decision rather than narrowed, because narrowing it would assume the owner of an
  unrecorded native child. The unfenced `brief_state === "DRAFT"` run-end branch
  is proven unreachable under the current reducer and pinned by test. Deployment
  Authorized: NO; not deployed; no live execution.
- Implemented owner-authorized M10/T2-R1 coordinator session binding and real
  coordinator runtime pickup: approved tasks now move from durable `QUEUED`
  through atomic coordinator claim, a real governed `o1`/`o2` turn started via
  the verified pinned-OpenClaw seam (`api.runtime.subagent.run()` with
  `deliver: false`), and an attempt-scoped ledger binding
  (`WORKFLOW_COORDINATOR_RUN_BOUND`), without fabricating delegation lineage.
  Bound coordinators resolve distinctly from Main/root everywhere (admission,
  spawn gate with canonical `AGENT_SPAWN_POLICY` containment, run-model
  resolution, reservation parentage), receive advisory brief context instead
  of the unresolvable-run BLOCKED instruction, and end without false completion
  claims. The production pickup loop runs single-flight on the existing plugin
  lifecycle with clean gateway-stop shutdown. Coordinator result ingestion
  remains a separate future task; a completed coordinator run leaves the task
  to existing lease/stale-recovery semantics rather than recording an
  unvalidated result. Not live-verified: no real coordinator turn has been
  started from this repository.
  Superseded in one respect by M10/T2-R2 above: the R1 entry claimed the
  subagent lifecycle hooks recognize a coordinator run and never contain it.
  That was true only while the queue item was `EXECUTING`; R1's own commit
  message is retained unaltered as historical evidence of the claim that was
  found to be inaccurate.
- Completed locally verified M8/T3 Governed Long-Term Memory Learning Loop:
  made the Zink user-teaching lifecycle work end-to-end without changing the
  three-module architecture, seven-agent topology, governance model, security
  boundary, or OpenClaw native-memory disablement (`slots.memory = "none"`).
  Decision memory now runs teach → explicit classification → owner confirmation
  (`handleOwnerDecisionConfirmation`) → `DecisionLedger` persistence with
  deterministic identity, idempotent confirm and scope containment intact.
  Skill learning now runs specialist proposal → durable atomic proposal record
  carrying the exact content bytes → dedicated `#office` skill approval
  (`zink:skill:approve`/`zink:skill:reject`, `SKILL_CANDIDATE_APPROVAL`) that
  never touches the workflow ledger, queue, or `executeApprovedTask` → trusted
  canonical promotion (`SKILL.md` + `manifest.json`, `CANDIDATE` then `ACTIVE`,
  one ACTIVE per capability, fail-closed conflicts) → derived pgvector sync
  from canonical ACTIVE state with canonical-truth-preserving failure reports.
  Unknown, missing, expired, rejected, mismatched, conflicting, wrong-owner and
  wrong-subject approvals all fail closed; exact replays are idempotent and
  post-approval canonical drift is detected. Unified `content_sha256` to the
  raw SHA-256 of the exact canonical bytes across proposal, approval, manifest
  and tests; removed the fake workflow `task_id` from skill approvals in favor
  of a discriminated proposal identity; removed the legacy `namespaces`
  discover fallback; added `NO_MATCH` to the skill tool contract; completed
  crash-safe canonical publication (stage → validate → atomic rename, with
  residue healing) and explicit owner correction with supersession for the
  Decision Ledger; bridged owner-confirmed reusable-procedure teachings into
  the existing skill proposal infrastructure; and proved fresh-session
  retrieval for both decision and skill memory plus the full negative matrix
  in `tests/m8-t3-governed-memory-learning.test.mjs` (41 focused tests, full
  repository suite green). Documented the durable Decision Ledger lifecycle in
  `docs/contracts/decision-ledger.md` and proved that a search hit leads to
  canonical approved procedure reuse via `canonical_skill_id`. User-written
  Knowledgebase persistence remains intentionally deferred (adapter forbids
  ingestion by contract); factual teachings route honestly with
  `persisted: false`. Live OpenClaw runtime validation was not performed from
  this environment.

- Completed locally verified M8/T2.2-R3 Root-Cause Governed Runtime, Discord, Semantic & Artifact Integrity Hardening:
  remediated and hardened all 15 root-cause families (RC-01 through RC-15) defined in `ACTIVE.md`; enforced ingress admission gate prior to model invocations with `@Quản Lý` (Main) established as the sole root owner and specialist direct mentions strictly rejected across all channels (`SPECIALIST_NO_DIRECT_INGRESS`); locked canonical topology in `role-capability-manifest.json` and runtime `guard.mjs` (`main -> [o1, o2]`, `o1 -> [excel, sql, python]`, `o2 -> [power-bi, python]`, leaf -> `[]`) blocking direct Main-to-specialist dispatch and O1/O2 cross-spawning; established durable correlation IDs and exact task lookups preventing duplicate executions; bound approval records to immutable plan content hashes, enforcing plan revision invalidation and User-only authorization for Approve/Reject/Accept; implemented file-backed `QueueManager` with atomic cross-process file locks, lease heartbeat fencing, worker attempt validation, and fail-closed state reconciliation; decoupled technical execution finish from task completion so that `EXECUTION_FINISHED` transitions to `RESULT_PENDING_REVIEW` requiring explicit User `ACCEPT_RESULT` to transition to `COMPLETE`; purged internal filesystem paths and raw `file://` URLs from user-facing delivery; eliminated secondary writes to repository `artifacts/`, outputting `.xlsx` workbooks with matching SVG sheet previews; enabled real DuckDB engine execution with canonical fixtures, discrete execution states (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`), and fail-closed syntax/binder validation without returning mock sample rows; enforced strict Python stack scoping between O1 ETL and O2 analytics/visualization; verified PK\x03\x04 container integrity for Power BI; prevented secret leaks, path traversal (`..`), and sandbox bypass; and expanded the repository test suite to 272 tests across 13 test suites (including `duckdb-bridge.test.mjs`) with 100% pass rate.

- Added multi-format data file validation and real preview engine in `integrations/openclaw/lib/artifact-validator.mjs`, `zink-tools/sql/validator.mjs`, and `zink-tools/python/python-validator.mjs`:
  implemented native Node.js-based validation and preview generation for SQL (`.sql`: UTF-8 read, keyword detection, statement count, DML/mutation flag, 30-line annotated preview), Python (`.py`: UTF-8 read, AST parsing, function/class count, categorization of data-science, DB, and file-I/O module imports, 30-line preview), Power BI (`.pbix`/`.pbit`: ZIP PK\x03\x04 magic byte check, container integrity, file size), Apache Parquet (`.parquet`: PAR1 header + footer byte check), PDF (`.pdf`: %PDF- magic byte check and header version extraction), Microsoft Word (`.docx`/`.doc`: ZIP PK\x03\x04 container check), Markdown (`.md`: UTF-8 read, heading count, 20-line preview), and Excel (`.xlsx`: workbook analysis with SVG visual sheet previews); accompanied by 28 automated test scenarios in `tests/m8-t2-governed-runtime-audit.test.mjs`.

- Completed locally verified M8/T2-R9 Governed Runtime, Authority, Memory & Reliability Hardening:
  established the strict 5-tuple action authority engine (`validateActionAuthority` in `integrations/openclaw/lib/authority.mjs`) enforcing that User is the sole final authority for plan approvals and result acceptance, routing actions across dedicated channels (`#office`, `#approvals`, `#results`, `#incidents`), and strictly prohibiting specialists from executing governance actions (`SPECIALIST_NO_GOVERNANCE`); decoupled technical execution finish from task completion so that `EXECUTION_FINISHED` transitions tasks to `RESULT_PENDING_REVIEW` and never directly to `COMPLETE`; built persistent file-backed `QueueManager` with atomic single-worker claims (`claimTask`), lease heartbeat renewal (`recordHeartbeat`), and automatic stale task recovery (`detectAndRecoverStaleTasks`), cleanly decoupling the 24/7 Control Plane from Local Laptop Worker sleep/reconnect cycles; implemented two-tier `evaluateResultGate` in `integrations/openclaw/lib/artifact-validator.mjs` verifying technical structure and enforcing the critical invariant that Technical PASS + Business FAIL yields `RESULT BLOCKED` with real data previews and zero synthetic mocks; implemented human-confirmed `DecisionLedger` (`integrations/openclaw/lib/decision-ledger.mjs`) caching confirmed operator answers and preventing redundant clarifying questions; established structured reference IDs conforming to `TOPIC(2)-EXEC(2)-TASK(4)` (`00` reserved for human-contributed documents) with retrieval context deduplication (`deduplicateRetrievalContext`) in `zink-tools/common/semantic-contract.mjs`; added governed Discord message and card formatters (`formatOfficeClarificationQuestion`, `formatOfficeFinalNotification`, `formatGovernedApprovalCard`, `formatGovernedResultCard`, `formatIncidentCard`); updated OpenClaw `zink-governance` plugin with stale-attempt protection (`STALE_ACTION_REJECTED`) and full asset materialization in `governancePluginFiles`; authored comprehensive 12-bug audit register (`tests/m8-t2-governed-runtime-audit.test.mjs`) and 20-scenario E2E workflow and failure injection suite (`tests/m8-t2-e2e-workflow.test.mjs`), validating all 156 unit and contract tests pass with zero regressions.

- Completed locally verified M8/T1 Governed Skill Store & Knowledgebase Semantic Vector RAG + 2-Way Memory:
  implemented PostgreSQL schema `skills` with `catalog_index`, `segments`, and 1024-dimension HNSW cosine vector index (`skills_segments_embedding_hnsw_idx`); established the shared canonical semantic contract (`zink-tools/common/semantic-contract.mjs`) with deterministic envelopes (`renderEmbeddingEnvelope`, `computeEmbeddingInputHash`) preserving raw content while structuring domain/topic envelopes for BGE-M3 embeddings; implemented Git-to-PostgreSQL vector synchronization (`zink-skill-store/src/vector-sync.mjs`) with fail-closed active catalog validation and source drift detection; added governed callable tool interfaces for `zink_skill_search` (vector cosine similarity, ACTIVE-only), `zink_skill_propose` (human-in-the-loop candidate proposal via `#approvals`, strictly preventing direct promotion to ACTIVE), and `zink_knowledge_search` (hybrid search proxying to Knowledgebase container with citation provenance); implemented Discord `#approvals` owner approval callback (`handleOwnerSkillApproval`) with immutable content hash binding; updated OpenClaw RBAC policy granting retrieval to all 7 agents and proposal capabilities to specialists and O1; fixed Discord Mobile mention resolution (handling raw snowflakes `<@ID>` and `<@!ID>` with corrected punctuation lookahead) and eliminated Discord 50035 errors with `replyToMode: "off"`; validated 11 automated test scenarios (`tests/m8-t1-skill-vector-memory.test.mjs`) and confirmed all 123 repository tests pass with zero regressions.

- Added Discord Multi-Bot Gateway operation guide, 7-bot directory with Snowflake IDs, Linux TCP keepalive settings (60s idle threshold to eliminate 2-hour Discord dropping), sandbox tool policy admitting specialist tools into isolated containers, and Discord Mobile multi-format mention protocol (handling raw snowflake mentions, nickname mentions, and Vietnamese natural text regex matching) in `README.md`.

- Completed remotely backed M7/T5-R13 Zink Runtime Governance Remediation & Capability Enforcement:
  remediated multi-agent Discord ingress task collision with deterministic per-agent `deriveTaskId`; registered full JSON Schema parameter definitions for all 5 callable Zink tools (`zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, `zink_n8n`); enforced specialist tool allowlists (`alsoAllow`) in `openclaw.json` granting designated tools to Excel, Power BI, SQL, Python, and O2 while preserving minimal sandbox isolation; added Vietnamese natural conversational Discord message formatting hook; fixed CI shallow clone depth and `smol-toml` vulnerability advisory; verified all 173 repository tests passed and GitHub Actions CI and Security workflows passed remotely on `codex/m7-t5-governance-remediation` at commits `4037187` and `8e71759`.

- Completed remotely backed M7/T3-R16 Zink Tools Governed Callable Interfaces & Adapter Contracts:
  implemented Model A (Virtual / Contract Tool Interface) for 5 callable tools (`zink_excel`, `zink_power_bi`,
  `zink_sql`, `zink_python`, `zink_n8n`) and 4 deferred schema-only capabilities (`zink_forecast`, `zink_optimization`,
  `zink_operations_research`, `zink_simulation`); established closed invocation and result envelopes,
  Option A self-contained tool branches, pure logical path safety (`validateArtifactLogicalPath`), Lean single-statement
  SQL validation with injective parameter binding (`validateSqlQuery`), loopback-only governed n8n webhook adapter
  (`invokeN8n`), dual authorization paths (read-only for SQL vs delegated for specialists), authenticated approval
  ledger resolution with atomic anti-replay protection, deterministic `ENGINE_NOT_IMPLEMENTED` 4-tuple contract seam,
  and host tool registration on branch `codex/m7-t3-tools-contracts` at implementation commit `ac68bce0653ad3c4bfcc8d230960bcdcf7e8f71d`.

- Completed remotely backed M7/T2-R12 OpenClaw native governance runtime: attached
  trusted governance guard to native pre-tool callback and child delivery paths,
  enforced atomic ledger reservations, parent-turn yield contracts, bounded
  subagent delegations, and pre-announce acceptance vetoes; verified reversible
  native patching and full rollback (`T1_RESTORED`) via `operator-rollback.mjs` and
  `operator-apply.mjs`; passed 112 unit tests and all 8 live governance probe stages
  (7 direct role checks and nested 7-role workflow with 6 accepted children) on branch
  `codex/m7-t2-agent-topology` at implementation commit `4872314c686bcc92797acc68483b8b68fe4ee8ca`.

- Completed remotely backed M7/T2-R11 OpenClaw governance runtime: five-stack
  topology and hard spawn allowlists, exact pinned `2026.6.34` capability policy,
  model-invisible `zink-governance` hooks, append-only trusted ledger with atomic
  budgets, strict execution/result/reference schemas, canonical identity hashes,
  state/retry/cancellation/supersession rules, secret-redacted bounded handoffs,
  layered generated AGENTS contracts, rollback backup manifest, and focused/full
  repository gates on `codex/m7-t2-agent-topology`.
- Added the remotely backed M7/T2-R11 verifier correction: live OpenClaw probes
  use bounded process groups, forced timeout cleanup, batched execution, and
  asynchronous JSON checks so a hung child cannot stall the verifier indefinitely.
- Completed the M7/T2-R11 live-gate hardening: gateway-secret resolution uses the
  same bounded process-group runner, OpenClaw probes run sequentially to avoid
  shared-runtime contention, and the full exact-`2026.6.34` live matrix passed.
- Completed locally verified M7/T1-R16 OpenClaw foundation: seven isolated
  minimal-tool agents and Discord bot accounts across one owner-only text channel
  and three forums, 21 partitioned Google profiles, restricted Docker sandboxes,
  fail-closed plugin/command/model policy, encrypted password-store resolution,
  systemd service controls, and semantic live verification of all 28
  account/surface permission pairs.
- Completed M6/T1-R4 Git-native governed Skill Store core: strict duplicate-key
  rejecting JSON manifests, raw-byte SHA-256-bound UTF-8 Markdown, complete
  fail-closed catalog validation, exact ACTIVE retrieval, deterministic offline
  diagnostics, and the read-only `skill-store` CLI.
- Completed locally verified M4 PDF ingestion at candidate `0a64b0b`: sidecar-driven native/scanned PDF extraction and OCR, deterministic page-local prose/table/figure segments, resumable and drift-safe atomic publication, combined Markdown/PDF retrieval with page citations, and current README operator instructions; exact-candidate Fixture/T3/T4 and five representative real PDFs passed without failed batches or duplicate source publication.
- Added locally validated M4/T2 PDF content builds: exact encrypted/protected/corrupt preflight, bounded four-page offline extraction and multilingual OCR, reading-order text/table/figure materialization, deterministic retrieval-budget segmentation with exact bbox provenance, source-drift and cumulative-deadline containment, process-group cleanup, and atomic non-searchable database batches.
- Added validated M3/T5 acceptance and operational handoff: an exact-clean-HEAD OCI-provenanced Knowledge image, isolated ownership/cleanup, machine-readable Fixture/RealVault/live evidence, candidate/deployment fingerprint separation, read-only Vault proof, migration/recovery checks, persistent rebuild safeguards, resource windows, and the Knowledge operations runbook.
- Added validated M3/T4 hybrid retrieval and ONNX reranking: filtered HNSW and FTS candidates, deterministic RRF, batched dynamic-INT8 reranking, source-line citations, capacity limits, and resource-gated runtime acceptance.
- Added validated M3/T3 index lifecycle: persistent run acceptance before `202`, incremental document replacement, side-by-side full rebuild publication, immutable model-identity gates, guarded deletion, atomic terminal transitions, restart recovery, bounded safe errors, and internal run-status APIs.
- Added locally validated M3/T2 Markdown discovery and retrieval-safe segmentation: deterministic all-or-nothing scan results, strict topic/native-tag validation, frontmatter and Markdown lexical handling, read-only path/link containment, original-line coordinates, heading-aware passages, pinned tokenizer artifacts and `uv` dependencies, actual query/passage pair-budget enforcement, and isolated Linux plus Windows-native acceptance.
- Added validated M3/T1 Knowledge-service foundation: an internal-only FastAPI/Uvicorn container; idempotent `knowledge` schema for indexes, runs, sources, sidecars, and segments; one ACTIVE-index constraint; BGE-M3 digest/dimension readiness guard; orphan-run interruption recovery; advisory-lock background-run coordination; and isolated container acceptance without Vault access.
- Established the local Git repository, private GitHub remote, and documented development conventions for M1/T1.
- Added a pinned Node/npm quality baseline with reproducible formatting, linting, testing, and repository-policy verification for M1/T2.
- Added isolated Git-fixture tests for sensitive-file allowlists, working-tree whitespace, Git whitespace, required files, and command placeholders.
- Added CI and Security workflows with exact Node 24.15.0/npm 12.0.2 provisioning, high/critical dependency audit, full-history Gitleaks scanning, and immutable Action pins for M1/T3.
- Added YAML 1.2 semantic workflow-contract validation with focused unit coverage for executable commands, ordering, permissions, Action pins, and Gitleaks safeguards.
- Added the validated M2/T1 AIStor Free and Ollama runtime preflight, including digest-pinned server/client images, ignored license and credential validation, and an ephemeral in-network `mc` S3 smoke test.
- Added validated M2/T2 core storage: digest-pinned PostgreSQL + pgvector and Redis, idempotent n8n database bootstrap, named-volume AIStor/PostgreSQL persistence, and recreation verification proving Redis remains transient.
- Added validated M2/T3 local integration: digest-pinned n8n and Nginx, PostgreSQL-backed n8n state with a persistent `.n8n` volume and required stable encryption key, loopback-only health/default-deny endpoints, container-to-host Ollama smoke, and recreation verification of encrypted synthetic n8n credentials.
- Added validated M2/T4 observability: digest-pinned Prometheus, Grafana, Dozzle, PostgreSQL exporter, and Redis exporter; repository-provisioned infrastructure metrics dashboard; loopback-only UIs; and verified target, log-filter, resource, OOM, and restart gates.
- Added validated M2/T5 operations and isolated acceptance: cumulative regression, logical PostgreSQL archives, S3-layer object backup/index with checksum and tags, protected `.n8n` archive, checksum manifest, acceptance-only restore guard, and a passing destroy-volumes → clean-recreate → restore verification of PostgreSQL, AIStor, n8n, encrypted credentials, and transient Redis behavior.

### Changed

- M12/T2-R2 (2026-10-13): the governed deployment path is documented for the operator as the two
  trusted scripts already in the repository — `operator-preflight.mjs` then `operator-apply.mjs` —
  which read the identifier file themselves, pass the flags to `configure.mjs`, snapshot and verify
  byte-for-byte, roll back on mismatch, and print only non-secret derived fields
  (README section "Triển Khai Bản Build Governance"). This replaces a hand-written copy-paste block
  that could not run: **`jq` is not installed on the WSL host**, so its six `$(jq -r …)`
  substitutions failed and `set -euo pipefail` aborted at once. The lesson recorded in `PLAN.md`
  §8 is that a command block for an operator host must be checked against what that host actually
  has, or reuse a script that already runs there.
- M12/T2-R2: the owner's five `STACK` definitions are recorded verbatim as the meaning of the tag —
  `INFRA` = Docker and the machine software that runs tasks (Excel, MySQL, DuckDB, …), `SEMANTIC` =
  the layer used when a task needs meaning added because the bot does not yet understand the
  problem, `DATA` = ETL, `ANALYTICS` = charts and dashboards, `DECISION` = the decision report the
  bot analyses. These are the ledger's `target_stack` / `stack_id` enum, so the M12/T2-R1 derivation
  is confirmed rather than changed and the R1 open question is closed.
- M12/T2-R1 (owner instruction 2026-10-13, "bỏ dòng trạng thái đi", **not deployed**): the
  approval card no longer prints its own state in prose —
  `**Trạng thái:** CHỜ DUYỆT (chưa được phép thực thi)` is removed from
  `renderGovernedApprovalBody`, because the state the owner filters on is the forum's `STATUS`
  tag and the thread is only ever opened as `STATUS: WAITING`. The action footer still states
  explicitly that approving is what queues execution, so removing the line removes duplication,
  not the warning. Two related shapes changed deliberately: the #results thread body is the new
  `renderGovernedResultBody` rather than `formatGovernedResultCard`, because that card asks for
  `ACCEPT`/`REJECT` and a results thread is opened only _after_ the owner has accepted — asking
  again would advertise a verdict that has already been made; and the drafted contract's
  "optional `thread_id` on `WORKFLOW_APPROVAL_REQUESTED`" became the separate
  `WORKFLOW_APPROVAL_SURFACED` event, because the request event is appended _before_ the card
  is posted, so no thread id exists yet, and writing one afterwards would mutate an
  already-durable event.
- M12/T2-R1: the acceptance notice in `#office` now points at the results **thread**
  (`<#threadId>`) when that thread was surfaced, and keeps naming the forum when it was not,
  so a suppressed publication never produces a link to something that does not exist.
- M12/T1-R1 (owner instruction 2026-10-13, **not deployed**): the governed task
  **identity** is the 12-character code (`ddmmyyyy` + four characters of the task-code
  alphabet) rather than a 64-hex digest, so the number the owner reads on the card, the
  number in the button `custom_id`, and the ledger key are one value. Readers accept both
  shapes and no live record was migrated or rewritten, which is what keeps the 128
  installed ledger events replaying. Two consequences are accepted and recorded as owner
  decisions: the identity is no longer re-derivable from the origin message (so the
  reducer verifies the recorded binding fields, and replay detection reads
  `findTaskByOriginBinding`), and the code space is ~195k per day (so mint-time uniqueness
  is checked against every live task id and code, and exhaustion fails closed).
- M12/T1-R1: the approval card presents only the Task ID, the plan (`Lý do`, one numbered
  step per admitted brief node with the software named and its operations, constraints and
  acceptance criterion) and the expected result (`Kết quả`). The run code, requester line,
  action line, `child:` line, node/brief revision line, 64-hex id line and the separate
  "Mã ngắn" alias are gone; an over-long plan is cut with a visible marker rather than
  silently. (The `CHỜ DUYỆT` state line that accompanied this presentation was removed by
  M12/T2-R1 on 2026-10-13.)
- Completed M5/T1-R2 architecture contraction: synchronized the three peer Zink modules and reserved OpenClaw boundary, rewrote the Vietnamese operator README, reduced Docker to PostgreSQL/Knowledge/Nginx/n8n/Dozzle profiles with a 6.5 GiB maximum ceiling, retained constrained Dozzle and reusable PostgreSQL/n8n backup logic, and retired unused ZAS/Data Plant runtime, AIStor, Redis, Prometheus/Grafana/exporter configuration. Implementation `4a331d7` and closeout `2ad4247` are remote-backed on `origin/codex/architecture-sync-m4`; repository, Knowledge and isolated runtime gates passed.
- Recorded M3/T5 and M3 remote completion: accepted candidate `ff4a5fb` passed failure cleanup, Fixture, RealVault isolated, persistent live acceptance, and 60 repository/contract tests; PR `#15` merge `9cd34ce` preserved the accepted SHA and is backed by successful GitHub CI run `31894926039`, Security run `31894925985`, and the exact-main remote gate.
- Recorded M3/T4 remote validation: PR `#12` merge `aa73b06` is backed by successful GitHub CI and Security runs after 53 Python tests, 55 repository/contract tests, builder/runtime acceptance, predecessor regressions, and cumulative M2 backup/restore regression.
- Recorded M3/T3 remote validation: PR `#10` merge `242bca8` is backed by successful GitHub CI and Security runs after 42 Python tests, 51 repository/contract tests, isolated M3/T1–T3 acceptance, Windows-native junction/reparse coverage, and cumulative M2/T1–T5 backup/restore regression.
- Recorded M3/T2 remote validation: PR `#8` merge `b446ff1` is backed by successful GitHub CI and Security runs after its 22 Python/golden tests, isolated read-only and Windows-native acceptance, M3/T1 regression, and cumulative M2/T1–T5 local acceptance checks.
- Recorded M3/T1 remote validation: merge `4097862` is backed by successful GitHub CI and Security runs after its isolated M3/T1 and cumulative M2/T1–T5 local acceptance checks.
- Updated backup manifests to record a locally built service image's immutable local image ID when it has no registry digest, preserving M2 backup/restore compatibility after adding the Knowledge container.
- Consolidated the approved V1 roadmap into one authoritative M3 architecture contract, recorded the verified remote M2 backup/CI evidence, and aligned the README with the Markdown-only M3 boundary and deferred multimodal roadmap.
- Replaced the Makefile placeholder with functional quality-gate targets backed by npm scripts and a committed lockfile.
- Replaced the initial partial scaffold with the approved Personal Tool architecture.
- Centralized observability under `infrastructure/observability/`.
- Separated document-oriented Knowledge RAG from L&SC Data Product RAG.
- Added cross-platform tests, experimental workspaces, and CI workflow placeholders.
- Replaced the CI, Security, and redundant test-workflow placeholders with the validated `CI / quality-gate`, `Security / dependency-audit`, and `Security / secret-scan` checks.
- Hardened the reviewed M2 runtime with automatic recovery for long-running services, graceful durable-service shutdown, bounded Docker logs, PostgreSQL shared memory, explicit n8n execution pruning/concurrency/display limits, bounded transient Redis memory with LRU eviction, Prometheus retention capped at 7 days or 512 MiB, and Grafana panels for PostgreSQL size and Redis memory pressure.
- Made normal M2 startup use locally cached immutable images instead of forcing a registry pull; image refresh remains an explicit validated `build.ps1` operation.
- Changed PostgreSQL backup/restore to operate directly on the mounted backup directory, preflight archives before destructive restore, restore with two workers, and run `ANALYZE` afterward so large archives no longer require duplicate staging space in the container writable layer.
- Aligned the eight requested M2 service memory ceilings and raised the global WSL2 VM cap to 9.5 GiB, reserving 2 GiB above their combined 7.5 GiB ceiling.

### Fixed

- **F-373 — the operator's documented deploy path did not name the state root, so
  the deploy deployed nothing.** F-219 made the machine-specific state root an
  OPERATOR INPUT: the operator drivers read `ZINK_OPERATOR_STATE_DIR` or their
  first argument and refuse without one (`STATE_DIR_NOT_NAMED`). The README's
  deploy block was never updated to match, so the commands the owner is told to
  run stopped with that refusal — the preflight never ran, the apply never ran,
  and the operator was left reading `STATE_DIR_NOT_NAMED` twice with nothing
  deployed. The README and the deploy runbook now export
  `ZINK_OPERATOR_STATE_DIR` before the first driver invocation and pass it to
  every driver; `tests/agent-setup-F-373.test.mjs` pins that they keep naming
  it and that the driver still refuses without one.
- M12/T2-R3 (2026-10-14): the owner's deployment of the STACK remediation failed as
  `{"status":"FAIL","stage":"builder-apply","reason":"APPLY_REJECTED","rollbackSucceeded":true}` and
  the truth was that `configure.mjs --apply` had refused at its **last** step,
  `Ledger writer unavailable [EXECUTION_STATE_UNKNOWN]`, because
  `operator/m7-t2/ledger/writer.lock` was orphaned — its `owner.json` names pid `60201`, which is
  dead (the gateway now runs as `60244`, restarted 00:05:29), and the running gateway has logged
  **202** lock-contention failures since. Two separate defects are named here. (1) _Masking_:
  `--apply` runs as a child of `operator-apply.mjs`, whose reason classifier reads only the child's
  **text**, and `configure.mjs` printed prose without the machine code — so a refusal whose code is
  the repository constant `EXECUTION_STATE_UNKNOWN` (already in `KNOWN_REASONS`) collapsed into the
  meaningless `APPLY_REJECTED`. `configure.mjs` now appends `[code]` to its stderr; codes are fixed
  literals, never a message body, path, config or identifier value, so naming one leaks nothing.
  Proven by a new case in `tests/m10-t2-r3-asset-predecessor.test.mjs` that reproduces the exact
  production state — a provisioned scratch runtime with a stranded writer lock — and asserts both
  the child's stderr and what `classifyApplyReason` derives from it; removing the code emission
  fails that one test. Gates: `npm run verify` **PASS** (1462 tests / 1417 pass / **0 fail** /
  45 skipped) and CI run `38443807440` @ `b40154f` `quality-gate` **SUCCESS** (1462 / 1411 pass /
  0 fail / 51 skipped) with `python-quality` **SUCCESS**; Security run `38443813434` `secret-scan`
  **SUCCESS**, `dependency-audit` red on the unchanged 5-high baseline. (2) _The blocker itself_: the lock primitive deliberately has **no**
  age-based reclaim (reclaiming could let two processes into the critical section together) and
  recovery of an orphan "is an explicit operator action, not an automatic heuristic" — but no
  operator procedure for it existed anywhere, and the apply/rollback restart is what produced this
  orphan. Recovery is therefore put to the owner as an explicit decision; nothing was deleted
  without his authorization.
  Diagnosis method: the real `configure.mjs --apply` was re-run against the live runtime inside a
  private mount namespace (`unshare --map-root-user --mount`) with overlayfs upper layers, exactly
  the isolation `r16-rehearsal.mjs` documents — every write landed in a throwaway layer. The live
  tree was then fingerprinted and is **byte-identical** (`live_unchanged: true`, ledger still 139
  events, extension still `513beb15…`, `lib/discord-forum-tags.mjs` still `e0a755bb…`), so this
  consumed no mutation grant and changed nothing. Also recorded honestly: the R16 apply rehearsal,
  which is the repository's own gate for exactly this scenario, **cannot run on WSL** — it still
  calls `inspectNativePatch`/`applyNativePatch`/`checkNativePatch` with a lone `runtimeRoot`
  although M10/T2-R8 made the Discord channel package a second governed root, and its expected
  native states are pinned to the R7→R10 era. It is red on WSL both before and after the partial
  wiring attempted here, so it was left unchanged rather than half-repaired, and the deployment
  was diagnosed without it.

- M12/T2-R3 (2026-10-13, found by the WSL re-run of this same remediation): `R7 P1` in
  `tests/m10-t2-r7-authority-predecessor.test.mjs` asserted that the live
  `lib/authority.mjs` equals one specific digest measured the day R7 was written. Deployment A
  installed a later build, so that photograph went red on every host able to read the live tree
  (Windows skipped it, WSL failed it) while the admission R7 exists to prove is still correct —
  the same stale-pin class M11/T2 closed for the boundary and observability predecessors. Repaired
  as an invariant, not relaxed: the live digest must now be **either** the build the repository
  derives **or** a digest `configure.mjs` admits (anything else is the M11/T1-R2 blocker recurring,
  because `--preflight` would refuse the upgrade), and the outgoing digest's admission was hoisted
  out of the live-reachability branch so every host checks it. No assertion was deleted and no gate
  weakened: the batch went from 143/0-fail-with-1-red to 143/0-fail, and the live halves still run
  (that suite is precisely what caught this).
- M12/T2-R3 (2026-10-13, live regression from deployment A): #office stopped producing approval
  cards. The owner's report was "bot kẹt phản hồi ngay tại kênh office" and the journal named the
  cause twice (`22:42` and `22:48`): `DISCORD_TAG_UNRESOLVED channel=approvals category=STACK
wanted="(no evidence in the governed record)" reason=CLASSIFIER_EMPTY` followed by
  `first-approval card NOT posted: APPROVAL_CARD_NOT_SURFACED:DISCORD_TAG_UNRESOLVED`. The
  fail-closed behaviour was correct — the request stayed durable (`WORKFLOW_APPROVAL_REQUESTED`
  appended, ledger 131 → 139 events, nothing mutated) — but the tag rule behind it was wrong:
  `surfaceStackTag` required the plan's nodes to carry **exactly one distinct** `stack_id`, and
  `current_stack` is bound only when execution starts (`workflow.mjs:1726`), so at approval time
  it is absent. Seven live pending tasks have nodes reaching `data_plant` (excel/sql/python) plus
  `intelligence` (power-bi), i.e. two stacks, i.e. no card, i.e. nothing for the owner to approve.
  The rule now follows the owner's own definitions: STACK names the surface the plan's **output**
  belongs to, so the deepest stack a plan reaches wins
  (`decision` > `intelligence` > `data_plant` > `semantic` > `infrastructure`) and a bound
  `current_stack` outranks the plan's reach because that is the stack actually executing. A plan
  with no stack evidence at all, or only software names (`excel`, `power_bi` — which are agents,
  not stacks), still resolves to nothing and still posts nothing. Two probes each killed one
  control: restoring the single-distinct rule failed 6 tests including the new live-shape case, and
  deleting the new asset admission failed both the textual guard and the real
  `--preflight`/`--apply` rehearsal. Because this changes an asset that is **already installed**,
  `configure.mjs` now admits the deployed digest `e0a755bb…` under
  `lib/discord-forum-tags.mjs` (reproduced byte-for-byte by `git show b6d04e8:…`, 23,825 bytes;
  packaging rewrites none of this module's imports) so the remediation build is reachable —
  admission of the installed bytes only; the candidate digest `18fbb077…` is deliberately not
  listed, and the entrypoint pin does not move because no packaged entrypoint byte changed.
  Gates: `npm run verify` **PASS** on Windows (1461 tests / 1416 pass / **0 fail** / 45 skipped,
  policy passed) and under WSL Ubuntu **143/0-fail** plus **96/0-fail** across the affected
  live-reading sets; CI run `38435007142` @ `c8bcc24` `quality-gate` **SUCCESS** (1461 / 1410 pass /
  0 fail / 51 skipped) with `python-quality` **SUCCESS** (`188 passed, 27 subtests`), Security run
  `38435012291` `secret-scan` **SUCCESS** and `dependency-audit` red on the unchanged 5-high
  baseline. Implementation `0b55dfa`, operator note `c8bcc24`, pushed on
  `codex/m11-t1-audit-remediation`.
  **Not deployed**: the live runtime still carries the refusing build until the owner grants a
  fresh preflight → apply, and the precedence order itself is the agent's judgment call pending his
  confirmation.

- M12/T2-R2 (2026-10-13): deployment A's first attempt failed closed and **mutated nothing**, and
  the reason was this repository's own blind spot, not the live tree. `configure.mjs` reads
  `ZINK_ROUTER_HOST/PORT/API_KEY` from the environment to build the config, so a shell that has not
  sourced `~/.openclaw-zink/router.env` aborts with `ROUTER_…_UNAVAILABLE` before any state check —
  and `operator-preflight.mjs` recognised only nine classes, so every such refusal collapsed into
  `PREFLIGHT_REJECTED`. Two fixes: the classifier now names each known class (router env,
  snowflake parsing, canonical-JSON config, instructions drift, file-mode drift, plugin
  package/manifest, hotfix, resolver, systemd drop-in, ledger corruption, symlink) while still
  emitting only a whitelisted literal and never a raw message, and the README deployment section
  documents the env-sourcing step it omitted. Diagnosed by replication, not guesswork: every gate
  that can be evaluated without operator credentials was checked read-only against the installed
  tree and passed — all divergent assets admitted, entrypoint `61e344e6…` admitted, manifest and
  package byte-equal, auth plans/resolver/hotfix byte-equal at their expected modes, systemd
  drop-in equal to the current rendering, ledger `CURRENT`, workspace templates admissible, and the
  generated config structurally identical to the installed one (318 key paths each).
- M12/T2-R1 (2026-10-13): three gates were red **only on a host that can read the live WSL
  tree** and none of the three was an M12 regression — each was a photograph of the day it was
  written, overtaken by the runtime it observes. They are repaired as invariants, not relaxed
  into passes:
  (1) `tests/m8-t2.4-approval-request.test.mjs` pinned the production ledger at exactly `103`
  events / `37` tasks and asserted that **zero** approvable tasks exist. The gateway keeps
  appending (131 events) and legitimately parks tasks in "requested, not yet decided", so the
  case now asserts the projected sequence equals the replayed log length, that the historical
  tasks and their briefs survive, and that replay invents no approval opportunity by comparing
  the projection against its own installed anchor — the fabrication rule itself stays enforced
  behaviourally by the reducer. (2, 3) `tests/m10-t2-r6-boundary-predecessor.test.mjs` and
  `tests/m10-t2-r8-observability-predecessor.test.mjs` each cross-checked the _live_ installed
  file against their own historical baseline digest, which any later deployment invalidates.
  Their provenance half (a historical commit re-packaged through `governancePluginFiles()`
  reproduces the digest that task admitted) is untouched and still byte-exact; the redundant
  live half now defers to `R13 P1`/`R13 P2`, which read those same two installed paths and
  require the live digest to be either the build the repository derives now or a digest
  admitted in `configure.mjs` — one live-reachability mechanism instead of three copies of a
  stale equality. Evidence: 20/20 for those three predecessor suites and 181/181 across the
  whole affected set under WSL with ZERO skips.

- M12/T1-R1 (2026-10-13, **not deployed**): every Discord component this plugin posts is
  now built through the host's `buildDiscordComponentMessage` and registered with
  `registerBuiltDiscordComponentMessage` against the message id the adapter returns, with a
  per-card 24-hour ttl and `reusable` blocks so a decision that fails inside the plugin
  stays retryable. Approve / Request Revision / Reject therefore no longer answer "This
  component has expired". Registration degrades loudly (`COMPONENT_SDK_UNAVAILABLE` /
  `COMPONENT_REGISTRATION_FAILED`) and never blocks the card, so approving from the thread
  text keeps working even where the host SDK is unreachable. Live behaviour is NOT
  verified: the running gateway still carries the M11/T3-R1 build, and deploying this one
  needs its own owner grant. Repository evidence: CI run `38365272022` @ `219ac1d` on
  ubuntu-24.04 (`quality-gate` SUCCESS — 1417 tests, 0 fail, `Repository policy check
passed.`; `python-quality` SUCCESS — 188 passed, 27 subtests) and Security run
  `38365276313` (`secret-scan` SUCCESS, zero leaks; `dependency-audit` unchanged red on
  the pre-existing 5-high baseline).
- M12/T1-R1: the two live-runtime cross-checks in
  `tests/m8-t2.10-r13-r7-predecessor-allowlist.test.mjs` (R13 P1/P2) failed on any host
  that can read the deployed tree, because they still asserted the installed entrypoint
  and `lib/native-boundary.mjs` equal the R7-era digests while the 2026-10-13 M11/T3-R1
  deployment replaced them (`61e344e6…`, `5966d446…`). The committed-source R7 proofs are
  untouched; the live half now checks the property that actually matters — the installed
  digest is either the build the repository derives now or a predecessor
  `configure.mjs` admits in both mode gates — so the suite is green on WSL and on Windows
  without weakening anything.
- M12/T1-R1: an approval decision with no caller-supplied reason is recorded with the
  reason that matches the decision taken (`USER_APPROVED`, `USER_REQUESTED_REVISION`,
  `USER_REJECTED`, `USER_ACCEPTED`) instead of the single literal `USER_REJECTED` that
  every approval-channel verdict used before.
- Fixed ten verified HIGH-severity defects in the OpenClaw runtime and its durable-state
  seams (`3cb8274` + `6b0ea0a`, M11/T3-R1, closed 2026-10-13; **deployed and verified on
  the live WSL gateway the same day** — see the deployment record under `Added`). Gateway
  hangs and silently lost state both
  had concrete mechanisms: the Discord bot-token path ran a config-derived path through
  `/bin/sh`, three Discord REST `fetch` calls had no deadline at all, three
  native-boundary catch seams threw their fixed contract string and dropped the
  original error, and the queue's `enqueueTask`/`clear` were the two mutators that wrote
  without `withLock`, so a stale in-memory projection could clobber a concurrent
  `claimTask` lease. Phase 1 replaced the shell with argv (`execFileSync`), bound every
  fetch to one exported `DISCORD_REST_DEADLINE_MS = 10_000`, preserved each cause while
  leaving every host-visible string byte-identical, and moved both queue mutators inside
  the existing lock. Durable integrity had worse failure modes: an exhausted file-lock
  release left its owner-token mapping behind so a process could believe it still held a
  lock it had lost, and the async release path busy-waited the event loop; a
  half-initialized governance ledger (one of events/snapshot present) was silently
  "repaired" into an empty one, which for this repository means the owner's confirmed
  decisions disappearing; `DecisionLedger.save()` and the approval-file reads did their
  whole read-modify-write outside any lock while both sibling stores serialize; and a
  `REJECTED` skill proposal was missing from the decided-state guard, so re-proposing
  identical bytes overwrote the owner's rejection. Phase 2 gave both release halves one
  shared errno/attempt policy (`ESTALE`/`EIO` retryable, token cleared on exhaustion, no
  new stale-lock reclaim heuristic), made a half-missing ledger pair a refusal with the
  existing `EXECUTION_STATE_UNKNOWN` code instead of a silent reset, serialized the
  decision-ledger write plus rename and the approval reads through the shared
  `withFileLockSync`/`lockDirFor` primitive and the catalog's own
  `withSkillStoreWriterLock`, and made `REJECTED` terminal. Contention surfaces only
  through codes these seams already emit — no new enum member was added to
  `tool-result.schema.json` or `TOOL_RESULT_ERROR_CODES`, and no file format changed.
  Evidence: two new suites written red-first
  (`tests/m11-t3-openclaw-runtime-bounds.test.mjs` 8,
  `tests/m11-t3-durable-state-integrity.test.mjs` 20) and wired into the hand-maintained
  `npm test` list; `npm run verify` **PASS** on the Windows host (1374 tests / 1329 pass
  / 0 fail / 45 skipped, `Repository policy check passed.`); the lock predecessors
  `m10-t2-r18-file-lock` 8/8 and `m11-t1-r2` 7/7; both new suites and the predecessor
  suite re-run green under WSL Ubuntu, where the four re-pinned packaged digests match
  the Windows values exactly. Remote backing: CI run `38336851433` on the task branch at
  the closeout commit — `quality-gate` **SUCCESS** on ubuntu-24.04 (`ℹ tests 1374 /
ℹ pass 1323 / ℹ fail 0 / ℹ skipped 51`, `Repository policy check passed.`) and
  `python-quality` **SUCCESS** (`188 passed, 27 subtests passed`) — plus Security run
  `38336854295`, whose `secret-scan` is **SUCCESS** (gitleaks 8.24.3, zero leaks) while
  the run overall stays red only on the pre-existing `dependency-audit` baseline.
  22 of 24 mutation runs killed their defect; the 2
  survivors are at the pre-existing `enterNativeRun` seam this task did not change and
  are recorded as a coverage gap. Four outgoing packaged digests were admitted so
  `--preflight` keeps accepting the deployed extension. Reported and deliberately not
  changed: two ledger roots are configured (live `openclaw.json` points at the Windows
  operator root while every regression fixture hardcodes the WSL path), the router
  fallback chain's 100 s × 5-candidate dead time is bounded by the owner's own recorded
  model-order decision, and approval replay protection remains in-memory and
  single-process. `npm audit` stays red on the pre-existing 5-high findings both locally
  and in CI, and `verify.mjs`/the PostgreSQL statement gate stay `NOT RUN`.
- Fixed `CI / quality-gate` being unrunnable in CI since 2026-10-02 (`a8122f5`,
  M11/T2-R2, closed 2026-10-12). Commit `1a36c52` inserted the Knowledgebase Python
  suite into the `verify` composition and pinned it in `REQUIRED_VERIFY_STAGES`, but
  attached the Python toolchain (`actions/setup-python`, `uv`, the checksum-verified
  tokenizer) only to `CI / python-quality`. `quality-gate` runs `npm run verify` in a
  job that provisions Node alone, so every CI invocation of that gate passed `npm test`
  and then died at `sh: 1: uv: not found` (exit 127) — including the merge-base state
  that would have turned `main` red on merge. The suite now has exactly one executor
  per environment: `CI / python-quality` in CI, `npm run test:knowledge` /
  `make test-knowledge` on a host, and `verify` is the four Node stages
  (`format:check`, `lint`, `test`, `repo:check`). Deleting the stage from `verify`
  alone would have removed the only proof the Python gate runs at all, so
  `checkCiWorkflow` gained `checkKnowledgebaseSuiteSingleOwner`, which fails unless
  `npm run test:knowledge` appears exactly once across all jobs and belongs to
  `python-quality`; the previous guard was re-expressed rather than deleted
  (`rejects a verify gate that deviates from the documented Node stage order` covers an
  omitted stage, a reordering and a re-added Python stage;
  `requires exactly one CI executor for the Knowledgebase Python suite` covers a
  duplicated and a misplaced executor). `README.md` and
  `docs/development/conventions.md` record the host instruction. Evidence:
  `node --test tests/repository-policy.test.mjs` 22/22 (one case added, none removed),
  `npm run repo:check` passed, `npm run verify` **passes on this host with
  `KNOWLEDGE_TOKENIZER_PATH` unset**, `npm run test:knowledge` unchanged at
  `184 passed, 4 skipped, 27 subtests passed`, and CI run `38202129189` shows
  `quality-gate` **SUCCESS** (`ℹ tests 1344 / ℹ fail 0`,
  `Repository policy check passed.`) with `python-quality` **SUCCESS**
  (`188 passed, 27 subtests passed in 11.45s`, tokenizer verified `OK`). `.github`
  workflow files are byte-unchanged. Cost of this design, stated plainly: one host
  command no longer covers the Python tier. `dependency-audit` remains red on the
  pre-existing 5-high findings.
- Fixed three gates that could not run outside one laptop (`2bc8ddf`, M11/T2-R1,
  closed 2026-10-12 with CI evidence). (1) Four Skill Store suites
  (`tests/m10-t2-r20-skill-catalog-and-sql`, `…r21-skill-chunking-and-text-budgets`,
  `…r22-publish-durability-and-bounded-backup`, `…r25-skill-read-apply-integrity`)
  read production sources through a hardcoded
  `const ROOT = "C:/Users/HOANG VINH/…"` and `ENOENT`-ed on any other host; they now
  derive the repo root with the repository's own portable idiom
  (`path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")`) and load
  modules through `pathToFileURL(…).href`. No assertion, expected value, test name,
  subtest, fixture or skip condition changed, and `npm test` totals stayed exactly
  1343 tests / 1298 pass / 0 fail / 45 skipped — that identity is the proof nothing
  was weakened. (2) `CI / python-quality` installed Python and `uv` but no Node, so
  `npm run test:knowledge` died in npm on the `devEngines.runtime` pin
  (`EBADDEVENGINES … v22.23.3`) before pytest collected anything; the job now carries
  the same SHA-pinned Node/npm toolchain steps `quality-gate` uses. (3) `secret-scan`
  in full-history `workflow_dispatch` mode reported two sha256 **digest constants**
  in `integrations/openclaw/configure.mjs` as `generic-api-key` leaks; they are
  provenance pins, so they are fingerprinted in `.gitleaksignore` instead of touching
  scanner rules. Evidence: CI run `38199387584` — `python-quality` SUCCESS with
  `188 passed, 27 subtests passed in 10.50s` and the pinned tokenizer verified
  `OK` (188 = the 184 that pass here plus the 4 this Windows account must skip for
  symlink privilege, so those platform cases are now proven on Linux); Security run
  `38199389639` — `secret-scan` SUCCESS. `CI / quality-gate` is **still failing**,
  one stage later and for a different, pre-existing reason: `verify` contains the
  Python stage while that job provisions Node only (`sh: 1: uv: not found`, root
  cause `1a36c52`), which is recorded as open finding A-08 and drives the proposed
  M11/T2-R2. `dependency-audit` remains red on the pre-existing 5-high findings and
  `M11-06`'s PostgreSQL gate stays `NOT RUN` in CI.
- Fixed a Zink Knowledgebase boot failure. `GET /healthz` in
  `apps/knowledge/app/main.py` declared the return annotation
  `JSONResponse | dict[str, str]` without `response_model=None`, so the pinned
  FastAPI 0.133.0 / Pydantic 2.13.4 pair raised `FastAPIError` while
  registering the route. `import app.main` and therefore the container's
  `uvicorn app.main:app` command failed at startup, independent of database
  availability. The fix adds `response_model=None`, matching the `/readyz` route
  immediately below it, and changes no response contract, no dependency version,
  and no unrelated code. The regression entered in commit `01489aa`; the running
  `personal-tool/knowledge:m3` image predates it (revision `0a64b0b`) and was
  therefore not affected. No deployment or runtime change was made.
- Fixed the absence of a Python quality gate. The Knowledgebase Python suite was
  never executed by `npm run verify` or CI, so the boot failure above shipped
  undetected. Added `npm run test:knowledge` (and a `test-knowledge` Make target)
  running `uv run --directory apps/knowledge --locked python -m pytest tests -q`
  against the existing `uv.lock`, pinned `pytest==9.1.1` in a new `dev`
  dependency group that the runtime image does not install, inserted the stage
  into `npm run verify` between `npm test` and `npm run repo:check`, and added a
  blocking `CI / python-quality` job using SHA-pinned `actions/setup-python`,
  `uv sync --locked`, and a checksum-verified suite tokenizer.
  `repository-policy.mjs` now enforces the verify stage order and the presence,
  ordering, blocking behaviour, and pdf-runtime exclusion of that CI job, with
  matching policy tests. The Linux/x86_64-only `pdf-runtime` suite remains an
  explicit `NOT RUN` in CI rather than an implied pass.
- Fixed specialist bot direct Discord mention leakage by enforcing `SPECIALIST_NO_DIRECT_INGRESS` in `integrations/openclaw/lib/authority.mjs` and the governance plugin, ensuring specialist agents reject direct ingress mentions across all channels and never converse directly on `#office`.
- Fixed mock SQL row leakage by enabling real DuckDB execution via `zink-tools/sql/duckdb-bridge.mjs` and enforcing discrete execution states (`REAL_EXECUTED`, `EMPTY_RESULT`, `TEST_SIMULATION`, `TIMEOUT`) that fail closed upon syntax or binder errors.
- Fixed workspace artifact dirtying by eliminating secondary writes to repository `artifacts/` during Excel and artifact generation, strictly isolating persistent artifacts to designated out-of-repo storage.
- Fixed truncated OpenClaw Discord replies across all seven bots by backporting
  exact-version Gemini terminal-stream recovery and suppressing errored partial
  answer, reasoning, and final-evidence payloads. The patch is hash-guarded,
  reversible, enforced before service start, and validated by 81 repository
  tests, 60 live gates, and three owner-observed all-seven Discord runs.
- Hardened the M6 Skill Store validator to stop before decoding oversized
  content, reject URI-shaped repository references, suppress partial catalogs,
  preserve operational error classification, and order diagnostics without
  locale dependence.
- Isolated T5 Nginx now uses a validated ephemeral loopback port, remote evidence resolves exact workflow-run IDs, and schema-present live recovery dumps run inside operational PostgreSQL without Compose helper reconciliation.
- Made partial validation startups eligible for cleanup, added a bounded retry for transient AIStor marker writes immediately after bucket readiness, and made acceptance fail if its isolated project or volumes cannot be destroyed, preventing leaked test stacks, flaky recreation checks, and false backup/restore passes.
- Fixed the high-risk audit tier (`M12/T2.1-R3`, closed 2026-10-15): an unreadable proposal record is no longer indistinguishable from an absent one (so a recorded owner verdict cannot be silently overwritten), rollback residue is detected by `stat` instead of by catching, upstream HTTP response bytes and child-process stderr are kept out of model-visible results, a live credential substring is masked by omission rather than redaction, snapshot temp residue and ledger attribution are errno-first, a PDF citation can no longer print `(lines None-None)`, and a destructive rehearsal is no longer published under a `test:*` name. Evidence in `PLAN.md` §8.
- Fixed Wave A of the medium tier (`M12/T2.2-R1`, closed 2026-10-15): one coordinator-to-stack registry source with an honest stack denial, an applied migration that refuses silent editing, a state root that is already a ledger root refused by name, and the no-skip re-embed decision pinned where a future change would break it. Two planned items stopped on refuted premises and are recorded, not shipped.
- Fixed Wave B of the medium tier (`M12/T2.2-R2`, closed 2026-10-16): `npm test`'s argv is reconciled with `tests/` in both directions, prettier and eslint globs are quoted so `dash` cannot silently check zero test files, the reference-id predicate means resolvable, one relevance rule with the conservative polarity the live adapters already used, resource ceilings read from one place, a broken reason-policy load named and undeclared reason codes refused, a schema manifest that lost a member no longer verifying as valid, a component build failure no longer taking the approval card with it, bounded lock walks and created-not-adopted temp files, a query bounded before the tokenizer, cause-preserving attribution for governed denials, terminal fault mappers for the index-run routes and `/readyz`, and a file-lock gate that measures liveness rather than tick rate. Follow-ons from executing it: the deployed extension is reachable to `--preflight` again, every announce discard states its reason, and the nine drifted governed assets were admitted with provenance rather than re-baselined. Evidence in `PLAN.md` §8.
- Fixed the low-risk documentation and gate tier (`M12/T2.3-R1`, closed 2026-10-17): the Skill Store contract lists only the two real model tools and describes both boundary paths, the decision ledger is no longer a fourth module, the published provider matrix answers to each adapter's own `SIMULATION_CONTRACT` header (and Gate G18 asserts its live column for the first time), RC-09 states the execution states the SQL bridge actually returns, the Zink Tools diagram separates capability families from the eleven real exports, `apps/knowledge/` is named as the accepted runtime instead of the `platforms/` scaffold, the five governed outage classes have a runbook, the vector sync report carries the semantic contract version, `PLAN.md` gained the two gate fields plus the `NOT RUN` / `NOT TESTED` / `NOT DEPLOYED` definitions, and the npm gate registry is enumerated and enforced (7 → 9 required scripts). Evidence in `PLAN.md` §8.
- Fixed the Skill Store lifecycle band (`M12/T2.2-R3`, closed 2026-10-17): writer residue from a killed publisher is recognized by the grammar the writer actually produces and empty parent directories are pruned, so a stale staging directory beside another version can no longer null the whole catalog; a version directory missing either member heals instead of masquerading as canonical; `ALREADY_ACTIVE` now binds the decision and provenance it claims to confirm instead of silently dropping a second owner verdict; every writer refusal carries a machine-readable `details` cause array so a caller can tell bad input from a poisoned tree without parsing prose; a control byte in a skill body is now a scan-time diagnostic (`INVALID_SKILL_CONTENT`) instead of a database error inside an open transaction, with tab/LF/CR exempted by owner decision `A` because the borrowed predicate was written for identity segments; a failed vector sync refreshes both digests and deletes the segment rows, so a `FAILED` row no longer advertises the previous successful sync's representation or leaves its vectors selectable; an absent namespace is `AMBIGUOUS` rather than `general`; the embedding envelope refuses to fabricate the taxonomy it advertises and coerces a non-string body; `validateArtifactLogicalPath` returns the normalized path its README promises. The failure-path SQL now has a real-PostgreSQL lane in the tracked tree (owner grant `n1`). `R3-0`'s endpoint probe is `NOT RUN` on this host, so the `R5-E05-05` guard stays unshipped, and the packaged-entrypoint, retirement and schema-ownership work stays excluded by the owner's own letters (`p1`, `r2`, `s1`). Evidence in `PLAN.md` §8.
- Fixed the governance record itself (`M12/T4-R1`, closed 2026-10-17): `PLAN.md` gained §4.17, a tracked disposition table that gives each of the 38 findings orphaned by the withdrawn `M12/T2.4`–`T2.7` groupings a locator, a disposition, and a live successor band (`M12/T5`…`T8`), so "what is still open" now has one answerable source; no row claims a landing it cannot cite. The findings register was refreshed to the vocabulary §4.17 uses and stated its own limits (124 entries, 27 `CLOSED`, 2 `REFUTED`, 6 `EXCLUDED`, the rest `OPEN`/`LATENT`/`HYPOTHESIS`/`REPORTED`), and `R5-E09-08` was added after the re-inventory proved it was never recorded. The M12 release-gate cell dropped 81% of its length under a printed, independently re-measured no-fact-loss diff, and the two delivery records that had been sitting outside §8 were moved back inside it. `docs/development/conventions.md` names the executor `dsh`, the way `AGENTS.md` §3 defines it. Five premises this contract inherited from its own plan failed verification and are recorded as corrections, not shipped as fixes. Evidence in `PLAN.md` §8.

---

#### The register's closure history — moved out of `docs/execution/findings.md` §2 (2026-10-21)

- The owner's decision `H10` (2026-10-21) — _"lỗi nào fix xong và chứng minh được là đã
  fix thì được phép xóa lỗi đó trong findings, lịch sử lưu vào changelog"_ — makes
  `docs/execution/findings.md` the OPEN queue: a row that is FIXED and PROVEN is deleted
  from it, and its history lives here.

- The **368** closed rows the register's §2 closure tables carried are below, grouped by
  the band that closed them. Each entry carries the row's own id, its own one-line
  defect, the commit that closed it and its evidence. For the 317 rows the register
  closed with one commit each, the commit IS the evidence (`findings.md` §0.2 rule 3);
  for the 51 rows it closed with an evidence line, that line is carried verbatim.

- The register keeps the rows that are still open, the rows whose premise was measured
  dead (`REFUTED`) and the rows parked on a decision (`EXCLUDED`); the closure tables
  are gone from it, and `docs/execution/findings.md` §0.5 states the rule.

#### M12/T2.1 — the high-risk tier (8 rows)

- **`R1-A14-01`** — a failed snapshot write clears its temp file and names its errno —
  closed by `b3affc2`. Evidence: M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3.
- **`R1-A14-02`** — a failed snapshot write clears its temp file and names its errno —
  closed by `b3affc2`. Evidence: M12/T2.1 T2.1-6 (b3affc2) — B7-1/B7-2/B7-3.
- **`R5-E02-05`** — a citation omits a line location its row does not have — closed by
  `b7497ca`. Evidence: M12/T2.1 T2.1-7 (b7497ca) — test\_retrieval.py, PDF row with a
  NULL page pair.
- **`R5-E04-03`** — a rolled-back promotion says whether canonical state is clean —
  closed by `2e7da50`. Evidence: M12/T2.1 T2.1-2 (2e7da50) — R22-08/R22-09, stat-based.
- **`R5-E06-03`** — a Knowledge service failure forwards no response bytes — closed by
  `c4833e6`. Evidence: M12/T2.1 T2.1-3 (c4833e6) — stub HTTP service + marker scan;
  acceptance divergence recorded in PLAN.md §8.
- **`R5-E06-04`** — a DuckDB engine failure forwards structured fields, not stderr —
  closed by `710f650`. Evidence: M12/T2.1 T2.1-4 (710f650) — real engine, marker scan,
  ETIMEDOUT shape observed.
- **`R5-E06-07`** — a proposal record that cannot be read blocks the write — closed by
  `96a6dd2`. Evidence: M12/T2.1 T2.1-1 (96a6dd2) — B6-4 + mutation probe.
- **`R5-E08-02`** — put the R16 rehearsal behind an operator gate, out of a test: name —
  closed by `ba5ff08`. Evidence: M12/T2.1 T2.1-8 (ba5ff08) — four driver gates; the
  residual host-evidence half stays open as R6-I01-03.

#### M12/T2.1-R3 — the owner-answer round (3 rows)

- **`R5-E13-06`** — the lock recovery report states presence, never a nonce fragment —
  closed by `91d788d`. Evidence: M12/T2.1-R3 owner answer A (91d788d) — the recovery
  report now states presence only; verified in tree at
  integrations/openclaw/topology/fixtures/runtime-regression/operator-lock-recovery.mjs:147.
- **`R6-I01-01`** — importing app.main no longer requires the pinned tokenizer — closed
  by `ad4a8d6`. Evidence: M12/T2.1-R3 (ad4a8d6) — the skip that this defect caused now
  runs; Python lane 142 passed / 6 skipped.
- **`R6-I01-02`** — the lock recovery report states presence, never a nonce fragment —
  closed by `91d788d`. Evidence: M12/T2.1-R3 owner answer A (91d788d) — assertion
  re-valued to a presence constant; disabling the omission reddens it.

#### M12/T2.2-R1 — Wave A (4 rows)

- **`R1-A04-01`** — read the coordinator stack rule from one table, before the write —
  closed by `ccf2ad7`. Evidence: M12/T2.2-R1 A-1 (ccf2ad7) — test-first 9/9, adjacent
  66/66, WSL lane run.
- **`R1-A04-05`** — one stack registry, and stop reporting a stack refusal as a missing
  delegation — closed by `09aa698`. Evidence: M12/T2.2-R1 A-2 (09aa698).
- **`R5-E16-01`** — serialize the coordinator-notification queue write, and roll the
  build digest forward — closed by `d1378ba` and `f93068e`. Evidence: M12/T2.2-R1 A-3
  (d1378ba) + M12/T2.2-R2 B-12 (f93068e) — new lock/temp test file 203 lines.
- **`R5-E16-02`** — serialize the coordinator-notification queue write, and roll the
  build digest forward — closed by `d1378ba` and `f93068e`. Evidence: M12/T2.2-R1 A-3
  (d1378ba) + M12/T2.2-R2 B-12 (f93068e).

#### M12/T2.2-R2 — Wave B (18 rows)

- **`R1-A04-06`** — name a broken reason-policy load, and stop accepting an undeclared
  reason code — closed by `a21c610`. Evidence: M12/T2.2-R2 B-8 (a21c610).
- **`R1-A05-01`** — a component build throw must degrade to text, not lose the card —
  closed by `46852f3`. Evidence: M12/T2.2-R2 B-10 (46852f3).
- **`R1-A02-04`** — a component build throw must degrade to text, not lose the card —
  closed by `46852f3`. Evidence: M12/T2.2-R2 B-10 (46852f3) — same defect as
  `R1-A05-01`, filed twice; closed by the shipped test 'delivers the card as text when
  the component build itself throws' (re-run 2026-10-17: suite 12 pass / 0 fail).
- **`R1-A09-01`** — a component build throw must degrade to text, not lose the card —
  closed by `46852f3`. Evidence: M12/T2.2-R2 B-10 (46852f3) — the by-elimination
  confirmation of `R1-A05-01`; same commit, same test, re-run green 2026-10-17.
- **`R1-A13-03`** — the boundary seams now say which guard reason denied them — closed
  by `5c156d4`. Evidence: M12/T2.2-R2 B-16 (5c156d4) — that commit message names
  `R1-A13-03`; tests/m12-t2.2-b16-denial-reason re-run 2026-10-17, combined with the
  registry suite: 19 tests / 19 pass / 0 fail.
- **`R1-A08-08`** — stop the workflow from retyping the ceilings it is meant to enforce
  — closed by `6f3c970`. Evidence: M12/T2.2-R2 B-7 (6f3c970).
- **`R1-A12-07`** — the boundary seams now say which guard reason denied them — closed
  by `5c156d4`. Evidence: M12/T2.2-R2 B-16 (5c156d4) — red-before 6/7, green-after 7/7,
  three mutation probes.
- **`R5-E01-03`** — bound the search query before it costs a slot and a tokenization —
  closed by `7bc3e5d`. Evidence: M12/T2.2-R2 B-13 (7bc3e5d).
- **`R5-E07-02`** — one relevance rule, with the conservative default — closed by
  `3701804`. Evidence: M12/T2.2-R2 B-6 (3701804).
- **`R5-E07-03`** — make the reference-id predicate mean resolvable, not well-formed —
  closed by `b7d9d36`. Evidence: M12/T2.2-R2 B-5 (b7d9d36).
- **`R5-E08-01`** — let prettier expand its own globs, so CI stops checking 4 files —
  closed by `c449cd0`. Evidence: M12/T2.2-R2 B-2 (c449cd0).
- **`R5-E08-03`** — make repo:check refuse a test file that npm test never names —
  closed by `a108cde`. Evidence: M12/T2.2-R2 B-1 (a108cde).
- **`R5-E08-04`** — stop verify.mjs asserting POSIX modes on a host that cannot express
  them — closed by `d34c666`. Evidence: M12/T2.2-R2 B-3 (d34c666).
- **`R5-E10-03`** — make the asset-table assertion refuse an unterminated table — closed
  by `0dddea4`. Evidence: M12/T2.2-R2 B-17 (0dddea4).
- **`R5-E14-05`** — make the two identical acceptance compose files a gated relationship
  — closed by `7aebc39`. Evidence: M12/T2.2-R2 B-15 (7aebc39).
- **`R5-E16-03`** — stop walking to the filesystem root six times per ensureLedger —
  closed by `937521c`. Evidence: M12/T2.2-R2 B-11 (937521c).
- **`R7-GATE-01`** — the file-lock gate must measure liveness, not tick rate — closed by
  `9fa6505`. Evidence: M12/T2.2-R2 B-19 (9fa6505) — gate now asserts heartbeats >= 1
  (liveness) instead of tick rate; verified in tree.
- **`R1-A12-07-BLOCK`** — the boundary seams now say which guard reason denied them —
  closed by `5c156d4`. Evidence: narrative blocker for R1-A12-07; resolved when B-16
  landed (5c156d4).

#### M12/T2.3-R1 — Wave C (9 rows)

- **`R5-E05-06`** — the sync report says which version it means — closed by `8bde65f`.
  Evidence: M12/T2.3-R1 C-9 (8bde65f, re-scoped) — red-before, 2/2 after, WSL lane 2/2.
- **`R5-E11-02`** — the boundary claim describes both paths that really exist — closed
  by `e47e660`. Evidence: M12/T2.3-R1 C-3 (e47e660, narrowed scope).
- **`R5-E11-03`** — the model-visible list names only the two model tools — closed by
  `3685548`. Evidence: M12/T2.3-R1 C-1 (3685548).
- **`R5-E11-04`** — the provider matrix must answer to the adapters — closed by
  `68fe25b` and `cd1b541`. Evidence: M12/T2.3-R1 C-4 (68fe25b + review fix cd1b541) —
  three mutation probes, WSL 12/12 twice.
- **`R5-E11-05`** — RC-09 promises the execution states the bridge actually returns —
  closed by `0ccdd81`. Evidence: M12/T2.3-R1 C-5 (0ccdd81).
- **`R5-E11-06`** — the boundaries diagram says what it is, and the exports are listed —
  closed by `5e798aa`. Evidence: M12/T2.3-R1 C-6 (5e798aa).
- **`R5-E11-07`** — the decision ledger stops calling itself the fourth module — closed
  by `3248f60`. Evidence: M12/T2.3-R1 C-2 (3248f60).
- **`R5-E12-04`** — the gate registry is enumerated, and the enumeration is enforced —
  closed by `d9e1bcc`. Evidence: M12/T2.3-R1 C-13 (d9e1bcc) — 35/35 policy tests + two
  real-tree probes.
- **`R5-E14-01`** — the accepted Knowledgebase runtime is apps/knowledge/, not
  platforms/ — closed by `a4ed77d`. Evidence: M12/T2.3-R1 C-7 (a4ed77d, re-scoped by
  location).

#### M12/T2.2-R3 — the Skill Store lifecycle (4 rows)

- **`R5-E04-02`** — heal a version directory that is missing either member — closed by
  `812b8ec`. Evidence: M12/T2.2-R3 R3-2 (812b8ec) — that commit says 'Closes R5-E04-02';
  tests/m8-t3-governed-memory-learning re-run 2026-10-17 → 47 tests / 47 pass / 0 fail
  incl. T2h.
- **`R5-E05-04`** — make a failed sync stop describing the last good one — closed by
  `1bab75d`. Evidence: M12/T2.2-R3 R3-7 (1bab75d) — shape test + scratch real-PostgreSQL
  run; two of its clauses were refuted at the pre-freeze read.
- **`R5-E07-06`** — return the normalized logical path the README promises — closed by
  `e7aee21`. Evidence: CLOSED by `M12/T2.2-R3` `R3-10` (`e7aee21`) — red-before measured
  2026-10-18 by replaying `git show e7aee21^:zink-tools/common/path-safety.mjs`: the
  pre-fix validator returned `data\sub\f.csv` verbatim where the shipped assertion
  demands `data/sub/f.csv`, and the `segments.length === 0` branch was unreachable.
  Green at HEAD: `tests/m7-t3-tools-contract.test.mjs` case `AC 36` passed on the re-run
  of 2026-10-18 (32 tests / 0 fail / 0 skipped), and `zink-tools/common/README.md:74-75`
  now documents the normalized return for both backslash forms, which is exactly this
  row's `Acceptance criteria`..
- **`R5-E07-07`** — stop the embedding envelope from inventing its own taxonomy — closed
  by `04e128f`. Evidence: CLOSED by `M12/T2.2-R3` `R3-9` (`04e128f`, owner grant `q1`) —
  red-before measured 2026-10-18 by replaying
  `git show 04e128f^:zink-tools/common/semantic-contract.mjs`: a taxonomy-less
  `renderEmbeddingEnvelope` call did NOT throw and rendered `Domain: general` /
  `Primary Topic: general`; at HEAD the same call raises
  `EMBEDDING_ENVELOPE_METADATA_REQUIRED`. Green at HEAD:
  `tests/m8-t1-skill-vector-memory.test.mjs` case `R3-9` passed on the re-run of
  2026-10-18 (15 tests / 0 fail / 0 skipped). Stated limit of the closure: an EXPLICIT
  `domain: "general"` still renders, because what the fix removed was the invented
  default, not the value..

#### the rows the register removed as duplicates of a canonical row (4 rows)

- **`R5-E01-01`** — duplicate of R5-E02-01 (canonical row kept as the R5-E02-01
  successor) — closed by `ddcc0b9` (the canonical row's commit).
- **`R1-A13-05`** — duplicate of R1-A12-03 (canonical row kept) — closed by `ba9bb19`
  (the canonical row's commit).
- **`R1-A16-04`** — duplicate of R1-A09-02 and R1-A05-01 — closed by `c4295ff` and
  `46852f3` (the canonical rows' commits).
- **`R6-CFG-03`** — duplicate of `R1-A04-01` (closed by A-1 ccf2ad7;
  tests/m12-t2.2-a1-stack-authority re-run 2026-10-17 → 9 pass / 0 fail) — closed by
  `ccf2ad7`.

#### the F-225 fix (2026-10-18) (1 row)

- **`R7-D4-01`** — a refused historical recovery now stops instead of continuing into
  the restore — closed by `cb5b83b`. Evidence: CLOSED by the F-225 fix (`cb5b83b`) —
  `refuse()` now throws a private `RecoveryRefused` that the single catch recognises, so
  every refusal ends the command before the first mutating call. Red-before 28/30 (the
  two new tests `R12 I`/`R12 J` fail), green-after 30/30, mutation probe (remove the
  `throw`) re-reddens exactly those two, full gate 1608 tests / 1559 pass / 0 fail / 49
  skipped at `VERIFY_EXIT=0`. The live gateway was never restarted by any of this: the
  lane runs a copy whose `systemctl` literal is replaced by a binary that cannot exist..

#### M12/T9 — the first band (2026-10-19) (134 rows)

- **`R2-B01-02`** — if (context.agentId) reqHeaders["X-Agent-Id"]
  (knowledge-adapter.mjs:261) is always false on the live path while X-Task-Id (:260) is
  payload-populated → the internal service gets attacker-chosen correlation and no
  identity — closed by `ad397d4`.
- **`R7-OB-05`** — the outage runbook points the operator at a symlink validator for the
  writer lock it says to recover — closed by `61a60ac`.
- **`R7-OB-04`** — a durable contract counts the code it audits, and both counts are now
  wrong — closed by `2741094`.
- **`R7-F1-09`** — the ingress diagnostics case titled "before the logger call" records
  two independent captures and never compares their order — closed by `8201723`.
- **`R7-F1-08`** — the task-code lane's header justifies the display alias with an
  alphabet size the same file pins at a different value — closed by `8340ccc`.
- **`R7-F1-07`** — the case that forces a failing lock release never asserts that the
  release failed, and the file's own comment records that the first version passed
  vacuously — closed by `0a70780`.
- **`R7-F1-06`** — an assertion that promises to scan the boundary source for retired
  codes actually scans a 41-character refusal constant — closed by `ea8571c`.
- **`R7-F1-05`** — the case that claims to test ids outside both reference registries
  reads only one of them, and its surviving assertion is sensitive to data it never
  names — closed by `7a28ec7`.
- **`R7-E4-01`** — the heartbeat exemption case passes the hook's arguments to a map
  lookup, so the handler is never invoked and both assertions are structural — closed by
  `661aa9c`.
- **`R7-C2-06`** — declared ceilings bind nothing in the analytics adapters: an exported
  timeout constant has no reader, and the row bound omits the sibling's lower clamp so a
  negative request reports a successful zero-row result — closed by `1855416`.
- **`R7-D11B-05`** — the reason-code reader consults only two of the three matrix
  sections, and the reducer's suspension write consults none — closed by `5820c42`.
- **`R5-E04-06`** — the invariant's code is dead vocabulary for sanctioned writers,
  while the state it guards can only be created by editing files outside the lock — with
  no digest recompute, no decision binding and no tooling. The owner gets no signal
  from… — closed by `2cbb462`.
- **`R5-E14-06`** — the runtime-backup/snapshot machinery writing under a module path
  (e.g — closed by `faec89e`.
- **`R1-A03-05`** — two different owner-snowflake validators and two owner sources —
  closed by `10a3da2`.
- **`R5-E01-02`** — the digest is computed once per process and nothing in its key can
  change at runtime, so after a PDF runtime/manifest/tokenizer change a long-lived
  /readyz probes forever against a stale expectation — permanent false not\_ready
  (replica… — closed by `c876539`.
- **`R5-E15-04`** — static — no validation of containerName exists between :239 and :253
  — closed by `131c768`.
- **`R1-A03-06`** — the knowledge adapter's SSRF allowlist has a blanket off switch —
  closed by `81b7e3c`.
- **`R6-R3-NEW-02`** — a $ inside a bounded error message truncates the failure-path
  SQL block — closed by `ac4577c`.
- **`R5-E14-04`** — an operator believes an editable workspace template exists on disk
  and edits a directory nothing reads — closed by `cb6c07d`.
- **`R2-B07-02`** — incident dedupe ignores Discord's truncation flag — closed by
  `f7d949a`.
- **`R7-OC2-03`** — the module READMEs document contract vocabularies, error names and a
  validation call that no schema or code defines — closed by `a239911`.
- **`R7-OC2-02`** — both operator walkthroughs read index/search response fields the
  service never returns — closed by `45aec4c`.
- **`R7-OB-03`** — the decision-ledger contract declares one deterministic id rule and
  the store enforces another — closed by `9588009`.
- **`R7-H1-01`** — the historical-recovery gate accepts an authorization record of any
  age and never binds it to the runtime it is about to dismantle — closed by `9f50fd6`.
- **`R7-F2-02`** — three distinct parent-side PDF build failures are folded into the
  generic runtime-failure code, and the test that names the specific case pins the
  generic one — closed by `7eb840c`.
- **`R7-F2-01`** — the PDF content-identity digest test derives its expected value from
  the production domain constant, so the persisted lookup key has no independent pin —
  closed by `9097917`.
- **`R7-F1-04`** — the e2e workflow lane names scenarios its bodies never run, compares
  a production constant to its own literal, and cites an execution contract that is not
  in the repository — closed by `7035b37`.
- **`R7-F1-03`** — the preflight-ingress lane never awaits the async harness it built,
  so the denial branch its own docstring advertises is unobservable in every case —
  closed by `53890b7`.
- **`R7-F1-02`** — the lane that proves each run resolves its own task pins the approved
  half only as absence of one code, so the stale-task symptoms it exists to disprove
  pass — closed by `949a8c3`.
- **`R7-F1-01`** — the heartbeat sentinel's second context field is production-reachable
  but no test ever supplies it, so deleting that disjunct keeps every lane green —
  closed by `61edc9b`.
- **`R7-E1-05`** — the vault scanner's link and junction gate reports "no link" when it
  cannot read metadata, so an unreadable component is indexed rather than refused —
  closed by `5e918e4`.
- **`R7-E5-02`** — the contract byte-integrity lane regenerates the manifest it is
  comparing, so editing any tool contract reddens nothing — closed by `5b92415`.
- **`R7-E4-03`** — six differently named n8n refusals are all proven by one flattened
  constant, so no case shows its titled rule firing — closed by `08833c0`.
- **`R7-E4-02`** — the cross-agent quota-leak assertion searches a JSON string for a
  quoted number, a form the payload can never contain — closed by `cf64d69`.
- **`R7-E3-04`** — the specialist-provenance rule's claimed-active allow branch is
  exercised only as a denial, so deleting the branch changes nothing — closed by
  `2d2ce4e`.
- **`R7-E2-04`** — one tests directory is run by two incompatible runners, and the image
  lane runs it without pytest installed — closed by `3c870a4`.
- **`R7-E1-06`** — the Knowledgebase start-up flattens every reranker failure into one
  string, stores it in a field nothing reads, and readiness re-emits that same string
  rather than reading the field — closed by `cf9db8b`.
- **`R7-E1-02`** — the run-error payload counts errors after deduplication and
  redaction, so `total_error_count` is not the number of errors — closed by `5572ab7`.
- **`R7-C5-02`** — the DuckDB timeout gate drives a test-supplied failure flag, and the
  only path that exercises the real bound sits behind a skip and inside a conditional
  assertion — closed by `f37b0a4`.
- **`R7-C2-05`** — the analytics adapters echo a target database of their own invention
  and never call the shared resource allowlist that the bridge enforces — closed by
  `8ff610d`.
- **`R7-C2-04`** — the simulation adapters emit no fidelity field, so canned provider
  results are structurally identical to real ones even though the shared bridge requires
  consumers to refuse them — closed by `84aaeb4`.
- **`R7-C2-03`** — the MLflow adapter returns shallow-frozen aliases of its live store,
  so a consumer can rewrite artifact lists and metric history it was told is immutable —
  closed by `8687dea`.
- **`R7-C2-02`** — the DagsHub adapter ignores its configured repository, accepts a
  wildcard selection, and enforces only the comment that forbids it — closed by
  `a372805`.
- **`R7-C2-01`** — the BigQuery read-only guard is a private seven-keyword regex instead
  of the shared SQL validator, so it admits statements the canonical gate refuses and
  rejects reads that contain none — closed by `0fd4883`.
- **`R7-C1-03`** — the envelope's artifact vocabulary has no producer anywhere in the
  repository, so results must ship an empty artifacts array — closed by `52a2d3d`.
- **`R7-D10B-01`** — each `/v1/search` pays three provider round-trips because identity
  verification resolves the model with a real embedding call, twice — closed by
  `71ca3a7`.
- **`R7-D11A-03`** — a directory-fsync failure after a committed rename rolls the
  in-memory ledger back, so the next successful save erases the owner's decision —
  closed by `5c027aa`.
- **`R7-D10A-05`** — the PDF publish path inserts one statement per segment while its
  markdown sibling uses `executemany`, so a large build aborts inside its own
  transaction — closed by `12b04ab`.
- **`R7-D8-04`** — `bindInvocationApproval` drops the owner-principal equality check
  whenever the task carries no principal reference — closed by `25dfe6b`.
- **`R7-D5-02`** — `python-validator.mjs` enforces no invariant yet README and CHANGELOG
  publish it as the AST safety gate for `zink_python` — closed by `5e20022`.
- **`R7-D4-06`** — the transaction preimage hashes raw bytes but stores and re-hashes
  them as UTF-8 text, so one non-UTF-8 asset makes capture throw — closed by `b6e9c0f`.
- **`R5-E10-05`** — assertions on a process-global singleton owned by the imported
  plugin, with no reset and no captured baseline — closed by `1c4dacd`.
- **`R5-E10-04`** — one boolean conflates "unreadable" with "readable but drifted" —
  closed by `22eb734`.
- **`R5-E10-01`** — three suites require historical git objects and the external tar
  binary — closed by `879613e`.
- **`R5-E09-04`** — the recorded evidence is a bare pass count (188 passed, 27 subtests,
  PLAN.md:246) with no skipped or deselected count, so a shrinking collected set reads
  as an unchanged green — closed by `3c50428`.
- **`R1-A10-07`** — the zink-tools/ lint/format gap hides four real defects, not style
  noise — closed by `64f40c4`.
- **`R5-E16-04`** — up to ten blocking file operations per second for ten minutes run on
  the same event loop that serves /search — closed by `bf4f665`.
- **`R5-E06-08`** — an absent, unmounted or unreadable skills root is reported as a
  successful discovery of zero skills — closed by `8e6ca1e`.
- **`R5-E06-06`** — the ceiling is a post-hoc .slice() on an already materialized full
  result with no LIMIT pushed to the engine and no maxBuffer set, so the only real bound
  is Node's 1 MiB default stdio buffer — closed by `ad64be5`.
- **`R1-A14-07`** — the knowledge adapter deadline is per-attempt, not per-call: 3 × 120
  s + backoff exceeds runTimeoutSeconds: 300, and transport errors get no retry — closed
  by `218bc8a`.
- **`R5-E06-02`** — the declared 50 MB ceiling admits up to ~150 MB UTF-8 for
  Vietnamese/CJK text, and any multi-byte character straddling a chunk boundary is
  silently replaced by U+FFFD — corrupted retrieved evidence is then formatted and
  counted as… — closed by `610714f`.
- **`R5-E04-04`** — the promotion probe compares content, decision and provenance but
  never actors, and its provenance equality is key-order-sensitive — closed by
  `099a1d2`.
- **`R5-E02-06`** — two slow embedding responses hold both slots for up to 90 s, so the
  third and every later caller is refused outright — closed by `75f7af5`.
- **`R5-E01-04`** — in the ordinary "Postgres starts later" race, boot failure becomes a
  sticky flag: no pool, no \_apply\_migrations, and both recovery calls skipped for the
  process lifetime — so interrupted RUNNING index runs and their shadow BUILDING… —
  closed by `b1676c8`.
- **`R2-B08-02`** — fixed-name exclusive-create temp files are never cleaned, so one
  interrupted apply/restore permanently blocks retries — closed by `2406013`.
- **`R5-E12-02`** — LATENT is neither OPEN nor FIXED, so the code-review:128 "zero OPEN"
  precondition is satisfiable by re-labelling confirmed High findings, and
  CLOSED/Duplicate records bypass README:83's "FIXED requires validation" rule. The
  per-round… — closed by `5f57b2a`.
- **`R5-E02-04`** — total\_count reports the page length, so a 20-candidate pool cut to
  limit=5 reads as "only 5 matches exist" — closed by `301e1f9`.
- **`R1-A15-08`** — stale comments and cited config keys that assert rules the build no
  longer follows — closed by `46181c3`.
- **`R1-A11-05`** — the published contract version is fabricated, and schema files
  resolve through process.cwd() — closed by `23a41fc`.
- **`R1-A10-05`** — zink\_excel implements less than its contract: template\_path
  ignored, extra sheets dropped, validate is an existence check — closed by `6db8d8f`.
- **`R1-A10-03`** — memory-tool output contracts are declared but validated nowhere, and
  the adapters already emit out-of-contract values — closed by `8fa4ad1`.
- **`R6-C-NEW-01`** — a skill manifest lifecycle event cannot cite the repository's own
  dotted task ids — closed by `846a2bb`.
- **`R5-E04-08`** — the caller branches on error.code (index.mjs:1123-1125 recognizes
  only SKILL\_ACTIVE\_CONFLICT/SKILL\_VERSION\_CONFLICT), so "your input is invalid"
  (retryable) and "the tree is poisoned" (needs an operator) share one code — a proposal
  can be… — closed by `c759246`.
- **`R5-E03-03`** — bounded, retryable recovery / an unbatched bulk delete under a 30 s
  command\_timeout sitting on the only path that makes the service ready — closed by
  `3115fc0`.
- **`R1-A14-05`** — event.yielded === true grants run-end approval before the success
  assertion, so a failed run passes with no terminal record — closed by `4dc7a52`.
- **`R1-A14-04`** — tool-call lease verification deletes the lease before checking it;
  three distinct denials collapse to POLICY\_DENIED and leak identity values into the
  log — closed by `2c2c5fe`.
- **`R1-A09-07`** — silent capability loss at load: no host-compatibility assertion and
  no interactive-surface self-check — closed by `063d27f`.
- **`R1-A07-06`** — handleDiscordAction's authoritative-state resolution and its ledger
  write are both optional (paths-gated) — closed by `c968a26`.
- **`R5-E15-02`** — putLandingArtifact({ artifact\_id: "../silver/x" }) is accepted
  today — closed by `7656ccc`.
- **`R5-E09-07`** — a credential committed to the task branch can reach main unscanned,
  and the "zero leaks" claim in PLAN.md cannot be re-inspected because no artifact
  exists — closed by `2977bd0`.
- **`R5-E05-05`** — the 1024-d vectors in skills.segments — and therefore which skill an
  agent retrieves — can come from a swapped or unversioned model while the sync reports
  READY — closed by `2c75a86`.
- **`R1-A06-07`** — invocation leases and run-start waiters share one process-global
  registry keyed without the governance scope — closed by `502c9c6`.
- **`R1-A03-01`** — media-root containment on the native send path is lexical, not
  symlink-safe — closed by `ac13e8d`.
- **`R5-E07-04`** — one corpus split by spelling — a document tagged research indexes
  with primary\_topic domain-research while kb/knowledge-base/literature (which do reach
  the alias) index as kb-ingestion, and neither the filter nor the envelope can… —
  closed by `a9310c1`.
- **`R5-E02-03`** — a caller that disables rerank for latency gets an unfiltered page
  whose "scores" are meaningless against any 0-1 threshold, and cannot distinguish
  low-confidence hits from filtered ones — closed by `83a6aa5`.
- **`R1-A16-08`** — skill-loop actor identity is re-derived a third way; the durable
  proposal records a constant, not the agent — closed by `481c848`.
- **`R1-A13-02`** — 0b55dfa silently changed #incidents tag semantics without touching
  index.mjs; the call-site comment still states the reverted rule — closed by `daeeda7`.
- **`R1-A10-06`** — two declared skill-search filters can never match: secondary\_topics
  is always empty and the primary\_topic check is a no-op — closed by `d299b9e`.
- **`R7-IG-04`** — a tracked test comment denies the owner's grant for the very
  assertion the same test pins — closed by `a5bb3e5`.
- **`R7-E2-01`** — the atomic-index test's fake connection records no transaction event,
  so the swap can stop being atomic and the suite stays green — closed by `8cb52ae`.
- **`R7-E1-03`** — the markdown topic derivation silently discards every alias tag the
  module itself recognises, and the code it reserves for that case is never raised —
  closed by `1e2cbf1`.
- **`R7-C6-04`** — the availability probe folds every failure into "engine not
  installed", so a hanging or broken DuckDB retires six SQL gates that still report
  success — closed by `acbd5f5`.
- **`R7-C6-03`** — the two tool envelopes resolve only through repo-relative and
  working-directory paths that packaging does not ship, and the failure is swallowed as
  a generic schema error — closed by `ff3191e`.
- **`R7-C6-01`** — the approval card tells the owner the result preview is attached, and
  no outbound path in the integration can attach a file — closed by `7ef4808`.
- **`R7-C1-02`** — the result envelope is validated with a 64 KiB caller default while
  the reachable n8n path publishes budgets an order of magnitude larger, so a successful
  side-effected call is destroyed after the fact — closed by `66dd9f3`.
- **`R7-D11A-02`** — the result card sanitizes every sibling field but emits `preview`
  raw, so untrusted file bytes reach Discord unredacted — closed by `2f169e1`.
- **`R7-D11A-01`** — artifact "validation" is extension plus size plus substring: the
  excel branch checks nothing structural and the ZIP helper is not a ZIP parser — closed
  by `78082ee`.
- **`R7-D10A-02`** — `acquire_advisory_lock` leaks a pooled connection whenever the lock
  query raises, and four leaks make the whole service report a database outage — closed
  by `88bff38`.
- **`R7-D10A-01`** — cancelling an index run leaves a permanent `RUNNING` row, and the
  unique-running constraint turns that into a self-block reported as a database outage —
  closed by `3e43a1b`.
- **`R7-D11B-04`** — the event contract accepts artifact objects the snapshot contract
  rejects, and the event is fsynced before the projection is validated — closed by
  `1812803`.
- **`R7-D8-03`** — the free-text approval ingress fabricates the channel and actor it
  then validates, so "approval must occur in #approvals" can never fail — closed by
  `731e6f2`.
- **`R7-D5-01`** — `zink_n8n` reports tool success the moment a workflow is accepted, so
  a queued run reads as completed work — closed by `6afc10f`.
- **`R7-D4-02`** — an owner ACCEPT stamps `workflow_status: COMPLETE` without reading
  the outcome it accepted — closed by `2fadb40`.
- **`R1-A12-08`** — the live-rehearsal probe writes the PRODUCTION ledger and seeds its
  own precondition, so its PASS says nothing about ingress or delivery — closed by
  `26f4e29`.
- **`R1-A12-04`** — the failing production seam for approval buttons has no test, and
  the try-block conflates "post failed" with "registration failed" — closed by
  `5ec731c`.
- **`R1-A12-01`** — the live-runtime digest cross-checks report PASS (not skip) when the
  live tree is unreachable, contradicting their own stated contract — closed by
  `3730ee5`.
- **`R1-A05-03`** — preflight installs an ExecStartPre boot dependency it never checks,
  so apply-then-start can leave the gateway permanently failed — closed by `9d6eb3e`.
- **`R5-E05-02`** — one malformed SKILL.md anywhere pins every previously READY row,
  including rows for deprecated skills — retirement stops taking effect — closed by
  `768253f`.
- **`R5-E04-01`** — one killed promotion of 2.0.0 makes skill-store get/validate,
  getActiveSkill, syncSkillsToVectorStore and every later promotion fail closed
  store-wide — because the contract says a malformed record prevents all normal
  retrieval — until a human finds a hidden directory — closed by `2319878`.
- **`R5-E03-02`** — the lock was introduced for the M4 acceptance-backup flow and the
  default startup branch was left outside it — closed by `c58653c`.
- **`R2-B08-01`** — the native-patch lineage-upgrade branch takes no backup and has no
  rollback — and it is the branch the live host version would use — closed by `416b0f0`.
- **`R1-A14-08`** — a knowledge-service failure returns a success-shaped envelope, and
  fabricated placeholder provenance is counted as evidence under governed\_status:
  "SUCCESS" — closed by `7cacb65`.
- **`R1-A08-01`** — one crash/ENOSPC/drvfs-EIO mid-append makes every readSnapshot,
  appendEvent and recordWorkflowEvent fail gateway-wide, forever — closed by `99c4168`.
- **`R5-E11-01`** — any routing or ownership decision made from the canonical document
  dispatches ETL work to O2, which the guard denies — closed by `26c4db9`.
- **`R5-E06-05`** — every contract-valid parameterized zink\_sql call fails at the
  engine, while the traversal/escape scan over parameter values protects data that never
  reaches SQL — closed by `dfe21cc`.
- **`R1-A11-01`** — parent\_agent\_id is declared twice with contradictory value sets —
  closed by `3fc27be`.
- **`R5-E06-01`** — an upstream-supplied Retry-After: 86400 sleeps unbounded with the
  permit held, freezing both slots of the process-wide sharedSearchSemaphore(2) — closed
  by `04847c9`.
- **`R5-E02-02`** — identity is a mutable text path plus an index-run UUID — closed by
  `0351044`.
- **`R1-A16-07`** — the Knowledgebase citation/provenance round trip breaks at the
  adapter: three advertised actions have no server route, and index identity is dropped
  — closed by `2f7bb8e`.
- **`R1-A13-04`** — the operator lock recovery covers 1 of at least 4 governed lock
  roots, while M11/T3 widened the unprotected one — closed by `a9636c1`.
- **`R1-A11-06`** — version governance: two duplicated supported-version lists,
  unconditional refusal, and cross-record era inference on replay — closed by `0223c5f`.
- **`R1-A05-08`** — admission loses the original cause and the inter-session digest
  binding is optional, so a resumed continuation can be minted started without
  comparison — closed by `496f18a`.
- **`R5-E15-03`** — model-authored SQL can reach a host file read whose contents return
  as result rows that the model — and then the Discord card — read — closed by
  `b0b8dbc`.
- **`R2-B01-01`** — user\_principal\_ref for ANSWER\_USER is minted with a hardcoded
  HMAC key — closed by `ab4333a`.
- **`R1-A10-04`** — model-supplied action, api\_key and timeout reach the adapters and
  override governance decisions — closed by `d5086e7`.
- **`R1-A02-02`** — two resolvers for the same governance dependencies disagree; the
  live one points at an incomplete hand-seeded directory — closed by `93c2aa1`.
- **`R1-A09-05`** — two plugin config keys are read but unreachable by configuration,
  killing skill approval and the guild gate — closed by `8b41897`.
- **`R1-A16-01`** — post-approval execution is unreachable: nothing ever writes
  task.primary\_coordinator — closed by `e45ba43`.
- **`R1-A06-01`** — the queue lease lifecycle has no runtime driver — a crashed claim
  never returns — closed by `dd7f6ac`.
- **`R1-A01-05`** — Zink Tools provider adapters exceed the declared tool-ownership set
  — closed by `86a9a4b`.
- **`R5-E15-05`** — the vault path that gets validated is a different path object from
  the one that gets opened — closed by `13a69c9`.
- **`R5-E01-05, F-240 R7-D6-01`** — entangled in one source file — closed by `263096d`.
- **`R1-A10-02`** — every successful zink\_excel and zink\_sql result is rejected by its
  own output contract — success is punished, failure passes — closed by `c865bcd`.
- **`R1-A07-01`** — the owner's APPROVE is bound to a task id only — no plan,
  brief-revision or digest binding — closed by `048c438`.

#### M12/T9 — the second band, first close (2026-10-20) (47 rows)

- **`R2-B02-01`** — pickup-loop eligibility is a one-shot existsSync at register() time
  (index.mjs:6095-6101), so a snapshot created after load (first install, or after a
  guarded lock/snapshot recovery) leaves the coordinator lane permanently dark until… —
  closed by `c4295ff`.
- **`R1-A02-01`** — the deployed plugin loads live repository source through a hardcoded
  Windows mount path, bypassing the digest-gated packaged assets — closed by `c4295ff`.
- **`R1-A04-03`** — Skill Store scoping is namespace-blind and the per-agent apply scope
  strings are decorative — closed by `eb1518c`.
- **`R1-A04-08`** — the memory-tool executors trust model-supplied session_key / run_id
  / task_id over the trusted context — closed by `c4295ff`.
- **`R1-A06-04`** — runId is reused across fallback re-entries while liveness is
  runId-keyed and consumed destructively — closed by `0514732`.
- **`R1-A10-01`** — skill read/validate/apply cannot reach the ACTIVE version once any
  superseded version exists — closed by `0786790`.
- **`R1-A15-04`** — preflight PASS is structurally blind to the orphaned writer lock
  that has twice killed an apply — closed by `1512d0a`.
- **`R1-A02-08`** — the coordinator pickup loop is started per register() with no
  process-level latch — four loops observed in one live process — closed by `c4295ff`.
- **`R1-A06-05`** — ASK_USER attributes a governed question to a run that did not ask it
  — closed by `832f082`.
- **`R1-A06-06`** — the reducer admits a digest-less result into review, then every
  verdict requires a digest — closed by `832f082`.
- **`R1-A06-08`** — a spawn reservation stuck in SPAWN_UNKNOWN has no timeout, no
  terminal event and no reconciler — closed by `832f082`.
- **`R1-A07-05`** — isPreAdmittedFixture is a fixture-named admission branch fully
  reachable in production — closed by `c4295ff`.
- **`R5-E03-04`** — read-only SELECT count(*) FROM knowledge.pdf_content_builds b WHERE
  NOT EXISTS (SELECT 1 FROM knowledge.pdf_source_details d WHERE d.build_id=b.id) —
  closed by `ddcc0b9`.
- **`R5-E03-08`** — a green contract test that pins dead schema (assert on the table's
  existence, not its behaviour) is a re-base cost the next refactor cannot remove
  without appearing to break a gate — and if anything ever does write a sidecar, the
  next… — closed by `072e225`.
- **`R2-B01-05`** — the bot token that opens a production #approvals thread is chosen
  from event-supplied childSessionKey, not from the ledger — closed by `c4295ff`.
- **`R1-A09-02`** — a card is durably recorded SURFACED while its interactive part never
  arrived, and is then un-re-drivable forever — closed by `c4295ff`.
- **`R1-A14-03`** — the announce seam discards the card-publish verdict and still
  returns deliver; an unparseable payload drops with no log line at all — closed by
  `c4295ff`.
- **`R5-E02-01`** — an answer scoped to a namespace is really corpus-wide — the owner
  cites content from another namespace believing it was governed, and no error ever
  surfaces — closed by `ddcc0b9`.
- **`R1-A11-03`** — outcome_status is copied six times and the reason-code matrix
  declares an outcome no schema can express — closed by `832f082`.
- **`R1-A15-07`** — governance docs no longer describe reality: executor role,
  validation vocabulary, branch discipline — closed by `21ce708`.
- **`R1-A02-05`** — one concept, two implementations: deriveApprovalScopeDigest exists
  twice with different payload shapes, plus dead duplicates and three canonicalizers —
  closed by `832f082`.
- **`R1-A05-07`** — apply-mode diagnostics carry 11 reason classes against
  preflight-mode's 27, so identical refusals degrade to APPLY_REJECTED — closed by
  `364bf22`.
- **`R2-B04-02`** — excel-writer.mjs is digest-pinned _and_ overridden from the working
  tree — closed by `c4295ff`.
- **`R5-E03-01`** — read-only SELECT typname FROM pg_type t JOIN pg_namespace n ON
  n.oid=t.typnamespace WHERE n.nspname='knowledge' — closed by `ddcc0b9`.
- **`R1-A05-05`** — the apply sequence restarts the unit without daemon-reload and never
  verifies the loaded unit — closed by `bbfccac`.
- **`R1-A12-05`** — the only apply-rehearsal instrument is skipped by an env var in all
  three lanes and its isolation proof is blind to the governed Discord channel root —
  closed by `e7f84b5`.
- **`R1-A12-09`** — the verdict-matrix suite counts any thrown error as the specified
  policy DENY, and three cases require no diagnostic at all — closed by `ee9a803`.
- **`R2-B06-01`** — the digest-derivation pins freeze the denial path's literal source
  text, penalising the very fix K01 needs — closed by `aaa0394`.
- **`R5-E14-03`** — a speculative target tree committed ahead of implementation —
  AGENTS.md §8 forbids exactly this — closed by `ea94a1f`.
- **`R6-R3-NEW-01`** — the real-PostgreSQL SQL gate exercises only one of the three
  tracked migrations — closed by `b3c9168`.
- **`R5-E08-06`** — npm run verify says nothing about the PowerShell the runbooks tell
  the owner to execute, including a backup script — closed by `45effbd`.
- **`R7-D4-03`** — the 12-character task code is minted from `Math.random()` over a 21^4
  space and is now the ledger identity the approval is keyed to — closed by `c4295ff`.
- **`R7-D4-05`** — the declared transition projection omits the state the replay arm
  writes, and its only checker has zero call sites — closed by `d0de7ee`.
- **`R7-D1-04`** — the enforced Knowledge input schema is a hand-built registry object,
  so the published `$defs.input` never gates a call — closed by `4a8ee68`.
- **`R7-D2-01`** — the `pdf-runtime` child package and its only test suite are executed
  by no lane: CI, the Docker build and the .mjs contracts all stop at the parent —
  closed by `301b492`.
- **`R7-D6-01`** — three remediation assertions can only be reddened by editing a
  literal, never by breaking the behaviour they claim to cover — closed by `a9c9f80`.
- **`R7-D10A-03`** — mutation transactions resolve the owner connection from a mutable
  global slot, so a stale run can write inside a newer session's ownership — closed by
  `ddcc0b9`.
- **`R7-C1-05`** — the four schema-only capability contracts declare an open parameters
  object that contradicts their own directory rule, and no gate validates a payload
  against them — closed by `5fc0a85`.
- **`R7-C3-02`** — the child rewrites every OCR timeout and output-cap breach into a
  generic runtime failure, so the parent's timeout handling is unreachable for the case
  it was written for — closed by `d4d7c44`.
- **`R7-C3-05`** — the processing-identity probe is an echo: the child returns the value
  it was sent and two parent sites compare it back — closed by `d4d7c44`.
- **`R7-C3-06`** — the segment builder drops runtime items whose content normalises to
  empty with no counter, unlike its own fail-closed sibling for a wholly empty result —
  closed by `c031ed6`.
- **`R7-C5-05`** — the snapshot-target test wraps its assertions in the condition that
  is itself under test, so reclassifying one scope silences the check without failing it
  — closed by `f355d81`.
- **`R7-C5B-C`** — the test that repeated attempts must not mutate the ledger runs no
  attempt and asserts only a property of the snapshot builder — closed by `c6f9ddf`.
- **`R7-E1-01`** — the PDF runtime manifest stamps model provenance copied from the
  downloader's own constant, and two supply-chain fields are checked for presence only —
  closed by `d4d7c44`.
- **`R7-E2-02`** — every reranker test constructs the object around its constructor, so
  the artifact-digest verification is executed by no test and eight failure codes are
  asserted as one — closed by `88ca6ec`.
- **`R7-E2-05`** — the readiness attribution test hand-copies five cases and cannot see
  three mapped branches the route actually emits — closed by `764f52d`.
- **`R7-E4-04`** — the canonical-versus-live SQL agreement matrix compares the validator
  against itself, because the live seam is a wrapper around the same module — closed by
  `a13d675`.

#### M12/T9 — the second band, final close (2026-10-21) (120 rows)

- **`R1-A02-07`** — two decision/queue stores with two roots, and a load-once in-memory
  singleton used as live authority — closed by `6a31150`.
- **`R1-A09-03`** — #incidents can never post: the dedupe read uses a Discord endpoint
  that does not exist — closed by `bcd1013`.
- **`R1-A13-01`** — M12/T2-R1's "one honest tag per category" rule caused the live
  approval outage; R3 reverted it for STACK only — the same rule still sits at the
  RISK/TYPE/STATUS siblings — closed by `5a2b536`.
- **`R2-B08-04`** — the Discord channel plugin path is pinned by a hardcoded install
  content-hash — closed by `bcd1013`.
- **`R1-A03-02`** — the execution-approval card renders model-authored plan text, so the
  owner's APPROVE is not bound to the plan that executes — closed by `15c1779`.
- **`R1-A03-04`** — completeTask verifies no principal and self-satisfies its own result
  digest — closed by `37a17a1`.
- **`R1-A04-02`** — the KB_ACCESS_MATRIX L1 (DISCOVER) tier is never enforced at the
  retrieval seam — closed by `15c1779`.
- **`R1-A11-04`** — WORKFLOW_CANCELLED channel/message provenance is unconstrained in
  schema and unchecked at runtime — closed by `4f9ef4b`.
- **`R2-B01-03`** — the durable reducer admits APPROVE for a plan that was never
  requested or surfaced — closed by `43999a7`.
- **`R2-B03-01`** — the probe forges origin: discord provenance into live durable state
  — closed by `b912a6b`.
- **`R5-E13-01`** — find /home/hoang_vinh/.openclaw-zink -maxdepth 1 -type f ! -perm 600
  — prints modes and names, no bodies — closed by `6c0f814`.
- **`R6-HUNT-01`** — a gitignored scratch worktree embeds a live Discord bot token and
  sends real messages outside governance — closed by `6ca68d7`.
- **`R1-A03-03`** — handleExecutionFinished reads and hashes an artifact path with only
  optional containment — closed by `5309439`.
- **`R1-A07-04`** — the verdict path never checks that the interaction happened in the
  recorded approval thread — closed by `43999a7`.
- **`R1-A10-08`** — Excel write-side containment is lexical while the read side is
  realpath — the weaker twin remains on the last write path — closed by `65ee430`.
- **`R5-E13-03`** — the repository — which lives under OneDrive, a synced third-party
  store, and is pushable to a remote — contains the complete server-scoped
  bot/role/channel identity map, enabling targeted impersonation of an agent mention
  surface, and the… — closed by `c89974e`.
- **`R5-E13-05`** — M7-063 is decorative: the only tracked occurrence sits outside its
  scope — closed by `0984b47`.
- **`R5-E15-01`** — dispatch a non-excel governed tool call carrying ../ in a
  path-shaped input through guard.beforeToolCall and observe that no
  SCHEMA_VALIDATION_FAILED is produced — closed by `fc13406`.
- **`R1-A02-03`** — the Skill Store imports the plugin's internal file-lock.mjs by
  relative path, creating two lock instances per process — a structural cause of the
  recurring orphan lock — closed by `b7d307e`.
- **`R1-A06-03`** — once a coordinator task reaches EXECUTING the state machine has no
  exit at all — closed by `0308434`.
- **`R1-A08-02`** — read-only duplicate-sequence check on the live journal (grep -o
  '"sequence":[0-9]*' then sort/uniq -d) — closed by `99ed7fa`.
- **`R1-A12-03`** — the documented EXECUTION_FINISHED result chain is unreachable in
  production while two suites keep it green — closed by `ba9bb19`.
- **`R1-A14-06`** — the coordinator pickup loop reports failures as return values that
  no one reads, so a permanently blocked queue logs nothing — closed by `ae52716`.
- **`R1-A08-03`** — terminal forensics for the known 4-NATIVE_ENDED/144-events gap is
  unresolvable from the ledger alone, and event-count reconciliation is impossible —
  closed by `357b933`.
- **`R1-A08-04`** — read-only — list snapshot tasks whose workflow_status is
  non-terminal and which have no matching terminal event — closed by `43999a7`.
- **`R1-A11-02`** — the owner-verdict enum: schema permits 6 values, the reducer accepts
  3, authority uses different names — closed by `bcd1013`.
- **`R1-A13-06`** — two "byte-equal" deployment post-checks report different
  denominators (35 vs 37) for a packaged set that did not change — closed by `ae9be15`.
- **`R1-A15-05`** — PLAN.md is 377 KB / 5,054 lines with a 1,203-word single table cell,
  while the documented process requires reading it whole — closed by `bc29715`.
- **`R1-A08-07`** — schema-accepted events should be uniformly replayable vs these two
  are invisible before the snapshot head and brick the read after it — closed by
  `357b933`.
- **`R1-A05-02`** — apply mutates surfaces the transaction preimage never captures, yet
  rollbackSucceeded is licensed by those bytes alone — and one apply stage deletes
  irreversibly — closed by `aa5b7bc`.
- **`R1-A15-01`** — integrations/openclaw/README.md still documents the retired
  Google-provider deployment end to end — closed by `b00c188`.
- **`R1-A15-02`** — the only documented deploy path bypasses the apply orchestration;
  "one apply per grant" has no tool support — closed by `bcd1013`.
- **`R1-A16-02`** — a second dead end in the same hop: dispatch capabilities include the
  coordinator, spawn policy never does — closed by `c4087c2`.
- **`R1-A16-03`** — no producer ever surfaces a pending result to #results; the accept
  path has nothing to accept — closed by `15c1779`.
- **`R1-A16-06`** — Discord root tasks are opened durably inside the admission predicate
  and never closed — on success or denial — closed by `f8ecbd5`.
- **`R2-B04-01`** — packaging cannot express the runtime dependency set, so A02-01's own
  acceptance criterion is unreachable — closed by `bcd1013`.
- **`R6-V05-04`** — this is the single outcome the owner was promised for Cluster D —
  closed by `4d41fde`.
- **`R1-A01-03`** — platforms/knowledge-platform/ names a fourth module that no
  canonical architecture doc owns — closed by `0449fed`.
- **`R1-A04-04`** — silent data_plant stack defaults substitute for a denial in four
  places — closed by `15c1779`.
- **`R1-A09-04`** — the announce approval card publishes model-authored prose, twice,
  unsanitised and silently truncated — closed by `5309439`.
- **`R2-B08-05`** — the runtime-backup plugin enumerator hard-fails --apply on any
  plugin-tree content it has never seen — closed by `d9bbae2`.
- **`R5-E12-06`** — no attributable writer discipline for the only finding register, no
  serialization (see R5-E12-03), and a "must" any agent can satisfy by declining to
  write — closed by `0449fed`.
- **`R1-A01-04`** — empty untracked models/ and shared/ are ownerless legacy scaffolding
  duplicating Zink Tools — closed by `d78c6de`.
- **`R2-B08-03`** — restoreT1RuntimeFiles never installs the preimages it captured — it
  only quarantines current content — closed by `6138c9e`.
- **`R2-B16-02`** — only 3 of 35 governed paths carry any live-reachability assertion
  (R13 P1, R13 P2, R7 P1) — closed by `770a097`.
- **`R5-E12-01`** — AGENTS.md §11 forbids committing implementation until the
  review-convergence and Final Quality Gate are PASS — and neither token has ever been
  recorded in any tracked artifact — closed by `0449fed`.
- **`R6-A03-01`** — the queue manager's durable writer does not lock itself, and one
  shipped caller relies on it — closed by `eb110cb`.
- **`R1-A15-06`** — PLAN.md cites 18 sections of a file that is Git-ignored and deleted
  at closeout, so durable evidence is unrecoverable — closed by `0449fed`.
- **`R5-E12-05`** — AGENTS.md §5 routes architecture/ownership/overengineering review to
  this artifact, which states expired milestone facts and gives nothing executable —
  closed by `db63c88`.
- **`R5-E12-07`** — the "no extra state files" rule is unverifiable as written (a set of
  three described as four), and a retired artifact stays referenced as if live — closed
  by `0449fed`.
- **`R1-A07-02`** — approval_thread_id is set once and never cleared — no re-drive after
  a failed component delivery, and none after REQUEST_REVISION — closed by `43999a7`.
- **`R1-A09-06`** — Discord native adapter sends are unbounded — REST got deadlines, the
  announce seam did not — closed by `bcd1013`.
- **`R2-B07-01`** — every runtime backup and native-patch manifest stamps a frozen
  governance_version literal that no longer exists, and validation demands that same
  literal — closed by `fda385b`.
- **`R5-E09-06`** — a permanently red gate cannot say "and this branch added one" — it
  returns the same word for the recorded 5-high baseline as for a new high-severity
  dependency — closed by `7725107`.
- **`R1-A02-06`** — the packaging whitelist and its rewrite engine have no completeness
  gate; the deployed entrypoint's module graph is never imported by any test — closed by
  `759a038`.
- **`R1-A05-04`** — the MemoryMax ceiling is asserted against one filename; any sibling
  drop-in overrides it and no gate notices — closed by `f210a1f`.
- **`R1-A05-06`** — Windows and WSL entrypoints disagree on permission assertions and on
  which state tree they inspect — closed by `3defcde`.
- **`R1-A12-02`** — a "test that cannot fail on Windows": the platform guard returns
  from the test body instead of skipping — closed by `5587bae`.
- **`R1-A13-07`** — deferred/OPEN historical defects are still present at HEAD, and the
  R16 rehearsal gate is permanently self-skipping — closed by `f04c32e`.
- **`R2-B03-03`** — the probe's failure classifier cannot attribute a state/assertion
  failure — closed by `0a5a6c2`.
- **`R5-E10-08`** — a comment reword, an import-line edit, or a units rename turns
  suites red while nothing behavioural changed — and the converse is worse: a code
  change can keep the comment, drop the enforcement, and stay green. The real guarantee
  ("the… — closed by `41d7dbf`.
- **`R5-E14-02`** — undetected drift, plus a false premise for later lanes — six tracked
  executables read like supported probes but can never fail in CI — closed by `3defcde`.
- **`R7-D4-04`** — `workflow-policy.json` and `role-capability-manifest.json` are read
  by no runtime code; every governed value exists as a duplicate literal — closed by
  `a328342`.
- **`R7-D3-01`** — the operator backup never dumps the Knowledge database while the
  runbook advertises a PostgreSQL backup — closed by `d211dd4`.
- **`R7-D3-02`** — `compose.m4-t5.live.yml` carries the only writable host bind and the
  live privilege block, and no gate parses it — closed by `51cf325`.
- **`R7-D7-01`** — `infrastructure/networking/networks.yml` is a placeholder whose own
  premise is already false and which nothing reads — closed by `7725107`.
- **`R7-D8-01`** — the live tool-call branch is selected by model-supplied parameter
  shape, and for `zink_excel`/`zink_power_bi` it never consumes the approval those
  operations require — closed by `accdef5`.
- **`R7-D8-02`** — no production code ever mints a tool-invocation approval record, so
  `bindInvocationApproval` is an inert control that only tests can satisfy — closed by
  `1b111cd`.
- **`R7-D11B-06`** — three canonical contracts are hash-pinned but never applied, and a
  contract edit reports no version change — closed by `f8ecbd5`.
- **`R7-D12B-01`** — a stale git worktree inside `scratch/` carries its own AGENTS.md
  and PLAN.md that assert owner-level authority, and every gate excludes it — closed by
  `7725107`.
- **`R7-D12B-02`** — no tracked lane parses `compose.m4-t5.live.yml`; the operator
  script that hands it to Docker is its only reader — closed by `957199d`.
- **`R7-D13-01`** — the n8n Postgres role password is passed on the `psql` command line,
  where it is visible in the process list — closed by `c629945`.
- **`R7-D13-02`** — the backup manifest asserts `secrets_included = $false` as a
  constant over an archive it never inspects — closed by `4307f19`.
- **`R7-D13-03`** — preflight validates an embedding model variable that no runtime
  component consumes — closed by `9f476d0`.
- **`R7-D13-04`** — the memory acceptance gate compares against a hardcoded 80% of 4 GiB
  without reading the container's real ceiling — closed by `0e20e6f`.
- **`R7-D13-05`** — the live acceptance restore container escapes the label sweeper and
  its removal exit code is unchecked, so a leak still reports PASS — closed by
  `4ec16cb`.
- **`R7-D12A-01`** — repository policy hardcodes that the pdf-runtime suite stays NOT
  RUN inside the only Python job CI admits, so F-237's fix needs a new job rather than a
  step — closed by _(accepted cost — no code change)_.
- **`R7-C1-01`** — the approval scope digest for `zink_power_bi bind` is derived from
  input keys its own closed contract forbids, so the approved datasource is not bound —
  closed by `9009dc4`.
- **`R7-C1-04`** — the call and result envelopes admit only five of the eight
  contract-registered tools, and their specialist rules disagree with each other —
  closed by `6756e2c`.
- **`R7-C3-01`** — the PDF extraction path reports success without reading the
  conversion result's status or proving that every requested page contributed content —
  closed by `21cc532`.
- **`R7-C3-03`** — the child's worst-case OCR budget is twelve times the parent's
  operation ceiling and the request schema carries no deadline, so the only real bound
  is a process-group kill — closed by `21cc532`.
- **`R7-C3-04`** — the child's only OCR runner test replaces the subprocess and the
  output reader, so the deadline, the output cap and the child reaping are asserted by
  nothing — closed by `21cc532`.
- **`R7-C4-02`** — the acceptance helper treats any nonzero exit as proof that the
  database rejected the statement, so the one-ACTIVE-index invariant can go unexercised
  while the lane prints passed — closed by `88cdf31`.
- **`R7-C4-03`** — the acceptance script fixes its compose project name and its fixture
  identifiers and resets nothing at entry, so a second run fails with an unrelated error
  and two overlapping runs destroy each other's database — closed by `990f2bc`.
- **`R7-C4-04`** — acceptance finalisation throws from inside the finally block in four
  drivers, so a cleanup failure replaces the real defect, and the two t5 drivers drop
  the resource-leak error whenever the body already failed — closed by `13c9e33`.
- **`R7-C4-05`** — the acceptance driver resolves the repository through git calls with
  no working-directory argument, so its attestation can describe a different tree than
  the files it packaged — closed by `6ad2310`.
- **`R7-C5-03`** — the ingress-registry eviction test compares an empty record against
  the shape an absent record also produces, so presence and eviction are
  indistinguishable — closed by `bff1967`.
- **`R7-C5-04`** — the durability gate is a text search after the only rename in each
  file, so any of the four writers can retarget its directory fsync onto the
  already-durable file handle and stay green — closed by `2718aa1`.
- **`R7-C5B-A`** — the lane that names the retry rule never attempts a retry, so
  widening the transient-failure class in production leaves it green — closed by
  `e99dbcb`.
- **`R7-C6-02`** — the preview renderer's table inputs have no producer, so every
  generated image is the placeholder layout while the plan data that would fill it is in
  scope — closed by `b3fa7e6`.
- **`R7-C6-06`** — the preview rasteriser performs no redaction of its own, unlike every
  other Discord-visible surface — closed by `255bb3c`.
- **`R7-E1-04`** — the reranker validates a graph contract the exporter wrote about
  itself, and the measured evidence that could contradict it is not shipped or loadable
  — closed by `77a34ca`.
- **`R7-E3-03`** — the migration-digest guard reconciles only manifest-to-disk, and its
  own fixture test mandates the blind direction — closed by `69bc955`.
- **`R7-E3-06`** — a file-wide occurrence count is asserted as per-list membership, with
  a failure message describing a condition the assertion cannot evaluate — closed by
  `f115d4b`.
- **`R7-E5-04`** — the byte-identical acceptance pair is pinned only against each other,
  and one driver pins the embedding model while the other inherits the operator's —
  closed by `068e41a`.
- **`R7-OA-02`** — the secret-scan allowlist suppresses 150 tracked paths by an
  unanchored regex and no policy check reads it — closed by `189e906`.
- **`R7-OA-04`** — the T5 acceptance nginx overlay defines the same location as
  `default.conf` without its three proxy timeouts — closed by `a28bfba`.
- **`R7-OB-01`** — the `work \| research` task mode has a normative architecture
  document, a cross-reference, and no implementation — closed by `0449fed`.
- **`R7-OB-02`** — nine legacy ids cited by archived execution contracts resolve to no
  register row — closed by `ec8dac2`.
- **`R7-OC1-01`** — the routed closeout procedure deletes `ACTIVE.md` while the protocol
  it defers to forbids deleting before archiving — closed by `5c3954d`.
- **`R7-OC1-02`** — the routed validation procedure demands "every required gate" while
  naming none, and the gate registry is unreachable from the authority chain — closed by
  `0449fed`.
- **`R7-OC1-03`** — PLAN uses a `Task Status` value its own §2 vocabulary does not admit
  — closed by `0449fed`.
- **`R7-OC1-04`** — the Active Task block carries two task identities and two
  `Task Status` lines, so the authorization check has no single answer — closed by
  `0449fed`.
- **`R7-OC1-05`** — the release-gate table has no M9 row although M9 owns a tracked
  suite, and its rows are out of milestone order — closed by `0449fed`.
- **`R7-OC1-06`** — the bootstrap order tells every agent to read a "nearest nested
  `AGENTS.md`" that the repository has never contained — closed by `6701075`.
- **`R7-OC1-07`** — the Owner Decision Protocol exists in full in two skills and one has
  already drifted from the other — closed by `0449fed`.
- **`R7-OC1-08`** — the six routed `SKILL.md` files and the state protocol live outside
  every enforced lane — closed by `20373dc`.
- **`R7-OC2-01`** — the operator-facing Vault rule documents three topic tags, none of
  which the ingest path accepts — closed by `b012b7c`.
- **`R7-X1-01`** — the published module inventory names no owner for the 68 tracked
  files that hold workflow state — closed by `0449fed`.
- **`R7-IG-01`** — two ignored state files contradict the owner's recorded deployment
  and disposition decisions, and the bootstrap order puts them on the read path — closed
  by `0449fed`.
- **`R7-IG-02`** — a tracked archive orders re-application of three held diffs whose
  content is already in the tree — closed by `0449fed`.
- **`R7-IG-03`** — 25 tracked lines still cite `.agents/states/findings.md`, a path that
  no longer exists and is Git-ignored — closed by `0449fed`.
- **`R7-IG-05`** — three PostgreSQL archives sit under `backups/knowledge-t5/` with no
  tracked producer, one of them empty — closed by `613c1e5`.
- **`R7-IG-06`** — `backups/` holds the audit record's snapshots and database dumps with
  no tracked owner, retention rule, or ignore coverage for nested paths — closed by
  `613c1e5`.
- **`R7-IG-07`** — the audit record is recoverable only from the unowned ignored
  snapshot directory for everything before 2026-10-17T22:57 — closed by `613c1e5`.
- **`R7-IG-08`** — four of six state files carry none of the six required freshness
  keys, so the documented resume check cannot run and closeout never deleted them —
  closed by `0449fed`.
- **`R8-M1-01`** — the runtime the gateway loads is six days behind HEAD and no lane
  compares them, so the state-root guard closed in the repo is absent from the tree that
  still mints nested ledger roots — closed by `d9bbae2`.
- **`R8-M1-02`** — two quarantined copies of the governance plugin stay inside the live
  discovery path carrying the same manifest id, so the correct governed code survives
  only by config precedence — closed by `6138c9e`.
- **`— (new in M12/T9; no legacy id)`** — the canonical delegation id is a 64-hex digest
  while the published envelope and the guard both require a UUIDv4, so every delegated
  tool call is refused with AUTH_DELEGATION_NOT_FOUND before it can reach a specialist —
  closed by `bcd1013`.
- **`— (new in M12/T9; no legacy id)`** — `applications/` is a third untracked,
  ownerless top-level tree — two empty directories that no canonical document names and
  no tracked file occupies — closed by `ed069a3`.

#### the owner's sixteen rulings (2026-10-21) (16 rows)

- **`R1-A06-02`** — primary_coordinator is a phantom ledger field, so the live pickup
  loop can never claim anything — closed by `273522a`.
- **`R1-A01-02`** — the governance plugin mutates the Skill Store canonical store and
  vector index through direct src/ imports, bypassing the Zink Tools boundary — closed
  by `021403e`.
- **`R6-A05-01`** — a valid skillsRoot that points at a different empty store still
  tombstones the intended store — closed by `38ba2c2`.
- **`R1-A07-03`** — STATUS: EXPIRED is not producible for a workflow approval; an
  unanswered approval never expires — closed by `9935149`.
- **`R5-E05-01`** — cost grows with total catalog × every promotion (index.mjs:1158-1162
  runs the FULL sync per approved skill) — closed by _(accepted cost — no code change)_.
- **`R5-E16-05`** — cost scales with total accumulated knowledge history rather than the
  incremental batch — a growing publish/verify stall — closed by
  _(accepted cost — no code change)_.
- **`R5-E03-06`** — every tag-filtered or PDF/MARKDOWN-mixed search heap-filters the
  entire index's segments — closed by _(accepted cost — no code change)_.
- **`R7-C4-01`** — the acceptance overlay proves egress isolation on a topology the
  deployed stack does not implement, so its boundary evidence transfers to nothing that
  ships — closed by `0d14a07`.
- **`R5-E13-04`** — third-party Discord identities accumulate verbatim in durable,
  long-lived events and prompt transcripts, which §10 treats as content that must not be
  exposed — closed by `6311298`.
- **`R1-A08-06`** — lock-hold time grows linearly with the ledger, which worsens the
  FILE_LOCK_BUSY / orphan-lock class (known item) and gateway latency — closed by
  `bd1398c`.
- **`R7-D11B-01`** — `task.accepted_reference_digests` is declared and read but has no
  writer, so any delegation carrying `input_refs` is refused forever — closed by
  `f2f4d15`.
- **`R7-D11B-03`** — the verdict binds `result_id` against a field the contract forbids,
  so id-only verdicts always fail — closed by `093439f`.
- **`R1-A01-01`** — integrations/openclaw/orchestration/patterns re-creates the retired
  L&SC Data Plant and a second orchestrator — closed by `b18d6f0`.
- **`R1-A08-05`** — any future maintenance operation on the journal can irreversibly
  corrupt or mis-derive the governance history — closed by `dd4dc29`.
- **`R7-OA-01`** — the same `uv` is pinned at three places with two different versions,
  and no lane ever compares them — closed by `0d79cf4`.
- **`R7-OA-03`** — `pdf-runtime/requirements.txt` is a hash-pinned pip artifact that
  cannot install two of its own pins — closed by `db7773a`.

## Changelog Rules

### Completed Changes Only

An entry may be added only after the corresponding task reaches its Definition of Done in `PLAN.md`.

Do not record:

- planned work;
- work in progress;
- blocked work;
- placeholders;
- empty directories;
- unverified code;
- speculative architecture;
- future milestones.

### Categories

Use the following categories:

- `Added` — new validated functionality.
- `Changed` — validated changes to existing functionality.
- `Fixed` — validated bug fixes.
- `Security` — validated security improvements or fixes.

### Source of Truth

`PLAN.md` is the authoritative source for:

- current progress;
- Active Task;
- milestone status;
- component status;
- dependencies;
- completion evidence.

`CHANGELOG.md` is only the historical record of changes that have already been completed and validated.

Do not use this file to determine what should be implemented next.

### Evidence

Every changelog entry must correspond to verified repository state.

A file, directory, configuration declaration, placeholder, or documentation entry does not by itself prove that functionality is implemented.

Validation evidence is maintained in `PLAN.md`.

### Update Timing

When a task reaches Definition of Done:

1. update `PLAN.md`;
2. record the completion evidence;
3. add the corresponding changelog entry;
4. keep these changes in the same change set whenever practical.

Do not add a changelog entry before validation is complete.

This file records material architectural changes rather than individual commits.
