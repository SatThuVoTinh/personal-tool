[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool-t4",
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$localIntegrationScript = Join-Path $scriptDirectory "local-integration.ps1"
$requiredJobs = @("prometheus", "postgres-exporter", "redis-exporter")

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

function Get-HttpStatusCode {
  param([string]$Uri)

  try {
    return [int](Invoke-WebRequest -Uri $Uri -UseBasicParsing -ErrorAction Stop).StatusCode
  }
  catch {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }

    throw
  }
}

function Convert-MemoryToBytes {
  param([string]$Value)

  if ($Value -notmatch "^(?<amount>[0-9]+(?:\.[0-9]+)?)(?<unit>KiB|MiB|GiB|B)$") {
    throw "Docker stats returned an unrecognized memory value."
  }

  $multipliers = @{
    B   = 1
    KiB = 1KB
    MiB = 1MB
    GiB = 1GB
  }

  return [double]$Matches.amount * [double]$multipliers[$Matches.unit]
}

function Assert-PrometheusTargets {
  $deadline = (Get-Date).AddSeconds(60)

  do {
    try {
      $targets = Invoke-RestMethod `
        -Uri "http://127.0.0.1:9090/api/v1/targets" `
        -UseBasicParsing `
        -ErrorAction Stop
      $activeTargets = @($targets.data.activeTargets)
      $allUp = $true

      foreach ($job in $requiredJobs) {
        $target = @($activeTargets | Where-Object { $_.labels.job -eq $job }) |
          Select-Object -First 1

        if (-not $target -or $target.health -ne "up") {
          $allUp = $false
          break
        }
      }

      if ($allUp) {
        return
      }
    }
    catch {
      # Prometheus may be healthy before its first scheduled scrape.
    }

    Start-Sleep -Seconds 2
  }
  while ((Get-Date) -lt $deadline)

  throw "One or more mandatory Prometheus targets did not become UP."
}

function Assert-ResourceContract {
  $containerIds = @(
    & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      ps -q
  ) | Where-Object { $_ }

  if ($LASTEXITCODE -ne 0 -or $containerIds.Count -eq 0) {
    throw "Unable to collect Docker stats for the observability stack."
  }

  $stats = @(
    & docker stats --no-stream --format "{{.Name}}|{{.MemUsage}}" @containerIds
  )

  if ($LASTEXITCODE -ne 0 -or $stats.Count -ne $containerIds.Count) {
    throw "Unable to measure every running container with docker stats."
  }

  $totalBytes = 0.0

  foreach ($line in $stats) {
    $parts = $line -split "\|", 2

    if ($parts.Count -ne 2) {
      throw "Docker stats returned an unrecognized row."
    }

    $usage = ($parts[1] -split "/", 2)[0].Trim()
    $totalBytes += Convert-MemoryToBytes $usage
  }

  if ($totalBytes -gt 6GB) {
    throw "Idle container memory usage exceeds the 6 GiB M2 target."
  }

  foreach ($containerId in $containerIds) {
    $state = & docker inspect --format "{{.State.OOMKilled}}|{{.RestartCount}}" $containerId

    if ($LASTEXITCODE -ne 0) {
      throw "Unable to inspect container runtime state."
    }

    $stateParts = $state -split "\|", 2

    if ($stateParts[0] -ne "false" -or [int]$stateParts[1] -ne 0) {
      throw "A container reported OOM termination or an unexpected restart."
    }
  }
}

$started = $false

try {
  & $localIntegrationScript -EnvironmentFile $EnvironmentFile

  $started = $true
  Invoke-Compose @(
    "pull",
    "postgres-exporter",
    "redis-exporter",
    "prometheus",
    "grafana",
    "dozzle"
  )
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "180",
    "object-storage",
    "postgres",
    "redis",
    "nginx"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "180",
    "n8n",
    "postgres-exporter",
    "redis-exporter",
    "prometheus",
    "grafana",
    "dozzle"
  )

  Assert-PrometheusTargets

  if ((Get-HttpStatusCode "http://127.0.0.1:3000/api/health") -ne 200) {
    throw "Grafana health endpoint did not return HTTP 200."
  }
  if ((Get-HttpStatusCode "http://127.0.0.1:3000/api/datasources/uid/prometheus") -ne 200) {
    throw "Grafana did not load the provisioned Prometheus datasource."
  }
  if ((Get-HttpStatusCode "http://127.0.0.1:3000/api/dashboards/uid/m2-infrastructure") -ne 200) {
    throw "Grafana did not load the provisioned infrastructure dashboard."
  }

  Invoke-Compose @("exec", "-T", "dozzle", "/dozzle", "healthcheck")
  if ((Get-HttpStatusCode "http://127.0.0.1:9999/") -ne 200) {
    throw "Dozzle UI did not return HTTP 200."
  }

  Assert-ResourceContract
  Write-Output "M2/T4 observability validation passed."
}
finally {
  if ($started -and -not $KeepRunning) {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"

    try {
      & docker compose `
        --project-name $ProjectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
        down --remove-orphans `
        2>&1 |
      Out-Null
    }
    finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
  }
}
