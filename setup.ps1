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
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [switch] $WhatIf,
    [switch] $SkipRuntimes,
    [switch] $SkipServers,
    [switch] $SkipPlugins,
    [switch] $SkipVerify,
    [string] $ReleaseTag = 'latest',          # التاج اللي يتم التنزيل منه على GitHub Releases
    [string] $GitHubRepo = 'elhussieny2ohamy-BIM/Pinnacle-AI-Agent'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$PSScriptRoot = Get-Item -Path $PSScriptRoot
$RepoRoot     = $PSScriptRoot.Parent
$SetupDir     = $PSScriptRoot

# ── مسارات الثوابت (per-user، لا مسار صلب للقرص) ──
$LOCAL = $env:LOCALAPPDATA
$ROAM  = $env:APPDATA
$USER  = $env:USERPROFILE

# ── حالات المراحل ──
$stages = [ordered]@{
    runtime  = @{ label = 'التحقق من التشغيلات (Node, .NET, uv)'; enabled = -not $SkipRuntimes }
    servers  = @{ label = 'تنزيل وتثبيت خوادم MCP';            enabled = -not $SkipServers  }
    plugins  = @{ label = 'حقن الإضافات داخل البرامج';        enabled = -not $SkipPlugins  }
    verify   = @{ label = 'فحص تشغيل الخوادم (smoke test)';   enabled = -not $SkipVerify   }
}

Write-Host "`n==================================================================" -ForegroundColor Cyan
Write-Host "  PINNACLE AI AGENT — MCP Servers Comprehensive Setup" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " المجلد الجذر: $RepoRoot"
Write-Host " الطور:        $ReleaseTag"
Write-Host " المستودع:    $GitHubRepo"
if ($WhatIfPreference.IsPresent -or $WhatIf) { Write-Host " ★ وضع تجربة فقط (-WhatIf) — لن يتم تعديل أي ملف" -ForegroundColor Yellow }
Write-Host ""

# ── دالة مساعدة لتشغيل مرحلة ──
function Invoke-Stage {
    param([string] $Name, [string] $Label, [scriptblock] $Script)
    if (-not $stages[$Name].enabled) {
        Write-Host "⏭️  تُخطّى: $Label" -ForegroundColor Gray
        return
    }
    Write-Host "`n▶ $Label ..." -ForegroundColor Cyan
    if ($PSCmdlet.ShouldProcess($Label, 'تنفيذ مرحلة التثبيت')) {
        & $Script
        if ($LASTEXITCODE -ne 0) {
            Write-Error "فشل تنفيذ مرحلة: $Label (كود الخروج $LASTEXITCODE)"
        }
    }
}

# ── تحميل ملفات المراحل الفرعية ──
function Dot-Source {
    param([string] $File)
    $path = Join-Path $SetupDir $File
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "ملف المرحلة غير موجود: $path"
    }
    . $path
}

# ── 실행 المراحل بالترتيب ──
try {
    Dot-Source 'runtime.ps1'
    Invoke-Stage -Name 'runtime'  -Label $stages.runtime.label  -Script { Install-Runtimes -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    Dot-Source 'servers.ps1'
    Invoke-Stage -Name 'servers'  -Label $stages.servers.label  -Script { Install-Servers -RepoRoot $RepoRoot -Tag $ReleaseTag -GitHubRepo $GitHubRepo -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    Dot-Source 'plugins.ps1'
    Invoke-Stage -Name 'plugins'  -Label $stages.plugins.label  -Script { Install-Plugins -RepoRoot $RepoRoot -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    Dot-Source 'verify.ps1'
    Invoke-Stage -Name 'verify'   -Label $stages.verify.label   -Script { Verify-Servers -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

Write-Host "`n==================================================================" -ForegroundColor Green
Write-Host "  اكتمل التثبيت بنجاح — كل خوادم MCP جاهزة للاستخدام" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " إذا ظهرت أي أخطاء أعلاه، راجع سجل التشغيل وأعد تشغيل السكربت."
Write-Host ""
