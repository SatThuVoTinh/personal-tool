[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$VaultRoot,
  [Parameter(Mandatory = $true)][string]$Query,
  [Parameter(Mandatory = $true)][string]$ExpectedSourcePath,
  [Parameter(Mandatory = $true)][switch]$ConfirmPersistentIndex,
  [string]$EnvironmentFile = "",
  [string]$ProjectName = "personal-tool"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "knowledge-t5-common.ps1")

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }

$runId = [guid]::NewGuid().ToString("N")
$composeFile = Join-Path $script:T5DockerDirectory "compose\compose.core.yml"
$knowledgeComposeFile = Join-Path $script:T5DockerDirectory "compose\compose.knowledge.yml"
$backupRoot = Join-Path $script:T5RepositoryRoot "backups\knowledge-t5\$runId"
$evidence = [ordered]@{ schema_version = 1; mode = "Live"; result = "FAIL"; acceptance_run_id = $runId; started_at = [DateTime]::UtcNow.ToString("o") }

function Invoke-LiveCompose {
  param([switch]$KnowledgeOverlay, [string[]]$Arguments)
  $composeArguments = @("--project-name", $ProjectName, "--env-file", $EnvironmentFile, "-f", $composeFile)
  if ($KnowledgeOverlay) { $composeArguments += @("-f", $knowledgeComposeFile) }
  & docker compose @composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command '$($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

function Invoke-LiveSql {
  param([string]$Sql)
  Invoke-LiveCompose -Arguments @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", $Sql)
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
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $ready = Invoke-LiveApi "GET" "/readyz"
    if ($ready.status -eq 200) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Knowledge readiness did not recover."
}

function Wait-LiveRun {
  param([string]$IndexRunId)
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $response = Invoke-LiveApi "GET" "/v1/index-runs/$IndexRunId"
    if ($response.status -eq 200) {
      $run = $response.body | ConvertFrom-Json
      if ($run.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $run }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Persistent index run did not reach a terminal state."
}

function Get-LiveSchemaCatalogFingerprint {
  $catalogSql = @"
SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
FROM information_schema.columns WHERE table_schema = 'knowledge'
UNION ALL
SELECT 'index|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'knowledge'
UNION ALL
SELECT 'constraint|' || c.conname || '|' || pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'knowledge';
"@
  $rows = @(Invoke-LiveSql $catalogSql | Where-Object { $_ } | Sort-Object)
  if ($rows.Count -eq 0) { throw "Knowledge schema catalog is empty." }
  return Get-T5Sha256Text (($rows -join "`n") + "`n")
}

function Assert-LiveSearch {
  param([System.Collections.IDictionary]$Request, [switch]$RequireExpectedSource)
  $response = Invoke-LiveApi "POST" "/v1/search" ($Request | ConvertTo-Json -Compress)
  if ($response.status -ne 200) { throw "Knowledge search failed (HTTP $($response.status)): $($response.body)" }
  $results = @(($response.body | ConvertFrom-Json).results)
  if (-not $RequireExpectedSource) { return $results }
  $result = @($results | Where-Object { $_.source_path -eq $ExpectedSourcePath } | Select-Object -First 1)[0]
  $score = if ($result) { [double]$result.rerank_score } else { [double]::NaN }
  if (-not $result -or [double]::IsNaN($score) -or [double]::IsInfinity($score) -or $score -lt 0 -or $score -gt 1) {
    throw "Expected source did not survive live reranking."
  }
  if ($result.citation.source_path -ne $ExpectedSourcePath -or $result.citation.line_start -lt 1 -or $result.citation.line_end -lt $result.citation.line_start) {
    throw "Live citation is invalid."
  }
  return [ordered]@{ source_found = $true; rerank_score = $score; citation_valid = $true; rerank_valid = $true }
}

try {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing: $EnvironmentFile" }
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
  $env:KNOWLEDGE_VAULT_ROOT = $canonicalVault

  Invoke-LiveCompose -KnowledgeOverlay -Arguments @("up", "--detach", "--wait", "--wait-timeout", "180", "object-storage", "postgres", "redis", "nginx")
  $schemaExists = ((Invoke-LiveSql "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'knowledge');") -join "").Trim() -eq "t"
  $previousActive = $null
  $catalogBefore = $null
  if ($schemaExists) {
    $requiredTables = ((Invoke-LiveSql "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'knowledge' AND table_name IN ('schema_migrations','indexes','index_runs','sources','source_sidecars','segments');") -join "").Trim()
    if ($requiredTables -ne "6") { throw "Knowledge schema is present but required tables are missing." }
    $ledger = @(Invoke-LiveSql "SELECT version FROM knowledge.schema_migrations ORDER BY version;") | Where-Object { $_ }
    if (($ledger -join "") -ne "001_initial.sql") { throw "Knowledge schema migration ledger is missing, corrupt, or unknown." }
    $catalogBefore = Get-LiveSchemaCatalogFingerprint
    if ($matching.migration.schema_catalog_fingerprint -ne $catalogBefore) { throw "Operational Knowledge schema catalog does not match isolated acceptance." }
    $activeRows = @(Invoke-LiveSql "SELECT id::text FROM knowledge.indexes WHERE status = 'ACTIVE';" | Where-Object { $_ })
    if ($activeRows.Count -gt 1) { throw "Operational database contains more than one ACTIVE index." }
    if ($activeRows.Count -eq 1) { $previousActive = $activeRows[0].Trim() }
  }
  $evidence.preflight = [ordered]@{ schema_present = $schemaExists; schema_catalog_fingerprint = $catalogBefore; previous_active_index_id = $previousActive }

  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  if ($schemaExists) {
    & docker compose --project-name $ProjectName --env-file $EnvironmentFile -f $composeFile run --rm --no-deps --entrypoint pg_dump --volume "${backupRoot}:/backup" postgres --username=postgres --dbname=postgres --format=custom --schema=knowledge --file=/backup/knowledge.dump
    if ($LASTEXITCODE -ne 0) { throw "Knowledge recovery-point backup failed." }
    $dumpPath = Join-Path $backupRoot "knowledge.dump"
    if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { throw "Knowledge recovery-point dump is missing." }
    $evidence.recovery_point = [ordered]@{ schema_present = $true; path = $dumpPath; sha256 = (Get-FileHash -LiteralPath $dumpPath -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
  else {
    $evidence.recovery_point = [ordered]@{ schema_present = $false }
  }

  if (-not $ConfirmPersistentIndex) { throw "ConfirmPersistentIndex is required." }
  Invoke-LiveCompose -KnowledgeOverlay -Arguments @("up", "--detach", "--wait", "--wait-timeout", "300", "knowledge")
  $knowledgeId = (Invoke-LiveCompose -KnowledgeOverlay -Arguments @("ps", "-q", "knowledge")).Trim()
  $nginxId = (Invoke-LiveCompose -KnowledgeOverlay -Arguments @("ps", "-q", "nginx")).Trim()
  Assert-T5ReadOnlyMount $knowledgeId $runId
  Assert-T5NetworkBoundary $knowledgeId $nginxId
  $ledgerAfterStart = @(Invoke-LiveSql "SELECT version FROM knowledge.schema_migrations ORDER BY version;") | Where-Object { $_ }
  if (($ledgerAfterStart -join "") -ne "001_initial.sql") { throw "Knowledge migration ledger is invalid after service start." }
  $catalogAfterStart = Get-LiveSchemaCatalogFingerprint
  if ($matching.migration.schema_catalog_fingerprint -ne $catalogAfterStart) { throw "Live Knowledge schema catalog does not match isolated acceptance." }
  $request = [ordered]@{ query = $Query; limit = 20; primary_topic = $filters.primary_topic; tags_all = $filters.tags_all; path_prefix = $filters.path_prefix }
  if ($previousActive) { Assert-LiveSearch $request | Out-Null }

  $rebuildBefore = Get-T5CgroupSnapshot $knowledgeId
  $accepted = Invoke-LiveApi "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.status -ne 202) { throw "Persistent full rebuild was rejected (HTTP $($accepted.status)): $($accepted.body)" }
  $run = Wait-LiveRun (($accepted.body | ConvertFrom-Json).index_run_id)
  if ($run.status -ne "SUCCEEDED") { throw "Persistent full rebuild failed with safe code '$($run.failure_code)'." }
  $retrievalEvidence = Assert-LiveSearch $request -RequireExpectedSource
  $rebuildAfter = Get-T5CgroupSnapshot $knowledgeId
  $rebuildEvidence = Get-T5ResourceWindow $rebuildBefore $rebuildAfter "live rebuild"
  $activeState = ((Invoke-LiveSql "SELECT count(*) || ':' || min(id::text) FROM knowledge.indexes WHERE status = 'ACTIVE';") -join "").Trim()
  if ($activeState -ne "1:$($run.index_id)") { throw "Persistent rebuild did not publish exactly the expected ACTIVE index: $activeState" }
  $previousState = if ($previousActive) { ((Invoke-LiveSql "SELECT coalesce((SELECT status::text FROM knowledge.indexes WHERE id = '$previousActive'), 'REMOVED');") -join "").Trim() } else { $null }
  if ($previousState -and $previousState -notin @("SUPERSEDED", "REMOVED")) { throw "Previous ACTIVE index reached an invalid state: $previousState" }

  $restartBefore = Get-T5CgroupSnapshot $knowledgeId
  Invoke-LiveCompose -KnowledgeOverlay -Arguments @("restart", "knowledge")
  Wait-LiveReady
  $restartAfter = Get-T5CgroupSnapshot $knowledgeId
  $restartEvidence = Get-T5ResourceWindow $restartBefore $restartAfter "live restart"
  Assert-LiveSearch $request -RequireExpectedSource | Out-Null
  $ledgerAfterRestart = @(Invoke-LiveSql "SELECT version FROM knowledge.schema_migrations ORDER BY version;") | Where-Object { $_ }
  if (($ledgerAfterRestart -join "") -ne "001_initial.sql") { throw "Migration ledger changed after live restart." }
  $catalogAfterRestart = Get-LiveSchemaCatalogFingerprint
  if ($catalogAfterStart -ne $catalogAfterRestart) { throw "Knowledge schema catalog changed after live restart." }
  $hashAfter = Get-T5VaultTreeHash $canonicalVault
  if ($vaultHash -ne $hashAfter) { throw "Vault changed during live acceptance." }

  $evidence.vault = [ordered]@{ canonical_root = $canonicalVault; tree_hash_before = $vaultHash; tree_hash_after = $hashAfter; unchanged = $true }
  $evidence.request = [ordered]@{ query = $Query; expected_source_path = $ExpectedSourcePath; filters = $filters }
  $evidence.migration = [ordered]@{ versions_after_start = $ledgerAfterStart; versions_after_restart = $ledgerAfterRestart; schema_catalog_fingerprint = $catalogAfterRestart; reapplied_after_restart = $false }
  $evidence.index = [ordered]@{ previous_active_index_id = $previousActive; previous_active_observed_state = $previousState; new_active_index_id = $run.index_id; active_count = 1; sources_indexed = $run.sources_indexed }
  $evidence.retrieval = $retrievalEvidence
  $evidence.runtime = [ordered]@{ rebuild = $rebuildEvidence; restart = $restartEvidence }
  $evidence.result = "PASS"
  $acceptedCandidate = [ordered]@{
    schema_version = 1
    accepted_candidate_sha = $candidate.repository_sha
    accepted_candidate_source_digest = $candidate.candidate_source_digest
    live_acceptance_run_id = $runId
    result = "PASS"
  }
  Write-T5AtomicJson (Join-Path $script:T5EvidenceDirectory "accepted-candidate.json") $acceptedCandidate
  Write-Output "M3/T5 live acceptance passed."
}
catch {
  $evidence.error = $_.Exception.Message
  throw
}
finally {
  $evidence.finished_at = [DateTime]::UtcNow.ToString("o")
  Write-T5Evidence "live" $runId $evidence | Out-Null
  Remove-Item Env:KNOWLEDGE_VAULT_ROOT -ErrorAction SilentlyContinue
}
