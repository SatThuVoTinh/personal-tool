# Phase 3 triage report — bucket 04 (loop 1)

- Agent: `triage-04` (phase 3, loop 1), READ-ONLY on source.
- Assigned rows: `F-KB-003` (`docs/execution/findings.md:2085-2096`), `F-KB-004` (`docs/execution/findings.md:2098-2109`).
- Audit target: dispatch working tree per `docs/execution/context.md:5,21` (HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, branch `codex/m11-t1-audit-remediation`, dirty baseline).
- Rules read: root `AGENTS.md` (no nested `AGENTS.md` exists — verified by glob, only the repository-root file), `docs/execution/findings.md` §0.1–§0.5, `docs/execution/context.md`, `docs/execution/slices.md` Phase 3 and §5 routing.
- Verdict vocabulary used: `CONFIRMED | CONFIRMED-AS-LATENT | REFUTED | OVERSTATED | UNDERSTATED | DUPLICATE-OF | WRONG-SITE | BLOCKED` (dispatch instruction).
- `type` taxonomy: `docs/execution/context.md` defines no type list, so the fallback vocabulary in the triage contract is used; the register `Category:` values in `docs/execution/findings.md` §0.4 are reported alongside.

## Verification limitations (recorded, not silently absorbed)

1. **`git status` / `git diff` were refused by my permissions** (three attempts, `permission.rejected`; a bare `"probe"` echo succeeded, so the refusal is scoped to Git access, not to shell generally). The dispatch instruction permits those commands; my delegated permission does not. Consequence: the HEAD-vs-working-tree attribution below is derived from converging documentary evidence, **not** from a direct diff. It is stated with its evidence so the lead can confirm it in one command.
2. No PostgreSQL, no HTTP request, no filesystem that preserves distinct NFC/NFD spellings was exercised. Every reproduction below is a static code trace. Per `docs/execution/findings.md` §0.2 step 2, none of these rows has a red test yet; a fix band may not start without building one.

---

## F-KB-003 — NFC normalization maps two distinct Markdown paths to one source key and deletes one document

**Verdict: CONFIRMED-AS-LATENT** (mechanism is code-proven **only inside the in-flight, uncommitted F-576 edit**; it is not live at the committed audit target `85eb094`, and its firing is filesystem-conditional).

- type: `data-integrity` · Category (§0.4): **F5 — Data Integrity & Result Correctness** (register row already correct; §0.7 rule "category by the nature of the defect, not the file" supports it).
- severity: **medium** — conditional, not a root cause. Nothing else in this bucket is a symptom of it.
- root_cause_of: none.
- depends_on: **F-576** (`docs/execution/findings.md:1903-1914`, `Status: OPEN`). F-576's chosen remedy determines whether this row is a code-only fix or a schema change.
- red: **NO** for the smallest sound fix (pre-publication collision refusal, Knowledge-local). **RED hazard recorded explicitly**: F-576's own acceptance criterion offers two branches (`findings.md:1913`) — "normalise `source_path` to NFC at ingest **and add a CHECK**, or drop the read-side normalisation". The first branch is a schema/migration semantics change (`AGENTS.md` §7 RED) and would make both F-576 and this row RED. Recommend the reject-before-publication branch, which satisfies this row's acceptance criterion without touching schema.

### Premise liveness: HEAD 85eb094 vs the dirty tree

This is the question the dispatch asked, and the answer is unambiguous in direction:

- `docs/execution/findings.md:1911` (F-576, **still OPEN**) measures at the committed baseline: `grep -rn "NFC|unicodedata" apps/knowledge/app/*.py` returns nine NFC sites, "**none on a stored source path**", and states "the stored column carries the writer's bytes with no normalisation constraint and no writer-side normalisation".
- The writer-side normalisation the finding depends on is therefore **not** in `85eb094`. `apps/knowledge/app/database.py:32-41` defines `normalize_source_path()` with the inline note "F-576 (R10-T10-7): … **Writers now store NFC**, and the SQL comparisons below …" — the present tense of an unfinished band.
- `apps/knowledge/app/index_lifecycle.py:206-223` carries the matching "F-576 (R10-T10-7)" comment and is the only place the manifest/stale-key normalisation exists.
- The only committed-looking test for this behaviour, `apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py`, is **untracked** (dispatch brief, confirmed present on disk by glob; it contains no two-file collision case). `grep normalize_source_path apps/knowledge/tests` returns **no matches in any tracked test** — the whole F-576 write-form assertion set exists only in that untracked file.
- `CHANGELOG.md` contains **no** `F-576` / `R10-T10-7` closure entry (grep: 0 hits), so under `findings.md` §0.5 the fix is neither closed nor history-eligible.

