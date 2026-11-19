#!/usr/bin/env pwsh
# =============================================================================
# Clients stage - configure MCP servers for the three AI agents:
#   1) Claude Desktop   -> %APPDATA%\Claude\claude_desktop_config.json
#   2) ChatGPT Desktop  -> %APPDATA%\ChatGPT\config.json (and legacy variants)
#   3) PINNACLE AI AGENT (dsh) -> ~/.dsh/profiles/web (mcp-manager / hub)
#
# Design rules:
#   - Every write is backed up first (<file>.bak_pinnacle_<timestamp>).
#   - Merging is additive: existing entries are preserved unless -Force.
#   - Only servers whose executable (or node script) actually exists are added.
#   - The PINNACLE hub, when installed, already auto-discovers servers through
#     @pinnacle/pack-aec, so we do NOT duplicate them in mcp-manager config.
# =============================================================================

function Get-FirstExistingFile {
    param([string[]] $Candidates, [string] $Fallback)
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $Fallback
}

function Resolve-NodeCommand {
    $node = Get-Command 'node' -CommandType Application -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    return 'node'
}

# Build the canonical MCP server catalog from the real per-user install paths.
function Get-McpServerCatalog {
    $LOCAL = $env:LOCALAPPDATA
    $ROAM  = $env:APPDATA
    $USER  = $env:USERPROFILE
    $docs  = [Environment]::GetFolderPath('MyDocuments')
    $node  = Resolve-NodeCommand

    $rvtExe      = Join-Path $LOCAL 'Bimwright\rvt-mcp\server\current\rvt-mcp.exe'
    $navisExe    = Join-Path $LOCAL 'NavisHelper\McpServer\NavisHelper.McpServer.exe'
    $civil3dJs   = Join-Path $ROAM  'MCP Civil 3D\index.js'
    $sketchupJs  = Join-Path $LOCAL 'Programs\SketchUp MCP\server\index.mjs'
    $autocadBin  = Join-Path $USER  '.local\bin\autocad-mcp.exe'
    $autocadAlt  = Join-Path $ROAM  'MCP AutoCAD\MCPAutoCADServer.exe'
    $rhinoBin    = Join-Path $USER  '.local\bin\rhino-mcp.exe'
    $rhinoAlt    = Join-Path $ROAM  'MCP Rhino\MCPRhinoServer.exe'

    $autocad = Get-FirstExistingFile @($autocadBin, $autocadAlt) $autocadBin
    $rhino   = Get-FirstExistingFile @($rhinoBin, $rhinoAlt) $rhinoBin

    $catalog = [ordered]@{}

    $catalog['rvt-mcp'] = [ordered]@{
        command      = $rvtExe
        args         = @()
        env          = [ordered]@{}
        requiredPath = $rvtExe
    }

    $catalog['navis-mcp'] = [ordered]@{
        command      = $navisExe
        args         = @()
        env          = [ordered]@{}
        requiredPath = $navisExe
    }

    $catalog['autocad-mcp'] = [ordered]@{
        command      = $autocad
        args         = @('--port', '8080')
        env          = [ordered]@{
            AUTOCAD_MCP_BACKEND = 'auto'
            ALLOWED_PATHS       = $docs
        }
        requiredPath = $autocad
    }

    $catalog['civil3d-mcp'] = [ordered]@{
        command      = $node
        args         = @($civil3dJs, '--stdio')
        env          = [ordered]@{
            CIVIL3D_ENABLE_NETWORKS = 'true'
            CIVIL3D_ENABLE_SURFACES = 'true'
            LOG_LEVEL               = 'info'
        }
        requiredPath = $civil3dJs
    }

    $catalog['rhino-mcp'] = [ordered]@{
        command      = $rhino
        args         = @('--transport', 'stdio')
        env          = [ordered]@{
            RHINO_MCP_TRANSPORT  = 'stdio'
            RHINO_PORT           = '4242'
            ENABLE_REVIT_BRIDGE  = '0'
        }
        requiredPath = $rhino
    }

    $catalog['sketchup-mcp'] = [ordered]@{
        command      = $node
        args         = @($sketchupJs)
        env          = [ordered]@{
            SKETCHUP_MCP_PORT    = '9876'
            SKETCHUP_MCP_TIMEOUT = '120'
        }
        requiredPath = $sketchupJs
    }

    return $catalog
}

