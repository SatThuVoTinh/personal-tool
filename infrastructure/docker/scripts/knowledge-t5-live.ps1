[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VaultRoot,
  [Parameter(Mandatory = $true)][string]$Query,
  [Parameter(Mandatory = $true)][string]$ExpectedSourcePath,
  [Parameter(Mandatory = $true)][switch]$ConfirmPersistentIndex,
  [string]$EnvironmentFile = "",
  [string]$ProjectName = "personal-tool",
  [string]$BackupBase = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "knowledge-t5-common.ps1")

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }
if (-not $BackupBase) { $BackupBase = Join-Path $env:LOCALAPPDATA "ZinkKnowledge\recovery\m4" }

$runId = [guid]::NewGuid().ToString("N")
$composeFile = Join-Path $script:T5DockerDirectory "compose\compose.core.yml"
$knowledgeComposeFile = Join-Path $script:T5DockerDirectory "compose\compose.knowledge.yml"
$liveComposeFile = Join-Path $script:T5DockerDirectory "compose\compose.m4-t5.live.yml"
$barrierRoot = Join-Path ([IO.Path]::GetTempPath()) "knowledge-t5-backup-barrier-$runId"
$backupRoot = Join-Path $BackupBase $runId
$dumpPath = Join-Path $backupRoot "m4-recovery-$runId.dump"
$manifestPath = Join-Path $backupRoot "m4-recovery-$runId.manifest.json"
$evidence = [ordered]@{ schema_version = 2; mode = "Live"; result = "FAIL"; acceptance_run_id = $runId; started_at = [DateTime]::UtcNow.ToString("o") }
$restoreContainer = "knowledge-t5-restore-$runId"
$script:restoreContainerStarted = $false
$script:knowledgeStarted = $false
$script:bodyFailed = $false
$snapshot = $null
$acceptedCandidate = $null
$acceptedCandidatePath = $null

function Invoke-LiveCompose {
  param([string[]]$Arguments)
  & docker compose --project-name $ProjectName --env-file $EnvironmentFile -f $composeFile -f $knowledgeComposeFile -f $liveComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed with exit code $LASTEXITCODE." }
}

function Write-ExclusiveText {
  param([string]$Path, [string]$Value)
  $stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.Encoding]::ASCII.GetBytes($Value)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  }
  finally { $stream.Dispose() }
}

function Invoke-LiveSql {
  param([string]$Sql)
  Invoke-LiveCompose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", $Sql)
}

function Invoke-ContainerSql {
  param([string]$ContainerId, [string]$Database, [string]$Sql)
  & docker exec $ContainerId psql --username=postgres --dbname=$Database --set=ON_ERROR_STOP=1 --tuples-only --no-align --command $Sql
  if ($LASTEXITCODE -ne 0) { throw "Disposable recovery SQL failed." }
}

function Invoke-LiveSnapshotSql {
  param([string]$Sql, [string]$SnapshotId)
  if ($SnapshotId -notmatch '^\d+:\d+:\d+$') { throw "Exported PostgreSQL snapshot identity is invalid." }
  $wrapped = "BEGIN ISOLATION LEVEL REPEATABLE READ; SET TRANSACTION SNAPSHOT '$SnapshotId'; $Sql; COMMIT;"
  Invoke-LiveSql $wrapped
}

function Invoke-LiveApi {
  param([string]$Method, [string]$Path, [string]$Body = "")
  $responsePath = Join-Path ([IO.Path]::GetTempPath()) "knowledge-t5-$runId-$([guid]::NewGuid().ToString('N')).json"
  $requestPath = $null
  try {
    $arguments = @("--silent", "--show-error", "--max-time", "90", "--output", $responsePath, "--write-out", "%{http_code}", "--request", $Method)
    if ($Body) {
      $requestPath = Join-Path ([IO.Path]::GetTempPath()) "knowledge-t5-$runId-$([guid]::NewGuid().ToString('N')).request.json"
      [IO.File]::WriteAllText($requestPath, $Body, [Text.UTF8Encoding]::new($false))
      $arguments += @("--header", "Content-Type: application/json", "--data-binary", "@$requestPath")
    }
    $arguments += "http://127.0.0.1:8080/knowledge$Path"
    $statusCode = & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed for $Path." }
    return [ordered]@{ status = [int]$statusCode; body = Get-Content -LiteralPath $responsePath -Raw -Encoding utf8 }
  }
  finally {
    Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
    if ($requestPath) { Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue }
  }
}

