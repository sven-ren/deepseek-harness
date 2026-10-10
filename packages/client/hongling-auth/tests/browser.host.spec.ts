/**
 * Browser launching: the per-platform opener command, the best-effort spawn
 * (never throwing, never blocking on the child), and the two failure arms —
 * a child that reports an error and a spawn that throws outright.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionLogger } from '../src/login-session.ts'
import { browserCommand, createBrowserLauncher } from '../src/browser.ts'

// The real spawn is replaced in every test: on Windows the win32 opener is
// `cmd /c start`, which would open an actual browser window in the suite.
const spawned = vi.hoisted(() => ({ calls: [] as { command: string; args: readonly string[] }[] }))
vi.mock('node:child_process', () => ({
  spawn: (command: string, args: readonly string[]) => {
    spawned.calls.push({ command, args })
    return { on: () => undefined, unref: () => undefined }
  },
}))

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies SessionLogger
}

/** One fake child: records the error listener and exposes an unref spy. */
function fakeChild() {
  const listeners: ((error: Error) => void)[] = []
  const unref = vi.fn()
  return {
    spawn: () => ({ on: (_event: 'error', listener: (error: Error) => void) => { listeners.push(listener) }, unref }),
    fail: (error: Error) => { for (const listener of listeners) listener(error) },
    unref,
  }
}

beforeEach(() => { spawned.calls.length = 0 })

describe('browserCommand', () => {
  it('uses the platform opener, with an empty Windows window title', () => {
    expect(browserCommand('http://127.0.0.1:1/cb', 'darwin')).toEqual({ command: 'open', args: ['http://127.0.0.1:1/cb'] })
    expect(browserCommand('http://127.0.0.1:1/cb', 'win32')).toEqual({
      command: 'cmd', args: ['/c', 'start', '', 'http://127.0.0.1:1/cb'],
    })
    expect(browserCommand('http://127.0.0.1:1/cb', 'linux')).toEqual({ command: 'xdg-open', args: ['http://127.0.0.1:1/cb'] })
  })
})

describe('createBrowserLauncher', () => {
  it('spawns the opener detached and does not wait for the child', () => {
    const log = logger()
    const child = fakeChild()
    createBrowserLauncher(log, { platform: 'darwin', spawn: child.spawn })('http://127.0.0.1:1/cb')
    expect(child.unref).toHaveBeenCalledTimes(1)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('warns instead of throwing when the child reports an error', () => {
    const log = logger()
    const child = fakeChild()
    createBrowserLauncher(log, { platform: 'linux', spawn: child.spawn })('http://127.0.0.1:1/cb')
    child.fail(new Error('no such file'))
    expect(log.warn).toHaveBeenCalledWith('[hongling-auth] 打开浏览器失败：no such file')
  })

  it('warns when the platform cannot spawn at all', () => {
    const log = logger()
    const launch = createBrowserLauncher(log, {
      platform: 'linux',
      spawn: () => { throw new Error('spawn failed') },
    })
    expect(() => { launch('http://127.0.0.1:1/cb') }).not.toThrow()
    expect(log.warn).toHaveBeenCalledWith('[hongling-auth] 打开浏览器失败：spawn failed')
  })

  it('renders a non-Error throw as text', () => {
    const log = logger()
    const launch = createBrowserLauncher(log, {
      platform: 'linux',
      spawn: () => { throw 'no opener' },
    })
    launch('http://127.0.0.1:1/cb')
    expect(log.warn).toHaveBeenCalledWith('[hongling-auth] 打开浏览器失败：no opener')
  })

  it('defaults to the running platform and the detached node spawn', () => {
    const log = logger()
    createBrowserLauncher(log)('http://127.0.0.1:1/cb')
    const expected = browserCommand('http://127.0.0.1:1/cb', process.platform)
    expect(spawned.calls).toEqual([{ command: expected.command, args: expected.args }])
    expect(log.warn).not.toHaveBeenCalled()
  })
})
