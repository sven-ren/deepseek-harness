import { EventEmitter } from 'node:events'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer as createNetServer } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { AuthError } from '../src/errors.ts'
import {
  CALLBACK_PATH, COMPLETE_PATH, LoginReceiver, MAX_BODY_BYTES, isLoopback,
  type LoginReceiverOptions,
} from '../src/login-session.ts'

// The receiver's own branches — a peer that cannot be a loopback socket, a bound
// address that is not a TCP port, and a handler that throws — cannot be reached
// through a real HTTP client. The mock keeps `createServer` genuine by default
// and lets one test hand `listen` a server whose answers it decides.
const http = vi.hoisted(() => ({
  server: undefined as Server | undefined,
  listener: undefined as ((request: IncomingMessage, response: ServerResponse) => void) | undefined,
}))

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>()
  return {
    ...actual,
    createServer: ((listener: (request: IncomingMessage, response: ServerResponse) => void) => {
      http.listener = listener
      return http.server ?? actual.createServer(listener)
    }) as typeof actual.createServer,
  }
})

const CLOSED_MESSAGE = '登录会话已关闭，请回到 DSH 重新登录。'
const receiverOptions = (overrides: Partial<LoginReceiverOptions> = {}): LoginReceiverOptions => ({
  logger: { warn: () => {} },
  onPayload: () => Promise.resolve({ ok: true, message: '登录成功，可以关闭本页并回到 DSH。' }),
  ...overrides,
})

/** What the receiver did, in order, for the tests that assert a teardown sequence. */
const order: string[] = []

/** A server whose bound address, and every close, the test observes. */
class FakeServer extends EventEmitter {
  closes = 0
  idleCloses = 0
  connectionCloses = 0
  /** @param bound - what `address()` reports. */
  constructor(private readonly bound: AddressInfo | string | null) { super() }
  listen(_port: number, _host: string, callback: () => void): this { callback(); return this }
  close(): this { this.closes += 1; return this }
  closeIdleConnections(): void { this.idleCloses += 1; order.push('idle-connections-closed') }
  closeAllConnections(): void { this.connectionCloses += 1; order.push('connections-destroyed') }
  address(): AddressInfo | string | null { return this.bound }
}

/**
 * A response stand-in that signals completion with `done` and finishes its
 * reply on a later turn of the loop, the way a real one hands its bytes to the
 * socket after `end` returns.
 */
class FakeResponse extends EventEmitter {
  headersSent = false
  writableEnded = false
  writableFinished = false
  destroyed = false
  status: number | undefined
  headers: Record<string, unknown> | undefined
  body: string | undefined
  /** Resolves once the handler wrote its reply. */
  readonly done: Promise<void>
  private readonly settle: () => void
  constructor() {
    super()
    let settle = (): void => {}
    this.done = new Promise<void>((resolve) => { settle = resolve })
    this.settle = settle
    this.on('finish', () => { this.writableFinished = true; order.push('reply-flushed') })
  }
  writeHead(status: number, headers?: Record<string, unknown>): this {
    this.status = status
    this.headers = headers
    this.headersSent = true
    return this
  }
  end(body?: string): this {
    this.body = body
    this.writableEnded = true
    order.push('reply-written')
    this.settle()
    setImmediate(() => { this.emit('finish') })
    return this
  }
}

/** A request stand-in carrying only the fields the listener reads. @param overrides - fields to replace. @returns the request. */
function plainRequest(overrides: { method?: string; url?: string; remoteAddress?: string } = {}): IncomingMessage {
  return {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/',
    socket: { remoteAddress: overrides.remoteAddress ?? '127.0.0.1' },
  } as unknown as IncomingMessage
}

/** A request whose body arrives as the given chunks. @param chunks - body chunks in arrival order. @returns the request. */
function bodyRequest(chunks: Buffer[]): IncomingMessage {
  return {
    method: 'POST',
    url: COMPLETE_PATH,
    socket: { remoteAddress: '127.0.0.1' },
    [Symbol.asyncIterator]: async function * () { yield * chunks },
  } as unknown as IncomingMessage
}

/**
 * Drives one request through a receiver's real listener.
 * @param listener - the installed connection listener.
 * @param request - the request to route.
 * @returns the reply once the handler wrote it.
 */
