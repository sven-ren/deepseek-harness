/**
 * 虹灵 enterprise SSO account provider for the official account seam.
 *
 * This implements `ctx.deepseekAccount` for the Changhong deployment, so the
 * account menu, the welcome gate, the bottom-left identity label and the model
 * credential path are all the stock ones. It adds no renderer surface of its
 * own, which is what keeps the customization alive across upstream syncs: the
 * only registration is a home patch that disables the official provider row
 * and inserts this one.
 *
 * Two deliberate departures from the official platform provider:
 *
 * - **No authorization-flow registration.** The official provider commits its
 *   grant through `ctx.authorization.begin()`, whose seam only accepts a commit
 *   it saw happen. Nothing else consumes that seam for the account key, so this
 *   provider drives its attempt directly and writes the grant through
 *   `ctx.credentials`. That removes the `NO_FLOW`, `ALREADY_IN_FLIGHT` and
 *   `NOT_COMMITTED` failure classes and the interaction stubs they require.
 * - **No code exchange.** The company relay performs the OIDC exchange on its
 *   own server, because the registered `redirect_uri` belongs to the relay and
 *   the client secret is not ours to hold. We receive an id_token and verify it.
 *
 * @module @deepseek-ai/dsh-hongling-account
 */

import { randomUUID } from 'node:crypto'
import { platform, release } from 'node:os'
import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { DeepSeekAccount, installAccountTaskCancellation, type AccountBonusBatch, type AccountBonusOrderId, type AccountClientMetadata, type AccountDetails, type AccountUserId, type AccountView, type PlatformSession, type SignInAttemptId, type SignInAttemptView } from '@deepseek-ai/dsh-deepseek-account'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Config, requireHttpsUrl, requireOrigin, type Config as ConfigInput } from './config.ts'
import { AuthError, messageOf } from './errors.ts'
import { createJwksResolver, verifyToken, type Identity, type JwksResolver } from './jwt.ts'
import { LoginReceiver, type CompletionResult, type ReceiverLogger } from './login-session.ts'

/** Credential slot for this provider's own grant; never the platform provider's. */
const KEY = credentialKey('hongling-account', 'default')

/**
 * Stored grant.
 *
 * The profile fields are stored alongside the token so the account menu paints
 * the employee name without a network round trip on every mount. `issuer` and
 * `subject` are kept because they are the only parts a later environment check
 * can compare against configuration without re-reading the token.
 */
const grant = z.object({
  version: z.literal(1),
  idToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  issuer: z.string(),
  subject: z.string().min(1),
  name: z.string().nullable(),
  contact: z.string().nullable(),
  expiresAt: z.number().int().positive().optional(),
  savedAt: z.number().int().positive(),
})

/** One stored grant, as read back from the credential store. */
type Grant = z.infer<typeof grant>

/** Loops through console so a login failure is visible without a logger service. */
const logger: ReceiverLogger = {
  warn: (...values: unknown[]): void => { console.warn(...values) },
}

/** Phases that mean an attempt is still in flight. */
const ACTIVE_PHASES: readonly SignInAttemptView['phase'][] = ['initializing', 'waiting-browser', 'exchanging', 'committing']

/** One in-flight login attempt and the machinery that settles it. */
interface Attempt {
  view: SignInAttemptView
  /** Aborted by cancellation and by the attempt deadline alike. */
  controller: AbortController
  /** Resolves when the attempt reaches a terminal phase; never rejects. */
  done: Promise<void>
  loginSource: 'web' | 'desktop'
  /** The relayed fragment, resolved by the loopback receiver. */
  payload: Promise<Record<string, unknown>>
  resolvePayload: (payload: Record<string, unknown>) => void
  rejectPayload: (error: unknown) => void
  /** What the landing page renders; settled in the attempt's `finally`. */
  completion: Promise<CompletionResult>
  settleCompletion: (result: CompletionResult) => void
  /** Distinct from cancellation, so a deadline failure reports `expired`. */
  timedOut: boolean
  receiver?: LoginReceiver | undefined
}

/**
 * The 虹灵 account implementation.
 *
 * Owns login state and one opaque stored grant, and answers every other seam
 * question from that grant rather than from a server query: the deployment has
 * no wallet, no bonus campaign and no embedded platform document.
 */
