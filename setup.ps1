#!/usr/bin/env pwsh
# =============================================================================
# PINNACLE AI AGENT - MCP Servers comprehensive setup
# =============================================================================
# Installs and configures the six MCP servers used by the AEC bundle:
# Revit, Navisworks, AutoCAD, Civil 3D, Rhino and SketchUp.
#
# Stages:
#   1) runtime   -> verify/install Node.js, .NET Desktop Runtime and uv
#   2) servers   -> download server archives and install uv packages
#   3) plugins   -> copy host add-ins into the application load paths
#   4) clients   -> configure Claude, ChatGPT, PINNACLE (dsh) and OpenCode
#   5) verify    -> JSON-RPC initialize + tools/list for every server
#
# Usage:
#   .\setup.ps1                    # full install
#   .\setup.ps1 -WhatIf            # preview only, no changes
#   .\setup.ps1 -SkipServers       # reuse installed servers
#   .\setup.ps1 -SkipPlugins       # do not copy host add-ins
# =============================================================================
[CmdletBinding()]
param(
    [switch] $WhatIf,
    [switch] $SkipRuntimes,
    [switch] $SkipServers,
    [switch] $SkipPlugins,
    [switch] $SkipClients,
    [switch] $SkipVerify,
    [switch] $ForceClientConfig,             # rewrite existing MCP client entries
    [string] $InstallDir = '',               # install root (installer mode)
    [string] $BundledAssetsDir = '',         # offline release-assets folder
    [string] $AddinsDir = '',                # local add-in staging folder
    [string] $LogPath = '',                  # transcript path (silent install)
    [string] $ReleaseTag = 'latest',         # GitHub release tag
    [string] $GitHubRepo = 'elhussieny2ohamy-BIM/Pinnacle-AI-Agent'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

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

$stages = [ordered]@{
    runtime = @{ label = 'Runtime check (Node.js, .NET, uv)';        enabled = -not $SkipRuntimes }
    servers = @{ label = 'Install MCP servers';                       enabled = -not $SkipServers  }
    plugins = @{ label = 'Install host add-ins';                      enabled = -not $SkipPlugins  }
    clients = @{ label = 'Configure MCP clients (Claude / ChatGPT / PINNACLE / OpenCode)'; enabled = -not $SkipClients }
    verify  = @{ label = 'Protocol smoke test';                       enabled = -not $SkipVerify   }
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  PINNACLE AI AGENT - MCP Servers Setup" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " Root:      $RepoRoot"
Write-Host " Release:   $ReleaseTag"
Write-Host " Repository: $GitHubRepo"
if ($WhatIf) { Write-Host " PREVIEW MODE (-WhatIf) - no files will be changed" -ForegroundColor Yellow }
Write-Host ""

function Invoke-Stage {
    param([string] $Name, [string] $Label, [scriptblock] $Script)
    if (-not $stages[$Name].enabled) {
        Write-Host "SKIP: $Label" -ForegroundColor Gray
        return
    }
    Write-Host ""
    Write-Host ">> $Label ..." -ForegroundColor Cyan
    & $Script
}

function Get-StagePath {
    param([string] $File)
    $path = Join-Path $SetupDir $File
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Stage file not found: $path"
    }
    return $path
}

try {
    . (Get-StagePath 'runtime.ps1')
    Invoke-Stage -Name 'runtime' -Label $stages.runtime.label -Script { Install-Runtimes -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'servers.ps1')
    Invoke-Stage -Name 'servers' -Label $stages.servers.label -Script {
        Install-Servers -RepoRoot $RepoRoot -Tag $ReleaseTag -GitHubRepo $GitHubRepo -BundledAssetsDir $BundledAssetsDir -WhatIf:$WhatIf
    }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'plugins.ps1')
    Invoke-Stage -Name 'plugins' -Label $stages.plugins.label -Script {
        Install-Plugins -RepoRoot $RepoRoot -AddinsDir $AddinsDir -BundledAssetsDir $BundledAssetsDir -Tag $ReleaseTag -GitHubRepo $GitHubRepo -WhatIf:$WhatIf
    }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'clients.ps1')
    Invoke-Stage -Name 'clients' -Label $stages.clients.label -Script {
        Install-Clients -RepoRoot $RepoRoot -ForceClientConfig:$ForceClientConfig -WhatIf:$WhatIf
    }
}
catch { Write-Error $_; exit 1 }

try {
    . (Get-StagePath 'verify.ps1')
    Invoke-Stage -Name 'verify' -Label $stages.verify.label -Script { Verify-Servers -WhatIf:$WhatIf }
}
catch { Write-Error $_; exit 1 }

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  Setup complete - MCP servers are ready" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " Start the CAD/BIM application before calling its tools."
Write-Host ""
if ($script:TranscriptStarted) {
    try { Stop-Transcript | Out-Null } catch { }
}
