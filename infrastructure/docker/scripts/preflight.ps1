[CmdletBinding()]
param(
  [ValidateSet("knowledge", "automation", "all")]
  [string]$Profile = "all",
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$OllamaExecutable
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$dockerDirectory = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$knowledgeComposeFile = Join-Path $dockerDirectory "compose\compose.knowledge.yml"
$usesKnowledge = $Profile -in @("knowledge", "all")
$usesAutomation = $Profile -in @("automation", "all")
$requiredVariables = @("POSTGRES_PASSWORD")
if ($usesAutomation) {
  $requiredVariables += @("N8N_POSTGRES_PASSWORD", "N8N_ENCRYPTION_KEY")
}
if ($usesKnowledge) {
  # F-266 (R7-D13-03): the service reads KNOWLEDGE_EMBEDDING_MODEL
  # (apps/knowledge/app/config.py), so that is the variable this preflight has
  # to prove. OLLAMA_SMOKE_MODEL names a different model and nothing compared
  # the two, so an operator who changed one got a green preflight and a
  # knowledge readiness failure at index/embed time.
  $requiredVariables += @("KNOWLEDGE_VAULT_ROOT", "OLLAMA_SMOKE_MODEL", "KNOWLEDGE_EMBEDDING_MODEL")
}

function Read-EnvironmentFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Runtime environment file is missing: $Path"
  }

  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) { continue }
    $separator = $trimmed.IndexOf("=")
    if ($separator -lt 1) { throw "Runtime environment file contains an invalid assignment." }
    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim().Trim('"').Trim("'")
    $values[$name] = $value
  }
  return $values
}

function Test-SentinelValue {
  param([string]$Value)
  $normalized = $Value.Trim().ToLowerInvariant()
  return (
    $normalized.Length -eq 0 -or
    $normalized -match "(?:change|replace|example|placeholder|your)[-_ ]?(?:me|with|value|secret|password|key|path)?"
  )
}

function Get-OllamaExecutable {
  if ($OllamaExecutable) { return $OllamaExecutable }
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"),
    (Join-Path $env:ProgramFiles "Ollama\ollama.exe")
  )
  return $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}

$values = Read-EnvironmentFile $EnvironmentFile
foreach ($name in $requiredVariables) {
  if (-not $values.ContainsKey($name) -or (Test-SentinelValue $values[$name])) {
    throw "Runtime variable $name is missing, empty, or uses a rejected example value."
  }
}

if ($usesKnowledge) {
  if (-not (Test-Path -LiteralPath $values.KNOWLEDGE_VAULT_ROOT -PathType Container)) {
    throw "KNOWLEDGE_VAULT_ROOT must point to an existing directory."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $values.KNOWLEDGE_VAULT_ROOT "01. Knowledge") -PathType Container)) {
    throw "KNOWLEDGE_VAULT_ROOT must contain 01. Knowledge."
  }
  $ollama = Get-OllamaExecutable
  if (-not $ollama) { throw "Ollama executable was not found." }
  $embeddingModel = $values.KNOWLEDGE_EMBEDDING_MODEL
  if ($values.ContainsKey("OLLAMA_SMOKE_MODEL") -and $values.OLLAMA_SMOKE_MODEL -ne $embeddingModel) {
    throw "OLLAMA_SMOKE_MODEL and KNOWLEDGE_EMBEDDING_MODEL name different models: '$($values.OLLAMA_SMOKE_MODEL)' and '$embeddingModel'. The service embeds with KNOWLEDGE_EMBEDDING_MODEL, so the two variables must agree."
  }
  $models = Invoke-RestMethod -Uri "http://127.0.0.1:11434/api/tags" -Method Get
  if (-not @($models.models | Where-Object { $_.name -eq $values.KNOWLEDGE_EMBEDDING_MODEL })) {
    throw "Configured embedding model '$embeddingModel' is not installed."
  }
}

& docker version --format "{{.Server.Version}}" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is unavailable." }
& docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose is unavailable." }

$composeArguments = @("--env-file", $EnvironmentFile, "-f", $composeFile)
if ($usesKnowledge) { $composeArguments += @("-f", $knowledgeComposeFile) }
$composeArguments += @("--profile", $Profile, "config", "--quiet")
& docker compose @composeArguments
if ($LASTEXITCODE -ne 0) { throw "Docker Compose configuration is invalid." }

if ($usesKnowledge) {
  Write-Output "Static preflight passed for Docker profile '$Profile' with embedding model '$embeddingModel'."
}
else {
  Write-Output "Static preflight passed for Docker profile '$Profile'."
}