export class HonglingAccount extends DeepSeekAccount {
  static inject = ['credentials']
  static Config = Config
  private readonly brokerOrigin: string
  private readonly issuer: string
  private readonly jwksUri: string
  private readonly inferenceOrigin: string
  private readonly usageUrl: string
  private readonly topUpUrl: string
  private readonly verifyLocal: boolean
  private readonly callbackPort: number
  private readonly attemptTimeout: number
  private readonly jwks: JwksResolver
  private readonly listeners = new Set<() => void>()
  private attempt: Attempt | undefined
  private closed = false
  private removing: Promise<AccountView> | undefined

  /** @param ctx - Host with a credentials service. @param config - deployment origins and deadlines. */
  constructor(ctx: Context, config: ConfigInput = {}) {
    super(ctx)
    installAccountTaskCancellation(ctx)
    const resolved = Config(config)
    this.brokerOrigin = requireOrigin(resolved.brokerOrigin, 'brokerOrigin')
    this.inferenceOrigin = requireOrigin(resolved.inferenceOrigin, 'inferenceOrigin')
    this.jwksUri = requireHttpsUrl(resolved.jwksUri, 'jwksUri')
    this.usageUrl = requireHttpsUrl(resolved.usageUrl, 'usageUrl')
    this.topUpUrl = requireHttpsUrl(resolved.topUpUrl, 'topUpUrl')
    this.issuer = resolved.issuer.trim()
    if (this.issuer !== '') requireHttpsUrl(this.issuer, 'issuer')
    this.verifyLocal = resolved.verifyLocal
    this.callbackPort = resolved.callbackPort
    this.attemptTimeout = resolved.attemptTimeoutMs
    this.jwks = createJwksResolver(this.jwksUri)
    // A grant written by this provider wakes the account stream, and one written
    // by another process on the same home does the same.
    ctx.on('credentials/record-updated', (key) => {
      if (key === KEY) this.changed()
    })
    ctx.effect(() => async () => {
      this.closed = true
      const active = this.attempt
      if (active !== undefined) {
        if (active.view.phase !== 'committing') active.controller.abort()
        await active.done
      }
      await this.removing
      this.changed()
    }, 'account: active attempt lifetime')
  }

