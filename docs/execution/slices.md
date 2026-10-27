# Audit roster and slices

This file is the approved source of truth for phase boundaries, roster size, slices, and fixer routing. Preserve the listed agent counts and routing unless the owner approves a change. Agent definitions are configured outside this repository at `%USERPROFILE%\.config\opencode\opencode.json`; read the actual configuration when validating agent names, model assignments, permissions, or routing. Do not assume an `opencode.json` exists in the repository. Before dispatch, the main agent must establish the real run in `docs/execution/context.md` and verify the task authorization and agent permissions.

## Phase 1 and 6: scanners (20)

| Agent          | Scope                                                                                                                           | Angle                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `scan-infra-1` | infrastructure/                                                                                                                 | Docker/Compose services, networks, volumes, healthchecks, startup order, resource ceilings                                |
| `scan-infra-2` | infrastructure/ and docs/runbooks/                                                                                              | env templates, secrets handling, backup/restore scripts, runbook vs reality                                               |
| `scan-kb-1`    | apps/knowledge/                                                                                                                 | ingestion, read-only source Vault handling, input trust boundary                                                          |
| `scan-kb-2`    | apps/knowledge/                                                                                                                 | indexing, embeddings, storage, persistence, migrations                                                                    |
| `scan-kb-3`    | apps/knowledge/                                                                                                                 | retrieval, provenance, citations, API surface                                                                             |
| `scan-skill-1` | zink-skill-store/                                                                                                               | learned-skill persistence and governance                                                                                  |
| `scan-skill-2` | zink-skill-store/                                                                                                               | scoped retrieval and API                                                                                                  |
| `scan-skill-3` | zink-skill-store/                                                                                                               | isolation from Knowledgebase indexes, backup/restore of its own state                                                     |
| `scan-tools-1` | zink-tools/                                                                                                                     | adapter contracts, schemas, input validation                                                                              |
| `scan-tools-2` | zink-tools/                                                                                                                     | capability execution (forecast, optimization, OR, simulation), resource limits                                            |
| `scan-tools-3` | zink-tools/                                                                                                                     | provider / n8n / OpenClaw boundary, timeouts, error semantics                                                             |
| `scan-oc-1`    | integrations/openclaw/lib/discord-formatter.mjs, integrations/openclaw/lib/discord-native-send.mjs                              | Discord formatting, native send, destination routing, fail-closed behavior                                                |
| `scan-oc-2`    | integrations/openclaw/lib/artifact-validator.mjs, integrations/openclaw/lib/excel-writer.mjs                                    | artifact validation, Excel writer, path safety, truthful execution status                                                 |
| `scan-oc-3`    | integrations/openclaw/lib/authority.mjs, decision-ledger.mjs, file-lock.mjs, policy.mjs, queue-manager.mjs, quota-telemetry.mjs | authority, policy, ledger, locking, queue, quota, idempotency                                                             |
| `scan-oc-4`    | `integrations/openclaw/topology/**` and `integrations/openclaw/orchestration/**`                                                | production graph main -> [o1,o2], o1 -> [excel,sql,python], o2 -> [power-bi,python]; task/run identity; state transitions |
| `scan-oc-5`    | integrations/openclaw/plugins/zink-governance/index.mjs                                                                         | governance plugin: guard, policy projection, spawn authorization, sandbox, provenance                                     |
| `scan-oc-6`    | integrations/openclaw/configure.mjs, integrations/openclaw/verify.mjs, integrations/openclaw/templates/**                       | setup, preflight, rollback gates, templates                                                                               |
| `scan-db-1`    | database definitions under infrastructure/                                                                                      | schema, migrations, init scripts                                                                                          |
| `scan-db-2`    | database definitions under infrastructure/ plus how apps use them                                                               | backup, restore, integrity, recovery                                                                                      |
| `scan-db-3`    | database definitions under infrastructure/ plus app data-access code                                                            | roles, credentials, network exposure, injection, transactions                                                             |

Files under `integrations/openclaw/` outside oc-1..oc-6 have no matching fixer: the lead reports them to the owner instead of assigning them.

## Phase 2 and 7: cross-checkers (12)

| Agent                      | Boundary                                                           | Focus                                                                                   |
| -------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `xcheck-kb-skill`          | Knowledgebase <-> Skill Store                                      | logical isolation of indexes; no shared mutable state                                   |
| `xcheck-kb-tools`          | Knowledgebase <-> Tools                                            | retrieval/citation contracts consumed by tools                                          |
| `xcheck-skill-tools`       | Skill Store <-> Tools                                              | scoped skill retrieval used by tools; governance of learned skills                      |
| `xcheck-tools-oc`          | Tools <-> integrations/openclaw                                    | hosting boundary and adapter contract; Tools stays a thin adapter                       |
| `xcheck-oc-gov-topo`       | OpenClaw governance (plugin + library) <-> topology/orchestration  | spawn authorization vs production graph; identity and state transitions                 |
| `xcheck-oc-discord-gov`    | OpenClaw Discord adapters <-> governance                           | channel authority, routing, identity/task lineage, fail-closed                          |
| `xcheck-oc-artifact`       | OpenClaw artifact validation/Excel writer <-> Tools and governance | provenance, integrity, protected paths, truthful status                                 |
| `xcheck-infra-kb`          | Infrastructure <-> Knowledgebase                                   | volumes, networks, env, ports, resource ceilings, health, startup order                 |
| `xcheck-infra-skill-tools` | Infrastructure <-> Skill Store and Tools                           | same checks for the two peer modules                                                    |
| `xcheck-infra-oc`          | Infrastructure <-> OpenClaw                                        | setup, templates, runtime config, deployment/preflight/rollback gates                   |
| `xcheck-db-all`            | Database <-> all modules                                           | schema ownership, access rights, who writes what, backup coverage of every module state |
| `xcheck-tests-all`         | tests/** <-> all modules                                           | coverage drift, stale fixtures, weakened assertions, required gates                     |

## Phase 3: triagers (12)

`triage-01` .. `triage-12`: the lead splits candidate findings into 12 buckets in ID order, one bucket each.

## Phase 5: fixer routing

| Area                                          | Fixer                                             |
| --------------------------------------------- | ------------------------------------------------- |
| `apps/knowledge/**`                           | `fix-knowledgebase`                               |
| `zink-skill-store/**`                         | `fix-skill-store`                                 |
| `zink-tools/**`                               | `fix-tools`                                       |
| Discord formatter, native send                | `fix-openclaw-discord-adapters`                   |
| artifact validator, Excel writer              | `fix-openclaw-artifact-validation`                |
| authority, policy, ledger, lock, queue, quota | `fix-openclaw-governance-library` (asks per edit) |
| topology, orchestration                       | `fix-openclaw-topology` (asks per edit)           |
| governance plugin                             | `fix-openclaw-governance-plugin` (asks per edit)  |
| configure, verify, templates                  | `fix-openclaw-setup-templates` (asks per edit)    |
| `tests/**`                                    | `fix-tests`                                       |
| `infrastructure/**`, database definitions     | `fix-infrastructure` (new, asks per edit)         |
