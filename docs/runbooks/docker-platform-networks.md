# Docker platform networks

This runbook owns the shared Docker network the platform stack joins. It
answers three questions: which network the stack uses, where that network is
declared, and how it is created.

## The shared network

The platform stack joins one network, `platform`. The declaration lives in
`infrastructure/networking/networks.yml`:

```yaml
networks:
  platform:
    driver: bridge
```

The compose files under `infrastructure/docker/compose/` consume that network
by the shared name `platform`:

| Compose file                   | How it consumes the shared network                 |
| ------------------------------ | -------------------------------------------------- |
| `compose.core.yml`             | declares `platform` with the bridge driver         |
| `compose.knowledge.yml`        | adds the persistence labels to `platform`          |
| `compose.m3-t5.acceptance.yml` | marks `platform` internal for the acceptance stack |

The repository policy check reads the declaration and the compose files
together and fails when they drift apart, so the declaration cannot go back
to being a file nothing reads.

## The name is project scoped

A compose project names its network `<project>_platform`. Every operator
script in this repository passes `--project-name`, and the acceptance stacks
use their own project name (`personal-tool-m3-t3`, `personal-tool-m3-t4`,
`personal-tool-knowledge-t5-<runId>`). The live stack uses `personal-tool`.

That is deliberate: the acceptance stacks must never join the live stack's
network. The declaration therefore carries no fixed `name:`, and no compose
file may add one either.

## Creation step

The network is created by compose when it is absent. A host that provisions
the network before the stack starts creates it explicitly:

```bash
docker network create --driver bridge <project>_platform
```

For the live stack `<project>` is `personal-tool`, so the command is:

```bash
docker network create --driver bridge personal-tool_platform
```

The step is idempotent in effect: `docker compose up` creates the same
network with the same bridge driver when it is missing, so an operator who
skips the explicit step loses nothing. The explicit step exists for a host
that creates the network before the compose files are read.

To confirm the network exists:

```bash
docker network ls --filter name=platform
```

## Operator entry point

The platform stack is started with `infrastructure/docker/scripts/start.ps1`,
which passes `--project-name` and therefore resolves the network name this
runbook documents.