Conclusion: the collision premise is **not live at the committed audit target**. It is live in the working tree because the working tree contains someone's in-flight F-576 fix, and that fix *creates* the collision it does not guard. The audit target for Phases 1–4 is the dirty working tree (`context.md:5`), so the mechanism is correctly reported — but it must be dispositioned as a **defect in an unreviewed, uncommitted patch**, not as a pre-existing HEAD bug.

### Mechanism, re-traced independently at the working tree

Confirmed, and the guard that should have caught it is defeated by statement ordering:

1. `apps/knowledge/app/markdown_adapter.py:296-337` — `_discover_candidates` collects `Path(entry.path)` from `os.scandir` and derives `relative = path.relative_to(vault_root).as_posix()` (`:312,336`) with **no normalization**; `:368-374` `_validate_source` repeats it (`:372`). Two filesystems-preserving spellings therefore reach the writer as two distinct `source_path` strings.
2. `apps/knowledge/app/index_lifecycle.py:210-219` — the publish manifest is keyed by `normalize_source_path(source.source_path)`, so two canonically-equivalent names collapse into **one dict entry** (last writer wins) before anything is persisted. `:220-224` then compares digests by that collapsed key, and the stale set is derived from the same collapsed keys.
3. `apps/knowledge/app/database.py:1995` — `source_path = normalize_source_path(source.source_path)`; `:1999-2006` `DELETE FROM knowledge.sources WHERE index_id = $1 AND normalize(source_path, NFC) = $2` runs **before** `:2007-2024 INSERT`. The second source's DELETE therefore removes the first source's row, and segment loss follows the existing cascade (`CHANGELOG.md:2160` records that cascade for `knowledge.segments`).
4. `apps/knowledge/migrations/001_initial.sql:81` — `UNIQUE (index_id, source_path)` is the only would-be guard, and it cannot fire: the DELETE precedes the INSERT inside the same `_mutation_transaction` (`database.py:1997`). Net effect is a **silent** overwrite with no constraint violation, no error surfaced (`index_lifecycle.py:233-235` counts both as indexed) and a published `indexed` count that overstates retained sources.
5. Durability of the loss: `database.py:2207-2210` (`complete_incremental`) compares stale paths with `normalize(source_path, NFC) = ANY(...)`, so the deleted document is not re-materialised as stale either.

### Evidence-locator audit (register §0.2 step 1)

| Locator in `findings.md:2093` | Re-read result |
| --- | --- |
| `apps/knowledge/app/database.py:1995-2024` | **ACCURATE** — normalize at `:1995`, DELETE `:1999-2006`, INSERT `:2007-2024`. |
| `apps/knowledge/app/markdown_adapter.py:296-337,368-374` | **ACCURATE** — raw relative paths retained at `:312,336` and `:372`. |
| `apps/knowledge/migrations/001_initial.sql:81` | **ACCURATE** — `UNIQUE (index_id, source_path)`. |
| `test_m12_t9_r4_f576_source_path_form.py:127-157,292-371` | **LINE-ACCURATE BUT ILLEGIBLE AS REGISTER EVIDENCE** — the file is untracked. It is the only citation in either assigned row that is not a tracked artifact, which conflicts with the register's own coverage claim at `findings.md:98` ("mọi path đều là file được track hoặc artifact runtime được nêu tên"). Either commit the test in the same band as the fix or replace the citation with the tracked `index_lifecycle.py:210-223` / `database.py:1995-2024` pair. |
| Missing, should be added | `apps/knowledge/app/index_lifecycle.py:206-224` — the manifest collapse is a **second, earlier** manifestation of the same root cause and the cleanest place to detect the collision. |

**Falsification attempts, all failed to refute:** (a) "discovery deduplicates canonically-equivalent names" — `markdown_adapter.py` deduplicates only `_sort_and_deduplicate_errors` (`:279,978`) and tags (`:533,640`), never candidate paths; (b) "the unique index rejects it" — the DELETE at `:1999` precedes the INSERT, defeating it; (c) "`_has_link_component` refuses one spelling" — it refuses link/reparse components, not Unicode spellings (`:377-384`); (d) "the incremental skip hides it" — the skip compares the collapsed key (`index_lifecycle.py:221-224`), so it republishes and deletes rather than preserving.

