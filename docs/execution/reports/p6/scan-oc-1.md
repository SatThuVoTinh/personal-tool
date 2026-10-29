# Phase 6 Recheck Report: Slice oc-1

- **Slice ID:** oc-1
- **Mode:** Recheck
- **Scope:** `integrations/openclaw/lib/discord-formatter.mjs`, `integrations/openclaw/lib/discord-native-send.mjs`
- **Angle:** Discord formatting, native send, destination routing, fail-closed behavior
- **Date:** 2026-10-29

---

## 1. Finding Recheck Status

### F-OC-001 — A button-bearing Discord payload is sent with raw unregistered components when host SDK resolution fails
- **Status:** FIXED
- **Verification Evidence:**
  - `integrations/openclaw/lib/discord-native-send.mjs:735-756`: `sendNativePayload` checks if `buttons` is non-empty and invokes `resolveNativeComponentBundle`. If `bundle` is `null` (due to SDK unavailability or component build failure), `sendNativePayload` throws a named error (`COMPONENT_SDK_UNAVAILABLE` or `COMPONENT_BUILD_FAILED`) instead of transmitting raw unregistered component JSON.
  - Fail-closed behavior verified in `tests/m12-t1-discord-component-registry.test.mjs:255-314`.
- **Test Evidence Citation:** `docs/execution/reports/p6/tests.md` reports `m12-t1-discord-component-registry` PASS (19/19 passed).

---

### F-OC-007 — A superseded delegated run can pass specialist message provenance and publish to Discord
- **Status:** FIXED
- **Verification Evidence:**
  - `integrations/openclaw/plugins/zink-governance/index.mjs:905-915`: `evaluateSpecialistProvenance` explicitly checks if `runId` is present in `delegation.previous_native_run_ids` while differing from `delegation.native_run_id`, returning `{ allowed: false, reason: "SUPERSEDED_RUN:<runId>" }`.
  - `integrations/openclaw/plugins/zink-governance/index.mjs:10205-10227`: `specialistExecutionProvenanceWithRunCheck` re-checks the current snapshot and rejects messages from superseded attempts.
- **Test Evidence Citation:** Cited per `docs/execution/reports/p6/tests.md`.

---

### F-OC-009 — The outbound message hook treats any thread metadata as proof of a canonical Discord surface
- **Status:** FIXED
- **Verification Evidence:**
  - `integrations/openclaw/plugins/zink-governance/index.mjs:10297-10322`: In `message_sending`, `isCanonical` is calculated by checking `destChannel`, `rawDest`, `ctx.parentChannelId`, or `event.parentChannelId` against `CANONICAL_DISCORD_SURFACE_IDS`. Overtly trusting arbitrary thread metadata presence without parent channel ID verification against the configured canonical set has been removed.
- **Test Evidence Citation:** Cited per `docs/execution/reports/p6/tests.md`.

---

## 2. New Defects Introduced in Scope

- **New Defects:** None (0).
- Inspection of `integrations/openclaw/lib/discord-formatter.mjs` and `integrations/openclaw/lib/discord-native-send.mjs` confirmed proper input sanitization, bounds enforcement (2000 char Discord ceiling), path containment checks (`assertMediaInsideRoots`), and fail-closed error handling.

---

## 3. Summary

| Finding ID | Status | Primary File & Lines |
| --- | --- | --- |
| `F-OC-001` | FIXED | `integrations/openclaw/lib/discord-native-send.mjs:745-756` |
| `F-OC-007` | FIXED | `integrations/openclaw/plugins/zink-governance/index.mjs:905-915,10205-10227` |
| `F-OC-009` | FIXED | `integrations/openclaw/plugins/zink-governance/index.mjs:10297-10322` |
