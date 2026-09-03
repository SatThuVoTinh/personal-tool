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

& docker compose @composeArguments config --quiet
if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid." }

$candidateSha = ""
$previousRevision = $env:KNOWLEDGE_IMAGE_REVISION

try {
  if ($usesKnowledge) {
    $workingTree = @(git status --porcelain)
    if ($LASTEXITCODE -ne 0 -or $workingTree.Count -ne 0) {
      throw "Knowledge image provenance requires a clean working tree."
    }
    $candidateSha = (git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $candidateSha -notmatch '^[0-9a-f]{40}$') {
      throw "Unable to resolve the candidate repository SHA."
    }
    $env:KNOWLEDGE_IMAGE_REVISION = $candidateSha
  }

  $pullServices = switch ($Profile) {
    "knowledge" { @("postgres", "nginx", "dozzle") }
    "automation" { @("postgres", "n8n", "dozzle") }
    "all" { @("postgres", "nginx", "n8n", "dozzle") }
  }
  & docker compose @composeArguments pull --ignore-buildable @pullServices
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose pull failed with exit code $LASTEXITCODE." }

  if ($usesKnowledge) {
    & docker compose @composeArguments build --pull knowledge
    if ($LASTEXITCODE -ne 0) { throw "Knowledge image build failed with exit code $LASTEXITCODE." }

    $image = @(& docker image inspect "personal-tool/knowledge:m3" | ConvertFrom-Json)[0]
    $imageRevision = $image.Config.Labels."org.opencontainers.image.revision"
    if ($LASTEXITCODE -ne 0 -or -not $imageRevision -or $imageRevision -ne $candidateSha) {
      throw "Knowledge image provenance does not match the candidate repository SHA."
    }
    Write-Output "Built Knowledge image provenanced to $candidateSha."
  }
  else {
    Write-Output "Validated Compose and pulled immutable runtime images for profile '$Profile'."
  }
}
finally {
  if ($null -eq $previousRevision) {
    Remove-Item Env:KNOWLEDGE_IMAGE_REVISION -ErrorAction SilentlyContinue
  }
  else {
    $env:KNOWLEDGE_IMAGE_REVISION = $previousRevision
  }
}
