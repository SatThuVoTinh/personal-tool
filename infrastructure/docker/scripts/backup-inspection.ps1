Set-StrictMode -Version Latest

# F-265 (R7-D13-02): the backup manifest used to carry the constant
# `secrets_included = $false` over an archive the script never inspected.
# The claim is computed from what the archives actually hold, and it names
# what the inspection can prove.
#
# Two inspections feed it:
#   * the n8n home archive is listed, and the known plaintext carriers are
#     looked for by name: the instance `config` path that can hold the
#     encryption key, and any other plaintext secret file;
#   * every database dump is listed with `pg_restore --list`, and the objects
#     it carries are classified: a credential-bearing object is disclosed, and
#     an object whose name declares plaintext content is a carrier.
#
# The claim is the narrow one the inspection supports: no plaintext secret
# carrier is present in the archive. The credential-bearing database objects
# are recorded beside it, because the dump does carry them.

function Get-BackupPlaintextCarrierPaths {
  param([string[]]$HomeArchiveEntries)

  $carriers = @()
  foreach ($entry in @($HomeArchiveEntries)) {
    if (-not $entry) { continue }
    $normalized = $entry.Replace("\", "/") -replace "^\./", ""
    $segments = @($normalized.Split("/") | Where-Object { $_ })
    $name = if ($segments.Count -gt 0) { $segments[-1] } else { $normalized }
    $isConfigPath = $normalized -eq "config" -or $normalized -like "config/*" -or
      $normalized -like "*/config" -or $normalized -like "*/config/*"
    $isSecretFileName = $name -in @(
      ".env",
      "credentials.json",
      "secrets.json",
      "secrets.yaml",
      "secrets.yml",
      "id_rsa",
      "id_ed25519"
    ) -or $name -like "*.env" -or $name -like "*.pem" -or $name -like "*.key" -or
      $name -like "*.p12" -or $name -like "*.pfx" -or $name -like "*.keystore"
    if ($isConfigPath -or $isSecretFileName) { $carriers += $normalized }
  }
  return @($carriers | Sort-Object -Unique)
}

function Get-BackupArchiveObjectNames {
  param([string[]]$ListingLines)

  $names = @()
  foreach ($line in @($ListingLines)) {
    if ($line -notmatch "^\s*\d+;") { continue }
    # A pg_restore table-of-contents line is `<dump id>; <tableoid> <oid>
    # <type> <schema> <name> <owner>`, and a data entry carries the two-word
    # type `TABLE DATA`.
    $parts = @($line -split ";")
    if ($parts.Count -lt 2) { continue }
    $fields = @($parts[1].Trim() -split "\s+")
    if ($fields.Count -lt 5) { continue }
    $type = $fields[2]
    $offset = 3
    if ($type -eq "TABLE" -and $fields[3] -eq "DATA") { $type = "TABLE DATA"; $offset = 4 }
    if ($type -eq "MATERIALIZED" -and $fields[3] -eq "VIEW") { $type = "MATERIALIZED VIEW"; $offset = 4 }
    if ($type -notin @("TABLE", "TABLE DATA", "VIEW", "MATERIALIZED VIEW", "SEQUENCE")) { continue }
    if ($fields.Count -lt ($offset + 2)) { continue }
    if (-not $fields[$offset + 1]) { continue }
    $names += "$($fields[$offset]).$($fields[$offset + 1])"
  }
  return @($names | Sort-Object -Unique)
}

function Get-BackupCredentialBearingObjects {
  param([System.Collections.IDictionary]$ArchiveObjectsByDatabase)

  if ($null -eq $ArchiveObjectsByDatabase) { return @() }
  $objects = @()
  foreach ($database in @($ArchiveObjectsByDatabase.Keys | Sort-Object)) {
    foreach ($object in @($ArchiveObjectsByDatabase[$database])) {
      if ("$object" -match "(?i)(credential|secret|token|api[_-]?key|password)") {
        $objects += "$database.$object"
      }
    }
  }
  return @($objects | Sort-Object -Unique)
}

function Get-BackupPlaintextObjectNames {
  param([System.Collections.IDictionary]$ArchiveObjectsByDatabase)

  if ($null -eq $ArchiveObjectsByDatabase) { return @() }
  $objects = @()
  foreach ($database in @($ArchiveObjectsByDatabase.Keys | Sort-Object)) {
    foreach ($object in @($ArchiveObjectsByDatabase[$database])) {
      if ("$object" -match "(?i)(plaintext|cleartext|clear_text|unencrypted)") {
        $objects += "$database.$object"
      }
    }
  }
  return @($objects | Sort-Object -Unique)
}

function Get-BackupSecretInspection {
  param([string[]]$HomeArchiveEntries, [System.Collections.IDictionary]$ArchiveObjectsByDatabase)

  $carriers = @(
    @(Get-BackupPlaintextCarrierPaths $HomeArchiveEntries) +
    @(Get-BackupPlaintextObjectNames $ArchiveObjectsByDatabase) |
      Sort-Object -Unique
  )
  return [ordered]@{
    method = "archive-inspection"
    scope = "plaintext secret carriers: secret-bearing files in the archived home directory and plaintext-named database objects"
    n8n_home_entries_inspected = @($HomeArchiveEntries).Count
    plaintext_secret_carrier_paths = $carriers
    credential_bearing_objects = @(Get-BackupCredentialBearingObjects $ArchiveObjectsByDatabase)
    plaintext_secrets_excluded = ($carriers.Count -eq 0)
  }
}
