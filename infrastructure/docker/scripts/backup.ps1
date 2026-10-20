[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$BackupDirectory,
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool",
  # F-238 (R7-D3-01): the Knowledge schema lives in the `postgres` database
  # (compose.core.yml: POSTGRES_DB and KNOWLEDGE_DATABASE_NAME). The list
  # defaulted to `n8n` alone, so the operator command the runbook documents --
  # the one that omits -Databases -- produced an artifact with no indexed
  # source, no segment and no provenance row in it.
  [string[]]$Databases = @("n8n", "postgres")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
# F-265 (R7-D13-02): the secret claim in the manifest is computed by
# inspecting the archives this script produces, so the decision lives in one
# place instead of being asserted as a constant over an archive nobody read.
. (Join-Path $scriptDirectory "backup-inspection.ps1")

function Invoke-Compose {
  param([string[]]$Arguments, [string[]]$Profiles = @())

  $composeArguments = @("--project-name", $ProjectName, "--env-file", $EnvironmentFile, "-f", $composeFile)
  foreach ($profile in $Profiles) { $composeArguments += @("--profile", $profile) }
  & docker compose @composeArguments @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
}

function Get-ComposeOutput {
  param([string[]]$Arguments)

  $output = & docker compose --project-name $ProjectName --env-file $EnvironmentFile -f $composeFile @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
  return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-ComposeCapture {
  param([string[]]$Arguments, [string[]]$Profiles = @())

  $composeArguments = @("--project-name", $ProjectName, "--env-file", $EnvironmentFile, "-f", $composeFile)
  foreach ($profile in $Profiles) { $composeArguments += @("--profile", $profile) }
  $output = & docker compose @composeArguments @Arguments 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose command failed with exit code $LASTEXITCODE."
  }
  return @($output | ForEach-Object { $_.ToString() })
}

function Assert-DatabaseName {
  param([string]$Name)
  if ($Name -notmatch "^[a-z][a-z0-9_]{0,62}$") {
    throw "Database name is invalid."
  }
}

function Get-RelativePath {
  param([string]$BasePath, [string]$Path)
  $base = [IO.Path]::GetFullPath($BasePath).TrimEnd("\", "/") + "\"
  $fullPath = [IO.Path]::GetFullPath($Path)
  if (-not $fullPath.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Generated backup file is outside the selected backup directory."
  }
  return $fullPath.Substring($base.Length).Replace("\", "/")
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
foreach ($database in $Databases) { Assert-DatabaseName $database }

if (Get-ComposeOutput @("ps", "--status", "running", "-q", "n8n")) {
  throw "Stop n8n before backup so the n8n home archive is file-consistent."
}
if (-not (Get-ComposeOutput @("ps", "--status", "running", "-q", "postgres"))) {
  throw "PostgreSQL must be running before backup."
}

$backupMount = "${backupRoot}:/backup"
foreach ($database in $Databases) {
  $destination = Join-Path $backupRoot "postgres\$database.dump"
  Invoke-Compose -Profiles @("bootstrap") -Arguments @(
    "run", "--rm", "--no-deps", "-T", "--user", "999:999", "--entrypoint",
    "pg_dump", "-v", $backupMount, "postgres-bootstrap", "--username=postgres",
    "--format=custom", "--file=/backup/postgres/$database.dump", $database
  )
  if (-not (Test-Path -LiteralPath $destination -PathType Leaf) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
    throw "PostgreSQL logical backup failed for database '$database'."
  }
}

Invoke-Compose -Profiles @("automation") -Arguments @(
  "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "-v",
  $backupMount, "n8n", "-c",
  "set -eu; tar -C /home/node/.n8n --exclude=config -czf /backup/n8n-home.tar.gz .; if tar -tzf /backup/n8n-home.tar.gz | grep -Eq '(^|/)config$'; then exit 1; fi"
)

# F-265 (R7-D13-02): the archives are listed before the manifest claims
# anything about them. The home archive is read with `tar -tzf` and every
# database dump is read with `pg_restore --list`, so the claim below is a
# result and not an assumption.
$homeArchiveEntries = @(Invoke-ComposeCapture -Profiles @("automation") -Arguments @(
  "run", "--rm", "--no-deps", "-T", "--entrypoint", "/bin/sh", "-v",
  $backupMount, "n8n", "-c",
  "set -eu; tar -tzf /backup/n8n-home.tar.gz"
) | Where-Object { $_ })
$archiveObjectsByDatabase = [ordered]@{}
foreach ($database in $Databases) {
  $listing = @(Invoke-ComposeCapture -Profiles @("bootstrap") -Arguments @(
    "run", "--rm", "--no-deps", "-T", "--entrypoint", "pg_restore", "-v",
    $backupMount, "postgres-bootstrap", "--list", "/backup/postgres/$database.dump"
  ) | Where-Object { $_ })
  $archiveObjectsByDatabase[$database] = @(Get-BackupArchiveObjectNames $listing)
}
$secretInspection = Get-BackupSecretInspection -HomeArchiveEntries $homeArchiveEntries -ArchiveObjectsByDatabase $archiveObjectsByDatabase

$files = @()
foreach ($file in @(Get-ChildItem -LiteralPath $backupRoot -File -Recurse)) {
  $relativePath = Get-RelativePath $backupRoot $file.FullName
  $files += [ordered]@{
    path = $relativePath
    sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    type = if ($relativePath -like "postgres/*.dump") { "postgres-custom" } else { "n8n-home" }
  }
}

$manifest = [ordered]@{
  backup_format_version = 3
  created_at = [DateTime]::UtcNow.ToString("o")
  compose_project = $ProjectName
  files = $files
  plaintext_secrets_excluded = $secretInspection.plaintext_secrets_excluded
  secret_inspection = $secretInspection
}
[IO.File]::WriteAllText(
  (Join-Path $backupRoot "manifest.json"),
  ($manifest | ConvertTo-Json -Depth 10),
  $utf8WithoutBom
)

Write-Output "Created PostgreSQL/n8n backup manifest at $backupRoot. Plaintext secrets excluded: $($secretInspection.plaintext_secrets_excluded). Credential-bearing database objects in the archive: $($secretInspection.credential_bearing_objects.Count)."
