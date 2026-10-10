import { useId } from 'react'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MARK_VIEW_BOX, markArtwork, WORDMARK_VIEW_BOX, wordmarkArtwork } from './brand-artwork.ts'

/**
 * Render the 虹灵 mark at the host-requested edge.
 *
 * Both brand-mark slots use this occupant. The sidebar share supplies `size`
 * alone and wraps the result in its own geometry; the conversation hero also
 * supplies the class carrying the mark's hover-swim transform. The artwork is
 * decorative, so it is hidden from assistive technology — the same treatment
 * the shell's own mark and wordmark carry.
 * @param props - Host-supplied mark presentation.
 * @returns the 虹灵 mark inside its host-geometry wrapper.
 */
export function HongLingBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  const instanceId = useId().replaceAll(':', '')
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', flex: 'none', width: size, height: size, lineHeight: 0 }}
    >
      <svg
        width={size}
        height={size}
        viewBox={MARK_VIEW_BOX}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        dangerouslySetInnerHTML={{ __html: markArtwork(instanceId) }}
      />
    </span>
  )
}

/**
 * Render the 虹灵 HongLing wordmark for the expanded sidebar brand row. The
 * owner share is empty: the occupant owns its own content and width, and the
 * svg tracks the row's type scale at 1.8em tall.
 * @returns the wordmark inside its row-height wrapper.
 */
export function HongLingBrandName() {
  const instanceId = useId().replaceAll(':', '')
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0, color: 'inherit' }}>
      <svg
        viewBox={WORDMARK_VIEW_BOX}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        style={{ height: '1.8em', width: 'auto', display: 'block', overflow: 'visible' }}
        dangerouslySetInnerHTML={{ __html: wordmarkArtwork(instanceId) }}
      />
    </span>
  )
}
