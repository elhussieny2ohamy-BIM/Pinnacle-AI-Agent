# Phase 0 â€” Audit Report

Scope: the five technical checks of Phase 0 in `PINNACLE_AEC_PLAN_v3.1.md` Â§14, executed on this machine (2026-11-09) before any production code exists. Everything below is either a verified runtime observation or a file/registry fact quoted with its source. Nothing in this report depends on assumptions from the plan.

| # | Check | Verdict |
| --- | --- | --- |
| 1 | Client build outside the monorepo | PASS â€” recipe proven, artifact contract matched |
| 2 | Runtime loading of a bundle and of a patch row by name | PASS â€” with three operational traps found |
| 3 | Backup capability per MCP server | PASS â€” two plan statements corrected |
| 4 | `ask` without an approval service | PASS â€” fails closed |
| 5 | Discovery sources per application on this machine | PASS â€” one stale path and one wrong marker found |

---

## 1. Client build outside the monorepo

**Verdict: PASS.** `@PINNACLE/mcp-hub` can build its browser half without importing any monorepo script.

### Contract that the artifact must satisfy

The harness loads a dynamic client bundle as a CommonJS factory registered by the bundle itself:

```
window.__ModuleLoader__.load({ id: '<package name>', factory: (require) => { â€¦ return module.exports } })
```

React and the other platform modules stay external and arrive through the injected `require`. The authoritative list is `PLATFORM_MODULES` in `deepseek-harness/packages/client/web/src/platform.ts`: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `zod`, `@tanstack/react-virtual`, `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-ui-dockkit`. `PRELOADED_CLIENT_EXTERNALS` is empty.

### Proven recipe

Working sandbox: `sandbox/client-build/` (kept as the reference until Phase 1 replaces it).

- `tsdown` v0.22.2, run from the harness `node_modules\.bin\tsdown.cmd`, cwd = the package directory.
- The config is a **plain exported object**, not `defineConfig(...)`: the standalone directory cannot resolve the `tsdown` package for a config-time import (`ERR_MODULE_NOT_FOUND` from `import { defineConfig } from 'tsdown'`).
- Externals use `deps.neverBundle`; the legacy `external` key still works but warns (`\`external\` is deprecated. Use \`deps.neverBundle\` instead`).
- Output wrappers: `banner` opens the loader call and the factory, `intro` declares `module`/`exports`, `footer` returns `module.exports` and closes the call. `format: ['cjs']`, `platform: 'browser'`, `target: 'es2022'`, `dts: false`.

Verified output (`sandbox/client-build/lib/client.js`, 0.51 kB):

```js
window.__ModuleLoader__.load({
  id: "@PINNACLE/probe-client",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    let react = require("react");
    â€¦
    return module.exports;
  }
});
```

`react` stayed external; no monorepo code inlined.

### Consequences for the package

