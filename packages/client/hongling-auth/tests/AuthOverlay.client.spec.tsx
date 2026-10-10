// @vitest-environment jsdom
/**
 * The login overlay: the modal chrome around the shared body, the request the
 * page raises to open it, and the self-dismissal that returns the operator to
 * whatever asked them to sign in.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts'
import { AuthOverlay, CLOSE_DELAY_MS } from '../src/client/AuthOverlay.tsx'
import { AuthPanel, createAuthPanelFace } from '../src/client/auth-panel.ts'
import { en } from '../src/client/locales.ts'
import { channel } from './channel.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const SIGNED_IN = { loggedIn: true, profile: { username: 'sven', displayName: 'Sven Ren', roles: [] } }

async function bench(respond: () => unknown = () => ({ loggedIn: false })) {
  const { call } = channel(() => respond())
  const panel = new AuthPanel(call)
  const { hooks, ...actions } = createAuthPanelFace(panel)
  const rendered = render(
    <AuthOverlay
      {...({} as GlobalStandardProps)}
      {...actions}
      useAuth={bindSnapshotSelector(hooks.auth)}
      t={key => en[key as keyof typeof en]}
    />,
  )
  return { panel, rendered }
}

it('renders nothing until the panel opens, then the shell-owned modal chrome', async () => {
  const subject = await bench()
  expect(screen.queryByRole('dialog')).toBeNull()

  await act(async () => { subject.panel.openOverlay() })
  expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe(en['title'])
  expect(screen.getByRole('button', { name: en['close'] })).toBeTruthy()
  expect(screen.getByRole('button', { name: en['action.login'] })).toBeTruthy()
})

it('closes from the modal command', async () => {
  const subject = await bench()
  await act(async () => { subject.panel.openOverlay() })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['close'] })) })
  expect(subject.panel.state.getSnapshot().open).toBe(false)
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('dismisses itself shortly after a sign-in lands', async () => {
  vi.useFakeTimers()
  const subject = await bench(() => SIGNED_IN)
  await act(async () => { subject.panel.openOverlay() })
  await act(async () => { await subject.panel.refreshStatus() })
  expect(screen.getByText('Sven Ren')).toBeTruthy()

  await act(async () => { vi.advanceTimersByTime(CLOSE_DELAY_MS - 1) })
  expect(subject.panel.state.getSnapshot().open).toBe(true)
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(subject.panel.state.getSnapshot().open).toBe(false)
  expect(CLOSE_DELAY_MS).toBe(600)
})

it('stays open while the operator is not signed in, and drops the timer on unmount', async () => {
  vi.useFakeTimers()
  const subject = await bench()
  await act(async () => { subject.panel.openOverlay() })
  await act(async () => { vi.advanceTimersByTime(CLOSE_DELAY_MS * 2) })
  expect(subject.panel.state.getSnapshot().open).toBe(true)

  const signedIn = await bench(() => SIGNED_IN)
  await act(async () => { signedIn.panel.openOverlay() })
  await act(async () => { await signedIn.panel.refreshStatus() })
  signedIn.rendered.unmount()
  await act(async () => { vi.advanceTimersByTime(CLOSE_DELAY_MS * 2) })
  // The unmounted overlay no longer owns the dismissal.
  expect(signedIn.panel.state.getSnapshot().open).toBe(true)
})
