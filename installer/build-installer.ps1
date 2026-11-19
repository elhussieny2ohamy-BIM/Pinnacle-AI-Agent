#!/usr/bin/env pwsh
# =============================================================================
# Build the PINNACLE MCP Servers installer EXE with Inno Setup 6.
#
# Usage:
#   .\build-installer.ps1                 # locate (or install) Inno Setup, compile
#   .\build-installer.ps1 -SkipDownload   # fail if Inno Setup is missing
#   .\build-installer.ps1 -IssPath <path> # use a specific .iss
#
# Output: .\output\Pinnacle-MCP-Setup-<version>.exe
# =============================================================================
[CmdletBinding()]
param(
    [string] $IssPath = '',
    [switch] $SkipDownload
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Here     = $PSScriptRoot
$RepoRoot = (Get-Item $Here).Parent.FullName
if (-not $IssPath) { $IssPath = Join-Path $Here 'pinnacle-mcp-setup.iss' }

function Find-Iscc {
    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 5\ISCC.exe')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    $onPath = Get-Command 'ISCC.exe' -CommandType Application -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    return $null
}

function Install-InnoSetup {
    if ($SkipDownload) { return $null }

    # Prefer winget when available.
    $winget = Get-Command 'winget' -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  Installing Inno Setup via winget ..." -ForegroundColor Cyan
        try {
            & $winget.Source install --id JRSoftware.InnoSetup -e --silent `
                --accept-package-agreements --accept-source-agreements | Out-Null
        }
        catch {
            Write-Warning "winget install failed: $($_.Exception.Message)"
        }
        $found = Find-Iscc
        if ($found) { return $found }
    }

    # Fall back to the official silent installer.
    Write-Host "  Downloading Inno Setup from jrsoftware.org ..." -ForegroundColor Cyan
    $installer = Join-Path $env:TEMP 'innosetup-installer.exe'
    Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile $installer -TimeoutSec 300
    Write-Host "  Running Inno Setup installer silently ..." -ForegroundColor Cyan
    & $installer /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- | Out-Null
    Start-Sleep -Seconds 2
    return (Find-Iscc)
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  Building PINNACLE MCP Servers installer" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  Repo root: $RepoRoot"
Write-Host "  Script:    $IssPath"

if (-not (Test-Path -LiteralPath $IssPath -PathType Leaf)) {
    throw "Inno Setup script not found: $IssPath"
}
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'release-assets') -PathType Container)) {
    Write-Warning "release-assets folder not found - the installer will fall back to online downloads."
}

$iscc = Find-Iscc
if (-not $iscc) {
    Write-Host "  Inno Setup compiler (ISCC.exe) not found - attempting install ..." -ForegroundColor Yellow
    $iscc = Install-InnoSetup
}
if (-not $iscc) {
    throw "ISCC.exe not found. Install Inno Setup 6 from https://jrsoftware.org/isdl.php and re-run."
}

Write-Host "  ISCC: $iscc" -ForegroundColor Green
Write-Host "  Compiling ...`n" -ForegroundColor Cyan

& $iscc $IssPath
if ($LASTEXITCODE -ne 0) {
    throw "Inno Setup compilation failed (exit code $LASTEXITCODE)."
}

$outputDir = Join-Path $Here 'output'
Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  Build complete" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
if (Test-Path -LiteralPath $outputDir) {
    Get-ChildItem -LiteralPath $outputDir -Filter '*.exe' | ForEach-Object {
        $mb = [math]::Round($_.Length / 1MB, 1)
        Write-Host "  EXE: $($_.FullName) ($mb MB)" -ForegroundColor Green
    }
}
Write-Host ""