### Impact and reachability

- Blast radius is Knowledgebase-local: `normalize_source_path` is module-local (`apps/knowledge/app/database.py:32`); `xcheck-tests-all` reached the same conclusion and adds the ownership constraint at `docs/execution/reports/p2/xcheck-tests-all.md:88` — do not touch Skill Store namespace/capability keys or shared-module ownership to solve this. `xcheck-infra-kb:18,107` confirms no Infrastructure or volume change is implicated (the Vault bind is read-only).
- Firing requires (i) the in-flight F-576 write normalization to be committed as currently written, and (ii) a real corpus containing two canonically-equivalent-but-distinct names (ext4/APFS preserve them; NTFS normalizes to NFC at the OS layer, so a Windows host cannot exhibit it). Two conditions, no live symptom → `medium`, `LATENT`, not high.
- Owner-visible effect if it fires: one valid human source silently disappears from retrieval and citation; `indexed` overstates retained sources. Derived-index data loss only — the read-only source Vault is never modified, so no backup/restore implication.

### fixer and files (for parallel-safe waves)

- fixer: **`fix-knowledgebase`** (`slices.md:57`, `apps/knowledge/**`).
- files a fix would touch:
  - `apps/knowledge/app/markdown_adapter.py` (`_discover_candidates`, detection at discovery) **and/or** `apps/knowledge/app/index_lifecycle.py:206-224` (collision refusal before publication),
  - `apps/knowledge/app/database.py` (`:1995-2024`, `:2093-2111`, `:2207-2210`) only if the guard is placed at the writer rather than at discovery,
  - `apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py` — extend to a two-file NFC/NFD collision case (and commit it), or add a new tracked test file in the same directory.
- write-ownership: disjoint from `F-KB-004`'s Tools files. **Overlap risk**: both rows touch `apps/knowledge/app/*` and the same Knowledge test directory while the uncommitted F-576 patch is still in flight in exactly those files. Do not schedule F-KB-003 and any F-576 fixer in the same wave against the same tree.

### Disposition recommendation to the lead

Re-status `HYPOTHESIS` → `LATENT` (register vocabulary `findings.md:49`: code-proven, not yet live-burning). Keep the row. It is **not** a duplicate of F-576 (F-576 is the one-path prefix false-negative; this is the two-path identity collision — agreed at `docs/execution/reports/p2/xcheck-kb-skill.md:66` and `xcheck-tests-all.md:276`) and it is **not** REFUTED. But it must be re-verified once more, and re-severitised, after the F-576 band lands, because its existence is contingent on how that band lands. If F-576 instead takes the "drop the read-side normalisation" branch, this row becomes REFUTED at that head with no fix required.

---

## F-KB-004 — citation and chunk API responses omit index status and stable chunk ordinal supplied by the database

**Verdict: CONFIRMED — a distinct new defect at the HTTP/contract serializer layer; simultaneously an incomplete *caller-visible* closure of F-573; explicitly NOT a duplicate of F-071.**

