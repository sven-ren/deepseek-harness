/**
 * The provider against the seam it implements: a real cordis Context, a
 * scripted credential store, and the real loopback receiver for the login legs,
 * so the relay's actual contract — a port, a landing page, one fragment post —
 * is what these tests exercise.
 */

import { createSign, generateKeyPairSync } from 'node:crypto'
import { request as httpRequest, type ClientRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer as createNetServer } from 'node:net'
import { platform, release } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type {
  AccountBonusOrderId, AccountClientMetadata, AccountUserId, SignInAttemptView, SignInErrorCode,
} from '@deepseek-ai/dsh-deepseek-account'
import { AuthError } from '../src/errors.ts'
import { HonglingAccount } from '../src/index.ts'
import type { Config as ConfigInput } from '../src/config.ts'
import { CALLBACK_PATH, COMPLETE_PATH } from '../src/login-session.ts'

/** Fetch bound before any test stubs the global one, for this file's own requests. */
const realFetch = globalThis.fetch

const CLIENT: AccountClientMetadata = { version: '0.2.1', locale: 'zh_CN', timezoneOffsetSeconds: 28_800 }
const KEY = credentialKey('hongling-account', 'default')
const IDP = 'https://account-xc.changhong.com'
const DEPLOYMENT = {
  brokerOrigin: 'https://agent-sphere.changhong.com',
  jwksUri: `${IDP}/keys`,
  inferenceOrigin: 'https://maas.changhong.com',
  usageUrl: 'https://agent-sphere.changhong.com/usage',
  topUpUrl: 'https://agent-sphere.changhong.com/top_up',
}
const LINKS = { usageUrl: DEPLOYMENT.usageUrl, topUpUrl: DEPLOYMENT.topUpUrl }

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', key_ops: ['verify'] }
const claims = { iss: IDP, sub: 'E9', name: '张三', email: 'zhang@example.test', exp: 4_102_444_800 }
const idToken = (() => {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'rsa-1' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${head}.${body}.${createSign('SHA256').update(`${head}.${body}`).sign(rsa.privateKey).toString('base64url')}`
})()

/**
 * A token that parses and carries the deployment's claims; its signature is
 * never checked.
 * @param overrides - claim overrides.
 * @returns the serialized token.
 */
function unsignedToken(overrides: Record<string, unknown> = {}): string {
  const head = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString('base64url')
  return `${head}.${body}.${Buffer.alloc(1).toString('base64url')}`
}

/** One stored grant in this provider's own format. @param overrides - payload fields to replace. @returns the record. */
function storedGrant(overrides: Record<string, unknown> = {}): CredentialRecord {
  return {
    kind: 'grant',
    payload: {
      version: 1, idToken: 'stored-token', issuer: IDP, subject: 'E9',
      name: '张三', contact: 'zhang@example.test', savedAt: 1_700_000_000_000, ...overrides,
    },
  }
}

/** Scripted stand-in for the credentials service. */
class Store {
  record: CredentialRecord | undefined
  /** Answers for upcoming reads, consumed in order; an explicit `undefined` answers signed-out. */
  queued: Array<CredentialRecord | undefined> = []
  /** Keys every record operation was called with, in order. */
  keys: CredentialKey[] = []
  writes: Array<CredentialRecord | undefined> = []
  deletions = 0
  /** When true, `modifyRecord` declines the write instead of committing it. */
  declineWrite = false
  /** When set, `modifyRecord` rejects with it. */
  writeFailure: Error | undefined

  /** @param record - the record present at load time, if any. */
  constructor(record?: CredentialRecord) { this.record = record }
  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    this.keys.push(key)
    return this.queued.length > 0 ? this.queued.shift() : this.record
  }
  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    this.keys.push(key)
    if (this.writeFailure !== undefined) throw this.writeFailure
    if (this.declineWrite) { this.writes.push(undefined); return undefined }
    const next = await mutate(this.record)
    this.record = next
    this.writes.push(next)
    return next
  }
  async deleteRecord(key: CredentialKey): Promise<void> {
    this.keys.push(key)
    this.record = undefined
    this.deletions += 1
  }
}

/** Phases an attempt never leaves. */
const TERMINAL: readonly SignInAttemptView['phase'][] = ['succeeded', 'cancelled', 'expired', 'failed']

const scopes: Array<{ dispose(): Promise<void> }> = []
const watches: AbortController[] = []
let logs: string[] = []

beforeEach(() => {
  logs = []
  // Structured lines are rendered as JSON so a test can assert what an operator
  // would actually read in the log.
  vi.spyOn(console, 'info').mockImplementation((...values: unknown[]) => {
    logs.push(values.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join(' '))
  })
})

afterEach(async () => {
  for (const controller of watches.splice(0)) controller.abort()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  while (scopes.length > 0) await scopes.pop()!.dispose()
})

interface Harness {
  readonly ctx: Context
  readonly account: HonglingAccount
  readonly store: Store
  readonly events: string[]
  dispose(): Promise<void>
  /** Wait for the current attempt to reach a phase. */
  watchFor(phase: SignInAttemptView['phase']): Promise<SignInAttemptView>
  /** The relay URL of the attempt that reached `waiting-browser`, with its bound port. */
  relay(): Promise<{ url: URL; port: number }>
  /** Post one fragment to the attempt's loopback receiver, as the landing page does. */
  complete(body: Record<string, unknown>): Promise<{ status: number; result: { ok: boolean; message: string } }>
}

/**
 * Register the provider on a fresh context.
 * @param config - deployment overrides.
 * @param stored - record already present when the provider loads.
 * @returns the harness, or the error the provider refused to load with.
 */
async function fixture(config: Partial<ConfigInput> = {}, stored?: CredentialRecord): Promise<Harness | Error> {
  const store = new Store(stored)
  const ctx = new Context()
  ctx.provide('credentials', store as never)
  const events: string[] = []
  ctx.on('deepseek-account/signed-out', () => { events.push('signed-out') })
  ctx.on('deepseek-account/session-expired', () => { events.push('session-expired') })
  const scope = ctx.plugin(HonglingAccount, { ...DEPLOYMENT, verifyLocal: false, ...config })
  scopes.push(scope)
  const failure: unknown = await scope.then(() => undefined, (error: unknown) => error)
  if (failure !== undefined) return failure as Error
  const account = ctx.deepseekAccount as HonglingAccount
  const watchFor = async (phase: SignInAttemptView['phase']): Promise<SignInAttemptView> => {
    const controller = new AbortController()
    watches.push(controller)
    for await (const state of account.watch(controller.signal)) {
      const attempt = state.attempt
      if (attempt === null) continue
      if (attempt.phase === phase) return attempt
      // A terminal phase that is not the awaited one never changes again.
      if (TERMINAL.includes(attempt.phase)) {
        throw new Error(`the attempt reached ${attempt.phase} (${attempt.errorCode ?? 'no code'}) instead of ${phase}`)
      }
    }
    throw new Error(`the watch ended before the attempt reached ${phase}`)
  }
  const relay = async (): Promise<{ url: URL; port: number }> => {
    const attempt = await watchFor('waiting-browser')
    const url = new URL(attempt.authorizeUrl ?? '')
    return { url, port: Number(url.searchParams.get('port')) }
  }
  return {
    ctx, account, store, events, watchFor, relay,
    dispose: async () => { await scope.dispose() },
    complete: async (body) => {
      const { port } = await relay()
      const response = await realFetch(`http://127.0.0.1:${port}${COMPLETE_PATH}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, result: await response.json() as { ok: boolean; message: string } }
    },
  }
}

