import { createSign, generateKeyPairSync } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { AuthError } from '../src/errors.ts'
import {
  JWKS_TTL_MS, createJwksResolver, decodeJwt, firstString, identityOf, verifyJwtSignature, verifyToken,
  type Jwk, type JwtParts,
} from '../src/jwt.ts'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const rsaJwk = { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', key_ops: ['verify'] } as Jwk
const ecJwk = { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec-1' } as Jwk

/**
 * Compact JWS over the given header and claims.
 * @param header - JOSE header.
 * @param claims - claim set.
 * @param sign - signature producer for the `header.payload` input.
 * @returns the serialized token.
 */
function token(header: object, claims: object, sign: (input: string) => Buffer): string {
  const head = Buffer.from(JSON.stringify(header)).toString('base64url')
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${head}.${body}.${sign(`${head}.${body}`).toString('base64url')}`
}

/** Sign with an RSA key under the given digest. @param key - private key. @param hash - digest name. @returns a signer for JWS input. */
function rsaSigner(key: typeof rsa.privateKey, hash = 'SHA256'): (input: string) => Buffer {
  return input => createSign(hash).update(input).sign(key)
}

/** Sign with a P-256 key in the JOSE-mandated raw form. @param key - private key. @returns a signer for JWS input. */
function ecSigner(key: typeof ec.privateKey): (input: string) => Buffer {
  return input => createSign('SHA256').update(input).sign({ key, dsaEncoding: 'ieee-p1363' })
}

const claims = { iss: 'https://idp.test', sub: 'user-1', name: '张三', email: 'z@example.test', exp: 4_102_444_800 }
const signed = token({ alg: 'RS256', kid: 'rsa-1' }, claims, rsaSigner(rsa.privateKey))
const partsOf = (value = signed): JwtParts => decodeJwt(value)

/** Verification options with a single RSA key and a fixed clock. @param overrides - options to replace. @returns the options. */
function options(overrides: Partial<Parameters<typeof verifyToken>[1]> = {}): Parameters<typeof verifyToken>[1] {
  return { verifyLocal: true, resolveJwks: () => Promise.resolve([rsaJwk]), logger: { warn: () => {} }, expectedIssuer: '', ...overrides }
}

it('decodes a compact JWS into header, claims, signed input and signature', () => {
  const parts = partsOf()
  expect(parts.header).toEqual({ alg: 'RS256', kid: 'rsa-1' })
  expect(parts.claims).toEqual(claims)
  expect(parts.signingInput).toBe(signed.split('.').slice(0, 2).join('.'))
  expect(parts.signature.length).toBeGreaterThan(0)
})

it('rejects a token that is not three base64url segments', () => {
  for (const bad of ['a.b', 'a.b.c.d', '']) {
    expect(() => decodeJwt(bad)).toThrow(new AuthError('protocol', 'id_token 格式非法'))
  }
})

it('rejects a token whose segments are not JSON', () => {
  expect(() => decodeJwt('@@@.@@@.x')).toThrow(new AuthError('protocol', 'id_token 解析失败'))
})

it('reads the first non-empty string claim', () => {
  expect(firstString({ a: '', b: 3, c: 'hit', d: 'later' }, ['a', 'b', 'c', 'd'])).toBe('hit')
  expect(firstString({}, ['missing'])).toBe('')
})

it('projects identity with fallback claims and a null for every absent display field', () => {
  expect(identityOf(partsOf())).toEqual({
    issuer: 'https://idp.test', subject: 'user-1', name: '张三', contact: 'z@example.test', expiresAt: 4_102_444_800_000,
  })
  const bare = decodeJwt(token({ alg: 'RS256' }, { sub: 'user-2' }, rsaSigner(rsa.privateKey)))
  expect(identityOf(bare)).toEqual({ issuer: '', subject: 'user-2', name: null, contact: null, expiresAt: undefined })
})

it('falls back through the name, contact and subject claim lists', () => {
  const fallback = decodeJwt(token({ alg: 'RS256' }, {
    preferred_username: 'emp-9', mobile: '13800000000', employee_no: 'E9',
  }, rsaSigner(rsa.privateKey)))
  expect(identityOf(fallback)).toEqual({ issuer: '', subject: 'E9', name: 'emp-9', contact: '13800000000', expiresAt: undefined })
})

it('accepts an RSA signature and refuses a tampered one', () => {
  expect(verifyJwtSignature(partsOf(), rsaJwk)).toBe(true)
  const other = token({ alg: 'RS256', kid: 'rsa-1' }, { ...claims, sub: 'someone-else' }, rsaSigner(rsa.privateKey))
  expect(verifyJwtSignature({ ...partsOf(), signature: decodeJwt(other).signature }, rsaJwk)).toBe(false)
})

it('accepts a raw-form ECDSA signature', () => {
  const es = token({ alg: 'ES256', kid: 'ec-1' }, claims, ecSigner(ec.privateKey))
  expect(verifyJwtSignature(partsOf(es), ecJwk)).toBe(true)
  expect(verifyJwtSignature({ ...partsOf(es), signature: Buffer.alloc(64) }, ecJwk)).toBe(false)
})

it('refuses an algorithm family it does not implement', () => {
  expect(verifyJwtSignature({ ...partsOf(), header: {} }, rsaJwk)).toBe(false)
  expect(verifyJwtSignature({ ...partsOf(), header: { alg: 'none' } }, rsaJwk)).toBe(false)
  expect(verifyJwtSignature({ ...partsOf(), header: { alg: 'PS256' } }, rsaJwk)).toBe(false)
  const sha512 = token({ alg: 'RS512', kid: 'rsa-1' }, claims, rsaSigner(rsa.privateKey, 'SHA512'))
  expect(verifyJwtSignature(partsOf(sha512), rsaJwk)).toBe(true)
  const sha384 = token({ alg: 'RS384', kid: 'rsa-1' }, claims, rsaSigner(rsa.privateKey, 'SHA384'))
  expect(verifyJwtSignature(partsOf(sha384), rsaJwk)).toBe(true)
})

it('refuses a key that cannot be constructed', () => {
  expect(verifyJwtSignature(partsOf(), { kty: 'RSA', n: 'not-a-modulus' })).toBe(false)
})

it('memoizes the key list and refetches once the cache expires', async () => {
  let calls = 0
  let clock = 1_000
  const resolve = createJwksResolver('https://idp.test/keys', {
    now: () => clock,
    fetch: () => { calls += 1; return Promise.resolve(Response.json({ keys: [rsaJwk] })) },
  })
  expect(await resolve()).toEqual([rsaJwk])
  expect(await resolve()).toEqual([rsaJwk])
  expect(calls).toBe(1)
  clock += JWKS_TTL_MS
  expect(await resolve()).toEqual([rsaJwk])
  expect(calls).toBe(2)
})

it('reports an unreachable or failing key list as a network failure', async () => {
  await expect(createJwksResolver('https://idp.test/keys', {
    fetch: () => Promise.reject(new Error('boom')),
  })()).rejects.toThrow(new AuthError('network', 'JWKS 获取失败：boom'))
  await expect(createJwksResolver('https://idp.test/keys', {
    fetch: () => Promise.resolve(new Response('nope', { status: 500 })),
  })()).rejects.toThrow(new AuthError('network', 'JWKS 获取失败：HTTP 500'))
})

it('treats a key list without a keys array as empty', async () => {
  const resolve = createJwksResolver('https://idp.test/keys', { fetch: () => Promise.resolve(Response.json({})) })
  expect(await resolve()).toEqual([])
})

it('falls back to the process-wide fetch when no transport is injected', async () => {
  const transport = vi.fn(() => Promise.resolve(Response.json({ keys: [rsaJwk] })))
  vi.stubGlobal('fetch', transport)
  try {
    expect(await createJwksResolver('https://idp.test/keys')()).toEqual([rsaJwk])
    expect(transport).toHaveBeenCalledWith('https://idp.test/keys', { signal: expect.any(AbortSignal) as AbortSignal })
  } finally {
    vi.unstubAllGlobals()
  }
})

it('accepts an unexpired token and projects its identity', async () => {
  await expect(verifyToken(signed, options({ verifyLocal: false }))).resolves.toMatchObject({ subject: 'user-1' })
})

it('refuses an expired token regardless of the signature policy', async () => {
  const expired = token({ alg: 'RS256', kid: 'rsa-1' }, { ...claims, exp: 1 }, rsaSigner(rsa.privateKey))
  await expect(verifyToken(expired, options())).rejects.toThrow(new AuthError('expired', 'id_token 已过期，请重新登录'))
})

it('refuses an expiry claim the credential store could not hold', async () => {
  // A claim beyond the safe-integer range would be written as a grant no later
  // read can parse, so it is refused while it is still only a claim.
  const unrepresentable = token({ alg: 'RS256', kid: 'rsa-1' }, { ...claims, exp: 1e30 }, rsaSigner(rsa.privateKey))
  await expect(verifyToken(unrepresentable, options())).rejects.toThrow(new AuthError('protocol', 'id_token 过期时间非法'))
})

it('checks the issuer only when one is configured', async () => {
  await expect(verifyToken(signed, options({ expectedIssuer: 'https://idp.test' }))).resolves.toMatchObject({ issuer: 'https://idp.test' })
  await expect(verifyToken(signed, options({ expectedIssuer: 'https://other.test' })))
    .rejects.toThrow(new AuthError('protocol', 'id_token 签发方与配置不符：https://idp.test'))
  const unclaimed = token({ alg: 'RS256', kid: 'rsa-1' }, { sub: 'user-1' }, rsaSigner(rsa.privateKey))
  await expect(verifyToken(unclaimed, options({ expectedIssuer: 'https://other.test', verifyLocal: false })))
    .rejects.toThrow(new AuthError('protocol', 'id_token 签发方与配置不符：未声明'))
})

it('refuses a token without a subject', async () => {
  const anonymous = token({ alg: 'RS256', kid: 'rsa-1' }, { iss: 'https://idp.test' }, rsaSigner(rsa.privateKey))
  await expect(verifyToken(anonymous, options())).rejects.toThrow(new AuthError('protocol', 'id_token 未包含主体标识，无法标识账号'))
})

it('verifies the signature against the key the token names', async () => {
  await expect(verifyToken(signed, options())).resolves.toMatchObject({ subject: 'user-1' })
  const wrong = token({ alg: 'RS256', kid: 'rsa-1' }, { ...claims, sub: 'other' }, ecSigner(ec.privateKey))
  await expect(verifyToken(wrong, options())).rejects.toThrow(new AuthError('protocol', 'id_token 签名校验失败'))
})

it('falls back to a sole published key when no kid matches', async () => {
  const unidentified = token({ alg: 'RS512' }, claims, rsaSigner(rsa.privateKey, 'SHA512'))
  await expect(verifyToken(unidentified, options({ resolveJwks: () => Promise.resolve([rsaJwk]) }))).resolves.toMatchObject({ subject: 'user-1' })
  const sha512 = token({ alg: 'RS512', kid: 'labelled' }, claims, rsaSigner(rsa.privateKey, 'SHA512'))
  await expect(verifyToken(sha512, options({ resolveJwks: () => Promise.resolve([{ ...rsaJwk, kid: 'other' }]) })))
    .resolves.toMatchObject({ subject: 'user-1' })
})

it('refuses to guess among several keys when no kid matches', async () => {
  const sha512 = token({ alg: 'RS512', kid: 'labelled' }, claims, rsaSigner(rsa.privateKey, 'SHA512'))
  await expect(verifyToken(sha512, options({ resolveJwks: () => Promise.resolve([rsaJwk, ecJwk]) })))
    .rejects.toThrow(new AuthError('protocol', 'JWKS 中找不到匹配密钥（kid=labelled）'))
  await expect(verifyToken(sha512, options({ resolveJwks: () => Promise.resolve([]) })))
    .rejects.toThrow(new AuthError('protocol', 'JWKS 中找不到匹配密钥（kid=labelled）'))
  const unlabelled = token({ alg: 'RS512' }, claims, rsaSigner(rsa.privateKey, 'SHA512'))
  await expect(verifyToken(unlabelled, options({ resolveJwks: () => Promise.resolve([rsaJwk, ecJwk]) })))
    .rejects.toThrow(new AuthError('protocol', 'JWKS 中找不到匹配密钥（kid=无）'))
})

it('downgrades an unreachable key list to a warning', async () => {
  const warnings: unknown[][] = []
  const unreachable = options({
    logger: { warn: (...values: unknown[]) => { warnings.push(values) } },
    resolveJwks: () => Promise.reject(new AuthError('network', 'JWKS 获取失败：offline')),
  })
  await expect(verifyToken(signed, unreachable)).resolves.toMatchObject({ subject: 'user-1' })
  expect(warnings).toHaveLength(1)
  expect(String(warnings[0]?.[0])).toContain('JWKS 不可达')
})

it('propagates a key-list failure that is not a network error', async () => {
  const failure = new AuthError('protocol', 'JWKS 不可用')
  await expect(verifyToken(signed, options({ resolveJwks: () => Promise.reject(failure) }))).rejects.toThrow(failure)
  await expect(verifyToken(signed, options({ resolveJwks: () => Promise.reject(new Error('other')) })))
    .rejects.toThrow(new Error('other'))
})
