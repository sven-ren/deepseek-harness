/**
 * id_token decoding, claim projection, JWKS signature verification, and the
 * verify-then-assemble step that turns a raw token into the stored
 * {@link TokenSet}.
 *
 * The plugin never holds a client secret: it validates what the backend
 * relayed and treats that backend as the final authority. Local verification
 * is therefore deliberately two-tier — expiry is always enforced, while a
 * signature check that cannot reach the issuer's JWKS degrades to a warning
 * instead of a failed login.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/jwt
 */

import { createPublicKey, createVerify, type JsonWebKey as NodeJsonWebKey } from 'node:crypto'
import { AuthError, messageOf } from './errors.ts'
import type { AuthProfile, TokenSet } from './types.ts'

/** Cache lifetime for a fetched JWKS, matching the backend's own window. */
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
    throw new AuthError('BAD_TOKEN', 'token 格式非法')
  }
  let header: JwtParts['header']
  let claims: Record<string, unknown>
  try {
    header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as JwtParts['header']
    claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new AuthError('BAD_TOKEN', 'token 解析失败')
  }
  return {
    header,
    claims,
    signingInput: encodedHeader + '.' + encodedClaims,
    signature: Buffer.from(encodedSignature, 'base64url'),
  }
}

/**
 * First non-empty string claim among the candidate keys, or the empty string.
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
 * Collect roles from both the flat `roles` claim and Keycloak's nested
 * `realm_access.roles`, accepting either an array or a space-delimited
 * string, and de-duplicate while keeping first-seen order.
 * @param claims - the decoded claim set.
 * @returns the role names, each once, in first-seen order.
 */
export function claimRoles(claims: Record<string, unknown>): string[] {
  const roles: string[] = []
  const push = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) if (typeof entry === 'string' && entry !== '') roles.push(entry)
    } else if (typeof value === 'string' && value !== '') {
      for (const entry of value.split(' ')) if (entry !== '') roles.push(entry)
    }
  }
  push(claims.roles)
  const realmAccess = claims.realm_access
  if (typeof realmAccess === 'object' && realmAccess !== null) push((realmAccess as Record<string, unknown>).roles)
  return [...new Set(roles)]
}

/**
 * Project the display-relevant subset of the claims into a profile.
 * @param claims - the decoded claim set.
 * @returns the profile the browser displays and the token file stores.
 */
export function profileFromClaims(claims: Record<string, unknown>): AuthProfile {
  const subject = firstString(claims, ['sub'])
  const email = firstString(claims, ['email'])
  return {
    username: firstString(claims, ['preferred_username', 'username']) || subject,
    displayName: firstString(claims, ['name', 'preferred_username']) || subject,
    ...(email === '' ? {} : { email }),
    roles: claimRoles(claims),
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
 * accepts. A JWKS entry may also carry members Node's type does not declare,
 * such as a `key_ops` array, so the copy keeps the string values only.
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
 * Only the RSA (`RS*`) and ECDSA (`ES*`) families the issuer publishes are
 * accepted; ECDSA signatures are read in the JOSE-mandated raw r1||s form
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
export type JwksResolver = (issuer: string) => Promise<Jwk[]>

/**
 * Build the JWKS reader. The cache is per-resolver rather than per-module so
 * a reloaded plugin never inherits a predecessor's keys, and the injected
 * clock keeps expiry testable.
 * @param internals - network and clock overrides.
 * @returns a resolver memoizing each issuer's keys for {@link JWKS_TTL_MS}.
 */
export function createJwksResolver(internals: VerificationInternals = {}): JwksResolver {
  const doFetch = internals.fetch ?? globalThis.fetch
  const now = internals.now ?? Date.now
  let cache: { keys: Jwk[]; at: number } | null = null
  return async (issuer: string): Promise<Jwk[]> => {
    if (cache !== null && now() - cache.at < JWKS_TTL_MS) return cache.keys
    const url = `${issuer.replace(/\/+$/u, '')}/.well-known/jwks.json`
    const response = await doFetch(url, { signal: AbortSignal.timeout(JWKS_TIMEOUT_MS) })
    if (!response.ok) throw new AuthError('JWKS_UNAVAILABLE', `JWKS 获取失败：HTTP ${String(response.status)}`)
    const body = (await response.json()) as { keys?: Jwk[] }
    const keys = Array.isArray(body.keys) ? body.keys : []
    cache = { keys, at: now() }
    return keys
  }
}

/** Everything {@link buildTokenSet} needs beyond the token itself. */
export interface BuildTokenSetOptions {
  verifyLocal: boolean
  resolveJwks: JwksResolver
  logger: VerificationLogger
  now?: () => number
}

/**
 * Enforce expiry, optionally verify the signature, and assemble the record
 * that gets persisted.
 *
 * Expiry is unconditional: a token that has already expired never reaches the
 * store. When `verifyLocal` is on and the token names an issuer, the
 * signature is checked against that issuer's JWKS; an unreachable JWKS is a
 * warning, because the backend re-verifies every request it proxies, while a
 * signature that is present but wrong is always fatal.
 * @param idToken - the compact id_token.
 * @param refreshToken - refresh_token relayed alongside it, when the issuer issued one.
 * @param options - verification policy, JWKS reader, logger, and clock.
 * @returns the assembled token set.
 * @throws AuthError on expiry, an unreachable-issuer signature mismatch, or an unknown key id.
 */
export async function buildTokenSet(
  idToken: string,
  refreshToken: string | undefined,
  options: BuildTokenSetOptions,
): Promise<TokenSet> {
  const now = options.now ?? Date.now
  const parts = decodeJwt(idToken)
  const exp = parts.claims.exp
  const expiresAt = typeof exp === 'number' ? exp * 1000 : undefined
  if (expiresAt !== undefined && now() > expiresAt) {
    throw new AuthError('TOKEN_EXPIRED', 'id_token 已过期，请重新登录')
  }
  const issuer = firstString(parts.claims, ['iss'])
  if (options.verifyLocal && issuer !== '') {
    await verifyAgainstJwks(parts, issuer, options)
  }
  return {
    version: 1,
    ...(issuer === '' ? {} : { iss: issuer }),
    idToken,
    ...(refreshToken === undefined ? {} : { refreshToken }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    profile: profileFromClaims(parts.claims),
    savedAt: now(),
  }
}

/** Signature check with the unreachable-JWKS downgrade. */
async function verifyAgainstJwks(
  parts: JwtParts,
  issuer: string,
  options: BuildTokenSetOptions,
): Promise<void> {
  let keys: Jwk[]
  try {
    keys = await options.resolveJwks(issuer)
  } catch (error) {
    if (error instanceof AuthError && error.code === 'JWKS_UNAVAILABLE') {
      options.logger.warn(
        '[hongling-auth] JWKS 不可达，跳过本地验签（后端验签为最终权威）：' + messageOf(error),
      )
      return
    }
    throw error
  }
  const kid = parts.header.kid
  const key = keys.find(candidate => candidate.kid === kid) ?? (keys.length === 1 ? keys[0] : undefined)
  if (key === undefined) {
    throw new AuthError('JWKS_NO_KEY', 'JWKS 中找不到匹配密钥（kid=' + (kid ?? '无') + '）')
  }
  if (!verifyJwtSignature(parts, key)) {
    throw new AuthError('BAD_SIGNATURE', 'id_token 签名校验失败')
  }
}
