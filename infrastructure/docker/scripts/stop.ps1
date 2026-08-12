[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$dockerDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

& docker compose `
  --project-name $ProjectName `
  --env-file $EnvironmentFile `
  -f $composeFile `
  down --remove-orphans

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose shutdown failed with exit code $LASTEXITCODE."
}

Write-Output "Stopped project '$ProjectName' without removing named volumes."
