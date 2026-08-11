# Personal Tool

Personal Tool is a local-first system for personal knowledge, AI, automation, and Logistics & Supply Chain data.

## Current status

M1 is complete: the repository has the M1/T2 local quality baseline plus validated CI and Security workflows from M1/T3. The current focus is planning M2 only; runtime services, schemas, pipelines, and application code remain intentionally unimplemented until their approved milestone and task.

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
