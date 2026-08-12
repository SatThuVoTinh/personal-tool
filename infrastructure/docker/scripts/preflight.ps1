[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [switch]$Runtime,
  [string]$OllamaExecutable
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = (Resolve-Path (Join-Path $dockerDirectory "..\..")).Path
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$projectName = "personal-tool-t1"

$requiredVariables = @(
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
  "AISTOR_LICENSE_FILE",
  "OLLAMA_SMOKE_MODEL"
)

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

    # Support quoted .env values.
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
    $normalized -eq "minioadmin" -or
    $normalized -match "(?:change|replace|example|placeholder|your)[-_ ]?(?:me|with|value|secret|password|user|path)?"
  )
}

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

function Get-OllamaExecutable {
  if ($OllamaExecutable) {
    return $OllamaExecutable
  }

  $command = Get-Command ollama -ErrorAction SilentlyContinue

  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )

  return $candidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1
}

function Assert-TrackedSecretPolicy {
  $trackedFiles = & git `
    -c "safe.directory=$repositoryRoot" `
    ls-files

  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect tracked repository files."
  }

  if (
    $trackedFiles |
      Where-Object {
        $_ -match "(?i)(^|/)(?:\.env|.*\.license)$"
      }
  ) {
    throw "Tracked runtime secret or license artifact detected."
  }
}

function Assert-Ollama {
  param([hashtable]$Values)

  $executable = Get-OllamaExecutable

  if (-not $executable) {
    throw "Ollama executable was not found."
  }

  $models = Invoke-RestMethod `
    -Uri "http://127.0.0.1:11434/api/tags" `
    -Method Get

  $model = @(
    $models.models |
      Where-Object {
        $_.name -eq $Values.OLLAMA_SMOKE_MODEL
      }
  ) | Select-Object -First 1

  if (-not $model) {
    throw "Configured Ollama smoke model is not installed."
  }

  if ([int64]$model.size -gt 4GB) {
    throw "Configured Ollama smoke model artifact exceeds 4 GiB."
  }

  & $executable show $Values.OLLAMA_SMOKE_MODEL | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "Configured Ollama smoke model cannot be loaded."
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

$licenseFile = (
  Resolve-Path `
    -LiteralPath $values.AISTOR_LICENSE_FILE `
    -ErrorAction Stop
).Path

if ((Get-Item -LiteralPath $licenseFile).Length -eq 0) {
  throw "AIStor license file is empty."
}

$repositoryPrefix = "$repositoryRoot$([IO.Path]::DirectorySeparatorChar)"

if (
  $licenseFile.StartsWith(
    $repositoryPrefix,
    [StringComparison]::OrdinalIgnoreCase
  )
) {
  throw "AIStor license file must be stored outside the repository."
}

Assert-TrackedSecretPolicy

& docker version --format "{{.Server.Version}}" | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Docker Engine is unavailable."
}

& docker compose version | Out-Null

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose is unavailable."
}

Assert-Ollama $values

Invoke-Compose @(
  "config",
  "--quiet"
)

if (-not $Runtime) {
  Write-Output "M2/T1 static preflight passed. Run with -Runtime to validate AIStor through the ephemeral mc helper."
  exit 0
}

$started = $false

try {
  $started = $true
  Invoke-Compose @(
    "pull",
    "object-storage",
    "aistor-mc"
  )

  Invoke-Compose @(
    "up",
    "--detach",
    "object-storage"
  )

  $deadline = (Get-Date).AddMinutes(2)
  $ready = $false

  do {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      & docker compose `
        --project-name $projectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
        run --rm --no-deps -T aistor-mc `
        admin info aistor `
        2>&1 | Out-Null

      $adminInfoExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($adminInfoExitCode -eq 0) {
      $ready = $true
      break
    }

    Start-Sleep -Seconds 2
  }
  while ((Get-Date) -lt $deadline)

  if (-not $ready) {
    throw "AIStor did not become ready within two minutes."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & docker compose `
      --project-name $projectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      run --rm --no-deps -T aistor-mc `
      license info aistor `
      2>&1 | Out-Null

    $licenseExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($licenseExitCode -ne 0) {
    throw "AIStor license validation failed."
  }

  $bucket = "t1-smoke"
  $object = "marker.txt"
  $marker = [guid]::NewGuid().ToString("N")

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & docker compose `
      --project-name $projectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      run --rm --no-deps -T aistor-mc `
      mb --ignore-existing "aistor/$bucket" `
      2>&1 | Out-Null

    $bucketExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($bucketExitCode -ne 0) {
    throw "Unable to create AIStor smoke bucket."
  }

  $pipeExitCode = 1

  for ($pipeAttempt = 1; $pipeAttempt -le 3; $pipeAttempt++) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      $marker |
        & docker compose `
          --project-name $projectName `
          --env-file $EnvironmentFile `
          -f $composeFile `
          run --rm --no-deps -T aistor-mc `
          pipe "aistor/$bucket/$object" `
          2>&1 |
        Out-Null

      $pipeExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($pipeExitCode -eq 0) {
      break
    }

    Start-Sleep -Seconds 2
  }

  if ($pipeExitCode -ne 0) {
    throw "Unable to write AIStor smoke object."
  }

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $readMarker = (
      & docker compose `
        --project-name $projectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
        run --rm --no-deps -T aistor-mc `
        cat "aistor/$bucket/$object" `
        2>$null
    ) -join "`n"

    $catExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if (
    $catExitCode -ne 0 -or
    $readMarker.Trim() -ne $marker
  ) {
    throw "AIStor smoke object did not round-trip correctly."
  }

  Write-Output "M2/T1 runtime preflight passed."
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
        down --remove-orphans `
        2>&1 |
      Out-Null

      $cleanupExitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($cleanupExitCode -ne 0) {
      Write-Warning "Runtime preflight cleanup failed with exit code $cleanupExitCode."
    }
  }
}
