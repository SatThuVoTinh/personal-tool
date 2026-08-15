# Personal Tool — Development Plan

## Development Rules

### 1. Read Before Acting

Before modifying the repository, the agent MUST:

1. Read `AGENTS.md`.
2. Read `PLAN.md`.
3. Identify the current Active Task in `PLAN.md`.
4. Inspect the relevant repository files and existing implementation.
5. Determine the actual implementation state from repository evidence.
6. Make the smallest change required by the Active Task.

Do not begin implementation before the Active Task is known.

---

### 2. `PLAN.md` Is the Development Source of Truth

`PLAN.md` is the single source of truth for:

- development sequence;
- milestone status;
- task status;
- Current Focus;
- Active Task;
- dependencies;
- Definition of Done;
- completion evidence;
- blockers;
- component completion status.

`AGENTS.md` defines how an agent must work.

`CHANGELOG.md` records historical completed changes.

The agent MUST NOT create a separate development roadmap or progress state in another document.

---

### 3. Active Task Rule

Only the task explicitly identified as the current Active Task in `PLAN.md` is in scope.

The agent MUST NOT:

- implement future milestones proactively;
- start another milestone because it appears easy;
- create infrastructure for future milestones;
- refactor unrelated components;
- add speculative abstractions;
- modify deferred applications;
- mark future work as complete;
- silently expand the scope of the Active Task.

If the current task reveals a prerequisite outside its scope, stop and report the dependency. Do not silently expand the task.

---

### 4. Sequential Milestone Rule

Personal Tool V1 follows the approved milestone sequence:

```text
M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8 → M9 → M10
```

A milestone may move to `IN PROGRESS` only after the previous required milestone has reached `COMPLETE`.

No milestone may run in parallel unless the owner explicitly approves the exception.

The agent MUST NOT unlock or begin the next milestone merely because its implementation appears possible.

---

### 5. Milestone Completion Gate

A milestone may be marked `COMPLETE` only when:

1. its Definition of Done is satisfied;
2. the required implementation exists;
3. relevant validation has passed;
4. required service health checks have passed;
5. completion evidence has been recorded in `PLAN.md`;
6. known blockers affecting the milestone are resolved or explicitly documented.

Code existence alone does not establish completion.

After a milestone becomes `COMPLETE`, the next milestone becomes eligible for execution according to `PLAN.md`.

---

### 6. Evidence Rule

Never infer implementation status from:

- file names;
- directory names;
- architecture diagrams;
- documentation;
- comments;
- TODO items;
- placeholders;
- empty directories;
- configuration templates;
- planned schemas;
- declared Docker services.

A component may be classified as `IMPLEMENTED` only when observable repository evidence supports that status.

Acceptable evidence may include:

- executable implementation;
- passing automated tests;
- successful reproducible commands;
- successful database migration;
- successful service health check;
- validated API behavior;
- validated data-pipeline output;
- validated end-to-end behavior.

If evidence is unavailable, report the component as not verified.

---

### 7. Status Vocabulary

Milestone and task status:

```text
NOT STARTED
IN PROGRESS
BLOCKED
COMPLETE
DEFERRED
CANCELLED
```

Component status:

```text
IMPLEMENTED
PARTIALLY IMPLEMENTED
PLANNED
MISSING
INCONSISTENT
DEPRECATED
```

These two status systems MUST NOT be mixed.

For example:

```text
M5 → IN PROGRESS
ai-chat → PARTIALLY IMPLEMENTED
```

is valid.

Do not use `IMPLEMENTED` as a milestone status or `COMPLETE` as a component status.

---

### 8. Repository-State Verification

Before claiming that something is implemented, inspect the actual repository.

The agent MUST NOT assume that an architectural component exists merely because it is described in:

- `AGENTS.md`;
- `PLAN.md`;
- architecture documentation;
- README files;
- diagrams;
- previous conversations.

If implementation and documentation disagree, treat the repository evidence as the current implementation reality and report the inconsistency.

---

### 9. Architecture and Dependency Changes

Do not silently change approved architecture.

A new:

- database;
- infrastructure service;
- framework;
- model provider;
- external dependency;
- architectural boundary;
- major runtime dependency

requires an explicit architectural decision before implementation when it changes the approved V1 design.

