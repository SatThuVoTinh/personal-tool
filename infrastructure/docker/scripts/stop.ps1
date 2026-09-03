[CmdletBinding()]
param(
  [ValidateSet("knowledge", "automation", "all")]
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
$usesKnowledge = $Profile -in @("knowledge", "all")

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

$composeArguments = @(
  "--project-name", $ProjectName,
  "--env-file", $EnvironmentFile,
  "-f", $composeFile
)
if ($usesKnowledge) {
  $composeArguments += @("-f", $knowledgeComposeFile)
}
$composeArguments += @("--profile", $Profile)

$services = switch ($Profile) {
  "knowledge" { @("knowledge", "nginx", "dozzle", "postgres") }
  "automation" { @("n8n", "dozzle", "postgres") }
  "all" { @("knowledge", "nginx", "n8n", "dozzle", "postgres") }
}

& docker compose @composeArguments stop @services
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose shutdown failed with exit code $LASTEXITCODE."
}

Write-Output "Stopped Docker profile '$Profile' for project '$ProjectName' without removing named volumes."
