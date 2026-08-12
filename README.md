# Personal Tool

Personal Tool is a local-first system for personal knowledge, AI, automation, and Logistics & Supply Chain data.

## Current status

M1 and M2 are complete. The validated stack uses a normal user-defined Compose bridge: PostgreSQL 17 + pgvector, AIStor Free, and n8n `.n8n` use named volumes, while Redis is transient; PostgreSQL, Redis, exporters, and the S3 API have no host ports. Container recreation (`docker compose down` then `up`), not `restart`, proved PostgreSQL, AIStor, n8n state, and the `.n8n` marker durable while the Redis marker disappeared. The isolated acceptance also passed backup → destroy acceptance volumes → clean recreate → restore, including PostgreSQL, AIStor object bytes/tags, n8n state and a synthetic encrypted credential. n8n is available only at `127.0.0.1:5678`; Nginx at `127.0.0.1:8080` serves `/healthz` and returns `404` otherwise; Prometheus, Grafana, and Dozzle are loopback-only at `127.0.0.1:9090`, `127.0.0.1:3000`, and `127.0.0.1:9999`. The n8n container successfully called Ollama on the Windows host through `host.docker.internal`. M3 is unlocked for planning only; schemas, pipelines, business workflows, RAG, and application code remain out of scope.

## Development

Before making a change, read:

- [AGENTS.md](AGENTS.md) for repository-wide operating rules.
- [PLAN.md](PLAN.md) for the active task, dependencies, and completion evidence.
- [Development conventions](docs/development/conventions.md) for Git, formatting, verification, secrets, and progress-update rules.
- [CHANGELOG.md](CHANGELOG.md) for validated historical changes only.

### Local verification

Use Node `>=24.15.0 <25` and npm `12.0.2`. On this Windows environment, invoke the user-global npm explicitly so the bundled npm 11.12.1 fallback is not used:

```powershell
$npm = "$env:APPDATA\npm\npm.cmd"
& $npm ci
& $npm run verify
```

### M2/T1 preflight

Copy `infrastructure/docker/env/.env.example` to the ignored sibling `.env`, set unique AIStor root credentials, point `AISTOR_LICENSE_FILE` to a non-empty AIStor Free license file outside the repository, and keep `OLLAMA_SMOKE_MODEL` at an installed model no larger than 4 GiB.

Run the static check first, then the runtime check:

```powershell
./infrastructure/docker/scripts/preflight.ps1
./infrastructure/docker/scripts/preflight.ps1 -Runtime
```

The runtime check uses a temporary Compose project and the pinned AIStor `mc` helper container. It does not publish the S3 API to Windows and tears down its temporary container on completion.

### M2/T2 core-storage validation

The ignored runtime `.env` must also define distinct long random `POSTGRES_PASSWORD` and `N8N_POSTGRES_PASSWORD` values. The validation reruns T1, creates the idempotent PostgreSQL bootstrap, and proves the durable/transient storage contract by recreating containers without removing named volumes:

```powershell
./infrastructure/docker/scripts/core-storage.ps1
```

It creates no long-running development stack by default: synthetic markers and the temporary `personal-tool-t2` project are removed after validation. `vector` is enabled only in database `postgres`; it is deliberately absent from `n8n` and `template1`. Redis has neither a data volume nor persistence configuration and must not be used as a source of truth.

### M2/T3 local-integration validation

The ignored runtime `.env` must also set a unique, random `N8N_ENCRYPTION_KEY` of at least 32 characters. Keep this key stable across container recreation and future recovery: losing it can make already-saved n8n credentials impossible to decrypt. It is a secret managed separately from backups and must never be logged or exported in plaintext.

Run the cumulative validation with:

```powershell
./infrastructure/docker/scripts/local-integration.ps1
```

It reruns T1 and T2, starts n8n and Nginx, validates Nginx health/default-deny behavior and n8n-to-host Ollama connectivity, then recreates containers without deleting named volumes. The synthetic n8n credential contains no real secret; decrypted verification stays in memory, and the temporary project, marker, and credential are removed on completion.

### M2/T4 observability validation

Run the cumulative observability validation with:

```powershell
./infrastructure/docker/scripts/observability.ps1
```

It reruns T1–T3, then verifies the Prometheus self, PostgreSQL exporter, and Redis exporter targets are `UP`; Grafana's provisioned Prometheus datasource and `M2 Infrastructure` dashboard are available; and Dozzle is healthy on loopback. Grafana datasource/dashboard definitions are repository-provisioned and its runtime database is not an M2 durable source of truth. The validator also measures all running T4 containers with `docker stats`, requires aggregate idle usage below 6 GiB, and rejects OOM termination or unexpected restarts. Docker Desktop/WSL memory remains a separate VM-level limit.

Dozzle filters by the `personal-tool.project=personal-tool` Docker label, mounts `/var/run/docker.sock` read-only, and has actions, shell, and MCP disabled. This reduces exposure but does not make a direct Docker socket mount least-privilege: it is still a strong privileged host boundary. A Docker socket proxy is deferred to future hardening.

