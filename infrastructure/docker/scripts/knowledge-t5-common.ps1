Set-StrictMode -Version Latest

$script:T5RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$script:T5DockerDirectory = Split-Path -Parent $PSScriptRoot
$script:T5EvidenceDirectory = Join-Path $script:T5RepositoryRoot "temp\knowledge-t5\evidence"
$script:T5CandidatePathspecs = @(
  "apps/knowledge",
  "infrastructure/docker/compose",
  "infrastructure/docker/scripts",
  "tests",
  "docs/runbooks"
)

if (-not ("PersonalTool.T5ReparsePoint" -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace PersonalTool {
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

function Assert-T5CleanRepository {
  $changes = @(git status --porcelain)
  if ($LASTEXITCODE -ne 0 -or $changes.Count -ne 0) {
    throw "M3/T5 acceptance requires a clean working tree."
  }
}

function Get-T5RepositorySha {
  $sha = (git rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') {
    throw "Unable to resolve the current repository SHA."
  }
  return $sha
}

function Get-T5CandidateSourceDigest {
  $paths = @(git ls-files -- @script:T5CandidatePathspecs | Sort-Object)
  if ($LASTEXITCODE -ne 0 -or $paths.Count -eq 0) {
    throw "Unable to enumerate M3/T5 candidate files."
  }
  $lines = foreach ($relativePath in $paths) {
    $absolutePath = Join-Path $script:T5RepositoryRoot $relativePath
    if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
      throw "Candidate file is missing: $relativePath"
    }
    $hash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $length = (Get-Item -LiteralPath $absolutePath).Length
    "{0}|{1}|{2}" -f ($relativePath.Replace("\", "/")), $length, $hash
  }
  return (Get-T5Sha256Text (($lines -join "`n") + "`n"))
}

function Get-T5Sha256Text {
  param([string]$Text)

  $bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $sha256.Dispose()
  }
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

function Assert-T5ExpectedSourcePath {
  param([string]$CanonicalVaultRoot, [string]$ExpectedSourcePath)

  if ([IO.Path]::IsPathRooted($ExpectedSourcePath) -or $ExpectedSourcePath.Contains('\') -or
    $ExpectedSourcePath.StartsWith('/') -or -not $ExpectedSourcePath.EndsWith('.md', [StringComparison]::Ordinal) -or
    $ExpectedSourcePath -notmatch '^01\. Knowledge/[A-Za-z0-9._ -]+(?:/[A-Za-z0-9._ -]+)*\.md$') {
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
  if ($migrations.Count -ne 1 -or $migrations[0]["name"] -ne "001_initial.sql") {
    throw "M3/T5 expects exactly migration 001_initial.sql."
  }
  return @($migrations)
}

function Get-T5ModelIdentity {
  param([string]$ModelName = "bge-m3:latest")

  $model = @((Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get).models | Where-Object { $_.name -eq $ModelName }) | Select-Object -First 1
  if (-not $model -or -not $model.digest) { throw "Embedding model $ModelName is unavailable." }
  $embedding = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/embed" -Method Post -ContentType "application/json" -Body "{`"model`":`"$ModelName`",`"input`":`"knowledge-t5-identity`"}"
  if (-not $embedding.embeddings -or $embedding.embeddings[0].Length -ne 1024) { throw "Embedding model identity has the wrong dimension." }
  return [ordered]@{ name = $ModelName; digest = $model.digest; dimension = 1024 }
}

function Get-T5Candidate {
  param([string]$ModelName = "bge-m3:latest")

  Assert-T5CleanRepository
  $repositorySha = Get-T5RepositorySha
  $image = Get-T5ImageIdentity
  if ($image.revision -ne $repositorySha) {
    throw "Knowledge image provenance does not match the clean repository HEAD."
  }
  $candidate = [ordered]@{
    repository_sha = $repositorySha
    candidate_source_digest = Get-T5CandidateSourceDigest
    image = $image
    embedding = Get-T5ModelIdentity $ModelName
    migrations = Get-T5MigrationIdentity
    knowledge_memory_limit_bytes = 4294967296
    vault_target = "/vault"
    vault_read_only = $true
  }
  $candidate.candidate_fingerprint = Get-T5Sha256Text ($candidate | ConvertTo-Json -Depth 10 -Compress)
  return $candidate
}

function Get-T5DeploymentFingerprint {
  param([string]$ProjectName, [string]$Persistence)

  $deployment = [ordered]@{ project = $ProjectName; persistence = $Persistence }
  $deployment.fingerprint = Get-T5Sha256Text ($deployment | ConvertTo-Json -Compress)
  return $deployment
}

function Write-T5Evidence {
  param([string]$Prefix, [string]$RunId, [System.Collections.IDictionary]$Evidence)

  New-Item -ItemType Directory -Path $script:T5EvidenceDirectory -Force | Out-Null
  $path = Join-Path $script:T5EvidenceDirectory "$Prefix-$RunId.json"
  Write-T5AtomicJson $path $Evidence
  return $path
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
  param([string]$KnowledgeContainerId, [string]$NginxContainerId)

  $knowledgePorts = (& docker inspect --format "{{json .HostConfig.PortBindings}}" $KnowledgeContainerId).Trim()
  if ($knowledgePorts -notin @('null', '{}', '')) { throw "Knowledge must not publish host ports." }
  $nginx = @(& docker inspect $NginxContainerId | ConvertFrom-Json)[0]
  $bindings = @($nginx.HostConfig.PortBindings.'8080/tcp')
  if ($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1' -or $bindings[0].HostPort -ne '8080') {
    throw "Nginx must bind exactly 127.0.0.1:8080."
  }
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
