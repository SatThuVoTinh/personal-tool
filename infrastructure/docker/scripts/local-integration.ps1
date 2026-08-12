[CmdletBinding()]
param(
  [string]$EnvironmentFile = (Join-Path $PSScriptRoot "..\env\.env"),
  [string]$ProjectName = "personal-tool-t3",
  [switch]$KeepRunning
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$scriptDirectory = Split-Path -Parent $PSCommandPath
$dockerDirectory = Split-Path -Parent $scriptDirectory
$composeFile = Join-Path $dockerDirectory "compose\compose.core.yml"
$coreStorageScript = Join-Path $scriptDirectory "core-storage.ps1"
$requiredVariables = @(
  "POSTGRES_PASSWORD",
  "N8N_POSTGRES_PASSWORD",
  "N8N_ENCRYPTION_KEY"
)

function Read-EnvironmentFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Runtime environment file is missing: $Path"
  }

  $values = @{}

  foreach ($line in Get-Content -LiteralPath $Path -Encoding utf8) {
    $trimmed = $line.Trim()

    if ($trimmed.Length -eq 0 -or $trimmed.StartsWith("#")) {
      continue
    }

    $separator = $trimmed.IndexOf("=")

    if ($separator -lt 1) {
      throw "Runtime environment file contains an invalid assignment."
    }

    $name = $trimmed.Substring(0, $separator).Trim()
    $value = $trimmed.Substring($separator + 1).Trim()

    if (
      $value.Length -ge 2 -and
      (
        ($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'"))
      )
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    $values[$name] = $value
  }

  return $values
}

function Test-SentinelValue {
  param([string]$Value)

  $normalized = $Value.Trim().ToLowerInvariant()

  return (
    $normalized.Length -eq 0 -or
    $normalized -match "(?:change|replace|example|placeholder|your)[-_ ]?(?:me|with|value|secret|password|user|path)?" -or
    $normalized -match "^m2-t[23]-unconfigured$"
  )
}

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

function Get-ComposeOutput {
  param([string[]]$Arguments)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $output = & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      @Arguments `
      2>$null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Docker Compose command failed with exit code $exitCode."
  }

  return ($output -join "`n").Trim()
}

function Import-SyntheticCredential {
  param(
    [string]$Name,
    [string]$Marker
  )

  $credentialPayload = ConvertTo-Json `
    -InputObject @(
      [pscustomobject]@{
        id = [guid]::NewGuid().ToString()
        name = $Name
        type = "httpBasicAuth"
        data = [pscustomobject]@{
          user = "m2-t3-synthetic"
          password = $Marker
        }
      }
    ) `
    -Compress `
    -Depth 5
  $importCommand = 'set -eu; file=/tmp/m2-t3-credential.json; trap ''rm -f "$file"'' EXIT; umask 077; cat > "$file"; n8n import:credentials --input="$file" >/dev/null'

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    $credentialPayload |
      & docker compose `
        --project-name $ProjectName `
        --env-file $EnvironmentFile `
        -f $composeFile `
        exec -T n8n /bin/sh -c $importCommand `
        2>&1 |
      Out-Null
    $exitCode = $LASTEXITCODE
  }
  finally {
    $credentialPayload = $null
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0) {
    throw "Unable to import the ephemeral synthetic n8n credential."
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

function Remove-SyntheticN8nState {
  param([string]$CredentialName)

  if (-not $CredentialName) {
    return
  }

  $cleanupSql = "DELETE FROM credentials_entity WHERE name = '$CredentialName';"

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"

  try {
    & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      exec -T postgres psql --username=postgres --dbname=n8n --set=ON_ERROR_STOP=1 --command $cleanupSql `
      2>&1 |
    Out-Null
    $exitCode = $LASTEXITCODE

    & docker compose `
      --project-name $ProjectName `
      --env-file $EnvironmentFile `
      -f $composeFile `
      exec -T n8n /bin/sh -c "rm -f /home/node/.n8n/m2-t3-recreation-marker" `
      2>&1 |
    Out-Null
    $markerExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($exitCode -ne 0 -or $markerExitCode -ne 0) {
    Write-Warning "Synthetic n8n test state cleanup did not complete."
  }
}

$values = Read-EnvironmentFile $EnvironmentFile

foreach ($name in $requiredVariables) {
  if (
    -not $values.ContainsKey($name) -or
    (Test-SentinelValue $values[$name])
  ) {
    throw "Runtime variable $name is missing, empty, or uses a rejected example value."
  }
}

if ($values.N8N_ENCRYPTION_KEY.Length -lt 32) {
  throw "N8N_ENCRYPTION_KEY must contain at least 32 characters."
}

$started = $false
$credentialName = $null

try {
  & $coreStorageScript -EnvironmentFile $EnvironmentFile

  Invoke-Compose @("pull", "n8n", "nginx")
  $started = $true
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
    "object-storage",
    "postgres",
    "redis",
    "nginx"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "180", "n8n")

  Invoke-Compose @("exec", "-T", "nginx", "nginx", "-t")

  if ((Get-HttpStatusCode "http://127.0.0.1:8080/healthz") -ne 200) {
    throw "Nginx health endpoint did not return HTTP 200."
  }
  if ((Get-HttpStatusCode "http://127.0.0.1:8080/") -ne 404) {
    throw "Nginx default route must return HTTP 404."
  }

  $ollamaSmoke = @'
const model = process.env.OLLAMA_SMOKE_MODEL;
fetch("http://host.docker.internal:11434/api/embed", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model, input: "m2-t3 connectivity smoke" }),
})
  .then(async (response) => {
    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.embeddings) || payload.embeddings.length === 0 || payload.embeddings[0].length === 0) {
      throw new Error("Ollama returned an empty embedding response");
    }
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
'@
  # PowerShell's native-command argument handling can strip JavaScript quotes
  # passed directly to `node -e`. Pass the smoke program as opaque Base64
  # input so the container receives exactly the program that was validated.
  $ollamaSmokeEncoded = [Convert]::ToBase64String(
    [Text.Encoding]::UTF8.GetBytes($ollamaSmoke)
  )
  $ollamaRunner = 'eval(Buffer.from(process.argv[1],`base64`).toString())'
  Get-ComposeOutput @(
    "exec",
    "-T",
    "n8n",
    "node",
    "-e",
    $ollamaRunner,
    $ollamaSmokeEncoded
  ) | Out-Null
  $ollamaSmokeEncoded = $null

  $marker = [guid]::NewGuid().ToString("N")
  $credentialName = "m2-t3-synthetic-$marker"

  Invoke-Compose @(
    "exec",
    "-T",
    "n8n",
    "/bin/sh",
    "-c",
    "umask 077; printf '%s' '$marker' > /home/node/.n8n/m2-t3-recreation-marker"
  )
  Import-SyntheticCredential $credentialName $marker

  $ciphertext = Get-ComposeOutput @(
    "exec",
    "-T",
    "postgres",
    "psql",
    "--username=postgres",
    "--dbname=n8n",
    "--tuples-only",
    "--no-align",
    "--command",
    "SELECT data FROM credentials_entity WHERE name = '$credentialName';"
  )
  if ($ciphertext.Length -eq 0 -or $ciphertext.Contains($marker)) {
    throw "Synthetic n8n credential was not encrypted at rest."
  }

  Invoke-Compose @("down", "--remove-orphans")
  $started = $false
  $started = $true
  Invoke-Compose @(
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "120",
    "object-storage",
    "postgres",
    "redis",
    "nginx"
  )
  Invoke-Compose @("run", "--rm", "--no-deps", "-T", "postgres-bootstrap")
  Invoke-Compose @("up", "--detach", "--wait", "--wait-timeout", "180", "n8n")

  if (
    (Get-ComposeOutput @(
      "exec",
      "-T",
      "n8n",
      "/bin/sh",
      "-c",
      "cat /home/node/.n8n/m2-t3-recreation-marker"
    )) -ne $marker
  ) {
    throw "The n8n .n8n marker did not survive container recreation."
  }

  $decryptedExport = Get-ComposeOutput @(
    "exec",
    "-T",
    "n8n",
    "n8n",
    "export:credentials",
    "--all",
    "--decrypted"
  )
  $jsonStart = $decryptedExport.IndexOf("[")

  if ($jsonStart -lt 0) {
    throw "n8n decrypted credential export did not return a JSON array."
  }

  $credentials = @($decryptedExport.Substring($jsonStart) | ConvertFrom-Json)
  $credential = @($credentials | Where-Object { $_.name -eq $credentialName }) | Select-Object -First 1

  if (
    -not $credential -or
    $credential.data.password -cne $marker
  ) {
    throw "n8n could not decrypt the synthetic credential with the configured encryption key."
  }

  Write-Output "M2/T3 local integration recreation validation passed."
}
finally {
  if ($started) {
    Remove-SyntheticN8nState $credentialName

    if (-not $KeepRunning) {
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
}
