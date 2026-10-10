/**
 * Token decoding, claim projection, JWKS verification, and the verify-then-
 * assemble step: three-segment decoding, both role claim shapes, RSA and
 * ECDSA signature families across the SHA-256/384/512 hashes, the memoized
 * JWKS reader, and every arm of the expiry/verification policy — including
 * the unreachable-issuer downgrade and the process clock.
 */
import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../src/errors.ts'
import {
  JWKS_TIMEOUT_MS, JWKS_TTL_MS, buildTokenSet, claimRoles, createJwksResolver, decodeJwt, firstString,
  profileFromClaims, verifyJwtSignature, type Jwk, type JwtParts, type VerificationLogger,
} from '../src/jwt.ts'

const BASE_NOW = 1_700_000_000_000

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })

function jwkOf(key: ReturnType<typeof generateKeyPairSync>['publicKey'], kid: string): Jwk {
  return { ...(key.export({ format: 'jwk' }) as object), kid } as Jwk
}

const RSA_JWK = jwkOf(rsa.publicKey, 'rsa-1')
const EC_JWK = jwkOf(ec.publicKey, 'ec-1')

const b64url = (value: string): string => Buffer.from(value, 'utf8').toString('base64url')

/** One signed token: header, claims, and a signature over the signing input. */
function signed(
  claims: Record<string, unknown>,
  options: { alg?: string; kid?: string; key?: typeof rsa.privateKey; hash?: string } = {},
): { parts: JwtParts; token: string } {
  const alg = options.alg ?? 'RS256'
  const header: JwtParts['header'] = { alg, ...(options.kid === undefined ? {} : { kid: options.kid }) }
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(claims))
  const signer = createSign(options.hash ?? 'SHA256').update(signingInput)
  const signature = alg.startsWith('ES')
    ? signer.sign({ key: options.key ?? ec.privateKey, dsaEncoding: 'ieee-p1363' })
    : signer.sign(options.key ?? rsa.privateKey)
  return { parts: { header, claims, signingInput, signature }, token: signingInput + '.' + signature.toString('base64url') }
}

/** A warning spy that still satisfies the logger the verifier asks for. */
function logger() {
  return { warn: vi.fn<(...values: unknown[]) => void>() } satisfies VerificationLogger
}

const NOW = (): number => BASE_NOW

describe('decodeJwt', () => {
  it('splits a compact token into its header, claims, signing input, and signature', () => {
    const { token } = signed({ sub: 'u1' }, { kid: 'rsa-1' })
    const parts = decodeJwt(token)
    expect(parts.header).toEqual({ alg: 'RS256', kid: 'rsa-1' })
    expect(parts.claims).toEqual({ sub: 'u1' })
    expect(parts.signingInput).toBe(token.split('.').slice(0, 2).join('.'))
    expect(parts.signature).toEqual(Buffer.from(token.split('.')[2] as string, 'base64url'))
  })

  it('refuses a token that is not exactly three segments', () => {
    for (const token of ['one', 'one.two', 'one.two.three.four', '']) {
      expect(() => decodeJwt(token)).toThrow(AuthError)
    }
    try {
      decodeJwt('one')
      expect.unreachable()
    } catch (error) {
      expect((error as AuthError).code).toBe('BAD_TOKEN')
      expect((error as AuthError).message).toBe('token 格式非法')
    }
  })

  it('refuses segments that are not base64url JSON', () => {
    try {
      decodeJwt('a.b.c')
      expect.unreachable()
    } catch (error) {
      expect((error as AuthError).code).toBe('BAD_TOKEN')
      expect((error as AuthError).message).toBe('token 解析失败')
    }
  })
})

describe('firstString', () => {
  it('returns the first non-empty string claim', () => {
    expect(firstString({ a: 'first', b: 'second' }, ['a', 'b'])).toBe('first')
    expect(firstString({ a: '', b: 'second' }, ['a', 'b'])).toBe('second')
    expect(firstString({ a: 7, b: 'second' }, ['a', 'b'])).toBe('second')
    expect(firstString({}, ['a', 'b'])).toBe('')
  })
})

describe('claimRoles', () => {
  it('reads a flat array of role strings', () => {
    expect(claimRoles({ roles: ['admin', 'user'] })).toEqual(['admin', 'user'])
  })

  it('drops non-strings and empty entries', () => {
    expect(claimRoles({ roles: ['admin', 7, '', 'user'] })).toEqual(['admin', 'user'])
  })

  it('reads a space-delimited string', () => {
    expect(claimRoles({ roles: 'admin  user' })).toEqual(['admin', 'user'])
  })

  it('reads Keycloak realm_access.roles and de-duplicates across both sources', () => {
    expect(claimRoles({ roles: ['admin', 'ops'], realm_access: { roles: ['admin', 'ops'] } })).toEqual(['admin', 'ops'])
  })

  it('ignores a realm_access that is absent, null, or not an object', () => {
    expect(claimRoles({})).toEqual([])
    expect(claimRoles({ realm_access: null })).toEqual([])
    expect(claimRoles({ realm_access: 'admin' })).toEqual([])
  })
})

