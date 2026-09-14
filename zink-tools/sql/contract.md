# Zink SQL Specialist Interface Contract

## 1. Scope & Ownership

This document defines the semantic boundary for the `zink_sql` tool interface.
The SQL interface provides conservative, read-only analytical query capabilities over approved target databases (`knowledge`, `analytics_read`).

Canonical capability registry: `zink_sql` in `integrations/openclaw/lib/policy.mjs`.
Schema definition: `zink-tools/contracts/tools/zink-sql.schema.json`.

## 2. Operations & Semantics

The SQL interface supports a single read-only operation:

- `query`: Executes a single SELECT query adhering to the Lean Option B minimum safe subset. Target: `target_database`.

## 3. Boundary & Invariants

- Strictly read-only: mutations (`INSERT`, `UPDATE`, `DELETE`, `DROP`, etc.) throw `SQL_MUTATION_NOT_PERMITTED`.
- Syntax is strictly validated via `validateSqlQuery`: single statement, mandatory `FROM`, no aliases, no JOINs, no subqueries, no functions, and no comments.
- Named parameters are injectively aligned by exact name set equality.
- Under Model A (Contract Tool Interface), invocation returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam.
