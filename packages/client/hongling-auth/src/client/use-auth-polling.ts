/**
 * One polling policy for both surfaces.
 *
 * The settings section polls while a sign-in is in flight; the overlay polls
 * while it is open and the same flow is running. Writing the policy once keeps
 * them from drifting, and starting the poll on the `inFlight` edge rather than
 * on mount is what makes a sign-in started from the section visible in an
 * overlay opened afterwards.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/use-auth-polling
 */

import { useEffect } from 'react'

/** Progress poll interval while a browser sign-in is in flight. */
export const POLL_INTERVAL_MS = 1000

/** Stable actions the hook drives. */
export interface AuthPollingActions {
  /** Read the redacted status once. */
  refreshStatus: () => void
  /** Read the login progress once. */
  refreshProgress: () => void
}

/**
 * Keep the panel's status and progress fresh while a surface is mounted.
 * @param active - whether the surface is showing; a hidden overlay stops polling.
 * @param inFlight - whether a browser sign-in is running.
 * @param actions - the panel's stable reads; the identity must not change per render.
 */
export function useAuthPolling(active: boolean, inFlight: boolean, actions: AuthPollingActions): void {
  const { refreshStatus, refreshProgress } = actions
  useEffect(() => {
    if (!active) return
    refreshStatus()
  }, [active, refreshStatus])
  useEffect(() => {
    if (!active || !inFlight) return
    const timer = setInterval(refreshProgress, POLL_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [active, inFlight, refreshProgress])
}
