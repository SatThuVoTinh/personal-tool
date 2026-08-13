[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$uvVersion = "0.12.0"
$uvArchiveSha256 = "68200e25de594df92387186bbfb9d9df606ec1d87efaa0ae0c7f690970e53db6"
$scriptDirectory = Split-Path -Parent $PSCommandPath
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory "..\..\..")).Path
$knowledgeDirectory = Join-Path $repositoryRoot "apps\knowledge"
$acceptanceRoot = Join-Path ([IO.Path]::GetTempPath()) "personal-tool-m3-t2-windows-$([guid]::NewGuid().ToString('N'))"
$archivePath = Join-Path $acceptanceRoot "uv.zip"
$uvDirectory = Join-Path $acceptanceRoot "uv"
$environmentDirectory = Join-Path $acceptanceRoot ".venv"
$vaultRoot = Join-Path $acceptanceRoot "vault"
$targetDirectory = Join-Path $acceptanceRoot "junction-target"
$pythonAcceptancePath = Join-Path $acceptanceRoot "windows_acceptance.py"

try {
  New-Item -ItemType Directory -Path $acceptanceRoot, $uvDirectory, $vaultRoot, $targetDirectory | Out-Null
  $downloadUri = "https://github.com/astral-sh/uv/releases/download/$uvVersion/uv-x86_64-pc-windows-msvc.zip"
  Invoke-WebRequest -UseBasicParsing -Uri $downloadUri -OutFile $archivePath
  $actualArchiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualArchiveSha256 -ne $uvArchiveSha256) {
    throw "The Windows uv archive checksum does not match the pinned value."
  }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $uvDirectory
  $uvExecutable = (Get-ChildItem -LiteralPath $uvDirectory -Filter uv.exe -Recurse -File).FullName
  if (-not $uvExecutable) {
    throw "The pinned Windows uv archive does not contain uv.exe."
  }

  $env:UV_PROJECT_ENVIRONMENT = $environmentDirectory
  & $uvExecutable sync --locked --no-dev --no-install-project --project $knowledgeDirectory
  if ($LASTEXITCODE -ne 0) {
    throw "The Windows M3/T2 environment could not be synchronized from uv.lock."
  }

  $knowledgeRoot = Join-Path $vaultRoot "01. Knowledge"
  New-Item -ItemType Directory -Path $knowledgeRoot | Out-Null
  $targetNote = Join-Path $targetDirectory "linked.md"
  [IO.File]::WriteAllText(
    $targetNote,
    "# Linked`n`nBody.`n`n#ai`n",
    [Text.UTF8Encoding]::new($false)
  )
  $junctionPath = Join-Path $knowledgeRoot "AI"
  New-Item -ItemType Junction -Path $junctionPath -Target $targetDirectory | Out-Null

  $pythonCommand = @'
from pathlib import Path
from app.markdown_adapter import MarkdownVaultScanner

class UnusedTokenBudget:
    def count(self, text):
        raise AssertionError("Discovery must reject the junction before tokenization")

    def fits(self, text):
        raise AssertionError("Discovery must reject the junction before tokenization")

vault_root = Path(r"__VAULT_ROOT__")
result = MarkdownVaultScanner(UnusedTokenBudget()).scan_vault(vault_root)
if result.succeeded or result.sources:
    raise SystemExit("Windows junction/reparse scan unexpectedly succeeded")
if [(error.source_path, error.code) for error in result.errors] != [
    ("01. Knowledge/AI", "SOURCE_LINK_NOT_ALLOWED")
]:
    raise SystemExit("Windows junction/reparse scan returned the wrong error")
print("M3/T2 Windows-native junction/reparse acceptance passed.")
'@.Replace("__VAULT_ROOT__", $vaultRoot.Replace("\", "\\"))
  [IO.File]::WriteAllText(
    $pythonAcceptancePath,
    $pythonCommand,
    [Text.UTF8Encoding]::new($false)
  )

  $env:PYTHONPATH = $knowledgeDirectory
  & $uvExecutable run --locked --no-sync --project $knowledgeDirectory python $pythonAcceptancePath
  if ($LASTEXITCODE -ne 0) {
    throw "M3/T2 Windows-native junction/reparse acceptance failed."
  }
}
finally {
  Remove-Item Env:UV_PROJECT_ENVIRONMENT -ErrorAction SilentlyContinue
  Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $acceptanceRoot) {
    Remove-Item -LiteralPath $acceptanceRoot -Recurse -Force
  }
}