Record the decision in `PLAN.md` under `Decision Log`.

A proposal must be marked `PROPOSED` until explicitly approved by the owner.

Do not implement a `PROPOSED` architectural change as though it were `ACCEPTED`.

---

### 10. Scope Protection

V1 prioritizes the complete Knowledge Assistant before L&SC Intelligence.

The approved execution order is:

```text
Knowledge Assistant
    M3 → M4 → M5 → M6
        ↓
L&SC Intelligence
    M7 → M8 → M9
        ↓
V1 Hardening
    M10
```

Deferred applications, including:

```text
applications/admin-dashboard/
applications/document-manager/
```

must not be developed during V1 unless explicitly re-approved.

---

### 11. Validation Rule

After implementation, run the narrowest meaningful validation first and broader validation when required.

Examples:

```text
implementation
    ↓
unit test
    ↓
integration validation
    ↓
service health
    ↓
end-to-end validation
```

If validation cannot be performed:

- do not claim completion;
- record the missing validation or blocker in `PLAN.md`;
- report exactly what remains unverified.

---

### 12. `PLAN.md` Update Rule

Update `PLAN.md` when:

- a task is completed;
- a task becomes blocked;
- a task is deferred or cancelled;
- the Active Task changes;
- a dependency changes;
- the Definition of Done changes;
- the implementation materially changes the approved approach;
- a new architectural decision is required;
- completion evidence changes.

All updates must describe actual repository state, not intentions.

---

### 13. `CHANGELOG.md` Update Rule

`CHANGELOG.md` is a historical record of completed and validated changes.

Add an entry only after the relevant task reaches its Definition of Done.

Do not add entries for:

- planned work;
- work in progress;
- blocked work;
- placeholders;
- empty directories;
- unverified code;
- architecture proposals;
- speculative changes.

When a task reaches Definition of Done, update `PLAN.md` and `CHANGELOG.md` in the same change set whenever practical.

`CHANGELOG.md` MUST NOT be used as the source of truth for the current Active Task.

---

### 14. Security and Secrets

Never:

- commit `.env` files containing secrets;
- expose API keys;
- expose passwords;
- expose access tokens;
- print credentials;
- commit private certificates;
- expose sensitive local configuration.

Environment files may be inspected for variable names and structure, but secret values must remain redacted.

Use `.env.example` to document configuration shape.

---

### 15. Database and Persistent Data Safety

Do not:

- silently delete databases;
- reset persistent volumes without explicit approval;
- destroy existing data merely to simplify testing;
- introduce schema changes without appropriate validation;
- treat a migration file as proof that a migration has been executed successfully.

Database changes must be reproducible and validated.

---

### 16. Minimal Change Principle

Prefer the smallest coherent change that satisfies the Active Task.

Do not perform unrelated cleanup, broad refactoring, dependency replacement, or architecture modernization during an implementation task.

If a larger refactor is genuinely required, explain why and obtain the necessary architectural decision before expanding scope.

---

### 17. Final Verification

Before reporting a task as complete:

1. Verify the changed files.
2. Run the relevant tests/checks.
3. Verify affected services where applicable.
4. Confirm no secrets were exposed.
5. Record completion evidence in `PLAN.md`.
6. Update `CHANGELOG.md` if the Definition of Done was reached.
7. Confirm the next milestone is actually unlocked.

The final response must clearly state:

- what was changed;
- what was validated;
- what evidence was obtained;
- what remains blocked or unverified;
- whether the next milestone is unlocked.

## End rule
## Current status and release gate

