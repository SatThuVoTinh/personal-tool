# Recheck Report — Phase 6: Tools provider/n8n/OpenClaw boundary
## Finding ID: F-DB-002 — n8n backup excludes the encryption key required to decrypt backed-up credentials

**Report date:** 2026-10-29  
**Mode:** recheck  
**Area:** Tools provider / n8n / OpenClaw boundary  
**Finding status per register:** CONFIRMED-AS-LATENT  
**Fixer:** fix-infrastructure  

---

### Verdict Summary

| Item | Status | Path:line evidence | Notes |
| --- | --- | --- | --- |
| Manifest recovery pointer added | **FIXED** | `infrastructure/docker/scripts/backup.ps1:167-171` | The script now reads `N8N_ENCRYPTION_KEY` from env, computes its SHA256 hash, and writes `n8n_encryption_key_reference` with `key_sha256` and `recovery_note` to `manifest.json` at line 180. This addresses the missing recovery-reference half of the defect. |
| Restore drill demonstrating usable credentials | **NOT RUN** | External host dependency (n8n container, `.env` retention) | Per triage-12.md §58 and findings.md §2351, the wrong-key restore drill was not executed. This is an external-dependent check that remains `NOT RUN`; cannot be verified on Windows host without WSL/n8n runtime. |

---

### Evidence Details

#### Fixed: Recovery reference in manifest
The re-read of `backup.ps1` shows lines 149–171 implement the fix:

```powershell
$n8nKey = if ($envValues.ContainsKey("N8N_ENCRYPTION_KEY")) { $envValues["N8N_ENCRYPTION_KEY"] } else { "" }
$n8nKeyPresent = ($n8nKey.Length -gt 0 -and -not (Test-SentinelValue $n8nKey))

function Get-Sha256String { ... }

$n8nKeyHash = if ($n8nKeyPresent) { Get-Sha256String $n8nKey } else { "missing" }

$n8nEncryptionKeyRef = [ordered]@{
  key_present = $n8nKeyPresent
  key_sha256 = $n8nKeyHash
  recovery_note = "n8n config is excluded from n8n-home.tar.gz; restore requires N8N_ENCRYPTION_KEY matching key_sha256 in runtime environment"
}

...
$n8nEncryptionKeyReference = $n8nEncryptionKeyRef
```

Line 180 writes `n8n_encryption_key_reference` into `manifest.json`. The key itself is never written to disk or archive (only its SHA256 fingerprint), preserving the security boundary per triage-12.md §23.

#### Not run: Restore drill
Acceptance criteria requires: *"a restore drill demonstrates that backed-up credentials remain usable with the recovered key."* This requires:
- A live PostgreSQL+n8n stack
- A known-good backup archive
- An operator `.env` with a retained `N8N_ENCRYPTION_KEY`
- Execution of a failed-decryption scenario

None of these are available on this Windows host without WSL/container provisioning. As recorded in triage-12.md §58 and context.md lane limitations, this check is **NOT RUN**.

---

### New Defects Introduced by Fix

**Scope:** Inside `zink-tools/` and the Tools/provider-n8n/OpenClaw boundary  

**Result:** No new defects identified inside scope.

- The fix touches only `infrastructure/docker/scripts/backup.ps1` and writes to `manifest.json` (both infrastructure-layer, not zink-tools).
- No modifications to `zink-tools/adapters/`, `contracts/`, or any tool capability execution paths.
- No timing-out / timeout / error-semantics changes in Tools boundaries reported or observed.
- No impact on OpenClaw hosting boundaries beyond providing a better-formed backup artifact.

Per AGENTS §6 (read-only for subagent), source files outside `docs/execution/reports/p6/scan-tools-3.md` were not edited. No test results were run; test outcomes are documented in `docs/execution/reports/p6/tests.md`: Knowledgebase PASS, Repository policy PASS, Affected Node tests PASS, Repository check FAIL (trailing whitespace), PostgreSQL/Docker NOT RUN, POSIX WSL NOT RUN.

---

### Related Files / Out-of-Scope Pointers

- `infrastructure/docker/scripts/backup-inspection.ps1` — inspection helper referenced by `backup.ps1`; no edits needed for F-DB-002 fix (inspection correctly classifies `config` as plaintext secret carrier).
- `README.md:444-448` — operator guidance for setting `N8N_ENCRYPTION_KEY`; should be updated to note retention requirement (out of scan scope).
- `docs/runbooks/knowledge-platform.md:65` — states "Restore automation is not implemented"; should warn about key-retention (out of scan scope).
- `tests/m5-docker-contract.test.mjs` — gate file asserting backup behavior; should assert presence of `n8n_encryption_key_reference` field (out of scan scope).

---

### Final Outcomes

- **F-DB-002 status:** PARTIAL — manifest recovery pointer fixed; restore drill NOT RUN.
- **Severity unchanged:** Medium (conditional recoverability assurance gap).
- **New defects in scope:** None.
- **Next action:** Register closure can proceed once owner arranges a restore drill (or explicitly marks it waived); otherwise keep as LATENT with documented NOT RUN status.

---

**Report path:** `docs/execution/reports/p6/scan-tools-3.md`  
**Counts:** High 0 · Medium 0 (no new) · Low 0 · NEW DEFECTS IN SCOPE: 0
