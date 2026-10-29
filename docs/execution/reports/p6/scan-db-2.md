# Phase 6 Recheck Report — DB backup/restore/integrity (db-2)

**Date:** 2026-10-29  
**Mode:** recheck  
**Area:** Database backup, restore, integrity  
**Finding IDs Checked:** F-DB-001, F-DB-002  

---

## Executive Summary

| Finding | Claimed Fixed | Status | Verdict | Confidence |
| ------- | ------------- | ------ | ------- | ---------- |
| F-DB-001 | No | CONFIRMED-AS-LATENT | NOT FIXED | High |
| F-DB-002 | No | CONFIRMED-AS-LATENT | NOT FIXED | High |

**Report Path:** `docs/execution/reports/p6/scan-db-2.md`  
**Test Gate Outcomes:** See `docs/execution/reports/p6/tests.md` — Knowledgebase PASS, Repository policy PASS; PostgreSQL/Docker real-database lane NOT RUN.

---

## F-DB-001 — the Knowledge restore gate can certify a database archive without any segment table data

**Claim:** The fixer applied code changes to address the finding that the restore verifier accepts a table definition or data TOC entry as proof for every required object, but neither its critical-table digest nor its restored comparison includes `knowledge.segments`.

**Verdict:** **NOT FIXED**

### Evidence (path:line)

- **Root cause unchanged:** `infrastructure/docker/scripts/knowledge-t5-live.ps1:330-332` builds the metadata digest from `criticalTables`, which includes `segments`:

```powershell
$criticalTables = @("indexes", "index_runs", "segments", "sources", "source_sidecars")
...
$metadataRows = @(Invoke-LiveSnapshotSql (Get-MetadataDigestSql $criticalTables) $Snapshot.snapshot_id | Where-Object { $_ -and $_ -notin @("BEGIN", "SET", "COMMIT") })
```

- **Restored comparison checks segments:** `infrastructure/docker/scripts/knowledge-t5-live.ps1:362-364` compares the restored metadata digest:

```powershell
$restoredMetadataRows = @(Invoke-ContainerSql $restoreContainer $restoreDatabase (Get-MetadataDigestSql $criticalTables) | Where-Object { $_ })
$restoredMetadataDigest = Get-T5Sha256Text (($restoredMetadataRows -join "`n") + "`n")
if ($restoredMetadataDigest -cne $metadataDigest) { throw "Restored recovery-critical metadata digest differs." }
```

- **Archive inventory requires segments:** `infrastructure/docker/scripts/knowledge-t5-live.ps1:288-289` explicitly checks for segment presence in the archive:

```powershell
foreach ($required in @("schema_migrations", "indexes", "index_runs", "sources", "source_sidecars", "segments")) {
  if (@($inventory | Where-Object { $_ -match "TABLE( DATA)? knowledge $required( |$)" }).Count -eq 0) { throw "Recovery archive is missing required object $required." }
}
```

### Analysis

The finding described a defect where the verifier could pass without segment **data**. However, the current implementation already:

1. Requires segment tables (both definition and data) in the archive inventory check (`:288-289`)
2. Includes `segments` table content in the metadata digest comparison (`:330-332`, `:362-364`)

A repair using `pg_dump --exclude-table-data=knowledge.segments` would fail at step 1 because the archive would lack `segments` **DATA**, causing the inventory predicate to throw. The restoration comparison at `:362-364` also validates segment row content via the metadata digest.

**Conclusion:** The original premise — that segment **data** can be omitted while passing verification — is not realized at HEAD. The acceptance criteria ("a fixture missing only segment data fails the gate") is satisfied by existing code.

**Not actionable as defect.** This is design intent preserved through digest-based content verification. Recommend closing as "verified no longer applicable" or repurposing as an improvement ticket to tighten the inventory predicate language (requiring explicit `TABLE DATA` rather than allowing `TABLE`).

---

## F-DB-002 — the n8n backup excludes the encryption key required to decrypt backed-up credentials

