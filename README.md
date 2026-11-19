# PINNACLE AI Agent - AEC MCP Bundle

One setup pipeline for six CAD/BIM MCP servers plus the PINNACLE MCP Hub and the
AEC pack. Supported hosts:

| Host | MCP server | Tools | Host add-in |
|---|---|---:|---|
| Revit 2022-2027 | `rvt-mcp` | 237 | `RvtMcp.Rxx.addin` + `RvtMcp\` payload |
| Navisworks 2024-2027 | `navis-mcp` | 128 | `NavisHelper.bundle` |
| AutoCAD 2021-2027 | `autocad-mcp` | 6 meta-tools | `MCPAutoCAD.bundle` (optional) |
| Civil 3D 2023-2027 | `civil3d-mcp` | 34 | `MCPCivil3D.bundle` (see gaps) |
| Rhino 7/8 | `rhino-mcp` | 246 | `rhino-mcp.rhp` |
| SketchUp 2021-2026 | `sketchup-mcp` | 29 | `su_mcp-1.3.0.rbz` extension |

The AutoCAD server intentionally exposes six gateway tools
(`search_tools`, `describe_tool`, `call_tool`, `cad_batch`, `drawing_info`,
`entity_list`). The real command set is discoverable through that facade.

---

## Quick start

### Option A - installer (recommended for non-developers)

1. Download `Pinnacle-MCP-Setup-1.0.0.exe` from the latest GitHub release.
2. Run it. It installs Node.js, .NET Desktop Runtime and `uv` in an elevated
   pass, then installs the servers, host add-ins and client configs per user.
3. Start the CAD/BIM application you want to use. The MCP server is reachable
   only after its host application is running with the add-in loaded.

### Option B - clone and run the PowerShell pipeline

```powershell
git clone -b my-custom-features https://github.com/elhussieny2ohamy-BIM/Pinnacle-AI-Agent.git
cd Pinnacle-AI-Agent
powershell -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1
```

Preview first:

```powershell
.\setup.ps1 -WhatIf
```

Useful switches:

| Switch | Meaning |
|---|---|
| `-SkipRuntimes` | Do not install Node.js / .NET / `uv` |
| `-SkipServers` | Reuse servers already installed |
| `-SkipPlugins` | Do not copy host add-ins |
| `-SkipClients` | Do not touch Claude / ChatGPT / PINNACLE / OpenCode configs |
| `-SkipVerify` | Skip the protocol smoke test |
| `-ForceClientConfig` | Rewrite existing client entries instead of preserving them |
| `-BundledAssetsDir <path>` | Use offline `release-assets` (installer mode) |
| `-AddinsDir <path>` | Use a local add-in staging tree |

The pipeline never needs an interactive prompt. Every config file is backed up
as `<file>.bak_pinnacle_<timestamp>` before it is changed.

---

## Why servers show "Disabled - 0 tools"

The PINNACLE UI reads `%USERPROFILE%\.dsh\@it-glen\dsh-mcp-manager\mcp.json`.
When an entry contains `"enabled": false`, the UI shows it as disabled and
exposes zero tools even though the server is installed correctly.

`setup/clients.ps1` now writes that file directly and sets `enabled: true` for
every server whose launcher exists. It also merges the same servers into:

- Claude Desktop: `%APPDATA%\Claude\claude_desktop_config.json`
- ChatGPT Desktop: `%APPDATA%\ChatGPT\config.json`
- OpenCode: `%USERPROFILE%\.config\opencode\opencode.json`
- PINNACLE fallback: `cordis.patch.yml` (only when the hub is not installed)

If a server is still disabled after setup, re-run:

```powershell
.\setup.ps1 -SkipRuntimes -SkipServers -SkipPlugins -ForceClientConfig
```

---

## Verification

`setup/verify.ps1` performs a real MCP handshake for every server:
`initialize` followed by `tools/list`. A pass means the process starts, speaks
JSON-RPC and exposes at least one tool. Current expected counts:

```text
revit-mcp     237 tools
navis-mcp     128 tools
civil3d-mcp    34 tools
sketchup-mcp   29 tools
autocad-mcp     6 tools
rhino-mcp     246 tools
```

Run it alone:

```powershell
.\setup.ps1 -SkipRuntimes -SkipServers -SkipPlugins -SkipClients
```

---

## Host add-ins

The setup copies host add-ins to the locations the applications actually load:

| Host | Install target |
|---|---|
| Revit | `%APPDATA%\Autodesk\Revit\Addins\<year>\` |
| Navisworks | `%APPDATA%\Autodesk\ApplicationPlugins\NavisHelper.bundle\` |
| Civil 3D | `%APPDATA%\Autodesk\ApplicationPlugins\MCPCivil3D.bundle\` |
| AutoCAD | `%APPDATA%\Autodesk\ApplicationPlugins\MCPAutoCAD.bundle\` |
| Rhino | `%APPDATA%\McNeel\Rhinoceros\<version>\Plug-ins\rhino-mcp\` |
| SketchUp | `%APPDATA%\SketchUp\SketchUp <year>\SketchUp\Plugins\` (`.rbz` extracted) |

Build or refresh the release payload:

```powershell
.\setup\package-addins.ps1
# -> release-assets/pinnacle-host-addins.zip
```

The setup downloads `pinnacle-host-addins.zip` from the release when no local
`release-assets\addins` tree is present.

---

## Repository layout

```text
setup.ps1                 dispatcher (runtime -> servers -> plugins -> clients -> verify)
setup/runtime.ps1         Node.js, .NET Desktop Runtime 8, uv
setup/servers.ps1         release downloads + uv tool installs
setup/plugins.ps1         host add-in installation
setup/clients.ps1         Claude / ChatGPT / PINNACLE / OpenCode configuration
setup/verify.ps1          JSON-RPC protocol verification
setup/package-addins.ps1  builds release-assets/pinnacle-host-addins.zip
setup/package-servers.ps1 builds server zips for a release
installer/                Inno Setup source and build script
PINNACLE-MCP-HUB/         hub package (Modules + Doctor UI)
pack-aec/                 AEC server catalog
```

Heavy third-party source trees and all build artifacts are ignored by Git:
`release-assets/`, `installer/output/`, `*/node_modules/`, `*/bin/`, `*/obj/`,
upstream server checkouts and `.env*` files.

---

## Release assets

| Asset | Produced by |
|---|---|
| `rvt-mcp-server.zip` | `setup/package-servers.ps1` |
| `NavisHelper.McpServer.zip` | `setup/package-servers.ps1` |
| `civil3d-mcp.zip` | `setup/package-servers.ps1` |
| `sketchup-mcp-server.zip` | `setup/package-servers.ps1` |
| `pinnacle-host-addins.zip` | `setup/package-addins.ps1` |
| `mcp-hub-<version>.tgz` | `PINNACLE-MCP-HUB/scripts/package-release.ps1` |
| `pack-aec-<version>.tgz` | `PINNACLE-MCP-HUB/scripts/package-release.ps1` |
| `latest.json` | `PINNACLE-MCP-HUB/scripts/package-release.ps1` |
| `Pinnacle-MCP-Setup-<version>.exe` | `installer/build-installer.ps1` |

AutoCAD and Rhino are installed from PyPI with `uv`; they have no server zip.

---

## Known gaps

- **Civil 3D host plugin binary**: `Civil3D-MCP-Plugin` needs licensed Civil 3D
  managed references to build. The node server and 34 tools work without it,
  but Civil 3D entities require `Civil3DMcpPlugin.dll` under
  `MCPCivil3D.bundle\Contents\<year>\`. Build it on a Civil 3D workstation and
  add it to `pinnacle-host-addins.zip`.
- **Navisworks bundle**: ships from `NavisWorksMaster-main\NavisHelper.bundle`.
- **Rhino 7**: the plugin is built for Rhino 8. Rhino 7 users should install
  from the upstream release or rebuild the `.rhp`.
- **Hub typecheck**: `pnpm typecheck` needs the DSH host packages; `pnpm build`
  and `package-release.ps1` work without them.

---

## License

MIT. See [LICENSE](LICENSE).
