[CmdletBinding()]
param(
  [ValidateSet("all", "knowledge")]
  [string]$Profile = "all",
  [string]$EnvironmentFile = "",
  [string]$ProjectName = "personal-tool"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }

$dockerDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

if ($Profile -eq "knowledge") {
  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    stop knowledge nginx redis postgres object-storage
}
else {
  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    down --remove-orphans
}

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose shutdown failed with exit code $LASTEXITCODE."
}

Write-Output "Stopped logical profile '$Profile' for project '$ProjectName' without removing named volumes."
