[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $Profile = 'desktop',

    [string] $ReleaseDirectory,

    [string] $DshCommand
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not $ReleaseDirectory) {
    $localReleaseMetadata = Join-Path $PSScriptRoot 'latest.json'
    $workspaceReleaseDirectory = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\dist'))
    $workspaceReleaseMetadata = Join-Path $workspaceReleaseDirectory 'latest.json'
    $ReleaseDirectory = if (Test-Path -LiteralPath $localReleaseMetadata -PathType Leaf) {
        $PSScriptRoot
    } elseif (Test-Path -LiteralPath $workspaceReleaseMetadata -PathType Leaf) {
        $workspaceReleaseDirectory
    } else {
        throw 'Pass -ReleaseDirectory with the folder containing latest.json and both release tarballs.'
    }
}

function Add-DshCommandCandidate {
    param([System.Collections.Generic.List[string]] $Candidates, [string] $Path)

    if ($Path -and -not $Candidates.Contains($Path)) {
        $Candidates.Add($Path)
    }
}

function Get-DesktopInstallRoots {
    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $uninstallRoots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        foreach ($entry in (Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            $app = Get-ItemProperty -LiteralPath $entry.PSPath -ErrorAction SilentlyContinue
            if ($app.DisplayName -like '*DeepSeek Harness*' -and $app.InstallLocation) {
                [string]$app.InstallLocation
            }
        }
    }
}

function Get-DshCommandCandidates {
    param([string] $RequestedPath, [string] $SelectedProfile)

    $candidates = [System.Collections.Generic.List[string]]::new()
    if ($RequestedPath) { Add-DshCommandCandidate $candidates $RequestedPath; return $candidates }

    # Prefer Desktop's bundled runtime because npm-installed dsh cannot manage its reserved profile.
    $registered = Get-ItemProperty -LiteralPath 'HKCU:\Software\DeepSeekHarness\Command' -Name Directory -ErrorAction SilentlyContinue
    if ($registered -and $registered.Directory) {
        Add-DshCommandCandidate $candidates (Join-Path ([string]$registered.Directory) 'dsh.cmd')
    }
    foreach ($root in (Get-DesktopInstallRoots)) {
        Add-DshCommandCandidate $candidates (Join-Path $root 'resources\runtime\cli\bin\dsh.cmd')
    }

    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ($base) {
            Add-DshCommandCandidate $candidates (Join-Path $base 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
            Add-DshCommandCandidate $candidates (Join-Path $base 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
        }
    }
    if ($SelectedProfile -ne 'desktop') {
        $pathCommand = Get-Command dsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($pathCommand) { Add-DshCommandCandidate $candidates $pathCommand.Source }
    }
    return $candidates
}

function Find-DshCommand {
    param([string] $RequestedPath, [string] $SelectedProfile)

    $candidates = Get-DshCommandCandidates -RequestedPath $RequestedPath -SelectedProfile $SelectedProfile
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $candidate).Path)
        }
    }

    throw "Couldn't find DSH Desktop's bundled dsh.cmd. Install DSH Desktop first or pass -DshCommand with the full path to resources\runtime\cli\bin\dsh.cmd."
}

function Assert-ArtifactHash {
    param([string] $Path, [string] $ExpectedHash, [string] $FileName)

    $actualHash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if (-not $actualHash.Equals($ExpectedHash, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "SHA-256 verification failed for '$FileName'. Ensure the release file matches latest.json."
    }
}

function Get-VerifiedArtifactPath {
    param(
        [string] $SourceDirectory,
        [string] $FileName,
        [string] $ExpectedHash
    )

    if ($FileName -notmatch '^[A-Za-z0-9._-]+\.tgz$' -or
        $ExpectedHash -notmatch '^[A-Fa-f0-9]{64}$') {
        throw "Release metadata contains an invalid artifact name or SHA-256 value for '$FileName'."
    }

    $source = Join-Path $SourceDirectory $FileName
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Release artifact not found: $source"
    }
    Assert-ArtifactHash -Path $source -ExpectedHash $ExpectedHash -FileName $FileName
    return $source
}

function Copy-VerifiedArtifact {
    param(
        [string] $SourcePath,
        [string] $DestinationDirectory,
        [string] $FileName,
        [string] $ExpectedHash
    )

    $destination = Join-Path $DestinationDirectory $FileName
    Copy-Item -LiteralPath $SourcePath -Destination $destination -Force
    Assert-ArtifactHash -Path $destination -ExpectedHash $ExpectedHash -FileName $FileName
    return $destination
}

if (-not (Test-Path -LiteralPath $ReleaseDirectory -PathType Container)) {
    throw "Release folder is unavailable: $ReleaseDirectory"
}
$ReleaseDirectory = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $ReleaseDirectory).Path)

$metadataPath = Join-Path $ReleaseDirectory 'latest.json'
if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) {
    throw "Release metadata not found: $metadataPath"
}
$metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if ($metadata.version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$' -or
    $metadata.url -ne "mcp-hub-$($metadata.version).tgz" -or
    $metadata.packAec -ne "pack-aec-$($metadata.version).tgz") {
    throw 'latest.json does not describe a matching Hub and AEC pack release.'
}
$hubSource = Get-VerifiedArtifactPath -SourceDirectory $ReleaseDirectory -FileName $metadata.url -ExpectedHash $metadata.sha256
$packSource = Get-VerifiedArtifactPath -SourceDirectory $ReleaseDirectory -FileName $metadata.packAec -ExpectedHash $metadata.packAecSha256

$dsh = Find-DshCommand -RequestedPath $DshCommand -SelectedProfile $Profile
if ($Profile -eq 'desktop') {
    $runningDesktop = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'DeepSeek Harness.exe'" -ErrorAction SilentlyContinue)
    if ($runningDesktop.Count -gt 0) {
        throw 'Quit DeepSeek Harness Desktop fully before installing. Reopen it after the install finishes.'
    }
}

$installationSucceeded = $false
$dshHomePath = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$archiveDirectory = Join-Path (Join-Path (Join-Path $dshHomePath 'installers') 'PINNACLE-mcp-hub') $metadata.version

Write-Host "Release: @PINNACLE/mcp-hub $($metadata.version) + @PINNACLE/pack-aec $($metadata.version)"
Write-Host "DSH command: $dsh"

if ($PSCmdlet.ShouldProcess("DSH profile '$Profile'", 'Install the verified Hub and AEC pack tarballs')) {
    $null = New-Item -ItemType Directory -Path $archiveDirectory -Force
    $hubArchive = Copy-VerifiedArtifact -SourcePath $hubSource -DestinationDirectory $archiveDirectory -FileName $metadata.url -ExpectedHash $metadata.sha256
    $packArchive = Copy-VerifiedArtifact -SourcePath $packSource -DestinationDirectory $archiveDirectory -FileName $metadata.packAec -ExpectedHash $metadata.packAecSha256

    & $dsh plugin --profile $Profile add $hubArchive $packArchive
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw "DSH plugin installation failed with exit code $exitCode. Read the dsh output above for the compatibility or install error."
    }
    $installationSucceeded = $true
}

if ($installationSucceeded) {
    Write-Host "Installed both packages into the '$Profile' profile. Archives are retained in $archiveDirectory. Restart that DSH profile to load the Hub."
}

