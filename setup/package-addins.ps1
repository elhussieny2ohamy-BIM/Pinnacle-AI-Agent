#!/usr/bin/env pwsh
# =============================================================================
# Build the host add-in payload used by setup/plugins.ps1.
#
# Output:
#   release-assets/addins/<Host>/...        (staging tree)
#   release-assets/pinnacle-host-addins.zip (release asset)
#
# The staging tree intentionally matches the layout the setup expects:
#   addins/Revit/2025/RvtMcp.R25.addin
#   addins/Revit/2025/RvtMcp/*.dll
#   addins/Navisworks/NavisHelper.bundle/...
#   addins/Civil3D/MCPCivil3D.bundle/...
#   addins/AutoCAD/MCPAutoCAD.bundle/...
#   addins/Rhino/rhino-mcp.rhp
#   addins/SketchUp/su_mcp-1.3.0.rbz
#
# Run from the repo root on a machine that has the upstream source trees and
# the built add-in artifacts:
#   .\setup\package-addins.ps1
# =============================================================================
[CmdletBinding()]
param(
    [string] $OutputDir = 'release-assets',
    [switch] $SkipZip
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$OutRoot  = Join-Path $RepoRoot $OutputDir
$Stage    = Join-Path $OutRoot 'addins'
$LOCAL    = $env:LOCALAPPDATA
$ROAM     = $env:APPDATA

function Reset-Stage {
    if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
}

function Copy-Tree {
    param([string] $Source, [string] $Destination)
    if (-not (Test-Path -LiteralPath $Source)) { return $false }
    if (-not (Test-Path -LiteralPath $Destination)) { New-Item -ItemType Directory -Path $Destination -Force | Out-Null }
    $result = robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    if ($LASTEXITCODE -gt 7) { throw "robocopy failed ($LASTEXITCODE): $Source -> $Destination" }
    return $true
}

function Copy-FileTo {
    param([string] $Source, [string] $Destination)
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { return $false }
    $dir = Split-Path -Parent $Destination
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
    return $true
}

$report = [ordered]@{}
Reset-Stage

# -- Revit ------------------------------------------------------------------
# build\plugin-zip\Rxx is flat; Revit expects <year>\RvtMcp.Rxx.addin plus a
# sibling RvtMcp folder with the payload (see the .addin Assembly path).
$revitSource = Join-Path $RepoRoot 'rvt-mcp-master\build\plugin-zip'
$revitCount = 0
if (Test-Path -LiteralPath $revitSource) {
    foreach ($folder in @(Get-ChildItem -LiteralPath $revitSource -Directory)) {
        if ($folder.Name -notmatch '^R(\d{2})$') { continue }
        $year = '20' + $Matches[1]
        $target = Join-Path $Stage "Revit\$year"
        $payload = Join-Path $target 'RvtMcp'
        New-Item -ItemType Directory -Path $payload -Force | Out-Null

        $addin = Get-ChildItem -LiteralPath $folder.FullName -File -Filter '*.addin' | Select-Object -First 1
        if ($addin) { Copy-Item -LiteralPath $addin.FullName -Destination $target -Force }

        foreach ($item in @(Get-ChildItem -LiteralPath $folder.FullName -Force)) {
            if ($item.Name -like '*.addin') { continue }
            if ($item.PSIsContainer) {
                Copy-Tree -Source $item.FullName -Destination (Join-Path $payload $item.Name) | Out-Null
            }
            else {
                Copy-Item -LiteralPath $item.FullName -Destination $payload -Force
            }
        }
        $revitCount++
    }
}
$report['Revit'] = if ($revitCount -gt 0) { "$revitCount version(s)" } else { 'missing (rvt-mcp-master\build\plugin-zip)' }

# -- Navisworks -------------------------------------------------------------
$navisSource = Join-Path $RepoRoot 'NavisWorksMaster-main\NavisHelper.bundle'
$navisTarget = Join-Path $Stage 'Navisworks\NavisHelper.bundle'
$navisOk = Copy-Tree -Source $navisSource -Destination $navisTarget
$report['Navisworks'] = if ($navisOk) { 'ok' } else { 'missing (NavisWorksMaster-main\NavisHelper.bundle)' }

# -- Civil 3D ---------------------------------------------------------------
# A Civil 3D bundle needs Contents\<year>\Civil3DMcpPlugin.dll. The source
# project requires licensed Civil 3D references; only package it when a built
# DLL exists, never an XML-only stub.
$civilBuilds = @(
    @{ Path = (Join-Path $RepoRoot 'Civil3D-mcp-main\Civil3D-MCP-Plugin\bin\Release\net10.0-windows'); Years = @('2026', '2027') },
    @{ Path = (Join-Path $RepoRoot 'Civil3D-mcp-main\Civil3D-MCP-Plugin\bin\Release\net8.0-windows');  Years = @('2025') },
    @{ Path = (Join-Path $RepoRoot 'Civil3D-mcp-main\Civil3D-MCP-Plugin\bin\Release\net8.0');          Years = @('2025') }
)
$civilTarget = Join-Path $Stage 'Civil3D\MCPCivil3D.bundle'
$civilYears = @()
foreach ($build in $civilBuilds) {
    if (-not (Test-Path -LiteralPath $build.Path -PathType Container)) { continue }
    $dll = Get-ChildItem -LiteralPath $build.Path -File -Filter 'Civil3DMcpPlugin.dll' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $dll) { continue }
    foreach ($year in $build.Years) {
        $versionDir = Join-Path $civilTarget "Contents\$year"
        New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
        Copy-Item -LiteralPath $dll.FullName -Destination $versionDir -Force
        $civilYears += $year
    }
}
if ($civilYears.Count -gt 0) {
    $xml = Join-Path $RepoRoot 'Civil3D-mcp-main\Civil3D-MCP-Plugin\PackageContents.xml'
    if (Test-Path -LiteralPath $xml) { Copy-Item -LiteralPath $xml -Destination $civilTarget -Force }
    $report['Civil3D'] = "ok ($($civilYears -join ', '))"
}
else {
    $report['Civil3D'] = 'MISSING - build Civil3D-MCP-Plugin with Civil 3D references first'
}

