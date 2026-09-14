# Zink Power BI Specialist Interface Contract

## 1. Scope & Ownership

This document defines the semantic boundary for the `zink_power_bi` tool interface.
The Power BI interface provides governed contract operations for semantic data models.

Canonical capability registry: `zink_power_bi` in `integrations/openclaw/lib/policy.mjs`.
Schema definition: `zink-tools/contracts/tools/zink-power-bi.schema.json`.

## 2. Operations & Semantics

The Power BI interface supports four closed operations:

- `load`: Reads semantic model metadata and definitions. Target: `model`.
- `bind`: Associates datasources and tables to the model. Target: `model`. Requires owner approval.
- `update`: Applies schema and measure modifications to the model. Target: `model`. Requires owner approval.
- `validate`: Checks semantic model consistency and integrity. Target: `model`.

## 3. Boundary & Invariants

- Authorization is governed strictly by `TOOL_POLICY` and runtime delegation.
- Under Model A (Contract Tool Interface), invocation returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam.