1. The client build needs `react`/`react-dom` **types and values** only as build inputs; the emitted bundle carries none of them.
2. The build script must resolve `tsdown` by absolute path from the harness installation (or vendor it into the package's dev dependencies for the build machine). End users never build, so this affects only the release machine.
3. `dsh.client.platform` must be `web`, and the package must export `./client`, or the client scan rejects the package before the bundle is read.

---

## 2. Runtime loading by name

**Verdict: PASS**, with three operational traps that shape Phase 1.

### 2a. Bundle resolution is two-anchor, and a missing bundle is non-fatal

`app-boot/src/profile.ts` resolves a bundle name from the installation first, then from the profile directory:

```
dsh: cannot resolve profile bundle "<name>" from the dsh installation or <profile dir>;
run 'dsh plugin --profile <profile> install' if its dependency is not installed
```

A bundle that fails to resolve (or is unreadable, or incompatible) is not fatal: it is pushed into `skippedBundles` and printed once by `reportSkippedBundles`:

```
dsh: skipping profile bundle "@PINNACLE/not-installed-bundle": Error: dsh: cannot resolve â€¦
```

Observed live with `DSH_HOME=<temp>` and a probe profile declaring `@deepseek-ai/dsh-base` plus a nonexistent bundle: the warning was printed and the composed tree still contained every `dsh-base` row.

**Impact:** the hub's install can never â€œfail silently because a bundle was skippedâ€; but a partially installed hub will boot with the bundle missing. The hub must self-check that its own row is active and report it in `doctor`.

### 2b. A patch row whose package is missing fails per entry, not per boot

Observed stderr during a real boot of a profile containing

```yaml
- insert:
    - id: PINNACLE-missing-row
      name: '@PINNACLE/definitely-missing-plugin'
```

```
#include PINNACLE-missing-row (@PINNACLE/definitely-missing-plugin): failed to import:
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@PINNACLE/definitely-missing-plugin' imported from <profile>\
```

The web app still started and printed its URL; the entry was dropped from the tree. So: visible, attributed to the row id and package name, but **not** fatal.

### 2c. A correctly installed row loads and applies

Probe: a local package `probe-plugin` installed into a scratch profile with `pnpm install` (`link:./local/probe-plugin`) and referenced by one patch row. Boot result:

- the web app started (`dsh web: http://127.0.0.1:3080/â€¦`),
- the plugin's `apply` executed (marker file written),
- no error on stderr.

This is the exact mechanism the hub's single `cordis.patch.yml` row relies on. It works.

### 2d. Trap: a declared dependency that the package manager did not install stalls startup

With `"dependencies": { "probe-plugin": "1.0.0" }` pointing at a hand-placed `node_modules/probe-plugin` folder, boot produced **no output, no listening port, no `apply`** for at least 55 s (killed twice). Removing the hand-placed dependency restored a normal boot. The profile's package resolution expects packages installed through the package manager, not copied in.

**Impact:** the hub install path is the plugin manager / `pnpm`, never â€œunzip into `node_modules`â€. `doctor` must verify the installed layout by resolving through the same interception, not by `existsSync`.

### 2e. Trap: a UTF-8 BOM in the profile `package.json` aborts boot

Writing the profile manifest with PowerShell `Set-Content -Encoding UTF8` produced `EF BB BF` and boot failed at `readProfileManifest`:

```
SyntaxError: Unexpected token 'ï»¿', "ï»¿{ "n"... is not valid JSON
```

**Impact:** packaging for colleagues must emit BOM-free JSON, and `setup` should verify the manifest parses before installing.

### 2f. Trap: rows are inert when the owning plugin needs a service nothing provides

`plugin-manager` is `disabled: !!js "!ctx.get('profileContext')"` in `dsh-base`. Any hub feature that depends on `ctx.pluginManager` must degrade in profiles without `profileContext` (bare `cordis.yml` composition tests) instead of failing to load.

---

## 3. Backup capability per MCP server

**Verdict: PASS** â€” capability matrix established, and two plan statements corrected.

| Module | Save / snapshot surface | Can the hub take a snapshot through MCP? | Backup decision |
| --- | --- | --- | --- |
| Revit (`rvt-mcp`) | 268 tools; no project save. The only `SaveAs` is `revit_export_family_to_path` (exports a `.rfa`) | No | Hub file copy only when the `.rvt` is closed; otherwise `confirm` + warning |
| Navisworks (`NavisHelper.McpServer`) | read-only tool set | No | None; `backup.supported: false` |
| Rhino (`MCPRhinoServer`) | `rhino_save { path, version }` | Yes â€” writes a snapshot to a chosen path | Snapshot to `backups/<timestamp>.3dm`, path recorded in audit |
| AutoCAD (`MCPAutoCADServer`) | `drawing_save`, `drawing_save_as(path, fmt)`, `drawing_close(save)` | Technically yes, but `SaveAs` rebinds the live document (`com_backend.py`: â€œOur own SaveAs renamed the bound document: same document, same idâ€) | Do not save-as as a backup. Native `.bak` + `confirm` + audit; hub copy only when the file is closed |
| Civil 3D (`civil3d_drawing`) | `action: "save"`, `saveAs`, `overwrite` | Same rebinding hazard as AutoCAD | Same as AutoCAD |
| SketchUp | MCP v1.3.0 installed; no SketchUp Pro | Untestable | `.skb` only once Pro exists |

**Correction 1:** the earlier assumption â€œAutoCAD/Civil 3D have no save toolâ€ is wrong. Both expose save and save-as. The real constraint is that save-as retargets the open document, which makes it unusable as a silent backup step.

**Correction 2:** Revit's lack of a project save is confirmed (not just assumed): of 268 tools, none writes the project document.

`pack` must therefore declare `backup.supported` and `backup.tool` per server; the default stays `false` with an explicit warning, exactly as decided in Â§19.5.

---

## 4. `ask` without an approval service

**Verdict: PASS â€” fails closed.**

`packages/interaction/user-approval` defines the policy as `'ask' | 'never'` and resolves an unanswered request to `unavailable`, which the tool pipeline treats as denial. `tools/pre-execute` documents the same: â€œmissing approval support turns `ask` into denial.â€

**Impact:** `writeMode: confirm` is safe in headless or SDK profiles â€” the operation is refused, never silently allowed. `destructive` must request `ask` even under `writeMode: allow`, and that is also safe.

---

## 5. Discovery sources on this machine

**Verdict: PASS.** Per-module evidence, with the exact anchors the catalog must use.

| Module | Application evidence | MCP server evidence | Confidence |
| --- | --- | --- | --- |
| Revit | Uninstall keys `Autodesk Revit 2020 / 2022 / 2023 / 2025`; `C:\Program Files\Autodesk\Revit <ver>\Revit.exe`; add-in roots `C:\ProgramData\Autodesk\Revit\Addins\{2017â€¦2026}` and `%APPDATA%\Autodesk\Revit\Addins\{2020â€¦2027}`; process `Revit.exe` | `D:\OPENCODE\MCPs\rvt-mcp-master\build\client-setup\stage\server\rvt-mcp.exe`; add-in `%APPDATA%\Autodesk\Revit\Addins\2025\RvtMcp.R25.addin` (`ET-MCP`); plugin zips R22â€“R27 | high |
| Navisworks | `C:\Program Files\Autodesk\Navisworks Manage 2026` and `â€¦2023` (`Roamer.exe`); uninstall keys `Autodesk Navisworks Exporters 2023 / 2025`; `%APPDATA%\Autodesk\Navisworks 2023 / 2026` | `%LOCALAPPDATA%\Navisworks MCP\versions\2.30.0.0-8c568f84\NavisHelper.McpServer.exe` (sole version dir); installer selection lists Navisworks 2024â€“2027 | high |
| AutoCAD | Uninstall key `Autodesk AutoCAD 2026.1.2 Update`; **no** `C:\Program Files\Autodesk\AutoCAD 2026` â€” the only seat is `D:\Civil 3D\AutoCAD 2026\acad.exe` | `%APPDATA%\MCP AutoCAD\MCPAutoCADServer.exe --port 8080`, env `AUTOCAD_MCP_BACKEND=auto`, `ALLOWED_PATHS=<OneDrive Documents>` | high |
| Civil 3D | Uninstall key `Autodesk Civil 3D 2026 - English`; install root `D:\Civil 3D\AutoCAD 2026` | Not installed. Built artifacts exist: `D:\OPENCODE\MCPs\Civil3D-mcp-main\dist\MCPCivil3D-App.exe`, `MCPCivil3D_Setup.exe`; plugin source `Civil3D-MCP-Plugin` | app high / server â€œbuilt, not installedâ€ |
| Rhino | No `C:\Program Files\Rhino 7` or `Rhino 8`; `%APPDATA%\McNeel\Rhinoceros` exists (bridge leftovers) | `%APPDATA%\MCP Rhino\MCPRhinoServer.exe --transport stdio`, product 0.6.0, `bridgePort: 4242` | app none / server high |
| SketchUp | No `C:\Program Files\SketchUp*`; only `%APPDATA%\SketchUp\SketchUp 2022` preferences remain | `%LOCALAPPDATA%\Programs\SketchUp MCP` (node + `server/index.mjs` + `bridge/su_mcp.rb`) | server present; app absent |

### Corrections to the catalog

1. **Civil 3D markers:** `Aecc*` files do **not** exist in this install. Present: `C3D\` (directory), `AecBase.dbx`, `AecCore.crx`. `AcMapWorkspace` is absent. The AutoCAD/Civil 3D discriminator must be `C3D\` + `AecBase.dbx` + `AecCore.crx`, with `Aecc*` kept only as an optional hint.
2. **Navisworks stale path is real:** `%APPDATA%\..\opencode\opencode.json` contains `â€¦\Navisworks MCP\McpServer\NavisHelper.McpServer.exe`, which **does not exist**; the working path is under `versions\<ver>-<hash>\`. Resolution order `McpServer\` â†’ `versions\*` (highest) â†’ override is correct, and `doctor` must name the stale configured path.
3. **SketchUp server is installed but the host app is not.** Discovery should still find the server; the module can become available once SketchUp Pro is installed and the bridge is loaded.

---

## Decisions confirmed or changed by this audit

| Item | Outcome |
| --- | --- |
| Client build recipe | Keep `sandbox/client-build/tsdown.config.ts` as the base for the real build; drop the sandbox once the package builds |
| Bundle missing | Non-fatal skip; hub self-check + `doctor` entry required |
| Row missing | Per-entry `ERR_MODULE_NOT_FOUND`, visible on stderr; `doctor` must assert the row is live |
| Install path | Plugin manager / pnpm only; no hand-copied `node_modules` |
| Profile JSON | Must be BOM-free; `setup` verifies parseability |
| `pluginManager` dependency | Must tolerate absent `profileContext` |
| Backup | Revit/Navis: no MCP backup; Rhino: `rhino_save`; AutoCAD/Civil 3D: save-as is not a backup; SketchUp: `.skb` backup requires SketchUp Pro |
| Civil 3D markers | `C3D\` + `AecBase.dbx` + `AecCore.crx` |
| Navis discovery | `McpServer\` â†’ `versions\*` â†’ override; report stale paths |

## Phase 1 entry criteria

1. Package skeleton with `dsh.bundle.patch` + `dsh.client` and a `./client` export that builds with the recipe above.
2. `cordis.patch.yml` with exactly one hub row, naming the bundle's host entry.
3. Double-load protection proven before any tool registration.
4. `~/.dsh/profiles/PINNACLE-test` created from the `web` profile; every phase validated there and in `web`.
5. A `doctor` skeleton that already reports: bundle skipped, row not live, install layout unresolved, and stale discovery paths.

