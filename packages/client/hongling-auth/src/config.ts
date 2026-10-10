/**
 * Pure configuration resolution and on-disk locations for the 虹灵 SSO
 * plugin. Every external input (plugin config and process environment) is a
 * parameter, so the whole surface is testable without a process.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/config
 */

import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { Config } from './index.ts'

/** Environment variable overriding the market backend address. */
export const BACKEND_URL_ENV = 'HONGLING_DSH_BACKEND_URL'
/** Environment variable pinning the loopback receiver's port. */
export const REDIRECT_PORT_ENV = 'HONGLING_DSH_OIDC_REDIRECT_PORT'
/** Environment variable disabling local JWKS signature verification. */
export const VERIFY_LOCAL_ENV = 'HONGLING_DSH_OIDC_VERIFY_LOCAL'

/** Market backend address used when neither config nor environment names one. */
export const DEFAULT_BACKEND_URL = 'https://agent-sphere.changhong.com'

/** Lowest port the loopback receiver accepts when pinned explicitly. */
const MIN_PORT = 1024
/** Highest assignable port. */
const MAX_PORT = 65535

/** Config after defaults, environment fallbacks, and validation. */
export interface ResolvedConfig {
  backendUrl: string
  redirectPort?: number
  verifyLocal: boolean
  devAuth: boolean
}

/** Environment subset this plugin reads. */
export type ConfigEnv = Record<string, string | undefined>

/** Treat an absent, empty, or whitespace-only string as unset. */
function envValue(env: ConfigEnv, name: string): string | undefined {
  const raw = env[name]
  return raw === undefined || raw.trim() === '' ? undefined : raw
}

/**
 * Resolve the effective config: explicit plugin config wins over the
 * environment, which wins over the built-in default. A pinned `redirectPort`
 * outside the assignable range is ignored rather than fatal, so a bad
 * environment value degrades to a random port instead of blocking startup.
 * @param raw - the plugin's authored config.
 * @param env - process environment used for fallbacks.
 * @returns the effective config.
 */
export function resolveConfig(raw: Config = {}, env: ConfigEnv = process.env): ResolvedConfig {
  const backendUrl = raw.backendUrl ?? envValue(env, BACKEND_URL_ENV) ?? DEFAULT_BACKEND_URL
  const portRaw = raw.redirectPort ?? envValue(env, REDIRECT_PORT_ENV)
  const port = typeof portRaw === 'number' ? portRaw : Number(portRaw)
  const verifyRaw = raw.verifyLocal ?? envValue(env, VERIFY_LOCAL_ENV)
  return {
    backendUrl: backendUrl.replace(/\/+$/u, ''),
    ...(Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? { redirectPort: port } : {}),
    verifyLocal: resolveVerifyLocal(verifyRaw),
    devAuth: raw.devAuth === true,
  }
}

/** Absent means verify; a string form is falsy only when it spells an explicit "no". */
function resolveVerifyLocal(value: boolean | string | undefined): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return !/^(0|false|no)$/iu.test(value)
  return true
}

/**
 * Absolute path of the 0600 token file below the harness home.
 * @returns the token file path for this installation.
 */
export function authFilePath(): string {
  return dshHomePath('hongling-auth', 'auth.json')
}
