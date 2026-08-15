[CmdletBinding()]
param(
  [ValidateSet("Fixture", "RealVault")]
  [string]$Mode = "Fixture",
  [string]$EnvironmentFile = "",
  [string]$VaultRoot = "",
  [string]$Query = "What is safety stock?",
  [string]$ExpectedSourcePath = "01. Knowledge/Supply Chain/safety-stock.md",
  [switch]$InjectFailureAfterStart
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "knowledge-t5-common.ps1")

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }

$runId = [guid]::NewGuid().ToString("N")
$projectName = "personal-tool-knowledge-t5-$runId"
$composeFile = Join-Path $script:T5DockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $script:T5DockerDirectory "compose\compose.m3-t5.acceptance.yml"
$fixtureVault = Join-Path $script:T5RepositoryRoot "apps\knowledge\tests\fixtures\vault"
$fixtureCopyRoot = ""
$started = $false
$apiBaseUrl = ""
$evidence = [ordered]@{ schema_version = 1; mode = $Mode; result = "FAIL"; acceptance_run_id = $runId; started_at = [DateTime]::UtcNow.ToString("o") }

function Invoke-T5Compose {
  param([string[]]$Arguments)
  & docker compose --project-name $projectName --env-file $EnvironmentFile -f $composeFile -f $acceptanceComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command '$($Arguments -join ' ')' failed with exit code $LASTEXITCODE." }
}

function Invoke-T5Api {
  param([string]$Method, [string]$Path, [string]$Body = "")
  if (-not $script:apiBaseUrl) { throw "The isolated Nginx endpoint has not been resolved." }
  $responsePath = Join-Path ([IO.Path]::GetTempPath()) "knowledge-t5-$runId-$([guid]::NewGuid().ToString('N')).json"
  $requestPath = $null
  try {
    $arguments = @("--silent", "--show-error", "--max-time", "90", "--output", $responsePath, "--write-out", "%{http_code}", "--request", $Method)
    if ($Body) {
      $requestPath = Join-Path ([IO.Path]::GetTempPath()) "knowledge-t5-$runId-$([guid]::NewGuid().ToString('N')).request.json"
      [IO.File]::WriteAllText($requestPath, $Body, [Text.UTF8Encoding]::new($false))
      $arguments += @("--header", "Content-Type: application/json", "--data-binary", "@$requestPath")
    }
    $arguments += "$script:apiBaseUrl$Path"
    $statusCode = & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed for $Path." }
    return [ordered]@{ status = [int]$statusCode; body = Get-Content -LiteralPath $responsePath -Raw -Encoding utf8 }
  }
  finally {
    Remove-Item -LiteralPath $responsePath -Force -ErrorAction SilentlyContinue
    if ($requestPath) { Remove-Item -LiteralPath $requestPath -Force -ErrorAction SilentlyContinue }
  }
}

