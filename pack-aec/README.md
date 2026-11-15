# @pinnacle/pack-aec

AEC module catalog for the PINNACLE MCP Hub. The pack declares Revit, Navisworks, AutoCAD, Civil 3D, Rhino, and SketchUp. It contains no installers and does not modify upstream server projects.

## Install

Install `pack-aec-<version>.tgz` into the same DSH profile as `mcp-hub-<version>.tgz`, then configure the hub row with:

```yaml
packs: ['@pinnacle/pack-aec']
```

The Hub package includes PowerShell setup handlers for supported servers. Run them from an extracted Hub tarball or source checkout with `scripts/setup.ps1 -Server <id>`. See the Hub `README.md` for per-server prerequisites and side effects.

## Portable paths

The pack uses standard per-user server paths and Autodesk install roots. Override machine-specific locations with environment variables when a server is installed elsewhere:

- `PINNACLE_REVIT_EXE`, `PINNACLE_RVT_MCP_EXE`
- `PINNACLE_NAVIS_MCP_EXE`
- `PINNACLE_UV_BIN`, `PINNACLE_AUTOCAD_EXE`, `PINNACLE_AUTOCAD_MCP_EXE`
- `PINNACLE_CIVIL3D_ROOT`, `PINNACLE_CIVIL3D_SERVER_JS`, `PINNACLE_NODE_EXE`
- `PINNACLE_RHINO_MCP_EXE`
- `PINNACLE_SKETCHUP_ROOT`, `PINNACLE_SKETCHUP_SERVER_JS`, `PINNACLE_NODE_EXE`

SketchUp setup installs its prebuilt MCP server and stages the Ruby bridge plus `su_mcp.rbz` without requiring SketchUp Pro. When a SketchUp installation is detected, setup also copies the bridge into its Plugins folder. Set `PINNACLE_NODE_EXE` if the Node.js command is not available on the host PATH.
