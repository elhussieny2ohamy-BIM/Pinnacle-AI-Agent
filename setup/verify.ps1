#!/usr/bin/env pwsh
# =============================================================================
# Verify stage - protocol-level check of every MCP server.
#
# A file check is not enough: a server can exist and still start with 0 tools
# (wrong transport, missing host add-in, broken entrypoint). This stage performs
# a real JSON-RPC handshake (initialize + tools/list) and reports the tool count.
#
# It also reports:
#   - mcp-manager entries that are present but disabled
#   - host add-ins that are not installed (the server will start, but host-side
#     tool calls will fail until the CAD/BIM application is running with them)
# =============================================================================

$script:ProbeSource = @'
const { spawn } = require('node:child_process');
const cfg = JSON.parse(Buffer.from(process.env.PINNACLE_PROBE_CFG || '', 'base64').toString('utf8'));
const child = spawn(cfg.command, cfg.args || [], {
  env: { ...process.env, ...(cfg.env || {}) },
  cwd: cfg.cwd || undefined,
  windowsHide: true
});
let buf = '';
let err = '';
let done = false;
let result = null;

function parse() {
  let idx;
  while ((idx = buf.indexOf('Content-Length:')) !== -1) {
    const end = buf.indexOf('\r\n\r\n', idx);
    if (end === -1) return;
    const len = parseInt(buf.slice(idx + 15, end).trim(), 10);
    const start = end + 4;
    if (buf.length < start + len) return;
    const payload = buf.slice(start, start + len);
    buf = buf.slice(start + len);
    try { handle(JSON.parse(payload)); } catch (e) { }
  }
  const lines = buf.split(/\r?\n/);
  buf = lines.pop();
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith('{')) { try { handle(JSON.parse(t)); } catch (e) { } }
  }
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.id === 1) {
    if (msg.error) { result = { ok: false, stage: 'initialize', error: msg.error }; return finish(); }
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  }
  if (msg.id === 2) {
    if (msg.error) { result = { ok: false, stage: 'tools/list', error: msg.error }; return finish(); }
    const tools = (msg.result && msg.result.tools) || [];
    result = {
      ok: tools.length > 0,
      stage: tools.length > 0 ? 'ready' : 'no-tools',
      toolCount: tools.length,
      sample: tools.slice(0, 3).map(t => t.name)
    };
    finish();
  }
}

function finish() {
  if (done) return;
  done = true;
  try { child.kill(); } catch (e) { }
  console.log(JSON.stringify(result));
  setTimeout(() => process.exit(0), 50);
}

child.stdout.on('data', d => { buf += d.toString(); parse(); });
child.stderr.on('data', d => { err += d.toString(); });
child.on('error', e => {
  result = { ok: false, stage: 'spawn', error: String((e && e.message) || e) };
  finish();
});
child.on('exit', c => {
  if (!done) {
    result = { ok: false, stage: 'exit', code: c, stderr: err.slice(0, 400) };
    finish();
  }
});
child.stdin.write(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'pinnacle-setup-verify', version: '1.0' }
  }
}) + '\n');
setTimeout(() => {
  if (!done) {
    result = { ok: false, stage: 'timeout', stderr: err.slice(0, 400) };
    finish();
  }
}, 25000);
'@

