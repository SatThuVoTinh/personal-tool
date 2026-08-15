[CmdletBinding()]
param(
  [string]$Remote = "origin",
  [string]$MainBranch = "main"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "knowledge-t5-common.ps1")

Assert-T5CleanRepository
$acceptedPath = Join-Path $script:T5EvidenceDirectory "accepted-candidate.json"
if (-not (Test-Path -LiteralPath $acceptedPath -PathType Leaf)) {
  throw "accepted-candidate.json is missing; live acceptance has not passed."
}
$accepted = Get-Content -LiteralPath $acceptedPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($accepted.result -ne "PASS" -or $accepted.accepted_candidate_sha -notmatch '^[0-9a-f]{40}$' -or
  $accepted.accepted_candidate_source_digest -notmatch '^[0-9a-f]{64}$') {
  throw "Accepted-candidate evidence is invalid."
}

& git fetch $Remote $MainBranch
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch $Remote/$MainBranch." }
$remoteRef = "$Remote/$MainBranch"
& git merge-base --is-ancestor $accepted.accepted_candidate_sha $remoteRef
if ($LASTEXITCODE -ne 0) { throw "Accepted candidate SHA is not an ancestor of $remoteRef." }
$currentDigest = Get-T5CandidateSourceDigest
if ($currentDigest -ne $accepted.accepted_candidate_source_digest) {
  throw "Candidate-affecting source digest changed after live acceptance."
}
$remoteSha = (& git rev-parse $remoteRef).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteSha -notmatch '^[0-9a-f]{40}$') { throw "Unable to resolve $remoteRef." }

function Get-SuccessfulWorkflowRun {
  param([string]$WorkflowName)
  $runs = @(& gh run list --workflow $WorkflowName --branch $MainBranch --commit $remoteSha --limit 1 --json workflowDatabaseId,headSha,status,url | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $runs.Count -ne 1 -or $runs[0].headSha -ne $remoteSha -or $runs[0].status -ne "completed") {
    throw "$WorkflowName has no completed run for remote main SHA $remoteSha."
  }
  $run = & gh run view $runs[0].workflowDatabaseId --json conclusion,headSha,status,url | ConvertFrom-Json
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
  accepted_candidate_sha = $accepted.accepted_candidate_sha
  accepted_candidate_source_digest = $accepted.accepted_candidate_source_digest
  remote_main_sha = $remoteSha
  accepted_sha_is_ancestor = $true
  candidate_source_digest_unchanged = $true
  ci = [ordered]@{ passed = $true; url = $ci.url }
  security = [ordered]@{ passed = $true; url = $security.url }
  verified_at = [DateTime]::UtcNow.ToString("o")
}
Write-T5AtomicJson (Join-Path $script:T5EvidenceDirectory "remote-gate.json") $remoteEvidence
Write-Output "M3/T5 remote gate passed for $remoteSha."
