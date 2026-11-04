[CmdletBinding()]
param(
  [ValidateSet("knowledge", "automation", "all")]
  [string]$Profile = "all",
  [string]$EnvironmentFile = "",
  [string]$ProjectName = "personal-tool"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot "credential-sentinels.ps1")

if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $PSScriptRoot "..\env\.env" }

$dockerDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$knowledgeComposeFile = Join-Path $dockerDirectory "compose\compose.knowledge.yml"
$knowledgeHardeningComposeFile = Join-Path $dockerDirectory "compose\compose.knowledge.hardening.yml"
$usesKnowledge = $Profile -in @("knowledge", "all")

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
  param(
    [string[]]$Arguments,
    [string[]]$Profiles = @($Profile)
  )

  $composeArguments = @(
    "--project-name", $ProjectName,
    "--env-file", $EnvironmentFile,
    "-f", $composeFile
  )
  if ($usesKnowledge) {
    $composeArguments += @("-f", $knowledgeComposeFile)
    $composeArguments += @("-f", $knowledgeHardeningComposeFile)
  }
  foreach ($composeProfile in $Profiles) {
    $composeArguments += @("--profile", $composeProfile)
  }

  & docker compose @composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

# F-522 (R10-L09-6): this is the mutating path README.md and both runbooks
# publish as the start command, so it refuses a missing or placeholder
# credential itself rather than relying on the operator having volunteered to
# run preflight.ps1 first. compose.core.yml interpolates
# POSTGRES_PASSWORD with an `unconfigured` default, so nothing downstream does.
Assert-CredentialValues -Values (Read-EnvironmentFile $EnvironmentFile) -Names (Get-CredentialVariableNames $Profile)

if ($usesKnowledge) {
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

Invoke-PlatformCompose -Arguments @("up", "--detach", "--wait", "--wait-timeout", "180", "postgres")

Invoke-PlatformCompose -Profiles @("bootstrap") -Arguments @(
  "run", "--rm", "--no-deps", "-T", "postgres-bootstrap"
)

Invoke-PlatformCompose -Arguments @("up", "--detach", "--wait", "--wait-timeout", "180")

Write-Output "Started Docker profile '$Profile' for project '$ProjectName'."
