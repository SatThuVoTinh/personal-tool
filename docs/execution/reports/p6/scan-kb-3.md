# Recheck Report — kb-3 (Knowledgebase retrieval, provenance, citations and API)

- **Slice:** kb-3 (`apps/knowledge/`)
- **Area:** Knowledgebase retrieval, provenance, citations and API surface
- **Mode:** Recheck (Phase 6)
- **Rechecked Findings:** `F-KB-004`

## Status Summary

| Finding ID | Title | Status | Severity | Category |
| --- | --- | --- | --- | --- |
| F-KB-004 | citation and chunk API responses omit index status and stable chunk ordinal supplied by the database | NOT FIXED | Medium | F5 |

---

## Detailed Recheck Results

### F-KB-004 — citation and chunk API responses omit index status and stable chunk ordinal supplied by the database

- **Status:** NOT FIXED
- **Category:** F5 — Data Integrity & Result Correctness
- **Severity:** Medium
- **Affected Modules:** Zink Knowledgebase API (`apps/knowledge/app/main.py`), Zink Tools Knowledge Adapter (`zink-tools/adapters/knowledge/knowledge-adapter.mjs`), Tools Schema (`zink-tools/contracts/tools/zink-knowledge.schema.json`)
- **Evidence:**
  - `apps/knowledge/app/main.py:958-977`: `/v1/chunk/{segment_id}` serializer builds `row` dict containing `segment_id`, `chunk_id`, `index_id`, `indexed_by_run_id`, `source_id`, `source_sha256`, `source_path`, `source_type`, `title`, `text`, `heading_path`, `line_start`, `line_end`, `page_start`, `page_end`, and `citation`. It still omits `record.index_status` and `record.chunk_ordinal` loaded by `get_segment` (`apps/knowledge/app/database.py:1961-1967`).
  - `apps/knowledge/app/main.py:998-1027`: `/v1/citation/{segment_id}` serializer builds `row` dict with identical fields, omitting `record.index_status` and `record.chunk_ordinal`.
  - `apps/knowledge/app/main.py:1039-1068`: `/v1/metadata/{segment_id}` serializer builds `row` dict omitting `record.index_status` and `record.chunk_ordinal`.
  - `zink-tools/adapters/knowledge/knowledge-adapter.mjs:775-822`: `knowledge-adapter.mjs` formats result rows into the Tools envelope without mapping `index_status` or `chunk_ordinal`.
  - `zink-tools/contracts/tools/zink-knowledge.schema.json:85-119`: Schema specifies `"additionalProperties": false` at `:114` and `:118` and carries no `index_status` or `chunk_ordinal` fields.
- **Reason Not Fixed:** `F-KB-004` requires an owner decision (RED row) regarding public API modification and updating the closed 1.1.0 Tools schema (`docs/contracts/execution/ACTIVE.md:297-300`). No owner decision was recorded for `F-KB-004` during R5 execution (`ACTIVE.md:318-362`), and the row was not assigned to a fixer wave.

### New Defects Introduced

- **New Defects:** None. No code modifications were performed for `F-KB-004`.

---

## Test Gate Citation

Per lead test report `docs/execution/reports/p6/tests.md`:
- **Knowledgebase tests (`test:knowledge`):** PASS (311 passed, 18 skipped, 31 subtests passed in 54.67s; `uv run --directory apps/knowledge --locked python -m pytest tests -q`)
- **Repository policy (`repository-policy.mjs`):** PASS (1 suite, 1 test passed in 3.15s)
- **Repository check (`repo:check`):** FAIL (Diagnostic failures: trailing whitespace in 7 files; status vocabulary in findings.md; package.json missing 2 new test files)
- **PostgreSQL / Docker real-database lane:** NOT RUN (Host lacks live container daemon / active PostgreSQL instance)
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows host environment)

---

## Summary Counts

- **Total Rechecked:** 1
- **FIXED:** 0
- **PARTIAL:** 0
- **NOT FIXED:** 1 (`F-KB-004`)
- **NEW DEFECTS:** 0
- **Blockers:** 0
