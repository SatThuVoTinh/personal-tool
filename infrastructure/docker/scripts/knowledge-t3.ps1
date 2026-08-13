[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectName = "personal-tool-m3-t3"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $dockerDirectory "compose\compose.m3-t3.acceptance.yml"
$fixtureRoot = Join-Path $repositoryRoot "apps\knowledge\tests\fixtures\vault"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t3-$([guid]::NewGuid().ToString('N'))"
$vaultRoot = Join-Path $temporaryRoot "vault"

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose --project-name $projectName --env-file $EnvironmentFile -f $composeFile -f $acceptanceComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed with exit code $LASTEXITCODE." }
}

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Body = "")
  $bodyPath = Join-Path $temporaryRoot "response-$([guid]::NewGuid().ToString('N')).json"
  $requestBodyPath = Join-Path $temporaryRoot "request-$([guid]::NewGuid().ToString('N')).json"
  try {
    $arguments = @("--silent", "--show-error", "--max-time", "30", "--output", $bodyPath, "--write-out", "%{http_code}", "--request", $Method)
    if ($Body) {
      [IO.File]::WriteAllText($requestBodyPath, $Body, [Text.UTF8Encoding]::new($false))
      $arguments += @("--header", "Content-Type: application/json", "--data-binary", "@$requestBodyPath")
    }
    $arguments += "http://127.0.0.1:8080/knowledge$Path"
    $statusCode = & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed for $Path." }
    return [pscustomobject]@{ StatusCode = [int]$statusCode; Body = Get-Content -LiteralPath $bodyPath -Raw -Encoding utf8 }
  }
  finally {
    if (Test-Path -LiteralPath $bodyPath) { Remove-Item -LiteralPath $bodyPath -Force }
    if (Test-Path -LiteralPath $requestBodyPath) { Remove-Item -LiteralPath $requestBodyPath -Force }
  }
}

function Wait-Run {
  param([string]$RunId)
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    $response = Invoke-Api "GET" "/v1/index-runs/$RunId"
    if ($response.StatusCode -ne 200) { throw "Index run $RunId cannot be read." }
    $run = $response.Body | ConvertFrom-Json
    if ($run.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $run }
    Start-Sleep -Milliseconds 500
  }
  throw "Index run $RunId did not reach a terminal state."
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing: $EnvironmentFile" }
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
Copy-Item -LiteralPath $fixtureRoot -Destination $vaultRoot -Recurse
$env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT = $vaultRoot
$started = $false

try {
  Invoke-Compose @("build", "knowledge")
  $started = $true
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "240", "knowledge", "nginx")

  $mounts = & docker inspect --format "{{json .Mounts}}" "${projectName}-knowledge-1" | ConvertFrom-Json
  $vaultMount = @($mounts | Where-Object { $_.Destination -eq "/vault" })
  if ($vaultMount.Count -ne 1 -or $vaultMount[0].RW -ne $false) { throw "M3/T3 Vault mount is not read-only." }

  $accepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.StatusCode -ne 202) { throw "Full rebuild was not accepted: HTTP $($accepted.StatusCode) $($accepted.Body)" }
  $acceptedBody = $accepted.Body | ConvertFrom-Json
  $immediate = Invoke-Api "GET" "/v1/index-runs/$($acceptedBody.index_run_id)"
  if ($immediate.StatusCode -ne 200) { throw "Accepted run was not immediately visible." }
  $fullRun = Wait-Run $acceptedBody.index_run_id
  if ($fullRun.status -ne "SUCCEEDED" -or $fullRun.sources_indexed -ne 1) { throw "Full rebuild did not publish the fixture index." }

  $incrementalAccepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"INCREMENTAL"}'
  if ($incrementalAccepted.StatusCode -ne 202) { throw "Unchanged incremental run was not accepted." }
  $incrementalRun = Wait-Run (($incrementalAccepted.Body | ConvertFrom-Json).index_run_id)
  if ($incrementalRun.status -ne "SUCCEEDED" -or $incrementalRun.sources_indexed -ne 0) { throw "Unchanged source was re-indexed." }

  Remove-Item -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Force
  $emptyAccepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"INCREMENTAL"}'
  if ($emptyAccepted.StatusCode -ne 202) { throw "Empty incremental run was not accepted asynchronously." }
  $emptyRun = Wait-Run (($emptyAccepted.Body | ConvertFrom-Json).index_run_id)
  if ($emptyRun.status -ne "FAILED" -or $emptyRun.failure_code -ne "EMPTY_SNAPSHOT_DELETION_BLOCKED") { throw "Empty snapshot guard did not protect the active index." }

  $sourceCount = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT count(*) FROM knowledge.sources WHERE index_id = '$($fullRun.index_id)';")
  if (($sourceCount -join "").Trim() -ne "1") { throw "Empty snapshot guard deleted indexed sources." }

  $orphanIndexId = [guid]::NewGuid().ToString()
  $orphanRunId = [guid]::NewGuid().ToString()
  $model = (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get).models | Where-Object { $_.name -eq "bge-m3:latest" } | Select-Object -First 1
  $recoverySql = @"
INSERT INTO knowledge.indexes (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions)
VALUES ('$orphanIndexId', 'BUILDING', 'bge-m3:latest', '$($model.digest)', 1024);
INSERT INTO knowledge.index_runs (id, index_id, kind, status)
VALUES ('$orphanRunId', '$orphanIndexId', 'FULL_REBUILD', 'RUNNING');
"@
  Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--command", $recoverySql)
  Invoke-Compose @("stop", "knowledge")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "120", "knowledge")
  $recoveryState = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT (SELECT status FROM knowledge.index_runs WHERE id = '$orphanRunId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$orphanIndexId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$($fullRun.index_id)');")
  if (($recoveryState -join "").Trim() -ne "INTERRUPTED:FAILED:ACTIVE") { throw "Full rebuild restart recovery did not preserve the active index." }
  Write-Output "M3/T3 index lifecycle acceptance passed."
}
finally {
  if ($started) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { Invoke-Compose @("down", "--volumes", "--remove-orphans") } finally { $ErrorActionPreference = $previous }
  }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  Remove-Item Env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT -ErrorAction SilentlyContinue
}
