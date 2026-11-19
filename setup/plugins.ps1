#!/usr/bin/env pwsh
# =============================================================================
# Plugins stage - install the host-side add-ins that the MCP servers talk to.
#
# Supported hosts and install targets:
#   Revit       -> %APPDATA%\Autodesk\Revit\Addins\<year>\   (.addin + payload)
#   Navisworks  -> %APPDATA%\Autodesk\ApplicationPlugins\*.bundle
#   Civil 3D    -> %APPDATA%\Autodesk\ApplicationPlugins\*.bundle
#   AutoCAD     -> %APPDATA%\Autodesk\ApplicationPlugins\*.bundle (optional)
#   Rhino       -> %APPDATA%\McNeel\Rhinoceros\<ver>\Plug-ins\<name>\*.rhp
#   SketchUp    -> %APPDATA%\SketchUp\SketchUp <year>\SketchUp\Plugins\ (rbz)
#
# Add-in source layout (staged by setup/package-addins.ps1):
#   addins/Revit/R25/...
#   addins/Navisworks/NavisHelper.bundle/...
#   addins/Civil3D/MCPCivil3D.bundle/...
#   addins/AutoCAD/MCPAutoCAD.bundle/...
#   addins/Rhino/rhino-mcp.rhp
#   addins/SketchUp/su_mcp-1.3.0.rbz
#
# If no local add-ins folder is present, the release asset
# `pinnacle-host-addins.zip` is downloaded and staged under
# %LOCALAPPDATA%\PINNACLE\addins.
# =============================================================================

$ProgressPreference = 'SilentlyContinue'

$script:ProgramFilesRoot = if ($env:ProgramW6432) { $env:ProgramW6432 }
                           elseif ($env:ProgramFiles) { $env:ProgramFiles }
                           else { 'C:\Program Files' }

$script:AppPlugins = Join-Path $env:APPDATA 'Autodesk\ApplicationPlugins'
$script:RevitAddins = Join-Path $env:APPDATA 'Autodesk\Revit\Addins'
$script:RhinoRoot = Join-Path $env:APPDATA 'McNeel\Rhinoceros'
$script:SketchUpRoot = Join-Path $env:APPDATA 'SketchUp'
$script:PinnacleRoot = Join-Path $env:LOCALAPPDATA 'PINNACLE'

function Get-DetectedVersions {
    param([string] $Pattern, [string] $Exe)

    $versions = @()
    $dirs = @(Get-ChildItem -Path $Pattern -Directory -ErrorAction SilentlyContinue |
              Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName $Exe) -PathType Leaf })
    foreach ($dir in $dirs) {
        if ($dir.Name -match '(\d{4}|\d(?:\.\d)?)$') { $versions += $Matches[1] }
    }
    return @($versions | Sort-Object -Unique)
}

function Copy-DirectoryMerge {
    param([string] $Source, [string] $Destination)

    if (-not (Test-Path -LiteralPath $Destination -PathType Container)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }
    $null = New-Item -ItemType Directory -Path $Destination -Force -ErrorAction SilentlyContinue
    $result = robocopy $Source $Destination /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1
    $code = $LASTEXITCODE
    # robocopy: 0-7 are success codes (1 = files copied, 2 = extra files, 3 = both)
    if ($code -gt 7) { throw "robocopy failed with exit code $code ($Source -> $Destination)" }
}

function Get-AddinsSource {
    param([string] $AddinsDir, [string] $BundledAssetsDir, [string] $Tag, [string] $Repo, [switch] $WhatIf)

    $candidates = @()
    if ($AddinsDir) { $candidates += $AddinsDir }
    if ($BundledAssetsDir) { $candidates += (Join-Path $BundledAssetsDir 'addins') }
    $candidates += (Join-Path $PSScriptRoot '..\release-assets\addins')
    $candidates += (Join-Path $PSScriptRoot '..\addins')
    $candidates += (Join-Path $script:PinnacleRoot 'addins')

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Container)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    # Offline installer: release-assets\pinnacle-host-addins.zip is bundled.
    if ($BundledAssetsDir) {
        $bundledZip = Join-Path $BundledAssetsDir 'pinnacle-host-addins.zip'
        if (Test-Path -LiteralPath $bundledZip -PathType Leaf) {
            if ($WhatIf) {
                Write-Host "    [WhatIf] would extract bundled add-ins: $bundledZip" -ForegroundColor Gray
                return $null
            }
            $target = Join-Path $script:PinnacleRoot 'addins'
            if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($bundledZip, $target)
            $nested = Join-Path $target 'addins'
            if (Test-Path -LiteralPath $nested -PathType Container) { return $nested }
            return $target
        }
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] would download pinnacle-host-addins.zip from the release" -ForegroundColor Gray
        return $null
    }

    $target = Join-Path $script:PinnacleRoot 'addins'
    $zip = Join-Path $env:TEMP 'pinnacle-host-addins.zip'
    $url = if ($Tag -eq 'latest') {
        "https://github.com/$Repo/releases/latest/download/pinnacle-host-addins.zip"
    }
    else {
        "https://github.com/$Repo/releases/download/$Tag/pinnacle-host-addins.zip"
    }

    Write-Host "    downloading host add-ins: $url" -ForegroundColor DarkCyan
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 600 -ErrorAction Stop
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        Expand-Archive -Path $zip -DestinationPath $target -Force
        $nested = Join-Path $target 'addins'
        if (Test-Path -LiteralPath $nested -PathType Container) { return $nested }
        return $target
    }
    catch {
        Write-Host "    [warn] host add-ins asset unavailable: $($_.Exception.Message)" -ForegroundColor Yellow
        return $null
    }
    finally {
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue }
    }
}

