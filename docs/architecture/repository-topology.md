# Repository Topology

Every tracked top-level directory has one documented owner. This document is that map: it
names the owner of each tracked tree so a change is routed to a module, a contract, the
governance layer, or the repository tooling — never to a tree nobody owns.

The three **logical** modules are unchanged by this map: **Zink Knowledgebase**
(`apps/knowledge/`), **Zink Skill Store** (`zink-skill-store/`) and **Zink Tools**
(`zink-tools/`). The other trees below are hosting boundaries, specifications, contracts,
tooling or generated output, and each has its own owner.

## Module roots

| Path                | Owner              | What lives there                                                                                           |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `apps/knowledge/`   | Zink Knowledgebase | The accepted Knowledgebase runtime: ingestion, indexing, retrieval, provenance and citations.              |
| `zink-skill-store/` | Zink Skill Store   | Governed learned-skill persistence and scoped retrieval, plus its standard templates.                      |
| `zink-tools/`       | Zink Tools         | The thin callable-tool and adapter-contract boundary, including the schema-only capability specifications. |

## Hosting boundaries and specifications

| Path                     | Owner                                       | What lives there                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `integrations/openclaw/` | OpenClaw host runtime                       | The host runtime that carries the Zink Tools adapter surface: orchestration, model-tool execution, the governed workflow state and the ledger. Not a fourth module.                                                            |
| `platforms/`             | Canonical target-architecture specification | The intended future shape of the platform, documented only (`platforms/README.md` and the tree below it). It is not a runtime, owns no runtime state, and is not a module; the accepted runtime stays under `apps/knowledge/`. |

## Contracts, governance and tooling

| Path              | Owner                     | What lives there                                                                                                     |
| ----------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `docs/`           | Documentation owner       | Canonical architecture, persistent contracts, execution-contract protocol, runbooks and the tracked defect register. |
| `.agents/`        | Governance layer          | The routed task procedures (`.agents/skills/`) and the working-state protocol (`.agents/states/`).                   |
| `scripts/`        | Repository tooling        | The policy and check scripts the gates run.                                                                          |
| `tests/`          | Executable evidence       | The contract and regression suites the `test` gate runs.                                                             |
| `infrastructure/` | Runtime capability        | Docker compose, proxy and operator scripts. It owns runtime capability, not domain policy.                           |
| `experiments/`    | Experiments               | Isolated experiment scaffolds; their artefacts and results are generated output and are never a record of truth.     |
| `.github/`        | CI and Security workflows | The `quality-gate`, `python-quality`, `dependency-audit` and `secret-scan` definitions.                              |
| `.vscode/`        | Editor configuration      | Workspace editor settings; no runtime behaviour.                                                                     |

## Generated trees

These three trees are output, never a record of truth. They are Git-ignored including
nested paths, so a capture under any module path cannot be staged by accident.

| Path       | Owner                            | What lives there                                                                                                       |
| ---------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `backups/` | Operator-approved backup process | Snapshot and dump output from a backup the owner allowed. `docs/execution/findings.md` remains the register of record. |
| `logs/`    | Runtime                          | Runtime output.                                                                                                        |
| `temp/`    | Working session                  | Temporary artifacts of one working session.                                                                            |

The defect register of record is `docs/execution/findings.md`; the gate registry of record
is `docs/development/conventions.md`.
