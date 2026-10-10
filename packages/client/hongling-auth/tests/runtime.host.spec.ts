/**
 * The runtime: token adoption from disk, the redacted status and progress
 * faces, the browser-login round trip over a real loopback receiver, the
 * development injection, endpoint dispatch, and every arm of the refresh
 * policy — including the `invalid_grant` sign-out and the fallback to the
 * lifetime the backend reports for a refreshed token that carries no expiry.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedConfig } from '../src/config.ts'
import type { SessionLogger } from '../src/login-session.ts'
import { AuthRuntime, REFRESH_MARGIN_MS, REFRESH_TIMEOUT_MS } from '../src/runtime.ts'
import type { TokenSet } from '../src/types.ts'

const NOW = 1_700_000_000_000

const CONFIG: ResolvedConfig = {
  backendUrl: 'https://backend.example.com',
  verifyLocal: false,
  devAuth: false,
}

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hongling-runtime-'))
  dirs.push(dir)
  return dir
}

/** Spies that still satisfy the logger the runtime asks for. */
function logger() {
  return {
    info: vi.fn<(...values: unknown[]) => void>(),
    warn: vi.fn<(...values: unknown[]) => void>(),
    error: vi.fn<(...values: unknown[]) => void>(),
  } satisfies SessionLogger
}

/** One unsigned compact token; every runtime test runs with local verification off. */
function jwt(claims: Record<string, unknown>): string {
  const segment = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return segment({ alg: 'none' }) + '.' + segment(claims) + '.signature'
}

const STORED_TOKEN = jwt({ sub: 'stored', preferred_username: 'stored', exp: NOW / 1000 + 3600 })

function tokenSet(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    version: 1,
    idToken: STORED_TOKEN,
    profile: { username: 'stored', displayName: 'Stored', roles: [] },
    savedAt: NOW,
    ...overrides,
  }
}

interface Bench {
  runtime: AuthRuntime
  log: ReturnType<typeof logger>
  launch: ReturnType<typeof vi.fn>
  file: string
  fetchMock: ReturnType<typeof vi.fn>
}

async function bench(overrides: {
  config?: Partial<ResolvedConfig>
  tokens?: TokenSet
  fetch?: () => Promise<Response>
  file?: string
  now?: () => number
} = {}): Promise<Bench> {
  const file = overrides.file ?? join(await tempDir(), 'auth.json')
  if (overrides.tokens !== undefined) {
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(overrides.tokens))
  }
  const log = logger()
  const launch = vi.fn()
  const fetchMock = vi.fn<typeof globalThis.fetch>(overrides.fetch ?? (async () => new Response('{}', { status: 200 })))
  const runtime = new AuthRuntime({
    config: { ...CONFIG, ...overrides.config },
    logger: log,
    file,
    launch,
    fetch: fetchMock,
    now: overrides.now ?? (() => NOW),
    loginTimeoutMs: 5_000,
  })
  return { runtime, log, launch, file, fetchMock }
}

/** A refresh response the backend would return for a valid session. */
function refreshBody(overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    id_token: jwt({ sub: 'refreshed', exp: NOW / 1000 + 3600 }),
    ...overrides,
  }), { status: 200 })
}

/** The JSON body the loopback receiver answers one callback with. */
interface CallbackReply {
  ok: boolean
  message?: string
}

