# Zink Skill Store Contract

## Purpose

Zink Skill Store owns governed reusable skills and owner-built template assets.
It is logically isolated from Zink Knowledgebase indexes. OpenClaw reaches it
only through the governed Zink Tools boundary described below.

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

The read-only interface is the **operator CLI** (`zink-skill-store/bin/skill-store.mjs`),
not a model tool:

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

OpenClaw reaches Skill Store only through the governed Zink Tools boundary.

**Model-visible interface** (callable tools, untrusted proposal content):

```text
zink_skill_search   # ACTIVE-only semantic retrieval (READY index rows only)
zink_skill_propose  # CANDIDATE proposal only; never self-activates
```

These are the only Skill Store tools the model can call. `skill-store validate`
and `skill-store get` above are the operator CLI surface, not model tools.

**Trusted internal interface** (never model-visible, owner approval required):

```text
owner confirmation in #office (dedicated zink:skill:* action identity,
  never the execution-plan APPROVE)
  -> canonical promotion (SKILL.md + manifest.json, CANDIDATE then ACTIVE)
  -> derived pgvector sync from canonical ACTIVE state
```

The #office learning card is built by `buildSkillProposalCard`: proposal text
plus native approve/reject buttons whose custom_ids bind the exact proposal
(`zink:skill:<approve|reject>:<proposal_id>:<digest-prefix>`, within Discord's
100-char custom_id ceiling). The click corroborates identity; the approval
itself always binds the exact bytes stored server-side. Live Discord delivery
of these cards was not verified from the development environment.

`get` returns only the exact `ACTIVE` version after validation of the complete
catalog. A proposal alone creates no canonical skill; only the owner-confirmed
promotion writes canonical files, and only canonical ACTIVE records become
searchable after the derived index reports READY. pgvector is derived and is
never the source of truth.
