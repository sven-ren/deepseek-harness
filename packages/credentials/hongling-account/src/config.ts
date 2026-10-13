/**
 * Deployment choices for the 虹灵 enterprise SSO account provider.
 *
 * Every field has a working default for the Changhong deployment, so a home
 * patch may override just the two that differ per environment (`brokerOrigin`
 * and `inferenceOrigin`) rather than restating a whole origin table.
 *
 * @module @deepseek-ai/dsh-hongling-account/config
 */

import Schema from '@deepseek-ai/schemastery'

/** Deployment-specific origins and deadlines. */
export interface Config {
  /** Origin of the company login relay that owns the browser round trip and the code exchange. */
  brokerOrigin?: string
  /** Issuer the relayed id_token must declare; an empty string accepts any issuer. */
  issuer?: string
  /** JWKS endpoint of that issuer, read only for local signature verification. */
  jwksUri?: string
  /** Exact origin allowed to receive the account token for model inference. */
  inferenceOrigin?: string
  /** Browser destination for the usage page; must be an absolute https URL. */
  usageUrl?: string
  /** Browser destination for the top-up page; must be an absolute https URL. */
  topUpUrl?: string
  /** Verify the id_token signature locally whenever the issuer's keys are reachable. */
  verifyLocal?: boolean
  /** Local port for the loopback receiver; 0 selects a free port. */
  callbackPort?: number
  /** Upper bound for one login attempt, including the browser round trip. */
  attemptTimeoutMs?: number
}

/** Validated deployment choices. */
export const Config = Schema.object({
  brokerOrigin: Schema.string().default('https://agent-sphere.changhong.com'),
  // Left unpinned by default. The trust anchor is the signature check against
  // jwksUri, not an `iss` string match, and the relay is free to re-issue the
  // token under its own issuer — which would make a pinned default reject the
  // first successful login. Set this once the real `iss` is known.
  issuer: Schema.string().default(''),
  jwksUri: Schema.string().default('https://account-xc.changhong.com/keys'),
  inferenceOrigin: Schema.string().default('https://maas.changhong.com'),
  usageUrl: Schema.string().default('https://agent-sphere.changhong.com'),
  topUpUrl: Schema.string().default('https://agent-sphere.changhong.com'),
  verifyLocal: Schema.boolean().default(true),
  callbackPort: Schema.number().min(0).max(65_535).step(1).default(0),
  attemptTimeoutMs: Schema.number().min(1).max(3_600_000).default(300_000),
})

/**
 * Accept an HTTP(S) origin without credentials, path, query or fragment.
 * @param value - candidate origin.
 * @param label - option name used in the failure message.
 * @returns the normalized origin.
 * @throws Error when the value is not a bare HTTP(S) origin.
 */
export function requireOrigin(value: string, label: string): string {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`account: ${label} must be an HTTP(S) origin without credentials, path, query or fragment`)
  }
  return url.origin
}

/**
 * Accept a browser or key-list destination.
 *
 * The Desktop validates both account-menu links before it will publish any
 * account state, so a malformed value here would break the whole account
 * stream rather than just one menu item; rejecting it at construction keeps
 * that failure at boot instead of in the UI.
 * @param value - candidate URL.
 * @param label - option name used in the failure message.
 * @returns the normalized href.
 * @throws Error when the value is neither https nor a loopback http URL.
 */
export function requireHttpsUrl(value: string, label: string): string {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`account: ${label} must be an absolute https URL, or loopback http`)
  }
  if (url.username || url.password) throw new Error(`account: ${label} must not carry credentials`)
  return url.href
}