/** Complete one browser login through the runtime's own loopback receiver. */
async function completeLogin(subject: Bench, payload: Record<string, unknown>): Promise<CallbackReply> {
  const started = await subject.runtime.dispatch('auth.login', {}) as { loginUrl: string }
  const port = new URL(started.loginUrl).searchParams.get('port')
  const response = await fetch(`http://127.0.0.1:${String(port)}/complete`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return await response.json() as CallbackReply
}

describe('AuthRuntime', () => {
  it('starts logged out and defaults its clock and transport to the process', async () => {
    const runtime = new AuthRuntime({
      config: CONFIG,
      logger: logger(),
      file: join(await tempDir(), 'auth.json'),
      launch: vi.fn(),
    })
    await expect(runtime.restore()).resolves.toBeUndefined()
    expect(runtime.getStatus()).toEqual({ loggedIn: false })
    expect(runtime.progress()).toEqual({ phase: 'idle' })
    await expect(runtime.getToken()).resolves.toBeUndefined()
    runtime.dispose()
  })

  it('adopts a stored token, reporting its profile, expiry, and refreshability', async () => {
    const subject = await bench({ tokens: tokenSet({ expiresAt: NOW + 3600_000, refreshToken: 'r1' }) })
    await subject.runtime.restore()
    expect(subject.runtime.getStatus()).toEqual({
      loggedIn: true,
      profile: { username: 'stored', displayName: 'Stored', roles: [] },
      expiresAt: NOW + 3600_000,
      canRefresh: true,
    })
    expect(subject.runtime.progress()).toEqual({ phase: 'done' })
    await expect(subject.runtime.getToken()).resolves.toBe(STORED_TOKEN)
    subject.runtime.dispose()
  })

  it('reports a token without an expiry or a refresh token', async () => {
    const subject = await bench({ tokens: tokenSet() })
    await subject.runtime.restore()
    expect(subject.runtime.getStatus()).toEqual({
      loggedIn: true,
      profile: { username: 'stored', displayName: 'Stored', roles: [] },
      canRefresh: false,
    })
    subject.runtime.dispose()
  })

  it('renews a stored token that is already inside the refresh margin', async () => {
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW + REFRESH_MARGIN_MS - 1, refreshToken: 'r1' }),
      fetch: async () => refreshBody({ refresh_token: 'r2' }),
    })
    await subject.runtime.restore()
    expect(subject.fetchMock).toHaveBeenCalledTimes(1)
    expect(subject.runtime.getStatus().profile).toEqual({ username: 'refreshed', displayName: 'refreshed', roles: [] })
    subject.runtime.dispose()
  })

  it('leaves an expiring token alone when it cannot be renewed', async () => {
    const subject = await bench({ tokens: tokenSet({ expiresAt: NOW - 1 }) })
    await subject.runtime.restore()
    expect(subject.fetchMock).not.toHaveBeenCalled()
    expect(subject.runtime.getStatus().loggedIn).toBe(true)
    subject.runtime.dispose()
  })

  it('notifies subscribers of a sign-in and a sign-out, surviving a failing one', async () => {
    const subject = await bench({ config: { devAuth: true } })
    const seen: string[] = []
    const unsubscribe = subject.runtime.onChange(() => { seen.push('first') })
    subject.runtime.onChange(() => { throw new Error('subscriber blew up') })
    const last = subject.runtime.onChange(() => { seen.push('last') })

    await subject.runtime.devLogin({ username: 'sven' })
    expect(seen).toEqual(['first', 'last'])
    unsubscribe()
    await subject.runtime.logout()
    expect(seen).toEqual(['first', 'last', 'last'])
    last()
    subject.runtime.dispose()
  })

  it('publishes the service face other host halves consume', async () => {
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW + 3600_000, refreshToken: 'r1' }),
      fetch: async () => refreshBody(),
    })
    await subject.runtime.restore()
    const service = subject.runtime.service()
    expect(service.getStatus().loggedIn).toBe(true)
    await expect(service.getToken()).resolves.toBe(STORED_TOKEN)
    await expect(service.refresh()).resolves.toBe(true)
    const seen = vi.fn()
    service.onChange(seen)
    await subject.runtime.logout()
    expect(seen).toHaveBeenCalledTimes(1)
    subject.runtime.dispose()
  })

  it('renews a token on read only when it is expiring and refreshable', async () => {
    const expiring = await bench({
      tokens: tokenSet({ expiresAt: NOW - 1, refreshToken: 'r1' }),
      fetch: async () => refreshBody(),
    })
    await expiring.runtime.restore()
    await expect(expiring.runtime.getToken()).resolves.toBe(jwt({ sub: 'refreshed', exp: NOW / 1000 + 3600 }))
    expiring.runtime.dispose()

    const unrefreshable = await bench({ tokens: tokenSet({ expiresAt: NOW - 1 }) })
    await unrefreshable.runtime.restore()
    await expect(unrefreshable.runtime.getToken()).resolves.toBe(STORED_TOKEN)
    unrefreshable.runtime.dispose()
  })

  it('renews on read once the adopted token has entered the refresh margin', async () => {
    let clock = NOW
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW + REFRESH_MARGIN_MS + 1_000, refreshToken: 'r1' }),
      fetch: async () => refreshBody(),
      now: () => clock,
    })
    await subject.runtime.restore()
    expect(subject.fetchMock).not.toHaveBeenCalled()

    // Time passes, so the token the panel reads is now the expiring one.
    clock = NOW + 2_000
    await expect(subject.runtime.getToken()).resolves.toBe(jwt({ sub: 'refreshed', exp: NOW / 1000 + 3600 }))
    expect(subject.fetchMock).toHaveBeenCalledTimes(1)
    subject.runtime.dispose()
  })

  it('runs one browser login end to end and adopts the token the callback delivers', async () => {
    const subject = await bench()
    expect(subject.runtime.progress()).toEqual({ phase: 'idle' })

    const started = await subject.runtime.dispatch('auth.login', {}) as { started: boolean; loginUrl: string }
    expect(started.started).toBe(true)
    expect(subject.launch).toHaveBeenCalledWith(started.loginUrl)
    expect(subject.runtime.progress()).toMatchObject({ phase: 'waiting_browser', loginUrl: started.loginUrl })

    const port = new URL(started.loginUrl).searchParams.get('port')
    const completed = await fetch(`http://127.0.0.1:${String(port)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ token: jwt({ sub: 'browser', name: 'Browser User', exp: NOW / 1000 + 60 }) }),
    })
    await expect(completed.json()).resolves.toEqual({ ok: true })

    expect(subject.runtime.getStatus().profile).toEqual({ username: 'browser', displayName: 'Browser User', roles: [] })
    expect(subject.runtime.progress()).toEqual({ phase: 'done' })
    expect(JSON.parse(await readFile(subject.file, 'utf8'))).toMatchObject({ version: 1 })
    subject.runtime.dispose()
  })

  it('keeps a refresh token the callback relays and ignores an empty one', async () => {
    const kept = await bench()
    await expect(completeLogin(kept, { token: jwt({ sub: 'browser' }), refresh_token: 'r1' }))
      .resolves.toEqual({ ok: true })
    expect(JSON.parse(await readFile(kept.file, 'utf8'))).toMatchObject({ refreshToken: 'r1' })
    expect(kept.runtime.getStatus().canRefresh).toBe(true)
    kept.runtime.dispose()

    const blank = await bench()
    await expect(completeLogin(blank, { token: jwt({ sub: 'browser' }), refresh_token: '' }))
      .resolves.toEqual({ ok: true })
    expect(blank.runtime.getStatus().canRefresh).toBe(false)
    blank.runtime.dispose()
  })

  it('refuses a callback that carries no usable token and keeps its message', async () => {
    const subject = await bench()
    await expect(completeLogin(subject, { token: 'not-a-jwt' })).resolves.toEqual({
      ok: false, message: 'token 格式非法',
    })
    expect(subject.runtime.getStatus().loggedIn).toBe(false)
    const progress = subject.runtime.progress()
    expect(progress.phase).toBe('error')
    expect(progress.message).toBe('token 格式非法')
    expect(typeof progress.loginUrl).toBe('string')
    subject.runtime.dispose()
  })

  it('reports a login failure as a value, not a rejection', async () => {
    const subject = await bench({ config: { verifyLocal: true } })
    const result = await completeLogin(subject, {
      token: jwt({ sub: 'browser', iss: 'https://issuer.example.com' }),
    })
    expect(result.ok).toBe(false)
    expect(result.message ?? '').toContain('JWKS 中找不到匹配密钥')
    subject.runtime.dispose()
  })

  it('cancels an in-flight login, tolerating a receiver that is already gone', async () => {
    const subject = await bench()
    await subject.runtime.login()
    subject.runtime.cancelLogin()
    expect(subject.runtime.progress()).toEqual({ phase: 'idle' })
    subject.runtime.cancelLogin()
    expect(subject.runtime.progress()).toEqual({ phase: 'idle' })
    subject.runtime.dispose()
  })

  it('forgets the token in memory and on disk', async () => {
    const subject = await bench({ config: { devAuth: true } })
    await subject.runtime.devLogin({ username: 'sven' })
    await subject.runtime.logout()
    expect(subject.runtime.getStatus()).toEqual({ loggedIn: false })
    await expect(readFile(subject.file, 'utf8')).rejects.toThrow()
    subject.runtime.dispose()
  })

  it('injects a development login only when the config enables it', async () => {
    const disabled = await bench()
    await expect(disabled.runtime.devLogin({ username: 'sven' }))
      .rejects.toMatchObject({ code: 'DEV_AUTH_DISABLED' })
    disabled.runtime.dispose()

    const subject = await bench({ config: { devAuth: true } })
    await expect(subject.runtime.devLogin({ username: '  ' })).rejects.toMatchObject({ code: 'BAD_USERNAME' })
    await expect(subject.runtime.devLogin({})).rejects.toMatchObject({ code: 'BAD_USERNAME' })
    await expect(subject.runtime.devLogin({ username: 'sven', roles: ['admin', '', 7] })).resolves.toEqual({ ok: true })
    expect(subject.runtime.getStatus()).toEqual({
      loggedIn: true,
      profile: { username: 'sven', displayName: 'sven', roles: ['admin', '7'] },
      canRefresh: false,
    })
    expect(subject.runtime.progress()).toEqual({ phase: 'done' })

    await subject.runtime.devLogin({ username: 'guest', roles: 'admin' })
    expect(subject.runtime.getStatus().profile?.roles).toEqual([])
    subject.runtime.dispose()
  })

  it('serves every endpoint and refuses an unknown one', async () => {
    const subject = await bench({ config: { devAuth: true } })
    await expect(subject.runtime.dispatch('auth.getStatus', {})).resolves.toEqual({ loggedIn: false })
    await expect(subject.runtime.dispatch('auth.getLoginProgress', {})).resolves.toEqual({ phase: 'idle' })
    await expect(subject.runtime.dispatch('auth.cancelLogin', {})).resolves.toEqual({ ok: true })
    await expect(subject.runtime.dispatch('auth.devLogin', { username: 'sven' })).resolves.toEqual({ ok: true })
    await expect(subject.runtime.dispatch('auth.logout', {})).resolves.toEqual({ ok: true })
    await expect(subject.runtime.dispatch('auth.login', {})).resolves.toMatchObject({ started: true })
    await expect(subject.runtime.dispatch('auth.nope' as never, {}))
      .rejects.toMatchObject({ code: 'UNKNOWN_ENDPOINT' })
    subject.runtime.dispose()
  })

  it('adopts a refreshed token, keeping the old refresh token when none is reissued', async () => {
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW - 1, refreshToken: 'r1' }),
      fetch: async () => refreshBody(),
    })
    await subject.runtime.restore()
    await expect(subject.runtime.refresh()).resolves.toBe(true)
    expect(subject.fetchMock).toHaveBeenLastCalledWith('https://backend.example.com/dsh/refresh', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ refresh_token: 'r1' }),
    }))
    expect(JSON.parse(await readFile(subject.file, 'utf8'))).toMatchObject({ refreshToken: 'r1' })
    expect(REFRESH_TIMEOUT_MS).toBe(15_000)
    subject.runtime.dispose()
  })

  it('falls back to the backend lifetime for a refreshed token without an expiry', async () => {
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW - 1, refreshToken: 'r1' }),
      fetch: async () => new Response(JSON.stringify({ id_token: jwt({ sub: 'refreshed' }), expires_in: 120 }), { status: 200 }),
    })
    await subject.runtime.restore()
    expect(subject.runtime.getStatus()).toEqual({
      loggedIn: true,
      profile: { username: 'refreshed', displayName: 'refreshed', roles: [] },
      expiresAt: NOW + 120_000,
      canRefresh: true,
    })
    subject.runtime.dispose()
  })

  it('keeps the token expiry the refreshed token itself declares', async () => {
    const subject = await bench({
      tokens: tokenSet({ expiresAt: NOW - 1, refreshToken: 'r1' }),
      fetch: async () => new Response(JSON.stringify({
        id_token: jwt({ sub: 'refreshed', exp: NOW / 1000 + 300 }), expires_in: 9999,
      }), { status: 200 }),
    })
    await subject.runtime.restore()
    expect(subject.runtime.getStatus().expiresAt).toBe((NOW / 1000 + 300) * 1000)
    subject.runtime.dispose()
  })

  it('declines to refresh without a refresh token', async () => {
    const missing = await bench()
    await expect(missing.runtime.refresh()).resolves.toBe(false)
    missing.runtime.dispose()

    const empty = await bench({ tokens: tokenSet({ refreshToken: '' }) })
    await empty.runtime.restore()
    await expect(empty.runtime.refresh()).resolves.toBe(false)
    empty.runtime.dispose()
  })

  it('keeps the session when the refresh round trip fails', async () => {
    const offline = await bench({
      tokens: tokenSet({ refreshToken: 'r1' }),
      fetch: async () => { throw new Error('socket hang up') },
    })
    await offline.runtime.restore()
    await expect(offline.runtime.refresh()).resolves.toBe(false)
    expect(offline.log.warn).toHaveBeenCalledWith(expect.stringContaining('refresh 请求失败：socket hang up'))
    offline.runtime.dispose()

    for (const response of [
      new Response('nope', { status: 500 }),
      new Response(JSON.stringify({ id_token: 7 }), { status: 200 }),
      new Response(JSON.stringify({ id_token: '' }), { status: 200 }),
      new Response('not json', { status: 200 }),
    ]) {
      const subject = await bench({ tokens: tokenSet({ refreshToken: 'r1' }), fetch: async () => response })
      await subject.runtime.restore()
      await expect(subject.runtime.refresh()).resolves.toBe(false)
      expect(subject.runtime.getStatus().loggedIn).toBe(true)
      expect(subject.log.warn).toHaveBeenCalled()
      subject.runtime.dispose()
    }
  })

  it('signs the operator out when the backend reports the refresh token is spent', async () => {
    for (const response of [
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      new Response('', { status: 401 }),
    ]) {
      const subject = await bench({ tokens: tokenSet({ refreshToken: 'r1' }), fetch: async () => response })
      await subject.runtime.restore()
      await expect(subject.runtime.refresh()).resolves.toBe(false)
      expect(subject.runtime.getStatus().loggedIn).toBe(false)
      expect(subject.log.info).toHaveBeenCalledWith(expect.stringContaining('refresh_token 已失效'))
      await expect(readFile(subject.file, 'utf8')).rejects.toThrow()
      subject.runtime.dispose()
    }
  })

  it('keeps the session when the refreshed token fails local verification', async () => {
    const subject = await bench({
      tokens: tokenSet({ refreshToken: 'r1' }),
      fetch: async () => new Response(JSON.stringify({ id_token: jwt({ sub: 'refreshed', exp: NOW / 1000 - 10 }) }), { status: 200 }),
    })
    await subject.runtime.restore()
    await expect(subject.runtime.refresh()).resolves.toBe(false)
    expect(subject.log.warn).toHaveBeenCalledWith(expect.stringContaining('refresh 后 token 校验失败'))
    subject.runtime.dispose()
  })

  it('surfaces a sign-out that cannot reach the disk', async () => {
    const blocked = join(await tempDir(), 'as-a-directory')
    await mkdir(blocked)
    const subject = await bench({ file: blocked })
    await expect(subject.runtime.logout()).rejects.toThrow()
    subject.runtime.dispose()
  })
})
