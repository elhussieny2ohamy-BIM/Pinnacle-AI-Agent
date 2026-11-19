# PINNACLE MCP Servers - Installer

One EXE that installs all six MCP servers and configures the AI clients.

| Client | Config file |
|---|---|
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` |
| ChatGPT Desktop | `%APPDATA%\ChatGPT\config.json` (and legacy variants) |
| PINNACLE AI Agent (dsh) | `%USERPROFILE%\.dsh\@it-glen\dsh-mcp-manager\mcp.json` |
| OpenCode | `%USERPROFILE%\.config\opencode\opencode.json` (only when present) |

## What it does

The installer runs `setup.ps1` in two passes:

1. **Elevated** - installs Node.js, .NET Desktop Runtime 8 and `uv`.
2. **Original user** - resolves per-user paths and:
   - installs the six MCP servers,
   - copies host add-ins into the host load paths,
   - configures Claude, ChatGPT, PINNACLE and OpenCode,
   - runs a real JSON-RPC `initialize` + `tools/list` check.

All paths are per-user (`%LOCALAPPDATA%`, `%APPDATA%`, `~/.dsh`). No hard-coded
drive letters.

## Build

```powershell
cd installer
.\build-installer.ps1
```

- Finds `ISCC.exe` (Inno Setup 6) or installs it with winget.
- Output: `installer\output\Pinnacle-MCP-Setup-1.1.0.exe`

### Bundled files

- `setup.ps1` and `setup\*.ps1` (every stage).
- `release-assets\*.zip`, including `pinnacle-host-addins.zip` for offline
  host add-in installation.
- `pack-aec\` and the setup docs.

AutoCAD and Rhino are installed from PyPI through `uv tool install`, so they
need internet on first install. The other servers and all host add-ins are in
the bundled zips.

## Deploy

Publish the EXE to GitHub Releases and/or the internal share
(File Share / SCCM / Intune / GPO).

```text
Pinnacle-MCP-Setup-1.1.0.exe
Pinnacle-MCP-Setup-1.1.0.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

Reconfigure clients without reinstalling runtimes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\PINNACLE\MCP-Setup\setup.ps1" `
  -InstallDir "C:\Program Files\PINNACLE\MCP-Setup" `
  -SkipRuntimes -SkipServers -SkipPlugins -BundledAssetsDir "C:\Program Files\PINNACLE\MCP-Setup\release-assets"
```

## setup.ps1 options

| Option | Purpose |
|---|---|
| `-SkipRuntimes` | Do not install Node / .NET / uv |
| `-SkipServers` | Reuse installed servers |
| `-SkipPlugins` | Do not copy host add-ins |
| `-SkipClients` | Do not touch client configs |
| `-SkipVerify` | Skip the protocol smoke test |
| `-ForceClientConfig` | Rewrite existing MCP entries |
| `-BundledAssetsDir <dir>` | Use bundled server/add-in zips |
| `-AddinsDir <dir>` | Use a local add-in staging tree |
| `-LogPath <file>` | Write a transcript (silent install) |
| `-WhatIf` | Preview only |

## Safety

- Every client config is backed up as `<file>.bak_pinnacle_<timestamp>`.
- Merge is additive; unrelated settings are preserved.
- The MCP manager file is written with `enabled: true` for every installed
  server, which fixes the "Disabled - 0 tools" state.
- When `@pinnacle/mcp-hub` is installed, `cordis.patch.yml` is left to the hub;
  otherwise a clearly marked `mcp-manager` block is appended.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing added to Claude/ChatGPT | Check that the server launcher exists; read the stage output |
| `ISCC.exe not found` | Install Inno Setup 6 from <https://jrsoftware.org/isdl.php> |
| AutoCAD/Rhino install fails | `uv tool install` needs internet |
| PINNACLE still shows disabled | Re-run with `-ForceClientConfig` |
| SmartScreen warning | Sign the EXE with the company certificate |

Full log: `%TEMP%\pinnacle-mcp-setup.log`.
