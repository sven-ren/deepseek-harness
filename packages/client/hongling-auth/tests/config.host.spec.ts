/**
 * Config resolution: explicit plugin config beats the environment, the
 * environment beats the default, a pinned port outside the assignable range
 * degrades to a random one instead of failing startup, and the verify flag
 * reads both its boolean and its string forms.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import {
  authFilePath, BACKEND_URL_ENV, DEFAULT_BACKEND_URL, REDIRECT_PORT_ENV, resolveConfig, VERIFY_LOCAL_ENV,
} from '../src/config.ts'

describe('resolveConfig', () => {
  it('prefers the authored backend URL, then the environment, then the default', () => {
    expect(resolveConfig({ backendUrl: 'https://auth.example.com' }, {}).backendUrl).toBe('https://auth.example.com')
    expect(resolveConfig({}, { [BACKEND_URL_ENV]: 'https://env.example.com' }).backendUrl).toBe('https://env.example.com')
    expect(resolveConfig({}, {}).backendUrl).toBe(DEFAULT_BACKEND_URL)
  })

  it('reads the backend URL from the process environment when called without arguments', () => {
    expect(resolveConfig().backendUrl).toBe(DEFAULT_BACKEND_URL)
  })

  it('strips trailing slashes so the relay path is never doubled', () => {
    expect(resolveConfig({ backendUrl: 'https://auth.example.com//' }, {}).backendUrl).toBe('https://auth.example.com')
  })

  it('treats an absent, empty, or whitespace-only environment value as unset', () => {
    for (const value of ['', '   ']) {
      expect(resolveConfig({}, { [BACKEND_URL_ENV]: value }).backendUrl).toBe(DEFAULT_BACKEND_URL)
    }
  })

  it('accepts a pinned port as a number or as a numeric string', () => {
    expect(resolveConfig({ redirectPort: 8765 }, {}).redirectPort).toBe(8765)
    expect(resolveConfig({}, { [REDIRECT_PORT_ENV]: '8765' }).redirectPort).toBe(8765)
  })

  it('leaves the port ephemeral when nothing pins it', () => {
    expect(resolveConfig({}, {}).redirectPort).toBeUndefined()
  })

  it('ignores a pinned port outside the assignable range instead of failing startup', () => {
    for (const redirectPort of [0, 1023, 65536, 8765.5, Number.NaN]) {
      expect(resolveConfig({ redirectPort }, {}).redirectPort).toBeUndefined()
    }
    expect(resolveConfig({}, { [REDIRECT_PORT_ENV]: 'not-a-number' }).redirectPort).toBeUndefined()
  })

  it('accepts the range boundaries', () => {
    expect(resolveConfig({ redirectPort: 1024 }, {}).redirectPort).toBe(1024)
    expect(resolveConfig({ redirectPort: 65535 }, {}).redirectPort).toBe(65535)
  })

  it('enables local verification by default and honors both boolean forms', () => {
    expect(resolveConfig({}, {}).verifyLocal).toBe(true)
    expect(resolveConfig({ verifyLocal: true }, {}).verifyLocal).toBe(true)
    expect(resolveConfig({ verifyLocal: false }, {}).verifyLocal).toBe(false)
  })

  it('reads the verify override from the environment, spelling "no" as the only false', () => {
    expect(resolveConfig({}, { [VERIFY_LOCAL_ENV]: 'false' }).verifyLocal).toBe(false)
    expect(resolveConfig({}, { [VERIFY_LOCAL_ENV]: 'NO' }).verifyLocal).toBe(false)
    expect(resolveConfig({}, { [VERIFY_LOCAL_ENV]: '0' }).verifyLocal).toBe(false)
    expect(resolveConfig({}, { [VERIFY_LOCAL_ENV]: 'yes' }).verifyLocal).toBe(true)
  })

  it('lets the authored verify flag win over the environment', () => {
    expect(resolveConfig({ verifyLocal: true }, { [VERIFY_LOCAL_ENV]: 'false' }).verifyLocal).toBe(true)
  })

  it('enables the development injection only on an explicit true', () => {
    expect(resolveConfig({ devAuth: true }, {}).devAuth).toBe(true)
    expect(resolveConfig({}, {}).devAuth).toBe(false)
  })
})

describe('authFilePath', () => {
  it('keeps the token file below the harness home', () => {
    expect(authFilePath()).toBe(join(dshHomePath('hongling-auth', 'auth.json')))
  })
})
