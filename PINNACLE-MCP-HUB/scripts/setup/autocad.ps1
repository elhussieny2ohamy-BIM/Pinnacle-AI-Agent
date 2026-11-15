[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $SourceRoot,
    [string] $Version = '1.8.0'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$uv = Get-Command 'uv' -ErrorAction SilentlyContinue
if ($null -eq $uv) { throw 'Astral uv is required. Install uv, reopen PowerShell, and rerun setup autocad.' }
$package = "autocad-mcp-pro==$Version"

if ($PSCmdlet.ShouldProcess("uv tool '$package'", 'Install/update for the current user')) {
    & $uv.Source tool install --upgrade --from $package autocad-mcp-pro
    if ($LASTEXITCODE -ne 0) { throw "uv could not install $package (exit code $LASTEXITCODE)." }
    $toolBin = (& $uv.Source tool dir --bin | Select-Object -Last 1).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($toolBin)) { throw 'uv could not resolve its tool executable directory.' }
    Complete-AecSetup 'autocad' (Join-Path $toolBin 'autocad-mcp.exe') 'installed/updated'
}
