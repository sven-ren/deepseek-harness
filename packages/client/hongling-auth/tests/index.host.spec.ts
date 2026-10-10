/**
 * The Host entry on a real cordis Context with a fake Connection service:
 * the channel it claims, the endpoint table it enforces, the two failure
 * arms of the dispatch boundary, the `ctx.honglingAuth` service it publishes,
 * and the two ways adopting a previous session can go wrong — a restore that
 * cannot sign out and a request that cannot reach the disk.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, CHANNEL, inject, name } from '../src/index.ts'

const dirs: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-hongling-host-'))
  dirs.push(dir)
  return dir
}

type Handler = (
  endpoint: string,
  payload: unknown,
) => Promise<{ ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }>

interface Bench {
  ctx: Context
  fiber: Fiber
  channels: string[]
  dispatch: Handler
  warn: ReturnType<typeof vi.spyOn>
  error: ReturnType<typeof vi.spyOn>
  info: ReturnType<typeof vi.spyOn>
  dispose: () => Promise<void>
}

/**
 * Mount the plugin over a fake Connection.
 * @param config - authored config block, or undefined for the schema defaults.
 * @param withWebServer - whether the composition also provides `webServer`, as
 * every browser-serving host does. The channel is a physical route, so the
 * host half claims it only where that service exists.
 */
async function bench(config?: Record<string, unknown>, withWebServer = true): Promise<Bench> {
  const ctx = new Context()
  const channels: string[] = []
  let handler: Handler | undefined
  ctx.provide('connection', {
    rpc: {
      handle: (channel: string, registered: Handler) => {
        channels.push(channel)
        handler = registered
        return async () => { channels.splice(channels.indexOf(channel), 1) }
      },
    },
  } as never)
  if (withWebServer) ctx.provide('webServer', {} as never)
  const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
  const error = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
  const info = vi.spyOn(ctx.logger, 'info').mockImplementation(() => {})
  const fiber = config === undefined
    ? ctx.plugin({ inject: [...inject], apply })
    : ctx.plugin({ inject: [...inject], apply }, config)
  await fiber.await()
  if (withWebServer && handler === undefined) throw new Error('the plugin did not claim its RPC channel')
  return { ctx, fiber, channels, dispatch: handler as Handler, warn, error, info, dispose: () => fiber.dispose() }
}

/** One unsigned token whose claims say the session is already over. */
function expiredToken(): string {
  const segment = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return segment({ alg: 'none' }) + '.' + segment({ sub: 'stored', exp: 1 }) + '.signature'
}

describe('hongling-auth Host entry', () => {
  it('claims one authenticated channel and publishes the login service', async () => {
    const subject = await bench()
    expect(name).toBe('hongling-auth')
    expect(CHANNEL).toBe('/hongling-auth')
    expect(subject.channels).toEqual([CHANNEL])
    expect(subject.info).toHaveBeenCalledWith(expect.stringContaining('RPC 通道已注册'))
    expect(subject.info).toHaveBeenCalledWith(expect.stringContaining('verifyLocal=true'))
    expect(subject.ctx.get('honglingAuth')?.getStatus()).toEqual({ loggedIn: false })

    await subject.dispose()
    expect(subject.channels).toEqual([])
  })

  // The bug this pins: registering from `apply` itself read `webServer` off a
  // fiber that had not injected it, so the whole host half died at mount and
  // the browser's POST reached an unmounted channel as a 405.
  it('mounts the service but claims no channel when the host has no web server', async () => {
    const subject = await bench(undefined, false)
    expect(subject.channels).toEqual([])
    expect(subject.info).not.toHaveBeenCalledWith(expect.stringContaining('RPC 通道已注册'))
    expect(subject.info).toHaveBeenCalledWith(expect.stringContaining('插件已挂载'))
    expect(subject.ctx.get('honglingAuth')?.getStatus()).toEqual({ loggedIn: false })

    await subject.dispose()
  })

  it('dispatches the endpoint table and refuses anything else', async () => {
    const subject = await bench({ backendUrl: 'https://backend.example.com', verifyLocal: false, devAuth: true })
    await expect(subject.dispatch('auth.getStatus', {})).resolves.toEqual({ ok: true, value: { loggedIn: false } })
    await expect(subject.dispatch('auth.getLoginProgress', {})).resolves.toEqual({ ok: true, value: { phase: 'idle' } })
    await expect(subject.dispatch('auth.cancelLogin', {})).resolves.toEqual({ ok: true, value: { ok: true } })
    await expect(subject.dispatch('auth.devLogin', { username: 'sven' })).resolves.toEqual({ ok: true, value: { ok: true } })
    await expect(subject.dispatch('auth.logout', {})).resolves.toEqual({ ok: true, value: { ok: true } })
    await expect(subject.dispatch('auth.getStatus', 'not-an-object'))
      .resolves.toEqual({ ok: true, value: { loggedIn: false } })

    await expect(subject.dispatch('auth.unknown', {})).resolves.toMatchObject({
      ok: false, error: { code: 'unknown-endpoint', message: '未知端点：auth.unknown' },
    })
    await subject.dispose()
  })

  it('turns a refused command into a coded failure and logs it', async () => {
    const subject = await bench({ backendUrl: 'https://backend.example.com', verifyLocal: false, devAuth: false })
    const refused = await subject.dispatch('auth.devLogin', { username: 'sven' })
    expect(refused).toMatchObject({
      ok: false, error: { code: 'command-error', message: '开发注入未启用（config.devAuth）' },
    })
    expect(subject.warn).toHaveBeenCalledWith(expect.stringContaining('auth.devLogin failed [DEV_AUTH_DISABLED]'))
    await subject.dispose()
  })

  it('logs an unexpected failure as an error, not a warning', async () => {
    const home = await tempDir()
    // The token path is a directory, so the sign-out cannot unlink it.
    await mkdir(join(home, 'hongling-auth', 'auth.json'), { recursive: true })
    vi.stubEnv('DSH_HOME', home)

    const subject = await bench({ backendUrl: 'https://backend.example.com', verifyLocal: false, devAuth: false })
    const failure = await subject.dispatch('auth.logout', {}) as { ok: boolean; error: { code: string } }
    expect(failure.ok).toBe(false)
    expect(failure.error.code).toBe('command-error')
    expect(subject.error).toHaveBeenCalledWith(expect.any(Error))
    await subject.dispose()
  })

  it('keeps running when adopting the previous session cannot complete', async () => {
    const home = await tempDir()
    const authFile = join(home, 'hongling-auth', 'auth.json')
    await mkdir(dirname(authFile), { recursive: true })
    await writeFile(authFile, JSON.stringify({
      version: 1,
      idToken: expiredToken(),
      refreshToken: 'spent',
      expiresAt: 1,
      profile: { username: 'stored', displayName: 'Stored', roles: [] },
      savedAt: 1,
    }))
    vi.stubEnv('DSH_HOME', home)
    // The backend rejects the stored refresh token, and the sign-out that
    // follows finds a directory where the token file used to be.
    vi.stubGlobal('fetch', async () => {
      await rm(authFile, { force: true })
      await mkdir(authFile)
      return new Response('', { status: 401 })
    })

    const subject = await bench({ backendUrl: 'https://backend.example.com', verifyLocal: false, devAuth: false })
    await vi.waitFor(() => {
      expect(subject.warn).toHaveBeenCalledWith(expect.stringContaining('恢复登录态失败'))
    })
    // The failed sign-out still cleared the in-memory session.
    expect(subject.ctx.get('honglingAuth')?.getStatus()).toEqual({ loggedIn: false })
    await subject.dispose()
  })
})