/**
 * Register the provider and require that it loaded.
 * @param config - deployment overrides.
 * @param stored - record present at load.
 * @returns the harness.
 */
async function ready(config: Partial<ConfigInput> = {}, stored?: CredentialRecord): Promise<Harness> {
  const result = await fixture(config, stored)
  expect(result).not.toBeInstanceOf(Error)
  return result as Harness
}

/** Run a promise expected to fail, and return the failure. @param promise - the call under test. @returns what it rejected with. */
async function failureOf(promise: Promise<unknown>): Promise<AuthError> {
  const error: unknown = await promise.then(() => undefined, (value: unknown) => value)
  expect(error).toBeInstanceOf(AuthError)
  return error as AuthError
}

/**
 * Assert a rejection carries the published code and the operator message.
 * @param promise - the call under test.
 * @param code - expected code.
 * @param message - expected message.
 */
async function refuses(promise: Promise<unknown>, code: SignInErrorCode, message: string): Promise<void> {
  const error = await failureOf(promise)
  expect(error.code).toBe(code)
  expect(error.message).toBe(message)
}

/** Every account read that consults the stored grant, as thunks. @param harness - the harness under test. @returns the calls. */
function callsOn(harness: Harness): Array<() => Promise<unknown>> {
  return [
    () => harness.account.getState(),
    () => harness.account.getProfile(CLIENT),
    () => harness.account.getBalance(CLIENT),
    () => harness.account.getDeviceIdentity(),
    () => harness.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/x`),
    () => harness.account.signOut(CLIENT),
  ]
}

/** A port already held by a foreign socket, so the receiver cannot bind it. */
async function occupiedPort(): Promise<number> {
  const server = createNetServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  scopes.push({ dispose: async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) } })
  return (server.address() as AddressInfo).port
}

/** Let every pending microtask and one macrotask run, so a watcher's wake has landed. */
function tick(): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, 0) })
}

/**
 * A landing page that sent its headers and half a fragment, and never finishes
 * it. The receiver owes such a connection a reply, so its teardown waits — which
 * is how a test below holds an attempt's `done` open while the provider closes
 * underneath it.
 * @param port - the attempt's loopback port.
 * @returns the open request, once the receiver has read its partial body.
 */
async function stalledPost(port: number): Promise<ClientRequest> {
  const stalled = httpRequest({
    host: '127.0.0.1', port, path: COMPLETE_PATH, method: 'POST',
    headers: { 'content-type': 'application/json' },
  })
  stalled.on('error', () => {})
  // The request is only holding the receiver open once it has arrived, so wait
  // for the connection and then for the server's own later turns to read it.
  await new Promise<void>((resolve) => {
    stalled.once('socket', (socket) => {
      if (socket.connecting) socket.once('connect', resolve)
      else resolve()
    })
  })
  stalled.write('{"token":"')
  await tick()
  await tick()
  return stalled
}

/** Whether a promise is still pending after one macrotask. @param promise - the promise to watch. @returns its state. */
async function heldOpen(promise: Promise<unknown>): Promise<'settled' | 'pending'> {
  return Promise.race([
    promise.then(() => 'settled' as const, () => 'settled' as const),
    tick().then(() => 'pending' as const),
  ])
}

it('starts signed out, withholding the employee identity', async () => {
  const h = await ready()
  expect(await h.account.getState()).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
  expect(await h.account.getProfile(CLIENT)).toBeNull()
  expect(await h.account.getBalance(CLIENT)).toBeNull()
  expect(await h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/v1/messages`)).toBeUndefined()
  expect(await h.account.getDeviceIdentity()).toEqual({ osVersion: `${platform()} ${release()}` })
  // Every read went to this provider's own slot, never the official one.
  expect(new Set(h.store.keys)).toEqual(new Set([KEY]))
})

