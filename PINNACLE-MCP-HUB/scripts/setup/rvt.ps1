[CmdletBinding(SupportsShouldProcess = $true)]
param([string] $SourceRoot)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$root = Get-AecSourceRoot $SourceRoot
$installer = Join-Path (Get-AecProjectPath $root 'rvt-mcp-master') 'scripts\install.ps1'
Assert-AecFile $installer 'Bimwright Revit installer'

if ($PSCmdlet.ShouldProcess('Bimwright rvt-mcp and installed Revit add-ins', 'Install/update (no external MCP-client wiring)')) {
    Invoke-AecPowerShellScript $installer @('-Client', 'none') -WhatIf:$WhatIfPreference
    Complete-AecSetup 'rvt' (Join-Path $env:LOCALAPPDATA 'Bimwright\rvt-mcp\server\current\rvt-mcp.exe') 'installed/updated'
}
