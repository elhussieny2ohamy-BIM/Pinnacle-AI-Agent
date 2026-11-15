# Phase 3 â€” Packs and Discovery Status

**Date:** 2026-11-09  **Verdict:** PASS â€” live in `pinnacle-test`.

## Scope
Implemented `pack-aec` (6 AEC modules), `src/discovery.ts`, `src/doctor.ts`, and wired `doctor()` into the `pinnacleHub` service. Discovery is read-only and never registers a server; the supervisor owns registration.

## What was implemented

**`@pinnacle/pack-aec`** (`D:\OPENCODE\MCPs\pack-aec\`) â€” pack manifest with 6 modules:
| id | title | requiresApp | backup | server | notes |
|---|---|---|---|---|---|
| rvt | Revit | yes | no | stdio rvt-mcp.exe | Revit 2020â€“2025 install markers |
| navis | Navisworks | yes | no | stdio NavisHelper.McpServer.exe | `McpServer\` first, then `versions\*` glob (highest version) |
| autocad | AutoCAD | yes | no | stdio MCPAutoCADServer.exe --port 8080 | `D:\Civil 3D\AutoCAD 2026\acad.exe` |
| civil3d | Civil 3D | yes | no | stdio MCPCivil3D-App.exe | Markers `C3D\` + `AecBase.dbx` + `AecCore.crx` |
| rhino | Rhino | no | yes (`rhino_save`) | stdio MCPRhinoServer.exe | Standalone mode works without Rhino 8 |
| sketchup | SketchUp | yes | no | stdio `node server/index.mjs` | Server and bridge can be installed without SketchUp Pro |

Modules without a `server` entry are metadata-only: discovery/doctor report on them, but the supervisor never registers them.

**`src/discovery.ts`** â€” `discoverModules(modules, appGate?)`:
- Read-only: never registers with `mcp-manager`.
- Resolves server commands from `discovery.serverPaths`; plain paths and single-`*` globs (e.g. `versions\*\NavisHelper.McpServer.exe`, highest directory name wins).
- Checks host-app install markers from `discovery.appPaths` and running processes via the app gate.
- Confidence: `high` (server + app, or standalone + server), `medium` (one of the two), `low` (neither), `none` (unsupported).
- Evidence strings per result.

**`src/doctor.ts`** â€” `generateDoctor(...)`:
- Combines discovery + supervision state into per-module `DoctorModule` (confidence, state, command, appInstalled/Running, issues).
- Environment-wide checks: approval service, port conflicts (Civil3D :8080, SketchUp :9876), caller-supplied issues.
- Returns `DoctorReport`.

**`src/index.ts`** â€” `pinnacleHub.doctor()` added to `HubService`; runs discovery through the supervisor's app gate and returns the doctor report.

**Types** â€” `PackModule.discovery` hints, `DiscoverableModule`, `DiscoveryResult`, `DiscoveryConfidence`, `DoctorModule`, `DoctorReport` added to `types.ts`; registry validates `discovery`.

## Tests
`tests/discovery.test.ts` (8), `tests/doctor.test.ts` (5), plus existing 25 = **38 total**, all pass via `node --test`; `pnpm typecheck` clean; `pnpm build` emits `lib/index.js` + `lib/client.js`.

## Live proof (`pinnacle-test`, no restart)

pack-aec linked into the profile (`@pinnacle/pack-aec` â†’ `D:\OPENCODE\MCPs\pack-aec`) and into the hub's `node_modules\@pinnacle\pack-aec` (so `import()` resolves). The observer (`pinnacle-hub-observer`) writes transitions + the `doctor()` report to JSONL.

Boot evidence (`C:\Users\elhussieny.mohamed\AppData\Local\Temp\opencode\phase3-proof.jsonl`):

| module | confidence | state | command resolved |
|---|---|---|---|
| rvt | high | app_not_running | rvt-mcp.exe |
| navis | high | app_not_running | NavisHelper.McpServer.exe |
| autocad | high | app_not_running | MCPAutoCADServer.exe |
| civil3d | high | app_not_running | MCPCivil3D-App.exe |
| rhino | high | starting (reconnecting, stub server) | MCPRhinoServer.exe |
| sketchup | medium | disabled (host app absent) | `server/index.mjs` |

**5/6 high confidence** â€” meets Phase 3 acceptance (â‰¥5 high, rest with clear reason). SketchUp is medium because its server is present while SketchUp Pro is absent.

The doctor report also correctly reports `approvalService: false` and the environment issue "No approval service present; write confirm/ask is refused."

Rhino's MCP server is a local stub that keeps reconnecting with backoff; the hub handles it gracefully (no crash, no orphaned children).

## Artifacts
- Staging tarball: `dist\pinnacle-mcp-hub-0.1.0.tgz` (rebuilt with discovery/doctor).
- Pack-aec: `D:\OPENCODE\MCPs\pack-aec\` (separate package, separate tarball at distribution time per Â§19.6).
- Test-only observer lives under `test-support/` (not in `package.json` `files`, not shipped).

## Deviations from plan
- None material. Discovery confidence model (`high`/`medium`/`low`/`none`) operationalizes the plan's `high | medium | low | none`.

## Next
Proceed to Phase 4 (commands: `/aec`, `/aec discover`, `/aec enable\|disable`, `/aec probe`, `/aec doctor`, `/aec profile`, `/aec audit`, plus the `aec_control` model-facing tool).

