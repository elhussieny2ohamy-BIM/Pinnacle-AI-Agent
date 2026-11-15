/**
 * The hub's Modules and Doctor screens. Writes require an in-page confirmation
 * and are sent through the host's aec_control tool pipeline for policy checks.
 * @module @pinnacle/mcp-hub/src/client/HubPage
 */

import { useCallback, useEffect, useState, type JSX } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { HubPanelFace } from './HubClient.ts'
import type { HubLocaleKey } from './locales.ts'
import { PINNACLE_SYMBOL_DATA_URI, PINNACLE_SYMBOL_DIMENSIONS } from './brand.ts'
import type { DoctorBackup, DoctorModule, DoctorReport, HubStatus, ModuleStatus, ProbeOutcome } from '../../src/types.ts'

/** Injected face: the remote client and the locale `t` function. */
export interface HubPageInject {
  face: HubPanelFace
  t: (key: HubLocaleKey) => string
}

/** Sidebar icon for the MCP hub entry: the Pinnacle brand symbol. */
export function HubPageIcon({ size = 18 }: PropsRuntime<'sidebar.panellist'>): JSX.Element {
  const aspect = PINNACLE_SYMBOL_DIMENSIONS.width / PINNACLE_SYMBOL_DIMENSIONS.height
  return (
    <svg
      width={size * aspect}
      height={size}
      viewBox={`0 0 ${PINNACLE_SYMBOL_DIMENSIONS.width} ${PINNACLE_SYMBOL_DIMENSIONS.height}`}
      fill="none"
      aria-hidden="true"
      className="pinnacle-hub-icon"
    >
      <image
        width={PINNACLE_SYMBOL_DIMENSIONS.width}
        height={PINNACLE_SYMBOL_DIMENSIONS.height}
        href={PINNACLE_SYMBOL_DATA_URI}
      />
    </svg>
  )
}

/** Component props assembled by the main slot renderer. */
export type HubPageProps = PropsRuntime<'main'> & PropsLocale<'hub'> & InjectFace<HubPageInject>

type RemoteState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'error'; readonly error: string }
  | { readonly state: 'ready'; readonly data: T }

type WriteAction = 'enable' | 'disable' | 'probe'
type Feedback = { readonly tone: 'success' | 'error'; readonly text: string }

const PAGE_STYLE = {
  display: 'grid',
  gap: 16,
  maxWidth: 1120,
  padding: 20,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
} as const

const MUTED_STYLE = { color: 'var(--dsw-alias-label-secondary)' } as const
const TABLE_WRAP_STYLE = { overflowX: 'auto', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8 } as const
const TABLE_STYLE = { width: '100%', borderCollapse: 'collapse', minWidth: 560, textAlign: 'start' } as const
const CELL_STYLE = { padding: '10px 12px', borderBottom: '1px solid var(--dsw-alias-border-l2)', verticalAlign: 'top' } as const
const HEADER_CELL_STYLE = { ...CELL_STYLE, color: 'var(--dsw-alias-label-secondary)', fontWeight: 600, whiteSpace: 'nowrap' } as const
const BUTTON_STYLE = {
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  padding: '6px 10px',
  color: 'var(--dsw-alias-label-primary)',
  background: 'var(--dsw-alias-bg-base)',
  cursor: 'pointer',
  font: 'inherit',
} as const

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stateLabel(state: string, t: (key: HubLocaleKey) => string): string {
  switch (state) {
    case 'connected': return t('status.connected')
    case 'app_not_running': return t('status.appNotRunning')
    case 'disabled': return t('status.disabled')
    case 'error': return t('status.error')
    case 'starting': return t('status.starting')
    default: return state
  }
}

function capabilityLabel(capability: DoctorBackup['capability'], t: (key: HubLocaleKey) => string): string {
  switch (capability) {
    case 'tool': return t('capability.tool')
    case 'file': return t('capability.file')
    case 'none': return t('capability.none')
    case 'unsupported': return t('capability.unsupported')
  }
}

function stateTone(state: ModuleStatus['state']): string {
  if (state === 'connected') return 'var(--dsw-alias-state-business-primary)'
  if (state === 'error') return 'var(--dsw-alias-state-error-primary)'
  if (state === 'disabled') return 'var(--dsw-alias-label-tertiary)'
  return 'var(--dsw-alias-label-secondary)'
}

function errorStyle() {
  return {
    padding: 12,
    borderRadius: 6,
    color: 'var(--dsw-alias-state-error-primary)',
    background: 'var(--dsw-alias-state-error-tertiary)',
  }
}

