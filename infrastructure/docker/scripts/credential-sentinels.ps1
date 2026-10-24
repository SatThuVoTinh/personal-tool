# F-522 (R10-L09-6) - the credential sentinel grammar, in exactly one place.
#
# preflight.ps1 invented this grammar and start.ps1 - the script README.md and
# both runbooks publish as the start command - re-implemented none of it, so the
# guard only held if the operator volunteered to run the other script first.
# Both entrypoint scripts dot-source this file, which defines functions and runs
# nothing.

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

# The variables that hold secret material, per profile. POSTGRES_PASSWORD is
# interpolated by compose.core.yml with an `unconfigured` default, so a stack
# can come up on a placeholder unless something refuses it here.
function Get-CredentialVariableNames {
  param(
    [ValidateSet("knowledge", "automation", "all")]
    [string]$Profile
  )

  $names = @("POSTGRES_PASSWORD")
  $usesAutomation = $Profile -in @("automation", "all")
  if ($usesAutomation) {
    $names += @("N8N_POSTGRES_PASSWORD", "N8N_ENCRYPTION_KEY")
  }

  return $names
}

function Assert-CredentialValues {
  param(
    [hashtable]$Values,
    [string[]]$Names
  )

  foreach ($name in $Names) {
    if (-not $Values.ContainsKey($name) -or (Test-SentinelValue $Values[$name])) {
      throw "Runtime variable $name is missing, empty, or uses a rejected example value."
    }
  }
}
