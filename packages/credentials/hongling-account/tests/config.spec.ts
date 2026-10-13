import { expect, it } from 'vitest'
import { Config, requireHttpsUrl, requireOrigin } from '../src/config.ts'

/** Resolved deployment configuration. @param overrides - fields to replace. @returns the parsed config. */
function resolve(overrides: Record<string, unknown> = {}): ReturnType<typeof Config> {
  return Config({ ...overrides })
}

it('defaults every field to the Changhong deployment', () => {
  expect(resolve()).toEqual({
    brokerOrigin: 'https://agent-sphere.changhong.com',
    issuer: '',
    jwksUri: 'https://account-xc.changhong.com/keys',
    inferenceOrigin: 'https://maas.changhong.com',
    usageUrl: 'https://agent-sphere.changhong.com',
    topUpUrl: 'https://agent-sphere.changhong.com',
    verifyLocal: true,
    callbackPort: 0,
    attemptTimeoutMs: 300_000,
  })
})

it('accepts per-environment overrides', () => {
  const config = resolve({ brokerOrigin: 'https://sso.example.test', inferenceOrigin: 'https://gateway.example.test', verifyLocal: false, callbackPort: 8_080 })
  expect(config.brokerOrigin).toBe('https://sso.example.test')
  expect(config.inferenceOrigin).toBe('https://gateway.example.test')
  expect(config.verifyLocal).toBe(false)
  expect(config.callbackPort).toBe(8_080)
})

it('rejects a callback port outside the TCP range', () => {
  expect(() => resolve({ callbackPort: 70_000 })).toThrow()
})

it('normalizes an HTTP(S) origin and refuses anything with more than an origin', () => {
  expect(requireOrigin('https://example.test', 'brokerOrigin')).toBe('https://example.test')
  expect(requireOrigin('http://127.0.0.1:8080', 'brokerOrigin')).toBe('http://127.0.0.1:8080')
  expect(requireOrigin('https://example.test/', 'brokerOrigin')).toBe('https://example.test')
  for (const value of ['ftp://example.test', 'https://example.test/path', 'https://user:pw@example.test',
    'https://example.test/?a=1', 'https://example.test/#x']) {
    expect(() => requireOrigin(value, 'brokerOrigin'))
      .toThrow(new Error('account: brokerOrigin must be an HTTP(S) origin without credentials, path, query or fragment'))
  }
})

it('accepts an https destination or a loopback http one', () => {
  expect(requireHttpsUrl('https://example.test/usage', 'usageUrl')).toBe('https://example.test/usage')
  expect(requireHttpsUrl('http://localhost:1234/', 'usageUrl')).toBe('http://localhost:1234/')
  expect(requireHttpsUrl('http://127.0.0.1:1234/', 'usageUrl')).toBe('http://127.0.0.1:1234/')
  expect(requireHttpsUrl('http://[::1]:1234/', 'usageUrl')).toBe('http://[::1]:1234/')
})

it('refuses a plain-http destination that is not loopback, or one carrying credentials', () => {
  expect(() => requireHttpsUrl('http://example.test/usage', 'usageUrl'))
    .toThrow(new Error('account: usageUrl must be an absolute https URL, or loopback http'))
  expect(() => requireHttpsUrl('https://user:pw@example.test/usage', 'usageUrl'))
    .toThrow(new Error('account: usageUrl must not carry credentials'))
})
