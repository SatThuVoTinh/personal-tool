# Phase 1 audit — scan-tools-3

- **Mode:** Audit
- **Scope:** `zink-tools/` — provider / n8n / OpenClaw boundary, timeouts, and error semantics
- **Baseline:** Current working tree at dispatch, HEAD `85eb094` (pre-existing changes present)
- **Result:** 0 new confirmed findings; 0 hypotheses; no blockers. Static inspection only; tests not run.

## Investigation and evidence

- The provider adapters under `zink-tools/adapters/` are explicitly described as simulated contract doubles, with no provider network calls or durable provider execution (`zink-tools/adapters/README.md:3-27`). This separates their simulated results from the real n8n webhook and Knowledgebase HTTP adapters; no provider-boundary defect in this slice was established.
- The real n8n adapter is loaded by the OpenClaw guard through the shared module resolver (`integrations/openclaw/topology/lib/guard.mjs:317-347`). The guard resolves the workflow and derives its timeout from the shared registry (`integrations/openclaw/topology/lib/guard.mjs:1951-1968`, `:490-519`); the three registry deadlines are 30,000 ms, 60,000 ms, and 15,000 ms (`integrations/openclaw/lib/policy.mjs:2663-2690`). The call envelope caps caller `timeout_seconds` at 300 (`zink-tools/contracts/tool-call.schema.json:27-41`). Thus the live dispatch path gives the adapter a positive, bounded effective timeout no greater than the workflow limit.
- `invokeN8n` applies that timeout to `fetch` with `AbortSignal.timeout` (`zink-tools/n8n/trigger.mjs:269-283`) and checks the signal during error normalization (`:475-503`). It refuses redirects (`:297-303`), caps consumed response bytes in its stream path (`:339-377`), validates the upstream wrapper and workflow data (`:394-432`), and does not mark non-terminal workflow states successful (`:434-460`). The OpenClaw guard maps timeout to the timeout envelope and maps the adapter's enumerated upstream/transport/configuration errors to sanitized error envelopes (`integrations/openclaw/topology/lib/guard.mjs:2243-2275`); the post-dispatch result is schema-validated (`:2277-2301`).
- **Existing finding checked — F-539** (`docs/execution/findings.md:1604-1615`): the mismatch among the tool error-code declarations is already registered, including `N8N_WORKFLOW_PENDING` and `N8N_TIMEOUT`. The pending result itself conforms to the published result schema (`zink-tools/contracts/tool-result.schema.json:33-63,309-359`; `zink-tools/n8n/trigger.mjs:444-460`). This is a duplicate of the existing cross-module vocabulary-drift finding, not a new runtime failure.
- **Existing finding checked — F-581** (`docs/execution/findings.md:1968-1979`): the n8n adapter uses `AbortSignal.timeout`; the registered wall-clock deadline sites concern Knowledgebase retry budgeting and OpenClaw file-lock timing. No new n8n wall-clock timeout defect was evidenced.
- The hook's abort signal is checked before the guarded operation (`integrations/openclaw/topology/lib/guard.mjs:1518-1533`); the adapter invocation receives only the decision context and validated input (`:2224-2234`). Mid-request cancellation propagation was not reported: the scoped contracts do not define post-dispatch cancellation semantics, and the n8n request already has a bounded adapter timeout. No class 1–4 defect was established from this observation.

## Confirmed findings

None.

## Hypotheses

None.

## Out-of-scope pointers

None. OpenClaw policy and guard sources were inspected only to confirm the in-scope adapter's production boundary and timeout/error mapping; the existing F-539 register entry already routes its cross-module vocabulary drift.