function Wait-LiveReady {
  for ($attempt = 0; $attempt -lt 300; $attempt++) {
    try { $ready = Invoke-LiveApi "GET" "/readyz" } catch { $ready = $null }
    if ($ready -and $ready.status -eq 200) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Knowledge readiness did not recover."
}

function Wait-LiveRun {
  param([string]$IndexRunId)
  for ($attempt = 0; $attempt -lt 600; $attempt++) {
    $response = Invoke-LiveApi "GET" "/v1/index-runs/$IndexRunId"
    if ($response.status -eq 200) {
      $run = $response.body | ConvertFrom-Json
      if ($run.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $run }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Persistent index run did not reach a terminal state."
}

function Get-CatalogSql {
  return @"
SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
FROM information_schema.columns WHERE table_schema = 'knowledge'
UNION ALL
SELECT 'index|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'knowledge'
UNION ALL
SELECT 'constraint|' || c.conname || '|' || pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'knowledge'
UNION ALL
SELECT 'type|' || t.typname || '|' || t.typtype FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='knowledge'
UNION ALL
SELECT 'function|' || p.proname || '|' || pg_get_function_identity_arguments(p.oid) || '|' || pg_get_function_result(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='knowledge'
ORDER BY 1
"@
}

function Get-LiveSnapshotFingerprint {
  param([string]$SnapshotId)
  $rows = @(Invoke-LiveSnapshotSql (Get-CatalogSql) $SnapshotId | Where-Object { $_ -and $_ -notin @("BEGIN", "SET", "COMMIT") })
  if ($rows.Count -eq 0) { throw "Knowledge snapshot catalog is empty." }
  return Get-T5Sha256Text (($rows -join "`n") + "`n")
}

function Get-RestoreFingerprint {
  param([string]$ContainerId, [string]$Database)
  $rows = @(Invoke-ContainerSql $ContainerId $Database (Get-CatalogSql) | Where-Object { $_ })
  if ($rows.Count -eq 0) { throw "Restored Knowledge catalog is empty." }
  return Get-T5Sha256Text (($rows -join "`n") + "`n")
}

function Get-MetadataDigestSql {
  param([string[]]$Tables)
  $parts = foreach ($table in $Tables) {
    "SELECT '$table|' || coalesce(string_agg(to_jsonb(row_value)::text, E'\\n' ORDER BY to_jsonb(row_value)::text), '') FROM knowledge.$table AS row_value"
  }
  return ($parts -join " UNION ALL ") + " ORDER BY 1"
}

function Assert-PrivatePath {
  param([string]$Path, [switch]$Directory)
  $resolvedParent = if ($Directory) { Split-Path -Parent $Path } else { Split-Path -Parent $Path }
  if (-not (Test-Path -LiteralPath $resolvedParent -PathType Container)) { throw "Approved backup parent is missing." }
  $current = Get-Item -LiteralPath $resolvedParent -Force
  while ($current) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Backup path traverses a reparse point." }
    $current = $current.Parent
  }
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Backup target is a reparse point." }
  }
}

function Set-PrivateAcl {
  param([string]$Path, [switch]$Directory)
  $grant = if ($Directory) { "${env:USERNAME}:(OI)(CI)F" } else { "${env:USERNAME}:F" }
  & icacls.exe $Path /inheritance:r /grant:r $grant | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to apply private backup ACL." }
  $acl = Get-Acl -LiteralPath $Path
  if ($acl.AreAccessRulesProtected -ne $true) { throw "Backup ACL inheritance is still enabled." }
  $unexpected = @($acl.Access | Where-Object { $_.AccessControlType -eq "Allow" -and $_.IdentityReference.Value -notmatch "(^|\\)$([regex]::Escape($env:USERNAME))$" })
  if ($unexpected.Count -ne 0) { throw "Backup ACL grants an unrelated principal." }
}

function Assert-NoBackupCollision {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) { throw "Final recovery archive collision; overwrite is forbidden." }
}

function Assert-FileChecksum {
  param([string]$Path, [string]$ExpectedSha256)
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -cne $ExpectedSha256) { throw "Recovery archive checksum mismatch." }
}

