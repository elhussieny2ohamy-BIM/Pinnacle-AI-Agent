[CmdletBinding(SupportsShouldProcess = $true)]
param([string] $SourceRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-AecSourceRoot $SourceRoot
$bundle = Join-Path $root 'Sketchup MCP\sketchup-mcp-main\mcpb\dist\bundle'
$serverSource = Join-Path $bundle 'server\index.mjs'
$bridgeLoaderSource = Join-Path $bundle 'bridge\su_mcp.rb'
$bridgeMainSource = Join-Path $bundle 'bridge\su_mcp\main.rb'
$rbzSource = Join-Path $bundle 'bridge\su_mcp.rbz'
Assert-AecFile $serverSource 'SketchUp MCP server bundle'
Assert-AecFile $bridgeLoaderSource 'SketchUp Ruby bridge loader'
Assert-AecFile $bridgeMainSource 'SketchUp Ruby bridge implementation'
Assert-AecFile $rbzSource 'SketchUp Extension Manager bundle'

$configuredNode = [Environment]::GetEnvironmentVariable('PINNACLE_NODE_EXE')
if (-not [string]::IsNullOrWhiteSpace($configuredNode)) {
    Assert-AecFile $configuredNode 'Configured Node.js runtime'
} elseif ($null -eq (Get-Command 'node.exe' -ErrorAction SilentlyContinue)) {
    Write-Warning 'Node.js was not found on PATH. The server and bridge will be staged; set PINNACLE_NODE_EXE before starting the SketchUp MCP server.'
}

$targetRoot = Join-Path $env:LOCALAPPDATA 'Programs\SketchUp MCP'
$serverTarget = Join-Path $targetRoot 'server\index.mjs'
$bridgeLoaderTarget = Join-Path $targetRoot 'bridge\su_mcp.rb'
$bridgeMainTarget = Join-Path $targetRoot 'bridge\su_mcp\main.rb'
$rbzTarget = Join-Path $targetRoot 'tools\su_mcp.rbz'

$programRoots = @(
    [Environment]::GetFolderPath('ProgramFiles'),
    [Environment]::GetFolderPath('ProgramFilesX86')
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
$configuredSketchupRoot = [Environment]::GetEnvironmentVariable('PINNACLE_SKETCHUP_ROOT')
if (-not [string]::IsNullOrWhiteSpace($configuredSketchupRoot)) {
    if (-not (Test-Path -LiteralPath $configuredSketchupRoot -PathType Container)) {
        throw "Configured SketchUp root was not found: $configuredSketchupRoot"
    }
    $sketchupRoots = @($configuredSketchupRoot)
} else {
    $sketchupRoots = @($programRoots | ForEach-Object { Join-Path $_ 'SketchUp' })
}
$installedApps = @(
    foreach ($sketchupRoot in $sketchupRoots) {
        if (-not (Test-Path -LiteralPath $sketchupRoot -PathType Container)) { continue }
        foreach ($versionDirectory in Get-ChildItem -LiteralPath $sketchupRoot -Directory -ErrorAction SilentlyContinue) {
            if ($versionDirectory.Name -match '^SketchUp (\d{4})$') {
                $executable = Join-Path $versionDirectory.FullName 'SketchUp.exe'
                if (Test-Path -LiteralPath $executable -PathType Leaf) {
                    [pscustomobject]@{ Version = $Matches[1]; Executable = $executable }
                }
            }
        }
    }
)

if ($PSCmdlet.ShouldProcess($targetRoot, 'Install/update the SketchUp MCP server and stage its bridge')) {
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $serverTarget)
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $bridgeMainTarget)
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $rbzTarget)
    Copy-Item -LiteralPath $serverSource -Destination $serverTarget -Force
    Copy-Item -LiteralPath $bridgeMainSource -Destination $bridgeMainTarget -Force
    Copy-Item -LiteralPath $bridgeLoaderSource -Destination $bridgeLoaderTarget -Force
    Copy-Item -LiteralPath $rbzSource -Destination $rbzTarget -Force

    foreach ($installedApp in $installedApps) {
        $plugins = Join-Path $env:APPDATA "SketchUp\SketchUp $($installedApp.Version)\SketchUp\Plugins"
        $null = New-Item -ItemType Directory -Force -Path (Join-Path $plugins 'su_mcp')
        Copy-Item -LiteralPath $bridgeMainSource -Destination (Join-Path $plugins 'su_mcp\main.rb') -Force
        Copy-Item -LiteralPath $bridgeLoaderSource -Destination (Join-Path $plugins 'su_mcp.rb') -Force
    }

    if ($installedApps.Count -gt 0) {
        Complete-AecSetup 'sketchup' $serverTarget ("server and bridge installed; bridge copied to {0} SketchUp version(s); close and restart SketchUp" -f $installedApps.Count)
    } else {
        Complete-AecSetup 'sketchup' $serverTarget 'server, bridge, and Extension Manager bundle staged; SketchUp Pro is not required for this setup'
    }
    Write-Host "Extension Manager bundle: $rbzTarget"
}

