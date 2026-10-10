/**
 * The shared failure type and the renderer that turns any thrown value into
 * the message the login panel shows.
 */
import { describe, expect, it } from 'vitest'
import { AuthError, messageOf } from '../src/errors.ts'

describe('AuthError', () => {
  it('carries the stable code and names itself', () => {
    const error = new AuthError('BAD_TOKEN', 'token 格式非法')
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('AuthError')
    expect(error.code).toBe('BAD_TOKEN')
    expect(error.message).toBe('token 格式非法')
  })
})

describe('messageOf', () => {
  it('renders an Error by its message', () => {
    expect(messageOf(new Error('socket hang up'))).toBe('socket hang up')
    expect(messageOf(new AuthError('JWKS_UNAVAILABLE', 'JWKS 获取失败：HTTP 503'))).toBe('JWKS 获取失败：HTTP 503')
  })

  it('stringifies a thrown value that is not an Error', () => {
    expect(messageOf('boom')).toBe('boom')
  })
})