| Item                             | Status                     | Verified evidence                                                                                                                                                          |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — plan approval               | `COMPLETE`                 | V1 sequence and ownership boundaries approved.                                                                                                                             |
| M1 — development foundation      | `COMPLETE`                 | Local verification suite and GitHub CI/Security workflows exist and pass.                                                                                                  |
| M2 — local infrastructure        | `COMPLETE + REMOTE-BACKED` | Commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`; full isolated M2/T5 acceptance passed on 2026-08-12; GitHub CI run `31597875617` and Security run `31597875566` passed. |
| M3 — Markdown Knowledge Platform | `IN PROGRESS`              | M3/T1–T4 are `COMPLETE + REMOTE-BACKED`; M3/T5 local Fixture, RealVault isolated, and live acceptance passed on 2026-08-15 for accepted candidate `be4c8687b5d7fa2c12f19c330639968ac9d7edfb`. Remote gates remain. |

**Active Task:** M3/T5 — local acceptance passed, awaiting remote gates. The exact clean candidate `be4c8687b5d7fa2c12f19c330639968ac9d7edfb` passed Fixture, RealVault isolated, and live acceptance on 2026-08-15. Completion still requires the implementation PR and sanitized remote-evidence PR to pass GitHub CI/Security and merge without rewriting the accepted commit identity.

**M2 completion evidence:** the isolated `personal-tool-acceptance` project passed T1 runtime preflight, T2 durable PostgreSQL/AIStor plus transient Redis checks, T3 persistent/encrypted n8n state and Ollama connectivity, T4 observability target/resource checks, and T5 logical backup → destroy acceptance volumes → clean recreate → restore. The acceptance project and its temporary artifacts were removed. GitHub confirmed `CI / quality-gate`, `Security / dependency-audit`, and `Security / secret-scan` as successful for the remote M2 commit.

## V1 milestone sequence

```text
M0  Plan approval                         COMPLETE
M1  Development foundation                COMPLETE
M2  Local infrastructure                  COMPLETE + REMOTE-BACKED
M3  Markdown Knowledge Platform           IN PROGRESS (T1-T4 remote-backed; T5 local acceptance passed, awaiting remote gates)
M4  PDF document ingestion                 deferred until M3 is complete
M5  Image and video multimodal ingestion  deferred until M4 is complete
M6  AI Platform                            deferred
M7  Web Chat                               deferred
M8  Automation and application observability deferred
M9  L&SC Data Plant                        deferred
M10 Forecasting and optimization           deferred
M11 Dashboard                              deferred
M12 Hardening and V1 release               deferred
```

M3 is deliberately Markdown-only. PDF, image, and video source adapters are architectural follow-ons, not partial M3 implementation.

## M3 — Markdown Knowledge Platform

### Purpose and hard boundaries

M3 provides local hybrid retrieval over human-authored Markdown in `01. Knowledge` with citations to original file lines. It does not add a chat UI, RAG answer generator, PDF/image/video ingestion, n8n workflow, external queue, or a second worker/container.

- One FastAPI service and one Uvicorn process run in the `knowledge` container.
- The service is internal to the Docker network with **no host port mapping**.
- Nginx retains its host-loopback binding and reverse-proxies the M3 route to `knowledge:<internal-port>` over the Docker network. “Loopback” refers to Nginx's host binding, not the Nginx-to-service connection.
- PostgreSQL + pgvector is the structured and vector store; Redis is not a source of truth and is not required for M3 job execution.
- One in-process background indexing task manages an accepted index run. No Celery, RQ, external queue, or additional worker/container is introduced.

### M3 task sequence

| Task                                        | Status        | Scope and completion gate                                                                                                                                                                                                     |
| ------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M3/T1 — service and index identity          | `COMPLETE + REMOTE-BACKED` | Internal-only Knowledge service, idempotent migrations, health/readiness, active-index invariant, digest/dimension preflight, orphan-run recovery, and an advisory-lock in-process scheduler passed isolated runtime acceptance plus M2/T1–T5 regression on 2026-08-12; merge `4097862` and its GitHub CI/Security checks passed. No retrieval or source adapter was implemented. |
| M3/T2 — Markdown discovery and segmentation | `COMPLETE + REMOTE-BACKED` | Read-only Vault scan, deterministic all-or-nothing scan result, canonical topic/tag validation, Markdown lexical parsing, original-line spans, and retrieval-safe segmentation passed all local gates; merge `b446ff1` and its GitHub CI/Security checks passed on `main` on 2026-08-13. |
| M3/T3 — index lifecycle                     | `COMPLETE + REMOTE-BACKED` | Incremental replacement, side-by-side full rebuild, immutable model checks, document-level atomicity, deletion safety, recovery, and run status APIs passed all local gates; merge `242bca8` and its GitHub CI/Security checks passed on `main` on 2026-08-13. |
| M3/T4 — hybrid retrieval and reranking      | `COMPLETE + REMOTE-BACKED` | Filtered HNSW/FTS retrieval, deterministic RRF, batched dynamic-INT8 ONNX reranking, citations, capacity limits, and search APIs passed builder/runtime acceptance and all predecessor regressions; merge `aa73b06` and its GitHub CI/Security checks passed on `main`. |
| M3/T5 — acceptance and handoff              | `IN PROGRESS — LOCAL ACCEPTANCE PASSED` | Exact-HEAD image provenance, owned isolated cleanup, Fixture, RealVault isolated, and persistent live acceptance passed on 2026-08-15 for candidate `be4c8687b5d7fa2c12f19c330639968ac9d7edfb`. The live run indexed 28 sources, preserved one queryable ACTIVE index across restart, verified retrieval/citation and read-only Vault integrity, stayed below the Knowledge-container memory threshold, and recorded zero OOM-kill deltas. Completion awaits remote CI/Security and the final sanitized evidence merge. |

Each task reruns all relevant predecessor regression checks. A failed task remains `IN PROGRESS` or becomes `BLOCKED`; it never unlocks the next task.

**M3/T1 completion evidence:** the isolated `personal-tool-m3-t1` project built the Knowledge image and proved that Nginx reaches its internal-only liveness route, readiness refuses a missing ACTIVE index, active-index uniqueness is enforced, readiness becomes healthy only with the exact resolved BGE-M3 digest and 1024 dimensions, a digest change returns `EMBEDDING_MODEL_DRIFT`, and a restarted service converts a `RUNNING` run to `INTERRUPTED` with `PROCESS_RESTART`. Its project, network, and volume were removed. The cumulative isolated M2/T1–T5 acceptance was then rerun and passed, including backup, destroy/recreate, restore, and cleanup. M3/T1 was merged at `4097862ab383e8698f2d5b1ff5adce0acd1c6579`; GitHub CI run `31615503607` and Security run `31615503591` passed on that `main` commit.

**M3/T2 completion evidence:** on 2026-08-13, all 22 Python unit/golden tests passed in the pinned `uv` environment; the isolated read-only fixture acceptance passed with identical Vault hashes before and after; Windows-native junction/reparse acceptance passed; all 46 repository and contract tests passed through `npm run verify`; the isolated M3/T1 runtime regression passed; and the cumulative M2/T1–T5 acceptance passed, including backup, destroy/recreate, restore, and cleanup. PR `#8` merged at `b446ff17146763ea762b8669207c09642d42098f`; GitHub CI run `31682828157` and Security run `31682828014` passed on that `main` commit. M3/T3 is unlocked.

