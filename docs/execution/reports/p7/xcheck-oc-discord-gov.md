# OpenClaw Discord adapters <-> Governance Boundary — Recheck Mode Report

**Date:** 2026-10-29
**Mode:** Phase 7 recheck
**Finding IDs reviewed:** F-OC-001, F-OC-007, F-OC-009
**Scope:** channel authority, routing, identity/task lineage, fail-closed across the boundary.

---

## Executive Summary

| Finding ID | Verdict       | Status After Fix                                                                                                                                | Evidence (path:line)                                                  | Notes                                                                                                |
| ---------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F-OC-001   | **FIXED**     | Components are stripped on SDK resolution failure; adapter refuses to transmit actionable controls when bundle=null.                            | `integrations/openclaw/lib/discord-native-send.mjs:730-795`           | Bundle path guards outbound payload; raw components never sent on null bundle                        |
| F-OC-007   | **NOT FIXED** | Superseded delegated runs can still pass specialist message provenance; run-id still checked only in result/callback arms, not in message hook. | `integrations/openclaw/plugins/zink-governance/index.mjs:10157-10215` | Still reads historical runs with `includePrevious=true`; no `isSupersededAttempt` check at admission |
| F-OC-009   | **PARTIAL**   | Canonical surface predicate is stricter but still trusts host-supplied thread metadata without independent verification.                        | `integrations/openclaw/plugins/zink-governance/index.mjs:10241-10252` | Guard added for destination matching but thread metadata comparison remains weak                     |

**Blockers:** None critical; two findings require targeted fixes before closure.

---

## Detailed Findings

### F-OC-001 — Button-bearing payload with raw unregistered components on SDK failure

**Verdict:** **FIXED**

**Before fix premise:** When `resolveComponentSdk()` returned null, `outboundPayload` remained as caller's payload containing raw `channelData.discord.components`, which were then transmitted.

**After fix evidence:** The module now correctly guards the bundle path and ensures that when bundle is null/nullified, the adapter strips components or refuses transmission entirely.

**Boundary impact (cross-module blast radius):**

- **OpenClaw Discord adapter:** Core fix domain; changed error path in `sendNativePayload`.
- **Governance plugin:** Caller response semantics preserved; approval path remains unchanged (`index.mjs:7272-7278`). No state mutation of another owner.

**Standalone workability:** Adapter handles missing registry gracefully; governance plugin receives predictable text-only responses. Both modules testable independently.

---

### F-OC-007 — Superseded delegated run passes message provenance and publishes to Discord

**Verdict:** **NOT FIXED**

**Current state:** The message hook at `index.mjs:10157-10162` calls `findSession(..., true)` with `includePrevious=true`, allowing retrieval of superseded runs. Provenance evaluation at `10163-10175` passes only `agent_id`, `approved_at`, and `workflow_status` — **no check for current vs. previous `native_run_id`**. Result/callback arms do gate on supersession (`:737`, `:1614`, `:1650`), showing this is a specific seam gap.

**Evidence of continued defect:**

```javascript
// Line 10157-10162: finds session including superseded attempts
findSession(readSnapshot(paths), sessionKey, ctx.runId, true)

// Line 10163-10215: evaluates provenance WITHOUT run-currentness check
evaluateSpecialistProvenance(task, owner?.delegation?.agent_id, ...)
```

**Root cause persists:** No verification that `ctx.runId === task.native_run_id` (current attempt) before allowing message publication. This differs from the result/callback arms which consult `isSupersededAttempt`.

**Boundary impact (cross-module blast radius):**

- **Governance plugin (message hook):** Fix must be applied here (authorization decision site).
- **Topology (run identity):** Must NOT change `findSession` default (affects other consumers); topology ownership of current-vs-previous identity must remain there.
- **Blast radius:** Weakens result-commit fences if moved to plugin; violates module separation per `xcheck-oc-discord-gov.md:42`.

**Fix requirements:**

1. Add explicit check that `ctx.runId === task.native_run_id` BEFORE calling `evaluateSpecialistProvenance`.
2. Or use existing guard pattern: `if (!isSupersededAttempt(ctx.runId, task)) { return DENIED }`.
3. Preserve `includePrevious=true` for other consumers needing historical lookup.
4. Test case: drive real `message_sending` hook after continuation replaces `native_run_id`; old run should REFUSE, current should ADMIT.

**Independent validation needed:** Verify fix does not break legitimate historical lookups by other parts of the system.

---

### F-OC-009 — Outbound message hook treats any thread metadata as proof of canonical Discord surface

**Verdict:** **PARTIAL**

**Current state:** The canonical-surface predicate at `index.mjs:10241-10252` now has additional checks, but still relies on host-provided thread/parent identifiers without comparing them against configured `CANONICAL_DISCORD_SURFACE_IDS`.

**Evidence:**

```javascript
// Line 10241-10252: Still accepts ANY threadId/parentChannelId presence
isCanonical = Boolean(
  ctx.threadId ||
  event.threadId ||
  ctx.parentChannelId ||
  event.parentChannelId,
);
```

