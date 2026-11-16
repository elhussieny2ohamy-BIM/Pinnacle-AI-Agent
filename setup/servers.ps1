#!/usr/bin/env pwsh
# =============================================================================
# مرحلة الخوادم (Servers) — ينزل ملفات MCP من GitHub Releases ويخوّنها في مكانها
# =============================================================================
# كل خادم له:
#   - AssetName: اسم الملف في Release Assets
#   - Destination: المسار النهائي على الجهاز (per-user، لا مسار صلب للقرص)
#   - InstallType: 'file' (نسخة مباشرة) | 'uv' (يُثبت عبر uv tool) | 'zip' (يُفك ويُنقل)
# =============================================================================

# إعدادات التحميل (تُحدّث عند كل إصدار جديد)
$script:ReleaseAssets = @(
    @{
        Name         = 'rvt'
        DisplayName  = 'Revit MCP'
        AssetName    = 'rvt-mcp-server.zip'
        Destination  = Join-Path $env:LOCALAPPDATA 'Bimwright\rvt-mcp\server\current'
        InstallType  = 'zip'
        Executable   = 'rvt-mcp.exe'
    },
    @{
        Name         = 'navis'
        DisplayName  = 'Navisworks MCP'
        AssetName    = 'NavisHelper.McpServer.zip'
        Destination  = Join-Path $env:LOCALAPPDATA 'NavisHelper\McpServer'
        InstallType  = 'zip'
        Executable   = 'NavisHelper.McpServer.exe'
    },
    @{
        Name         = 'civil3d'
        DisplayName  = 'Civil 3D MCP'
        AssetName    = 'civil3d-mcp.zip'
        Destination  = Join-Path $env:APPDATA 'MCP Civil 3D'
        InstallType  = 'zip'
        Executable   = 'index.js'
    },
    @{
        Name         = 'sketchup'
        DisplayName  = 'SketchUp MCP'
        AssetName    = 'sketchup-mcp-server.zip'
        Destination  = Join-Path $env:LOCALAPPDATA 'Programs\SketchUp MCP\server'
        InstallType  = 'zip'
        Executable   = 'index.mjs'
    },
    @{
        Name         = 'autocad'
        DisplayName  = 'AutoCAD MCP'
        AssetName    = $null
        Destination  = Join-Path $env:USERPROFILE '.local\bin'
        InstallType  = 'uv'
        Package      = 'autocad-mcp-pro==1.8.0'
        Executable   = 'autocad-mcp.exe'
    },
    @{
        Name         = 'rhino'
        DisplayName  = 'Rhino MCP'
        AssetName    = $null
        Destination  = Join-Path $env:USERPROFILE '.local\bin'
        InstallType  = 'uv'
        Package      = 'rhino3dm-mcp==0.7.0'
        Executable   = 'rhino-mcp.exe'
    }
)

# ── دالة التحميل مع إعادة المحاولة ──
function Download-ReleaseAsset {
    param(
        [string] $Tag,
        [string] $Repo,
        [string] $AssetName,
        [string] $OutPath
    )

    $url = "https://github.com/$Repo/releases/download/$Tag/$AssetName"
    Write-Host "    تحميل: $AssetName" -ForegroundColor DarkCyan

    $attempt = 0
    $maxAttempts = 3
    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            Invoke-WebRequest -Uri $url -OutFile $OutPath -TimeoutSec 600 -ErrorAction Stop
            return $true
        }
        catch {
            Write-Host "    محاولة $attempt/$maxAttempts فشلت: $($_.Exception.Message)" -ForegroundColor Yellow
            if ($attempt -eq $maxAttempts) {
                Write-Error "فشل تحميل $AssetName بعد $maxAttempts محاولات"
                return $false
            }
            Start-Sleep -Seconds 5
        }
    }
    return $false
}

# ── دالة فك الضغط(zip) ──
function Expand-ZipFile {
    param([string] $ZipPath, [string] $DestDir)

    if (-not (Test-Path -LiteralPath $DestDir -PathType Container)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    }

    # استخدام PowerShell 7 expand-archive أو .NET كبديل
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force -ErrorAction Stop
    }
    catch {
        # بديل لـ PowerShell 5.1
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestDir, $true)
    }
}

