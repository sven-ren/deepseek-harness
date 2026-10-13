/**
 * Loopback receiver for the relayed login result.
 *
 * The company relay finishes the OIDC code exchange on its own server and
 * returns the tokens to the operator's browser in the URL fragment. A fragment
 * is never sent to a server, so the relay has to land the browser on a page we
 * control; this module is that page and the two-endpoint server behind it.
 *
 * Two properties carry the security of the arrangement:
 *
 * - Only IPv4/IPv6 loopback peers are served, so no other host that can reach
 *   the port ever sees a response.
 * - The landing page posts the fragment back under a one-shot lock, so a
 *   second request cannot overwrite the result of the first.
 *
 * The server is bound by the attempt and closed with it, which is why it takes
 * a port rather than reading the host's web server: the relay's contract is a
 * loopback port, not the host's externally visible origin.
 *
 * @module @deepseek-ai/dsh-hongling-account/login-session
 */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { AuthError, messageOf } from './errors.ts'

/** Path the relay returns the browser to. */
export const CALLBACK_PATH = '/callback'
/** Path the landing page posts the fragment to. */
export const COMPLETE_PATH = '/complete'
/** Largest fragment-bearing body accepted from the landing page. */
export const MAX_BODY_BYTES = 256 * 1024

/** What the landing page renders once the host has settled the login. */
export interface CompletionResult {
  /** Whether the login completed and a credential is stored. */
  readonly ok: boolean
  /** Operator-facing text for the landing page; never a token. */
  readonly message: string
}

/** Narrow logger face used by the receiver. */
export interface ReceiverLogger {
  warn(...values: unknown[]): void
}

/** Host behaviour the receiver calls into. */
export interface LoginReceiverOptions {
  logger: ReceiverLogger
  /** Hand the relayed fragment to the host, and reply only when it settles. */
  onPayload: (payload: Record<string, unknown>) => Promise<CompletionResult>
}

/** Reply for a request that arrives after this attempt already settled. */
const CLOSED_REPLY: CompletionResult = { ok: false, message: '登录会话已关闭，请回到 DSH 重新登录。' }

/**
 * Whether a peer address is a loopback address.
 * @param address - `req.socket.remoteAddress`, possibly IPv4-mapped or undefined.
 * @returns whether the request originates from this machine.
 */
export function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * The page the relay lands on.
 *
 * It reads the fragment, immediately erases it from the address bar so a
 * shoulder-surfer or a later screenshot cannot recover the token, and posts it
 * to the host. It renders the host's own message, so failure text never has to
 * be reproduced in this template.
 * @param nonce - per-response script nonce matching the response's policy header.
 * @returns the complete HTML document.
 */
