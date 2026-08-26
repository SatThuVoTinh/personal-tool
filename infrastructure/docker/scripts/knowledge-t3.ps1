[CmdletBinding()]
param(
  [string]$EnvironmentFile = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $scriptDirectory "..\env\.env" }
$projectName = "personal-tool-m3-t3"
$dockerDirectory = Split-Path -Parent $scriptDirectory
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$acceptanceComposeFile = Join-Path $dockerDirectory "compose\compose.m3-t3.acceptance.yml"
$fixtureRoot = Join-Path $repositoryRoot "apps\knowledge\tests\fixtures\vault"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t3-$([guid]::NewGuid().ToString('N'))"
$vaultRoot = Join-Path $temporaryRoot "vault"
$script:nginxPort = 0
$priorEmbeddingModel = $env:KNOWLEDGE_EMBEDDING_MODEL

function Invoke-Compose {
  param([string[]]$Arguments)
  & docker compose --project-name $projectName --env-file $EnvironmentFile -f $composeFile -f $acceptanceComposeFile @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker Compose command failed with exit code $LASTEXITCODE." }
}

function Invoke-Api {
  param([string]$Method, [string]$Path, [string]$Body = "")
  $bodyPath = Join-Path $temporaryRoot "response-$([guid]::NewGuid().ToString('N')).json"
  $requestBodyPath = Join-Path $temporaryRoot "request-$([guid]::NewGuid().ToString('N')).json"
  try {
    $arguments = @("--silent", "--show-error", "--max-time", "30", "--output", $bodyPath, "--write-out", "%{http_code}", "--request", $Method)
    if ($Body) {
      [IO.File]::WriteAllText($requestBodyPath, $Body, [Text.UTF8Encoding]::new($false))
      $arguments += @("--header", "Content-Type: application/json", "--data-binary", "@$requestBodyPath")
    }
    $arguments += "http://127.0.0.1:$script:nginxPort/knowledge$Path"
    $statusCode = & curl.exe @arguments
    if ($LASTEXITCODE -ne 0) { throw "HTTP request failed for $Path." }
    return [pscustomobject]@{ StatusCode = [int]$statusCode; Body = Get-Content -LiteralPath $bodyPath -Raw -Encoding utf8 }
  }
  finally {
    if (Test-Path -LiteralPath $bodyPath) { Remove-Item -LiteralPath $bodyPath -Force }
    if (Test-Path -LiteralPath $requestBodyPath) { Remove-Item -LiteralPath $requestBodyPath -Force }
  }
}

