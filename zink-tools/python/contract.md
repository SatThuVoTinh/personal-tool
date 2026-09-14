# Zink Python Specialist Interface Contract

## 1. Scope & Ownership

This document defines the semantic boundary for the `zink_python` tool interface.
The Python interface provides governed script execution in per-stack isolated environments.

Canonical capability registry: `zink_python` in `integrations/openclaw/lib/policy.mjs`.
Schema definition: `zink-tools/contracts/tools/zink-python.schema.json`.

## 2. Operations & Semantics

The Python interface supports a single operation:

- `execute`: Runs a specified Python script entrypoint with arguments. Target: `entrypoint`. Requires owner approval.

## 3. Boundary & Invariants

- Script entrypoint is restricted to pattern `^scripts/[a-zA-Z0-9_-]+\.py$`.
- Logical script paths are validated via `validateArtifactLogicalPath`.
- Stack binding is strictly validated: `input.stack === ownerSession.delegation.stack_id`.
- Under Model A (Contract Tool Interface), invocation returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam.
