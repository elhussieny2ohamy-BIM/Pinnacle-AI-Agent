/**
 * Locale dictionaries for the PINNACLE MCP hub client page.
 *
 * English is the source; Arabic is provided for the primary deployment locale.
 * Every product-visible string lives here and reaches components through the
 * standard `t` seat. Code tokens, module ids, and tool names stay verbatim.
 * @module @PINNACLE/mcp-hub/src/client/locales
 */

export type HubLocaleKey =
  | 'panel'
  | 'modules.title'
  | 'modules.state'
  | 'modules.toggle'
  | 'modules.probe'
  | 'modules.empty'
  | 'modules.loading'
  | 'doctor.title'
  | 'doctor.modules'
  | 'doctor.backup'
  | 'doctor.environment'
  | 'doctor.confidence'
  | 'doctor.approval'
  | 'doctor.approvalAvailable'
  | 'doctor.approvalUnavailable'
  | 'doctor.lastSnapshot'
  | 'doctor.noSnapshot'
  | 'doctor.error'
  | 'doctor.issues'
  | 'doctor.none'
  | 'status.connected'
  | 'status.appNotRunning'
  | 'status.disabled'
  | 'status.error'
  | 'status.starting'
  | 'action.enable'
  | 'action.disable'
  | 'action.probe'
  | 'action.confirm'
  | 'action.cancel'
  | 'action.retry'
  | 'action.refresh'
  | 'action.probeSucceeded'
  | 'action.probeFailed'
  | 'confirm.enable'
  | 'confirm.disable'
  | 'confirm.probe'
  | 'feedback.completed'
  | 'loading'
  | 'capability.tool'
  | 'capability.file'
  | 'capability.none'
  | 'capability.unsupported'
  | 'issue.backupToolMissing'
  | 'issue.documentMissing'
  | 'issue.lastSnapshotFailed'

export const en: Record<HubLocaleKey, string> = {
  panel: 'PINNACLE MCP',
  'modules.title': 'Modules',
  'modules.state': 'State',
  'modules.toggle': 'Toggle',
  'modules.probe': 'Probe',
  'modules.empty': 'No modules are registered in this pack.',
  'modules.loading': 'Loading module statusâ€¦',
  'doctor.title': 'Doctor',
  'doctor.modules': 'Module diagnosis',
  'doctor.backup': 'Backup readiness',
  'doctor.environment': 'Environment',
  'doctor.confidence': 'Discovery confidence',
  'doctor.approval': 'Approval service',
  'doctor.approvalAvailable': 'Available',
  'doctor.approvalUnavailable': 'Unavailable',
  'doctor.lastSnapshot': 'Last snapshot',
  'doctor.noSnapshot': 'No snapshot yet',
  'doctor.error': 'Error',
  'doctor.issues': 'Issues',
  'doctor.none': 'None',
  'status.connected': 'Connected',
  'status.appNotRunning': 'App not running',
  'status.disabled': 'Disabled',
  'status.error': 'Error',
  'status.starting': 'Starting',
  'action.enable': 'Enable',
  'action.disable': 'Disable',
  'action.probe': 'Probe',
  'action.confirm': 'Confirm',
  'action.cancel': 'Cancel',
  'action.retry': 'Retry',
  'action.refresh': 'Refresh',
  'action.probeSucceeded': 'Probe succeeded',
  'action.probeFailed': 'Probe failed',
  'confirm.enable': 'Enable this module?',
  'confirm.disable': 'Disable this module?',
  'confirm.probe': 'Run a connection probe for this module?',
  'feedback.completed': 'Action completed.',
  loading: 'Loadingâ€¦',
  'capability.tool': 'MCP save tool',
  'capability.file': 'File copy (app closed)',
  'capability.none': 'None',
  'capability.unsupported': 'Unsupported',
  'issue.backupToolMissing': 'Backup tool not registered',
  'issue.documentMissing': 'Configured document missing',
  'issue.lastSnapshotFailed': 'Last snapshot failed',
}

