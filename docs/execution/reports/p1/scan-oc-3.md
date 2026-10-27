# Phase 1 audit — oc-3

- **Mode:** audit
- **Scope:** `integrations/openclaw/lib/authority.mjs`, `decision-ledger.mjs`, `file-lock.mjs`, `policy.mjs`, `queue-manager.mjs`, `quota-telemetry.mjs`
- **Angle:** authority, policy, ledger, locking, queue, quota, idempotency
- **Baseline:** dispatch states HEAD `85eb094`; repository instructions and coordinated-run context were read. No nested `AGENTS.md` was found under `integrations/` or `docs/`.
- **Method/limits:** Read all six scoped modules, relevant callers in the governance plugin and topology guard/ledger, and relevant register entries. No tests run. The shell tool was permission-denied, so Git status/diff could not be inspected; evidence below is from the current file contents returned by repository reads.

## Candidates

### CAND-oc-3-01 — release can remove a replacement holder's lock

- **Path:** `integrations/openclaw/lib/file-lock.mjs:188-212` (ownership check); `:220-240` (unconditional removal); `:264-285` (release sequence)
- **Evidence:** `ownsRecordedLock()` reads `owner.json` and compares its token with the expected token at `:193-212`, then returns only a boolean. `release()` calls it at `:266`, and subsequently `removalRound()` unlinks whichever `owner.json` currently occupies the directory and removes that directory at `:269-270`. There is no token re-read or compare in `removalRound()` between the ownership check and unlink. The module itself describes the relevant replacement scenario at `:115-120`: an operator removes a live holder's directory and another holder acquires the same path.
- **Concrete interleaving:** Holder A passes the token check. An operator removes A's lock directory; holder B then acquires that path and writes B's token. A resumes `removalRound()`, unlinks B's `owner.json` and removes B's lock directory. A third writer can now acquire while B is still in its critical section. The directory's atomic-mkdir mutual exclusion is lost, allowing concurrent writes to shared governance stores.
- **Impact:** Concurrent ledger/queue/decision-ledger writers can enter supposedly serialized critical sections; a journal append race can corrupt authoritative governance state and stop governance operations. Relevant in-scope callers: `decision-ledger.mjs:436-438`, `queue-manager.mjs:246-259,382-383`. The topology ledger also uses this primitive (`integrations/openclaw/topology/lib/ledger.mjs:1503-1507`) to serialize its journal writer.
- **Class:** 4 — can bring the governance system down through corruption of shared authoritative state.
- **Severity:** High.
- **Other modules touched:** `decision-ledger.mjs`, `queue-manager.mjs`, and the out-of-scope topology ledger caller. The defect is in the scoped shared lock implementation.
- **Confidence:** High.
- **Duplicate check:** `F-433` (`docs/execution/findings.md:915-926`) covers the analogous read-once/delete race in operator recovery drivers. This candidate is the distinct in-scope `release()` path; its lock-owner protocol explicitly claims to prevent this replacement-holder deletion.

### CAND-oc-3-02 — concurrent conflicting decisions overwrite instead of conflicting

- **Path:** `integrations/openclaw/lib/decision-ledger.mjs:579-638` and `:405-459`
- **Evidence:** `recordDecision()` refreshes and checks `this.decisions` for an existing ID at `:583-620`; the deterministic ID is derived from topic/question/scope at `:596-607`, not from decision text. A matching existing record with a different decision is supposed to fail closed at `:634-638`. But `save()` acquires the writer lock only afterward (`:436-438`), reads the durable set while locked (`:446-448`), and unconditionally runs `durable.set(id, record)` for every local record (`:449-450`). It does not re-check for a conflicting record that another process wrote after this instance's refresh.
- **Concrete interleaving:** Two `DecisionLedger` instances for the same path both refresh before either save and record the same topic/question/scope with different decision text. Both compute the same ID and see no existing record. The first save commits; the second save reads that durable record under lock, overwrites the same ID with its own decision, and both callers return success. This violates the documented fail-closed conflict behavior and silently loses one owner-confirmed decision.
- **Impact:** Persistent decision history silently changes under concurrent confirmations; the losing decision is not retained as a conflict or superseded record.
- **Class:** 2 — data integrity/data loss.
- **Severity:** Medium.
- **Other modules touched:** `policy.mjs` supplies the shared lock/root and serializer; the governance plugin's exported `handleOwnerDecisionConfirmation()` validates the owner and creates a ledger instance at `integrations/openclaw/plugins/zink-governance/index.mjs:1589-1602,1633-1685`.
- **Confidence:** High for the race mechanism; medium for current production reachability. Repository search found no in-repository call site of the exported confirmation handler, so this is currently latent unless an external caller invokes that export.
- **Duplicate check:** Distinct from `F-404` (`docs/execution/findings.md:668-679`), which concerns key-order-dependent replay equality; this candidate concerns concurrent different decisions sharing a deterministic ID and the missing conflict check under lock.

## Out-of-scope pointers

- None newly identified. The topology ledger path above confirms a caller affected by CAND-oc-3-01; no separate defect located outside this slice is proposed here.

## Checks

- Tests: **Not run** (read-only audit).
- Git diff/status: **Not obtained**; shell access was denied. Current source locators were read directly.