it('answers identity, wallet, device and grant-only capabilities from the stored grant', async () => {
  const h = await ready({}, storedGrant())
  expect(await h.account.getState()).toEqual({ status: 'credential-stored', attempt: null, links: LINKS })
  expect(await h.account.getProfile(CLIENT))
    .toEqual({ status: 'ready', value: { id: 'E9', name: '张三', contact: 'zhang@example.test' } })
  expect(await h.account.getBalance(CLIENT)).toEqual({ status: 'ready', value: [], bonusWallets: [] })
  expect(await h.account.getDeviceIdentity()).toEqual({ userId: 'E9', osVersion: `${platform()} ${release()}` })
  expect(await h.account.getUnnotifiedBonuses(CLIENT)).toBeNull()
  expect(await h.account.ackBonusNotified('E9' as AccountUserId, 'order-1' as AccountBonusOrderId, CLIENT)).toBe(false)
  expect(await h.account.getPlatformSession()).toBeNull()
  expect(new Set(h.store.keys)).toEqual(new Set([KEY]))
})

it('refuses every read of a record that changed into another kind', async () => {
  const h = await ready()
  const foreign = { kind: 'reference', payload: { key: 'secret' } } as CredentialRecord
  // The state snapshot reports one storage fault for both a foreign kind and a
  // malformed payload; every other read names the kind it cannot use.
  h.store.queued = [foreign]
  await refuses(h.account.getState(), 'storage', '本地凭据格式非法')
  for (const call of callsOn(h).slice(1)) {
    h.store.queued = [foreign]
    await refuses(call(), 'storage', '本地凭据类型非法')
  }
})

it('refuses every read of a grant that changed into a shape it cannot read', async () => {
  const h = await ready()
  const broken: CredentialRecord = { kind: 'grant', payload: { version: 2 } }
  for (const call of callsOn(h)) {
    h.store.queued = [broken]
    await refuses(call(), 'storage', '本地凭据格式非法')
  }
})

