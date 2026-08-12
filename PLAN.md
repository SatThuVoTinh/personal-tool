# Personal Tool — Development Plan

`PLAN.md` is the authoritative record of development order, active scope, architectural decisions, completion evidence, and blockers. `CHANGELOG.md` records only work that has completed its Definition of Done.

## Operating rules

- Read `AGENTS.md`, this file, and the relevant implementation before changing a module.
- Work only on the declared active task. Do not create speculative infrastructure or start a later milestone early.
- A task is complete only with executable evidence: tests, reproducible commands, runtime checks, or observed API/database behavior as appropriate.
- Do not infer completion from a file, directory, diagram, configuration declaration, or placeholder.
- Do not commit secrets, runtime `.env` files, licenses, credentials, generated backup data, or user Vault content.
- Treat Obsidian as read-only source material. PostgreSQL/vector data is derived and rebuildable.
- When a module completes, update this file, `CHANGELOG.md`, and `README.md` in the same change set where applicable. Planned or blocked work is recorded here, never as a completed changelog entry.

## Current status and release gate

| Item                             | Status                     | Verified evidence                                                                                                                                                          |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0 — plan approval               | `COMPLETE`                 | V1 sequence and ownership boundaries approved.                                                                                                                             |
| M1 — development foundation      | `COMPLETE`                 | Local verification suite and GitHub CI/Security workflows exist and pass.                                                                                                  |
| M2 — local infrastructure        | `COMPLETE + REMOTE-BACKED` | Commit `5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19`; full isolated M2/T5 acceptance passed on 2026-08-12; GitHub CI run `31597875617` and Security run `31597875566` passed. |
| M3 — Markdown Knowledge Platform | `NOT STARTED`              | Architecture below is approved; no M3 application, schema, or service code exists yet.                                                                                     |

**Next eligible task:** M3/T1 — Knowledge service and immutable index identity. It may start only after the documentation change set containing this plan, `README.md`, and `CHANGELOG.md` is committed, merged to `main`, and its GitHub CI/Security checks pass.

**M2 completion evidence:** the isolated `personal-tool-acceptance` project passed T1 runtime preflight, T2 durable PostgreSQL/AIStor plus transient Redis checks, T3 persistent/encrypted n8n state and Ollama connectivity, T4 observability target/resource checks, and T5 logical backup → destroy acceptance volumes → clean recreate → restore. The acceptance project and its temporary artifacts were removed. GitHub confirmed `CI / quality-gate`, `Security / dependency-audit`, and `Security / secret-scan` as successful for the remote M2 commit.

## V1 milestone sequence

```text
M0  Plan approval                         COMPLETE
M1  Development foundation                COMPLETE
M2  Local infrastructure                  COMPLETE + REMOTE-BACKED
M3  Markdown Knowledge Platform           NEXT
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
| M3/T1 — service and index identity          | `NOT STARTED` | Create the internal-only Knowledge service, migrations, health/readiness contract, active-index invariant, model preflight, and in-process run scheduler. Do not implement retrieval or source adapters beyond test fixtures. |
| M3/T2 — Markdown discovery and segmentation | `NOT STARTED` | Read-only Vault scan, canonical topic validation, native-tag extraction, title/heading extraction, original-line source spans, and deterministic token-aware chunks.                                                          |
| M3/T3 — index lifecycle                     | `NOT STARTED` | Incremental replacement, side-by-side full rebuild, digest checks, document-level atomicity, deletion safety, recovery, and run status APIs.                                                                                  |
| M3/T4 — hybrid retrieval and reranking      | `NOT STARTED` | Filtered HNSW/FTS retrieval, RRF, batched ONNX reranking, citations, capacity limits, and search APIs.                                                                                                                        |
| M3/T5 — acceptance and handoff              | `NOT STARTED` | Fixture and opt-in Vault acceptance, migration/rebuild recovery, operations runbook, final evidence, and synchronized documentation.                                                                                          |

Each task reruns all relevant predecessor regression checks. A failed task remains `IN PROGRESS` or becomes `BLOCKED`; it never unlocks the next task.

### Read-only Vault and canonical topics

M3 discovers only `01. Knowledge/**/*.md` from the configured Vault root. It must not write to the Vault and must reject paths escaping the configured root. `02. Books`, `03. Papers`, `04. Images`, and `05. Videos` are excluded from M3.

The five media branches share the same thirteen logical topics for later milestones. In M3, the topic folder determines `primary_topic`; native Obsidian tags are mandatory validation and secondary classification. Numeric folder prefixes are ignored when matching the canonical folder label.

| Folder topic        | Required primary native tag |
| ------------------- | --------------------------- |
| AI                  | `#ai`                       |
| Data                | `#data`                     |
| Cloud               | `#cloud`                    |
| Machine Learning    | `#machinelearning`          |
| Logistics           | `#logistics`                |
| Supply Chain        | `#supplychain`              |
| Material Science    | `#materialscience`          |
| Agriculture Science | `#agriculturalscience`      |
| Economic            | `#economic`                 |
| Natural Science     | `#naturalscience`           |
| Social Science      | `#socialscience`            |
| English             | `#english`                  |
| Chinese             | `#chinese`                  |