# Keep only the servers whose launcher file exists on this machine.
function Get-AvailableServers {
    param([System.Collections.Specialized.OrderedDictionary] $Catalog)
    $available = [ordered]@{}
    foreach ($name in $Catalog.Keys) {
        $entry = $Catalog[$name]
        if (Test-Path -LiteralPath $entry.requiredPath -PathType Leaf) {
            $available[$name] = $entry
        }
    }
    return $available
}

# -----------------------------------------------------------------------------
# JSON client config (Claude Desktop / ChatGPT Desktop)
# -----------------------------------------------------------------------------
# Paths that are legitimately MCP configuration files. Anything else is only
# written when it already contains an `mcpServers` object, so app state such as
# Claude\config.json (theme, OAuth cache, window position) is never touched.
function Test-KnownMcpConfigPath {
    param([string] $Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $known = @(
        (Join-Path $env:APPDATA      'Claude\claude_desktop_config.json'),
        (Join-Path $env:LOCALAPPDATA 'Claude\claude_desktop_config.json'),
        (Join-Path $env:APPDATA      'ChatGPT\config.json'),
        (Join-Path $env:APPDATA      'ChatGPT\mcp.json'),
        (Join-Path $env:LOCALAPPDATA 'ChatGPT\config.json'),
        (Join-Path $env:LOCALAPPDATA 'ChatGPT\mcp.json'),
        (Join-Path $env:APPDATA      'OpenAI\ChatGPT\config.json'),
        (Join-Path $env:LOCALAPPDATA 'OpenAI\ChatGPT\config.json')
    ) | ForEach-Object { [System.IO.Path]::GetFullPath($_) }
    return ($known -contains $full)
}

# Identify the file a server entry actually launches, so the same server
# configured under a different name is not added twice.
function Get-ServerTarget {
    param($Entry)
    if ($null -eq $Entry) { return $null }
    $candidates = @()
    if ($Entry.command) { $candidates += [string]$Entry.command }
    foreach ($a in @($Entry.args)) { if ($a) { $candidates += [string]$a } }
    $launchers = @('node.exe', 'node', 'uv.exe', 'uv', 'python.exe', 'python', 'py.exe', 'npx.cmd', 'npx')
    foreach ($c in $candidates) {
        $leaf = [System.IO.Path]::GetFileName($c).ToLower()
        if ($launchers -contains $leaf) { continue }
        if ($leaf -match '\.(exe|js|mjs|cjs|py)$') { return $leaf }
    }
    return $null
}

function Merge-JsonMcpServers {
    param(
        [string] $Path,
        [System.Collections.Specialized.OrderedDictionary] $Servers,
        [switch] $Force,
        [switch] $WhatIf
    )

    if ($WhatIf) {
        Write-Host "    [WhatIf] would merge $($Servers.Count) server(s) into: $Path" -ForegroundColor Gray
        return
    }

    $dir = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    $doc = $null
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try {
            $doc = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        }
        catch {
            throw "Invalid JSON in $Path : $($_.Exception.Message)"
        }
    }

    # Safety: only touch a known MCP config or a file that already has mcpServers.
    $hasMcpKey = ($null -ne $doc) -and ($doc.PSObject.Properties.Name -contains 'mcpServers')
    if (-not $hasMcpKey -and -not (Test-KnownMcpConfigPath -Path $Path)) {
        Write-Host "    - skipped (not an MCP config file): $Path" -ForegroundColor Yellow
        return
    }

    if ($null -ne $doc) {
        $backup = "$Path.bak_pinnacle_$(Get-Date -Format 'yyyyMMdd_HHmmssfff')"
        Copy-Item -LiteralPath $Path -Destination $backup -Force
        Write-Host "    backup: $backup" -ForegroundColor DarkGray
    }
    if ($null -eq $doc) { $doc = [pscustomobject]@{} }

    if (-not ($doc.PSObject.Properties.Name -contains 'mcpServers')) {
        $doc | Add-Member -NotePropertyName 'mcpServers' -NotePropertyValue ([pscustomobject]@{}) -Force
    }
    $mcp = $doc.mcpServers

    # Map already-configured launch targets to their entry names.
    $existingTargets = @{}
    foreach ($prop in $mcp.PSObject.Properties) {
        $t = Get-ServerTarget -Entry $prop.Value
        if ($t -and -not $existingTargets.ContainsKey($t)) { $existingTargets[$t] = $prop.Name }
    }

    foreach ($name in $Servers.Keys) {
        $entry = $Servers[$name]
        $obj = [pscustomobject]@{
            command = $entry.command
            args    = @($entry.args)
            env     = [pscustomobject]$entry.env
        }
        if ($mcp.PSObject.Properties.Name -contains $name) {
            if ($Force) {
                $mcp.$name = $obj
                Write-Host "    updated: $name" -ForegroundColor Yellow
            }
            else {
                Write-Host "    kept existing: $name (use -ForceClientConfig to update)" -ForegroundColor DarkGray
            }
            continue
        }

        $target = Get-ServerTarget -Entry $obj
        if ($target -and $existingTargets.ContainsKey($target)) {
            Write-Host "    - already configured as '$($existingTargets[$target])' (same launcher): $name" -ForegroundColor DarkGray
            continue
        }

        $mcp | Add-Member -NotePropertyName $name -NotePropertyValue $obj -Force
        if ($target) { $existingTargets[$target] = $name }
        Write-Host "    added: $name" -ForegroundColor Green
    }

    $doc | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $Path -Encoding UTF8
    Write-Host "    wrote: $Path" -ForegroundColor Green
}

