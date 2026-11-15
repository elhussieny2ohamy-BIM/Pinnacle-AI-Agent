[CmdletBinding(SupportsShouldProcess = $true)]
param([string] $SourceRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$root = Get-AecSourceRoot $SourceRoot
$installer = Join-Path (Get-AecProjectPath $root 'Civil3D-mcp-main') 'dist\MCPCivil3D-App.exe'
Assert-AecFile $installer 'Civil 3D per-user installer'

$node = Get-Command 'node' -ErrorAction SilentlyContinue
$configuredNode = [Environment]::GetEnvironmentVariable('PINNACLE_NODE_EXE')
if (-not [string]::IsNullOrWhiteSpace($configuredNode)) {
    Assert-AecFile $configuredNode 'Configured Node.js runtime'
}
if ($null -eq $node -and [string]::IsNullOrWhiteSpace($configuredNode)) {
    throw 'Civil 3D MCP uses Node.js at runtime. Install Node.js or set PINNACLE_NODE_EXE, then rerun setup civil3d.'
}

if ($PSCmdlet.ShouldProcess((Join-Path $env:APPDATA 'MCP Civil 3D'), 'Install Core only; leave all external MCP client configs untouched')) {
    $process = Start-Process -FilePath $installer -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/COMPONENTS=Core') -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Civil 3D installer failed with exit code $($process.ExitCode)." }
    Complete-AecSetup 'civil3d' (Join-Path $env:APPDATA 'MCP Civil 3D\index.js') 'installed; client configs untouched'
}