function Wait-Run {
  param([string]$RunId)
  for ($attempt = 0; $attempt -lt 240; $attempt++) {
    $response = Invoke-Api "GET" "/v1/index-runs/$RunId"
    if ($response.StatusCode -ne 200) { throw "Index run $RunId cannot be read." }
    $run = $response.Body | ConvertFrom-Json
    if ($run.status -in @("SUCCEEDED", "FAILED", "INTERRUPTED")) { return $run }
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
  $header = $encoding.GetBytes("%PDF-1.4`n% synthetic fixture`n")
  $bytes.AddRange($header)
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
$pdfDirectory = Join-Path $vaultRoot "02. Books\T3"
New-Item -ItemType Directory -Path $pdfDirectory -Force | Out-Null
$pdfPath = Join-Path $pdfDirectory "acceptance.pdf"
New-SyntheticPdf -Path $pdfPath -Text "PDF acceptance text"
[IO.File]::WriteAllText(
  (Join-Path $pdfDirectory "acceptance.md"),
  "---`nzink_source: pdf`n---`n`n# PDF acceptance`n`n![[02. Books/T3/acceptance.pdf]]`n`n#supplychain #english`n",
  [Text.UTF8Encoding]::new($false)
)
$env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT = $vaultRoot
$env:KNOWLEDGE_EMBEDDING_MODEL = "bge-m3:latest"
$started = $false

try {
  Invoke-Compose @("build", "knowledge")
  $started = $true
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "240", "knowledge", "nginx")
  $nginxAddress = (Invoke-Compose @("port", "nginx", "8080") | Select-Object -Last 1).Trim()
  if ($nginxAddress -notmatch '^127\.0\.0\.1:(\d+)$') { throw "Acceptance Nginx did not receive a loopback port." }
  $script:nginxPort = [int]$Matches[1]

  $mounts = & docker inspect --format "{{json .Mounts}}" "${projectName}-knowledge-1" | ConvertFrom-Json
  $vaultMount = @($mounts | Where-Object { $_.Destination -eq "/vault" })
  if ($vaultMount.Count -ne 1 -or $vaultMount[0].RW -ne $false) { throw "M3/T3 Vault mount is not read-only." }

  $accepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"FULL_REBUILD"}'
  if ($accepted.StatusCode -ne 202) { throw "Full rebuild was not accepted: HTTP $($accepted.StatusCode) $($accepted.Body)" }
  $acceptedBody = $accepted.Body | ConvertFrom-Json
  $immediate = Invoke-Api "GET" "/v1/index-runs/$($acceptedBody.index_run_id)"
  if ($immediate.StatusCode -ne 200) { throw "Accepted run was not immediately visible: HTTP $($immediate.StatusCode) $($immediate.Body)" }
  $fullRun = Wait-Run $acceptedBody.index_run_id
  if ($fullRun.status -ne "SUCCEEDED" -or $fullRun.sources_indexed -ne 2) { throw "Full rebuild did not publish the combined fixture index." }

  $pdfPublication = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT (SELECT count(*) FROM knowledge.sources WHERE index_id = '$($fullRun.index_id)' AND source_type = 'PDF') || ':' || (SELECT count(*) FROM knowledge.pdf_source_details WHERE index_id = '$($fullRun.index_id)') || ':' || (SELECT count(*) FROM knowledge.segments WHERE index_id = '$($fullRun.index_id)' AND segment_type LIKE 'PDF_%');")
  if (($pdfPublication -join "").Trim() -notmatch '^1:1:[1-9][0-9]*$') { throw "PDF publication did not atomically create source, detail and segments." }
  $sourceCounts = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT string_agg(source_type || ':' || discovered_count || ':' || indexed_count || ':' || failed_count, ',' ORDER BY CASE source_type WHEN 'MARKDOWN' THEN 1 WHEN 'PDF' THEN 2 END) FROM knowledge.index_run_source_counts WHERE index_run_id = '$($fullRun.index_run_id)';")
  if (($sourceCounts -join "").Trim() -ne "MARKDOWN:1:1:0,PDF:1:1:0") { throw "Full rebuild source counters were not exact and canonical." }
  if (($fullRun.source_counts | ForEach-Object { "$($_.source_type):$($_.discovered_count):$($_.indexed_count):$($_.failed_count)" }) -join "," -cne "MARKDOWN:1:1:0,PDF:1:1:0") { throw "API source counters were not exact and canonical." }

  $pdfSearch = Invoke-Api "POST" "/v1/search" '{"query":"PDF acceptance text","source_types":["PDF"]}'
  if ($pdfSearch.StatusCode -ne 200) { throw "PDF-only retrieval did not succeed." }
  $pdfResult = $pdfSearch.Body | ConvertFrom-Json
  if ($pdfResult.results.Count -lt 1 -or $pdfResult.results[0].source_type -ne "PDF" -or $null -eq $pdfResult.results[0].citation.page_start -or $null -ne $pdfResult.results[0].citation.line_start) { throw "PDF retrieval fields did not satisfy the additive API contract." }
  $markdownSearch = Invoke-Api "POST" "/v1/search" '{"query":"safety stock","source_types":["MARKDOWN"]}'
  if ($markdownSearch.StatusCode -ne 200) { throw "Markdown-only retrieval regressed." }

  $incrementalAccepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"INCREMENTAL"}'
  if ($incrementalAccepted.StatusCode -ne 202) { throw "Unchanged incremental run was not accepted." }
  $incrementalRun = Wait-Run (($incrementalAccepted.Body | ConvertFrom-Json).index_run_id)
  if ($incrementalRun.status -ne "SUCCEEDED" -or $incrementalRun.sources_indexed -ne 0) { throw "Unchanged source was re-indexed." }

  Remove-Item -LiteralPath (Join-Path $vaultRoot "01. Knowledge\Supply Chain\safety-stock.md") -Force
  Remove-Item -LiteralPath $pdfPath -Force
  Remove-Item -LiteralPath (Join-Path $pdfDirectory "acceptance.md") -Force
  $emptyAccepted = Invoke-Api "POST" "/v1/index-runs" '{"kind":"INCREMENTAL"}'
  if ($emptyAccepted.StatusCode -ne 202) { throw "Empty incremental run was not accepted asynchronously." }
  $emptyRun = Wait-Run (($emptyAccepted.Body | ConvertFrom-Json).index_run_id)
  if ($emptyRun.status -ne "FAILED" -or $emptyRun.failure_code -ne "EMPTY_SNAPSHOT_DELETION_BLOCKED") { throw "Empty snapshot guard did not protect the active index." }

  $sourceCount = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT count(*) FROM knowledge.sources WHERE index_id = '$($fullRun.index_id)';")
  if (($sourceCount -join "").Trim() -ne "2") { throw "Empty snapshot guard deleted indexed sources." }

  $orphanIndexId = [guid]::NewGuid().ToString()
  $orphanRunId = [guid]::NewGuid().ToString()
  $model = (Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get).models | Where-Object { $_.name -eq "bge-m3:latest" } | Select-Object -First 1
  $recoverySql = @"
INSERT INTO knowledge.indexes (id, status, embedding_model_name, embedding_model_digest, embedding_dimensions)
VALUES ('$orphanIndexId', 'BUILDING', 'bge-m3:latest', '$($model.digest)', 1024);
INSERT INTO knowledge.index_runs (id, index_id, kind, status)
VALUES ('$orphanRunId', '$orphanIndexId', 'FULL_REBUILD', 'RUNNING');
"@
  Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--set=ON_ERROR_STOP=1", "--command", $recoverySql)
  Invoke-Compose @("stop", "knowledge")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "120", "knowledge")
  $recoveryState = Invoke-Compose @("exec", "-T", "postgres", "psql", "--username=postgres", "--dbname=postgres", "--tuples-only", "--no-align", "--command", "SELECT (SELECT status FROM knowledge.index_runs WHERE id = '$orphanRunId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$orphanIndexId') || ':' || (SELECT status FROM knowledge.indexes WHERE id = '$($fullRun.index_id)');")
  if (($recoveryState -join "").Trim() -ne "INTERRUPTED:FAILED:ACTIVE") { throw "Full rebuild restart recovery did not preserve the active index." }
  Write-Output "M4/T3 index lifecycle acceptance passed."
}
finally {
  if ($started) {
    $previous = $ErrorActionPreference; $ErrorActionPreference = "Continue"
    try { Invoke-Compose @("down", "--volumes", "--remove-orphans") } finally { $ErrorActionPreference = $previous }
  }
  if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
  Remove-Item Env:KNOWLEDGE_ACCEPTANCE_VAULT_ROOT -ErrorAction SilentlyContinue
  if ($null -eq $priorEmbeddingModel) { Remove-Item Env:KNOWLEDGE_EMBEDDING_MODEL -ErrorAction SilentlyContinue }
  else { $env:KNOWLEDGE_EMBEDDING_MODEL = $priorEmbeddingModel }
}
