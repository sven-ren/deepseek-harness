/**
 * id_token decoding, claim projection, and JWKS signature verification.
 *
 * The company IdP issues the token to a backend relay, which hands it to the
 * operator's browser and the browser hands it to our loopback receiver. Since
 * the token arrives over a redirect rather than from the issuer directly,
 * signature verification is the only thing that makes it trustworthy: without
 * it, anything able to reach the loopback port could inject an identity.
 *
 * Verification is therefore deliberate about its two tiers. Expiry is always
 * enforced. The signature check is enforced when a key can be fetched, and
 * degrades to a warning when the JWKS endpoint is unreachable — the relay
 * re-verifies every request it proxies, so an unreachable key list is an
 * availability failure rather than a forged token.
 *
 * @module @deepseek-ai/dsh-hongling-account/jwt
 */

import { createPublicKey, createVerify, type JsonWebKey as NodeJsonWebKey } from 'node:crypto'
import { AuthError, messageOf } from './errors.ts'

/** Cache lifetime for a fetched JWKS. */
export const JWKS_TTL_MS = 5 * 60 * 1000
/** Request deadline for one JWKS fetch. */
export const JWKS_TIMEOUT_MS = 10_000

/** A decoded JWT split into the pieces verification needs. */
export interface JwtParts {
  header: { alg?: string; kid?: string }
  claims: Record<string, unknown>
  /** The signed `header.payload` prefix. */
  signingInput: string
  signature: Buffer
}

/** One JSON Web Key as published by the issuer. */
export interface Jwk {
  kty: string
  kid?: string
  [key: string]: unknown
}

/** The identity one verified id_token names. */
export interface Identity {
  /** `iss` claim; empty when the token declares none. */
  readonly issuer: string
  /** `sub` claim, the stable account identifier. */
  readonly subject: string
  /** Display name for the account menu; null when the token names none. */
  readonly name: string | null
  /** Contact shown under the name; null when the token names none. */
  readonly contact: string | null
  /** `exp` in epoch milliseconds, absent when the token declares no expiry. */
  readonly expiresAt: number | undefined
}

/** Narrow logger face used by verification. */
export interface VerificationLogger {
  warn(...values: unknown[]): void
}

/** Injectable effects, so verification runs without a network or a clock. */
export interface VerificationInternals {
  fetch?: typeof globalThis.fetch
  now?: () => number
}

/**
 * Decode a compact JWS into its header, claims, signed input, and signature.
 * @param token - the compact serialized JWT.
 * @returns the decoded parts.
 * @throws AuthError when the token is not three base64url segments of JSON.
 */
export function decodeJwt(token: string): JwtParts {
  const [encodedHeader, encodedClaims, encodedSignature, ...extra] = token.split('.')
  if (encodedHeader === undefined || encodedClaims === undefined || encodedSignature === undefined || extra.length > 0) {
    throw new AuthError('protocol', 'id_token 格式非法')
  }
  let header: JwtParts['header']
  let claims: Record<string, unknown>
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as JwtParts['header']
    claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new AuthError('protocol', 'id_token 解析失败')
  }
  return {
    header,
    claims,
    signingInput: encodedHeader + '.' + encodedClaims,
    signature: Buffer.from(encodedSignature, 'base64url'),
  }
}

/**
 * First non-empty string claim among the candidate keys.
 * @param claims - the decoded claim set.
 * @param keys - candidate claim names, most preferred first.
 * @returns the first non-empty string value, or the empty string.
 */
export function firstString(claims: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = claims[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return ''
}

/**
 * Project the identity a token names.
 * @param parts - the decoded token.
 * @returns the identity, with null for each display field the token omits.
 */
export function identityOf(parts: JwtParts): Identity {
  const name = firstString(parts.claims, ['name', 'preferred_username', 'employee_no'])
  const contact = firstString(parts.claims, ['email', 'phone', 'mobile'])
  const expiresAt = typeof parts.claims.exp === 'number' ? parts.claims.exp * 1000 : undefined
  return {
    issuer: firstString(parts.claims, ['iss']),
    subject: firstString(parts.claims, ['sub', 'user_id', 'employee_no']),
    name: name === '' ? null : name,
    contact: contact === '' ? null : contact,
    expiresAt,
  }
}

/** The hash a JWS algorithm family signs over, or undefined when unsupported. */
function hashForAlgorithm(alg: string): string | undefined {
  if (alg.endsWith('256')) return 'SHA256'
  if (alg.endsWith('384')) return 'SHA384'
  if (alg.endsWith('512')) return 'SHA512'
  return undefined
}

/**
 * Project a published JWK onto the string-only shape `createPublicKey`
 * accepts. A JWKS entry may carry members Node's type does not declare, such
 * as a `key_ops` array, so the copy keeps the string values only.
 * @param jwk - the key selected by `kid`.
 * @returns the same key restricted to its string members.
 */
function nodeJwk(jwk: Jwk): NodeJsonWebKey {
  const key: NodeJsonWebKey = {}
  for (const [name, value] of Object.entries(jwk)) {
    if (typeof value === 'string') Object.assign(key, { [name]: value })
  }
  return key
}

/**
 * Verify one JWS signature against a JWK.
 *
 * Only the RSA (`RS*`) and ECDSA (`ES*`) families an OIDC issuer publishes are
 * accepted; ECDSA signatures are read in the JOSE-mandated raw r||s form
 * rather than the DER form `node:crypto` defaults to.
 * @param parts - the decoded token.
 * @param jwk - the key selected by `kid`.
 * @returns whether the signature is valid for this key.
 */
export function verifyJwtSignature(parts: JwtParts, jwk: Jwk): boolean {
  const alg = parts.header.alg ?? ''
  const hash = hashForAlgorithm(alg)
  if (hash === undefined) return false
  try {
    const key = createPublicKey({ key: nodeJwk(jwk), format: 'jwk' })
    const verifier = createVerify(hash)
    verifier.update(parts.signingInput)
    if (alg.startsWith('ES')) return verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, parts.signature)
    if (alg.startsWith('RS')) return verifier.verify(key, parts.signature)
    return false
  } catch {
    return false
  }
}

