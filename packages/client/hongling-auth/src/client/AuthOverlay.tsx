/**
 * The login overlay.
 *
 * Any in-page feature can open it by dispatching the request event, which is
 * what lets a marketplace 401 hand the operator a sign-in entry without
 * depending on the settings panel. It renders the same body as the account
 * section inside the shell's modal, and closes itself shortly after a sign-in
 * lands so the operator returns to whatever asked them to sign in.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/AuthOverlay
 */

import { useEffect, type ReactElement } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: the shell.overlay slot declaration.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AuthBody } from './AuthBody.tsx'
import type { AuthPanelInjected } from './auth-panel.ts'
import { AUTH_NS } from './locales.ts'
import { authView, isInFlight } from './presentation.ts'
import { useAuthPolling } from './use-auth-polling.ts'

/** Composed login-overlay props. */
export type AuthOverlayProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<typeof AUTH_NS> & InjectFace<AuthPanelInjected>

/** How long the success state stays visible before the overlay dismisses itself. */
export const CLOSE_DELAY_MS = 600

/** Avatar edge length in the overlay, matching the shipped sign-in dialog. */
const AVATAR_SIZE = 24

/**
 * Render the sign-in overlay.
 * @param props - localized copy, the panel snapshot hook, and the panel's actions.
 * @returns the portal-less modal; the shell's overlay layer owns placement.
 */
export function AuthOverlay(props: AuthOverlayProps): ReactElement {
  const {
    t, useAuth, refreshStatus, refreshProgress, startLogin, cancelLogin, logout, copyLoginUrl, closeOverlay,
  } = props
  const state = useAuth(value => value)
  const view = authView(state.status, state.progress)
  useAuthPolling(state.open, isInFlight(state.progress.phase), { refreshStatus, refreshProgress })
  const signedIn = view.kind === 'signed-in'
  useEffect(() => {
    if (!state.open || !signedIn) return
    const timer = setTimeout(closeOverlay, CLOSE_DELAY_MS)
    return () => { clearTimeout(timer) }
  }, [state.open, signedIn, closeOverlay])
  return (
    <Modal open={state.open} onClose={closeOverlay} title={t('title')} closeLabel={t('close')}>
      <AuthBody
        view={view}
        t={t}
        avatarSize={AVATAR_SIZE}
        busy={state.busy}
        copied={state.copied}
        error={state.error}
        onStart={startLogin}
        onCancel={cancelLogin}
        onLogout={logout}
        onCopy={copyLoginUrl}
      />
    </Modal>
  )
}
