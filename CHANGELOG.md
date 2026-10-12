# Changelog

All notable, validated changes to Personal Tool are documented here.

`CHANGELOG.md` records completed work only. It is not a roadmap, task list, development status, or architecture proposal.

## [Unreleased]

### Added

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

---

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
