[CmdletBinding(SupportsShouldProcess = $true)]
param([string] $SourceRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$root = Get-AecSourceRoot $SourceRoot
$project = Get-AecProjectPath $root 'NavisWorksMaster-main'
$serverInstaller = Join-Path $project 'tools\install_local_mcp_server.ps1'
$bundleInstaller = Join-Path $project 'tools\install_local_bundle.ps1'
$serverSource = Join-Path $project 'NavisHelper.McpServer\bin\Release\net9.0'
$bundleSource = Join-Path $project 'NavisHelper.bundle'
Assert-AecFile $serverInstaller 'Navisworks server installer'
Assert-AecFile (Join-Path $serverSource 'NavisHelper.McpServer.exe') 'Navisworks server build'
Assert-AecFile (Join-Path $bundleSource 'PackageContents.xml') 'Navisworks application bundle'

$dotnet = Get-Command 'dotnet.exe' -ErrorAction SilentlyContinue
if ($null -eq $dotnet) { throw '.NET 10 or later is required for the Navisworks MCP server. Install the .NET runtime and rerun setup navis.' }
$runtimeOutput = @(& $dotnet.Source --list-runtimes 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect installed .NET runtimes. Repair the .NET installation and rerun setup navis.' }
$hasSupportedRuntime = $false
foreach ($runtime in $runtimeOutput) {
    if ($runtime -match '^Microsoft\.NETCore\.App\s+(\d+)\.') {
        if ([int]$Matches[1] -ge 10) { $hasSupportedRuntime = $true; break }
    }
}
if (-not $hasSupportedRuntime) { throw '.NET 10 or later is required for Navisworks setup. The configurator can roll forward from .NET 9 to .NET 10; install the current .NET runtime and rerun setup navis.' }

$running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('Roamer', 'Navisworks') })
if ($running.Count -gt 0) {
    throw 'Close Autodesk Navisworks before setup so the server and bundle can be replaced safely.'
}

if ($PSCmdlet.ShouldProcess('NavisHelper per-user install and Autodesk ApplicationPlugins bundle', 'Install/update')) {
    & $serverInstaller -Source $serverSource -Destination (Join-Path $env:LOCALAPPDATA 'NavisHelper')
    if ($LASTEXITCODE -ne 0) { throw "Navisworks server install failed with exit code $LASTEXITCODE." }
    & $bundleInstaller -SourceBundle $bundleSource
    if ($LASTEXITCODE -ne 0) { throw "Navisworks bundle install failed with exit code $LASTEXITCODE." }
    Complete-AecSetup 'navis' (Join-Path $env:LOCALAPPDATA 'NavisHelper\versions') 'installed/updated'
}
