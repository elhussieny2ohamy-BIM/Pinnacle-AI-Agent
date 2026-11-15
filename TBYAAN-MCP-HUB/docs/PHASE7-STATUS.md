# Phase 7 â€” Delivery Status

**Date:** 2026-11-10  **Verdict:** Phase 7 is complete. All six local setup handlers completed, final isolated-profile discovery passed, and the release was published to the internal share.

## Completed

- The AEC catalog, setup dispatcher, version records, and project documentation contain six modules: Revit, Navisworks, AutoCAD, Civil 3D, Rhino, and SketchUp.
- SketchUp setup staged the prebuilt server, Ruby bridge, and Extension Manager bundle under the user profile without requiring SketchUp Pro. No SketchUp host application is installed on this workstation; discovery correctly reports the server present and host absent.
- All six local setup handlers completed. Revit, Navisworks, AutoCAD, Civil 3D, and Rhino servers were installed or updated; SketchUp's server and bridge assets were staged.
- The Navisworks configurator now has the same major-version runtime roll-forward as its MCP server. The configurator and optional AI worker were rebuilt, and the server and bundle installers completed on the installed .NET 10 runtime. The setup handler checks for .NET 10 or later before making changes.
- Direct discovery found all six server commands. Revit, Navisworks, AutoCAD, Civil 3D, and Rhino report high confidence; SketchUp reports medium confidence because its host application is absent. Rhino does not require its host application to run its MCP server.
- `pack-aec/index.js` uses per-user install paths, detects SketchUp version folders dynamically, and accepts `PINNACLE_*` overrides.
- The retired module and its setup handler were removed from the AEC catalog, setup dispatcher, version records, and project documentation.
- `pnpm typecheck`, `scripts/verify.ps1`, and `scripts/package-release.ps1` passed. The final Hub and AEC tarballs, SHA-256 files, and `latest.json` are staged in `dist`.
- The isolated DSH profile was refreshed from the final tarballs. Its config dump contains the Hub row with the AEC pack, and direct discovery from the installed pack found all six server commands.
- The five release files were copied to `\\172.16.70.6\bim\PIN-SharedResources\06-EXE\PINNACLE-MCP-HUB\`. Both archive hashes and sidecar files were checked against `latest.json` at the share.

## Remaining

- No Phase 7 tasks remain. Later roadmap acceptance criteria are tracked separately in the plan.

## Acceptance note

The `/aec discover` chat entry could not run in the isolated profile because its `local-models` provider has no registered adapter (`NO_ADAPTER`). The final installed profile's config dump and direct discovery confirmed the package and module detection without that chat route.

## Runtime requirements

- Revit, Navisworks, and Civil 3D need source/build payloads under `-SourceRoot`; installers are not embedded in the tarballs.
- Navisworks setup requires .NET 10 or later. Its .NET 9-targeted configurator and MCP server roll forward to the installed major runtime.
- Civil 3D and SketchUp need Node.js at runtime. Set `PINNACLE_NODE_EXE` when `node` is not available on DSH's PATH.

