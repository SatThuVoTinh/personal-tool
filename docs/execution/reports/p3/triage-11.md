# Phase 3 triage report — triage-11 (loop 1)

- **Bucket:** F-OC-011, F-DB-001
- **Baseline:** dispatch tree reported at HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, dirty before dispatch
  (`docs/execution/context.md:21`). Review was read-only against the working tree.
- **Constraint:** `git status` / `git diff` were permission-denied for this lane
  (`permission.rejected — shell`), so every locator was re-read from the files themselves;
  nothing here can be attributed to committed HEAD versus pre-existing dirty edits, and no
  test or archive probe was executed.
- **Verdicts:** CONFIRMED 1 · CONFIRMED-AS-LATENT 1 · REJECTED 0 · BLOCKED 0.
- **Severity counts:** root-cause 0 · high 0 · medium 1 (`F-DB-001`) · low 1 (`F-OC-011`).
- **RED:** both rows are RED, for different reasons (published contract semantics /
  persistence-recovery gate).
- **Blockers for the lead:** (B1) `F-OC-011` needs the owner to state the intended public
  execution mode of `zink_excel` before any text or runtime change; (B2) `F-DB-001` needs a
  disposable archive-injection harness that the current driver does not offer, so its
  acceptance probe cannot be run as the register words it.

---

## F-OC-011 — the published Excel semantic contract states the engine is unimplemented while the hosted runtime writes real workbooks

- **Verdict:** CONFIRMED — but **overstated as a runtime integration violation**; the real
  defect is an ambiguous published contract, not a failing dispatch.
- **Type:** F4 — Integration & Contract Violations (`docs/execution/findings.md:51-66`).
- **Severity:** Low — degraded/conditional: misleads a reader of the Tools contract; no
  runtime failure and no security or data consequence follows from it alone.
- **root_cause_of:** none. **depends_on:** none (F-OC-010 is adjacent surface, different
  mechanism).
- **red:** YES — the fix decides what the public contract of `zink_excel` promises
  (`AGENTS.md` §7: public API / compatibility guarantee). Recording the ambiguity is not the
  owner decision; choosing the semantics is.
- **Status proposed:** `LATENT` (contract-text defect proven statically, no live failure).
- **Fixer:** `fix-tools`. **Files the fix would touch:** `zink-tools/excel/contract.md`,
  `zink-tools/README.md`, plus a consistency assertion in
  `tests/m7-t3-tools-contract.test.mjs`. Changing guard/plugin dispatch instead would move
  this to `fix-openclaw-governance-library` / `fix-openclaw-governance-plugin` and is not
  supported by the evidence.

### Why the runtime-violation reading is refuted

The contract sentence is scoped, not universal: `zink-tools/excel/contract.md:24` says
"**Under Model A (Contract Tool Interface)**, invocation returns deterministic
`ENGINE_NOT_IMPLEMENTED` via the contract seam". That seam exists and behaves exactly as
described:

- `integrations/openclaw/lib/policy.mjs:2498-2504` — `CALLABLE_DISPATCH_REGISTRY` maps
  `zink_excel` to `"contract_seam"`.
- `integrations/openclaw/topology/lib/guard.mjs:2230-2242` — the dispatch arm runs
  `contractOnlySeam(...)` when `target === "contract_seam"`.
- `integrations/openclaw/topology/lib/guard.mjs:621-634` — `makeEngineNotImplementedResult`
  emits `status:"error"` / `error.code:"ENGINE_NOT_IMPLEMENTED"`, "Contract seam invoked;
  engine execution unavailable."
- `tests/m7-t3-tools-contract.test.mjs:922-956` (AC 27) asserts a governed `zink_excel.load`
  guard call returns `ENGINE_NOT_IMPLEMENTED`, and `:973-984` (AC 29) pins the seam 4-tuple.
  So the seam contract is a pinned, passing behavior — not drift.

The hosted native path is deliberately a **second, different** path, and the plugin says so
in its own comment at the branch:

- `integrations/openclaw/plugins/zink-governance/index.mjs:8362-8393` — the plugin calls
  `guard.beforeToolCall`, and at `:8377-8379`: "The other governed tools execute in this
  plugin's own registered tool, so the guard's CONTRACT-SEAM result is not the tool's
  outcome: what matters here is that the guard AUTHORIZED the call." It then returns
  `{ allow: true }`.
