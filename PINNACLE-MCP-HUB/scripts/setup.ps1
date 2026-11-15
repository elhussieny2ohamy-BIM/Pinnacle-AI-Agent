[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('rvt', 'navis', 'rhino', 'autocad', 'sketchup', 'civil3d')]
    [string] $Server,

    [string] $SourceRoot
)

$ErrorActionPreference = 'Stop'
$handler = Join-Path $PSScriptRoot ("setup\{0}.ps1" -f $Server)
if (-not (Test-Path -LiteralPath $handler -PathType Leaf)) {
    throw "No setup handler exists for '$Server': $handler"
}

if ($WhatIfPreference) {
    & $handler -SourceRoot $SourceRoot -WhatIf
} else {
    & $handler -SourceRoot $SourceRoot
}
