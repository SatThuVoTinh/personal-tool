# Phase 1 audit — infra-2

- **Mode:** Audit
- **Scope:** `infrastructure/` and `docs/runbooks/` — environment templates, secret handling, backup/restore scripts, and runbook accuracy
- **Baseline:** Working tree at dispatch, HEAD `85eb094` (per coordinated-run context); the tree was already dirty. Source remained read-only. The real `infrastructure/docker/env/.env` was discovered by filename only and was not opened or printed.
- **Checks:** Read scoped Compose/env templates, startup/preflight/credential helpers, PostgreSQL bootstrap, backup and backup-inspection scripts, Knowledge T5 recovery driver, runbooks, and relevant existing register/test evidence. No tests or Compose commands were run.

## Confirmed candidate

### CAND-infra-2-01 — Knowledge service receives PostgreSQL administrator credentials

- **Path:** `infrastructure/docker/compose/compose.core.yml:149-153`
- **Evidence:** The Knowledge container is assigned `KNOWLEDGE_DATABASE_NAME: postgres`, `KNOWLEDGE_DATABASE_USER: postgres`, and `KNOWLEDGE_DATABASE_PASSWORD: ${POSTGRES_PASSWORD:-unconfigured}`. The same Compose file initializes the PostgreSQL service with `POSTGRES_USER: postgres` (`:13-16`). The bootstrap creates a separate `n8n LOGIN` role (`infrastructure/docker/scripts/bootstrap-postgres.sh:28-38`), and the n8n service connects to database `n8n` as that role (`infrastructure/docker/compose/compose.core.yml:65-72`). With the standard PostgreSQL image initialization used here, the configured `POSTGRES_USER` is the database superuser; the application has no narrower credential configured.
- **Impact:** Any compromise of the Knowledge process or disclosure of its database credential grants administrator-level access to the shared PostgreSQL instance, including reading or changing n8n automation data and database roles. This defeats the separation represented by the dedicated n8n login and exposes the peer automation module to a Knowledge-service compromise.
- **Class:** 1 — security flaw
- **Severity:** High
- **Other modules touched:** Knowledgebase runtime; n8n automation database
- **Confidence:** High
- **Existing finding check:** No matching live finding was found in `docs/execution/findings.md` (searched for PostgreSQL superuser, database privilege, and Knowledge database credential references).

## Existing finding overlap — do not file as new

- The generic backup script’s empty/unreadable inventory being treated as a clean secret inspection is already covered by **F-558 (OPEN)**. At `infrastructure/docker/scripts/backup.ps1:123-136`, empty command output can flow into the inspection, and `backup-inspection.ps1:109-115` computes `plaintext_secrets_excluded` as true for an empty carrier set. F-558 already cites these lines and the false-certification impact; this audit found no distinct additional backup candidate in that mechanism.
- The runbook explicitly says restore automation is not implemented (`docs/runbooks/knowledge-platform.md:65`), so this is a disclosed limitation, not an evidenced runbook-versus-runtime defect.

## Out-of-scope pointers

- `integrations/openclaw/configure.mjs:1559-1561` — the homedir-only state-root refusal conflicts with the operator-named-root promise in `docs/runbooks/deploying-the-m12-t9-build.md:69-72`; already tracked as F-490.
- `integrations/openclaw/topology/fixtures/runtime-regression/operator-rollback.mjs:50-54` — rollback state-root input promise versus positional-argument parser refusal; already tracked as F-556 and cross-referenced by the same runbook at `docs/runbooks/deploying-the-m12-t9-build.md:69-72`.

## Hypotheses not reported

- The generic backup archive may require separately retained n8n encryption-key material for eventual recovery, but the current runbook explicitly states restore automation is absent and repository evidence does not establish the operator’s key-retention arrangement. No new data-loss finding is claimed.
