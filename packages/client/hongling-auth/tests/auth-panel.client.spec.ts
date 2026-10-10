// @vitest-environment jsdom
/**
 * The panel: the resting state, the two surface toggles, each action's
 * success and failure arms, the change events the page hears, the clipboard
 * arm a denied browser forces, and the inject face the slot hands components.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthPanelState } from '../src/client/auth-panel.ts'
import { AuthPanel, createAuthPanelFace } from '../src/client/auth-panel.ts'
import { AuthClientError } from '../src/client/auth-rpc.ts'
import { LOGIN_CHANGED_EVENT } from '../src/client/login-bridge.ts'
import { channel } from './channel.client.ts'

type Respond = (endpoint: string, payload: unknown) => unknown

/** One panel over `respond`, plus the call log and the change events the page heard. */
function bench(respond: Respond = () => ({ loggedIn: false })) {
  const { call, log } = channel(respond)
  const panel = new AuthPanel(call)
  const changed = vi.fn()
  window.addEventListener(LOGIN_CHANGED_EVENT, changed)
  return {
    panel, call: log, changed,
    snapshot: (): AuthPanelState => panel.state.getSnapshot(),
    dispose: () => { window.removeEventListener(LOGIN_CHANGED_EVENT, changed) },
  }
}

const SIGNED_IN = {
  loggedIn: true,
  profile: { username: 'sven', displayName: 'Sven', roles: ['admin'] },
  expiresAt: 1_700_000_000_000,
  canRefresh: true,
}

afterEach(() => { vi.unstubAllGlobals() })

