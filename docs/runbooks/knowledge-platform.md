# Knowledge Platform Runbook

## Scope

This runbook operates the accepted Knowledgebase runtime. It mounts the
human-owned Obsidian Vault read-only and indexes Markdown from 01. Knowledge
plus contract-valid PDF sidecars from 02. Books and 03. Papers. It does not
authorize Vault writes, database edits or automatic rollback of an index.

## Preconditions

- Docker Desktop and Docker Compose are available.
- Ollama exposes the configured embedding model at 127.0.0.1:11434.
- KNOWLEDGE_VAULT_ROOT is an absolute path with 01. Knowledge.
- The ignored environment file contains non-placeholder PostgreSQL/n8n secrets.

## Start and stop

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/preflight.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

The operational endpoint is [http://127.0.0.1:8080/knowledge](http://127.0.0.1:8080/knowledge). Stop without
deleting named volumes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

## Index and retrieval

The implemented index kinds are FULL_REBUILD and INCREMENTAL:

```powershell
$body = @{ kind = "FULL_REBUILD" } | ConvertTo-Json -Compress
$run = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8080/knowledge/v1/index-runs -ContentType application/json -Body $body
Invoke-RestMethod -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs/$($run.index_run_id)"
```

Use the API contract implemented in apps/knowledge for search request fields.
No Tool API, Skill Store API, OpenClaw adapter, recovery convenience command or
n8n workflow is introduced by M5/T1-R2.

## Logs and backup

Dozzle at [http://127.0.0.1:9999](http://127.0.0.1:9999) is a loopback-only log viewer. It is not a
metrics/observability platform.

The retained backup script creates a non-overwriting PostgreSQL/n8n backup only
after n8n has been stopped:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/backup.ps1 -BackupDirectory C:/safe/empty/backup -EnvironmentFile ./infrastructure/docker/env/.env
```

The manifest's `plaintext_secrets_excluded` field is computed by inspecting the
archives the run has just produced: the n8n home archive is listed and every
database dump is read with `pg_restore --list`. Its companion
`secret_inspection` field records what that inspection found, including the
credential-bearing database objects the dumps carry, so the claim can be
audited instead of believed.

Restore automation is not implemented in the current runtime contract.
