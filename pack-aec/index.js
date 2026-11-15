/**
 * @tbyaan/pack-aec — portable declarations for the team's AEC MCP servers.
 *
 * Every machine-specific path may be overridden with a TBYAAN_* environment
 * variable. Defaults use per-user install locations and standard Autodesk
 * roots; no source checkout or drive letter is embedded in the package.
 * @module @tbyaan/pack-aec
 */

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const env = process.env
const APPDATA = env.APPDATA || ''
const LOCALAPPDATA = env.LOCALAPPDATA || ''
const PROGRAMFILES = env.ProgramW6432 || env.PROGRAMFILES || 'C:\\Program Files'
const USERPROFILE = env.USERPROFILE || ''

function override(name, fallback) {
  const value = env[name]?.trim()
  return value ? value : fallback
}

const UV_BIN = override('TBYAAN_UV_BIN', env.UV_TOOL_BIN_DIR || join(USERPROFILE, '.local', 'bin'))

function firstExisting(paths, fallback) {
  return paths.find(path => path && existsSync(path)) || fallback
}

/** Return the highest versioned executable under an installer's version root. */
function newestVersionedExecutable(roots, executable) {
  for (const root of roots) {
    try {
      const versions = readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }))
      for (const version of versions) {
        const candidate = join(root, version, executable)
        if (existsSync(candidate)) return candidate
      }
    } catch {
      // A missing installation root is a normal discovery miss.
    }
  }
  return null
}

const revitExe = override('TBYAAN_REVIT_EXE', join(PROGRAMFILES, 'Autodesk', 'Revit 2025', 'Revit.exe'))
const rvtMcpServer = override(
  'TBYAAN_RVT_MCP_EXE',
  join(LOCALAPPDATA, 'Bimwright', 'rvt-mcp', 'server', 'current', 'rvt-mcp.exe'),
)

const navisVersionRoots = [
  join(LOCALAPPDATA, 'NavisHelper', 'versions'),
  join(LOCALAPPDATA, 'Navisworks MCP', 'versions'),
]
const navisMcpServer = override(
  'TBYAAN_NAVIS_MCP_EXE',
  firstExisting([
    join(LOCALAPPDATA, 'NavisHelper', 'McpServer', 'NavisHelper.McpServer.exe'),
    join(LOCALAPPDATA, 'Navisworks MCP', 'McpServer', 'NavisHelper.McpServer.exe'),
    newestVersionedExecutable(navisVersionRoots, 'NavisHelper.McpServer.exe'),
  ], join(LOCALAPPDATA, 'NavisHelper', 'McpServer', 'NavisHelper.McpServer.exe')),
)
const navisAppPaths = ['2024', '2025', '2026', '2027'].flatMap(year => [
  join(PROGRAMFILES, 'Autodesk', `Navisworks Manage ${year}`, 'Roamer.exe'),
  join(PROGRAMFILES, 'Autodesk', `Navisworks Simulate ${year}`, 'Roamer.exe'),
])

const autocadMcpServer = override(
  'TBYAAN_AUTOCAD_MCP_EXE',
  firstExisting([
    join(UV_BIN, 'autocad-mcp.exe'),
    join(APPDATA, 'MCP AutoCAD', 'MCPAutoCADServer.exe'),
  ], join(UV_BIN, 'autocad-mcp.exe')),
)
const autocadExe = override(
  'TBYAAN_AUTOCAD_EXE',
  join(PROGRAMFILES, 'Autodesk', 'AutoCAD 2026', 'acad.exe'),
)
const civil3dRoot = override(
  'TBYAAN_CIVIL3D_ROOT',
  join(PROGRAMFILES, 'Autodesk', 'AutoCAD 2026'),
)
const civil3dServerPath = override(
  'TBYAAN_CIVIL3D_SERVER_JS',
  join(APPDATA, 'MCP Civil 3D', 'index.js'),
)

const rhinoMcpServer = override(
  'TBYAAN_RHINO_MCP_EXE',
  firstExisting([
    join(UV_BIN, 'rhino-mcp.exe'),
    join(APPDATA, 'MCP Rhino', 'MCPRhinoServer.exe'),
  ], join(UV_BIN, 'rhino-mcp.exe')),
)
const rhinoAppPaths = ['7', '8'].map(version =>
  join(PROGRAMFILES, 'McNeel', 'Rhinoceros', version, 'System', 'Rhino.exe'))

const sketchupServerPath = override(
  'TBYAAN_SKETCHUP_SERVER_JS',
  join(LOCALAPPDATA, 'Programs', 'SketchUp MCP', 'server', 'index.mjs'),
)
const sketchupNode = override('TBYAAN_NODE_EXE', 'node')
const sketchupRoot = override('TBYAAN_SKETCHUP_ROOT', join(PROGRAMFILES, 'SketchUp'))
const sketchupAppPaths = (() => {
  try {
    return readdirSync(sketchupRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && /^SketchUp \d{4}$/.test(entry.name))
      .map(entry => join(sketchupRoot, entry.name, 'SketchUp.exe'))
  } catch {
    return []
  }
})()