describe('AuthPanel', () => {
  it('rests signed out with the overlay hidden', () => {
    const subject = bench()
    expect(subject.snapshot()).toEqual({
      open: false, status: { loggedIn: false }, progress: { phase: 'idle' }, busy: false, error: undefined, copied: false,
    })
    subject.dispose()
  })

  it('shows and hides the overlay', () => {
    const subject = bench()
    subject.panel.openOverlay()
    expect(subject.snapshot().open).toBe(true)
    subject.panel.closeOverlay()
    expect(subject.snapshot().open).toBe(false)
    subject.dispose()
  })

  it('adopts the status and tells the page only when a session appears', async () => {
    const subject = bench(() => SIGNED_IN)
    await subject.panel.refreshStatus()
    expect(subject.snapshot().status).toEqual(SIGNED_IN)
    expect(subject.changed).toHaveBeenCalledTimes(1)

    // Reading the same session again is not a new sign-in.
    await subject.panel.refreshStatus()
    expect(subject.changed).toHaveBeenCalledTimes(1)
    subject.dispose()
  })

  it('leaves the last known status alone when the read fails', async () => {
    const subject = bench(() => { throw new AuthClientError('HOST_UNAVAILABLE', 'Host connection service is not published') })
    await subject.panel.refreshStatus()
    expect(subject.snapshot().status).toEqual({ loggedIn: false })
    expect(subject.changed).not.toHaveBeenCalled()
    subject.dispose()
  })

  it('folds the status in once the flow reports itself done', async () => {
    const subject = bench(endpoint => endpoint === 'auth.getLoginProgress'
      ? { phase: 'done' }
      : SIGNED_IN)
    await subject.panel.refreshProgress()
    expect(subject.call).toHaveBeenCalledTimes(2)
    expect(subject.snapshot().progress).toEqual({ phase: 'done' })
    expect(subject.snapshot().status).toEqual(SIGNED_IN)
    subject.dispose()
  })

  it('records progress in flight and swallows a failed read', async () => {
    const subject = bench(() => ({ phase: 'waiting_browser', loginUrl: 'https://idp/login' }))
    await subject.panel.refreshProgress()
    expect(subject.snapshot().progress).toEqual({ phase: 'waiting_browser', loginUrl: 'https://idp/login' })

    const offline = bench(() => { throw new Error('socket hang up') })
    await offline.panel.refreshProgress()
    expect(offline.snapshot().progress).toEqual({ phase: 'idle' })
    offline.dispose()
    subject.dispose()
  })

  it('opens a sign-in, clearing the previous failure and copy state', async () => {
    const subject = bench(endpoint => endpoint === 'auth.login' ? { started: true } : { phase: 'waiting_browser' })
    subject.panel.state.update((draft) => { draft.error = { code: 'OLD', message: 'stale' }; draft.copied = true })
    const started = subject.panel.startLogin()
    expect(subject.snapshot().busy).toBe(true)
    expect(subject.snapshot().error).toBeUndefined()
    expect(subject.snapshot().copied).toBe(false)
    await started
    expect(subject.snapshot()).toMatchObject({ busy: false, progress: { phase: 'waiting_browser' } })
    subject.dispose()
  })

  it('reports a failed sign-in by its code, its message, or its string form', async () => {
    for (const [thrown, expected] of [
      [new AuthClientError('LISTEN_FAILED', 'loopback 监听失败'), { code: 'LISTEN_FAILED', message: 'loopback 监听失败' }],
      [new Error('socket hang up'), { code: 'UNKNOWN', message: 'socket hang up' }],
      ['boom', { code: 'UNKNOWN', message: 'boom' }],
    ] as const) {
      const subject = bench(() => { throw thrown })
      await subject.panel.startLogin()
      expect(subject.snapshot()).toMatchObject({ busy: false, error: expected })
      subject.dispose()
    }
  })

  it('resets the flow on cancel, whether or not the Host still has the session', async () => {
    const subject = bench((endpoint) => {
      if (endpoint === 'auth.cancelLogin') throw new AuthClientError('UNKNOWN_ENDPOINT', '未知端点')
      return { phase: 'waiting_browser', loginUrl: 'https://idp/login' }
    })
    await subject.panel.refreshProgress()
    subject.panel.state.update((draft) => { draft.error = { code: 'OLD', message: 'stale' } })
    await subject.panel.cancelLogin()
    expect(subject.snapshot()).toMatchObject({ progress: { phase: 'idle' }, error: undefined })
    subject.dispose()
  })

  it('clears the account on sign-out and reports a refused one', async () => {
    const subject = bench(() => SIGNED_IN)
    await subject.panel.refreshStatus()
    await subject.panel.logout()
    expect(subject.snapshot()).toMatchObject({ status: { loggedIn: false }, progress: { phase: 'idle' }, busy: false })
    expect(subject.changed).toHaveBeenCalledTimes(2)

    const refused = bench(() => { throw new AuthClientError('COMMAND_ERROR', '磁盘不可写') })
    await refused.panel.logout()
    expect(refused.snapshot().busy).toBe(false)
    expect(refused.snapshot().error).toEqual({ code: 'COMMAND_ERROR', message: '磁盘不可写' })
    expect(refused.changed).not.toHaveBeenCalled()
    refused.dispose()
    subject.dispose()
  })

  it('marks the URL copied, and keeps the URL on screen when the clipboard is denied', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const subject = bench()
    await subject.panel.copyLoginUrl('https://idp/login')
    expect(writeText).toHaveBeenCalledWith('https://idp/login')
    expect(subject.snapshot().copied).toBe(true)
    subject.dispose()

    vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied') } } })
    const denied = bench()
    await denied.panel.copyLoginUrl('https://idp/login')
    expect(denied.snapshot().copied).toBe(false)
    denied.dispose()
  })

  it('hands components one stable inject face whose actions never reject', async () => {
    const subject = bench(() => { throw new Error('offline') })
    const face = createAuthPanelFace(subject.panel)
    expect(face.hooks.auth).toBe(subject.panel.state)
    // Every action is a void wrapper around the panel's own promise.
    for (const action of [
      face.refreshStatus, face.refreshProgress, face.startLogin, face.cancelLogin, face.logout,
    ]) {
      // oxlint-disable-next-line typescript/no-confusing-void-expression -- handing nothing back is the contract under test.
      expect(action()).toBeUndefined()
    }
    face.copyLoginUrl('https://idp/login')
    face.closeOverlay()
    // oxlint-disable-next-line typescript/no-confusing-void-expression -- handing nothing back is the contract under test.
    expect(face.closeOverlay()).toBeUndefined()
    await vi.waitFor(() => { expect(subject.snapshot().error).toEqual({ code: 'UNKNOWN', message: 'offline' }) })
    subject.dispose()
  })
})
