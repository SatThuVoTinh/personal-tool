# Knowledge Platform Runbook

## Scope

This runbook operates the M4 Markdown/PDF Knowledge Platform. It indexes
`01. Knowledge/**/*.md` plus contract-valid PDF sidecars under `02. Books` and
`03. Papers` from an external Obsidian Vault mounted read-only.
Folder names below `01. Knowledge` are organizational and may use personal
numbering. Each indexed note instead requires at least one lowercase canonical
native tag; the first canonical tag determines `primary_topic`.
Each PDF requires one valid Markdown sidecar and an exact internal embed target.
Exactly one visible internal PDF embed identifies a sidecar; Markdown with zero
or multiple visible PDF embeds is ignored by PDF discovery. A sidecar H1 is used
as its title when present, otherwise the Markdown filename stem is used. No
`zink_source` marker is required. A basename-only Obsidian PDF embed is accepted
only when that exact filename resolves to one safe PDF anywhere inside the
read-only Vault; missing or ambiguous basename targets fail closed. Markdown
discovery remains limited to Books and Papers.
It does not authorize image/video ingestion, Vault writes, ad-hoc database
edits, or automatic rollback of a published index.

## Prerequisites

- Docker Desktop and the M2 runtime environment are healthy.
- Ollama has `bge-m3:latest` available with 1024 embedding dimensions.
- `KNOWLEDGE_VAULT_ROOT` in the ignored environment file is an absolute Vault
  path containing `01. Knowledge`.
- The Vault has no nested symlink, junction, name-surrogate, or unknown reparse
  point. Recognized Microsoft Cloud Files placeholders are allowed only when
  they resolve inside the canonical Vault root.
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

Search through `POST /knowledge/v1/search`. Optional `source_types` accepts
`MARKDOWN` and `PDF`. Preserve the returned citation: Markdown citations use an
original line range, while PDF citations use page ranges and an encoded
`#page=N` fragment.

## M4/T5 validation boundary

M4 was locally accepted at immutable candidate
`0a64b0bcedb31d9e8c84c62bfc321e500fae72e8` using focused/full repository
checks, isolated Fixture/T3/T4 acceptance, and representative RealVault proof
covering five distinct PDFs through extraction, embedding, READY transition,
and atomic publication. The former all-PDF disposable rebuild and persistent-
live acceptance are not operator prerequisites and must not be run merely to
start or use Knowledge.

Normal operation uses the build, start, index, status, search, and stop commands
above. A full operational index is initiated by the owner when current Vault
content should be published; it is not an automatic acceptance side effect.
Private local evidence remains outside the repository and must never be copied,
uploaded, logged, or committed. Remote CI/Security backing, if required later,
is a separate owner-controlled closeout and is not implied by local validation
or a branch push.

## Recovery

The optional `knowledge-t5-live.ps1` recovery-acceptance path, when separately
owner-authorized, creates exactly one private, run-scoped, Knowledge-schema
logical recovery point under
`%LOCALAPPDATA%/ZinkKnowledge/recovery/m4/<run-id>/` by default. It is not
required for normal indexing. `-BackupBase` may select another owner-approved,
non-reparse private root outside the repository. The recovery point contains the
migration ledger and all Knowledge data required to recover the prior ACTIVE state. The
archive and manifest are always potentially secret-bearing private Knowledge
data: do not print, upload, mount elsewhere, or commit them. M4 automation never
deletes or overwrites an existing recovery point; retention is owner-controlled.

The acceptance gate verifies archive inventory, checksum, PostgreSQL/pgvector
compatibility, structural catalog, migration ledger, prior ACTIVE identity,
recovery-critical metadata digests, counters, and sequence/identity state in a
network-isolated disposable database. Restore intentionally uses `--no-owner
--no-acl`; ownership/ACL are validated separately and excluded from the
structural fingerprint.

Do not attempt a status-only or destructive live restore. An actual operational
restore requires a separate explicit owner authorization for the exact recovery
point and destination. Follow the existing M3 procedure only after creating a
new safety dump, verifying the private manifest/checksum, stopping writers, and
reviewing the exact `pg_restore --clean --if-exists --schema=knowledge` target.
The restore command must hard-reject the current live DSN unless that separate
recovery authorization explicitly names it. Re-run readiness, one-ACTIVE proof,
and combined cited Markdown/PDF retrieval afterward.

## Safe errors

- `EMBEDDING_MODEL_DRIFT`: restore the exact Ollama model digest or create a
  new full rebuild after reviewing the change.
- `NO_ACTIVE_INDEX`: create a full rebuild.
- `INDEX_RUN_ALREADY_ACTIVE`: wait for the current run; do not run another.
- `SEARCH_CAPACITY_EXCEEDED`: retry later; do not increase concurrency during
  M4.
- `RERANKER_UNAVAILABLE`: rebuild the provenanced Knowledge image and inspect
  its pinned artifact manifest.
