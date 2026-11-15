[CmdletBinding()]
param(
    [string] $PackAecRoot = (Join-Path $PSScriptRoot '..\..\pack-aec'),
    [string] $OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist')
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$PackAecRoot = [System.IO.Path]::GetFullPath($PackAecRoot)
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$hubPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$packPackage = Get-Content -LiteralPath (Join-Path $PackAecRoot 'package.json') -Raw | ConvertFrom-Json
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory

& (Join-Path $PSScriptRoot 'verify.ps1') -PackPath (Join-Path $PackAecRoot 'index.js')

Push-Location $projectRoot
try {
    & pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'Hub build failed.' }
    & pnpm run pack
    if ($LASTEXITCODE -ne 0) { throw 'Hub pack failed.' }
} finally { Pop-Location }

Push-Location $PackAecRoot
try {
    & npm pack --pack-destination $OutputDirectory
    if ($LASTEXITCODE -ne 0) { throw 'AEC pack packaging failed.' }
} finally { Pop-Location }

$hubSource = Join-Path $OutputDirectory ("PINNACLE-mcp-hub-{0}.tgz" -f $hubPackage.version)
$packSource = Join-Path $OutputDirectory ("PINNACLE-pack-aec-{0}.tgz" -f $packPackage.version)
$hubTarget = Join-Path $OutputDirectory ("mcp-hub-{0}.tgz" -f $hubPackage.version)
$packTarget = Join-Path $OutputDirectory ("pack-aec-{0}.tgz" -f $packPackage.version)
$pairs = @(
    @{ Source = $hubSource; Target = $hubTarget },
    @{ Source = $packSource; Target = $packTarget }
)
foreach ($pair in $pairs) {
    if (-not (Test-Path -LiteralPath $pair.Source -PathType Leaf)) { throw "Expected pack output was not created: $($pair.Source)" }
    Copy-Item -LiteralPath $pair.Source -Destination $pair.Target -Force
    $hash = (Get-FileHash -LiteralPath $pair.Target -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath ($pair.Target + '.sha256') -Value "$hash  $([System.IO.Path]::GetFileName($pair.Target))" -Encoding ascii
}

$hubHash = (Get-FileHash -LiteralPath $hubTarget -Algorithm SHA256).Hash.ToLowerInvariant()
$latest = [ordered]@{
    version = $hubPackage.version
    url = [System.IO.Path]::GetFileName($hubTarget)
    sha256 = $hubHash
    minDsh = $hubPackage.engines.dsh -replace '^>=', ''
    packAec = [System.IO.Path]::GetFileName($packTarget)
    packAecSha256 = (Get-FileHash -LiteralPath $packTarget -Algorithm SHA256).Hash.ToLowerInvariant()
}
$json = $latest | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $OutputDirectory 'latest.json'), $json, [System.Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot 'verify.ps1') -PackPath (Join-Path $PackAecRoot 'index.js') -ArchivePath $hubTarget
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-hub.ps1') -Destination (Join-Path $OutputDirectory 'install-hub.ps1') -Force
Write-Host "Staged release in $OutputDirectory"

