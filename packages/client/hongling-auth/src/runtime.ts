/**
 * The plugin's runtime: the in-memory login state, the browser-login flow, the
 * token-refresh round trip, and the endpoint dispatch shared by the RPC
 * channel and the public `ctx.honglingAuth` service.
 *
 * State lives here rather than in module scope so a reloaded plugin starts
 * clean, and every side effect (network, clock, browser launch, token file)
 * arrives through {@link AuthRuntimeInternals} so the whole surface is
 * testable without a real operator.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/runtime
 */

import type { ResolvedConfig } from './config.ts'
import { AuthError, messageOf } from './errors.ts'
import { buildTokenSet, createJwksResolver, type JwksResolver } from './jwt.ts'
import { LoginSessionRegistry, type CompletionResult, type LaunchExternal, type SessionLogger } from './login-session.ts'
import { clearTokenSet, loadTokenSet, saveTokenSet } from './token-store.ts'
import type { AuthRpcEndpoint, AuthStatus, HonglingAuthService, LoginProgress, TokenSet } from './types.ts'

/** Refresh this long before expiry, so an in-flight request never presents a stale token. */
export const REFRESH_MARGIN_MS = 60 * 1000
/** Request deadline for one refresh round trip. */
export const REFRESH_TIMEOUT_MS = 15_000

/** Everything the runtime touches, injected so no test reaches a real system. */
export interface AuthRuntimeInternals {
  config: ResolvedConfig
  logger: SessionLogger
  /** Absolute path of the token file. */
  file: string
  /** Hands the login URL to the operator's browser. */
  launch: LaunchExternal
  fetch?: typeof globalThis.fetch
  now?: () => number
  /** Browser-login deadline; a short value keeps timeout behavior testable. */
  loginTimeoutMs?: number
}

/** One refresh or login response body from the market backend. */
interface RelayResponse {
  id_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

/**
 * Owns login state for one plugin life.
 */
export class AuthRuntime {
  private current: TokenSet | null = null
  private readonly listeners = new Set<() => void>()
  private readonly sessions: LoginSessionRegistry
  private readonly internals: AuthRuntimeInternals
  private readonly doFetch: typeof globalThis.fetch
  private readonly now: () => number
  /** JWKS reader bound to this runtime's network and clock; built in the constructor so `now` already holds its value. */
  private readonly jwks: JwksResolver

  /** @param internals - config, logger, token file, launcher, and effect overrides. */
  constructor(internals: AuthRuntimeInternals) {
    this.internals = internals
    this.doFetch = internals.fetch ?? globalThis.fetch
    this.now = internals.now ?? Date.now
    this.jwks = createJwksResolver({
      ...(internals.fetch === undefined ? {} : { fetch: internals.fetch }),
      now: (): number => this.now(),
    })
    this.sessions = new LoginSessionRegistry({
      launch: internals.launch,
      logger: internals.logger,
      complete: (idToken, payload) => this.completeLogin(idToken, payload),
      ...(internals.loginTimeoutMs === undefined ? {} : { timeoutMs: internals.loginTimeoutMs }),
    })
  }

  /** Stop listening for callbacks. */
  dispose(): void {
    this.sessions.dispose()
  }

  /**
   * Adopt a token file left by a previous run, renewing it once in the
   * background when it is already inside the refresh margin.
   */
  async restore(): Promise<void> {
    const stored = await loadTokenSet(this.internals.file)
    if (stored === null) return
    this.current = stored
    if (this.isExpiring(stored) && this.hasRefreshToken(stored)) await this.refresh()
  }

  /**
   * Redacted login state; never includes the token.
   * @returns whether a token is held, with its profile, expiry, and refreshability.
   */
  getStatus(): AuthStatus {
    const current = this.current
    if (current === null) return { loggedIn: false }
    return {
      loggedIn: true,
      profile: current.profile,
      ...(current.expiresAt === undefined ? {} : { expiresAt: current.expiresAt }),
      canRefresh: this.hasRefreshToken(current),
    }
  }

  /**
   * Subscribe to login, logout, and token rotation.
   * @param listener - called after every published change.
   * @returns the unsubscribe that removes this listener.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * The published service face, bound to this runtime.
   * @returns the `ctx.honglingAuth` value other plugins' host halves read.
   */
  service(): HonglingAuthService {
    return {
      getStatus: () => this.getStatus(),
      getToken: () => this.getToken(),
      refresh: () => this.refresh(),
      onChange: listener => this.onChange(listener),
    }
  }

  /**
   * Current token, silently renewed first when it is inside the refresh margin.
   * @returns the id_token to attach to an upstream call, or undefined when signed out.
   */
  async getToken(): Promise<string | undefined> {
    const current = this.current
    if (current === null) return undefined
    if (this.isExpiring(current) && this.hasRefreshToken(current)) await this.refresh()
    return this.current?.idToken
  }

  /**
   * Progress of the login flow, reported as `done` once a login exists.
   * @returns the progress line the browser polls while signing in.
   */
  progress(): LoginProgress {
    return this.sessions.progress(this.current !== null)
  }

  /**
   * Open the loopback receiver and send the operator to the IdP relay.
   * @returns whether a login started, with the URL the operator can open by hand.
   */
  async login(): Promise<{ started: boolean; loginUrl: string }> {
    return this.sessions.start(this.internals.config.backendUrl, this.internals.config.redirectPort)
  }

  /** Abandon an in-flight login. */
  cancelLogin(): void {
    this.sessions.cancel()
  }

