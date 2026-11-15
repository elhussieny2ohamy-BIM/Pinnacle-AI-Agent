/**
 * Write policy for the PINNACLE MCP hub.
 *
 * Enforces `writeMode` on `tools/pre-execute` for the `aec_control` tool:
 * - Safe actions (`status`, `list`, `doctor`, `discover`) are always allowed.
 * - Write actions (`enable`, `disable`, `probe`) are governed by the hub's
 *   default `writeMode`: `deny` refuses, `confirm` asks (or refuses without
 *   an approval service), `allow` permits.
 * - `writeMode` is never exposed to the model; it is read from hub config only.
 * @module @PINNACLE/mcp-hub/src/policy
 */

/** Pre-dispatch decision. */
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string } }

/** Actions that never require policy approval (read-only). */
export const SAFE_ACTIONS = new Set(['status', 'list', 'doctor', 'discover', 'audit', 'backups'])

/** Actions that change module state and are governed by writeMode. */
export const WRITE_ACTIONS = new Set(['enable', 'disable', 'probe'])

/** Read the action and module from parsed aec_control arguments. */
export function readAecArgs(args: unknown): { action: string | undefined; module: string | undefined } {
  if (args === null || typeof args !== 'object') return { action: undefined, module: undefined }
  const record = args as Record<string, unknown>
  return {
    action: typeof record.action === 'string' ? record.action : undefined,
    module: typeof record.module === 'string' ? record.module : undefined,
  }
}

/** Policy decision for a write action based on writeMode. */
export function decide(writeMode: 'deny' | 'confirm' | 'allow', hasApproval: boolean): PreToolDecision {
  switch (writeMode) {
    case 'deny':
      return { kind: 'deny', reason: 'Write operations are denied by hub policy (writeMode: deny).' }
    case 'confirm':
      if (hasApproval) {
        return {
          kind: 'ask',
          reason: 'Write operation requires confirmation (writeMode: confirm).',
          displayReason: { en: 'Confirm AEC hub write operation' },
        }
      }
      return { kind: 'deny', reason: 'Write operations require confirmation but no approval service is available.' }
    case 'allow':
      return { kind: 'allow' }
    default:
      return { kind: 'deny', reason: `Unknown writeMode: ${writeMode}` }
  }
}

/**
 * Build the `tools/pre-execute` listener for the hub's write policy.
 * @param hubStatus - a thunk returning the current hub status (config + modules).
 * @param hasApproval - whether an approval service is present.
 * @returns a listener `(exec, next) => Promise<PreToolDecision>`.
 */
export function writePolicyListener(
  hubStatus: () => { config: { defaults: { writeMode: 'deny' | 'confirm' | 'allow' } } } | undefined,
  hasApproval: boolean,
) {
  return async (exec: { name: string; arguments: unknown }, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (exec.name !== 'aec_control') return next()
    const { action } = readAecArgs(exec.arguments)

    // Safe actions are always allowed.
    if (action === undefined || SAFE_ACTIONS.has(action)) return next()

    // Write actions are governed by the hub's default writeMode.
    if (WRITE_ACTIONS.has(action)) {
      const writeMode = hubStatus()?.config.defaults.writeMode ?? 'deny'
      const decision = decide(writeMode, hasApproval)
      if (decision.kind !== 'allow') return decision
      return next()
    }

    // Unknown action: let the tool body handle it (it will return an error).
    return next()
  }
}

/**
 * Build the `tools/pre-execute` listener that applies `writeMode` to a module's
 * own MCP tools, not only to `aec_control`. Without it the model could bypass
 * the write policy by calling `mcp__<module>__<tool>` directly.
 * @param identify - maps a tool name to its module and classification.
 * @param hubStatus - a thunk returning the current hub status.
 * @param hasApproval - whether an approval service is present.
 * @returns a listener `(exec, next) => Promise<PreToolDecision>`.
 */
export function moduleWriteListener(
  identify: (toolName: string) => { readonly moduleId: string; readonly kind: 'write' | 'read' | 'backup' | 'unknown' } | undefined,
  hubStatus: () => { config: { defaults: { writeMode: 'deny' | 'confirm' | 'allow' } } } | undefined,
  hasApproval: boolean,
) {
  return async (exec: { name: string }, next: () => Promise<PreToolDecision>): Promise<PreToolDecision> => {
    if (exec.name === 'aec_control') return next()
    const found = identify(exec.name)
    if (found === undefined || found.kind === 'read') return next()
    const writeMode = hubStatus()?.config.defaults.writeMode ?? 'deny'
    const decision = decide(writeMode, hasApproval)
    if (decision.kind !== 'allow') return decision
    return next()
  }
}