function Wait-T5Run {
  param([string]$RunId)
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $response = Invoke-T5Api "GET" "/v1/index-runs/$RunId"
    if ($response.status -eq 200) {
      $run = $response.body | ConvertFrom-Json
      if ($run.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $run }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Index run $RunId did not reach a terminal state."
}

function Invoke-T5Sql {
  param([string]$Sql)
  Invoke-T5Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", $Sql)
}

function Start-T5FullRebuild {
  $accepted = Invoke-T5Api "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.status -ne 202) { throw "Full rebuild was not accepted (HTTP $($accepted.status)): $($accepted.body)" }
  $run = Wait-T5Run (($accepted.body | ConvertFrom-Json).index_run_id)
  if ($run.status -ne "SUCCEEDED") { throw "Full rebuild failed with safe code '$($run.failure_code)'." }
  return $run
}

function Wait-T5Ready {
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $ready = Invoke-T5Api "GET" "/readyz"
    if ($ready.status -eq 200) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "Knowledge readiness did not recover after restart."
}

function Get-T5SchemaCatalogFingerprint {
  $catalogSql = @"
SELECT 'column|' || table_name || '|' || column_name || '|' || data_type || '|' || is_nullable || '|' || coalesce(column_default, '')
FROM information_schema.columns WHERE table_schema = 'knowledge'
UNION ALL
SELECT 'index|' || indexname || '|' || indexdef FROM pg_indexes WHERE schemaname = 'knowledge'
UNION ALL
SELECT 'constraint|' || c.conname || '|' || pg_get_constraintdef(c.oid)
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'knowledge';
"@
  $rows = @(Invoke-T5Sql $catalogSql | Where-Object { $_ } | Sort-Object)
  if ($rows.Count -eq 0) { throw "Knowledge schema catalog is empty." }
  return Get-T5Sha256Text (($rows -join "`n") + "`n")
}

try {
  if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing: $EnvironmentFile" }
  Assert-T5CleanRepository
  $candidateSha = Get-T5RepositorySha
  $env:KNOWLEDGE_IMAGE_REVISION = $candidateSha
  if ($Mode -eq "Fixture") {
    $fixtureCopyRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t5-fixture-$runId"
    Copy-Item -LiteralPath $fixtureVault -Destination $fixtureCopyRoot -Recurse
    $canonicalVault = Get-T5CanonicalVaultRoot $fixtureCopyRoot
  }
  else {
    $canonicalVault = Get-T5CanonicalVaultRoot $VaultRoot
  }
  Assert-T5ExpectedSourcePath $canonicalVault $ExpectedSourcePath | Out-Null
  $filters = Get-T5SearchFilters $canonicalVault $ExpectedSourcePath
  $hashBefore = Get-T5VaultTreeHash $canonicalVault
  $env:KNOWLEDGE_T5_RUN_ID = $runId
  $env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT = $canonicalVault

  $candidate = Get-T5Candidate
  $evidence.candidate = $candidate
  $evidence.deployment = Get-T5DeploymentFingerprint $projectName "temporary"
  $started = $true
  Invoke-T5Compose @("up", "--detach", "--wait", "--wait-timeout", "300", "postgres", "nginx", "knowledge")
  $publishedEndpoint = (Invoke-T5Compose @("port", "nginx", "8080")).Trim()
  if ($publishedEndpoint -notmatch '^127\.0\.0\.1:\d+$') {
    throw "Isolated Nginx did not publish an ephemeral loopback endpoint."
  }
  $script:apiBaseUrl = "http://$publishedEndpoint/knowledge"
  if ($InjectFailureAfterStart) { throw "Intentional M3/T5 cleanup failure injection." }

  $knowledgeId = (Invoke-T5Compose @("ps", "-q", "knowledge")).Trim()
  $nginxId = (Invoke-T5Compose @("ps", "-q", "nginx")).Trim()
  Assert-T5ReadOnlyMount $knowledgeId $runId
  Assert-T5NetworkBoundary $knowledgeId $nginxId
  $ledgerBefore = @(Invoke-T5Sql "SELECT version FROM knowledge.schema_migrations ORDER BY version;") | Where-Object { $_ }
  if (($ledgerBefore -join "") -ne "001_initial.sql") { throw "Knowledge migration ledger is invalid." }
  $schemaFingerprintBefore = Get-T5SchemaCatalogFingerprint

  $oldRun = Start-T5FullRebuild
  $orphanIndexId = [guid]::NewGuid().ToString()
  $orphanRunId = [guid]::NewGuid().ToString()
  $recoverySql = @"
INSERT INTO knowledge.indexes (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions)
VALUES ('$orphanIndexId', 'BUILDING', '$($candidate.embedding.name)', '$($candidate.embedding.digest)', $($candidate.embedding.dimension));
INSERT INTO knowledge.index_runs (id, index_id, kind, status)
VALUES ('$orphanRunId', '$orphanIndexId', 'FULL_REBUILD', 'RUNNING');
"@
  Invoke-T5Sql $recoverySql | Out-Null
  $recoveryRestartBefore = Get-T5CgroupSnapshot $knowledgeId
  Invoke-T5Compose @("restart", "knowledge")
  Wait-T5Ready
  $recoveryRestartAfter = Get-T5CgroupSnapshot $knowledgeId
  $recoveryRestartEvidence = Get-T5ResourceWindow $recoveryRestartBefore $recoveryRestartAfter "recovery restart"
  $recoveryState = ((Invoke-T5Sql "SELECT (SELECT status FROM knowledge.index_runs WHERE id = '$orphanRunId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$orphanIndexId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$($oldRun.index_id)');") -join "").Trim()
  if ($recoveryState -ne "INTERRUPTED:FAILED:ACTIVE") { throw "Orphan recovery mapping is invalid: $recoveryState" }

  $rebuildBefore = Get-T5CgroupSnapshot $knowledgeId
  $run = Start-T5FullRebuild
  $request = [ordered]@{ query = $Query; limit = 20; primary_topic = $filters.primary_topic; tags_all = $filters.tags_all; path_prefix = $filters.path_prefix }
  $search = Invoke-T5Api "POST" "/v1/search" ($request | ConvertTo-Json -Compress)
  if ($search.status -ne 200) { throw "Filtered search failed." }
  $results = @((($search.body | ConvertFrom-Json).results))
  $result = @($results | Where-Object { $_.source_path -eq $ExpectedSourcePath } | Select-Object -First 1)[0]
  $rerankScore = if ($result) { [double]$result.rerank_score } else { [double]::NaN }
  if (-not $result -or [double]::IsNaN($rerankScore) -or [double]::IsInfinity($rerankScore) -or $rerankScore -lt 0 -or $rerankScore -gt 1) { throw "Expected source did not survive reranking." }
  if ($result.citation.source_path -ne $ExpectedSourcePath -or $result.citation.line_start -lt 1 -or $result.citation.line_end -lt $result.citation.line_start) { throw "Citation is invalid." }
  $rebuildAfter = Get-T5CgroupSnapshot $knowledgeId
  $rebuildEvidence = Get-T5ResourceWindow $rebuildBefore $rebuildAfter "rebuild"
  $activeState = ((Invoke-T5Sql "SELECT count(*) || ':' || min(id::text) FROM knowledge.indexes WHERE status = 'ACTIVE';") -join "").Trim()
  if ($activeState -ne "1:$($run.index_id)") { throw "Rebuild did not publish exactly the expected ACTIVE index: $activeState" }
  $oldState = ((Invoke-T5Sql "SELECT coalesce((SELECT status::text FROM knowledge.indexes WHERE id = '$($oldRun.index_id)'), 'REMOVED');") -join "").Trim()
  if ($oldState -notin @("SUPERSEDED", "REMOVED")) { throw "Previous ACTIVE index reached an invalid state: $oldState" }

  $restartBefore = Get-T5CgroupSnapshot $knowledgeId
  Invoke-T5Compose @("restart", "knowledge")
  Wait-T5Ready
  $restartAfter = Get-T5CgroupSnapshot $knowledgeId
  $restartEvidence = Get-T5ResourceWindow $restartBefore $restartAfter "restart"
  $ledgerAfter = @(Invoke-T5Sql "SELECT version FROM knowledge.schema_migrations ORDER BY version;") | Where-Object { $_ }
  if (($ledgerAfter -join "") -ne "001_initial.sql") { throw "Migration was reapplied after restart." }
  $schemaFingerprintAfter = Get-T5SchemaCatalogFingerprint
  if ($schemaFingerprintBefore -ne $schemaFingerprintAfter) { throw "Knowledge schema catalog changed after restart/rebuild." }
  $afterRestartSearch = Invoke-T5Api "POST" "/v1/search" ($request | ConvertTo-Json -Compress)
  if ($afterRestartSearch.status -ne 200) { throw "Knowledge search failed after restart." }
  $hashAfter = Get-T5VaultTreeHash $canonicalVault
  if ($hashBefore -ne $hashAfter) { throw "Vault tree hash changed during acceptance." }

  $evidence.vault = [ordered]@{ canonical_root = $canonicalVault; tree_hash_before = $hashBefore; tree_hash_after = $hashAfter; unchanged = $true }
  $evidence.request = [ordered]@{ query = $Query; expected_source_path = $ExpectedSourcePath; filters = $filters }
  $evidence.migration = [ordered]@{ versions_before = $ledgerBefore; versions_after_restart = $ledgerAfter; schema_catalog_fingerprint = $schemaFingerprintAfter; reapplied_after_restart = $false }
  $evidence.recovery = [ordered]@{ orphan_run_id = $orphanRunId; orphan_index_id = $orphanIndexId; mapping = $recoveryState; old_active_queryable = $true; restart_resource_window = $recoveryRestartEvidence }
  $evidence.index = [ordered]@{ previous_active_index_id = $oldRun.index_id; previous_active_observed_state = $oldState; new_active_index_id = $run.index_id; active_count = 1; sources_indexed = $run.sources_indexed }
  $evidence.retrieval = [ordered]@{ source_found = $true; rerank_score = $rerankScore; citation_valid = $true; rerank_valid = $true }
  $evidence.runtime = [ordered]@{ rebuild = $rebuildEvidence; restart = $restartEvidence }
  $evidence.result = "PASS"
  Write-Output "M3/T5 $Mode acceptance passed."
}
catch {
  $evidence.error = $_.Exception.Message
  throw
}
finally {
  $evidence.finished_at = [DateTime]::UtcNow.ToString("o")
  $prefix = if ($Mode -eq "Fixture") { "fixture" } else { "realvault" }
  Write-T5Evidence $prefix $runId $evidence | Out-Null
  if ($started) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { Remove-T5TemporaryResources $runId } finally { $ErrorActionPreference = $previous }
  }
  Remove-Item Env:KNOWLEDGE_T5_RUN_ID -ErrorAction SilentlyContinue
  Remove-Item Env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:KNOWLEDGE_IMAGE_REVISION -ErrorAction SilentlyContinue
  if ($fixtureCopyRoot) { Remove-Item -LiteralPath $fixtureCopyRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
