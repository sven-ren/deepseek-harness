/**
 * Page-level sign-in bridge.
 *
 * The settings panel owns the account page, but a feature that discovers a
 * rejected upstream call (a marketplace 401, an entitlement check) needs to
 * open the sign-in flow from wherever it happens to be. The panel publishes
 * no programmatic open API across packages, so the two talk over window
 * events: a request opens the overlay, and a state change tells interested
 * features to re-read their own data.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/login-bridge
 */

/** Dispatched by any feature that wants the sign-in overlay opened. */
export const LOGIN_REQUEST_EVENT = 'hongling-auth:request-login'

/** Dispatched after a sign-in or sign-out lands. */
export const LOGIN_CHANGED_EVENT = 'hongling-auth:changed'

/** Tell the page that the login state changed. */
export function notifyLoginChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(LOGIN_CHANGED_EVENT))
}

/**
 * Listen for sign-in requests.
 * @param listener - invoked for each request.
 * @returns the unsubscribe function.
 */
export function onLoginRequest(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(LOGIN_REQUEST_EVENT, listener)
  return () => { window.removeEventListener(LOGIN_REQUEST_EVENT, listener) }
}
