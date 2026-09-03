# Zink Skill Store Contract

## Purpose

Zink Skill Store owns governed reusable skills and owner-built template assets.
It is logically isolated from Zink Knowledgebase indexes and is not a runtime
implemented by M5/T1-R2.

## Identity and lifecycle

A skill has the stable identity: capability + namespace + version.

There is no one-to-one legacy agent mapping. A candidate or research artifact
remains non-active until the owner explicitly promotes it to ACTIVE.

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
