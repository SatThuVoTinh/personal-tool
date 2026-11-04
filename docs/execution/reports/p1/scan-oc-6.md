# Phase 1 audit — oc-6

- **Scope:** `integrations/openclaw/configure.mjs`, `integrations/openclaw/verify.mjs`, `integrations/openclaw/templates/**`; setup, preflight, rollback gates and templates.
- **Mode:** Audit; dispatched against working tree at HEAD `85eb094` with pre-existing diffs, per `docs/execution/context.md:19`.
- **Outcome:** 1 candidate (High); no blockers. Static inspection only; no tests or runtime probes run.
- **Bootstrap:** Read root `AGENTS.md`, checked for nested OpenClaw `AGENTS.md` files (none found), then read coordination context, slices, findings rules/register, scoped sources and relevant callers. The shell status command was denied, so the reported dispatch baseline comes from the coordinator's context.

## Findings

### CAND-oc-6-01 — post-rename hotfix write failure escapes transaction tracking and leaves a boot-blocking partial state

- **Severity:** High.
- **Class:** 4 — defect can bring the whole system down.
- **Path:** `integrations/openclaw/templates/openclaw-gemini-stream-hotfix.mjs:300-301`, `:421-432`.
- **Evidence:** `writeAtomically` renames the desired bytes into the live runtime at line 300, then calls the parent-directory fsync at line 301. If that fsync throws, the catch at lines 302-315 rethrows after attempting to unlink only the now-absent temporary path; it does not restore the renamed destination. `writeTransaction` adds a record to `changed` only after `writeAtomically` returns at lines 423-426. Its catch rolls back only records already in `changed` at lines 428-432. Thus, if the second or later artifact's directory fsync fails after rename, that artifact remains patched but untracked, while earlier artifacts are rolled back to original bytes.
- **Concrete reproduction:** Start with all four supported artifacts in their original state and inject an `EIO` from the parent-directory `fsyncSync` after the second artifact's `renameSync` returns. The second target is already patched when `writeAtomically` throws; it is not in `changed`, so rollback restores the first target but leaves the second patched. The resulting ordered digest states are `original, patched, original, original`. `classifyState` accepts only all-patched, all-original, or the specific first-artifact-only `r18-predecessor` state (`:379-394`); this second-artifact mixture throws “unsupported partial state.” The generated systemd drop-in runs this utility as `ExecStartPre ... --ensure` (`integrations/openclaw/lib/policy.mjs:1989`), so a subsequent service start fails its preflight and the gateway remains down until manual repair.
- **Impact:** A filesystem durability error during apply/revert can leave the four vendor artifacts in a state the boot-time repair gate refuses, preventing the OpenClaw gateway service from starting.
- **Other modules touched:** Reachability only: `integrations/openclaw/lib/policy.mjs:1989` wires `--ensure` into `ExecStartPre`.
- **Confidence:** High; the failure ordering and bookkeeping are explicit. The filesystem fault was not injected in this read-only audit.
- **Register check:** No existing finding found for the hotfix transaction's post-rename untracked-write state. F-296's directory-fsync gate (`tests/agent-topo-F-296.test.mjs:172-215`) checks that publication renames have directory fsyncs, and F-417 covers a related committed-write error policy for queue/ledger writers (`CHANGELOG.md:2293`); neither covers this template's `changed.push` ordering or resulting hotfix state. F-490 and the other setup/rollback rows inspected concern different mechanisms.

## Other scope checks

- `configure.mjs` preflight and apply both check the owned systemd drop-in directory before mutation (`integrations/openclaw/configure.mjs:2040-2044`); I found no new defect there beyond the already registered rollback/setup items.
- `verify.mjs` requires the generated files, validates config and generated contents, verifies backup evidence, and checks for unowned systemd fragments (`integrations/openclaw/verify.mjs:547-566`, `:592-634`, `:611-617`). Its relevant no-live-evidence behavior and inspection verdict were already represented in the register; no distinct defect found in this pass.
- The pass resolver bounds requests, restricts IDs to the generated allowlist, and invokes `pass` without a shell (`integrations/openclaw/templates/openclaw-pass-resolver:6-9`, `:13-21`, `:59-70`). The workspace README explicitly documents that it is a placeholder (`integrations/openclaw/templates/main-workspace/README.md:3-18`).

## Out-of-scope pointers

- None identified.