/** Memoizing JWKS reader bound to one plugin life. */
export interface JwksResolver {
  (): Promise<Jwk[]>
}

/**
 * Build the JWKS reader for one key-list URL.
 *
 * The cache is per-resolver rather than per-module so a reloaded plugin never
 * inherits a predecessor's keys, and the injected clock keeps expiry testable.
 * @param url - the issuer's JWKS endpoint.
 * @param internals - network and clock overrides.
 * @returns a resolver memoizing the key list for {@link JWKS_TTL_MS}.
 */
export function createJwksResolver(url: string, internals: VerificationInternals = {}): JwksResolver {
  const doFetch = internals.fetch ?? globalThis.fetch
  const now = internals.now ?? Date.now
  let cache: { keys: Jwk[]; at: number } | null = null
  return async (): Promise<Jwk[]> => {
    if (cache !== null && now() - cache.at < JWKS_TTL_MS) return cache.keys
    let response: Response
    try {
      response = await doFetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) })
    } catch (error) {
      throw new AuthError('network', 'JWKS 获取失败：' + messageOf(error))
    }
    if (!response.ok) {
      throw new AuthError('network', 'JWKS 获取失败：HTTP ' + String(response.status))
    }
    const body = (await response.json()) as { keys?: Jwk[] }
    const keys = Array.isArray(body.keys) ? body.keys : []
    cache = { keys, at: now() }
    return keys
  }
}

/** Everything {@link verifyToken} needs beyond the token itself. */
export interface VerifyTokenOptions {
  /** Whether to check the signature, in addition to the always-enforced expiry. */
  verifyLocal: boolean
  resolveJwks: JwksResolver
  logger: VerificationLogger
  /** Issuer the token must declare; an empty string accepts any issuer. */
  expectedIssuer: string
  now?: () => number
}

/**
 * Enforce expiry and issuer, optionally verify the signature, and project the
 * identity the token names.
 *
 * Expiry and issuer are unconditional: a token that has already expired, or
 * that names an issuer other than the configured one, never becomes a
 * credential.
 * @param idToken - the compact id_token relayed by the browser.
 * @param options - verification policy, JWKS reader, logger, expected issuer, and clock.
 * @returns the identity to store.
 * @throws AuthError on an expiry claim that is not a timestamp the credential
 * store can hold, on expiry, on issuer mismatch, or on a signature that is
 * present but wrong.
 */
export async function verifyToken(idToken: string, options: VerifyTokenOptions): Promise<Identity> {
  const now = options.now ?? Date.now
  const parts = decodeJwt(idToken)
  const identity = identityOf(parts)
  if (identity.expiresAt !== undefined && !Number.isSafeInteger(identity.expiresAt)) {
    throw new AuthError('protocol', 'id_token 过期时间非法')
  }
  if (identity.expiresAt !== undefined && now() > identity.expiresAt) {
    throw new AuthError('expired', 'id_token 已过期，请重新登录')
  }
  if (options.expectedIssuer !== '' && identity.issuer !== options.expectedIssuer) {
    throw new AuthError('protocol', 'id_token 签发方与配置不符：' + (identity.issuer || '未声明'))
  }
  if (identity.subject === '') {
    throw new AuthError('protocol', 'id_token 未包含主体标识，无法标识账号')
  }
  if (options.verifyLocal) await verifyAgainstJwks(parts, options)
  return identity
}

/** Signature check with the unreachable-JWKS downgrade. */
async function verifyAgainstJwks(parts: JwtParts, options: VerifyTokenOptions): Promise<void> {
  let keys: Jwk[]
  try {
    keys = await options.resolveJwks()
  } catch (error) {
    if (error instanceof AuthError && error.code === 'network') {
      options.logger.warn('[hongling-account] JWKS 不可达，跳过本地验签（中转方验签为最终权威）：' + messageOf(error))
      return
    }
    throw error
  }
  const kid = parts.header.kid
  const key = keys.find(candidate => candidate.kid === kid) ?? (keys.length === 1 ? keys[0] : undefined)
  if (key === undefined) {
    throw new AuthError('protocol', 'JWKS 中找不到匹配密钥（kid=' + (kid ?? '无') + '）')
  }
  if (!verifyJwtSignature(parts, key)) {
    throw new AuthError('protocol', 'id_token 签名校验失败')
  }
}
