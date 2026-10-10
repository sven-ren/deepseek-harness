/**
 * Shared Host/Client types for the 虹灵 enterprise-SSO plugin. Both bundles
 * inline this module, so it never becomes a runtime dependency between faces.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth
 */

/** Redacted user facts carried by an id_token's claims. */
export interface AuthProfile {
  username: string
  displayName: string
  email?: string
  roles: string[]
}

/** Login state handed to the browser; never carries the token itself. */
export interface AuthStatus {
  loggedIn: boolean
  profile?: AuthProfile
  /** id_token expiry in epoch milliseconds; absent when the token declares no `exp`. */
  expiresAt?: number
  /** Whether a refresh_token was stored, i.e. whether silent renewal is possible. */
  canRefresh?: boolean
}

/** Stage of an in-flight browser login. */
export type LoginPhase =
  /** Nothing in flight. */
  | 'idle'
  /** The system browser was opened; waiting for the operator to finish at the IdP. */
  | 'waiting_browser'
  /** The browser came back to the loopback receiver; waiting for its hash submission. */
  | 'receiving'
  /** A token arrived and is being verified locally. */
  | 'verifying'
  | 'done'
  | 'error'

/** Progress snapshot polled by the browser while a login is in flight. */
export interface LoginProgress {
  phase: LoginPhase
  /** Login URL, so a browser that never opened can be reached by hand. */
  loginUrl?: string
  message?: string
}

/** Payload/result table of the plugin's RPC channel. No result carries a token. */
export interface AuthRpc {
  'auth.getStatus': { payload: Record<string, never>; result: AuthStatus }
  'auth.login': { payload: Record<string, never>; result: { started: boolean; loginUrl: string } }
  'auth.getLoginProgress': { payload: Record<string, never>; result: LoginProgress }
  'auth.cancelLogin': { payload: Record<string, never>; result: { ok: boolean } }
  'auth.logout': { payload: Record<string, never>; result: { ok: boolean } }
  /** Development injection, available only under `devAuth`. */
  'auth.devLogin': { payload: { username: string; roles?: string[] }; result: { ok: boolean } }
}

/** One endpoint key of {@link AuthRpc}. */
export type AuthRpcEndpoint = keyof AuthRpc

/**
 * Host-process service published as `ctx.honglingAuth`, so other plugins'
 * host halves can attach the operator's token to their own upstream calls.
 * The token stays inside the host process and never reaches the browser.
 */
export interface HonglingAuthService {
  /**
   * The current login state, redacted: it names the profile and the expiry, and
   * carries no token.
   * @returns the same snapshot the browser half reads over the RPC channel.
   */
  getStatus(): AuthStatus
  /**
   * Current valid id_token, silently renewed first when it is inside the
   * refresh margin, so a caller never presents a token that expires mid-request.
   * @returns the token, or undefined when the deployment holds no login.
   */
  getToken(): Promise<string | undefined>
  /**
   * Force a `/dsh/refresh` round trip; an `invalid_grant` clears the login
   * instead of retrying, and any other failure keeps the current token.
   * @returns whether a fresh token replaced the current one.
   */
  refresh(): Promise<boolean>
  /**
   * Subscribe to login, logout, and token rotation.
   * @param listener - called after every state change.
   * @returns the unsubscribe for that listener.
   */
  onChange(listener: () => void): () => void
}

/** Host-side effect registration carried on the Cordis context. */
export interface TokenSet {
  version: 1
  /** `iss` claim, the JWKS derivation input; `"dev"` for injected development logins. */
  iss?: string
  idToken: string
  refreshToken?: string
  /** Epoch milliseconds from `exp`, or derived from `expires_in`; absent means "no expiry declared". */
  expiresAt?: number
  profile: AuthProfile
  savedAt: number
}