function Assert-DisposableRestoreTarget {
  param([string]$ContainerId, [string]$Database, [string]$LiveContainerId, [string]$LiveDatabase)
  if ($ContainerId -eq $LiveContainerId -or $Database -eq $LiveDatabase -or $Database -notmatch '^knowledge_restore_[a-f0-9]{12}$') {
    throw "Live-database restore guard rejected the destination."
  }
}

function Assert-BackupGuardSelfTests {
  $guardRoot = Join-Path $env:LOCALAPPDATA "ZinkKnowledge\guard-selftest-$runId"
  $target = Join-Path $guardRoot "target"
  $junction = Join-Path $guardRoot "junction"
  try {
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $target | Out-Null
    try {
      Assert-PrivatePath $junction -Directory
      throw "Backup destination reparse guard did not fail closed."
    }
    catch {
      if ($_.Exception.Message -notmatch "reparse point") { throw }
    }
    $collision = Join-Path $target "existing.dump"
    [IO.File]::WriteAllBytes($collision, [byte[]](1, 2, 3))
    try {
      Assert-NoBackupCollision $collision
      throw "Backup collision guard did not fail closed."
    }
    catch {
      if ($_.Exception.Message -notmatch "collision") { throw }
    }
    try {
      Assert-FileChecksum $collision ("0" * 64)
      throw "Backup checksum guard did not fail closed."
    }
    catch {
      if ($_.Exception.Message -notmatch "checksum mismatch") { throw }
    }
    try {
      Assert-DisposableRestoreTarget "live" "postgres" "live" "postgres"
      throw "Live restore-target guard did not fail closed."
    }
    catch {
      if ($_.Exception.Message -notmatch "Live-database restore guard") { throw }
    }
  }
  finally {
    Remove-Item -LiteralPath $junction -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $guardRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function New-PrivateBackupRoot {
  if (-not (Test-Path -LiteralPath $BackupBase -PathType Container)) { New-Item -ItemType Directory -Path $BackupBase -Force | Out-Null }
  Assert-PrivatePath $BackupBase -Directory
  Set-PrivateAcl $BackupBase -Directory
  if (Test-Path -LiteralPath $backupRoot) { throw "Run-scoped recovery point already exists; overwrite is forbidden." }
  New-Item -ItemType Directory -Path $backupRoot | Out-Null
  Assert-PrivatePath $backupRoot -Directory
  Set-PrivateAcl $backupRoot -Directory
}

function Wait-BackupSnapshot {
  $path = Join-Path $barrierRoot "snapshot.json"
  for ($attempt = 0; $attempt -lt 1200; $attempt++) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      try {
        $value = Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json
        if ($value.token -eq $script:barrierToken -and $value.snapshot_id -match '^\d+:\d+:\d+$') { return $value }
      } catch { }
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Knowledge did not export the pre-mutation backup snapshot."
}

function Assert-BackupAndRestore {
  param([string]$PostgresId, [object]$Snapshot, [string]$CatalogBefore)

  New-PrivateBackupRoot
  $containerDump = "/tmp/m4-recovery-$runId.dump"
  $temporaryDump = Join-Path $backupRoot "m4-recovery-$runId.dump.tmp"
  try {
    $toolVersion = (& docker exec $PostgresId pg_dump --version).Trim()
    $restoreToolVersion = (& docker exec $PostgresId pg_restore --version).Trim()
    if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch 'pg_dump \(PostgreSQL\) 17\.' -or $restoreToolVersion -notmatch 'pg_restore \(PostgreSQL\) 17\.') { throw "Reviewed PostgreSQL backup tool identity is invalid." }
    & docker exec $PostgresId pg_dump --username=postgres --dbname=postgres --format=custom --no-owner --no-acl --schema=knowledge --snapshot=$($Snapshot.snapshot_id) --file=$containerDump
    if ($LASTEXITCODE -ne 0) { throw "Knowledge recovery-point backup failed." }
    $inventory = @(& docker exec $PostgresId pg_restore --list $containerDump)
    if ($LASTEXITCODE -ne 0 -or $inventory.Count -eq 0) { throw "Recovery archive inventory is unreadable." }
    foreach ($required in @("schema_migrations", "indexes", "index_runs", "sources", "source_sidecars", "segments")) {
      if (@($inventory | Where-Object { $_ -match "TABLE( DATA)? knowledge $required( |$)" }).Count -eq 0) { throw "Recovery archive is missing required object $required." }
    }
    if (@($Snapshot.migration_versions) -contains "002_pdf_ingestion_foundation.sql") {
      foreach ($required in @("pdf_content_builds", "pdf_content_batches", "pdf_content_segments", "pdf_source_details", "index_run_source_counts")) {
        if (@($inventory | Where-Object { $_ -match "TABLE( DATA)? knowledge $required( |$)" }).Count -eq 0) { throw "Recovery archive is missing M4 object $required." }
      }
    }
    $expectedTables = @("indexes", "index_runs", "schema_migrations", "segments", "source_sidecars", "sources")
    if (@($Snapshot.migration_versions) -contains "002_pdf_ingestion_foundation.sql") { $expectedTables += @("index_run_source_counts", "pdf_content_batches", "pdf_content_builds", "pdf_content_segments", "pdf_source_details") }
    $actualTables = @(Invoke-LiveSnapshotSql "SELECT table_name FROM information_schema.tables WHERE table_schema='knowledge' AND table_type='BASE TABLE' ORDER BY table_name" $Snapshot.snapshot_id | Where-Object { $_ -and $_ -notin @("BEGIN", "SET", "COMMIT") })
    if (($actualTables -join "`n") -cne (@($expectedTables | Sort-Object) -join "`n")) { throw "Knowledge backup scope contains an unknown or missing table." }
    & docker cp "${PostgresId}:$containerDump" $temporaryDump
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $temporaryDump -PathType Leaf) -or (Get-Item $temporaryDump).Length -le 0) { throw "Recovery archive copy is missing or empty." }
    Assert-PrivatePath $temporaryDump
    Set-PrivateAcl $temporaryDump
    Assert-NoBackupCollision $dumpPath
    Move-Item -LiteralPath $temporaryDump -Destination $dumpPath
    Set-PrivateAcl $dumpPath
    $dumpSha256 = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-FileChecksum $dumpPath $dumpSha256

    $truncatedHost = Join-Path $backupRoot "truncated-attack-test.dump"
    $truncatedContainer = "/tmp/truncated-attack-test-$runId.dump"
    try {
      $input = [IO.File]::OpenRead($dumpPath)
      $output = [IO.File]::Create($truncatedHost)
      try {
        $buffer = [byte[]]::new(64)
        $read = $input.Read($buffer, 0, $buffer.Length)
        $output.Write($buffer, 0, $read)
      }
      finally { $output.Dispose(); $input.Dispose() }
      & docker cp $truncatedHost "${PostgresId}:$truncatedContainer" | Out-Null
      & docker exec $PostgresId pg_restore --list $truncatedContainer 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { throw "Truncated recovery archive was accepted." }
    }
    finally {
      & docker exec $PostgresId rm -f $truncatedContainer 2>$null | Out-Null
      Remove-Item -LiteralPath $truncatedHost -Force -ErrorAction SilentlyContinue
    }

    $criticalTables = @("indexes", "index_runs", "sources", "source_sidecars")
    if (@($Snapshot.migration_versions) -contains "002_pdf_ingestion_foundation.sql") { $criticalTables += @("pdf_content_builds", "pdf_content_batches", "pdf_content_segments", "pdf_source_details", "index_run_source_counts") }
    $metadataRows = @(Invoke-LiveSnapshotSql (Get-MetadataDigestSql $criticalTables) $Snapshot.snapshot_id | Where-Object { $_ -and $_ -notin @("BEGIN", "SET", "COMMIT") })
    $metadataDigest = Get-T5Sha256Text (($metadataRows -join "`n") + "`n")
    $sequenceSql = "SELECT 'sequence|' || sequencename || '|' || coalesce(last_value::text,'') || '|' || increment_by::text || '|' || min_value::text || '|' || max_value::text FROM pg_sequences WHERE schemaname='knowledge' UNION ALL SELECT 'identity|' || table_name || '|' || column_name || '|' || identity_generation || '|' || identity_start || '|' || identity_increment FROM information_schema.columns WHERE table_schema='knowledge' AND is_identity='YES' ORDER BY 1"
    $sequenceRows = @(Invoke-LiveSnapshotSql $sequenceSql $Snapshot.snapshot_id | Where-Object { $_ -and $_ -notin @("BEGIN", "SET", "COMMIT") })

    $restoreImage = "pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21"
    & docker run --detach --name $restoreContainer --network none --memory 1g --pids-limit 256 --security-opt no-new-privileges:true --read-only --tmpfs /tmp:rw,nosuid,nodev,noexec,size=2048m --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1536m --tmpfs /var/run/postgresql:rw,nosuid,nodev,size=32m --env POSTGRES_HOST_AUTH_METHOD=trust --label com.personal-tool.acceptance=t5 --label com.personal-tool.acceptance-run=$runId $restoreImage | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Disposable recovery database failed to start." }
    $script:restoreContainerStarted = $true
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
      & docker exec $restoreContainer pg_isready --username=postgres --dbname=postgres | Out-Null
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep -Milliseconds 500
    }
    if ($LASTEXITCODE -ne 0) { throw "Disposable recovery database is not ready." }
    $restoreDatabase = "knowledge_restore_$($runId.Substring(0,12))"
    Assert-DisposableRestoreTarget $restoreContainer $restoreDatabase $PostgresId $Snapshot.database.database_name
    & docker exec $restoreContainer createdb --username=postgres $restoreDatabase
    if ($LASTEXITCODE -ne 0) { throw "Disposable recovery database creation failed." }
    Invoke-ContainerSql $restoreContainer $restoreDatabase "CREATE EXTENSION vector;" | Out-Null
    & docker cp $dumpPath "${restoreContainer}:/tmp/recovery.dump"
    if ($LASTEXITCODE -ne 0) { throw "Recovery archive could not enter the disposable target." }
    & docker exec $restoreContainer timeout 240 pg_restore --username=postgres --dbname=$restoreDatabase --exit-on-error --no-owner --no-acl /tmp/recovery.dump
    if ($LASTEXITCODE -ne 0) { throw "Disposable recovery restore failed." }
    $restoredCatalog = Get-RestoreFingerprint $restoreContainer $restoreDatabase
    if ($restoredCatalog -cne $CatalogBefore) { throw "Restored structural catalog fingerprint differs from the recovery snapshot." }
    $restoredLedger = @(Invoke-ContainerSql $restoreContainer $restoreDatabase "SELECT version FROM knowledge.schema_migrations ORDER BY version" | Where-Object { $_ })
    if (($restoredLedger -join "`n") -cne (@($Snapshot.migration_versions) -join "`n")) { throw "Restored migration ledger differs from the recovery snapshot." }
    $restoredActive = @(Invoke-ContainerSql $restoreContainer $restoreDatabase "SELECT id::text FROM knowledge.indexes WHERE status='ACTIVE' ORDER BY id" | Where-Object { $_ })
    if (($restoredActive -join "`n") -cne (@($Snapshot.prior_active_ids) -join "`n")) { throw "Restored ACTIVE identity differs from the recovery snapshot." }
    $restoredMetadataRows = @(Invoke-ContainerSql $restoreContainer $restoreDatabase (Get-MetadataDigestSql $criticalTables) | Where-Object { $_ })
    $restoredMetadataDigest = Get-T5Sha256Text (($restoredMetadataRows -join "`n") + "`n")
    if ($restoredMetadataDigest -cne $metadataDigest) { throw "Restored recovery-critical metadata digest differs." }
    $restoredSequences = @(Invoke-ContainerSql $restoreContainer $restoreDatabase $sequenceSql | Where-Object { $_ })
    if (($restoredSequences -join "`n") -cne ($sequenceRows -join "`n")) { throw "Restored sequence/identity state differs." }
    $restoredDatabaseIdentity = @((Invoke-ContainerSql $restoreContainer $restoreDatabase "SELECT current_setting('server_version_num') || '|' || current_setting('server_encoding') || '|' || current_setting('lc_collate') || '|' || current_setting('lc_ctype')" | Where-Object { $_ }))[0]
    $expectedDatabaseIdentity = "$($Snapshot.database.server_version_num)|$($Snapshot.database.server_encoding)|$($Snapshot.database.lc_collate)|$($Snapshot.database.lc_ctype)"
    if ($restoredDatabaseIdentity -cne $expectedDatabaseIdentity) { throw "Disposable recovery database compatibility differs from the live snapshot." }
    $restoredExtensions = @(Invoke-ContainerSql $restoreContainer $restoreDatabase "SELECT extname || '|' || extversion FROM pg_extension ORDER BY extname" | Where-Object { $_ })
    $expectedExtensions = @($Snapshot.extensions | ForEach-Object { "$($_.name)|$($_.version)" })
    if (($restoredExtensions -join "`n") -cne ($expectedExtensions -join "`n")) { throw "Disposable recovery extension identity differs from the live snapshot." }

    $manifest = [ordered]@{
      schema_version = 2
      opaque_backup_id = $runId
      implementation_candidate_sha = (Get-T5RepositorySha)
      dump_sha256 = $dumpSha256
      dump_bytes = (Get-Item -LiteralPath $dumpPath).Length
      pg_dump = $toolVersion
      pg_restore = $restoreToolVersion
      database = $Snapshot.database
      extensions = $Snapshot.extensions
      migration_versions = @($Snapshot.migration_versions)
      prior_active_count = @($Snapshot.prior_active_ids).Count
      catalog_sha256 = $CatalogBefore
      metadata_sha256 = $metadataDigest
      sequence_identity_gate = if ($sequenceRows.Count -eq 0) { "N/A" } else { "PASS" }
      known_credential_store_in_scope = $false
      arbitrary_knowledge_content_may_contain_secrets = $true
      owner_acl_restore = "excluded-and-validated-separately"
      result = "PASS"
    }
    Write-T5AtomicJson $manifestPath $manifest
    Set-PrivateAcl $manifestPath
    $evidence.recovery_point = [ordered]@{ created = $true; opaque_backup_id = $runId; manifest_sha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant(); restore_verified = $true }
  }
  finally {
    & docker exec $PostgresId rm -f $containerDump 2>$null | Out-Null
    Remove-Item -LiteralPath $temporaryDump -Force -ErrorAction SilentlyContinue
  }
}

