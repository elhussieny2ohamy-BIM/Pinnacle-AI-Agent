/**
 * Process lookup for the app gate. The supervisor asks once per poll for every
 * process name declared by an enabled module; this adapter answers from one
 * system query instead of one query per application.
 *
 * Windows uses `tasklist`; other platforms fall back to `ps`. Both return raw
 * process names, and the supervisor normalizes `.exe` and directory prefixes.
 * @module @PINNACLE/mcp-hub/src/app-gate
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppGate } from './supervisor.ts'

/** Run one command and return its stdout. */
export type CommandRunner = (file: string, args: readonly string[]) => Promise<string>

/** Query budget; a hung process table must not stall the poll loop. */
const QUERY_TIMEOUT_MS = 5_000

/** Bound the captured table so a pathological process list cannot exhaust memory. */
const MAX_BUFFER_BYTES = 4 * 1024 * 1024

const execFileAsync = promisify(execFile)

/** Default runner: no shell, hidden window, bounded time and output. */
const defaultRunner: CommandRunner = async (file, args) => {
  const { stdout } = await execFileAsync(file, [...args], {
    timeout: QUERY_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER_BYTES,
    windowsHide: true,
  })
  return stdout
}

/** Strip a directory prefix and `.exe`, then lowercase. */
export function normalizeProcessName(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  return base.toLowerCase().replace(/\.exe$/, '')
}

/** Parse `tasklist /FO CSV /NH`; the first CSV field is the image name. */
function parseTasklist(stdout: string): string[] {
  const names: string[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]+)"/.exec(line)
    if (match !== null) names.push(match[1]!)
  }
  return names
}

/** Parse `ps -eo comm=`; each line is a command name. */
function parsePs(stdout: string): string[] {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0)
}

/**
 * Build the platform process gate.
 * @param run - command runner, injectable for tests.
 * @param platform - target platform; defaults to the running one.
 * @returns a gate answering one batched query per call.
 */
export function createSystemAppGate(run: CommandRunner = defaultRunner, platform: string = process.platform): AppGate {
  const read = async (): Promise<string[]> => {
    if (platform === 'win32') return parseTasklist(await run('tasklist.exe', ['/FO', 'CSV', '/NH']))
    return parsePs(await run('ps', ['-eo', 'comm=']))
  }
  return {
    async running(names) {
      const requested = new Set(names.map(normalizeProcessName))
      const present = new Set<string>()
      for (const name of await read()) {
        const normalized = normalizeProcessName(name)
        if (requested.has(normalized)) present.add(normalized)
      }
      return present
    },
  }
}

