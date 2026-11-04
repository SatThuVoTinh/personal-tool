Set-StrictMode -Version Latest

# The shared helper for the acceptance drivers.
#
# F-291 (R7-C4-04): the six acceptance drivers used to implement finalisation
# in six different ways, and two of those ways dropped a cleanup failure on
# the floor. A failure raised from inside the outer `finally` replaced the
# body's own failure, and a finalisation error was rethrown only when the body
# had not failed, so on the run where both went wrong the leak was never
# reported. The contract is implemented once, here, and every driver calls it:
#
#   * every cleanup step runs, and every failure it raises is captured;
#   * the captured conditions are written to the run's evidence;
#   * the conditions are named in the operator's output;
#   * the body's own failure is never replaced by a finalisation failure, and a
#     finalisation failure is raised only when the body itself succeeded.
#
# F-290 (R7-C4-03): a run identifies itself with a per-run identifier, and
# every fixture identity is derived from that identifier, so two runs can
# never share a compose project, a volume or a primary key.

function New-AcceptanceRunId {
  return [guid]::NewGuid().ToString("N")
}

function New-AcceptanceFixtureUuid {
  param([Parameter(Mandatory)][string]$Seed)

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash([Text.Encoding]::UTF8.GetBytes($Seed))
  }
  finally {
    $sha256.Dispose()
  }
  # The Guid(byte[]) constructor lays the bytes out the way a UUID stores
  # them: the version nibble sits in byte 7 and the variant in byte 8.
  $bytes = [byte[]]$hash[0..15]
  $bytes[7] = [byte](($bytes[7] -band 0x0f) -bor 0x40)
  $bytes[8] = [byte](($bytes[8] -band 0x3f) -bor 0x80)
  return ([guid]::new($bytes)).ToString()
}

function Get-AcceptanceEvidenceDirectory {
  if (-not $env:LOCALAPPDATA) {
    throw "LOCALAPPDATA is required for the private acceptance evidence directory."
  }
  $directory = Join-Path $env:LOCALAPPDATA "ZinkKnowledge\evidence\acceptance"
  New-Item -ItemType Directory -Path $directory -Force | Out-Null
  & icacls.exe $directory /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to apply the private acceptance evidence ACL."
  }
  if (-not (Get-Acl -LiteralPath $directory).AreAccessRulesProtected) {
    throw "Acceptance evidence ACL inheritance remains enabled."
  }
  return $directory
}

function Write-AcceptanceEvidence {
  param([string]$Name, [System.Collections.IDictionary]$Evidence)

  $directory = Get-AcceptanceEvidenceDirectory
  $path = Join-Path $directory $Name
  $temporary = "$path.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, ($Evidence | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $path -Force
  return $path
}

function Invoke-AcceptanceFinalization {
  param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$RunId,
    [Parameter(Mandatory)][scriptblock]$Cleanup,
    [Parameter(Mandatory)][System.Collections.IDictionary]$Evidence,
    [scriptblock]$EvidenceWriter,
    [string]$EvidenceName
  )

  $record = [pscustomobject]@{
    label = $Label
    run_id = $RunId
    completed = $true
    conditions = @()
    error = $null
    evidence_path = $null
  }
  $Evidence["finalization"] = $record

  $cleanupOutput = @()
  try {
    $cleanupOutput = @(& $Cleanup)
  }
  catch {
    $record.conditions = @($record.conditions) + @([ordered]@{ step = "cleanup"; error = $_.Exception.Message })
  }
  if ($record.conditions.Count -ne 0) {
    $record.completed = $false
    $record.error = $record.conditions[0]["error"]
  }
  if (-not $record.completed -and $Evidence.Contains("result") -and $Evidence["result"] -eq "PASS") {
    $Evidence["result"] = "FAIL"
  }

  try {
    if ($null -ne $EvidenceWriter) {
      $record.evidence_path = & $EvidenceWriter
    }
    elseif ($EvidenceName) {
      $record.evidence_path = Write-AcceptanceEvidence -Name $EvidenceName -Evidence $Evidence
    }
  }
  catch {
    $condition = [ordered]@{ step = "evidence"; error = $_.Exception.Message }
    $record.conditions = @($record.conditions) + @($condition)
    $record.completed = $false
    if (-not $record.error) { $record.error = $condition["error"] }
  }

  foreach ($condition in @($record.conditions)) {
    Write-Output "$Label acceptance finalization: $($condition['step']) failed: $($condition['error'])"
  }
}