- type: `data-integrity` primary, with a **`contract-mismatch`** component (the consumer contract cannot represent the fields) and a **`test-gap`** component (the existing HTTP fixture makes endpoint coverage structurally incapable of catching a serializer regression).
- Category (§0.4): **F5 — Data Integrity & Result Correctness** (register correct; §0.4's own rule puts the schema-mapping half at F4 — the *nature* of the defect is un-deliverable provenance, so F5 stays primary).
- severity: **medium** — degraded/conditional. A citation resolves correctly and is not wrong; the consumer cannot tell whether it is live and cannot re-derive it after cleanup. No data loss, no host outage.
- root_cause_of: none in this bucket.
- depends_on: none for the Knowledge serializer half (it is independently fixable). The **end-to-end** acceptance in `findings.md:2108` depends on the RED owner decision for the Tools contract and on `F-KB-003` only in the sense of wave ordering, not correctness. Predecessors (not blockers, both closed): F-573, F-570, F-071.
- red: **YES.** Reasons, each tied to `AGENTS.md` §7:
  1. **Public API** — adding `index_status` / `chunk_ordinal` to `/v1/chunk` (`main.py:958-977`), `/v1/citation` (`:998-1026`) and `/v1/metadata` (`:1039-1068`) changes a published response contract; `xcheck-kb-skill.md:36` states the same.
  2. **Schema semantics** — `zink-tools/contracts/tools/zink-knowledge.schema.json` is a versioned closed contract (`x-zink-contract-version: "1.1.0"` at `:5`; `additionalProperties: false` on the root `:7`, on the output item `:118`, and on `metadata` `:114`). Declaring new members is a contract change, and its pinned-closure assertion is a gate (`tests/memory-tool-output-contracts.test.mjs:401-427`).
  3. **Topology / deployed-build admission** — the adapter is in `PACKAGED_RUNTIME_MODULES` (`integrations/openclaw/lib/policy.mjs:1767`) and is imported by the governance plugin (`plugins/zink-governance/index.mjs:758,771,780`), so editing it moves the packaged digest set `configure.mjs` admits (`configure.mjs:107-357`, "digests recorded from the live bytes, never hand-authored").
  4. **Ownership boundary** — one defect needs coordinated edits in two modules plus the OpenClaw hosting boundary. `AGENTS.md` §8 requires one integration owner for shared surfaces.
  - Smallest sound alternative to recommend to the owner: land the Knowledge serializer half first (additive, no consumer breaks because the adapter builds a **fresh** object at `knowledge-adapter.mjs:775-822` and cannot reject unknown upstream keys), then decide the Tools contract-version bump separately. Note plainly: the Knowledge half alone does **not** satisfy the row's acceptance criterion.

### Fix-site ownership (named as the dispatch required)

| Fix site | File:line | Owner / fixer |
| --- | --- | --- |
| Chunk serializer omits both fields | `apps/knowledge/app/main.py:958-977` | Knowledgebase — **`fix-knowledgebase`** |
| Citation serializer omits both fields | `apps/knowledge/app/main.py:998-1026` (and `citation_block` `:1016-1026`) | Knowledgebase — **`fix-knowledgebase`** |
| Metadata serializer omits both fields | `apps/knowledge/app/main.py:1039-1068` | Knowledgebase — **`fix-knowledgebase`** |
| Field source (already correct) | `apps/knowledge/app/database.py:1905,1913,1961-1967`; `SegmentRecord` `:290-317` (`index_status:316`, `chunk_ordinal:317`, both `| None` default) | Knowledgebase — **`fix-knowledgebase`** — no change needed; this is F-573's closed half |
| Surrogate-id non-durability | `apps/knowledge/app/database.py:2377-2414` (`DELETE FROM knowledge.sources` for `SUPERSEDED`), `:2591-2609` (`DELETE FROM knowledge.segments`) | Knowledgebase — **`fix-knowledgebase`** — correct behaviour, cited as impact evidence only |
| Adapter projection drops both, and drops top-level `index_id`/`indexed_by_run_id` | `zink-tools/adapters/knowledge/knowledge-adapter.mjs:405-419` (routing), `:716-822` (formatter) | Zink Tools — **`fix-tools`** |
| Closed output schema declares neither field | `zink-tools/contracts/tools/zink-knowledge.schema.json:85-119` (`metadata.additionalProperties:false` `:114`; item `additionalProperties:false` `:118`) | Zink Tools — **`fix-tools`** |
| Cross-module output-contract gate | `tests/memory-tool-output-contracts.test.mjs:144-427` | **`fix-tests`** (`slices.md:67`, `tests/**`), coordinated with `fix-tools` |
| KB endpoint coverage | `apps/knowledge/tests/test_b5_knowledge_http_surface.py:347-382` | **`fix-knowledgebase`** (`apps/knowledge/**` wins over `tests/**` for this path) |
| Packaged-asset admission / digests | `integrations/openclaw/lib/policy.mjs:1757-1774`; `integrations/openclaw/configure.mjs` digest table | **`fix-openclaw-governance-library`** (asks per edit) — `policy.mjs` is in `scan-oc-3` scope (`slices.md:22`), so this is not an unassigned `integrations/openclaw/` path |

Primary fixer: **`fix-knowledgebase`** (root-cause site). This row **cannot** be assigned to a single fixer; the lead must appoint one integration owner and sequence waves.

### The three-way question: distinct defect vs incomplete F-573 closure vs duplicate of F-071

Answer: **both a distinct new defect and an incomplete caller-visible closure of F-573; not a duplicate of F-071.** Measured evidence:

- **F-573 (`CHANGELOG.md:2160-2161`, closed by `d1d21a1`)** — its *code* half is genuinely present and correct (`database.py:1913` join, `:1961-1967` return, three tests in `apps/knowledge/tests/test_m12_t9_b5_db_retrieval.py:225-280`). But its closure sentence asserts the caller-facing effect: "**so a caller can tell a superseded-index hit from the live one and re-derive the segment** by (index, source digest, ordinal)". `get_segment` has exactly two consumers — `_read_segment` (`main.py:930-944`) and these three serializers — so the only "caller" F-573's sentence can mean is the HTTP client, and the HTTP client demonstrably never receives either value. So: F-573's *claim* is overstated; its *code* is not. Keep `F-KB-004` as its own live row (F-573 is closed and history-eligible under §0.5; re-opening a closed row whose named site is fixed would violate the permanent-id rule at `findings.md` §0.2 item 6), and record in the disposition that **F-573's closure narrative must be annotated** so no later band reads the caller-facing promise as delivered. That is exactly what `findings.md:2108` already demands ("F-573's disposition must be re-judged (widened or reopened)") — I confirm that requirement and specify the outcome: annotate-as-incomplete, do not reopen.
- **F-071 (`CHANGELOG.md:1461-1463`, legacy `R1-A16-07`, closed by `2f7bb8e`)** — "three advertised actions have no server route, and index identity is dropped". Both halves must be separated. The **routes** half is truly closed: `/v1/chunk` `:946`, `/v1/citation` `:986`, `/v1/metadata` `:1036` exist and emit top-level `index_id`/`indexed_by_run_id` (`:981-982`, `:1031-1032`, `:1072-1073`), and `knowledge-adapter.mjs:409-419` dispatches all three. The **dropped index identity** half is *not* closed at the consumer: a case-insensitive grep for `parsed.index_id` / `indexed_by_run_id` / `index_id` inside `knowledge-adapter.mjs` returns **no matches**, and the formatter receives only result rows (`:716-729`), so the endpoints' top-level attribution is structurally unreachable in the Tools envelope. Verdict: that residue is **F-071's own incomplete caller-visible closure, at a different seam (envelope mapping, not row liveness), and must not be folded into F-KB-004**. The register already says so at `findings.md:2108`, and `xcheck-kb-tools.md:19-20` reached the same split independently. I keep the split and recommend the lead file the F-071 residue as its own row rather than widening this one (widening would merge two root causes with two owners).
- **Duplicate of F-570?** No. F-570 (`findings.md` §Related; `main.py:970-975,1009-1014`; `knowledge-adapter.mjs:798-820`) delivered `source_id` / `source_sha256` / line-and-page span. Its field set contains none of F-573's status/ordinal, which is *why* the end-to-end path still loses them.

### Coverage finding (widening, not a new row)

The register states "no endpoint test asserts the two fields" (`findings.md:2107`). True, and **stronger than recorded**: `apps/knowledge/tests/test_b5_knowledge_http_surface.py:350-372` constructs the HTTP fake's `SegmentRecord` **without** `index_status` or `chunk_ordinal` — they fall through to the `| None` defaults at `database.py:316-317`. The fixture therefore cannot distinguish "serializer drops the field" from "serializer emits `null`", which is precisely the false-confidence pattern `PLAN.md §4.17` records as `R5-E10-08` ("assertions on prose, not behaviour"). Add to the row's evidence: `apps/knowledge/tests/test_b5_knowledge_http_surface.py:350-372` (fixture cannot fail either way). Verdict stays CONFIRMED at medium; I do not call the row UNDERSTATED because severity and type are already correct.

### Corrections to the row as filed

1. `findings.md:2106` says the loader joins "for any segment by id with **no ACTIVE-only condition**" — **CONFIRMED**: `database.py:1897-1926` joins `knowledge.indexes ON indexes.id = segments.index_id` with no status predicate, unlike the search path, which does filter (`:1700`, `:1792` `WHERE status = 'ACTIVE'`). This also *supports* the finding: only the citation/retrieve/metadata path can resolve a superseded index, so it is the only path that needs to say so.
2. `findings.md:2105-2106` adds `/v1/metadata` beyond Phase 1's chunk+citation scope — **CONFIRMED** at `main.py:1039-1068`. `xcheck-kb-tools.md:18` independently verified it. The register's widening is correct and should be kept.
3. All line numbers in both rows re-read at the working tree: `database.py:1905/1913/1961-1967`, `main.py:958-977/998-1026/1039-1068/978-984/1028-1034`, `database.py:2377-2407/2591-2609`, `knowledge-adapter.mjs:405-419/716-822/775-822`, `zink-knowledge.schema.json:85-119/114/118`, `test_m12_t9_b5_db_retrieval.py:225-280`, `test_b5_knowledge_http_surface.py:347-382`, `CHANGELOG.md:2160-2161/1461-1463` — **all accurate**. No stale locator in F-KB-004.

### fixer and files (for parallel-safe waves)

- fixers: **`fix-knowledgebase`** (primary) + **`fix-tools`** (contract/adapter) + **`fix-tests`** (cross-module gate) + **`fix-openclaw-governance-library`** (packaged-asset admission, asks per edit).
- files: `apps/knowledge/app/main.py`; `apps/knowledge/tests/test_b5_knowledge_http_surface.py`; `zink-tools/adapters/knowledge/knowledge-adapter.mjs`; `zink-tools/contracts/tools/zink-knowledge.schema.json`; `tests/memory-tool-output-contracts.test.mjs`; conditionally `integrations/openclaw/lib/policy.mjs` and `integrations/openclaw/configure.mjs`.
- Do **not** touch Skill Store: agreed by `xcheck-kb-skill.md:36` and `findings.md:2109`.
- Wave safety: this row's KB-side files collide with the uncommitted F-576 patch and with F-KB-003's fixer; the Tools-side files are disjoint from everything in this bucket.

---

## Consolidated triage table

| Row | Verdict | type | Category | severity | depends_on | fixer(s) | red |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-KB-003 | CONFIRMED-AS-LATENT | data-integrity | F5 | medium | F-576 | fix-knowledgebase | NO (RED if F-576 takes the schema-CHECK branch) |
| F-KB-004 | CONFIRMED (distinct defect + incomplete F-573 closure; **not** DUPLICATE-OF F-071) | data-integrity (+contract-mismatch, +test-gap) | F5 | medium | RED owner decision for the Tools/schema half | fix-knowledgebase + fix-tools + fix-tests + fix-openclaw-governance-library | **YES** |

Severity counts for this bucket: root-cause 0 · high 0 · medium 2 · low 0. Confirmed 1 · confirmed-as-latent 1 · rejected 0 · refuted 0.

Gate on this report (`findings.md:8` — `docs/**/*.md` is covered by `markdownlint-cli2` and `prettier --check`, i.e. `npm run format:check` / `npm run lint`): **NOT RUN** — shell execution is denied to this agent (`AGENTS.md` §11: an unavailable required gate stays `NOT RUN`; it is not converted into a pass). The lead must run it before consolidation.

## Blockers for the lead

1. **B-04-1 (verification).** `git status` / `git diff` were denied to me by permissions. F-KB-003's central claim — that the NFC writer normalization exists only in an uncommitted F-576 edit — must be confirmed with one command (`git diff -- apps/knowledge/app/database.py apps/knowledge/app/index_lifecycle.py`) and `git ls-files --error-unmatch apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py` (expected: not tracked) before the row is finalised. Affected: F-KB-003.
2. **B-04-2 (authority).** The in-flight F-576 patch sits in the assigned files while the audit runs. I am read-only, `PLAN.md` shows `Execution Authorization: NO` for the historical bands I read (`PLAN.md:679,771,819` etc.) and `findings.md` §0.2 item 10 reserves authority to `PLAN.md`/a valid `ACTIVE.md`. No agent may fix F-KB-003 until F-576's disposition is settled, and the owner must decide which of F-576's two remedy branches is taken.
3. **B-04-3 (owner decision, RED).** F-KB-004 requires amending a versioned public API and a closed `additionalProperties:false` Tools contract at `1.1.0`, plus the packaged-build digest set. `AGENTS.md` §7 requires the owner's decision; silence is not approval. Recommend the two-stage split (Knowledge additive first, Tools contract version separately).
4. **B-04-4 (evidence hygiene).** `findings.md:2093` cites an untracked test file, which conflicts with the register's own tracked-path claim at `findings.md:98`. Needs the lead's correction, not a source edit.
5. **B-04-5 (reproduction gap).** Per `findings.md` §0.2 items 2–5, both rows have **no red test and no executed probe** (`NOT RUN`). F-KB-003 additionally needs a filesystem that preserves distinct NFC/NFD spellings — unavailable on this Windows host; the WSL/ext4 lane is required. F-KB-004 needs a superseded-index fixture against the running service. Neither may be claimed fixed without those, and neither may be closed by static reasoning alone.
6. **B-04-6 (parallel-safety).** F-KB-003 and the KB half of F-KB-004 both write under `apps/knowledge/` while the uncommitted F-576 patch is still in flight there. Sequence them into different waves or appoint one integration owner (`AGENTS.md` §8).
