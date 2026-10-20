[CmdletBinding()]
param(
  [string]$EnvironmentFile = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectName = "personal-tool-m3-t4"
$scriptDirectory = Split-Path -Parent $PSCommandPath
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $scriptDirectory "..\env\.env" }
$dockerDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $dockerDirectory "compose\compose.m3-t4.acceptance.yml"
$fixtureRoot = Join-Path $repositoryRoot "apps\knowledge\tests\fixtures\vault"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t4-$([guid]::NewGuid().ToString('N'))"
$vaultRoot = Join-Path $temporaryRoot "vault"
$script:nginxPort = 0
# F-267 (R7-D13-04): the documented Knowledge memory ceiling and the fraction
# of it the acceptance gate allows the cgroup peak to reach. The gate reads
# the limit the container was actually given and fails when that limit is not
# the documented one, so a lowered limit cannot make the gate lenient while
# the run still reports PASS. The sibling t5 harness asserts the same ceiling
# (knowledge-t5-common.ps1: HostConfig.Memory == 4294967296).
$knowledgeMemoryLimitBytes = 4294967296
$knowledgeMemoryLimitFraction = 0.8

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose --project-name $projectName --env-file $EnvironmentFile -f $composeFile -f $acceptanceComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed with exit code $LASTEXITCODE." }
}

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Body = "")
  $responsePath = Join-Path $temporaryRoot "response-$([guid]::NewGuid().ToString('N')).json"
  $requestPath = Join-Path $temporaryRoot "request-$([guid]::NewGuid().ToString('N')).json"
  try {
    $arguments = @("--silent", "--show-error", "--max-time", "90", "--output", $responsePath, "--write-out", "%{http_code}", "--request", $Method)
    if ($Body) {
      [IO.File]::WriteAllText($requestPath, $Body, [Text.UTF8Encoding]::new($false))
      $arguments += @("--header", "Content-Type: application/json", "--data-binary", "@$requestPath")
    }
    $arguments += "http://127.0.0.1:$script:nginxPort/knowledge$Path"
    $statusCode = & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed for $Path." }
    return [pscustomobject]@{ StatusCode = [int]$statusCode; Body = Get-Content -LiteralPath $responsePath -Raw -Encoding utf8 }
  }
  finally {
    Remove-Item -LiteralPath $responsePath, $requestPath -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-Postgres {
  param([string]$Command)
  Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--quiet", "--tuples-only", "--no-align", "--command", $Command)
}

function Assert-HnswCapability {
  param([string]$IndexId)
  $vector = "[1," + (("0," * 1022) + "0]")
  $indexState = (Invoke-Postgres "SELECT index_class.relname || ':' || index_state.indisvalid || ':' || access_method.amname || ':' || pg_get_indexdef(index_class.oid) FROM pg_class AS index_class JOIN pg_namespace AS namespace ON namespace.oid = index_class.relnamespace JOIN pg_index AS index_state ON index_state.indexrelid = index_class.oid JOIN pg_am AS access_method ON access_method.oid = index_class.relam WHERE namespace.nspname = 'knowledge' AND index_class.relname = 'knowledge_segments_embedding_hnsw_idx';" -join "`n").Trim()
  if ($indexState -notmatch '^knowledge_segments_embedding_hnsw_idx:(true|t):hnsw:.*vector_cosine_ops') {
    throw "Knowledge HNSW index is missing, invalid or has the wrong operator class: $indexState"
  }
  $query = @"
BEGIN;
-- This is a focused capability check only.  It proves that the installed
-- HNSW KNN vector path is usable; it is not production-planner evidence.
-- Production may legitimately select a filter index plus sort instead.
SET LOCAL enable_seqscan = off;
SET LOCAL hnsw.iterative_scan = strict_order;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.max_scan_tuples = 20000;
SET LOCAL hnsw.scan_mem_multiplier = 1;
EXPLAIN (ANALYZE, SETTINGS, FORMAT JSON)
WITH ann AS MATERIALIZED (
  SELECT id, embedding <=> '$vector'::vector AS dense_distance
  FROM knowledge.segments
  ORDER BY embedding <=> '$vector'::vector ASC
  LIMIT 40
)
SELECT id FROM ann ORDER BY dense_distance ASC, id ASC;
COMMIT;
"@
  $raw = Invoke-Postgres $query
  $json = (($raw -join "`n").Trim())
  $start = $json.IndexOf("[")
  $end = $json.LastIndexOf("]")
  if ($start -lt 0 -or $end -lt $start) { throw "HNSW EXPLAIN did not return JSON." }
  $plan = $json.Substring($start, $end - $start + 1) | ConvertFrom-Json
  $rendered = $plan | ConvertTo-Json -Depth 100
  if ($rendered -notmatch 'knowledge_segments_embedding_hnsw_idx') {
    throw "Knowledge HNSW capability path did not use knowledge_segments_embedding_hnsw_idx."
  }
}

function Assert-KnowledgeMemory {
  $containerId = (Invoke-Compose @("ps", "-q", "knowledge")).Trim()
  if (-not $containerId) { throw "Knowledge container id is unavailable." }
  $memoryLimit = [int64]((& docker inspect --format "{{.HostConfig.Memory}}" $containerId | Select-Object -First 1).Trim())
  if ($memoryLimit -ne $knowledgeMemoryLimitBytes) {
    throw "Knowledge container memory limit is $memoryLimit bytes; the documented ceiling is $knowledgeMemoryLimitBytes bytes."
  }
  & docker exec $containerId test -f /sys/fs/cgroup/memory.peak | Out-Null
  if ($LASTEXITCODE -eq 0) {
    $peakOutput = @(& docker exec $containerId cat /sys/fs/cgroup/memory.peak)
    if ($LASTEXITCODE -ne 0 -or $peakOutput.Count -eq 0) { throw "Knowledge cgroup v2 peak is unavailable." }
    $events = @(& docker exec $containerId cat /sys/fs/cgroup/memory.events)
    if ($LASTEXITCODE -ne 0) { throw "Knowledge cgroup v2 OOM counters are unavailable." }
    if (($events -match '^oom [1-9][0-9]*$').Count -gt 0 -or ($events -match '^oom_kill [1-9][0-9]*$').Count -gt 0) {
      throw "Knowledge cgroup reported an OOM event."
    }
  }
  else {
    $peakOutput = @(& docker exec $containerId cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes)
    if ($LASTEXITCODE -ne 0 -or $peakOutput.Count -eq 0) { throw "Knowledge cgroup v1 peak is unavailable." }
    $failCountOutput = @(& docker exec $containerId cat /sys/fs/cgroup/memory/memory.failcnt)
    if ($LASTEXITCODE -ne 0 -or $failCountOutput.Count -eq 0) { throw "Knowledge cgroup v1 failure counter is unavailable." }
    $oomControl = @(& docker exec $containerId cat /sys/fs/cgroup/memory/memory.oom_control)
    if ($LASTEXITCODE -ne 0) { throw "Knowledge cgroup v1 OOM counters are unavailable." }
    if ([int64](($failCountOutput -join "").Trim()) -gt 0 -or ($oomControl -match '^oom_kill [1-9][0-9]*$').Count -gt 0) {
      throw "Knowledge cgroup reported an OOM event."
    }
  }
  $peak = [int64](($peakOutput -join "").Trim())
  $peakCeiling = [int64][Math]::Ceiling($memoryLimit * $knowledgeMemoryLimitFraction)
  if ($peak -ge $peakCeiling) { throw "Knowledge cgroup peak memory exceeded 80% of its $memoryLimit byte ceiling: $peak bytes." }
}

function Wait-Run {
  param([string]$RunId)
  for ($attempt = 0; $attempt -lt 600; $attempt++) {
    $run = Invoke-Api "GET" "/v1/index-runs/$RunId"
    if ($run.StatusCode -eq 200) {
      $payload = $run.Body | ConvertFrom-Json
      if ($payload.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $payload }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Index run $RunId did not reach a terminal state."
}

function New-SyntheticPdf {
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
  $bytes.AddRange($encoding.GetBytes("%PDF-1.4`n% synthetic fixture`n"))
  $offsets = [Collections.Generic.List[int]]::new()
  foreach ($object in $objects) {
    $offsets.Add($bytes.Count)
    $bytes.AddRange($encoding.GetBytes($object))
  }
  $xrefOffset = $bytes.Count
  $xref = "xref`n0 6`n0000000000 65535 f `n" + (($offsets | ForEach-Object { "{0:D10} 00000 n `n" -f $_ }) -join "") + "trailer`n<< /Size 6 /Root 1 0 R >>`nstartxref`n$xrefOffset`n%%EOF`n"
  $bytes.AddRange($encoding.GetBytes($xref))
  [IO.File]::WriteAllBytes($Path, $bytes.ToArray())
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing: $EnvironmentFile" }
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
Copy-Item -LiteralPath $fixtureRoot -Destination $vaultRoot -Recurse
$pdfDirectory = Join-Path $vaultRoot "02. Books\T4"
New-Item -ItemType Directory -Path $pdfDirectory -Force | Out-Null
$unicodeD = [char]0x0111
$pdfName = "My 50% ($unicodeD).pdf"
$pdfPath = Join-Path $pdfDirectory $pdfName
$sidecarPath = Join-Path $pdfDirectory "acceptance.md"
New-SyntheticPdf -Path $pdfPath -Text "PDF retrieval acceptance text"
[IO.File]::WriteAllText(
  $sidecarPath,
  "---`nzink_source: pdf`n---`n`n# PDF retrieval title`n`n![[02. Books/T4/$pdfName]]`n`n#supplychain #english`n",
  [Text.UTF8Encoding]::new($false)
)
$beforeHash = (Get-FileHash -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Algorithm SHA256).Hash
$beforePdfHash = (Get-FileHash -LiteralPath $pdfPath -Algorithm SHA256).Hash
$beforeSidecarHash = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash
$env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT = $vaultRoot
$started = $false

try {
  Invoke-Compose @("build", "knowledge")
  $started = $true
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "300", "knowledge", "nginx")
  $nginxAddress = (Invoke-Compose @("port", "nginx", "8080") | Select-Object -Last 1).Trim()
  if ($nginxAddress -notmatch '^127\.0\.0\.1:(\d+)$') { throw "Acceptance Nginx did not receive a loopback port." }
  $script:nginxPort = [int]$Matches[1]
  $mounts = @(& docker inspect --format "{{json .Mounts}}" "${projectName}-knowledge-1" | ConvertFrom-Json)
  $mount = @($mounts | Where-Object { $_.Destination -eq "/vault" })
  if ($mount.Count -ne 1 -or $mount[0].RW) { throw "M3/T4 Vault mount is not read-only." }

  $accepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.StatusCode -ne 202) { throw "Full rebuild was not accepted: $($accepted.Body)" }
  $run = Wait-Run (($accepted.Body | ConvertFrom-Json).index_run_id)
  if ($run.status -ne "SUCCEEDED" -or $run.sources_indexed -ne 2) { throw "Combined fixture rebuild failed." }
  if (($run.source_counts | ForEach-Object { "$($_.source_type):$($_.discovered_count):$($_.indexed_count):$($_.failed_count)" }) -join "," -cne "MARKDOWN:1:1:0,PDF:1:1:0") { throw "Combined source counters are not exact or canonical." }

  $first = Invoke-Api "POST" "/v1/search" '{"query":"What is safety stock?","limit":10,"primary_topic":"Supply Chain","tags_all":["inventory"],"path_prefix":"01. Knowledge/Supply Chain"}'
  if ($first.StatusCode -ne 200) { throw "Search failed: $($first.Body)" }
  $second = Invoke-Api "POST" "/v1/search" '{"query":"What is safety stock?","limit":10,"primary_topic":"Supply Chain","tags_all":["inventory"],"path_prefix":"01. Knowledge/Supply Chain"}'
  $firstIds = @(($first.Body | ConvertFrom-Json).results | ForEach-Object segment_id)
  $secondIds = @(($second.Body | ConvertFrom-Json).results | ForEach-Object segment_id)
  if ($firstIds.Count -eq 0 -or (($firstIds -join "`n") -cne ($secondIds -join "`n"))) { throw "Search ordering is not deterministic." }
  $citation = (($first.Body | ConvertFrom-Json).results[0].citation)
  if ($citation.line_start -lt 1 -or $citation.line_end -lt $citation.line_start -or $null -ne $citation.page_start -or $null -ne $citation.page_end -or $null -ne $citation.bbox -or $citation.markdown -notmatch "\(lines ") { throw "Citation does not preserve additive Markdown compatibility." }

  $pdfOnly = Invoke-Api "POST" "/v1/search" '{"query":"PDF retrieval acceptance text","source_types":["PDF","PDF"]}'
  if ($pdfOnly.StatusCode -ne 200) { throw "PDF-only retrieval failed: $($pdfOnly.Body)" }
  $pdfResults = @(($pdfOnly.Body | ConvertFrom-Json).results)
  if ($pdfResults.Count -lt 1 -or @($pdfResults | Where-Object source_type -ne "PDF").Count -ne 0) { throw "PDF source filtering failed closed." }
  $pdfCitation = $pdfResults[0].citation
  if ($pdfCitation.line_start -ne $null -or $pdfCitation.line_end -ne $null -or $pdfCitation.page_start -ne 1 -or $pdfCitation.page_end -ne 1) { throw "PDF citation page metadata is invalid." }
  if ($pdfCitation.markdown -notmatch 'My%2050%25%20%28%C4%91%29\.pdf#page=1' -or $pdfCitation.markdown -notmatch '\(pages 1\)') { throw "PDF citation URL encoding or fragment composition is invalid." }
  if ($null -ne $pdfCitation.bbox -and @($pdfCitation.bbox).Count -ne 4) { throw "PDF citation bbox is invalid." }

  $markdownOnly = Invoke-Api "POST" "/v1/search" '{"query":"safety stock","source_types":["MARKDOWN"]}'
  if ($markdownOnly.StatusCode -ne 200 -or @((($markdownOnly.Body | ConvertFrom-Json).results) | Where-Object source_type -ne "MARKDOWN").Count -ne 0) { throw "Markdown source filtering regressed." }
  if ((Invoke-Api "POST" "/v1/search" '{"query":"x","source_types":[]}').StatusCode -ne 422) { throw "Empty source_types was not rejected." }
  if ((Invoke-Api "POST" "/v1/search" '{"query":"x","source_types":["UNKNOWN"]}').StatusCode -ne 422) { throw "Unknown source_types was not rejected." }
  Assert-KnowledgeMemory

  $activeIndexId = $run.index_id
  $syntheticSql = @"
WITH source AS (
  SELECT id, source_path, title, primary_topic, canonical_topics, tags, indexed_by_run_id
  FROM knowledge.sources WHERE index_id = '$activeIndexId'::uuid ORDER BY source_path LIMIT 1
)
INSERT INTO knowledge.segments
  (id, index_id, source_id, segment_type, chunk_ordinal, source_path, title,
   primary_topic, canonical_topics, tags, heading_path, heading_text, text,
   line_start, line_end, embedding, indexed_by_run_id)
SELECT
  ('a0000000-0000-0000-0000-' || lpad(candidate::text, 12, '0'))::uuid,
  '$activeIndexId'::uuid, source.id, 'MARKDOWN_PASSAGE', 100000 + candidate,
  source.source_path, source.title, source.primary_topic, source.canonical_topics,
  source.tags, ARRAY['Synthetic HNSW fixture'], 'Synthetic HNSW fixture',
  'Synthetic retrieval fixture ' || candidate, 1, 1,
  ('[' || array_to_string(array_fill((CASE WHEN candidate = 1 THEN 1.0 ELSE 0.001 END)::real, ARRAY[1024]), ',') || ']')::vector,
  source.indexed_by_run_id
FROM source CROSS JOIN generate_series(1, 1000) AS series(candidate);
ANALYZE knowledge.segments;
"@
  Invoke-Postgres $syntheticSql | Out-Null
  Assert-HnswCapability $activeIndexId

  $afterHash = (Get-FileHash -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Algorithm SHA256).Hash
  $afterPdfHash = (Get-FileHash -LiteralPath $pdfPath -Algorithm SHA256).Hash
  $afterSidecarHash = (Get-FileHash -LiteralPath $sidecarPath -Algorithm SHA256).Hash
  if ($beforeHash -ne $afterHash -or $beforePdfHash -ne $afterPdfHash -or $beforeSidecarHash -ne $afterSidecarHash) { throw "M3/T4 wrote to the Vault." }
  Write-Output "M3/T4 hybrid retrieval acceptance passed."
}
finally {
  if ($started) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { Invoke-Compose @("down", "--volumes", "--remove-orphans") } finally { $ErrorActionPreference = $previous }
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item Env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT -ErrorAction SilentlyContinue
}