**M3/T3 completion evidence:** on 2026-08-13, the audited implementation passed all 42 Python lifecycle/scanner/model/error/API tests in the pinned `uv` container and all 51 repository/contract tests. The isolated M3/T3 acceptance passed through Nginx with PostgreSQL assertions, immediate GET after `202`, full publication, unchanged incremental convergence, empty-snapshot protection, restart recovery, read-only Vault mounting, and cleanup. M3/T1, M3/T2 read-only fixture, Windows-native junction/reparse, and cumulative M2/T1–T5 backup/destroy/recreate/restore regressions also passed. PR `#10` merged at `242bca819b72ded9f6178221eb9cdda09b3dea38`; GitHub CI run `31694753997` and Security run `31694754021` passed on that `main` commit. M3/T4 is unlocked.

**M3/T4 completion evidence:** on 2026-08-14, 53 Python tests and all 55 repository/contract tests passed. Builder fidelity validated the pinned multilingual FP32 reference → FP32 ONNX → dynamic-INT8 ONNX chain; runtime acceptance validated batched reranking, deterministic filtered search, citations, the 10,000-segment HNSW plan, the 4 GiB cgroup memory/OOM gate, and read-only Vault hashes. M3/T1–T3, Windows-native junction/reparse, and cumulative M2/T1–T5 backup/destroy/recreate/restore regressions also passed. PR `#12` merged at `aa73b06375321460800b9f78e8195b6837ea5125`; GitHub CI run `31805436907` and Security run `31805436900` passed on that `main` commit. The M3/T5 plan is unlocked; no T5 implementation is claimed.

### Read-only Vault and canonical topics

M3 discovers only `01. Knowledge/**/*.md` from the configured Vault root. It must not write to the Vault and must reject paths escaping the configured root. `02. Books`, `03. Papers`, `04. Images`, and `05. Videos` are excluded from M3.

