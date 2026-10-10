/**
 * The loopback receiver: the fragment-reading callback page, the `/complete`
 * submission paths (success, relayed error, missing token, bad JSON, closed
 * session, and a verifier that fails or throws), the loopback-only fence, the
 * body ceiling, the one-login-at-a-time rule, the timeout, and the bind
 * failure.
 */
import { createServer, IncomingMessage, type Server } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionLogger } from '../src/login-session.ts'
import {
  CALLBACK_PATH, COMPLETE_PATH, LOGIN_TIMEOUT_MS, LoginSessionRegistry, MAX_BODY_BYTES, isLoopback, readBody,
  type CompletionResult,
} from '../src/login-session.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve) => {
    server.closeAllConnections()
    server.close(() => { resolve() })
  })))
})

/** Spies that still satisfy the logger the registry asks for. */
function logger() {
  return {
    info: vi.fn<(...values: unknown[]) => void>(),
    warn: vi.fn<(...values: unknown[]) => void>(),
    error: vi.fn<(...values: unknown[]) => void>(),
  } satisfies SessionLogger
}

function bench(
  complete: (idToken: string, payload: Record<string, unknown>) => Promise<CompletionResult> = async () => ({ ok: true }),
  timeoutMs?: number,
) {
  const log = logger()
  const launched: string[] = []
  const registry = new LoginSessionRegistry({
    launch: (url) => { launched.push(url) },
    logger: log,
    complete,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  })
  return { registry, log, launched }
}

/** One login in flight, with its loopback origin. */
async function startLogin(subject = bench()) {
  const { loginUrl } = await subject.registry.start('https://backend.example.com', undefined)
  const port = new URL(loginUrl).searchParams.get('port')
  return { ...subject, loginUrl, origin: 'http://127.0.0.1:' + String(port) }
}

/** A real IncomingMessage over a socket that reports no peer address. */
function incoming(): IncomingMessage & { url: string; method: string } {
  return new IncomingMessage(new Socket()) as IncomingMessage & { url: string; method: string }
}

/** Make one request look like it arrived from the IPv4 loopback. */
function fromLoopback(req: IncomingMessage): void {
  Object.defineProperty(req, 'socket', { value: { remoteAddress: '127.0.0.1' } })
}

/** A response double recording the status and body of one reply. */
function reply() {
  return {
    status: 0 as number,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(status: number, headers: Record<string, string>) { this.status = status; this.headers = headers },
    end(body?: string) { this.body = body ?? '' },
  }
}

/** Wait for the session's unref'd deadline to fire. */
const sleep = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

describe('isLoopback', () => {
  it('accepts every spelling of the IPv4 and IPv6 loopback and refuses the rest', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.5', '::ffff:127.0.0.5']) {
      expect(isLoopback(address)).toBe(true)
    }
    for (const address of ['10.0.0.1', '::2', '::ffff:10.0.0.1', '']) {
      expect(isLoopback(address)).toBe(false)
    }
  })
})

describe('readBody', () => {
  it('joins the request chunks', async () => {
    const req = incoming()
    const pending = readBody(req)
    req.push(Buffer.from('{"token":'))
    req.push(Buffer.from('"x"}'))
    req.push(null)
    await expect(pending).resolves.toBe('{"token":"x"}')
  })

  it('refuses a body over the ceiling and stops reading', async () => {
    const req = incoming()
    const destroy = vi.spyOn(req, 'destroy')
    const pending = readBody(req)
    req.push(Buffer.alloc(MAX_BODY_BYTES + 1))
    await expect(pending).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' })
    expect(destroy).toHaveBeenCalled()
  })

  it('propagates a transport failure', async () => {
    const req = incoming()
    const pending = readBody(req)
    req.destroy(new Error('connection reset'))
    await expect(pending).rejects.toThrow('connection reset')
  })
})

