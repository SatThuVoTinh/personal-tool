# Zink Decision Ledger contract

## Purpose

The Decision Ledger owns **explicit owner-confirmed decisions, preferences and
rules** alongside the repository's three logical modules — Zink Knowledgebase
(factual / reference knowledge), Zink Skill Store (reusable procedures) and Zink
Tools (executable capabilities) — without being a fourth one:
`docs/architecture/system-overview.md` fixes the module count at exactly three,
and the ledger is a governed record class owned inside those boundaries, like the
trusted operator ledger it shares rules with. It is the only long-term memory
class whose content is a judgement rather than a document, so it has its own
lifecycle.

It is not: a knowledge index, a procedure library, a task/execution state
store, or an observation log. Current task/execution/governance state remains
the main operational state and is never written here.

## Storage and identity

- One JSON store per governed operator root (`<ledgerRoot>/decision-ledger.json`),
  written atomically. The file is authoritative; nothing is cached as the sole
  source of truth across processes.
- Every record requires a **verified owner principal** in `confirmedBy`. An
  agent, an observed answer, or inferred behavior can never author a decision.
- A record id is derived from the governed key: `dec-<first 16 hex of the
governed key>`, where the governed key is `topic + question + scope + scope
identity`. Confirming the same governed question twice therefore resolves to
  one record.
- A caller MAY supply an explicit `decisionId`, and then that id is used
  verbatim: the derivation is the default, not a rejection of the caller's
  handle. The governed key, not the id, is what the store looks up, so a
  record written under an explicit id is still found by its key.
- The governed key is also the **chain identity**. A correction replaces the
  answer for that key, so the key is shared by the whole chain while each
  generation gets a distinct id: `dec-<first 12 hex of the governed key>-s<n>`,
  where `n` is the number of records already in the chain plus one, so the
  first correction of a one-record chain is `-s2`. The chain prefix is 12 hex,
  not the 16 the root record uses, and the two forms are distinct by
  construction.

## Lifecycle

| Situation                                                                          | Result                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| First owner confirmation                                                           | `RECORDED` — one active record.                                                                                                             |
| Exact repeat of the active decision                                                | Idempotent success; the same active record is returned, nothing is written.                                                                 |
| A **different** decision for the same governed key, without an explicit correction | `DECISION_ID_CONFLICT` — fail closed, never silently overwrite.                                                                             |
| **Explicit owner correction** of an existing decision                              | `CORRECTED` — the prior record is marked `superseded` (retained as audit history) and exactly one new authoritative record takes its place. |
| Re-asserting a superseded value after a correction                                 | `DECISION_SUPERSEDED_CORRECTION_REQUIRED` — fail closed. Changing an authoritative decision is always explicit.                             |
| Correction of a governed question with no prior decision                           | `DECISION_NOT_FOUND` — fail closed.                                                                                                         |

Invariants:

- At most one active decision per governed key, always.
- Superseded records are audit history. They never appear in applicable
  lookups (`queryDecisions`, `lookupDecision`, `shouldClarify`, `hasDecision`),
  so a fresh process resolves only the authoritative answer.
- Scope containment is unchanged: `task-specific` decisions require an exact
  task identity, `domain` decisions require an exact domain, and a narrow
  decision never leaks outward.
- A corrupt or unreadable ledger fails closed; it is never treated as "no
  decisions exist".

## Teaching classification

An explicit user teaching is classified before anything is persisted.
Classification is required and fail-closed — an ambiguous candidate persists
nothing.

| Classification        | Destination                                                                                                                                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `preference-decision` | Decision Ledger (this contract).                                                                                                                                                                                                                                                                 |
| `reusable-procedure`  | Skill Store: governed `CANDIDATE` proposal, then owner approval. See [skill-store/agent-skill-store.md](skill-store/agent-skill-store.md).                                                                                                                                                       |
| `factual-knowledge`   | Knowledgebase route. User-written Knowledgebase persistence is **intentionally deferred** in M8/T3: the Knowledgebase adapter forbids ingestion/update by contract and the human-owned Vault is read-only. The route reports `persisted: false` and must never be presented as stored knowledge. |
| `operational-state`   | Current task/execution state only; never long-term memory.                                                                                                                                                                                                                                       |

## Implementation status

- **Implemented:** record, idempotent replay, explicit correction with
  supersession, persistence across processes, authoritative lookup, negative
  matrix, and fail-closed owner binding. Exercised by
  `tests/m8-t3-governed-memory-learning.test.mjs`.
- **Not live-verified:** no live OpenClaw runtime or Discord delivery was
  exercised from the development environment.