async function drive(
  listener: (request: IncomingMessage, response: ServerResponse) => void,
  request: IncomingMessage,
): Promise<FakeResponse> {
  const response = new FakeResponse()
  listener(request, response)
  await response.done
  return response
}

const bound: LoginReceiver[] = []

/** A receiver on a real loopback port plus the listener it installed. */
async function bind(onPayload?: LoginReceiverOptions['onPayload']): Promise<{
  receiver: LoginReceiver
  listener: (request: IncomingMessage, response: ServerResponse) => void
  port: number
  payloads: Record<string, unknown>[]
  warnings: string[]
}> {
  const payloads: Record<string, unknown>[] = []
  const warnings: string[] = []
  const receiver = new LoginReceiver(receiverOptions({
    logger: { warn: (...values: unknown[]) => { warnings.push(values.map(String).join(' ')) } },
    onPayload: async (payload) => {
      payloads.push(payload)
      return onPayload === undefined
        ? { ok: true, message: '登录成功，可以关闭本页并回到 DSH。' }
        : await onPayload(payload)
    },
  }))
  bound.push(receiver)
  const port = await receiver.listen(0)
  const listener = http.listener
  if (listener === undefined) throw new Error('the receiver installed no listener')
  return { receiver, listener, port, payloads, warnings }
}

afterEach(async () => {
  // Close first: teardown settles the replies still in flight, and the order
  // they were written in is only cleared once every one of them has landed.
  for (const receiver of bound.splice(0)) await receiver.close()
  order.length = 0
  http.server = undefined
})

it('serves only loopback peers', () => {
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) expect(isLoopback(address)).toBe(true)
  for (const address of ['10.0.0.7', '127.0.0.2', undefined]) expect(isLoopback(address)).toBe(false)
})

