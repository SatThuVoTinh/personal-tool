### Review

Codex reviews:

* current task/Plan Revision and authorization in `PLAN.md`;
* matching valid `docs/contracts/execution/ACTIVE.md`;
* complete final diff;
* `.agents/states/handoff.md` and `context.md` when present (supplementary only);
* directly affected implementation;
* relevant neighboring code;
* tests;
* referenced architecture and persistent contracts;
* actual runtime behavior where required.

Codex must detect:

* missing plan steps;
* contract divergence;
* regressions;
* security defects;
* data-integrity defects;
* unnecessary complexity;
* duplicated responsibility;
* resource violations;
* incorrect error handling;
* architecture leakage.

Codex may directly perform only bounded remediation that preserves the approved plan.

If the best remediation requires a material plan change, use the Owner Decision Protocol.

Codex must never:

* approve its own plan;
* authorize its own execution;
* waive required gates;
* declare owner acceptance;
* fabricate completion evidence.

## Requirements
Actively identify:

* overlapping tasks;
* duplicate abstractions;
* duplicate state;
* duplicate policy;
* duplicate validation;
* duplicate ownership;
* premature abstraction;
* speculative extensibility;
* unnecessary dependencies;
* unnecessary services;
* unnecessary queues/workers;
* redundant configuration;
* conflicting architecture;
* unnecessary indirection.

Do not manufacture disagreement merely to appear intelligent.

If the approved approach is already the best option, preserve it.

# Codex review and bounded remediation

After Cursor implementation reaches its review gate, Codex performs an
independent review.

Review inputs:

```text
AGENTS
PLAN task / Plan Revision / authorization
valid ACTIVE.md
optional context.md
optional handoff.md
optional findings.md
complete diff
affected code/tests
relevant neighboring code
architecture + persistent contracts
actual validation evidence
```

`ACTIVE.md` is the sole source of truth for approved implementation details. `context.md`, `handoff.md`, and `findings.md` are navigation/working-memory aids only; they are never authority and never define the review boundary.

Codex must check both:

```text
Did the implementation do everything required?
```

and:

```text
Did it introduce anything unnecessary or harmful?
```

For each finding classify:

```text
LOCAL FIX
or
OWNER DECISION REQUIRED
```

A `LOCAL FIX` must preserve the approved plan.

Codex may fix it directly.

Any fix must:

* create/update `.agents/states/findings.md` for actionable review findings when useful;
* update `context.md` or `handoff.md` only when they materially improve continuity;
* rerun affected gates;
* remain within current authority.

A material fix requires the Owner Decision Protocol. Codex cannot accept risk on
behalf of the owner; `ACCEPTED-RISK` requires an explicit owner decision.

## Review state discipline

`findings.md` is a transient review/remediation queue, not a contract. When used,
each actionable finding uses the status vocabulary from
`.agents/states/README.md`: `OPEN`, `FIXED`, `ACCEPTED-RISK`, or `INVALID`.
Owner-decision findings remain `OPEN` until the owner decides; `ACCEPTED-RISK`
requires that explicit decision. A finding may be marked `FIXED` only after its
affected validation passes.

`QUALITY REVIEW PASS` requires zero `OPEN` actionable findings. The file may be
updated across review/fix iterations, but it must never widen remediation authority
or replace independent inspection of the complete final diff.

## Review convergence gate

Codex must continue the bounded review/fix loop until either the task is blocked
or one complete final review pass produces no actionable findings.

```text
FULL REVIEW
↓
actionable finding?
├─ YES → bounded fix → affected validation → FULL RE-REVIEW
└─ NO  → required final gates PASS?
          ├─ NO  → diagnose/fix or BLOCKED
          └─ YES → QUALITY REVIEW PASS
```

`QUALITY REVIEW PASS` requires all of the following:

* every `ACTIVE.md` step and acceptance criterion is satisfied;
* zero unresolved actionable contract, correctness, data-integrity, or regression findings;
* zero unresolved in-scope security findings or weakened security/integrity controls;
* architecture/ownership boundaries remain correct;
* code is the smallest coherent solution: no avoidable duplication, dead code, speculative abstraction, unnecessary dependency/service/queue/worker/configuration, or needless indirection;
* error handling, resource ceilings, compatibility, and operational constraints remain correct;
* tests/gates are meaningful, unweakened, and `PASS` against the final state;
* the complete final diff contains no unauthorized scope, unrelated cleanup, secrets, runtime artifacts, or mass-format churn.

Fixing the last known finding does not itself produce `PASS`. After every material
fix, Codex must re-review the complete final diff/state so the fix cannot hide or
introduce another defect.

The loop is convergent, not perfection-seeking. Do not manufacture requirements
or repeatedly refactor already compliant code. If repeated attempts produce no
new evidence, stop as `BLOCKED` or request an owner decision instead of looping
indefinitely.

---
