# Knowledge Platform Runbook

## Scope

This runbook operates the M4 Markdown/PDF Knowledge Platform. It indexes
`01. Knowledge/**/*.md` plus contract-valid PDF sidecars under `02. Books` and
`03. Papers` from an external Obsidian Vault mounted read-only.
Folder names below `01. Knowledge` are organizational and may use personal
numbering. Each indexed note instead requires at least one lowercase canonical
native tag; the first canonical tag determines `primary_topic`.
Each PDF requires one valid Markdown sidecar and an exact internal embed target.
PDF discovery is driven by a visible internal PDF embed; ordinary Markdown under
Books/Papers without one is ignored, and no `zink_source` marker is required.
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

## M4/T5 exact-candidate acceptance

Create the reviewed implementation candidate commit before these commands.
Every command below must run on that unchanged clean SHA. A code, test,
configuration, runtime, lock, or candidate-path change invalidates the candidate
and restarts the complete acceptance sequence.

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

The script writes private local evidence under
`%LOCALAPPDATA%/ZinkKnowledge/evidence/m4-t5/`, outside the repository and its
OneDrive tree. Do not copy or upload it. It includes private Vault paths, query
input, checksums, and recovery identifiers.

Only after isolated RealVault PASS, while the Vault remains quiescent, run the
persistent live gate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5-live.ps1 -EnvironmentFile ./infrastructure/docker/env/.env -VaultRoot "C:/Vault" -Query "What is safety stock?" -ExpectedSourcePath "01. Knowledge/Supply Chain/safety-stock.md" -ConfirmPersistentIndex
```

The live gate refuses to mutate Knowledge state unless it finds a matching
isolated PASS artifact for the same canonical Vault root, tree hash, query,
source path, image candidate, model identity, and migrations.

Before any migration or index mutation, the Knowledge process acquires its
pinned PostgreSQL advisory-lock session, exports a repeatable-read snapshot, and
waits. The host gate creates and validates a private logical archive from that
exact snapshot, restores it into an isolated disposable PostgreSQL container,
and only then releases the barrier. Migration, recovery, admission, publication,
counters, and ACTIVE lifecycle continue under the same lock-owning session.

After live PASS, the private
`accepted-candidate-<implementation-sha>.json` evidence freezes
the implementation SHA, Git-blob manifest digest, POSIX path-set digest, path
count, and `REMOTE-PENDING`. Private evidence and backup locations never enter
Git. Any later candidate-affecting change requires a new candidate and a full
acceptance rerun.

Remote verification is the separately authorized M4/T5-C1 phase. After the
implementation PR is merged without squash/rebase and CI/Security have passed
on the exact `main` SHA, verify the frozen candidate:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t5-remote.ps1 -ImplementationCandidateSha "<accepted-40-character-SHA>"
```

This writes ignored sanitized `remote-gate.json`. Only its non-private status,
repository SHA, workflow URLs, image/model identities, and migration version may
be copied into remote-backed documentation.

## Recovery

The live gate creates exactly one private, run-scoped, Knowledge-schema logical
recovery point under `%LOCALAPPDATA%/ZinkKnowledge/recovery/m4/<run-id>/` by
default. `-BackupBase` may select another owner-approved, non-reparse private
root outside the repository. It contains the migration ledger and all Knowledge
data required to recover the prior ACTIVE state. The
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
