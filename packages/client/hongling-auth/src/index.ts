/**
 * 虹灵 enterprise-SSO login plugin, host half.
 *
 * The browser never sees a token. It asks this half to start a login, this
 * half opens a loopback receiver and sends the operator to the market
 * backend, the backend relays the IdP's answer back to that receiver, and the
 * resulting id_token is verified and stored under the harness home. The
 * browser reads redacted state over the `/hongling-auth` RPC channel and
 * other plugins' host halves read the token through `ctx.honglingAuth`.
 *
 * The backend is a confidential OIDC client, so this plugin holds no client
 * secret and renews the session with a `/dsh/refresh` round trip rather than
 * an authorization-code exchange of its own.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import z from '@deepseek-ai/schemastery'
import { createBrowserLauncher } from './browser.ts'
import { CHANNEL } from './channel.ts'
import { authFilePath, resolveConfig, type ResolvedConfig } from './config.ts'
import { AuthError, messageOf } from './errors.ts'
import { AuthRuntime } from './runtime.ts'
import type { AuthRpcEndpoint, HonglingAuthService } from './types.ts'

export type { AuthProfile, AuthRpc, AuthRpcEndpoint, AuthStatus, HonglingAuthService, LoginPhase, LoginProgress } from './types.ts'
export { authFilePath, resolveConfig } from './config.ts'
export { CHANNEL } from './channel.ts'
export { AuthError } from './errors.ts'
export type { ResolvedConfig } from './config.ts'

/** Stable Cordis plugin name. */
export const name = 'hongling-auth'

/**
 * Required service: the transport that authenticates and carries the RPC
 * channel. `webServer` is not listed here — the browser channel injects it at
 * its registration site, so a host without one still publishes the service.
 */
export const inject = ['connection']

/** Raw plugin config as authored in `cordis.patch.yml`. */
export interface Config {
  /** Market backend origin, without the `/api/v1` suffix. */
  backendUrl?: string
  /** Fixed loopback port for SSH port-forwarding setups; a random port otherwise. */
  redirectPort?: number
  /** Verify the id_token signature against the issuer's JWKS. */
  verifyLocal?: boolean
  /** Expose `auth.devLogin`, which mirrors the backend's `AUTH_MODE=dev` injection. */
  devAuth?: boolean
}

export const Config: z<Config> = z.object({
  backendUrl: z.string(),
  redirectPort: z.number().step(1).min(1024).max(65535),
  verifyLocal: z.boolean().default(true),
  devAuth: z.boolean().default(false),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 虹灵 login state, for other plugins' host halves that proxy upstream calls. */
    honglingAuth: HonglingAuthService
  }
}

/** The endpoint set this channel owns; anything else is refused before dispatch. */
const ENDPOINTS = new Set<string>([
  'auth.getStatus',
  'auth.login',
  'auth.getLoginProgress',
  'auth.cancelLogin',
  'auth.logout',
  'auth.devLogin',
])

/** Payload is an object for every endpoint in the table. */
function asPayload(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
}

/**
 * Mount the plugin.
 * @param ctx - the host context, already carrying `connection`.
 * @param rawConfig - the authored config block from the composition.
 */
export function apply(ctx: Context, rawConfig: Config = {}): void {
  const config: ResolvedConfig = resolveConfig(rawConfig)
  const runtime = new AuthRuntime({
    config,
    logger: ctx.logger,
    file: authFilePath(),
    launch: createBrowserLauncher(ctx.logger),
  })

  // Adopt a token left by a previous run. A failure here is not fatal: the
  // operator simply sees the logged-out panel and can sign in again.
  void runtime.restore().catch((error: unknown) => {
    ctx.logger.warn('[hongling-auth] 恢复登录态失败：' + messageOf(error))
  })

  ctx.provide('honglingAuth', runtime.service())

  // The channel is a physical route on the web server, so it mounts only where
  // a browser transport exists: a headless composition keeps the service and
  // simply has no channel to answer. Declaring `webServer` here also states
  // that dependency plainly, rather than letting the mount fail at request time.
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.connection.rpc.handle(CHANNEL, async (endpoint, payload) => {
        if (!ENDPOINTS.has(endpoint)) {
          return { ok: false, error: { code: 'unknown-endpoint', message: '未知端点：' + endpoint, details: {} } }
        }
        try {
          return { ok: true, value: await runtime.dispatch(endpoint as AuthRpcEndpoint, asPayload(payload)) }
        } catch (error) {
          const message = messageOf(error)
          if (error instanceof AuthError) {
            webCtx.logger.warn('[hongling-auth] ' + endpoint + ' failed [' + error.code + ']: ' + message)
          } else {
            webCtx.logger.error(error)
          }
          return { ok: false, error: { code: 'command-error', message, details: {} } }
        }
      }),
      'hongling-auth: rpc channel ' + CHANNEL,
    )

    webCtx.logger.info('[hongling-auth] RPC 通道已注册：' + CHANNEL)
  })

  ctx.effect(() => () => { runtime.dispose() }, 'hongling-auth: loopback session cleanup')

  // Mount state, not channel state: a composition without a web server keeps
  // the service and this line, and simply has no browser channel to answer.
  ctx.logger.info(
    '[hongling-auth] 插件已挂载（backendUrl=' + config.backendUrl +
      '，verifyLocal=' + String(config.verifyLocal) + '，devAuth=' + String(config.devAuth) + '）',
  )
}
