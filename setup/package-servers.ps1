#!/usr/bin/env pwsh
# =============================================================================
# Package MCP servers into zip files for GitHub Release assets
# =============================================================================
param(
    [string] $OutputDir = 'release-assets'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$OutDir   = Join-Path $RepoRoot $OutputDir
$LOCAL    = $env:LOCALAPPDATA
$ROAM     = $env:APPDATA

$script:Packages = @(
    @{
        Name    = 'rvt'
        Label   = 'Revit MCP Server'
        Source  = Join-Path $LOCAL 'Bimwright\rvt-mcp\server\current'
        ZipName = 'rvt-mcp-server.zip'
    },
    @{
        Name    = 'navis'
        Label   = 'Navisworks MCP Server'
        Source  = Join-Path $LOCAL 'NavisHelper\McpServer'
        ZipName = 'NavisHelper.McpServer.zip'
    },
    @{
        Name    = 'navis-alt'
        Label   = 'Navisworks MCP Server (alt)'
        Source  = Join-Path $LOCAL 'Navisworks MCP\McpServer'
        ZipName = 'NavisHelper.McpServer-alt.zip'
    },
    @{
        Name    = 'civil3d'
        Label   = 'Civil 3D MCP Server'
        Source  = Join-Path $ROAM 'MCP Civil 3D'
        ZipName = 'civil3d-mcp.zip'
    },
    @{
        Name    = 'sketchup'
        Label   = 'SketchUp MCP Server'
        Source  = Join-Path $LOCAL 'Programs\SketchUp MCP\server'
        ZipName = 'sketchup-mcp-server.zip'
    }
)

function Compress-Folder {
    param([string] $SourceFolder, [string] $ZipPath)

    if (-not (Test-Path -LiteralPath $SourceFolder -PathType Container)) {
        Write-Host "  SKIP: source folder not found: $SourceFolder" -ForegroundColor Yellow
        return $false
    }

    $parent = Split-Path -Parent $ZipPath
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    if (Test-Path -LiteralPath $ZipPath -PathType Leaf) {
        Remove-Item -LiteralPath $ZipPath -Force
    }

    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($SourceFolder, $ZipPath)
        $size = [math]::Round(((Get-Item -LiteralPath $ZipPath).Length) / 1MB, 2)
        Write-Host "  OK: $ZipPath ($size MB)" -ForegroundColor Green
        return $true
    }
    catch {
        $errMsg = $_.Exception.Message
        Write-Error ("Failed to compress " + $SourceFolder + ": " + $errMsg)
        return $false
    }
}

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "  Package MCP servers for GitHub Release" -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Output dir: $OutDir"
Write-Host ""

if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) {
    New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

$success = 0
$failed  = 0

foreach ($pkg in $script:Packages) {
    Write-Host "  >> $($pkg.Label) ..." -ForegroundColor Cyan
    $zipPath = Join-Path $OutDir $pkg.ZipName
    if (Compress-Folder -SourceFolder $pkg.Source -ZipPath $zipPath) {
        $success++
    }
    else {
        $failed++
    }
}

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host "  Done: $success zip files ready for GitHub Release assets" -ForegroundColor Green
}
else {
    Write-Host "  Done with errors: $success ok, $failed failed" -ForegroundColor Yellow
}
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next step:" -ForegroundColor DarkCyan
Write-Host "  1. Go to https://github.com/elhussieny2ohamy-BIM/Pinnacle-AI-Agent/releases/new"
Write-Host "  2. Create a new release (e.g. v1.0.0)"
Write-Host "  3. Upload every zip from $OutDir as Release Assets"
Write-Host "  4. The setup script uses tag 'latest' so it auto-resolves to your release"
Write-Host ""
