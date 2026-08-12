[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool-t2",
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$preflightScript = Join-Path $scriptDirectory "preflight.ps1"
$requiredVariables = @("POSTGRES_PASSWORD", "N8N_POSTGRES_PASSWORD")

function Read-EnvironmentFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Runtime environment file is missing: $Path"
  }

  $values = @{}

  foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
    $trimmed = $line.Trim()

    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")

    if ($separator -lt 1) {
      throw "Runtime environment file contains an invalid assignment."
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()

    if (
      $value.Length -ge 2 -and
      (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      )
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$name] = $value
  }

  return $values
}

function Test-SentinelValue {
  param([string]$Value)

  $normalized = $Value.Trim().ToLowerInvariant()

  return (
    $normalized.Length -eq 0 -or
    $normalized -match "(?:change|replace|example|placeholder|your)[-_ ]?(?:me|with|value|secret|password|user|path)?" -or
    $normalized -eq "m2-t2-unconfigured"
  )
}

function Invoke-Compose {
  param([string[]]$Arguments)

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

function Get-ComposeOutput {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $output = & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      @Arguments `
      2>$null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Docker Compose command failed with exit code $exitCode."
  }

  return ($output -join "`n").Trim()
}

function Write-ObjectMarker {
  param(
    [string]$Bucket,
    [string]$Object,
    [string]$Marker
  )

  Invoke-Compose @(
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "aistor-mc",
    "mb",
    "--ignore-existing",
    "aistor/$Bucket"
  )

  # The regression project can retain its named volume after a failed run.
  # Remove a previous synthetic marker so this validation is repeatable.
  $removeOutput = @()
  $removeExitCode = -1
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $removeOutput = & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      run --rm --no-deps -T aistor-mc `
      rm --force "aistor/$Bucket/$Object" `
      2>&1
    $removeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($removeExitCode -ne 0 -and (($removeOutput -join "`n") -notmatch "Object does not exist")) {
    throw "Unable to remove a previous AIStor recreation marker."
  }

  $exitCode = 1

  for ($pipeAttempt = 1; $pipeAttempt -le 3; $pipeAttempt++) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      $Marker |
        & docker compose `
          --project-name $ProjectName `
          --env-file $EnvironmentFile `
          -f $composeFile `
          run --rm --no-deps -T aistor-mc `
          pipe "aistor/$Bucket/$Object" `
          2>&1 |
        Out-Null
      $exitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($exitCode -eq 0) {
      break
    }

    Start-Sleep -Seconds 2
  }

  if ($exitCode -ne 0) {
    throw "Unable to write AIStor recreation marker."
  }
}

$values = Read-EnvironmentFile $EnvironmentFile

foreach ($name in $requiredVariables) {
  if (
    -not $values.ContainsKey($name) -or
    (Test-SentinelValue $values[$name])
  ) {
    throw "Runtime variable $name is missing, empty, or uses a rejected example value."
  }
}

$started = $false

try {
  & $preflightScript -EnvironmentFile $EnvironmentFile -Runtime

  Invoke-Compose @(
    "pull",
    "object-storage",
    "aistor-mc",
    "postgres",
    "postgres-bootstrap",
    "redis"
  )
  $started = $true
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
    "object-storage",
    "postgres",
    "redis"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")

  if (
    (Get-ComposeOutput @(
      "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
      "--tuples-only", "--no-align", "--command", "SELECT extname FROM pg_extension WHERE extname = 'vector';"
    )) -ne "vector"
  ) {
    throw "pgvector is not enabled in the postgres database."
  }
  foreach ($database in @("n8n", "template1")) {
    if (
      (Get-ComposeOutput @(
        "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=$database",
        "--tuples-only", "--no-align", "--command", "SELECT count(*) FROM pg_extension WHERE extname = 'vector';"
      )) -ne "0"
    ) {
      throw "pgvector must not be enabled in $database."
    }
  }

  $marker = [guid]::NewGuid().ToString("N")
  $bucket = "m2-t2-synthetic"
  $object = "recreation-marker.txt"

  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--set=ON_ERROR_STOP=1", "--command",
    "CREATE TABLE IF NOT EXISTS m2_t2_recreation_marker (marker text NOT NULL); TRUNCATE m2_t2_recreation_marker; INSERT INTO m2_t2_recreation_marker VALUES ('$marker');"
  )
  Write-ObjectMarker $bucket $object $marker
  Invoke-Compose @("exec", "-T", "redis", "redis-cli", "SET", "m2:t2:recreation-marker", $marker)

  Invoke-Compose @("down", "--remove-orphans")
  $started = $false
  $started = $true
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
    "object-storage",
    "postgres",
    "redis"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")

  if (
    (Get-ComposeOutput @(
      "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
      "--tuples-only", "--no-align", "--command", "SELECT marker FROM m2_t2_recreation_marker;"
    )) -ne $marker
  ) {
    throw "PostgreSQL marker did not survive container recreation."
  }
  if (
    (Get-ComposeOutput @(
      "run", "--rm", "--no-deps", "-T", "aistor-mc", "cat", "aistor/$bucket/$object"
    )) -ne $marker
  ) {
    throw "AIStor marker did not survive container recreation."
  }
  if (
    (Get-ComposeOutput @(
      "exec", "-T", "redis", "redis-cli", "GET", "m2:t2:recreation-marker"
    )) -ne ""
  ) {
    throw "Redis transient marker survived container recreation."
  }

  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--set=ON_ERROR_STOP=1", "--command", "DROP TABLE m2_t2_recreation_marker;"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "aistor-mc", "rm", "--force", "aistor/$bucket/$object")
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "aistor-mc", "rb", "aistor/$bucket")

  Write-Output "M2/T2 core storage recreation validation passed."
}
finally {
  if ($started -and -not $KeepRunning) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      & docker compose `
        --project-name $ProjectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
        down --remove-orphans `
        2>&1 |
      Out-Null
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
  }
}