describe('LoginSessionRegistry', () => {
  it('serves the fragment-reading callback page and completes one login', async () => {
    const subject = await startLogin()
    try {
      expect(subject.loginUrl).toMatch(/^https:\/\/backend\.example\.com\/dsh\/login\?port=\d+$/)
      expect(subject.launched).toEqual([subject.loginUrl])
      expect(subject.log.info).toHaveBeenCalledWith(
        expect.stringContaining('登录会话已启动：http://127.0.0.1:'),
      )
      expect(subject.registry.progress(false)).toMatchObject({ phase: 'waiting_browser', loginUrl: subject.loginUrl })
      // A registry built without a deadline runs on the module's own.
      expect(LOGIN_TIMEOUT_MS).toBe(5 * 60 * 1000)

      const page = await fetch(subject.origin + CALLBACK_PATH)
      expect(await page.text()).toContain('location.hash')
      expect(subject.registry.progress(false).phase).toBe('receiving')

      const completed = await fetch(subject.origin + COMPLETE_PATH, {
        method: 'POST',
        body: JSON.stringify({ token: 'id-token', refresh_token: 'refresh-token' }),
      })
      expect(completed.status).toBe(200)
      await expect(completed.json()).resolves.toEqual({ ok: true })
      // The receiver is gone, so the panel now reads the login itself.
      expect(subject.registry.progress(true)).toEqual({ phase: 'done' })
    } finally {
      subject.registry.dispose()
    }
  })

  it('reuses the login already in flight and opens a fresh one after a failure', async () => {
    const subject = await startLogin()
    try {
      await expect(subject.registry.start('https://backend.example.com', undefined))
        .resolves.toEqual({ started: true, loginUrl: subject.loginUrl })
      expect(subject.launched).toHaveLength(1)

      await fetch(subject.origin + COMPLETE_PATH, { method: 'POST', body: JSON.stringify({ error: 'access_denied' }) })
      expect(subject.registry.progress(false)).toEqual({ phase: 'error', loginUrl: subject.loginUrl, message: 'access_denied' })

      const again = await subject.registry.start('https://backend.example.com', undefined)
      expect(again.loginUrl).not.toBe(subject.loginUrl)
      expect(subject.launched).toHaveLength(2)
    } finally {
      subject.registry.dispose()
    }
  })

  it('hands the verifier the token it validated out of the payload', async () => {
    const complete = vi.fn(async () => ({ ok: true }))
    const subject = await startLogin(bench(complete))
    try {
      const payload = { token: 'id-token', refresh_token: 'refresh-token' }
      const response = await fetch(subject.origin + COMPLETE_PATH, {
        method: 'POST', body: JSON.stringify(payload),
      })
      await expect(response.json()).resolves.toEqual({ ok: true })
      expect(complete).toHaveBeenCalledWith('id-token', payload)
    } finally {
      subject.registry.dispose()
    }
  })

  it('reports the relayed failure, a missing token, and bad JSON', async () => {
    // Each refusal closes the receiver, so every case gets its own login.
    const denied = await startLogin()
    const deniedReply = await fetch(denied.origin + COMPLETE_PATH, {
      method: 'POST',
      body: JSON.stringify({ error: 'login_required' }),
    })
    expect(deniedReply.status).toBe(400)
    await expect(deniedReply.json()).resolves.toEqual({ ok: false, message: 'login_required' })
    expect(denied.registry.progress(false).phase).toBe('error')
    denied.registry.dispose()

    const tokenless = await startLogin()
    const tokenlessReply = await fetch(tokenless.origin + COMPLETE_PATH, { method: 'POST', body: '{}' })
    expect(tokenlessReply.status).toBe(400)
    await expect(tokenlessReply.json()).resolves.toEqual({ ok: false, message: '回调缺少 token' })
    tokenless.registry.dispose()

    const malformed = await startLogin()
    const malformedReply = await fetch(malformed.origin + COMPLETE_PATH, { method: 'POST', body: 'not json' })
    expect(malformedReply.status).toBe(400)
    await expect(malformedReply.json()).resolves.toEqual({ ok: false, message: 'bad json' })
    malformed.registry.dispose()
  })

  it('keeps the verifier message, or the generic one, when verification fails', async () => {
    const withMessage = await startLogin(bench(async () => ({ ok: false, message: 'id_token 签名校验失败' })))
    try {
      const response = await fetch(withMessage.origin + COMPLETE_PATH, {
        method: 'POST', body: JSON.stringify({ token: 'bad' }),
      })
      expect(response.status).toBe(400)
      expect(withMessage.registry.progress(false).message).toBe('id_token 签名校验失败')
    } finally {
      withMessage.registry.dispose()
    }

    const tokenless = await startLogin(bench(async () => ({ ok: false })))
    try {
      await fetch(tokenless.origin + COMPLETE_PATH, { method: 'POST', body: JSON.stringify({ token: 'bad' }) })
      expect(tokenless.registry.progress(false).message).toBe('登录失败')
    } finally {
      tokenless.registry.dispose()
    }
  })

  it('reports an internal error without failing the operator request', async () => {
    const subject = await startLogin(bench(async () => { throw new Error('disk full') }))
    try {
      const response = await fetch(subject.origin + COMPLETE_PATH, {
        method: 'POST', body: JSON.stringify({ token: 'x' }),
      })
      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({ ok: false, message: 'internal error' })
      expect(subject.log.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
    } finally {
      subject.registry.dispose()
    }
  })

  it('answers 404 for anything else and 403 off the loopback', async () => {
    const subject = await startLogin()
    try {
      const missing = await fetch(subject.origin + '/other')
      expect(missing.status).toBe(404)
      await expect(missing.json()).resolves.toEqual({ error: 'not found' })
    } finally {
      subject.registry.dispose()
    }

    const off = bench()
    const req = incoming()
    req.url = CALLBACK_PATH
    req.method = 'GET'
    const denied = reply()
    await off.registry.handleRequest(req, denied as never)
    expect(denied.status).toBe(403)
    expect(denied.body).toBe('{"error":"loopback only"}')
  })

  it('treats a request that names no target as the root path', async () => {
    const subject = bench()
    const req = incoming()
    fromLoopback(req)
    Object.defineProperty(req, 'url', { value: undefined })
    req.method = 'GET'
    const res = reply()
    await subject.registry.handleRequest(req, res as never)
    expect(res.status).toBe(404)
    expect(res.body).toBe('{"error":"not found"}')
  })

  it('refuses a completion for a session that is already closed', async () => {
    const subject = bench()
    const req = incoming()
    fromLoopback(req)
    req.url = COMPLETE_PATH
    req.method = 'POST'
    const res = reply()
    await subject.registry.handleRequest(req, res as never)
    expect(res.status).toBe(400)
    expect(res.body).toBe('{"ok":false,"message":"登录会话已关闭"}')
  })

  it('serves the callback page to a session-less receiver', async () => {
    const subject = bench()
    const req = incoming()
    fromLoopback(req)
    req.url = CALLBACK_PATH
    req.method = 'GET'
    const res = reply()
    await subject.registry.handleRequest(req, res as never)
    expect(res.status).toBe(200)
    expect(res.body).toContain('正在完成登录')
  })

  it('drops a completion whose session was cancelled while its body was arriving', async () => {
    const complete = vi.fn(async () => ({ ok: true }))
    const subject = await startLogin(bench(complete))
    const req = incoming()
    fromLoopback(req)
    req.url = COMPLETE_PATH
    req.method = 'POST'
    const res = reply()
    const pending = subject.registry.handleRequest(req, res as never)
    subject.registry.cancel()
    expect(subject.registry.progress(false)).toEqual({ phase: 'idle' })
    req.push(Buffer.from(JSON.stringify({ token: 'x' })))
    req.push(null)
    await pending
    expect(res.status).toBe(400)
    expect(res.body).toBe('{"ok":false,"message":"登录会话已关闭"}')
    expect(complete).not.toHaveBeenCalled()
  })

  it('forgets a refusal that lands after its session was cancelled', async () => {
    let release: (result: CompletionResult) => void = () => {}
    const complete = vi.fn(() => new Promise<CompletionResult>((resolve) => { release = resolve }))
    const subject = await startLogin(bench(complete))
    const req = incoming()
    fromLoopback(req)
    req.url = COMPLETE_PATH
    req.method = 'POST'
    const res = reply()
    const pending = subject.registry.handleRequest(req, res as never)
    req.push(Buffer.from(JSON.stringify({ token: 'x' })))
    req.push(null)
    await vi.waitFor(() => { expect(complete).toHaveBeenCalled() })
    // The operator cancels while the verifier is still running, so the
    // receiver no longer owns this login and records nothing.
    subject.registry.cancel()
    release({ ok: false, message: 'id_token 签名校验失败' })
    await pending
    expect(res.status).toBe(400)
    expect(res.body).toBe('{"ok":false,"message":"id_token 签名校验失败"}')
    expect(subject.registry.progress(false)).toEqual({ phase: 'idle' })
  })

  it('records the deadline as a failure and forgets a deadline that outlives its session', async () => {
    const timedOut = await startLogin(bench(async () => ({ ok: true }), 20))
    await sleep(60)
    expect(timedOut.registry.progress(false)).toEqual({
      phase: 'error', loginUrl: timedOut.loginUrl, message: '登录超时（5 分钟），请重试',
    })
    await expect(fetch(timedOut.origin + CALLBACK_PATH)).rejects.toThrow()
    timedOut.registry.dispose()

    const cancelled = await startLogin(bench(async () => ({ ok: true }), 20))
    cancelled.registry.cancel()
    cancelled.registry.dispose()
    await sleep(60)
    expect(cancelled.registry.progress(false)).toEqual({ phase: 'idle' })
  })

  it('reports a bind failure with the platform reason', async () => {
    const occupied = createServer()
    servers.push(occupied)
    await new Promise<void>((resolve) => { occupied.listen(0, '127.0.0.1', resolve) })
    const address = occupied.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    const subject = bench()
    await expect(subject.registry.start('https://backend.example.com', port))
      .rejects.toMatchObject({ code: 'LISTEN_FAILED' })
    await expect(subject.registry.start('https://backend.example.com', port))
      .rejects.toThrow(String(port))
    expect(subject.launched).toEqual([])
  })
})
