[CmdletBinding()]
param(
  [ValidateSet("core", "platform", "observability", "all", "knowledge")]
  [string]$Profile = "all",
  [string]$EnvironmentFile = "",
  [string]$ProjectName = "personal-tool"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }

$dockerDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$knowledgeComposeFile = Join-Path $dockerDirectory "compose\compose.knowledge.yml"

function Get-EnvironmentFileValue {
  param([string]$Name, [string]$Path)

  foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
    if ($line -match "^$([regex]::Escape($Name))=(.*)$") {
      return $Matches[1].Trim().Trim('"')
    }
  }
  return ""
}

function Invoke-PlatformCompose {
  param([string[]]$Arguments)

  $composeArguments = @(
    "--project-name", $ProjectName,
    "--env-file", $EnvironmentFile,
    "-f", $composeFile
  )
  if ($Profile -eq "knowledge") {
    $composeArguments += @("-f", $knowledgeComposeFile)
  }
  & docker compose @composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

if ($Profile -eq "knowledge") {
  $configuredVaultRoot = Get-EnvironmentFileValue "KNOWLEDGE_VAULT_ROOT" $EnvironmentFile
  if (-not $configuredVaultRoot) {
    throw "KNOWLEDGE_VAULT_ROOT is required for the knowledge profile."
  }
  $resolvedVaultRoot = (Resolve-Path -LiteralPath $configuredVaultRoot -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolvedVaultRoot -PathType Container)) {
    throw "KNOWLEDGE_VAULT_ROOT must resolve to a directory."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $resolvedVaultRoot "01. Knowledge") -PathType Container)) {
    throw "KNOWLEDGE_VAULT_ROOT must contain 01. Knowledge."
  }
  $env:KNOWLEDGE_VAULT_ROOT = $resolvedVaultRoot
}

$servicesByProfile = @{
  core = @("object-storage", "postgres", "redis")
  platform = @("object-storage", "postgres", "redis", "nginx", "n8n")
  observability = @(
    "object-storage", "postgres", "redis", "nginx", "n8n",
    "postgres-exporter", "redis-exporter", "prometheus", "grafana", "dozzle"
  )
  all = @(
    "object-storage", "postgres", "redis", "nginx", "n8n",
    "postgres-exporter", "redis-exporter", "prometheus", "grafana", "dozzle"
  )
  knowledge = @("object-storage", "postgres", "redis", "nginx", "knowledge")
}

$services = $servicesByProfile[$Profile]
$coreServices = $servicesByProfile.core
$nonCoreServices = @($services | Where-Object { $_ -notin $coreServices })

Invoke-PlatformCompose -Arguments (@("up", "--detach", "--wait", "--wait-timeout", "180") + $coreServices)

if ($Profile -in @("platform", "observability", "all")) {
  Invoke-PlatformCompose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")
}

if ($Profile -ne "core") {
  Invoke-PlatformCompose -Arguments (@("up", "--detach", "--wait", "--wait-timeout", "180") + $nonCoreServices)
}

Write-Output "Started logical profile '$Profile' for project '$ProjectName'."
