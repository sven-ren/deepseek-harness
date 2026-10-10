/**
 * The panel body both surfaces render.
 *
 * One implementation per render case keeps the section and the overlay from
 * diverging; they differ only in the chrome around this component and in the
 * avatar size, which is a number rather than a variant.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/AuthBody
 */

import type { ReactElement } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AuthKey } from './locales.ts'
import { HOST_UNAVAILABLE } from './auth-rpc.ts'
import type { AuthPanelError } from './auth-panel.ts'
import { avatarInitial, identityLine, type AuthView } from './presentation.ts'
import css from './auth.module.css'

/** Localized copy of the `hongling.auth` namespace. */
export type AuthTranslate = (key: AuthKey) => string

/** Everything {@link AuthBody} renders and invokes. */
export interface AuthBodyProps {
  /** The projected render case. */
  view: AuthView
  /** Localized copy. */
  t: AuthTranslate
  /** Edge length of the avatar monogram. */
  avatarSize: number
  /** A panel action is in flight. */
  busy: boolean
  /** The login URL was copied. */
  copied: boolean
  /** Last panel failure, or undefined. */
  error: AuthPanelError | undefined
  /** Start the browser sign-in. */
  onStart: () => void
  /** Abandon the in-flight sign-in. */
  onCancel: () => void
  /** Forget the stored token. */
  onLogout: () => void
  /** @param url - login URL to copy. */
  onCopy: (url: string) => void
}

/**
 * The monogram shown while signed in.
 * @param props - the initial and the edge length.
 * @returns a decorative circle; the name beside it carries the meaning.
 */
export function AuthAvatar({ initial, size }: { initial: string; size: number }): ReactElement {
  return (
    <span
      className={css.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size / 2) }}
      aria-hidden="true"
    >
      {initial}
    </span>
  )
}

/** Signed-in summary: identity, optional expiry, and the sign-out action. */
function SignedInCard({ view, avatarSize, busy, t, onLogout }: AuthBodyProps & { view: Extract<AuthView, { kind: 'signed-in' }> }): ReactElement {
  const line = identityLine(view, t('hint.roles'))
  return (
    <>
      <div className={css.card}>
        <AuthAvatar initial={avatarInitial(view)} size={avatarSize} />
        <div className={css.identity}>
          <span className={css.name}>{view.displayName}</span>
          {line === '' ? null : <span className={css.muted}>{line}</span>}
          {view.expiresAt === undefined
            ? null
            : <span className={css.muted}>{t('hint.expiry')}: {new Date(view.expiresAt).toLocaleString()}</span>}
        </div>
      </div>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={onLogout}>{t('action.logout')}</Button>
      </div>
    </>
  )
}

/** Browser sign-in in progress: the phase line, the manual link, and cancel. */
function WaitingBlock({ view, copied, t, onCancel, onCopy }: AuthBodyProps & { view: Extract<AuthView, { kind: 'waiting' }> }): ReactElement {
  const url = view.loginUrl
  return (
    <>
      <p className={css.progress}>{t(view.phaseKey)}</p>
      {url === undefined ? null : (
        <>
          <span className={css.muted}>{t('hint.manual')}</span>
          <code className={css.url}>{url}</code>
          <div className={css.actions}>
            <Button variant="outline" size="sm" onClick={() => { onCopy(url) }}>
              {copied ? t('action.copied') : t('action.copy')}
            </Button>
          </div>
        </>
      )}
      <div className={css.actions}>
        <Button variant="outline" size="sm" onClick={onCancel}>{t('action.cancel')}</Button>
      </div>
    </>
  )
}

/** A failed browser sign-in: the Host's reason, retry, and cancel. */
function FailedBlock({ view, busy, t, onStart, onCancel }: AuthBodyProps & { view: Extract<AuthView, { kind: 'failed' }> }): ReactElement {
  return (
    <>
      <p className={css.error}>{view.message ?? t('phase.error')}</p>
      <div className={css.actions}>
        <Button variant="primary" size="sm" disabled={busy} onClick={onStart}>{t('action.retry')}</Button>
        <Button variant="outline" size="sm" onClick={onCancel}>{t('action.cancel')}</Button>
      </div>
    </>
  )
}

/** Nothing in flight: the single sign-in entry. */
function IdleBlock({ busy, t, onStart }: AuthBodyProps): ReactElement {
  return (
    <div className={css.actions}>
      <Button variant="primary" disabled={busy} onClick={onStart}>{t('action.login')}</Button>
    </div>
  )
}

/**
 * Render one panel state.
 * @param props - the projection, localized copy, and the panel's actions.
 * @returns the account summary, the sign-in flow, or its failure, under one error line.
 */
export function AuthBody(props: AuthBodyProps): ReactElement {
  const { view, error, t } = props
  return (
    <div className={css.body}>
      {view.kind === 'signed-in'
        ? <SignedInCard {...props} view={view} />
        : view.kind === 'waiting'
          ? <WaitingBlock {...props} view={view} />
          : view.kind === 'failed'
            ? <FailedBlock {...props} view={view} />
            : <IdleBlock {...props} />}
      {error === undefined
        ? null
        : <p className={css.error}>{error.code === HOST_UNAVAILABLE ? t('error.unavailable') : error.message}</p>}
    </div>
  )
}
