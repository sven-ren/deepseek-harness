/**
 * The browser half's state and actions.
 *
 * Both surfaces render from one snapshot, so a sign-in started in the settings
 * section is already visible when the overlay opens, and the overlay's
 * auto-close watches the same login state the section does. The class holds no
 * React: it exposes a snapshot store the render framework binds a selector
 * hook to, and plain async actions the inject face hands to the components.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/client/auth-panel
 */

import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { AuthStatus, LoginProgress } from '../types.ts'
import { AuthClientError, type AuthRpcCall } from './auth-rpc.ts'
import { notifyLoginChanged } from './login-bridge.ts'

/** A failure worth showing the operator, reduced to its code and message. */
export interface AuthPanelError {
  /** Machine-readable code; the Host-unavailable code gets its own copy in the UI. */
  code: string
  message: string
}

/** Everything both surfaces render from. */
export interface AuthPanelState {
  /** Whether the login overlay is showing. */
  open: boolean
  /** Last known redacted login state; never carries a token. */
  status: AuthStatus
  /** Last known login progress. */
  progress: LoginProgress
  /** A panel action is in flight. */
  busy: boolean
  /** A panel action failed, or undefined after a successful one. */
  error: AuthPanelError | undefined
  /** The login URL was copied to the clipboard. */
  copied: boolean
}

/** Signed-out resting state; the store returns a new object on every write. */
const INITIAL: AuthPanelState = {
  open: false,
  status: { loggedIn: false },
  progress: { phase: 'idle' },
  busy: false,
  error: undefined,
  copied: false,
}

/** Reduce any thrown value to the panel's error shape. */
function errorOf(error: unknown): AuthPanelError {
  if (error instanceof AuthClientError) return { code: error.code, message: error.message }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
}

/**
 * The stable face the plugin entry injects into both surfaces.
 *
 * The framework turns the `hooks` compartment into a bound selector hook, so
 * components never touch the store directly; the remaining members are the
 * actions, wrapped so a component cannot observe a rejected promise.
 */
export interface AuthPanelInjected {
  /** Snapshot sources the render framework binds `useAuth` to. */
  hooks: { auth: ObservableSnapshot<AuthPanelState> }
  /** Read the redacted status once. */
  refreshStatus: () => void
  /** Read the login progress once. */
  refreshProgress: () => void
  /** Start the browser sign-in. */
  startLogin: () => void
  /** Abandon the in-flight sign-in. */
  cancelLogin: () => void
  /** Forget the stored token. */
  logout: () => void
  /** @param url - login URL to copy. */
  copyLoginUrl: (url: string) => void
  /** Hide the login overlay. */
  closeOverlay: () => void
}

/**
 * Build the inject face for one panel.
 *
 * The object is constructed once per plugin life: the render framework caches
 * nothing about it, and a fresh object per call would change the action
 * identities the polling effects depend on.
 * @param panel - the panel the surfaces drive.
 * @returns the inject face, with every action wrapped to swallow its rejection.
 */
export function createAuthPanelFace(panel: AuthPanel): AuthPanelInjected {
  return {
    hooks: { auth: panel.state },
    refreshStatus: () => { void panel.refreshStatus() },
    refreshProgress: () => { void panel.refreshProgress() },
    startLogin: () => { void panel.startLogin() },
    cancelLogin: () => { void panel.cancelLogin() },
    logout: () => { void panel.logout() },
    copyLoginUrl: (url) => { void panel.copyLoginUrl(url) },
    closeOverlay: () => { panel.closeOverlay() },
  }
}

/**
 * Login state and actions for one plugin life.
 */
export class AuthPanel {
  /** Snapshot the render framework binds `useAuth` to. */
  readonly state: SnapshotStore<AuthPanelState> = createSnapshotStore(INITIAL)

  /** @param call - the typed Host channel caller. */
  constructor(private readonly call: AuthRpcCall) {}

  /** Show the login overlay. */
  openOverlay(): void {
    this.state.update((draft) => { draft.open = true })
  }

  /** Hide the login overlay. */
  closeOverlay(): void {
    this.state.update((draft) => { draft.open = false })
  }

  /**
   * Read the redacted status once.
   *
   * A read that fails leaves the last known state alone: the browser can reach
   * this panel before the connection service installs, and an unavailable Host
   * is not the same as a sign-out.
   */
  async refreshStatus(): Promise<void> {
    let status: AuthStatus
    try {
      status = await this.call('auth.getStatus', {})
    } catch {
      return
    }
    const becameSignedIn = !this.state.getSnapshot().status.loggedIn && status.loggedIn
    this.state.update((draft) => { draft.status = status })
    if (becameSignedIn) notifyLoginChanged()
  }

  /**
   * Read the login progress once, folding in the status when the flow ends.
   *
   * A failure is swallowed for the same reason {@link refreshStatus} swallows
   * one: polling must not surface transport noise as a login error.
   */
  async refreshProgress(): Promise<void> {
    let progress: LoginProgress
    try {
      progress = await this.call('auth.getLoginProgress', {})
    } catch {
      return
    }
    this.state.update((draft) => { draft.progress = progress })
    if (progress.phase === 'done') await this.refreshStatus()
  }

  /** Open the loopback receiver and send the operator to the IdP relay. */
  async startLogin(): Promise<void> {
    this.state.update((draft) => { draft.busy = true; draft.error = undefined; draft.copied = false })
    try {
      await this.call('auth.login', {})
      const progress = await this.call('auth.getLoginProgress', {})
      this.state.update((draft) => { draft.progress = progress; draft.busy = false })
    } catch (error) {
      this.state.update((draft) => { draft.busy = false; draft.error = errorOf(error) })
    }
  }

  /** Abandon an in-flight login and return the panel to its resting state. */
  async cancelLogin(): Promise<void> {
    try {
      await this.call('auth.cancelLogin', {})
    } catch {
      /* the session is already gone on the Host side; the panel still resets */
    }
    this.state.update((draft) => { draft.progress = { phase: 'idle' }; draft.error = undefined })
  }

  /** Forget the stored token, locally and on the Host. */
  async logout(): Promise<void> {
    this.state.update((draft) => { draft.busy = true })
    try {
      await this.call('auth.logout', {})
      this.state.update((draft) => {
        draft.status = { loggedIn: false }
        draft.progress = { phase: 'idle' }
        draft.busy = false
      })
      notifyLoginChanged()
    } catch (error) {
      this.state.update((draft) => { draft.busy = false; draft.error = errorOf(error) })
    }
  }

  /**
   * Copy the login URL, for a browser that never opened on its own.
   * @param url - the Host's login URL.
   */
  async copyLoginUrl(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // A denied clipboard is not a login failure: the URL stays on screen.
      return
    }
    this.state.update((draft) => { draft.copied = true })
  }
}