it('refuses a grant that changed to another environment mid-session', async () => {
  const h = await ready({ issuer: IDP })
  const foreign = storedGrant({ issuer: 'https://other.test' })
  for (const call of [() => h.account.getProfile(CLIENT), () => h.account.getBalance(CLIENT),
    () => h.account.getDeviceIdentity(), () => h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/x`)]) {
    h.store.queued = [foreign]
    await refuses(call(), 'protocol', '本地凭据来自其他环境')
  }
  // The same issuer written with trailing slashes is still the configured one.
  h.store.queued = [storedGrant({ issuer: `${IDP}//` })]
  expect(await h.account.getProfile(CLIENT)).toMatchObject({ status: 'ready', value: { id: 'E9' } })
})

it('keeps a stored grant at load when no issuer is pinned', async () => {
  const h = await ready({}, storedGrant({ issuer: 'https://whatever.test' }))
  expect(await h.account.getState()).toMatchObject({ status: 'credential-stored' })
  expect(h.store.deletions).toBe(0)
})

it('keeps a stored grant at load whose issuer matches the pin', async () => {
  const h = await ready({ issuer: IDP }, storedGrant())
  expect(await h.account.getState()).toMatchObject({ status: 'credential-stored' })
  expect(h.store.deletions).toBe(0)
  expect(logs).toEqual([])
})

it('discards a stored grant from another environment at load', async () => {
  const h = await ready({ issuer: IDP }, storedGrant({ issuer: 'https://other.test' }))
  expect(await h.account.getState()).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
  expect(h.store.record).toBeUndefined()
  expect(h.store.deletions).toBe(1)
  expect(logs.join('\n')).toContain('[hongling-account] stored grant discarded')
})

it('refuses to load a stored record it cannot read', async () => {
  const wrongKind = await fixture({}, { kind: 'reference', payload: {} } as CredentialRecord)
  expect(wrongKind).toBeInstanceOf(AuthError)
  expect((wrongKind as AuthError).code).toBe('storage')
  expect((wrongKind as AuthError).message).toBe('本地凭据类型非法')
  const malformed = await fixture({}, { kind: 'grant', payload: { version: 1 } })
  expect(malformed).toBeInstanceOf(AuthError)
  expect((malformed as AuthError).message).toBe('本地凭据格式非法')
})

it('refuses a deployment configuration it cannot serve', async () => {
  for (const config of [
    { brokerOrigin: 'https://agent-sphere.changhong.com/path' },
    { inferenceOrigin: 'ftp://maas.changhong.com' },
    { jwksUri: 'http://account-xc.changhong.com/keys' },
    { usageUrl: 'https://user:pw@agent-sphere.changhong.com/usage' },
    { topUpUrl: 'http://agent-sphere.changhong.com/top_up' },
    { issuer: 'http://idp.test' },
  ]) {
    expect(await fixture(config)).toBeInstanceOf(Error)
  }
})

it('signs in through the relay: loopback page, one fragment, verified grant', async () => {
  const jwks = vi.fn(() => Promise.resolve(Response.json({ keys: [jwk] })))
  vi.stubGlobal('fetch', jwks)
  const h = await ready({ issuer: IDP, verifyLocal: true })

  expect(await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')).toEqual({
    status: 'signed-out', links: LINKS,
    attempt: { id: expect.any(String) as string, phase: 'initializing' },
  })

  const { url, port } = await h.relay()
  expect(url.origin).toBe(DEPLOYMENT.brokerOrigin)
  expect(url.pathname).toBe('/dsh/login')
  expect(port).toBeGreaterThan(0)
  expect(url.searchParams.get('port')).toBe(String(port))
  expect((await h.account.getState()).attempt?.expiresAt).toBeGreaterThan(Date.now())

  // The relay lands the browser on the page this provider bound.
  const page = await realFetch(`http://127.0.0.1:${port}${CALLBACK_PATH}`)
  expect(page.status).toBe(200)
  expect(await page.text()).toContain('正在完成登录…')

  // The landing page posts the fragment; its reply waits for the grant.
  expect(await h.complete({ token: idToken, refresh_token: 'rt-1', extra: 'ignored' }))
    .toEqual({ status: 200, result: { ok: true, message: '登录成功，可以关闭本页并回到 DSH。' } })

  const succeeded = await h.watchFor('succeeded')
  expect(succeeded.errorCode).toBeUndefined()
  expect(succeeded.authorizeUrl).toBeUndefined()
  expect(await h.account.getState())
    .toMatchObject({ status: 'credential-stored', attempt: { phase: 'succeeded' } })
  expect(h.store.writes).toEqual([{
    kind: 'grant',
    payload: {
      version: 1, idToken, refreshToken: 'rt-1', issuer: IDP, subject: 'E9', name: '张三',
      contact: 'zhang@example.test', expiresAt: 4_102_444_800_000, savedAt: expect.any(Number) as number,
    },
  }])
  // The employee name the account menu paints comes from the verified token.
  expect(await h.account.getProfile(CLIENT))
    .toEqual({ status: 'ready', value: { id: 'E9', name: '张三', contact: 'zhang@example.test' } })
  expect(await h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/v1/messages`)).toBe(idToken)
  expect(jwks).toHaveBeenCalledWith(`${IDP}/keys`, { signal: expect.any(AbortSignal) as AbortSignal })
  expect(logs.join('\n')).toContain('signed in')
  expect(new Set(h.store.keys)).toEqual(new Set([KEY]))
})

it('hands the account token to the inference origin only', async () => {
  const h = await ready({}, storedGrant({ idToken: 'grant-token' }))
  expect(await h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/v1/messages`)).toBe('grant-token')
  expect(await h.account.resolveToken('https://maas.changhong.com.evil.test/v1/messages')).toBeUndefined()
  expect(await h.account.resolveToken('https://user:pw@maas.changhong.com/v1/messages')).toBeUndefined()
  expect(await h.account.resolveToken('http://maas.changhong.com/v1/messages')).toBeUndefined()
  await h.account.signOut(CLIENT)
  expect(await h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/v1/messages`)).toBeUndefined()
})

it('reports a relayed refusal on the landing page', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect(await h.complete({ error: ' access_denied ' }))
    .toEqual({ status: 400, result: { ok: false, message: '登录失败：登录被拒绝：access_denied' } })
  expect(await h.watchFor('failed')).toMatchObject({ phase: 'failed', errorCode: 'protocol' })
  expect(h.store.writes).toEqual([])
  expect(logs.join('\n')).toContain('sign-in failed')
})

it('refuses a fragment without a token', async () => {
  for (const fragment of [{}, { token: '' }, { error: '   ' }, { token: 42 }]) {
    const h = await ready()
    await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
    expect(await h.complete(fragment))
      .toEqual({ status: 400, result: { ok: false, message: '登录失败：回调缺少 token' } })
    expect(await h.watchFor('failed')).toMatchObject({ phase: 'failed', errorCode: 'protocol' })
  }
})

it('refuses a token this deployment cannot verify', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({
    keys: [{ ...stranger.publicKey.export({ format: 'jwk' }), kid: 'rsa-1' }],
  })))
  const h = await ready({ issuer: IDP, verifyLocal: true })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await h.complete({ token: idToken })).result.message).toBe('登录失败：id_token 签名校验失败')
  expect(await h.watchFor('failed')).toMatchObject({ errorCode: 'protocol' })
  expect(h.store.writes).toEqual([])
})

it('refuses a token issued by another environment', async () => {
  const foreign = (() => {
    const head = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ ...claims, iss: 'https://elsewhere.test' })).toString('base64url')
    return `${head}.${body}.${Buffer.alloc(1).toString('base64url')}`
  })()
  const h = await ready({ issuer: IDP })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await h.complete({ token: foreign })).result.message).toBe('登录失败：id_token 签发方与配置不符：https://elsewhere.test')
  expect(await h.watchFor('failed')).toMatchObject({ errorCode: 'protocol' })
})

it('reports a credential store that refuses the write', async () => {
  const refused = await ready()
  refused.store.declineWrite = true
  await refused.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await refused.complete({ token: unsignedToken() })).result.message).toBe('登录失败：凭据未写入')
  expect(await refused.watchFor('failed')).toMatchObject({ errorCode: 'storage' })

  const failing = await ready()
  failing.store.writeFailure = new Error('disk full')
  await failing.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await failing.complete({ token: unsignedToken() })).result.message).toBe('登录失败：凭据写入失败：disk full')
  expect(await failing.watchFor('failed')).toMatchObject({ errorCode: 'storage' })

  // A failure the store raises in this provider's own vocabulary is published as-is.
  const typed = await ready()
  typed.store.writeFailure = new AuthError('storage', '凭据被另一进程占用')
  await typed.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await typed.complete({ token: unsignedToken() })).result.message).toBe('登录失败：凭据被另一进程占用')
  expect(await typed.watchFor('failed')).toMatchObject({ errorCode: 'storage' })
})

it('fails the attempt when the loopback port is already bound', async () => {
  const h = await ready({ callbackPort: await occupiedPort() })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const failed = await h.watchFor('failed')
  expect(failed.errorCode).toBe('network')
  expect(failed.authorizeUrl).toBeUndefined()
  expect(logs.join('\n')).toContain('sign-in failed')
})

it('expires an attempt nobody completes', async () => {
  const h = await ready({ attemptTimeoutMs: 20 })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect(await h.watchFor('expired')).toMatchObject({ phase: 'expired', errorCode: 'expired' })
  expect(logs.join('\n')).toContain('sign-in failed')
})

it('cancels an attempt on request without reporting a failure', async () => {
  const h = await ready()
  const started = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  const id = started.attempt!.id
  expect(await h.account.cancelSignIn(id)).toMatchObject({ status: 'signed-out', attempt: { phase: 'cancelled' } })
  const cancelled = await h.watchFor('cancelled')
  expect(cancelled.phase).toBe('cancelled')
  expect(cancelled.errorCode).toBeUndefined()
  expect(logs).toEqual([])
  // Cancelling again, or naming an attempt that never existed, leaves the state alone.
  expect((await h.account.cancelSignIn(id)).attempt).toMatchObject({ phase: 'cancelled' })
  expect((await h.account.cancelSignIn('stranger' as never)).attempt).toMatchObject({ phase: 'cancelled' })
})

it('joins the attempt already in flight instead of starting a second one', async () => {
  const h = await ready()
  const first = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const second = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'web')
  expect(second.attempt?.id).toBe(first.attempt?.id)
  await h.account.cancelSignIn(first.attempt!.id)
})

it('starts a fresh attempt after the previous one settled', async () => {
  const h = await ready({ callbackPort: await occupiedPort() })
  const first = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.watchFor('failed')
  const second = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect(second.attempt?.id).not.toBe(first.attempt?.id)
  await h.watchFor('failed')
})

it('lets the later of two racing attempts observe the winner', async () => {
  const h = await ready({ callbackPort: await occupiedPort() })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.watchFor('failed')
  // Both calls read the failed attempt as their predecessor and suspend on it;
  // the first to resume installs a new attempt, which the second must observe.
  const winner = h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const later = h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const first = await winner
  const second = await later
  expect(first.attempt?.id).toBeDefined()
  expect(second.attempt?.id).toBe(first.attempt?.id)
  await h.account.cancelSignIn(first.attempt!.id)
})

it('refuses a callback origin that is not an origin', async () => {
  const h = await ready()
  await expect(h.account.startSignIn(CLIENT, 'https://dsh.example.test/oauth/callback', 'web'))
    .rejects.toThrow('account: callbackOrigin must be an HTTP(S) origin without credentials, path, query or fragment')
})

it('yields a complete snapshot first and then every change', async () => {
  const h = await ready()
  const snapshot = h.account.watch(new AbortController().signal)[Symbol.asyncIterator]()
  expect((await snapshot.next()).value).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
  await snapshot.return?.(undefined)

  const controller = new AbortController()
  const seen: string[] = []
  const loop = (async () => {
    for await (const state of h.account.watch(controller.signal)) seen.push(state.attempt?.phase ?? 'none')
  })()
  const started = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  await h.account.cancelSignIn(started.attempt!.id)
  await h.watchFor('cancelled')
  controller.abort()
  await loop
  expect(seen).not.toContain('none')
  expect(seen).toContain('waiting-browser')
  expect(seen.at(-1)).toBe('cancelled')
})

it('ends a watch that outlives the provider', async () => {
  const h = await ready()
  const controller = new AbortController()
  const loop = (async () => {
    const seen: string[] = []
    for await (const state of h.account.watch(controller.signal)) seen.push(state.status)
    return seen
  })()
  await h.dispose()
  expect(await loop).toEqual(['signed-out'])
})

it('signs out, clearing the grant and announcing it once', async () => {
  const h = await ready({}, storedGrant())
  expect(await h.account.signOut(CLIENT)).toMatchObject({ status: 'signed-out', attempt: null })
  expect(h.store.record).toBeUndefined()
  expect(h.store.deletions).toBe(1)
  expect(h.events).toEqual(['signed-out'])
  // Removing an already-absent grant is still a clean sign-out.
  expect(await h.account.signOut(CLIENT)).toMatchObject({ status: 'signed-out' })
  expect(h.events).toEqual(['signed-out', 'signed-out'])
})

it('drops the grant the inference origin rejected, in the order the Desktop expects', async () => {
  const h = await ready({}, storedGrant({ idToken: 'rejected-token' }))
  await h.account.rejectToken('another-token')
  expect(h.store.record).toBeDefined()
  expect(h.events).toEqual([])

  await h.account.rejectToken('rejected-token')
  expect(h.store.record).toBeUndefined()
  expect(h.store.deletions).toBe(1)
  expect(h.events).toEqual(['session-expired', 'signed-out'])
  expect(await h.account.getState()).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
})

it('keeps the grant when the rejection belongs to another token', async () => {
  const h = await ready({}, storedGrant({ idToken: 'kept-token' }))
  await h.account.rejectToken('some-other-token')
  expect(h.store.record).toBeDefined()
  expect(h.store.deletions).toBe(0)
  expect(h.events).toEqual([])
})

it('cancels the in-flight attempt as part of dropping a rejected token', async () => {
  const h = await ready({}, storedGrant({ idToken: 'rejected-token' }))
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  await h.account.rejectToken('rejected-token')
  expect(await h.account.getState()).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
  expect(h.store.deletions).toBe(1)
  expect(h.events).toEqual(['session-expired', 'signed-out'])
})

it('reports no attempt once the grant is gone, even after a successful login', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  await h.complete({ token: unsignedToken() })
  await h.watchFor('succeeded')
  // Another process on the same home removes the grant behind this provider.
  h.store.record = undefined
  expect(await h.account.getState()).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
})

it('keeps the grant when a rejection lands as the provider closes', async () => {
  const h = await ready({}, storedGrant({ idToken: 'rejected-token' }))
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  // Disposal closes the provider while the rejection is still cancelling the attempt.
  const rejection = h.account.rejectToken('rejected-token')
  const disposal = h.dispose()
  await Promise.all([rejection, disposal])
  expect(h.store.record).toBeDefined()
  expect(h.store.deletions).toBe(0)
  expect(h.events).toEqual([])
})

it('refuses every account operation once the provider is disposed', async () => {
  const h = await ready({}, storedGrant())
  await h.dispose()
  await refuses(h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop'), 'protocol', '账号服务已关闭')
  await refuses(h.account.signOut(CLIENT), 'protocol', '账号服务已关闭')
  expect(await h.account.getProfile(CLIENT)).toBeNull()
  expect(await h.account.getBalance(CLIENT)).toBeNull()
  expect(await h.account.resolveToken(`${DEPLOYMENT.inferenceOrigin}/x`)).toBeUndefined()
  expect(await h.account.getDeviceIdentity()).toEqual({ osVersion: `${platform()} ${release()}` })
})

it('cancels the attempt the provider is disposed under', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  await h.dispose()
  expect(await h.account.getState()).toMatchObject({ status: 'signed-out', attempt: { phase: 'cancelled' } })
})

it('lets an attempt that already committed finish while the provider is disposed', async () => {
  const h = await ready()
  const gate = Promise.withResolvers<undefined>()
  const write = h.store.modifyRecord.bind(h.store)
  h.store.modifyRecord = async (key, mutate) => { await gate.promise; return await write(key, mutate) }

  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  const settled = h.complete({ token: unsignedToken() })
  // Disposal while the grant is being written waits for it instead of aborting:
  // a committing attempt already owns the credential it is publishing.
  expect((await h.watchFor('committing')).phase).toBe('committing')
  const disposal = h.dispose()
  gate.resolve()
  expect((await settled).result).toEqual({ ok: true, message: '登录成功，可以关闭本页并回到 DSH。' })
  await disposal
  expect(h.store.record).toBeDefined()
})

it('wakes a watcher when another writer touches this provider slot', async () => {
  const h = await ready()
  const controller = new AbortController()
  watches.push(controller)
  const seen: string[] = []
  const loop = (async () => {
    for await (const state of h.account.watch(controller.signal)) seen.push(state.status)
  })()
  await tick()
  expect(seen).toEqual(['signed-out'])
  // Another provider's slot is not this account's business.
  h.ctx.emit('credentials/record-updated', credentialKey('deepseek-account-platform', 'default'))
  await tick()
  expect(seen).toEqual(['signed-out'])
  h.ctx.emit('credentials/record-updated', KEY)
  await tick()
  expect(seen).toEqual(['signed-out', 'signed-out'])
  controller.abort()
  await loop
})

it('waits for a sign-out in flight before it starts an attempt', async () => {
  const h = await ready({}, storedGrant())
  const removing = h.account.signOut(CLIENT)
  const started = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await removing
  expect(h.store.record).toBeUndefined()
  expect(started.attempt).not.toBeNull()
  await h.account.cancelSignIn(started.attempt!.id)
})

it('cancels the attempt in flight when the operator signs out', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const { port } = await h.relay()
  expect(await h.account.signOut(CLIENT)).toEqual({ status: 'signed-out', attempt: null, links: LINKS })
  expect(h.events).toEqual(['signed-out'])
  // The receiver went down with the attempt it belonged to.
  await expect(realFetch(`http://127.0.0.1:${port}${CALLBACK_PATH}`)).rejects.toThrow()
})

it('lets a committing attempt settle instead of aborting it', async () => {
  const h = await ready()
  const gate = Promise.withResolvers<undefined>()
  const write = h.store.modifyRecord.bind(h.store)
  h.store.modifyRecord = async (key, mutate) => { await gate.promise; return await write(key, mutate) }
  const started = await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  await h.relay()
  const settled = h.complete({ token: unsignedToken() })
  expect((await h.watchFor('committing')).phase).toBe('committing')
  // The grant is being written, so cancelling waits for the write to land
  // rather than tearing the attempt down with the credential half-written.
  const cancelling = h.account.cancelSignIn(started.attempt!.id)
  gate.resolve()
  expect(await cancelling).toMatchObject({ status: 'credential-stored', attempt: { phase: 'succeeded' } })
  expect((await settled).result.ok).toBe(true)
  expect(h.store.record).toBeDefined()
})

it('refuses an attempt that was still waiting on its predecessor when the provider closed', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const { port } = await h.relay()
  // An unfinished fragment post holds the receiver's teardown open, so the
  // cancelled attempt's `done` stays pending: the one window in which a new
  // attempt can observe the provider closing under it.
  const stalled = await stalledPost(port)
  const cancelling = h.account.cancelSignIn((await h.account.getState()).attempt!.id)
  await h.watchFor('cancelled')
  expect(await heldOpen(cancelling)).toBe('pending')
  const pending = h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const disposal = h.dispose()
  await tick()
  stalled.destroy()
  await refuses(pending, 'protocol', '账号服务已关闭')
  await Promise.all([cancelling, disposal])
})

