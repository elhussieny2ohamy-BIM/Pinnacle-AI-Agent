# @PINNACLE/mcp-hub

Generic MCP hub for DeepSeek Harness, plus the AEC pack that connects the Autodesk, Rhino, and SketchUp MCP servers this team runs.

One `cordis.patch.yml` row activates the hub. It adds a discovery and supervision layer over `ctx.mcpManager`, applies a write policy before any tool call, records an audit trail, and exposes exactly one model-facing tool (`aec_control`). Everything else is a human surface: the hub page and the `/aec` command.

## Install

For Windows DSH Desktop, use the installer script. Open DeepSeek Harness once to initialize its Desktop profile, then fully quit it. Preview the operation, then run it without `-WhatIf` to install both packages:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-hub.ps1 -WhatIf
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-hub.ps1
```

The staged release folder also contains `install-hub.ps1`, so a colleague can run it from the shared release folder. The script verifies both SHA-256 hashes from `latest.json`, then uses the DSH Desktop bundled `dsh` command and package manager to install into the `desktop` profile. It does not require separate Node.js or pnpm installs. DSH checks the Hub's `engines.dsh` range during installation. Verified tarballs are retained under `$DSH_HOME/installers/PINNACLE-mcp-hub/<version>` for future reinstalls. Restart the selected DSH profile after installation. For a non-Desktop profile, pass `-Profile <name>`; pass `-ReleaseDirectory <path>` to use a local release folder, or `-DshCommand <path>` if DSH Desktop is installed in a nonstandard location.

From the staged release folder, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-hub.ps1 -WhatIf
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-hub.ps1
```

The DSH UI remains available as an alternative: install both release tarballs into the same profile from **Plugins â†’ Install from file**:

- `mcp-hub-<version>.tgz`
- `pack-aec-<version>.tgz`

`latest.json` lists the Hub SHA-256, minimum DSH version, matching pack filename, and pack SHA-256. The installer script checks both hashes before passing the archives to DSH; for UI installation, compare both archives to those values first.

For development, link the checkout instead:

```json
{ "dependencies": { "@PINNACLE/mcp-hub": "link:D:/OPENCODE/MCPs/PINNACLE-MCP-HUB" } }
```

The package declares `dsh.bundle.patch`, so selecting it as a bundle inserts the Hub and its client contribution automatically. To override its defaults in a profile's own `cordis.patch.yml`, patch the inserted row:

```yaml
- id: PINNACLE-mcp-hub
  config:
    packs: ['@PINNACLE/pack-aec']
    discovery: { applyMode: confirm }
    defaults: { profile: coordination, writeMode: deny, maxVisibleTools: 120 }
```

## Behavior at load

- **One row only.** A second activation in the same process is refused with a message naming both rows; two hubs would race the same servers, policy state, and audit files.
- **Configuration is validated, not coerced.** A malformed row fails with the exact field path (`config.defaults.writeMode must be one of deny | confirm | allow`).
- **Packs are validated before use.** A pack that cannot be imported fails with its package name and the install command; a pack with a duplicate module id or tool prefix is rejected.
- **A skipped bundle is not fatal.** The harness reports it on stderr and boots without it, so the hub page and `doctor` own the â€œis the hub actually active?â€ question.

## Layout

```
src/index.ts       host entry: config, pack registry, PINNACLEHub service, double-load guard
src/config.ts      row validation with field-named failures
src/registry.ts    pack resolution and manifest validation
src/types.ts       shared types (no runtime code)
src/remote.ts      Host Remote methods, routed through the hub control policy
src/client/        Modules and Doctor screens, Remote contribution, EN/AR locale
cordis.patch.yml   the single bundle patch row
scripts/           server setup handlers, Hub installer, and release tooling
servers.lock       advisory versions from local metadata/audit
INTEGRATION.md     DSH integration contract map
AGENTS.md          maintenance rules and project map
UPGRADE_PROMPT.md  prompt for checking compatibility after a DSH update
tests/             unit tests for config and registry
docs/              audit and build notes
```

## Server setup

Setup handlers run the relevant server installer automatically when invoked. They act in the current user scope where upstream supports it and avoid adding entries to unrelated MCP client configuration. Extract the Hub tarball, open the extracted `package` folder in PowerShell, and run:

```powershell
pwsh -NoProfile -File .\scripts\setup.ps1 -Server rhino
pwsh -NoProfile -File .\scripts\setup.ps1 -Server autocad -WhatIf
```

For Revit, Navisworks, SketchUp, and Civil 3D, pass `-SourceRoot` pointing at the folder containing the matching server source/build folders, or set `PINNACLE_AEC_SOURCE_ROOT`. Rhino and AutoCAD setup uses Astral `uv` to install the pinned Python packages. Civil 3D and SketchUp require Node.js at runtime; set `PINNACLE_NODE_EXE` if `node` is not on PATH. SketchUp setup stages its prebuilt server, Ruby bridge, and Extension Manager bundle even when SketchUp Pro is absent, and installs the bridge into detected SketchUp versions when present. `servers.lock` records observed/source versions and does not block a different installed version.

`scripts/verify.ps1` checks package metadata, integration files, all six handlers, and the advisory version records. From the source checkout, it also checks the sibling `pack-aec` source for developer-machine paths and removed-module references. A clean-machine install acceptance still requires a separate DSH profile with both tarballs installed.

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

`pnpm build` emits two artifacts: `lib/index.js` (ESM host plugin) and `lib/client.js` (the CJS factory artifact the browser module loader expects). The Host keeps `@deepseek-ai/dsh-typert-protocol` external as a peer dependency so it uses the harness's Typert and Cordis runtime; packs stay external.

## Status

Phases 0â€“8 are implemented. Phase 9 local acceptance passed on DSH `0.2.2-alpha.3`, with a colleague-device install still pending. The upstream DSH `0.2.2-rc.1` update removed the manager API this Hub relies on; the staged release excludes that incompatible version through `engines.dsh`. See `docs/PHASE8-STATUS.md` and `docs/PHASE9-STATUS.md`.