export const ar: Record<HubLocaleKey, string> = {
  panel: 'PINNACLE MCP',
  'modules.title': 'Ø§Ù„ÙˆØ­Ø¯Ø§Øª',
  'modules.state': 'Ø§Ù„Ø­Ø§Ù„Ø©',
  'modules.toggle': 'ØªÙØ¹ÙŠÙ„/Ø¥ÙŠÙ‚Ø§Ù',
  'modules.probe': 'ÙØ­Øµ',
  'modules.empty': 'Ù„Ø§ ØªÙˆØ¬Ø¯ ÙˆØ­Ø¯Ø§Øª Ù…Ø³Ø¬Ù„Ø© ÙÙŠ Ù‡Ø°Ù‡ Ø§Ù„Ø­Ø²Ù…Ø©.',
  'modules.loading': 'Ø¬Ø§Ø±Ù ØªØ­Ù…ÙŠÙ„ Ø­Ø§Ù„Ø© Ø§Ù„ÙˆØ­Ø¯Ø§Øªâ€¦',
  'doctor.title': 'Ø§Ù„ØªØ´Ø®ÙŠØµ',
  'doctor.modules': 'ØªØ´Ø®ÙŠØµ Ø§Ù„ÙˆØ­Ø¯Ø§Øª',
  'doctor.backup': 'Ø¬Ø§Ù‡Ø²ÙŠØ© Ø§Ù„Ù†Ø³Ø® Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠ',
  'doctor.environment': 'Ø§Ù„Ø¨ÙŠØ¦Ø©',
  'doctor.confidence': 'Ø«Ù‚Ø© Ø§Ù„Ø§ÙƒØªØ´Ø§Ù',
  'doctor.approval': 'Ø®Ø¯Ù…Ø© Ø§Ù„Ù…ÙˆØ§ÙÙ‚Ø©',
  'doctor.approvalAvailable': 'Ù…ØªØ§Ø­Ø©',
  'doctor.approvalUnavailable': 'ØºÙŠØ± Ù…ØªØ§Ø­Ø©',
  'doctor.lastSnapshot': 'Ø¢Ø®Ø± Ù†Ø³Ø®Ø©',
  'doctor.noSnapshot': 'Ù„Ø§ ØªÙˆØ¬Ø¯ Ù†Ø³Ø®Ø© Ø¨Ø¹Ø¯',
  'doctor.error': 'Ø®Ø·Ø£',
  'doctor.issues': 'Ù…Ø´Ø§ÙƒÙ„',
  'doctor.none': 'Ù„Ø§ Ø´ÙŠØ¡',
  'status.connected': 'Ù…ØªØµÙ„',
  'status.appNotRunning': 'Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ ØºÙŠØ± Ù‚ÙŠØ¯ Ø§Ù„ØªØ´ØºÙŠÙ„',
  'status.disabled': 'Ù…Ø¹Ø·Ù„',
  'status.error': 'Ø®Ø·Ø£',
  'status.starting': 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ´ØºÙŠÙ„',
  'action.enable': 'ØªÙØ¹ÙŠÙ„',
  'action.disable': 'Ø¥ÙŠÙ‚Ø§Ù',
  'action.probe': 'ÙØ­Øµ',
  'action.confirm': 'ØªØ£ÙƒÙŠØ¯',
  'action.cancel': 'Ø¥Ù„ØºØ§Ø¡',
  'action.retry': 'Ø¥Ø¹Ø§Ø¯Ø© Ø§Ù„Ù…Ø­Ø§ÙˆÙ„Ø©',
  'action.refresh': 'ØªØ­Ø¯ÙŠØ«',
  'action.probeSucceeded': 'Ù†Ø¬Ø­ Ø§Ù„ÙØ­Øµ',
  'action.probeFailed': 'ÙØ´Ù„ Ø§Ù„ÙØ­Øµ',
  'confirm.enable': 'Ù‡Ù„ ØªØ±ÙŠØ¯ ØªÙØ¹ÙŠÙ„ Ù‡Ø°Ù‡ Ø§Ù„ÙˆØ­Ø¯Ø©ØŸ',
  'confirm.disable': 'Ù‡Ù„ ØªØ±ÙŠØ¯ Ø¥ÙŠÙ‚Ø§Ù Ù‡Ø°Ù‡ Ø§Ù„ÙˆØ­Ø¯Ø©ØŸ',
  'confirm.probe': 'Ù‡Ù„ ØªØ±ÙŠØ¯ ÙØ­Øµ Ø§ØªØµØ§Ù„ Ù‡Ø°Ù‡ Ø§Ù„ÙˆØ­Ø¯Ø©ØŸ',
  'feedback.completed': 'Ø§ÙƒØªÙ…Ù„ Ø§Ù„Ø¥Ø¬Ø±Ø§Ø¡.',
  loading: 'Ø¬Ø§Ø±Ù Ø§Ù„ØªØ­Ù…ÙŠÙ„â€¦',
  'capability.tool': 'Ø£Ø¯Ø§Ø© Ø­ÙØ¸ MCP',
  'capability.file': 'Ù†Ø³Ø® Ø§Ù„Ù…Ù„Ù (Ø§Ù„ØªØ·Ø¨ÙŠÙ‚ Ù…ØºÙ„Ù‚)',
  'capability.none': 'Ù„Ø§ Ø´ÙŠØ¡',
  'capability.unsupported': 'ØºÙŠØ± Ù…Ø¯Ø¹ÙˆÙ…',
  'issue.backupToolMissing': 'Ø£Ø¯Ø§Ø© Ø§Ù„Ù†Ø³Ø®Ø© Ø§Ù„Ø§Ø­ØªÙŠØ§Ø·ÙŠØ© ØºÙŠØ± Ù…Ø³Ø¬Ù„Ø©',
  'issue.documentMissing': 'Ø§Ù„Ù…Ø³ØªÙ†Ø¯ Ø§Ù„Ù…ÙƒÙˆÙ‘Ù† Ù…ÙÙ‚ÙˆØ¯',
  'issue.lastSnapshotFailed': 'ÙØ´Ù„ Ø¢Ø®Ø± Ù†Ø³Ø®Ø© Ø§Ø­ØªÙŠØ§Ø·ÙŠØ©',
}

// Chinese falls back to English strings until a proper translation is provided.
export const zh: Record<HubLocaleKey, string> = { ...en }

export type HubLocaleNamespace = typeof en

