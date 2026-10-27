# Phase 1 audit — kb-1

- **Scope:** `apps/knowledge/`; ingestion, read-only source Vault handling, input trust boundary.
- **Mode:** Audit; dispatch-time working tree at HEAD `85eb094` with pre-existing changes.
- **Outcome:** 1 confirmed candidate (Medium); no blockers.
- **Checks:** Read root `AGENTS.md`, coordination context, slices, findings rules/register, scoped ingestion code/tests, and relevant database/migration callers. Static inspection only; no tests or live Vault access. Source files were already dirty at dispatch per the coordinator baseline.

## Confirmed findings

### CAND-kb-1-01 — oversized PDF sidecars are silently omitted, so a successful incremental run deletes the previously indexed PDF source

- **Severity:** Medium.
- **Class:** 2 — backup/restore/data-loss.
- **Path:** `apps/knowledge/app/pdf_foundation.py:255-263`; lifecycle and deletion path: `apps/knowledge/app/index_lifecycle.py:206-219,418-435`; `apps/knowledge/app/database.py:2202-2211`.
- **Evidence:** `discover_pdf_sidecars` enumerates sidecars under the approved roots at `pdf_foundation.py:255`; for any sidecar whose stat size exceeds `MAX_SIDECAR_BYTES`, it executes `continue` at `:261-263`. It emits no per-source error and does not return that PDF's source path. `IndexLifecycle.execute` builds the manifest only from successfully scanned Markdown and returned PDF sidecars at `index_lifecycle.py:210-219`. If the scan otherwise succeeds, the incremental path calls `complete_incremental` with `set(existing).difference(manifest)` at `:418-435`. `KnowledgeDatabase.complete_incremental` deletes those stale source paths at `database.py:2202-2211`. The source row owns the indexed segments and sidecar details through cascading foreign keys (`apps/knowledge/migrations/001_initial.sql:87-95,136-140`; PDF details cascade from source at `apps/knowledge/migrations/002_pdf_ingestion_foundation.sql:71-79`), so the previously indexed PDF disappears from retrieval and its derived index rows are deleted. The PDF bytes and sidecar remain in the read-only Vault.
- **Concrete reproduction/probe:** First index a valid PDF and a valid sidecar such as `02. Books/topic/book.md` containing one visible embed for `book.pdf`. Then enlarge only that sidecar beyond 64 KiB while preserving its embed and required topic tag. Run an incremental indexing cycle. Discovery skips the sidecar at `pdf_foundation.py:261-263` without setting an error; the manifest omits `02. Books/topic/book.pdf`; the existing PDF path is classified stale and deleted by the incremental publication at `database.py:2202-2211`, cascading to its segments. This is a static call-path probe; it was not executed against a Vault or database.
- **Impact:** A routine incremental run can remove an unchanged PDF's searchable record and derived segments solely because its sidecar crosses the size ceiling. Restoring a valid sidecar and reindexing can rebuild derived data, but until then the source is silently absent from retrieval. A full rebuild also silently omits that PDF.
- **Other modules touched:** Zink Knowledgebase database schema/persistence (`apps/knowledge/migrations/001_initial.sql:87-95,136-140`; `apps/knowledge/migrations/002_pdf_ingestion_foundation.sql:71-79`). No other module is implicated.
- **Confidence:** High.
- **Duplicate check:** No matching open finding was found in `docs/execution/findings.md`. Existing `F-440` is distinct: it refuses an oversized PDF itself before hashing and records a discovery error; it does not cover an oversized sidecar being silently skipped and then treated as stale during a successful incremental run. `F-443`/`F-444` are not live headings in the current register.

## Hypotheses

None promoted; no evidence-backed ingestion/security candidate beyond the confirmed item above.

## Out-of-scope pointers

None identified.
