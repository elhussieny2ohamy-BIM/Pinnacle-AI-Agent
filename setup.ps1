#!/usr/bin/env pwsh
# =============================================================================
# PINNACLE AI AGENT — MCP Servers Comprehensive Setup
# =============================================================================
# هذا السكربت يثبت كل خوادم الـ MCP (Revit, Navisworks, AutoCAD, Civil 3D, Rhino, SketchUp)
# على الجهاز الحالي من غير ما المستخدم يسطّب حاجة بره.
#
# المراحل:
#   1) runtime   → يتحقق وينصب Node.js, .NET Runtime, uv/Python
#   2) servers   → ينزل ملفات السيرفرات من GitHub Releases ويخوّنها في مكانها
#   3) plugins   → يحقن الإضافات داخل البرامج (Revit, Rhino, SketchUp, Civil3D, Navis)
#   4) verify    → يختبر إن كل MCP شغال قبل ما يخلص
#
# تشغيل:
#   .\setup.ps1                    # التثبيت الطبيعي (يطلب تأكيد لكل مرحلة)
#   .\setup.ps1 -WhatIf            # يشوف هي ejecut إيه من غير ما يثبت فعلياً
#   .\setup.ps1 -SkipServers       # يتخطى تنزيل السيرفرات (إذا كانت موجودة بالفعل)
#   .\setup.ps1 -SkipPlugins       # يتخطى حقن الإضافات
# =============================================================================
[CmdletBinding()]
param(
    [switch] $WhatIf,
    [switch] $SkipRuntimes,
    [switch] $SkipServers,
    [switch] $SkipPlugins,
    [switch] $SkipClients,
    [switch] $SkipVerify,
    [switch] $ForceClientConfig,             # يحدّث إعدادات MCP الموجودة بدل الحفاظ عليها
    [string] $InstallDir = '',               # مجلد التثبيت (من الـ EXE) — افتراضي: مجلد السكربت
    [string] $BundledAssetsDir = '',         # مجلد release-assets المضمّن (للتثبيت دون إنترنت)
    [string] $AddinsDir = '',                # مجلد الإضافات المحلي (addins) — افتراضي: البحث التلقائي
    [string] $LogPath = '',                  # مسار سجل التشغيل (يُستخدم في وضع التثبيت الصامت)
    [string] $ReleaseTag = 'latest',          # التاج اللي يتم التنزيل منه على GitHub Releases
    [string] $GitHubRepo = 'elhussieny2ohamy-BIM/Pinnacle-AI-Agent'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Make Arabic console output readable when the host supports UTF-8.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
}
catch { }

$ScriptDir = Get-Item -Path $PSScriptRoot
# When invoked from the repo/app root, stage files live in .\setup; when invoked
# from inside .\setup they sit beside this script.
$SetupDir  = if (Test-Path -LiteralPath (Join-Path $ScriptDir.FullName 'runtime.ps1') -PathType Leaf) {
    $ScriptDir.FullName
}
else {
    Join-Path $ScriptDir.FullName 'setup'
}
$RepoRoot  = if ($InstallDir) { (Resolve-Path -LiteralPath $InstallDir).Path } else { $ScriptDir.FullName }

# Prefer the bundled offline assets when the repo/installer ships them.
if (-not $BundledAssetsDir) {
    $defaultAssets = Join-Path $RepoRoot 'release-assets'
    if (Test-Path -LiteralPath $defaultAssets -PathType Container) { $BundledAssetsDir = $defaultAssets }
}

# Optional transcript so the silent EXE install leaves a readable log.
$script:TranscriptStarted = $false
if ($LogPath) {
    try {
        Start-Transcript -Path $LogPath -Append -Force | Out-Null
        $script:TranscriptStarted = $true
    }
    catch {
        Write-Warning "Could not start transcript at $LogPath : $($_.Exception.Message)"
    }
}

# ── مسارات الثوابت (per-user، لا مسار صلب للقرص) ──
$LOCAL = $env:LOCALAPPDATA
$ROAM  = $env:APPDATA
$USER  = $env:USERPROFILE

# ── حالات المراحل ──
$stages = [ordered]@{
    runtime  = @{ label = 'التحقق من التشغيلات (Node, .NET, uv)'; enabled = -not $SkipRuntimes }
    servers  = @{ label = 'تنزيل وتثبيت خوادم MCP';            enabled = -not $SkipServers  }
    plugins  = @{ label = 'حقن الإضافات داخل البرامج';        enabled = -not $SkipPlugins  }
    clients  = @{ label = 'تكوين عملاء MCP (Claude / ChatGPT / PINNACLE)'; enabled = -not $SkipClients }
    verify   = @{ label = 'فحص تشغيل الخوادم (smoke test)';   enabled = -not $SkipVerify   }
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  PINNACLE AI AGENT — MCP Servers Comprehensive Setup" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " المجلد الجذر: $RepoRoot"
Write-Host " الطور:        $ReleaseTag"
Write-Host " المستودع:    $GitHubRepo"
if ($WhatIf) { Write-Host " ★ وضع تجربة فقط (-WhatIf) — لن يتم تعديل أي ملف" -ForegroundColor Yellow }
Write-Host ""

# ── دالة مساعدة لتشغيل مرحلة ──
function Invoke-Stage {
    param([string] $Name, [string] $Label, [scriptblock] $Script)
    if (-not $stages[$Name].enabled) {
        Write-Host "⏭️  تُخطّى: $Label" -ForegroundColor Gray
        return
    }
    Write-Host "`n▶ $Label ..." -ForegroundColor Cyan
    & $Script
}

# ── تحميل ملفات المراحل الفرعية (في نطاق السكربت نفسه) ──
function Get-StagePath {
    param([string] $File)
    $path = Join-Path $SetupDir $File
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "ملف المرحلة غير موجود: $path"
    }
    return $path
}

# ── تنفيذ المراحل بالترتيب ──
try {
    . (Get-StagePath 'runtime.ps1')
    Invoke-Stage -Name 'runtime'  -Label $stages.runtime.label  -Script { Install-Runtimes -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'servers.ps1')
    Invoke-Stage -Name 'servers'  -Label $stages.servers.label  -Script { Install-Servers -RepoRoot $RepoRoot -Tag $ReleaseTag -GitHubRepo $GitHubRepo -BundledAssetsDir $BundledAssetsDir -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'plugins.ps1')
    Invoke-Stage -Name 'plugins'  -Label $stages.plugins.label  -Script {
        Install-Plugins -RepoRoot $RepoRoot -AddinsDir $AddinsDir -BundledAssetsDir $BundledAssetsDir -Tag $ReleaseTag -GitHubRepo $GitHubRepo -WhatIf:$WhatIf
    }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'clients.ps1')
    Invoke-Stage -Name 'clients'  -Label $stages.clients.label  -Script { Install-Clients -RepoRoot $RepoRoot -ForceClientConfig:$ForceClientConfig -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'verify.ps1')
    Invoke-Stage -Name 'verify'   -Label $stages.verify.label   -Script { Verify-Servers -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  اكتمل التثبيت بنجاح — كل خوادم MCP جاهزة للاستخدام" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " إذا ظهرت أي أخطاء أعلاه، راجع سجل التشغيل وأعد تشغيل السكربت."
Write-Host ""
if ($script:TranscriptStarted) {
    try { Stop-Transcript | Out-Null } catch { }
}
