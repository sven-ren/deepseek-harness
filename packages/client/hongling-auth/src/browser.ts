/**
 * Handing the login URL to the operator's default browser.
 *
 * The launch is best-effort by design: a headless or containerized host has
 * no browser to open, and that is not a login failure. The command form is a
 * pure function so the platform variants are testable without spawning
 * anything, and the panel always shows the URL for manual copying.
 *
 * @module @deepseek-ai/dsh-client-hongling-auth/browser
 */

import { spawn } from 'node:child_process'
import type { LaunchExternal, SessionLogger } from './login-session.ts'

/** The command and arguments that open one URL on a platform. */
export interface BrowserCommand {
  command: string
  args: string[]
}

/** Process-spawning boundary, injectable for tests. */
export type SpawnDetached = (
  command: string,
  args: readonly string[],
) => { on(event: 'error', listener: (error: Error) => void): unknown; unref(): void }

/**
 * The platform's URL opener.
 * @param url - the URL to open.
 * @param platform - the operating system to target.
 * @returns the command and its arguments. Windows goes through `cmd /c start`
 * with an empty title argument so a URL containing spaces is not mistaken for
 * the window title.
 */
export function browserCommand(url: string, platform: NodeJS.Platform): BrowserCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] }
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  return { command: 'xdg-open', args: [url] }
}

/**
 * Build the launcher used by the login flow.
 * @param logger - receives a warning when the platform could not start a browser.
 * @param options - platform and spawn overrides.
 * @returns a launcher that never throws and never blocks on the child.
 */
export function createBrowserLauncher(
  logger: SessionLogger,
  options: { platform?: NodeJS.Platform; spawn?: SpawnDetached } = {},
): LaunchExternal {
  const platform = options.platform ?? process.platform
  const run = options.spawn ?? ((command: string, args: readonly string[]) =>
    spawn(command, [...args], { detached: true, stdio: 'ignore', shell: false }))
  return (url: string): void => {
    const { command, args } = browserCommand(url, platform)
    try {
      const child = run(command, args)
      child.on('error', (error: Error) => { logger.warn('[hongling-auth] 打开浏览器失败：' + error.message) })
      child.unref()
    } catch (error) {
      logger.warn('[hongling-auth] 打开浏览器失败：' + (error instanceof Error ? error.message : String(error)))
    }
  }
}
