#Requires -Version 7
<#
.SYNOPSIS
  Nasadí novou verzi OZ Dashboard: aktualizuje Config.js, commitne, pushne na GitHub a přes clasp do GAS.

.PARAMETER Bump
  Typ zvýšení verze: 'patch' (opravy), 'minor' (nové funkce), 'major' (architektonické změny).
  Nebo přímo verze ve formátu 'v1.2.3'.

.PARAMETER Changes
  Seznam změn pro changelog (pole stringů).

.EXAMPLE
  .\deploy.ps1 -Bump minor -Changes 'Přidán changelog modal','Opravena diakritika'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Bump,

    [Parameter(Mandatory = $true)]
    [string[]]$Changes
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

function Step([string]$msg) { Write-Host "`n▸ $msg" -ForegroundColor Cyan }
function OK([string]$msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Fail([string]$msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; exit 1 }

# ─── 1. Ověř čisté pracovní stromě ──────────────────────────────────────────
Step "Kontrola git stavu"
$status = git -C $dir status --porcelain
if ($status) {
    Fail "Existují necommitnuté změny. Nejprve je commitni, pak spusť deploy."
}
OK "Pracovní strom je čistý"

# ─── 2. Načti aktuální verzi z Config.js ────────────────────────────────────
Step "Čtu aktuální verzi"
$configPath = Join-Path $dir 'Config.js'
$config = [System.IO.File]::ReadAllText($configPath, [System.Text.Encoding]::UTF8)

if ($config -notmatch "version:\s*'v(\d+)\.(\d+)\.(\d+)'") {
    Fail "Nepodařilo se načíst verzi z Config.js"
}
$curMajor = [int]$Matches[1]
$curMinor = [int]$Matches[2]
$curPatch = [int]$Matches[3]
$curVersion = "v$curMajor.$curMinor.$curPatch"

# ─── 3. Vypočítej novou verzi ────────────────────────────────────────────────
$newVersion = switch -Regex ($Bump) {
    '^v\d+\.\d+\.\d+$' { $Bump }
    '^major$'           { "v$($curMajor + 1).0.0" }
    '^minor$'           { "v$curMajor.$($curMinor + 1).0" }
    '^patch$'           { "v$curMajor.$curMinor.$($curPatch + 1)" }
    default             { Fail "Neplatný Bump '$Bump'. Použij: patch / minor / major / vX.Y.Z" }
}

OK "$curVersion  →  $newVersion"

# ─── 4. git pull ────────────────────────────────────────────────────────────
Step "git pull --rebase"
git -C $dir pull --rebase
if ($LASTEXITCODE -ne 0) { Fail "git pull selhal" }
OK "Lokální větev je aktuální"

# ─── 5. Aktualizuj Config.js ────────────────────────────────────────────────
Step "Aktualizuji Config.js ($newVersion)"

$today = Get-Date -Format 'yyyy-MM-dd'

# Sestavení nového záznamu changelogu
$changeLines = ($Changes | ForEach-Object { "      '$($_ -replace "'", "\'")'," }) -join "`n"
$newEntry = @"
  {
    version: '$newVersion',
    date: '$today',
    changes: [
$changeLines
    ],
  },
"@

# Nahraď číslo verze pouze v APP_CONFIG (první výskyt), ne v changelog záznamech
# Instance metoda Regex.Replace(input, replacement, count) — nahradí právě 1 výskyt
$versionRegex = [System.Text.RegularExpressions.Regex]::new("version:\s*'$([regex]::Escape($curVersion))'")
$config = $versionRegex.Replace($config, "version: '$newVersion'", 1)

# Vlož nový záznam na začátek APP_CHANGELOG
$config = $config -replace '(const APP_CHANGELOG\s*=\s*\[)', "`$1`n$newEntry"

[System.IO.File]::WriteAllText($configPath, $config, [System.Text.Encoding]::UTF8)
OK "Config.js aktualizován"

# ─── 6. git commit ──────────────────────────────────────────────────────────
Step "git commit"
git -C $dir add 'Config.js'
git -C $dir commit -m "Release $newVersion"
if ($LASTEXITCODE -ne 0) { Fail "git commit selhal" }
OK "Commit vytvořen"

# ─── 7. git push ────────────────────────────────────────────────────────────
Step "git push"
git -C $dir push
if ($LASTEXITCODE -ne 0) { Fail "git push selhal" }
OK "Pushnuté na GitHub"

# ─── 8. clasp push ──────────────────────────────────────────────────────────
Step "clasp push"
Set-Location $dir
clasp push --force
if ($LASTEXITCODE -ne 0) { Fail "clasp push selhal" }
OK "Pushnuté do Google Apps Script"

# ─── Hotovo ──────────────────────────────────────────────────────────────────
Write-Host "`n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Deploy $newVersion dokončen úspěšně!" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`n" -ForegroundColor Green
