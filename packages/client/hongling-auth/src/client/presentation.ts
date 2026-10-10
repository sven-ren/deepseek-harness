/**
 * Pure projection from panel state to what the surfaces render.
 *
 * All the branching lives here so the components stay one shape per case and
 * the whole decision table is testable without a DOM: the account section and
 * the login overlay consume the same projection and differ only in chrome.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/presentation
 */

import type { AuthStatus, LoginPhase, LoginProgress } from '../types.ts'
import type { AuthKey } from './locales.ts'

/** What a surface renders for one state pair. */
export type AuthView =
  | { readonly kind: 'signed-in'; readonly username: string; readonly displayName: string; readonly email: string | undefined; readonly roles: readonly string[]; readonly expiresAt: number | undefined }
  | { readonly kind: 'waiting'; readonly phaseKey: AuthKey; readonly loginUrl: string | undefined }
  | { readonly kind: 'failed'; readonly message: string | undefined }
  | { readonly kind: 'idle' }

/** Phases during which the Host is actively completing a browser login. */
const IN_FLIGHT = new Set<LoginPhase>(['waiting_browser', 'receiving', 'verifying'])

/**
 * Whether a login is in flight, i.e. whether polling is worth doing.
 * @param phase - the reported login phase.
 * @returns true for the phases between opening the browser and verifying a token.
 */
export function isInFlight(phase: LoginPhase): boolean {
  return IN_FLIGHT.has(phase)
}

/** Translate key of each in-flight phase's progress line. */
const PHASE_KEYS: Partial<Record<LoginPhase, AuthKey>> = {
  waiting_browser: 'phase.waiting_browser',
  receiving: 'phase.receiving',
  verifying: 'phase.verifying',
}

/**
 * Project the redacted status and the login progress onto one render case.
 *
 * A signed-in session wins over any progress line: the section and the overlay
 * both keep showing the account until the operator signs out, even while a
 * stale error is still recorded from an earlier attempt.
 * @param status - the Host's redacted login state.
 * @param progress - the Host's current login-progress snapshot.
 * @returns the case a surface renders.
 */
export function authView(status: AuthStatus, progress: LoginProgress): AuthView {
  if (status.loggedIn && status.profile !== undefined) {
    const { username, displayName, email, roles } = status.profile
    return {
      kind: 'signed-in',
      username,
      displayName,
      email,
      roles,
      expiresAt: status.expiresAt,
    }
  }
  if (progress.phase === 'error') return { kind: 'failed', message: progress.message }
  const phaseKey = PHASE_KEYS[progress.phase]
  if (phaseKey !== undefined) return { kind: 'waiting', phaseKey, loginUrl: progress.loginUrl }
  return { kind: 'idle' }
}

/**
 * The operator line under a signed-in name: the address, then the roles.
 * @param view - a signed-in projection.
 * @param roleLabel - localized "Roles" label.
 * @returns the joined line, or the empty string when the profile carries neither.
 */
export function identityLine(view: Extract<AuthView, { kind: 'signed-in' }>, roleLabel: string): string {
  const address = view.email ?? view.username
  const roleText = view.roles.length === 0 ? '' : roleLabel + ': ' + view.roles.join(', ')
  if (address === '') return roleText
  if (roleText === '') return address
  return address + ' · ' + roleText
}

/**
 * The first character of the avatar's monogram.
 * @param view - a signed-in projection.
 * @returns one upper-cased character, or '?' when the profile names nothing.
 */
export function avatarInitial(view: Extract<AuthView, { kind: 'signed-in' }>): string {
  return (view.displayName || view.username || '?').slice(0, 1).toUpperCase()
}
