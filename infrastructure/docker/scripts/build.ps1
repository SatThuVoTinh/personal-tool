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
  config --quiet

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose configuration is invalid."
}

& docker compose `
  --project-name $ProjectName `
  --env-file $EnvironmentFile `
  -f $composeFile `
  pull

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose pull failed with exit code $LASTEXITCODE."
}

Write-Output "Validated Compose and pulled all immutable runtime images for project '$ProjectName'."
