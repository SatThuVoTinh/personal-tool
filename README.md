# Personal Tool

Personal Tool is a local-first, single-user system for personal knowledge, AI, automation, and Logistics & Supply Chain data.

## Current status

M1 and M2 are complete. M2 is backed up on GitHub at commit [`5ffe4cb`](https://github.com/SatThuVoTinh/personal-tool/commit/5ffe4cb9be81c30d5c24bd7eb6a9d41abc2a5f19): its isolated full acceptance passed locally, and GitHub [CI](https://github.com/SatThuVoTinh/personal-tool/actions/runs/31597875617) plus [Security](https://github.com/SatThuVoTinh/personal-tool/actions/runs/31597875566) passed.

The validated M2 stack uses PostgreSQL 17 + pgvector, AIStor Free, Redis, n8n, Nginx, Prometheus, Grafana, and Dozzle. PostgreSQL, AIStor, n8n state, and `.n8n` use named volumes; Redis is intentionally transient. PostgreSQL, Redis, exporters, the S3 API, and the future Knowledge service have no host port mapping. Nginx, n8n, Prometheus, Grafana, and Dozzle bind only to host loopback.

M3 is in progress. M3/T1 provides the merged internal-only Knowledge-service foundation at [`4097862`](https://github.com/SatThuVoTinh/personal-tool/commit/4097862ab383e8698f2d5b1ff5adce0acd1c6579). M3/T2 provides remote-backed, read-only Markdown discovery, all-or-nothing source validation, native Obsidian tag parsing, original-line coordinates, and retrieval-safe segmentation under the pinned reranker tokenizer budget. M3/T2 is merged at [`b446ff1`](https://github.com/SatThuVoTinh/personal-tool/commit/b446ff17146763ea762b8669207c09642d42098f), with [CI](https://github.com/SatThuVoTinh/personal-tool/actions/runs/31682828157) and [Security](https://github.com/SatThuVoTinh/personal-tool/actions/runs/31682828014) passed on `main`; M3/T3 is now eligible. T2 does not write to the database, embed content, expose an API, or manage index lifecycle. PDF, image, and video ingestion remain deferred to M4/M5.

## Development

Before changing a module, read:

- [AGENTS.md](AGENTS.md) for repository operating rules.
- [PLAN.md](PLAN.md) for the active task, architectural contracts, and completion evidence.
- [CHANGELOG.md](CHANGELOG.md) for completed, validated history only.
- [Development conventions](docs/development/conventions.md) for Git, formatting, verification, and secret handling.

Use Node `>=24.15.0 <25` and npm `12.0.2`:

```powershell
$npm = "$env:APPDATA\npm\npm.cmd"
& $npm ci
& $npm run verify
```

## M2 runtime verification

Copy `infrastructure/docker/env/.env.example` to the ignored sibling `.env`. Supply unique credentials and passwords, a stable `N8N_ENCRYPTION_KEY` of at least 32 characters, an installed Ollama smoke model no larger than 4 GiB, and an AIStor Free license file outside the repository. Never commit or print those values.

Run the cumulative checks with an execution-policy override for the current process only:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/preflight.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/core-storage.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/local-integration.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/observability.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/acceptance.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
```

The final acceptance creates only the temporary `personal-tool-acceptance` Compose project. It validates recreation, logical backup, destroy of acceptance volumes, clean recreation, and restore; it removes its project, volumes, and temporary artifacts afterward. Automated restore rejects all project names other than `personal-tool-acceptance`.

Normal profiles are cumulative:

- `core`: AIStor, PostgreSQL, and Redis.
- `platform`: `core` plus Nginx and n8n.
- `observability`: `platform` plus Prometheus, Grafana, Dozzle, and exporters.
- `all`: every M2 long-running service.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/build.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/start.ps1 -Profile all -EnvironmentFile ./infrastructure/docker/env/.env
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/stop.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
```

`build.ps1` is the explicit image refresh/validation gate. `start.ps1` uses cached immutable images when available. M2 backup excludes runtime credentials, AIStor root credentials and license, PostgreSQL roles/passwords, the n8n encryption key, plaintext n8n credentials, Redis, Prometheus runtime metrics, and Grafana runtime state.

## M3/T1 runtime verification

With the same ignored runtime environment file and a locally available `bge-m3:latest` Ollama model, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t1.ps1 -EnvironmentFile ./infrastructure/docker/env/.env
```

This creates only the isolated `personal-tool-m3-t1` Compose project, builds the Knowledge image, verifies the internal Nginx route, active-index uniqueness, digest-drift refusal, and interrupted-run recovery, then removes its project, network, and volume. It does not read or write an Obsidian Vault.

## M3/T2 Markdown verification

Run the pinned unit/golden tests and isolated read-only fixture acceptance:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t2.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./infrastructure/docker/scripts/knowledge-t2-windows.ps1
```

The first script builds with the committed `uv.lock`, verifies the immutable tokenizer artifact, runs the Python suite, mounts only the repository fixture Vault read-only, and confirms its hashes are unchanged. The second script is Windows-native acceptance for junction/reparse rejection; Linux-container tests do not claim Windows filesystem semantics.

## GitHub validation

The `CI` workflow supplies `CI / quality-gate`; the `Security` workflow supplies `Security / dependency-audit` and `Security / secret-scan`. They run on pushes and pull requests to `main`; Security also runs on its weekly schedule. All Node/npm jobs pin Node `24.15.0` and npm `12.0.2`, and the repository policy tests validate workflow commands, order, immutable Action pins, and Gitleaks safeguards.

## Architecture

The current architecture and execution contracts are maintained in [PLAN.md](PLAN.md). The repository's ownership boundaries are documented in:

- [System overview](docs/architecture/system-overview.md)
- [Platform boundaries](docs/architecture/platform-boundaries.md)
- [Knowledge flow](docs/architecture/knowledge-flow.md)
- [Data flow](docs/architecture/data-flow.md)
- [AI boundaries](docs/architecture/ai-boundaries.md)
