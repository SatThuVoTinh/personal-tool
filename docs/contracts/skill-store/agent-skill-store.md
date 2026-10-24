# Zink Skill Store Contract

## Purpose

Zink Skill Store owns governed reusable skills and owner-built template assets.
It is logically isolated from Zink Knowledgebase indexes. Two paths reach it, and
only the first is model-visible: retrieval goes through the governed Zink Tools
boundary described below, while owner-approved canonical promotion is a trusted
internal write through Skill Store's own API under its store-wide writer lock
(`zink-skill-store/src/catalog.mjs` — `withSkillStoreWriterLock` and
`promoteApprovedSkillUnlocked`).

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

The operator CLI (`zink-skill-store/bin/skill-store.mjs`) is the operator
surface, not a model tool:

```text
skill-store validate
skill-store get --namespace <slash-separated namespace> --capability <slug>
skill-store deprecate --namespace <ns> --capability <slug> --version <semver> --decision-ref <PLAN:M../T..-R..> [--actor <name>]
skill-store migrate
```

`get` returns only the exact `ACTIVE` version after validation of the complete
catalog. The lifecycle histories are `[CANDIDATE]`, `[CANDIDATE, ACTIVE]`,
`[CANDIDATE, ACTIVE, DEPRECATED]`, and `[CANDIDATE, REJECTED]`; current state is
the final event. At most one version per namespace/capability is ACTIVE.

## Schema ownership

The Skill Store owns its durable schema, its migration set and its migration
ledger. The `skills.*` DDL lives in `zink-skill-store/migrations/`, is applied
by the Skill Store's own runner (`zink-skill-store/src/migrations.mjs`), and is
recorded in the Skill Store's own ledger (`skills.schema_migrations`).

The Knowledgebase's migration set keeps its own tables and applies **zero**
statements against `skills.*`: the Knowledgebase's startup path never mutates a
peer module's persistence.

An applied migration is keyed by filename and pinned by its SHA-256
(`docs/contracts/skill-store/skill-store-migration-digests.json`). Editing an
applied migration in place is a silent no-op on every database that adopted
it; the only correct action is a NEW forward migration. The runner refuses an
applied migration whose bytes changed (`SKILL_STORE_MIGRATION_DIGEST_MISMATCH`).

## The governed DEPRECATED retirement

A promoted skill is retired through the governed API, never by editing the
tree. The retirement appends the third lifecycle event, so the durable record
(`manifest.json`) carries `CANDIDATE, ACTIVE, DEPRECATED` — a history
`scanCatalog` accepts — and the successor version of the same capability can
then be promoted.

The retirement is a canonical write, so it carries the promotion's discipline:
it runs inside the store-wide writer lock (`withSkillStoreWriterLock`), it
requires the governed decision reference (`PLAN:M../T..-R..`), it refuses a
version that is not `ACTIVE`, and it re-reads the catalog afterwards, rolling
the retirement back if it would break the store. The retired version keeps its
`SKILL.md` bytes and its place in the tree; only its state changed.

`REJECTED` keeps its own writer: the retirement path never writes `REJECTED`
and never overwrites a rejected record.

In the derived index the retirement is RECORDED, not merely deleted: the
derived row moves to `status = 'DEPRECATED'`, `sync_status = 'TOMBSTONED'`,
and the vectors of the retired skill are dropped. That state is admitted by
the Skill Store's forward migration
`zink-skill-store/migrations/004_skill_retirement_state.sql`; the applied
`003_skills_vector_schema.sql` is never edited.

The retirement is never model-visible: the Zink Tools `SkillAdapter` still
refuses the `deprecate` action, and only an owner-confirmed governed action
reaches the store's public door (`retireSkill`).

A terminal derived row is reclaimed, not kept forever: after a COMPLETE scan
proves its canonical record is gone, a `DEPRECATED` row older than the bounded
retention window (`TERMINAL_DERIVED_ROW_RETENTION_DAYS`, 30 days, in
`zink-skill-store/src/vector-sync.mjs`) is deleted from the derived index. The
window keeps an incomplete or transient catalog read from pruning a live
retirement, and the deletion runs only under the same store-confirmation gate
that guards the `ACTIVE` tombstone.

This contract intentionally has no `work` or `research` manifest field.
Operational routing policy remains the responsibility of M7/OpenClaw.

## Templates

Excel and Power BI templates use a Git + external-storage hybrid:

- Git stores metadata, contracts, version references and lightweight examples.
- External storage holds approved binary/template artifacts when needed.
- Specialists may select, populate and validate allowed regions; they do not
  silently redesign owner-owned canonical templates.

## Boundaries

Model-visible retrieval reaches Skill Store through the governed Zink Tools
boundary. The owner-approved promotion path is not a Zink Tools call: the
governance plugin loads `zink-skill-store/src/catalog.mjs` and promotes under the
store-wide writer lock itself, bound to the exact approved bytes
(`APPROVAL_PROPOSAL_MISMATCH`) and refusing when the writer is unavailable
(`APPROVAL_PROMOTE_UNAVAILABLE`). The promotion entry point is not callable by a
model: agents propose, and only an owner-confirmed governance action promotes.

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