it('keeps the grant when the provider closes while a rejected token is being cleared', async () => {
  const h = await ready({}, storedGrant({ idToken: 'rejected-token' }))
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  const { port } = await h.relay()
  const stalled = await stalledPost(port)
  // The rejection is cancelling the attempt when the provider closes, so its
  // own removal never reaches the record it meant to drop.
  const rejection = h.account.rejectToken('rejected-token')
  await h.watchFor('cancelled')
  expect(await heldOpen(rejection)).toBe('pending')
  const disposal = h.dispose()
  await tick()
  stalled.destroy()
  await Promise.all([rejection, disposal])
  expect(h.store.record).toBeDefined()
  expect(h.store.deletions).toBe(0)
  expect(h.events).toEqual([])
})

it('keeps the grant when it changed shape before the clear reached it', async () => {
  const h = await ready({}, storedGrant({ idToken: 'rejected-token' }))
  // The record the rejection reads is the matching one; the record it finds
  // when it comes back to delete is no longer a grant it can read.
  h.store.queued = [storedGrant({ idToken: 'rejected-token' }), { kind: 'grant', payload: { version: 2 } }]
  await h.account.rejectToken('rejected-token')
  expect(h.store.record).toBeDefined()
  expect(h.store.deletions).toBe(0)
  expect(h.events).toEqual([])
})