function Assert-LiveSearch {
  param([System.Collections.IDictionary]$Request, [string]$SourceType = "MARKDOWN")
  $response = Invoke-LiveApi "POST" "/v1/search" ($Request | ConvertTo-Json -Compress)
  if ($response.status -ne 200) { throw "Knowledge search failed (HTTP $($response.status))." }
  $results = @(($response.body | ConvertFrom-Json).results)
  if ($SourceType -eq "PDF") {
    if (@($results | Where-Object source_type -eq "PDF").Count -lt 1) { throw "Live combined retrieval returned no PDF result." }
    return [ordered]@{ pdf_found = $true }
  }
  $result = @($results | Where-Object { $_.source_path -eq $ExpectedSourcePath } | Select-Object -First 1)[0]
  $score = if ($result) { [double]$result.rerank_score } else { [double]::NaN }
  if (-not $result -or [double]::IsNaN($score) -or [double]::IsInfinity($score) -or $score -lt 0 -or $score -gt 1 -or $result.citation.line_start -lt 1) { throw "Expected Markdown source did not survive live retrieval." }
  return [ordered]@{ markdown_found = $true; rerank_score = $score; citation_valid = $true }
}

try {
  if (-not $ConfirmPersistentIndex) { throw "ConfirmPersistentIndex is required." }
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing." }
  Assert-T5CleanRepository
  $canonicalVault = Get-T5CanonicalVaultRoot $VaultRoot
  Assert-T5ExpectedSourcePath $canonicalVault $ExpectedSourcePath | Out-Null
  $filters = Get-T5SearchFilters $canonicalVault $ExpectedSourcePath
  $vaultHash = Get-T5VaultTreeHash $canonicalVault
  $candidate = Get-T5Candidate
  $matching = Get-T5MatchingRealVaultEvidence $candidate $canonicalVault $vaultHash $Query $ExpectedSourcePath
  if (-not $matching) { throw "No matching isolated RealVault PASS evidence exists; aborting before database mutation." }
  $evidence.candidate = $candidate
  $evidence.deployment = Get-T5DeploymentFingerprint $ProjectName "operational"
  $evidence.isolated_evidence_run_id = $matching.acceptance_run_id
  Assert-BackupGuardSelfTests

  New-Item -ItemType Directory -Path $barrierRoot | Out-Null
  Assert-PrivatePath $barrierRoot -Directory
  Set-PrivateAcl $barrierRoot -Directory
  $script:barrierToken = Get-T5Sha256Text "$runId|$($candidate.repository_sha)"
  Write-ExclusiveText (Join-Path $barrierRoot "request") $script:barrierToken
  $env:KNOWLEDGE_T5_BACKUP_BARRIER_ROOT = $barrierRoot
  $env:KNOWLEDGE_VAULT_ROOT = $canonicalVault

  Invoke-LiveCompose @("up", "--detach", "--wait", "--wait-timeout", "180", "object-storage", "postgres", "redis", "nginx")
  $schemaExists = ((Invoke-LiveSql "SELECT to_regclass('knowledge.schema_migrations') IS NOT NULL AND to_regclass('knowledge.indexes') IS NOT NULL;") -join "").Trim() -eq "t"
  if (-not $schemaExists) { throw "M4 live acceptance requires the recoverable M3 Knowledge schema." }
  $ledgerBefore = @(Invoke-LiveSql "SELECT version FROM knowledge.schema_migrations ORDER BY version" | Where-Object { $_ })
  $allowedLedgers = @("001_initial.sql", "001_initial.sql`n002_pdf_ingestion_foundation.sql")
  if (($ledgerBefore -join "`n") -notin $allowedLedgers) { throw "Knowledge migration ledger is missing, corrupt, or unknown." }

  Invoke-LiveCompose @("up", "--detach", "knowledge")
  $script:knowledgeStarted = $true
  $snapshot = Wait-BackupSnapshot
  if (($snapshot.migration_versions -join "`n") -cne ($ledgerBefore -join "`n")) { throw "Backup snapshot migration identity drifted from preflight." }
  $catalogBefore = Get-LiveSnapshotFingerprint $snapshot.snapshot_id
  $postgresId = (Invoke-LiveCompose @("ps", "-q", "postgres")).Trim()
  Assert-BackupAndRestore $postgresId $snapshot $catalogBefore
  Write-ExclusiveText (Join-Path $barrierRoot "continue") $script:barrierToken

  Wait-LiveReady
  $knowledgeId = (Invoke-LiveCompose @("ps", "-q", "knowledge")).Trim()
  $nginxId = (Invoke-LiveCompose @("ps", "-q", "nginx")).Trim()
  Assert-T5ReadOnlyMount $knowledgeId $runId
  Assert-T5NetworkBoundary $knowledgeId $nginxId
  Assert-T5PrivilegeBoundary $knowledgeId
  $ledgerAfterStart = @(Invoke-LiveSql "SELECT version FROM knowledge.schema_migrations ORDER BY version" | Where-Object { $_ })
  if (($ledgerAfterStart -join "`n") -cne "001_initial.sql`n002_pdf_ingestion_foundation.sql") { throw "M4 migration ledger is invalid after service start." }
  $catalogAfterStart = ((Invoke-LiveSql (Get-CatalogSql) | Where-Object { $_ }) -join "`n") + "`n"
  if ((Get-T5Sha256Text $catalogAfterStart) -cne $matching.migration.schema_catalog_fingerprint) { throw "Operational M4 catalog differs from isolated exact-candidate acceptance." }

  $request = [ordered]@{ query = $Query; limit = 20; primary_topic = $filters.primary_topic; tags_all = $filters.tags_all; path_prefix = $filters.path_prefix; source_types = @("MARKDOWN") }
  $accepted = Invoke-LiveApi "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.status -ne 202) { throw "Persistent full rebuild was rejected (HTTP $($accepted.status))." }
  $rebuildBefore = Get-T5CgroupSnapshot $knowledgeId
  $run = Wait-LiveRun (($accepted.body | ConvertFrom-Json).index_run_id)
  if ($run.status -ne "SUCCEEDED") { throw "Persistent full rebuild failed with safe code '$($run.failure_code)'." }
  $sourceCounts = @($run.source_counts | ForEach-Object { "$($_.source_type):$($_.discovered_count):$($_.indexed_count):$($_.failed_count)" })
  if (@($run.source_counts | Where-Object { $_.source_type -eq "MARKDOWN" -and $_.indexed_count -gt 0 }).Count -ne 1 -or @($run.source_counts | Where-Object { $_.source_type -eq "PDF" -and $_.indexed_count -gt 0 }).Count -ne 1) { throw "Persistent combined Markdown/PDF indexing did not pass." }
  $markdownEvidence = Assert-LiveSearch $request
  $pdfEvidence = Assert-LiveSearch ([ordered]@{ query = $Query; limit = 20; source_types = @("PDF") }) "PDF"
  $rebuildEvidence = Get-T5ResourceWindow $rebuildBefore (Get-T5CgroupSnapshot $knowledgeId) "live rebuild"
  $activeState = ((Invoke-LiveSql "SELECT count(*) || ':' || min(id::text) FROM knowledge.indexes WHERE status='ACTIVE'") -join "").Trim()
  if ($activeState -ne "1:$($run.index_id)") { throw "Persistent rebuild did not publish exactly one expected ACTIVE index." }

  $restartBefore = Get-T5CgroupSnapshot $knowledgeId
  Invoke-LiveCompose @("restart", "knowledge")
  Wait-LiveReady
  $restartEvidence = Get-T5ResourceWindow $restartBefore (Get-T5CgroupSnapshot $knowledgeId) "live restart"
  Assert-LiveSearch $request | Out-Null
  Assert-LiveSearch ([ordered]@{ query = $Query; limit = 20; source_types = @("PDF") }) "PDF" | Out-Null
  $hashAfter = Get-T5VaultTreeHash $canonicalVault
  if ($vaultHash -ne $hashAfter) { throw "Vault changed during live acceptance." }

  $evidence.vault = [ordered]@{ unchanged = $true }
  $evidence.migration = [ordered]@{ versions_before = $ledgerBefore; versions_after = $ledgerAfterStart }
  $evidence.index = [ordered]@{ new_active_index_id = $run.index_id; active_count = 1; source_counts = $sourceCounts }
  $evidence.retrieval = [ordered]@{ markdown = $markdownEvidence; pdf = $pdfEvidence }
  $evidence.runtime = [ordered]@{ rebuild = $rebuildEvidence; restart = $restartEvidence }
  $evidence.security_recovery_gate = "PASS"
  $evidence.result = "PASS"
  $acceptedCandidate = [ordered]@{
    schema_version = 2
    implementation_candidate_sha = $candidate.repository_sha
    candidate_manifest_sha256 = $candidate.candidate_manifest.candidate_manifest_sha256
    candidate_path_set_sha256 = $candidate.candidate_manifest.candidate_path_set_sha256
    candidate_path_count = $candidate.candidate_manifest.candidate_path_count
    live_acceptance_run_id = $runId
    status = "REMOTE-PENDING"
    result = "PASS"
  }
  $acceptedCandidatePath = Join-Path $script:T5EvidenceDirectory "accepted-candidate-$($candidate.repository_sha).json"
}
catch {
  $script:bodyFailed = $true
  $evidence.error_code = "SECURITY_RECOVERY_GATE_FAILED"
  throw
}
finally {
  $evidence.finished_at = [DateTime]::UtcNow.ToString("o")
  $finalizationError = $null
  try { Write-T5Evidence "live" $runId $evidence | Out-Null } catch { $finalizationError = $_.Exception }
  try {
    if ($script:restoreContainerStarted) { & docker rm -f $restoreContainer 2>$null | Out-Null }
    if ($evidence.result -ne "PASS" -and $script:knowledgeStarted) {
      $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
      try { Invoke-LiveCompose @("stop", "knowledge") | Out-Null } finally { $ErrorActionPreference = $previous }
    }
  }
  catch {
    if ($null -eq $finalizationError) { $finalizationError = $_.Exception }
  }
  Remove-Item Env:KNOWLEDGE_VAULT_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:KNOWLEDGE_T5_BACKUP_BARRIER_ROOT -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $barrierRoot -Recurse -Force -ErrorAction SilentlyContinue
  if ($null -eq $finalizationError -and $evidence.result -eq "PASS") {
    try {
      Initialize-T5PrivateEvidenceDirectory
      if (Test-Path -LiteralPath $acceptedCandidatePath) { throw "Accepted candidate evidence is immutable and already exists." }
      Write-T5AtomicJson $acceptedCandidatePath $acceptedCandidate
    }
    catch { $finalizationError = $_.Exception }
  }
  if ($null -ne $finalizationError -and -not $script:bodyFailed) { throw "M4/T5 live evidence finalization or cleanup failed." }
}
Write-Output "M4/T5 live acceptance passed."