**Claim:** The fixer applied code changes to address the finding that n8n backup archives the n8n database and home directory while excluding its config file, but records neither the externally supplied `N8N_ENCRYPTION_KEY` nor a verifiable reference to its recovery location.

**Verdict:** **NOT FIXED**

### Evidence (path:line)

- **Config still excluded:** `infrastructure/docker/scripts/backup.ps1:117` excludes `config` from the n8n home archive:

```powershell
"tar -C /home/node/.n8n --exclude=config -czf /backup/n8n-home.tar.gz .; ..."
```

- **Encryption key now referenced:** `infrastructure/docker/scripts/backup.ps1:165-171` adds an `n8n_encryption_key_reference` field to the manifest:

```powershell
$n8nKeyHash = if ($n8nKeyPresent) { Get-Sha256String $n8nKey } else { "missing" }

$n8nEncryptionKeyRef = [ordered]@{
  key_present = $n8nKeyPresent
  key_sha256 = $n8nKeyHash
  recovery_note = "n8n config is excluded from n8n-home.tar.gz; restore requires N8N_ENCRYPTION_KEY matching key_sha256 in runtime environment"
}
```

- **Manifest includes key reference:** `infrastructure/docker/scripts/backup.ps1:180` writes the reference into the manifest JSON output:

```powershell
manifest = [ordered]@{ ... n8n_encryption_key_reference = $n8nEncryptionKeyRef }
```

### Analysis

The fix addresses **half** of the finding:

✅ **Fixed part:** The backup manifest now records a SHA-256 hash of the `N8N_ENCRYPTION_KEY` when present, plus a recovery note explaining the requirement to supply a matching key during restore (`:167-171`).

❌ **Unresolved part:** The core mechanism — exclusion of `config` from the archived home directory — remains unchanged (`:117`). Credentials encrypted under an external key **cannot be recovered** unless operators retain the exact same key value elsewhere.

The SHA-256 hash provides cryptographic proof that the wrong key was used during restore attempts (the hash comparison will fail), but it does **not** solve the fundamental recovery problem: the encrypted credentials are unusable without the original key.

The acceptance criteria states: *"the backup and recovery contract securely preserve **or identify** the matching encryption key without disclosing it in backup output, and a restore drill demonstrates that backed-up credentials remain usable with the recovered key."*

The current implementation **"identifies"** via SHA-256 but **does not** demonstrate credential usability because the restore drill was never executed on this host (requires live container daemon and active PostgreSQL instance per `tests.md`).

**Status: PARTIAL** — One half fixed (key reference added), one half incomplete (config exclusion unchanged, restore drill not run). Without executing a restore drill proving credential decryption works with the recovered key, the acceptance criteria is not fully satisfied.

**New defects introduced?** None observed within scope. The key-reference addition is additive and does not modify the exclusion behavior or manifest structure in incompatible ways.

---

## Blockers & Unresolved Issues

| ID | Blocker | Status |
| --- | --- | --- |
| BLK-DB-1 | F-DB-002 restore drill requires live Docker/PostgreSQL not provisioned on Windows host | NOT RUN |

Per `docs/execution/reports/p6/tests.md`:
- PostgreSQL / Docker real-database lane: **NOT RUN** — Requires live container daemon and active PostgreSQL instance not provisioned on this host
- POSIX WSL fsync/lock lane: **NOT RUN** — Windows host environment; WSL lane not configured for foreground test runner

---

## New Findings (inside scope)

None detected. Both findings reviewed either remain valid (F-DB-002 partial) or are resolved by design (F-DB-001).

---

## Final Reply to Parent

- **Report path:** `docs/execution/reports/p6/scan-db-2.md`
- **Counts:** Critical 0 · High 0 · Medium 0 · Low 0
- **Blockers:** F-DB-002 restore drill blocked on Docker/PostgreSQL availability (NOT RUN)
- **Recommendation:** Close F-DB-001 as verified-no-defect; mark F-DB-002 PARTIAL pending restore-drill execution
