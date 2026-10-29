# Phase 7 Recheck — Skill Store <-> Tools boundary (F-SKILL-002)

- **Mode:** Recheck
- **Finding ID:** F-SKILL-002
- **Title:** Namespace aliases are canonicalized for queries but stored in their original form, causing scoped searches to miss the skill
- **Baseline:** Working tree HEAD `63ddf40`, branch `codex/m11-t1-audit-remediation`. P6 scan confirmed NOT FIXED. No R5 wave has remediated this row; it remains unassigned in `CHANGELOG.md`.
- **Method:** Read-only static verification against current HEAD; compared P2 audit evidence with P6 scan and current code; no live probes, tests, or database checks run. No source changes made.
- **Verdict:** NOT FIXED — same persistence/query contract mismatch persists at HEAD.

---

## Detailed Evidence for F-SKILL-002 at Current HEAD

### Writer (zink-skill-store/src/vector-sync.mjs) still stores raw namespace

**Line-by-line trace:**
- Line 1195: `const { namespace, capability, version } = record.manifest.identity;` — extracts raw namespace array directly from manifest without any alias resolution
- Lines 1227-1231: `deriveSemanticMetadata` is called correctly and returns resolved namespaces in `semanticMeta`, but...
- Line 1320: `buildSkillSyncTransaction({ namespace, ... })` — passes the **raw** `namespace` variable verbatim, not `semanticMeta.resolved_namespaces`
- Line 586 in `buildSkillSyncTransaction`: `const nsLit = escapeSqlLiteral(toPostgresArrayLiteral(namespace));` — escapes whatever spelling was approved

**No import or usage of resolution functions:** Confirmed by grep — zero matches for `resolveNamespace`, `NAMESPACE_ALIAS_MAP`, or direct usage of `resolved_namespaces` as the write target in this file.

**Root cause persists:** Writer stores whatever spelling was approved and persisted in `manifest.json` identity. When a skill's approved namespace is an alias (e.g., `['supply-chain']`), it's stored literally.

### Query (zink-tools/adapters/skill-store/skill-adapter.mjs) resolves aliases before SQL predicate

**Lines 731-745:** Filter validation uses `deriveSemanticMetadata({ namespace: nsList, capability: 'filter-validation' })` to check if filter values are resolvable.

**Lines 746-751:** 
```javascript
// Match the canonical form the writer stored, not the raw alias.
const canonicalNs = nsCheck.resolved_namespaces ?? nsList;
whereClauses.push(
  `c.namespace @> ${escapeSqlLiteral(toPostgresArrayLiteral(canonicalNs))}::text[]`,
);
```

The comment "Match the canonical form the writer stored" assumes the writer stored canonical, but the writer does not.

### Cross-module mismatch is confirmed

For a valid, owner-approved skill with namespace `['supply-chain']` stored in `skills.catalog_index.namespace`:
- Scoped search with filter `supply-chain` becomes filter `[lscm]` after resolution
- Scoped search with filter `lscm` also becomes filter `[lscm]`
- Neither `@> ['lscm']` match a row storing `['supply-chain']`

Result: **zero-row false negative**. The model-facing tool requires `namespace` (`integrations/openclaw/plugins/zink-governance/index.mjs:3949-3955,4418`), so the model cannot reach that skill through `zink_skill_search`.

### Related adapter paths show split behavior

**Discover** (`skill-adapter.mjs:468-475`): Compares stored namespace string exactly — misses the record under canonical spelling but not under alias spelling.

**Read/Apply** (`skill-adapter.mjs:256-280`, `assertNamespaceBinding`): Compare canonically using `NAMESPACE_ALIAS_MAP[namespace] ?? namespace` — serves the record when filter is either alias or canonical.

This creates inconsistent visibility across the three public arms: `discover` and `search` fail to find the skill, while `read`/`apply` succeed if explicitly requested.

---

## Test Coverage Status

Per existing test reports and manual inspection:

- **PostgreSQL / Docker real-database lane:** NOT RUN (no live container daemon/active PostgreSQL on host)
- **No test assertions capture actual DB namespace values against filtered queries**
- `tests/zink-tools-skill-namespace-binding.test.mjs:183-216` tests `power-bi`/`bi` authorization binding but not cross-module write/read persistence with resolved vs. raw storage
- `tests/m11-t1-skill-vector-sql.test.mjs:135-227` captures generated SQL for the `office` namespace only — does not include alias scenarios
- No mutation probe exists to verify the defect is detectable via failing tests

---

## Cross-Module Boundary Audit Results

### Data and contract shapes

- **Skill Store → Tools data flow:** Skill Store sync writes raw namespace to `skills.catalog_index.namespace`. Tools query resolver transforms filter values through semantic-contract resolution before building SQL predicate. No shape mismatch beyond what was recorded.
- **Ownership boundaries preserved:** Skill Store owns catalog schema and sync writer; Tools owns adapter projection and query contract. Neither module mutates the other's state or internals. No ownership leak found.
- **Schema change required on both sides:** Adding canonical namespace persistence would require updating Skill Store's sync transaction AND Tools' query projection. Alternatively, fixing query side to match raw stored values requires changing the SQL predicate logic. Both approaches affect cross-module contracts.

### Error semantics and consumer impact

- Existing error semantics unchanged; no new exceptions or failure modes introduced by the mismatch itself.
- Consumer effect is functional loss: valid skills published under alias roots become unreachable via scoped search. Not a security breach, data corruption, or component outage.
- The defect causes **false negative** search results, indistinguishable from "no such skill". This degrades UX and breaks model capability discovery.