Windows Cloud Files placeholders are allowed only when their Microsoft cloud reparse tag is recognized and the resolved path remains inside the canonical Vault root. Symlinks, junctions, name-surrogate reparse points, unknown reparse tags, cycles, and path escapes fail closed.

The five media branches share the same thirteen logical topics for later milestones. In M3, native Obsidian tags are the taxonomy source of truth. Folder names below `01. Knowledge` are organizational only and may use personal names or numbering such as `2. Data`; they do not determine or validate topic metadata. The first canonical native tag in document order determines `primary_topic`, and every canonical native tag contributes to `canonical_topics`.

| Canonical topic | Native tag |
| --- | --- |
| AI | `#ai` |
| Data | `#data` |
| Cloud | `#cloud` |
| Machine Learning | `#machinelearning` |
| Logistics | `#logistics` |
| Supply Chain | `#supplychain` |
| Material Science | `#materialscience` |
| Agricultural Science | `#agriculturalscience` |
| Economic | `#economic` |
| Natural Science | `#naturalscience` |
| Social Science | `#socialscience` |
| English | `#english` |
| Chinese | `#chinese` |

- Canonical native `#tags` are lowercase and parsed from Markdown outside YAML frontmatter, fenced code, inline code, headings, and HTML comments. Escaped hashes and URL fragments are not tags.
- Canonical-topic validation uses the raw native-tag lexeme before NFC/case-fold normalization; for example, `#MachineLearning` does not satisfy `#machinelearning`.
- A note must contain at least one canonical native topic tag. It may contain additional canonical topics and ordinary Obsidian tags; all appear in `canonical_topics` and `tags` metadata.
- `primary_topic` is derived from the first canonical tag in document order, while `canonical_topics` preserve first occurrence order and remove duplicates. After validation, metadata tags are NFC-normalized, case-folded, deduplicated, and deterministically sorted; passage text, titles, and headings are not Unicode-normalized.
- Moving a note between folders changes `source_path` but not its topic metadata. Reordering canonical tags may intentionally change `primary_topic` and is handled as an atomic reindex replacement.
- A missing canonical native topic tag makes that source invalid. An incremental run retains the previous source version and marks the source/run error. A full rebuild fails and never activates its BUILDING index.
- Tag-only lines may be omitted from passage text, but tags remain structured metadata and receive full-text weight A. YAML removal and every embedding transformation preserve original Markdown source coordinates.

The initial read-only inventory found the five top-level subject trees and all thirteen topics. At the time of inspection, `01. Knowledge`, Papers, Images, and Videos had no eligible content; Books had Markdown sidecars for PDFs physically archived under `99. Archives`. M3 acceptance therefore uses a repository fixture Vault. A separate opt-in real-Vault acceptance remains skipped until the owner provides at least one valid `01. Knowledge` note; it never writes to that Vault.

### Database contract

All M3 retrieval rows are scoped by an `index_id`; an ACTIVE and a BUILDING index can therefore coexist without touching each other.

#### `knowledge.indexes`

- `id` UUID primary key; `status` is `BUILDING`, `ACTIVE`, `SUPERSEDED`, or `FAILED`.
- Stores `embedding_model_name`, `embedding_model_digest`, and `embedding_dimensions`, plus creation/activation/supersession timestamps and conditional failure fields.
- Does **not** have `created_by_run_id`; `index_runs.index_id` is the one-way relation that avoids a circular foreign key.
- A partial unique index on a constant value where `status = 'ACTIVE'` guarantees at most one ACTIVE row at database level.

#### `knowledge.index_runs`

- `id` UUID primary key; `index_id NOT NULL` foreign key to `indexes`; `kind` is `INCREMENTAL` or `FULL_REBUILD`.
- `status` is `RUNNING`, `SUCCEEDED`, `FAILED`, or `INTERRUPTED`, with timestamps, counters, and conditional error detail.
- A partial unique index over active run statuses prevents more than one accepted run. A request while one is active returns `409 INDEX_RUN_ALREADY_ACTIVE`.

#### `knowledge.sources`