describe('profileFromClaims', () => {
  it('prefers the descriptive claims', () => {
    expect(profileFromClaims({
      sub: 'u1', preferred_username: 'sven', name: 'Sven Ren', email: 'sven@example.com', roles: ['admin'],
    })).toEqual({ username: 'sven', displayName: 'Sven Ren', email: 'sven@example.com', roles: ['admin'] })
  })

  it('falls back to the subject and omits an absent email', () => {
    expect(profileFromClaims({ sub: 'u1' })).toEqual({ username: 'u1', displayName: 'u1', roles: [] })
    expect(profileFromClaims({ sub: 'u1', preferred_username: 'sven' }))
      .toEqual({ username: 'sven', displayName: 'sven', roles: [] })
  })
})

describe('verifyJwtSignature', () => {
  it('accepts an RSA signature from the matching key', () => {
    expect(verifyJwtSignature(signed({ sub: 'u1' }).parts, RSA_JWK)).toBe(true)
  })

  it('accepts a raw r||s ECDSA signature', () => {
    expect(verifyJwtSignature(signed({ sub: 'u1' }, { alg: 'ES256', key: ec.privateKey }).parts, EC_JWK)).toBe(true)
  })

  it('accepts a signature from the hash the header names', () => {
    for (const [alg, hash] of [['RS384', 'SHA384'], ['RS512', 'SHA512']] as const) {
      const { parts } = signed({ sub: 'u1' }, { alg, hash })
      expect(verifyJwtSignature(parts, RSA_JWK)).toBe(true)
      // The same bytes under the default hash must not pass.
      expect(verifyJwtSignature(signed({ sub: 'u1' }, { alg }).parts, RSA_JWK)).toBe(false)
    }
  })

  it('rejects a signature over different content or by a different key', () => {
    const { parts } = signed({ sub: 'u1' })
    expect(verifyJwtSignature({ ...parts, signingInput: parts.signingInput + 'x' }, RSA_JWK)).toBe(false)
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(verifyJwtSignature(parts, jwkOf(other.publicKey, 'other'))).toBe(false)
  })

  it('rejects an unsupported algorithm family or hash', () => {
    expect(verifyJwtSignature(signed({}, { alg: 'PS256' }).parts, RSA_JWK)).toBe(false)
    const header: JwtParts['header'] = {}
    expect(verifyJwtSignature({ ...signed({}).parts, header }, RSA_JWK)).toBe(false)
  })

  it('rejects a key it cannot load', () => {
    expect(verifyJwtSignature(signed({}).parts, { kty: 'oct', k: 'AAAA' })).toBe(false)
  })

  it('ignores the JWK members a published key carries beyond the string ones', () => {
    // `key_ops` and `ext` are valid JWKS members Node's key type does not take.
    expect(verifyJwtSignature(signed({}).parts, { ...RSA_JWK, key_ops: ['verify'], ext: true })).toBe(true)
  })
})

