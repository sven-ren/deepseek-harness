/**
 * Audit-space panel, browser half: the **Audit Space** entry of the sidebar
 * and the page it opens in the main column. The page is a vertical slice of
 * the audit-workbench prototype — a project picker, a wide-table picker, and
 * a chat zone — and the chat zone drives a real agent Session through the
 * standard `ctx.sessions` service, proving the "reuse the harness chat
 * capability inside a custom panel" direction end to end.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the sessions-service Context merge (ctx.sessions).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the SlotRegistry Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { AuditSpacePage } from './AuditSpacePage.tsx'
import { AuditSpaceController } from './audit-space-controller.ts'
import { createAuditSpaceStore } from './audit-space-store.ts'
import { AuditSpaceIcon } from './AuditSpaceIcon.tsx'
import { en, zh, type AuditSpaceLocaleKey } from './locales.ts'

export type { AuditSpacePageProps } from './AuditSpacePage.tsx'
export type { AuditSpaceFace } from './audit-space-controller.ts'
export type { AuditLine, AuditSpaceState, StreamingText } from './audit-space-store.ts'
export type { AuditSpaceLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Audit-space panel copy. */
    'auditSpace': AuditSpaceLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'auditSpace'

/** The id shared by the sidebar entry and the main panel it opens. */
export const PANEL_ID = 'audit-space' as MainPanelId

/** Required services: the slot registry, dictionaries, and the sessions service. */
export const inject = ['slots', 'locale', 'sessions']

/**
 * Contribute the Audit Space entry to the sidebar with the page it opens.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-audit-space: dictionaries')
  const t = ctx.locale.bind(NS)

  // The page is a global panel: it belongs to the profile, not to a Session.
  // Its chat owns one Session that the controller creates on first send.
  ctx.slots.inject('main', function* () {
    const handle = createAuditSpaceStore()
    const instance = handle.create()
    const store: typeof handle = { ...handle, create: () => instance }
    const controller = new AuditSpaceController(
      ctx,
      instance.actions,
      () => instance.getSnapshot(),
      t,
    )
    yield ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      store,
      inject: () => controller.inject(),
    }, AuditSpacePage)
    yield () => { controller.dispose() }
  })
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 0,
    label: () => t('panel'),
    locale: NS,
  }, AuditSpaceIcon))
}