# -- AutoCAD ----------------------------------------------------------------
$acadSource = Join-Path $ROAM 'Autodesk\ApplicationPlugins\MCPAutoCAD.bundle'
$acadTarget = Join-Path $Stage 'AutoCAD\MCPAutoCAD.bundle'
$acadOk = Copy-Tree -Source $acadSource -Destination $acadTarget
$report['AutoCAD'] = if ($acadOk) { 'ok' } else { 'missing (install MCPAutoCAD.bundle or pass a source)' }

# -- Rhino ------------------------------------------------------------------
$rhinoBin = Join-Path $RepoRoot 'rhino-mcp-main\rhino_plugin\csharp\bin\Release\net8.0'
$rhinoTarget = Join-Path $Stage 'Rhino'
$rhinoOk = $false
if (Test-Path -LiteralPath $rhinoBin) {
    New-Item -ItemType Directory -Path $rhinoTarget -Force | Out-Null
    foreach ($name in @('rhino-mcp.rhp', 'Newtonsoft.Json.dll')) {
        if (Copy-FileTo -Source (Join-Path $rhinoBin $name) -Destination (Join-Path $rhinoTarget $name)) { $rhinoOk = $true }
    }
}
$report['Rhino'] = if ($rhinoOk) { 'ok' } else { 'missing (rhino-mcp-main ...\rhino-mcp.rhp)' }

# -- SketchUp ---------------------------------------------------------------
$skpSource = Join-Path $RepoRoot 'Sketchup MCP\sketchup-mcp-main\mcpb\dist\su_mcp-1.3.0.rbz'
$skpTarget = Join-Path $Stage 'SketchUp\su_mcp-1.3.0.rbz'
$skpOk = Copy-FileTo -Source $skpSource -Destination $skpTarget
$report['SketchUp'] = if ($skpOk) { 'ok' } else { 'missing (su_mcp-1.3.0.rbz)' }

# -- Report -----------------------------------------------------------------
Write-Host "`nHost add-in staging report:" -ForegroundColor Cyan
foreach ($key in $report.Keys) {
    $value = $report[$key]
    $color = if ($value -like 'ok*' -or $value -like '*version*') { 'Green' } else { 'Yellow' }
    Write-Host ("  {0,-12} {1}" -f $key, $value) -ForegroundColor $color
}

if ($SkipZip) { return }

$zipPath = Join-Path $OutRoot 'pinnacle-host-addins.zip'
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $zipPath -Force
$size = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1MB, 1)
Write-Host "`n  [ok] $zipPath ($size MB)" -ForegroundColor Green
Write-Host "  Upload this file to the GitHub release as 'pinnacle-host-addins.zip'." -ForegroundColor DarkGray