export function HubPage({ t, face }: HubPageProps): JSX.Element {
  const [tab, setTab] = useState<'modules' | 'doctor'>('modules')
  const [status, setStatus] = useState<RemoteState<HubStatus>>({ state: 'loading' })
  const [doctor, setDoctor] = useState<RemoteState<DoctorReport>>({ state: 'loading' })

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus({ state: 'ready', data: await face.status() })
    } catch (error) {
      setStatus({ state: 'error', error: messageOf(error) })
    }
  }, [face])

  const refreshDoctor = useCallback(async (): Promise<void> => {
    try {
      setDoctor({ state: 'ready', data: await face.doctor() })
    } catch (error) {
      setDoctor({ state: 'error', error: messageOf(error) })
    }
  }, [face])

  const refreshAll = useCallback(async (): Promise<void> => {
    await Promise.all([refreshStatus(), refreshDoctor()])
  }, [refreshDoctor, refreshStatus])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const waitingForConnection = status.state === 'ready'
    && status.data.modules.some(module => module.state === 'starting')
  useEffect(() => {
    if (!waitingForConnection) return
    const timer = globalThis.setInterval(() => { void refreshStatus() }, 1000)
    return () => globalThis.clearInterval(timer)
  }, [refreshStatus, waitingForConnection])

  const tabStyle = (active: boolean) => ({
    ...BUTTON_STYLE,
    borderRadius: '6px 6px 0 0',
    borderBottom: active ? '2px solid var(--dsw-alias-state-business-primary)' : '1px solid var(--dsw-alias-border-l2)',
    background: active ? 'var(--dsw-alias-bg-base)' : 'transparent',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div className="pinnacle-hub-page" style={PAGE_STYLE}>
      <header style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 650 }}>{t('panel')}</h2>
          <p style={{ ...MUTED_STYLE, margin: '6px 0 0' }}>{t(tab === 'modules' ? 'modules.title' : 'doctor.title')}</p>
        </div>
        <button type="button" onClick={() => void refreshAll()} style={BUTTON_STYLE}>{t('action.refresh')}</button>
      </header>

      <div role="tablist" aria-label={t('panel')} style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
        <button type="button" role="tab" aria-selected={tab === 'modules'} onClick={() => setTab('modules')} style={tabStyle(tab === 'modules')}>
          {t('modules.title')}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'doctor'} onClick={() => setTab('doctor')} style={tabStyle(tab === 'doctor')}>
          {t('doctor.title')}
        </button>
      </div>

      {tab === 'modules' ? (
        <ModulesScreen state={status} face={face} t={t} refresh={refreshAll} retry={refreshStatus} />
      ) : (
        <DoctorScreen state={doctor} t={t} retry={refreshDoctor} />
      )}
    </div>
  )
}

