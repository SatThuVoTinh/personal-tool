[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{40}$')][string]$ImplementationCandidateSha,
  [string]$Remote = "origin",
  [string]$MainBranch = "main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "knowledge-t5-common.ps1")

Assert-T5CleanRepository
$acceptedPath = Join-Path $script:T5EvidenceDirectory "accepted-candidate-$ImplementationCandidateSha.json"
if (-not (Test-Path -LiteralPath $acceptedPath -PathType Leaf)) {
  throw "Exact accepted-candidate evidence is missing; live acceptance has not passed."
}
$accepted = Get-Content -LiteralPath $acceptedPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($accepted.result -ne "PASS" -or $accepted.implementation_candidate_sha -notmatch '^[0-9a-f]{40}$' -or
  $accepted.candidate_manifest_sha256 -notmatch '^[0-9a-f]{64}$' -or
  $accepted.candidate_path_set_sha256 -notmatch '^[0-9a-f]{64}$' -or
  [int]$accepted.candidate_path_count -le 0) {
  throw "Accepted-candidate evidence is invalid."
}
if ($accepted.implementation_candidate_sha -cne $ImplementationCandidateSha) { throw "Accepted candidate SHA does not match the requested remote proof." }

& git fetch $Remote $MainBranch
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch $Remote/$MainBranch." }
$remoteRef = "$Remote/$MainBranch"
& git merge-base --is-ancestor $accepted.implementation_candidate_sha $remoteRef
if ($LASTEXITCODE -ne 0) { throw "Accepted candidate SHA is not an ancestor of $remoteRef." }
$remoteSha = (& git rev-parse $remoteRef).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteSha -notmatch '^[0-9a-f]{40}$') { throw "Unable to resolve $remoteRef." }
$remoteManifest = Get-T5CandidatePathManifest $remoteSha
if ($remoteManifest.candidate_manifest_sha256 -cne $accepted.candidate_manifest_sha256 -or
  $remoteManifest.candidate_path_set_sha256 -cne $accepted.candidate_path_set_sha256 -or
  $remoteManifest.candidate_path_count -ne $accepted.candidate_path_count) {
  throw "Remote candidate path completeness or Git-blob manifest changed after local acceptance."
}

function Get-SuccessfulWorkflowRun {
  param([string]$WorkflowName)
  $runs = @(& gh run list --workflow $WorkflowName --branch $MainBranch --commit $remoteSha --limit 1 --json databaseId,headSha,status,url | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $runs.Count -ne 1 -or $runs[0].headSha -ne $remoteSha -or $runs[0].status -ne "completed") {
    throw "$WorkflowName has no completed run for remote main SHA $remoteSha."
  }
  $run = & gh run view $runs[0].databaseId --json conclusion,headSha,status,url | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0 -or $run.headSha -ne $remoteSha -or $run.status -ne "completed" -or $run.conclusion -ne "success") {
    throw "$WorkflowName did not pass for remote main SHA $remoteSha."
  }
  return $run
}

$ci = Get-SuccessfulWorkflowRun "CI"
$security = Get-SuccessfulWorkflowRun "Security"
$remoteEvidence = [ordered]@{
  schema_version = 1
  result = "PASS"
  implementation_candidate_sha = $accepted.implementation_candidate_sha
  candidate_manifest_sha256 = $accepted.candidate_manifest_sha256
  candidate_path_set_sha256 = $accepted.candidate_path_set_sha256
  candidate_path_count = $accepted.candidate_path_count
  remote_main_sha = $remoteSha
  accepted_sha_is_ancestor = $true
  candidate_manifest_unchanged = $true
  ci = [ordered]@{ passed = $true; url = $ci.url }
  security = [ordered]@{ passed = $true; url = $security.url }
  verified_at = [DateTime]::UtcNow.ToString("o")
}
Write-T5AtomicJson (Join-Path $script:T5EvidenceDirectory "remote-gate.json") $remoteEvidence
Write-Output "M4/T5-C1 remote gate passed for $remoteSha."