# Servers are checked in the same order the clients use, with the exact command
# line the setup writes into mcp.json / opencode.json.
function Get-VerifyServers {
    $LOCAL = $env:LOCALAPPDATA
    $ROAM  = $env:APPDATA
    $USER  = $env:USERPROFILE
    $docs  = [Environment]::GetFolderPath('MyDocuments')

    return @(
        @{
            Name        = 'revit-mcp'
            DisplayName = 'Revit'
            Command     = (Join-Path $LOCAL 'Bimwright\rvt-mcp\server\current\rvt-mcp.exe')
            Args        = @()
            Env         = @{}
            HostHint    = (Join-Path $ROAM 'Autodesk\Revit\Addins')
        },
        @{
            Name        = 'navis-mcp'
            DisplayName = 'Navisworks'
            Command     = (Join-Path $LOCAL 'NavisHelper\McpServer\NavisHelper.McpServer.exe')
            Args        = @()
            Env         = @{}
            HostHint    = (Join-Path $ROAM 'Autodesk\ApplicationPlugins\NavisHelper.bundle')
        },
        @{
            Name        = 'civil3d-mcp'
            DisplayName = 'Civil 3D'
            Command     = 'node'
            Args        = @((Join-Path $ROAM 'MCP Civil 3D\index.js'), '--stdio')
            Env         = @{ MCP_HTTP_PORT = '3001' }
            HostHint    = (Join-Path $ROAM 'Autodesk\ApplicationPlugins\MCPCivil3D.bundle')
        },
        @{
            Name        = 'sketchup-mcp'
            DisplayName = 'SketchUp'
            Command     = 'node'
            Args        = @((Join-Path $LOCAL 'Programs\SketchUp MCP\server\index.mjs'))
            Env         = @{ SKETCHUP_MCP_PORT = '9876'; SKETCHUP_MCP_TIMEOUT = '120' }
            HostHint    = (Join-Path $ROAM 'SketchUp')
        },
        @{
            Name        = 'autocad-mcp'
            DisplayName = 'AutoCAD'
            Command     = (Join-Path $USER '.local\bin\autocad-mcp.exe')
            Args        = @('--port', '8080')
            Env         = @{ AUTOCAD_MCP_BACKEND = 'auto'; ALLOWED_PATHS = $docs }
            HostHint    = (Join-Path $ROAM 'Autodesk\ApplicationPlugins\MCPAutoCAD.bundle')
        },
        @{
            Name        = 'rhino-mcp'
            DisplayName = 'Rhino'
            Command     = (Join-Path $USER '.local\bin\rhino-mcp.exe')
            Args        = @('--transport', 'stdio')
            Env         = @{ RHINO_MCP_TRANSPORT = 'stdio'; RHINO_PORT = '4242' }
            HostHint    = (Join-Path $ROAM 'McNeel\Rhinoceros')
        }
    )
}

function Test-PathEntry {
    param([string] $Path)
    if (-not $Path) { return $false }
    return (Test-Path -LiteralPath $Path)
}

function Invoke-McpProbe {
    param(
        [hashtable] $Server,
        [string]   $ProbePath,
        [switch]   $WhatIf
    )

    if (-not (Test-Path -LiteralPath $Server.Command -PathType Leaf) -and
        -not (Get-Command $Server.Command -CommandType Application -ErrorAction SilentlyContinue)) {
        return [pscustomobject]@{
            Ok     = $false
            Stage  = 'missing'
            ToolCount = 0
            Detail = "launcher not found: $($Server.Command)"
        }
    }

    if ($WhatIf) {
        return [pscustomobject]@{ Ok = $true; Stage = 'whatif'; ToolCount = 0; Detail = 'not executed (-WhatIf)' }
    }

    $cfg = @{
        command = $Server.Command
        args    = @($Server.Args)
        env     = $Server.Env
    }
    $env:PINNACLE_PROBE_CFG = [Convert]::ToBase64String(
        [System.Text.Encoding]::UTF8.GetBytes(($cfg | ConvertTo-Json -Compress -Depth 8))
    )
    try {
        $raw = (& node $ProbePath 2>$null) | Select-Object -Last 1
    }
    finally {
        Remove-Item Env:PINNACLE_PROBE_CFG -ErrorAction SilentlyContinue
    }

    if (-not $raw) {
        return [pscustomobject]@{ Ok = $false; Stage = 'no-output'; ToolCount = 0; Detail = 'probe produced no output' }
    }

    try {
        $result = $raw | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{ Ok = $false; Stage = 'bad-output'; ToolCount = 0; Detail = [string]$raw }
    }

    $detail = ''
    if ($result.PSObject.Properties.Name -contains 'stderr' -and $result.stderr) { $detail = [string]$result.stderr }
    elseif ($result.PSObject.Properties.Name -contains 'error' -and $result.error) { $detail = ($result.error | ConvertTo-Json -Compress -Depth 5) }

    return [pscustomobject]@{
        Ok        = [bool]$result.ok
        Stage     = [string]$result.stage
        ToolCount = [int]$result.toolCount
        Detail    = $detail
    }
}

