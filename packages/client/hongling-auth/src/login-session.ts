/**
 * The loopback receiver that completes a browser login.
 *
 * The backend relay returns the operator to `http://127.0.0.1:<port>/callback`
 * with the tokens in the URL *fragment*, which browsers never send to a
 * server. The served page therefore reads `location.hash` itself, erases it
 * from the address bar, and POSTs the pairs back to `/complete` on the same
 * origin. The listener binds only to the IPv4 loopback, accepts exactly one
 * completion (or one cancellation, or a timeout), and closes immediately
 * afterwards.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/login-session
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { AuthError, messageOf } from './errors.ts'
import type { LoginPhase, LoginProgress } from './types.ts'

/** Login session deadline, matching the backend's own OIDC state lifetime. */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
/** Request-body ceiling for `/complete`; the payload is a few small strings. */
export const MAX_BODY_BYTES = 256 * 1024
/** Path to the callback page the browser is returned to. */
export const CALLBACK_PATH = '/callback'
/** Path the callback page posts the fragment back to. */
export const COMPLETE_PATH = '/complete'

/** The answer to a completion that arrives for a receiver that no longer owns a login. */
const CLOSED_REPLY = { ok: false, message: '登录会话已关闭' }

/** Outcome of handing a completed payload to the verifier. */
export interface CompletionResult {
  ok: boolean
  message?: string
}

/** Narrow logger face used by the receiver. */
export interface SessionLogger {
  info(...values: unknown[]): void
  warn(...values: unknown[]): void
  error(...values: unknown[]): void
}

/** Hand a URL to the operating system's default browser. */
export type LaunchExternal = (url: string) => void

/** Effects {@link LoginSessionRegistry} performs, injected for testing. */
export interface LoginSessionInternals {
  launch: LaunchExternal
  logger: SessionLogger
  /** Verify and store the tokens the callback delivered; `idToken` is the validated `payload.token`. */
  complete: (idToken: string, payload: Record<string, unknown>) => Promise<CompletionResult>
  /** Session deadline; a short value keeps timeout behavior testable. */
  timeoutMs?: number
}

/** One in-flight login. */
interface Session {
  server: Server
  port: number
  /** A live receiver is never `done`: that phase is reported for a closed session once a login exists. */
  phase: Exclude<LoginPhase, 'done'>
  loginUrl: string
  message?: string
  timer: ReturnType<typeof setTimeout>
}

/** The served callback page: read the fragment, wipe it, post it home. */
const CALLBACK_PAGE = [
  '<!doctype html><html><head><meta charset="utf-8"><title>hongling-auth</title></head><body>',
  '<p id="msg">正在完成登录…</p>',
  '<script>(async()=>{const el=document.getElementById("msg");',
  'const params=Object.fromEntries(new URLSearchParams(location.hash.slice(1)));',
  'history.replaceState(null,"",location.pathname);',
  'try{const r=await fetch("/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(params)});',
  'const d=await r.json();el.textContent=d.ok?"登录成功，可以关闭本页并回到 DSH。":"登录失败："+(d.message||"未知错误");}',
  'catch(e){el.textContent="登录回调提交失败："+e}})()</script>',
  '</body></html>',
].join('')

/**
 * Whether a peer address belongs to the IPv4 loopback.
 * @param remoteAddress - the socket's peer address.
 * @returns whether the receiver accepts a callback from that address.
 */
export function isLoopback(remoteAddress: string): boolean {
  return (
    remoteAddress === '127.0.0.1' ||
    remoteAddress === '::1' ||
    remoteAddress === '::ffff:127.0.0.1' ||
    remoteAddress.startsWith('127.') ||
    remoteAddress.startsWith('::ffff:127.')
  )
}

/**
 * Read a request body as text, refusing anything over the ceiling.
 * @param req - the incoming request whose body is read.
 * @returns the body decoded as UTF-8 text.
 * @throws AuthError when the body exceeds {@link MAX_BODY_BYTES}.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new AuthError('PAYLOAD_TOO_LARGE', '请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
    req.on('error', reject)
  })
}

/** Write one JSON response. */
function replyJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Write the callback page. */
function replyHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html)
}

/**
 * Owns the loopback receiver for the plugin's lifetime. There is at most one
 * login in flight: starting a second reuses the first, and a session that
 * already succeeded or failed is torn down before a new one opens.
 */
export class LoginSessionRegistry {
  private session: Session | null = null
  private readonly internals: LoginSessionInternals

  /** @param internals - browser launcher, logger, verifier, and deadline. */
  constructor(internals: LoginSessionInternals) {
    this.internals = internals
  }

