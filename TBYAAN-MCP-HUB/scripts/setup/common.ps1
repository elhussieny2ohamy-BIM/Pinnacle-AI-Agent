function Get-AecSourceRoot {
    param([string] $Provided)

    if (-not [string]::IsNullOrWhiteSpace($Provided)) {
        return [System.IO.Path]::GetFullPath($Provided)
    }
    $fromEnvironment = [Environment]::GetEnvironmentVariable('PINNACLE_AEC_SOURCE_ROOT')
    if (-not [string]::IsNullOrWhiteSpace($fromEnvironment)) {
        return [System.IO.Path]::GetFullPath($fromEnvironment)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
}

function Get-AecProjectPath {
    param([string] $Root, [string] $Folder)
    return Join-Path $Root $Folder
}

function Assert-AecFile {
    param([string] $Path, [string] $Purpose)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Purpose was not found at '$Path'. Pass -SourceRoot to the MCP source folder or set PINNACLE_AEC_SOURCE_ROOT."
    }
}

function Complete-AecSetup {
    param([string] $Server, [string] $Target, [string] $Result)
    Write-Host ("{0}: {1} â€” {2}" -f $Server, $Result, $Target)
}

function Invoke-AecPowerShellScript {
    param(
        [string] $Path,
        [string[]] $Arguments = @(),
        [switch] $WhatIf
    )

    $shell = Get-Command 'powershell.exe' -ErrorAction SilentlyContinue
    if ($null -eq $shell) { $shell = Get-Command 'pwsh.exe' -ErrorAction SilentlyContinue }
    if ($null -eq $shell) { throw 'PowerShell 5.1 or PowerShell 7 is required to run this server installer.' }
    $commandArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Path) + $Arguments
    if ($WhatIf) { $commandArguments += '-WhatIf' }
    & $shell.Source @commandArguments
    if ($LASTEXITCODE -ne 0) { throw "Installer '$Path' failed with exit code $LASTEXITCODE." }
}

