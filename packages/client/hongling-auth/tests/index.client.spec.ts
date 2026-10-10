// @vitest-environment jsdom
/**
 * The client entry: the services it claims, the two occupants it registers
 * (with the priority that shadows the shipped account section), the inject
 * face it hands them, the channel the face drives, the page event that opens
 * the overlay, and the teardown that removes both.
 */
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthOverlay } from '../src/client/AuthOverlay.tsx'
import { AuthSection } from '../src/client/AuthSection.tsx'
import type { AuthPanelInjected } from '../src/client/auth-panel.ts'
import { apply, inject } from '../src/client/index.ts'
import { AUTH_NS } from '../src/client/locales.ts'
import { LOGIN_REQUEST_EVENT } from '../src/client/login-bridge.ts'
import { CHANNEL } from '../src/channel.ts'

/** Both slots this plugin occupies, as the composition declares them. */
const HOLES = {
  'settings.section': { kind: 'list', scope: 'root' },
  'shell.overlay': { kind: 'list', scope: 'root' },
} as const

afterEach(() => { vi.unstubAllGlobals() })

interface Bench {
  ctx: Context
  slots: SlotRegistry
  rpc: ReturnType<typeof vi.fn>
  declareHoles: () => void
  dispose: () => Promise<void>
}

/** The client entry over a real registry, a real locale, and a fake channel. */
async function bench(): Promise<Bench> {
  vi.stubGlobal('navigator', { languages: ['en-US'], language: 'en-US' })
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  ctx.provide('locale', new LocaleRuntime(ctx))
  const rpc = vi.fn(async () => ({ ok: true as const, value: { loggedIn: false } }))
  ctx.provide('connection', { rpc: { call: rpc } } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    ctx, slots, rpc,
    declareHoles: () => { slots.register({ name: 'root', children: HOLES } as never, () => null) },
    dispose: () => fiber.dispose(),
  }
}

describe('虹灵 HongLing auth client entry', () => {
  it('claims the registry, the locale, and the connection', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
    expect(AUTH_NS).toBe('hongling.auth')
    expect(CHANNEL).toBe('/hongling-auth')
  })

  it('waits for each hole and fills both when the composition declares them', async () => {
    const subject = await bench()
    expect(subject.slots.entries('settings.section')).toHaveLength(0)
    expect(subject.slots.entries('shell.overlay')).toHaveLength(0)

    subject.declareHoles()
    await Promise.resolve()
    const section = subject.slots.entries('settings.section')
    const overlay = subject.slots.entries('shell.overlay')
    expect(section).toHaveLength(1)
    expect(overlay).toHaveLength(1)
    expect(section[0]?.component).toBe(AuthSection)
    expect(overlay[0]?.component).toBe(AuthOverlay)
    await subject.dispose()
  })

  it('shadows the shipped account section from a lower priority', async () => {
    const subject = await bench()
    subject.declareHoles()
    await Promise.resolve()
    const section = subject.slots.entries('settings.section')[0]
    expect(section?.options).toMatchObject({ id: 'account', order: -10, priority: -1 })
    expect(section?.locale).toBe(AUTH_NS)
    // A lazy label, so a locale switch never re-registers the occupant.
    expect(typeof section?.options.label).toBe('function')
    expect(resolveSlotLabel(section!.options.label)).toBe('Account')
    // The shipped account package claims the same id at the default priority;
    // the registry keeps both entries and the election still renders this one.
    subject.slots.register({ name: 'settings.section', id: 'account', order: -10, label: 'Account' } as never, () => null)
    const elected = subject.slots.entriesOfSlot('settings.section')
    expect(elected).toHaveLength(1)
    expect(elected[0]?.component).toBe(AuthSection)

    const overlay = subject.slots.entries('shell.overlay')[0]
    expect(overlay?.options).toMatchObject({ id: 'hongling-auth', order: 90 })
    expect(overlay?.locale).toBe(AUTH_NS)
    expect(typeof overlay?.options.label).not.toBe('function')
    await subject.dispose()
  })

  it('gives both surfaces one shared face that drives the plugin channel', async () => {
    const subject = await bench()
    subject.declareHoles()
    await Promise.resolve()
    const sectionFace = subject.slots.entries('settings.section')[0]!.inject!() as object as AuthPanelInjected
    const overlayFace = subject.slots.entries('shell.overlay')[0]!.inject!() as object as AuthPanelInjected
    expect(overlayFace).toBe(sectionFace)
    expect(sectionFace.hooks.auth.getSnapshot()).toEqual({
      open: false, status: { loggedIn: false }, progress: { phase: 'idle' }, busy: false, error: undefined, copied: false,
    })
    sectionFace.refreshStatus()
    await vi.waitFor(() => { expect(subject.rpc).toHaveBeenCalledWith(CHANNEL, 'auth.getStatus', {}) })
    sectionFace.startLogin()
    await vi.waitFor(() => { expect(subject.rpc).toHaveBeenCalledWith(CHANNEL, 'auth.login', {}) })
    await subject.dispose()
  })

  it('opens the overlay when a page feature raises the request event, until teardown', async () => {
    const subject = await bench()
    subject.declareHoles()
    await Promise.resolve()
    const face = subject.slots.entries('shell.overlay')[0]!.inject!() as object as AuthPanelInjected
    window.dispatchEvent(new CustomEvent(LOGIN_REQUEST_EVENT))
    expect(face.hooks.auth.getSnapshot().open).toBe(true)

    await subject.dispose()
    expect(subject.slots.entries('settings.section')).toHaveLength(0)
    expect(subject.slots.entries('shell.overlay')).toHaveLength(0)
  })
})
