// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { HongLingBrandMark, HongLingBrandName } from '../src/client/Brand.tsx'
import { MARK_VIEW_BOX, markArtwork, WORDMARK_VIEW_BOX, wordmarkArtwork } from '../src/client/brand-artwork.ts'
import { apply as hostApply } from '../src/index.ts'

afterEach(cleanup)

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'conversation.hero.brand.mark',
] as const

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

describe('虹灵 HongLing browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('shadows the shipped occupant of every single slot it fills', async () => {
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) {
      expect(subject.slots.entries(hole).map(entry => entry.options.priority)).toEqual([-1])
    }
  })

  it('renders the mark at the requested edge, decorative and host-classed', () => {
    const { container } = render(<HongLingBrandMark size={34} className="hero-fish" />)
    const mark = container.querySelector('svg')
    expect(mark?.getAttribute('viewBox')).toBe(MARK_VIEW_BOX)
    expect(mark?.getAttribute('width')).toBe('34')
    expect(mark?.getAttribute('height')).toBe('34')
    expect(mark?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('span')?.className).toBe('hero-fish')
  })

  it('namespaces the mark artwork by instance', () => {
    const artwork = markArtwork('probe')
    expect(artwork).toContain('id="probeRainbow"')
    expect(artwork).toContain('url(#probeRainbow)')
    expect(artwork).toContain('url(#probeShadow)')
    // The core keeps the page-base token so it reads as a cutout on any background.
    expect(artwork).toContain('var(--dsw-alias-bg-base, #FFFFFF)')
  })

  it('renders the wordmark without the independently slotted mark', () => {
    const { container } = render(<HongLingBrandName />)
    const wordmark = container.querySelector('svg')
    expect(wordmark?.getAttribute('viewBox')).toBe(WORDMARK_VIEW_BOX)
    expect(wordmark?.getAttribute('aria-hidden')).toBe('true')
    expect(wordmark?.innerHTML).toContain('虹灵')
    expect(wordmark?.innerHTML).toContain('id="')
  })

  it('namespaces the wordmark artwork by instance', () => {
    const artwork = wordmarkArtwork('probe')
    expect(artwork).toContain('id="probeAccent"')
    expect(artwork).toContain('url(#probeAccent)')
  })

  it('keeps two simultaneous mark instances on distinct gradient ids', () => {
    const { container } = render(
      <>
        <HongLingBrandMark size={24} />
        <HongLingBrandMark size={24} />
      </>,
    )
    const ids = [...container.querySelectorAll('linearGradient')].map(node => node.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})
