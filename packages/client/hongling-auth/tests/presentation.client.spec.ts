/**
 * The pure projection: the in-flight predicate, the render case each
 * (status, progress) pair selects, and the two string derivations the panel
 * body renders from a signed-in projection.
 */
import { describe, expect, it } from 'vitest'
import type { AuthView } from '../src/client/presentation.ts'
import { avatarInitial, authView, identityLine, isInFlight } from '../src/client/presentation.ts'
import type { AuthStatus, LoginPhase } from '../src/types.ts'

type SignedIn = Extract<AuthView, { kind: 'signed-in' }>

function signedIn(overrides: Partial<SignedIn> = {}): SignedIn {
  return {
    kind: 'signed-in', username: 'u1', displayName: 'User One', email: 'u1@example.com', roles: [], expiresAt: undefined,
    ...overrides,
  }
}

describe('isInFlight', () => {
  it('is true only between opening the browser and verifying a token', () => {
    const inFlight: LoginPhase[] = ['waiting_browser', 'receiving', 'verifying']
    for (const phase of inFlight) expect(isInFlight(phase)).toBe(true)
    for (const phase of ['idle', 'done', 'error'] as LoginPhase[]) expect(isInFlight(phase)).toBe(false)
  })
})

describe('authView', () => {
  const profile: AuthStatus['profile'] = { username: 'u1', displayName: 'User One', roles: ['admin'] }

  it('projects a signed-in session, carrying its optional email and expiry', () => {
    expect(authView(
      { loggedIn: true, profile, expiresAt: 1_700_000_000_000 },
      { phase: 'idle' },
    )).toEqual({
      kind: 'signed-in', username: 'u1', displayName: 'User One', email: undefined, roles: ['admin'],
      expiresAt: 1_700_000_000_000,
    })
    // A session without an expiry reports none rather than the peer's last value.
    expect(authView({ loggedIn: true, profile }, { phase: 'done' })).toMatchObject({ expiresAt: undefined })
  })

  it('keeps the account on screen over a stale progress line', () => {
    expect(authView({ loggedIn: true, profile }, { phase: 'error', message: '登录失败' }).kind).toBe('signed-in')
  })

  it('does not invent an account for a sign-in without a profile', () => {
    expect(authView({ loggedIn: true }, { phase: 'error', message: '登录失败' }))
      .toEqual({ kind: 'failed', message: '登录失败' })
    expect(authView({ loggedIn: true }, { phase: 'idle' })).toEqual({ kind: 'idle' })
  })

  it('projects a failure with or without the Host message', () => {
    expect(authView({ loggedIn: false }, { phase: 'error', message: 'access_denied' }))
      .toEqual({ kind: 'failed', message: 'access_denied' })
    expect(authView({ loggedIn: false }, { phase: 'error' })).toEqual({ kind: 'failed', message: undefined })
  })

  it('projects each in-flight phase onto its copy key and the manual link', () => {
    for (const [phase, phaseKey] of [
      ['waiting_browser', 'phase.waiting_browser'],
      ['receiving', 'phase.receiving'],
      ['verifying', 'phase.verifying'],
    ] as const) {
      expect(authView({ loggedIn: false }, { phase, loginUrl: 'https://idp/login' }))
        .toEqual({ kind: 'waiting', phaseKey, loginUrl: 'https://idp/login' })
    }
    // A progress line without a URL still renders its phase.
    expect(authView({ loggedIn: false }, { phase: 'receiving' })).toMatchObject({ loginUrl: undefined })
  })

  it('rests at idle for the terminal phases', () => {
    expect(authView({ loggedIn: false }, { phase: 'idle' })).toEqual({ kind: 'idle' })
    expect(authView({ loggedIn: false }, { phase: 'done' })).toEqual({ kind: 'idle' })
  })
})

describe('identityLine', () => {
  it('joins the address and the roles', () => {
    expect(identityLine(signedIn({ roles: ['admin', 'ops'] }), 'Roles')).toBe('u1@example.com · Roles: admin, ops')
  })

  it('keeps only the roles when the profile names no address', () => {
    expect(identityLine(signedIn({ email: undefined, username: '', roles: ['admin'] }), 'Roles')).toBe('Roles: admin')
  })

  it('drops the role text when the profile carries none', () => {
    expect(identityLine(signedIn({ roles: [] }), 'Roles')).toBe('u1@example.com')
  })

  it('is empty when the profile names neither', () => {
    expect(identityLine(signedIn({ username: '', email: undefined, roles: [] }), 'Roles')).toBe('')
  })
})

describe('avatarInitial', () => {
  it('uppercases the first character of the display name', () => {
    expect(avatarInitial(signedIn({ displayName: 'sven ren' }))).toBe('S')
  })

  it('falls back to the username, then to a placeholder', () => {
    expect(avatarInitial(signedIn({ displayName: '', username: 'ren' }))).toBe('R')
    expect(avatarInitial(signedIn({ displayName: '', username: '' }))).toBe('?')
  })
})