- `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4871` — the registered tool
  resolves the writer and calls `executeExcelOperation(params, sandboxDir)`; the
  `ENGINE_NOT_IMPLEMENTED` object at `:4873-4887` is only the missing-module fallback, and
  `:4849-4861` returns `BLOCKED / SANDBOX_UNAVAILABLE` when no sandbox exists.
- `integrations/openclaw/lib/excel-writer.mjs:841-852` — writes the workbook, SVG and PNG
  previews. Containment is enforced before the write at `:660-674`.

Therefore "the hosted runtime executes what the contract calls unimplemented" is a false
description of a two-layer design (guard authorization seam + hosted native execution). No
caller receives a wrong result from this pair, and no integration actually breaks.

### What remains true (why the row is not REJECTED)

The three published descriptions are mutually irreconcilable for a reader who cannot see the
two-layer design, and one of them is the registry's own named contract:

- `zink-tools/excel/contract.md:5-9` claims to "define the semantic boundary for the
  `zink_excel` tool interface" and names `integrations/openclaw/lib/policy.mjs` as the
  canonical registry; `:24` then promises `ENGINE_NOT_IMPLEMENTED`.
- `integrations/openclaw/lib/policy.mjs:2392-2402` registers `zink_excel` with
  `status:"callable_interface"`, `executionMode:"contract_interface"` and
  `contractPath:"zink-tools/excel/contract.md"` — i.e. the registry links the sentence that
  denies the engine, and the registry *itself* carries no statement that execution happens
  in the hosted plugin.
- `zink-tools/README.md:8` says `zink_excel` is "**Thật, một engine duy nhất**" pointing at
  `integrations/openclaw/lib/excel-writer.mjs`, while `:27` labels the same tool's execution
  mode `contract_interface` and links the same `excel/contract.md`.
- `docs/architecture/zink-tools-boundaries.md:61-64` describes Excel as loading, populating
  and validating templates — a third phrasing, again with no seam/native distinction.

`AGENTS.md:22/§2.5` makes `docs/contracts/` the durable behavior source, and this file is
named by production policy code, so it is not free-standing prose: it is a published contract
surface whose text cannot be corrected unilaterally without choosing which of the two modes
is the contract. `zink-tools/README.md:11-12` also shows the vocabulary is meaningful —
`zink_power_bi` and `zink_python` are declared genuinely unimplemented — so an agent that
reads `ENGINE_NOT_IMPLEMENTED` for Excel reasonably concludes Excel is not implemented. The
register's own instruction at `docs/execution/findings.md:2278` ("do not resolve by making
the hosted writer return `ENGINE_NOT_IMPLEMENTED`") is correct and should be carried into any
band that fixes this.

**Acceptance shape (refined):** one authoritative statement of how `zink_excel` executes
(guard seam authorizes, hosted plugin executes the workbook writer, seam
`ENGINE_NOT_IMPLEMENTED` is an authorization-layer result and not the tool outcome), repeated
consistently in `zink-tools/excel/contract.md`, `zink-tools/README.md`,
`integrations/openclaw/lib/policy.mjs` and `docs/architecture/zink-tools-boundaries.md`, plus
a check that fails when the texts diverge. No behavior change is licensed by this row.

---

## F-DB-001 — the Knowledge restore gate can certify a database archive without any segment table data

- **Verdict:** CONFIRMED-AS-LATENT — the verifier hole is proven statically; the end-to-end
  certification requires an archive the driver itself never produces, so it is not a live
  failure.
- **Type:** F5 — Data Integrity & Result Correctness.
- **Severity:** Medium — conditional. Root cause is not shared with another row; the
  consequence (retrieval data silently lost behind a `restore_verified = true` claim) would be
  high *if* a partial archive ever reached the verifier.
- **root_cause_of:** none. **depends_on:** none. Not a duplicate of F-558.
- **red:** YES — narrowing or widening this gate changes persistence/recovery semantics and a
  required acceptance gate (`AGENTS.md` §7; the T5 evidence is accepted candidate evidence).
