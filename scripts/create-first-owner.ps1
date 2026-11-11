<#
.SYNOPSIS
  Safe launcher for the ONE-TIME "create the first Owner" script (scripts/create-first-user.ts).

.DESCRIPTION
  Run it yourself in a normal PowerShell window (not inside an automated session):

      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\create-first-owner.ps1

  What it does:
    1. Checks that it runs in a real, interactive console.
    2. Checks that .env.local points at the expected Supabase project (prfarsersxoeavcqydez) and has a secret key
       (neither value is ever printed), and that no environment variable overrides them.
    3. Starts the existing protected script `npx tsx scripts/create-first-user.ts`, attached to THIS console.

  What it deliberately does NOT do:
    * It never asks for, reads, stores or forwards the password. The existing script asks for the temporary password
      itself, in raw hidden-input mode, directly from your keyboard: the characters are not shown, not echoed, not
      logged, never reach PowerShell, never go on a command line, in an environment variable or in a file.
    * It has no parameter for a password, name, email or confirmation. You type the name, the email and the literal
      CREATE OWNER yourself, in the existing script's own prompts.
    * It does not touch the database and does not run SQL.

  -DryRun     runs the script's dry run (nothing is created).
  -CheckOnly  runs only this launcher's own checks and prints the command it would run (used by the tests).
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$CheckOnly,
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

# The only project this launcher will ever create an Owner in. A constant on purpose: not a parameter.
$ExpectedRef = "prfarsersxoeavcqydez"

$repo = Split-Path -Parent $PSScriptRoot
$realEnv = Join-Path $repo ".env.local"
if ([string]::IsNullOrEmpty($EnvFile)) { $EnvFile = $realEnv }
# The TypeScript script itself reads .env.local from the repository folder, so a real run can only use that file.
if (-not $CheckOnly -and ((Resolve-Path -LiteralPath $EnvFile -ErrorAction SilentlyContinue).Path -ne (Resolve-Path -LiteralPath $realEnv -ErrorAction SilentlyContinue).Path)) {
  Write-Host "Refused: a real or dry run only uses the repository's own .env.local." -ForegroundColor Red
  exit 1
}

function Stop-Launcher([string]$message) {
  Write-Host "Refused: $message" -ForegroundColor Red
  Write-Host "Nothing was created." -ForegroundColor Red
  exit 1
}

# ---- 1. interactive console (the hidden password prompt of the real script needs one)
if (-not $CheckOnly) {
  if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
    Stop-Launcher "this must run in a normal, interactive PowerShell window (input or output is redirected)."
  }
}

# ---- 2. environment overrides: the script's loadEnvFile never overrides variables that are already set
foreach ($name in @("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY")) {
  if (Test-Path "Env:$name") {
    Stop-Launcher "the environment variable $name is set in this window and would override .env.local. Open a fresh PowerShell window."
  }
}

# ---- 3. read .env.local WITHOUT printing or exporting any value
if (-not (Test-Path -LiteralPath $EnvFile)) { Stop-Launcher ".env.local was not found." }
$values = @{}
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  if ($line -match '^\s*(NEXT_PUBLIC_SUPABASE_URL|SUPABASE_SECRET_KEY)\s*=\s*(.*?)\s*$') {
    $values[$Matches[1]] = $Matches[2].Trim('"').Trim("'")
  }
}
$url = $values["NEXT_PUBLIC_SUPABASE_URL"]
$key = $values["SUPABASE_SECRET_KEY"]
if ([string]::IsNullOrEmpty($url)) { Stop-Launcher "NEXT_PUBLIC_SUPABASE_URL is missing in .env.local." }
if ([string]::IsNullOrEmpty($key)) { Stop-Launcher "SUPABASE_SECRET_KEY is missing in .env.local." }
if (-not $key.StartsWith("sb_secret_")) { Stop-Launcher "SUPABASE_SECRET_KEY does not look like a Supabase secret key (expected the new sb_secret_ format)." }

try { $hostName = ([System.Uri]$url).Host.ToLowerInvariant() } catch { Stop-Launcher "NEXT_PUBLIC_SUPABASE_URL is not a valid address." }
if ($hostName -ne "$ExpectedRef.supabase.co") {
  Stop-Launcher "the project in .env.local is not the expected project ($ExpectedRef). The project address is not shown here on purpose; check .env.local."
}
Write-Host "Project check passed: .env.local points at $ExpectedRef." -ForegroundColor Green

# ---- 4. the command that will run (no password, name, email or confirmation can be added here)
$tsArgs = @("tsx", "scripts/create-first-user.ts")
if ($DryRun) { $tsArgs += "--dry-run" }
if ($CheckOnly) {
  Write-Host ("Would run: npx " + ($tsArgs -join " "))
  exit 0
}

Write-Host ""
if ($DryRun) {
  Write-Host "DRY RUN: nothing will be created. The script will ask for a name and email only." -ForegroundColor Yellow
} else {
  Write-Host "You are about to create the FIRST OWNER. The next prompts come from the protected script:" -ForegroundColor Yellow
  Write-Host "  1. 'Has the Secret Key ... been replaced ...? (yes/no)'  ->  yes"
  Write-Host "  2. Owner's full name                                      ->  Stateadv"
  Write-Host "  3. Owner's email                                          ->  sayedshoaibahmed21@gmail.com"
  Write-Host "  4. Temporary password (hidden), twice                     ->  type a NEW password; nothing is shown"
  Write-Host "  5. Type CREATE OWNER to create ...                        ->  CREATE OWNER (exactly)"
  Write-Host "Never type the password anywhere else, and never reuse one that was shared before."
}
Write-Host ""

# ---- 5. hand the console over to the existing script (it keeps its own safeguards)
Push-Location $repo
try {
  & npx @tsArgs
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}
if ($code -ne 0) {
  Write-Host "The script stopped with an error. Read its message above; nothing is created unless it printed 'Done. The Owner account exists.'" -ForegroundColor Red
  exit $code
}
