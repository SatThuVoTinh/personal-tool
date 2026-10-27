# Phase 3 triage report — triage-10 (loop 1)

- **Bucket:** F-OC-009, F-OC-010.
- **Baseline:** dispatch tree HEAD `85eb094aaedaf518e0184767f25812a8a3c3b10a`, reported dirty in `docs/execution/context.md:21`; this lane's `git status --short` showed the existing modified/untracked tree. Shell `git diff` was permission-denied, so reviewed locators are attributed to the dispatch working tree, not claimed as committed-HEAD-only evidence. No source files were changed; no tests or host probes were run.
- **Verdicts:** CONFIRMED-AS-LATENT 1 (F-OC-009) · CONFIRMED 1 (F-OC-010) · REFUTED / OVERSTATED / UNDERSTATED / DUPLICATE-OF / WRONG-SITE / BLOCKED 0.
- **Severity counts:** root-cause 0 · high 0 · medium 1 · low 1.
- **RED:** YES 2 — F-OC-009 affects the security boundary; F-OC-010 changes a published output contract/compatibility guarantee.
- **Blockers for the lead:** F-OC-009 needs one specific OpenClaw host observation before calling this a live bypass (see below). F-OC-010 has no external blocker; owner decision is required before choosing a contract/envelope change.

---

## F-OC-009 — outbound message canonical-surface predicate

**Verdict: CONFIRMED-AS-LATENT.** The predicate gap is proven in the registered hook; a live firing is not established without the host fact specified below. Proposed register status: `LATENT`.

### Evidence re-verification (working tree)

- `integrations/openclaw/plugins/zink-governance/index.mjs:10113-10128` constructs `CANONICAL_DISCORD_SURFACE_IDS` from the configured channel/forum IDs and their prefixed forms.
- `index.mjs:10178-10182` registers the production `message_sending` hook and gates it to Discord. `index.mjs:10230-10240` resolves the destination from conversation/target/event fields.
- `index.mjs:10241-10252` sets `isCanonical` true for a configured destination, but also unconditionally for any truthy `ctx.threadId`, `event.threadId`, `ctx.parentChannelId`, or `event.parentChannelId`; none of those four values is compared with the configured ID set. `index.mjs:10202-10204` says arbitrary channels remain blocked, while `index.mjs:10253-10258` only blocks when this predicate is false. If admitted, the hook continues to return formatted content at `index.mjs:10307-10310`.
- The empty-set alternative at `index.mjs:10244` is not needed to prove this gap. `integrations/openclaw/lib/policy.mjs:1304-1321` validates all configured surface identifiers as distinct Discord snowflakes, and `index.mjs:6132-6137` rejects invalid plugin configuration before registering tools/hooks.
- `tests/m8-t2-governed-runtime-audit.test.mjs:2433-2452` only searches source strings for the set and refusal log. It does not execute a noncanonical-destination case. `tests/m11-t1-openclaw-outbound-and-caches.test.mjs:213-260` drives the real hook for attachment containment but has no destination/thread metadata case.
- The Phase 2 source is consistent: `docs/execution/reports/p2/xcheck-oc-discord-gov.md:48` identifies the same predicate gap and explicitly says host population is unverified; `:47` distinguishes F-400's inbound text-verdict mapping.

### Adversarial refutation and exact host dependency

The strongest refutation is that the predicate's four metadata values may be absent on every host invocation whose resolved destination is outside the configured set. The repository does not define or demonstrate the pinned OpenClaw host's `message_sending` event/context mapping for that situation. If those fields are always absent, this branch cannot bypass the destination check; if the host only supplies a parent ID that itself corresponds to the configured surface, the observed send would not establish admission to an unconfigured surface.

Before classifying this as a live defect, the OpenClaw host owner must supply a trace or executable host-level contract for a Discord `message_sending` invocation where **(a)** the resolved `destChannel` is not in the plugin's configured canonical set, **(b)** at least one of `ctx.threadId`, `event.threadId`, `ctx.parentChannelId`, or `event.parentChannelId` is truthy and its value/meaning does not bind that destination to a configured surface, and **(c)** the host proceeds with that destination after the plugin returns its allow/format result. A generic statement that the host populates thread metadata is insufficient. Until that conjunction is evidenced, the predicate gap is latent, not a demonstrated production bypass.

### Finding fields

- **Type:** F2 — Security & Authorization (`security` fallback label).
- **Severity:** **medium** — conditional unauthorized Discord publication outside configured governed surfaces; no in-repo evidence of a live trigger or state/data loss.
- **root_cause_of:** none established. **depends_on:** none.
- **red:** **YES** — a change to this admission predicate changes the OpenClaw Discord security boundary (`AGENTS.md` §7). Owner decision is required before execution.
- **Fixer:** `fix-openclaw-governance-plugin`. **Files the fix would touch:** `integrations/openclaw/plugins/zink-governance/index.mjs`; `tests/m11-t1-openclaw-outbound-and-caches.test.mjs` (or an explicitly coordinated new `tests/**` hook case; coordinate that test write with `fix-tests` under one integration owner). A host contract/probe artifact must come from the OpenClaw host owner; no such host source file is present in the audited repository slice.
- **Duplicates/dependencies:** not a duplicate of F-400 (`docs/execution/findings.md:616-626`), which concerns inbound forum-thread text verdict mapping and is separately blocked on inbound host mapping. No relationship requiring F-400 to be fixed first.

---

## F-OC-010 — native Excel thrown-error envelope versus its output schema

**Verdict: CONFIRMED.** The Excel mismatch is directly code-reachable: the exception catch exits before output validation, and the validator independently exempts `ERROR`. The shared mechanism also affects the other four callable execution tools as described below. Proposed register status: `OPEN`, with the shared blast radius recorded.

