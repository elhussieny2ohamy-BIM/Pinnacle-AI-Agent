#!/usr/bin/env pwsh
# =============================================================================
# Servers stage - download the six MCP servers into their per-user locations.
#
# Install types:
#   zip -> release asset extracted to Destination
#   uv  -> pinned PyPI package installed with uv tool (AutoCAD / Rhino)
#
# GitHub's /releases/latest/download/<asset> redirect is used when Tag = latest.
# /releases/download/latest/<asset> is NOT a valid GitHub URL.
# =============================================================================

$ProgressPreference = 'SilentlyContinue'

# Entrypoint must match the console_scripts name inside the PyPI package.
# autocad-mcp-pro exposes: autocad-mcp, autocad-mcp-pro
# rhino3dm-mcp exposes:    rhino-mcp, rhino3dm-mcp
$script:ReleaseAssets = @(
    @{
        Name        = 'rvt'
        DisplayName = 'Revit MCP'
        AssetName   = 'rvt-mcp-server.zip'
        Destination = Join-Path $env:LOCALAPPDATA 'Bimwright\rvt-mcp\server\current'
        InstallType = 'zip'
        Executable  = 'rvt-mcp.exe'
    },
    @{
        Name        = 'navis'
        DisplayName = 'Navisworks MCP'
        AssetName   = 'NavisHelper.McpServer.zip'
        Destination = Join-Path $env:LOCALAPPDATA 'NavisHelper\McpServer'
        InstallType = 'zip'
        Executable  = 'NavisHelper.McpServer.exe'
    },
    @{
        Name        = 'civil3d'
        DisplayName = 'Civil 3D MCP'
        AssetName   = 'civil3d-mcp.zip'
        Destination = Join-Path $env:APPDATA 'MCP Civil 3D'
        InstallType = 'zip'
        Executable  = 'index.js'
    },
    @{
        Name        = 'sketchup'
        DisplayName = 'SketchUp MCP'
        AssetName   = 'sketchup-mcp-server.zip'
        Destination = Join-Path $env:LOCALAPPDATA 'Programs\SketchUp MCP\server'
        InstallType = 'zip'
        Executable  = 'index.mjs'
    },
    @{
        Name        = 'autocad'
        DisplayName = 'AutoCAD MCP'
        AssetName   = $null
        Destination = Join-Path $env:USERPROFILE '.local\bin'
        InstallType = 'uv'
        Package     = 'autocad-mcp-pro==1.8.0'
        EntryPoint  = 'autocad-mcp'
        Executable  = 'autocad-mcp.exe'
    },
    @{
        Name        = 'rhino'
        DisplayName = 'Rhino MCP'
        AssetName   = $null
        Destination = Join-Path $env:USERPROFILE '.local\bin'
        InstallType = 'uv'
        Package     = 'rhino3dm-mcp==0.7.0'
        EntryPoint  = 'rhino-mcp'
        Executable  = 'rhino-mcp.exe'
    }
)

function Get-ReleaseAssetUrl {
    param([string] $Repo, [string] $Tag, [string] $AssetName)
    if ($Tag -eq 'latest') {
        return "https://github.com/$Repo/releases/latest/download/$AssetName"
    }
    return "https://github.com/$Repo/releases/download/$Tag/$AssetName"
}

function Download-ReleaseAsset {
    param([string] $Url, [string] $OutPath)

    $attempt = 0
    $maxAttempts = 3
    while ($attempt -lt $maxAttempts) {
        $attempt++
        try {
            Invoke-WebRequest -Uri $Url -OutFile $OutPath -TimeoutSec 900 -ErrorAction Stop
            return $true
        }
        catch {
            Write-Host "    attempt $attempt/$maxAttempts failed: $($_.Exception.Message)" -ForegroundColor Yellow
            if ($attempt -eq $maxAttempts) { return $false }
            Start-Sleep -Seconds 5
        }
    }
    return $false
}

function Expand-ZipFile {
    param([string] $ZipPath, [string] $DestDir)

    if (-not (Test-Path -LiteralPath $DestDir -PathType Container)) {
        New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    }
    try {
        Expand-Archive -Path $ZipPath -DestinationPath $DestDir -Force -ErrorAction Stop
    }
    catch {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $DestDir, $true)
    }
}

