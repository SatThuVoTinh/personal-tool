[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectName = "personal-tool-m3-t1"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$indexId = "11111111-1111-1111-1111-111111111111"
$interruptedIndexId = "22222222-2222-2222-2222-222222222222"
$interruptedRunId = "33333333-3333-3333-3333-333333333333"

function Invoke-Compose {
  param([string[]]$Arguments)

  & docker compose `
    --project-name $projectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
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
  param([string]$Command)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & docker compose `
      --project-name $projectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      exec -T postgres psql --username=postgres --dbname=postgres --set=ON_ERROR_STOP=1 --command $Command `
      2>&1 |
      Out-Null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -eq 0) {
    throw "Expected SQL command to fail but it succeeded."
  }
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

$started = $false

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

  $health = Get-HttpResponse "http://127.0.0.1:8080/knowledge/healthz"
  if ($health.StatusCode -ne 200) {
    throw "Knowledge liveness endpoint did not return HTTP 200 through Nginx."
  }

  $withoutIndex = Get-HttpResponse "http://127.0.0.1:8080/knowledge/readyz"
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
  '$($model.digest)',
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
    "--command",
    $insertActiveIndex
  )

  Assert-SqlFailure @"
INSERT INTO knowledge.indexes (
  id,
  status,
  embedding_model_name,
  embedding_model_digest,
  embedding_dimensions,
  activated_at
) VALUES (
  '44444444-4444-4444-4444-444444444444',
  'ACTIVE',
  'bge-m3:latest',
  '$($model.digest)',
  1024,
  now()
);
"@

  $ready = Get-HttpResponse "http://127.0.0.1:8080/knowledge/readyz"
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

  $drift = Get-HttpResponse "http://127.0.0.1:8080/knowledge/readyz"
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
  '$($model.digest)',
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
    "--command",
    $insertInterruptedRun
  )
  Invoke-Compose @("stop", "knowledge")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "120", "knowledge")

  $interruptedStatus = & docker compose `
    --project-name $projectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    exec -T postgres psql --username=postgres --dbname=postgres --tuples-only --no-align `
    --command "SELECT status || ':' || failure_code FROM knowledge.index_runs WHERE id = '$interruptedRunId';"
  if ($LASTEXITCODE -ne 0 -or (($interruptedStatus -join "").Trim() -ne "INTERRUPTED:PROCESS_RESTART")) {
    throw "Knowledge startup did not mark an orphan run as INTERRUPTED."
  }

  Write-Output "M3/T1 Knowledge service validation passed."
}
finally {
  if ($started) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      & docker compose `
        --project-name $projectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
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