function callbackPage(nonce: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<title>登录</title>
<body style="font-family:system-ui;margin:3rem">
<p id="message">正在完成登录…</p>
<script nonce="${nonce}">
(async function () {
  var text = function (value) { document.getElementById('message').textContent = value }
  var params = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname)
  try {
    var response = await fetch(${JSON.stringify(COMPLETE_PATH)}, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(params)),
    })
    var result = await response.json()
    text(result.message || (result.ok ? '登录成功，可以关闭本页并回到 DSH。' : '登录失败，请回到 DSH 重试。'))
  } catch (error) {
    text('登录失败：无法与本地 DSH 通信，请回到 DSH 重试。')
  }
})()
</script>
</body>
</html>
`
}

/** One attempt's loopback server; created per attempt and closed with it. */
export class LoginReceiver {
  private server: Server | undefined
  private settled = false
  /** Replies still being written; {@link close} lets them land before it destroys connections. */
  private readonly pending = new Set<Promise<void>>()
  /** @param options - logging and the host callback that settles the login. */
  constructor(private readonly options: LoginReceiverOptions) {}

  /**
   * Bind the loopback port and start serving.
   * @param port - requested port, or 0 for any free port.
   * @returns the port actually bound, which is what the relay is told to use.
   * @throws AuthError when the port cannot be bound.
   */
  async listen(port: number): Promise<number> {
    const server = createServer((request, response) => {
      const handled = this.handle(request, response)
      this.pending.add(handled)
      void handled.then(() => { this.pending.delete(handled) }, () => { this.pending.delete(handled) })
    })
    this.server = server
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
      })
    } catch (error) {
      server.close()
      this.server = undefined
      throw new AuthError('network', '无法绑定本地回调端口：' + messageOf(error))
    }
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      this.server = undefined
      throw new AuthError('network', '本地回调端口不可用')
    }
    return address.port
  }

  /**
   * Stop serving; safe to call more than once.
   *
   * The listening socket goes first, then every reply still being written — the
   * landing page is owed an answer for the fragment it posted, and cutting that
   * connection before the answer leaves this process would report a successful
   * login as a local communication failure. Answered connections are then
   * closed politely, so their replies are read rather than reset, and only what
   * is left is cut.
   */
  async close(): Promise<void> {
    const server = this.server
    this.server = undefined
    if (server === undefined) return
    server.close()
    await Promise.allSettled([...this.pending])
    server.closeIdleConnections()
    server.closeAllConnections()
  }

  /** Route one request, rejecting everything that is not our two local endpoints. */
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      if (!isLoopback(request.socket.remoteAddress)) {
        response.writeHead(403, { 'cache-control': 'no-store' }).end()
        await flushed(response)
        return
      }
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'GET' && url.pathname === CALLBACK_PATH) {
        const nonce = randomBytes(16).toString('base64url')
        await this.respond(response, 200, 'text/html; charset=utf-8', callbackPage(nonce), nonce)
        return
      }
      if (request.method === 'POST' && url.pathname === COMPLETE_PATH) {
        await this.handleComplete(request, response)
        return
      }
      response.writeHead(404, { 'cache-control': 'no-store' }).end()
      await flushed(response)
    } catch (error) {
      this.options.logger.warn('[hongling-account] 本地回调处理失败：' + messageOf(error))
      if (!response.headersSent) response.writeHead(500, { 'cache-control': 'no-store' })
      if (!response.writableEnded) response.end()
      await flushed(response)
    }
  }

  /** One-shot fragment relay: owns the result from the first accepted request. */
  private async handleComplete(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: string
    try {
      body = await readBody(request)
    } catch (error) {
      await this.writeResult(response, 413, { ok: false, message: messageOf(error) })
      return
    }
    if (this.settled) {
      await this.writeResult(response, 409, CLOSED_REPLY)
      return
    }
    this.settled = true
    let payload: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(body)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('payload is not an object')
      payload = parsed as Record<string, unknown>
    } catch {
      await this.writeResult(response, 400, { ok: false, message: '回调数据格式非法。' })
      return
    }
    const result = await this.options.onPayload(payload)
    await this.writeResult(response, result.ok ? 200 : 400, result)
  }

  /** Write one completion reply, never caching it, and let it leave the process. */
  private async writeResult(response: ServerResponse, status: number, result: CompletionResult): Promise<void> {
    await this.respond(response, status, 'application/json; charset=utf-8', JSON.stringify(result))
  }

  /**
   * Write one response under the headers this surface always carries.
   * @param response - the reply under construction.
   * @param status - HTTP status code.
   * @param contentType - response content type.
   * @param body - complete response body.
   * @param nonce - script nonce for an HTML body, matching its policy header.
   */
  private async respond(response: ServerResponse, status: number, contentType: string, body: string, nonce?: string): Promise<void> {
    response.writeHead(status, {
      'content-type': contentType,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      ...nonce === undefined
        ? {}
        : { 'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'` },
    }).end(body)
    await flushed(response)
  }
}

/**
 * Resolve once a reply has left this process.
 *
 * `end` only queues the bytes: the response has finished when the socket took
 * them, which is what `close` has to wait for before it may cut the connection
 * carrying them. A response whose connection died first finishes the wait too —
 * a page that abandoned its post is not owed an answer.
 * @param response - the reply under construction.
 * @returns a promise that settles with the response.
 */
function flushed(response: ServerResponse): Promise<void> {
  /* v8 ignore next -- a fresh reply has not finished yet, and `close` reaches the events below for one that has. */
  if (response.writableFinished || response.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    response.once('finish', resolve)
    response.once('close', resolve)
  })
}

/**
 * Read a request body under the size cap.
 * @param request - the incoming request.
 * @returns the decoded body text.
 * @throws Error when the body exceeds {@link MAX_BODY_BYTES}.
 */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    size += buffer.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('回调数据过大')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