export const pack = {
  name: '@tbyaan/pack-aec',
  version: '0.1.3',
  modules: [
    {
      id: 'rvt',
      title: 'Revit',
      toolPrefix: 'rvt',
      requiresApp: true,
      backup: { supported: false },
      server: {
        transport: 'stdio',
        command: rvtMcpServer,
        args: [],
        env: {},
        startupTimeoutMs: 60_000,
      },
      app: { processNames: ['Revit.exe'] },
      discovery: {
        serverPaths: [rvtMcpServer],
        appPaths: ['2020', '2022', '2023', '2024', '2025', '2026', '2027']
          .map(year => join(PROGRAMFILES, 'Autodesk', `Revit ${year}`, 'Revit.exe')),
      },
    },
    {
      id: 'navis',
      title: 'Navisworks',
      toolPrefix: 'navis',
      requiresApp: true,
      backup: { supported: false },
      server: {
        transport: 'stdio',
        command: navisMcpServer,
        args: [],
        env: {},
        startupTimeoutMs: 60_000,
      },
      app: { processNames: ['Roamer.exe'] },
      discovery: {
        serverPaths: [
          join(LOCALAPPDATA, 'NavisHelper', 'McpServer', 'NavisHelper.McpServer.exe'),
          join(LOCALAPPDATA, 'Navisworks MCP', 'McpServer', 'NavisHelper.McpServer.exe'),
          join(LOCALAPPDATA, 'NavisHelper', 'versions', '*', 'NavisHelper.McpServer.exe'),
          join(LOCALAPPDATA, 'Navisworks MCP', 'versions', '*', 'NavisHelper.McpServer.exe'),
          ...(env.TBYAAN_NAVIS_MCP_EXE ? [env.TBYAAN_NAVIS_MCP_EXE] : []),
        ],
        appPaths: navisAppPaths,
      },
    },
    {
      id: 'autocad',
      title: 'AutoCAD',
      toolPrefix: 'acad',
      requiresApp: true,
      backup: { supported: false },
      server: {
        transport: 'stdio',
        command: autocadMcpServer,
        args: ['--port', '8080'],
        env: {
          AUTOCAD_MCP_BACKEND: 'auto',
          ALLOWED_PATHS: join(USERPROFILE, 'Documents'),
        },
        cwd: USERPROFILE,
        startupTimeoutMs: 60_000,
      },
      app: { processNames: ['acad.exe'] },
      discovery: {
        serverPaths: [autocadMcpServer],
        appPaths: [autocadExe],
      },
    },
    {
      id: 'civil3d',
      title: 'Civil 3D',
      toolPrefix: 'c3d',
      requiresApp: true,
      backup: { supported: false },
      server: {
        transport: 'stdio',
        command: override('TBYAAN_NODE_EXE', 'node'),
        args: [civil3dServerPath, '--stdio'],
        env: {},
        cwd: join(APPDATA, 'MCP Civil 3D'),
        startupTimeoutMs: 60_000,
      },
      app: { processNames: ['acad.exe'] },
      discovery: {
        serverPaths: [civil3dServerPath],
        appPaths: [
          join(civil3dRoot, 'C3D'),
          join(civil3dRoot, 'AecBase.dbx'),
          join(civil3dRoot, 'AecCore.crx'),
        ],
      },
    },
    {
      id: 'rhino',
      title: 'Rhino',
      toolPrefix: 'rhino',
      requiresApp: false,
      backup: { supported: true, tool: 'rhino_save' },
      server: {
        transport: 'stdio',
        command: rhinoMcpServer,
        args: ['--transport', 'stdio'],
        env: {},
        startupTimeoutMs: 30_000,
      },
      app: { processNames: ['Rhino.exe'] },
      discovery: {
        serverPaths: [rhinoMcpServer],
        appPaths: rhinoAppPaths,
      },
    },
    {
      id: 'sketchup',
      title: 'SketchUp',
      toolPrefix: 'skp',
      requiresApp: true,
      backup: { supported: false },
      server: {
        transport: 'stdio',
        command: sketchupNode,
        args: [sketchupServerPath],
        env: {
          SKETCHUP_MCP_PORT: '9876',
          SKETCHUP_MCP_TIMEOUT: '120',
        },
        startupTimeoutMs: 30_000,
      },
      app: { processNames: ['SketchUp.exe'] },
      discovery: {
        serverPaths: [sketchupServerPath],
        appPaths: sketchupAppPaths,
      },
    },
  ],
}
