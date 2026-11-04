# Phase 1 audit — skill-2

- **Mode:** Audit; slice `zink-skill-store/`, scoped retrieval and API.
- **Baseline:** Dispatch-time working tree at HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`; the tree was already dirty per `docs/execution/context.md:19`.
- **Instructions:** Read root `AGENTS.md`, checked for nested `zink-skill-store/**/AGENTS.md` (none found), read the rules at the top of `docs/execution/findings.md`, and checked current register entries for overlap.
- **Review:** Static source and caller trace. Tests and live PostgreSQL probes were not run. No source files were changed.

## Confirmed candidates

None in the audit's four allowed classes (security; backup/restore or data loss; defects that stop component startup or runtime; whole-system outages).

## Reviewed behavior excluded from candidate counts

### Namespace-alias write/read mismatch — scoped false negative

- **Evidence:** The catalog accepts lowercase kebab-case namespace segments without resolving aliases (`zink-skill-store/src/catalog.mjs:337-347`). The proposal adapter permits alias roots through `VETTED_ROOT_NAMESPACES` (`zink-tools/adapters/skill-store/skill-adapter.mjs:83-95,1110-1137`). During sync, semantic metadata is derived from the namespace, but the transaction writes the original identity namespace (`zink-skill-store/src/vector-sync.mjs:1216-1220,575-576,622-627`). Query filters canonicalize aliases before generating `c.namespace @>` (`zink-tools/common/semantic-contract.mjs:477-486`; `zink-tools/adapters/skill-store/skill-adapter.mjs:720-751`). For a stored namespace `['supply-chain']`, both `namespace: 'supply-chain'` and `namespace: 'lscm'` produce a canonical `['lscm']` filter, which cannot match the stored array. The shared alias map explicitly resolves `supply-chain` to `lscm` (`zink-tools/common/semantic-contract.mjs:36-44,203-210`).
- **Concrete reproduction/probe:** Promote a valid skill with identity namespace `['supply-chain']`, sync it, then issue scoped semantic searches with `namespace: 'supply-chain'` and `namespace: 'lscm'`. The writer persists `['supply-chain']`; each filter becomes `c.namespace @> '{"lscm"}'::text[]`, so neither finds the row. An unscoped query omits the namespace predicate. This is a static path proof; no PostgreSQL probe was run.
- **Disposition:** Confirmed scoped retrieval false negative, excluded because the demonstrated impact does not fit the audit's four permitted classes. It does not expose another namespace's records, delete canonical or derived data, stop component operation, or affect the system beyond matching searches. The register search found no existing row for this specific mismatch; nearby `F-015` is about capability normalization and is REFUTED (`docs/execution/findings.md:135-146`), while `F-434` and `F-572` concern freshness and embedding identity.
- **Modules involved:** Skill Store catalog and vector writer; Zink Tools shared semantic contract and Skill Store adapter. The defect mechanism includes the in-scope Skill Store writer.

## Reviewed without a new candidate

- Catalog reads fail closed on catalog diagnostics; `getActiveSkill` returns no skill on catalog errors (`zink-skill-store/src/catalog.mjs:953-963`).
- Vector sync snapshots eligible ACTIVE records under the writer lock and rechecks lifecycle before committing READY rows (`zink-skill-store/src/vector-sync.mjs:851-867,1264-1323`).
- Existing register item `F-565` already covers the injected database executor bypassing the server-side statement timeout (`docs/execution/findings.md:1864-1874`); not re-reported.

## Out-of-scope pointers

None. Cross-module adapter and semantic-contract lines above were used only to confirm the alias behavior; the evidence does not meet the allowed finding classes.

## Counts

- Critical: 0
- High: 0
- Medium: 0
- Low: 0
- Candidates: 0
- Confirmed observations excluded by audit class: 1
- Hypotheses: 0
- Out-of-scope pointers: 0
- Blockers: none
