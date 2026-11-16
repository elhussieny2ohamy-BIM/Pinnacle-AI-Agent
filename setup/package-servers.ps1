#!/usr/bin/env pwsh
# =============================================================================
# سكريبت تحزيم خوادم MCP للرفع على GitHub Releases
# =============================================================================
# يجمع الملفات المثبتة على جهازك ويحولها إلى ملفات zip باسماء متوافقة مع setup/servers.ps1
# مسار الإخراج: ./release-assets/ (تُرفع هذه الملفات كـ Assets في Release GitHub)
# =============================================================================
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch] $WhatIf,
    [string] $OutputDir = 'release-assets'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = (Get-Item $PSScriptRoot).Parent.FullName
$OutDir   = Join-Path $RepoRoot $OutputDir
$LOCAL    = $env:LOCALAPPDATA
$ROAM     = $env:APPDATA
$USER     = $env:USERPROFILE

# تعريف الحزم: مصدر على الجهاز → اسم ملف الـ zip في release
$script:Packages = @(
    @{
        Name      = 'rvt'
        Label     = 'Revit MCP Server'
        Source    = Join-Path $LOCAL 'Bimwright\rvt-mcp\server\current'
        ZipName   = 'rvt-mcp-server.zip'
    },
    @{
        Name      = 'navis'
        Label     = 'Navisworks MCP Server'
        Source    = Join-Path $LOCAL 'NavisHelper\McpServer'
        ZipName   = 'NavisHelper.McpServer.zip'
    },
    @{
        Name      = 'navis-alt'
        Label     = 'Navisworks MCP Server (alt)'
        Source    = Join-Path $LOCAL 'Navisworks MCP\McpServer'
        ZipName   = 'NavisHelper.McpServer-alt.zip'
    },
    @{
        Name      = 'civil3d'
        Label     = 'Civil 3D MCP Server'
        Source    = Join-Path $ROAM 'MCP Civil 3D'
        ZipName   = 'civil3d-mcp.zip'
    },
    @{
        Name      = 'sketchup'
        Label     = 'SketchUp MCP Server'
        Source    = Join-Path $LOCAL 'Programs\SketchUp MCP\server'
        ZipName   = 'sketchup-mcp-server.zip'
    }
)

function Compress-Folder {
    param([string] $SourceFolder, [string] $ZipPath)

    if (-not (Test-Path -LiteralPath $SourceFolder -PathType Container)) {
        Write-Host "  ⚠ المجلد غير موجود، يُتخطى: $SourceFolder" -ForegroundColor Yellow
        return $false
    }

    if (-not (Test-Path -LiteralPath (Split-Path -Parent $ZipPath) -PathType Container)) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $ZipPath) -Force | Out-Null
    }

    if (Test-Path -LiteralPath $ZipPath -PathType Leaf) {
        Remove-Item -LiteralPath $ZipPath -Force
    }

    if ($WhatIf) {
        Write-Host "  [WhatIf] سيُضغط: $SourceFolder → $ZipPath" -ForegroundColor Gray
        return $true
    }

    try {
        Compress-Archive -Path "$SourceFolder\*" -DestinationPath $ZipPath -Force
        $size = [math]::Round(((Get-Item -LiteralPath $ZipPath).Length) / 1MB, 2)
        Write-Host "  ✓ تم الإنشاء: $ZipPath ($size MB)" -ForegroundColor Green
        return $true
    }
    catch {
        Write-Error "فشل ضغط $SourceFolder: $_"
        return $false
    }
}

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  تحزيم خوادم MCP لإصدار GitHub Release" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host " مخرج الملفات: $OutDir"
if ($WhatIfPreference.IsPresent -or $WhatIf) { Write-Host " ★ وضع تجربة فقط (-WhatIf)" -ForegroundColor Yellow }
Write-Host ""

if (-not $WhatIf) {
    if (-not (Test-Path -LiteralPath $OutDir -PathType Container)) {
        New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
    }
}

$success = 0
$failed  = 0

foreach ($pkg in $script:Packages) {
    Write-Host "  ▶ $($pkg.Label) ..." -ForegroundColor Cyan
    $zipPath = Join-Path $OutDir $pkg.ZipName
    if (Compress-Folder -SourceFolder $pkg.Source -ZipPath $zipPath -WhatIf:$WhatIf) {
        $success++
    }
    else {
        $failed++
    }
}

Write-Host ""
Write-Host "========================================================" -ForegroundColor Cyan
if ($failed -eq 0) {
    Write-Host "  اكتمل التحزيم بنجاح — $success ملف zip جاهز للرفع على GitHub Releases" -ForegroundColor Green
}
else {
    Write-Host "  اكتمل مع أخطاء — $success نجح، $failed فشل" -ForegroundColor Yellow
}
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "الخطوة التالية:" -ForegroundColor DarkCyan
Write-Host "  1. اذهب إلى https://github.com/elhussieny2ohamy-BIM/Pinnacle-AI-Agent/releases/new"
Write-Host "  2. أنشئ إصداراً جديداً (مثلاً v1.0.0)"
Write-Host "  3. ارفع كل ملف zip من مجلد $OutDir كـ Release Assets"
Write-Host "  4. عدّل setup/servers.ps1 بحيث يتطابق $script:ReleaseAssets مع أسماء الملفات والتاج"
Write-Host ""
