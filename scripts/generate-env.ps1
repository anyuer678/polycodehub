# Generates infra/docker/.env from .env.example with random strong secrets
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$envDir = Join-Path $root 'infra\docker'
$example = Join-Path $envDir '.env.example'
$target = Join-Path $envDir '.env'

function New-RandomPassword([int]$length = 24) {
  $bytes = New-Object byte[] $length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'Z').Replace('=', '')
}

function New-RandomSecret([int]$length = 48) {
  $bytes = New-Object byte[] $length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', 'A').Replace('/', 'Z')
}

if (-not (Test-Path -LiteralPath $example)) {
  Write-Error ".env.example not found at $example"
}

if (Test-Path -LiteralPath $target) {
  Write-Host "[SKIP] $target already exists (keep existing). Delete it to regenerate."
  exit 0
}

$lines = Get-Content -LiteralPath $example -Encoding UTF8
$out = @()
foreach ($line in $lines) {
  if ($line -match '^([A-Z0-9_]+)=(.*)$') {
    $key = $Matches[1]
    $value = $Matches[2]
    switch ($key) {
      'POSTGRES_USER'      { $value = 'polycodehub' }
      'POSTGRES_DB'        { $value = 'polycodehub' }
      'POSTGRES_PASSWORD'  { $value = New-RandomPassword }
      'REDIS_PASSWORD'     { $value = New-RandomPassword }
      'RABBITMQ_USER'      { $value = 'polycodehub' }
      'RABBITMQ_PASSWORD'  { $value = New-RandomPassword }
      'AUTH_JWT_SECRET'    { $value = New-RandomSecret }
      'CORS_ORIGINS'       { $value = 'http://localhost:3000' }
      default              { $value = $Matches[2] }
    }
    $out += "$key=$value"
  } else {
    $out += $line
  }
}

Set-Content -LiteralPath $target -Value $out -Encoding ASCII
Write-Host "[OK] Generated $target with random credentials."
Write-Host "     Username default: polycodehub (postgres/rabbitmq)"
Write-Host "     Passwords/JWT: random, 24-48 chars, safe for logs"