# -- Revit ------------------------------------------------------------------
function Install-RevitAddins {
    param([string] $Root, [switch] $Force, [switch] $WhatIf)

    $source = Join-Path $Root 'Revit'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Host "    - no Revit add-ins staged" -ForegroundColor DarkGray
        return $false
    }

    # Only copy into versions that are actually installed; fall back to every
    # staged year when detection is impossible (e.g. non-standard install path).
    $installedYears = @()
    foreach ($revitDir in @(Get-ChildItem -Path (Join-Path $script:ProgramFilesRoot 'Autodesk') -Directory -Filter 'Revit *' -ErrorAction SilentlyContinue)) {
        if (Test-Path -LiteralPath (Join-Path $revitDir.FullName 'Revit.exe') -PathType Leaf) {
            if ($revitDir.Name -match '(\d{4})$') { $installedYears += $Matches[1] }
        }
    }

    $installed = 0
    $folders = @(Get-ChildItem -LiteralPath $source -Directory -ErrorAction SilentlyContinue)
    foreach ($folder in $folders) {
        $year = $null
        if ($folder.Name -match '^R(\d{2})$') { $year = '20' + $Matches[1] }
        elseif ($folder.Name -match '^(20\d{2})$') { $year = $Matches[1] }
        else { continue }
        if ($installedYears.Count -gt 0 -and $installedYears -notcontains $year) {
            Write-Host "    - Revit $year not installed - skipped" -ForegroundColor DarkGray
            continue
        }

        $target = Join-Path $script:RevitAddins $year
        if ($WhatIf) {
            Write-Host "    [WhatIf] would install Revit $year add-in into $target" -ForegroundColor Gray
            $installed++
            continue
        }
        Copy-DirectoryMerge -Source $folder.FullName -Destination $target
        Write-Host "    [ok] Revit $year -> $target" -ForegroundColor Green
        $installed++
    }

    if ($installed -eq 0 -and $folders.Count -eq 0) { return $false }
    return $true
}

# -- Autodesk bundles (Navisworks / Civil 3D / AutoCAD) ---------------------
function Install-Bundles {
    param([string] $Root, [string] $Name, [string[]] $RequiredFiles = @(), [switch] $WhatIf)

    $source = Join-Path $Root $Name
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Host "    - no $Name bundle staged" -ForegroundColor DarkGray
        return $false
    }

    $bundles = @(Get-ChildItem -LiteralPath $source -Directory -Filter '*.bundle' -ErrorAction SilentlyContinue)
    if ($bundles.Count -eq 0) { $bundles = @(Get-Item -LiteralPath $source) }

    $ok = $false
    foreach ($bundle in $bundles) {
        $missing = @()
        foreach ($required in $RequiredFiles) {
            if (-not (Get-ChildItem -LiteralPath $bundle.FullName -Recurse -File -Filter $required -ErrorAction SilentlyContinue)) {
                $missing += $required
            }
        }
        if ($missing.Count -gt 0) {
            Write-Host "    [warn] $($bundle.Name) is missing: $($missing -join ', ')" -ForegroundColor Yellow
        }

        $target = Join-Path $script:AppPlugins $bundle.Name
        if ($WhatIf) {
            Write-Host "    [WhatIf] would install $($bundle.Name) into $target" -ForegroundColor Gray
            $ok = $true
            continue
        }
        Copy-DirectoryMerge -Source $bundle.FullName -Destination $target
        Write-Host "    [ok] $($bundle.Name) -> $target" -ForegroundColor Green
        $ok = $true
    }
    return $ok
}

# -- Rhino ------------------------------------------------------------------
function Install-RhinoPlugin {
    param([string] $Root, [switch] $WhatIf)

    $source = Join-Path $Root 'Rhino'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Host "    - no Rhino plug-in staged" -ForegroundColor DarkGray
        return $false
    }

    $plugins = @(Get-ChildItem -LiteralPath $source -File -Filter '*.rhp' -ErrorAction SilentlyContinue)
    if ($plugins.Count -eq 0) {
        Write-Host "    - no .rhp file found in $source" -ForegroundColor DarkGray
        return $false
    }

    $versions = @('7.0', '8.0')
    $detected = @(Get-DetectedVersions -Pattern (Join-Path $script:ProgramFilesRoot 'McNeel\Rhinoceros\*\System') -Exe 'Rhino.exe')
    if ($detected.Count -gt 0) {
        $versions = @($detected | ForEach-Object { if ($_ -match '^\d$') { "$_.0" } else { $_ } })
    }

    $ok = $false
    foreach ($version in $versions) {
        $target = Join-Path $script:RhinoRoot "$version\Plug-ins\rhino-mcp"
        if ($WhatIf) {
            Write-Host "    [WhatIf] would install Rhino $version plug-in into $target" -ForegroundColor Gray
            $ok = $true
            continue
        }
        Copy-DirectoryMerge -Source $source -Destination $target
        Write-Host "    [ok] Rhino $version plug-in -> $target" -ForegroundColor Green
        Write-Host "         (start Rhino; if it is not auto-loaded use PlugInManager > Install)" -ForegroundColor DarkGray
        $ok = $true
    }
    return $ok
}

