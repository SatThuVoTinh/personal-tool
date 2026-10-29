# Phase 7 Recheck — Knowledgebase <-> Tools boundary (F-KB-004)

- **Mode:** Recheck
- **Finding ID:** F-KB-004
- **Title:** citation and chunk API responses omit index status and stable chunk ordinal supplied by the database
- **Baseline:** Working tree HEAD `63ddf40`, branch `codex/m11-t1-audit-remediation`. P6 scan confirmed NOT FIXED. Owner decision required (RED row), not assigned to any R5 fix wave.
- **Method:** Read-only static verification against current HEAD; compared p2 audit evidence with current code; no live probes, tests, or database checks run. No source changes made.
- **Verdict:** NOT FIXED — same serialization omission persists at HEAD.

---

## Detailed Evidence for F-KB-004 at Current HEAD

### Knowledgebase API serializers still omit fields

- `/v1/chunk/{segment_id}` row construction (`apps/knowledge/app/main.py:958-977`): builds dict with `segment_id`, `chunk_id`, `index_id`, `indexed_by_run_id`, source fields, title/text/span/citation. Does **not** include `record.index_status` or `record.chunk_ordinal` loaded by `get_segment`.
- `/v1/citation/{segment_id}` row construction (`apps/knowledge/app/main.py:998-1027`): identical field set, still omits `index_status` and `chunk_ordinal`.
- `/v1/metadata/{segment_id}` row construction (`apps/knowledge/app/main.py:1039-1068`): also omits both fields.
- Database loader supplies them (`apps/knowledge/app/database.py:1961-1967`): `SegmentRecord` includes `index_status` and `chunk_ordinal`, but HTTP response dicts never project them.

### Tools adapter projection lacks these fields

- Adapter formatter (`zink-tools/adapters/knowledge/knowledge-adapter.mjs:775-822`): maps only declared fields; does not map `index_status` or `chunk_ordinal`. The upstream properties are absent from Knowledge's serialized rows, so even if added downstream they would be unmapped here.

### Contract schema rejects unknown fields

- Output schema (`zink-tools/contracts/tools/zink-knowledge.schema.json:85-119`): declares metadata and result members with `"additionalProperties": false` at lines `:114` and `:118`. There is **no** `index_status` or `chunk_ordinal` declaration, so any extension must update this closed contract.

### Relationship to F-573 and F-071 remains unchanged

- F-573 (loader half closed per CHANGELOG.md:2160-2161): its closure claim that a caller can distinguish superseded hits and re-derive `(index, source digest, ordinal)` requires status + ordinal on the public API, which remain omitted. This finding has not been remediated.
- F-071 (routes exist; envelope mapping incomplete): top-level `index_id`/`indexed_by_run_id` are returned by endpoints (`main.py:978-984,1028-1034`) and admitted in the schema, but the Tools formatter drops them (`knowledge-adapter.mjs:716-822`). That seam is separate from the F-573 status/ordinal omission covered by F-KB-004.

---

## Cross-Module Boundary Audit Results

### Data and contract shapes

- **KB → Tools data flow:** KB returns `index_id`/`indexed_by_run_id` at the endpoint level; tools adapter receives result rows and projects a fresh object without copying those top-level values. Status and ordinal are omitted earlier at KB serialization. No shape mismatch beyond what was recorded.
- **Ownership boundaries preserved:** Knowledgebase owns API serialization of status/ordinal; Tools owns its projection and output contract. Neither module mutates the other's state or internals. No ownership leak found.
- **Schema change required on Tools side:** Adding these fields would require a versioned update to the closed 1.1.0 Tools schema and adapter regression tests.

### Error semantics and consumer impact

- Existing error semantics unchanged; no new exceptions or failure modes introduced by the omission itself. Consumer effect is informational loss (cannot infer liveness or ordinal after segment deletion), not behavioral breakage.

### Startup order and health dependencies

- No new startup/health deps introduced by this finding. KB and Tools retain their existing topology and dependency chain.

### Backup coverage

- No backup policy changes implicated by this finding. KB database and Tools config remain independent artifacts.

---

## Blast Radius Assessment

Fixing F-KB-004 requires coordinated changes across three owners:

| Module | File(s) | Change Scope | Blast Radius if Fixed |
| --- | --- | --- | --- |
| Zink Knowledgebase | `apps/knowledge/app/main.py:958-977,998-1026,1039-1068` | Add `index_status`, `chunk_ordinal` to serializer rows | Public API change; breaks consumers that assume absence; requires regression tests |
| Zink Tools | `zink-tools/adapters/knowledge/knowledge-adapter.mjs:775-822` | Project the new fields into Tools envelope | Projection contract change; affects all governed consumers of the Tool |
| Zink Tools Contracts | `zink-tools/contracts/tools/zink-knowledge.schema.json:85-119` | Add fields with validation; keep `additionalProperties:false` intact | Version bump of declared output contract; adapter/tests must pass |

No fix touches Zink Skill Store or infrastructure modules.

---

## Test Gates Status

- **Knowledgebase tests (`test:knowledge`):** PASS (311 passed, 18 skipped, 31 subtests passed in 54.67s) — Per P6 test report.
- **Repository policy (`repository-policy.mjs`):** PASS (1 suite, 1 test passed).
- **Affected Node tests:** Not specifically failing due to F-KB-004 (row unassigned to fixer waves).
- **PostgreSQL / Docker real-database lane:** NOT RUN (no live container daemon/active PostgreSQL on host).
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows environment; WSL lane not configured for foreground test runner).

There is currently no red test asserting `index_status`/`chunk_ordinal` presence in HTTP responses; mutation probe cannot be executed until such a test exists.

---

## Final Verdict

**NOT FIXED** — Root cause verified unchanged at HEAD. The KB API serializer omission persists; Tools adapter projection and closed schema have not been updated. Owner decision required before implementation (RED). Fix would touch Knowledgebase HTTP layers, Tools adapter and schema. Both modules remain independently runnable and standalone. No new cross-module defects introduced during the P6 period.
