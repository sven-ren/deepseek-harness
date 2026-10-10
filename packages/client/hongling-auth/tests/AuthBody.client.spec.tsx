// @vitest-environment jsdom
/**
 * The one panel body both surfaces render: every render case, the avatar
 * geometry, the copy control's two labels, and the error line under the body.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthAvatar, AuthBody, type AuthBodyProps } from '../src/client/AuthBody.tsx'
import { HOST_UNAVAILABLE } from '../src/client/auth-rpc.ts'
import { AUTH_NS, en } from '../src/client/locales.ts'
import type { AuthView } from '../src/client/presentation.ts'
import css from '../src/client/auth.module.css'

afterEach(cleanup)

type SignedIn = Extract<AuthView, { kind: 'signed-in' }>

function viewOf(overrides: Partial<SignedIn> = {}): SignedIn {
  return {
    kind: 'signed-in', username: 'sven', displayName: 'Sven Ren', email: 'sven@example.com',
    roles: ['admin', 'ops'], expiresAt: undefined,
    ...overrides,
  }
}

function props(overrides: Partial<AuthBodyProps> = {}): AuthBodyProps {
  return {
    view: { kind: 'idle' },
    t: key => en[key],
    avatarSize: 40,
    busy: false,
    copied: false,
    error: undefined,
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onLogout: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  }
}

describe('AuthAvatar', () => {
  it('renders the monogram at the requested edge, decorative', () => {
    const { container } = render(<AuthAvatar initial="S" size={45} />)
    const avatar = container.querySelector('span')
    expect(avatar?.textContent).toBe('S')
    expect(avatar?.getAttribute('aria-hidden')).toBe('true')
    // The glyph is half the circle, and an odd edge length lands on a whole pixel.
    expect(avatar?.style.width).toBe('45px')
    expect(avatar?.style.fontSize).toBe('23px')
  })
})

describe('AuthBody', () => {
  it('summarizes a signed-in session and offers the sign-out', () => {
    const onLogout = vi.fn()
    render(<AuthBody {...props({ view: viewOf({ expiresAt: Date.UTC(2026, 0, 2, 3, 4, 5) }), onLogout })} />)
    expect(screen.getByText('Sven Ren')).toBeTruthy()
    expect(screen.getByText('sven@example.com · Roles: admin, ops')).toBeTruthy()
    expect(screen.getByText(`${en['hint.expiry']}: ${new Date(Date.UTC(2026, 0, 2, 3, 4, 5)).toLocaleString()}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['action.logout'] }))
    expect(onLogout).toHaveBeenCalledOnce()
  })

  it('omits the expiry line and the identity line when the profile carries neither', () => {
    const { container } = render(<AuthBody {...props({ view: viewOf({ email: undefined, username: '', roles: [] }) })} />)
    expect(screen.queryByText(en['hint.expiry'], { exact: false })).toBeNull()
    expect(container.querySelectorAll(`.${css.identity} .${css.muted}`)).toHaveLength(0)
  })

  it('keeps the sign-out disabled while an action is in flight', () => {
    render(<AuthBody {...props({ view: viewOf(), busy: true })} />)
    expect(screen.getByRole('button', { name: en['action.logout'] }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the in-flight phase with the manual link and its two copy labels', () => {
    const onCopy = vi.fn()
    const url = 'https://idp.example.com/dsh/login?port=51234'
    const { unmount } = render(<AuthBody {...props({
      view: { kind: 'waiting', phaseKey: 'phase.waiting_browser', loginUrl: url }, onCopy,
    })} />)
    expect(screen.getByText(en['phase.waiting_browser'])).toBeTruthy()
    expect(screen.getByText(en['hint.manual'])).toBeTruthy()
    expect(screen.getByText(url)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['action.copy'] }))
    expect(onCopy).toHaveBeenCalledWith(url)
    unmount()

    render(<AuthBody {...props({ view: { kind: 'waiting', phaseKey: 'phase.receiving', loginUrl: url }, copied: true })} />)
    expect(screen.getByRole('button', { name: en['action.copied'] })).toBeTruthy()
  })

  it('offers only the cancel when the Host reported no login URL', () => {
    render(<AuthBody {...props({ view: { kind: 'waiting', phaseKey: 'phase.verifying', loginUrl: undefined } })} />)
    expect(screen.getByText(en['phase.verifying'])).toBeTruthy()
    expect(screen.queryByText(en['hint.manual'])).toBeNull()
    expect(screen.queryByRole('button', { name: en['action.copy'] })).toBeNull()
    expect(screen.getByRole('button', { name: en['action.cancel'] })).toBeTruthy()
  })

  it('reports a failure with the Host message, or the generic copy without one', () => {
    const onStart = vi.fn()
    const { unmount } = render(<AuthBody {...props({ view: { kind: 'failed', message: 'access_denied' }, onStart })} />)
    expect(screen.getByText('access_denied')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['action.retry'] }))
    expect(onStart).toHaveBeenCalledOnce()
    unmount()

    render(<AuthBody {...props({ view: { kind: 'failed', message: undefined }, busy: true })} />)
    expect(screen.getByText(en['phase.error'])).toBeTruthy()
    expect(screen.getByRole('button', { name: en['action.retry'] }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: en['action.cancel'] })).toBeTruthy()
  })

  it('offers the single sign-in entry at rest', () => {
    const onStart = vi.fn()
    const { unmount } = render(<AuthBody {...props({ onStart })} />)
    fireEvent.click(screen.getByRole('button', { name: en['action.login'] }))
    expect(onStart).toHaveBeenCalledOnce()
    unmount()

    render(<AuthBody {...props({ busy: true })} />)
    expect(screen.getByRole('button', { name: en['action.login'] }).hasAttribute('disabled')).toBe(true)
  })

  it('translates the unavailable-Host failure and passes any other message through', () => {
    const { unmount } = render(<AuthBody {...props({ error: { code: HOST_UNAVAILABLE, message: 'Host connection service is not published' } })} />)
    expect(screen.getByText(en['error.unavailable'])).toBeTruthy()
    unmount()

    render(<AuthBody {...props({ error: { code: 'COMMAND_ERROR', message: '磁盘不可写' } })} />)
    expect(screen.getByText('磁盘不可写')).toBeTruthy()
    expect(AUTH_NS).toBe('hongling.auth')
  })
})
