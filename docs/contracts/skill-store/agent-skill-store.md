# Zink Skill Store Contract

## Purpose

Zink Skill Store owns governed reusable skills and owner-built template assets.
It is logically isolated from Zink Knowledgebase indexes and is not a runtime
implemented by M5/T1-R2.

## Git-native governed skills

A governed skill version is tracked at:

```text
zink-skill-store/skills/<namespace...>/<capability>/<version>/
├── manifest.json
└── SKILL.md
```

Its stable identity is namespace + capability + version. The manifest is strict
JSON and binds that identity to the directory and to the SHA-256 of the exact
raw Markdown bytes. The catalog is fail-closed: a malformed record prevents all
normal retrieval, including retrieval of otherwise valid records.

The public read-only interface is:

```text
skill-store validate
skill-store get --namespace <slash-separated namespace> --capability <slug>
```

`get` returns only the exact `ACTIVE` version after validation of the complete
catalog. The lifecycle histories are `[CANDIDATE]`, `[CANDIDATE, ACTIVE]`,
`[CANDIDATE, ACTIVE, DEPRECATED]`, and `[CANDIDATE, REJECTED]`; current state is
the final event. At most one version per namespace/capability is ACTIVE.

This contract intentionally has no `work` or `research` manifest field.
Operational routing policy remains the responsibility of M7/OpenClaw.

## Templates

Excel and Power BI templates use a Git + external-storage hybrid:

- Git stores metadata, contracts, version references and lightweight examples.
- External storage holds approved binary/template artifacts when needed.
- Specialists may select, populate and validate allowed regions; they do not
  silently redesign owner-owned canonical templates.

## Boundaries

OpenClaw reaches Skill Store only through a future thin adapter at the Zink Tools
boundary. M5/T1-R2 documents and reserves that boundary only; it does not
implement the adapter, a Skill Store runtime, APIs or persistence.