it('accepts a token it cannot check locally when the key list is unreachable', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  const warnings: string[] = []
  vi.spyOn(console, 'warn').mockImplementation((...values: unknown[]) => { warnings.push(values.map(String).join(' ')) })
  const h = await ready({ verifyLocal: true })
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await h.complete({ token: unsignedToken() })).result)
    .toEqual({ ok: true, message: '登录成功，可以关闭本页并回到 DSH。' })
  expect(await h.watchFor('succeeded')).toMatchObject({ phase: 'succeeded' })
  // The relay's own verification is the authority for this deployment, so an
  // unreachable key list is a warning rather than a failed login.
  expect(warnings).toEqual([
    '[hongling-account] JWKS 不可达，跳过本地验签（中转方验签为最终权威）：JWKS 获取失败：offline',
  ])
})

it('records a token that declares no expiry', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  expect((await h.complete({ token: unsignedToken({ exp: undefined }) })).result.ok).toBe(true)
  expect(await h.watchFor('succeeded')).toMatchObject({ phase: 'succeeded' })
  expect(await h.account.getProfile(CLIENT)).toMatchObject({ status: 'ready', value: { name: '张三' } })
  // No expiry means no expiry field: a later read must not invent one.
  expect(h.store.record?.payload).not.toHaveProperty('expiresAt')
  expect(logs.join('\n')).toContain('"expiresAt":null')
})

it('refuses a token whose expiry claim is not a usable timestamp', async () => {
  const h = await ready()
  await h.account.startSignIn(CLIENT, 'https://dsh.example.test', 'desktop')
  // The claim decides how the grant is read back, so a value the credential
  // store cannot hold is refused before any of it is written.
  expect((await h.complete({ token: unsignedToken({ exp: 1e30 }) })).result.message)
    .toBe('登录失败：id_token 过期时间非法')
  expect((await h.watchFor('failed')).errorCode).toBe('protocol')
  expect(h.store.writes).toEqual([])
  expect(await h.account.getState()).toMatchObject({ status: 'signed-out', attempt: { phase: 'failed', errorCode: 'protocol' } })
})
