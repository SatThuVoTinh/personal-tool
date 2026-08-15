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

$candidateSha = ""
$previousRevision = $env:KNOWLEDGE_IMAGE_REVISION
if ($Profile -eq "knowledge") {
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

try {
  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    config --quiet
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid." }

  $pullServices = if ($Profile -eq "knowledge") {
    @("object-storage", "postgres", "redis", "nginx", "knowledge")
  }
  else {
    @()
  }
  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    pull --ignore-buildable @pullServices
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose pull failed with exit code $LASTEXITCODE." }

  if ($Profile -eq "knowledge") {
    & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      build --pull knowledge
    if ($LASTEXITCODE -ne 0) { throw "Knowledge image build failed with exit code $LASTEXITCODE." }

    $image = @(& docker image inspect "personal-tool/knowledge:m3" | ConvertFrom-Json)[0]
    $imageRevision = $image.Config.Labels."org.opencontainers.image.revision"
    if ($LASTEXITCODE -ne 0 -or -not $imageRevision -or $imageRevision -ne $candidateSha) {
      throw "Knowledge image provenance does not match the candidate repository SHA."
    }
    Write-Output "Built Knowledge image provenanced to $candidateSha."
  }
  else {
    Write-Output "Validated Compose and pulled all immutable runtime images for project '$ProjectName'."
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