function Get-DisabledManagerServers {
    $path = Join-Path $env:USERPROFILE '.dsh\@it-glen\dsh-mcp-manager\mcp.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @() }
    try {
        $doc = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
        return @($doc.servers | Where-Object { $_.enabled -eq $false } | ForEach-Object { $_.name })
    }
    catch {
        return @()
    }
}

function Verify-Servers {
    param([switch] $WhatIf)

    $servers = Get-VerifyServers
    $probePath = Join-Path $env:TEMP 'pinnacle-mcp-probe.js'
    if (-not $WhatIf) {
        [System.IO.File]::WriteAllText($probePath, $script:ProbeSource, (New-Object System.Text.UTF8Encoding($false)))
    }

    Write-Host "`nProtocol check (initialize + tools/list):" -ForegroundColor Cyan

    $results = @()
    foreach ($server in $servers) {
        Write-Host "  >> $($server.DisplayName) ..." -ForegroundColor DarkCyan
        $probe = Invoke-McpProbe -Server $server -ProbePath $probePath -WhatIf:$WhatIf
        $results += [pscustomobject]@{
            Name     = $server.Name
            Display  = $server.DisplayName
            Ok       = $probe.Ok
            Tools    = $probe.ToolCount
            Stage    = $probe.Stage
            Detail   = $probe.Detail
            HostHint = $server.HostHint
        }
        if ($probe.Ok) {
            Write-Host "     [ok] $($probe.ToolCount) tools" -ForegroundColor Green
        }
        else {
            Write-Host "     [fail] $($probe.Stage): $($probe.Detail)" -ForegroundColor Red
        }
    }

    if (-not $WhatIf) {
        Remove-Item -LiteralPath $probePath -Force -ErrorAction SilentlyContinue
    }

    # Host add-ins make the difference between "server starts" and "tool call
    # actually reaches Revit / Navisworks / Civil 3D / Rhino / SketchUp".
    Write-Host "`nHost add-in presence (warnings only):" -ForegroundColor Cyan
    foreach ($row in $results) {
        $hint = $row.HostHint
        if (-not $hint) { continue }
        $present = Test-PathEntry -Path $hint
        $mark = if ($present) { '[ok]  ' } else { '[warn]' }
        $color = if ($present) { 'Green' } else { 'Yellow' }
        Write-Host "  $mark $($row.Display): $hint" -ForegroundColor $color
    }

    $disabled = @(Get-DisabledManagerServers)
    if ($disabled.Count -gt 0) {
        Write-Host "`n[!] mcp-manager still has disabled entries: $($disabled -join ', ')" -ForegroundColor Yellow
        Write-Host "    The clients stage writes enabled=true; re-run it with -ForceClientConfig." -ForegroundColor Yellow
    }

    Write-Host "`nSummary:" -ForegroundColor Cyan
    foreach ($row in $results) {
        $mark = if ($row.Ok) { '[ok]  ' } else { '[fail]' }
        $color = if ($row.Ok) { 'Green' } else { 'Red' }
        Write-Host ("  {0} {1,-12} {2,4} tools  {3}" -f $mark, $row.Name, $row.Tools, $row.Stage) -ForegroundColor $color
    }

    $failed = @($results | Where-Object { -not $_.Ok })
    Write-Host ""
    if ($failed.Count -gt 0) {
        if ($WhatIf) {
            Write-Host "  $($failed.Count) server(s) did not answer the probe (ignored in -WhatIf)." -ForegroundColor Yellow
        }
        else {
            throw "$($failed.Count) MCP server(s) failed the protocol check: $((($failed | ForEach-Object { $_.Name }) -join ', '))"
        }
    }
    else {
        Write-Host "  All MCP servers answered and expose at least one tool." -ForegroundColor Green
    }
}
