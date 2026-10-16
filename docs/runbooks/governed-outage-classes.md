# Governed Outage Classes Runbook

## Scope

This runbook names the five failure classes that can stop a governed Zink
request before it produces a result, and for each one gives the machine code it
prints, what the code actually claims, the read-only check that confirms it, and
the operator action it does **not** authorize.

It is a diagnosis document. Nothing in it authorizes a restart, an `--apply`, a
lock deletion, an `events.jsonl` edit, or any write under the OpenClaw state
root. Deployment is a separate, per-apply owner grant (`AGENTS.md` §10). The
`<state-dir>` placeholder means the operator's own OpenClaw state root; this
repository never stores its contents.

Read the code, then read the ledger. A code alone is a claim about one seam; the
ledger is the record of what the system committed to.

## 1. The ledger writer is blocked

```text
FILE_LOCK_BUSY  FILE_LOCK_TIMEOUT  EXECUTION_STATE_UNKNOWN
```

Every governance ledger write and every `--apply` takes the store-wide writer
lock at `<ledger-root>/writer.lock` (`integrations/openclaw/topology/lib/ledger.mjs:130`).
When that lock's `owner.json` names a process that no longer exists — the usual
cause is a killed gateway restart — every writer refuses, and
`configure.mjs --apply` ends with `Ledger writer unavailable
[EXECUTION_STATE_UNKNOWN]` rather than a deployment failure. Symptoms look like
a global outage: approval cards stop surfacing, results stop recording, and the
gateway journal fills with lock-contention lines.

**Read-only confirmation:** ask the lock who holds it and whether that pid is
alive. `integrations/openclaw/topology/fixtures/runtime-regression/operator-lock-recovery.mjs`
is the guarded tool: its `REPORT` mode prints `holder_alive` without touching the
lock, so run that first and read it. Corroborate with the journal for the
operator's gateway unit and with the ledger's absence of a terminal event for the
affected runs.

**Not authorized by this document:** deleting `writer.lock`, editing or appending
`events.jsonl`, restarting the unit, or re-running `--apply` to "see if it
clears". Orphan-lock recovery is destructive, needs the exact target named in
the grant, and is never automatic.

## 2. The model or its completion is unavailable

```text
GOVERNANCE_UNAVAILABLE  GOVERNANCE_COMPLETION_UNAVAILABLE
```

A fault at the native model boundary is reported as a governance refusal, not as
a model error (`integrations/openclaw/topology/lib/native-boundary.mjs`), so a
router outage, an expired token, or a refused completion can surface as a failed
model candidate or as `GOVERNANCE_COMPLETION_UNAVAILABLE` while the request
never reached a specialist. Runs refused this way record no terminal ledger
event, which is why the queue looks stuck rather than failed.

**Read-only confirmation:** read the boundary's own denial reason — Wave B made
the seams print which guard reason denied them — and compare the journal window
against the ledger for the task id. A denial with a named reason is a governance
decision; a refusal with no reason on a build that prints them is a bug, and the
bug is the reportable thing.

**Not authorized by this document:** changing the router configuration, model
order, or `timeoutSeconds`; widening a resource ceiling to let a run through; or
marking the task complete. Retry only after the refusal is understood.

## 3. The approval surface refuses

```text
DISCORD_TAG_UNRESOLVED  APPROVAL_CARD_NOT_SURFACED
DISCORD_TAG_TRANSITION_REJECTED_<status>  COMPONENT_SDK_UNAVAILABLE
COMPONENT_REGISTRATION_SKIPPED  COMPONENT_REGISTRATION_FAILED
COMPONENT_BUILD_FAILED
```

A governed thread is a Discord forum thread with `STATUS`, `RISK`/`TYPE`/
`SEVERITY` and `STACK` tags resolved from that forum's own `available_tags` at
run time (`integrations/openclaw/lib/discord-forum-tags.mjs`). If a required tag
value does not exist in the forum, nothing is resolved and nothing is posted:
`DISCORD_TAG_UNRESOLVED` is followed by `APPROVAL_CARD_NOT_SURFACED`, so the
approval exists in the ledger but no human can see it. The `COMPONENT_*` codes
are the other half — a card whose buttons were not registered answers
"This component has expired" and the verdict never arrives.

