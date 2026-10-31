# Phase 6 Recheck Report — Skill Store (F-SKILL-002)

## Finding Verification: F-SKILL-002

**Verdict: NOT FIXED**

### Evidence

**Original Finding Summary:**

- Issue: Namespace aliases are stored in their original form while scoped searches canonicalize them, causing valid alias-named skills to be unreachable via both raw alias and canonical filter queries
- Path: Writer stores raw; query resolves aliases; mismatch yields zero-row results

**Current Code State:**

**Writer (zink-skill-store/src/vector-sync.mjs):**

- Line 1195: `const { namespace, capability, version } = record.manifest.identity;` — extracts raw namespace directly from manifest without resolution
- Line 1320: `namespace` passed verbatim to `buildSkillSyncTransaction({ namespace, ... })`
- No import or usage of `resolveNamespace`, `NAMESPACE_ALIAS_MAP`, or `CANONICAL_DOMAINS` in this file
- Confirmed by grep: zero matches for namespace resolution functions in `vector-sync.mjs`

**Query (zink-tools/adapters/skill-store/skill-adapter.mjs):**

- Lines 746-747: `const canonicalNs = nsCheck.resolved_namespaces ?? nsList;` — explicitly resolves aliases to canonical form before building SQL predicate
- Lines 748-751: Uses `canonicalNs` array for `@>` SQL operator

**Root Cause Persists:**
Writer stores whatever spelling was approved and persisted in `manifest.json` identity. Query always transforms filter values through semantic-contract resolution. When a skill's approved namespace is an alias (e.g., `["supply-chain"]`), it's stored literally but never matched by a scoped search using either the alias or its canonical target (`lscm`).

### Test Coverage

Per `docs/execution/reports/p6/tests.md`:

- PostgreSQL / Docker real-database lane: **NOT RUN**
- No test assertions capture actual DB namespace values against filtered queries
- `tests/zink-tools-skill-namespace-binding.test.mjs:183-216` tests `power-bi`/`bi` authorization binding but not cross-module write/read persistence with resolved vs. raw storage

### Conclusion

The fix requires canonicalizing namespace arrays in the writer path (vector-sync.mjs) before persisting to `skills.catalog_index.namespace`. This would require importing `deriveSemanticMetadata` or equivalent resolution logic from semantic-contract.mjs and using `resolved_namespaces` instead of raw input when writing the transaction.

No code changes were made to address this defect between audit and recheck phases.

---

**Report metadata:**

- Phase: 6 (recheck)
- Area: skill-2 (Skill Store)
- Date: 2026-10-29
- Commit: 63ddf40 (from p6/tests.md)
