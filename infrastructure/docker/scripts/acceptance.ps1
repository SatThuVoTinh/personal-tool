[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$acceptanceProjectName = "personal-tool-acceptance"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$observabilityScript = Join-Path $scriptDirectory "observability.ps1"
$startScript = Join-Path $scriptDirectory "start.ps1"
$backupScript = Join-Path $scriptDirectory "backup.ps1"
$restoreScript = Join-Path $scriptDirectory "restore.ps1"
$runId = [guid]::NewGuid().ToString("N")
$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m2-acceptance-$runId"
$acceptanceEnvironmentFile = Join-Path $acceptanceRoot "acceptance.env"
$acceptanceLicenseFile = Join-Path $acceptanceRoot "aistor.license"
$backupDirectory = Join-Path $acceptanceRoot "backup"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Compose {
  param([string[]]$Arguments)

  & docker compose `
    --project-name $acceptanceProjectName `
    --env-file $acceptanceEnvironmentFile `
    -f $composeFile `
    @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

function Get-ComposeOutput {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $output = & docker compose `
      --project-name $acceptanceProjectName `
      --env-file $acceptanceEnvironmentFile `
      -f $composeFile `
      @Arguments `
      2>$null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Docker Compose command failed with exit code $exitCode."
  }

  return ($output -join "`n").Trim()
}

function Read-EnvironmentValue {
  param(
    [string]$Path,
    [string]$Name
  )

  $line = Get-Content -LiteralPath $Path -Encoding utf8 |
    Where-Object { $_ -match "^$([regex]::Escape($Name))=" } |
    Select-Object -First 1

  if (-not $line) {
    throw "Runtime environment file is missing $Name."
  }

  $value = ($line -split "=", 2)[1].Trim()

  if (
    $value.Length -ge 2 -and
    (($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  return $value
}

function Import-SyntheticCredential {
  param(
    [string]$Name,
    [string]$Marker
  )

  $payload = ConvertTo-Json -InputObject @(
    [pscustomobject]@{
      id = [guid]::NewGuid().ToString()
      name = $Name
      type = "httpBasicAuth"
      data = [pscustomobject]@{
        user = "m2-acceptance-synthetic"
        password = $Marker
      }
    }
  ) -Compress -Depth 5
  $command = 'set -eu; file=/tmp/m2-acceptance-credential.json; trap ''rm -f "$file"'' EXIT; umask 077; cat > "$file"; n8n import:credentials --input="$file" >/dev/null'

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $payload |
      & docker compose `
        --project-name $acceptanceProjectName `
        --env-file $acceptanceEnvironmentFile `
        -f $composeFile `
        exec -T n8n /bin/sh -c $command `
        2>&1 |
      Out-Null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $payload = $null
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Unable to import the ephemeral synthetic n8n credential."
  }
}

function Assert-SyntheticCredential {
  param(
    [string]$Name,
    [string]$Marker
  )

  $decryptedExport = Get-ComposeOutput @(
    "exec", "-T", "n8n", "n8n", "export:credentials", "--all", "--decrypted"
  )
  $jsonStart = $decryptedExport.IndexOf("[")

  if ($jsonStart -lt 0) {
    throw "n8n decrypted credential export did not return a JSON array."
  }

  $credentials = @($decryptedExport.Substring($jsonStart) | ConvertFrom-Json)
  $credential = @($credentials | Where-Object { $_.name -eq $Name }) |
    Select-Object -First 1

  if (-not $credential -or $credential.data.password -cne $Marker) {
    throw "n8n could not decrypt the synthetic acceptance credential."
  }
}

function Assert-Manifest {
  $manifestPath = Join-Path $backupDirectory "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json

  if (
    $manifest.backup_format_version -ne 1 -or
    $manifest.compose_project -ne $acceptanceProjectName -or
    $manifest.secrets_included -ne $false
  ) {
    throw "Acceptance backup manifest does not satisfy the M2 contract."
  }

  foreach ($file in @($manifest.files)) {
    $path = Join-Path $backupDirectory $file.path
    $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($hash -cne $file.sha256) {
      throw "Acceptance backup manifest checksum validation failed."
    }
  }
}

function Assert-ObjectTag {
  param(
    [string]$Bucket,
    [string]$Key,
    [string]$TagPair
  )

  $raw = Get-ComposeOutput @(
    "run", "--rm", "--no-deps", "-T", "aistor-mc", "tag", "list", "--json",
    "aistor/$Bucket/$Key"
  )
  $jsonLine = @($raw -split "`r?`n" | Where-Object { $_.Trim().StartsWith("{") }) |
    Select-Object -First 1

  if (-not $jsonLine) {
    throw "AIStor object tag was not restored."
  }

  $tagResult = $jsonLine | ConvertFrom-Json
  $tagParts = $TagPair -split "=", 2

  if (
    -not $tagResult.tagset -or
    $tagResult.tagset.($tagParts[0]) -cne $tagParts[1]
  ) {
    throw "AIStor object tag was not restored."
  }
}

function Destroy-AcceptanceProject {
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & docker compose `
      --project-name $acceptanceProjectName `
      --env-file $acceptanceEnvironmentFile `
      -f $composeFile `
      down --volumes --remove-orphans `
      2>&1 |
    Out-Null
    $cleanupExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($cleanupExitCode -ne 0) {
    throw "Acceptance project and volume cleanup failed with exit code $cleanupExitCode."
  }
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

$started = $false

try {
  New-Item -ItemType Directory -Path $acceptanceRoot -Force | Out-Null
  $sourceLicenseFile = Read-EnvironmentValue $EnvironmentFile "AISTOR_LICENSE_FILE"

  if (-not (Test-Path -LiteralPath $sourceLicenseFile -PathType Leaf)) {
    throw "The source AIStor license file is missing."
  }

  Copy-Item -LiteralPath $EnvironmentFile -Destination $acceptanceEnvironmentFile -Force
  Copy-Item -LiteralPath $sourceLicenseFile -Destination $acceptanceLicenseFile -Force
  $acceptanceLicenseValue = $acceptanceLicenseFile.Replace("\", "/")
  $acceptanceEnvironmentLines = Get-Content -LiteralPath $acceptanceEnvironmentFile -Encoding utf8 |
    ForEach-Object {
      if ($_ -match "^AISTOR_LICENSE_FILE=") {
        "AISTOR_LICENSE_FILE=$acceptanceLicenseValue"
      }
      else {
        $_
      }
    }
  [IO.File]::WriteAllLines(
    $acceptanceEnvironmentFile,
    [string[]]$acceptanceEnvironmentLines,
    $utf8WithoutBom
  )

  & $observabilityScript -EnvironmentFile $acceptanceEnvironmentFile

  $started = $true
  & $startScript `
    -Profile all `
    -EnvironmentFile $acceptanceEnvironmentFile `
    -ProjectName $acceptanceProjectName
  $marker = "m2-acceptance-$runId"
  $credentialName = "m2-acceptance-credential-$runId"
  $bucket = "m2-acceptance"
  $object = "synthetic/marker.txt"
  $tagPair = "classification=synthetic"

  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--set=ON_ERROR_STOP=1", "--command", "CREATE DATABASE m2_acceptance;"
  )
  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=m2_acceptance",
    "--set=ON_ERROR_STOP=1", "--command",
    "CREATE TABLE acceptance_marker (marker text NOT NULL); INSERT INTO acceptance_marker VALUES ('$marker');"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "aistor-mc", "mb", "aistor/$bucket")

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $marker | & docker compose `
      --project-name $acceptanceProjectName `
      --env-file $acceptanceEnvironmentFile `
      -f $composeFile `
      run --rm --no-deps -T aistor-mc pipe "aistor/$bucket/$object" `
      2>&1 |
    Out-Null
    $pipeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($pipeExitCode -ne 0) {
    throw "Unable to seed the synthetic AIStor object."
  }

  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "aistor-mc", "tag", "set", "aistor/$bucket/$object", $tagPair)
  Invoke-Compose @("exec", "-T", "n8n", "/bin/sh", "-c", "umask 077; printf '%s' '$marker' > /home/node/.n8n/m2-acceptance-marker")
  Import-SyntheticCredential $credentialName $marker
  Invoke-Compose @("exec", "-T", "redis", "redis-cli", "SET", "m2:acceptance:marker", $marker)

  if ((Get-ComposeOutput @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=m2_acceptance", "--tuples-only", "--no-align", "--command", "SELECT marker FROM acceptance_marker;")) -ne $marker) {
    throw "Synthetic PostgreSQL marker was not seeded."
  }
  if ((Get-ComposeOutput @("run", "--rm", "--no-deps", "-T", "aistor-mc", "cat", "aistor/$bucket/$object")) -ne $marker) {
    throw "Synthetic AIStor object was not seeded."
  }
  Assert-ObjectTag $bucket $object $tagPair
  Assert-SyntheticCredential $credentialName $marker

  Invoke-Compose @("down", "--remove-orphans")
  $started = $false
  $started = $true
  & $startScript `
    -Profile all `
    -EnvironmentFile $acceptanceEnvironmentFile `
    -ProjectName $acceptanceProjectName
  if ((Get-ComposeOutput @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=m2_acceptance", "--tuples-only", "--no-align", "--command", "SELECT marker FROM acceptance_marker;")) -ne $marker) {
    throw "PostgreSQL acceptance marker did not survive recreation."
  }
  if ((Get-ComposeOutput @("run", "--rm", "--no-deps", "-T", "aistor-mc", "cat", "aistor/$bucket/$object")) -ne $marker) {
    throw "AIStor acceptance object did not survive recreation."
  }
  if ((Get-ComposeOutput @("exec", "-T", "redis", "redis-cli", "GET", "m2:acceptance:marker")) -ne "") {
    throw "Redis acceptance marker survived recreation."
  }
  if ((Get-ComposeOutput @("exec", "-T", "n8n", "/bin/sh", "-c", "cat /home/node/.n8n/m2-acceptance-marker")) -ne $marker) {
    throw "n8n acceptance marker did not survive recreation."
  }
  Assert-SyntheticCredential $credentialName $marker

  Invoke-Compose @("stop", "n8n")
  & $backupScript `
    -BackupDirectory $backupDirectory `
    -EnvironmentFile $acceptanceEnvironmentFile `
    -ProjectName $acceptanceProjectName `
    -Databases @("n8n", "m2_acceptance") `
    -ObjectBuckets @($bucket)
  Assert-Manifest

  Destroy-AcceptanceProject
  $started = $false
  $started = $true
  & $startScript `
    -Profile all `
    -EnvironmentFile $acceptanceEnvironmentFile `
    -ProjectName $acceptanceProjectName
  & $restoreScript `
    -BackupDirectory $backupDirectory `
    -EnvironmentFile $acceptanceEnvironmentFile `
    -ProjectName $acceptanceProjectName

  if ((Get-ComposeOutput @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=m2_acceptance", "--tuples-only", "--no-align", "--command", "SELECT marker FROM acceptance_marker;")) -ne $marker) {
    throw "PostgreSQL acceptance marker was not restored."
  }
  if ((Get-ComposeOutput @("run", "--rm", "--no-deps", "-T", "aistor-mc", "cat", "aistor/$bucket/$object")) -ne $marker) {
    throw "AIStor acceptance object was not restored."
  }
  Assert-ObjectTag $bucket $object $tagPair
  if ((Get-ComposeOutput @("exec", "-T", "n8n", "/bin/sh", "-c", "cat /home/node/.n8n/m2-acceptance-marker")) -ne $marker) {
    throw "n8n acceptance marker was not restored."
  }
  if ((Get-ComposeOutput @("exec", "-T", "redis", "redis-cli", "GET", "m2:acceptance:marker")) -ne "") {
    throw "Redis acceptance marker was unexpectedly restored."
  }
  Assert-SyntheticCredential $credentialName $marker

  Write-Output "M2/T5 full acceptance passed."
}
finally {
  try {
    if ($started) {
      Destroy-AcceptanceProject
    }
  }
  finally {
    if (Test-Path -LiteralPath $acceptanceRoot) {
      Remove-Item -LiteralPath $acceptanceRoot -Recurse -Force
    }
  }
}
