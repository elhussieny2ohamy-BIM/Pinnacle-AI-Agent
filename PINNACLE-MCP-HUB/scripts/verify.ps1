[CmdletBinding()]
param(
    [string] $PackPath = (Join-Path $PSScriptRoot '..\..\pack-aec\index.js'),
    [string] $ArchivePath
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Require-Path([string] $RelativePath) {
    $path = Join-Path $projectRoot $RelativePath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { $failures.Add("Missing required file: $RelativePath") }
}

foreach ($path in @(
    'package.json', 'cordis.patch.yml', 'INTEGRATION.md', 'AGENTS.md', 'UPGRADE_PROMPT.md', 'servers.lock',
    'lib/index.js', 'lib/client.js', 'scripts/setup.ps1', 'scripts/setup/common.ps1'
)) { Require-Path $path }

$serverIds = @('rvt', 'navis', 'rhino', 'autocad', 'sketchup', 'civil3d')
foreach ($server in $serverIds) { Require-Path "scripts/setup/$server.ps1" }

$powerShellFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'scripts') -Filter '*.ps1' -Recurse -File)
foreach ($file in $powerShellFiles) {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$parseErrors)
    foreach ($parseError in $parseErrors) {
        $failures.Add("PowerShell syntax error in $($file.FullName): $($parseError.Message)")
    }
}

$packagePath = Join-Path $projectRoot 'package.json'
if (Test-Path -LiteralPath $packagePath) {
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    if ($package.engines.dsh -ne '>=0.2.2-alpha.3 <0.2.3') { $failures.Add('package.json engines.dsh no longer matches the tested DSH compatibility range.') }
    if ($package.dsh.bundle.patch -ne './cordis.patch.yml') { $failures.Add('package.json no longer points to cordis.patch.yml.') }
    if ($package.peerDependencies.'@deepseek-ai/dsh-typert-protocol' -ne '^0.2.2-alpha.3') { $failures.Add('Typert protocol peer range changed; review INTEGRATION.md.') }
}

$patchPath = Join-Path $projectRoot 'cordis.patch.yml'
if (Test-Path -LiteralPath $patchPath) {
    $patchText = Get-Content -LiteralPath $patchPath -Raw
    if ($patchText -notmatch "id:\s*pinnacle-mcp-hub") { $failures.Add('Bundle patch is missing the pinnacle-mcp-hub row.') }
    if ($patchText -notmatch "name:\s*'@pinnacle/mcp-hub'") { $failures.Add('Bundle patch does not insert the @pinnacle/mcp-hub package.') }
    if ($patchText -notmatch "packs:\s*\['@pinnacle/pack-aec'\]") { $failures.Add('Bundle patch does not configure the AEC pack.') }
}

$packFullPath = if ([System.IO.Path]::IsPathRooted($PackPath)) {
    [System.IO.Path]::GetFullPath($PackPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $PackPath))
}
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $packFullPath) 'README.md') -PathType Leaf)) {
    $failures.Add('AEC pack README.md is missing beside the pack entry point.')
}
if (Test-Path -LiteralPath $packFullPath -PathType Leaf) {
    $packText = Get-Content -LiteralPath $packFullPath -Raw
    if ($packText -match '[A-Za-z]:\\OPENCODE\\MCPs\\') { $failures.Add('AEC pack contains a developer-machine checkout path.') }
    foreach ($server in $serverIds) {
        if ($packText -notmatch "id:\s*'$server'") { $failures.Add("AEC pack does not declare '$server'.") }
    }
} else {
    $warnings.Add("AEC pack source not found at $packFullPath; pass -PackPath to verify a release checkout.")
}

$lockPath = Join-Path $projectRoot 'servers.lock'
if (Test-Path -LiteralPath $lockPath) {
    $lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
    foreach ($server in $serverIds) {
        if ($null -eq $lock.servers.$server.version) { $failures.Add("servers.lock has no version record for '$server'.") }
    }
}

if (-not [string]::IsNullOrWhiteSpace($ArchivePath)) {
    $archive = [System.IO.Path]::GetFullPath($ArchivePath)
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        $failures.Add("Tarball not found: $archive")
    } else {
        $tar = Get-Command 'tar.exe' -ErrorAction SilentlyContinue
        if ($null -eq $tar) { $warnings.Add('tar.exe is unavailable; skipped archive-content inspection.') }
        else {
            $entries = @(& $tar.Source -tzf $archive)
            if ($LASTEXITCODE -ne 0) { $failures.Add("Tarball could not be listed: $archive") }
            foreach ($entry in @('package/package.json', 'package/scripts/setup.ps1', 'package/INTEGRATION.md')) {
                if ($entries -notcontains $entry) { $failures.Add("Tarball is missing required entry '$entry'.") }
            }
        }
    }
}

foreach ($warning in $warnings) { Write-Warning $warning }
foreach ($failure in $failures) { Write-Error $failure -ErrorAction Continue }
if ($failures.Count -gt 0) { throw "verify failed with $($failures.Count) error(s)." }
Write-Host ("verify passed: required hub files are present, {0} setup handlers and {1} lock records are complete." -f $serverIds.Count, $serverIds.Count)