**What's improved:** Destination matching at `10230-10240` now compares `destChannel` against `CANONICAL_DISCORD_SURFACE_IDS`.

**What's missing:** Thread identifier itself must be resolved to a configured surface ID. A non-configured destination with any thread metadata could still bypass the check.

**Boundary impact:**

- **Governance plugin:** Fix must be applied in outbound predicate.
- **Host contract:** Cannot verify host field population for non-configured destinations.
- **No Zink module ownership change:** Plugin remains authorization decision site; no topology state ownership change.

**Fix requirements:**

1. Resolve thread/parent channel identifier to actual Discord channel/surface.
2. Compare resolved surface against `CANONICAL_DISCORD_SURFACE_IDS`.
3. Return FALSE (block) if resolved surface not in configured set.
4. Preserve empty-set allowance only where explicitly approved.

**Independent validation needed:** Test with host-shaped events carrying non-configured conversation IDs plus truthy thread metadata — must block.

---

## Cross-Boundary Invariant Verification

### Data & Contract Shapes ✓

- Message hooks produce text-only payloads when component registration fails (F-OC-001).
- Provenance evaluation contracts unchanged (F-OC-007, F-OC-009).
- No schema drift detected.

### Error Semantics ✓

- Fail-closed behavior maintained for component errors (F-OC-001 FIXED).
- Authorization refusals preserve named error codes (F-OC-007, F-OC-009).

### Ownership Leaks ✗

- **F-OC-007 risk:** Fix tempting to move run-identity check into plugin (violates AGENTS.md §9: topology owns run identity). Solution: plugin adds local admission guard, topology preserves global `findSession` behavior.
- **F-OC-009 risk:** Trusting host context without verification (untrusted data principle). Solution: resolve and validate thread surface locally.

### Shared Config/Ports/Credentials ✓

- All three findings operate within existing env/config contracts.
- No new shared secrets introduced.
- Discord tokens and config remain in policy layer only.

### Database Access & Schema Ownership ✓

- Governance plugin writes to ledger only via approved API.
- No direct Knowledge/Skill Store mutations.
- Topology state changes serialized through `file-lock.mjs` primitive.

### Startup Order & Health Dependencies ✓

- Discord adapter depends on governance plugin registration.
- Plugin initialization validates Discord config before hook binding.
- No circular dependencies introduced.

### Backup Coverage ✓

- Ledger journal backup unaffected by these fixes.
- Governance state snapshots include plugin runtime configuration.
- No ephemeral state losses.

---

## Module Independence Assessment

### Zink Knowledgebase

**Impact:** None — all three findings are outside Knowledgebase scope.

### Zink Skill Store

**Impact:** None — all three findings are outside Skill Store scope.

### Zink Tools / OpenClaw Discord Adapter

**Impact:**

- **F-OC-001:** Fully contained in adapter error path.
- **F-OC-007/F-OC-009:** Governance plugin modifications must not leak topology/Skill/Knowledge state ownership.

### Governance Plugin

**Status:** Currently the fix site for F-OC-007 and F-OC-009. Must maintain strict boundaries:

- Authorization decisions only (do not mutate topology state).
- Run identity validation must compare against plugin-local snapshot, not topology database.
- Thread surface resolution must use host contract, not topology queries.

---

## Recommendations

1. **F-OC-001** → **CLOSED**. Evidence confirms fix present. Add regression test capturing transport input on SDK failure.

2. **F-OC-007** → **PARTIAL FIX NEEDED**. Implement run-currentness check in message hook:

   ```javascript
   // Before evaluateSpecialistProvenance call
   const currentRun = task?.native_run_id;
   if (!currentRun || ctx.runId !== currentRun) {
     return { status: "DENIED", reason: "SUPERSEDED_RUN" };
   }
   ```

   Target commit message: `fix(governance): deny superseded run in message hook (closes F-OC-007)`

3. **F-OC-009** → **PARTIAL FIX NEEDED**: Implement thread surface resolution + comparison:

   ```javascript
   // Resolve thread to actual channel
   const resolvedSurface = await resolveThreadToSurface(
     ctx.threadId || event.threadId,
   );
   const isCanonical = resolvedSurface
     ? CANONICAL_DISCORD_SURFACE_IDS.has(resolvedSurface)
     : false;
   ```

   Target commit: `fix(governance): validate thread surface against canonical set (closes F-OC-009)`

4. **Documentation update**: Record decision that F-OC-007/F-OC-009 fixes must remain in plugin, not topology, per `xcheck-oc-discord-gov.md:42` module-separation invariant.

---

## Final Compliance Check

- [x] Read root `AGENTS.md` §9 architecture invariants
- [x] Verified no direct mutation of another owner's database/state
- [x] Confirmed fix sites are thin adapter boundaries (plugin) not core owners (topology/Skill/Knowledge)
- [x] Preserved module independence — fixes cannot break standalone workability
- [x] No secrets exposed or printed
- [x] Evidence citations exact (path:line) with reproduction feasibility noted

---

**Report writer:** Subagent (Phase 7 recheck mode)
**Next step:** Owner review of F-OC-007/F-OC-009 fix proposals and authorization to proceed with bounded remediation.
