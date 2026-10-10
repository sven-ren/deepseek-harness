// @vitest-environment jsdom
/**
 * The page-level bridge: the two event names other packages address this
 * plugin by, the dispatch on a login change, the request subscription, and
 * the no-window arm of both entry points.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LOGIN_CHANGED_EVENT, LOGIN_REQUEST_EVENT, notifyLoginChanged, onLoginRequest } from '../src/client/login-bridge.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('login bridge', () => {
  it('dispatches a custom change event the page can hear', () => {
    const heard = vi.fn()
    window.addEventListener(LOGIN_CHANGED_EVENT, heard)
    try {
      notifyLoginChanged()
      expect(heard).toHaveBeenCalledTimes(1)
      expect(heard.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent)
    } finally {
      window.removeEventListener(LOGIN_CHANGED_EVENT, heard)
    }
  })

  it('subscribes to sign-in requests and removes the listener on unsubscribe', () => {
    const listener = vi.fn()
    const off = onLoginRequest(listener)
    window.dispatchEvent(new CustomEvent(LOGIN_REQUEST_EVENT))
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    window.dispatchEvent(new CustomEvent(LOGIN_REQUEST_EVENT))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(LOGIN_REQUEST_EVENT).toBe('hongling-auth:request-login')
  })

  it('stays inert outside a browser page', () => {
    vi.stubGlobal('window', undefined)
    expect(() => { notifyLoginChanged() }).not.toThrow()
    const off = onLoginRequest(vi.fn())
    expect(() => { off() }).not.toThrow()
  })
})