  /**
   * Open the receiver and send the operator to the backend's login relay.
   * @param backendUrl - market backend origin, without a trailing slash.
   * @param redirectPort - fixed loopback port, or undefined for an ephemeral one.
   * @returns the login URL, which the panel also offers for manual copying.
   * @throws AuthError when the loopback port cannot be bound.
   */
  async start(backendUrl: string, redirectPort: number | undefined): Promise<{ started: boolean; loginUrl: string }> {
    if (this.session !== null && this.session.phase !== 'error') {
      return { started: true, loginUrl: this.session.loginUrl }
    }
    this.close()
    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch((error: unknown) => {
        this.internals.logger.error(error)
        replyJson(res, 500, { ok: false, message: 'internal error' })
      })
    })
    let port: number
    try {
      port = await listen(server, redirectPort ?? 0)
    } catch (error) {
      // The platform error already names the address and port it could not
      // bind, so the operator reads the reason and the target from one line.
      throw new AuthError('LISTEN_FAILED', 'loopback 监听失败：' + messageOf(error))
    }
    const loginUrl = `${backendUrl}/dsh/login?port=${String(port)}`
    const timer = setTimeout(() => { this.fail('登录超时（5 分钟），请重试') }, this.internals.timeoutMs ?? LOGIN_TIMEOUT_MS)
    // The Host half only ever runs on Node; an unref'd deadline never keeps
    // the process alive on its own.
    timer.unref()
    this.session = { server, port, phase: 'waiting_browser', loginUrl, timer }
    this.internals.launch(loginUrl)
    this.internals.logger.info(`[hongling-auth] 登录会话已启动：http://127.0.0.1:${String(port)}${CALLBACK_PATH}`)
    return { started: true, loginUrl }
  }

  /** Close any in-flight login without recording an error. */
  cancel(): void {
    this.close()
  }

  /** Release the receiver; safe to call at any point. */
  dispose(): void {
    this.close()
  }

  /**
   * Current progress, reporting a finished session as `done` once a login exists.
   * @param loggedIn - whether the runtime already holds a token.
   * @returns the progress line the browser polls.
   */
  progress(loggedIn: boolean): LoginProgress {
    if (this.session === null) return { phase: loggedIn ? 'done' : 'idle' }
    return {
      phase: this.session.phase,
      loginUrl: this.session.loginUrl,
      ...(this.session.message === undefined ? {} : { message: this.session.message }),
    }
  }

  /**
   * One request against the receiver. Exposed for direct tests.
   * @param req - the incoming loopback request.
   * @param res - the response to answer it with.
   * @returns a promise that settles once the response is written.
   */
  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLoopback(req.socket.remoteAddress ?? '')) {
      replyJson(res, 403, { error: 'loopback only' })
      return
    }
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (req.method === 'GET' && pathname === CALLBACK_PATH) {
      if (this.session !== null) this.session.phase = 'receiving'
      replyHtml(res, 200, CALLBACK_PAGE)
      return
    }
    if (req.method === 'POST' && pathname === COMPLETE_PATH) {
      await this.handleComplete(req, res)
      return
    }
    replyJson(res, 404, { error: 'not found' })
  }

  /** Decode one `/complete` submission and hand it to the verifier. */
  private async handleComplete(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const owned = this.session
    if (owned === null) {
      replyJson(res, 400, CLOSED_REPLY)
      return
    }
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(await readBody(req)) as Record<string, unknown>
    } catch {
      replyJson(res, 400, { ok: false, message: 'bad json' })
      return
    }
    // The operator may have cancelled — or the plugin unloaded — while the
    // body was still arriving, so the receiver no longer owns this login and
    // must not adopt the tokens it just read.
    if (this.session !== owned) {
      replyJson(res, 400, CLOSED_REPLY)
      return
    }
    const relayed = typeof payload.error === 'string' ? payload.error : ''
    if (relayed !== '') {
      this.fail(relayed)
      replyJson(res, 400, { ok: false, message: relayed })
      return
    }
    const idToken = typeof payload.token === 'string' ? payload.token : ''
    if (idToken === '') {
      this.fail('回调缺少 token')
      replyJson(res, 400, { ok: false, message: '回调缺少 token' })
      return
    }
    owned.phase = 'verifying'
    const result = await this.internals.complete(idToken, payload)
    if (result.ok) {
      this.close()
    } else {
      this.fail(result.message ?? '登录失败')
    }
    replyJson(res, result.ok ? 200 : 400, result)
  }

  /** Record a failure and stop listening, keeping the message for the panel. */
  private fail(message: string): void {
    if (this.session === null) return
    this.session.phase = 'error'
    this.session.message = message
    clearTimeout(this.session.timer)
    this.session.server.close()
  }

  /** Drop the session and stop listening. */
  private close(): void {
    if (this.session === null) return
    clearTimeout(this.session.timer)
    this.session.server.close()
    this.session = null
  }
}

/** Bind a server to the IPv4 loopback and report the port it got. */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { resolve((server.address() as AddressInfo).port) })
  })
}
