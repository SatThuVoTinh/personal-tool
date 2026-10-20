[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "acceptance-common.ps1")

# F-290 (R7-C4-03): everything a run owns is derived from a per-run
# identifier: the compose project (and with it the network, the volumes and
# the container names), the fixture row identities, and the host port the
# acceptance stack binds. A rerun therefore cannot meet the state an earlier
# run left behind, and two overlapping runs cannot share a volume.
$runId = New-AcceptanceRunId
$projectName = "personal-tool-m3-t1-$runId"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $dockerDirectory "compose\compose.m3-t1.acceptance.yml"
$indexId = New-AcceptanceFixtureUuid "$runId-active-index"
$interruptedIndexId = New-AcceptanceFixtureUuid "$runId-interrupted-index"
$interruptedRunId = New-AcceptanceFixtureUuid "$runId-interrupted-run"
$duplicateIndexId = New-AcceptanceFixtureUuid "$runId-duplicate-index"
$script:nginxPort = 0

function Invoke-Compose {
  param([string[]]$Arguments)

  & docker compose `
    --project-name $projectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    -f $acceptanceComposeFile `
    @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

function Get-HttpResponse {
  param([string]$Uri)

  $bodyPath = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-http-$([guid]::NewGuid().ToString('N')).body"

  try {
    $statusCode = & curl.exe `
      --silent `
      --show-error `
      --max-time 15 `
      --output $bodyPath `
      --write-out "%{http_code}" `
      $Uri

    if ($LASTEXITCODE -ne 0 -or $statusCode -notmatch '^\d{3}$') {
      throw "Unable to obtain HTTP status from $Uri."
    }

    return [pscustomobject]@{
      StatusCode = [int]$statusCode
      Body = Get-Content -LiteralPath $bodyPath -Raw -Encoding utf8
    }
  }
  finally {
    if (Test-Path -LiteralPath $bodyPath) {
      Remove-Item -LiteralPath $bodyPath -Force
    }
  }
}

function Assert-SqlFailure {
  param(
    [string]$Command,
    [string]$ExpectedSignature,
    [string]$ModelDigest
  )

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $output = & docker compose `
      --project-name $projectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      -f $acceptanceComposeFile `
      exec -T postgres psql --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --set=model_digest=$ModelDigest --command $Command `
      2>&1 |
      Out-String
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -eq 0) {
    throw "Expected SQL command to fail but it succeeded."
  }
  # F-289 (R7-C4-02): psql exits 3 when ON_ERROR_STOP turned a SQL error into
  # a failed script. Every other nonzero exit code is a client, connection or
  # command failure, and the error TEXT has to name the constraint the
  # statement was supposed to violate: "the command failed" is not "the
  # database rejected this statement", and only the second one exercises the
  # one-ACTIVE-index invariant.
  if ($exitCode -ne 3) {
    throw "Expected a database constraint violation (psql exit 3) but the client exited ${exitCode}: $output"
  }
  if (-not $output -or $output -notmatch [regex]::Escape($ExpectedSignature)) {
    throw "The statement failed for an unrelated reason; '$ExpectedSignature' was not reported: $output"
  }
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

$started = $false
$script:bodyFailed = $false
$finalizationError = $null
# F-291 (R7-C4-04): the run's evidence carries the finalisation record, so a
# cleanup failure is never dropped and never replaces the body's own failure.
$evidence = [ordered]@{
  schema_version = 1
  mode = "Acceptance"
  result = "FAIL"
  acceptance_run_id = $runId
  compose_project = $projectName
  started_at = [DateTime]::UtcNow.ToString("o")
}

try {
  Invoke-Compose @("build", "knowledge")
  $started = $true
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "240",
    "knowledge",
    "nginx"
  )

  $nginxAddress = (Invoke-Compose @("port", "nginx", "8080") | Select-Object -Last 1).Trim()
  if ($nginxAddress -notmatch '^127\.0\.0\.1:(?<port>\d+)$') {
    throw "Acceptance Nginx did not receive a loopback port."
  }
  $script:nginxPort = [int]$Matches.port

  $health = Get-HttpResponse "http://127.0.0.1:$script:nginxPort/knowledge/healthz"
  if ($health.StatusCode -ne 200) {
    throw "Knowledge liveness endpoint did not return HTTP 200 through Nginx."
  }

  $withoutIndex = Get-HttpResponse "http://127.0.0.1:$script:nginxPort/knowledge/readyz"
  if ($withoutIndex.StatusCode -ne 503 -or $withoutIndex.Body -notmatch 'NO_ACTIVE_INDEX') {
    throw "Knowledge readiness did not reject the missing active index."
  }

  $model = @(
    (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get).models |
      Where-Object { $_.name -eq "bge-m3:latest" }
  ) | Select-Object -First 1
  if (-not $model -or -not $model.digest) {
    throw "The required bge-m3:latest Ollama model is unavailable."
  }
  # F-293 (R7-C4-06): the provider's response is untrusted data. Its digest is
  # validated against the shape the column's CHECK constraint accepts, and it
  # reaches the database as a psql VARIABLE, so a quote in the response cannot
  # terminate the literal and start a second statement.
  if ($model.digest -notmatch '^[0-9a-f]{64}$') {
    throw "The bge-m3:latest model digest does not have the documented shape."
  }

  $embedding = Invoke-RestMethod `
    -Uri "http://127.0.0.1:11434/api/embed" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"model":"bge-m3:latest","input":"knowledge-t1-acceptance"}'
  if (-not $embedding.embeddings -or $embedding.embeddings[0].Length -ne 1024) {
    throw "The required bge-m3:latest model did not return 1024 dimensions."
  }

  $insertActiveIndex = @"
INSERT INTO knowledge.indexes (
  id,
  status,
  embedding_model_name,
  embedding_model_digest,
  embedding_dimensions,
  activated_at
) VALUES (
  '$indexId',
  'ACTIVE',
  'bge-m3:latest',
  :'model_digest',
  1024,
  now()
);
"@
  Invoke-Compose @(
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=postgres",
    "--dbname=postgres",
    "--set=ON_ERROR_STOP=1",
    "--set=model_digest=$($model.digest)",
    "--command",
    $insertActiveIndex
  )

  $duplicateActiveIndex = @"
INSERT INTO knowledge.indexes (
  id,
  status,
  embedding_model_name,
  embedding_model_digest,
  embedding_dimensions,
  activated_at
) VALUES (
  '$duplicateIndexId',
  'ACTIVE',
  'bge-m3:latest',
  :'model_digest',
  1024,
  now()
);
"@
  Assert-SqlFailure -Command $duplicateActiveIndex -ExpectedSignature "knowledge_indexes_one_active_idx" -ModelDigest $model.digest

  $ready = Get-HttpResponse "http://127.0.0.1:$script:nginxPort/knowledge/readyz"
  if ($ready.StatusCode -ne 200 -or $ready.Body -notmatch '"status":"ready"') {
    throw "Knowledge readiness did not accept the matching resolved model digest."
  }

  Invoke-Compose @(
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=postgres",
    "--dbname=postgres",
    "--set=ON_ERROR_STOP=1",
    "--command",
    "UPDATE knowledge.indexes SET embedding_model_digest = repeat('0', 64) WHERE id = '$indexId';"
  )

  $drift = Get-HttpResponse "http://127.0.0.1:$script:nginxPort/knowledge/readyz"
  if ($drift.StatusCode -ne 503 -or $drift.Body -notmatch 'EMBEDDING_MODEL_DRIFT') {
    throw "Knowledge readiness did not reject embedding-model digest drift."
  }

  $insertInterruptedRun = @"
INSERT INTO knowledge.indexes (
  id,
  status,
  embedding_model_name,
  embedding_model_digest,
  embedding_dimensions
) VALUES (
  '$interruptedIndexId',
  'BUILDING',
  'bge-m3:latest',
  :'model_digest',
  1024
);
INSERT INTO knowledge.index_runs (id, index_id, kind, status)
VALUES ('$interruptedRunId', '$interruptedIndexId', 'FULL_REBUILD', 'RUNNING');
"@
  Invoke-Compose @(
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=postgres",
    "--dbname=postgres",
    "--set=ON_ERROR_STOP=1",
    "--set=model_digest=$($model.digest)",
    "--command",
    $insertInterruptedRun
  )
  Invoke-Compose @("stop", "knowledge")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "120", "knowledge")

  $interruptedStatus = & docker compose `
    --project-name $projectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    -f $acceptanceComposeFile `
    exec -T postgres psql --username=postgres --dbname=postgres --tuples-only --no-align `
    --command "SELECT status || ':' || failure_code FROM knowledge.index_runs WHERE id = '$interruptedRunId';"
  if ($LASTEXITCODE -ne 0 -or (($interruptedStatus -join "").Trim() -ne "INTERRUPTED:PROCESS_RESTART")) {
    throw "Knowledge startup did not mark an orphan run as INTERRUPTED."
  }

  $evidence.result = "PASS"
}
catch {
  $script:bodyFailed = $true
  $evidence.error = $_.Exception.Message
  throw
}
finally {
  Invoke-AcceptanceFinalization -Label "M3/T1" -RunId $runId -Evidence $evidence -EvidenceName "acceptance-M3-T1-$runId.json" -Cleanup {
    if ($started) {
      $previousErrorActionPreference = $ErrorActionPreference
      $ErrorActionPreference = "Continue"

      try {
        & docker compose `
          --project-name $projectName `
          --env-file $EnvironmentFile `
          -f $composeFile `
          -f $acceptanceComposeFile `
          down --volumes --remove-orphans `
          2>&1 |
          Out-Null
        $cleanupExitCode = $LASTEXITCODE
      }
      finally {
        $ErrorActionPreference = $previousErrorActionPreference
      }

      if ($cleanupExitCode -ne 0) {
        throw "M3/T1 acceptance project cleanup failed with exit code $cleanupExitCode."
      }
    }
  }
  $finalizationError = $evidence["finalization"].error
}

if ($null -ne $finalizationError -and -not $script:bodyFailed) {
  throw "M3/T1 acceptance finalization failed: $finalizationError"
}

Write-Output "M3/T1 Knowledge service validation passed."
