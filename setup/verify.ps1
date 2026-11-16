#!/usr/bin/env pwsh
# =============================================================================
# مرحلة الفحص (Verify) — يختبر إن كل خوادم MCP شغال قبل ما السكربت يخلص
# =============================================================================

function Test-FileReady {
    param([string] $Path, [string] $Name)
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        $size = [math]::Round(((Get-Item -LiteralPath $Path).Length) / 1MB, 2)
        Write-Host "  ✓ $Name جاهز ($size MB): $Path" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "  ✗ $Name غير موجود: $Path" -ForegroundColor Red
        return $false
    }
}

function Test-CommandReady {
    param([string] $Name, [string] $Label)
    if (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue) {
        Write-Host "  ✓ $Label متاح: $Name" -ForegroundColor Green
        return $true
    }
    else {
        Write-Host "  ✗ $Label غير موجود في PATH: $Name" -ForegroundColor Red
        return $false
    }
}

function Verify-Servers {
    param([switch] $WhatIf)

    $allOk = $true
    $LOCAL = $env:LOCALAPPDATA
    $ROAM  = $env:APPDATA
    $USER  = $env:USERPROFILE

    Write-Host "`nفحص توافر كل خادم MCP:" -ForegroundColor Cyan

    # 1) Revit
    $rvtOk = Test-FileReady -Path (Join-Path $LOCAL 'Bimwright\rvt-mcp\server\current\rvt-mcp.exe') -Name 'Revit MCP'

    # 2) Navisworks
    $navisOk = Test-FileReady -Path (Join-Path $LOCAL 'NavisHelper\McpServer\NavisHelper.McpServer.exe') -Name 'Navisworks MCP'

    # 3) Civil 3D
    $c3dOk = Test-FileReady -Path (Join-Path $ROAM 'MCP Civil 3D\index.js') -Name 'Civil 3D MCP'

    # 4) SketchUp
    $skpOk = Test-FileReady -Path (Join-Path $LOCAL 'Programs\SketchUp MCP\server\index.mjs') -Name 'SketchUp MCP'

    # 5) AutoCAD (via uv)
    $acadOk = Test-FileReady -Path (Join-Path $USER '.local\bin\autocad-mcp.exe') -Name 'AutoCAD MCP'

    # 6) Rhino (via uv)
    $rhinoOk = Test-FileReady -Path (Join-Path $USER '.local\bin\rhino-mcp.exe') -Name 'Rhino MCP'

    # التشغيلات المطلوبة
    Write-Host "`nفحص التشغيلات المطلوبة:" -ForegroundColor Cyan
    $nodeOk = Test-CommandReady -Name 'node' -Label 'Node.js'
    $dotnetOk = Test-CommandReady -Name 'dotnet' -Label '.NET Runtime'
    $uvOk = Test-CommandReady -Name 'uv' -Label 'uv (Python)'

    $allOk = $rvtOk -and $navisOk -and $c3dOk -and $skpOk -and $acadOk -and $rhinoOk -and $nodeOk -and $dotnetOk -and $uvOk

    Write-Host ""
    if ($allOk) {
        Write-Host "========================================================" -ForegroundColor Green
        Write-Host "  جميع الخوادم والتشغيلات جاهزة ✓" -ForegroundColor Green
        Write-Host "========================================================" -ForegroundColor Green
    }
    else {
        Write-Host "========================================================" -ForegroundColor Red
        Write-Host "  بعض الخوادم ناقصة — راجع العلامات ✗ أعلاه" -ForegroundColor Red
        Write-Host "========================================================" -ForegroundColor Red
        if (-not $WhatIf) { exit 1 }
    }
}
