/** 虹灵 HongLing occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { HongLingBrandMark, HongLingBrandName } from './Brand.tsx'

/** Required service: the UI slot registry. */
export const inject = ['slots']

/**
 * Fill the sidebar and conversation-hero brand slots as one declaration-aware
 * registration set. Each target is a `single` slot whose shipped occupant sits
 * at priority 0; the lowest priority renders, so `-1` shadows it and the 虹灵
 * artwork replaces the default mark wherever the shell offers one.
 *
 * The three nested `inject` calls wait on every declaring package, so the set
 * works whether this row activates before or after them and withdraws together
 * when any declaration collapses.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', () =>
      ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: -1 }, HongLingBrandMark)
        yield ctx.slots.register({ name: 'sidebar.brand.name', priority: -1 }, HongLingBrandName)
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -1 }, HongLingBrandMark)
      })))
}