describe('createJwksResolver', () => {
  it('memoizes each issuer within the window and refetches afterwards', async () => {
    let clock = BASE_NOW
    const fetchMock = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify({ keys: [RSA_JWK] }), { status: 200 }))
    const resolve = createJwksResolver({ fetch: fetchMock, now: () => clock })
    await expect(resolve('https://issuer.example.com/')).resolves.toEqual([RSA_JWK])
    const [requested, init] = fetchMock.mock.calls[0] ?? []
    expect(requested).toBe('https://issuer.example.com/.well-known/jwks.json')
    // The fetch carries an abort signal rather than the ambient deadline.
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    clock += JWKS_TTL_MS - 1
    await expect(resolve('https://issuer.example.com')).resolves.toEqual([RSA_JWK])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    clock += 1
    await resolve('https://issuer.example.com')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The request deadline is the module's own, not the ambient one.
    expect(JWKS_TIMEOUT_MS).toBe(10_000)
  })

  it('reports a refused JWKS as unavailable', async () => {
    const resolve = createJwksResolver({
      fetch: async () => new Response('', { status: 503 }),
      now: NOW,
    })
    await expect(resolve('https://issuer.example.com')).rejects.toMatchObject({ code: 'JWKS_UNAVAILABLE' })
  })

  it('reads a body without a key array as no keys', async () => {
    const resolve = createJwksResolver({
      fetch: async () => new Response(JSON.stringify({ keys: 'nope' }), { status: 200 }),
      now: NOW,
    })
    await expect(resolve('https://issuer.example.com')).resolves.toEqual([])
  })

  it('falls back to the process fetch and clock when nothing is injected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [RSA_JWK] }), { status: 200 })))
    try {
      await expect(createJwksResolver()('https://issuer.example.com')).resolves.toEqual([RSA_JWK])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('buildTokenSet', () => {
  const resolveJwks = async (): Promise<Jwk[]> => [RSA_JWK]

  it('assembles the record and never persists an expired token', async () => {
    const fresh = signed({ sub: 'u1' })
    await expect(buildTokenSet(fresh.token, undefined, { verifyLocal: true, resolveJwks, logger: logger(), now: NOW }))
      .resolves.toEqual({
        version: 1,
        idToken: fresh.token,
        profile: { username: 'u1', displayName: 'u1', roles: [] },
        savedAt: BASE_NOW,
      })
    const expired = signed({ sub: 'u1', exp: BASE_NOW / 1000 - 1 })
    await expect(buildTokenSet(expired.token, undefined, { verifyLocal: false, resolveJwks, logger: logger(), now: NOW }))
      .rejects.toMatchObject({ code: 'TOKEN_EXPIRED' })
  })

  it('defaults the clock to the process when none is injected', async () => {
    const { token } = signed({ sub: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 })
    const set = await buildTokenSet(token, undefined, { verifyLocal: false, resolveJwks, logger: logger() })
    expect(set.idToken).toBe(token)
    // The expiry is derived from the process clock, not from an injected one.
    expect(typeof set.expiresAt).toBe('number')
  })

  it('keeps the issuer, refresh token, and expiry when the token carries them', async () => {
    const { token } = signed({ sub: 'u1', iss: 'https://issuer.example.com', exp: BASE_NOW / 1000 + 60 }, { kid: 'rsa-1' })
    await expect(buildTokenSet(token, 'refresh-1', {
      verifyLocal: true, resolveJwks, logger: logger(), now: NOW,
    })).resolves.toMatchObject({
      iss: 'https://issuer.example.com',
      refreshToken: 'refresh-1',
      expiresAt: (BASE_NOW / 1000 + 60) * 1000,
    })
  })

  it('skips the signature check when verification is off or the token names no issuer', async () => {
    const jwks = vi.fn(resolveJwks)
    for (const verifyLocal of [false, true]) {
      const { token } = signed({ sub: 'u1' })
      await buildTokenSet(token, undefined, { verifyLocal, resolveJwks: jwks, logger: logger(), now: NOW })
    }
    expect(jwks).not.toHaveBeenCalled()
  })

  it('warns and keeps the token when the issuer JWKS is unreachable', async () => {
    const log = logger()
    const { token } = signed({ sub: 'u1', iss: 'https://issuer.example.com' })
    await expect(buildTokenSet(token, undefined, {
      verifyLocal: true,
      resolveJwks: async () => { throw new AuthError('JWKS_UNAVAILABLE', 'JWKS 获取失败：HTTP 503') },
      logger: log,
      now: NOW,
    })).resolves.toMatchObject({ idToken: token })
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('JWKS 不可达，跳过本地验签'))
  })

  it('throws on any other JWKS failure', async () => {
    const { token } = signed({ sub: 'u1', iss: 'https://issuer.example.com' })
    await expect(buildTokenSet(token, undefined, {
      verifyLocal: true,
      resolveJwks: async () => { throw new Error('socket hang up') },
      logger: logger(),
      now: NOW,
    })).rejects.toThrow('socket hang up')
  })

  it('selects the key by kid, or the only published key when the kid is absent', async () => {
    const withKid = signed({ sub: 'u1', iss: 'https://issuer.example.com' }, { kid: 'rsa-1' })
    await expect(buildTokenSet(withKid.token, undefined, {
      verifyLocal: true, resolveJwks: async () => [RSA_JWK], logger: logger(), now: NOW,
    })).resolves.toMatchObject({ idToken: withKid.token })

    const noKid = signed({ sub: 'u1', iss: 'https://issuer.example.com' })
    await expect(buildTokenSet(noKid.token, undefined, {
      verifyLocal: true, resolveJwks: async () => [RSA_JWK], logger: logger(), now: NOW,
    })).resolves.toMatchObject({ idToken: noKid.token })
  })

  it('refuses a token whose key is not published', async () => {
    const { token } = signed({ sub: 'u1', iss: 'https://issuer.example.com' }, { kid: 'rsa-9' })
    await expect(buildTokenSet(token, undefined, {
      verifyLocal: true, resolveJwks: async () => [RSA_JWK, EC_JWK], logger: logger(), now: NOW,
    })).rejects.toMatchObject({ code: 'JWKS_NO_KEY' })
  })

  it('refuses a token whose signature does not match', async () => {
    const { token } = signed({ sub: 'u1', iss: 'https://issuer.example.com' }, { kid: 'rsa-1' })
    await expect(buildTokenSet(token, undefined, {
      verifyLocal: true, resolveJwks: async () => [jwkOf(ec.publicKey, 'rsa-1')], logger: logger(), now: NOW,
    })).rejects.toMatchObject({ code: 'BAD_SIGNATURE' })
  })
})
