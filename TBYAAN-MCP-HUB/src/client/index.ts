/**
 * Client entry for the PINNACLE MCP hub page.
 *
 * Contributes an always-visible MCP entry to the sidebar (`sidebar.panellist`)
 * and a main panel (`main`, keyed by `mcp-hub`) with two screens: Modules and
 * Doctor. The page talks to the host through the `PINNACLEHub` Typert remote
 * namespace exposed by `src/remote.ts`.
 *
 * @module @PINNACLE/mcp-hub/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the layout service merge (ctx.layout).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the sidebar slot declarations (sidebar.panellist).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale service merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createHubClient, type HubPanelFace } from './HubClient.ts'
import { en, ar, zh, type HubLocaleKey, type HubLocaleNamespace } from './locales.ts'
import { HubPage, HubPageIcon } from './HubPage.tsx'
import hubRemote, { type HubClientRemote } from './remote.ts'
import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Hub page copy. */
    hub: HubLocaleKey
  }
}

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'mcp-hub' as const

/** Dictionary namespace owned by this plugin. */
export const NS = 'hub'

/** Services required by the sidebar registration, the remote face, and layout. */
export const inject = ['slots', 'locale', 'layout', 'remote']

/**
 * Contribute the MCP hub entry to the sidebar and the main panel it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ar }), 'PINNACLE-mcp-hub: dictionaries')
  const remote = (ctx as ClientContext & { remote: TypertClientRemote }).remote
  const remoteReady = remote.$mount(hubRemote)
  // Remote namespaces are Cordis services in their own right. The main panel
  // waits for that service so its face is created in a context that injects it.
  void remoteReady.catch(() => {})
  ctx.effect(() => () => {
    void remoteReady.then(dispose => dispose(), () => {})
  }, 'PINNACLE-mcp-hub: remote')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 100,
    label: () => t('panel'),
    locale: NS,
  }, HubPageIcon)))

  ctx.inject(['remote.PINNACLEHub'], child => {
    const remoteContext = child as ClientContext & {
      remote: TypertClientRemote & { PINNACLEHub: HubClientRemote }
    }
    const face = createHubClient(remoteContext)
    child.effect(() => child.slots.inject('main', () => child.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: () => ({ face, t }),
    }, HubPage)))
  })
}

/** Sidebar icon for the MCP hub entry. */
export { HubPageIcon }

