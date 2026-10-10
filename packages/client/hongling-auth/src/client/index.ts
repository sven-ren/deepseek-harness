/**
 * 虹灵 enterprise-SSO login, browser half.
 *
 * Two surfaces, one panel: the account section lives in settings, and the
 * login overlay is the programmatic entry any in-page feature can raise over
 * the request event. Both read a redacted status and a progress line from the
 * Host half over the `/hongling-auth` RPC channel — the token itself never
 * enters the browser, and no component here talks to the IdP or the market
 * backend directly.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: the locale Context merge (ctx.locale) and the slot declarations
// this package registers into (settings.section, shell.overlay).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AuthOverlay } from './AuthOverlay.tsx'
import { AuthSection } from './AuthSection.tsx'
import { AuthPanel, createAuthPanelFace } from './auth-panel.ts'
import { createAuthRpcCall } from './auth-rpc.ts'
import { AUTH_NS, en, zh } from './locales.ts'
import { onLoginRequest } from './login-bridge.ts'

export type { AuthPanelError, AuthPanelState } from './auth-panel.ts'
export type { AuthSectionProps } from './AuthSection.tsx'
export type { AuthOverlayProps } from './AuthOverlay.tsx'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * Mount both surfaces.
 *
 * The account section claims the shipped account section's id at a lower
 * priority: a `list` slot renders the lowest priority for an id, so this panel
 * wins over `@deepseek-ai/dsh-client-ui-settings-account` wherever both are
 * installed, and a same-priority collision (which the slot registry refuses)
 * cannot happen.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(AUTH_NS, { en, zh }), 'hongling-auth: dictionaries')
  const t = ctx.locale.bind(AUTH_NS)
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const panel = new AuthPanel(createAuthRpcCall(connection))
  const face = createAuthPanelFace(panel)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'account', order: -10, priority: -1,
    label: () => t('nav'), locale: AUTH_NS, inject: () => face,
  }, AuthSection))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'hongling-auth', order: 90, locale: AUTH_NS, inject: () => face,
  }, AuthOverlay))

  // The bridge is how a feature that hits a 401 opens the sign-in flow; it is
  // also the only part of this plugin another package addresses by name.
  ctx.effect(() => onLoginRequest(() => { panel.openOverlay() }), 'hongling-auth: login-request bridge')
}
