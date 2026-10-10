/**
 * 虹灵 HongLing brand artwork, inlined from the mark and wordmark SVGs of the
 * source plugin.
 *
 * Both exports return inner-SVG markup injected through `dangerouslySetInnerHTML`,
 * following the `dsh-client-ui-primitives` code-file icons: the authored
 * attribute spelling survives, and `class` rules become presentation attributes
 * so no stylesheet is injected document-wide. Every paint except the mark's core
 * cutout and the wordmark's accent runs through `currentColor`, so the artwork
 * tracks the host brand row's ink in both themes.
 *
 * Gradient and filter ids carry the caller's instance id because the mark
 * renders in the sidebar and the conversation hero at once; shared ids would
 * collide in the document.
 */

/** Box the mark is cropped to, tightened to its artwork bounds in the source 512 box. */
export const MARK_VIEW_BOX = '106 101 300 300'

/**
 * Box the wordmark is cropped to; the source 1200x300 box kept empty margins,
 * and the headroom here leaves descenders and the baseline rule unclipped.
 */
export const WORDMARK_VIEW_BOX = '20 20 1160 260'

/**
 * Render the inner markup of the 虹灵 mark: rainbow wings, the H they form, and
 * the node core that reads as a cutout on any background.
 * @param instanceId - Document-unique fragment safe inside `url(#…)` references.
 * @returns the mark's `<defs>` and painted groups, without the outer `<svg>`.
 */
export function markArtwork(instanceId: string): string {
  return `<defs>
    <linearGradient id="${instanceId}Rainbow" x1="130" y1="350" x2="390" y2="145" gradientUnits="userSpaceOnUse">
      <stop stop-color="#41E4FF"/>
      <stop offset="0.32" stop-color="#9B7BFF"/>
      <stop offset="0.66" stop-color="#FF63B8"/>
      <stop offset="1" stop-color="#FFD56A"/>
    </linearGradient>
    <filter id="${instanceId}Shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#5035B8" flood-opacity=".20"/>
    </filter>
  </defs>
  <g filter="url(#${instanceId}Shadow)">
    <path fill="currentColor" d="M135 150c0-17 20-27 34-16 39 31 64 70 86 108 23-38 48-77 88-108 14-11 34-1 34 16v47c-35 27-61 65-85 105-11 18-23 37-37 55-14-18-26-37-37-55-24-40-49-78-83-105v-47Z"/>
    <path fill="url(#${instanceId}Rainbow)" d="M135 315c34-28 59-65 83-105 11-18 23-37 37-55 14 18 26 37 37 55 24 40 50 77 85 105v47c0 17-20 27-34 16-40-31-65-70-88-108-22 38-47 77-86 108-14 11-34 1-34-16v-47Z"/>
    <circle cx="256" cy="256" r="34" stroke-width="12" fill="var(--dsw-alias-bg-base, #FFFFFF)" stroke="currentColor"/>
    <circle cx="256" cy="256" r="9" fill="#61E8FF"/>
  </g>
  <g fill="currentColor">
    <circle cx="135" cy="150" r="12"/>
    <circle cx="377" cy="150" r="12"/>
    <circle cx="377" cy="362" r="12"/>
  </g>`
}

/**
 * Render the inner markup of the 虹灵 HongLing wordmark: the Chinese name, the
 * accented divider, the Latin name, and the baseline rule.
 * @param instanceId - Document-unique fragment safe inside `url(#…)` references.
 * @returns the wordmark's `<defs>` and painted children, without the outer `<svg>`.
 */
export function wordmarkArtwork(instanceId: string): string {
  return `<defs>
    <linearGradient id="${instanceId}Accent" x1="62" y1="74" x2="1140" y2="236" gradientUnits="userSpaceOnUse">
      <stop stop-color="#715CFF"/>
      <stop offset="0.46" stop-color="#A85DEB"/>
      <stop offset="0.74" stop-color="#F05FAF"/>
      <stop offset="1" stop-color="#27C9E8"/>
    </linearGradient>
  </defs>
  <text fill="currentColor" x="54" y="207"
        font-family="'PingFang SC','Noto Sans CJK SC','Microsoft YaHei',sans-serif"
        font-size="164" font-weight="600" letter-spacing="2">虹灵</text>
  <rect x="432" y="91" width="10" height="118" rx="5" fill="url(#${instanceId}Accent)"/>
  <circle cx="437" cy="69" r="8" fill="#8D67F2"/>
  <text fill="currentColor" x="484" y="201"
        font-family="Inter,'SF Pro Display','Helvetica Neue',Arial,sans-serif"
        font-size="118" font-weight="500" letter-spacing="-4">Hong</text>
  <text fill="url(#${instanceId}Accent)" x="780" y="201"
        font-family="Inter,'SF Pro Display','Helvetica Neue',Arial,sans-serif"
        font-size="118" font-weight="500" letter-spacing="-4">Ling</text>
  <path d="M486 229H1138" stroke="currentColor" stroke-opacity=".12" stroke-width="4" stroke-linecap="round"/>
  <path d="M486 229H687" stroke="url(#${instanceId}Accent)" stroke-width="4" stroke-linecap="round"/>`
}