function Get-ClaudeConfigPaths {
    $paths = [System.Collections.Generic.List[string]]::new()
    # Claude Desktop reads MCP servers ONLY from claude_desktop_config.json.
    # (Claude\config.json is application state: theme, OAuth cache, window
    # position. Writing mcpServers into it would corrupt that state.)
    $candidates = @(
        (Join-Path $env:APPDATA      'Claude\claude_desktop_config.json'),
        (Join-Path $env:LOCALAPPDATA 'Claude\claude_desktop_config.json')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $paths.Add($candidate) }
    }
    if ($paths.Count -eq 0 -and (Test-Path -LiteralPath (Join-Path $env:APPDATA 'Claude') -PathType Container)) {
        $paths.Add((Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'))
    }
    return @($paths)
}

function Get-ChatGptConfigPaths {
    $paths = [System.Collections.Generic.List[string]]::new()
    $candidates = @(
        (Join-Path $env:APPDATA      'ChatGPT\config.json'),
        (Join-Path $env:APPDATA      'ChatGPT\mcp.json'),
        (Join-Path $env:LOCALAPPDATA 'ChatGPT\config.json'),
        (Join-Path $env:LOCALAPPDATA 'ChatGPT\mcp.json'),
        (Join-Path $env:APPDATA      'OpenAI\ChatGPT\config.json'),
        (Join-Path $env:LOCALAPPDATA 'OpenAI\ChatGPT\config.json')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { $paths.Add($candidate) }
    }
    if ($paths.Count -eq 0 -and (Test-Path -LiteralPath (Join-Path $env:APPDATA 'ChatGPT') -PathType Container)) {
        $paths.Add((Join-Path $env:APPDATA 'ChatGPT\config.json'))
    }
    return @($paths)
}

# -----------------------------------------------------------------------------
# PINNACLE AI AGENT (dsh) config
# -----------------------------------------------------------------------------
function Format-YamlScalar {
    param([string] $Value)
    if ($null -eq $Value) { return "''" }
    return "'" + ($Value -replace "'", "''") + "'"
}

function New-PinnacleServersYaml {
    param([System.Collections.Specialized.OrderedDictionary] $Servers)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('# >>> PINNACLE MCP SERVERS (managed by Pinnacle MCP Setup) >>>')
    [void]$sb.AppendLine('# Remove this block to let the PINNACLE hub/pack-aec own discovery again.')
    [void]$sb.AppendLine('- id: mcp-manager')
    [void]$sb.AppendLine('  config:')
    [void]$sb.AppendLine('    servers:')
    foreach ($name in $Servers.Keys) {
        $entry = $Servers[$name]
        [void]$sb.AppendLine("      ${name}:")
        [void]$sb.AppendLine('        transport: stdio')
        [void]$sb.AppendLine("        command: $(Format-YamlScalar $entry.command)")
        $argList = ($entry.args | ForEach-Object { Format-YamlScalar ([string]$_) }) -join ', '
        [void]$sb.AppendLine("        args: [${argList}]")
        if ($entry.env -and $entry.env.Count -gt 0) {
            [void]$sb.AppendLine('        env:')
            foreach ($key in $entry.env.Keys) {
                [void]$sb.AppendLine("          ${key}: $(Format-YamlScalar ([string]$entry.env[$key]))")
            }
        }
        else {
            [void]$sb.AppendLine('        env: {}')
        }
        [void]$sb.AppendLine('        enabled: true')
        [void]$sb.AppendLine('        startupTimeoutMs: 60000')
    }
    [void]$sb.AppendLine('# <<< PINNACLE MCP SERVERS <<<')
    return $sb.ToString()
}

function Install-PinnacleConfig {
    param(
        [System.Collections.Specialized.OrderedDictionary] $Servers,
        [switch] $Force,
        [switch] $WhatIf
    )

    $profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
    if (-not (Test-Path -LiteralPath $profileDir -PathType Container)) {
        Write-Host "    PINNACLE (dsh) not installed - skipping" -ForegroundColor Yellow
        return
    }

    # Always fix the MCP manager list first: this is what the UI reads and what
    # produced "Disabled - 0 tools" in the first place.
    Install-DshMcpManagerConfig -Servers $Servers -Force:$Force -WhatIf:$WhatIf

    $pkgPath = Join-Path $profileDir 'package.json'
    $hubInstalled = $false
    if (Test-Path -LiteralPath $pkgPath -PathType Leaf) {
        try {
            $pkg = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
            if ($pkg.dependencies -and ($pkg.dependencies.PSObject.Properties.Name -contains '@pinnacle/mcp-hub')) {
                $hubInstalled = $true
            }
        }
        catch {
            Write-Host "    could not read $pkgPath - skipping PINNACLE config" -ForegroundColor Yellow
            return
        }
    }

    if ($hubInstalled) {
        Write-Host "    @pinnacle/mcp-hub present - servers auto-discovered via @pinnacle/pack-aec" -ForegroundColor Green
        return
    }

    $patchPath = Join-Path $profileDir 'cordis.patch.yml'
    $marker = '# >>> PINNACLE MCP SERVERS (managed by Pinnacle MCP Setup) >>>'

    if ($WhatIf) {
        Write-Host "    [WhatIf] would add mcp-manager servers block to: $patchPath" -ForegroundColor Gray
        return
    }

    $content = ''
    if (Test-Path -LiteralPath $patchPath -PathType Leaf) {
        $content = Get-Content -LiteralPath $patchPath -Raw
        $backup = "$patchPath.bak_pinnacle_$(Get-Date -Format 'yyyyMMdd_HHmmssfff')"
        Copy-Item -LiteralPath $patchPath -Destination $backup -Force
        Write-Host "    backup: $backup" -ForegroundColor DarkGray
    }

    if ($content -match [regex]::Escape($marker)) {
        if (-not $Force) {
            Write-Host "    mcp-manager block already present - kept (use -ForceClientConfig to rewrite)" -ForegroundColor DarkGray
            return
        }
        # Drop the previous managed block before re-appending.
        $content = [regex]::Replace(
            $content,
            "(?s)\r?\n# >>> PINNACLE MCP SERVERS \(managed by Pinnacle MCP Setup\) >>>.*?# <<< PINNACLE MCP SERVERS <<<",
            ''
        )
    }

    $block = New-PinnacleServersYaml -Servers $Servers
    $newContent = $content.TrimEnd() + "`r`n" + $block
    Set-Content -LiteralPath $patchPath -Value $newContent -Encoding UTF8
    Write-Host "    wrote mcp-manager servers into: $patchPath" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# dsh MCP manager (the list behind the PINNACLE "MCP Servers" screen)
# -----------------------------------------------------------------------------
# This file is the reason servers can show "Disabled - 0 tools" even when they
# are installed correctly. The setup must write enabled=true here instead of
# relying on the hub/pack-aec discovery path.
function Install-DshMcpManagerConfig {
    param(
        [System.Collections.Specialized.OrderedDictionary] $Servers,
        [switch] $Force,
        [switch] $WhatIf
    )

    $path = Join-Path $env:USERPROFILE '.dsh\@it-glen\dsh-mcp-manager\mcp.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Host "    mcp-manager config not found - skipping: $path" -ForegroundColor Yellow
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] would enable $($Servers.Count) server(s) in: $path" -ForegroundColor Gray
        return
    }

    try {
        $doc = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "    could not read $path - skipping" -ForegroundColor Yellow
        return
    }

    $backup = "$path.bak_pinnacle_$(Get-Date -Format 'yyyyMMdd_HHmmssfff')"
    Copy-Item -LiteralPath $path -Destination $backup -Force
    Write-Host "    backup: $backup" -ForegroundColor DarkGray

    $existing = @{}
    $list = @()
    foreach ($entry in @($doc.servers)) {
        if ($null -eq $entry) { continue }
        $list += $entry
        if ($entry.name) { $existing[[string]$entry.name] = $entry }
    }

    $changed = 0
    foreach ($name in $Servers.Keys) {
        $source = $Servers[$name]
        $argsList = @($source.args)
        $envMap = @{}
        foreach ($key in $source.env.Keys) { $envMap[$key] = [string]$source.env[$key] }

        if ($existing.ContainsKey($name)) {
            $entry = $existing[$name]
            $before = "$($entry.command)|$($entry.enabled)|$($entry.args -join ' ')"
            $entry.enabled = $true
            $entry.transport = 'stdio'
            if ($Force -or -not $entry.command) {
                $entry.command = [string]$source.command
                $entry.args = @($argsList)
            }
            if ($entry.PSObject.Properties.Name -contains 'env') {
                foreach ($key in $envMap.Keys) {
                    $entry.env | Add-Member -NotePropertyName $key -NotePropertyValue $envMap[$key] -Force
                }
            }
            else {
                $entry | Add-Member -NotePropertyName 'env' -NotePropertyValue ([pscustomobject]$envMap) -Force
            }
            $after = "$($entry.command)|$($entry.enabled)|$($entry.args -join ' ')"
            if ($before -ne $after) { $changed++ }
        }
        else {
            $entry = [pscustomobject]@{
                name               = $name
                transport          = 'stdio'
                enabled            = $true
                toolCallTimeoutMs  = 120000
                reconnect          = [pscustomobject]@{}
                command            = [string]$source.command
                args               = @($argsList)
                env                = [pscustomobject]$envMap
            }
            $list += $entry
            $existing[$name] = $entry
            $changed++
        }
    }

    $doc.servers = @($list)
    $doc | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host "    enabled $($Servers.Count) server(s) in: $path ($changed updated)" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# OpenCode (opencode.json) - only when OpenCode is already installed
# -----------------------------------------------------------------------------
function Install-OpenCodeConfig {
    param(
        [System.Collections.Specialized.OrderedDictionary] $Servers,
        [switch] $Force,
        [switch] $WhatIf
    )

    $configDir = if ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME 'opencode' }
                 else { Join-Path $env:USERPROFILE '.config\opencode' }
    $path = if ($env:OPENCODE_CONFIG) { $env:OPENCODE_CONFIG } else { Join-Path $configDir 'opencode.json' }

    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Write-Host "    OpenCode config not found - skipping: $path" -ForegroundColor DarkGray
        return
    }

    if ($WhatIf) {
        Write-Host "    [WhatIf] would merge $($Servers.Count) server(s) into: $path" -ForegroundColor Gray
        return
    }

    try {
        $doc = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    }
    catch {
        Write-Host "    could not read $path - skipping" -ForegroundColor Yellow
        return
    }

    $backup = "$path.bak_pinnacle_$(Get-Date -Format 'yyyyMMdd_HHmmssfff')"
    Copy-Item -LiteralPath $path -Destination $backup -Force
    Write-Host "    backup: $backup" -ForegroundColor DarkGray

    if (-not ($doc.PSObject.Properties.Name -contains 'mcp') -or $null -eq $doc.mcp) {
        $doc | Add-Member -NotePropertyName 'mcp' -NotePropertyValue ([pscustomobject]@{}) -Force
    }

    $added = 0
    foreach ($name in $Servers.Keys) {
        $source = $Servers[$name]
        $command = @([string]$source.command) + @($source.args | ForEach-Object { [string]$_ })
        $envMap = [ordered]@{}
        foreach ($key in $source.env.Keys) { $envMap[$key] = [string]$source.env[$key] }

        $entry = [pscustomobject]@{
            type        = 'local'
            command     = @($command)
            enabled     = $true
            environment = [pscustomobject]$envMap
        }

        if ($doc.mcp.PSObject.Properties.Name -contains $name) {
            if ($Force) { $doc.mcp.$name = $entry; $added++ }
            else { $doc.mcp.$name.enabled = $true }
        }
        else {
            $doc.mcp | Add-Member -NotePropertyName $name -NotePropertyValue $entry -Force
            $added++
        }
    }

    $doc | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $path -Encoding UTF8
    Write-Host "    wrote OpenCode MCP servers: $path ($added added/updated)" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# Reference file for PINNACLE / manual use