### M2 operations and acceptance

Use the ignored runtime `.env` and an AIStor Free license file outside the repository. `N8N_ENCRYPTION_KEY` is a separate, stable secret: losing it can make previously stored n8n credentials impossible to decrypt. Keep it out of backups and recover it through the secret-management procedure.

Logical profiles are cumulative:

- `core`: PostgreSQL, Redis, and AIStor.
- `platform`: `core` plus n8n and Nginx.
- `observability`: `platform` plus Prometheus, Grafana, Dozzle, and exporters.
- `all`: every long-running M2 service.

The `aistor-mc` service is never part of a normal profile; scripts run it only as an ephemeral in-network helper.

```powershell
./infrastructure/docker/scripts/build.ps1
./infrastructure/docker/scripts/start.ps1 -Profile all
./infrastructure/docker/scripts/stop.ps1
```

`build.ps1` is the explicit validation/pull gate. `start.ps1` does not contact the registry on every start; it uses the immutable local image when present, while Compose still pulls a missing image. Long-running services use `unless-stopped`, bounded local Docker logs, and graceful stop windows for PostgreSQL, AIStor, and n8n.

Run the complete isolated acceptance at any time with:

```powershell
./infrastructure/docker/scripts/acceptance.ps1
```

It uses only `personal-tool-acceptance` and its own named volumes; it removes that project and its temporary artifacts after verification. Automated restore rejects every project name other than `personal-tool-acceptance` before it changes any volume.

For acceptance backups, `backup.ps1` creates custom-format PostgreSQL archives directly on the selected backup mount, an S3-layer current-object export and index (bucket/key/checksum/tags), a `.n8n` file archive that excludes its `config`, and a checksum manifest. It does not stage a second large dump in the PostgreSQL container writable layer. Restore validates the manifest version, project, paths, every checksum, and PostgreSQL archive readability before changing databases; it uses two restore jobs and runs `ANALYZE` afterward. PostgreSQL roles/passwords, root credentials, the AIStor license, encryption key, plaintext credentials, Redis, Prometheus runtime metrics, and Grafana runtime state are excluded.

AIStor M2 backup is deliberately limited to current object bytes, keys, checksums, and used tags. It does not preserve version history, IAM/policies, lifecycle/replication, retention/object-lock, internal metadata, the license, or root credentials. M2 does not enable object versioning; any later use of versioning, IAM, lifecycle, retention, or replication requires an upgraded backup contract first.

To bound growth and memory pressure on the 24 GiB laptop, n8n explicitly prunes finished executions after 14 days or 10,000 records, limits production concurrency to two, and refuses to display a single execution payload larger than 32 MiB. Redis caps its transient dataset at 192 MiB and evicts least-recently-used keys before reaching the 512 MiB container ceiling. Prometheus keeps at most 7 days or 512 MiB of TSDB blocks, whichever limit is reached first. The eight requested service ceilings total 7.5 GiB, while `%UserProfile%\.wslconfig` caps the global WSL2 VM at 9.5 GiB to leave 2 GiB for Docker/WSL overhead. PostgreSQL receives 256 MiB of shared memory; its database-size metric and Redis memory pressure are visible in the provisioned Grafana dashboard.

These controls prevent common unbounded-growth and OOM paths, but they do not replace capacity planning. Named volumes still consume Docker Desktop/WSL disk space, PostgreSQL storage does not auto-expand, and the single-node AIStor Free deployment has no high availability. Monitor database size and Docker Desktop disk capacity, keep validated backups outside the Docker disk image, and revisit PostgreSQL tuning only after representative workload metrics identify a real bottleneck.

Use `npm ci` for clean verification and CI. Use `npm install --save-dev --save-exact <package>` only when intentionally adding or updating a dependency and regenerating `package-lock.json`.

### GitHub validation (M1/T3)

The `CI` workflow provides the stable `CI / quality-gate` check on pull requests to `main`, pushes to `main`, and manual dispatch. The `Security` workflow provides `Security / dependency-audit` and `Security / secret-scan` on the same triggers plus the Monday `0 2 * * 1` schedule.

Every Node/npm job sets up Node `24.15.0` with `package-manager-cache: false`, installs npm `12.0.2` from `${{ runner.temp }}`, then asserts both exact versions before running `npm ci`/`npm run verify` or `npm audit --audit-level=high`. Security keeps `contents: read` and adds only `pull-requests: read`, which Gitleaks needs to inspect PR commits. The repository policy test parses the workflow YAML and verifies executable job steps, their order, full-SHA Action pins, and the Gitleaks full-history and no-comment/no-artifact contract. It does not accept comments, metadata, or a text substring as evidence.

## Architecture

The canonical repository structure and ownership boundaries are documented in [docs/architecture/system-overview.md](docs/architecture/system-overview.md).

Related documents:

- [Platform boundaries](docs/architecture/platform-boundaries.md)
- [Data flow](docs/architecture/data-flow.md)
- [Knowledge flow](docs/architecture/knowledge-flow.md)
- [AI boundaries](docs/architecture/ai-boundaries.md)
