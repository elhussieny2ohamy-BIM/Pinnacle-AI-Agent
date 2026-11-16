#!/usr/bin/env pwsh
# =============================================================================
# مرحلة التشغيلات (Runtimes) — يتحقق وينصب Node.js, .NET Runtime, uv/Python
# =============================================================================

function Test-Command {
    param([string] $Name)
    return (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue) -ne $null
}

function Test-Node {
    return (Test-Command 'node') -and (node --version 2>$null -match '^v\d+\.\d+')
}

function Test-DotNet {
    return (Test-Command 'dotnet') -and (dotnet --version 2>$null -match '^\d+\.\d+')
}

function Test-Uv {
    return (Test-Command 'uv')
}

# ── تنصيب Node.js إن لم يوجد ──
function Install-Node {
    param([switch] $WhatIf)

    if (Test-Node) {
        Write-Host "  ✓ Node.js موجود بالفعل: $(node --version)" -ForegroundColor Green
        return
    }

    Write-Host "  ✗ Node.js غير مثبت — جاري التنزيل من nodejs.org ..." -ForegroundColor Yellow
    $nodeUrl = 'https://nodejs.org/dist/v20.11.1/node-v20.11.1-x64.msi'
    $msiPath = Join-Path $env:TEMP 'node-installer.msi'

    if ($WhatIf) {
        Write-Host "  [WhatIf] سيُحمل Node.js من: $nodeUrl ويُثبت بصمت" -ForegroundColor Gray
        return
    }

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -TimeoutSec 300
        & msiexec.exe /i $msiPath /quiet /norestart
        if ($LASTEXITCODE -ne 0) { throw "فشل تثبيت Node.js (كود $LASTEXITCODE)" }
        Write-Host "  ✓ تم تثبيت Node.js بنجاح" -ForegroundColor Green
    }
    catch {
        Write-Error "فشل تنزيل/تثبيت Node.js: $_"
        throw
    }
}

# ── تنصيب .NET Runtime إن لم يوجد ──
function Install-DotNet {
    param([switch] $WhatIf)

    if (Test-DotNet) {
        Write-Host "  ✓ .NET موجود بالفعل: $(dotnet --version)" -ForegroundColor Green
        return
    }

    Write-Host "  ✗ .NET Runtime غير مثبت — جاري التنزيل ..." -ForegroundColor Yellow
    $dotnetUrl = 'https://download.visualstudio.microsoft.com/download/pr/8c2e0f1c-8f2d-4e5a-9b3c-7d1e6f5a4b3c/dotnet-runtime-8.0.0-win-x64.exe'

    if ($WhatIf) {
        Write-Host "  [WhatIf] سيُحمل .NET Runtime من: $dotnetUrl ويُثبت بصمت" -ForegroundColor Gray
        return
    }

    try {
        $exePath = Join-Path $env:TEMP 'dotnet-installer.exe'
        Invoke-WebRequest -Uri $dotnetUrl -OutFile $exePath -TimeoutSec 600
        & $exePath /quiet /norestart
        if ($LASTEXITCODE -ne 0) { throw "فشل تثبيت .NET Runtime (كود $LASTEXITCODE)" }
        Write-Host "  ✓ تم تثبيت .NET Runtime بنجاح" -ForegroundColor Green
    }
    catch {
        Write-Error "فشل تنزيل/تثبيت .NET Runtime: $_"
        throw
    }
}

# ── تنصيب uv (Python tool manager) إن لم يوجد ──
function Install-Uv {
    param([switch] $WhatIf)

    if (Test-Uv) {
        Write-Host "  ✓ uv موجود بالفعل: $(uv --version 2>$null)" -ForegroundColor Green
        return
    }

    Write-Host "  ✗ uv غير مثبت — جاري التنزيل من astral.sh ..." -ForegroundColor Yellow

    if ($WhatIf) {
        Write-Host "  [WhatIf] سيُحمل uv وتُثبت أداوت Python (autocad-mcp, rhino3dm-mcp)" -ForegroundColor Gray
        return
    }

    try {
        # offizielle установка uv عبر PowerShell
        $installScript = 'https://astral.sh/uv/install.ps1'
        Invoke-WebRequest -Uri $installScript -OutFile (Join-Path $env:TEMP 'uv-install.ps1') -TimeoutSec 120
        & (Join-Path $env:TEMP 'uv-install.ps1')
        if ($LASTEXITCODE -ne 0) { throw "فشل تثبيت uv (كود $LASTEXITCODE)" }

        # إعادة تحميل PATH ليشمل uv
        $env:PATH = [Environment]::GetEnvironmentVariable('PATH', [EnvironmentVariableTarget]::User) + ';' +
                    [Environment]::GetEnvironmentVariable('PATH', [EnvironmentVariableTarget]::Machine)

        if (-not (Test-Uv)) { throw 'uv لم يتم إضافته إلى PATH بعد التثبيت' }
        Write-Host "  ✓ تم تثبيت uv بنجاح" -ForegroundColor Green
    }
    catch {
        Write-Error "فشل تثبيت uv: $_"
        throw
    }
}

# ── الدالة الرئيسية للمرحلة ──
function Install-Runtimes {
    param([switch] $WhatIf)

    Write-Host "  [1/3] Node.js ..." -ForegroundColor DarkCyan
    Install-Node -WhatIf:$WhatIf

    Write-Host "  [2/3] .NET Runtime ..." -ForegroundColor DarkCyan
    Install-DotNet -WhatIf:$WhatIf

    Write-Host "  [3/3] uv (Python tool manager) ..." -ForegroundColor DarkCyan
    Install-Uv -WhatIf:$WhatIf

    Write-Host "  ✓ جميع التشغيلات جاهزة" -ForegroundColor Green
}
