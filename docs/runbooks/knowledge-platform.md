# Knowledge Platform Runbook

## Scope

This runbook operates the M3 Markdown Knowledge Platform. It indexes only
`01. Knowledge/**/*.md` from an external Obsidian Vault mounted read-only.
It does not authorize PDF ingestion, Vault writes, direct database edits, or
automatic rollback of a published index.

## Prerequisites

- Docker Desktop and the M2 runtime environment are healthy.
- Ollama has `bge-m3:latest` available with 1024 embedding dimensions.
- `KNOWLEDGE_VAULT_ROOT` in the ignored environment file is an absolute Vault
  path containing `01. Knowledge`.
- The Vault has no nested symlink, junction, or reparse point.
- Before any RealVault acceptance, pause Obsidian writes, sync clients, and
  every other writer until the final tree-hash check completes.

## Build and start

Build the exact clean Git candidate. This requires a clean working tree and
sets the Knowledge OCI image revision to the current HEAD SHA.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Start the dedicated operational unit:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Stop it without removing named volumes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -Profile knowledge -EnvironmentFile ./infrastructure/docker/env/.env
```

Knowledge remains internal to Docker. Use Nginx at
`http://127.0.0.1:8080/knowledge` for health, readiness, index runs, and
search.

## Index operations

Create an initial full rebuild:

```powershell
$body = @{ kind = "FULL_REBUILD" } | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body -Uri "http://127.0.0.1:8080/knowledge/v1/index-runs"
```

Use `GET /knowledge/v1/index-runs/<id>` until the run is terminal. Use an
incremental run only after an ACTIVE index exists. A full rebuild atomically
publishes a new ACTIVE index and supersedes the prior one.

Search through `POST /knowledge/v1/search`. Preserve and render the returned
Markdown citation; its line range refers to the original source file.

## M3/T5 acceptance

Run the intentional failure-cleanup gate first. It must fail with the injected
error and leave no resource carrying that run ID:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5.ps1 -Mode Fixture -EnvironmentFile ./infrastructure/docker/env/.env -InjectFailureAfterStart
```

Then run the fixture gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5.ps1 -Mode Fixture -EnvironmentFile ./infrastructure/docker/env/.env
```

Then run isolated RealVault acceptance with a valid canonical source path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5.ps1 -Mode RealVault -EnvironmentFile ./infrastructure/docker/env/.env -VaultRoot "C:/Vault" -Query "What is safety stock?" -ExpectedSourcePath "01. Knowledge/Supply Chain/safety-stock.md"
```

The script writes ignored local evidence to `temp/knowledge-t5/evidence/`.
Do not commit it. It includes private Vault paths, query input, checksums, and
recovery locations.

Only after isolated RealVault PASS, while the Vault remains quiescent, run the
persistent live gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5-live.ps1 -EnvironmentFile ./infrastructure/docker/env/.env -VaultRoot "C:/Vault" -Query "What is safety stock?" -ExpectedSourcePath "01. Knowledge/Supply Chain/safety-stock.md" -ConfirmPersistentIndex
```

The live gate refuses to mutate Knowledge state unless it finds a matching
isolated PASS artifact for the same canonical Vault root, tree hash, query,
source path, image candidate, model identity, and migrations.

After live PASS, `temp/knowledge-t5/evidence/accepted-candidate.json` freezes
the accepted repository SHA and candidate-source digest. Any later change to
Knowledge code, Compose, migrations, acceptance scripts, tests, or this
runbook invalidates that runtime evidence and requires all gates to run again.

After the implementation PR is merged without squash/rebase and CI/Security
have passed on `main`, verify the frozen candidate against remote main:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5-remote.ps1
```

This writes ignored sanitized `remote-gate.json`. Only its non-private status,
repository SHA, workflow URLs, image/model identities, and migration version may
be copied into remote-backed documentation.

## Recovery

The live gate creates an ignored schema-only recovery point in
`backups/knowledge-t5/<run-id>/` before migration or rebuild. If post-publish
acceptance fails, it leaves operational volumes untouched and records the
previous and new ACTIVE index IDs in local evidence.

Do not attempt a status-only rollback. Stop Knowledge, create a safety dump of
the current `knowledge` schema, then restore the recorded custom-format schema
dump with an explicitly reviewed `pg_restore --clean --if-exists
--schema=knowledge` operation. If the recovery manifest says the schema was
absent, drop only the `knowledge` schema after explicit review and restart the
service to recreate it. Re-run readiness and a cited search afterward.

## Safe errors

- `EMBEDDING_MODEL_DRIFT`: restore the exact Ollama model digest or create a
  new full rebuild after reviewing the change.
- `NO_ACTIVE_INDEX`: create a full rebuild.
- `INDEX_RUN_ALREADY_ACTIVE`: wait for the current run; do not run another.
- `SEARCH_CAPACITY_EXCEEDED`: retry later; do not increase concurrency during
  M3.
- `RERANKER_UNAVAILABLE`: rebuild the provenanced Knowledge image and inspect
  its pinned artifact manifest.
