#!/usr/bin/env pwsh
# =============================================================================
# مرحلة الإضافات (Plugins) — يحقن إضافات MCP داخل البرامج المضيفة
# =============================================================================
# للبرامج التي تحتاج إضافة داخلية (ليست خادم مستقل):
#   Revit      → rvt-mcp plugin
#   Rhino      → rhino3dm-mcp bridge
#   SketchUp   → sketchup MCP extension
#   Civil 3D   → civil3d MCP bridge
#   Navisworks → NavisHelper plugin
# =============================================================================

$PROGRAMFILES = $env:ProgramW6432
$LOCAL        = $env:LOCALAPPDATA
$ROAM         = $env:APPDATA

# قائمة البرامج المضيفة ومساراتها المحتملة
$script:HostApps = @(
    @{
        Name       = 'Revit'
        Process    = 'Revit.exe'
        SearchRoots = @(
            Join-Path $PROGRAMFILES 'Autodesk\Revit 2025'
            Join-Path $PROGRAMFILES 'Autodesk\Revit 2026'
            Join-Path $PROGRAMFILES 'Autodesk\Revit 2027'
        )
        ExeName    = 'Revit.exe'
        PluginSrc  = Join-Path $PSScriptParent 'rvt-mcp-master'
        PluginDest = Join-Path $LOCAL 'Bimwright\rvt-mcp\plugins'
    },
    @{
        Name       = 'Rhino'
        Process    = 'Rhino.exe'
        SearchRoots = @(
            Join-Path $PROGRAMFILES 'McNeel\Rhinoceros\7\System'
            Join-Path $PROGRAMFILES 'McNeel\Rhinoceros\8\System'
        )
        ExeName    = 'Rhino.exe'
        PluginSrc  = Join-Path $PSScriptParent 'rhino-mcp-main'
        PluginDest = Join-Path $LOCAL 'MCP Rhino'
    },
    @{
        Name       = 'SketchUp'
        Process    = 'SketchUp.exe'
        SearchRoot = Join-Path $PROGRAMFILES 'SketchUp'
        ExeName    = 'SketchUp.exe'
        PluginSrc  = Join-Path $PSScriptParent 'Sketchup MCP'
        PluginDest = Join-Path $LOCAL 'Programs\SketchUp MCP'
    },
    @{
        Name       = 'Civil 3D'
        Process    = 'acad.exe'
        SearchRoots = @(
            Join-Path $PROGRAMFILES 'Autodesk\AutoCAD 2026'
        )
        ExeName    = 'acad.exe'
        PluginSrc  = Join-Path $PSScriptParent 'Civil3D-mcp-main'
        PluginDest = Join-Path $ROAM 'MCP Civil 3D'
    },
    @{
        Name       = 'Navisworks'
        Process    = 'Roamer.exe'
        SearchRoots = @(
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Manage 2024',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Manage 2025',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Manage 2026',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Manage 2027',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Simulate 2024',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Simulate 2025',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Simulate 2026',
            Join-Path $PROGRAMFILES 'Autodesk\Navisworks Simulate 2027'
        )
        ExeName    = 'Roamer.exe'
        PluginSrc  = Join-Path $PSScriptParent 'NavisWorksMaster-main'
        PluginDest = Join-Path $LOCAL 'NavisHelper'
    }
)

$script:PSScriptParent = (Get-Item $PSScriptRoot).Parent.FullName

# ── البحث عن مسار برنامج مضيف ──
function Find-HostApp {
    param([hashtable] $App)

    foreach ($root in $App.SearchRoots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $exe = Join-Path $root $App.ExeName
        if (Test-Path -LiteralPath $exe -PathType Leaf) {
            return @{ Root = $root; Exe = $exe }
        }
    }
    return $null
}

# ── نسخ ملفات الإضافة إلى وجهتها ──
function Copy-PluginFiles {
    param([string] $Source, [string] $Destination)

    if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
        Write-Host "    ⚠ مصدر الإضافة غير موجود: $Source — يُتخطى" -ForegroundColor Yellow
        return $false
    }

    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }

    Get-ChildItem -LiteralPath $Source -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        $relPath = $_.FullName.Substring($Source.Length)
        $destFile = Join-Path $Destination $relPath
        $destDir  = Split-Path -Parent $destFile
        if (-not (Test-Path -LiteralPath $destDir -PathType Container)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $_.FullName -Destination $destFile -Force
    }

    return $true
}

# ── الدالة الرئيسية للمرحلة ──
function Install-Plugins {
    param(
        [string] $RepoRoot,
        [switch] $WhatIf
    )

    foreach ($app in $script:HostApps) {
        Write-Host "  ▶ إضافة $($app.Name) ..." -ForegroundColor Cyan

        $found = Find-HostApp -App $app
        if (-not $found) {
            Write-Host "    ⚠ برنامج $($app.Name) غير مثبت على هذا الجهاز — يُتخطى" -ForegroundColor Yellow
            continue
        }

        Write-Host "    وُجد البرنامج: $($found.Exe)" -ForegroundColor Green

        if ($WhatIf) {
            Write-Host "    [WhatIf] سيُنسخ ملفات الإضافة من $($app.PluginSrc) إلى: $($app.PluginDest)" -ForegroundColor Gray
            continue
        }

        $ok = Copy-PluginFiles -Source $app.PluginSrc -Destination $app.PluginDest
        if ($ok) {
            Write-Host "    ✓ تم تثبيت إضافة $($app.Name) في: $($app.PluginDest)" -ForegroundColor Green
        }
    }

    Write-Host "  ✓ فحص الإضافات اكتمل" -ForegroundColor Green
}