  /** Forget the token, on disk and in memory. */
  async logout(): Promise<void> {
    this.current = null
    await clearTokenSet(this.internals.file)
    this.notify()
  }

  /**
   * Inject a development login, mirroring the backend's `AUTH_MODE=dev`
   * token shape. Guarded by config, never by the caller.
   * @param payload - the operator name and optional roles.
   * @returns whether the injected login was stored.
   * @throws AuthError when development injection is disabled or the name is empty.
   */
  async devLogin(payload: Record<string, unknown>): Promise<{ ok: boolean }> {
    if (!this.internals.config.devAuth) {
      throw new AuthError('DEV_AUTH_DISABLED', '开发注入未启用（config.devAuth）')
    }
    const username = typeof payload.username === 'string' ? payload.username.trim() : ''
    if (username === '') throw new AuthError('BAD_USERNAME', 'username 不能为空')
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String).filter(role => role !== '') : []
    const next: TokenSet = {
      version: 1,
      iss: 'dev',
      idToken: 'dev:' + username + (roles.length === 0 ? '' : ':' + roles.join(',')),
      profile: { username, displayName: username, roles },
      savedAt: this.now(),
    }
    this.current = next
    await saveTokenSet(this.internals.file, next)
    this.notify()
    return { ok: true }
  }

  /**
   * Serve one RPC endpoint.
   * @param endpoint - the endpoint key.
   * @param payload - the endpoint's payload.
   * @returns the endpoint's result value.
   * @throws AuthError when the endpoint is unknown.
   */
  async dispatch(endpoint: AuthRpcEndpoint, payload: Record<string, unknown>): Promise<unknown> {
    switch (endpoint) {
      case 'auth.getStatus':
        return this.getStatus()
      case 'auth.login':
        return this.login()
      case 'auth.getLoginProgress':
        return this.progress()
      case 'auth.cancelLogin': {
        this.cancelLogin()
        return { ok: true }
      }
      case 'auth.logout': {
        await this.logout()
        return { ok: true }
      }
      case 'auth.devLogin':
        return this.devLogin(payload)
      default:
        throw new AuthError('UNKNOWN_ENDPOINT', '未知端点：' + String(endpoint))
    }
  }

  /** Verify and persist a token the callback relayed, then publish the change. */
  private async completeLogin(idToken: string, payload: Record<string, unknown>): Promise<CompletionResult> {
    const refreshToken = typeof payload.refresh_token === 'string' && payload.refresh_token !== ''
      ? payload.refresh_token
      : undefined
    let next: TokenSet
    try {
      next = await this.buildTokenSet(idToken, refreshToken)
    } catch (error) {
      return { ok: false, message: messageOf(error) }
    }
    this.current = next
    await saveTokenSet(this.internals.file, next)
    this.notify()
    return { ok: true }
  }

  /** Run the shared verify step with this runtime's policy and clock. */
  private buildTokenSet(idToken: string, refreshToken: string | undefined): Promise<TokenSet> {
    return buildTokenSet(idToken, refreshToken, {
      verifyLocal: this.internals.config.verifyLocal,
      resolveJwks: this.jwks,
      logger: this.internals.logger,
      now: this.now,
    })
  }

  /**
   * Exchange the refresh_token through the backend, which holds the client
   * secret this plugin deliberately never has. An `invalid_grant` means the
   * session is over: the token is dropped rather than retried.
   * @returns whether a fresh token was adopted.
   */
  async refresh(): Promise<boolean> {
    const refreshToken = this.current?.refreshToken
    if (refreshToken === undefined || refreshToken === '') return false
    let response: Response
    try {
      response = await this.doFetch(this.internals.config.backendUrl + '/dsh/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
        signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
      })
    } catch (error) {
      this.internals.logger.warn('[hongling-auth] refresh 请求失败：' + messageOf(error))
      return false
    }
    const body = (await response.json().catch(() => ({}))) as RelayResponse
    if (response.status === 401 || body.error === 'invalid_grant') {
      await this.logout()
      this.internals.logger.info('[hongling-auth] refresh_token 已失效，登录态已清除')
      return false
    }
    if (!response.ok || typeof body.id_token !== 'string' || body.id_token === '') {
      this.internals.logger.warn(`[hongling-auth] refresh 失败：HTTP ${String(response.status)}`)
      return false
    }
    try {
      const next = await this.buildTokenSet(body.id_token, body.refresh_token ?? refreshToken)
      // A refreshed token without an `exp` claim falls back to the lifetime
      // the backend reported alongside it.
      if (next.expiresAt === undefined && typeof body.expires_in === 'number') {
        next.expiresAt = this.now() + body.expires_in * 1000
      }
      this.current = next
      await saveTokenSet(this.internals.file, next)
      this.notify()
      return true
    } catch (error) {
      this.internals.logger.warn('[hongling-auth] refresh 后 token 校验失败：' + messageOf(error))
      return false
    }
  }

  /** Whether a stored token is past, or close to, its declared expiry. */
  private isExpiring(tokens: TokenSet): boolean {
    return tokens.expiresAt !== undefined && this.now() > tokens.expiresAt - REFRESH_MARGIN_MS
  }

  /** Whether the stored token can be renewed without the operator. */
  private hasRefreshToken(tokens: TokenSet): boolean {
    return tokens.refreshToken !== undefined && tokens.refreshToken !== ''
  }

  /** Publish a login-state change to every subscriber. */
  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch {
        /* one subscriber's failure must not deny the others their update */
      }
    }
  }
}
