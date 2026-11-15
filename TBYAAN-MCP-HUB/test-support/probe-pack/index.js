/**
 * Test-only pack for the Phase 2 live proof.
 *
 * Modules:
 *  - `rvt` / `navis`: gated on host processes that are closed on this machine
 *    during the proof, so they settle at `app_not_running`.
 *  - `echo`: a stdio MCP server (a tiny in-process server shipped here) with no
 *    app gate, so it reaches `connected`, then can be disabled/disposed without
 *    restarting dsh. It also declares `echo_save` as its snapshot tool so the
 *    Phase 5 backup proof has a real MCP round trip.
 *
 * This pack is NOT part of the shipping tarball: it lives under test-support
 * and is wired into the test profiles only.
 * @module PINNACLE-probe-pack
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const __dirname = join(fileURLToPath(import.meta.url), '..')

const echoServer = join(__dirname, 'echo-server.js')

export const pack = {
  name: 'PINNACLE-probe-pack',
  version: '0.1.0',
  modules: [
    {
      id: 'rvt',
      title: 'Revit',
      toolPrefix: 'rvt',
      requiresApp: true,
      app: { processNames: ['revit.exe'] },
      backup: { supported: false },
      server: { transport: 'stdio', command: 'revit.exe', args: [] },
    },
    {
      id: 'navis',
      title: 'Navisworks',
      toolPrefix: 'navis',
      requiresApp: true,
      app: { processNames: ['Roamer.exe'] },
      backup: { supported: false },
      server: { transport: 'stdio', command: 'Roamer.exe', args: [] },
    },
    {
      id: 'echo',
      title: 'Echo (stdio test server)',
      toolPrefix: 'echo',
      requiresApp: false,
      app: { processNames: [] },
      backup: { supported: true, tool: 'echo_save', pathArg: 'path', docPathTool: 'echo_doc_info' },
      writes: ['echo_write'],
      reads: ['echo_read', 'echo_echo', 'echo_doc_info'],
      server: { transport: 'stdio', command: 'node', args: [echoServer] },
    },
  ],
}

