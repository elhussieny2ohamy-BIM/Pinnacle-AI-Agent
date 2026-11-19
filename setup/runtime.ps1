#!/usr/bin/env pwsh
# =============================================================================
# Runtime stage - verify/install Node.js, .NET Desktop Runtime and uv (Python).
# All output is ASCII so Windows PowerShell 5.1 never mangles the console.
# =============================================================================

$script:MinNodeMajor = 20

function Test-Command {
    param([string] $Name)
    return (Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue) -ne $null
}

function Get-NodeVersion {
    if (-not (Test-Command 'node')) { return $null }
    $raw = (node --version 2>$null)
    if ($raw -match '^v(\d+)\.(\d+)\.(\d+)') { return [version]($Matches[1] + '.' + $Matches[2] + '.' + $Matches[3]) }
    return $null
}

function Test-Node {
    $v = Get-NodeVersion
    return ($null -ne $v) -and ($v.Major -ge $script:MinNodeMajor)
}

# `dotnet --version` only works with an SDK. Runtimes are checked separately.
function Test-DotNet {
    if (-not (Test-Command 'dotnet')) { return $false }
    $runtimes = (dotnet --list-runtimes 2>$null)
    if (-not $runtimes) { return $false }
    return [bool]($runtimes -match 'Microsoft\.(WindowsDesktop|NETCore)\.App\s+8\.')
}

function Test-Uv {
    return (Test-Command 'uv')
}

function Invoke-Installer {
    param([string] $Path, [string] $Arguments)
    $p = Start-Process -FilePath $Path -ArgumentList $Arguments -Wait -PassThru
    # 0 = success, 3010 = reboot required, 1641 = reboot initiated
    if ($p.ExitCode -notin @(0, 3010, 1641)) {
        throw "Installer failed with exit code $($p.ExitCode): $Path"
    }
    if ($p.ExitCode -in @(3010, 1641)) {
        Write-Host "    (a reboot is required to finish the installation)" -ForegroundColor Yellow
    }
}

# -- Node.js ----------------------------------------------------------------
function Install-Node {
    param([switch] $WhatIf)

    if (Test-Node) {
        Write-Host "  [ok] Node.js $((Get-NodeVersion))" -ForegroundColor Green
        return
    }

    $nodeUrl = 'https://nodejs.org/dist/v20.18.1/node-v20.18.1-x64.msi'
    $msiPath = Join-Path $env:TEMP 'pinnacle-node-installer.msi'
    Write-Host "  Node.js $script:MinNodeMajor+ is required - downloading $nodeUrl ..." -ForegroundColor Yellow

    if ($WhatIf) {
        Write-Host "  [WhatIf] would install Node.js from $nodeUrl" -ForegroundColor Gray
        return
    }

    try {
        Invoke-WebRequest -Uri $nodeUrl -OutFile $msiPath -TimeoutSec 600
        Invoke-Installer -Path 'msiexec.exe' -Arguments "/i `"$msiPath`" /quiet /norestart"
        $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('PATH', 'User')
        if (-not (Test-Node)) { throw 'Node.js was installed but is not on PATH yet. Open a new terminal and re-run setup.' }
        Write-Host "  [ok] Node.js installed" -ForegroundColor Green
    }
    finally {
        if (Test-Path -LiteralPath $msiPath) { Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue }
    }
}

# -- .NET Desktop Runtime 8 -------------------------------------------------
function Install-DotNet {
    param([switch] $WhatIf)

    if (Test-DotNet) {
        Write-Host "  [ok] .NET Desktop Runtime 8" -ForegroundColor Green
        return
    }

    # aka.ms always resolves to the current 8.0 servicing release.
    $dotnetUrl = 'https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe'
    $exePath = Join-Path $env:TEMP 'pinnacle-dotnet-runtime.exe'
    Write-Host "  .NET Desktop Runtime 8 is required - downloading ..." -ForegroundColor Yellow

    if ($WhatIf) {
        Write-Host "  [WhatIf] would install .NET Desktop Runtime 8 from $dotnetUrl" -ForegroundColor Gray
        return
    }

    try {
        Invoke-WebRequest -Uri $dotnetUrl -OutFile $exePath -TimeoutSec 600 -MaximumRedirection 5
        Invoke-Installer -Path $exePath -Arguments '/install /quiet /norestart'
        Write-Host "  [ok] .NET Desktop Runtime installed" -ForegroundColor Green
    }
    finally {
        if (Test-Path -LiteralPath $exePath) { Remove-Item -LiteralPath $exePath -Force -ErrorAction SilentlyContinue }
    }
}

# -- uv (Python tool manager) ----------------------------------------------
function Install-Uv {
    param([switch] $WhatIf)

    if (Test-Uv) {
        Write-Host "  [ok] $((uv --version 2>$null))" -ForegroundColor Green
        return
    }

    Write-Host "  uv is required for AutoCAD and Rhino MCP - installing ..." -ForegroundColor Yellow

    if ($WhatIf) {
        Write-Host "  [WhatIf] would install uv from https://astral.sh/uv/install.ps1" -ForegroundColor Gray
        return
    }

    $installScript = Join-Path $env:TEMP 'pinnacle-uv-install.ps1'
    try {
        Invoke-WebRequest -Uri 'https://astral.sh/uv/install.ps1' -OutFile $installScript -TimeoutSec 180
        & $installScript
        if ($LASTEXITCODE -ne 0) { throw "uv installer exited with code $LASTEXITCODE" }

        $env:PATH = [Environment]::GetEnvironmentVariable('PATH', 'Machine') + ';' +
                    [Environment]::GetEnvironmentVariable('PATH', 'User') + ';' +
                    (Join-Path $env:USERPROFILE '.local\bin')

        if (-not (Test-Uv)) { throw 'uv was installed but is not on PATH yet. Open a new terminal and re-run setup.' }
        Write-Host "  [ok] uv installed" -ForegroundColor Green
    }
    finally {
        if (Test-Path -LiteralPath $installScript) { Remove-Item -LiteralPath $installScript -Force -ErrorAction SilentlyContinue }
    }
}

function Install-Runtimes {
    param([switch] $WhatIf)

    Write-Host "  [1/3] Node.js ..." -ForegroundColor DarkCyan
    Install-Node -WhatIf:$WhatIf

    Write-Host "  [2/3] .NET Desktop Runtime ..." -ForegroundColor DarkCyan
    Install-DotNet -WhatIf:$WhatIf

    Write-Host "  [3/3] uv ..." -ForegroundColor DarkCyan
    Install-Uv -WhatIf:$WhatIf

    Write-Host "  [ok] runtimes ready" -ForegroundColor Green
}