- `id` UUID primary key and `index_id NOT NULL` foreign key.
- `source_type` is `MARKDOWN` in M3; future values are `PDF`, `IMAGE`, and `VIDEO`.
- Stores normalized Vault-relative `source_path`, SHA-256, MIME type, `title`, `primary_topic`, `canonical_topics`, ordinary `tags`, and `indexed_by_run_id`.
- `title` is the first H1; the filename stem is the fallback.
- Identity is `UNIQUE(index_id, source_path)`.

#### `knowledge.source_sidecars`

- Contains `index_id`, `source_id`, `sidecar_path`, and `relation_type` (`EMBED` initially), with `UNIQUE(index_id, source_id, sidecar_path)`.
- M3 creates no sidecar relationship. The table is reserved for M4/M5 so one PDF/image/video can have several logical Markdown sidecars without reducing that relation to a single `sidecar_path` field.

#### `knowledge.segments`

- Contains `id`, `index_id`, `source_id`, `segment_type`, `chunk_ordinal`, `text`, `embedding`, `search_vector`, `heading_path`, `heading_text`, original Markdown `line_start`/`line_end`, and `indexed_by_run_id`.
- Stores denormalized retrieval metadata (`source_path`, `title`, `primary_topic`, `canonical_topics`, and `tags`) transactionally with its source, so filters and full-text search do not depend on mutable joins.
- Future locator fields are nullable: `page_start`, `page_end`, `bbox`, `time_start_ms`, and `time_end_ms`.
- Identity/order is `UNIQUE(index_id, source_id, chunk_ordinal)`.
- M3 uses **one physical `segments` table**. Logical topic filtering uses `primary_topic`; partitioning by list is deferred until a benchmark demonstrates a benefit.

`indexed_by_run_id` always means the run that created the current source/segment version. It is not the latest successful global scan; unchanged content may correctly carry an older run ID.

### Embedding and chunking contract

1. Preflight resolves `bge-m3:latest` to its actual Ollama digest and verifies 1024 dimensions. The resolved digest is the model identity, not the mutable `latest` tag.
2. The captured name, digest, and dimensions are written to the index record. The currently verified digest is `7907646426070047a77226ac3e684fbbe8410524f7b4a74d02837e43f2146bab`; implementation must resolve it again rather than trust this documentation value.
3. At startup, before every index run, before every document transaction commit, before full-index activation, and before query embedding, actual name/digest/dimensions must equal the active or target index contract.
4. If an ACTIVE index exists and its digest drifts, `/readyz` is not ready, `/search` returns `503 EMBEDDING_MODEL_DRIFT`, incremental indexing is rejected, and only an explicit full rebuild using the newly resolved digest is allowed.
5. A digest change during a run fails that run. Committed source replacements retain normal document-level atomicity; a BUILDING index with drift can never activate.

Markdown segmentation is deterministic and heading/paragraph-aware:

- `TARGET_CHARS=1500` is a soft target; `MAX_CHARS=2000` is the hard character cap. Chunks may exceed the target but never the hard cap, and semantic boundaries are not broken merely to hit the target.
- `retrieval_text` prepends the current `heading_path` joined by `" > "` and two newlines. `content_token_count` counts raw passage text; `retrieval_token_count` counts this final retrieval representation, both with `add_special_tokens=False`.
- The application-level reranker budget is `QUERY_MAX_TOKENS=256`, `PAIR_MAX_TOKENS=1024`, `PAIR_SPECIAL_TOKENS_EXPECTED=4`, and `MAX_RETRIEVAL_TOKENS=764`. Initialization disables tokenizer truncation and padding, verifies the tokenizer's actual pair-special-token count is four, and verifies the budget equation.
- Every segment is checked through the actual tokenizer pair API with a fixed query fixture that encodes to exactly 256 raw tokens. Segmentation, never silent truncation, must make `len(pair_encoding.ids) <= 1024`.
- Use heading and paragraph boundaries first, then sentence, whitespace, and tokenizer-offset boundaries. Never split a CommonMark-style backtick or tilde fenced block; an oversized block is rejected if it exceeds `MAX_CHARS`, `MAX_RETRIEVAL_TOKENS`, or the actual pair budget.
- `line_start` and `line_end` are 1-based and inclusive over logical source lines before newline normalization. SHA-256 is computed separately over the original raw bytes.

