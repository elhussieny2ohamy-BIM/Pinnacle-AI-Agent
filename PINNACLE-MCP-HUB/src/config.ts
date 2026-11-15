/**
 * Validation for the hub's `cordis.patch.yml` row. Every value is checked
 * before the registry touches the filesystem, so a malformed row fails at load
 * with a message naming the exact field instead of a downstream `undefined`.
 * @module @pinnacle/mcp-hub/src/config
 */

import { isAbsolute } from 'node:path'
import type { ApplyMode, BackupFailureMode, HubBackupConfig, HubConfig, HubDefaults, WriteMode } from './types.ts'

/** Raised when the configuration row is malformed. */
export class HubConfigError extends Error {
  /** @param message - an actionable description naming the offending field. */
  constructor(message: string) {
    super(message)
    this.name = 'HubConfigError'
  }
}

const WRITE_MODES: readonly WriteMode[] = ['deny', 'confirm', 'allow']
const APPLY_MODES: readonly ApplyMode[] = ['confirm', 'auto']
const BACKUP_FAILURE_MODES: readonly BackupFailureMode[] = ['block', 'warn']

/** Defaults applied when a row omits an optional section. */
export const DEFAULT_DEFAULTS: HubDefaults = {
  profile: 'coordination',
  writeMode: 'deny',
  maxVisibleTools: 120,
  pollMs: 20_000,
}

/** Defaults applied when the row omits its `backup` section. */
export const DEFAULT_BACKUP: HubBackupConfig = {
  failure: 'block',
  dedupeMs: 120_000,
  keep: 10,
  minFreeMb: 2048,
  timeoutMs: 20_000,
  files: {},
}

/** Read a record-like value, or fail with the field's path. */
function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a mapping`)
  }
  return value as Record<string, unknown>
}

/** Read a non-empty string. */
function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a non-empty string`)
  }
  return value
}

/** Read a non-empty string list, rejecting non-strings instead of coercing them. */
function packageNames(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a list of package names`)
  return value.map((entry, index) => text(entry, `${path}[${index}]`))
}

/** Read one enum member, listing the accepted values in the error. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}`)
}

/** Read a positive integer bound. */
function positiveInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/** Read a non-negative integer bound (zero disables the feature). */
function nonNegativeInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be a non-negative integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/** Read an absolute path; relative paths would depend on the process CWD. */
function absolutePath(value: unknown, path: string): string {
  const resolved = text(value, path)
  if (!isAbsolute(resolved)) {
    throw new HubConfigError(`pinnacle-mcp-hub: ${path} must be an absolute path, got ${JSON.stringify(resolved)}`)
  }
  return resolved
}

/** Validate the `discovery` section, defaulting to confirmation. */
function readDiscovery(raw: unknown): HubConfig['discovery'] {
  if (raw === undefined) return { applyMode: 'confirm' }
  const source = record(raw, 'config.discovery')
  return {
    applyMode: source.applyMode === undefined
      ? 'confirm'
      : oneOf(source.applyMode, APPLY_MODES, 'config.discovery.applyMode'),
  }
}

/** Validate the `defaults` section, filling each absent field from {@link DEFAULT_DEFAULTS}. */
function readDefaults(raw: unknown): HubDefaults {
  if (raw === undefined) return DEFAULT_DEFAULTS
  const source = record(raw, 'config.defaults')
  return {
    profile: source.profile === undefined
      ? DEFAULT_DEFAULTS.profile
      : text(source.profile, 'config.defaults.profile'),
    writeMode: source.writeMode === undefined
      ? DEFAULT_DEFAULTS.writeMode
      : oneOf(source.writeMode, WRITE_MODES, 'config.defaults.writeMode'),
    maxVisibleTools: source.maxVisibleTools === undefined
      ? DEFAULT_DEFAULTS.maxVisibleTools
      : positiveInteger(source.maxVisibleTools, 'config.defaults.maxVisibleTools'),
    pollMs: source.pollMs === undefined
      ? DEFAULT_DEFAULTS.pollMs
      : positiveInteger(source.pollMs, 'config.defaults.pollMs'),
  }
}

/** Validate the `backup` section, filling each absent field from {@link DEFAULT_BACKUP}. */
function readBackup(raw: unknown): HubBackupConfig {
  if (raw === undefined) return DEFAULT_BACKUP
  const source = record(raw, 'config.backup')
  const files: Record<string, string> = {}
  if (source.files !== undefined) {
    const entries = record(source.files, 'config.backup.files')
    for (const [id, value] of Object.entries(entries)) {
      files[id] = absolutePath(value, `config.backup.files.${id}`)
    }
  }
  return {
    failure: source.failure === undefined
      ? DEFAULT_BACKUP.failure
      : oneOf(source.failure, BACKUP_FAILURE_MODES, 'config.backup.failure'),
    dedupeMs: source.dedupeMs === undefined
      ? DEFAULT_BACKUP.dedupeMs
      : nonNegativeInteger(source.dedupeMs, 'config.backup.dedupeMs'),
    keep: source.keep === undefined
      ? DEFAULT_BACKUP.keep
      : positiveInteger(source.keep, 'config.backup.keep'),
    minFreeMb: source.minFreeMb === undefined
      ? DEFAULT_BACKUP.minFreeMb
      : nonNegativeInteger(source.minFreeMb, 'config.backup.minFreeMb'),
    timeoutMs: source.timeoutMs === undefined
      ? DEFAULT_BACKUP.timeoutMs
      : positiveInteger(source.timeoutMs, 'config.backup.timeoutMs'),
    files,
  }
}

/**
 * Validate the row's `config` value.
 * @param raw - the unvalidated `config` mapping handed to `apply`.
 * @returns the complete hub configuration, with defaults filled per section.
 * @throws {HubConfigError} when any field is absent or has the wrong type.
 */
export function readHubConfig(raw: unknown): HubConfig {
  const source = raw === undefined ? {} : record(raw, 'config')
  return {
    packs: source.packs === undefined ? [] : packageNames(source.packs, 'config.packs'),
    discovery: readDiscovery(source.discovery),
    defaults: readDefaults(source.defaults),
    backup: readBackup(source.backup),
  }
}