### Evidence re-verification (working tree)

- The native Excel implementation is callable through the registered tool: `integrations/openclaw/plugins/zink-governance/index.mjs:4845-4870` invokes `executeExcelOperation(params, sandboxDir)`. A normal writer error can throw, for example path escape at `integrations/openclaw/lib/excel-writer.mjs:660-674` or missing populate template at `:814-817`.
- The shared wrapper invokes `def.execute` inside the try at `index.mjs:5292-5296`. Its catch at `:5315-5336` logs a symbolic code and immediately returns JSON containing `status`, `tool`, `error`, `message`, and `code`; this object has no `operation` or `success`. The post-execution `validateToolOutputEnvelope` call at `:5339-5349` is therefore unreachable for caught throws.
- Independently, `validateToolOutputEnvelope` lists the callable execution tools at `index.mjs:5360-5370`; after parsing, its branch at `:5400-5417` skips `checkSchema` whenever status uppercases to `ERROR`. Thus even a returned ERROR object would bypass this schema check.
- `zink-tools/contracts/tools/zink-excel.schema.json:56-75` explicitly defines `status` values `success` and `ERROR`, permits an `error` property, requires both `operation` and `success`, and closes the object with `additionalProperties: false`. The wrapper's missing required fields and extra `message`/`code` do not satisfy that schema.
- This path is exercised for another callable tool in `tests/m7-lane-b-ingress.test.mjs:538-563`: the test makes `zink_sql` throw and observes the generic `ERROR` envelope. This confirms the shared catch behavior, though it does not test Excel's schema mismatch.
- The Phase 2 source lines up with the implementation: `docs/execution/reports/p2/xcheck-oc-artifact.md:47-58` describes the Excel shape gap and correctly notes F-539/F-549 as related rather than equivalent.

### Other callable tools and duplicate check

The same generic catch returns before validation for all five IDs (`index.mjs:5361-5367`): `zink_excel`, `zink_power_bi`, `zink_sql`, `zink_python`, and `zink_n8n`. The ERROR exemption also applies to all five. Each tool schema's `$defs.output` is closed and describes operation results rather than the shared native catch envelope: Power BI requires operation/model/success (`zink-power-bi.schema.json:55-64`); SQL requires row_count/columns/rows (`zink-sql.schema.json:93-138`); Python requires exit_code/stdout/stderr (`zink-python.schema.json:33-49`); n8n requires one of its workflow/data result shapes (`zink-n8n.schema.json:101-129`). The repository comment at `index.mjs:5357-5359` says terminal/error envelopes pass through, but no corresponding declared error shape is consulted by this native boundary. The SQL throw test (`tests/m7-lane-b-ingress.test.mjs:538-563`) demonstrates a caught exception emitting the incompatible generic envelope; it does not establish an intended exception for SQL or the other tools. Thus the root defect is broader than the candidate title: a shared native error envelope bypasses each callable tool's output contract. Excel is the clearest specific instance because its output schema expressly allows `status: ERROR` while requiring `operation` and `success` and forbidding the wrapper's extra fields. Keep the other four schema results scoped to their own operation outputs unless the owner confirms they are also intended to represent terminal errors.

This is not a duplicate of F-539 (`docs/execution/findings.md:1604-1615`), which concerns disagreement among error-code vocabularies; F-549 (`:1695-1706`), which concerns code carriers/discriminators; or F-562 (`:1825-1836`), which concerns artifact path validation. None describes the Excel ERROR object's schema mismatch or the early return from output validation. No `depends_on` relation is established.

### Finding fields

- **Type:** F4 — Integration & Contract Violations (`contract-mismatch` fallback label).
- **Severity:** **low** — the caught Excel execution failure has a truthful ERROR status but violates the declared shape; the shared wrapper affects other callable tools as detailed above. No evidence here of data loss, false success, or a runtime outage.
- **root_cause_of:** none established. **depends_on:** none; F-539, F-549, and F-562 are adjacent, distinct mechanisms.
- **red:** **YES** — the available correction choices affect the published `zink_excel` output contract/compatibility guarantee and required schema-validation behavior (`AGENTS.md` §7). The owner must choose the public error-envelope semantics before implementation.
- **Fixer:** `fix-openclaw-governance-plugin` (primary fault site is the shared executor/validator). **Files the bounded Excel fix would touch:** `integrations/openclaw/plugins/zink-governance/index.mjs`, `zink-tools/contracts/tools/zink-excel.schema.json`, and `tests/m7-lane-b-ingress.test.mjs`. To remediate the widened shared root, the fix plan must inventory and align all five output contracts (`zink-tools/contracts/tools/zink-excel.schema.json`, `zink-tools/contracts/tools/zink-power-bi.schema.json`, `zink-tools/contracts/tools/zink-sql.schema.json`, `zink-tools/contracts/tools/zink-python.schema.json`, `zink-tools/contracts/tools/zink-n8n.schema.json`) with the wrapper's error behavior and add coverage in `tests/m7-lane-b-ingress.test.mjs`. This full cross-contract change is RED and needs the owner to decide whether to define a common terminal-error envelope or tool-specific envelopes.

---

## Checks and limitations

- Re-read both candidate blocks and all cited locators, plus the full relevant sections of `xcheck-oc-discord-gov.md` and `xcheck-oc-artifact.md`.
- Read the root `AGENTS.md`; globbing found no nested `AGENTS.md` in the repository.
- No tests or runtime probes were run. No live OpenClaw host/Discord event was available to resolve F-OC-009's conditional host fact.