it('binds a loopback port and serves the landing page that settles the relay', async () => {
  const { listener, port, payloads } = await bind()
  expect(port).toBeGreaterThan(0)

  const page = await fetch(`http://127.0.0.1:${port}${CALLBACK_PATH}`)
  const body = await page.text()
  expect(page.status).toBe(200)
  expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(page.headers.get('cache-control')).toBe('no-store')
  expect(page.headers.get('referrer-policy')).toBe('no-referrer')
  expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  expect(Number(page.headers.get('content-length'))).toBe(Buffer.byteLength(body))
  const nonce = /<script nonce="([\w-]+)">/.exec(body)?.[1]
  expect(nonce).toMatch(/^[\w-]{22}$/)
  expect(page.headers.get('content-security-policy'))
    .toBe(`default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'`)
  expect(body).toContain('正在完成登录…')
  expect(body).toContain('new URLSearchParams(location.hash.slice(1))')
  // The page erases the fragment before it posts, so the token cannot be
  // recovered from the address bar afterwards.
  expect(body.indexOf('history.replaceState')).toBeLessThan(body.indexOf('await fetch'))

  const settled = await fetch(`http://127.0.0.1:${port}${COMPLETE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'id-1', refresh_token: 'rt-1' }),
  })
  expect(settled.status).toBe(200)
  expect(await settled.json()).toEqual({ ok: true, message: '登录成功，可以关闭本页并回到 DSH。' })
  expect(payloads).toEqual([{ token: 'id-1', refresh_token: 'rt-1' }])

  // The listener routes the page's own POST, so an unknown route is answered
  // without touching the result.
  const missing = await drive(listener, plainRequest({ url: '/nope' }))
  expect(missing.status).toBe(404)
  expect(missing.headers).toEqual({ 'cache-control': 'no-store' })
})

it('accepts exactly one fragment relay and refuses every later one', async () => {
  const { listener, payloads } = await bind()
  const first = await drive(listener, bodyRequest([Buffer.from('{"token":"id-1"}')]))
  expect(first.status).toBe(200)
  expect(first.headers).toMatchObject({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  expect(first.body).toBe('{"ok":true,"message":"登录成功，可以关闭本页并回到 DSH。"}')
  expect(Number(first.headers?.['content-length'])).toBe(Buffer.byteLength(first.body ?? ''))

  const second = await drive(listener, bodyRequest([Buffer.from('{"token":"id-2"}')]))
  expect(second.status).toBe(409)
  expect(second.body).toBe(JSON.stringify({ ok: false, message: CLOSED_MESSAGE }))
  expect(payloads).toEqual([{ token: 'id-1' }])
})

it('reassembles a fragment body that arrives in several chunks', async () => {
  const { listener, payloads } = await bind()
  const response = await drive(listener, bodyRequest([Buffer.from('{"token":'), Buffer.from('"id-1","state":"s"}')]))
  expect(response.status).toBe(200)
  expect(payloads).toEqual([{ token: 'id-1', state: 's' }])
})

it('refuses a fragment body that is not a JSON object', async () => {
  for (const body of ['not json', '[]', 'null', '"token"', '5']) {
    const { listener, payloads } = await bind()
    const response = await drive(listener, bodyRequest([Buffer.from(body)]))
    expect(response.status).toBe(400)
    expect(response.body).toBe(JSON.stringify({ ok: false, message: '回调数据格式非法。' }))
    expect(payloads).toEqual([])
  }
})

it('reports an oversized fragment body as too large, and holds the cap exactly', async () => {
  const oversized = await bind()
  const tooLarge = await drive(oversized.listener, bodyRequest([Buffer.alloc(MAX_BODY_BYTES), Buffer.from('{')]))
  expect(tooLarge.status).toBe(413)
  expect(tooLarge.body).toBe(JSON.stringify({ ok: false, message: '回调数据过大' }))
  expect(oversized.payloads).toEqual([])

  // A body of exactly the cap is read, then rejected on its content instead.
  const atCap = await bind()
  const rejected = await drive(atCap.listener, bodyRequest([Buffer.alloc(MAX_BODY_BYTES)]))
  expect(rejected.status).toBe(400)
})

it('returns the host verdict when the host refuses the fragment', async () => {
  const { listener } = await bind(() => Promise.resolve({ ok: false, message: 'id_token 签名校验失败' }))
  const response = await drive(listener, bodyRequest([Buffer.from('{"token":"forged"}')]))
  expect(response.status).toBe(400)
  expect(response.body).toBe(JSON.stringify({ ok: false, message: 'id_token 签名校验失败' }))
})

it('answers every other route with 404', async () => {
  const { listener } = await bind()
  for (const request of [
    plainRequest({ method: 'POST', url: CALLBACK_PATH }),
    plainRequest({ method: 'GET', url: COMPLETE_PATH }),
    plainRequest({ method: 'POST', url: '/nope' }),
    // No target at all: the request line's own default is not our page either.
    { method: 'GET', socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage,
  ]) {
    const response = await drive(listener, request)
    expect(response.status).toBe(404)
    expect(response.body).toBeUndefined()
  }
})

it('refuses a peer that is not on this machine', async () => {
  const { listener } = await bind()
  const response = await drive(listener, plainRequest({ url: CALLBACK_PATH, remoteAddress: '10.0.0.7' }))
  expect(response.status).toBe(403)
  expect(response.headers).toEqual({ 'cache-control': 'no-store' })
  expect(response.body).toBeUndefined()
})

it('turns a handler failure into a 500 and a warning', async () => {
  const { listener, warnings } = await bind()
  const response = await drive(listener, {
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    get url(): string { throw new Error('boom') },
  } as unknown as IncomingMessage)
  expect(warnings).toEqual(['[hongling-account] 本地回调处理失败：boom'])
  expect(response.status).toBe(500)
  expect(response.headers).toEqual({ 'cache-control': 'no-store' })
  expect(response.writableEnded).toBe(true)
})

it('leaves a response that already started alone', async () => {
  const warnings: string[] = []
  const receiver = new LoginReceiver(receiverOptions({ logger: { warn: (...values: unknown[]) => { warnings.push(values.map(String).join(' ')) } } }))
  bound.push(receiver)
  await receiver.listen(0)
  const listener = http.listener
  if (listener === undefined) throw new Error('the receiver installed no listener')

  const response = new FakeResponse()
  response.headersSent = true
  response.writableEnded = true
  response.writableFinished = true
  listener({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    get url(): string { throw new Error('late') },
  } as unknown as IncomingMessage, response as unknown as ServerResponse)
  expect(warnings).toEqual(['[hongling-account] 本地回调处理失败：late'])
  expect(response.status).toBeUndefined()
  expect(response.body).toBeUndefined()
})

it('reports a port it could not bind', async () => {
  const occupied = createNetServer()
  await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve))
  const port = (occupied.address() as AddressInfo).port
  const receiver = new LoginReceiver(receiverOptions())
  bound.push(receiver)
  const failure: unknown = await receiver.listen(port).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AuthError)
  expect((failure as AuthError).code).toBe('network')
  expect((failure as AuthError).message.startsWith('无法绑定本地回调端口：')).toBe(true)
  // The failed server is dropped, so the attempt's teardown is a no-op.
  await receiver.close()
  await new Promise<void>((resolve) => { occupied.close(() => { resolve() }) })
})

it('reports a bound socket that is not a TCP port', async () => {
  for (const boundAddress of [null, '\\\\.\\pipe\\dsh-account']) {
    const server = new FakeServer(boundAddress)
    http.server = server as unknown as Server
    const receiver = new LoginReceiver(receiverOptions())
    await expect(receiver.listen(0)).rejects.toThrow(new AuthError('network', '本地回调端口不可用'))
    expect(server.closes).toBe(1)
    await receiver.close()
    expect(server.closes).toBe(1)
  }
})

it('adopts the port a server reports and closes its connections on teardown', async () => {
  const server = new FakeServer({ address: '127.0.0.1', family: 'IPv4', port: 43_210 })
  http.server = server as unknown as Server
  const receiver = new LoginReceiver(receiverOptions())
  await expect(receiver.listen(0)).resolves.toBe(43_210)
  await receiver.close()
  expect(server.closes).toBe(1)
  expect(server.idleCloses).toBe(1)
  expect(server.connectionCloses).toBe(1)
  // Closing twice must not touch the server again.
  await receiver.close()
  expect(server.closes).toBe(1)
})

it('closes a receiver that never bound a port', async () => {
  await new LoginReceiver(receiverOptions()).close()
})

it('releases a connection whose handler failed outside the routing guards', async () => {
  const server = new FakeServer({ address: '127.0.0.1', family: 'IPv4', port: 43_210 })
  http.server = server as unknown as Server
  const receiver = new LoginReceiver(receiverOptions({
    logger: { warn: () => { throw new Error('logger down') } },
  }))
  bound.push(receiver)
  await receiver.listen(0)
  const listener = http.listener
  if (listener === undefined) throw new Error('the receiver installed no listener')
  // The guards' own failure path reports through the logger; a logger that
  // fails turns that into a rejected handler, whose rejection is consumed
  // rather than left to wedge the connection's teardown.
  listener({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    get url(): string { throw new Error('boom') },
  } as unknown as IncomingMessage, new FakeResponse() as unknown as ServerResponse)
  await receiver.close()
  expect(server.connectionCloses).toBe(1)
})

it('writes the reply still in flight, and lets it land, before releasing that connection', async () => {
  const server = new FakeServer({ address: '127.0.0.1', family: 'IPv4', port: 43_210 })
  http.server = server as unknown as Server
  const gate = Promise.withResolvers<undefined>()
  const { receiver, listener } = await bind(async () => {
    await gate.promise
    return { ok: true, message: '登录成功' }
  })
  const response = new FakeResponse()
  listener(bodyRequest([Buffer.from('{"token":"id-1"}')]), response as unknown as ServerResponse)
  const closing = receiver.close()
  gate.resolve()
  await closing
  expect(response.status).toBe(200)
  expect(response.body).toBe('{"ok":true,"message":"登录成功"}')
  // The reply reaches the socket before anything is closed, and the connection
  // carrying it is closed politely rather than reset.
  expect(order).toEqual(['reply-written', 'reply-flushed', 'idle-connections-closed', 'connections-destroyed'])
})

it('answers the landing page over a real socket while the attempt ends', async () => {
  const arrived = Promise.withResolvers<undefined>()
  const gate = Promise.withResolvers<undefined>()
  const { receiver, port } = await bind(async () => {
    arrived.resolve(undefined)
    await gate.promise
    return { ok: true, message: '登录成功，可以关闭本页并回到 DSH。' }
  })
  // The page posts, the host settles the login, and the attempt ends the moment
  // it does — closing the receiver with the page's answer still in flight.
  const answered = fetch(`http://127.0.0.1:${port}${COMPLETE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'id-1' }),
  })
  await arrived.promise
  const closing = receiver.close()
  gate.resolve()
  const response = await answered
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, message: '登录成功，可以关闭本页并回到 DSH。' })
  await closing
})
