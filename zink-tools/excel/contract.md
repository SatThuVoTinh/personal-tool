# Zink Excel Specialist Interface Contract

## 1. Scope & Ownership

This document defines the semantic boundary for the `zink_excel` tool interface.
The Excel interface provides governed contract operations for Microsoft Excel workbooks within the Zink workflow ecosystem.

Canonical capability registry: `zink_excel` in `integrations/openclaw/lib/policy.mjs`.
Schema definition: `zink-tools/contracts/tools/zink-excel.schema.json`.

## 2. Operations & Semantics

The Excel interface supports four closed operations:

- `load`: Reads and inspects workbook metadata and sheets. Target: `file_path`.
- `populate`: Applies structured data to a template workbook. Target: `file_path`. Requires owner approval.
- `validate`: Evaluates workbook contents against defined business rules. Target: `file_path`.
- `generate`: Synthesizes a new workbook from a specification. Target: `file_path`. Requires owner approval.

## 3. Boundary & Invariants

- Logical paths are validated via `validateArtifactLogicalPath`.
- Authorization is governed strictly by `TOOL_POLICY` and runtime delegation.
- Executable mode: invocation executes the hosted workbook engine (or returns deterministic `ENGINE_NOT_IMPLEMENTED` via the contract seam when dispatched to the contract seam).