  async [Service.init](): Promise<void> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return
    if (record.kind !== 'grant') throw new AuthError('storage', '本地凭据类型非法')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new AuthError('storage', '本地凭据格式非法')
    if (this.issuer === '' || !this.issuerMismatch(parsed.data.issuer)) return
    await this.ctx.credentials.deleteRecord(KEY)
    console.info('[hongling-account] stored grant discarded', { reason: 'issuer-mismatch' })
  }

  override async getState(): Promise<AccountView> {
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record !== undefined && (record.kind !== 'grant' || !grant.safeParse(record.payload).success)) {
      throw new AuthError('storage', '本地凭据格式非法')
    }
    const attempt = this.attempt?.view ?? null
    return {
      status: record === undefined ? 'signed-out' : 'credential-stored',
      // Credential removal can notify watchers before sign-out finishes clearing the attempt.
      attempt: record === undefined && attempt?.phase === 'succeeded' ? null : attempt,
      links: { usageUrl: this.usageUrl, topUpUrl: this.topUpUrl },
    }
  }

  /**
   * Answer the employee identity from the stored grant.
   *
   * No request is made: the name, contact and subject were captured from the
   * verified id_token at login time, so the account menu paints immediately and
   * an unreachable profile endpoint cannot blank the identity.
   */
  override async getProfile(_client: AccountClientMetadata): Promise<AccountDetails['profile'] | null> {
    const stored = await this.readCurrentGrant()
    if (stored === null) return null
    return {
      status: 'ready',
      value: {
        id: stored.subject as AccountUserId,
        name: stored.name,
        contact: stored.contact,
      },
    }
  }

  /**
   * Report an empty wallet for a signed-in account.
   *
   * The deployment has no recharge concept. An empty ready result renders as
   * "no wallets" rather than as a failure, which is the truthful reading; the
   * `null` reserved for signed-out would make the UI report a session problem.
   */
  override async getBalance(_client: AccountClientMetadata): Promise<AccountDetails['balance'] | null> {
    const stored = await this.readCurrentGrant()
    return stored === null ? null : { status: 'ready', value: [], bonusWallets: [] }
  }

  /** The deployment runs no bonus campaign, so there is never a pending notice. */
  override getUnnotifiedBonuses(_client: AccountClientMetadata): Promise<AccountBonusBatch | null> {
    return Promise.resolve(null)
  }

  /** No notice can exist, so no acknowledgement is ever recorded. */
  override ackBonusNotified(_accountId: AccountUserId, _orderId: AccountBonusOrderId,
    _client: AccountClientMetadata): Promise<boolean> {
    return Promise.resolve(false)
  }

  override async startSignIn(_client: AccountClientMetadata, callbackOrigin: string,
    loginSource: 'web' | 'desktop'): Promise<AccountView> {
    if (this.removing !== undefined) await this.removing
    // The relay's contract takes a loopback port, not the host's visible origin,
    // so the origin is validated for shape and then discarded.
    requireOrigin(callbackOrigin, 'callbackOrigin')
    if (this.closed) throw new AuthError('protocol', '账号服务已关闭')
    if (this.attempt !== undefined && ACTIVE_PHASES.includes(this.attempt.view.phase)) return this.getState()
    const previous = this.attempt
    if (previous !== undefined) {
      await previous.done
      // Disposal can close the provider while the previous attempt settles.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (this.closed) throw new AuthError('protocol', '账号服务已关闭')
      if (this.attempt !== previous) return this.getState()
    }
    const payload = Promise.withResolvers<Record<string, unknown>>()
    const completion = Promise.withResolvers<CompletionResult>()
    // The receiver may observe its own cancellation before the attempt does.
    void payload.promise.catch(() => undefined)
    const attempt: Attempt = {
      loginSource,
      view: { id: randomUUID() as SignInAttemptId, phase: 'initializing' },
      controller: new AbortController(),
      done: Promise.resolve(),
      payload: payload.promise,
      resolvePayload: payload.resolve,
      rejectPayload: payload.reject,
      completion: completion.promise,
      settleCompletion: completion.resolve,
      timedOut: false,
    }
    this.attempt = attempt
    attempt.done = this.runAttempt(attempt)
    this.changed()
    return this.getState()
  }

  override async cancelSignIn(id: SignInAttemptId): Promise<AccountView> {
    const attempt = this.attempt
    if (attempt?.view.id === id) {
      // A committing attempt owns a grant that already exists; let it settle.
      if (attempt.view.phase !== 'committing') attempt.controller.abort()
      await attempt.done
    }
    return this.getState()
  }

  override signOut(_client: AccountClientMetadata): Promise<AccountView> {
    this.removing ??= (async () => {
      if (this.closed) throw new AuthError('protocol', '账号服务已关闭')
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const record = await this.ctx.credentials.readRecord(KEY)
      if (record !== undefined) {
        if (record.kind !== 'grant') throw new AuthError('storage', '本地凭据类型非法')
        if (!grant.safeParse(record.payload).success) throw new AuthError('storage', '本地凭据格式非法')
        // Removed locally and only locally: the deployment exposes no revoke
        // endpoint, and the relay re-verifies every request it proxies anyway.
        await this.ctx.credentials.deleteRecord(KEY)
      }
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    return this.removing
  }

  override async *watch(signal: AbortSignal): AsyncIterable<AccountView> {
    let dirty = true
    let wake: (() => void) | undefined
    const changed = (): void => { dirty = true; wake?.() }
    this.listeners.add(changed)
    signal.addEventListener('abort', changed, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        if (dirty) { dirty = false; yield await this.getState(); continue }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      this.listeners.delete(changed)
      signal.removeEventListener('abort', changed)
    }
  }

  /**
   * Hand the account token to the inference origin only.
   *
   * Expiry is not checked here: the token is the credential the company gateway
   * validates, and letting it answer 401 is what makes the expiry path
   * observable, which in turn lets {@link rejectToken} clear the grant and
   * return the operator to the login gate.
   */
  override async resolveToken(url: string): Promise<string | undefined> {
    if (this.closed || this.removing !== undefined) return undefined
    const destination = new URL(url)
    if (destination.origin !== this.inferenceOrigin || destination.username || destination.password) return undefined
    return (await this.readCurrentGrant())?.idToken
  }

  override async rejectToken(token: string): Promise<void> {
    const stored = await this.readCurrentGrant()
    if (stored?.idToken !== token) return
    await this.expireCredential(token)
  }

  /** No platform document is embedded for this deployment. */
  override getPlatformSession(): Promise<PlatformSession | null> {
    return Promise.resolve(null)
  }

  /** Account identity without creating a device; this provider registers none. */
  override async getDeviceIdentity(): Promise<{ deviceId?: string; userId?: AccountUserId; osVersion: string }> {
    const stored = await this.readCurrentGrant()
    return {
      ...stored === null ? {} : { userId: stored.subject as AccountUserId },
      osVersion: `${platform()} ${release()}`,
    }
  }

  /**
   * Run one attempt to a terminal phase.
   *
   * Never rejects: every outcome is a phase on the attempt and a message for the
   * landing page, so no caller has to attach a rejection handler to observe a
   * failure.
   * @param attempt - the attempt this provider just published.
   */
  private async runAttempt(attempt: Attempt): Promise<void> {
    const deadline = new AbortController()
    const timer = setTimeout(() => { attempt.timedOut = true; deadline.abort() }, this.attemptTimeout)
    const signal = AbortSignal.any([attempt.controller.signal, deadline.signal])
    const abort = (): void => { attempt.rejectPayload(new AuthError('expired', '登录尝试已结束')) }
    signal.addEventListener('abort', abort, { once: true })
    const receiver = new LoginReceiver({
      logger,
      onPayload: async (payload) => {
        attempt.resolvePayload(payload)
        // Reply only once the host has settled, so the page never claims success
        // before a credential exists.
        return await attempt.completion
      },
    })
    let result: CompletionResult = { ok: false, message: '登录未完成，请回到 DSH 重试。' }
    try {
      const port = await receiver.listen(this.callbackPort)
      attempt.receiver = receiver
      const authorizeUrl = new URL('/dsh/login', this.brokerOrigin)
      authorizeUrl.searchParams.set('port', String(port))
      this.update(attempt, {
        phase: 'waiting-browser',
        authorizeUrl: authorizeUrl.href,
        expiresAt: Date.now() + this.attemptTimeout,
      })
      const payload = await attempt.payload
      this.update(attempt, { phase: 'exchanging' })
      const { idToken, identity } = await this.verify(payload)
      this.update(attempt, { phase: 'committing' })
      await this.commit(idToken, payload, identity)
      console.info('[hongling-account] signed in', {
        issuer: identity.issuer, subject: identity.subject, name: identity.name,
        expiresAt: identity.expiresAt === undefined ? null : new Date(identity.expiresAt).toISOString(),
      })
      this.update(attempt, { phase: 'succeeded' })
      result = { ok: true, message: '登录成功，可以关闭本页并回到 DSH。' }
    } catch (error) {
      /* v8 ignore next -- every step an attempt runs rejects with AuthError; this only codes a failure that escapes without one. */
      const code = error instanceof AuthError ? error.code : 'protocol'
      const cancelled = !attempt.timedOut && attempt.controller.signal.aborted
      if (!cancelled) {
        console.info('[hongling-account] sign-in failed', { errorCode: code, message: messageOf(error) })
      }
      this.update(attempt, cancelled ? { phase: 'cancelled' } : {
        phase: code === 'expired' ? 'expired' : 'failed',
        errorCode: code,
      })
      result = { ok: false, message: cancelled ? '登录已取消。' : '登录失败：' + messageOf(error) }
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      attempt.receiver = undefined
      // Settle the landing page's reply before the receiver drops the
      // connection carrying it, or a finished login reads as a local failure.
      attempt.settleCompletion(result)
      await receiver.close()
      this.changed()
    }
  }

  /**
   * Validate one relayed payload into an identity.
   * @param payload - the fragment the landing page posted back.
   * @returns the verified token and the identity it names.
   * @throws AuthError on a relayed error, a missing token, or failed verification.
   */
  private async verify(payload: Record<string, unknown>): Promise<{ idToken: string; identity: Identity }> {
    const relayed = typeof payload.error === 'string' ? payload.error.trim() : ''
    if (relayed !== '') throw new AuthError('protocol', '登录被拒绝：' + relayed)
    if (typeof payload.token !== 'string' || payload.token === '') {
      throw new AuthError('protocol', '回调缺少 token')
    }
    const idToken = payload.token
    const identity = await verifyToken(idToken, {
      verifyLocal: this.verifyLocal,
      resolveJwks: this.jwks,
      logger,
      expectedIssuer: this.issuer,
    })
    return { idToken, identity }
  }

  /**
   * Write the grant for a verified identity.
   * @param idToken - the verified token, which becomes the model credential.
   * @param payload - relayed fragment, read for a refresh token.
   * @param identity - verified identity to persist alongside the token.
   * @throws AuthError when the credential store rejects the write.
   */
  private async commit(idToken: string, payload: Record<string, unknown>, identity: Identity): Promise<void> {
    const refreshToken = typeof payload.refresh_token === 'string' && payload.refresh_token !== ''
      ? payload.refresh_token
      : undefined
    const record: Grant = {
      version: 1,
      idToken,
      ...refreshToken === undefined ? {} : { refreshToken },
      issuer: identity.issuer,
      subject: identity.subject,
      name: identity.name,
      contact: identity.contact,
      ...identity.expiresAt === undefined ? {} : { expiresAt: identity.expiresAt },
      savedAt: Date.now(),
    }
    try {
      const written = await this.ctx.credentials.modifyRecord(KEY, () => Promise.resolve({
        kind: 'grant' as const, payload: record,
      }))
      if (written?.kind !== 'grant') throw new AuthError('storage', '凭据未写入')
    } catch (error) {
      if (error instanceof AuthError) throw error
      throw new AuthError('storage', '凭据写入失败：' + messageOf(error))
    }
  }

  /**
   * Drop a grant the server has rejected, and announce it in the order the
   * Desktop expects: the expiry notice first, then sign-out.
   * @param token - the rejected token, compared against the stored one.
   */
  private async expireCredential(token: string): Promise<void> {
    this.removing ??= (async () => {
      if (this.attempt !== undefined) await this.cancelSignIn(this.attempt.view.id)
      const record = await this.ctx.credentials.readRecord(KEY)
      if (this.closed || record?.kind !== 'grant') return this.getState()
      const parsed = grant.safeParse(record.payload)
      if (!parsed.success || parsed.data.idToken !== token) return this.getState()
      await this.ctx.credentials.deleteRecord(KEY)
      this.ctx.emit('deepseek-account/session-expired')
      this.attempt = undefined
      this.ctx.emit('deepseek-account/signed-out')
      this.changed()
      return this.getState()
    })().finally(() => { this.removing = undefined })
    await this.removing
  }

  /**
   * Read the stored grant, rejecting anything this environment must not use.
   * @returns the grant, or null while signed out.
   * @throws AuthError when the stored record is malformed or issued elsewhere.
   */
  private async readCurrentGrant(): Promise<Grant | null> {
    if (this.closed) return null
    const record = await this.ctx.credentials.readRecord(KEY)
    if (record === undefined) return null
    if (record.kind !== 'grant') throw new AuthError('storage', '本地凭据类型非法')
    const parsed = grant.safeParse(record.payload)
    if (!parsed.success) throw new AuthError('storage', '本地凭据格式非法')
    if (this.issuerMismatch(parsed.data.issuer)) throw new AuthError('protocol', '本地凭据来自其他环境')
    return parsed.data
  }

  /**
   * Whether a stored issuer contradicts the configured pin.
   * @param stored - issuer recorded with the grant.
   * @returns whether the grant must be refused; always false without a pin.
   */
  private issuerMismatch(stored: string): boolean {
    if (this.issuer === '') return false
    return stripSlash(stored) !== stripSlash(this.issuer)
  }

  private changed(): void { for (const listener of this.listeners) listener() }

  /** Replace the attempt view, dropping a stale `authorizeUrl` on every change. */
  private update(attempt: Attempt, value: Partial<SignInAttemptView>): void {
    const { authorizeUrl: _url, ...rest } = attempt.view
    attempt.view = { ...rest, ...value }
    this.changed()
  }
}
export default HonglingAccount

/** Compare issuers without caring about one trailing slash. */
function stripSlash(value: string): string {
  return value.replace(/\/+$/u, '')
}