function Install-ServerZip {
    param([hashtable] $Server, [string] $Tag, [string] $Repo, [string] $BundledAssetsDir = '', [switch] $WhatIf)

    $destDir = $Server.Destination
    $exePath = Join-Path $destDir $Server.Executable

    if (Test-Path -LiteralPath $exePath -PathType Leaf) {
        Write-Host "    [ok] already installed: $exePath" -ForegroundColor Green
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] would install $($Server.AssetName) into $destDir" -ForegroundColor Gray
        return
    }

    $zipPath = Join-Path $env:TEMP "pinnacle-$($Server.Name)-server.zip"

    $bundled = $null
    if ($BundledAssetsDir -and $Server.AssetName) {
        $candidate = Join-Path $BundledAssetsDir $Server.AssetName
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $bundled = $candidate }
    }

    try {
        if ($bundled) {
            Write-Host "    using bundled asset: $(Split-Path -Leaf $bundled)" -ForegroundColor DarkCyan
            Copy-Item -LiteralPath $bundled -Destination $zipPath -Force
        }
        else {
            $url = Get-ReleaseAssetUrl -Repo $Repo -Tag $Tag -AssetName $Server.AssetName
            Write-Host "    downloading: $url" -ForegroundColor DarkCyan
            if (-not (Download-ReleaseAsset -Url $url -OutPath $zipPath)) {
                throw "Failed to download $($Server.AssetName) from $url"
            }
        }

        Expand-ZipFile -ZipPath $zipPath -DestDir $destDir
        if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
            throw "Archive extracted but expected launcher was not found: $exePath"
        }
        Write-Host "    [ok] installed: $exePath" -ForegroundColor Green
    }
    finally {
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
    }
}

function Install-ServerUv {
    param([hashtable] $Server, [switch] $WhatIf)

    $binDir = $Server.Destination
    $exePath = Join-Path $binDir $Server.Executable

    if (Test-Path -LiteralPath $exePath -PathType Leaf) {
        Write-Host "    [ok] already installed: $exePath" -ForegroundColor Green
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] would run: uv tool install --python 3.11 --from $($Server.Package) $($Server.EntryPoint)" -ForegroundColor Gray
        return
    }

    $uv = Get-Command 'uv' -CommandType Application -ErrorAction SilentlyContinue
    if (-not $uv) { throw 'uv is not installed - run the runtime stage first (or install https://astral.sh/uv).' }

    Write-Host "    uv tool install $($Server.Package) ($($Server.EntryPoint)) ..." -ForegroundColor DarkCyan
    & $uv.Source tool install --upgrade --python 3.11 --from $Server.Package $Server.EntryPoint
    if ($LASTEXITCODE -ne 0) { throw "uv tool install failed for $($Server.Package) (exit $LASTEXITCODE)" }

    if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
        $found = Get-ChildItem -Path $binDir -Filter "*$($Server.Name)*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) {
            Write-Host "    [ok] installed as $($found.FullName) (expected $exePath)" -ForegroundColor Yellow
        }
        else {
            throw "uv reported success but no launcher was found in $binDir"
        }
    }
    else {
        Write-Host "    [ok] installed: $exePath" -ForegroundColor Green
    }
}

function Install-Servers {
    param(
        [string] $RepoRoot,
        [string] $Tag = 'latest',
        [string] $GitHubRepo,
        [string] $BundledAssetsDir = '',
        [switch] $WhatIf
    )

    if ($Tag -eq 'latest') {
        Write-Host "    using GitHub's 'latest release' redirect" -ForegroundColor DarkGray
    }

    $failures = @()
    foreach ($server in $script:ReleaseAssets) {
        Write-Host "  >> $($server.DisplayName) ..." -ForegroundColor Cyan
        try {
            switch ($server.InstallType) {
                'zip' { Install-ServerZip -Server $server -Tag $Tag -Repo $GitHubRepo -BundledAssetsDir $BundledAssetsDir -WhatIf:$WhatIf }
                'uv'  { Install-ServerUv  -Server $server -WhatIf:$WhatIf }
            }
        }
        catch {
            $failures += "$($server.DisplayName): $($_.Exception.Message)"
            Write-Host "    [fail] $($_.Exception.Message)" -ForegroundColor Red
        }
    }

    if ($failures.Count -gt 0) {
        throw ("Server installation finished with errors:`n  - " + ($failures -join "`n  - "))
    }

    Write-Host "  [ok] all MCP servers are in their standard locations" -ForegroundColor Green
}