- **Status proposed:** `LATENT`.
- **Fixer:** `fix-infrastructure`. **Files the fix would touch:**
  `infrastructure/docker/scripts/knowledge-t5-live.ps1` (lines `:288-289`, `:330-332`,
  `:362-364`) and `tests/m3-t5-contract.test.mjs`; optionally a new isolated archive probe.
  Knowledge data ownership (`docs/architecture/platform-boundaries.md:3-7`) must not move, and
  the drill must stay scoped to the `knowledge` schema — it must not start verifying
  `skills.*`.

### Locator re-read (all four hold at the dispatch tree)

1. `knowledge-t5-live.ps1:284` — the archive is created internally: `pg_dump --format=custom
   --no-owner --no-acl --schema=knowledge --snapshot=...`.
2. `:286-287` — `pg_restore --list` inventory must be readable and non-empty.
3. `:288-289` — for each of `schema_migrations, indexes, index_runs, sources, source_sidecars,
   segments` the predicate is `$_ -match "TABLE( DATA)? knowledge $required( |$)"`. The
   optional `( DATA)?` group is the hole: a `TABLE knowledge segments` TOC line alone satisfies
   the `segments` requirement. The same weak predicate repeats for the M4 objects at `:291-295`.
4. `:296-299` — expected-table comparison is against `information_schema.tables` on the live
   snapshot: table *presence*, not content.
5. `:330-332` — `$criticalTables = @("indexes","index_runs","sources","source_sidecars")` plus
   the five PDF tables when `002_pdf_ingestion_foundation.sql` is in the ledger. **`segments` is
   absent.** `Get-MetadataDigestSql` at `:154-159` builds `string_agg(to_jsonb(row_value)::text)`
   per listed table only, so a table not in the list contributes nothing to the digest.
6. `:356-372` — post-restore comparisons are structural catalog fingerprint, migration ledger,
   ACTIVE index ids, the `$criticalTables` metadata digest (`:362-364`), sequences/identity,
   database compatibility and extensions. None of these observes segment rows, segment text,
   embeddings, or `search_vector`.
7. `:394-396` — the manifest is written with `result = "PASS"` and
   `$evidence.recovery_point = ... restore_verified = $true`.

So a schema-intact archive whose `knowledge.segments` rows are absent satisfies every gate in
this function and publishes a positive recovery certification. `contracts`-level importance is
real: `apps/knowledge/migrations/001_initial.sql:98-141` shows `knowledge.segments` carries
`text`, `embedding vector(1024)`, `search_vector`, and the FKs to `indexes`, `sources` and
`index_runs`, with the HNSW/GIN/filter indexes at `:143-150`. Emptying it silently destroys the
retrieval corpus while the four digested tables still look healthy.

### What a real archive probe would have to show

The register's reproduction as written ("then run the verifier") is **not executable against
this driver**, because the driver dumps the live database itself at `:284` and offers no
archive injection point; the caller-supplied-archive premise belongs to `backup.ps1`, not here.
A valid probe must establish all of the following, in a disposable target only:

1. Seed `knowledge.segments` with at least one row whose FKs to `indexes`/`sources`/`index_runs`
   are satisfied, and record its pre-dump row count and content digest.
2. Produce a custom-format archive of the `knowledge` schema using
   `pg_dump --exclude-table-data=knowledge.segments` (definition retained, data excluded).
3. Show `pg_restore --list` of that archive contains `TABLE knowledge segments` and contains **no**
   `TABLE DATA knowledge segments` entry — i.e. the `:288-289` predicate is genuinely satisfied
   by the definition alone.
4. Run the verifier's checks (`:288-299` presence, `:330-333` snapshot digest, `:354-372`
   restore + comparisons) against that archive into a disposable container, without touching
   live state.
5. Observe the outcome. The latent claim is proven if and only if the checks pass while
   `SELECT count(*) FROM knowledge.segments` on the restored database is `0`; the row would be
   REFUTED if any earlier check throws first.
6. A red-then-green regression: with the fix, the same archive must fail the gate, and a
   complete archive must still pass. Mutation-probe the new control specifically (removing
   `segments` from the data set must turn the test red again), per
   `docs/execution/findings.md:32-34` item 5.

Steps 1-6 were **NOT RUN** here (read-only lane, no PostgreSQL/WSL host, no shell permission).

### Additional risk the row understates

