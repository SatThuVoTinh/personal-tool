# Phase 1 scan — oc-1

**Scope:** `integrations/openclaw/lib/discord-formatter.mjs`, `integrations/openclaw/lib/discord-native-send.mjs`
**Angle:** Discord formatting, native send, destination routing, fail-closed behavior
**Tree:** dispatch target at HEAD `85eb094` per `docs/execution/context.md`; the working tree was already dirty at dispatch. Source was inspected as presented in the current working tree.
**Checks:** Static read and caller tracing only; tests not run.

## Findings

### CAND-oc-1-01 — Unix host paths under common roots survive the governed Discord sanitizer

- **Severity:** High; **class:** 1 (security / information disclosure)
- **Path:** `integrations/openclaw/lib/discord-formatter.mjs:23`
- **Evidence:** The Unix-path alternative only matches paths beginning `/Users/`, `/home/`, `/tmp/`, `/etc/`, `/var/`, or `/app/`. It does not match `/mnt/`, `/opt/`, `/srv/`, or `/root/`. Governed plan values do pass through this sanitizer: `renderGovernedPlanSteps` calls `redactGovernedField(node?.inputs)` at `:690`, which calls `sanitizeDiscordText` at `:663-665`; the returned step is inserted into approval/result bodies at `:755-762` and `:805-809`. The production approval caller builds and publishes that body at `integrations/openclaw/plugins/zink-governance/index.mjs:1984-1995` and the result callers use the renderer at `:6493-6502` / `:6581-6590`.
- **Reproduction:** Render a plan node whose `inputs` is the safe sentinel `/mnt/c/Users/alice/private/report.xlsx`. None of the listed banned patterns match that path, so `redactGovernedField` returns it and the plan renderer places it in the Discord body. The same applies to an `/opt/...` host path.
- **Impact:** Internal host directory layout and usernames in a governed plan can be disclosed in approval/result Discord messages despite the formatter’s stated path-redaction behavior.
- **Other modules touched:** OpenClaw governance plugin caller (confirmation only).
- **Confidence:** High.
- **Existing finding overlap:** F-463 (`docs/execution/findings.md`, current OPEN row) covers the same plan-field disclosure mechanism and should receive this concrete unhandled path class during consolidation; this is a residual case of that finding rather than an unrelated root cause.

### CAND-oc-1-02 — Native send transmits unregistered raw buttons when the host component SDK is unavailable

- **Severity:** Medium; **class:** 3 (the button interaction capability does not run)
- **Path:** `integrations/openclaw/lib/discord-native-send.mjs:730-755`
- **Evidence:** `outboundPayload` starts as the caller’s `payload` at `:733`. When `buildNativeComponentBundle` returns null (`:735-755`), the payload is never replaced or stripped; `context.payload` is then sent at `:787-795`. The production pending-result caller passes `buttons` and also constructs `payload.channelData.discord.components` with `buildNativeComponentPayload` at `integrations/openclaw/plugins/zink-governance/index.mjs:6636-6645`. The native module documents that component clicks require the host registry and that a missing registry yields expired buttons at `discord-native-send.mjs:21-38`; SDK resolution failure is converted to a null bundle and logged at `:311-329`, while the later send still proceeds.
- **Reproduction:** Call `sendNativePayload` with a button-bearing `buttons` array, a payload from `buildNativeComponentPayload`, and a `resolveSdk` stub that throws; have a stub adapter capture `context.payload`. Bundle resolution returns null, but the captured payload still contains `channelData.discord.components`. The adapter call can succeed, so the caller reports the controls sent although they were never registered and cannot dispatch.
- **Impact:** A Discord message visibly carries controls that cannot invoke the governed handler. The pending-result path’s separate control message is sent this way and its caller treats a resolved send as success; the owner can be left with dead controls when the component SDK is unavailable.
- **Other modules touched:** OpenClaw governance plugin pending-result caller (confirmation only).
- **Confidence:** High.

## Existing findings confirmed in scope

- **F-399:** The current `sendWithinDeadline` still absorbs late rejection and ignores late resolution (`discord-native-send.mjs:579-611`); registration is reached only after the awaited send returns in time (`:791-814`). This matches the existing open finding; not re-reported.
- **F-463:** Its governed-plan redaction path is present (`discord-formatter.mjs:659-695`), but the path-pattern gap above leaves common Unix roots unredacted.

## Out-of-scope pointers

- `integrations/openclaw/plugins/zink-governance/index.mjs:10685` — observed text-verdict channel routing check; related existing F-400 is BLOCKED pending the OpenClaw host’s forum-thread event mapping.