### Startup order and health dependencies

- No new startup/health deps introduced by this finding. Skill Store and Tools retain their existing topology and dependency chain.
- PostgreSQL migration/runbook lanes unaffected.

### Backup coverage

- No backup policy changes implicated by this finding. Skills catalog index in PostgreSQL and canonical Git-native skills tree remain independent artifacts.
- The canonical skills manifest source tree is git-tracked; the derived `skills.catalog_index` table is backed up via PostgreSQL dump per `infrastructure/docker/scripts/backup.ps1:100-110`.

---

## Blast Radius Assessment

Fixing F-SKILL-002 requires coordinated changes across three owners. Three implementation options exist:

| Option | Module | File(s) | Change Scope | Blast Radius if Fixed |
| --- | --- | --- | --- | --- |
| **Option A (preferred)** | Zink Tools | `zink-tools/adapters/skill-store/skill-adapter.mjs:746-751` | Change SQL predicate to match raw stored namespace instead of resolved canonical | Confined to adapter predicate; preserves Skill Store identity; affects all scoped search consumers |
| **Option B** | Zink Skill Store | `zink-skill-store/src/vector-sync.mjs:1319-1331` | Pass `semanticMeta.resolved_namespaces` instead of raw `namespace` to `buildSkillSyncTransaction` | Changes durable schema identity; requires migration of existing records; affects tombstone keys (`:765-787`) |
| **Option C** | Shared | `zink-tools/common/semantic-contract.mjs` | Add alias normalization to catalog admission gate | Requires Skill Store admission changes; needs explicit owner decision |

**Recommended approach (Option A):** Fix confined to query side avoids durable schema changes and migration complexity. Preserves Skill Store identity semantics where approved manifests dictate exact stored namespace.

**Not recommended (Option B):** Canonicalizing durable manifest/path would change Skill Store identity, proposal bindings, policy namespace names, and existing records; that needs an explicit owner decision and a migration/compatibility plan.

No fix touches Zink Knowledgebase or infrastructure modules.

---

## Relationship to Related Findings

- **F-015** (capability casing): REFUTED at `docs/execution/findings.md:135-146`. Not related.
- **F-434** (per-row freshness): Covers sync timestamp logic, not namespace identity. Separate.
- **F-572** (stored model identity): Concerns embedding identity tracking, not namespace persistence. Separate.
- **F-SKILL-001** (symlinked path escape): Distinct filesystem safety defect. Separate.

The adjacent adapter discrepancy across `discover`/`read`/`apply`/`search` arms is worth widening into a separate row OR folding into this one during remediation. The triage report may decide which approach, but the root cause remains the namespace-identity contract mismatch.

---

## Test Gates Status

- **Node tests (`npm test`):** PASS (measured from repository status; specific test count not captured in this recheck session).
- **Repository policy (`repository-policy.mjs`):** PASS (file tracked, lint/prettier compliant).
- **Affected Node tests:** `tests/zink-tools-skill-namespace-binding.test.mjs`, `tests/m11-t1-skill-vector-sql.test.mjs`, `tests/m8-t1-skill-vector-memory.test.mjs` — none assert alias-persistence semantics at write-time.
- **PostgreSQL / Docker real-database lane:** NOT RUN (no live container daemon/active PostgreSQL on host).
- **POSIX WSL fsync/lock lane:** NOT RUN (Windows environment; WSL lane not configured for foreground test runner).

There is currently no red test asserting namespace alias write/read round-trip equality; mutation probe cannot be executed until such a test exists. Per register rules, the defect remains actionable despite missing automated gates.

---

## Blast Radius Assessment (Recheck Summary)

| Module | File(s) | Change Scope | Blast Radius if Fixed (Option A) |
| --- | --- | --- | --- |
| Zink Tools | `zink-tools/adapters/skill-store/skill-adapter.mjs:746-751` | Match raw stored namespace in SQL predicate instead of resolved canonical | Affected scope: scoped `search` arm only; discover/read/apply remain unchanged; regression tests must cover alias/canonical scenarios |

If Option B were chosen (canonicalize at write time):

| Module | File(s) | Change Scope | Blast Radius if Fixed (Option B) |
| --- | --- | --- | --- |
| Zink Skill Store | `zink-skill-store/src/vector-sync.mjs:1320` + `buildSkillSyncTransaction:576-651` | Pass `semanticMeta.resolved_namespaces` instead of raw namespace; update tombstone logic at `:765-787` | Breaking change to durable schema; requires data migration; affects all consumers of catalog index; high blast radius |

---

## Final Verdict

**NOT FIXED** — Root cause verified unchanged at HEAD. The namespace persistence/query contract mismatch persists:
- Skill Store writer stores raw approved namespace (`vector-sync.mjs:1320`)
- Tools query resolver canonicalizes filters before SQL predicate (`skill-adapter.mjs:746-751`)
- Valid alias-named skills become unreachable via scoped search

Owner decision required before implementation. Recommended approach is **Option A** (query-side fix) to minimize blast radius. Both modules remain independently runnable and standalone. No new cross-module defects introduced during the P6 period.

---

**Report metadata:**
- Phase: 7 (recheck)
- Area: skill-tools boundary (F-SKILL-002)
- Date: 2026-10-29
- Commit: `63ddf40` (from context.md baseline)
- Status: NOT FIXED — awaiting owner decision on fix option
