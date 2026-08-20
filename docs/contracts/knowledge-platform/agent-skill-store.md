# Agent Skill Store Contract — Architecture Baseline

Status: architecture baseline only. Implementation remains gated by `PLAN.md`.

## Purpose

Define the minimum cross-project contract required for Zink Agents System to
persist and retrieve learned functional skills without owning Knowledgebase
storage internals.

## Identity invariant

Every record is scoped by:

- stable `function_id`;
- stable `subagent_id`;
- stable `namespace_id`;
- immutable skill-record/version identity.

The active registry must enforce a one-to-one mapping among function, subagent,
and namespace.

## Minimum candidate fields

The final executable schema may refine names/types, but it must preserve the
following semantics:

- function/subagent/namespace identity;
- candidate/version identity;
- reusable skill content or canonical representation;
- originating task/outcome reference;
- learning source type such as demonstration, execution, correction, or
  escalation;
- evidence/provenance;
- ZAS evaluation result or confidence evidence;
- created-at/model/tool/policy identities needed for audit;
- idempotency identity;
- lifecycle state.

## Lifecycle

Minimum states:

```text
CANDIDATE → ACTIVE → DEPRECATED
         ↘ REJECTED
```

Normal retrieval returns `ACTIVE` versions only. Superseded/rejected records
remain auditable according to retention policy but are not normal execution
context.

## API boundary

ZAS may request:

- candidate intake;
- candidate/version inspection;
- authorized promotion/deprecation/rejection;
- scoped ACTIVE retrieval for a function/subagent;
- provenance/evaluation lookup required for audit or rollback.

ZAS may not write database tables, vector rows, object-storage objects, or index
publication state directly.

## Isolation

Agent Skill Store publication and retrieval must be logically isolated from the
Research Knowledge Store even when they reuse the same PostgreSQL/pgvector,
object-storage, embedding, or API runtime infrastructure.
