[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "acceptance-common.ps1")

$runId = New-AcceptanceRunId
$containerName = "personal-tool-m3-t2-fixture"
$imageName = "personal-tool/knowledge:m3-t2"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$knowledgeDirectory = Join-Path $repositoryRoot "apps\knowledge"
$fixtureRoot = (Resolve-Path (Join-Path $knowledgeDirectory "tests\fixtures\vault")).Path
$fixtureAcceptance = (Resolve-Path (Join-Path $knowledgeDirectory "tests\fixture_acceptance.py")).Path
$fixturePrefix = $fixtureRoot.TrimEnd("\") + "\"

function Get-FixtureManifest {
  Get-ChildItem -LiteralPath $fixtureRoot -Recurse -File |
    Sort-Object FullName |
    ForEach-Object {
      if (-not $_.FullName.StartsWith($fixturePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "A fixture file resolved outside the fixture root."
      }
      $relativePath = $_.FullName.Substring($fixturePrefix.Length).Replace("\", "/")
      "${relativePath}:$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash)"
    }
}

$beforeManifest = @(Get-FixtureManifest)
$created = $false
$script:bodyFailed = $false
$finalizationError = $null
# F-291 (R7-C4-04): the run's evidence carries the finalisation record, so a
# cleanup failure is never dropped and never replaces the body's own failure.
$evidence = [ordered]@{
  schema_version = 1
  mode = "Acceptance"
  result = "FAIL"
  acceptance_run_id = $runId
  container = $containerName
  started_at = [DateTime]::UtcNow.ToString("o")
}

try {
  & docker build `
    --target test `
    --tag "personal-tool/knowledge:m3-t2-test" `
    $knowledgeDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "M3/T2 Python unit and golden tests failed."
  }

  & docker build --target runtime --tag $imageName $knowledgeDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "M3/T2 runtime image build failed."
  }

  & docker create `
    --name $containerName `
    --env "PYTHONPATH=/app" `
    --mount "type=bind,source=$fixtureRoot,target=/vault,readonly" `
    --mount "type=bind,source=$fixtureAcceptance,target=/tmp/fixture_acceptance.py,readonly" `
    $imageName `
    python /tmp/fixture_acceptance.py |
    Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to create the isolated M3/T2 fixture container."
  }
  $created = $true

  $mountsJson = & docker inspect --format "{{json .Mounts}}" $containerName
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect the isolated M3/T2 fixture mount."
  }
  $vaultMount = @($mountsJson | ConvertFrom-Json | Where-Object { $_.Destination -eq "/vault" })
  if ($vaultMount.Count -ne 1 -or $vaultMount[0].RW -ne $false) {
    throw "The fixture Vault mount is not read-only."
  }

  $output = & docker start --attach $containerName
  if ($LASTEXITCODE -ne 0) {
    throw "The isolated M3/T2 fixture scan failed."
  }
  $result = $output | Select-Object -Last 1 | ConvertFrom-Json
  if (
    -not $result.succeeded -or
    $result.discovered_count -ne 1 -or
    $result.valid_source_count -ne 1 -or
    $result.source_count -ne 1 -or
    $result.error_count -ne 0 -or
    $result.first_line_start -ne 8
  ) {
    throw "The isolated M3/T2 fixture result did not satisfy its contract."
  }

  $afterManifest = @(Get-FixtureManifest)
  if (Compare-Object -ReferenceObject $beforeManifest -DifferenceObject $afterManifest) {
    throw "The read-only fixture Vault changed during acceptance."
  }

  $evidence.result = "PASS"
}
catch {
  $script:bodyFailed = $true
  $evidence.error = $_.Exception.Message
  throw
}
finally {
  Invoke-AcceptanceFinalization -Label "M3/T2" -RunId $runId -Evidence $evidence -EvidenceName "acceptance-M3-T2-$runId.json" -Cleanup {
    if ($created) {
      & docker rm --force $containerName | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "M3/T2 fixture container cleanup failed."
      }
    }
  }
  $finalizationError = $evidence["finalization"].error
}

if ($null -ne $finalizationError -and -not $script:bodyFailed) {
  throw "M3/T2 acceptance finalization failed: $finalizationError"
}

Write-Output "M3/T2 isolated read-only fixture acceptance passed."