M3/T2 returns one deterministic `MarkdownScanResult`. `discovered_count` counts `.md` candidates before validation and `valid_source_count` counts sources that pass all validation. Any validation error makes `succeeded=false` and public `sources=[]`, while preserving the valid count and deterministically sorted safe errors; T3 cannot consume a partial snapshot.

### Index execution and atomicity

`POST /knowledge/v1/index-runs` accepts `{ "kind": "INCREMENTAL" | "FULL_REBUILD" }` and returns `202` with `index_run_id`, `index_id`, and `RUNNING` status.

- The single Uvicorn process holds a dedicated PostgreSQL session advisory lock for the lifetime of the in-process indexing task. The request creates the RUNNING record and schedules exactly one task only after the lock is acquired.
- Parsing, hashing, tokenizer work, Ollama calls, and ONNX work run outside the asyncio event loop. PostgreSQL operations use the service's async database path.
- On process startup, any inherited RUNNING records become `INTERRUPTED`. Interrupted runs are never resumed; a later run converges from source truth.
- An incremental run reads the complete eligible Vault manifest, then atomically replaces each changed source and its segments in its own transaction. A failed source keeps its prior version. The run is not a global transaction: a FAILED run may already have committed valid source replacements.
- Deletion/deactivation is committed only after the complete source scan succeeds. If any scan/source error occurs, no deletions are applied; the next successful run converges.
- A full rebuild creates a new BUILDING index and writes only rows bearing that new `index_id`. It never mutates ACTIVE rows.
- After a clean full scan and a final digest check, one transaction changes BUILDING → ACTIVE and previous ACTIVE → SUPERSEDED. Cleanup of SUPERSEDED rows is best-effort after activation; cleanup failure never rolls back the new active index.

### Retrieval and reranking contract

`POST /knowledge/v1/search` accepts:

```json
{
  "query": "string",
  "limit": 10,
  "primary_topic": "optional canonical topic",
  "tags_all": ["optional", "tags"],
  "path_prefix": "optional Vault-relative prefix"
}
```

- Only the unique ACTIVE `index_id` is searchable. All supplied metadata filters are SQL predicates before candidate generation.
- The vector path uses a pgvector 0.8.1 HNSW cosine index (`vector_cosine_ops`). Every dense retrieval transaction sets `hnsw.iterative_scan = strict_order`, `hnsw.ef_search = 100`, `hnsw.max_scan_tuples = 20000`, and `hnsw.scan_mem_multiplier = 1` locally on the same connection as the ANN SELECT. HNSW filtering is logically constrained by SQL predicates but physically applied after approximate scan; iterative scan compensates for filter underfill.
- Global dense retrieval returns top 40; global FTS returns top 40. M3 does not fan out into thirteen physical tables.
- `segments.search_vector` is constructed as:

```sql
setweight(to_tsvector('simple', title), 'A') ||
setweight(to_tsvector('simple', tags_text), 'A') ||
setweight(to_tsvector('simple', heading_text), 'B') ||
setweight(to_tsvector('simple', text), 'D')
```

FTS parses with `websearch_to_tsquery('simple', query)` and ranks with `ts_rank_cd('{0.1,0.2,0.4,1.0}', search_vector, query, 0)`. Chinese lexical segmentation is intentionally deferred; multilingual dense retrieval remains available through BGE-M3.

- Candidate identity is `segment_id`. Dense sorts by cosine distance then `segment_id`; FTS sorts by rank then `segment_id`. The union deduplicates by ID before 1-based RRF with `k=60`; `best_branch_rank` is the minimum non-null branch rank. RRF ties resolve by best branch rank then `segment_id`.
- Search resolves an ACTIVE index, verifies/embeds against that immutable identity, then re-reads ACTIVE inside one read-only `REPEATABLE READ` transaction. A change retries the full pipeline once; a second change returns `503 ACTIVE_INDEX_CHANGED`. Dense and FTS never mix index generations.
- Reranking uses a singleton `BAAI/bge-reranker-v2-m3` dynamic-INT8 ONNX Runtime session with `CPUExecutionProvider`, `ORT_SEQUENTIAL`, `intra_op_num_threads=4`, and a dedicated one-worker executor. A 2-slot atomic no-queue search limiter returns `429 SEARCH_CAPACITY_EXCEEDED` when saturated; the executor enforces at most one physical inference despite cancellation.
- T4 inherits the T2 pair budget unchanged: `QUERY_MAX_TOKENS=256`, `MAX_RETRIEVAL_TOKENS=764`, `PAIR_SPECIAL_TOKENS_EXPECTED=4`, and `PAIR_MAX_TOKENS=1024`. Each actual pair is validated without tokenizer truncation/padding, then manually right-padded only to the longest sequence in the one 1–20-pair ONNX batch. `render_retrieval_text()` remains the single canonical representation renderer. `rerank_score = sigmoid(raw_logit)`; never min-max normalize scores within a query.

