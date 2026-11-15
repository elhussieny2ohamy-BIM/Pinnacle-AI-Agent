[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $SourceRoot,
    [string] $Version = '0.7.0'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$uv = Get-Command 'uv' -ErrorAction SilentlyContinue
if ($null -eq $uv) { throw 'Astral uv is required. Install uv, reopen PowerShell, and rerun setup rhino.' }
$package = "rhino3dm-mcp==$Version"

if ($PSCmdlet.ShouldProcess("uv tool '$package'", 'Install/update for the current user')) {
    & $uv.Source tool install --upgrade --from $package rhino3dm-mcp
    if ($LASTEXITCODE -ne 0) { throw "uv could not install $package (exit code $LASTEXITCODE)." }
    $toolBin = (& $uv.Source tool dir --bin | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($toolBin)) { throw 'uv could not resolve its tool executable directory.' }
    Complete-AecSetup 'rhino' (Join-Path $toolBin 'rhino-mcp.exe') 'installed/updated'
}