# -- SketchUp ---------------------------------------------------------------
function Install-SketchUpExtension {
    param([string] $Root, [switch] $WhatIf)

    $source = Join-Path $Root 'SketchUp'
    if (-not (Test-Path -LiteralPath $source -PathType Container)) {
        Write-Host "    - no SketchUp extension staged" -ForegroundColor DarkGray
        return $false
    }

    $rbz = @(Get-ChildItem -LiteralPath $source -File -Filter '*.rbz' -ErrorAction SilentlyContinue |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    if ($rbz.Count -eq 0) {
        Write-Host "    - no .rbz file found in $source" -ForegroundColor DarkGray
        return $false
    }

    $detected = @(Get-DetectedVersions -Pattern (Join-Path $script:ProgramFilesRoot 'SketchUp\SketchUp *') -Exe 'SketchUp.exe')
    if ($detected.Count -eq 0) {
        $years = @()
        foreach ($dir in @(Get-ChildItem -LiteralPath $script:SketchUpRoot -Directory -ErrorAction SilentlyContinue)) {
            if ($dir.Name -match '^SketchUp (20\d{2})$') { $years += $Matches[1] }
        }
        $detected = $years
    }
    if ($detected.Count -eq 0) {
        Write-Host "    [warn] SketchUp is not installed - the .rbz can be installed later from $($rbz[0].FullName)" -ForegroundColor Yellow
        return $false
    }

    $ok = $false
    foreach ($year in @($detected | Sort-Object -Unique)) {
        $target = Join-Path $script:SketchUpRoot "SketchUp $year\SketchUp\Plugins"
        if ($WhatIf) {
            Write-Host "    [WhatIf] would extract $($rbz[0].Name) into $target" -ForegroundColor Gray
            $ok = $true
            continue
        }
        New-Item -ItemType Directory -Path $target -Force | Out-Null
        $temp = Join-Path $env:TEMP "pinnacle-sketchup-$year"
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
        New-Item -ItemType Directory -Path $temp -Force | Out-Null
        # .rbz is a zip archive; Expand-Archive rejects the extension.
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($rbz[0].FullName, $temp)
        Copy-DirectoryMerge -Source $temp -Destination $target
        Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "    [ok] SketchUp $year extension -> $target" -ForegroundColor Green
        $ok = $true
    }
    return $ok
}

function Install-Plugins {
    param(
        [string] $RepoRoot,
        [string] $AddinsDir = '',
        [string] $BundledAssetsDir = '',
        [string] $Tag = 'latest',
        [string] $GitHubRepo = 'elhussieny2ohamy-BIM/Pinnacle-AI-Agent',
        [switch] $Force,
        [switch] $WhatIf
    )

    $root = Get-AddinsSource -AddinsDir $AddinsDir -BundledAssetsDir $BundledAssetsDir -Tag $Tag -Repo $GitHubRepo -WhatIf:$WhatIf
    if (-not $root) {
        if ($WhatIf) { return }
        Write-Host "  [warn] no host add-ins available - servers will start but host tool calls will fail." -ForegroundColor Yellow
        Write-Host "         Publish 'pinnacle-host-addins.zip' to the release, or pass -AddinsDir." -ForegroundColor Yellow
        return
    }

    Write-Host "  add-in source: $root" -ForegroundColor DarkCyan

    $results = [ordered]@{}
    $results['Revit'] = Install-RevitAddins -Root $root -Force:$Force -WhatIf:$WhatIf
    $results['Navisworks'] = Install-Bundles -Root $root -Name 'Navisworks' -RequiredFiles @('*.dll') -WhatIf:$WhatIf
    $results['Civil3D'] = Install-Bundles -Root $root -Name 'Civil3D' -RequiredFiles @('*Plugin*.dll') -WhatIf:$WhatIf
    $results['AutoCAD'] = Install-Bundles -Root $root -Name 'AutoCAD' -WhatIf:$WhatIf
    $results['Rhino'] = Install-RhinoPlugin -Root $root -WhatIf:$WhatIf
    $results['SketchUp'] = Install-SketchUpExtension -Root $root -WhatIf:$WhatIf

    Write-Host ""
    foreach ($key in $results.Keys) {
        $mark = if ($results[$key]) { '[ok]  ' } else { '[skip]' }
        Write-Host "  $mark $key" -ForegroundColor $(if ($results[$key]) { 'Green' } else { 'DarkGray' })
    }
}