Because the *same* archive feeds the digest baseline at `:332` and the restore at `:362`, a
missing-data archive is self-consistent: the baseline digest already lacks segment rows, so
no comparison can ever notice. Any fix must therefore make the required-object check demand
`TABLE DATA` (not merely add `segments` to `$criticalTables`), and must state what zero source
segments means — on a genuinely empty knowledge base the gate should either report `N/A`
explicitly or prove non-emptiness from prior evidence, the way the sequence/identity gate already
does at `:388`. Silently passing an empty segment table in a fresh drill would be the same class
of false certification that `F-558` records elsewhere.

### Duplicate / adjacency check

- `F-558` (`docs/execution/findings.md:1773`) — generic `backup.ps1` /
  `backup-inspection.ps1` coerced-empty inventories and secret-inspection claims. Different
  script, different carrier, different failed control. Not a duplicate; shared theme only.
- `F-DB-002` — n8n encryption key outside the archive. Independent.
- `F-INFRA-004` (`docs/execution/findings.md:2306-2317`) — the T5 drivers hardcode the 001/002
  migration set. This is a **sequencing hazard, not a duplicate**: that row decides whether
  `Assert-BackupAndRestore` ever runs, so a band that fixes F-DB-001 while F-INFRA-004 still
  rejects the shipped migration set will not be able to exercise the new segment check
  end-to-end. Recommend the lead treat F-INFRA-004 as a soft ordering dependency for the probe,
  even though F-DB-001's static fix stands alone.
- Phase 2 lanes agree: `xcheck-db-all.md:25-37` (static only, injection not run),
  `xcheck-infra-kb.md:91-100` (needs an explicit test seam), `xcheck-tests-all.md:244-253`
  (no test asserts a `segments` data requirement), `xcheck-infra-skill-tools.md:35`
  (Knowledge-only; must not be widened to `skills.*`).

---

## Gaps in the register rows themselves (for the lead's consolidation pass)

- `F-OC-011` Evidence `docs/execution/findings.md:2275` cites `guard.mjs:2230-2242` correctly
  but omits that the plugin comment at `index.mjs:8377-8379` already documents the seam/native
  split, and it omits `policy.mjs:2398` as the link that makes `contract.md` a published
  contract surface. Suggested severity stays Low; suggested status should become `LATENT`, not
  `HYPOTHESIS`, and the finding text should be narrowed from "contract states the engine is
  unimplemented" to "contract does not state *which* layer's result `ENGINE_NOT_IMPLEMENTED`
  is".
- `F-DB-001` Reproduction `docs/execution/findings.md:2289` says "then run the verifier"
  against a `pg_dump --exclude-table-data` archive. As shown above the driver generates its own
  dump and has no injection seam; that wording cannot be executed as written and should be
  replaced by the 6-step probe. Evidence locators `:288-289`, `:330-332`, `:362-364`, `:396`
  all verified accurate; `:154-159` (`Get-MetadataDigestSql`) should be added because it is the
  reason `$criticalTables` membership is the whole content guarantee.

## Checks run

- Read: `AGENTS.md` (root; only `AGENTS.md` exists repo-wide per glob),
  `docs/execution/context.md`, `docs/execution/findings.md` §0 rules and both rows,
  `docs/execution/slices.md`.
- Re-read locators: `zink-tools/excel/contract.md`, `zink-tools/README.md`,
  `integrations/openclaw/lib/policy.mjs`, `integrations/openclaw/topology/lib/guard.mjs`,
  `integrations/openclaw/plugins/zink-governance/index.mjs`,
  `integrations/openclaw/lib/excel-writer.mjs`, `tests/m7-t3-tools-contract.test.mjs`,
  `infrastructure/docker/scripts/knowledge-t5-live.ps1`,
  `apps/knowledge/migrations/001_initial.sql`, `tests/m3-t5-contract.test.mjs`,
  `docs/architecture/platform-boundaries.md`, `docs/architecture/zink-tools-boundaries.md`,
  `docs/runbooks/knowledge-platform.md`, Phase 1/2 reports for both rows.
- `git status --short` / `git diff`: **NOT RUN** (permission denied by this lane's permission
  set; recorded as a limitation, not as a pass).
- `npm run format:check` / `npm run lint` on this report: **NOT RUN** for the same reason. This
  file is inside the `docs/**/*.md` glob that `docs/execution/findings.md:8-9` says the
  markdownlint and prettier gates check; the lead should expect to format it during
  consolidation.
- Source files modified: **none**. Only this report was written.
