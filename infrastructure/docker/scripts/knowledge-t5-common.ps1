Set-StrictMode -Version Latest

$script:T5RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script:T5DockerDirectory = Split-Path -Parent $PSScriptRoot
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA is required for private M4/T5 evidence." }
$script:T5EvidenceDirectory = Join-Path $env:LOCALAPPDATA "ZinkKnowledge\evidence\m4-t5"
$script:T5AdvisoryLockKey = 741212391041002

if (-not ("PersonalTool.T5ReparsePoint" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PersonalTool {
  public sealed class T5Utf8ByteComparer : System.Collections.Generic.IComparer<string> {
    public int Compare(string left, string right) {
      byte[] a = System.Text.Encoding.UTF8.GetBytes(left);
      byte[] b = System.Text.Encoding.UTF8.GetBytes(right);
      int count = Math.Min(a.Length, b.Length);
      for (int index = 0; index < count; index++) {
        int comparison = a[index].CompareTo(b[index]);
        if (comparison != 0) return comparison;
      }
      return a.Length.CompareTo(b.Length);
    }
  }

  public static class T5ReparsePoint {
    private const uint FSCTL_GET_REPARSE_POINT = 0x000900A8;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
      string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes,
      uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
      SafeFileHandle device, uint controlCode, IntPtr inputBuffer, int inputSize,
      byte[] outputBuffer, int outputSize, out int bytesReturned, IntPtr overlapped);

    public static uint GetTag(string path) {
      using (SafeFileHandle handle = CreateFile(
        path, 0, 7, IntPtr.Zero, 3,
        FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, IntPtr.Zero)) {
        if (handle.IsInvalid) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        byte[] buffer = new byte[16384];
        int returned;
        if (!DeviceIoControl(
          handle, FSCTL_GET_REPARSE_POINT, IntPtr.Zero, 0,
          buffer, buffer.Length, out returned, IntPtr.Zero)) {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        if (returned < 8) {
          throw new InvalidOperationException("The reparse buffer is incomplete.");
        }
        return BitConverter.ToUInt32(buffer, 0);
      }
    }

    public static bool IsCloudPlaceholder(uint tag) {
      return (tag & 0xFFFF0FFFu) == 0x9000001Au;
    }
  }
}
'@
}

# F-292 (R7-C4-05): every repository probe names the directory it reads.
# The script's own tree is the tree the driver packages, so its revision is
# read from that tree and not from whichever repository the invocation
# directory happens to be inside.
function Assert-T5CleanRepository {
  $changes = @(git -C $script:T5RepositoryRoot status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) {
    throw "M3/T5 acceptance requires a clean working tree."
  }
}

function Get-T5RepositorySha {
  $sha = (git -C $script:T5RepositoryRoot rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to resolve the current repository SHA."
  }
  return $sha
}

function ConvertTo-T5ComparablePath {
  param([string]$Path)

  if (-not $Path) { return "" }
  return $Path.Replace("\", "/").TrimEnd("/")
}

# The decision that turns a foreign tree into a failure, separated from the
# probes so it can be exercised on its own: the script's own tree at the same
# revision is accepted, and anything else names both revisions.
function New-T5RepositoryIdentityError {
  param([string]$ScriptRoot, [string]$ScriptSha, [string]$InvocationRoot, [string]$InvocationSha)

  if (-not $InvocationRoot) { return $null }
  $sameRoot = (ConvertTo-T5ComparablePath $InvocationRoot) -ieq (ConvertTo-T5ComparablePath $ScriptRoot)
  if ($sameRoot -and $ScriptSha -ceq $InvocationSha) { return $null }
  return "Acceptance must run from the script's own working tree. The script tree '$ScriptRoot' is at revision $ScriptSha; the invocation tree '$InvocationRoot' is at revision $InvocationSha."
}

function Assert-T5RepositoryIdentity {
  $scriptSha = Get-T5RepositorySha
  $invocationDirectory = (Get-Location).Path
  $invocationRoot = $null
  $invocationSha = $null
  $rootOutput = & git -C $invocationDirectory rev-parse --show-toplevel 2>$null
  if ($LASTEXITCODE -eq 0 -and $rootOutput) {
    $invocationRoot = (@($rootOutput) | Select-Object -First 1).ToString().Trim()
    $shaOutput = & git -C $invocationDirectory rev-parse HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $shaOutput) {
      $invocationSha = (@($shaOutput) | Select-Object -First 1).ToString().Trim()
    }
  }
  $identityError = New-T5RepositoryIdentityError -ScriptRoot $script:T5RepositoryRoot -ScriptSha $scriptSha -InvocationRoot $invocationRoot -InvocationSha $invocationSha
  if ($identityError) { throw $identityError }
  return $scriptSha
}

function Get-T5CandidatePathManifest {
  param([string]$Treeish = "HEAD")

  if ($Treeish -notmatch '^(HEAD|[0-9a-f]{40,64}|[A-Za-z0-9_.]+/[A-Za-z0-9_.-]+)$') { throw "Candidate Git tree identity is invalid." }
  [string[]]$paths = @(git -C $script:T5RepositoryRoot ls-tree -r --name-only $Treeish |
    ForEach-Object { $_.Replace("\", "/") } |
    Where-Object { Test-T5CandidateAffectingPath $_ })
  [Array]::Sort($paths, [PersonalTool.T5Utf8ByteComparer]::new())
  if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) {
    throw "Unable to enumerate M4/T5 candidate files."
  }

  $pathBytes = [Collections.Generic.List[byte]]::new()
  $manifestBytes = [Collections.Generic.List[byte]]::new()
  $entries = foreach ($relativePath in $paths) {
    if ($relativePath.Contains("\")) { throw "Candidate path is not POSIX-normalized: $relativePath" }
    $oid = (& git -C $script:T5RepositoryRoot rev-parse "${Treeish}:$relativePath").Trim()
    if ($LASTEXITCODE -ne 0 -or $oid -notmatch '^[0-9a-f]{40,64}$') {
      throw "Unable to resolve candidate Git blob OID: $relativePath"
    }
    $encodedPath = [Text.UTF8Encoding]::new($false).GetBytes($relativePath)
    $encodedOid = [Text.Encoding]::ASCII.GetBytes($oid)
    $pathBytes.AddRange($encodedPath); $pathBytes.Add(0)
    $manifestBytes.AddRange($encodedPath); $manifestBytes.Add(0)
    $manifestBytes.AddRange($encodedOid); $manifestBytes.Add(0)
    [ordered]@{ path = $relativePath; git_blob_oid = $oid }
  }
  return [ordered]@{
    entries = @($entries)
    candidate_path_count = $paths.Count
    candidate_path_set_sha256 = Get-T5Sha256Bytes $pathBytes.ToArray()
    candidate_manifest_sha256 = Get-T5Sha256Bytes $manifestBytes.ToArray()
  }
}

function Test-T5CandidateAffectingPath {
  param([string]$Path)

  if ($Path -match '^(apps/knowledge|docs|infrastructure/docker|infrastructure/nginx|scripts|tests|\.github/workflows)/') {
    return $true
  }
  return $Path -match '^(README\.md|Makefile|package(?:-lock)?\.json|eslint\.config\.[^/]+|\.editorconfig|\.env\.example|\.gitattributes|\.gitignore|\.markdownlint[^/]*|\.npmrc|\.nvmrc|Dockerfile|tsconfig[^/]*|.*workspace[^/]*)$'
}

function Get-T5Sha256Bytes {
  param([byte[]]$Bytes)

  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally { $sha256.Dispose() }
}

function Get-T5Sha256Text {
  param([string]$Text)

  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
  return Get-T5Sha256Bytes $bytes
}

function Get-T5CanonicalVaultRoot {
  param([string]$VaultRoot)

  if (-not $VaultRoot) { throw "VaultRoot is required." }
  $resolved = (Resolve-Path -LiteralPath $VaultRoot -ErrorAction Stop).Path
  if (-not (Test-Path -LiteralPath $resolved -PathType Container)) {
    throw "VaultRoot must resolve to a directory."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $resolved "01. Knowledge") -PathType Container)) {
    throw "VaultRoot must contain 01. Knowledge."
  }
  return $resolved.TrimEnd('\', '/')
}

function Assert-T5NoUnsafeNestedReparsePoint {
  param([string]$VaultRoot)

  $items = Get-ChildItem -LiteralPath $VaultRoot -Force -Recurse -ErrorAction Stop
  $rootPrefix = $VaultRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  foreach ($item in $items) {
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      $tag = [PersonalTool.T5ReparsePoint]::GetTag($item.FullName)
      if (-not [PersonalTool.T5ReparsePoint]::IsCloudPlaceholder($tag)) {
        throw "Nested link-like or unknown reparse point is not allowed: $($item.FullName)"
      }
      $resolved = (Resolve-Path -LiteralPath $item.FullName -ErrorAction Stop).Path
      if ($resolved -cne $VaultRoot -and -not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Cloud placeholder resolves outside the configured Vault: $($item.FullName)"
      }
    }
  }
}

function Get-T5VaultTreeHash {
  param([string]$CanonicalVaultRoot)

  Assert-T5NoUnsafeNestedReparsePoint $CanonicalVaultRoot
  $entries = foreach ($item in Get-ChildItem -LiteralPath $CanonicalVaultRoot -File -Force -Recurse -ErrorAction Stop) {
    $relative = $item.FullName.Substring($CanonicalVaultRoot.Length).TrimStart('\', '/').Replace('\', '/')
    [ordered]@{
      path = $relative
      byte_length = [int64]$item.Length
      sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  }
  $serialized = foreach ($entry in @($entries | Sort-Object { $_.path })) {
    $entry | ConvertTo-Json -Compress
  }
  return Get-T5Sha256Text (($serialized -join "`n") + "`n")
}

function New-T5SyntheticPdf {
  param([string]$Path, [string]$Text)

  $encoding = [Text.Encoding]::ASCII
  $stream = "BT /F1 24 Tf 72 720 Td ($Text) Tj ET"
  $objects = @(
    "1 0 obj`n<< /Type /Catalog /Pages 2 0 R >>`nendobj`n",
    "2 0 obj`n<< /Type /Pages /Kids [3 0 R] /Count 1 >>`nendobj`n",
    "3 0 obj`n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`nendobj`n",
    "4 0 obj`n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`nendobj`n",
    "5 0 obj`n<< /Length $($encoding.GetByteCount($stream)) >>`nstream`n$stream`nendstream`nendobj`n"
  )
  $bytes = [Collections.Generic.List[byte]]::new()
  $bytes.AddRange($encoding.GetBytes("%PDF-1.4`n% M4 acceptance fixture`n"))
  $offsets = [Collections.Generic.List[int]]::new()
  foreach ($object in $objects) { $offsets.Add($bytes.Count); $bytes.AddRange($encoding.GetBytes($object)) }
  $xrefOffset = $bytes.Count
  $xref = "xref`n0 6`n0000000000 65535 f `n" + (($offsets | ForEach-Object { "{0:D10} 00000 n `n" -f $_ }) -join "") + "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"
  $bytes.AddRange($encoding.GetBytes($xref))
  [IO.File]::WriteAllBytes($Path, $bytes.ToArray())
}

function Assert-T5ExpectedSourcePath {
  param([string]$CanonicalVaultRoot, [string]$ExpectedSourcePath)

  if ([IO.Path]::IsPathRooted($ExpectedSourcePath) -or $ExpectedSourcePath.Contains('\') -or
    $ExpectedSourcePath.StartsWith('/') -or -not $ExpectedSourcePath.EndsWith('.md', [StringComparison]::Ordinal) -or
    $ExpectedSourcePath -notmatch '^01\. Knowledge/.+\.md$' -or $ExpectedSourcePath -match '[\x00-\x1f\x7f]') {
    throw "ExpectedSourcePath must be a canonical Vault-relative POSIX Markdown path."
  }
  $segments = $ExpectedSourcePath.Split('/')
  if (@($segments | Where-Object { -not $_ -or $_ -in @('.', '..') }).Count -ne 0) {
    throw "ExpectedSourcePath must not contain empty, dot, or parent segments."
  }
  $current = $CanonicalVaultRoot
  foreach ($segment in $segments) {
    $exact = @(Get-ChildItem -LiteralPath $current -Force -ErrorAction Stop | Where-Object { $_.Name -ceq $segment })
    if ($exact.Count -ne 1) { throw "ExpectedSourcePath case does not exactly match the Vault." }
    $current = $exact[0].FullName
  }
  $sourcePath = Join-Path $CanonicalVaultRoot ($ExpectedSourcePath.Replace('/', '\'))
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "ExpectedSourcePath does not exist in the Vault."
  }
  $resolvedSource = (Resolve-Path -LiteralPath $sourcePath -ErrorAction Stop).Path
  if (-not $resolvedSource.StartsWith($CanonicalVaultRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "ExpectedSourcePath resolves outside the Vault."
  }
  return $resolvedSource
}

function Get-T5SearchFilters {
  param([string]$CanonicalVaultRoot, [string]$ExpectedSourcePath)

  $segments = $ExpectedSourcePath.Split('/')
  $source = Assert-T5ExpectedSourcePath $CanonicalVaultRoot $ExpectedSourcePath
  $contents = Get-Content -LiteralPath $source -Raw -Encoding utf8

  $canonicalTags = @(
    [pscustomobject]@{ topic = "AI"; tag = "ai" },
    [pscustomobject]@{ topic = "Data"; tag = "data" },
    [pscustomobject]@{ topic = "Cloud"; tag = "cloud" },
    [pscustomobject]@{ topic = "Machine Learning"; tag = "machinelearning" },
    [pscustomobject]@{ topic = "Logistics"; tag = "logistics" },
    [pscustomobject]@{ topic = "Supply Chain"; tag = "supplychain" },
    [pscustomobject]@{ topic = "Material Science"; tag = "materialscience" },
    [pscustomobject]@{ topic = "Agricultural Science"; tag = "agriculturalscience" },
    [pscustomobject]@{ topic = "Economic"; tag = "economic" },
    [pscustomobject]@{ topic = "Natural Science"; tag = "naturalscience" },
    [pscustomobject]@{ topic = "Social Science"; tag = "socialscience" },
    [pscustomobject]@{ topic = "English"; tag = "english" },
    [pscustomobject]@{ topic = "Chinese"; tag = "chinese" }
  )
  $firstCanonical = $null
  foreach ($candidate in $canonicalTags) {
    $pattern = "(?<![\w/\\])#$([regex]::Escape($candidate.tag))(?![\w/-])"
    $match = [regex]::Match($contents, $pattern, [Text.RegularExpressions.RegexOptions]::CultureInvariant)
    if ($match.Success -and (-not $firstCanonical -or $match.Index -lt $firstCanonical.index)) {
      $firstCanonical = [pscustomobject]@{ index = $match.Index; topic = $candidate.topic; tag = $candidate.tag }
    }
  }
  if (-not $firstCanonical) { throw "Expected source does not contain a lowercase canonical native topic tag." }

  $parent = ($segments[0..($segments.Count - 2)] -join '/')
  return [ordered]@{ primary_topic = $firstCanonical.topic; tags_all = @($firstCanonical.tag); path_prefix = $parent }
}

function Get-T5ImageIdentity {
  param([string]$Image = "personal-tool/knowledge:m3")

  if (-not $Image) { $Image = "personal-tool/knowledge:m3" }
  $imageInspect = @(& docker image inspect $Image | ConvertFrom-Json)[0]
  if (-not $imageInspect -or -not $imageInspect.Id) { throw "Knowledge image is unavailable: $Image" }
  $revision = $imageInspect.Config.Labels."org.opencontainers.image.revision"
  if (-not $revision -or $revision -notmatch '^[0-9a-f]{40}$') {
    throw "Knowledge image is missing OCI repository revision provenance."
  }
  $entrypointProperty = $imageInspect.Config.PSObject.Properties["Entrypoint"]
  $commandProperty = $imageInspect.Config.PSObject.Properties["Cmd"]
  return [ordered]@{
    image_id = $imageInspect.Id
    repo_digest = @($imageInspect.RepoDigests | Select-Object -First 1)[0]
    revision = $revision
    entrypoint = if ($entrypointProperty) { @($entrypointProperty.Value) } else { @() }
    command = if ($commandProperty) { @($commandProperty.Value) } else { @() }
  }
}

function Get-T5MigrationIdentity {
  $migrationDirectory = Join-Path $script:T5RepositoryRoot "apps\knowledge\migrations"
  $migrations = @(foreach ($file in Get-ChildItem -LiteralPath $migrationDirectory -Filter *.sql | Sort-Object Name) {
    [ordered]@{ name = $file.Name; sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  })
  $expected = @("001_initial.sql", "002_pdf_ingestion_foundation.sql", "004_pdf_build_failure_cause.sql", "005_schema_migration_digest.sql")
  if (($migrations.name -join "`n") -cne ($expected -join "`n")) {
    throw "M4/T5 expects the exact approved migration 001/002/004/005 ledger."
  }
  return @($migrations)
}

function Get-T5ModelIdentity {
  param([string]$ModelName = "bge-m3:latest")

  $model = @((Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get).models | Where-Object { $_.name -eq $ModelName }) | Select-Object -First 1
  if (-not $model -or -not $model.digest) { throw "Embedding model $ModelName is unavailable." }
  # F-293 (R7-C4-06): the provider's response is untrusted data, so the digest
  # must have the shape the column's CHECK constraint accepts before it is
  # used anywhere -- including in the acceptance statements, where it reaches
  # the database as a psql variable rather than as an interpolated literal.
  if ($model.digest -notmatch '^[0-9a-f]{64}$') { throw "Embedding model $ModelName digest does not have the documented shape." }
  $embedding = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/embed" -Method Post -ContentType "application/json" -Body "{`"model`":`"$ModelName`",`"input`":`"knowledge-t5-identity`"}"
  if (-not $embedding.embeddings -or $embedding.embeddings[0].Length -ne 1024) { throw "Embedding model identity has the wrong dimension." }
  return [ordered]@{ name = $ModelName; digest = $model.digest; dimension = 1024 }
}

function Assert-T5LocalEmbeddingReady {
  param([string]$ModelName, [int]$ExpectedDimensions)

  $body = @{ model = $ModelName; input = "knowledge-m4-t5-offline-preflight" } | ConvertTo-Json -Compress
  try {
    $response = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/embed" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 90
  }
  catch {
    throw "Approved local Ollama embedding endpoint is not ready before the offline phase."
  }
  $embeddings = @($response.embeddings)
  if ($embeddings.Count -ne 1 -or @($embeddings[0]).Count -ne $ExpectedDimensions) {
    throw "Approved local Ollama embedding dimensions do not match the frozen contract."
  }
}

function Get-T5Candidate {
  param([string]$ModelName = "bge-m3:latest")

  Assert-T5CleanRepository
  $repositorySha = Assert-T5RepositoryIdentity
  $image = Get-T5ImageIdentity
  if ($image.revision -ne $repositorySha) {
    throw "Knowledge image provenance does not match the clean repository HEAD."
  }
  $embedding = Get-T5ModelIdentity $ModelName
  Assert-T5LocalEmbeddingReady $ModelName 1024
  $candidate = [ordered]@{
    repository_sha = $repositorySha
    candidate_manifest = Get-T5CandidatePathManifest
    image = $image
    embedding = $embedding
    migrations = Get-T5MigrationIdentity
    knowledge_memory_limit_bytes = 4294967296
    vault_target = "/vault"
    vault_read_only = $true
  }
  $candidate.candidate_fingerprint = Get-T5Sha256Text ($candidate | ConvertTo-Json -Depth 10 -Compress)
  return $candidate
}

function Assert-T5CandidateManifest {
  param([object]$Expected)

  $actual = Get-T5CandidatePathManifest
  if ($actual.candidate_path_count -ne $Expected.candidate_path_count -or
    $actual.candidate_path_set_sha256 -cne $Expected.candidate_path_set_sha256 -or
    $actual.candidate_manifest_sha256 -cne $Expected.candidate_manifest_sha256) {
    throw "Frozen candidate path set or Git-blob manifest changed."
  }
  return $actual
}

function Get-T5DeploymentFingerprint {
  param([string]$ProjectName, [string]$Persistence)

  $deployment = [ordered]@{ project = $ProjectName; persistence = $Persistence }
  $deployment.fingerprint = Get-T5Sha256Text ($deployment | ConvertTo-Json -Compress)
  return $deployment
}

function Write-T5Evidence {
  param([string]$Prefix, [string]$RunId, [System.Collections.IDictionary]$Evidence)

  Initialize-T5PrivateEvidenceDirectory
  $path = Join-Path $script:T5EvidenceDirectory "$Prefix-$RunId.json"
  Write-T5AtomicJson $path $Evidence
  return $path
}

function Initialize-T5PrivateEvidenceDirectory {
  New-Item -ItemType Directory -Path $script:T5EvidenceDirectory -Force | Out-Null
  $current = Get-Item -LiteralPath $script:T5EvidenceDirectory -Force
  while ($current) {
    if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Private evidence path traverses a reparse point."
    }
    $current = $current.Parent
  }
  & icacls.exe $script:T5EvidenceDirectory /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to apply private evidence ACL." }
  $acl = Get-Acl -LiteralPath $script:T5EvidenceDirectory
  if (-not $acl.AreAccessRulesProtected) { throw "Private evidence ACL inheritance remains enabled." }
}

function Write-T5AtomicJson {
  param([string]$Path, [System.Collections.IDictionary]$Value)

  $parent = Split-Path -Parent $Path
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  $path = $Path
  $temporary = "$path.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $temporary -Destination $path -Force
}

function Get-T5MatchingRealVaultEvidence {
  param([System.Collections.IDictionary]$Candidate, [string]$CanonicalVaultRoot, [string]$VaultTreeHash, [string]$Query, [string]$ExpectedSourcePath)

  if (-not (Test-Path -LiteralPath $script:T5EvidenceDirectory -PathType Container)) { return $null }
  $matches = foreach ($path in Get-ChildItem -LiteralPath $script:T5EvidenceDirectory -Filter "realvault-*.json" -File | Sort-Object LastWriteTimeUtc -Descending) {
    try { $evidence = Get-Content -LiteralPath $path.FullName -Raw -Encoding utf8 | ConvertFrom-Json } catch { continue }
    if ($evidence.mode -eq "RealVault" -and $evidence.result -eq "PASS" -and
      $evidence.vault.canonical_root -eq $CanonicalVaultRoot -and
      $evidence.vault.tree_hash_after -eq $VaultTreeHash -and
      $evidence.request.query -eq $Query -and
      $evidence.request.expected_source_path -eq $ExpectedSourcePath -and
      $evidence.candidate.candidate_fingerprint -eq $Candidate.candidate_fingerprint) { $evidence; break }
  }
  return @($matches | Select-Object -First 1)[0]
}

function Get-T5CgroupSnapshot {
  param([string]$ContainerId)

  $limit = [int64]((& docker inspect --format "{{.HostConfig.Memory}}" $ContainerId).Trim())
  if ($LASTEXITCODE -ne 0 -or $limit -ne 4294967296) {
    throw "Knowledge container memory_limit_bytes must equal 4294967296."
  }
  & docker exec $ContainerId test -f /sys/fs/cgroup/memory.peak | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $peak = [int64]((& docker exec $ContainerId cat /sys/fs/cgroup/memory.peak).Trim())
    if ($LASTEXITCODE -ne 0) { throw "Knowledge cgroup v2 memory peak is unavailable." }
    $events = @(& docker exec $ContainerId cat /sys/fs/cgroup/memory.events)
    if ($LASTEXITCODE -ne 0) { throw "Knowledge cgroup v2 OOM counters are unavailable." }
    $oomLine = @($events | Where-Object { $_ -match '^oom\s+\d+$' } | Select-Object -First 1)
    $oomKillLine = @($events | Where-Object { $_ -match '^oom_kill\s+\d+$' } | Select-Object -First 1)
    if ($oomLine.Count -ne 1 -or $oomKillLine.Count -ne 1) { throw "Knowledge cgroup v2 OOM counters are malformed." }
    $oom = [int64](($oomLine[0] -split '\s+')[1])
    $oomKill = [int64](($oomKillLine[0] -split '\s+')[1])
    $version = 2
  }
  else {
    $peak = [int64]((& docker exec $ContainerId cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes).Trim())
    $oom = [int64]((& docker exec $ContainerId cat /sys/fs/cgroup/memory/memory.failcnt).Trim())
    if ($LASTEXITCODE -ne 0) { throw "Knowledge cgroup v1 memory counters are unavailable." }
    $oomControl = @(& docker exec $ContainerId cat /sys/fs/cgroup/memory/memory.oom_control)
    $oomKillLine = @($oomControl | Where-Object { $_ -match '^oom_kill\s+\d+$' } | Select-Object -First 1)
    $oomKill = if ($oomKillLine.Count -eq 1) { [int64](($oomKillLine[0] -split '\s+')[1]) } else { 0 }
    $version = 1
  }
  return [ordered]@{ cgroup_version = $version; memory_limit_bytes = $limit; memory_peak_bytes = $peak; oom_count = $oom; oom_kill_count = $oomKill }
}

function Get-T5ResourceWindow {
  param(
    [System.Collections.IDictionary]$Before,
    [System.Collections.IDictionary]$After,
    [string]$WindowName
  )

  if ($Before.memory_limit_bytes -ne 4294967296 -or $After.memory_limit_bytes -ne 4294967296) {
    throw "Knowledge $WindowName memory limit drifted."
  }
  $oomDelta = [int64]$After.oom_count - [int64]$Before.oom_count
  $oomKillDelta = [int64]$After.oom_kill_count - [int64]$Before.oom_kill_count
  if ($oomDelta -lt 0 -or $oomKillDelta -lt 0) { throw "Knowledge $WindowName OOM counters moved backwards." }
  $peak = [int64]$After.memory_peak_bytes
  if ($peak -ge 3435973837 -or $oomDelta -ne 0 -or $oomKillDelta -ne 0) {
    throw "Knowledge $WindowName resource gate failed: peak=$peak, oom_delta=$oomDelta, oom_kill_delta=$oomKillDelta."
  }
  return [ordered]@{
    memory_limit_bytes = [int64]$After.memory_limit_bytes
    memory_peak_bytes = $peak
    oom_count_before = [int64]$Before.oom_count
    oom_count_after = [int64]$After.oom_count
    oom_delta = $oomDelta
    oom_kill_before = [int64]$Before.oom_kill_count
    oom_kill_after = [int64]$After.oom_kill_count
    oom_kill_delta = $oomKillDelta
  }
}

function Assert-T5NetworkBoundary {
  param(
    [string]$KnowledgeContainerId,
    [string]$NginxContainerId,
    [string]$ExpectedNginxHostPort = "8080"
  )

  $knowledgePorts = (& docker inspect --format "{{json .HostConfig.PortBindings}}" $KnowledgeContainerId).Trim()
  if ($knowledgePorts -notin @('null', '{}', '')) { throw "Knowledge must not publish host ports." }
  $nginx = @(& docker inspect $NginxContainerId | ConvertFrom-Json)[0]
  $configuredBindings = @($nginx.HostConfig.PortBindings.'8080/tcp')
  $runtimeBindings = @($nginx.NetworkSettings.Ports.'8080/tcp')
  if ($ExpectedNginxHostPort -notmatch '^\d+$' -or $configuredBindings.Count -ne 1 -or
    $runtimeBindings.Count -ne 1 -or $configuredBindings[0].HostIp -ne '127.0.0.1' -or
    $configuredBindings[0].HostPort -notin @('', $ExpectedNginxHostPort) -or
    $runtimeBindings[0].HostIp -ne '127.0.0.1' -or $runtimeBindings[0].HostPort -ne $ExpectedNginxHostPort) {
    throw "Nginx must bind exactly 127.0.0.1:$ExpectedNginxHostPort."
  }
}

function Assert-T5ModelEgressAllowlist {
  param([string]$KnowledgeContainerId)

  # F-288 (R7-C4-01): the model-egress proof is shape-agnostic, so it runs
  # against the DEPLOYED composition and not only against the acceptance
  # overlay. The Knowledge container's model route must be the allowlisted
  # gateway, and the gateway must refuse every model API the allowlist does
  # not name - a generic forward proxy is not an allowlist.
  $knowledge = @(& docker inspect $KnowledgeContainerId | ConvertFrom-Json)[0]
  $modelRoute = @($knowledge.Config.Env | Where-Object { $_ -like "KNOWLEDGE_OLLAMA_URL=*" })[0]
  if ($modelRoute -ne "KNOWLEDGE_OLLAMA_URL=http://nginx:8080/ollama") {
    throw "Knowledge model egress must use the allowlisted gateway route."
  }
  & docker exec $KnowledgeContainerId python -c "from urllib.request import urlopen; r=urlopen('http://nginx:8080/ollama/api/tags',timeout=5); raise SystemExit(0 if r.status==200 else 1)"
  if ($LASTEXITCODE -ne 0) { throw "Knowledge could not reach the model service through the allowlisted gateway." }
  & docker exec $KnowledgeContainerId python -c "from urllib.request import urlopen;`ntry: urlopen('http://nginx:8080/https://example.com/', timeout=3)`nexcept Exception: raise SystemExit(0)`nraise SystemExit(1)"
  if ($LASTEXITCODE -ne 0) { throw "The model gateway behaved like a generic forward proxy." }
  & docker exec $KnowledgeContainerId python -c "from urllib.request import Request,urlopen;`ntry: urlopen(Request('http://nginx:8080/ollama/api/pull',data=b'{}',method='POST'),timeout=3)`nexcept Exception: raise SystemExit(0)`nraise SystemExit(1)"
  if ($LASTEXITCODE -ne 0) { throw "The model gateway exposed a non-allowlisted Ollama API." }
}

function Assert-T5RuntimeIsolation {
  param([string]$KnowledgeContainerId, [string]$NginxContainerId)

  Assert-T5PrivilegeBoundary $KnowledgeContainerId
  $knowledge = @(& docker inspect $KnowledgeContainerId | ConvertFrom-Json)[0]
  if (@($knowledge.HostConfig.ExtraHosts).Count -ne 0 -or
    @($knowledge.NetworkSettings.Networks.PSObject.Properties).Count -ne 1) {
    throw "Knowledge acceptance has an unexpected host or network route."
  }
  $networkId = @($knowledge.NetworkSettings.Networks.PSObject.Properties.Value.NetworkID)[0]
  $network = @(& docker network inspect $networkId | ConvertFrom-Json)[0]
  if (-not $network.Internal) { throw "Knowledge acceptance network must be internal." }
  & docker exec $KnowledgeContainerId python -c "import socket; s=socket.socket(); s.settimeout(2);`ntry: s.connect(('1.1.1.1',443))`nexcept OSError: raise SystemExit(0)`nraise SystemExit(1)"
  if ($LASTEXITCODE -ne 0) { throw "Knowledge direct external TCP egress was not denied." }
  & docker exec $KnowledgeContainerId python -c "import socket; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(2);`ntry: s.sendto(b'\\x00'*12,('8.8.8.8',53)); s.recvfrom(512)`nexcept OSError: raise SystemExit(0)`nraise SystemExit(1)"
  if ($LASTEXITCODE -ne 0) { throw "Knowledge external DNS transport was not denied." }
  & docker exec $KnowledgeContainerId python -c "import socket; s=socket.create_connection(('postgres',5432),3); s.close()"
  if ($LASTEXITCODE -ne 0) { throw "Knowledge could not reach approved local PostgreSQL." }
  Assert-T5ModelEgressAllowlist $KnowledgeContainerId

  $nginx = @(& docker inspect $NginxContainerId | ConvertFrom-Json)[0]
  if (@($nginx.NetworkSettings.Networks.PSObject.Properties).Count -ne 2) {
    throw "Acceptance Nginx must be the only dual-homed allowlisted gateway."
  }
}

function Assert-T5PrivilegeBoundary {
  param([string]$KnowledgeContainerId)

  $knowledge = @(& docker inspect $KnowledgeContainerId | ConvertFrom-Json)[0]
  if (-not $knowledge.HostConfig.ReadonlyRootfs -or
    @($knowledge.HostConfig.CapDrop) -notcontains "ALL" -or
    @($knowledge.HostConfig.SecurityOpt) -notcontains "no-new-privileges:true" -or
    [int]$knowledge.HostConfig.PidsLimit -ne 256) {
    throw "Knowledge acceptance privilege isolation is incomplete."
  }
  if (@($knowledge.Mounts | Where-Object { $_.Destination -eq "/var/run/docker.sock" }).Count -ne 0) {
    throw "Knowledge acceptance must not receive the Docker socket."
  }

  $status = @(& docker exec $KnowledgeContainerId sh -c "grep -E '^(CapEff|NoNewPrivs):' /proc/1/status")
  if (($status -join "`n") -notmatch 'CapEff:\s+0{16}' -or ($status -join "`n") -notmatch 'NoNewPrivs:\s+1') {
    throw "Knowledge runtime capability/no-new-privileges proof failed."
  }
  & docker exec $KnowledgeContainerId python -c "from pathlib import Path; p=Path('/app/.t5-rootfs-probe');`ntry: p.write_text('x')`nexcept OSError: raise SystemExit(0)`nraise SystemExit(1)"
  if ($LASTEXITCODE -ne 0) { throw "Knowledge root filesystem is writable." }
}

function Assert-T5ReadOnlyMount {
  param([string]$ContainerId, [string]$RunId)

  $mounts = @(& docker inspect --format "{{json .Mounts}}" $ContainerId | ConvertFrom-Json)
  $vaultMount = @($mounts | Where-Object { $_.Destination -eq "/vault" })
  if ($vaultMount.Count -ne 1 -or $vaultMount[0].RW) { throw "Knowledge Vault mount is not read-only." }
  $probe = "/vault/.knowledge-t5-write-probe-$RunId"
  $python = "from pathlib import Path; import errno, sys; p=Path('$probe');`ntry:`n p.write_bytes(b'probe')`nexcept OSError as e:`n if e.errno != errno.EROFS: raise SystemExit('unexpected errno: %s' % e.errno)`nelse:`n raise SystemExit('write unexpectedly succeeded')"
  & docker exec $ContainerId python -c $python
  if ($LASTEXITCODE -ne 0) { throw "Kernel-level read-only write probe did not return EROFS." }
  & docker exec $ContainerId python -c "from pathlib import Path; import sys; sys.exit(1 if Path('$probe').exists() else 0)"
  if ($LASTEXITCODE -ne 0) { throw "Read-only write probe unexpectedly exists." }
}

function Remove-T5TemporaryResources {
  param([string]$RunId)

  $filters = @("--filter", "label=com.personal-tool.acceptance=t5", "--filter", "label=com.personal-tool.acceptance-run=$RunId", "--filter", "label=com.personal-tool.persistence=temporary")
  $containers = @(& docker ps -aq @filters | Where-Object { $_ })
  if ($containers.Count -gt 0) { & docker rm -f @containers | Out-Null }
  $networks = @(& docker network ls -q @filters | Where-Object { $_ })
  if ($networks.Count -gt 0) { & docker network rm @networks | Out-Null }
  $volumes = @(& docker volume ls -q @filters | Where-Object { $_ })
  if ($volumes.Count -gt 0) { & docker volume rm @volumes | Out-Null }
  $remaining = @(& docker ps -aq @filters) + @(& docker network ls -q @filters) + @(& docker volume ls -q @filters)
  if (@($remaining | Where-Object { $_ }).Count -gt 0) { throw "Temporary T5 resources remain after cleanup." }
}
