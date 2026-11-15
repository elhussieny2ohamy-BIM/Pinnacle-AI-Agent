#!/usr/bin/env node
/**
 * Minimal stdio MCP server for the hub live proofs.
 *
 * Implements just enough of the MCP stdio protocol for the SDK client
 * (@modelcontextprotocol/client) to complete initialize + tools/list, and the
 * tool calls the Phase 5 backup proof needs:
 *  - `echo_read`   — read-only tool, must not trigger a snapshot
 *  - `echo_write`  — write tool, must snapshot first
 *  - `echo_save`   — declared backup tool, writes to the requested path
 *  - `echo_doc_info` — reports the current document path
 *
 * Reads JSON-RPC requests and notifications from stdin, writes responses to
 * stdout. Exits on EOF.
 * @module echo-server
 */

import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { appendFileSync, writeFileSync } from 'node:fs'

const OUT = process.stdout

const CAPABILITIES = { tools: {} }

const TOOLS = [
  {
    name: 'echo_echo',
    title: 'Echo',
    description: 'Echo the provided text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
  },
  {
    name: 'echo_read',
    title: 'Echo read',
    description: 'Read-only probe used to prove reads are not snapshotted.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'echo_write',
    title: 'Echo write',
    description: 'Write probe used to prove a snapshot precedes the write.',
    inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
  },
  {
    name: 'echo_save',
    title: 'Echo save',
    description: 'Snapshot tool: writes the current document to the requested path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
  },
  {
    name: 'echo_doc_info',
    title: 'Echo document info',
    description: 'Reports the current document path.',
    inputSchema: { type: 'object', properties: {} },
  },
]

function send(obj) {
  OUT.write(JSON.stringify(obj) + '\n')
}

function idResponse(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function errorResponse(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

function callTool(name, args) {
  switch (name) {
    case 'echo_echo':
      return { content: [{ type: 'text', text: String(args.text ?? '') }] }
    case 'echo_read':
      return { content: [{ type: 'text', text: 'read-ok' }] }
    case 'echo_write': {
      const log = process.env.ECHO_WRITE_LOG
      if (log !== undefined) appendFileSync(log, `${new Date().toISOString()} write ${String(args.value ?? '')}\n`)
      return { content: [{ type: 'text', text: 'write-ok' }] }
    }
    case 'echo_save': {
      const path = typeof args.path === 'string' ? args.path : undefined
      if (path === undefined) return { isError: true, content: [{ type: 'text', text: 'path is required' }] }
      if (process.env.ECHO_SAVE_BROKEN === '1') {
        throw new Error('echo_save is configured to fail (ECHO_SAVE_BROKEN=1)')
      }
      writeFileSync(path, `snapshot:${new Date().toISOString()}`)
      return { content: [{ type: 'text', text: `saved:${path}` }] }
    }
    case 'echo_doc_info':
      return { content: [{ type: 'text', text: process.env.ECHO_DOC_PATH ?? 'C:\\none.3dm' }] }
    default:
      throw new Error(`unknown tool: ${name}`)
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

rl.on('line', line => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  const { jsonrpc, id, method, params } = message
  if (jsonrpc !== '2.0') return
  if (method === 'initialize') {
    idResponse(id, {
      protocolVersion: '2025-03-26',
      capabilities: CAPABILITIES,
      serverInfo: { name: 'echo-probe-server', version: '0.2.0' },
    })
  } else if (method === 'initialized') {
    // no state to set; listing is unconditional
  } else if (method === 'tools/list') {
    idResponse(id, { tools: TOOLS })
  } else if (method === 'tools/call') {
    try {
      idResponse(id, callTool(params?.name, params?.arguments ?? {}))
    } catch (error) {
      errorResponse(id, -32000, String(error))
    }
  } else if (method === 'ping') {
    idResponse(id, {})
  } else if (id !== undefined) {
    errorResponse(id, -32601, `Method not found: ${method}`)
  }
})

// Keep the process alive until stdin closes.
void once(rl, 'close').then(() => process.exit(0))
