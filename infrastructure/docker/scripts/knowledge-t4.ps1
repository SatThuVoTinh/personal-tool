[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env")
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectName = "personal-tool-m3-t4"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $dockerDirectory "compose\compose.m3-t4.acceptance.yml"
$fixtureRoot = Join-Path $repositoryRoot "apps\knowledge\tests\fixtures\vault"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t4-$([guid]::NewGuid().ToString('N'))"
$vaultRoot = Join-Path $temporaryRoot "vault"

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
    $arguments += "http://127.0.0.1:8080/knowledge$Path"
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

function Assert-HnswPlan {
  param([string]$IndexId)
  $vector = "[1," + (("0," * 1022) + "0]")
  $query = @"
BEGIN;
SET LOCAL hnsw.iterative_scan = strict_order;
SET LOCAL hnsw.ef_search = 100;
SET LOCAL hnsw.max_scan_tuples = 20000;
SET LOCAL hnsw.scan_mem_multiplier = 1;
EXPLAIN (ANALYZE, SETTINGS, FORMAT JSON)
WITH ann AS MATERIALIZED (
  SELECT id, embedding <=> '$vector'::vector AS dense_distance
  FROM knowledge.segments
  WHERE index_id = '$IndexId'::uuid
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
    throw "Production dense query shape did not use knowledge_segments_embedding_hnsw_idx."
  }
}

function Assert-KnowledgeMemory {
  $containerId = (Invoke-Compose @("ps", "-q", "knowledge")).Trim()
  if (-not $containerId) { throw "Knowledge container id is unavailable." }
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
  if ($peak -ge 3435973837) { throw "Knowledge cgroup peak memory exceeded 80% of its 4 GiB ceiling: $peak bytes." }
}

function Wait-Run {
  param([string]$RunId)
  for ($attempt = 0; $attempt -lt 180; $attempt++) {
    $run = Invoke-Api "GET" "/v1/index-runs/$RunId"
    if ($run.StatusCode -eq 200) {
      $payload = $run.Body | ConvertFrom-Json
      if ($payload.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $payload }
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Index run $RunId did not reach a terminal state."
}

if (-not (Test-Path -LiteralPath $EnvironmentFile -PathType Leaf)) { throw "Runtime environment file is missing: $EnvironmentFile" }
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
Copy-Item -LiteralPath $fixtureRoot -Destination $vaultRoot -Recurse
$beforeHash = (Get-FileHash -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Algorithm SHA256).Hash
$env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT = $vaultRoot
$started = $false

try {
  Invoke-Compose @("build", "knowledge")
  $started = $true
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "300", "knowledge", "nginx")
  $mounts = @(& docker inspect --format "{{json .Mounts}}" "${projectName}-knowledge-1" | ConvertFrom-Json)
  $mount = @($mounts | Where-Object { $_.Destination -eq "/vault" })
  if ($mount.Count -ne 1 -or $mount[0].RW) { throw "M3/T4 Vault mount is not read-only." }

  $accepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.StatusCode -ne 202) { throw "Full rebuild was not accepted: $($accepted.Body)" }
  $run = Wait-Run (($accepted.Body | ConvertFrom-Json).index_run_id)
  if ($run.status -ne "SUCCEEDED") { throw "Fixture rebuild failed." }

  $first = Invoke-Api "POST" "/v1/search" '{"query":"What is safety stock?","limit":10,"primary_topic":"Supply Chain","tags_all":["inventory"],"path_prefix":"01. Knowledge/Supply Chain"}'
  if ($first.StatusCode -ne 200) { throw "Search failed: $($first.Body)" }
  $second = Invoke-Api "POST" "/v1/search" '{"query":"What is safety stock?","limit":10,"primary_topic":"Supply Chain","tags_all":["inventory"],"path_prefix":"01. Knowledge/Supply Chain"}'
  $firstIds = @(($first.Body | ConvertFrom-Json).results | ForEach-Object segment_id)
  $secondIds = @(($second.Body | ConvertFrom-Json).results | ForEach-Object segment_id)
  if ($firstIds.Count -eq 0 -or (($firstIds -join "`n") -cne ($secondIds -join "`n"))) { throw "Search ordering is not deterministic." }
  $citation = (($first.Body | ConvertFrom-Json).results[0].citation)
  if ($citation.line_start -lt 1 -or $citation.line_end -lt $citation.line_start -or $citation.markdown -notmatch "\(lines ") { throw "Citation does not preserve Markdown source lines." }
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
  '$activeIndexId'::uuid, source.id, 'MARKDOWN', 100000 + candidate,
  source.source_path, source.title, source.primary_topic, source.canonical_topics,
  source.tags, ARRAY['Synthetic HNSW fixture'], 'Synthetic HNSW fixture',
  'Synthetic retrieval fixture ' || candidate, 1, 1,
  ('[' || array_to_string(array_fill((CASE WHEN candidate = 1 THEN 1.0 ELSE 0.001 END)::real, ARRAY[1024]), ',') || ']')::vector,
  source.indexed_by_run_id
FROM source CROSS JOIN generate_series(1, 10000) AS series(candidate);
ANALYZE knowledge.segments;
"@
  Invoke-Postgres $syntheticSql | Out-Null
  Assert-HnswPlan $activeIndexId

  $afterHash = (Get-FileHash -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Algorithm SHA256).Hash
  if ($beforeHash -ne $afterHash) { throw "M3/T4 wrote to the Vault." }
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
