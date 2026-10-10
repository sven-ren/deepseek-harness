// @vitest-environment jsdom
/**
 * The account settings section: it renders the shared body from the injected
 * panel, reads the status on mount, and drives the panel's actions.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-ui-renderer/src/client/bind.ts'
import { AuthPanel, createAuthPanelFace } from '../src/client/auth-panel.ts'
import { AuthClientError } from '../src/client/auth-rpc.ts'
import { AuthSection } from '../src/client/AuthSection.tsx'
import { en } from '../src/client/locales.ts'
import css from '../src/client/auth.module.css'
import { channel } from './channel.client.ts'

afterEach(cleanup)

const SIGNED_IN = { loggedIn: true, profile: { username: 'sven', displayName: 'Sven Ren', roles: ['admin'] } }

/** Mount the section over a panel whose RPC answers `respond`. */
function mount(respond: (endpoint: string) => unknown = () => ({ loggedIn: false })) {
  const { call, log } = channel(endpoint => respond(endpoint))
  const panel = new AuthPanel(call)
  const { hooks, ...actions } = createAuthPanelFace(panel)
  const rendered = render(
    <AuthSection
      {...({} as GlobalStandardProps)}
      close={vi.fn()}
      {...actions}
      useAuth={bindSnapshotSelector(hooks.auth)}
      t={key => en[key as keyof typeof en]}
    />,
  )
  return { panel, call: log, rendered }
}

it('renders the body inside the settings column and reads the status on mount', () => {
  const subject = mount()
  expect(subject.rendered.container.querySelector(`.${css.section}`)).toBeTruthy()
  expect(subject.call).toHaveBeenCalledWith('auth.getStatus', {})
  expect(screen.getByRole('button', { name: en['action.login'] })).toBeTruthy()
})

it('starts the sign-in from the section and follows the reported progress', async () => {
  const subject = mount(endpoint => endpoint === 'auth.login'
    ? { started: true }
    : { phase: 'waiting_browser', loginUrl: 'https://idp.example.com/dsh/login?port=1' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['action.login'] })) })
  expect(subject.call).toHaveBeenCalledWith('auth.login', {})
  expect(screen.getByText(en['phase.waiting_browser'])).toBeTruthy()
  expect(screen.getByText('https://idp.example.com/dsh/login?port=1')).toBeTruthy()
})

it('shows the account once the status reports a session, and signs it out', async () => {
  const subject = mount(() => SIGNED_IN)
  await act(async () => { await subject.panel.refreshStatus() })
  expect(screen.getByText('Sven Ren')).toBeTruthy()
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['action.logout'] })) })
  expect(subject.call).toHaveBeenCalledWith('auth.logout', {})
  expect(subject.panel.state.getSnapshot().status).toEqual({ loggedIn: false })
})

it('surfaces an unavailable Host instead of pretending the operator signed out', async () => {
  const subject = mount(() => { throw new AuthClientError('HOST_UNAVAILABLE', 'Host connection service is not published') })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: en['action.login'] })) })
  expect(screen.getByText(en['error.unavailable'])).toBeTruthy()
  expect(subject.panel.state.getSnapshot().status).toEqual({ loggedIn: false })
})
