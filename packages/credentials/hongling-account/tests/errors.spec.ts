import { expect, it } from 'vitest'
import { AuthError, messageOf } from '../src/errors.ts'

it('carries a published sign-in code alongside its operator message', () => {
  const error = new AuthError('network', 'JWKS 获取失败：boom')
  expect(error).toBeInstanceOf(Error)
  expect(error.name).toBe('AuthError')
  expect(error.code).toBe('network')
  expect(error.message).toBe('JWKS 获取失败：boom')
})

it('renders any caught value as a message', () => {
  expect(messageOf(new Error('boom'))).toBe('boom')
  expect(messageOf('plain')).toBe('plain')
  expect(messageOf(undefined)).toBe('undefined')
})