# ── الدالة الرئيسية ──
function Install-Servers {
    param(
        [string] $RepoRoot,
        [string] $Tag = 'latest',
        [string] $GitHubRepo,
        [switch] $WhatIf
    )

    if ($Tag -eq 'latest') {
        Write-Host "    ملاحظة: '-latest' يحتاج استعلام GitHub API للتأكد من التاج الفعلي" -ForegroundColor Yellow
        # في وضع التطوير، يستخدم المستخدم التاج الصريح. للإنتاج، يُستبدل بالتاج الحقيقي.
    }

    foreach ($server in $script:ReleaseAssets) {
        Write-Host "  ▶ $($server.DisplayName) ($($server.Name)) ..." -ForegroundColor Cyan

        switch ($server.InstallType) {
            'zip' {
                Install-ServerZip -Server $server -Tag $Tag -Repo $GitHubRepo -WhatIf:$WhatIf
            }
            'uv' {
                Install-ServerUv -Server $server -WhatIf:$WhatIf
            }
        }
    }

    Write-Host "  ✓ جميع الخوادم مثبتة في مواقعها القياسية" -ForegroundColor Green
}

function Install-ServerZip {
    param(
        [hashtable] $Server,
        [string] $Tag,
        [string] $Repo,
        [switch] $WhatIf
    )

    $destDir = $Server.Destination
    $exePath = Join-Path $destDir $Server.Executable

    # إذا الملف موجود بالفعل، نتخطى (يدعم إعادة التشغيل بأمان)
    if (Test-Path -LiteralPath $exePath -PathType Leaf) {
        Write-Host "    ✓ موجود بالفعل: $exePath" -ForegroundColor Green
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] سيُحمل $($Server.AssetName) ويُفك في: $destDir" -ForegroundColor Gray
        return
    }

    $zipPath = Join-Path $env:TEMP "$($Server.Name)-server.zip"
    if (-not (Download-ReleaseAsset -Tag $Tag -Repo $Repo -AssetName $Server.AssetName -OutPath $zipPath)) {
        throw "فشل تحميل خادم $($Server.DisplayName)"
    }

    try {
        Expand-ZipFile -ZipPath $zipPath -DestDir $destDir
        Write-Host "    ✓ تم فك الضغط في: $destDir" -ForegroundColor Green
    }
    catch {
        Write-Error "فشل فك ضغط $($Server.AssetName): $_"
        throw
    }
    finally {
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    }
}

function Install-ServerUv {
    param(
        [hashtable] $Server,
        [switch] $WhatIf
    )

    $binDir = $Server.Destination
    $exePath = Join-Path $binDir $Server.Executable

    if (Test-Path -LiteralPath $exePath -PathType Leaf) {
        Write-Host "    ✓ موجود بالفعل: $exePath" -ForegroundColor Green
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] سيُثبت $($Server.Package) عبر uv في: $binDir" -ForegroundColor Gray
        return
    }

    # تأكد من وجود uv
    $uv = Get-Command 'uv' -ErrorAction SilentlyContinue
    if (-not $uv) { throw 'uv غير مثبت — لا يمكن تثبيت الخوادم من نوع uv' }

    try {
        Write-Host "    جاري التثبيت عبر uv: $($Server.Package) ..." -ForegroundColor DarkCyan
        & $uv.Source tool install --upgrade --from $($Server.Package) $($Server.Name.Split('-')[0])
        if ($LASTEXITCODE -ne 0) { throw "فشل تثبيت $($Server.Package) (كود $LASTEXITCODE)" }

        # التحقق من وجود الملف النافذ
        if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
            # uv قد يضع الملف باسم مختلف قليلاً، نبحث في bin dir
            $found = Get-ChildItem -Path $binDir -Filter "*$($Server.Name)*" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($found) { Write-Host "    ✓ تم التثبيت (ملف موجود: $($found.Name))" -ForegroundColor Green }
            else { throw "تم التثبيت لكن الملف النافذ غير موجود: $exePath" }
        }
        else {
            Write-Host "    ✓ تم التثبيت: $exePath" -ForegroundColor Green
        }
    }
    catch {
        Write-Error "فشل تثبيت $($Server.Package) عبر uv: $_"
        throw
    }
}

Export-ModuleMember -Function Install-Servers