# -----------------------------------------------------------------------------
function Write-PinnacleReference {
    param(
        [string] $RepoRoot,
        [System.Collections.Specialized.OrderedDictionary] $Servers,
        [switch] $WhatIf
    )
    # Write to a per-user location so the silent installer never needs write
    # access to Program Files.
    $outDir  = Join-Path $env:LOCALAPPDATA 'PINNACLE\mcp'
    $outPath = Join-Path $outDir 'pinnacle-mcp-servers.json'
    if ($WhatIf) {
        Write-Host "    [WhatIf] would write reference: $outPath" -ForegroundColor Gray
        return
    }
    if (-not (Test-Path -LiteralPath $outDir -PathType Container)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    $map = [ordered]@{}
    foreach ($name in $Servers.Keys) {
        $entry = $Servers[$name]
        $map[$name] = [ordered]@{
            transport = 'stdio'
            command   = $entry.command
            args      = @($entry.args)
            env       = $entry.env
            enabled   = $true
        }
    }
    ([ordered]@{ mcpServers = $map }) | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $outPath -Encoding UTF8
    Write-Host "    reference: $outPath" -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Stage entry point
# -----------------------------------------------------------------------------
function Install-Clients {
    param(
        [string] $RepoRoot,
        [switch] $ForceClientConfig,
        [switch] $WhatIf
    )

    Write-Host "  Building MCP server catalog ..." -ForegroundColor DarkCyan
    $catalog   = Get-McpServerCatalog
    $available = Get-AvailableServers -Catalog $catalog

    Write-Host "  Available servers: $($available.Count)/$($catalog.Count)" -ForegroundColor Cyan
    foreach ($name in $catalog.Keys) {
        $mark = if ($available.Contains($name)) { 'OK  ' } else { 'MISS' }
        $color = if ($available.Contains($name)) { 'Green' } else { 'DarkGray' }
        Write-Host "    [$mark] $name" -ForegroundColor $color
    }

    if ($available.Count -eq 0) {
        Write-Host "  No MCP server executables found - skipping client configuration." -ForegroundColor Yellow
        return
    }

    # 1) Claude Desktop
    Write-Host "`n  Claude Desktop ..." -ForegroundColor Cyan
    $claudePaths = @(Get-ClaudeConfigPaths)
    if ($claudePaths.Count -eq 0) {
        Write-Host "    Claude Desktop not installed - skipping" -ForegroundColor Yellow
    }
    else {
        foreach ($path in $claudePaths) {
            Merge-JsonMcpServers -Path $path -Servers $available -Force:$ForceClientConfig -WhatIf:$WhatIf
        }
    }

    # 2) ChatGPT Desktop
    Write-Host "`n  ChatGPT Desktop ..." -ForegroundColor Cyan
    $chatgptPaths = @(Get-ChatGptConfigPaths)
    if ($chatgptPaths.Count -eq 0) {
        Write-Host "    ChatGPT Desktop not installed - skipping" -ForegroundColor Yellow
    }
    else {
        foreach ($path in $chatgptPaths) {
            Merge-JsonMcpServers -Path $path -Servers $available -Force:$ForceClientConfig -WhatIf:$WhatIf
        }
    }

    # 3) PINNACLE AI AGENT (dsh)
    Write-Host "`n  PINNACLE AI AGENT (dsh) ..." -ForegroundColor Cyan
    Install-PinnacleConfig -Servers $available -Force:$ForceClientConfig -WhatIf:$WhatIf

    # 4) OpenCode (only if installed; never creates a config from scratch)
    Write-Host "`n  OpenCode ..." -ForegroundColor Cyan
    Install-OpenCodeConfig -Servers $available -Force:$ForceClientConfig -WhatIf:$WhatIf

    # Reference file
    Write-PinnacleReference -RepoRoot $RepoRoot -Servers $available -WhatIf:$WhatIf

    Write-Host "`n  Client configuration complete." -ForegroundColor Green
}
