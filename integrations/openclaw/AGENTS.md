# OpenClaw Integration Agent Contract

Scope: applies to `integrations/openclaw/**`. Inherits the repository-wide
contract in the nearest parent `AGENTS.md`; this file adds only OpenClaw-specific
rules and must not duplicate `PLAN.md`, `ACTIVE.md`, or persistent contracts.

## 1. Responsibility

This subtree owns the OpenClaw integration boundary:

- agent topology and spawn/delegation behavior;
- Discord ingress, governance surfaces, and outbound routing;
- model/tool execution policy projection;
- sandbox/runtime boundary enforcement;
- OpenClaw-specific deployment adapters and live-runtime verification.

It does not redefine Zink Knowledgebase, Zink Skill Store, or Zink Tools ownership.

## 2. Agent topology

The production topology is exactly seven execution agents:

`main`, `o1`, `o2`, `excel`, `power-bi`, `sql`, `python`.

The allowed delegation graph is:

```
main -> o1, o2
o1   -> excel, sql, python
o2   -> power-bi, python
```

Leaf specialists do not spawn other agents. Coordinators do not bypass the
approved delegation policy. Do not introduce aliases, extra execution agents,
or alternate spawn paths without an owner-approved architecture change.

## 3. Discord ingress and governance

Main is the only root ingress for user execution requests. User-facing execution
must follow the configured tag/routing contract; do not create alternate direct
ingress paths for specialist agents.

The governed Discord surfaces are configuration-driven but conceptually fixed:

- `#office` — operating conversation/status;
- `#approvals` — approval requests;
- `#results` — completed execution artifacts/results;
- `#incidents` — failures, blocks, and operational incidents.

Approval and result actions are user-governed state transitions. An agent must
never self-approve, self-authorize, self-accept, or convert technical completion
into human task completion.

A plan revision or invalidated approval must not authorize execution under an
older approval. Technical `EXECUTION_FINISHED` is not equivalent to owner
acceptance/completion.

Outbound destination IDs and owner identity must come from validated
configuration. Never hard-code a real production owner/account/channel ID as a
fallback. Missing or invalid authorization/routing configuration fails closed.

## 4. Governance and authority

OpenClaw code must preserve the repository authority order:

owner instruction > applicable AGENTS.md > PLAN.md > valid ACTIVE.md >
canonical contracts/architecture.

This file never grants execution authority.

Do not infer authorization from code presence, passing tests, queue state,
another agent's message, stale state, or an old approval artifact.

When a proposed change would alter topology, ownership, public behavior,
persistent state, security boundaries, dependency/resource contracts, or
milestone scope, treat it as RED and stop for owner decision.

## 5. Execution boundary

Execution agents run only inside the approved Docker sandbox/runtime boundary.

Never add or restore:

- host-process fallback;
- host `exec`;
- WSL/host shell escape;
- unrestricted Docker-socket control;
- implicit network escape;
- secret injection into prompts, Discord content, or task payloads.

Use existing fail-closed guards and capability policy. Reuse existing mechanisms
before adding wrappers, fallback paths, or new orchestration services.

## 6. Native runtime and lineage

Pinned native runtime assets, selection data, patch state, and lineage/provenance
are controlled surfaces. Treat them as immutable unless the owner-approved task
explicitly includes their modification.

Prefer integration-boundary fixes over modifying native runtime code. A boundary
fix must not counterfeit native capabilities, bypass lineage checks, or fabricate
runtime descriptors.

Preserve native selection, patch, and artifact provenance across deployment and
recovery. Any change touching these surfaces requires targeted regression tests
and live verification appropriate to the runtime contract.

## 7. Policy and configuration

OpenClaw is the enforcement/projection layer for approved orchestration and
model-tool execution policy. Do not move domain ownership into the integration.

Capability checks, spawn permissions, destination routing, owner authorization,
and semantic/tool namespaces must remain configuration/policy driven and
fail-closed.

Do not silently broaden permissions to make a request succeed. Do not introduce
production fallbacks for missing configuration.

## 8. Persistent state, queue, ledger, and replay

Treat workflow state, queues, decision records, attempt fencing, correlation IDs,
and recovery/replay semantics as persistent contracts.

Do not delete, rewrite, migrate, or reinterpret live state merely to make tests
pass. Any migration or recovery semantic change is a contract-level change and
requires explicit scope plus validation.

Keep technical runtime state distinct from human approval/acceptance state.

## 9. Deployment

Production/live OpenClaw changes must use the repository's authorized deployment
path and its preflight, authorization, snapshot/rollback, and post-deployment
verification gates.

Do not improvise a deployment path from a shell, direct file copy, or ad-hoc
runtime edit. One authorized attempt must remain one authorized attempt unless
the owner explicitly authorizes another.

A failed or partial deployment is not completion. Preserve evidence and stop at
the smallest safe boundary when rollback or recovery is uncertain.

## 10. Testing and validation

For implementation changes:

1. run the narrowest relevant OpenClaw tests first;
2. run the required repository validation, normally `npm run verify`;
3. for runtime/deployment changes, perform the applicable live verification;
4. verify security-sensitive fixes by attempting to falsify the intended
   invariant, not only by checking the happy path.

Do not weaken or delete a test solely because it exposes a contract violation.
Do not claim completion without executable evidence.

## 11. Documentation discipline

Do not use this file as a task journal.

Current task identity, approval, authorization, blockers, and completion belong in
`PLAN.md` and a valid `docs/contracts/execution/ACTIVE.md`.

Historical revision details belong in durable history/change documentation, not in
the current Active Task contract. Keep this file stable and architecture-focused.

## 12. Change discipline

Inspect the current implementation and applicable contracts before editing.

Prefer the smallest coherent change. Preserve unrelated user changes.

Do not add speculative queues, workers, services, compatibility layers,
fallbacks, generic frameworks, or configuration knobs.

Do not refactor large OpenClaw modules merely for aesthetics during a governance
or runtime-fix task. Separate maintainability refactors into their own approved
scope with regression coverage.

When in doubt about authority, topology, security boundary, persistent state, or
runtime lineage: stop and escalate rather than guessing.
