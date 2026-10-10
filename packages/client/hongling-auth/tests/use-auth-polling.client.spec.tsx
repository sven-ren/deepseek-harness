// @vitest-environment jsdom
/**
 * The shared polling policy: one status read per activation edge, one progress
 * interval only while a sign-in is in flight, and both cleaned up on change.
 */
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POLL_INTERVAL_MS, useAuthPolling, type AuthPollingActions } from '../src/client/use-auth-polling.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Stable action identities, as the inject face hands them to a component. */
function actions() {
  const refreshStatus = vi.fn()
  const refreshProgress = vi.fn()
  return { drive: { refreshStatus, refreshProgress } as AuthPollingActions, refreshStatus, refreshProgress }
}

function Probe({ active, inFlight, drive }: { active: boolean; inFlight: boolean; drive: AuthPollingActions }) {
  useAuthPolling(active, inFlight, drive)
  return null
}

describe('useAuthPolling', () => {
  it('reads the status once per activation, and not while hidden', () => {
    vi.useFakeTimers()
    const drive = actions()
    const hidden = render(<Probe active={false} inFlight={false} drive={drive.drive} />)
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS * 3) })
    expect(drive.refreshStatus).not.toHaveBeenCalled()
    hidden.unmount()

    const shown = render(<Probe active inFlight={false} drive={drive.drive} />)
    expect(drive.refreshStatus).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS * 3) })
    expect(drive.refreshStatus).toHaveBeenCalledTimes(1)
    expect(drive.refreshProgress).not.toHaveBeenCalled()
    shown.unmount()
  })

  it('polls the progress only while a sign-in is in flight, and stops on unmount', () => {
    vi.useFakeTimers()
    const drive = actions()
    const subject = render(<Probe active inFlight drive={drive.drive} />)
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS * 2) })
    expect(drive.refreshProgress).toHaveBeenCalledTimes(2)
    subject.rerender(<Probe active inFlight={false} drive={drive.drive} />)
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS * 2) })
    expect(drive.refreshProgress).toHaveBeenCalledTimes(2)
    subject.rerender(<Probe active inFlight drive={drive.drive} />)
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS) })
    expect(drive.refreshProgress).toHaveBeenCalledTimes(3)
    subject.unmount()
    act(() => { vi.advanceTimersByTime(POLL_INTERVAL_MS * 2) })
    expect(drive.refreshProgress).toHaveBeenCalledTimes(3)
    expect(POLL_INTERVAL_MS).toBe(1000)
  })
})
