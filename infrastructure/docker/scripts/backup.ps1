[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BackupDirectory,
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool-acceptance",
  [string[]]$Databases = @("n8n"),
  [string[]]$ObjectBuckets = @("m2-acceptance")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$backupFormatVersion = 1
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)

function Invoke-Compose {
  param([string[]]$Arguments)

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
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
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
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

function Invoke-McWithBackupMount {
  param([string[]]$Arguments)

  $backupMount = "$backupRoot`:/backup"

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    run --rm --no-deps -T -v $backupMount aistor-mc @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "AIStor backup helper failed with exit code $LASTEXITCODE."
  }
}

function Get-ObjectTags {
  param(
    [string]$Bucket,
    [string]$Key
  )

  $raw = Get-ComposeOutput @(
    "run", "--rm", "--no-deps", "-T", "aistor-mc", "tag", "list", "--json",
    "aistor/$Bucket/$Key"
  )

  $jsonLine = @($raw -split "`r?`n" | Where-Object { $_.Trim().StartsWith("{") }) |
    Select-Object -First 1

  if (-not $jsonLine) {
    return [ordered]@{}
  }

  $tagResult = $jsonLine | ConvertFrom-Json
  $tags = [ordered]@{}

  if ($tagResult.tagset) {
    foreach ($property in $tagResult.tagset.PSObject.Properties) {
      $tags[$property.Name] = [string]$property.Value
    }
  }

  return $tags
}

function Assert-Name {
  param(
    [string]$Name,
    [string]$Kind
  )

  if ($Name -notmatch "^[a-z][a-z0-9_]{0,62}$") {
    throw "$Kind name is invalid."
  }
}

function Get-BackupRelativePath {
  param(
    [string]$BasePath,
    [string]$Path
  )

  $normalizedBase = [IO.Path]::GetFullPath($BasePath).TrimEnd("\", "/") + "\"
  $normalizedPath = [IO.Path]::GetFullPath($Path)

  if (-not $normalizedPath.StartsWith($normalizedBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Generated backup file is outside the selected backup directory."
  }

  return $normalizedPath.Substring($normalizedBase.Length).Replace("\", "/")
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}

if (Test-Path -LiteralPath $BackupDirectory) {
  if (@(Get-ChildItem -LiteralPath $BackupDirectory -Force).Count -ne 0) {
    throw "BackupDirectory must be empty to prevent overwrite: $BackupDirectory"
  }
}
else {
  New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
}

$backupRoot = (Resolve-Path -LiteralPath $BackupDirectory).Path
New-Item -ItemType Directory -Path (Join-Path $backupRoot "postgres") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $backupRoot "objects") -Force | Out-Null

foreach ($database in $Databases) {
  Assert-Name $database "Database"
}
foreach ($bucket in $ObjectBuckets) {
  if ($bucket -notmatch "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$") {
    throw "Object bucket name is invalid."
  }
}

$runningN8n = Get-ComposeOutput @("ps", "--status", "running", "-q", "n8n")

if ($runningN8n) {
  throw "Stop n8n before backup so the .n8n archive is file-consistent."
}

$postgresContainerId = Get-ComposeOutput @("ps", "--status", "running", "-q", "postgres")

if (-not $postgresContainerId) {
  throw "PostgreSQL must be running before backup."
}

foreach ($database in $Databases) {
  $destination = Join-Path $backupRoot "postgres\$database.dump"
  $backupMount = "$backupRoot`:/backup"

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    run --rm --no-deps -T `
    --user "999:999" `
    --entrypoint pg_dump `
    -v $backupMount `
    postgres-bootstrap `
    --username=postgres `
    --format=custom `
    --file="/backup/postgres/$database.dump" `
    $database

  if (
    $LASTEXITCODE -ne 0 -or
    -not (Test-Path -LiteralPath $destination -PathType Leaf) -or
    (Get-Item -LiteralPath $destination).Length -eq 0
  ) {
    throw "PostgreSQL logical backup failed for database '$database'."
  }
}

Invoke-Compose @(
  "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh",
  "-v", "$backupRoot`:/backup", "n8n", "-c",
  "set -eu; tar -C /home/node/.n8n --exclude=config -czf /backup/n8n-home.tar.gz .; if tar -tzf /backup/n8n-home.tar.gz | grep -Eq '(^|/)config$'; then exit 1; fi"
)

$objectIndex = [ordered]@{
  buckets = @($ObjectBuckets)
  objects = @()
}

foreach ($bucket in $ObjectBuckets) {
  $bucketDirectory = Join-Path $backupRoot "objects\$bucket"
  New-Item -ItemType Directory -Path $bucketDirectory -Force | Out-Null
  Invoke-McWithBackupMount @("mirror", "--overwrite", "aistor/$bucket", "/backup/objects/$bucket")

  foreach ($file in @(Get-ChildItem -LiteralPath $bucketDirectory -File -Recurse)) {
    $key = Get-BackupRelativePath $bucketDirectory $file.FullName
    $objectIndex.objects += [ordered]@{
      bucket = $bucket
      key = $key
      sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      tags = Get-ObjectTags $bucket $key
    }
  }
}

$objectIndexPath = Join-Path $backupRoot "object-storage-index.json"
[IO.File]::WriteAllText(
  $objectIndexPath,
  ($objectIndex | ConvertTo-Json -Depth 10),
  $utf8WithoutBom
)

$composeConfiguration = Get-ComposeOutput @("config", "--format", "json") | ConvertFrom-Json
$serviceVersions = [ordered]@{}
$imageDigests = [ordered]@{}

foreach ($property in $composeConfiguration.services.PSObject.Properties) {
  $image = [string]$property.Value.image
  $serviceVersions[$property.Name] = $image
  $imageDigests[$property.Name] = ($image -split "@", 2)[1]
}

$manifestFiles = @()
foreach ($file in @(Get-ChildItem -LiteralPath $backupRoot -File -Recurse)) {
  $relativePath = Get-BackupRelativePath $backupRoot $file.FullName

  $type = if ($relativePath -like "postgres/*.dump") {
    "postgres-custom"
  }
  elseif ($relativePath -eq "n8n-home.tar.gz") {
    "n8n-home"
  }
  elseif ($relativePath -eq "object-storage-index.json") {
    "object-index"
  }
  else {
    "object-export"
  }

  $manifestFiles += [ordered]@{
    path = $relativePath
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    type = $type
  }
}

$manifest = [ordered]@{
  backup_format_version = $backupFormatVersion
  created_at = [DateTime]::UtcNow.ToString("o")
  compose_project = $ProjectName
  service_versions = $serviceVersions
  image_digests = $imageDigests
  postgres_version = Get-ComposeOutput @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--tuples-only", "--no-align", "--command", "SHOW server_version;"
  )
  object_storage_implementation = "aistor-free"
  files = $manifestFiles
  secrets_included = $false
}

[IO.File]::WriteAllText(
  (Join-Path $backupRoot "manifest.json"),
  ($manifest | ConvertTo-Json -Depth 10),
  $utf8WithoutBom
)

Write-Output "Created backup manifest at $backupRoot without plaintext secrets."