- Canonical native `#tags` are lowercase and parsed from Markdown outside fenced code blocks. YAML frontmatter, including a YAML `tags:` field, is ignored as classification input.
- A note must contain the canonical tag required by its topic folder. It may contain other canonical topics and ordinary Obsidian tags; all appear in `canonical_topics` and `tags` metadata.
- Tag order is not semantic and cannot change `primary_topic`. Moving a note to another topic folder changes `primary_topic` and is an atomic reindex replacement.
- A missing or mismatched required tag makes that source invalid. An incremental run retains the previous source version and marks the source/run error. A full rebuild fails and never activates its BUILDING index.
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

- Target approximately 1,500 characters; hard maximum 2,000 characters.
- A segment may contain at most 768 passage tokens according to the reranker tokenizer.
- `RERANK_MAX_LENGTH=1024`; the query budget is 256 tokens including pair special-token allowance. The final tokenizer pair encoding must be asserted to be no longer than 1,024 tokens; passage text is shortened before that assertion if necessary.
- Use heading and paragraph boundaries first, then sentence boundaries. Never split a fenced code block; an oversized fenced block remains a single segment only if it meets both hard caps, otherwise the source is rejected with a clear error.
- The parser keeps a source-span map to original Markdown line numbers. Stripping YAML frontmatter or normalizing embedding text never renumbers citations.

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
- The vector path uses a pgvector 0.8.1 HNSW cosine index (`vector_cosine_ops`). Every dense retrieval transaction sets `hnsw.iterative_scan = strict_order`, `hnsw.ef_search = 100`, `hnsw.max_scan_tuples = 20000`, and `hnsw.scan_mem_multiplier = 1` locally so approximate filtering continues until sufficient ordered candidates are found.
- Global dense retrieval returns top 40; global FTS returns top 40. M3 does not fan out into thirteen physical tables.
- `segments.search_vector` is constructed as:

```sql
setweight(to_tsvector('simple', title), 'A') ||
setweight(to_tsvector('simple', tags_text), 'A') ||
setweight(to_tsvector('simple', heading_text), 'B') ||
setweight(to_tsvector('simple', text), 'D')
```

FTS parses with `websearch_to_tsquery('simple', query)` and ranks with `ts_rank_cd('{0.1,0.2,0.4,1.0}', search_vector, query, 0)`. Chinese lexical segmentation is intentionally deferred; multilingual dense retrieval remains available through BGE-M3.

- Candidate identity is `segment_id`. The dense/FTS union deduplicates by that ID before fusion. If a segment is rank 2 dense and rank 5 FTS, its score is `1/(60+2) + 1/(60+5)` and it appears once.
- RRF uses `k=60`, fuses at most 80 unique segments, and passes the top 20 to reranking. Stable ties resolve by the best branch rank, then `segment_id`.
- Reranking uses a singleton `BAAI/bge-reranker-v2-m3` ONNX Runtime CPU session with a dynamic-INT8 artifact, `CPUExecutionProvider` only, `intra_op_num_threads=4`, `inter_op_num_threads=1`, and configurable batch size (default 20).
- One global search semaphore permits two retrieval pipelines; one global rerank semaphore permits only one batched `CrossEncoder.predict` call at a time. A saturated search slot returns `429 SEARCH_CAPACITY_EXCEEDED` rather than unboundedly queueing requests.
- The reranker receives one batch of `(query, segment)` pairs, not twenty separate inference calls. `rerank_score = sigmoid(raw_logit)`; never min-max normalize scores within a query.

Search results contain the source title/path, text, heading path, `indexed_by_run_id`, retrieval/rerank scores, and a source-specific citation locator. M3 emits Markdown citations using original `line_start` and `line_end` only.

`GET /knowledge/v1/healthz` is liveness. `GET /knowledge/v1/readyz` is readiness and reports non-ready for missing ACTIVE index, unavailable dependencies, or embedding-model drift. `GET /knowledge/v1/index-runs/{id}` exposes only safe run state/counters/errors. Errors never include secrets, source contents beyond a safe path, or internal credentials.

### M3 acceptance criteria

- Migration tests prove all required foreign keys, `index_id` uniqueness, and the one-ACTIVE partial unique index.
- Tests prove native tag parsing, YAML tag exclusion, required folder/tag matching, tag-order invariance, path traversal rejection, H1 fallback, source-line citation mapping, fenced-code behavior, Chinese token caps, and reranker pair-length enforcement.
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
