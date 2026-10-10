/**
 * The account settings section.
 *
 * It registers into `settings.section` under the shipped account section's own
 * id at a lower priority, so on a Desktop build — where
 * `@deepseek-ai/dsh-client-ui-settings-account` also claims `account` — this
 * panel is the occupant that renders and the DeepSeek one withdraws. The shell
 * already wraps the page in its settings column, so this component owns only
 * its content column.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/AuthSection
 */

import type { ReactElement } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AuthBody } from './AuthBody.tsx'
import type { AuthPanelInjected } from './auth-panel.ts'
import { AUTH_NS } from './locales.ts'
import { authView, isInFlight } from './presentation.ts'
import { useAuthPolling } from './use-auth-polling.ts'
import css from './auth.module.css'

/** Composed account-section props. */
export type AuthSectionProps =
  PropsRuntime<'settings.section'> & PropsLocale<typeof AUTH_NS> & InjectFace<AuthPanelInjected>

/** Avatar edge length in the settings panel, matching the shipped account page. */
const AVATAR_SIZE = 40

/**
 * Render the account page.
 * @param props - localized copy, the panel snapshot hook, and the panel's actions.
 * @returns the section, kept fresh by the shared polling policy.
 */
export function AuthSection(props: AuthSectionProps): ReactElement {
  const {
    t, useAuth, refreshStatus, refreshProgress, startLogin, cancelLogin, logout, copyLoginUrl,
  } = props
  const state = useAuth(value => value)
  useAuthPolling(true, isInFlight(state.progress.phase), { refreshStatus, refreshProgress })
  return (
    <div className={css.section}>
      <AuthBody
        view={authView(state.status, state.progress)}
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
    </div>
  )
}