Search results contain the source title/path, text, heading path, `indexed_by_run_id`, retrieval/rerank scores, and a source-specific citation locator. M3 emits Markdown citations using original `line_start` and `line_end` only.

`GET /knowledge/v1/healthz` is liveness. `GET /knowledge/v1/readyz` is readiness and reports non-ready for missing ACTIVE index, unavailable dependencies, or embedding-model drift. `GET /knowledge/v1/index-runs/{id}` exposes only safe run state/counters/errors. Errors never include secrets, source contents beyond a safe path, or internal credentials.

### M3 acceptance criteria

- Migration tests prove all required foreign keys, `index_id` uniqueness, and the one-ACTIVE partial unique index.
- Tests prove tag-derived topics independent of folder names, first-canonical-tag primary selection, native tag parsing, YAML tag exclusion, path traversal rejection, H1 fallback, source-line citation mapping, fenced-code behavior, Chinese token caps, and reranker pair-length enforcement.
- Runtime tests prove digest capture, drift refusal, no incremental mutation on drift, full rebuild side-by-side isolation, atomic activation, failed-run partial-success semantics, protected deletion behavior, startup interruption recovery, and active-run `409` behavior.
- Retrieval tests prove filters are present in both candidate SQL branches, iterative HNSW settings are local, FTS weights/parser are exact, RRF deduplicates by `segment_id`, and reranking is singleton/batched/semaphore-limited with sigmoid scores.
- Container acceptance proves the Knowledge service has no host port, Nginx reaches it only over the internal network, read-only fixture mounting prevents Vault writes, and citations resolve to the original fixture lines.
- Full M3 completion requires a passing opt-in real-Vault acceptance after the owner supplies a valid note. It must leave the Vault byte-for-byte unchanged.

## Deferred source adapters

### M4 — PDF document ingestion

M4 adds PDF only after M3 is complete. It preserves physical and logical provenance separately:

- `sources.source_path` is the physical binary path; `source_sidecars` supplies one or more logical Markdown paths.
- PDFs referenced by a valid sidecar may physically reside in `99. Archives`; Archives are never independently scanned into active retrieval.
- Native text uses page/block extraction; OCR is fallback only for missing/failed text layers; Docling/layout processing handles mixed paragraphs, tables, and figures.
- Tables become structured text; figures are cropped transient artifacts processed through OCR/VLM-derived text.
- PDF citations use `page_start`/`page_end` and optional `bbox`, never Markdown line numbers.

### M5 — image and video multimodal ingestion

M5 adds PNG/JPG OCR + VLM-derived segments and MP4 ASR transcripts plus keyframe/VLM timeline segments. Image citations use optional bounding boxes; video citations use `time_start_ms`/`time_end_ms`. Both reuse the M3 source, segment, hybrid retrieval, RRF, reranker, and citation contracts rather than creating a format-specific retrieval engine.

## Later milestones and V1 boundaries

- M6 adds the local AI orchestrator, resource/model policy, agents, and RAG router; agents consume retrieval APIs rather than manipulating the Vault.
- M7 adds a local Web Chat interface that renders answers, index status, and retrieved citations.
- M8 adds n8n-triggered operations and application-level metrics/runbooks after the Knowledge service lifecycle is stable.
- M9–M11 add the governed L&SC Data Plant, forecasting/optimization, and dashboard only after the Knowledge Assistant path is complete.
- M12 validates security boundaries, backup/restore, capacity, end-to-end flows, and release readiness.

Personal Tool remains local-first and single-user. Do not introduce Kubernetes, a multi-user SaaS model, autonomous unrestricted agents, Kafka, or unapproved cloud dependencies within V1.
