[CmdletBinding()]
param(
  [ValidateSet("core", "platform", "observability", "all")]
  [string]$Profile = "all",
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

$servicesByProfile = @{
  core = @("object-storage", "postgres", "redis")
  platform = @("object-storage", "postgres", "redis", "nginx", "n8n")
  observability = @(
    "object-storage",
    "postgres",
    "redis",
    "nginx",
    "n8n",
    "postgres-exporter",
    "redis-exporter",
    "prometheus",
    "grafana",
    "dozzle"
  )
  all = @(
    "object-storage",
    "postgres",
    "redis",
    "nginx",
    "n8n",
    "postgres-exporter",
    "redis-exporter",
    "prometheus",
    "grafana",
    "dozzle"
  )
}

$services = $servicesByProfile[$Profile]
$coreServices = $servicesByProfile.core
$nonCoreServices = @($services | Where-Object { $_ -notin $coreServices })

& docker compose `
  --project-name $ProjectName `
  --env-file $EnvironmentFile `
  -f $composeFile `
  up --detach --wait --wait-timeout 180 @coreServices

if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose startup failed with exit code $LASTEXITCODE."
}

if ($Profile -ne "core") {
  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    run --rm --no-deps -T postgres-bootstrap

  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL bootstrap failed with exit code $LASTEXITCODE."
  }

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    up --detach --wait --wait-timeout 180 @nonCoreServices

  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose startup failed with exit code $LASTEXITCODE."
  }
}

Write-Output "Started logical profile '$Profile' for project '$ProjectName'."
