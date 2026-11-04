# Zink n8n Workflow Trigger Interface Contract

## 1. Scope & Ownership

This document defines the semantic boundary for the `zink_n8n` governed adapter interface.
The n8n interface provides governed webhook triggers over local loopback HTTP (`http://127.0.0.1:5678`).

Canonical capability registry: `zink_n8n` in `integrations/openclaw/lib/policy.mjs`.
Workflow registry: `N8N_WORKFLOW_REGISTRY` in `integrations/openclaw/lib/policy.mjs`.
Schema definition: `zink-tools/contracts/tools/zink-n8n.schema.json`.

## 2. Operations & Semantics

The n8n interface supports a single operation:

- `trigger`: Triggers an allowlisted webhook workflow. Target: `workflow_id`. Requires owner approval.

Approved workflows are strictly scoped to `stack: "data_plant"`:

- `data_plant_ingest`
- `data_plant_sync`
- `pipeline_notify`

## 3. Boundary & Invariants

- Transport is strictly loopback-only POST to `http://127.0.0.1:5678`. HTTP redirects (3xx) are forbidden.
- Payloads have a 64 KB ceiling; responses are bounded to 1 MB with fatal UTF-8 decoding.
- Upstream returns domain payload only inside `{ "data": { ... } }`; envelope metadata is authoritatively constructed by the adapter.
