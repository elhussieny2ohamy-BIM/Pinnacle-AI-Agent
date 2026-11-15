/**
 * One message extractor for unknown thrown values, so every hub failure reports
 * the same way whether it came from Node, from a pack, or from Cordis.
 * @module @pinnacle/mcp-hub/src/message
 */

/**
 * Read a printable message from an unknown thrown value.
 * @param error - any value a `catch` block received.
 * @returns the error's message, or the value's string form for non-errors.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