function ModulesScreen({
  state,
  face,
  t,
  refresh,
  retry,
}: {
  state: RemoteState<HubStatus>
  face: HubPanelFace
  t: (key: HubLocaleKey) => string
  refresh: () => Promise<void>
  retry: () => Promise<void>
}): JSX.Element {
  const [pending, setPending] = useState<{ readonly id: string; readonly action: WriteAction } | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const modules = state.state === 'ready' ? state.data.modules : []

  const runPendingAction = async (): Promise<void> => {
    if (pending === null || busy) return
    const action = pending
    setPending(null)
    setBusy(true)
    setFeedback(null)
    try {
      if (action.action === 'probe') {
        const outcome: ProbeOutcome = await face.probe(action.id)
        setFeedback({
          tone: outcome.ok ? 'success' : 'error',
          text: outcome.ok
            ? `${t('action.probeSucceeded')} Â· ${outcome.durationMs} ms`
            : `${t('action.probeFailed')}: ${outcome.message ?? outcome.stage}`,
        })
      } else {
        await face.setEnabled(action.id, action.action === 'enable')
        setFeedback({ tone: 'success', text: t('feedback.completed') })
      }
      await refresh()
    } catch (error) {
      setFeedback({ tone: 'error', text: messageOf(error) })
    } finally {
      setBusy(false)
    }
  }

  if (state.state === 'loading') return <p role="status" style={MUTED_STYLE}>{t('modules.loading')}</p>
  if (state.state === 'error') {
    return <RetryPanel message={state.error} t={t} retry={retry} />
  }

  return (
    <section aria-busy={busy} style={{ display: 'grid', gap: 12 }}>
      {feedback !== null ? (
        <div role="status" aria-live="polite" style={feedback.tone === 'error' ? errorStyle() : MUTED_STYLE}>{feedback.text}</div>
      ) : null}

      {pending !== null ? (
        <div role="group" aria-label={t('action.confirm')} style={{ padding: 12, border: '1px solid var(--dsw-alias-state-warn-secondary)', borderRadius: 8, background: 'var(--dsw-alias-state-warn-tertiary)' }}>
          <p style={{ margin: '0 0 10px' }}>{t(`confirm.${pending.action}`)} <strong>{pending.id}</strong></p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => void runPendingAction()} style={BUTTON_STYLE}>{t('action.confirm')}</button>
            <button type="button" disabled={busy} onClick={() => setPending(null)} style={BUTTON_STYLE}>{t('action.cancel')}</button>
          </div>
        </div>
      ) : null}

      {modules.length === 0 ? <p style={MUTED_STYLE}>{t('modules.empty')}</p> : (
        <div style={TABLE_WRAP_STYLE}>
          <table style={TABLE_STYLE}>
            <thead><tr>
              {[t('modules.title'), t('modules.state'), t('modules.toggle'), t('modules.probe')].map(label => <th key={label} scope="col" style={HEADER_CELL_STYLE}>{label}</th>)}
            </tr></thead>
            <tbody>
              {modules.map(module => (
                <tr key={module.id}>
                  <td style={CELL_STYLE}>
                    <strong>{module.title}</strong>
                    <div style={{ ...MUTED_STYLE, marginTop: 3, overflowWrap: 'anywhere' }}>{module.detail}</div>
                  </td>
                  <td style={CELL_STYLE}><span style={{ color: stateTone(module.state), fontWeight: 600 }}>{stateLabel(module.state, t)}</span></td>
                  <td style={CELL_STYLE}>
                    <button type="button" disabled={busy || pending !== null} aria-label={`${module.state === 'connected' || module.state === 'starting' ? t('action.disable') : t('action.enable')} ${module.title}`} onClick={() => setPending({ id: module.id, action: module.state === 'connected' || module.state === 'starting' ? 'disable' : 'enable' })} style={BUTTON_STYLE}>
                      {module.state === 'connected' || module.state === 'starting' ? t('action.disable') : t('action.enable')}
                    </button>
                  </td>
                  <td style={CELL_STYLE}>
                    <button type="button" disabled={busy || pending !== null || module.state === 'disabled'} aria-label={`${t('action.probe')} ${module.title}`} onClick={() => setPending({ id: module.id, action: 'probe' })} style={BUTTON_STYLE}>
                      {t('action.probe')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function DoctorScreen({
  state,
  t,
  retry,
}: {
  state: RemoteState<DoctorReport>
  t: (key: HubLocaleKey) => string
  retry: () => Promise<void>
}): JSX.Element {
  if (state.state === 'loading') return <p role="status" style={MUTED_STYLE}>{t('loading')}</p>
  if (state.state === 'error') return <RetryPanel message={state.error} t={t} retry={retry} />

  const report = state.data
  return (
    <section style={{ display: 'grid', gap: 18 }}>
      <p style={MUTED_STYLE}>
        {t('doctor.approval')}: <strong>{t(report.approvalService ? 'doctor.approvalAvailable' : 'doctor.approvalUnavailable')}</strong>
        {' Â· '}{new Date(report.generatedAt).toLocaleString()}
      </p>
      <DiagnosticTable modules={report.modules} t={t} />
      <BackupTable backups={report.backup} t={t} />
      <section>
        <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('doctor.environment')}</h3>
        {report.environment.length === 0 ? <p style={MUTED_STYLE}>{t('doctor.none')}</p> : (
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>{report.environment.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
        )}
      </section>
    </section>
  )
}

function DiagnosticTable({ modules, t }: { modules: readonly DoctorModule[]; t: (key: HubLocaleKey) => string }): JSX.Element {
  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('doctor.modules')}</h3>
      <div style={TABLE_WRAP_STYLE}>
        <table style={TABLE_STYLE}>
          <thead><tr>
            {[t('modules.title'), t('doctor.confidence'), t('modules.state'), t('doctor.issues')].map(label => <th key={label} scope="col" style={HEADER_CELL_STYLE}>{label}</th>)}
          </tr></thead>
          <tbody>
            {modules.length === 0 ? <tr><td colSpan={4} style={CELL_STYLE}>{t('doctor.none')}</td></tr> : modules.map(module => (
              <tr key={module.id}>
                <td style={CELL_STYLE}>{module.title}</td>
                <td style={CELL_STYLE}>{module.confidence}</td>
                <td style={CELL_STYLE}>{stateLabel(module.state, t)}</td>
                <td style={CELL_STYLE}>{[module.detail, ...module.issues].join(' Â· ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BackupTable({ backups, t }: { backups: readonly DoctorBackup[]; t: (key: HubLocaleKey) => string }): JSX.Element {
  return (
    <section>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('doctor.backup')}</h3>
      <div style={TABLE_WRAP_STYLE}>
        <table style={TABLE_STYLE}>
          <thead><tr>
            {[t('modules.title'), t('doctor.backup'), t('doctor.lastSnapshot'), t('doctor.issues')].map(label => <th key={label} scope="col" style={HEADER_CELL_STYLE}>{label}</th>)}
          </tr></thead>
          <tbody>
            {backups.length === 0 ? <tr><td colSpan={4} style={CELL_STYLE}>{t('doctor.none')}</td></tr> : backups.map(backup => (
              <tr key={backup.id}>
                <td style={CELL_STYLE}>{backup.id}</td>
                <td style={CELL_STYLE}>{capabilityLabel(backup.capability, t)}</td>
                <td style={CELL_STYLE}>{backup.lastSnapshotAt ?? t('doctor.noSnapshot')}</td>
                <td style={CELL_STYLE}>{backup.issues.length === 0 ? t('doctor.none') : backup.issues.join(' Â· ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RetryPanel({ message, t, retry }: { message: string; t: (key: HubLocaleKey) => string; retry: () => Promise<void> }): JSX.Element {
  return (
    <div role="alert" style={{ ...errorStyle(), display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <span>{t('doctor.error')}: {message}</span>
      <button type="button" onClick={() => void retry()} style={BUTTON_STYLE}>{t('action.retry')}</button>
    </div>
  )
}

