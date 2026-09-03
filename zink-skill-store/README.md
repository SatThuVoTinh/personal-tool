# Zink Skill Store

Zink Skill Store is the peer module that owns governed reusable skills, their
provenance and lifecycle, scoped retrieval, and owner-built Excel/Power BI
templates.

The module provides a small offline, read-only Node CLI:

```text
node zink-skill-store/bin/skill-store.mjs validate
node zink-skill-store/bin/skill-store.mjs get --namespace supply-chain/inventory --capability safety-stock
```

Skill files live under `skills/<namespace...>/<capability>/<version>/` and use a
strict JSON manifest with SHA-256-bound UTF-8 Markdown. Validation scans the
entire catalog and fails closed; retrieval returns one exact ACTIVE version only.

It does not implement a database, service, HTTP API, OpenClaw adapter,
evaluation pipeline, automatic promotion, or routing policy.

Skill identity is `namespace + capability + version`. Work/research routing is
M7/OpenClaw policy, not Skill Store metadata. Knowledgebase indexes and Skill
Store state remain logically isolated even when infrastructure is reused.