**Read-only confirmation:** check whether the ledger holds
`WORKFLOW_APPROVAL_SURFACED` / `WORKFLOW_RESULT_SURFACED` for the task, then
compare the tag names the plan needs against the forum's current `available_tags`
with any read-only Discord query. A missing thread plus a tag refusal is this
class; a thread plus no button click is the `COMPONENT_*` half.

**Not authorized by this document:** renaming or creating Discord tags, sending
a Discord message by hand to "unlock" a thread, or editing the pinned host
adapter. `PATCH /channels/{thread.id}` with `applied_tags` is the only seam for
a STATUS transition and its live acceptance is `NOT TESTED` on this server, so a
transition failure is expected to appear as
`DISCORD_TAG_TRANSITION_REJECTED_<status>` and must be reported, not retried blind.

## 4. Preflight or apply refuses

```text
APPLY_REJECTED  (and the machine code configure.mjs prints beside it)
```

`--preflight` is the read-only admission step and `--apply` is the one write that
installs a packaged build. `APPLY_REJECTED` is a wrapper, not a diagnosis: the
refusal reason is printed next to it, and an apply can be refused by a healthy
system for a correct reason (an unadmitted digest, a half-missing
events/snapshot pair, a blocked ledger writer — class 1 is its most common
cause). Rollback after a refused apply restores the previous build, so the host
usually stays byte-unchanged; verify that rather than assuming it.

**Read-only confirmation:** re-run `--preflight` with the same identifier
arguments and read its printed code. Compare the installed asset digests against
the packaged build before concluding anything about the candidate.

**Not authorized by this document:** a second `--apply`. One apply is one grant,
it is spent when used, and reaching the host again needs a fresh preflight →
apply authorization from the owner. Nothing here authorizes editing
`openclaw.json`, the ledger, or any file under `<state-dir>`.

## 5. A fault reaches the surface without a code

```text
INTERNAL_ERROR  (mapped routes)  vs  a codeless HTTP 500
DUCKDB_TIMEOUT  EMPTY_RESULT  TEST_SIMULATION  FIXTURE_CONTRACT_EXECUTED
```

The Knowledgebase used to answer with a bare 500 whenever a fault fell outside a
route's mapped exceptions — the record could not say what happened, and the
console log was the only trace. Wave B gave the index-run routes and `/readyz` a
terminal fault mapper (`apps/knowledge/tests/test_b18_index_run_attribution.py`,
`test_b20_readyz_attribution.py`), so an unmapped fault now prints a code. Any
remaining codeless 500 is therefore a _new_ defect with a precise location, not
background noise.

On the SQL side the classes are inverted: `zink-tools/sql/duckdb-bridge.mjs`
returns `FIXTURE_CONTRACT_EXECUTED`, `EMPTY_RESULT` or `TEST_SIMULATION` as
execution states and reports a timeout as the refusal code `DUCKDB_TIMEOUT`. It
deliberately never emits a real-execution attestation, because the engine is real
while the datasource is a two-row contract fixture. A governed consumer that
needs business data must refuse on `FIXTURE_CONTRACT_EXECUTED`; seeing that code
is the system working, not failing.

**Read-only confirmation:** request the route and read the response's code field;
if it is empty, that is the defect to report. For SQL, read the run row's
structured error (`apps/knowledge/app/run_errors.py` owns that channel) rather
than the process log.

**Not authorized by this document:** adding a mapper to swallow a fault into a
generic code, widening `QUERY_MAX_TOKENS` or any other ceiling to make a request
pass, or promoting a contract-fixture result into a business answer.

## Reporting format

One outage report per incident is enough, and it must contain only what a
read-only observer could confirm:

```text
class:        1..5
code:         the machine code, verbatim
task/run id:  if the ledger holds one
confirmed by: the read-only command or file:line actually read
not claimed:  anything not observed
```

Never paste into a report: token values, `router.env` content, ledger event
bodies, config file bodies, Vault paths' contents, or raw log excerpts. Naming a
path as the target of a check is fine; copying what it holds is not.
