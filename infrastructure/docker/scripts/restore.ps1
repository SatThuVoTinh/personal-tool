[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BackupDirectory,
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool-acceptance"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$backupFormatVersion = 1
$acceptanceProjectName = "personal-tool-acceptance"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"

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

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    run --rm --no-deps -T -v "$backupRoot`:/backup" aistor-mc @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "AIStor restore helper failed with exit code $LASTEXITCODE."
  }
}

function Assert-BackupPath {
  param([string]$RelativePath)

  if (
    [IO.Path]::IsPathRooted($RelativePath) -or
    $RelativePath -match "(^|[\\/])\.\.([\\/]|$)"
  ) {
    throw "Backup manifest contains an unsafe file path."
  }
}

function Convert-TagsToArgument {
  param([object]$Tags)

  $pairs = @()

  foreach ($property in $Tags.PSObject.Properties) {
    $pairs += "{0}={1}" -f `
      [uri]::EscapeDataString($property.Name), `
      [uri]::EscapeDataString([string]$property.Value)
  }

  return $pairs -join "&"
}

if ($ProjectName -ne $acceptanceProjectName) {
  throw "Automated restore is restricted to project '$acceptanceProjectName'."
}
if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) {
  throw "Runtime environment file is missing: $EnvironmentFile"
}
if (-not (Test-Path -LiteralPath $BackupDirectory -PathType Container)) {
  throw "Backup directory does not exist."
}

$backupRoot = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $backupRoot "manifest.json"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Backup manifest is missing."
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json

if (
  $manifest.backup_format_version -ne $backupFormatVersion -or
  $manifest.compose_project -ne $acceptanceProjectName -or
  $manifest.object_storage_implementation -ne "aistor-free" -or
  $manifest.secrets_included -ne $false
) {
  throw "Backup manifest does not satisfy the M2 acceptance restore contract."
}

foreach ($file in @($manifest.files)) {
  Assert-BackupPath $file.path
  $path = Join-Path $backupRoot $file.path

  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Backup file listed in the manifest is missing."
  }

  $actualHash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()

  if ($actualHash -cne $file.sha256) {
    throw "Backup checksum validation failed before any restore operation."
  }
}

$indexPath = Join-Path $backupRoot "object-storage-index.json"
$objectIndex = Get-Content -LiteralPath $indexPath -Raw -Encoding utf8 | ConvertFrom-Json
$postgresArchives = @($manifest.files | Where-Object { $_.type -eq "postgres-custom" })
$n8nArchive = @($manifest.files | Where-Object { $_.type -eq "n8n-home" }) |
  Select-Object -First 1

if ($postgresArchives.Count -eq 0 -or -not $n8nArchive) {
  throw "Backup manifest is incomplete for PostgreSQL or n8n restoration."
}

Invoke-Compose @("stop", "n8n")

$postgresContainerId = Get-ComposeOutput @("ps", "-q", "postgres")

if (-not $postgresContainerId) {
  throw "PostgreSQL must be running before restore."
}

foreach ($archive in $postgresArchives) {
  $database = [IO.Path]::GetFileNameWithoutExtension($archive.path)

  if ($database -notmatch "^[a-z][a-z0-9_]{0,62}$") {
    throw "Backup archive has an invalid database name."
  }

  $owner = if ($database -eq "n8n") { "n8n" } else { "postgres" }
  $archivePath = ([string]$archive.path).Replace("\", "/")
  $backupMount = "$backupRoot`:/backup:ro"

  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--set=ON_ERROR_STOP=1", "--command",
    "DROP DATABASE IF EXISTS `"$database`" WITH (FORCE);"
  )
  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres",
    "--set=ON_ERROR_STOP=1", "--command",
    "CREATE DATABASE `"$database`" OWNER `"$owner`";"
  )

  & docker compose `
    --project-name $ProjectName `
    --env-file $EnvironmentFile `
    -f $composeFile `
    run --rm --no-deps -T `
    --user "999:999" `
    --entrypoint pg_restore `
    -v $backupMount `
    postgres-bootstrap `
    --exit-on-error `
    --jobs=2 `
    --username=postgres `
    --dbname=$database `
    "/backup/$archivePath"

  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL logical restore failed for database '$database'."
  }

  # pg_dump archives do not contain optimizer statistics. Refresh them now
  # so restored, larger databases do not start with avoidable poor plans.
  Invoke-Compose @(
    "exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=$database",
    "--set=ON_ERROR_STOP=1", "--command", "ANALYZE;"
  )
}

foreach ($bucket in @($objectIndex.buckets)) {
  if ($bucket -notmatch "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$") {
    throw "Backup index contains an invalid bucket name."
  }

  Invoke-McWithBackupMount @("mb", "--ignore-existing", "aistor/$bucket")
  Invoke-McWithBackupMount @(
    "mirror", "--overwrite", "--remove", "/backup/objects/$bucket", "aistor/$bucket"
  )
}

foreach ($object in @($objectIndex.objects)) {
  if ($object.key -match "(^|[\\/])\.\.([\\/]|$)") {
    throw "Backup index contains an unsafe object key."
  }

  $tags = Convert-TagsToArgument $object.tags

  if ($tags) {
    Invoke-McWithBackupMount @("tag", "set", "aistor/$($object.bucket)/$($object.key)", $tags)
  }
}

Invoke-Compose @(
  "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh",
  "-v", "$backupRoot`:/backup", "n8n", "-c",
  "set -eu; find /home/node/.n8n -mindepth 1 -maxdepth 1 -exec rm -rf {} +; tar -C /home/node/.n8n -xzf /backup/n8n-home.tar.gz"
)
Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "180", "n8n")

Write-Output "Restored the validated M2 acceptance backup into '$acceptanceProjectName'."
