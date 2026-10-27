# Phase 1 audit — kb-3

- **Mode:** Audit; slice `apps/knowledge/`, retrieval, provenance, citations and API surface.
- **Baseline:** Dispatch-time working tree at HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; the tree was already dirty. In-scope source diffs include the NFC path changes described below.
- **Instructions:** Read root `AGENTS.md`, `docs/execution/context.md`, the top rules and live register in `docs/execution/findings.md`, and checked for nested `apps/knowledge/**/AGENTS.md` (none found).
- **Review:** Static source, SQL, API, tests and caller inspection. No tests or database probes were run.

## Confirmed candidates

### CAND-kb-3-01 — NFC-normalizing source paths collapses distinct canonical-equivalent filenames into one indexed row

- **Severity:** Medium
- **Path:** `apps/knowledge/app/database.py:1995-2006`
- **Evidence:** `IndexLifecycle.execute` iterates every scanned Markdown source and calls `replace_source` for each one (`apps/knowledge/app/index_lifecycle.py:220-235`). The scanner obtains each candidate's relative path without Unicode normalization and retains each discovered file (`apps/knowledge/app/markdown_adapter.py:296-337,368-374`). `replace_source` now normalizes each path to NFC (`database.py:1995-1996`), deletes any existing source at that normalized path (`:1999-2006`), then inserts the new source using that same path (`:2007-2024`; segment rows also receive it at `:2033-2041`). The schema's unique key is `(index_id, source_path)` (`apps/knowledge/migrations/001_initial.sql:81`). Thus two separate files whose names differ only by canonical Unicode composition are mapped to one key; processing the later file deletes the earlier source and its segments. The loop counts each successful replacement as indexed (`index_lifecycle.py:233-235`), so the run can report both while only one remains searchable. The new NFC regression test covers one NFD source and an NFC stored path, but not two distinct paths that normalize to the same value (`apps/knowledge/tests/test_m12_t9_r4_f576_source_path_form.py:127-157,292-371`).
- **Concrete reproduction:** On a filesystem that permits both names (for example Linux ext4), create two Markdown files under the Knowledge root with relative paths `01. Knowledge/Café/a.md` (NFC) and `01. Knowledge/Café/a.md` (NFD; `e` plus combining acute), and give them different valid contents. Start a full rebuild. The scanner returns both entries; both writes target the same NFC `source_path`, and the second `DELETE` cascades away the first source and its segments. The published index contains only one of the two documents even though the run processed both. The Vault itself is not modified by this reproduction.
- **Impact:** One valid source silently disappears from retrieval and citation whenever the corpus contains two distinct names that normalize to the same NFC path; reported indexed counts can overstate the retained source set.
- **Class:** 2 — data-loss flaw (derived indexed evidence is discarded).
- **Other modules touched:** Knowledgebase scanner and index lifecycle; schema uniqueness in `apps/knowledge/migrations/001_initial.sql`.
- **Confidence:** Medium — deterministic for filesystems preserving both Unicode spellings; exact reachability depends on the Vault filesystem.
- **Register check:** Related but distinct from live `F-576` (`docs/execution/findings.md:1903-1914`), which concerns matching a single NFD source to an NFC prefix. F-576 does not cover collisions between two distinct source paths after writer normalization.

### CAND-kb-3-02 — citation and chunk routes discard index status and stable chunk ordinal

- **Severity:** Medium
- **Path:** `apps/knowledge/app/main.py:958-976`
- **Evidence:** `KnowledgeDatabase.get_segment` selects the resolved index status and segment ordinal (`apps/knowledge/app/database.py:1905-1913`) and returns them as `SegmentRecord.index_status` and `.chunk_ordinal` (`:1961-1967`). The `/v1/chunk/{segment_id}` serializer omits both fields from its result row (`main.py:958-976`); `/v1/citation/{segment_id}` also omits them (`:998-1025`). These lookups can resolve a superseded index because `get_segment` joins by segment ID and index but does not restrict index status (`database.py:1914-1925`). The repository's stated purpose for the loader fields is that a caller can distinguish a superseded citation and re-derive a segment after its surrogate ID is removed (`CHANGELOG.md:2160-2161`), but API callers cannot receive the status or the ordinal needed for that stable identity.
- **Concrete reproduction:** Given a segment ID from a superseded index, issue `GET /v1/chunk/<segment-id>` or `GET /v1/citation/<segment-id>`. Inspect `results[0]`: it includes `index_id` and source identity, but no `index_status` or `chunk_ordinal`, despite those values being present in the database record. After the old segment is removed during superseded-index cleanup, the caller has no ordinal to re-derive it.
- **Impact:** A caller that receives a citation from a superseded index cannot determine its status from the citation response or reconstruct the referenced segment from the durable `(index, source revision, ordinal)` identity after reindex cleanup.
- **Class:** 2 — provenance/data-loss flaw.
- **Other modules touched:** Public Knowledgebase HTTP API consumers; no external source change is needed to reproduce.
- **Confidence:** High — direct serializer omission; the database record carries both values.
- **Register check:** Closely related to closed `F-573` (`CHANGELOG.md:2160-2161`), whose closure says callers can tell the index status and re-derive the segment. The loader portion exists, but the API serializer still withholds both fields; lead should decide whether this is an incomplete closure or a separate API-layer finding.

## Reviewed without a new candidate

- Search request scope is normalized and passed into both SQL branches; unknown namespace/topic scope fails closed (`apps/knowledge/app/main.py:655-725`, `apps/knowledge/app/retrieval.py:133-202`, `apps/knowledge/app/database.py:1710-1723`).
- The search result includes source ID, source digest and source span, and renders Markdown/PDF citations from the corresponding line/page fields (`apps/knowledge/app/main.py:788-849`). PDF digest projection resolves to the file digest in both search and segment readers (`apps/knowledge/app/database.py:1807-1848,1936-1943`); this matches closed `F-512` in `CHANGELOG.md:2157-2158`.
- Search completeness exposes retained count, page count, truncation and candidate-pool size (`apps/knowledge/app/main.py:231-263,869-881`). The retrieval ceiling behavior has explicit current coverage; the old register premise at `docs/execution/findings.md:265-275` is marked REFUTED.
- Path-prefix NFC mismatch is addressed in the dirty working tree by normalizing writes and both sides of SQL path comparisons (`apps/knowledge/app/database.py:32-41,1715-1718,1995-2024,2093-2123`); its distinct-name collision is CAND-kb-3-01 above.
- No other confirmed defect in the retrieval/provenance/API slice had exact evidence.

## Out-of-scope pointers

None identified.

## Counts

- Critical: 0
- High: 0
- Medium: 2
- Low: 0
- Candidates: 2
- Blockers: none
